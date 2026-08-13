import { describe, expect, it, vi } from 'vitest'
import { ALL_MIGRATIONS, databaseConfigFromEnv, F0_MIGRATIONS, pendingMigrations, withStoreContext } from './index.js'
import { storeId } from '@profitpilot/types'

describe('database configuration', () => {
  it('builds production-ready config from env', () => {
    const config = databaseConfigFromEnv({ DATABASE_URL: 'postgresql://db/profitpilot', NODE_ENV: 'production' })
    expect(config.maxConnections).toBe(10)
    expect(config.ssl).toBe(true)
  })
  it('uses development defaults', () => {
    const config = databaseConfigFromEnv({ DATABASE_URL: 'postgres://localhost/db' })
    expect(config.idleTimeoutMs).toBe(10000)
    expect(config.ssl).toBe(false)
  })
  it('rejects a missing database URL', () => expect(() => databaseConfigFromEnv({})).toThrow('DATABASE_URL'))
  it('rejects invalid pool numbers', () => expect(() => databaseConfigFromEnv({ DATABASE_URL: 'postgres://db', DB_POOL_MAX: '0' })).toThrow('DB_POOL_MAX'))
})

describe('F0 migrations', () => {
  it('contains core tenancy migrations', () => expect(F0_MIGRATIONS.map((migration) => migration.id)).toEqual(['0001', '0002']))
  it('returns unapplied migrations in order', () => expect(pendingMigrations(['0001']).map((migration) => migration.id)).toEqual(['0002', '0003', '0004', '0005']))
  it('returns no work when current', () => expect(pendingMigrations(ALL_MIGRATIONS.map((migration) => migration.id))).toEqual([]))
})

describe('tenant context', () => {
  it('sets the RLS context before running a callback', async () => {
    const queries: string[] = []
    const executor = { query: vi.fn(async (text: string) => { queries.push(text); return { rows: [], rowCount: 0 } }) }
    const operation = vi.fn(async () => 'done')
    await expect(withStoreContext(executor, storeId('store-1'), operation)).resolves.toBe('done')
    expect(queries[0]).toContain('set_config')
    expect(operation).toHaveBeenCalledOnce()
  })
})
