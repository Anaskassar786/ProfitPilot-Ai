import { dayLabel } from '@profitpilot/db'
import type { AnalyticsRepository, CatalogProduct, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { StoreId } from '@profitpilot/types'

type SyncRow = QueryResultRow & { payload: unknown }

/**
 * Builds the deterministic rule-engine snapshot from real synced data.
 *
 * PR #46 data-quality fixes:
 * - Currency comes from the most recent synced order (fallback USD only when
 *   the store has no orders at all — the honest cold-start case).
 * - `averageDailyUnits` / `unitsSold120d` / `daysSinceLastSale` are derived
 *   from `analytics_product_sales_daily` instead of nonexistent Shopify
 *   product payload fields, so STOCKOUT_RISK and DEAD_STOCK can actually fire.
 * - `unitCost` reads the Shopify variant `cost` / `inventory_item.cost` when
 *   the sync captured it; otherwise stays null (PRICING_UPLIFT stays silent
 *   rather than inventing a margin).
 * - `productPairs` are built from real order line-item co-occurrence.
 */
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
  const last120 = since(now, 120)
  const prev30 = since(now, 60)
  // `dayLabel` normalizes `pg`'s Date objects for `date` columns; without it
  // the string window comparisons below silently match nothing in production
  // (Date >= string coerces to NaN) and every 30-day figure reads as zero.
  const last30dRevenue = snapshot.revenue.filter((row) => dayLabel(row.day) >= last30).reduce((sum, row) => sum + row.grossRevenue, 0)
  const previous30dRevenue = snapshot.revenue.filter((row) => dayLabel(row.day) >= prev30 && dayLabel(row.day) < last30).reduce((sum, row) => sum + row.grossRevenue, 0)
  const last30dOrders = snapshot.orders.filter((row) => dayLabel(row.day) >= last30).reduce((sum, row) => sum + row.orderCount, 0)
  const previous30dOrders = snapshot.orders.filter((row) => dayLabel(row.day) >= prev30 && dayLabel(row.day) < last30).reduce((sum, row) => sum + row.orderCount, 0)
  const salesByProduct = aggregateProductSales(snapshot.productSales, last30, last120, now)
  const rawOrders = orderRows.rows.map((row) => toOrder(row.payload)).filter((order): order is OrderFacts => order !== null)
  return {
    storeId,
    currency: storeCurrency(rawOrders),
    timezone: 'UTC',
    asOf,
    dataFreshAt: dayLabel(snapshot.revenue.at(-1)?.day) || asOf,
    products: catalog.map((product) => toProduct(product, salesByProduct.get(product.productId))),
    customers: customers.rows.flatMap((row) => toCustomer(row.payload, now)),
    checkouts: checkouts.rows.flatMap((row) => toCheckout(row.payload, now)),
    orders: rawOrders.map((order) => ({ orderKey: order.orderKey, total: order.total, day: order.day, productIds: order.productIds, customerKey: order.customerKey })),
    productPairs: buildProductPairs(rawOrders, catalog),
    last30dRevenue,
    previous30dRevenue,
    last30dOrders,
    previous30dOrders,
  }
}

type ProductSalesFacts = Readonly<{ averageDailyUnits: number; unitsSold120d: number; daysSinceLastSale: number | null }>
type ProductSalesRow = Readonly<{ day: string; productId: string; unitsSold: number }>

/** PR45 compatibility name; derives the standard 30/120-day windows. */
export function velocityByProduct(rows: readonly ProductSalesRow[], now: number): ReadonlyMap<string, ProductSalesFacts> {
  return aggregateProductSales(rows, since(now, 30), since(now, 120), now)
}

/** Velocity facts per product from `analytics_product_sales_daily`. */
export function aggregateProductSales(rows: readonly ProductSalesRow[], last30: string, last120: string, now: number): ReadonlyMap<string, ProductSalesFacts> {
  const perProduct = new Map<string, { units30: number; units120: number; lastSaleDay: string | null }>()
  for (const row of rows) {
    const entry = perProduct.get(row.productId) ?? { units30: 0, units120: 0, lastSaleDay: null }
    const day = dayLabel(row.day)
    if (row.unitsSold > 0) {
      if (day >= last30) entry.units30 += row.unitsSold
      if (day >= last120) entry.units120 += row.unitsSold
      if (entry.lastSaleDay === null || day > entry.lastSaleDay) entry.lastSaleDay = day
    }
    perProduct.set(row.productId, entry)
  }
  const facts = new Map<string, ProductSalesFacts>()
  for (const [productId, entry] of perProduct) {
    const lastSale = entry.lastSaleDay ? Date.parse(`${entry.lastSaleDay}T00:00:00Z`) : Number.NaN
    facts.set(productId, {
      averageDailyUnits: Math.round((entry.units30 / 30) * 1000) / 1000,
      unitsSold120d: entry.units120,
      daysSinceLastSale: Number.isFinite(lastSale) ? Math.max(0, Math.floor((now - lastSale) / 86_400_000)) : null,
    })
  }
  return facts
}

