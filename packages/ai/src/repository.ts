import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AgentId, Recommendation, RecommendationStatus, RejectReason, RuleId } from './domain.js'

export const RECOMMENDATION_PAGE_LIMIT = 50
/** Post-decision grace window during which an undo reverts to PENDING. */
export const UNDO_WINDOW_MS = 30_000

export type RecommendationSort = 'impact' | 'confidence' | 'created' | 'decided'
export type RecommendationListQuery = Readonly<{
  status?: RecommendationStatus
  agent?: AgentId
  ruleId?: RuleId
  minImpact?: number
  maxImpact?: number
  dateFrom?: string
  dateTo?: string
  sort?: RecommendationSort
  direction?: 'asc' | 'desc'
  cursor?: number
  limit?: number
}>
export type RecommendationPage = Readonly<{ items: readonly Recommendation[]; total: number; cursor: number; limit: number; hasMore: boolean }>

export type DecisionInput = Readonly<{ decidedBy?: string | null; rejectReason?: RejectReason | null; decidedAt?: string }>

export type RecommendationSummary = Readonly<{
  counts: Readonly<Record<RecommendationStatus, number>>
  total: number
  /** PENDING impact grouped by currency — currencies are never summed together. */
  pendingImpact: readonly Readonly<{ currency: string; value: number }>[]
  approvedThisMonth: Readonly<{ count: number; impact: readonly Readonly<{ currency: string; value: number }>[] }>
  byAgent: readonly Readonly<{ agent: AgentId; pending: number; approved: number; rejected: number; total: number }>[]
  byRule: readonly Readonly<{ ruleId: RuleId; total: number }>[]
  approvalRate: Readonly<{ allTime: number | null; last30d: number | null }>
  averageDecisionMs: number | null
  recentDecisions: readonly Recommendation[]
  generatedTrend: readonly Readonly<{ day: string; generated: number; approved: number }>[]
}>

export interface RecommendationRepository {
  put(recommendation: Recommendation): Promise<void>
  list(storeId: StoreId, query?: RecommendationListQuery): Promise<readonly Recommendation[]>
  page(storeId: StoreId, query: RecommendationListQuery): Promise<RecommendationPage>
  listByAgent(storeId: StoreId, agent: AgentId, limit?: number): Promise<readonly Recommendation[]>
  get(storeId: StoreId, id: string): Promise<Recommendation | null>
  /** Pending recommendation with the same rule/entity, used as the dedupe anchor. */
  findPending(storeId: StoreId, ruleId: string, entityKey: string | null): Promise<Recommendation | null>
  refresh(recommendation: Recommendation): Promise<void>
  decide(storeId: StoreId, id: string, expectedVersion: number, status: 'APPROVED' | 'REJECTED', input?: DecisionInput): Promise<Recommendation>
  /**
   * Single-statement decision without a client-supplied version. Used by
   * Jarvis chat where the merchant confirmed by id — the WHERE status =
   * 'PENDING' guard keeps it atomic (PR #46 race fix for the old
   * SELECT-version-then-UPDATE pattern).
   */
  decidePending(storeId: StoreId, id: string, status: 'APPROVED' | 'REJECTED', input?: DecisionInput): Promise<Recommendation>
  undo(storeId: StoreId, id: string, now?: number): Promise<Recommendation>
  snooze(storeId: StoreId, id: string, until: string): Promise<Recommendation>
  markExecution(storeId: StoreId, id: string, status: 'EXECUTED' | 'FAILED'): Promise<Recommendation>
  expireStale(storeId: StoreId, now?: number): Promise<number>
  summary(storeId: StoreId, now?: number): Promise<RecommendationSummary>
}

const EMPTY_COUNTS: Readonly<Record<RecommendationStatus, number>> = { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 }

export class InMemoryRecommendationRepository implements RecommendationRepository {
  private readonly records = new Map<string, Recommendation>()

