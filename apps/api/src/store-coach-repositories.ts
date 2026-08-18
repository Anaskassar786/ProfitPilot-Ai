import { randomUUID } from 'node:crypto'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { CoachGoalMetric, CoachGoalStatus, CoachGoalType, CoachPersonality, CoachStreak, PriorityCandidate } from '@profitpilot/ai'

/**
 * PR #48 — Store Coach Postgres repositories. All access goes through
 * withTenantContext so the app.store_id GUC drives the RLS policies from
 * migrations/0021_store_coach.sql.
 */

export type CoachHuddleRecord = Readonly<{
  id: string
  storeId: StoreId
  huddleDate: string
  content: Readonly<Record<string, unknown>>
  viewedAt: number | null
  createdAt: number
}>

export type CoachPriorityRecord = Readonly<{
  id: string
  storeId: StoreId
  priorityDate: string
  category: 'HIGH_IMPACT' | 'QUICK_WIN' | 'OPPORTUNITY'
  title: string
  description: string
  impactValue: number
  impactCurrency: string
  impactLabel: string
  timeEstimateMinutes: number
  actionType: string
  actionPayload: Readonly<Record<string, unknown>>
  status: 'PENDING' | 'COMPLETED' | 'DISMISSED' | 'EXPIRED'
  completedAt: number | null
  expiresAt: number | null
  createdAt: number
}>

export type CoachGoalRecord = Readonly<{
  id: string
  storeId: StoreId
  goalType: CoachGoalType
  title: string
  description: string
  metric: CoachGoalMetric
  targetValue: number
  targetCurrency: string
  startDate: string
  endDate: string
  status: CoachGoalStatus
  currentProgress: number
  feasibility: 'HIGH' | 'MEDIUM' | 'LOW'
  achievedAt: number | null
  createdAt: number
  updatedAt: number
}>

export type CoachAchievementRecord = Readonly<{ id: string; storeId: StoreId; badgeId: string; earnedAt: number; context: Readonly<Record<string, unknown>> }>

export type CoachMessage = Readonly<{ role: 'user' | 'coach'; content: string; timestamp: number; confidence?: number | null }>

export type CoachConversation = Readonly<{ id: string; storeId: StoreId; messages: readonly CoachMessage[]; createdAt: number; updatedAt: number }>

export type CoachPreferences = Readonly<{
  storeId: StoreId
  personality: CoachPersonality
  huddleTimeMinutes: number
  huddleEnabled: boolean
  weeklyEmailEnabled: boolean
  voiceEnabled: boolean
  widgetEnabled: boolean
  language: 'en' | 'hi'
  notificationFrequency: 'LOW' | 'NORMAL' | 'HIGH'
  updatedAt: number
}>

export type CoachHealthScoreRecord = Readonly<{ id: string; storeId: StoreId; score: number; calculatedAt: number; factors: Readonly<Record<string, unknown>> }>

export type CoachReportRecord = Readonly<{
  id: string
  storeId: StoreId
  reportType: 'WEEKLY' | 'MONTHLY'
  reportDate: string
  content: Readonly<Record<string, unknown>>
  pdfUrl: string | null
  sentViaEmail: boolean
  createdAt: number
}>

export type CoachOnboardingState = Readonly<{ storeId: StoreId; currentStep: number; completed: boolean; skipped: boolean; completedAt: number | null }>

export type CoachUsageToday = Readonly<{ storeId: StoreId; usageDay: string; chatMessages: number; huddlesGenerated: number }>

export interface HuddleRepository {
  getByDate(storeId: StoreId, day: string): Promise<CoachHuddleRecord | null>
  upsert(storeId: StoreId, day: string, content: Readonly<Record<string, unknown>>): Promise<CoachHuddleRecord>
  history(storeId: StoreId, days: number): Promise<readonly CoachHuddleRecord[]>
  markViewed(storeId: StoreId, id: string): Promise<CoachHuddleRecord | null>
}

export interface PriorityRepository {
  forDay(storeId: StoreId, day: string): Promise<readonly CoachPriorityRecord[]>
  insert(storeId: StoreId, day: string, candidates: readonly PriorityCandidate[], expiresAt: number): Promise<readonly CoachPriorityRecord[]>
  complete(storeId: StoreId, id: string): Promise<CoachPriorityRecord | null>
  dismiss(storeId: StoreId, id: string): Promise<CoachPriorityRecord | null>
  expire(storeId: StoreId, day: string): Promise<number>
  signalCounts(storeId: StoreId): Promise<{ completed: number; doneDays: number }>
}

