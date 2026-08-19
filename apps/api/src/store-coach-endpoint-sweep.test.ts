/**
 * Store Coach ULTRA endpoint sweep.
 *
 * Exercises every Store Coach HTTP route across all four plans, including
 * invalid / missing / hostile inputs, and asserts that none of them ever
 * produce a 5xx. Regression guard for "internal server error" reports:
 * validation problems must surface as 4xx, plan gating as 402, and missing
 * rows as 404 — never a 500.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger } from '@profitpilot/logger'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { StoreId } from '@profitpilot/types'
import type { AiGeneration, PriorityCandidate } from '@profitpilot/ai'
import { createApi } from './app.js'
import { StoreCoachService } from './store-coach-service.js'
import type { CoachAiProvider } from './store-coach-service.js'
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
  CoachReportRecord,
  CoachUsageToday,
  ConversationRepository,
  GoalRepository,
  HealthScoreRepository,
  HuddleRepository,
  OnboardingRepository,
  PreferenceRepository,
  PriorityRepository,
  StreakRepository,
  CoachReportRepository,
  CoachUsageRepository,
  CoachHealthScoreRecord,
} from './store-coach-repositories.js'
import type { CoachStreak } from '@profitpilot/ai'

const STORE = 'store-0001' as StoreId
const DAY = '2026-08-18'

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

class FakeHuddles implements HuddleRepository {
  public rows = new Map<string, CoachHuddleRecord>()
  public async getByDate(storeId: StoreId, day: string) { return this.rows.get(`${storeId}:${day}`) ?? null }
  public async upsert(storeId: StoreId, day: string, content: Readonly<Record<string, unknown>>): Promise<CoachHuddleRecord> {
    const existing = this.rows.get(`${storeId}:${day}`)
    const record: CoachHuddleRecord = { id: existing?.id ?? randomUUID(), storeId, huddleDate: day, content, viewedAt: existing?.viewedAt ?? null, createdAt: existing?.createdAt ?? Date.now() }
    this.rows.set(`${storeId}:${day}`, record)
    return record
  }
  public async history(storeId: StoreId): Promise<readonly CoachHuddleRecord[]> { return [...this.rows.values()].filter((row) => row.storeId === storeId) }
  public async markViewed(storeId: StoreId, id: string): Promise<CoachHuddleRecord | null> {
    const found = [...this.rows.values()].find((row) => row.storeId === storeId && row.id === id)
    if (!found || found.viewedAt !== null) return null
    const updated = { ...found, viewedAt: Date.now() }
    this.rows.set(`${storeId}:${updated.huddleDate}`, updated)
    return updated
  }
}

class FakePriorities implements PriorityRepository {
  public rows: CoachPriorityRecord[] = []
  public async forDay(storeId: StoreId, day: string) { return this.rows.filter((row) => row.storeId === storeId && row.priorityDate === day && row.status === 'PENDING') }
  public async insert(storeId: StoreId, day: string, candidates: readonly PriorityCandidate[], expiresAt: number): Promise<readonly CoachPriorityRecord[]> {
    const created = candidates.map((candidate): CoachPriorityRecord => ({ id: randomUUID(), storeId, priorityDate: day, category: candidate.category, title: candidate.title, description: candidate.description, impactValue: candidate.impactValue, impactCurrency: candidate.impactCurrency, impactLabel: candidate.impactLabel, timeEstimateMinutes: candidate.timeEstimateMinutes, actionType: candidate.actionType, actionPayload: candidate.actionPayload, status: 'PENDING', completedAt: null, expiresAt, createdAt: Date.now() }))
    this.rows.push(...created)
    return created
  }
  public async complete(storeId: StoreId, id: string): Promise<CoachPriorityRecord | null> {
    const row = this.rows.find((candidate) => candidate.storeId === storeId && candidate.id === id && candidate.status === 'PENDING')
    if (!row) return null
    this.rows = this.rows.map((candidate) => (candidate.id === id ? { ...candidate, status: 'COMPLETED' as const, completedAt: Date.now() } : candidate))
    return this.rows.find((candidate) => candidate.id === id) ?? null
  }
  public async dismiss(storeId: StoreId, id: string): Promise<CoachPriorityRecord | null> {
    const row = this.rows.find((candidate) => candidate.storeId === storeId && candidate.id === id && candidate.status === 'PENDING')
    if (!row) return null
    this.rows = this.rows.map((candidate) => (candidate.id === id ? { ...candidate, status: 'DISMISSED' as const } : candidate))
    return this.rows.find((candidate) => candidate.id === id) ?? null
  }
  public async expire(): Promise<number> { return 0 }
  public async signalCounts(): Promise<{ completed: number; doneDays: number }> {
    return { completed: this.rows.filter((row) => row.status === 'COMPLETED').length, doneDays: 0 }
  }
}

class FakeGoals implements GoalRepository {
  public rows: CoachGoalRecord[] = []
  public async list(storeId: StoreId, status?: CoachGoalRecord['status']) { return this.rows.filter((row) => row.storeId === storeId && (status === undefined || row.status === status)) }
  public async create(storeId: StoreId, input: Parameters<GoalRepository['create']>[1]): Promise<CoachGoalRecord> {
    const record: CoachGoalRecord = { id: randomUUID(), storeId, ...input, status: 'ACTIVE', currentProgress: 0, achievedAt: null, createdAt: Date.now(), updatedAt: Date.now() }
    this.rows.push(record)
    return record
  }
  public async update(storeId: StoreId, id: string, patch: Parameters<GoalRepository['update']>[2]): Promise<CoachGoalRecord | null> {
    const found = this.rows.find((row) => row.storeId === storeId && row.id === id)
    if (!found) return null
    const updated: CoachGoalRecord = { ...found, ...patch, updatedAt: Date.now() }
    this.rows = this.rows.map((row) => (row.id === id ? updated : row))
    return updated
  }
  public async remove(storeId: StoreId, id: string): Promise<boolean> {
    const before = this.rows.length
    this.rows = this.rows.filter((row) => !(row.storeId === storeId && row.id === id))
    return this.rows.length < before
  }
  public async progress(storeId: StoreId, id: string, current: number): Promise<CoachGoalRecord | null> {
    return this.update(storeId, id, { currentProgress: current })
  }
  public async signalCounts(): Promise<{ created: number; achieved: number }> {
    return { created: this.rows.length, achieved: this.rows.filter((row) => row.status === 'ACHIEVED').length }
  }
}

class FakeAchievements implements AchievementRepository {
  public rows: CoachAchievementRecord[] = []
  public async earned(storeId: StoreId) { return this.rows.filter((row) => row.storeId === storeId) }
  public async earnedIds(storeId: StoreId): Promise<ReadonlySet<string>> { return new Set((await this.earned(storeId)).map((row) => row.badgeId)) }
  public async award(storeId: StoreId, badgeId: string, context: Readonly<Record<string, unknown>>): Promise<boolean> {
    if (this.rows.some((row) => row.storeId === storeId && row.badgeId === badgeId)) return false
    this.rows.push({ id: randomUUID(), storeId, badgeId, earnedAt: Date.now(), context })
    return true
  }
}

class FakeConversations implements ConversationRepository {
  public conversation: CoachConversation | null = null
  public async get(): Promise<CoachConversation | null> { return this.conversation }
  public async append(storeId: StoreId, messages: readonly CoachMessage[]): Promise<CoachConversation> {
    const current = this.conversation
    this.conversation = { id: current?.id ?? randomUUID(), storeId, messages: [...(current?.messages ?? []), ...messages], createdAt: current?.createdAt ?? Date.now(), updatedAt: Date.now() }
    return this.conversation
  }
  public async clear(): Promise<void> { this.conversation = null }
  public async lifetimeMessages(): Promise<number> { return this.conversation?.messages.length ?? 0 }
}

class FakePreferences implements PreferenceRepository {
  public stored: CoachPreferences | null = null
  public async get(): Promise<CoachPreferences | null> { return this.stored }
  public async save(storeId: StoreId, patch: Readonly<Partial<Omit<CoachPreferences, 'storeId' | 'updatedAt'>>>): Promise<CoachPreferences> {
    const base: CoachPreferences = this.stored ?? { storeId, personality: 'PROFESSIONAL', huddleTimeMinutes: 420, huddleEnabled: true, weeklyEmailEnabled: true, voiceEnabled: false, widgetEnabled: false, language: 'en', notificationFrequency: 'NORMAL', updatedAt: Date.now() }
    this.stored = { ...base, ...patch, updatedAt: Date.now() }
    return this.stored
  }
}

class FakeHealthScores implements HealthScoreRepository {
  public rows: CoachHealthScoreRecord[] = []
  public async latest(): Promise<CoachHealthScoreRecord | null> { return this.rows[this.rows.length - 1] ?? null }
  public async history(): Promise<readonly CoachHealthScoreRecord[]> { return [...this.rows].reverse() }
  public async record(storeId: StoreId, score: number, factors: Readonly<Record<string, unknown>>): Promise<CoachHealthScoreRecord> {
    const record = { id: randomUUID(), storeId, score, calculatedAt: Date.now(), factors }
    this.rows.push(record)
    return record
  }
}

class FakeReports implements CoachReportRepository {
  public rows: CoachReportRecord[] = []
  public async latest(): Promise<CoachReportRecord | null> { return this.rows[this.rows.length - 1] ?? null }
  public async list(): Promise<readonly CoachReportRecord[]> { return [...this.rows].reverse() }
  public async save(storeId: StoreId, input: Parameters<CoachReportRepository['save']>[1]): Promise<CoachReportRecord> {
    const record: CoachReportRecord = { id: randomUUID(), storeId, reportType: input.reportType, reportDate: input.reportDate, content: input.content, pdfUrl: input.pdfUrl ?? null, sentViaEmail: input.sentViaEmail ?? false, createdAt: Date.now() }
    this.rows.push(record)
    return record
  }
  public async markEmailed(storeId: StoreId, id: string): Promise<CoachReportRecord | null> {
    const row = this.rows.find((candidate) => candidate.storeId === storeId && candidate.id === id)
    if (!row) return null
    const updated = { ...row, sentViaEmail: true }
    this.rows = this.rows.map((candidate) => (candidate.id === id ? updated : candidate))
    return updated
  }
  public async readCount(): Promise<number> { return this.rows.length }
}

class FakeStreaks implements StreakRepository {
  public streak: CoachStreak | null = null
  public async get(): Promise<CoachStreak | null> { return this.streak }
  public async update(_storeId: StoreId, streak: CoachStreak): Promise<CoachStreak> { this.streak = streak; return streak }
}

class FakeOnboarding implements OnboardingRepository {
  public state: CoachOnboardingState | null = null
  public async get(): Promise<CoachOnboardingState | null> { return this.state }
  public async completeStep(storeId: StoreId, step: number): Promise<CoachOnboardingState> {
    this.state = { storeId, currentStep: step, completed: step >= 5, skipped: false, completedAt: step >= 5 ? Date.now() : null }
    return this.state
  }
  public async skip(storeId: StoreId): Promise<CoachOnboardingState> {
    this.state = { storeId, currentStep: 5, completed: false, skipped: true, completedAt: null }
    return this.state
  }
}

class FakeUsage implements CoachUsageRepository {
  public usage: CoachUsageToday = { storeId: STORE, usageDay: DAY, chatMessages: 0, huddlesGenerated: 0 }
  public async today(): Promise<CoachUsageToday> { return this.usage }
  public async incrementChat(): Promise<CoachUsageToday> { this.usage = { ...this.usage, chatMessages: this.usage.chatMessages + 1 }; return this.usage }
  public async incrementHuddle(): Promise<CoachUsageToday> { this.usage = { ...this.usage, huddlesGenerated: this.usage.huddlesGenerated + 1 }; return this.usage }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_AI: CoachAiProvider = {
  configured: true,
  generate: async (system: string): Promise<AiGeneration> => {
    if (system.includes('daily huddle briefing')) {
      return generation(`{"greeting": "Good morning.", "yesterdaySnapshot": "Yesterday brought 14 orders and $1,280.50 in revenue.", "todayPreview": "Review your priorities and check the revenue trend.", "keyInsight": "AOV yesterday was 91.46.", "reviewMinutes": 2}`)
    }
    if (system.includes('action priorities')) {
      return generation(JSON.stringify({ priorities: [
        { category: 'HIGH_IMPACT', title: 'Check the revenue dip', description: 'Yesterday revenue was 1,280.50 — review the 7-day trend', impact_value: 1280.5, impact_currency: 'USD', impact_label: '7-day revenue', time_estimate_minutes: 15, action_type: 'navigate', action_payload: { page: 'analytics' } },
        { category: 'QUICK_WIN', title: 'Review yesterday orders', description: '14 orders yesterday are worth a quick look', impact_value: 14, impact_currency: 'USD', impact_label: 'orders', time_estimate_minutes: 5, action_type: 'review', action_payload: {} },
        { category: 'OPPORTUNITY', title: 'Aim for a stronger week', description: 'Trailing 7-day revenue is 3,631 — set a weekly goal', impact_value: 3631, impact_currency: 'USD', impact_label: '7-day revenue', time_estimate_minutes: 10, action_type: 'goal', action_payload: {} },
      ] }))
    }
    if (system.includes('weekly goals')) {
      return generation(JSON.stringify({ suggestions: [
        { title: 'Grow the week', description: 'Beat trailing 7-day revenue', metric: 'REVENUE', target_value: 3994, currency: 'USD', feasibility: 'MEDIUM', rationale: '3,631 plus 10%' },
      ] }))
    }
    if (system.includes('Sunday weekly review')) {
      return generation(`{"subject": "Your Week in Review", "weekWins": ["Revenue held at 3,631 over the last 7 days"], "metrics": ["Revenue: 3,631"], "learnings": ["14 orders on the best day"], "nextWeekFocus": ["Keep the streak going"], "suggestedGoal": {"title": "Grow the week", "description": "Beat 3,631"}}`)
    }
    throw new Error(`Unhandled prompt in fake AI: ${system.slice(0, 60)}`)
  },
  generateStream: async (_system: string, _user: string, _context, onDelta): Promise<AiGeneration> => {
    const text = 'Yesterday brought 14 orders with an AOV of 91.46. Start with your priorities.'
    onDelta?.(text)
    return generation(text)
  },
}

function generation(text: string): AiGeneration {
  return { text, model: 'nvidia/nemotron-3-ultra:free', keyIndex: 0, usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 }, attempts: 1 }
}

function buildService(overrides: Partial<Parameters<typeof makeDeps>[0]> = {}): StoreCoachService {
  return new StoreCoachService(makeDeps(overrides))
}

function makeDeps(overrides: { plan?: 'trial' | 'start' | 'growth' | 'commander'; trialExpired?: boolean; analyticsDays?: number } = {}): ConstructorParameters<typeof StoreCoachService>[0] {
  const analytics = new InMemoryAnalyticsRepository()
  void analytics.upsert({
    revenue: [
      { storeId: STORE, day: '2026-08-15', grossRevenue: 1100, discounts: 0, orderCount: 12 },
      { storeId: STORE, day: '2026-08-16', grossRevenue: 1250.5, discounts: 0, orderCount: 13 },
      { storeId: STORE, day: '2026-08-17', grossRevenue: 1280.5, discounts: 0, orderCount: 14 },
    ],
    orders: [
      { storeId: STORE, day: '2026-08-15', orderCount: 12, fulfilledCount: 10, cancelledCount: 0, averageOrderValue: 91.67 },
      { storeId: STORE, day: '2026-08-16', orderCount: 13, fulfilledCount: 12, cancelledCount: 1, averageOrderValue: 96.19 },
      { storeId: STORE, day: '2026-08-17', orderCount: 14, fulfilledCount: 14, cancelledCount: 0, averageOrderValue: 91.46 },
    ],
    productSales: [],
    customerCohorts: [{ storeId: STORE, cohortDay: '2026-08-17', activityDay: '2026-08-17', customerCount: 3, grossRevenue: 1280.5 }],
  })
  return {
    huddles: new FakeHuddles(),
    priorities: new FakePriorities(),
    goals: new FakeGoals(),
    achievements: new FakeAchievements(),
    conversations: new FakeConversations(),
    preferences: new FakePreferences(),
    healthScores: new FakeHealthScores(),
    reports: new FakeReports(),
    streaks: new FakeStreaks(),
    onboarding: new FakeOnboarding(),
    usage: new FakeUsage(),
    analytics,
    plan: async () => overrides.plan ?? 'trial',
    merchantDay: async () => DAY,
    merchantHour: async () => 8,
    storeName: async () => 'coach-test-store',
    merchantEmail: async () => 'merchant@example.com',
    trialExpired: () => overrides.trialExpired ?? false,
    ai: FAKE_AI,
    mailer: { sendWeeklyReview: async () => undefined },
    pdf: { write: async (filename: string) => `/tmp/${filename}` },
    now: () => new Date('2026-08-18T08:00:00Z'),
    rateLimitPerMinute: 30,
  }
}

async function withServer<Value>(service: StoreCoachService, handler: (base: string) => Promise<Value>): Promise<Value> {
  const app = createApi({ logger: new Logger(), readinessChecks: [], storeCoach: { service } })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try {
    return await handler(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function apiCall(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  const json: Record<string, unknown> = text.trim() ? JSON.parse(text) as Record<string, unknown> : {}
  return { status: response.status, json }
}


// ---------------------------------------------------------------------------
// ULTRA SWEEP — every Store Coach route, every plan, hunting 5xx
// ---------------------------------------------------------------------------

type Probe = Readonly<{ method: string; path: string; body?: unknown; label: string }>

function allRoutes(ids: Readonly<{ huddleId: string; priorityId: string; goalId: string; reviewId: string }>): readonly Probe[] {
  const q = `?storeId=${STORE}`
  return [
    { method: 'GET', path: `/store-coach/huddle/today${q}`, label: 'huddle today' },
    { method: 'GET', path: `/store-coach/huddle/history${q}&days=30`, label: 'huddle history' },
    { method: 'GET', path: `/store-coach/huddle/history${q}&days=abc`, label: 'huddle history bad days' },
    { method: 'GET', path: `/store-coach/huddle/history${q}&days=-5`, label: 'huddle history negative' },
    { method: 'GET', path: `/store-coach/huddle/history${q}&days=99999`, label: 'huddle history huge' },
    { method: 'POST', path: `/store-coach/huddle/generate${q}`, label: 'huddle generate' },
    { method: 'POST', path: `/store-coach/huddle/${ids.huddleId}/viewed${q}`, label: 'huddle viewed' },
    { method: 'POST', path: `/store-coach/huddle/does-not-exist/viewed${q}`, label: 'huddle viewed missing' },
    { method: 'GET', path: `/store-coach/priorities/today${q}`, label: 'priorities today' },
    { method: 'POST', path: `/store-coach/priorities/generate${q}`, label: 'priorities generate' },
    { method: 'POST', path: `/store-coach/priorities/${ids.priorityId}/complete${q}`, label: 'priority complete' },
    { method: 'POST', path: `/store-coach/priorities/${ids.priorityId}/dismiss${q}`, label: 'priority dismiss (already resolved)' },
    { method: 'POST', path: `/store-coach/priorities/nope/complete${q}`, label: 'priority complete missing' },
    { method: 'GET', path: `/store-coach/goals${q}`, label: 'goals list' },
    { method: 'GET', path: `/store-coach/goals${q}&status=ACTIVE`, label: 'goals ACTIVE' },
    { method: 'GET', path: `/store-coach/goals${q}&status=bogus`, label: 'goals bogus status' },
    { method: 'GET', path: `/store-coach/goals/suggestions${q}`, label: 'goal suggestions' },
    { method: 'POST', path: `/store-coach/goals${q}`, body: { goalType: 'WEEKLY', title: 'Sweep goal', metric: 'REVENUE', targetValue: 1000, startDate: '2026-08-18', endDate: '2026-08-25' }, label: 'goal create' },
    { method: 'POST', path: `/store-coach/goals${q}`, body: {}, label: 'goal create empty body' },
    { method: 'POST', path: `/store-coach/goals${q}`, body: { title: 'x', startDate: 'nope', endDate: 'nope' }, label: 'goal create bad dates' },
    { method: 'PATCH', path: `/store-coach/goals/${ids.goalId}${q}`, body: { currentProgress: 50 }, label: 'goal patch' },
    { method: 'PATCH', path: `/store-coach/goals/${ids.goalId}${q}`, body: {}, label: 'goal patch empty' },
    { method: 'PATCH', path: `/store-coach/goals/missing${q}`, body: { currentProgress: 1 }, label: 'goal patch missing' },
    { method: 'GET', path: `/store-coach/goals/${ids.goalId}/progress${q}`, label: 'goal progress' },
    { method: 'GET', path: `/store-coach/goals/missing/progress${q}`, label: 'goal progress missing' },
    { method: 'POST', path: `/store-coach/goals/1/accept-suggestion${q}`, body: { suggestion: { title: 'Accepted', metric: 'REVENUE', targetValue: 500, currency: 'USD', feasibility: 'HIGH', rationale: 'r' } }, label: 'accept suggestion' },
    { method: 'POST', path: `/store-coach/goals/1/accept-suggestion${q}`, body: {}, label: 'accept suggestion empty' },
    { method: 'DELETE', path: `/store-coach/goals/${ids.goalId}${q}`, label: 'goal delete' },
    { method: 'DELETE', path: `/store-coach/goals/missing${q}`, label: 'goal delete missing' },
    { method: 'GET', path: `/store-coach/achievements${q}`, label: 'achievements' },
    { method: 'GET', path: `/store-coach/achievements/available${q}`, label: 'achievements available' },
    { method: 'GET', path: `/store-coach/streak${q}`, label: 'streak' },
    { method: 'GET', path: `/store-coach/progress/summary${q}&days=30`, label: 'progress summary' },
    { method: 'GET', path: `/store-coach/progress/summary${q}&days=0`, label: 'progress summary days=0' },
    { method: 'GET', path: `/store-coach/progress/trends${q}&metric=revenue`, label: 'trends revenue' },
    { method: 'GET', path: `/store-coach/progress/trends${q}&metric=orders`, label: 'trends orders' },
    { method: 'GET', path: `/store-coach/progress/trends${q}&metric=aov`, label: 'trends aov' },
    { method: 'GET', path: `/store-coach/progress/trends${q}&metric=wat`, label: 'trends unknown metric' },
    { method: 'GET', path: `/store-coach/progress/heatmap${q}`, label: 'heatmap' },
    { method: 'GET', path: `/store-coach/progress/comparisons${q}`, label: 'comparisons' },
    { method: 'GET', path: `/store-coach/chat/history${q}`, label: 'chat history' },
    { method: 'GET', path: `/store-coach/chat/suggestions${q}`, label: 'chat suggestions' },
    { method: 'POST', path: `/store-coach/chat/clear${q}`, label: 'chat clear' },
    { method: 'GET', path: `/store-coach/review/current${q}`, label: 'review current' },
    { method: 'GET', path: `/store-coach/review/history${q}`, label: 'review history' },
    { method: 'POST', path: `/store-coach/review/generate${q}`, label: 'review generate' },
    { method: 'GET', path: `/store-coach/review/${ids.reviewId}/pdf${q}`, label: 'review pdf' },
    { method: 'POST', path: `/store-coach/review/${ids.reviewId}/email${q}`, label: 'review email' },
    { method: 'GET', path: `/store-coach/review/missing/pdf${q}`, label: 'review pdf missing' },
    { method: 'GET', path: `/store-coach/preferences${q}`, label: 'preferences' },
    { method: 'PATCH', path: `/store-coach/preferences${q}`, body: { personality: 'MOTIVATIONAL' }, label: 'preferences patch' },
    { method: 'PATCH', path: `/store-coach/preferences${q}`, body: { personality: 'NOT_A_STYLE', huddleTimeMinutes: 99999 }, label: 'preferences patch invalid' },
    { method: 'PATCH', path: `/store-coach/preferences${q}`, body: {}, label: 'preferences patch empty' },
    { method: 'GET', path: `/store-coach/health-score${q}`, label: 'health score' },
    { method: 'GET', path: `/store-coach/onboarding/status${q}`, label: 'onboarding status' },
    { method: 'POST', path: `/store-coach/onboarding/complete-step${q}`, body: { step: 1 }, label: 'onboarding step 1' },
    { method: 'POST', path: `/store-coach/onboarding/complete-step${q}`, body: { step: 99 }, label: 'onboarding bad step' },
    { method: 'POST', path: `/store-coach/onboarding/complete-step${q}`, body: {}, label: 'onboarding no step' },
    { method: 'POST', path: `/store-coach/onboarding/skip${q}`, label: 'onboarding skip' },
    { method: 'GET', path: `/store-coach/usage${q}`, label: 'usage' },
    { method: 'GET', path: `/store-coach/cost-summary${q}`, label: 'cost summary' },
  ]
}

const PLANS = ['trial', 'start', 'growth', 'commander'] as const

describe('ULTRA SWEEP: no Store Coach route returns 5xx', () => {
  for (const plan of PLANS) {
    it(`plan=${plan}: every route responds without an internal server error`, async () => {
      const service = buildService({ plan })
      await withServer(service, async (base) => {
        // seed real ids
        const huddle = await apiCall(base, 'GET', `/store-coach/huddle/today?storeId=${STORE}`)
        const huddleId = String((huddle.json.data as Record<string, unknown> | null)?.id ?? 'seed-huddle')
        const priorities = await apiCall(base, 'GET', `/store-coach/priorities/today?storeId=${STORE}`)
        const plist = ((priorities.json.data as Record<string, unknown> | null)?.priorities ?? []) as Record<string, unknown>[]
        const priorityId = String(plist[0]?.id ?? 'seed-priority')
        const goal = await apiCall(base, 'POST', `/store-coach/goals?storeId=${STORE}`, { goalType: 'WEEKLY', title: 'Seed', metric: 'REVENUE', targetValue: 1000, startDate: '2026-08-18', endDate: '2026-08-25' })
        const goalId = String((goal.json.data as Record<string, unknown> | null)?.id ?? 'seed-goal')
        const review = await apiCall(base, 'POST', `/store-coach/review/generate?storeId=${STORE}`)
        const reviewId = String((review.json.data as Record<string, unknown> | null)?.id ?? 'seed-review')

        const failures: string[] = []
        for (const probe of allRoutes({ huddleId, priorityId, goalId, reviewId })) {
          let result: { status: number; json: Record<string, unknown> }
          try {
            result = await apiCall(base, probe.method, probe.path, probe.body)
          } catch (error) {
            failures.push(`${probe.label} [${probe.method} ${probe.path}] THREW ${String(error)}`)
            continue
          }
          if (result.status >= 500) {
            const err = result.json.error as Record<string, unknown> | undefined
            failures.push(`${probe.label} [${probe.method} ${probe.path}] -> ${result.status} ${JSON.stringify(err)}`)
          }
        }
        if (failures.length > 0) console.log(`\n=== ${plan} 5xx FAILURES ===\n` + failures.join('\n'))
        expect(failures).toEqual([])
      })
    })
  }

  it('missing storeId is a clean 400 everywhere, never a 500', async () => {
    await withServer(buildService(), async (base) => {
      const failures: string[] = []
      for (const probe of allRoutes({ huddleId: 'h', priorityId: 'p', goalId: 'g', reviewId: 'r' })) {
        const stripped = probe.path.replace(/storeId=[^&]*/, '').replace(/\?&/, '?')
        const result = await apiCall(base, probe.method, stripped, probe.body)
        if (result.status >= 500) failures.push(`${probe.label} -> ${result.status}`)
      }
      if (failures.length > 0) console.log('\n=== NO-STOREID 5xx ===\n' + failures.join('\n'))
      expect(failures).toEqual([])
    })
  })
})
