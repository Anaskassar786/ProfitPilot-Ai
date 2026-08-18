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
// Tests
// ---------------------------------------------------------------------------

describe('Store Coach huddle flow', () => {
  it('generates and returns today\u2019s huddle with grounded content', async () => withServer(buildService(), async (base) => {
    const first = await apiCall(base, 'GET', `/store-coach/huddle/today?storeId=${STORE}`)
    expect(first.status).toBe(200)
    const data = first.json.data as Record<string, unknown>
    expect(data.viewed).toBe(false)
    const content = data.content as Record<string, unknown>
    expect(content.keyInsight).toContain('91.46')
    expect(content.reviewMinutes).toBe(2)
    const second = await apiCall(base, 'GET', `/store-coach/huddle/today?storeId=${STORE}`)
    expect((second.json.data as Record<string, unknown>).id).toBe(data.id)
  }))

  it('marks a huddle viewed and updates the streak', async () => withServer(buildService(), async (base) => {
    const generated = await apiCall(base, 'GET', `/store-coach/huddle/today?storeId=${STORE}`)
    const id = (generated.json.data as Record<string, unknown>).id as string
    const viewed = await apiCall(base, 'POST', `/store-coach/huddle/${id}/viewed?storeId=${STORE}`)
    expect(viewed.status).toBe(200)
    expect((viewed.json.data as Record<string, unknown>).viewedAt).not.toBeNull()
    const streak = await apiCall(base, 'GET', `/store-coach/streak?storeId=${STORE}`)
    const streakData = streak.json.data as Record<string, unknown>
    expect(streakData.currentStreak).toBe(1)
    expect(streakData.todayViewed).toBe(true)
    const achievements = await apiCall(base, 'GET', `/store-coach/achievements?storeId=${STORE}`)
    const earned = (achievements.json.data as { earned: readonly { badgeId: string }[] }).earned
    expect(earned.map((record) => record.badgeId)).toContain('FIRST_HUDDLE')
  }))

  it('returns history within the plan window', async () => withServer(buildService(), async (base) => {
    await apiCall(base, 'GET', `/store-coach/huddle/today?storeId=${STORE}`)
    const history = await apiCall(base, 'GET', `/store-coach/huddle/history?storeId=${STORE}&days=7`)
    expect(history.status).toBe(200)
    expect((history.json.data as readonly unknown[]).length).toBe(1)
  }))
})

describe('Store Coach priorities', () => {
  it('generates priorities and caps them at the trial limit of 2', async () => withServer(buildService({ plan: 'trial' }), async (base) => {
    const result = await apiCall(base, 'GET', `/store-coach/priorities/today?storeId=${STORE}`)
    expect(result.status).toBe(200)
    const data = result.json.data as Record<string, unknown>
    expect(data.planLimit).toBe(2)
    expect((data.priorities as readonly unknown[]).length).toBe(2)
  }))

  it('growth plan keeps all three categories', async () => withServer(buildService({ plan: 'growth' }), async (base) => {
    const result = await apiCall(base, 'GET', `/store-coach/priorities/today?storeId=${STORE}`)
    const data = result.json.data as Record<string, unknown>
    expect((data.priorities as readonly unknown[]).length).toBe(3)
  }))

  it('completes and dismisses priorities', async () => withServer(buildService({ plan: 'growth' }), async (base) => {
    const generated = await apiCall(base, 'GET', `/store-coach/priorities/today?storeId=${STORE}`)
    const priorities = (generated.json.data as { priorities: readonly { id: string }[] }).priorities
    const completed = await apiCall(base, 'POST', `/store-coach/priorities/${priorities[0]!.id}/complete?storeId=${STORE}`)
    expect(completed.status).toBe(200)
    const dismissed = await apiCall(base, 'POST', `/store-coach/priorities/${priorities[1]!.id}/dismiss?storeId=${STORE}`)
    expect(dismissed.status).toBe(200)
  }))
})