export interface GoalRepository {
  list(storeId: StoreId, status?: CoachGoalStatus): Promise<readonly CoachGoalRecord[]>
  create(storeId: StoreId, input: Readonly<{ goalType: CoachGoalType; title: string; description: string; metric: CoachGoalMetric; targetValue: number; targetCurrency: string; startDate: string; endDate: string; feasibility: 'HIGH' | 'MEDIUM' | 'LOW' }>): Promise<CoachGoalRecord>
  update(storeId: StoreId, id: string, patch: Readonly<{ title?: string; description?: string; targetValue?: number; endDate?: string; currentProgress?: number; status?: CoachGoalStatus; feasibility?: 'HIGH' | 'MEDIUM' | 'LOW' }>): Promise<CoachGoalRecord | null>
  remove(storeId: StoreId, id: string): Promise<boolean>
  progress(storeId: StoreId, id: string, current: number): Promise<CoachGoalRecord | null>
  signalCounts(storeId: StoreId): Promise<{ created: number; achieved: number }>
}

export interface AchievementRepository {
  earned(storeId: StoreId): Promise<readonly CoachAchievementRecord[]>
  earnedIds(storeId: StoreId): Promise<ReadonlySet<string>>
  award(storeId: StoreId, badgeId: string, context: Readonly<Record<string, unknown>>): Promise<boolean>
}

export interface ConversationRepository {
  get(storeId: StoreId): Promise<CoachConversation | null>
  append(storeId: StoreId, messages: readonly CoachMessage[]): Promise<CoachConversation>
  clear(storeId: StoreId): Promise<void>
  lifetimeMessages(storeId: StoreId): Promise<number>
}

export interface PreferenceRepository {
  get(storeId: StoreId): Promise<CoachPreferences | null>
  save(storeId: StoreId, patch: Readonly<Partial<Omit<CoachPreferences, 'storeId' | 'updatedAt'>>>): Promise<CoachPreferences>
}

export interface HealthScoreRepository {
  latest(storeId: StoreId): Promise<CoachHealthScoreRecord | null>
  history(storeId: StoreId, limit: number): Promise<readonly CoachHealthScoreRecord[]>
  record(storeId: StoreId, score: number, factors: Readonly<Record<string, unknown>>): Promise<CoachHealthScoreRecord>
}

export interface CoachReportRepository {
  latest(storeId: StoreId, reportType: 'WEEKLY' | 'MONTHLY'): Promise<CoachReportRecord | null>
  list(storeId: StoreId, limit: number): Promise<readonly CoachReportRecord[]>
  save(storeId: StoreId, input: Readonly<{ reportType: 'WEEKLY' | 'MONTHLY'; reportDate: string; content: Readonly<Record<string, unknown>>; pdfUrl?: string | null; sentViaEmail?: boolean }>): Promise<CoachReportRecord>
  markEmailed(storeId: StoreId, id: string): Promise<CoachReportRecord | null>
  readCount(storeId: StoreId): Promise<number>
}

export interface StreakRepository {
  get(storeId: StoreId): Promise<CoachStreak | null>
  update(storeId: StoreId, streak: CoachStreak): Promise<CoachStreak>
}

export interface OnboardingRepository {
  get(storeId: StoreId): Promise<CoachOnboardingState | null>
  completeStep(storeId: StoreId, step: number): Promise<CoachOnboardingState>
  skip(storeId: StoreId): Promise<CoachOnboardingState>
}

export interface CoachUsageRepository {
  today(storeId: StoreId, day: string): Promise<CoachUsageToday>
  incrementChat(storeId: StoreId, day: string): Promise<CoachUsageToday>
  incrementHuddle(storeId: StoreId, day: string): Promise<CoachUsageToday>
}

// ---------------------------------------------------------------------------
// Postgres implementations
// ---------------------------------------------------------------------------

type HuddleRow = QueryResultRow & { id: string; store_id: string; huddle_date: string; content: unknown; viewed_at: Date | null; created_at: Date }
type PriorityRow = QueryResultRow & { id: string; store_id: string; priority_date: string; category: string; title: string; description: string; impact_value: string | number; impact_currency: string; impact_label: string; time_estimate_minutes: number; action_type: string; action_payload: unknown; status: string; completed_at: Date | null; expires_at: Date | null; created_at: Date }
type GoalRow = QueryResultRow & { id: string; store_id: string; goal_type: string; title: string; description: string; metric: string; target_value: string | number; target_currency: string; start_date: string; end_date: string; status: string; current_progress: string | number; feasibility: string; achieved_at: Date | null; created_at: Date; updated_at: Date }
type AchievementRow = QueryResultRow & { id: string; store_id: string; badge_id: string; earned_at: Date; context: unknown }
type ConversationRow = QueryResultRow & { id: string; store_id: string; messages: unknown; created_at: Date; updated_at: Date }
type PreferenceRow = QueryResultRow & { store_id: string; personality: string; huddle_time_minutes: number; huddle_enabled: boolean; weekly_email_enabled: boolean; voice_enabled: boolean; widget_enabled: boolean; language: string; notification_frequency: string; updated_at: Date }
type HealthScoreRow = QueryResultRow & { id: string; store_id: string; score: number; calculated_at: Date; factors: unknown }
type ReportRow = QueryResultRow & { id: string; store_id: string; report_type: string; report_date: string; content: unknown; pdf_url: string | null; sent_via_email: boolean; created_at: Date }
type StreakRow = QueryResultRow & { store_id: string; current_streak: number; longest_streak: number; last_active_date: string | null; updated_at: Date }
type OnboardingRow = QueryResultRow & { store_id: string; current_step: number; completed: boolean; skipped_at: Date | null; completed_at: Date | null }
type UsageRow = QueryResultRow & { store_id: string; usage_day: string; chat_messages: number; huddles_generated: number }

function toDateIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(0, 10)
}

function toMs(value: Date | null): number | null {
  return value === null ? null : new Date(value).getTime()
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}
}

function toHuddle(row: HuddleRow): CoachHuddleRecord {
  return { id: row.id, storeId: row.store_id as StoreId, huddleDate: toDateIso(row.huddle_date), content: asRecord(row.content), viewedAt: toMs(row.viewed_at), createdAt: new Date(row.created_at).getTime() }
}

function toPriority(row: PriorityRow): CoachPriorityRecord {
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    priorityDate: toDateIso(row.priority_date),
    category: row.category as CoachPriorityRecord['category'],
    title: row.title,
    description: row.description,
    impactValue: Number(row.impact_value),
    impactCurrency: row.impact_currency,
    impactLabel: row.impact_label,
    timeEstimateMinutes: row.time_estimate_minutes,
    actionType: row.action_type,
    actionPayload: asRecord(row.action_payload),
    status: row.status as CoachPriorityRecord['status'],
    completedAt: toMs(row.completed_at),
    expiresAt: toMs(row.expires_at),
    createdAt: new Date(row.created_at).getTime(),
  }
}

function toGoal(row: GoalRow): CoachGoalRecord {
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    goalType: row.goal_type as CoachGoalType,
    title: row.title,
    description: row.description,
    metric: row.metric as CoachGoalMetric,
    targetValue: Number(row.target_value),
    targetCurrency: row.target_currency,
    startDate: toDateIso(row.start_date),
    endDate: toDateIso(row.end_date),
    status: row.status as CoachGoalStatus,
    currentProgress: Number(row.current_progress),
    feasibility: row.feasibility as 'HIGH' | 'MEDIUM' | 'LOW',
    achievedAt: toMs(row.achieved_at),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

function toAchievement(row: AchievementRow): CoachAchievementRecord {
  return { id: row.id, storeId: row.store_id as StoreId, badgeId: row.badge_id, earnedAt: new Date(row.earned_at).getTime(), context: asRecord(row.context) }
}

function toConversation(row: ConversationRow): CoachConversation {
  const raw = Array.isArray(row.messages) ? row.messages : []
  const messages = raw.map((item) => {
    const record = asRecord(item)
    return {
      role: (record.role === 'coach' ? 'coach' : 'user') as CoachMessage['role'],
      content: String(record.content ?? ''),
      timestamp: typeof record.timestamp === 'number' ? record.timestamp : 0,
      ...(typeof record.confidence === 'number' ? { confidence: record.confidence } : {}),
    }
  })
  return { id: row.id, storeId: row.store_id as StoreId, messages, createdAt: new Date(row.created_at).getTime(), updatedAt: new Date(row.updated_at).getTime() }
}

function toPreferences(row: PreferenceRow): CoachPreferences {
  return {
    storeId: row.store_id as StoreId,
    personality: row.personality as CoachPersonality,
    huddleTimeMinutes: row.huddle_time_minutes,
    huddleEnabled: row.huddle_enabled,
    weeklyEmailEnabled: row.weekly_email_enabled,
    voiceEnabled: row.voice_enabled,
    widgetEnabled: row.widget_enabled,
    language: row.language as 'en' | 'hi',
    notificationFrequency: row.notification_frequency as 'LOW' | 'NORMAL' | 'HIGH',
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

function toHealthScore(row: HealthScoreRow): CoachHealthScoreRecord {
  return { id: row.id, storeId: row.store_id as StoreId, score: row.score, calculatedAt: new Date(row.calculated_at).getTime(), factors: asRecord(row.factors) }
}

function toReport(row: ReportRow): CoachReportRecord {
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    reportType: row.report_type as 'WEEKLY' | 'MONTHLY',
    reportDate: toDateIso(row.report_date),
    content: asRecord(row.content),
    pdfUrl: row.pdf_url,
    sentViaEmail: row.sent_via_email,
    createdAt: new Date(row.created_at).getTime(),
  }
}

function toStreak(row: StreakRow): CoachStreak {
  return { currentStreak: row.current_streak, longestStreak: row.longest_streak, lastActiveDate: row.last_active_date }
}

function toUsage(row: UsageRow): CoachUsageToday {
  return { storeId: row.store_id as StoreId, usageDay: toDateIso(row.usage_day), chatMessages: row.chat_messages, huddlesGenerated: row.huddles_generated }
}

function toOnboarding(row: OnboardingRow): CoachOnboardingState {
  return { storeId: row.store_id as StoreId, currentStep: row.current_step, completed: row.completed, skipped: row.skipped_at !== null, completedAt: toMs(row.completed_at) }
}

export class PostgresHuddleRepository implements HuddleRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async getByDate(storeId: StoreId, day: string): Promise<CoachHuddleRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<HuddleRow>('SELECT id, store_id, huddle_date, content, viewed_at, created_at FROM store_coach_huddles WHERE store_id = $1 AND huddle_date = $2 LIMIT 1', [storeId, day])
      const row = result.rows[0]
      return row ? toHuddle(row) : null
    })
  }
  public async upsert(storeId: StoreId, day: string, content: Readonly<Record<string, unknown>>): Promise<CoachHuddleRecord> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const id = randomUUID()
      const result = await client.query<HuddleRow>(`INSERT INTO store_coach_huddles (id, store_id, huddle_date, content) VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (store_id, huddle_date) DO UPDATE SET content = EXCLUDED.content, viewed_at = store_coach_huddles.viewed_at
        RETURNING id, store_id, huddle_date, content, viewed_at, created_at`, [id, storeId, day, JSON.stringify(content)])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Huddle upsert returned no row', 500, {}, false)
      return toHuddle(row)
    })
  }
  public async history(storeId: StoreId, days: number): Promise<readonly CoachHuddleRecord[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<HuddleRow>('SELECT id, store_id, huddle_date, content, viewed_at, created_at FROM store_coach_huddles WHERE store_id = $1 AND huddle_date >= (CURRENT_DATE - $2::integer) ORDER BY huddle_date DESC', [storeId, Math.max(1, days)])
      return result.rows.map(toHuddle)
    })
  }
  public async markViewed(storeId: StoreId, id: string): Promise<CoachHuddleRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<HuddleRow>('UPDATE store_coach_huddles SET viewed_at = now() WHERE id = $1 AND store_id = $2 AND viewed_at IS NULL RETURNING id, store_id, huddle_date, content, viewed_at, created_at', [id, storeId])
      const row = result.rows[0]
      return row ? toHuddle(row) : null
    })
  }
}

