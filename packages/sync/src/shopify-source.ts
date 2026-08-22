import { ShopifyApiError, ShopifyClient } from '@profitpilot/shopify'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { SyncModule, SyncPage, SyncRecord, SyncSource } from './sync.js'

export type ShopifyClientFactory = (storeId: StoreId) => Promise<ShopifyClient>

/**
 * Shopify accepts a bounded `location_ids` filter on /inventory_levels.json.
 * Locations beyond this bound are still persisted as metadata (flagged with
 * `levels_queried: false`) so the workspace can tell the merchant that some
 * locations were not included instead of silently dropping them.
 */
export const INVENTORY_LOCATION_QUERY_LIMIT = 50
/** Marks a location metadata row inside the `inventory` sync module. */
export const LOCATION_RECORD_PREFIX = 'location:'

type ShopifyLocation = Readonly<{ id: string; name: string | null; city: string | null; province: string | null; country: string | null; active: boolean | null; legacy: boolean | null }>

/**
 * Products, orders, and customers are synced through the Shopify GraphQL Admin
 * API (cursor-paginated with `after`). Inventory, collections, and discounts
 * remain on their REST endpoints because Shopify has no lossless GraphQL
 * equivalent for inventory levels (`/inventory_levels.json`) and the legacy
 * price-rules resource (`/price_rules.json`) is still the only source that
 * exposes legacy discount rules.
 *
 * GraphQL nodes are mapped back to the legacy REST field names (snake_case,
 * numeric ids) so `sync_records`, `catalog_products`, analytics, GDPR redact,
 * and the rule-engine snapshot keep working without any downstream change.
 */
export class ShopifyGraphqlSyncSource implements SyncSource {
  private readonly clients: ShopifyClientFactory
  private readonly pageSize: number

  public constructor(clients: ShopifyClientFactory, pageSize = 250) {
    if (pageSize < 1 || pageSize > 250) throw new RangeError('Shopify GraphQL page size must be between 1 and 250')
    this.clients = clients
    this.pageSize = pageSize
  }