  public async put(recommendation: Recommendation): Promise<void> {
    if (!this.records.has(recommendation.id)) this.records.set(recommendation.id, normalize(recommendation))
  }

  public async list(storeId: StoreId, query: RecommendationListQuery = {}): Promise<readonly Recommendation[]> {
    return (await this.page(storeId, { ...query, limit: query.limit ?? RECOMMENDATION_PAGE_LIMIT })).items
  }

  public async page(storeId: StoreId, query: RecommendationListQuery): Promise<RecommendationPage> {
    const filtered = [...this.records.values()].filter((record) => record.storeId === storeId).filter((record) => matches(record, query))
    const sorted = sortRecommendations(filtered, query.sort ?? 'created', query.direction)
    const cursor = Math.max(0, query.cursor ?? 0)
    const limit = clampLimit(query.limit)
    const items = sorted.slice(cursor, cursor + limit)
    return { items, total: sorted.length, cursor, limit, hasMore: cursor + items.length < sorted.length }
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

  public async decide(storeId: StoreId, id: string, expectedVersion: number, status: 'APPROVED' | 'REJECTED', input: DecisionInput = {}): Promise<Recommendation> {
    const current = await this.get(storeId, id)
    if (!current || current.version !== expectedVersion || current.status !== 'PENDING') throw new AppError('CONFLICT', 'Recommendation changed; reload before deciding', 409, { id, expectedVersion })
    const next: Recommendation = { ...current, status, version: current.version + 1, decidedAt: input.decidedAt ?? new Date().toISOString(), decidedBy: input.decidedBy ?? null, rejectReason: status === 'REJECTED' ? input.rejectReason ?? null : null }
    this.records.set(id, next)
    return next
  }

  public async decidePending(storeId: StoreId, id: string, status: 'APPROVED' | 'REJECTED', input: DecisionInput = {}): Promise<Recommendation> {
    const current = await this.get(storeId, id)
    if (!current || current.status !== 'PENDING') throw new AppError('CONFLICT', 'That recommendation is not pending', 409, { id })
    return this.decide(storeId, id, current.version, status, input)
  }

  public async undo(storeId: StoreId, id: string, now = Date.now()): Promise<Recommendation> {
    const current = await this.get(storeId, id)
    if (!current || (current.status !== 'APPROVED' && current.status !== 'REJECTED')) throw new AppError('CONFLICT', 'Only a just-decided recommendation can be undone', 409, { id })
    const decidedAt = current.decidedAt ? Date.parse(current.decidedAt) : Number.NaN
    if (!Number.isFinite(decidedAt) || now - decidedAt > UNDO_WINDOW_MS) throw new AppError('CONFLICT', 'The undo window has closed for this recommendation', 409, { id })
    const next: Recommendation = { ...current, status: 'PENDING', version: current.version + 1, decidedAt: null, decidedBy: null, rejectReason: null }
    this.records.set(id, next)
    return next
  }

  public async snooze(storeId: StoreId, id: string, until: string): Promise<Recommendation> {
    const current = await this.get(storeId, id)
    if (!current || current.status !== 'PENDING') throw new AppError('CONFLICT', 'Only a pending recommendation can be snoozed', 409, { id })
    const next: Recommendation = { ...current, snoozedUntil: until }
    this.records.set(id, next)
    return next
  }

  public async markExecution(storeId: StoreId, id: string, status: 'EXECUTED' | 'FAILED'): Promise<Recommendation> {
    const current = await this.get(storeId, id)
    if (!current || current.status !== 'APPROVED') throw new AppError('CONFLICT', 'Only an approved recommendation can be executed', 409, { id })
    const next: Recommendation = { ...current, status, version: current.version + 1 }
    this.records.set(id, next)
    return next
  }

  public async expireStale(storeId: StoreId, now = Date.now()): Promise<number> {
    let expired = 0
    for (const [id, record] of this.records) {
      if (record.storeId !== storeId || record.status !== 'PENDING' || !record.expiresAt) continue
      const expiresAt = Date.parse(record.expiresAt)
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        this.records.set(id, { ...record, status: 'EXPIRED', version: record.version + 1, decidedAt: new Date(now).toISOString(), decidedBy: 'system' })
        expired += 1
      }
    }
    return expired
  }