export class PostgresPriorityRepository implements PriorityRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async forDay(storeId: StoreId, day: string): Promise<readonly CoachPriorityRecord[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<PriorityRow>('SELECT * FROM store_coach_priorities WHERE store_id = $1 AND priority_date = $2 AND status = $3 ORDER BY CASE category WHEN $4 THEN 0 WHEN $5 THEN 1 ELSE 2 END, impact_value DESC', [storeId, day, 'PENDING', 'HIGH_IMPACT', 'QUICK_WIN'])
      return result.rows.map(toPriority)
    })
  }
  public async insert(storeId: StoreId, day: string, candidates: readonly PriorityCandidate[], expiresAt: number): Promise<readonly CoachPriorityRecord[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const values: string[] = []
      const params: unknown[] = []
      candidates.forEach((candidate, index) => {
        const base = index * 12
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, to_timestamp($${base + 12} / 1000.0))`)
        params.push(randomUUID(), storeId, day, candidate.category, candidate.title, candidate.description, candidate.impactValue, candidate.impactCurrency, candidate.impactLabel, candidate.timeEstimateMinutes, candidate.actionType, expiresAt)
      })
      if (values.length === 0) return []
      const result = await client.query<PriorityRow>(`INSERT INTO store_coach_priorities (id, store_id, priority_date, category, title, description, impact_value, impact_currency, impact_label, time_estimate_minutes, action_type, expires_at) VALUES ${values.join(', ')} RETURNING *`, params)
      return result.rows.map(toPriority)
    })
  }
  public async complete(storeId: StoreId, id: string): Promise<CoachPriorityRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<PriorityRow>('UPDATE store_coach_priorities SET status = $3, completed_at = now() WHERE id = $1 AND store_id = $2 AND status = $4 RETURNING *', [id, storeId, 'COMPLETED', 'PENDING'])
      const row = result.rows[0]
      return row ? toPriority(row) : null
    })
  }
  public async dismiss(storeId: StoreId, id: string): Promise<CoachPriorityRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<PriorityRow>('UPDATE store_coach_priorities SET status = $3 WHERE id = $1 AND store_id = $2 AND status = $4 RETURNING *', [id, storeId, 'DISMISSED', 'PENDING'])
      const row = result.rows[0]
      return row ? toPriority(row) : null
    })
  }
  public async expire(storeId: StoreId, day: string): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ expired: number }>('UPDATE store_coach_priorities SET status = $3 WHERE store_id = $1 AND priority_date < $2 AND status = $4 AND (expires_at IS NULL OR expires_at < now()) RETURNING id', [storeId, day, 'EXPIRED', 'PENDING'])
      return result.rows.length
    })
  }
  public async signalCounts(storeId: StoreId): Promise<{ completed: number; doneDays: number }> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const completed = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM store_coach_priorities WHERE store_id = $1 AND status = $2', [storeId, 'COMPLETED'])
      const doneDays = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM (
        SELECT priority_date FROM store_coach_priorities WHERE store_id = $1 GROUP BY priority_date
        HAVING COUNT(*) FILTER (WHERE status = $2) = COUNT(*) FILTER (WHERE status IN ($2, $3, $4)) AND COUNT(*) FILTER (WHERE status = $2) > 0
      ) days`, [storeId, 'COMPLETED', 'DISMISSED', 'EXPIRED'])
      return { completed: Number(completed.rows[0]?.count ?? 0), doneDays: Number(doneDays.rows[0]?.count ?? 0) }
    })
  }
}

