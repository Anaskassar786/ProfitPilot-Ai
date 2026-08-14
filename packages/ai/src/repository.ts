import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { Recommendation, RecommendationStatus } from './domain.js'

export interface RecommendationRepository {
  put(recommendation: Recommendation): Promise<void>
  list(storeId: StoreId): Promise<readonly Recommendation[]>
  get(storeId: StoreId, id: string): Promise<Recommendation | null>
  decide(storeId: StoreId, id: string, expectedVersion: number, status: 'APPROVED' | 'REJECTED'): Promise<Recommendation>
}

export class InMemoryRecommendationRepository implements RecommendationRepository {
  private readonly records = new Map<string, Recommendation>()

  public async put(recommendation: Recommendation): Promise<void> {
    if (!this.records.has(recommendation.id)) this.records.set(recommendation.id, recommendation)
  }

  public async list(storeId: StoreId): Promise<readonly Recommendation[]> {
    return [...this.records.values()].filter((record) => record.storeId === storeId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  public async get(storeId: StoreId, id: string): Promise<Recommendation | null> {
    const record = this.records.get(id)
    return record?.storeId === storeId ? record : null
  }

  public async decide(storeId: StoreId, id: string, expectedVersion: number, status: 'APPROVED' | 'REJECTED'): Promise<Recommendation> {
    const current = await this.get(storeId, id)
    if (!current || current.version !== expectedVersion || current.status !== 'PENDING') throw new AppError('CONFLICT', 'Recommendation changed; reload before deciding', 409, { id, expectedVersion })
    const next = { ...current, status, version: current.version + 1 }
    this.records.set(id, next)
    return next
  }
}

type RecommendationRow = QueryResultRow & { payload: unknown; status: RecommendationStatus; version: number }

export class PostgresRecommendationRepository implements RecommendationRepository {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) { this.executor = executor }

  public async put(recommendation: Recommendation): Promise<void> {
    await this.executor.query(`INSERT INTO ai_recommendations (id, store_id, agent, rule_id, status, version, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) ON CONFLICT (id) DO NOTHING`, [recommendation.id, recommendation.storeId, recommendation.agent, recommendation.ruleId, recommendation.status, recommendation.version, JSON.stringify(recommendation), recommendation.createdAt])
  }

  public async list(storeId: StoreId): Promise<readonly Recommendation[]> {
    const result = await this.executor.query<RecommendationRow>('SELECT payload, status, version FROM ai_recommendations WHERE store_id = $1 ORDER BY created_at DESC', [storeId])
    return result.rows.map((row) => parseRecommendation(row.payload))
  }

  public async get(storeId: StoreId, id: string): Promise<Recommendation | null> {
    const result = await this.executor.query<RecommendationRow>('SELECT payload, status, version FROM ai_recommendations WHERE store_id = $1 AND id = $2 LIMIT 1', [storeId, id])
    const row = result.rows[0]
    return row ? parseRecommendation(row.payload) : null
  }

  public async decide(storeId: StoreId, id: string, expectedVersion: number, status: 'APPROVED' | 'REJECTED'): Promise<Recommendation> {
    const result = await this.executor.query<RecommendationRow>(`UPDATE ai_recommendations SET status = $4, version = version + 1, payload = jsonb_set(jsonb_set(payload, '{status}', to_jsonb($4::text)), '{version}', to_jsonb(version + 1)) WHERE store_id = $1 AND id = $2 AND version = $3 AND status = 'PENDING' RETURNING payload, status, version`, [storeId, id, expectedVersion, status])
    const row = result.rows[0]
    if (!row) throw new AppError('CONFLICT', 'Recommendation changed; reload before deciding', 409, { id, expectedVersion })
    return parseRecommendation(row.payload)
  }
}

function parseRecommendation(value: unknown): Recommendation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('AI recommendation payload is invalid')
  return value as Recommendation
}