  public async summary(storeId: StoreId, now = Date.now()): Promise<RecommendationSummary> {
    const all = [...this.records.values()].filter((record) => record.storeId === storeId)
    return buildSummary(all, now)
  }
}

type RecommendationRow = QueryResultRow & { payload: unknown; status: RecommendationStatus; version: number }
type CountRow = QueryResultRow & { total: string | number }

export class PostgresRecommendationRepository implements RecommendationRepository {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) { this.executor = executor }

  public async put(recommendation: Recommendation): Promise<void> {
    const normalized = normalize(recommendation)
    await this.executor.query(
      `INSERT INTO ai_recommendations (id, store_id, agent, rule_id, status, version, payload, created_at, entity_key, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      [normalized.id, normalized.storeId, normalized.agent, normalized.ruleId, normalized.status, normalized.version, JSON.stringify(normalized), normalized.createdAt, normalized.entityKey, normalized.expiresAt],
    )
  }

  public async list(storeId: StoreId, query: RecommendationListQuery = {}): Promise<readonly Recommendation[]> {
    return (await this.page(storeId, { ...query, limit: query.limit ?? RECOMMENDATION_PAGE_LIMIT })).items
  }

  public async page(storeId: StoreId, query: RecommendationListQuery): Promise<RecommendationPage> {
    const where: string[] = ['store_id = $1']
    const values: unknown[] = [storeId]
    const add = (clause: string, value: unknown): void => { values.push(value); where.push(clause.replace('?', `$${values.length}`)) }
    if (query.status) add('status = ?', query.status)
    if (query.agent) add('agent = ?', query.agent)
    if (query.ruleId) add('rule_id = ?', query.ruleId)
    if (typeof query.minImpact === 'number') add(`(payload->>'impactValue')::numeric >= ?`, query.minImpact)
    if (typeof query.maxImpact === 'number') add(`(payload->>'impactValue')::numeric <= ?`, query.maxImpact)
    if (query.dateFrom) add('created_at >= ?', query.dateFrom)
    if (query.dateTo) add('created_at <= ?', query.dateTo)
    const cursor = Math.max(0, query.cursor ?? 0)
    const limit = clampLimit(query.limit)
    const orderBy = sqlOrder(query.sort ?? 'created', query.direction)
    const countResult = await this.executor.query<CountRow>(`SELECT COUNT(*) AS total FROM ai_recommendations WHERE ${where.join(' AND ')}`, values)
    const total = Number(countResult.rows[0]?.total ?? 0)
    values.push(limit, cursor)
    const result = await this.executor.query<RecommendationRow>(
      `SELECT payload, status, version FROM ai_recommendations WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    )
    const items = result.rows.map((row) => parseRecommendation(row.payload))
    return { items, total, cursor, limit, hasMore: cursor + items.length < total }
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

  public async decide(storeId: StoreId, id: string, expectedVersion: number, status: 'APPROVED' | 'REJECTED', input: DecisionInput = {}): Promise<Recommendation> {
    const decidedAt = input.decidedAt ?? new Date().toISOString()
    const decidedBy = input.decidedBy ?? null
    const rejectReason = status === 'REJECTED' ? input.rejectReason ?? null : null
    const result = await this.executor.query<RecommendationRow>(
      `UPDATE ai_recommendations SET status = $4, version = version + 1, decided_at = $5, decided_by = $6, reject_reason = $7,
         payload = payload || jsonb_build_object('status', $4::text, 'version', version + 1, 'decidedAt', $5::text, 'decidedBy', $6::text, 'rejectReason', $7::text)
       WHERE store_id = $1 AND id = $2 AND version = $3 AND status = 'PENDING' RETURNING payload, status, version`,
      [storeId, id, expectedVersion, status, decidedAt, decidedBy, rejectReason],
    )
    const row = result.rows[0]
    if (!row) throw new AppError('CONFLICT', 'Recommendation changed; reload before deciding', 409, { id, expectedVersion })
    return parseRecommendation(row.payload)
  }

  public async decidePending(storeId: StoreId, id: string, status: 'APPROVED' | 'REJECTED', input: DecisionInput = {}): Promise<Recommendation> {
    const decidedAt = input.decidedAt ?? new Date().toISOString()
    const decidedBy = input.decidedBy ?? null
    const rejectReason = status === 'REJECTED' ? input.rejectReason ?? null : null
    const result = await this.executor.query<RecommendationRow>(
      `UPDATE ai_recommendations SET status = $3, version = version + 1, decided_at = $4, decided_by = $5, reject_reason = $6,
         payload = payload || jsonb_build_object('status', $3::text, 'version', version + 1, 'decidedAt', $4::text, 'decidedBy', $5::text, 'rejectReason', $6::text)
       WHERE store_id = $1 AND id = $2 AND status = 'PENDING' RETURNING payload, status, version`,
      [storeId, id, status, decidedAt, decidedBy, rejectReason],
    )
    const row = result.rows[0]
    if (!row) throw new AppError('CONFLICT', 'That recommendation is not pending', 409, { id })
    return parseRecommendation(row.payload)
  }

  public async undo(storeId: StoreId, id: string, now = Date.now()): Promise<Recommendation> {
    const cutoff = new Date(now - UNDO_WINDOW_MS).toISOString()
    const result = await this.executor.query<RecommendationRow>(
      `UPDATE ai_recommendations SET status = 'PENDING', version = version + 1, decided_at = NULL, decided_by = NULL, reject_reason = NULL,
         payload = payload || jsonb_build_object('status', 'PENDING'::text, 'version', version + 1) || '{"decidedAt": null, "decidedBy": null, "rejectReason": null}'::jsonb
       WHERE store_id = $1 AND id = $2 AND status IN ('APPROVED', 'REJECTED') AND decided_at IS NOT NULL AND decided_at >= $3 RETURNING payload, status, version`,
      [storeId, id, cutoff],
    )
    const row = result.rows[0]
    if (!row) throw new AppError('CONFLICT', 'The undo window has closed for this recommendation', 409, { id })
    return parseRecommendation(row.payload)
  }

  public async snooze(storeId: StoreId, id: string, until: string): Promise<Recommendation> {
    const result = await this.executor.query<RecommendationRow>(
      `UPDATE ai_recommendations SET snoozed_until = $3, payload = payload || jsonb_build_object('snoozedUntil', $3::text)
       WHERE store_id = $1 AND id = $2 AND status = 'PENDING' RETURNING payload, status, version`,
      [storeId, id, until],
    )
    const row = result.rows[0]
    if (!row) throw new AppError('CONFLICT', 'Only a pending recommendation can be snoozed', 409, { id })
    return parseRecommendation(row.payload)
  }

  public async markExecution(storeId: StoreId, id: string, status: 'EXECUTED' | 'FAILED'): Promise<Recommendation> {
    const result = await this.executor.query<RecommendationRow>(
      `UPDATE ai_recommendations SET status = $3, version = version + 1,
         payload = payload || jsonb_build_object('status', $3::text, 'version', version + 1)
       WHERE store_id = $1 AND id = $2 AND status = 'APPROVED' RETURNING payload, status, version`,
      [storeId, id, status],
    )
    const row = result.rows[0]
    if (!row) throw new AppError('CONFLICT', 'Only an approved recommendation can be executed', 409, { id })
    return parseRecommendation(row.payload)
  }

  public async expireStale(storeId: StoreId, now = Date.now()): Promise<number> {
    const at = new Date(now).toISOString()
    const result = await this.executor.query(
      `UPDATE ai_recommendations SET status = 'EXPIRED', version = version + 1, decided_at = $2, decided_by = 'system',
         payload = payload || jsonb_build_object('status', 'EXPIRED'::text, 'version', version + 1, 'decidedAt', $2::text, 'decidedBy', 'system'::text)
       WHERE store_id = $1 AND status = 'PENDING' AND expires_at IS NOT NULL AND expires_at <= $2`,
      [storeId, at],
    )
    return result.rowCount
  }

  public async summary(storeId: StoreId, now = Date.now()): Promise<RecommendationSummary> {
    // Summary works over the full payload set; the per-store volume of
    // recommendations is bounded by monthly plan limits, so one scan is fine
    // and keeps every aggregate consistent with a single snapshot.
    const result = await this.executor.query<RecommendationRow>('SELECT payload, status, version FROM ai_recommendations WHERE store_id = $1 ORDER BY created_at DESC LIMIT 2000', [storeId])
    return buildSummary(result.rows.map((row) => parseRecommendation(row.payload)), now)
  }
}