export class PostgresGoalRepository implements GoalRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async list(storeId: StoreId, status?: CoachGoalStatus): Promise<readonly CoachGoalRecord[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = status
        ? await client.query<GoalRow>('SELECT * FROM store_coach_goals WHERE store_id = $1 AND status = $2 ORDER BY start_date DESC', [storeId, status])
        : await client.query<GoalRow>('SELECT * FROM store_coach_goals WHERE store_id = $1 ORDER BY start_date DESC', [storeId])
      return result.rows.map(toGoal)
    })
  }
  public async create(storeId: StoreId, input: Readonly<{ goalType: CoachGoalType; title: string; description: string; metric: CoachGoalMetric; targetValue: number; targetCurrency: string; startDate: string; endDate: string; feasibility: 'HIGH' | 'MEDIUM' | 'LOW' }>): Promise<CoachGoalRecord> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<GoalRow>('INSERT INTO store_coach_goals (id, store_id, goal_type, title, description, metric, target_value, target_currency, start_date, end_date, feasibility) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *', [randomUUID(), storeId, input.goalType, input.title, input.description, input.metric, input.targetValue, input.targetCurrency, input.startDate, input.endDate, input.feasibility])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Goal insert returned no row', 500, {}, false)
      return toGoal(row)
    })
  }
  public async update(storeId: StoreId, id: string, patch: Readonly<{ title?: string; description?: string; targetValue?: number; endDate?: string; currentProgress?: number; status?: CoachGoalStatus; feasibility?: 'HIGH' | 'MEDIUM' | 'LOW' }>): Promise<CoachGoalRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<GoalRow>(`UPDATE store_coach_goals SET
        title = COALESCE($3, title),
        description = COALESCE($4, description),
        target_value = COALESCE($5, target_value),
        end_date = COALESCE($6, end_date),
        current_progress = COALESCE($7, current_progress),
        status = COALESCE($8, status),
        feasibility = COALESCE($9, feasibility),
        updated_at = now()
        WHERE id = $1 AND store_id = $2 RETURNING *`, [id, storeId, patch.title ?? null, patch.description ?? null, patch.targetValue ?? null, patch.endDate ?? null, patch.currentProgress ?? null, patch.status ?? null, patch.feasibility ?? null])
      const row = result.rows[0]
      return row ? toGoal(row) : null
    })
  }
  public async remove(storeId: StoreId, id: string): Promise<boolean> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ id: string }>('DELETE FROM store_coach_goals WHERE id = $1 AND store_id = $2 RETURNING id', [id, storeId])
      return result.rows.length > 0
    })
  }
  public async progress(storeId: StoreId, id: string, current: number): Promise<CoachGoalRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<GoalRow>(`UPDATE store_coach_goals SET
        current_progress = GREATEST(current_progress, $3),
        status = CASE WHEN $3 >= target_value THEN $4 ELSE status END,
        achieved_at = CASE WHEN $3 >= target_value THEN now() ELSE achieved_at END,
        updated_at = now()
        WHERE id = $1 AND store_id = $2 RETURNING *`, [id, storeId, current, 'ACHIEVED'])
      const row = result.rows[0]
      return row ? toGoal(row) : null
    })
  }
  public async signalCounts(storeId: StoreId): Promise<{ created: number; achieved: number }> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const created = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM store_coach_goals WHERE store_id = $1', [storeId])
      const achieved = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM store_coach_goals WHERE store_id = $1 AND status = $2', [storeId, 'ACHIEVED'])
      return { created: Number(created.rows[0]?.count ?? 0), achieved: Number(achieved.rows[0]?.count ?? 0) }
    })
  }
}

