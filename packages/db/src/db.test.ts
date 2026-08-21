import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ALL_MIGRATIONS, databaseConfigFromEnv, F0_MIGRATIONS, pendingMigrations, withStoreContext } from './index.js'
import { storeId } from '@profitpilot/types'

// Regression guard for the 0021 collision found while landing the three AI
// Growth Command PRs: two feature branches independently claimed 0021 while
// 0021_ai_command.sql had already merged to main. Each parallel branch looked
// green on its own, so nothing failed until the second one merged. These
// checks make a duplicate or unregistered migration fail on the branch itself.
describe('migration registry integrity', () => {
  it('has no duplicate migration ids', () => {
    const ids = ALL_MIGRATIONS.map((migration) => migration.id)
    expect(ids).toEqual([...new Set(ids)])
  })
  it('has no duplicate migration filenames', () => {
    const filenames = ALL_MIGRATIONS.map((migration) => migration.filename)
    expect(filenames).toEqual([...new Set(filenames)])
  })
  it('numbers migrations contiguously from 0001 in registry order', () => {
    expect(ALL_MIGRATIONS.map((migration) => migration.id)).toEqual(ALL_MIGRATIONS.map((_, index) => String(index + 1).padStart(4, '0')))
  })
  it('prefixes every filename with its own id', () => {
    for (const migration of ALL_MIGRATIONS) expect(migration.filename.startsWith(`${migration.id}_`)).toBe(true)
  })
  it('registers every .sql file on disk exactly once, and registers nothing missing', () => {
    const onDisk = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()
    expect(ALL_MIGRATIONS.map((migration) => migration.filename).sort()).toEqual(onDisk)
  })
})

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
  it('returns unapplied migrations in order', () => expect(pendingMigrations(['0001']).map((migration) => migration.id)).toEqual(['0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015', '0016', '0017', '0018', '0019', '0020', '0021', '0022', '0023', '0024', '0025', '0026', '0027', '0028', '0029', '0030']))
  it('registers the Insights Hub migration with tenant RLS on all twelve tables', () => {
    const sql = readFileSync('migrations/0024_insights_hub.sql', 'utf8')
    for (const table of ['insights_discoveries', 'insights_lessons', 'insights_patterns', 'insights_personas', 'insights_investigations', 'insights_trends', 'insights_comparisons', 'insights_knowledge_base', 'insights_timeline_events', 'insights_predictions', 'insights_preferences', 'insights_api_usage']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
      expect(sql).toContain(`${table}_tenant_isolation`)
    }
    expect((sql.match(/WITH CHECK/g) ?? []).length).toBe(12)
    expect(sql).toContain('REFERENCES stores(id) ON DELETE CASCADE')
  })
  it('widens the PatternAI id columns to text so engine ids can be stored', () => {
    // Regression guard for the crash that took the module down: the engine
    // mints ids like `disc_1f4c…`, which cannot be written to a uuid column.
    const sql = readFileSync('migrations/0025_patternai_id_types.sql', 'utf8')
    for (const table of ['insights_discoveries', 'insights_lessons', 'insights_patterns', 'insights_personas', 'insights_investigations', 'insights_trends', 'insights_comparisons', 'insights_knowledge_base', 'insights_timeline_events', 'insights_predictions']) {
      expect(sql).toContain(`('${table}', 'id')`)
    }
    expect(sql).toContain("('insights_timeline_events', 'entity_id')")
    expect(sql).toContain('TYPE text USING')
    expect(sql).toContain('linked_insights TYPE text[]')
  })
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
