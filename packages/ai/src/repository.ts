import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AgentId, Recommendation, RecommendationStatus } from './domain.js'

export interface RecommendationRepository {
  put(recommendation: Recommendation): Promise<void>
  list(storeId: StoreId): Promise<readonly Recommendation[]>
  listByAgent(storeId: StoreId, agent: AgentId, limit?: number): Promise<readonly Recommendation[]>
  get(storeId: StoreId, id: string): Promise<Recommendation | null>
  /** Returns the PENDING recommendation for the same (rule, entity), if any — the dedupe anchor. */
  findPending(storeId: StoreId, ruleId: string, entityKey: string | null): Promise<Recommendation | null>
  /** Refreshes the payload of a still-PENDING recommendation in place (same id, same version). */
  refresh(recommendation: Recommendation): Promise<void>
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

  public async listByAgent(storeId: StoreId, agent: AgentId, limit = 20): Promise<readonly Recommendation[]> {
    return (await this.list(storeId)).filter((record) => record.agent === agent).slice(0, limit)
  }

  public async get(storeId: StoreId, id: string): Promise<Recommendation | null> {
    const record = this.records.get(id)
    return record?.storeId === storeId ? record : null
  }

  public async findPending(storeId: StoreId, ruleId: string, entityKey: string | null): Promise<Recommendation | null> {
    return [...this.records.values()].find((record) => record.storeId === storeId && record.ruleId === ruleId && (record.entityKey ?? null) === entityKey && record.status === 'PENDING') ?? null
  }

  public async refresh(recommendation: Recommendation): Promise<void> {
    const current = this.records.get(recommendation.id)
    if (current?.status === 'PENDING') this.records.set(recommendation.id, recommendation)
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
    await this.executor.query(`INSERT INTO ai_recommendations (id, store_id, agent, rule_id, entity_key, status, version, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) ON CONFLICT (id) DO NOTHING`, [recommendation.id, recommendation.storeId, recommendation.agent, recommendation.ruleId, recommendation.entityKey ?? null, recommendation.status, recommendation.version, JSON.stringify(recommendation), recommendation.createdAt])
  }

  public async list(storeId: StoreId): Promise<readonly Recommendation[]> {
    const result = await this.executor.query<RecommendationRow>('SELECT payload, status, version FROM ai_recommendations WHERE store_id = $1 ORDER BY created_at DESC', [storeId])
    return result.rows.map((row) => parseRecommendation(row.payload))
  }

  public async listByAgent(storeId: StoreId, agent: AgentId, limit = 20): Promise<readonly Recommendation[]> {
    const result = await this.executor.query<RecommendationRow>('SELECT payload, status, version FROM ai_recommendations WHERE store_id = $1 AND agent = $2 ORDER BY created_at DESC LIMIT $3', [storeId, agent, limit])
    return result.rows.map((row) => parseRecommendation(row.payload))
  }

  public async get(storeId: StoreId, id: string): Promise<Recommendation | null> {
    const result = await this.executor.query<RecommendationRow>('SELECT payload, status, version FROM ai_recommendations WHERE store_id = $1 AND id = $2 LIMIT 1', [storeId, id])
    const row = result.rows[0]
    return row ? parseRecommendation(row.payload) : null
  }

  public async findPending(storeId: StoreId, ruleId: string, entityKey: string | null): Promise<Recommendation | null> {
    const result = await this.executor.query<RecommendationRow>(`SELECT payload, status, version FROM ai_recommendations WHERE store_id = $1 AND rule_id = $2 AND status = 'PENDING' AND ((entity_key IS NULL AND $3::text IS NULL) OR entity_key = $3) ORDER BY created_at DESC LIMIT 1`, [storeId, ruleId, entityKey])
    const row = result.rows[0]
    return row ? parseRecommendation(row.payload) : null
  }

  public async refresh(recommendation: Recommendation): Promise<void> {
    await this.executor.query(`UPDATE ai_recommendations SET payload = $3::jsonb WHERE store_id = $1 AND id = $2 AND status = 'PENDING'`, [recommendation.storeId, recommendation.id, JSON.stringify(recommendation)])
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
