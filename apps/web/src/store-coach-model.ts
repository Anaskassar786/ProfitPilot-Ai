/**
 * Store Coach frontend model. Pure types and formatting helpers for the
 * Store Coach experience; no fetching or side effects live here. Everything
 * that looks like a number is either a formatted real payload, math derived
 * from one, or a fact from the plan matrix — never an invented metric.
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

// ---------------------------------------------------------------------------
// Redesign helpers — pure, testable, and grounded. Nothing here invents store
// numbers: each helper either formats real payloads, derives math from them,
// or describes the (factual) plan matrix.
// ---------------------------------------------------------------------------

/** Time-of-day bucket used by the personalized hero greeting. */
export type CoachDaypart = 'morning' | 'afternoon' | 'evening' | 'night'

export function daypartForHour(hour: number): CoachDaypart {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

export function greetingForDaypart(part: CoachDaypart): string {
  switch (part) {
    case 'morning': return 'Good morning'
    case 'afternoon': return 'Good afternoon'
    case 'evening': return 'Good evening'
    case 'night': return 'Burning the midnight oil'
  }
}

/**
 * Friendly merchant name derived from the real Shopify shop domain
 * (e.g. "anas-apparel.myshopify.com" → "Anas Apparel"). Falls back to null —
 * we never invent a name that the merchant did not give us.
 */
export function merchantDisplayName(shop: string | null): string | null {
  if (!shop) return null
  const subdomain = shop.toLowerCase().replace(/\.myshopify\.com$/, '').split('.')[0] ?? ''
  const words = subdomain.split(/[-_]+/).filter((word) => word.length > 0 && !/^\d+$/.test(word)).slice(0, 3)
  if (words.length === 0) return null
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// ── Streak milestones (mirror of the backend STREAK badge ladder) ──────────

export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 60, 100]

/** Streak badge ids from the backend catalog mapped to their day targets. */
export const STREAK_BADGE_TARGETS: Readonly<Record<string, number>> = {
  '3_DAY_STREAK': 3,
  '7_DAY_STREAK': 7,
  '14_DAY_STREAK': 14,
  '30_DAY_STREAK': 30,
  '60_DAY_STREAK': 60,
  '100_DAY_STREAK': 100,
}

export function nextStreakMilestone(currentStreak: number): { target: number; progressPct: number } | null {
  const safeStreak = Math.max(0, Math.floor(currentStreak))
  const target = STREAK_MILESTONES.find((milestone) => milestone > safeStreak)
  if (target === undefined) return null
  return { target, progressPct: Math.round(Math.min((safeStreak / target) * 100, 100)) }
}

/** Human badge title from a badge id, e.g. "7_DAY_STREAK" → "7 Day Streak". */
export function badgeTitleFromId(badgeId: string): string {
  return badgeId
    .toLowerCase()
    .split('_')
    .map((word) => (/^\d/.test(word) && word.length <= 2 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

// ── Heatmap pattern derivation (computed only from real synced cells) ──────

export const WEEKDAY_LABELS: readonly string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_LABELS_SHORT: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type CoachHeatmapPatterns = Readonly<{
  totalOrders: number
  activeDays: number
  weekdayAverages: readonly Readonly<{ weekday: number; averageOrders: number }>[]
  bestWeekday: number | null
  quietWeekday: number | null
  weekendDeltaPct: number | null
}>

const EMPTY_PATTERNS: CoachHeatmapPatterns = { totalOrders: 0, activeDays: 0, weekdayAverages: [], bestWeekday: null, quietWeekday: null, weekendDeltaPct: null }

/**
 * Derives honest weekly-rhythm facts from the synced heatmap cells: averages
 * per weekday, the strongest/quietest weekday, and how weekends compare to
 * weekdays. Percentages are only returned when there is enough real spread
 * (10+ active days and a non-zero weekday baseline) to mean something.
 */
export function heatmapPatterns(cells: readonly Readonly<{ weekday: number; orders: number }>[]): CoachHeatmapPatterns {
  if (cells.length === 0) return EMPTY_PATTERNS
  const totals = new Map<number, { orders: number; days: number }>()
  let totalOrders = 0
  let activeDays = 0
  for (const cell of cells) {
    const weekday = Number(cell.weekday)
    const orders = Number(cell.orders)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isFinite(orders) || orders < 0) continue
    const entry = totals.get(weekday) ?? { orders: 0, days: 0 }
    entry.orders += orders
    entry.days += 1
    totals.set(weekday, entry)
    totalOrders += orders
    if (orders > 0) activeDays += 1
  }
  if (totals.size === 0) return EMPTY_PATTERNS
  const weekdayAverages = [...totals.entries()]
    .map(([weekday, entry]) => ({ weekday, averageOrders: entry.days > 0 ? entry.orders / entry.days : 0 }))
    .sort((a, b) => a.weekday - b.weekday)
  const ranked = [...weekdayAverages].sort((a, b) => b.averageOrders - a.averageOrders)
  const bestWeekday = (ranked[0]?.averageOrders ?? 0) > 0 ? ranked[0]!.weekday : null
  const quietWeekday = ranked.length > 1 ? ranked[ranked.length - 1]!.weekday : null
  let weekendDeltaPct: number | null = null
  if (activeDays >= 10) {
    const weekend = weekdayAverages.filter((row) => row.weekday === 0 || row.weekday === 6)
    const weekdays = weekdayAverages.filter((row) => row.weekday >= 1 && row.weekday <= 5)
    const weekendAvg = average(weekend.map((row) => row.averageOrders))
    const weekdayAvg = average(weekdays.map((row) => row.averageOrders))
    if (weekdayAvg > 0) weekendDeltaPct = Math.round(((weekendAvg - weekdayAvg) / weekdayAvg) * 100)
  }
  return { totalOrders, activeDays, weekdayAverages, bestWeekday, quietWeekday, weekendDeltaPct }
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// ── Plan feature matrix (factual tier facts, mirrored from the backend) ────

export type CoachPlanSummary = Readonly<{
  included: readonly string[]
  upgradeTeaser: readonly string[] | null
  nextTierLabel: string | null
}>

const UNLIMITED = 999

function countLabel(value: number, unit: string): string {
  if (value >= UNLIMITED) return `Unlimited ${unit}`
  return `${value} ${unit}`
}

/** What the current tier factually includes, plus what higher tiers add. */
export function planFeatureSummary(plan: CoachPlan): CoachPlanSummary {
  const limits = COACH_LIMITS[plan] as Readonly<Record<string, number | boolean>>
  const num = (key: string): number => typeof limits[key] === 'number' ? limits[key] as number : 0
  const flag = (key: string): boolean => limits[key] === true
  const historyDays = num('progressHistoryDays')
  const included: string[] = [
    `${countLabel(num('prioritiesPerDay'), 'priorities per day')}`,
    `${countLabel(num('activeGoals'), 'active goals')}`,
    `${historyDays >= UNLIMITED ? 'Full progress history' : `${historyDays} days of progress history`}`,
    `${countLabel(num('chatMessagesPerDay'), 'coach chat messages a day')}`,
    `${num('badgesVisible')}-badge catalog`,
    flag('customHuddleTime') ? 'Custom huddle time' : 'Daily 7:00 AM huddle',
    `${coachPersonalitiesForPlan(plan).length} of 4 coach personalities`,
  ]
  if (flag('voice')) included.push('Voice coaching (huddles + chat)')
  if (flag('weeklyPdf')) included.push('Weekly PDF reports')
  if (flag('widget')) included.push('Floating coach widget')
  if (flag('hindi')) included.push('English + Hindi coaching')
  if (plan === 'commander') return { included, upgradeTeaser: null, nextTierLabel: null }
  const teaser: string[] = []
  if (!flag('customHuddleTime')) teaser.push('Custom huddle time')
  if (num('chatMessagesPerDay') < 100) teaser.push('More daily chat messages')
  if (!flag('voice')) teaser.push('Voice coaching')
  if (!flag('weeklyPdf')) teaser.push('Weekly PDF reports')
  if (historyDays < 90) teaser.push('Longer progress history')
  if (plan === 'trial') teaser.push('Floating coach widget')
  const nextTierLabel = plan === 'trial' ? 'Start' : plan === 'start' ? 'Growth' : 'Commander'
  return { included, upgradeTeaser: teaser, nextTierLabel }
}

/** "Aug 18, 2026" style date for briefing headers, from an ISO yyyy-mm-dd. */
export function formatCoachDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Aug 18 – Aug 24" style range from two ISO dates. */
export function formatCoachDateRange(startIso: string, endIso: string): string {
  return `${formatCoachDate(startIso)} – ${formatCoachDate(endIso)}`
}
