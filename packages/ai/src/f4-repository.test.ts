import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from '@profitpilot/db'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { InMemoryRecommendationRepository, PostgresRecommendationRepository } from './repository.js'
import type { Recommendation } from './domain.js'
import { storeId } from '@profitpilot/types'

const recommendation: Recommendation = { id: 'r1', storeId: storeId('s'), agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Reorder', reason: 'Low cover', impactValue: 100, impactLabel: 'at risk', currency: 'USD', confidence: .75, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { sha256: 'hash' }, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: '2024-06-12T00:00:00.000Z' }

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
})
