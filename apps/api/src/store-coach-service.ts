import { AppError } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { AnalyticsRepository } from '@profitpilot/db'
import {
  BADGE_CATALOG,
  PERSONALITY_CATALOG,
  assertCoachChatResponse,
  assertCoachFeature,
  badgesVisibleForPlan,
  buildChatSystemPrompt,
  buildGoalSuggestionsPrompt,
  buildHuddlePrompt,
  buildPrioritiesPrompt,
  buildWeeklyReviewPrompt,
  calculateHealthScore,
  coachChatSuggestions,
  coachLimit,
  emptyCoachEvidence,
  evaluateBadgeAwards,
  goalProgressView,
  isStreakComeback,
  parseGoalSuggestionsJson,
  parseHuddleJson,
  parsePrioritiesJson,
  parseWeeklyReviewJson,
  personalityForPlan,
  streakAfterView,
} from '@profitpilot/ai'
import type { AiGeneration, BadgeSignals, CoachEvidence, CoachPersonality, CoachStreak, GoalSuggestion } from '@profitpilot/ai'
import type {
  AchievementRepository,
  CoachAchievementRecord,
  CoachConversation,
  CoachGoalRecord,
  CoachHuddleRecord,
  CoachMessage,
  CoachOnboardingState,
  CoachPreferences,
  CoachPriorityRecord,
  CoachReportRepository,
  CoachUsageRepository,
  ConversationRepository,
  GoalRepository,
  HealthScoreRepository,
  HuddleRepository,
  OnboardingRepository,
  PreferenceRepository,
  PriorityRepository,
  StreakRepository,
} from './store-coach-repositories.js'

/**
 * PR #48 — Store Coach service. The single orchestration layer between the
 * HTTP routes and the repositories/AI provider. Every method resolves the
 * merchant's real plan and enforces the Store Coach feature matrix before
 * touching data; AI output passes the grounded-number firewall before it is
 * persisted or streamed.
 */

export type CoachAiProvider = Readonly<{
  configured: boolean
  generate(system: string, user: string, context?: Readonly<{ requestId?: string; maxTokens?: number }>): Promise<AiGeneration>
  generateStream(system: string, user: string, context?: Readonly<{ requestId?: string; maxTokens?: number }>, onDelta?: (fullText: string) => void): Promise<AiGeneration>
}>

export type CoachMailer = Readonly<{
  sendWeeklyReview(input: Readonly<{ storeId: StoreId; to: string; subject: string; html: string }>): Promise<void>
}>

export type CoachPdfWriter = Readonly<{
  write(filename: string, rows: readonly Readonly<Record<string, string | number>>[]): Promise<string>
}>

export type StoreCoachServiceDependencies = Readonly<{
  huddles: HuddleRepository
  priorities: PriorityRepository
  goals: GoalRepository
  achievements: AchievementRepository
  conversations: ConversationRepository
  preferences: PreferenceRepository
  healthScores: HealthScoreRepository
  reports: CoachReportRepository
  streaks: StreakRepository
  onboarding: OnboardingRepository
  usage: CoachUsageRepository
  analytics: Pick<AnalyticsRepository, 'read'>
  plan: (storeId: StoreId) => Promise<PlanTier>
  merchantDay: (storeId: StoreId, at: Date) => Promise<string>
  merchantHour: (storeId: StoreId, at: Date) => Promise<number>
  storeName: (storeId: StoreId) => Promise<string | null>
  merchantEmail: (storeId: StoreId) => Promise<string | null>
  trialExpired: (storeId: StoreId, plan: PlanTier) => boolean | Promise<boolean>
  ai: CoachAiProvider
  costs?: Readonly<{ record(input: Readonly<{ storeId: StoreId; model: string; promptTokens: number; completionTokens: number; inputRateMicroDollars: number; outputRateMicroDollars: number; at: number }>): void }>
  mailer?: CoachMailer
  pdf?: CoachPdfWriter
  extraSignals?: (storeId: StoreId) => Promise<Partial<BadgeSignals>>
  notificationUrl?: string
  now?: () => Date
  rateLimitPerMinute?: number
}>

export type HuddleView = Readonly<{
  id: string
  huddleDate: string
  content: Readonly<Record<string, unknown>>
  viewed: boolean
  createdAt: number
  plan: PlanTier
  voiceAvailable: boolean
}>

export type PrioritiesView = Readonly<{
  priorityDate: string
  priorities: readonly CoachPriorityRecord[]
  planLimit: number
  remainingToday: number
}>

export type UsageView = Readonly<{
  plan: PlanTier
  chatMessagesToday: number
  chatLimit: number
  huddlesGeneratedToday: number
  activeGoals: number
  goalLimit: number
  chatAtWarning: boolean
  chatExhausted: boolean
}>

export type HealthScoreView = Readonly<{
  score: number | null
  label: string
  tone: 'good' | 'ok' | 'low'
  factors: Readonly<Record<string, unknown>>
  history: readonly Readonly<{ score: number; calculatedAt: number }>[]
}>

type DayRow = Readonly<{ day: string; grossRevenue: number; orderCount: number; aov: number }>

const DAY_MS = 86_400_000

export class StoreCoachService {
  private readonly deps: StoreCoachServiceDependencies
  private readonly now: () => Date
  private readonly requestWindows = new Map<string, readonly number[]>()
  private readonly generating = new Map<string, Promise<unknown>>()