export class PostgresAchievementRepository implements AchievementRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async earned(storeId: StoreId): Promise<readonly CoachAchievementRecord[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<AchievementRow>('SELECT id, store_id, badge_id, earned_at, context FROM store_coach_achievements WHERE store_id = $1 ORDER BY earned_at DESC', [storeId])
      return result.rows.map(toAchievement)
    })
  }
  public async earnedIds(storeId: StoreId): Promise<ReadonlySet<string>> {
    const earned = await this.earned(storeId)
    return new Set(earned.map((record) => record.badgeId))
  }
  public async award(storeId: StoreId, badgeId: string, context: Readonly<Record<string, unknown>>): Promise<boolean> {
    return withTenantContext(this.executor, storeId, async (client) => {
      try {
        const result = await client.query<AchievementRow>('INSERT INTO store_coach_achievements (id, store_id, badge_id, context) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (store_id, badge_id) DO NOTHING RETURNING id', [randomUUID(), storeId, badgeId, JSON.stringify(context)])
        return result.rows.length > 0
      } catch {
        return false
      }
    })
  }
}

export class PostgresConversationRepository implements ConversationRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async get(storeId: StoreId): Promise<CoachConversation | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<ConversationRow>('SELECT id, store_id, messages, created_at, updated_at FROM store_coach_conversations WHERE store_id = $1 LIMIT 1', [storeId])
      const row = result.rows[0]
      return row ? toConversation(row) : null
    })
  }
  public async append(storeId: StoreId, messages: readonly CoachMessage[]): Promise<CoachConversation> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const existing = await client.query<ConversationRow>('SELECT id, store_id, messages, created_at, updated_at FROM store_coach_conversations WHERE store_id = $1 LIMIT 1', [storeId])
      const current = existing.rows[0]
      const merged = [...(Array.isArray(current?.messages) ? (current.messages as readonly unknown[]) : []), ...messages.map((message) => ({ role: message.role, content: message.content, timestamp: message.timestamp, ...(message.confidence !== undefined && message.confidence !== null ? { confidence: message.confidence } : {}) }))]
      const result = await client.query<ConversationRow>(`INSERT INTO store_coach_conversations (id, store_id, messages) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (store_id) DO UPDATE SET messages = EXCLUDED.messages, updated_at = now()
        RETURNING id, store_id, messages, created_at, updated_at`, [current?.id ?? randomUUID(), storeId, JSON.stringify(merged)])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Conversation append returned no row', 500, {}, false)
      return toConversation(row)
    })
  }
  public async clear(storeId: StoreId): Promise<void> {
    await withTenantContext(this.executor, storeId, async (client) => {
      await client.query('DELETE FROM store_coach_conversations WHERE store_id = $1', [storeId])
    })
  }
  public async lifetimeMessages(storeId: StoreId): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>(`SELECT COALESCE((SELECT jsonb_array_length(messages) FROM store_coach_conversations WHERE store_id = $1), 0)::text AS count`, [storeId])
      return Number(result.rows[0]?.count ?? 0)
    })
  }
}

export class PostgresPreferenceRepository implements PreferenceRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async get(storeId: StoreId): Promise<CoachPreferences | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<PreferenceRow>('SELECT store_id, personality, huddle_time_minutes, huddle_enabled, weekly_email_enabled, voice_enabled, widget_enabled, language, notification_frequency, updated_at FROM store_coach_preferences WHERE store_id = $1 LIMIT 1', [storeId])
      const row = result.rows[0]
      return row ? toPreferences(row) : null
    })
  }
  public async save(storeId: StoreId, patch: Readonly<Partial<Omit<CoachPreferences, 'storeId' | 'updatedAt'>>>): Promise<CoachPreferences> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<PreferenceRow>(`INSERT INTO store_coach_preferences (store_id, personality, huddle_time_minutes, huddle_enabled, weekly_email_enabled, voice_enabled, widget_enabled, language, notification_frequency)
        VALUES ($1, COALESCE($2, $10), COALESCE($3, 420), COALESCE($4, true), COALESCE($5, true), COALESCE($6, false), COALESCE($7, false), COALESCE($8, $11), COALESCE($9, $12))
        ON CONFLICT (store_id) DO UPDATE SET
          personality = COALESCE($2, store_coach_preferences.personality),
          huddle_time_minutes = COALESCE($3, store_coach_preferences.huddle_time_minutes),
          huddle_enabled = COALESCE($4, store_coach_preferences.huddle_enabled),
          weekly_email_enabled = COALESCE($5, store_coach_preferences.weekly_email_enabled),
          voice_enabled = COALESCE($6, store_coach_preferences.voice_enabled),
          widget_enabled = COALESCE($7, store_coach_preferences.widget_enabled),
          language = COALESCE($8, store_coach_preferences.language),
          notification_frequency = COALESCE($9, store_coach_preferences.notification_frequency),
          updated_at = now()
        RETURNING store_id, personality, huddle_time_minutes, huddle_enabled, weekly_email_enabled, voice_enabled, widget_enabled, language, notification_frequency, updated_at`,
      [storeId, patch.personality ?? null, patch.huddleTimeMinutes ?? null, patch.huddleEnabled ?? null, patch.weeklyEmailEnabled ?? null, patch.voiceEnabled ?? null, patch.widgetEnabled ?? null, patch.language ?? null, patch.notificationFrequency ?? null, 'PROFESSIONAL', 'en', 'NORMAL'])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Preference upsert returned no row', 500, {}, false)
      return toPreferences(row)
    })
  }
}

