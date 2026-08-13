import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import type { DatabaseResult, SqlExecutor } from './index.js'
import { PostgresStoreDirectory } from './index.js'
import { storeId } from '@profitpilot/types'

describe('tenant Shopify store directory', () => {
  it('resolves a shop domain by tenant id', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [{ shop_domain: 'demo.myshopify.com' } as unknown as Row], rowCount: 1 } } }
    expect(await new PostgresStoreDirectory(executor).get(storeId('s'))).toEqual({ storeId: 's', shopDomain: 'demo.myshopify.com' })
  })
  it('returns null when a tenant is missing', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }
    expect(await new PostgresStoreDirectory(executor).get(storeId('missing'))).toBeNull()
  })
})
