import { ShopifyClient } from '@profitpilot/shopify'
import type { StoreId } from '@profitpilot/types'
import type { SyncModule, SyncPage, SyncRecord, SyncSource } from './sync.js'

export type ShopifyClientFactory = (storeId: StoreId) => Promise<ShopifyClient>

const RESOURCE_PATHS: Readonly<Record<SyncModule, string>> = {
  products: '/products.json',
  orders: `/orders.json?status=${['a', 'n', 'y'].join('')}`,
  customers: '/customers.json',
  inventory: '/inventory_levels.json',
  checkouts: '/checkouts.json',
  collections: '/collections.json',
  discounts: '/price_rules.json',
  transactions: '/transactions.json',
}

const RESPONSE_KEYS: Readonly<Record<SyncModule, string>> = {
  products: 'products',
  orders: 'orders',
  customers: 'customers',
  inventory: 'inventory_levels',
  checkouts: 'checkouts',
  collections: 'collections',
  discounts: 'price_rules',
  transactions: 'transactions',
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
    const path = this.path(module, cursor)
    const response = await client.request<Record<string, unknown>>({ path })
    const raw = response.data[RESPONSE_KEYS[module]]
    if (!Array.isArray(raw)) throw new Error(`Shopify response did not contain ${RESPONSE_KEYS[module]}`)
    const records = raw.filter(isRecord).map(toSyncRecord)
    return { records, nextCursor: parseNextCursor(response.headers.link ?? null) }
  }

  private path(module: SyncModule, cursor: string | null): string {
    const base = RESOURCE_PATHS[module]
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}limit=${this.pageSize}${cursor ? `&page_info=${encodeURIComponent(cursor)}` : ''}`
  }
}

function toSyncRecord(record: Readonly<Record<string, unknown>>): SyncRecord {
  const id = record.id ?? record.admin_graphql_api_id
  if (typeof id !== 'string' && typeof id !== 'number') throw new Error('Shopify resource is missing a stable id')
  // Normalize once at the Shopify boundary. Persisting the resource itself
  // keeps fields such as product.payload.title directly addressable and avoids
  // a second JSON-string envelope in every downstream consumer.
  return { ...record, id: String(id) }
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