export class PostgresHealthScoreRepository implements HealthScoreRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async latest(storeId: StoreId): Promise<CoachHealthScoreRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<HealthScoreRow>('SELECT id, store_id, score, calculated_at, factors FROM store_coach_health_scores WHERE store_id = $1 ORDER BY calculated_at DESC LIMIT 1', [storeId])
      const row = result.rows[0]
      return row ? toHealthScore(row) : null
    })
  }
  public async history(storeId: StoreId, limit: number): Promise<readonly CoachHealthScoreRecord[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<HealthScoreRow>('SELECT id, store_id, score, calculated_at, factors FROM store_coach_health_scores WHERE store_id = $1 ORDER BY calculated_at DESC LIMIT $2', [storeId, Math.max(1, Math.min(limit, 200))])
      return result.rows.map(toHealthScore)
    })
  }
  public async record(storeId: StoreId, score: number, factors: Readonly<Record<string, unknown>>): Promise<CoachHealthScoreRecord> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<HealthScoreRow>('INSERT INTO store_coach_health_scores (id, store_id, score, factors) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, store_id, score, calculated_at, factors', [randomUUID(), storeId, Math.round(Math.max(0, Math.min(100, score))), JSON.stringify(factors)])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Health score insert returned no row', 500, {}, false)
      return toHealthScore(row)
    })
  }
}

export class PostgresCoachReportRepository implements CoachReportRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async latest(storeId: StoreId, reportType: 'WEEKLY' | 'MONTHLY'): Promise<CoachReportRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<ReportRow>('SELECT id, store_id, report_type, report_date, content, pdf_url, sent_via_email, created_at FROM store_coach_reports WHERE store_id = $1 AND report_type = $2 ORDER BY report_date DESC LIMIT 1', [storeId, reportType])
      const row = result.rows[0]
      return row ? toReport(row) : null
    })
  }
  public async list(storeId: StoreId, limit: number): Promise<readonly CoachReportRecord[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<ReportRow>('SELECT id, store_id, report_type, report_date, content, pdf_url, sent_via_email, created_at FROM store_coach_reports WHERE store_id = $1 ORDER BY report_date DESC LIMIT $2', [storeId, Math.max(1, Math.min(limit, 52))])
      return result.rows.map(toReport)
    })
  }
  public async save(storeId: StoreId, input: Readonly<{ reportType: 'WEEKLY' | 'MONTHLY'; reportDate: string; content: Readonly<Record<string, unknown>>; pdfUrl?: string | null; sentViaEmail?: boolean }>): Promise<CoachReportRecord> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<ReportRow>('INSERT INTO store_coach_reports (id, store_id, report_type, report_date, content, pdf_url, sent_via_email) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id, store_id, report_type, report_date, content, pdf_url, sent_via_email, created_at', [randomUUID(), storeId, input.reportType, input.reportDate, JSON.stringify(input.content), input.pdfUrl ?? null, input.sentViaEmail ?? false])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Report insert returned no row', 500, {}, false)
      return toReport(row)
    })
  }
  public async markEmailed(storeId: StoreId, id: string): Promise<CoachReportRecord | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<ReportRow>('UPDATE store_coach_reports SET sent_via_email = true WHERE id = $1 AND store_id = $2 RETURNING id, store_id, report_type, report_date, content, pdf_url, sent_via_email, created_at', [id, storeId])
      const row = result.rows[0]
      return row ? toReport(row) : null
    })
  }
  public async readCount(storeId: StoreId): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM store_coach_reports WHERE store_id = $1', [storeId])
      return Number(result.rows[0]?.count ?? 0)
    })
  }
}

