/**
 * PR #48 — Store Coach frontend model. Pure types and formatting helpers for
 * the AI Growth Command page; no fetching or side effects live here.
 */

export type CoachPlan = 'trial' | 'start' | 'growth' | 'commander'
export type CoachPersonality = 'PROFESSIONAL' | 'MOTIVATIONAL' | 'ANALYTICAL' | 'CASUAL'
export type CoachPriorityCategory = 'HIGH_IMPACT' | 'QUICK_WIN' | 'OPPORTUNITY'

export type CoachHuddle = Readonly<{
  id: string
  huddleDate: string
  content: Readonly<Record<string, unknown>>
  viewed: boolean
  createdAt: number
  plan: CoachPlan
  voiceAvailable: boolean
}>

export type CoachPriority = Readonly<{
  id: string
  priorityDate: string
  category: CoachPriorityCategory
  title: string
  description: string
  impactValue: number
  impactCurrency: string
  impactLabel: string
  timeEstimateMinutes: number
  actionType: string
  actionPayload: Readonly<Record<string, unknown>>
  status: 'PENDING' | 'COMPLETED' | 'DISMISSED' | 'EXPIRED'
  expiresAt: number | null
}>

export type CoachPrioritiesView = Readonly<{
  priorityDate: string
  priorities: readonly CoachPriority[]
  planLimit: number
  remainingToday: number
}>

export type CoachGoal = Readonly<{
  id: string
  goalType: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'CUSTOM'
  title: string
  description: string
  metric: 'REVENUE' | 'ORDERS' | 'CUSTOMERS' | 'AOV' | 'RETENTION' | 'CUSTOM'
  targetValue: number
  targetCurrency: string
  startDate: string
  endDate: string
  status: 'ACTIVE' | 'ACHIEVED' | 'MISSED' | 'CANCELLED'
  currentProgress: number
  feasibility: 'HIGH' | 'MEDIUM' | 'LOW'
}>

export type CoachGoalSuggestion = Readonly<{
  title: string
  description: string
  metric: CoachGoal['metric']
  targetValue: number
  currency: string
  feasibility: 'HIGH' | 'MEDIUM' | 'LOW'
  rationale: string
}>

export type CoachGoalProgress = Readonly<{
  current: number
  target: number
  progressPct: number
  daysElapsed: number
  daysTotal: number
  daysRemaining: number
  pace: 'ON_TRACK' | 'BEHIND' | 'AHEAD'
  requiredDailyPace: number
  actualDailyPace: number
  feasibility: 'HIGH' | 'MEDIUM' | 'LOW'
}>

export type CoachAchievement = Readonly<{
  id: string
  badgeId: string
  earnedAt: number
  context: Readonly<Record<string, unknown>>
}>

export type CoachBadgeCatalogEntry = Readonly<{
  id: string
  title: string
  description: string
  category: string
  rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'
  earned: boolean
  earnedAt: number | null
}>

export type CoachStreakView = Readonly<{
  currentStreak: number
  longestStreak: number
  lastActiveDate: string | null
  todayViewed: boolean
}>

export type CoachProgressSummary = Readonly<{
  window: number
  revenue: number
  orders: number
  aov: number
  customers: number
  revenueTrendPct: number
  series: readonly Readonly<{ day: string; revenue: number; orders: number }>[]
  comparisonSeries: readonly Readonly<{ day: string; revenue: number }>[]
}>

export type CoachHeatmapView = Readonly<{
  weeks: number
  bestDay: string | null
  busiestWeek: string | null
  cells: readonly Readonly<{ day: string; weekday: number; week: number; orders: number; revenue: number; intensity: number }>[]
  legend: readonly number[]
}>

export type CoachMessage = Readonly<{ role: 'user' | 'coach'; content: string; timestamp: number; confidence?: number | null }>

export type CoachPreferencesView = Readonly<{
  storeId: string
  personality: CoachPersonality
  huddleTimeMinutes: number
  huddleEnabled: boolean
  weeklyEmailEnabled: boolean
  voiceEnabled: boolean
  widgetEnabled: boolean
  language: 'en' | 'hi'
  notificationFrequency: 'LOW' | 'NORMAL' | 'HIGH'
  updatedAt: number
  plan: CoachPlan
}>

export type CoachUsageView = Readonly<{
  plan: CoachPlan
  chatMessagesToday: number
  chatLimit: number
  huddlesGeneratedToday: number
  activeGoals: number
  goalLimit: number
  chatAtWarning: boolean
  chatExhausted: boolean
}>

