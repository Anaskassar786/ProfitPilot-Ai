import { readFileSync } from 'node:fs'
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
  it('returns unapplied migrations in order', () => expect(pendingMigrations(['0001']).map((migration) => migration.id)).toEqual(['0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015', '0016', '0017', '0018', '0019', '0020', '0021', '0022']))
  it('adds an explicit stores WITH CHECK policy for tenant-safe writes', () => {
    const sql = readFileSync('migrations/0013_stores_rls_with_check.sql', 'utf8')
    expect(sql).toContain('CREATE POLICY stores_tenant_isolation ON stores')
    expect(sql).toContain('WITH CHECK')
    expect(sql).toContain("current_setting('app.shop_domain', true)")
  })
  it('adds tenant-safe writes for Jarvis, reports, and tickets', () => {
    const sql = readFileSync('migrations/0014_operator_fixes.sql', 'utf8')
    expect(sql).toContain('jarvis_sessions_tenant_isolation')
    expect(sql).toContain('content_base64')
    expect(sql).toContain('support_tickets')
    expect(sql).toContain('WITH CHECK')
  })
  it('registers durable campaign and Shopify privacy compliance migrations', () => {
    const campaign = readFileSync('migrations/0015_targeted_campaign_safety.sql', 'utf8')
    const privacy = readFileSync('migrations/0016_shopify_privacy_compliance.sql', 'utf8')
    expect(campaign).toContain('idempotency_fingerprint')
    expect(privacy).toContain('privacy_compliance_requests')
    expect(privacy).toContain('WITH CHECK')
  })
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