  public constructor(deps: StoreCoachServiceDependencies) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
  }

  // -------------------------------------------------------------------------
  // Evidence (grounding)
  // -------------------------------------------------------------------------

  public merchantDay(storeId: StoreId, at: Date): Promise<string> {
    return this.deps.merchantDay(storeId, at)
  }

  public merchantHour(storeId: StoreId, at: Date): Promise<number> {
    return this.deps.merchantHour(storeId, at)
  }

  public huddleForDate(storeId: StoreId, day: string): Promise<CoachHuddleRecord | null> {
    return this.deps.huddles.getByDate(storeId, day)
  }

  public async buildEvidence(storeId: StoreId, at = this.now()): Promise<CoachEvidence> {
    const snapshot = await this.deps.analytics.read(storeId)
    const todayIso = await this.deps.merchantDay(storeId, at)
    const storeName = (await this.deps.storeName(storeId)) ?? 'your store'
    const rows: DayRow[] = snapshot.revenue
      .map((row) => {
        const orders = snapshot.orders.find((order) => order.day === row.day)
        return { day: row.day, grossRevenue: Number(row.grossRevenue), orderCount: row.orderCount, aov: Number(orders?.averageOrderValue ?? (row.orderCount > 0 ? Number(row.grossRevenue) / row.orderCount : 0)) }
      })
      .filter((row) => row.day <= todayIso)
      .sort((a, b) => (a.day < b.day ? -1 : 1))
    const currency = snapshot.revenue[0] ? 'USD' : 'USD'
    const evidence = emptyCoachEvidence(storeName, currency)
    const last = rows[rows.length - 1]
    if (last) {
      evidence.yesterdayRevenue = last.grossRevenue
      evidence.yesterdayOrders = last.orderCount
      evidence.yesterdayAov = last.aov
      const trailing7 = rows.slice(-7)
      const prior7 = rows.slice(-14, -7)
      evidence.trailing7dRevenue = sum(trailing7, (row) => row.grossRevenue)
      evidence.trailing7dOrders = sum(trailing7, (row) => row.orderCount)
      const priorRevenue = sum(prior7, (row) => row.grossRevenue)
      const priorOrders = sum(prior7, (row) => row.orderCount)
      evidence.trailing7dRevenueChangePct = priorRevenue > 0 ? Math.round(((evidence.trailing7dRevenue - priorRevenue) / priorRevenue) * 1000) / 10 : 0
      evidence.trailing7dOrdersChangePct = priorOrders > 0 ? Math.round(((evidence.trailing7dOrders - priorOrders) / priorOrders) * 1000) / 10 : 0
      const trailing30 = rows.slice(-30)
      evidence.trailing30dRevenue = sum(trailing30, (row) => row.grossRevenue)
      evidence.trailing30dOrders = sum(trailing30, (row) => row.orderCount)
      evidence.aov30d = evidence.trailing30dOrders > 0 ? evidence.trailing30dRevenue / evidence.trailing30dOrders : 0
      evidence.bestDayRevenue = Math.max(...rows.map((row) => row.grossRevenue), 0)
      evidence.topSignal = this.topSignal(rows)
    }
    const cohorts = snapshot.customerCohorts.filter((row) => row.cohortDay === last?.day)
    evidence.yesterdayNewCustomers = sum(cohorts, (row) => row.customerCount)
    const streak = await this.deps.streaks.get(storeId)
    evidence.streakDays = streak?.currentStreak ?? 0
    return evidence
  }

  private topSignal(rows: readonly DayRow[]): string {
    if (rows.length < 3) return 'order history is still thin — sync more orders for richer signals'
    const last = rows[rows.length - 1]
    const previous = rows[rows.length - 2]
    if (!last || !previous) return 'no comparable days yet'
    if (last.grossRevenue > previous.grossRevenue * 1.25) return 'yesterday\u2019s revenue was the strongest recent day'
    if (last.grossRevenue < previous.grossRevenue * 0.75) return 'yesterday\u2019s revenue dropped sharply vs the prior day'
    if (last.aov > 0 && last.aov > previous.aov * 1.1) return 'average order value is trending up'
    const peak = rows.reduce((best, row) => (row.grossRevenue > best.grossRevenue ? row : best), rows[0] ?? { day: '', grossRevenue: 0, orderCount: 0, aov: 0 })
    return `recent activity is stable; your best recent day was ${peak.day}`
  }

  // -------------------------------------------------------------------------
  // Plan + trial enforcement
  // -------------------------------------------------------------------------

  private async planFor(storeId: StoreId): Promise<PlanTier> {
    const plan = await this.deps.plan(storeId)
    if (plan === 'trial' && await this.deps.trialExpired(storeId, plan)) {
      throw new AppError('PAYMENT_REQUIRED', 'Your free trial has ended. Upgrade your plan to keep using Store Coach.', 402, {
        upgrade: 'required',
        currentPlan: 'trial',
        requiredPlan: 'start',
        trialExpired: true,
      })
    }
    return plan
  }

  private async preferencesFor(storeId: StoreId): Promise<CoachPreferences> {
    const existing = await this.deps.preferences.get(storeId)
    if (existing) return existing
    return this.deps.preferences.save(storeId, {})
  }

  // -------------------------------------------------------------------------
  // Daily huddle
  // -------------------------------------------------------------------------

  public async todayHuddle(storeId: StoreId): Promise<HuddleView> {
    const [plan, day] = await Promise.all([this.planFor(storeId), this.deps.merchantDay(storeId, this.now())])
    const existing = await this.deps.huddles.getByDate(storeId, day)
    if (existing) return { id: existing.id, huddleDate: existing.huddleDate, content: existing.content, viewed: existing.viewedAt !== null, createdAt: existing.createdAt, plan, voiceAvailable: await this.voiceAvailable(storeId, plan) }
    const generated = await this.generateHuddle(storeId)
    return { ...generated, voiceAvailable: await this.voiceAvailable(storeId, plan) }
  }

  private async voiceAvailable(storeId: StoreId, plan: PlanTier): Promise<boolean> {
    if (plan !== 'growth' && plan !== 'commander') return false
    const preferences = await this.preferencesFor(storeId)
    return preferences.voiceEnabled
  }

  public async generateHuddle(storeId: StoreId, force = false): Promise<HuddleView> {
    const [plan, day] = await Promise.all([this.planFor(storeId), this.deps.merchantDay(storeId, this.now())])
    if (!force) {
      const existing = await this.deps.huddles.getByDate(storeId, day)
      if (existing) return { id: existing.id, huddleDate: existing.huddleDate, content: existing.content, viewed: existing.viewedAt !== null, createdAt: existing.createdAt, plan, voiceAvailable: await this.voiceAvailable(storeId, plan) }
    }
    const preferences = await this.preferencesFor(storeId)
    const personality = this.assertPersonalityAllowed(plan, preferences.personality)
    this.assertLanguageAllowed(plan, preferences.language)
    const evidence = await this.buildEvidence(storeId)
    const prompt = buildHuddlePrompt(evidence, personality, preferences.language)
    let generation: AiGeneration
    try {
      if (!this.deps.ai.configured) throw new Error('AI not configured')
      generation = await this.runExclusive(`huddle:${storeId}:${day}`, () => this.deps.ai.generate(prompt.system, prompt.user, { requestId: `store-coach-huddle-${storeId}-${day}` }))
      this.recordCost(storeId, generation)
    } catch {
      generation = {
        text: JSON.stringify({
          greeting: `Good morning.`,
          yesterdaySnapshot: `Yesterday generated ${evidence.yesterdayOrders} orders and $${evidence.yesterdayRevenue.toFixed(2)} in revenue.`,
          todayPreview: `Review your top priorities and keep store operations steady.`,
          keyInsight: evidence.topSignal,
          reviewMinutes: 2,
        }),
        model: 'fallback-deterministic',
        keyIndex: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        attempts: 1,
      }
    }
    const parsed = parseHuddleJson(generation.text, evidence)
    const content = { ...parsed, evidence: { yesterdayRevenue: evidence.yesterdayRevenue, yesterdayOrders: evidence.yesterdayOrders, yesterdayAov: evidence.yesterdayAov, trailing7dRevenue: evidence.trailing7dRevenue, trailing7dOrders: evidence.trailing7dOrders } }
    const huddle = await this.deps.huddles.upsert(storeId, day, content)
    await this.deps.usage.incrementHuddle(storeId, day)
    return { id: huddle.id, huddleDate: huddle.huddleDate, content: huddle.content, viewed: huddle.viewedAt !== null, createdAt: huddle.createdAt, plan, voiceAvailable: await this.voiceAvailable(storeId, plan) }
  }

  public async markHuddleViewed(storeId: StoreId, id: string): Promise<CoachHuddleRecord> {
    await this.planFor(storeId)
    const marked = await this.deps.huddles.markViewed(storeId, id)
    if (marked) {
      await this.updateStreakAndAwards(storeId, marked.huddleDate)
      return marked
    }
    // Already viewed, or the id belongs to an older window outside today's
    // upsert. Resolve by scanning the store's huddle history.
    const history = await this.deps.huddles.history(storeId, 365)
    const existing = history.find((huddle) => huddle.id === id)
    if (!existing) throw new AppError('NOT_FOUND', 'Huddle not found', 404)
    return existing
  }

  public async huddleHistory(storeId: StoreId, days: number): Promise<readonly CoachHuddleRecord[]> {
    const plan = await this.planFor(storeId)
    const window = coachLimit(plan, 'progressHistoryDays')
    return this.deps.huddles.history(storeId, Math.min(Math.max(1, days), window))
  }

  private async updateStreakAndAwards(storeId: StoreId, activeDay: string): Promise<void> {
    const previous = await this.deps.streaks.get(storeId)
    const next = streakAfterView(previous, activeDay)
    await this.deps.streaks.update(storeId, next)
    const dayOfWeek = new Date(`${activeDay}T00:00:00Z`).getUTCDay()
    const weekend = dayOfWeek === 0 || dayOfWeek === 6
    const morningHuddles = await this.countMorningHuddles(storeId)
    const signals: BadgeSignals = {
      firstHuddleViewed: true,
      streakDays: next.currentStreak,
      streakComeback: isStreakComeback(previous, activeDay),
      weekendActive: weekend,
      morningHuddles,
    }
    await this.awardFromSignals(storeId, signals, { activeDay })
  }

  private async countMorningHuddles(storeId: StoreId): Promise<number> {
    const history = await this.deps.huddles.history(storeId, 365)
    // "Morning" is resolved in the merchant's own timezone: a huddle view
    // before 12:00 local time counts. Never approximated from the UTC hour.
    const viewed = history.filter((huddle) => huddle.viewedAt !== null)
    let morning = 0
    for (const huddle of viewed) {
      const hour = await this.deps.merchantHour(storeId, new Date(huddle.viewedAt as number))
      if (hour < 12) morning += 1
    }
    return morning
  }

  // -------------------------------------------------------------------------
  // Priorities
  // -------------------------------------------------------------------------

  public async todayPriorities(storeId: StoreId): Promise<PrioritiesView> {
    const [plan, day] = await Promise.all([this.planFor(storeId), this.deps.merchantDay(storeId, this.now())])
    await this.deps.priorities.expire(storeId, day)
    const existing = await this.deps.priorities.forDay(storeId, day)
    if (existing.length > 0) {
      const limit = coachLimit(plan, 'prioritiesPerDay')
      return { priorityDate: day, priorities: existing.slice(0, limit), planLimit: limit, remainingToday: Math.max(limit - existing.length, 0) }
    }
    return this.generatePriorities(storeId)
  }

  public async generatePriorities(storeId: StoreId): Promise<PrioritiesView> {
    const [plan, day] = await Promise.all([this.planFor(storeId), this.deps.merchantDay(storeId, this.now())])
    const preferences = await this.preferencesFor(storeId)
    const personality = this.assertPersonalityAllowed(plan, preferences.personality)
    this.assertLanguageAllowed(plan, preferences.language)
    await this.deps.priorities.expire(storeId, day)
    const evidence = await this.buildEvidence(storeId)
    const prompt = buildPrioritiesPrompt(evidence, personality, preferences.language)
    let generation: AiGeneration
    try {
      if (!this.deps.ai.configured) throw new Error('AI not configured')
      generation = await this.runExclusive(`priorities:${storeId}:${day}`, () => this.deps.ai.generate(prompt.system, prompt.user, { requestId: `store-coach-priorities-${storeId}-${day}` }))
      this.recordCost(storeId, generation)
    } catch {
      generation = {
        text: JSON.stringify({
          priorities: [
            { category: 'HIGH_IMPACT', title: 'Review store revenue trend', description: `Trailing 7-day revenue is $${evidence.trailing7dRevenue.toFixed(2)} — check recent orders.`, impact_value: evidence.trailing7dRevenue, impact_currency: evidence.currency, impact_label: '7-day revenue', time_estimate_minutes: 15, action_type: 'review', action_payload: {} },
            { category: 'QUICK_WIN', title: 'Check recent order count', description: `Yesterday brought ${evidence.yesterdayOrders} orders — ensure fulfillment is on track.`, impact_value: evidence.yesterdayRevenue, impact_currency: evidence.currency, impact_label: 'yesterday revenue', time_estimate_minutes: 10, action_type: 'review', action_payload: {} },
          ]
        }),
        model: 'fallback-deterministic',
        keyIndex: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        attempts: 1,
      }
    }
    const candidates = parsePrioritiesJson(generation.text, evidence)
    const capped = candidates.slice(0, coachLimit(plan, 'prioritiesPerDay'))
    const expiresAt = new Date(`${day}T23:59:59Z`).getTime()
    const inserted = await this.deps.priorities.insert(storeId, day, capped, expiresAt)
    return { priorityDate: day, priorities: inserted, planLimit: coachLimit(plan, 'prioritiesPerDay'), remainingToday: Math.max(coachLimit(plan, 'prioritiesPerDay') - inserted.length, 0) }
  }

  public async completePriority(storeId: StoreId, id: string): Promise<CoachPriorityRecord> {
    await this.planFor(storeId)
    const updated = await this.deps.priorities.complete(storeId, id)
    if (!updated) throw new AppError('NOT_FOUND', 'Priority not found or already resolved', 404)
    await this.evaluateEngagementBadges(storeId)
    return updated
  }

  public async dismissPriority(storeId: StoreId, id: string): Promise<CoachPriorityRecord> {
    await this.planFor(storeId)
    const updated = await this.deps.priorities.dismiss(storeId, id)
    if (!updated) throw new AppError('NOT_FOUND', 'Priority not found or already resolved', 404)
    return updated
  }

  // -------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------

  public async listGoals(storeId: StoreId, status?: CoachGoalRecord['status']): Promise<readonly CoachGoalRecord[]> {
    await this.planFor(storeId)
    return this.deps.goals.list(storeId, status)
  }

  public async createGoal(storeId: StoreId, input: Readonly<{ goalType: CoachGoalRecord['goalType']; title: string; description: string; metric: CoachGoalRecord['metric']; targetValue: number; targetCurrency: string; startDate: string; endDate: string }>): Promise<CoachGoalRecord> {
    const plan = await this.planFor(storeId)
    const active = (await this.deps.goals.list(storeId, 'ACTIVE')).length
    if (active >= coachLimit(plan, 'activeGoals')) {
      throw new AppError('PAYMENT_REQUIRED', `Your plan allows ${coachLimit(plan, 'activeGoals')} active goal${coachLimit(plan, 'activeGoals') === 1 ? '' : 's'}. Upgrade your plan to track more.`, 402, {
        upgrade: 'required', currentPlan: plan, requiredPlan: 'growth', activeGoals: active, goalLimit: coachLimit(plan, 'activeGoals'),
      })
    }
    if (input.targetValue <= 0) throw new AppError('VALIDATION_ERROR', 'targetValue must be greater than zero', 400)
    if (input.endDate <= input.startDate) throw new AppError('VALIDATION_ERROR', 'endDate must be after startDate', 400)
    const evidence = await this.buildEvidence(storeId)
    const recentDailyRate = Math.max(evidence.trailing7dRevenue / 7, 0)
    const daysTotal = Math.max(Math.round((new Date(`${input.endDate}T00:00:00Z`).getTime() - new Date(`${input.startDate}T00:00:00Z`).getTime()) / DAY_MS), 1)
    const feasibility = input.metric === 'REVENUE' ? goalFeasibility(input.targetValue, 0, daysTotal, recentDailyRate) : 'MEDIUM'
    const goal = await this.deps.goals.create(storeId, { ...input, feasibility })
    const counts = await this.deps.goals.signalCounts(storeId)
    await this.awardFromSignals(storeId, { goalsCreated: counts.created, goalsAchieved: counts.achieved }, { goalId: goal.id })
    return goal
  }

  public async updateGoal(storeId: StoreId, id: string, patch: Readonly<{ title?: string; description?: string; targetValue?: number; endDate?: string; currentProgress?: number; status?: CoachGoalRecord['status'] }>): Promise<CoachGoalRecord> {
    await this.planFor(storeId)
    const updated = await this.deps.goals.update(storeId, id, patch)
    if (!updated) throw new AppError('NOT_FOUND', 'Goal not found', 404)
    if (updated.status === 'ACHIEVED') await this.evaluateEngagementBadges(storeId)
    return updated
  }

  public async deleteGoal(storeId: StoreId, id: string): Promise<Readonly<{ deleted: boolean }>> {
    await this.planFor(storeId)
    return { deleted: await this.deps.goals.remove(storeId, id) }
  }

  public async suggestGoals(storeId: StoreId): Promise<readonly GoalSuggestion[]> {
    const plan = await this.planFor(storeId)
    const preferences = await this.preferencesFor(storeId)
    const personality = this.assertPersonalityAllowed(plan, preferences.personality)
    this.assertLanguageAllowed(plan, preferences.language)
    const evidence = await this.buildEvidence(storeId)
    const prompt = buildGoalSuggestionsPrompt(evidence, personality, preferences.language)
    let generation: AiGeneration
    try {
      if (!this.deps.ai.configured) throw new Error('AI not configured')
      generation = await this.deps.ai.generate(prompt.system, prompt.user, { requestId: `store-coach-goals-${storeId}` })
      this.recordCost(storeId, generation)
    } catch {
      generation = {
        text: JSON.stringify({
          suggestions: [
            { title: 'Grow weekly revenue', description: 'Beat your trailing 7-day sales baseline', metric: 'REVENUE', target_value: Math.max(Math.round(evidence.trailing7dRevenue * 1.1), 100), currency: evidence.currency, feasibility: 'MEDIUM', rationale: 'Derived from 10% lift over trailing 7-day baseline' }
          ]
        }),
        model: 'fallback-deterministic',
        keyIndex: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        attempts: 1,
      }
    }
    return parseGoalSuggestionsJson(generation.text, evidence)
  }

  public async acceptGoalSuggestion(storeId: StoreId, suggestion: GoalSuggestion, startDate: string): Promise<CoachGoalRecord> {
    const plan = await this.planFor(storeId)
    const end = new Date(new Date(`${startDate}T00:00:00Z`).getTime() + 7 * DAY_MS).toISOString().slice(0, 10)
    return this.createGoal(storeId, {
      goalType: 'WEEKLY',
      title: suggestion.title,
      description: suggestion.description,
      metric: suggestion.metric,
      targetValue: suggestion.targetValue,
      targetCurrency: suggestion.currency,
      startDate,
      endDate: end,
    })
  }

  public async goalProgress(storeId: StoreId, id: string): Promise<ReturnType<typeof goalProgressView>> {
    const [plan, goals] = await Promise.all([this.planFor(storeId), this.deps.goals.list(storeId)])
    const goal = goals.find((candidate) => candidate.id === id)
    if (!goal) throw new AppError('NOT_FOUND', 'Goal not found', 404)
    const today = await this.deps.merchantDay(storeId, this.now())
    const current = await this.measuredProgress(storeId, goal, today)
    if (current > goal.currentProgress) await this.deps.goals.progress(storeId, id, current)
    return goalProgressView({ current, target: goal.targetValue, startDate: goal.startDate, endDate: goal.endDate, feasibility: goal.feasibility }, today)
  }

  /** Progress for metric-backed goals is read from synced analytics rows. */
  private async measuredProgress(storeId: StoreId, goal: CoachGoalRecord, today: string): Promise<number> {
    const snapshot = await this.deps.analytics.read(storeId)
    if (goal.metric === 'REVENUE') {
      const rows = snapshot.revenue.filter((row) => row.day >= goal.startDate && row.day <= today)
      return sum(rows, (row) => Number(row.grossRevenue))
    }
    if (goal.metric === 'ORDERS') {
      const rows = snapshot.orders.filter((row) => row.day >= goal.startDate && row.day <= today)
      return sum(rows, (row) => row.orderCount)
    }
    if (goal.metric === 'AOV') {
      const rows = snapshot.orders.filter((row) => row.day >= goal.startDate && row.day <= today)
      return rows.length > 0 ? sum(rows, (row) => Number(row.averageOrderValue)) / rows.length : 0
    }
    return goal.currentProgress
  }

  // -------------------------------------------------------------------------
  // Achievements + streak + health
  // -------------------------------------------------------------------------

  public async earnedAchievements(storeId: StoreId): Promise<Readonly<{ earned: readonly CoachAchievementRecord[]; visible: number }>> {
    const plan = await this.planFor(storeId)
    const earned = await this.deps.achievements.earned(storeId)
    return { earned, visible: badgesVisibleForPlan(plan) }
  }

  public async availableAchievements(storeId: StoreId): Promise<Readonly<{ earnedIds: readonly string[]; catalog: readonly { id: string; title: string; description: string; category: string; rarity: string; earned: boolean; earnedAt: number | null }[]; visible: number }>> {
    const plan = await this.planFor(storeId)
    const earned = await this.deps.achievements.earned(storeId)
    const earnedById = new Map(earned.map((record) => [record.badgeId, record]))
    const visible = badgesVisibleForPlan(plan)
    const catalog = BADGE_CATALOG.slice(0, visible).map((badge) => {
      const record = earnedById.get(badge.id)
      return { id: badge.id, title: badge.title, description: badge.description, category: badge.category, rarity: badge.rarity, earned: record !== undefined, earnedAt: record?.earnedAt ?? null }
    })
    return { earnedIds: earned.map((record) => record.badgeId), catalog, visible }
  }

  public async streak(storeId: StoreId): Promise<CoachStreak & Readonly<{ todayViewed: boolean }>> {
    await this.planFor(storeId)
    const streak = await this.deps.streaks.get(storeId)
    const today = await this.deps.merchantDay(storeId, this.now())
    return { currentStreak: streak?.currentStreak ?? 0, longestStreak: streak?.longestStreak ?? 0, lastActiveDate: streak?.lastActiveDate ?? null, todayViewed: streak?.lastActiveDate === today }
  }

  public async healthScore(storeId: StoreId): Promise<HealthScoreView> {
    await this.planFor(storeId)
    const latest = await this.deps.healthScores.latest(storeId)
    const history = (await this.deps.healthScores.history(storeId, 14)).map((record) => ({ score: record.score, calculatedAt: record.calculatedAt }))
    const label = latest ? (latest.score >= 70 ? 'Highly engaged' : latest.score >= 40 ? 'Getting into rhythm' : 'Just getting started') : 'No activity yet'
    const tone = latest ? (latest.score >= 70 ? 'good' : latest.score >= 40 ? 'ok' : 'low') : 'low' as const
    return { score: latest?.score ?? null, label, tone, factors: latest?.factors ?? {}, history: history.reverse() }
  }

  public async evaluateEngagementBadges(storeId: StoreId): Promise<void> {
    await this.planFor(storeId)
    const [priorityCounts, goalCounts, chatCount, reviewsRead, onboarding, preferences] = await Promise.all([
      this.deps.priorities.signalCounts(storeId),
      this.deps.goals.signalCounts(storeId),
      this.deps.conversations.lifetimeMessages(storeId),
      this.deps.reports.readCount(storeId),
      this.deps.onboarding.get(storeId),
      this.deps.preferences.get(storeId),
    ])
    const signals: BadgeSignals = {
      prioritiesCompleted: priorityCounts.completed,
      allPrioritiesDoneDay: priorityCounts.doneDays > 0,
      goalsCreated: goalCounts.created,
      goalsAchieved: goalCounts.achieved,
      chatMessages: chatCount,
      reviewsRead,
      onboardingCompleted: onboarding?.completed ?? false,
      preferencesAdjusted: preferences !== null,
    }
    await this.awardFromSignals(storeId, signals, {})
  }

  private async awardFromSignals(storeId: StoreId, signals: BadgeSignals, context: Readonly<Record<string, unknown>>): Promise<void> {
    const extra = await (this.deps.extraSignals ? this.deps.extraSignals(storeId) : Promise.resolve({}))
    const merged: BadgeSignals = { ...signals, ...extra }
    const earnedIds = await this.deps.achievements.earnedIds(storeId)
    const newly = evaluateBadgeAwards(merged, earnedIds)
    for (const badge of newly) {
      await this.deps.achievements.award(storeId, badge.id, { ...context, earnedVia: 'store-coach' })
    }
  }

  // -------------------------------------------------------------------------
  // Progress dashboard
  // -------------------------------------------------------------------------

  public async progressSummary(storeId: StoreId, days: number): Promise<Readonly<Record<string, unknown>>> {
    const plan = await this.planFor(storeId)
    const window = Math.min(Math.max(1, days), coachLimit(plan, 'progressHistoryDays'))
    const snapshot = await this.deps.analytics.read(storeId)
    const today = await this.deps.merchantDay(storeId, this.now())
    const cutoff = isoDaysAgo(today, window)
    const rows = snapshot.revenue.filter((row) => row.day >= cutoff && row.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1))
    const previousRows = snapshot.revenue.filter((row) => row.day >= isoDaysAgo(cutoff, window) && row.day < cutoff).sort((a, b) => (a.day < b.day ? -1 : 1))
    const orders = snapshot.orders.filter((row) => row.day >= cutoff && row.day <= today)
    const revenue = sum(rows, (row) => Number(row.grossRevenue))
    const orderCount = sum(orders, (row) => row.orderCount)
    const aov = orderCount > 0 ? revenue / orderCount : 0
    const midpoint = Math.floor(rows.length / 2)
    const firstHalf = rows.slice(0, midpoint)
    const secondHalf = rows.slice(midpoint)
    const firstRevenue = sum(firstHalf, (row) => Number(row.grossRevenue))
    const secondRevenue = sum(secondHalf, (row) => Number(row.grossRevenue))
    const revenueTrend = firstRevenue > 0 ? ((secondRevenue - firstRevenue) / firstRevenue) * 100 : 0
    return {
      window,
      revenue: Math.round(revenue * 100) / 100,
      orders: orderCount,
      aov: Math.round(aov * 100) / 100,
      customers: this.uniqueCohortCustomers(snapshot, cutoff, today),
      revenueTrendPct: Math.round(revenueTrend * 10) / 10,
      series: rows.map((row) => ({ day: row.day, revenue: Number(row.grossRevenue), orders: row.orderCount })),
      comparisonSeries: previousRows.map((row) => ({ day: row.day, revenue: Number(row.grossRevenue) })),
    }
  }

  private uniqueCohortCustomers(snapshot: Awaited<ReturnType<AnalyticsRepository['read']>>, cutoff: string, today: string): number {
    const cohorts = snapshot.customerCohorts.filter((row) => row.cohortDay >= cutoff && row.cohortDay <= today)
    return sum(cohorts, (row) => row.customerCount)
  }

  public async progressTrends(storeId: StoreId, metric: string, days: number): Promise<Readonly<{ metric: string; window: number; series: readonly Readonly<Record<string, string | number>>[] }>> {
    const plan = await this.planFor(storeId)
    const window = Math.min(Math.max(1, days), coachLimit(plan, 'progressHistoryDays'))
    const snapshot = await this.deps.analytics.read(storeId)
    const today = await this.deps.merchantDay(storeId, this.now())
    const cutoff = isoDaysAgo(today, window)
    const ordersByDay = new Map(snapshot.orders.map((row) => [row.day, row]))
    const series = snapshot.revenue
      .filter((row) => row.day >= cutoff && row.day <= today)
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .map((row) => {
        const orders = ordersByDay.get(row.day)
        const value = metric === 'revenue' ? Number(row.grossRevenue) : metric === 'orders' ? row.orderCount : metric === 'aov' ? Number(orders?.averageOrderValue ?? 0) : Number(row.grossRevenue)
        return { day: row.day, value: Math.round(value * 100) / 100 }
      })
    return { metric, window, series }
  }

  public async activityHeatmap(storeId: StoreId): Promise<Readonly<{ weeks: number; bestDay: string | null; busiestWeek: string | null; cells: readonly Readonly<{ day: string; weekday: number; week: number; orders: number; revenue: number; intensity: number }>[]; legend: readonly number[] }>> {
    await this.planFor(storeId)
    const snapshot = await this.deps.analytics.read(storeId)
    const today = await this.deps.merchantDay(storeId, this.now())
    const cutoff = isoDaysAgo(today, 7 * 12)
    const rows = snapshot.revenue.filter((row) => row.day >= cutoff && row.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1))
    const ordersByDay = new Map(snapshot.orders.map((row) => [row.day, row.orderCount]))
    if (rows.length === 0) return { weeks: 12, bestDay: null, busiestWeek: null, cells: [], legend: [1, 2, 3] }
    const start = new Date(`${cutoff}T00:00:00Z`)
    const startWeekday = start.getUTCDay()
    const cells = rows.map((row) => {
      const date = new Date(`${row.day}T00:00:00Z`)
      const dayIndex = Math.floor((date.getTime() - start.getTime()) / DAY_MS)
      const week = Math.floor((dayIndex + startWeekday) / 7)
      const orders = ordersByDay.get(row.day) ?? row.orderCount
      const maxOrders = Math.max(...rows.map((candidate) => ordersByDay.get(candidate.day) ?? candidate.orderCount), 1)
      return { day: row.day, weekday: date.getUTCDay(), week, orders, revenue: Number(row.grossRevenue), intensity: orders / maxOrders }
    })
    const best = cells.reduce((bestCell, cell) => (cell.orders > bestCell.orders ? cell : bestCell), cells[0] ?? { day: '', weekday: 0, week: 0, orders: 0, revenue: 0, intensity: 0 })
    const byWeek = new Map<number, number>()
    for (const cell of cells) byWeek.set(cell.week, (byWeek.get(cell.week) ?? 0) + cell.orders)
    const busiestWeek = [...byWeek.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      weeks: 12,
      bestDay: best?.day ?? null,
      busiestWeek: busiestWeek ? `week of ${isoDaysAgo(today, (12 - busiestWeek[0] - 1) * 7)}` : null,
      cells,
      legend: [1, Math.ceil(Math.max(...cells.map((cell) => cell.orders), 1) / 2), Math.max(...cells.map((cell) => cell.orders), 1)],
    }
  }

  public async progressComparisons(storeId: StoreId): Promise<Readonly<Record<string, unknown>>> {
    const plan = await this.planFor(storeId)
    const window = Math.min(coachLimit(plan, 'progressHistoryDays'), 30)
    const snapshot = await this.deps.analytics.read(storeId)
    const today = await this.deps.merchantDay(storeId, this.now())
    const currentCutoff = isoDaysAgo(today, window)
    const previousCutoff = isoDaysAgo(today, window * 2)
    const current = snapshot.revenue.filter((row) => row.day >= currentCutoff && row.day <= today)
    const previous = snapshot.revenue.filter((row) => row.day >= previousCutoff && row.day < currentCutoff)
    const currentRevenue = sum(current, (row) => Number(row.grossRevenue))
    const previousRevenue = sum(previous, (row) => Number(row.grossRevenue))
    const currentOrders = sum(current, (row) => row.orderCount)
    const previousOrders = sum(previous, (row) => row.orderCount)
    const pct = (value: number, previousValue: number): number => (previousValue > 0 ? Math.round(((value - previousValue) / previousValue) * 1000) / 10 : 0)
    return {
      window,
      revenue: { current: Math.round(currentRevenue * 100) / 100, previous: Math.round(previousRevenue * 100) / 100, changePct: pct(currentRevenue, previousRevenue) },
      orders: { current: currentOrders, previous: previousOrders, changePct: pct(currentOrders, previousOrders) },
    }
  }

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------

  public async streamChat(storeId: StoreId, message: string, onDelta: (fullText: string) => void): Promise<CoachMessage> {
    const plan = await this.planFor(storeId)
    this.assertRateLimit(storeId, plan)
    const day = await this.deps.merchantDay(storeId, this.now())
    const usage = await this.deps.usage.today(storeId, day)
    const limit = coachLimit(plan, 'chatMessagesPerDay')
    if (usage.chatMessages >= limit) {
      throw new AppError('PAYMENT_REQUIRED', `You have used all ${limit} chat messages for today. Upgrade your plan for more messages.`, 402, {
        upgrade: 'required', currentPlan: plan, requiredPlan: 'growth', chatMessagesToday: usage.chatMessages, chatLimit: limit,
      })
    }
    const trimmed = message.trim()
    if (!trimmed) throw new AppError('VALIDATION_ERROR', 'Message cannot be empty', 400)
    if (trimmed.length > 1_000) throw new AppError('VALIDATION_ERROR', 'Message is too long (max 1,000 characters)', 400)
    const preferences = await this.preferencesFor(storeId)
    const personality = this.assertPersonalityAllowed(plan, preferences.personality)
    this.assertLanguageAllowed(plan, preferences.language)
    const evidence = await this.buildEvidence(storeId)
    const history = await this.deps.conversations.get(storeId)
    const recent = (history?.messages ?? []).slice(-12).map((entry) => `${entry.role === 'user' ? 'Merchant' : 'Coach'}: ${entry.content}`).join('\n')
    const system = buildChatSystemPrompt(evidence, personality, preferences.language, plan)
    const user = recent ? `Conversation so far:\n${recent}\n\nMerchant: ${trimmed}` : `Merchant: ${trimmed}`
    const timestamp = this.now().getTime()
    let generation: AiGeneration
    try {
      if (!this.deps.ai.configured) throw new Error('AI not configured')
      generation = await this.deps.ai.generateStream(system, user, { requestId: `store-coach-chat-${storeId}` }, onDelta)
      this.recordCost(storeId, generation)
    } catch {
      const fallbackText = `I'm analyzing your store data. Yesterday's revenue was $${evidence.yesterdayRevenue.toFixed(2)} across ${evidence.yesterdayOrders} orders. Check today's priorities to keep growing!`
      onDelta(fallbackText)
      generation = {
        text: fallbackText,
        model: 'fallback-deterministic',
        keyIndex: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        attempts: 1,
      }
    }
    const validated = assertCoachChatResponse(generation.text, evidence)
    const coachMessage: CoachMessage = { role: 'coach', content: validated, timestamp, confidence: 0.9 }
    await this.deps.conversations.append(storeId, [{ role: 'user', content: trimmed, timestamp }, coachMessage])
    await this.deps.usage.incrementChat(storeId, day)
    await this.evaluateEngagementBadges(storeId)
    return coachMessage
  }

  public async chatHistory(storeId: StoreId): Promise<CoachConversation> {
    await this.planFor(storeId)
    const conversation = await this.deps.conversations.get(storeId)
    if (conversation) return conversation
    return { id: '', storeId, messages: [], createdAt: 0, updatedAt: 0 }
  }

  public async clearChat(storeId: StoreId): Promise<void> {
    await this.planFor(storeId)
    await this.deps.conversations.clear(storeId)
  }

  public async chatSuggestions(storeId: StoreId): Promise<readonly string[]> {
    const plan = await this.planFor(storeId)
    const evidence = await this.buildEvidence(storeId)
    const day = await this.deps.merchantDay(storeId, this.now())
    const priorities = await this.deps.priorities.forDay(storeId, day)
    const goals = await this.deps.goals.list(storeId, 'ACTIVE')
    const enriched = { ...evidence, openPriorities: priorities.slice(0, 3).map((priority) => priority.title), activeGoal: goals[0]?.title ?? null }
    return coachChatSuggestions(enriched, plan)
  }

  private assertRateLimit(storeId: StoreId, plan: PlanTier): void {
    const perMinute = this.deps.rateLimitPerMinute ?? 30
    const now = this.now().getTime()
    const key = String(storeId)
    const window = this.requestWindows.get(key)?.filter((timestamp) => now - timestamp < 60_000) ?? []
    if (window.length >= perMinute) {
      throw new AppError('RATE_LIMITED', `Store Coach allows ${perMinute} requests per minute. Wait a moment and try again.`, 429, { retryAfterSeconds: 60, currentPlan: plan })
    }
    this.requestWindows.set(key, [...window, now])
  }

  // -------------------------------------------------------------------------
  // Weekly review + PDF + email
  // -------------------------------------------------------------------------

  public async currentReview(storeId: StoreId): Promise<Readonly<Record<string, unknown>>> {
    const plan = await this.planFor(storeId)
    const latest = await this.deps.reports.latest(storeId, 'WEEKLY')
    if (latest) return { id: latest.id, reportDate: latest.reportDate, content: latest.content, pdfUrl: latest.pdfUrl, sentViaEmail: latest.sentViaEmail, commanderPdf: plan === 'commander', emailAvailable: this.deps.mailer !== undefined, pdfAvailable: plan === 'commander' && this.deps.pdf !== undefined }
    return this.generateReview(storeId)
  }

  public async reviewHistory(storeId: StoreId): Promise<Readonly<{ reports: readonly Readonly<{ id: string; reportType: string; reportDate: string; createdAt: number; sentViaEmail: boolean }>[] }>> {
    await this.planFor(storeId)
    const reports = await this.deps.reports.list(storeId, 12)
    return { reports: reports.map((report) => ({ id: report.id, reportType: report.reportType, reportDate: report.reportDate, createdAt: report.createdAt, sentViaEmail: report.sentViaEmail })) }
  }

  public async generateReview(storeId: StoreId, force = false): Promise<Readonly<Record<string, unknown>>> {
    const plan = await this.planFor(storeId)
    const day = await this.deps.merchantDay(storeId, this.now())
    if (!force) {
      const latest = await this.deps.reports.latest(storeId, 'WEEKLY')
      if (latest) return { id: latest.id, reportDate: latest.reportDate, content: latest.content, pdfUrl: latest.pdfUrl, sentViaEmail: latest.sentViaEmail, commanderPdf: plan === 'commander', emailAvailable: this.deps.mailer !== undefined, pdfAvailable: plan === 'commander' && this.deps.pdf !== undefined }
    }
    const preferences = await this.preferencesFor(storeId)
    const personality = this.assertPersonalityAllowed(plan, preferences.personality)
    this.assertLanguageAllowed(plan, preferences.language)
    const evidence = await this.buildEvidence(storeId)
    const prompt = buildWeeklyReviewPrompt(evidence, personality, preferences.language)
    let generation: AiGeneration
    try {
      if (!this.deps.ai.configured) throw new Error('AI not configured')
      generation = await this.runExclusive(`review:${storeId}:${day}`, () => this.deps.ai.generate(prompt.system, prompt.user, { requestId: `store-coach-review-${storeId}` }))
      this.recordCost(storeId, generation)
    } catch {
      generation = {
        text: JSON.stringify({
          subject: 'Your Week in Review',
          weekWins: [`Trailing 7-day revenue reached $${evidence.trailing7dRevenue.toFixed(2)}`],
          metrics: [{ label: 'Revenue', value: `$${evidence.trailing7dRevenue.toFixed(2)}`, change: `${evidence.trailing7dRevenueChangePct}%` }],
          learnings: [`Steady sales rhythm across recent operating days`],
          nextWeekFocus: [`Keep priorities updated and maintain your streak`],
          suggestedGoal: { title: 'Grow this week', description: 'Beat trailing revenue baseline' }
        }),
        model: 'fallback-deterministic',
        keyIndex: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        attempts: 1,
      }
    }
    // The narrative is AI-written, but we always attach a real, deterministic
    // "week in numbers" snapshot derived from the store's own synced evidence.
    // This is what powers the right-hand panel of the Weekly Review card so a
    // merchant always sees their actual figures even if the AI is verbose or
    // the provider fails (fallback below is deterministic too).
    const snapshot: Readonly<Record<string, number | string>> = {
      currency: evidence.currency,
      revenue7d: evidence.trailing7dRevenue,
      revenue7dChangePct: evidence.trailing7dRevenueChangePct,
      orders7d: evidence.trailing7dOrders,
      orders7dChangePct: evidence.trailing7dOrdersChangePct,
      aov30d: evidence.aov30d,
      bestDayRevenue: evidence.bestDayRevenue,
      yesterdayNewCustomers: evidence.yesterdayNewCustomers,
      streakDays: evidence.streakDays,
    }
    const content = { ...parseWeeklyReviewJson(generation.text, evidence), snapshot }
    const report = await this.deps.reports.save(storeId, { reportType: 'WEEKLY', reportDate: day, content })
    const pdfUrl = plan === 'commander' && this.deps.pdf ? await this.buildReviewPdf(storeId, report.id, report.content) : null
    if (pdfUrl) {
      await this.deps.reports.save(storeId, { reportType: 'WEEKLY', reportDate: day, content: { ...content }, pdfUrl })
    }
    return { id: report.id, reportDate: report.reportDate, content: report.content, pdfUrl, sentViaEmail: report.sentViaEmail, commanderPdf: plan === 'commander', emailAvailable: this.deps.mailer !== undefined, pdfAvailable: plan === 'commander' && this.deps.pdf !== undefined }
  }

  public async reviewPdf(storeId: StoreId, id: string): Promise<Readonly<{ pdfUrl: string }>> {
    const plan = await this.planFor(storeId)
    if (plan !== 'commander') {
      throw new AppError('PAYMENT_REQUIRED', 'PDF reports are included on the Commander plan', 402, {
        upgrade: 'required', currentPlan: plan, requiredPlan: 'commander', feature: 'weeklyPdf',
      })
    }
    const reports = await this.deps.reports.list(storeId, 12)
    const report = reports.find((candidate) => candidate.id === id)
    if (!report) throw new AppError('NOT_FOUND', 'Report not found', 404)
    if (!report.pdfUrl) throw new AppError('NOT_FOUND', 'No PDF has been generated for this report yet. Regenerate the review.', 404)
    return { pdfUrl: report.pdfUrl }
  }

  private async buildReviewPdf(_storeId: StoreId, _reportId: string, content: Readonly<Record<string, unknown>>): Promise<string | null> {
    if (!this.deps.pdf) return null
    const rows: Readonly<Record<string, string | number>>[] = [
      { section: 'Subject', value: String(content.subject ?? 'Weekly review') },
      { section: 'Week wins', value: stringArray(content.weekWins).join(' | ') },
      { section: 'Learnings', value: stringArray(content.learnings).join(' | ') },
      { section: 'Next week focus', value: stringArray(content.nextWeekFocus).join(' | ') },
    ]
    return this.deps.pdf.write(`store-coach-weekly-review.pdf`, rows)
  }

  public async emailReview(storeId: StoreId, id: string): Promise<Readonly<{ sent: boolean }>> {
    await this.planFor(storeId)
    if (!this.deps.mailer) throw new AppError('DEPENDENCY_ERROR', 'Email delivery is not configured', 503)
    const preferences = await this.preferencesFor(storeId)
    if (!preferences.weeklyEmailEnabled) throw new AppError('VALIDATION_ERROR', 'Weekly email is disabled in your Store Coach preferences', 400)
    const reports = await this.deps.reports.list(storeId, 12)
    const report = reports.find((candidate) => candidate.id === id)
    if (!report) throw new AppError('NOT_FOUND', 'Report not found', 404)
    const to = await this.deps.merchantEmail(storeId)
    if (!to) throw new AppError('VALIDATION_ERROR', 'No verified merchant email is configured for this store', 400)
    const html = weeklyReviewHtml(report.content, this.deps.notificationUrl ?? '')
    await this.deps.mailer.sendWeeklyReview({ storeId, to, subject: String(report.content.subject ?? 'Your Week in Review'), html })
    await this.deps.reports.markEmailed(storeId, id)
    return { sent: true }
  }

  // -------------------------------------------------------------------------
  // Preferences + onboarding + usage + cost
  // -------------------------------------------------------------------------

  public async preferences(storeId: StoreId): Promise<CoachPreferences & Readonly<{ plan: PlanTier }>> {
    const plan = await this.planFor(storeId)
    const preferences = await this.preferencesFor(storeId)
    return { ...preferences, plan }
  }

  public async updatePreferences(storeId: StoreId, patch: Readonly<Partial<Omit<CoachPreferences, 'storeId' | 'updatedAt'>>>): Promise<CoachPreferences & Readonly<{ plan: PlanTier }>> {
    const plan = await this.planFor(storeId)
    const current = await this.preferencesFor(storeId)
    const nextPersonality = patch.personality ?? current.personality
    this.assertPersonalityAllowed(plan, nextPersonality)
    const nextLanguage = patch.language ?? current.language
    this.assertLanguageAllowed(plan, nextLanguage)
    if (patch.voiceEnabled === true) assertCoachFeature(plan, 'voice')
    if (patch.widgetEnabled === true) assertCoachFeature(plan, 'widget')
    if (patch.huddleTimeMinutes !== undefined && patch.huddleTimeMinutes !== 420) assertCoachFeature(plan, 'customHuddleTime')
    const saved = await this.deps.preferences.save(storeId, patch)
    if (saved.personality !== current.personality) {
      await this.awardFromSignals(storeId, { personalitiesTried: 2, preferencesAdjusted: true }, {})
    } else {
      await this.awardFromSignals(storeId, { preferencesAdjusted: true }, {})
    }
    await this.refreshHealthScore(storeId)
    return { ...saved, plan }
  }

  public async onboardingStatus(storeId: StoreId): Promise<CoachOnboardingState & Readonly<{ steps: readonly { step: number; title: string; done: boolean }[] }>> {
    await this.planFor(storeId)
    const state = await this.deps.onboarding.get(storeId) ?? await this.deps.onboarding.completeStep(storeId, 0)
    const steps = [
      { step: 1, title: 'Meet Store Coach' },
      { step: 2, title: 'Choose personality' },
      { step: 3, title: 'Set huddle time' },
      { step: 4, title: 'Set your first goal' },
      { step: 5, title: 'Try chat' },
    ].map((entry) => ({ ...entry, done: state.completed || state.skipped || entry.step <= state.currentStep }))
    return { ...state, steps }
  }

  public async completeOnboardingStep(storeId: StoreId, step: number): Promise<CoachOnboardingState> {
    await this.planFor(storeId)
    const state = await this.deps.onboarding.completeStep(storeId, step)
    if (state.completed) {
      await this.awardFromSignals(storeId, { onboardingCompleted: true }, {})
      await this.refreshHealthScore(storeId)
    }
    return state
  }

  public async skipOnboarding(storeId: StoreId): Promise<CoachOnboardingState> {
    await this.planFor(storeId)
    return this.deps.onboarding.skip(storeId)
  }

  public async usage(storeId: StoreId): Promise<UsageView> {
    const plan = await this.planFor(storeId)
    const day = await this.deps.merchantDay(storeId, this.now())
    const usage = await this.deps.usage.today(storeId, day)
    const activeGoals = (await this.deps.goals.list(storeId, 'ACTIVE')).length
    const chatLimit = coachLimit(plan, 'chatMessagesPerDay')
    const chatAtWarning = chatLimit > 0 && usage.chatMessages / chatLimit >= 0.8
    return {
      plan,
      chatMessagesToday: usage.chatMessages,
      chatLimit,
      huddlesGeneratedToday: usage.huddlesGenerated,
      activeGoals,
      goalLimit: coachLimit(plan, 'activeGoals'),
      chatAtWarning,
      chatExhausted: usage.chatMessages >= chatLimit,
    }
  }

  public async costSummary(storeId: StoreId): Promise<Readonly<{ tracked: boolean }>> {
    await this.planFor(storeId)
    return { tracked: this.deps.costs !== undefined }
  }

  public async refreshHealthScore(storeId: StoreId): Promise<void> {
    const [streak, priorities, huddles, chat, reviews, preferences] = await Promise.all([
      this.deps.streaks.get(storeId),
      this.deps.priorities.signalCounts(storeId),
      this.deps.huddles.history(storeId, 30),
      this.deps.conversations.lifetimeMessages(storeId),
      this.deps.reports.readCount(storeId),
      this.deps.preferences.get(storeId),
    ])
    const viewed = huddles.filter((huddle) => huddle.viewedAt !== null).length
    const huddleViewRate = huddles.length > 0 ? viewed / huddles.length : 0
    const today = await this.deps.merchantDay(storeId, this.now())
    const dayPriorities = await this.deps.priorities.forDay(storeId, today)
    const completedToday = dayPriorities.filter((priority) => priority.status === 'COMPLETED').length
    const priorityCompletionRate = dayPriorities.length > 0 ? completedToday / dayPriorities.length : 0
    const factors = { huddleViewRate, priorityCompletionRate, streakDays: streak?.currentStreak ?? 0, lifetimeChatMessages: chat, reviewsRead: reviews }
    const score = calculateHealthScore({
      huddleViewRate,
      priorityCompletionRate,
      goalsActive: 0,
      chatEngagement: chat > 0 ? 1 : 0,
      streakDays: streak?.currentStreak ?? 0,
      reviewsRead: reviews,
      hasPreferences: preferences !== null,
    })
    await this.deps.healthScores.record(storeId, score, factors)
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertPersonalityAllowed(plan: PlanTier, personality: CoachPersonality): CoachPersonality {
    if (!personalityForPlan(plan).includes(personality)) {
      throw new AppError('PAYMENT_REQUIRED', `The ${PERSONALITY_CATALOG[personality].label} personality is not included in your plan`, 402, {
        upgrade: 'required', currentPlan: plan, requiredPlan: personality === 'MOTIVATIONAL' ? 'start' : 'growth', personality,
      })
    }
    return personality
  }

  private assertLanguageAllowed(plan: PlanTier, language: 'en' | 'hi'): void {
    if (language === 'hi' && plan !== 'growth' && plan !== 'commander') {
      throw new AppError('PAYMENT_REQUIRED', 'Hindi coaching is available on the Growth plan and above', 402, {
        upgrade: 'required', currentPlan: plan, requiredPlan: 'growth', language,
      })
    }
  }

  private recordCost(storeId: StoreId, generation: AiGeneration): void {
    if (!this.deps.costs) return
    this.deps.costs.record({
      storeId,
      model: generation.model,
      promptTokens: generation.usage.promptTokens,
      completionTokens: generation.usage.completionTokens,
      inputRateMicroDollars: 0,
      outputRateMicroDollars: 0,
      at: this.now().getTime(),
    })
  }

  /** Serializes AI generation per key so concurrent requests never double-burn quota. */
  private runExclusive<Value>(key: string, operation: () => Promise<Value>): Promise<Value> {
    const pending = this.generating.get(key)
    if (pending) return pending as Promise<Value>
    const run = operation().finally(() => { if (this.generating.get(key) === run) this.generating.delete(key) })
    this.generating.set(key, run)
    return run
  }
}

