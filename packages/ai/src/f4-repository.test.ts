import { describe, expect, it } from 'vitest'
import { PostgresDatabase } from '@profitpilot/db'
import type { QueryResultRow } from '@profitpilot/db'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { InMemoryRecommendationRepository, PostgresRecommendationRepository } from './repository.js'
import type { Recommendation } from './domain.js'
import { storeId } from '@profitpilot/types'

const recommendation: Recommendation = { id: 'r1', storeId: storeId('s'), agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Reorder', reason: 'Low cover', impactValue: 100, impactLabel: 'at risk', currency: 'USD', confidence: .75, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { sha256: 'hash' }, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: '2024-06-12T00:00:00.000Z', entityKey: 'p1', expiresAt: null, decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null }

describe('recommendation repositories', () => {
  it('stores and lists tenant recommendations', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(recommendation)
    expect(await repository.list(storeId('s'))).toHaveLength(1)
    expect(await repository.list(storeId('other'))).toHaveLength(0)
  })
  it('deduplicates recommendation ids', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(recommendation)
    await repository.put({ ...recommendation, title: 'changed' })
    expect((await repository.get(storeId('s'), 'r1'))?.title).toBe('Reorder')
  })
  it('decides with CAS versioning', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(recommendation)
    expect((await repository.decide(storeId('s'), 'r1', 0, 'APPROVED')).status).toBe('APPROVED')
  })
  it('rejects stale decisions', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(recommendation)
    await repository.decide(storeId('s'), 'r1', 0, 'APPROVED')
    await expect(repository.decide(storeId('s'), 'r1', 0, 'REJECTED')).rejects.toThrow('changed')
  })
  it('emits a Postgres recommendation upsert', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [], rowCount: 1 } } }
    await new PostgresRecommendationRepository(executor).put(recommendation)
    expect(queries[0]).toContain('ai_recommendations')
  })
  it('maps Postgres list payloads', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [{ payload: recommendation, status: 'PENDING', version: 0 } as unknown as Row], rowCount: 1 } } }
    expect(await new PostgresRecommendationRepository(executor).list(storeId('s'))).toHaveLength(1)
  })
  it('maps a missing Postgres recommendation', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }
    expect(await new PostgresRecommendationRepository(executor).get(storeId('s'), 'missing')).toBeNull()
  })
  it('raises a CAS conflict when Postgres returns no row', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }
    await expect(new PostgresRecommendationRepository(executor).decide(storeId('s'), 'r1', 0, 'APPROVED')).rejects.toThrow('changed')
  })

  it('sets the tenant context on the same Postgres transaction used for a decision', async () => {
    const queries: Array<Readonly<{ text: string; values: readonly unknown[] }>> = []
    const database = Object.create(PostgresDatabase.prototype) as PostgresDatabase
    database.withTransaction = async (operation) => operation({
      async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
        queries.push({ text, values })
        if (text.includes('UPDATE ai_recommendations')) return { rows: [{ payload: { ...recommendation, status: 'APPROVED', version: 1 } } as unknown as Row], rowCount: 1 }
        return { rows: [], rowCount: 1 }
      },
    } as never)

    const decided = await new PostgresRecommendationRepository(database).decide(storeId('s'), 'r1', 0, 'APPROVED')
    expect(decided.status).toBe('APPROVED')
    expect(queries[0]).toMatchObject({ text: 'SELECT set_config($1, $2, true)', values: ['app.store_id', 's'] })
    expect(queries[1]?.text).toContain("WHERE store_id = $1 AND id::text = $2 AND version = $3")
  })

  // Regression (production 500 on approve / skip): PostgreSQL cannot deduce a
  // single parameter type when the same parameter feeds both a timestamptz
  // column and a jsonb_build_object(...) ::text position — the planner raises
  // "inconsistent types deduced for parameter $N". Every shared parameter must
  // therefore carry an explicit cast in every position it is used.
  it('casts every shared parameter explicitly in the Postgres decision SQL', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> {
        queries.push(text)
        if (text.includes('UPDATE ai_recommendations')) return { rows: [{ payload: { ...recommendation, status: 'APPROVED', version: 1 } } as unknown as Row], rowCount: 1 }
        return { rows: [], rowCount: 1 }
      },
    }
    const repository = new PostgresRecommendationRepository(executor)
    await repository.decide(storeId('s'), 'r1', 0, 'APPROVED')
    const decide = queries[queries.length - 1] ?? ''
    expect(decide).toContain('decided_at = $5::text::timestamptz')
    expect(decide).toContain("'decidedAt', $5::text")
    expect(decide).toContain('status = $4::text')
    expect(decide).toContain('decided_by = $6::text')
    expect(decide).toContain('reject_reason = $7::text')
  })

  it('casts every shared parameter explicitly in the Postgres snooze SQL', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> {
        queries.push(text)
        if (text.includes('UPDATE ai_recommendations')) return { rows: [{ payload: { ...recommendation, status: 'PENDING', version: 0, snoozedUntil: '2026-08-20T00:00:00.000Z' } } as unknown as Row], rowCount: 1 }
        return { rows: [], rowCount: 1 }
      },
    }
    const repository = new PostgresRecommendationRepository(executor)
    await repository.snooze(storeId('s'), 'r1', '2026-08-20T00:00:00.000Z')
    const snooze = queries[queries.length - 1] ?? ''
    expect(snooze).toContain('snoozed_until = $3::text::timestamptz')
    expect(snooze).toContain("'snoozedUntil', $3::text")
  })

  it('casts every shared parameter explicitly in the Postgres expiry sweep SQL', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> {
        queries.push(text)
        if (text.includes('UPDATE ai_recommendations')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 1 }
      },
    }
    const repository = new PostgresRecommendationRepository(executor)
    await repository.expireStale(storeId('s'))
    const sweep = queries[queries.length - 1] ?? ''
    expect(sweep).toContain('decided_at = $2::text::timestamptz')
    expect(sweep).toContain('expires_at <= $2::text::timestamptz')
    expect(sweep).toContain("'decidedAt', $2::text")
  })
})
