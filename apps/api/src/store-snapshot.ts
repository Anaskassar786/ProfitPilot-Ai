import type { AnalyticsRepository, CatalogProduct, ProductSalesMetric, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { StoreId } from '@profitpilot/types'

type SyncRow = QueryResultRow & { payload: unknown }

/** Velocity window: average daily units are computed over the last 30 closed days. */
const VELOCITY_WINDOW_DAYS = 30
/** Dead-stock lookback used for unitsSold120d. */
const DEAD_STOCK_WINDOW_DAYS = 120
/** Only the strongest co-purchase pairs are kept to bound the snapshot size. */
const MAX_PRODUCT_PAIRS = 20

export async function buildStoreSnapshot(
  storeId: StoreId,
  analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>,
  database: SqlExecutor,
  now = Date.now(),
): Promise<StoreSnapshot> {
  const [snapshot, catalog, customers, checkouts, orderRows] = await Promise.all([
    analytics.read(storeId),
    analytics.readCatalog(storeId),
    database.query<SyncRow>('SELECT payload FROM sync_records WHERE store_id = $1 AND module = $2', [storeId, 'customers']).catch(() => ({ rows: [] as readonly SyncRow[] })),
    database.query<SyncRow>('SELECT payload FROM sync_records WHERE store_id = $1 AND module = $2', [storeId, 'checkouts']).catch(() => ({ rows: [] as readonly SyncRow[] })),
    database.query<SyncRow>('SELECT payload FROM sync_records WHERE store_id = $1 AND module = $2', [storeId, 'orders']).catch(() => ({ rows: [] as readonly SyncRow[] })),
  ])
  const asOf = new Date(now).toISOString()
  const last30 = since(now, 30)
  const prev30 = since(now, 60)
  const last30dRevenue = snapshot.revenue.filter((row) => row.day >= last30).reduce((sum, row) => sum + row.grossRevenue, 0)
  const previous30dRevenue = snapshot.revenue.filter((row) => row.day >= prev30 && row.day < last30).reduce((sum, row) => sum + row.grossRevenue, 0)
  const last30dOrders = snapshot.orders.filter((row) => row.day >= last30).reduce((sum, row) => sum + row.orderCount, 0)
  const previous30dOrders = snapshot.orders.filter((row) => row.day >= prev30 && row.day < last30).reduce((sum, row) => sum + row.orderCount, 0)
  const velocity = velocityByProduct(snapshot.productSales, now)
  const rawOrders = orderRows.rows.flatMap((row) => toRawOrder(row.payload))
  const products = catalog.map((product) => toProduct(product, velocity.get(product.productId) ?? null))
  return {
    storeId,
    currency: 'USD',
    timezone: 'UTC',
    asOf,
    dataFreshAt: snapshot.revenue.at(-1)?.day ?? asOf,
    products,
    customers: customers.rows.flatMap((row) => toCustomer(row.payload, now)),
    checkouts: checkouts.rows.flatMap((row) => toCheckout(row.payload, now)),
    orders: snapshot.orders.flatMap((row) => row.orderCount > 0 ? [{ orderKey: `${row.day}:${row.orderCount}`, total: row.averageOrderValue * row.orderCount, day: row.day, productIds: [], customerKey: null }] : []),
    productPairs: buildProductPairs(rawOrders, products),
    last30dRevenue,
    previous30dRevenue,
    last30dOrders,
    previous30dOrders,
  }
}

type ProductVelocity = Readonly<{ averageDailyUnits: number; unitsSold120d: number; daysSinceLastSale: number | null }>

/**
 * PR45 rule-starvation fix: velocity is now derived from real
 * analytics_product_sales rows instead of payload fields Shopify never sends.
 * Without this, STOCKOUT_RISK and PRICING_UPLIFT could never fire and
 * DEAD_STOCK fired for every product.
 */
export function velocityByProduct(productSales: readonly ProductSalesMetric[], now: number): ReadonlyMap<string, ProductVelocity> {
  const velocityStart = since(now, VELOCITY_WINDOW_DAYS)
  const deadStockStart = since(now, DEAD_STOCK_WINDOW_DAYS)
  const map = new Map<string, { recentUnits: number; units120d: number; lastSaleDay: string | null }>()
  for (const row of productSales) {
    const entry = map.get(row.productId) ?? { recentUnits: 0, units120d: 0, lastSaleDay: null }
    if (row.unitsSold > 0) {
      if (row.day >= velocityStart) entry.recentUnits += row.unitsSold
      if (row.day >= deadStockStart) entry.units120d += row.unitsSold
      if (!entry.lastSaleDay || row.day > entry.lastSaleDay) entry.lastSaleDay = row.day
    }
    map.set(row.productId, entry)
  }
  const result = new Map<string, ProductVelocity>()
  for (const [productId, entry] of map) {
    const daysSinceLastSale = entry.lastSaleDay ? Math.max(0, Math.floor((now - Date.parse(entry.lastSaleDay)) / 86_400_000)) : null
    result.set(productId, { averageDailyUnits: round(entry.recentUnits / VELOCITY_WINDOW_DAYS), unitsSold120d: entry.units120d, daysSinceLastSale })
  }
  return result
}

function toProduct(product: CatalogProduct, velocity: ProductVelocity | null): StoreSnapshot['products'][number] {
  const variants = Array.isArray(product.payload.variants) ? product.payload.variants : []
  const inventory = variants.reduce((sum, variant) => sum + (isRecord(variant) ? numberField(variant.inventory_quantity) ?? 0 : 0), 0)
  const price = variants.reduce((found, variant) => found ?? (isRecord(variant) ? numberField(variant.price) : null), null as number | null)
  // Shopify exposes landed cost on the variant's inventory item; syncs store it
  // under `cost` / `inventory_cost` / `cost_per_item` depending on the API used.
  const cost = variants.reduce((found, variant) => found ?? (isRecord(variant) ? numberField(variant.cost ?? variant.inventory_cost ?? variant.cost_per_item) : null), null as number | null)
  const title = typeof product.payload.title === 'string' ? product.payload.title : product.productId
  return {
    productId: product.productId,
    title,
    inventoryUnits: inventory,
    averageDailyUnits: velocity?.averageDailyUnits ?? numberField(product.payload.averageDailyUnits) ?? 0,
    unitPrice: price ?? 0,
    unitCost: cost ?? numberField(product.payload.unitCost),
    unitsSold120d: velocity?.unitsSold120d ?? numberField(product.payload.unitsSold120d) ?? 0,
    daysSinceLastSale: velocity?.daysSinceLastSale ?? numberField(product.payload.daysSinceLastSale),
  }
}

type RawOrder = Readonly<{ productIds: readonly string[] }>

function toCustomer(payload: unknown, now: number): StoreSnapshot['customers'] {
  if (!isRecord(payload)) return []
  const id = payload.id ?? payload.customer_id
  if (typeof id !== 'string' && typeof id !== 'number') return []
  const last = typeof payload.last_order_at === 'string' ? Date.parse(payload.last_order_at) : Number.NaN
  return [{ customerKey: String(id), lifetimeValue: numberField(payload.total_spent ?? payload.lifetime_value) ?? 0, orderCount: numberField(payload.orders_count ?? payload.order_count) ?? 0, daysSinceLastOrder: Number.isFinite(last) ? Math.max(0, Math.floor((now - last) / 86_400_000)) : 365, firstOrderDay: typeof payload.created_at === 'string' ? payload.created_at.slice(0, 10) : new Date(now).toISOString().slice(0, 10) }]
}

function toCheckout(payload: unknown, now: number): StoreSnapshot['checkouts'] {
  if (!isRecord(payload)) return []
  const id = payload.id ?? payload.token
  if (typeof id !== 'string' && typeof id !== 'number') return []
  const created = typeof payload.created_at === 'string' ? Date.parse(payload.created_at) : now
  return [{ checkoutKey: String(id), total: numberField(payload.total_price ?? payload.subtotal_price) ?? 0, ageHours: Math.max(0, (now - created) / 3_600_000), recovered: payload.completed_at != null }]
}

function toRawOrder(payload: unknown): readonly RawOrder[] {
  if (!isRecord(payload)) return []
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : []
  const productIds = [...new Set(lineItems.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = item.product_id ?? item.productId
    return typeof id === 'string' || typeof id === 'number' ? [String(id)] : []
  }))]
  return productIds.length > 0 ? [{ productIds }] : []
}