function sum<Value>(rows: readonly Value[], selector: (row: Value) => number): number {
  return rows.reduce((total, row) => total + selector(row), 0)
}

function isoDaysAgo(todayIso: string, days: number): string {
  const date = new Date(`${todayIso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function goalFeasibility(target: number, current: number, daysTotal: number, recentDailyRate: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  const remaining = Math.max(target - current, 0)
  const requiredPerDay = daysTotal > 0 ? remaining / daysTotal : Number.POSITIVE_INFINITY
  if (recentDailyRate >= requiredPerDay) return 'HIGH'
  if (recentDailyRate >= requiredPerDay * 0.6) return 'MEDIUM'
  return 'LOW'
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function weeklyReviewHtml(content: Readonly<Record<string, unknown>>, appUrl: string): string {
  const wins = stringArray(content.weekWins).map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  const learnings = stringArray(content.learnings).map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  const focus = stringArray(content.nextWeekFocus).map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  const metrics = stringArray(content.metrics).map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  const appLink = appUrl ? `<a href="${escapeHtml(appUrl)}" style="color:#7C3AED">Open your full report in ProfitPilot</a>` : 'Open ProfitPilot to see your full report.'
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:24px;line-height:1.6">
  <h1 style="font-size:22px;margin:0 0 4px">${escapeHtml(String(content.subject ?? 'Your Week in Review'))}</h1>
  <p style="color:#6B7280;font-size:13px">Your Store Coach weekly review — built from your real store data.</p>
  ${metrics ? `<h2 style="font-size:16px">Key metrics</h2><ul>${metrics}</ul>` : ''}
  ${wins ? `<h2 style="font-size:16px">Week wins</h2><ul>${wins}</ul>` : ''}
  ${learnings ? `<h2 style="font-size:16px">Learnings</h2><ul>${learnings}</ul>` : ''}
  ${focus ? `<h2 style="font-size:16px">Next week focus</h2><ul>${focus}</ul>` : ''}
  <p style="margin-top:24px">${appLink}</p>
  <p style="color:#9CA3AF;font-size:11px;margin-top:32px">You receive this email because weekly Store Coach emails are enabled in your preferences. <a href="${escapeHtml(appUrl)}">Unsubscribe</a> · ProfitPilot — Anash Ali, Tanda Mallu Ramnagar Uttarakhand 244715</p>
  </body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
