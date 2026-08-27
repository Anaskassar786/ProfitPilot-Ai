import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import type { DatabaseResult, SqlExecutor } from './index.js'
import { InMemoryStoreDirectory, PostgresStoreDirectory, normalizeShopDomain } from './index.js'
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

/**
 * PERMANENT 401 FIX — the tenant directory is the last hop before Postgres,
 * and `stores` RLS compares `shop_domain` to the `app.shop_domain` setting
 * BYTE FOR BYTE. A row written as `https://commander-pilot.myshopify.com` is
 * therefore invisible to a lookup for `commander-pilot.myshopify.com`, which
 * is what turned a completed install into a permanent 401.
 */
describe('store directory shop-domain normalization', () => {
  it('normalizes scheme, case, path and trailing slash identically to the shopify package', () => {
    for (const raw of ['commander-pilot.myshopify.com', ' Commander-Pilot.MyShopify.com ', 'https://commander-pilot.myshopify.com', 'http://commander-pilot.myshopify.com/', 'https://commander-pilot.myshopify.com/admin?x=1', 'commander-pilot']) {
      expect(normalizeShopDomain(raw)).toBe('commander-pilot.myshopify.com')
    }
    expect(normalizeShopDomain('')).toBe('')
    expect(normalizeShopDomain(null)).toBe('')
  })

  it('queries the canonical domain even when the caller passes a URL', async () => {
    const values: unknown[][] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(_text: string, params?: readonly unknown[]): Promise<DatabaseResult<Row>> { values.push([...(params ?? [])]); return { rows: [{ id: 'store-1', shop_domain: 'commander-pilot.myshopify.com' } as unknown as Row], rowCount: 1 } } }
    const directory = new PostgresStoreDirectory(executor)
    await directory.getByShopDomain('https://Commander-Pilot.myshopify.com/')
    await directory.upsertByShopDomain('https://Commander-Pilot.myshopify.com/admin')
    expect(values).toEqual([['commander-pilot.myshopify.com'], ['commander-pilot.myshopify.com']])
  })

  it('treats every spelling as the same tenant in the in-memory directory', async () => {
    const directory = new InMemoryStoreDirectory()
    const created = await directory.upsertByShopDomain('https://Commander-Pilot.myshopify.com/')
    expect((await directory.getByShopDomain('commander-pilot.myshopify.com'))?.storeId).toBe(created.storeId)
    expect((await directory.upsertByShopDomain('commander-pilot')).storeId).toBe(created.storeId)
  })
})