function toProduct(product: CatalogProduct, sales: ProductSalesFacts | undefined): StoreSnapshot['products'][number] {
  const variants = Array.isArray(product.payload.variants) ? product.payload.variants : []
  const inventory = variants.reduce((sum, variant) => sum + (isRecord(variant) ? numberField(variant.inventory_quantity) ?? 0 : 0), 0)
  const price = variants.reduce((found, variant) => found ?? (isRecord(variant) ? numberField(variant.price) : null), null as number | null)
  const cost = variants.reduce((found, variant) => found ?? (isRecord(variant) ? variantCost(variant) : null), null as number | null)
  const title = typeof product.payload.title === 'string' ? product.payload.title : product.productId
  return {
    productId: product.productId,
    title,
    inventoryUnits: inventory,
    averageDailyUnits: sales?.averageDailyUnits ?? numberField(product.payload.averageDailyUnits) ?? 0,
    unitPrice: price ?? 0,
    unitCost: cost ?? numberField(product.payload.unitCost),
    unitsSold120d: sales?.unitsSold120d ?? numberField(product.payload.unitsSold120d) ?? 0,
    daysSinceLastSale: sales?.daysSinceLastSale ?? numberField(product.payload.daysSinceLastSale),
  }
}

/** Shopify exposes cost either on the variant or its nested inventory_item. */
function variantCost(variant: Readonly<Record<string, unknown>>): number | null {
  const direct = numberField(variant.cost ?? variant.inventory_cost ?? variant.cost_per_item)
  if (direct !== null) return direct
  const item = variant.inventory_item
  return isRecord(item) ? numberField(item.cost) : null
}

type OrderFacts = Readonly<{ orderKey: string; total: number; day: string; productIds: readonly string[]; customerKey: string | null; currency?: string | null }>

function toOrder(payload: unknown): OrderFacts | null {
  if (!isRecord(payload)) return null
  const id = payload.id ?? payload.order_number ?? payload.name
  if (typeof id !== 'string' && typeof id !== 'number') return null
  const created = typeof payload.created_at === 'string' ? payload.created_at : null
  const lines = Array.isArray(payload.line_items) ? payload.line_items : []
  const productIds = [...new Set(lines.flatMap((line) => {
    if (!isRecord(line)) return []
    const productId = line.product_id
    return typeof productId === 'string' || typeof productId === 'number' ? [String(productId)] : []
  }))]
  const customer = isRecord(payload.customer) ? payload.customer.id : null
  const rawCurrency = typeof payload.currency === 'string' ? payload.currency : typeof payload.presentment_currency === 'string' ? payload.presentment_currency : null
  const currency = rawCurrency && /^[A-Za-z]{3}$/.test(rawCurrency.trim()) ? rawCurrency.trim().toUpperCase() : null
  return {
    orderKey: String(id),
    total: numberField(payload.total_price ?? payload.current_total_price) ?? 0,
    day: created ? created.slice(0, 10) : '',
    productIds,
    customerKey: typeof customer === 'string' || typeof customer === 'number' ? String(customer) : null,
    currency,
  }
}

/** Latest synced order's currency; USD only as the honest no-orders fallback. */
export function storeCurrency(orders: readonly Readonly<{ day: string; currency?: string | null }>[]): string {
  const latest = [...orders].filter((order) => order.currency != null).sort((left, right) => right.day.localeCompare(left.day))[0]
  return latest?.currency ?? 'USD'
}

/**
 * Co-purchase pairs from real order line items. Rate = co-occurrences of the
 * pair divided by orders containing the anchor product.
 */
export function buildProductPairs<
  T extends Readonly<{ productIds: readonly string[] }>,
  P extends Readonly<{ productId: string; payload?: unknown; unitPrice?: number }>,
>(orders: readonly T[], catalog: readonly P[]): StoreSnapshot['productPairs'] {
  const priceById = new Map<string, number>()
  for (const product of catalog) {
    const payload = isRecord(product.payload) ? product.payload : null
    const variants = payload && Array.isArray(payload.variants) ? payload.variants : []
    const variantPrice = variants.reduce((found, variant) => found ?? (isRecord(variant) ? numberField(variant.price) : null), null as number | null)
    priceById.set(product.productId, variantPrice ?? product.unitPrice ?? 0)
  }
  const productOrderCounts = new Map<string, number>()
  const pairCounts = new Map<string, number>()
  for (const order of orders) {
    const unique = order.productIds
    for (const productId of unique) productOrderCounts.set(productId, (productOrderCounts.get(productId) ?? 0) + 1)
    for (const left of unique) {
      for (const right of unique) {
        if (left === right) continue
        const key = `${left}::${right}`
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }
  const pairs: Array<StoreSnapshot['productPairs'][number]> = []
  for (const [key, count] of pairCounts) {
    const separator = key.indexOf('::')
    const productId = key.slice(0, separator)
    const relatedProductId = key.slice(separator + 2)
    const anchorOrders = productOrderCounts.get(productId) ?? 0
    if (anchorOrders < 2) continue
    pairs.push({
      productId,
      relatedProductId,
      coPurchaseRate: Math.round((count / anchorOrders) * 1000) / 1000,
      productPrice: priceById.get(productId) ?? 0,
      relatedProductPrice: priceById.get(relatedProductId) ?? 0,
    })
  }
  return pairs.sort((left, right) => right.coPurchaseRate - left.coPurchaseRate).slice(0, 50)
}

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

function since(now: number, days: number): string { return new Date(now - days * 86_400_000).toISOString().slice(0, 10) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function numberField(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null }