describe('Store Coach goals', () => {
  it('creates, lists, updates, and deletes goals', async () => withServer(buildService(), async (base) => {
    const created = await apiCall(base, 'POST', `/store-coach/goals?storeId=${STORE}`, { goalType: 'WEEKLY', title: 'Grow the week', description: 'Beat last week', metric: 'REVENUE', targetValue: 9240, targetCurrency: 'USD', startDate: '2026-08-18', endDate: '2026-08-25' })
    expect(created.status).toBe(201)
    const id = (created.json.data as Record<string, unknown>).id as string
    const list = await apiCall(base, 'GET', `/store-coach/goals?storeId=${STORE}&status=ACTIVE`)
    expect((list.json.data as readonly unknown[]).length).toBe(1)
    const updated = await apiCall(base, 'PATCH', `/store-coach/goals/${id}?storeId=${STORE}`, { title: 'Grow harder' })
    expect((updated.json.data as Record<string, unknown>).title).toBe('Grow harder')
    const progress = await apiCall(base, 'GET', `/store-coach/goals/${id}/progress?storeId=${STORE}`)
    expect(progress.status).toBe(200)
    const deleted = await apiCall(base, 'DELETE', `/store-coach/goals/${id}?storeId=${STORE}`)
    expect((deleted.json.data as Record<string, unknown>).deleted).toBe(true)
  }))

  it('returns 402 when the active goal cap is exceeded (trial allows 1)', async () => withServer(buildService(), async (base) => {
    await apiCall(base, 'POST', `/store-coach/goals?storeId=${STORE}`, { goalType: 'WEEKLY', title: 'One', metric: 'REVENUE', targetValue: 100, startDate: '2026-08-18', endDate: '2026-08-25' })
    const second = await apiCall(base, 'POST', `/store-coach/goals?storeId=${STORE}`, { goalType: 'WEEKLY', title: 'Two', metric: 'REVENUE', targetValue: 100, startDate: '2026-08-18', endDate: '2026-08-25' })
    expect(second.status).toBe(402)
    expect((second.json.error as Record<string, unknown>).code).toBe('PAYMENT_REQUIRED')
  }))

  it('suggests goals and accepts one', async () => withServer(buildService(), async (base) => {
    const suggestions = await apiCall(base, 'GET', `/store-coach/goals/suggestions?storeId=${STORE}`)
    expect(suggestions.status).toBe(200)
    const suggestion = (suggestions.json.data as readonly Record<string, unknown>[])[0]!
    const accepted = await apiCall(base, 'POST', `/store-coach/goals/any-id/accept-suggestion?storeId=${STORE}`, { suggestion, startDate: '2026-08-18' })
    expect(accepted.status).toBe(201)
  }))
})

describe('Store Coach chat', () => {
  it('streams a grounded chat answer over SSE', async () => withServer(buildService({ plan: 'growth' }), async (base) => {
    const response = await fetch(`${base}/store-coach/chat?storeId=${STORE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'How was yesterday?' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('data: {"type":"delta"')
    expect(text).toContain('"type":"done"')
    const history = await apiCall(base, 'GET', `/store-coach/chat/history?storeId=${STORE}`)
    const messages = (history.json.data as { messages: readonly { role: string; content: string }[] }).messages
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[1]!.role).toBe('coach')
  }))

  it('enforces the daily chat message cap with a 402 upgrade error', async () => withServer(buildService({ plan: 'trial' }), async (base) => {
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${base}/store-coach/chat?storeId=${STORE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'question' }) })
      expect(response.status).toBe(200)
      await response.text()
    }
    const response = await fetch(`${base}/store-coach/chat?storeId=${STORE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'one more' }) })
    const text = await response.text()
    expect(text).toContain('"code":"PAYMENT_REQUIRED"')
    expect(text).toContain('"status":402')
  }))

  it('clears chat history', async () => withServer(buildService(), async (base) => {
    await apiCall(base, 'POST', `/store-coach/chat/clear?storeId=${STORE}`)
    const history = await apiCall(base, 'GET', `/store-coach/chat/history?storeId=${STORE}`)
    expect((history.json.data as { messages: readonly unknown[] }).messages).toHaveLength(0)
  }))
})