  public async fetchPage(storeId: StoreId, module: SyncModule, cursor: string | null): Promise<SyncPage> {
    const client = await this.clients(storeId)
    if (module === 'inventory') return this.fetchInventory(client, cursor)
    if (module === 'collections') return this.fetchCollections(client, cursor)
    if (module === 'discounts') return this.fetchSimpleRest(client, '/price_rules.json', 'price_rules', 'discounts', cursor)
    return this.fetchGraphql(client, module, cursor)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GraphQL modules: products, orders, customers
  // ──────────────────────────────────────────────────────────────────────────

  private async fetchGraphql(client: ShopifyClient, module: 'products' | 'orders' | 'customers', cursor: string | null): Promise<SyncPage> {
    const definition = GRAPHQL_MODULES[module]
    const data = await this.graphql(client, definition.query, { first: this.pageSize, after: cursor ?? null }, module)
    const connection = record(data[definition.connectionKey])
    const edges = array(connection?.edges)
    const records = edges.flatMap((edge) => {
      const node = record(record(edge)?.node)
      if (!node) return []
      const mapped = definition.map(node)
      if (mapped.id === undefined || mapped.id === null || String(mapped.id).trim() === '') {
        throw new AppError('DEPENDENCY_ERROR', `Shopify ${module} resource is missing a stable id`, 502, { module })
      }
      return [mapped]
    })
    const pageInfo = record(connection?.pageInfo)
    const nextCursor = pageInfo?.hasNextPage === true ? nullableString(pageInfo.endCursor) : null
    return { records, nextCursor }
  }

  private async graphql(client: ShopifyClient, query: string, variables: Readonly<Record<string, unknown>>, module: SyncModule): Promise<Readonly<Record<string, unknown>>> {
    let body: GraphqlBody
    try {
      const response = await client.request<GraphqlBody>({ path: '/graphql.json', method: 'POST', body: JSON.stringify({ query, variables }) })
      body = response.data
    } catch (error: unknown) {
      if (error instanceof ShopifyApiError && (error.status === 401 || error.status === 403)) {
        throw new AppError('DEPENDENCY_ERROR', `Shopify denied the ${module} sync (${error.status}). Reinstall the app so it can request the required access scopes.`, error.status === 401 ? 401 : 403, { module, upstreamStatus: error.status })
      }
      throw error
    }
    const rawErrors = array(body.errors)
    const messages = rawErrors.map((item) => record(item)?.message).filter((message): message is string => typeof message === 'string')
    if (messages.length > 0 || rawErrors.length > 0) {
      // Log the full GraphQL error body for future debugging instead of only the truncated message.
      const full = (() => {
        try {
          return JSON.stringify(body.errors)
        } catch {
          return String(body.errors)
        }
      })()
      // eslint-disable-next-line no-console
      console.error(`[shopify-sync] GraphQL ${module} errors`, { errors: body.errors, variables })
      const joined = messages.length > 0 ? messages.join('; ') : full
      throw new AppError('DEPENDENCY_ERROR', `Shopify ${module} sync failed: ${joined}`, 502, { module, graphqlFull: full.slice(0, 2000) })
    }
    const data = record(body.data)
    if (!data) {
      const full = (() => {
        try {
          return JSON.stringify(body)
        } catch {
          return String(body)
        }
      })()
      // eslint-disable-next-line no-console
      console.error(`[shopify-sync] GraphQL ${module} missing data`, { body, variables })
      throw new AppError('DEPENDENCY_ERROR', `Shopify ${module} sync response did not contain data: ${full}`, 502, { module, graphqlFull: full.slice(0, 2000) })
    }
    return data
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REST modules: inventory, collections, discounts
  // ──────────────────────────────────────────────────────────────────────────

  private async fetchSimpleRest(client: ShopifyClient, path: string, key: string, module: SyncModule, cursor: string | null): Promise<SyncPage> {
    const response = await this.request(client, this.path(path, cursor), module)
    return { records: recordsFrom(response.data, key, module), nextCursor: parseNextCursor(response.headers.link ?? null) }
  }

  /**
   * Inventory levels require location_ids (or inventory_item_ids). Fetch
   * locations first, then page inventory for those locations.
   *
   * The location resources are persisted alongside the levels (once, on the
   * first page) under a `location:` record id so the workspace can render a
   * real location name instead of a bare Shopify id. Shopify has no
   * `/locations` sync module, and adding one would change the module contract,
   * so the inventory module carries both record kinds.
   */
  private async fetchInventory(client: ShopifyClient, cursor: string | null): Promise<SyncPage> {
    const locations = await this.locations(client)
    if (locations.length === 0) return { records: [], nextCursor: null }
    const queried = locations.slice(0, INVENTORY_LOCATION_QUERY_LIMIT)
    const params = cursor
      ? `limit=${this.pageSize}&page_info=${encodeURIComponent(cursor)}`
      : `limit=${this.pageSize}&location_ids=${queried.map((location) => location.id).join(',')}`
    const response = await this.request(client, `/inventory_levels.json?${params}`, 'inventory')
    const levels = recordsFrom(response.data, 'inventory_levels', 'inventory')
    // Only the first page carries the location metadata; resumed pages must not
    // re-request or duplicate it.
    const locationRecords: readonly SyncRecord[] = cursor
      ? []
      : locations.map((location, index) => ({ ...location, id: `${LOCATION_RECORD_PREFIX}${location.id}`, record_kind: 'location', location_id: location.id, levels_queried: index < INVENTORY_LOCATION_QUERY_LIMIT }))
    // Levels stay first so the module's primary payload is unchanged; the
    // location rows are appended metadata.
    return { records: [...levels, ...locationRecords], nextCursor: parseNextCursor(response.headers.link ?? null) }
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
   * Returns the shop's locations with their real metadata. Previously only the
   * id was kept, which forced the UI to display a raw Shopify location number.
   */
  private async locations(client: ShopifyClient): Promise<readonly ShopifyLocation[]> {
    const response = await this.request(client, '/locations.json?limit=250', 'inventory')
    return arrayField(response.data, 'locations').flatMap((location) => {
      const id = location.id
      if (typeof id !== 'string' && typeof id !== 'number') return []
      return [{
        id: String(id),
        name: typeof location.name === 'string' && location.name.trim() ? location.name.trim() : null,
        city: typeof location.city === 'string' && location.city.trim() ? location.city.trim() : null,
        province: typeof location.province === 'string' && location.province.trim() ? location.province.trim() : null,
        country: typeof location.country === 'string' && location.country.trim() ? location.country.trim() : null,
        active: typeof location.active === 'boolean' ? location.active : null,
        legacy: typeof location.legacy === 'boolean' ? location.legacy : null,
      }]
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

// ────────────────────────────────────────────────────────────────────────────
// GraphQL queries + node → legacy-shape mappers
// ────────────────────────────────────────────────────────────────────────────

type GraphqlBody = Readonly<{ data?: unknown; errors?: readonly unknown[] }>

type GraphqlModule = Readonly<{ query: string; connectionKey: string; map: (node: Readonly<Record<string, unknown>>) => SyncRecord }>

const PRODUCTS_QUERY = `query ProfitPilotProducts($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges { node {
      id title handle status createdAt updatedAt vendor productType descriptionHtml tags
      variants(first: 250) { edges { node {
        id title sku price inventoryQuantity
        inventoryItem { id unitCost { amount } }
      } } }
      options { id name values }
      images(first: 10) { edges { node { id url altText } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`

const ORDERS_QUERY = `query ProfitPilotOrders($first: Int!, $after: String) {
  orders(first: $first, after: $after) {
    edges { node {
      id name createdAt updatedAt processedAt cancelledAt cancelReason note tags email phone
      displayFinancialStatus displayFulfillmentStatus currencyCode presentmentCurrencyCode
      totalPriceSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount currencyCode } }
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      currentTotalTaxSet { shopMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } }
      currentTotalDiscountsSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      currentTotalShippingPriceSet { shopMoney { amount currencyCode } }
      customer {
        id firstName lastName createdAt
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
      }
      lineItems(first: 50) { edges { node {
        id title variantTitle sku quantity
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        totalDiscountSet { shopMoney { amount currencyCode } }
        product { id }
        variant { id }
      } } }
      shippingAddress { firstName lastName company address1 address2 city province zip country countryCodeV2 phone }
      billingAddress { firstName lastName company address1 address2 city province zip country countryCodeV2 phone }
      transactions {
        id kind status createdAt processedAt gateway
        amountSet { shopMoney { amount currencyCode } }
        parentTransaction { id }
      }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`

const CUSTOMERS_QUERY = `query ProfitPilotCustomers($first: Int!, $after: String) {
  customers(first: $first, after: $after) {
    edges { node {
      id firstName lastName createdAt updatedAt note tags
      numberOfOrders
      amountSpent { amount currencyCode }
      lastOrder { id name }
      defaultEmailAddress { emailAddress marketingState }
      defaultPhoneNumber { phoneNumber }
      defaultAddress { firstName lastName company address1 address2 city province zip country countryCodeV2 phone }
      addressesV2(first: 10) { edges { node { firstName lastName company address1 address2 city province zip country countryCodeV2 phone } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`

const GRAPHQL_MODULES: Readonly<Record<'products' | 'orders' | 'customers', GraphqlModule>> = {
  products: { query: PRODUCTS_QUERY, connectionKey: 'products', map: mapGraphqlProduct },
  orders: { query: ORDERS_QUERY, connectionKey: 'orders', map: mapGraphqlOrder },
  customers: { query: CUSTOMERS_QUERY, connectionKey: 'customers', map: mapGraphqlCustomer },
}

/** Maps a GraphQL Product node to the legacy REST product shape. */
export function mapGraphqlProduct(node: Readonly<Record<string, unknown>>): SyncRecord {
  const productId = gidNumber(node.id) ?? ''
  return {
    id: productId,
    admin_graphql_api_id: nullableString(node.id),
    title: nullableString(node.title),
    handle: nullableString(node.handle),
    status: nullableString(node.status)?.toLowerCase() ?? null,
    created_at: nullableString(node.createdAt),
    updated_at: nullableString(node.updatedAt),
    vendor: nullableString(node.vendor),
    product_type: nullableString(node.productType),
    body_html: nullableString(node.descriptionHtml),
    tags: array(node.tags),
    variants: connectionNodes(node.variants).map((variant) => mapGraphqlVariant(variant, productId)),
    options: array(node.options).map((option) => {
      const raw = record(option) ?? {}
      return { id: gidNumber(raw.id), product_id: productId, name: nullableString(raw.name), values: array(raw.values) }
    }),
    images: connectionNodes(node.images).map((image) => {
      const raw = record(image) ?? {}
      return { id: gidNumber(raw.id), product_id: productId, src: nullableString(raw.url), alt: nullableString(raw.altText) }
    }),
  }
}

function mapGraphqlVariant(node: Readonly<Record<string, unknown>>, productId: string): SyncRecord {
  const inventoryItem = record(node.inventoryItem)
  const unitCost = record(inventoryItem?.unitCost)
  return {
    id: gidNumber(node.id),
    product_id: productId,
    title: nullableString(node.title),
    sku: nullableString(node.sku),
    price: nullableString(node.price),
    inventory_quantity: numberOrNull(node.inventoryQuantity),
    inventory_item: {
      id: gidNumber(inventoryItem?.id),
      cost: nullableString(unitCost?.amount),
    },
  }
}

/** Maps a GraphQL Order node to the legacy REST order shape, with nested transactions. */
export function mapGraphqlOrder(node: Readonly<Record<string, unknown>>): SyncRecord {
  const orderId = gidNumber(node.id) ?? ''
  const customer = record(node.customer)
  return {
    id: orderId,
    admin_graphql_api_id: nullableString(node.id),
    order_number: parseOrderNumber(nullableString(node.name)),
    name: nullableString(node.name),
    created_at: nullableString(node.createdAt),
    updated_at: nullableString(node.updatedAt),
    processed_at: nullableString(node.processedAt),
    cancelled_at: nullableString(node.cancelledAt),
    cancel_reason: nullableString(node.cancelReason)?.toLowerCase() ?? null,
    note: nullableString(node.note),
    tags: array(node.tags),
    email: nullableString(node.email),
    phone: nullableString(node.phone),
    financial_status: nullableString(node.displayFinancialStatus)?.toLowerCase() ?? null,
    fulfillment_status: mapFulfillmentStatus(node.displayFulfillmentStatus ?? node.fulfillmentStatus),
    currency: nullableString(node.currencyCode),
    presentment_currency: nullableString(node.presentmentCurrencyCode),
    total_price: moneyAmount(node.totalPriceSet),
    current_total_price: moneyAmount(node.currentTotalPriceSet),
    subtotal_price: moneyAmount(node.subtotalPriceSet),
    current_subtotal_price: moneyAmount(node.currentSubtotalPriceSet),
    total_tax: moneyAmount(node.totalTaxSet),
    current_total_tax: moneyAmount(node.currentTotalTaxSet),
    total_discounts: moneyAmount(node.totalDiscountsSet),
    current_total_discounts: moneyAmount(node.currentTotalDiscountsSet),
    total_shipping_price_set: moneySet(node.totalShippingPriceSet),
    current_total_shipping_price_set: moneySet(node.currentTotalShippingPriceSet),
    customer: customer
      ? {
          id: gidNumber(customer.id),
          email: customerEmail(customer),
          phone: customerPhone(customer),
          first_name: nullableString(customer.firstName),
          last_name: nullableString(customer.lastName),
          created_at: nullableString(customer.createdAt),
        }
      : null,
    line_items: connectionNodes(node.lineItems).map((line) => mapGraphqlLineItem(record(line) ?? {})),
    shipping_address: mapAddress(record(node.shippingAddress)),
    billing_address: mapAddress(record(node.billingAddress)),
    transactions: transactionNodes(node.transactions).map((transaction) => mapGraphqlTransaction(record(transaction) ?? {}, orderId)),
  }
}

function customerEmail(node: Readonly<Record<string, unknown>>): string | null {
  // New Admin API: defaultEmailAddress { emailAddress }, legacy: email
  const direct = nullableString(node.email)
  if (direct) return direct
  const emailAddress = record(node.defaultEmailAddress)
  return nullableString(emailAddress?.emailAddress)
}

function customerPhone(node: Readonly<Record<string, unknown>>): string | null {
  const direct = nullableString(node.phone)
  if (direct) return direct
  const phone = record(node.defaultPhoneNumber)
  return nullableString(phone?.phoneNumber)
}

function transactionNodes(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  // Order.transactions is a list [OrderTransaction!]! in 2026-07, not a connection.
  // Support both shapes for backward compatibility with tests/mocks.
  if (Array.isArray(value)) return value.filter(isRecord)
  return connectionNodes(value)
}

function mapGraphqlLineItem(node: Readonly<Record<string, unknown>>): SyncRecord {
  const product = record(node.product)
  const variant = record(node.variant)
  return {
    id: gidNumber(node.id),
    title: nullableString(node.title),
    variant_title: nullableString(node.variantTitle),
    sku: nullableString(node.sku),
    quantity: numberOrNull(node.quantity) ?? 0,
    price: moneyAmount(node.originalUnitPriceSet),
    total_discount: moneyAmount(node.totalDiscountSet),
    product_id: product?.id ? gidNumber(product.id) : null,
    variant_id: variant?.id ? gidNumber(variant.id) : null,
  }
}

function mapGraphqlTransaction(node: Readonly<Record<string, unknown>>, orderId: string): SyncRecord {
  const parent = record(node.parentTransaction)
  return {
    id: gidNumber(node.id),
    order_id: orderId,
    kind: nullableString(node.kind)?.toLowerCase() ?? null,
    status: nullableString(node.status)?.toLowerCase() ?? null,
    amount: moneyAmount(node.amountSet),
    currency: moneyCurrency(node.amountSet),
    created_at: nullableString(node.createdAt),
    processed_at: nullableString(node.processedAt),
    gateway: nullableString(node.gateway),
    parent_id: parent?.id ? gidNumber(parent.id) : null,
  }
}

/** Maps a GraphQL Customer node to the legacy REST customer shape. */
export function mapGraphqlCustomer(node: Readonly<Record<string, unknown>>): SyncRecord {
  const amountSpent = record(node.amountSpent)
  const amount = nullableString(amountSpent?.amount)
  const currencyCode = nullableString(amountSpent?.currencyCode)
  const lastOrder = record(node.lastOrder)
  const phone = record(node.defaultPhoneNumber)
  const emailAddress = record(node.defaultEmailAddress)
  // New API uses defaultEmailAddress.marketingState, legacy used emailMarketingConsent.marketingState
  const legacyConsent = record(node.emailMarketingConsent)
  const marketingState = emailAddress?.marketingState ?? legacyConsent?.marketingState ?? null
  // Support both addresses (deprecated) and addressesV2 (current)
  const addressesConnection = node.addressesV2 ?? node.addresses
  const email = nullableString(node.email) ?? nullableString(emailAddress?.emailAddress)
  return {
    id: gidNumber(node.id) ?? '',
    admin_graphql_api_id: nullableString(node.id),
    email,
    phone: nullableString(phone?.phoneNumber),
    first_name: nullableString(node.firstName),
    last_name: nullableString(node.lastName),
    created_at: nullableString(node.createdAt),
    updated_at: nullableString(node.updatedAt),
    note: nullableString(node.note),
    tags: array(node.tags),
    orders_count: numberOrNull(node.numberOfOrders),
    total_spent: amount,
    amountSpent: { amount, currencyCode },
    last_order_id: lastOrder?.id ? gidNumber(lastOrder.id) : null,
    last_order_name: nullableString(lastOrder?.name),
    default_address: mapAddress(record(node.defaultAddress)),
    addresses: connectionNodes(addressesConnection).map((address) => mapAddress(record(address) ?? {})),
    email_marketing_consent: marketingState ? { state: nullableString(marketingState)?.toLowerCase() ?? null } : null,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Shared mapping helpers
// ────────────────────────────────────────────────────────────────────────────

/** Extracts the numeric id from a GraphQL `gid://shopify/Type/123` id. */
function gidNumber(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = /^gid:\/\/shopify\/[^/]+\/(\d+)$/.exec(trimmed)
  return match?.[1] ?? trimmed
}

/** Returns the numeric order number from a Shopify order name such as `#1001`. */
function parseOrderNumber(name: string | null): string | null {
  if (!name) return null
  const match = /^#?(\d+)$/.exec(name.trim())
  return match?.[1] ?? null
}

/** Maps the GraphQL `OrderFulfillmentStatus` enum to the legacy REST value. */
function mapFulfillmentStatus(value: unknown): string | null {
  const normalized = nullableString(value)?.toLowerCase() ?? null
  if (!normalized) return null
  if (normalized === 'pending_fulfillment') return 'pending'
  return normalized
}

function mapAddress(node: Readonly<Record<string, unknown>> | null): SyncRecord | null {
  if (!node) return null
  return {
    first_name: nullableString(node.firstName),
    last_name: nullableString(node.lastName),
    company: nullableString(node.company),
    address1: nullableString(node.address1),
    address2: nullableString(node.address2),
    city: nullableString(node.city),
    province: nullableString(node.province),
    zip: nullableString(node.zip),
    country: nullableString(node.country),
    country_code: nullableString(node.countryCodeV2) ?? nullableString(node.countryCode),
    phone: nullableString(node.phone),
  }
}

function moneyAmount(set: unknown): string | null {
  const bag = record(set)
  const shop = record(bag?.shopMoney)
  return nullableString(shop?.amount)
}

function moneyCurrency(set: unknown): string | null {
  const bag = record(set)
  const shop = record(bag?.shopMoney)
  return nullableString(shop?.currencyCode)
}

function moneySet(set: unknown): SyncRecord | null {
  const bag = record(set)
  const shop = record(bag?.shopMoney)
  if (!shop) return null
  return { shop_money: { amount: nullableString(shop.amount), currency_code: nullableString(shop.currencyCode) } }
}

function connectionNodes(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  const connection = record(value)
  return array(connection?.edges).flatMap((edge) => {
    const node = record(record(edge)?.node)
    return node ? [node] : []
  })
}

// ────────────────────────────────────────────────────────────────────────────
// REST record helpers (shared with the remaining REST modules)
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Low-level value helpers
// ────────────────────────────────────────────────────────────────────────────

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function nullableString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number') return String(value)
  return null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