export function buildSummary(records: readonly Recommendation[], now = Date.now()): RecommendationSummary {
  const counts: Record<RecommendationStatus, number> = { ...EMPTY_COUNTS }
  for (const record of records) counts[record.status] += 1
  const monthStart = new Date(now)
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const monthIso = monthStart.toISOString()
  const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString()
  const approvedLike = (record: Recommendation): boolean => record.status === 'APPROVED' || record.status === 'EXECUTED' || record.status === 'FAILED'
  const approvedThisMonth = records.filter((record) => approvedLike(record) && (record.decidedAt ?? record.createdAt) >= monthIso)
  const decided = records.filter((record) => approvedLike(record) || record.status === 'REJECTED')
  const decided30 = decided.filter((record) => (record.decidedAt ?? record.createdAt) >= thirtyDaysAgo)
  const decisionDurations = records
    .filter((record) => record.decidedAt && record.decidedBy !== 'system')
    .map((record) => Date.parse(record.decidedAt ?? '') - Date.parse(record.createdAt))
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
  const agents = new Map<AgentId, { pending: number; approved: number; rejected: number; total: number }>()
  for (const record of records) {
    const entry = agents.get(record.agent) ?? { pending: 0, approved: 0, rejected: 0, total: 0 }
    entry.total += 1
    if (record.status === 'PENDING') entry.pending += 1
    else if (approvedLike(record)) entry.approved += 1
    else if (record.status === 'REJECTED') entry.rejected += 1
    agents.set(record.agent, entry)
  }
  const rules = new Map<RuleId, number>()
  for (const record of records) rules.set(record.ruleId, (rules.get(record.ruleId) ?? 0) + 1)
  const trend = new Map<string, { generated: number; approved: number }>()
  for (const record of records) {
    const day = record.createdAt.slice(0, 10)
    if (Date.parse(record.createdAt) < now - 30 * 86_400_000) continue
    const entry = trend.get(day) ?? { generated: 0, approved: 0 }
    entry.generated += 1
    if (approvedLike(record)) entry.approved += 1
    trend.set(day, entry)
  }
  return {
    counts,
    total: records.length,
    pendingImpact: groupImpact(records.filter((record) => record.status === 'PENDING')),
    approvedThisMonth: { count: approvedThisMonth.length, impact: groupImpact(approvedThisMonth) },
    byAgent: [...agents.entries()].map(([agent, entry]) => ({ agent, ...entry })).sort((left, right) => right.total - left.total),
    byRule: [...rules.entries()].map(([ruleId, total]) => ({ ruleId, total })).sort((left, right) => right.total - left.total),
    approvalRate: {
      allTime: rate(decided.filter(approvedLike).length, decided.length),
      last30d: rate(decided30.filter(approvedLike).length, decided30.length),
    },
    averageDecisionMs: decisionDurations.length > 0 ? Math.round(decisionDurations.reduce((sum, ms) => sum + ms, 0) / decisionDurations.length) : null,
    recentDecisions: records.filter((record) => record.decidedAt !== null).sort((left, right) => (right.decidedAt ?? '').localeCompare(left.decidedAt ?? '')).slice(0, 10),
    generatedTrend: [...trend.entries()].map(([day, entry]) => ({ day, ...entry })).sort((left, right) => left.day.localeCompare(right.day)),
  }
}