export class PostgresStreakRepository implements StreakRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async get(storeId: StoreId): Promise<CoachStreak | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<StreakRow>('SELECT store_id, current_streak, longest_streak, last_active_date, updated_at FROM store_coach_streaks WHERE store_id = $1 LIMIT 1', [storeId])
      const row = result.rows[0]
      return row ? toStreak(row) : null
    })
  }
  public async update(storeId: StoreId, streak: CoachStreak): Promise<CoachStreak> {
    return withTenantContext(this.executor, storeId, async (client) => {
      await client.query('INSERT INTO store_coach_streaks (store_id, current_streak, longest_streak, last_active_date, updated_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (store_id) DO UPDATE SET current_streak = EXCLUDED.current_streak, longest_streak = EXCLUDED.longest_streak, last_active_date = EXCLUDED.last_active_date, updated_at = now()', [storeId, streak.currentStreak, streak.longestStreak, streak.lastActiveDate])
      return streak
    })
  }
}

export class PostgresOnboardingRepository implements OnboardingRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async get(storeId: StoreId): Promise<CoachOnboardingState | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<OnboardingRow>('SELECT store_id, current_step, completed, skipped_at, completed_at FROM store_coach_onboarding WHERE store_id = $1 LIMIT 1', [storeId])
      const row = result.rows[0]
      return row ? toOnboarding(row) : null
    })
  }
  public async completeStep(storeId: StoreId, step: number): Promise<CoachOnboardingState> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const safeStep = Math.max(0, Math.min(5, Math.floor(step)))
      const result = await client.query<OnboardingRow>(`INSERT INTO store_coach_onboarding (store_id, current_step, completed, completed_at) VALUES ($1, $2, $3, $4)
        ON CONFLICT (store_id) DO UPDATE SET current_step = GREATEST(store_coach_onboarding.current_step, $2), completed = $3, completed_at = CASE WHEN $3 THEN now() ELSE store_coach_onboarding.completed_at END, updated_at = now()
        RETURNING store_id, current_step, completed, skipped_at, completed_at`, [storeId, safeStep, safeStep >= 5, safeStep >= 5 ? new Date() : null])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Onboarding upsert returned no row', 500, {}, false)
      return toOnboarding(row)
    })
  }
  public async skip(storeId: StoreId): Promise<CoachOnboardingState> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<OnboardingRow>(`INSERT INTO store_coach_onboarding (store_id, current_step, completed, skipped_at) VALUES ($1, 5, false, now())
        ON CONFLICT (store_id) DO UPDATE SET skipped_at = now(), updated_at = now()
        RETURNING store_id, current_step, completed, skipped_at, completed_at`, [storeId])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Onboarding skip returned no row', 500, {}, false)
      return toOnboarding(row)
    })
  }
}

export class PostgresCoachUsageRepository implements CoachUsageRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async today(storeId: StoreId, day: string): Promise<CoachUsageToday> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<UsageRow>('INSERT INTO store_coach_usage_daily (store_id, usage_day) VALUES ($1, $2) ON CONFLICT (store_id, usage_day) DO NOTHING RETURNING store_id, usage_day, chat_messages, huddles_generated', [storeId, day])
      const row = result.rows[0]
      if (row) return toUsage(row)
      const read = await client.query<UsageRow>('SELECT store_id, usage_day, chat_messages, huddles_generated FROM store_coach_usage_daily WHERE store_id = $1 AND usage_day = $2', [storeId, day])
      const existing = read.rows[0]
      return existing ? toUsage(existing) : { storeId, usageDay: day, chatMessages: 0, huddlesGenerated: 0 }
    })
  }
  public async incrementChat(storeId: StoreId, day: string): Promise<CoachUsageToday> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<UsageRow>('INSERT INTO store_coach_usage_daily (store_id, usage_day, chat_messages) VALUES ($1, $2, 1) ON CONFLICT (store_id, usage_day) DO UPDATE SET chat_messages = store_coach_usage_daily.chat_messages + 1 RETURNING store_id, usage_day, chat_messages, huddles_generated', [storeId, day])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Usage increment returned no row', 500, {}, false)
      return toUsage(row)
    })
  }
  public async incrementHuddle(storeId: StoreId, day: string): Promise<CoachUsageToday> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<UsageRow>('INSERT INTO store_coach_usage_daily (store_id, usage_day, huddles_generated) VALUES ($1, $2, 1) ON CONFLICT (store_id, usage_day) DO UPDATE SET huddles_generated = store_coach_usage_daily.huddles_generated + 1 RETURNING store_id, usage_day, chat_messages, huddles_generated', [storeId, day])
      const row = result.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Usage increment returned no row', 500, {}, false)
      return toUsage(row)
    })
  }
}
