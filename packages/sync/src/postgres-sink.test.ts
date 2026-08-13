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