function groupImpact(records: readonly Recommendation[]): readonly Readonly<{ currency: string; value: number }>[] {
  const byCurrency = new Map<string, number>()
  for (const record of records) byCurrency.set(record.currency, (byCurrency.get(record.currency) ?? 0) + record.impactValue)
  return [...byCurrency.entries()].map(([currency, value]) => ({ currency, value: Math.round(value * 100) / 100 })).sort((left, right) => right.value - left.value)
}

function rate(part: number, whole: number): number | null { return whole === 0 ? null : Math.round((part / whole) * 1000) / 10 }

function matches(record: Recommendation, query: RecommendationListQuery): boolean {
  if (query.status && record.status !== query.status) return false
  if (query.agent && record.agent !== query.agent) return false
  if (query.ruleId && record.ruleId !== query.ruleId) return false
  if (typeof query.minImpact === 'number' && record.impactValue < query.minImpact) return false
  if (typeof query.maxImpact === 'number' && record.impactValue > query.maxImpact) return false
  if (query.dateFrom && record.createdAt < query.dateFrom) return false
  if (query.dateTo && record.createdAt > query.dateTo) return false
  return true
}

function sortRecommendations(records: readonly Recommendation[], sort: RecommendationSort, direction?: 'asc' | 'desc'): readonly Recommendation[] {
  const factor = (direction ?? 'desc') === 'desc' ? -1 : 1
  return [...records].sort((left, right) => {
    if (sort === 'impact') return factor * (left.impactValue - right.impactValue)
    if (sort === 'confidence') return factor * (left.confidence - right.confidence)
    if (sort === 'decided') return factor * ((left.decidedAt ?? '').localeCompare(right.decidedAt ?? ''))
    return factor * left.createdAt.localeCompare(right.createdAt)
  })
}

