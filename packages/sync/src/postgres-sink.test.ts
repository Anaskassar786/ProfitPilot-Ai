import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from '@profitpilot/db'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { storeId } from '@profitpilot/types'
import { PostgresSyncSink } from './index.js'

describe('Postgres sync sink', () => {
  it('upserts records idempotently and mirrors products to catalog', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [], rowCount: 1 } } }
    const analytics = new InMemoryAnalyticsRepository()
    await new PostgresSyncSink(executor, analytics, () => 100).upsert(storeId('s'), 'products', [{ id: 'p1', title: 'Product', inventory: 3 }])
    expect(queries[0]).toContain('ON CONFLICT (store_id, module, record_id)')
    expect((await analytics.readCatalog(storeId('s')))[0]?.productId).toBe('p1')
  })
  it('upserts non-product modules without catalog writes', async () => {
    let calls = 0
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { calls += 1; return { rows: [], rowCount: 1 } } }
    await new PostgresSyncSink(executor).upsert(storeId('s'), 'orders', [{ id: 'o1', total: 10 }])
    expect(calls).toBe(1)
  })
  it('rebuilds all four dashboard analytics families after an order sync completes', async () => {
    const persisted: unknown[] = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<DatabaseResult<Row>> {
        if (text.startsWith('INSERT INTO sync_records')) {
          persisted.push(JSON.parse(String(values?.[3])))
          return { rows: [], rowCount: 1 }
        }
        if (text.startsWith('SELECT payload FROM sync_records')) return { rows: persisted.map((payload) => ({ payload })) as unknown as Row[], rowCount: persisted.length }
        return { rows: [], rowCount: 0 }
      },
    }
    const analytics = new InMemoryAnalyticsRepository()
    const sink = new PostgresSyncSink(executor, analytics, () => 100)
    await sink.upsert(storeId('s'), 'orders', [{
      id: 'order-101',
      processed_at: '2026-08-14T09:30:00+05:30',
      total_price: '120.00',
      total_discounts: '20.00',
      fulfillment_status: 'fulfilled',
      cancelled_at: null,
      customer: { id: 501, created_at: '2026-08-01T08:00:00+05:30' },
      line_items: [{ product_id: 901, quantity: 2, price: '60.00' }],
    }])
    await sink.complete(storeId('s'), 'orders')
    const snapshot = await analytics.read(storeId('s'))
    expect(snapshot.revenue).toEqual([{ storeId: 's', day: '2026-08-14', grossRevenue: 120, discounts: 20, orderCount: 1 }])
    expect(snapshot.orders).toEqual([{ storeId: 's', day: '2026-08-14', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 120 }])
    expect(snapshot.productSales).toEqual([{ storeId: 's', day: '2026-08-14', productId: '901', unitsSold: 2, grossRevenue: 120 }])
    expect(snapshot.customerCohorts).toEqual([{ storeId: 's', cohortDay: '2026-08-01', activityDay: '2026-08-14', customerCount: 1, grossRevenue: 120 }])
  })
  it('rejects a record without a stable id', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 1 } } }
    await expect(new PostgresSyncSink(executor).upsert(storeId('s'), 'products', [{ title: 'no id' }])).rejects.toThrow('missing an id')
  })
  it('accepts Shopify GraphQL ids', async () => {
    let calls = 0
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { calls += 1; return { rows: [], rowCount: 1 } } }
    await new PostgresSyncSink(executor).upsert(storeId('s'), 'products', [{ admin_graphql_api_id: 'gid://shopify/Product/1' }])
    expect(calls).toBe(1)
  })
})
