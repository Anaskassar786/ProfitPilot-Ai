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

/** Per-category earned/total badge counts that power the home "Badge Radar". */
export type CoachBadgeCategoryStat = Readonly<{
  category: string
  earned: number
  total: number
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
  /** True only when the server actually has an SMTP mailer wired up. */
  emailAvailable?: boolean
  /** True only when the plan allows PDFs AND a PDF writer is configured. */
  pdfAvailable?: boolean
}>

/**
 * The real, deterministic "week in numbers" snapshot attached to every weekly
 * review on the server. These are the store's actual synced figures — never an
 * AI estimate. Older saved reviews may not carry one yet, so parsing is
 * defensive and returns null when absent.
 */
export type CoachReviewSnapshot = Readonly<{
  currency: string
  revenue7d: number
  revenue7dChangePct: number
  orders7d: number
  orders7dChangePct: number
  aov30d: number
  bestDayRevenue: number
  yesterdayNewCustomers: number
  streakDays: number
}>

/** Extracts the real review snapshot from a stored review's content. */
export function reviewSnapshot(content: Readonly<Record<string, unknown>>): CoachReviewSnapshot | null {
  const raw = content.snapshot
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Readonly<Record<string, unknown>>
  const num = (key: string): number | null => {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const currency = typeof record.currency === 'string' && record.currency.length > 0 ? record.currency : 'USD'
  const revenue7d = num('revenue7d')
  const revenue7dChangePct = num('revenue7dChangePct')
  const orders7d = num('orders7d')
  const orders7dChangePct = num('orders7dChangePct')
  const aov30d = num('aov30d')
  const bestDayRevenue = num('bestDayRevenue')
  const yesterdayNewCustomers = num('yesterdayNewCustomers')
  const streakDays = num('streakDays')
  if (revenue7d === null && orders7d === null && aov30d === null) return null
  return { currency, revenue7d: revenue7d ?? 0, revenue7dChangePct: revenue7dChangePct ?? 0, orders7d: orders7d ?? 0, orders7dChangePct: orders7dChangePct ?? 0, aov30d: aov30d ?? 0, bestDayRevenue: bestDayRevenue ?? 0, yesterdayNewCustomers: yesterdayNewCustomers ?? 0, streakDays: streakDays ?? 0 }
}


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

export const PERSONALITY_META: Readonly<Record<CoachPersonality, Readonly<{ label: string; tagline: string; sample: string; emoji: string }>>> = {
  CASUAL: {
    label: 'Friendly',
    tagline: 'Warm and encouraging',
    emoji: '😊',
    sample: 'Hey there! Great to see you. Quick look at yesterday, then we will figure out today together.',
  },
  PROFESSIONAL: {
    label: 'Professional',
    tagline: 'Direct and businesslike',
    emoji: '💼',
    sample: 'Good morning. Yesterday your store generated real orders. Let’s review what happened, then plan today.',
  },
  MOTIVATIONAL: {
    label: 'Motivational',
    tagline: 'Energetic and inspiring',
    emoji: '🎯',
    sample: 'Good morning, champion! You showed up today and that is already a win. Let’s build some momentum!',
  },
  ANALYTICAL: {
    label: 'Analytical',
    tagline: 'Detailed and data-focused',
    emoji: '📊',
    sample: 'Morning briefing. Here is yesterday against your own recent baseline, then the one move that matters most.',
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

/** Label the huddle action for the time the merchant is actually viewing it. */
export function huddleActionLabelForDaypart(part: CoachDaypart): string {
  switch (part) {
    case 'morning': return 'Start Morning Huddle'
    case 'afternoon': return 'Start Afternoon Huddle'
    case 'evening': return 'Start Evening Huddle'
    case 'night': return 'Start Night Huddle'
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
  if (subdomain === 'commander-pilot' || subdomain === 'commander_pilot' || subdomain === 'pilot') return 'Commander'
  const words = subdomain.split(/[-_]+/).filter((word) => word.length > 0 && !/^\d+$/.test(word) && word.toLowerCase() !== 'pilot').slice(0, 3)
  if (words.length === 0) return null
  const formatted = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  if (formatted === 'Commander Pilot') return 'Commander'
  return formatted
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
    'Daily morning briefings',
    `${countLabel(num('prioritiesPerDay'), num('prioritiesPerDay') === 1 ? 'personalized priority per day' : 'personalized priorities per day')}`,
    `${countLabel(num('activeGoals'), num('activeGoals') === 1 ? 'weekly goal to track' : 'weekly goals to track')}`,
    `${num('badgesVisible')} achievement badges`,
    `${historyDays >= UNLIMITED ? 'Full history of your journey' : `${historyDays} days of history`}`,
    `${coachPersonalitiesForPlan(plan).length} of 4 coach styles`,
  ]
  if (flag('customHuddleTime')) included.push('Choose your own briefing time')
  if (flag('weeklyPdf')) included.push('Weekly PDF reports')
  if (flag('widget')) included.push('Floating coach reminder')
  if (flag('hindi')) included.push('English + Hindi coaching')
  if (plan === 'commander') return { included, upgradeTeaser: null, nextTierLabel: null }
  const teaser: string[] = []
  if (num('prioritiesPerDay') < UNLIMITED) teaser.push('More personalized priorities each day')
  if (num('activeGoals') < UNLIMITED) teaser.push('Track more than one goal at a time')
  if (historyDays < 90) teaser.push('Longer history')
  if (coachPersonalitiesForPlan(plan).length < 4) teaser.push('Every coach style')
  if (!flag('weeklyPdf')) teaser.push('Weekly PDF reports')
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

// ── Human-friendly coaching copy (derived from real payloads only) ────────

export function engagementPill(currentStreak: number): string {
  if (currentStreak <= 0) return 'Just getting started'
  if (currentStreak < 3) return 'Building a habit'
  if (currentStreak < 7) return 'On a roll'
  if (currentStreak < 30) return 'Consistent coach'
  return 'Seasoned operator'
}

export type StreakStatusCopy = Readonly<{ headline: string; detail: string; cta: string | null }>

/** Motivational streak language. Never invents a streak the merchant did not earn. */
export function streakStatusCopy(currentStreak: number, todayViewed: boolean): StreakStatusCopy {
  const days = Math.max(0, Math.floor(currentStreak))
  if (days <= 0) {
    return {
      headline: 'Build your streak',
      detail: todayViewed ? 'Nice check-in. Come back tomorrow to start a 3-day streak.' : 'Check in today to start building a 3-day streak.',
      cta: todayViewed ? null : 'Check in today',
    }
  }
  if (days === 1) {
    return {
      headline: 'Day 1 — you showed up',
      detail: todayViewed ? 'Come back tomorrow and make it two in a row.' : 'Open today’s briefing to keep this going.',
      cta: todayViewed ? null : 'Keep it going',
    }
  }
  const milestone = nextStreakMilestone(days)
  if (!milestone) {
    return {
      headline: `${days}-day streak`,
      detail: 'Amazing consistency — every day here is a real check-in.',
      cta: todayViewed ? null : 'Keep it alive',
    }
  }
  return {
    headline: `${days}-day streak`,
    detail: todayViewed
      ? `${days} of ${milestone.target} days toward your next badge.`
      : `Open today’s briefing to keep your ${days}-day streak alive.`,
    cta: todayViewed ? null : 'Keep it alive',
  }
}

export type CoachTip = Readonly<{ title: string; body: string; action: string; kind: 'priority' | 'pattern' | 'goal' | 'streak' | 'insight' | 'welcome' }>

/** A coaching tip grounded in what the store actually has right now. */
export function dailyCoachTip(input: Readonly<{
  huddleInsight: string | null
  heatmapBestWeekday: number | null
  pendingPriorities: number
  hasGoal: boolean
  streakDays: number
}>): CoachTip {
  if (input.pendingPriorities > 0) {
    return {
      title: "Today's coaching tip",
      body: `You have ${input.pendingPriorities} action${input.pendingPriorities === 1 ? '' : 's'} waiting. Start with the smallest one — finishing something real builds momentum.`,
      action: 'See today’s priorities',
      kind: 'priority',
    }
  }
  if (input.heatmapBestWeekday !== null && input.heatmapBestWeekday >= 0 && input.heatmapBestWeekday <= 6) {
    const day = WEEKDAY_LABELS[input.heatmapBestWeekday] ?? 'your best day'
    return {
      title: "Today's coaching tip",
      body: `${day} is when your customers buy most. Plan promotions and emails for ${day} so you meet them when they are already shopping.`,
      action: 'See your best days',
      kind: 'pattern',
    }
  }
  if (!input.hasGoal) {
    return {
      title: "Today's coaching tip",
      body: 'A weekly goal gives your effort a finish line. Pick one target this week so every action has a direction.',
      action: 'Set a weekly goal',
      kind: 'goal',
    }
  }
  if (input.streakDays <= 0) {
    return {
      title: "Today's coaching tip",
      body: 'Checking in daily helps you notice what changed. Open today’s briefing and mark it read to start your streak.',
      action: 'Open today’s briefing',
      kind: 'streak',
    }
  }
  const insight = input.huddleInsight?.trim() ?? ''
  if (insight.length > 0) {
    return { title: "Today's coaching tip", body: insight, action: 'Review today’s briefing', kind: 'insight' }
  }
  return {
    title: "Today's coaching tip",
    body: 'Keep showing up. Your coach gets sharper as more of your real store activity syncs in.',
    action: 'Refresh your briefing',
    kind: 'welcome',
  }
}

export type WeekCelebration = Readonly<{ items: readonly string[]; note: string }>

/** Celebrate only facts we can see. Returns null when there is nothing real to cheer. */
export function weekCelebration(input: Readonly<{
  revenueTrendPct: number | null
  completedPriorities: number
  goalProgressPct: number | null
  earnedBadges: number
}>): WeekCelebration | null {
  const items: string[] = []
  if (input.revenueTrendPct !== null && Number.isFinite(input.revenueTrendPct) && input.revenueTrendPct !== 0) {
    items.push(input.revenueTrendPct > 0
      ? `Revenue is up ${Math.abs(input.revenueTrendPct).toFixed(1)}% versus the previous stretch`
      : `Revenue is down ${Math.abs(input.revenueTrendPct).toFixed(1)}% — a chance to focus today’s actions`)
  }
  if (input.completedPriorities > 0) items.push(`${input.completedPriorities} priorit${input.completedPriorities === 1 ? 'y' : 'ies'} finished`)
  if (input.goalProgressPct !== null && Number.isFinite(input.goalProgressPct) && input.goalProgressPct > 0) {
    items.push(`Weekly goal is ${Math.round(Math.min(input.goalProgressPct, 100))}% of the way there`)
  }
  if (input.earnedBadges > 0) items.push(`${input.earnedBadges} badge${input.earnedBadges === 1 ? '' : 's'} earned so far`)
  if (items.length === 0) return null
  return {
    items,
    note: input.revenueTrendPct !== null && input.revenueTrendPct < 0
      ? 'Slow weeks happen. Stay with the plan — you’ve got this.'
      : 'Keep going — this is real progress from your store.',
  }
}

export function friendlyFeasibility(level: CoachGoal['feasibility']): string {
  if (level === 'HIGH') return 'Well within reach'
  if (level === 'MEDIUM') return 'A healthy stretch'
  return 'Ambitious — we’ll take it day by day'
}

export function whyPriorityMatters(priority: CoachPriority): string {
  if (priority.impactValue > 0 && priority.impactLabel) return `Why it matters: ${priority.impactLabel}`
  if (priority.category === 'QUICK_WIN') return 'Why it matters: a small win today keeps the store moving.'
  if (priority.category === 'HIGH_IMPACT') return 'Why it matters: this is one of the highest-leverage moves on your store right now.'
  return 'Why it matters: this is an opening your recent store activity surfaced.'
}

export function learningMoment(input: Readonly<{ heatmapBestWeekday: number | null; hasGoal: boolean }>): Readonly<{ title: string; body: string }> {
  if (input.heatmapBestWeekday !== null && input.heatmapBestWeekday >= 0 && input.heatmapBestWeekday <= 6) {
    const day = WEEKDAY_LABELS[input.heatmapBestWeekday] ?? 'your busiest day'
    return {
      title: 'Why timing matters',
      body: `Your customers already have a favorite shopping day — ${day}. Meeting them then uses a pattern your store already has.`,
    }
  }
  if (!input.hasGoal) {
    return {
      title: 'Why a weekly goal helps',
      body: 'A single weekly target turns a pile of tasks into a direction. Your coach tracks it from your real orders, so you never have to guess the score.',
    }
  }
  return {
    title: 'Why daily check-ins help',
    body: 'Your briefing is written from yesterday’s real orders. Checking in keeps the streak honest and tells your coach you are in the loop.',
  }
}

export function openAiCommand(): void {
  try {
    window.location.hash = '/ai-command'
  } catch {
    /* embedded browsers may restrict location writes */
  }
}