function sqlOrder(sort: RecommendationSort, direction?: 'asc' | 'desc'): string {
  const dir = (direction ?? 'desc') === 'desc' ? 'DESC' : 'ASC'
  if (sort === 'impact') return `(payload->>'impactValue')::numeric ${dir}, created_at DESC`
  if (sort === 'confidence') return `(payload->>'confidence')::numeric ${dir}, created_at DESC`
  if (sort === 'decided') return `decided_at ${dir} NULLS LAST, created_at DESC`
  return `created_at ${dir}`
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return RECOMMENDATION_PAGE_LIMIT
  return Math.min(Math.floor(limit), RECOMMENDATION_PAGE_LIMIT)
}

/**
 * Rows written before PR #46 lack the lifecycle fields; defaulting them here
 * means every payload leaving the repository satisfies the current contract.
 */
function normalize(value: Recommendation): Recommendation {
  return {
    ...value,
    entityKey: value.entityKey ?? null,
    expiresAt: value.expiresAt ?? null,
    decidedAt: value.decidedAt ?? null,
    decidedBy: value.decidedBy ?? null,
    rejectReason: value.rejectReason ?? null,
    snoozedUntil: value.snoozedUntil ?? null,
  }
}

function parseRecommendation(value: unknown): Recommendation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('AI recommendation payload is invalid')
  return normalize(value as Recommendation)
}