describe('Store Coach plan gating', () => {
  it('blocks coach access entirely when the trial has expired', async () => withServer(buildService({ plan: 'trial', trialExpired: true }), async (base) => {
    const result = await apiCall(base, 'GET', `/store-coach/huddle/today?storeId=${STORE}`)
    expect(result.status).toBe(402)
    const error = result.json.error as Record<string, unknown>
    expect(error.code).toBe('PAYMENT_REQUIRED')
    expect(error.details).toMatchObject({ upgrade: 'required', trialExpired: true })
  }))

  it('blocks voice preference on Start with 402', async () => withServer(buildService({ plan: 'start' }), async (base) => {
    const result = await apiCall(base, 'PATCH', `/store-coach/preferences?storeId=${STORE}`, { voiceEnabled: true })
    expect(result.status).toBe(402)
    expect((result.json.error as Record<string, unknown>).code).toBe('PAYMENT_REQUIRED')
  }))

  it('allows voice on Growth', async () => withServer(buildService({ plan: 'growth' }), async (base) => {
    const result = await apiCall(base, 'PATCH', `/store-coach/preferences?storeId=${STORE}`, { voiceEnabled: true })
    expect(result.status).toBe(200)
    expect((result.json.data as Record<string, unknown>).voiceEnabled).toBe(true)
  }))

  it('gates weekly PDF downloads to Commander', async () => withServer(buildService({ plan: 'growth' }), async (base) => {
    const generated = await apiCall(base, 'POST', `/store-coach/review/generate?storeId=${STORE}`)
    const id = (generated.json.data as Record<string, unknown>).id as string
    const pdf = await apiCall(base, 'GET', `/store-coach/review/${id}/pdf?storeId=${STORE}`)
    expect(pdf.status).toBe(402)
    expect((pdf.json.error as Record<string, unknown>).code).toBe('PAYMENT_REQUIRED')
  }))

  it('exposes the usage meter with plan limits', async () => withServer(buildService({ plan: 'start' }), async (base) => {
    const usage = await apiCall(base, 'GET', `/store-coach/usage?storeId=${STORE}`)
    const data = usage.json.data as Record<string, unknown>
    expect(data.plan).toBe('start')
    expect(data.chatLimit).toBe(20)
    expect(data.goalLimit).toBe(2)
  }))
})

describe('Store Coach weekly review, preferences, onboarding', () => {
  it('generates a weekly review grounded in evidence', async () => withServer(buildService({ plan: 'commander' }), async (base) => {
    const result = await apiCall(base, 'GET', `/store-coach/review/current?storeId=${STORE}`)
    expect(result.status).toBe(200)
    const data = result.json.data as Record<string, unknown>
    const content = data.content as Record<string, unknown>
    expect(String(content.subject ?? '')).toContain('Week in Review')
  }))

  it('updates preferences and rejects personalities not in the plan', async () => withServer(buildService({ plan: 'growth' }), async (base) => {
    const result = await apiCall(base, 'PATCH', `/store-coach/preferences?storeId=${STORE}`, { personality: 'ANALYTICAL', huddleTimeMinutes: 540 })
    expect(result.status).toBe(200)
    expect((result.json.data as Record<string, unknown>).personality).toBe('ANALYTICAL')
  }))

  it('rejects personalities not included in the plan (Start)', async () => withServer(buildService({ plan: 'start' }), async (base) => {
    const result = await apiCall(base, 'PATCH', `/store-coach/preferences?storeId=${STORE}`, { personality: 'ANALYTICAL' })
    expect(result.status).toBe(402)
  }))

  it('walks the 5-step onboarding flow', async () => withServer(buildService(), async (base) => {
    for (let step = 1; step <= 5; step += 1) {
      const result = await apiCall(base, 'POST', `/store-coach/onboarding/complete-step?storeId=${STORE}`, { step })
      expect(result.status).toBe(200)
    }
    const status = await apiCall(base, 'GET', `/store-coach/onboarding/status?storeId=${STORE}`)
    expect((status.json.data as Record<string, unknown>).completed).toBe(true)
  }))

  it('exposes progress and health endpoints with real analytics rows', async () => withServer(buildService(), async (base) => {
    const summary = await apiCall(base, 'GET', `/store-coach/progress/summary?storeId=${STORE}&days=30`)
    expect(summary.status).toBe(200)
    expect((summary.json.data as Record<string, unknown>).orders).toBe(39)
    const heatmap = await apiCall(base, 'GET', `/store-coach/progress/heatmap?storeId=${STORE}`)
    expect(heatmap.status).toBe(200)
    const health = await apiCall(base, 'GET', `/store-coach/health-score?storeId=${STORE}`)
    expect(health.status).toBe(200)
  }))
})
