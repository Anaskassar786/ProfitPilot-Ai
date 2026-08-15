import type { AnalyticsRepository, CatalogProduct, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { StoreId } from '@profitpilot/types'

type SyncRow = QueryResultRow & { payload: unknown }

export async function buildStoreSnapshot(
  storeId: StoreId,
  analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>,
  database: SqlExecutor,
  now = Date.now(),
): Promise<StoreSnapshot> {
  const [snapshot, catalog, customers, checkouts] = await Promise.all([
    analytics.read(storeId),
    analytics.readCatalog(storeId),
    database.query<SyncRow>('SELECT payload FROM sync_records WHERE store_id = $1 AND module = $2', [storeId, 'customers']).catch(() => ({ rows: [] as readonly SyncRow[] })),
    database.query<SyncRow>('SELECT payload FROM sync_records WHERE store_id = $1 AND module = $2', [storeId, 'checkouts']).catch(() => ({ rows: [] as readonly SyncRow[] })),
  ])
  const asOf = new Date(now).toISOString()
  const last30 = since(now, 30)
  const prev30 = since(now, 60)
  const last30dRevenue = snapshot.revenue.filter((row) => row.day >= last30).reduce((sum, row) => sum + row.grossRevenue, 0)
  const previous30dRevenue = snapshot.revenue.filter((row) => row.day >= prev30 && row.day < last30).reduce((sum, row) => sum + row.grossRevenue, 0)
  const last30dOrders = snapshot.orders.filter((row) => row.day >= last30).reduce((sum, row) => sum + row.orderCount, 0)
  const previous30dOrders = snapshot.orders.filter((row) => row.day >= prev30 && row.day < last30).reduce((sum, row) => sum + row.orderCount, 0)
  return {
    storeId,
    currency: 'USD',
    timezone: 'UTC',
    asOf,
    dataFreshAt: snapshot.revenue.at(-1)?.day ?? asOf,
    products: catalog.map(toProduct),
    customers: customers.rows.flatMap((row) => toCustomer(row.payload, now)),
    checkouts: checkouts.rows.flatMap((row) => toCheckout(row.payload, now)),
    orders: snapshot.orders.flatMap((row) => row.orderCount > 0 ? [{ orderKey: `${row.day}:${row.orderCount}`, total: row.averageOrderValue * row.orderCount, day: row.day, productIds: [], customerKey: null }] : []),
    productPairs: [],
    last30dRevenue,
    previous30dRevenue,
    last30dOrders,
    previous30dOrders,
  }
}

function toProduct(product: CatalogProduct): StoreSnapshot['products'][number] {
  const variants = Array.isArray(product.payload.variants) ? product.payload.variants : []
  const inventory = variants.reduce((sum, variant) => sum + (isRecord(variant) ? numberField(variant.inventory_quantity) ?? 0 : 0), 0)
  const price = variants.reduce((found, variant) => found ?? (isRecord(variant) ? numberField(variant.price) : null), null as number | null)
  const title = typeof product.payload.title === 'string' ? product.payload.title : product.productId
  return { productId: product.productId, title, inventoryUnits: inventory, averageDailyUnits: numberField(product.payload.averageDailyUnits) ?? 0, unitPrice: price ?? 0, unitCost: numberField(product.payload.unitCost), unitsSold120d: numberField(product.payload.unitsSold120d) ?? 0, daysSinceLastSale: numberField(product.payload.daysSinceLastSale) }
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
