import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { storeId } from '@profitpilot/types'
import type { DatabaseResult, SqlExecutor } from './index.js'
import { InMemoryAnalyticsRepository, PostgresAnalyticsRepository } from './index.js'
import type { AnalyticsSnapshot, CatalogProduct } from './index.js'

const store = storeId('store-1')
const snapshot: AnalyticsSnapshot = {
  revenue: [{ storeId: store, day: '2024-06-01', grossRevenue: 100, discounts: 5, orderCount: 2 }],
  orders: [{ storeId: store, day: '2024-06-01', orderCount: 2, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 50 }],
  productSales: [{ storeId: store, day: '2024-06-01', productId: 'p1', unitsSold: 3, grossRevenue: 100 }],
  customerCohorts: [{ storeId: store, cohortDay: '2024-05-01', activityDay: '2024-06-01', customerCount: 2, grossRevenue: 100 }],
}
const product: CatalogProduct = { storeId: store, productId: 'p1', payload: { title: 'Product', inventory: 3 }, syncedAt: 100 }

describe('analytics pre-aggregation repositories', () => {
  it('stores and reads all four metric tables in memory', async () => {
    const repository = new InMemoryAnalyticsRepository()
    await repository.upsert(snapshot)
    const result = await repository.read(store)
    expect(result.revenue[0]?.grossRevenue).toBe(100)
    expect(result.orders[0]?.averageOrderValue).toBe(50)
    expect(result.productSales[0]?.unitsSold).toBe(3)
    expect(result.customerCohorts[0]?.customerCount).toBe(2)
  })
  it('upserts a metric row instead of double-counting replayed sync data', async () => {
    const repository = new InMemoryAnalyticsRepository()
    await repository.upsert(snapshot)
    await repository.upsert({ ...snapshot, revenue: [{ ...snapshot.revenue[0]!, grossRevenue: 120 }] })
    expect((await repository.read(store)).revenue).toHaveLength(1)
    expect((await repository.read(store)).revenue[0]?.grossRevenue).toBe(120)
  })
  it('isolates analytics by tenant', async () => {
    const repository = new InMemoryAnalyticsRepository()
    await repository.upsert(snapshot)
    expect(await repository.read(storeId('other'))).toEqual({ revenue: [], orders: [], productSales: [], customerCohorts: [] })
  })
  it('stores and reads catalog products', async () => {
    const repository = new InMemoryAnalyticsRepository()
    await repository.upsertCatalog([product])
    expect((await repository.readCatalog(store))[0]?.payload.title).toBe('Product')
  })
  it('upserts catalog products by tenant and product id', async () => {
    const repository = new InMemoryAnalyticsRepository()
    await repository.upsertCatalog([product, { ...product, payload: { title: 'Updated' }, syncedAt: 200 }])
    expect(await repository.readCatalog(store)).toHaveLength(1)
    expect((await repository.readCatalog(store))[0]?.payload.title).toBe('Updated')
  })
})

describe('Postgres analytics repository', () => {
  it('emits idempotent upserts for every metric table', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [], rowCount: 1 } } }
    await new PostgresAnalyticsRepository(executor).upsert(snapshot)
    expect(queries).toHaveLength(4)
    expect(queries.every((query) => query.includes('ON CONFLICT'))).toBe(true)
  })
  it('emits a catalog upsert', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [], rowCount: 1 } } }
    await new PostgresAnalyticsRepository(executor).upsertCatalog([product])
    expect(queries[0]).toContain('catalog_products')
  })
  it('maps typed analytics rows from Postgres', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> {
      const rows: readonly Record<string, unknown>[] = text.includes('analytics_revenue') ? [{ store_id: 'store-1', day: '2024-06-01', gross_revenue: '100.5', discounts: '2', order_count: 1 }] : text.includes('analytics_orders') ? [{ store_id: 'store-1', day: '2024-06-01', order_count: 1, fulfilled_count: 1, cancelled_count: 0, average_order_value: '100.5' }] : text.includes('product_sales') ? [{ store_id: 'store-1', day: '2024-06-01', product_id: 'p1', units_sold: 2, gross_revenue: '100.5' }] : text.includes('customer_cohorts') ? [{ store_id: 'store-1', cohort_day: '2024-05-01', activity_day: '2024-06-01', customer_count: 1, gross_revenue: '100.5' }] : []
      return { rows: rows as unknown as readonly Row[], rowCount: rows.length }
    } }
    const result = await new PostgresAnalyticsRepository(executor).read(store)
    expect(result.revenue[0]?.grossRevenue).toBe(100.5)
    expect(result.productSales[0]?.productId).toBe('p1')
  })
  it('maps catalog rows from Postgres', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [{ store_id: 'store-1', product_id: 'p1', payload: { title: 'Product' }, synced_at: new Date(100) } as unknown as Row], rowCount: 1 } } }
    expect((await new PostgresAnalyticsRepository(executor).readCatalog(store))[0]?.syncedAt).toBe(100)
  })
})
