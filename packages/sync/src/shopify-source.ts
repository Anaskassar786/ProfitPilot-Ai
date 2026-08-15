import { ShopifyApiError, ShopifyClient } from '@profitpilot/shopify'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { SyncModule, SyncPage, SyncRecord, SyncSource } from './sync.js'

export type ShopifyClientFactory = (storeId: StoreId) => Promise<ShopifyClient>

const RESOURCE_PATHS: Readonly<Record<SyncModule, string>> = {
  products: '/products.json',
  orders: `/orders.json?status=${['a', 'n', 'y'].join('')}`,
  customers: '/customers.json',
  inventory: '/inventory_levels.json',
  checkouts: '/checkouts.json',
  collections: '/custom_collections.json',
  discounts: '/price_rules.json',
  transactions: '/orders.json',
}

const RESPONSE_KEYS: Readonly<Record<SyncModule, string>> = {
  products: 'products',
  orders: 'orders',
  customers: 'customers',
  inventory: 'inventory_levels',
  checkouts: 'checkouts',
  collections: 'custom_collections',
  discounts: 'price_rules',
  transactions: 'orders',
}

export class ShopifyRestSyncSource implements SyncSource {
  private readonly clients: ShopifyClientFactory
  private readonly pageSize: number

  public constructor(clients: ShopifyClientFactory, pageSize = 250) {
    if (pageSize < 1 || pageSize > 250) throw new RangeError('Shopify REST page size must be between 1 and 250')
    this.clients = clients
    this.pageSize = pageSize
  }

  public async fetchPage(storeId: StoreId, module: SyncModule, cursor: string | null): Promise<SyncPage> {
    const client = await this.clients(storeId)
    if (module === 'inventory') return this.fetchInventory(client, cursor)
    if (module === 'collections') return this.fetchCollections(client, cursor)
    if (module === 'transactions') return this.fetchTransactions(client, cursor)
    return this.fetchSimple(client, module, cursor)
  }

  private async fetchSimple(client: ShopifyClient, module: SyncModule, cursor: string | null): Promise<SyncPage> {
    const response = await this.request(client, this.path(RESOURCE_PATHS[module], cursor), module)
    return { records: recordsFrom(response.data, RESPONSE_KEYS[module], module), nextCursor: parseNextCursor(response.headers.link ?? null) }
  }

  /**
   * Inventory levels require location_ids (or inventory_item_ids). Fetch
   * locations first, then page inventory for those locations.
   */
  private async fetchInventory(client: ShopifyClient, cursor: string | null): Promise<SyncPage> {
    const locationIds = await this.locationIds(client)
    if (locationIds.length === 0) return { records: [], nextCursor: null }
    const params = cursor
      ? `limit=${this.pageSize}&page_info=${encodeURIComponent(cursor)}`
      : `limit=${this.pageSize}&location_ids=${locationIds.slice(0, 50).join(',')}`
    const response = await this.request(client, `/inventory_levels.json?${params}`, 'inventory')
    return { records: recordsFrom(response.data, 'inventory_levels', 'inventory'), nextCursor: parseNextCursor(response.headers.link ?? null) }
  }

  /**
   * Shopify has no /collections.json. Custom and smart collections are two
   * resources; the cursor encodes which list we are paging.
   */
  private async fetchCollections(client: ShopifyClient, cursor: string | null): Promise<SyncPage> {
    const parsed = parseCollectionCursor(cursor)
    const path = parsed.kind === 'smart' ? '/smart_collections.json' : '/custom_collections.json'
    const key = parsed.kind === 'smart' ? 'smart_collections' : 'custom_collections'
    const response = await this.request(client, this.path(path, parsed.pageInfo), 'collections')
    const records = recordsFrom(response.data, key, 'collections').map((record) => ({ ...record, collection_kind: parsed.kind }))
    const next = parseNextCursor(response.headers.link ?? null)
    if (next) return { records, nextCursor: `${parsed.kind}:${next}` }
    if (parsed.kind === 'custom') return { records, nextCursor: 'smart:' }
    return { records, nextCursor: null }
  }

