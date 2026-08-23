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
  it('resolves a tenant by Shopify domain with a bound parameter', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [{ id: 'store-1', shop_domain: 'demo.myshopify.com' } as unknown as Row], rowCount: 1 } } }
    expect(await new PostgresStoreDirectory(executor).getByShopDomain(' DEMO.MYSHOPIFY.COM ')).toEqual({ storeId: 'store-1', shopDomain: 'demo.myshopify.com' })
    expect(queries[0]).not.toContain('DEMO.MYSHOPIFY.COM')
    await expect(new PostgresStoreDirectory(executor).getByShopDomain('')).resolves.toBeNull()
  })
  it('idempotently upserts a shop domain with ON CONFLICT and returns the tenant id', async () => {
    const queries: string[] = []
    const values: unknown[][] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string, params?: readonly unknown[]): Promise<DatabaseResult<Row>> { queries.push(text); values.push([...(params ?? [])]); return { rows: [{ id: 'store-1', shop_domain: 'demo.myshopify.com' } as unknown as Row], rowCount: 1 } } }
    const directory = new PostgresStoreDirectory(executor)
    const connection = await directory.upsertByShopDomain(' DEMO.MYSHOPIFY.COM ')
    expect(connection).toEqual({ storeId: 'store-1', shopDomain: 'demo.myshopify.com' })
    expect(queries[0]).toContain('INSERT INTO stores')
    expect(queries[0]).toContain('ON CONFLICT (shop_domain)')
    // Reinstall recovery: the conflict branch must reactivate the store and
    // clear the uninstall marker, or a reinstalled shop stays UNINSTALLED.
    expect(queries[0]).toContain(`status = 'ACTIVE'`)
    expect(queries[0]).toContain('uninstalled_at = NULL')
    expect(values[0]).toEqual(['demo.myshopify.com'])
    await expect(directory.upsertByShopDomain('')).rejects.toThrow('shop domain')
  })
})
