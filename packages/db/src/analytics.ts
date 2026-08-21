import type { StoreId } from '@profitpilot/types'
import type { QueryResultRow } from 'pg'
import type { SqlExecutor } from './database.js'

export type RevenueMetric = Readonly<{ storeId: StoreId; day: string; grossRevenue: number; discounts: number; orderCount: number }>
export type OrdersMetric = Readonly<{ storeId: StoreId; day: string; orderCount: number; fulfilledCount: number; cancelledCount: number; averageOrderValue: number }>
export type ProductSalesMetric = Readonly<{ storeId: StoreId; day: string; productId: string; unitsSold: number; grossRevenue: number }>
export type CustomerCohortMetric = Readonly<{ storeId: StoreId; cohortDay: string; activityDay: string; customerCount: number; grossRevenue: number }>
export type AnalyticsSnapshot = Readonly<{ revenue: readonly RevenueMetric[]; orders: readonly OrdersMetric[]; productSales: readonly ProductSalesMetric[]; customerCohorts: readonly CustomerCohortMetric[] }>
export type DbJsonValue = string | number | boolean | null | DbJsonObject | readonly DbJsonValue[]
export interface DbJsonObject { readonly [key: string]: DbJsonValue }
export type CatalogProduct = Readonly<{ storeId: StoreId; productId: string; payload: DbJsonObject; syncedAt: number }>

export interface AnalyticsRepository {
  upsert(snapshot: AnalyticsSnapshot): Promise<void>
  read(storeId: StoreId): Promise<AnalyticsSnapshot>
  upsertCatalog(products: readonly CatalogProduct[]): Promise<void>
  readCatalog(storeId: StoreId): Promise<readonly CatalogProduct[]>
}

const emptySnapshot = (): AnalyticsSnapshot => ({ revenue: [], orders: [], productSales: [], customerCohorts: [] })

export class InMemoryAnalyticsRepository implements AnalyticsRepository {
  private readonly snapshots = new Map<StoreId, AnalyticsSnapshot>()
  private readonly catalog = new Map<string, CatalogProduct>()

  public async upsert(snapshot: AnalyticsSnapshot): Promise<void> {
    const tenant = snapshot.revenue[0]?.storeId ?? snapshot.orders[0]?.storeId ?? snapshot.productSales[0]?.storeId ?? snapshot.customerCohorts[0]?.storeId
    if (!tenant) return
    const previous = this.snapshots.get(tenant)
    const current = previous ?? emptySnapshot()
    this.snapshots.set(tenant, {
      revenue: mergeRows(current.revenue, snapshot.revenue, (row) => row.day),
      orders: mergeRows(current.orders, snapshot.orders, (row) => row.day),
      productSales: mergeRows(current.productSales, snapshot.productSales, (row) => `${row.day}:${row.productId}`),
      customerCohorts: mergeRows(current.customerCohorts, snapshot.customerCohorts, (row) => `${row.cohortDay}:${row.activityDay}`),
    })
  }

  public async read(storeId: StoreId): Promise<AnalyticsSnapshot> {
    return this.snapshots.get(storeId) ?? emptySnapshot()
  }

  public async upsertCatalog(products: readonly CatalogProduct[]): Promise<void> {
    for (const product of products) this.catalog.set(`${product.storeId}:${product.productId}`, product)
  }

  public async readCatalog(storeId: StoreId): Promise<readonly CatalogProduct[]> {
    return [...this.catalog.values()].filter((product) => product.storeId === storeId)
  }
}