export type CoachOnboardingView = Readonly<{
  currentStep: number
  completed: boolean
  skipped: boolean
  completedAt: number | null
  steps: readonly Readonly<{ step: number; title: string; done: boolean }>[]
}>

export type CoachHealthView = Readonly<{
  score: number | null
  label: string
  tone: 'good' | 'ok' | 'low'
  factors: Readonly<Record<string, unknown>>
  history: readonly Readonly<{ score: number; calculatedAt: number }>[]
}>

export type CoachReviewView = Readonly<{
  id: string
  reportDate: string
  content: Readonly<Record<string, unknown>>
  pdfUrl: string | null
  sentViaEmail: boolean
  commanderPdf: boolean
}>

export type CoachChatDone = Readonly<{ type: 'done'; message: CoachMessage }>
export type CoachChatDelta = Readonly<{ type: 'delta'; text: string }>
export type CoachChatError = Readonly<{ type: 'error'; code: string; message: string; status: number; details?: Readonly<Record<string, string | number | boolean | null>> }>
export type CoachChatFrame = CoachChatDelta | CoachChatDone | CoachChatError

// ---------------------------------------------------------------------------
// Plan feature matrix (mirrors the server so locked-feature UI is exact)
// ---------------------------------------------------------------------------

export const COACH_LIMITS: Readonly<Record<CoachPlan, Readonly<Record<string, number | boolean>>>> = {
  trial: { prioritiesPerDay: 2, activeGoals: 1, badgesVisible: 5, progressHistoryDays: 7, chatMessagesPerDay: 5, customHuddleTime: false, voice: false, weeklyPdf: false, hindi: false, widget: false, allPersonalities: false },
  start: { prioritiesPerDay: 3, activeGoals: 2, badgesVisible: 15, progressHistoryDays: 30, chatMessagesPerDay: 20, customHuddleTime: true, voice: false, weeklyPdf: false, hindi: false, widget: true, allPersonalities: false },
  growth: { prioritiesPerDay: 5, activeGoals: 5, badgesVisible: 30, progressHistoryDays: 90, chatMessagesPerDay: 100, customHuddleTime: true, voice: true, weeklyPdf: false, hindi: true, widget: true, allPersonalities: true },
  commander: { prioritiesPerDay: 999, activeGoals: 999, badgesVisible: 50, progressHistoryDays: 3650, chatMessagesPerDay: 999, customHuddleTime: true, voice: true, weeklyPdf: true, hindi: true, widget: true, allPersonalities: true },
}

export const PLAN_LABEL: Readonly<Record<CoachPlan, string>> = {
  trial: 'Free Trial',
  start: 'Start',
  growth: 'Growth',
  commander: 'Commander',
}

export const PERSONALITY_META: Readonly<Record<CoachPersonality, Readonly<{ label: string; tagline: string; sample: string }>>> = {
  PROFESSIONAL: {
    label: 'Professional',
    tagline: 'Formal, friendly, data-focused',
    sample: 'Good morning. Yesterday your store generated real orders. Let\u2019s review what the data says before we plan today.',
  },
  MOTIVATIONAL: {
    label: 'Motivational',
    tagline: 'Enthusiastic, celebration-heavy',
    sample: 'Good morning, champion! You showed up today and that is already a win. Let\u2019s build some momentum!',
  },
  ANALYTICAL: {
    label: 'Analytical',
    tagline: 'Data-heavy, detail-oriented',
    sample: 'Morning briefing. Yesterday: revenue, orders, and AOV against the trailing 7-day baseline. Key deltas follow.',
  },
  CASUAL: {
    label: 'Casual',
    tagline: 'Friendly and conversational',
    sample: 'Hey there! Great to see you. Quick look at yesterday, then we\u2019ll figure out today together.',
  },
}

export function coachPersonalitiesForPlan(plan: CoachPlan): readonly CoachPersonality[] {
  if (plan === 'trial') return ['PROFESSIONAL']
  if (plan === 'start') return ['PROFESSIONAL', 'MOTIVATIONAL']
  return ['PROFESSIONAL', 'MOTIVATIONAL', 'ANALYTICAL', 'CASUAL']
}

export function huddleTimeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function paceLabel(pace: CoachGoalProgress['pace']): string {
  return pace === 'ON_TRACK' ? 'On Track' : pace === 'BEHIND' ? 'Behind' : 'Ahead'
}

export function relativeTimeLabel(timestamp: number): string {
  const delta = Date.now() - timestamp
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
}

export function isUpgradeError(error: unknown): error is Readonly<{ status: number; code: string }> {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status: unknown }).status === 402
}