/**
 * PR45 CROSS_SELL fix: co-purchase pairs are built from real synced order line
 * items instead of the previous hard-coded empty array.
 */
export function buildProductPairs(orders: readonly RawOrder[], products: StoreSnapshot['products']): StoreSnapshot['productPairs'] {
  const productCounts = new Map<string, number>()
  const pairCounts = new Map<string, number>()
  for (const order of orders) {
    for (const productId of order.productIds) productCounts.set(productId, (productCounts.get(productId) ?? 0) + 1)
    for (let left = 0; left < order.productIds.length; left += 1) {
      for (let right = 0; right < order.productIds.length; right += 1) {
        if (left === right) continue
        const key = `${order.productIds[left]}→${order.productIds[right]}`
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }
  const priceOf = new Map(products.map((product) => [product.productId, product.unitPrice]))
  const pairs: Array<StoreSnapshot['productPairs'][number]> = []
  for (const [key, count] of pairCounts) {
    const [productId, relatedProductId] = key.split('→')
    if (!productId || !relatedProductId) continue
    const anchor = productCounts.get(productId) ?? 0
    if (anchor === 0) continue
    pairs.push({ productId, relatedProductId, coPurchaseRate: round(count / anchor), productPrice: priceOf.get(productId) ?? 0, relatedProductPrice: priceOf.get(relatedProductId) ?? 0 })
  }
  return pairs.sort((left, right) => right.coPurchaseRate - left.coPurchaseRate).slice(0, MAX_PRODUCT_PAIRS)
}

function since(now: number, days: number): string { return new Date(now - days * 86_400_000).toISOString().slice(0, 10) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function numberField(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null }
function round(value: number): number { return Math.round(value * 100) / 100 }
