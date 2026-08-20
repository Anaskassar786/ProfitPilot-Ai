import { describe, expect, it } from 'vitest'
import type { QueryResultRow, DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { InMemoryBillingRepository, PostgresBillingRepository } from './repository.js'
import type { BillingRecord } from './repository.js'

const record: BillingRecord = { storeId: 's', plan: 'growth', state: 'ACTIVE_MONTHLY', currentPeriodEnd: null, version: 0, interval: 'MONTHLY', chargeId: 'c1' }

describe('billing repositories', () => {
  it('stores and upserts one account per shop', async () => {
    const repo = new InMemoryBillingRepository()
    await repo.put(record)
    expect((await repo.get('s'))?.state).toBe('ACTIVE_MONTHLY')
    // put must overwrite so gift redemptions and plan upgrades persist
    await repo.put({ ...record, state: 'PAST_DUE', version: 1 })
    expect((await repo.get('s'))?.state).toBe('PAST_DUE')
    expect((await repo.get('s'))?.version).toBe(1)
  })
  it('transitions an account with CAS', async () => { const repo = new InMemoryBillingRepository(); await repo.put(record); expect((await repo.transition('s', 0, 'PENDING_CONFIRMATION', 100)).version).toBe(1) })
  it('rejects a stale in-memory transition', async () => { const repo = new InMemoryBillingRepository(); await repo.put(record); await expect(repo.transition('s', 1, 'PAST_DUE', 100)).rejects.toThrow('changed') })
  it('reads a Postgres billing record', async () => { const row = { state: 'ACTIVE_MONTHLY', plan: 'growth', interval: 'MONTHLY', current_period_end: null, version: 0, price_locked_at: null, grandfathered: false, charge_id: null }; const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [row as unknown as Row], rowCount: 1 } } }; expect((await new PostgresBillingRepository(executor).get('s'))?.state).toBe('ACTIVE_MONTHLY') })
  it('returns null for a missing Postgres account', async () => { const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }; expect(await new PostgresBillingRepository(executor).get('missing')).toBeNull() })
  it('upserts a Postgres account', async () => { const queries: string[] = []; const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [], rowCount: 1 } } }; await new PostgresBillingRepository(executor).put(record); expect(queries[0]).toContain('ON CONFLICT (shop_id)') })
  it('returns a Postgres CAS conflict when no row updates', async () => { const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }; await expect(new PostgresBillingRepository(executor).transition('s', 0, 'PAST_DUE', 100)).rejects.toThrow('changed') })
})