// `pg` deserializes Postgres `date` columns into JavaScript `Date` objects
// (UTC midnight) while the snapshot types declare `day` as a `string`.
// RevenueRow and friends keep the driver-honest `string | Date` union, and
// `dayLabel` normalizes both shapes to the canonical `YYYY-MM-DD` label at
// the repository boundary so every consumer sees what the types promise.
type RevenueRow = QueryResultRow & { store_id: string; day: string | Date; gross_revenue: string | number; discounts: string | number; order_count: number }
type OrdersRow = QueryResultRow & { store_id: string; day: string | Date; order_count: number; fulfilled_count: number; cancelled_count: number; average_order_value: string | number }
type ProductSalesRow = QueryResultRow & { store_id: string; day: string | Date; product_id: string; units_sold: number; gross_revenue: string | number }
type CohortRow = QueryResultRow & { store_id: string; cohort_day: string | Date; activity_day: string | Date; customer_count: number; gross_revenue: string | number }
type CatalogRow = QueryResultRow & { store_id: string; product_id: string; payload: DbJsonObject; synced_at: Date }

export class PostgresAnalyticsRepository implements AnalyticsRepository {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) {
    this.executor = executor
  }

  public async upsert(snapshot: AnalyticsSnapshot): Promise<void> {
    for (const row of snapshot.revenue) await this.executor.query(`INSERT INTO analytics_revenue_daily (store_id, day, gross_revenue, discounts, order_count) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (store_id, day) DO UPDATE SET gross_revenue = EXCLUDED.gross_revenue, discounts = EXCLUDED.discounts, order_count = EXCLUDED.order_count`, [row.storeId, row.day, row.grossRevenue, row.discounts, row.orderCount])
    for (const row of snapshot.orders) await this.executor.query(`INSERT INTO analytics_orders_daily (store_id, day, order_count, fulfilled_count, cancelled_count, average_order_value) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (store_id, day) DO UPDATE SET order_count = EXCLUDED.order_count, fulfilled_count = EXCLUDED.fulfilled_count, cancelled_count = EXCLUDED.cancelled_count, average_order_value = EXCLUDED.average_order_value`, [row.storeId, row.day, row.orderCount, row.fulfilledCount, row.cancelledCount, row.averageOrderValue])
    for (const row of snapshot.productSales) await this.executor.query(`INSERT INTO analytics_product_sales_daily (store_id, day, product_id, units_sold, gross_revenue) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (store_id, day, product_id) DO UPDATE SET units_sold = EXCLUDED.units_sold, gross_revenue = EXCLUDED.gross_revenue`, [row.storeId, row.day, row.productId, row.unitsSold, row.grossRevenue])
    for (const row of snapshot.customerCohorts) await this.executor.query(`INSERT INTO analytics_customer_cohorts_daily (store_id, cohort_day, activity_day, customer_count, gross_revenue) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (store_id, cohort_day, activity_day) DO UPDATE SET customer_count = EXCLUDED.customer_count, gross_revenue = EXCLUDED.gross_revenue`, [row.storeId, row.cohortDay, row.activityDay, row.customerCount, row.grossRevenue])
  }

  public async read(storeId: StoreId): Promise<AnalyticsSnapshot> {
    // QA (2026-08-21): the four reads used to run as Promise.all over four
    // pooled connections. Under a connection-multiplexing proxy (or the QA
    // PGlite emulator) concurrent extended-protocol streams can interleave
    // and glitch a portal, surfacing as a 500 "Internal server error" on the
    // GrowthIQ dashboard. Sequential reads are deterministic and halve peak
    // pool usage at negligible latency cost for typical aggregates.
    const readRows = async (): Promise<Readonly<{ revenue: readonly RevenueRow[]; orders: readonly OrdersRow[]; productSales: readonly ProductSalesRow[]; customerCohorts: readonly CohortRow[] }>> => {
      const revenue = await this.executor.query<RevenueRow>('SELECT store_id, day, gross_revenue, discounts, order_count FROM analytics_revenue_daily WHERE store_id = $1 ORDER BY day', [storeId])
      const orders = await this.executor.query<OrdersRow>('SELECT store_id, day, order_count, fulfilled_count, cancelled_count, average_order_value FROM analytics_orders_daily WHERE store_id = $1 ORDER BY day', [storeId])
      const productSales = await this.executor.query<ProductSalesRow>('SELECT store_id, day, product_id, units_sold, gross_revenue FROM analytics_product_sales_daily WHERE store_id = $1 ORDER BY day', [storeId])
      const customerCohorts = await this.executor.query<CohortRow>('SELECT store_id, cohort_day, activity_day, customer_count, gross_revenue FROM analytics_customer_cohorts_daily WHERE store_id = $1 ORDER BY activity_day', [storeId])
      return { revenue: revenue.rows, orders: orders.rows, productSales: productSales.rows, customerCohorts: customerCohorts.rows }
    }
    const mapRows = (rows: Readonly<{ revenue: readonly RevenueRow[]; orders: readonly OrdersRow[]; productSales: readonly ProductSalesRow[]; customerCohorts: readonly CohortRow[] }>): AnalyticsSnapshot => ({
      revenue: rows.revenue.map((row) => ({ storeId: row.store_id as StoreId, day: dayLabel(row.day), grossRevenue: numeric(row.gross_revenue), discounts: numeric(row.discounts), orderCount: row.order_count })),
      orders: rows.orders.map((row) => ({ storeId: row.store_id as StoreId, day: dayLabel(row.day), orderCount: row.order_count, fulfilledCount: row.fulfilledCount, cancelledCount: row.cancelledCount, averageOrderValue: numeric(row.average_order_value) })),
      productSales: rows.productSales.map((row) => ({ storeId: row.store_id as StoreId, day: dayLabel(row.day), productId: row.product_id, unitsSold: row.units_sold, grossRevenue: numeric(row.gross_revenue) })),
      customerCohorts: rows.customerCohorts.map((row) => ({ storeId: row.store_id as StoreId, cohortDay: dayLabel(row.cohort_day), activityDay: dayLabel(row.activity_day), customerCount: row.customer_count, grossRevenue: numeric(row.gross_revenue) })),
    })
    try {
      return mapRows(await readRows())
    } catch (error: unknown) {
      // A glitched multiplexed response can hand back a row with an undefined
      // column, which numeric() rejects. One clean re-read recovers it; if the
      // second read also fails the error propagates — real corruption must
      // never be silently zeroed.
      if (error instanceof Error && error.message.includes('non-numeric')) return mapRows(await readRows())
      throw error
    }
  }

  public async upsertCatalog(products: readonly CatalogProduct[]): Promise<void> {
    for (const product of products) await this.executor.query(`INSERT INTO catalog_products (store_id, product_id, payload, synced_at) VALUES ($1, $2, $3::jsonb, to_timestamp($4 / 1000.0)) ON CONFLICT (store_id, product_id) DO UPDATE SET payload = EXCLUDED.payload, synced_at = EXCLUDED.synced_at`, [product.storeId, product.productId, JSON.stringify(product.payload), product.syncedAt])
  }

  public async readCatalog(storeId: StoreId): Promise<readonly CatalogProduct[]> {
    const result = await this.executor.query<CatalogRow>('SELECT store_id, product_id, payload, synced_at FROM catalog_products WHERE store_id = $1 ORDER BY product_id', [storeId])
    return result.rows.map((row) => ({ storeId: row.store_id as StoreId, productId: row.product_id, payload: row.payload, syncedAt: row.synced_at.valueOf() }))
  }
}

function numeric(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error('Analytics database returned a non-numeric value')
  return parsed
}

/**
 * Canonical `YYYY-MM-DD` label for a `date` column value.
 *
 * `pg` parses `date` columns into `Date` objects (UTC midnight), so a
 * `Date` input is converted in UTC — never local time — to keep the label
 * identical to the stored calendar day. String inputs are truncated to the
 * date part so ISO timestamps (`timestamptz` mapped as text) still work.
 */
export function dayLabel(value: string | Date | null | undefined): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string') return value.slice(0, 10)
  return ''
}

function mergeRows<Row>(current: readonly Row[], next: readonly Row[], key: (row: Row) => string): readonly Row[] {
  const merged = new Map(current.map((row) => [key(row), row]))
  for (const row of next) merged.set(key(row), row)
  return [...merged.values()]
}