  /**
   * Transactions live under each order. Page a compact order list, then load
   * /orders/{id}/transactions.json for that page.
   */
  private async fetchTransactions(client: ShopifyClient, cursor: string | null): Promise<SyncPage> {
    const orderLimit = Math.min(25, this.pageSize)
    const ordersPath = cursor
      ? `/orders.json?limit=${orderLimit}&page_info=${encodeURIComponent(cursor)}`
      : `/orders.json?status=any&fields=id,admin_graphql_api_id&limit=${orderLimit}`
    const orders = await this.request(client, ordersPath, 'transactions')
    const orderRecords = arrayField(orders.data, 'orders')
    const records: SyncRecord[] = []
    for (const order of orderRecords) {
      const orderId = order.id ?? order.admin_graphql_api_id
      if (typeof orderId !== 'string' && typeof orderId !== 'number') continue
      try {
        const txn = await this.request(client, `/orders/${encodeURIComponent(String(orderId))}/transactions.json`, 'transactions')
        for (const record of recordsFrom(txn.data, 'transactions', 'transactions')) {
          records.push({ ...record, order_id: String(orderId) })
        }
      } catch (error: unknown) {
        if (error instanceof ShopifyApiError && (error.status === 404 || error.status === 403)) continue
        throw error
      }
    }
    return { records, nextCursor: parseNextCursor(orders.headers.link ?? null) }
  }

  private async locationIds(client: ShopifyClient): Promise<readonly string[]> {
    const response = await this.request(client, '/locations.json?limit=250', 'inventory')
    return arrayField(response.data, 'locations').flatMap((location) => {
      const id = location.id
      return typeof id === 'string' || typeof id === 'number' ? [String(id)] : []
    })
  }

  private path(base: string, cursor: string | null): string {
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}limit=${this.pageSize}${cursor ? `&page_info=${encodeURIComponent(cursor)}` : ''}`
  }

  private async request(client: ShopifyClient, path: string, module: SyncModule): Promise<Readonly<{ data: Record<string, unknown>; headers: Readonly<Record<string, string>> }>> {
    try {
      return await client.request<Record<string, unknown>>({ path })
    } catch (error: unknown) {
      if (error instanceof ShopifyApiError && (error.status === 403 || error.status === 401)) {
        throw new AppError('DEPENDENCY_ERROR', `Shopify denied the ${module} sync (${error.status}). Reinstall the app so it can request the required access scopes.`, error.status === 401 ? 401 : 403, { module, upstreamStatus: error.status })
      }
      throw error
    }
  }
}

function recordsFrom(data: Readonly<Record<string, unknown>>, key: string, module: SyncModule): SyncRecord[] {
  const raw = data[key]
  if (!Array.isArray(raw)) throw new AppError('DEPENDENCY_ERROR', `Shopify ${module} response did not contain ${key}`, 502, { module, key })
  return raw.filter(isRecord).map((record) => toSyncRecord(record, module))
}

function arrayField(data: Readonly<Record<string, unknown>>, key: string): readonly Readonly<Record<string, unknown>>[] {
  const raw = data[key]
  return Array.isArray(raw) ? raw.filter(isRecord) : []
}

function toSyncRecord(record: Readonly<Record<string, unknown>>, module: SyncModule): SyncRecord {
  const composed = module === 'inventory' && record.location_id != null && record.inventory_item_id != null
    ? `${record.location_id}:${record.inventory_item_id}`
    : null
  const id = record.id ?? composed ?? record.admin_graphql_api_id
  if (typeof id !== 'string' && typeof id !== 'number') throw new AppError('DEPENDENCY_ERROR', `Shopify ${module} resource is missing a stable id`, 502, { module })
  return { ...record, id: String(id) }
}

function parseCollectionCursor(cursor: string | null): Readonly<{ kind: 'custom' | 'smart'; pageInfo: string | null }> {
  if (!cursor) return { kind: 'custom', pageInfo: null }
  if (cursor === 'smart:' || cursor.startsWith('smart:')) return { kind: 'smart', pageInfo: cursor.slice('smart:'.length) || null }
  if (cursor.startsWith('custom:')) return { kind: 'custom', pageInfo: cursor.slice('custom:'.length) || null }
  return { kind: 'custom', pageInfo: cursor }
}

function parseNextCursor(link: string | null): string | null {
  if (!link) return null
  const next = link.split(',').find((part) => part.includes('rel="next"'))
  if (!next) return null
  const match = next.match(/<([^>]+)>/)
  if (!match?.[1]) return null
  return new URL(match[1]).searchParams.get('page_info')
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
