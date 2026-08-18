import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'
import { extractNumbers } from './language.js'

/**
 * PR #48 — Store Coach domain logic.
 *
 * Everything the Store Coach needs that is deterministic and testable lives
 * here: the plan feature matrix, personality catalog, the 50-badge catalog,
 * streak/health/feasibility math, and the grounded prompt builders. The API
 * layer wires these into OpenRouter, Postgres, the cost ledger, and the
 * response envelope; nothing in this file invents store numbers.
 */

// ---------------------------------------------------------------------------
// Plan gating
// ---------------------------------------------------------------------------

export const COACH_PLAN_ORDER: readonly PlanTier[] = ['trial', 'start', 'growth', 'commander']

export type CoachFeature =
  | 'customHuddleTime'
  | 'voice'
  | 'weeklyPdf'
  | 'hindi'
  | 'widget'
  | 'allPersonalities'
  | 'weeklyEmail'

export type CoachLimitKey =
  | 'prioritiesPerDay'
  | 'activeGoals'
  | 'badgesVisible'
  | 'progressHistoryDays'
  | 'chatMessagesPerDay'

export const COACH_LIMITS: Readonly<Record<PlanTier, Readonly<Record<CoachLimitKey, number>>> & Record<PlanTier, Readonly<Record<CoachFeature, boolean>>>> = {
  trial: {
    prioritiesPerDay: 2,
    activeGoals: 1,
    badgesVisible: 5,
    progressHistoryDays: 7,
    chatMessagesPerDay: 5,
    customHuddleTime: false,
    voice: false,
    weeklyPdf: false,
    hindi: false,
    widget: false,
    allPersonalities: false,
    weeklyEmail: true,
  },
  start: {
    prioritiesPerDay: 3,
    activeGoals: 2,
    badgesVisible: 15,
    progressHistoryDays: 30,
    chatMessagesPerDay: 20,
    customHuddleTime: true,
    voice: false,
    weeklyPdf: false,
    hindi: false,
    widget: true,
    allPersonalities: false,
    weeklyEmail: true,
  },
  growth: {
    prioritiesPerDay: 5,
    activeGoals: 5,
    badgesVisible: 30,
    progressHistoryDays: 90,
    chatMessagesPerDay: 100,
    customHuddleTime: true,
    voice: true,
    weeklyPdf: false,
    hindi: true,
    widget: true,
    allPersonalities: true,
    weeklyEmail: true,
  },
  commander: {
    prioritiesPerDay: 1_000_000, // "Unlimited" represented as a safety ceiling
    activeGoals: 1_000_000,
    badgesVisible: 50,
    progressHistoryDays: 3650,
    chatMessagesPerDay: 1_000_000,
    customHuddleTime: true,
    voice: true,
    weeklyPdf: true,
    hindi: true,
    widget: true,
    allPersonalities: true,
    weeklyEmail: true,
  },
}

export function coachLimit(plan: PlanTier, key: CoachLimitKey): number {
  return COACH_LIMITS[plan][key]
}

export function coachFeatureEnabled(plan: PlanTier, feature: CoachFeature): boolean {
  return COACH_LIMITS[plan][feature]
}

export function planRank(plan: PlanTier): number {
  return COACH_PLAN_ORDER.indexOf(plan)
}

/** Throws a 402 UPGRADE_REQUIRED AppError when `plan` cannot use `feature`. */
export function assertCoachFeature(plan: PlanTier, feature: CoachFeature): void {
  if (!coachFeatureEnabled(plan, feature)) {
    throw new AppError('PAYMENT_REQUIRED', `This Store Coach feature is not included in your current plan`, 402, {
      upgrade: 'required',
      feature,
      currentPlan: plan,
      requiredPlan: requiredPlanForFeature(feature),
    })
  }
}

export function requiredPlanForFeature(feature: CoachFeature): PlanTier {
  for (const tier of COACH_PLAN_ORDER) {
    if (COACH_LIMITS[tier][feature]) return tier
  }
  return 'commander'
}

export const COACH_FEATURE_PLAN_LABEL: Readonly<Record<CoachFeature, string>> = {
  customHuddleTime: 'Start',
  voice: 'Growth',
  weeklyPdf: 'Commander',
  hindi: 'Growth',
  widget: 'Start',
  allPersonalities: 'Growth',
  weeklyEmail: 'Start',
}

// ---------------------------------------------------------------------------
// Personalities
// ---------------------------------------------------------------------------

export const COACH_PERSONALITIES = ['PROFESSIONAL', 'MOTIVATIONAL', 'ANALYTICAL', 'CASUAL'] as const
export type CoachPersonality = (typeof COACH_PERSONALITIES)[number]

export type PersonalityProfile = Readonly<{
  id: CoachPersonality
  label: string
  tagline: string
  description: string
  /** System-prompt instruction block applied to every coach completion. */
  systemRules: string
  /** Sample greeting used in onboarding and the settings preview. */
  sampleGreeting: string
  emojiLevel: 0 | 1 | 2
}>

export const PERSONALITY_CATALOG: Readonly<Record<CoachPersonality, PersonalityProfile>> = {
  PROFESSIONAL: {
    id: 'PROFESSIONAL',
    label: 'Professional',
    tagline: 'Formal, friendly, data-focused',
    description: 'Concise business language with a steady, advisory tone. The default coach voice.',
    systemRules:
      'Adopt a professional advisor tone: formal but friendly, concise, and data-focused. Use clean business language, no emojis, and lead with the number or fact that matters most.',
    sampleGreeting: 'Good morning. Yesterday your store generated revenue from real orders. Let\u2019s review what the data says before we plan today.',
    emojiLevel: 0,
  },
  MOTIVATIONAL: {
    id: 'MOTIVATIONAL',
    label: 'Motivational',
    tagline: 'Enthusiastic, celebration-heavy',
    description: 'Enthusiastic encouragement that celebrates wins and keeps momentum high.',
    systemRules:
      'Adopt a motivational coach tone: enthusiastic, celebration-heavy, and encouraging. Celebrate wins first, use emojis moderately (1-2 per message), and always pair encouragement with a concrete next action.',
    sampleGreeting: 'Good morning, champion! You showed up today and that is already a win. Let\u2019s look at yesterday\u2019s numbers and build some momentum!',
    emojiLevel: 1,
  },
  ANALYTICAL: {
    id: 'ANALYTICAL',
    label: 'Analytical',
    tagline: 'Data-heavy, detail-oriented',
    description: 'Detailed analysis with numbers first, charts and precise breakdowns.',
    systemRules:
      'Adopt an analytical tone: data-heavy and precise. Structure answers around the numbers first, add short causal analysis, and quantify every claim you are allowed to make. No emojis.',
    sampleGreeting: 'Morning briefing. Yesterday: revenue, orders, and average order value against the trailing 7-day baseline. Key deltas follow.',
    emojiLevel: 0,
  },
  CASUAL: {
    id: 'CASUAL',
    label: 'Casual',
    tagline: 'Friendly and conversational',
    description: 'Simple, approachable language with a light touch and a few emojis.',
    systemRules:
      'Adopt a casual, friendly tone: conversational and simple language. Keep sentences short, use emojis freely but not excessively, and never talk down to the merchant.',
    sampleGreeting: 'Hey there! Great to see you. Quick look at yesterday, then we\u2019ll figure out today together.',
    emojiLevel: 2,
  },
}

export function personalityForPlan(plan: PlanTier): readonly CoachPersonality[] {
  if (plan === 'trial') return ['PROFESSIONAL']
  if (plan === 'start') return ['PROFESSIONAL', 'MOTIVATIONAL']
  return [...COACH_PERSONALITIES]
}

// ---------------------------------------------------------------------------
// Badge catalog (50 badges)
// ---------------------------------------------------------------------------

export const BADGE_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const
export type BadgeRarity = (typeof BADGE_RARITIES)[number]

export const BADGE_CATEGORIES = ['STREAK', 'REVENUE', 'GROWTH', 'ENGAGEMENT', 'SPECIAL'] as const
export type BadgeCategory = (typeof BADGE_CATEGORIES)[number]

export type BadgeDefinition = Readonly<{
  id: string
  category: BadgeCategory
  title: string
  description: string
  rarity: BadgeRarity
  /** Deterministic condition key evaluated by evaluateBadgeAwards. */
  condition: string
}>

export const BADGE_RARITY_LABEL: Readonly<Record<BadgeRarity, string>> = {
  COMMON: 'Common',
  UNCOMMON: 'Uncommon',
  RARE: 'Rare',
  EPIC: 'Epic',
  LEGENDARY: 'Legendary',
}

export const BADGE_CATALOG: readonly BadgeDefinition[] = [
  // --- Streaks (10) ---
  { id: 'FIRST_HUDDLE', category: 'STREAK', title: 'First Huddle', description: 'Viewed your first daily huddle', rarity: 'COMMON', condition: 'firstHuddleViewed' },
  { id: '3_DAY_STREAK', category: 'STREAK', title: 'Three in a Row', description: 'Viewed huddles 3 days in a row', rarity: 'COMMON', condition: 'streakDays >= 3' },
  { id: '7_DAY_STREAK', category: 'STREAK', title: 'One Week Strong', description: 'Viewed huddles 7 days in a row', rarity: 'UNCOMMON', condition: 'streakDays >= 7' },
  { id: '14_DAY_STREAK', category: 'STREAK', title: 'Fortnight Focus', description: 'Viewed huddles 14 days in a row', rarity: 'UNCOMMON', condition: 'streakDays >= 14' },
  { id: '30_DAY_STREAK', category: 'STREAK', title: 'Habit Formed', description: 'Viewed huddles 30 days in a row', rarity: 'UNCOMMON', condition: 'streakDays >= 30' },
  { id: '60_DAY_STREAK', category: 'STREAK', title: 'Sixty-Day Savant', description: 'Viewed huddles 60 days in a row', rarity: 'RARE', condition: 'streakDays >= 60' },
  { id: '100_DAY_STREAK', category: 'STREAK', title: 'Coach Master', description: 'Viewed huddles 100 days in a row', rarity: 'EPIC', condition: 'streakDays >= 100' },
  { id: 'STREAK_COMEBACK', category: 'STREAK', title: 'Comeback', description: 'Returned after a streak of 3+ ended', rarity: 'COMMON', condition: 'streakComeback' },
  { id: 'WEEKEND_WARRIOR', category: 'STREAK', title: 'Weekend Warrior', description: 'Viewed huddles on a Saturday or Sunday', rarity: 'COMMON', condition: 'weekendActive' },
  { id: 'EARLY_BIRD', category: 'STREAK', title: 'Early Bird', description: 'Viewed a morning huddle 10 times', rarity: 'COMMON', condition: 'morningHuddles >= 10' },
  // --- Revenue milestones (8) ---
  { id: 'FIRST_100_DAY', category: 'REVENUE', title: 'First $100 Day', description: 'First day with $100+ gross revenue', rarity: 'COMMON', condition: 'bestRevenueDay >= 100' },
  { id: 'FIRST_500_DAY', category: 'REVENUE', title: 'First $500 Day', description: 'First day with $500+ gross revenue', rarity: 'COMMON', condition: 'bestRevenueDay >= 500' },
  { id: 'FIRST_1000_DAY', category: 'REVENUE', title: 'First $1K Day', description: 'First day with $1,000+ gross revenue', rarity: 'COMMON', condition: 'bestRevenueDay >= 1000' },
  { id: 'FIRST_5000_DAY', category: 'REVENUE', title: 'First $5K Day', description: 'First day with $5,000+ gross revenue', rarity: 'RARE', condition: 'bestRevenueDay >= 5000' },
  { id: 'BEST_DAY_EVER', category: 'REVENUE', title: 'Best Day Ever', description: 'Set a new single-day revenue record', rarity: 'COMMON', condition: 'newRevenueRecord' },
  { id: 'WEEK_10K', category: 'REVENUE', title: 'Ten-K Week', description: 'Week with $10,000+ gross revenue', rarity: 'RARE', condition: 'bestWeekRevenue >= 10000' },
  { id: 'MONTH_50K', category: 'REVENUE', title: 'Fifty-K Month', description: 'Month with $50,000+ gross revenue', rarity: 'RARE', condition: 'bestMonthRevenue >= 50000' },
  { id: 'QUARTER_100K', category: 'REVENUE', title: 'Six-Figure Quarter', description: 'Quarter with $100,000+ gross revenue', rarity: 'LEGENDARY', condition: 'bestQuarterRevenue >= 100000' },
  // --- Growth champions (10) ---
  { id: '10_PERCENT_GROWTH', category: 'GROWTH', title: 'Growing Steadily', description: '10%+ revenue growth vs the previous week', rarity: 'COMMON', condition: 'weeklyGrowthPct >= 10' },
  { id: '25_PERCENT_GROWTH', category: 'GROWTH', title: 'Quarter Leap', description: '25%+ revenue growth vs the previous week', rarity: 'UNCOMMON', condition: 'weeklyGrowthPct >= 25' },
  { id: '50_PERCENT_GROWTH', category: 'GROWTH', title: 'Half Again', description: '50%+ revenue growth vs the previous week', rarity: 'RARE', condition: 'weeklyGrowthPct >= 50' },
  { id: 'FIRST_100_CUSTOMERS', category: 'GROWTH', title: '100 Customers', description: '100 lifetime customers', rarity: 'COMMON', condition: 'totalCustomers >= 100' },
  { id: 'FIRST_1000_CUSTOMERS', category: 'GROWTH', title: '1,000 Customers', description: '1,000 lifetime customers', rarity: 'UNCOMMON', condition: 'totalCustomers >= 1000' },
  { id: 'HIGH_RETENTION', category: 'GROWTH', title: 'Retention Rockstar', description: '30%+ repeat purchase rate', rarity: 'COMMON', condition: 'repeatRatePct >= 30' },
  { id: 'LOW_CHURN', category: 'GROWTH', title: 'Churn Crusher', description: 'Reduced churn by 20%+', rarity: 'UNCOMMON', condition: 'churnReductionPct >= 20' },
  { id: 'AOV_UP', category: 'GROWTH', title: 'Bigger Baskets', description: 'AOV increased 10%+ vs the previous period', rarity: 'COMMON', condition: 'aovIncreasePct >= 10' },
  { id: 'CROSS_SELL_MASTER', category: 'GROWTH', title: 'Cross-Sell Master', description: 'Approved a cross-sell recommendation', rarity: 'UNCOMMON', condition: 'crossSellApproved' },
  { id: 'VIP_BUILDER', category: 'GROWTH', title: 'VIP Builder', description: 'Tagged 10 VIP customers', rarity: 'UNCOMMON', condition: 'vipCustomers >= 10' },
  // --- Coach engagement (12) ---
  { id: 'FIRST_GOAL', category: 'ENGAGEMENT', title: 'Goal Setter', description: 'Set your first goal', rarity: 'COMMON', condition: 'goalsCreated >= 1' },
  { id: 'GOAL_ACHIEVER', category: 'ENGAGEMENT', title: 'Goal Achiever', description: 'Achieved a weekly goal', rarity: 'COMMON', condition: 'goalsAchieved >= 1' },
  { id: 'GOAL_MASTER', category: 'ENGAGEMENT', title: 'Goal Master', description: 'Achieved 5 goals', rarity: 'RARE', condition: 'goalsAchieved >= 5' },
  { id: 'CHAT_STARTER', category: 'ENGAGEMENT', title: 'Chat Starter', description: 'Sent your first chat message', rarity: 'COMMON', condition: 'chatMessages >= 1' },
  { id: 'CURIOUS_MIND', category: 'ENGAGEMENT', title: 'Curious Mind', description: 'Asked 20 chat questions', rarity: 'COMMON', condition: 'chatMessages >= 20' },
  { id: 'ACTION_TAKER', category: 'ENGAGEMENT', title: 'Action Taker', description: 'Completed 10 priorities', rarity: 'COMMON', condition: 'prioritiesCompleted >= 10' },
  { id: 'ORGANIZED', category: 'ENGAGEMENT', title: 'Fully Organized', description: 'Completed every priority in one day', rarity: 'COMMON', condition: 'allPrioritiesDoneDay' },
  { id: 'REVIEWER', category: 'ENGAGEMENT', title: 'Reviewer', description: 'Read 4 weekly reviews', rarity: 'COMMON', condition: 'reviewsRead >= 4' },
  { id: 'OPTIMIZER', category: 'ENGAGEMENT', title: 'Optimizer', description: 'Adjusted coach preferences', rarity: 'COMMON', condition: 'preferencesAdjusted' },
  { id: 'ONBOARDED', category: 'ENGAGEMENT', title: 'Onboarded', description: 'Completed Store Coach onboarding', rarity: 'COMMON', condition: 'onboardingCompleted' },
  { id: 'PERSONALITY_EXPLORER', category: 'ENGAGEMENT', title: 'Personality Explorer', description: 'Tried more than one coach personality', rarity: 'UNCOMMON', condition: 'personalitiesTried >= 2' },
  { id: 'FEATURE_EXPLORER', category: 'ENGAGEMENT', title: 'Feature Explorer', description: 'Used every Store Coach feature', rarity: 'UNCOMMON', condition: 'allCoachFeaturesUsed' },
  // --- Special (10) ---
  { id: 'BETA_TESTER', category: 'SPECIAL', title: 'Beta Tester', description: 'Used the app during beta', rarity: 'COMMON', condition: 'betaUser' },
  { id: 'EARLY_ADOPTER', category: 'SPECIAL', title: 'Early Adopter', description: 'Signed up in the first month', rarity: 'UNCOMMON', condition: 'earlyAdopter' },
  { id: 'FEEDBACK_HERO', category: 'SPECIAL', title: 'Feedback Hero', description: 'Provided product feedback', rarity: 'COMMON', condition: 'feedbackGiven' },
  { id: 'REFERRER', category: 'SPECIAL', title: 'Referrer', description: 'Referred another merchant', rarity: 'UNCOMMON', condition: 'referred' },
  { id: 'ALL_ROUNDER', category: 'SPECIAL', title: 'All-Rounder', description: 'Uses all app modules', rarity: 'RARE', condition: 'allModulesUsed' },
  { id: 'ZERO_STOCKOUT', category: 'SPECIAL', title: 'Zero Stockout', description: 'A full month without stockouts', rarity: 'UNCOMMON', condition: 'zeroStockoutMonth' },
  { id: 'COMEBACK_KID', category: 'SPECIAL', title: 'Comeback Kid', description: 'Returned after churning', rarity: 'COMMON', condition: 'comebackAfterChurn' },
  { id: 'HIGH_ROLLER', category: 'SPECIAL', title: 'High Roller', description: 'Approved 10 recommendations', rarity: 'UNCOMMON', condition: 'recommendationsApproved >= 10' },
  { id: 'AUTOMATION_PRO', category: 'SPECIAL', title: 'Automation Pro', description: 'Created 5 workflows', rarity: 'UNCOMMON', condition: 'workflowsCreated >= 5' },
  { id: 'COMMANDER_LEVEL', category: 'SPECIAL', title: 'Commander Level', description: 'Upgraded to the Commander plan', rarity: 'EPIC', condition: 'commanderPlan' },
]

export function badgeById(id: string): BadgeDefinition | undefined {
  return BADGE_CATALOG.find((badge) => badge.id === id)
}

export function badgesVisibleForPlan(plan: PlanTier): number {
  return coachLimit(plan, 'badgesVisible')
}

/**
 * Deterministic signals computed from real store rows. Every field defaults
 * to a zero/absent value so badge evaluation can run even on sparse stores.
 */
export type BadgeSignals = Readonly<{
  firstHuddleViewed?: boolean
  streakDays?: number
  streakComeback?: boolean
  weekendActive?: boolean
  morningHuddles?: number
  bestRevenueDay?: number
  newRevenueRecord?: boolean
  bestWeekRevenue?: number
  bestMonthRevenue?: number
  bestQuarterRevenue?: number
  weeklyGrowthPct?: number
  totalCustomers?: number
  repeatRatePct?: number
  churnReductionPct?: number
  aovIncreasePct?: number
  crossSellApproved?: boolean
  vipCustomers?: number
  goalsCreated?: number
  goalsAchieved?: number
  chatMessages?: number
  prioritiesCompleted?: number
  allPrioritiesDoneDay?: boolean
  reviewsRead?: number
  preferencesAdjusted?: boolean
  onboardingCompleted?: boolean
  personalitiesTried?: number
  allCoachFeaturesUsed?: boolean
  betaUser?: boolean
  earlyAdopter?: boolean
  feedbackGiven?: boolean
  referred?: boolean
  allModulesUsed?: boolean
  zeroStockoutMonth?: boolean
  comebackAfterChurn?: boolean
  recommendationsApproved?: number
  workflowsCreated?: number
  commanderPlan?: boolean
}>

function signalNumber(signals: BadgeSignals, key: string): number {
  const value = (signals as unknown as Readonly<Record<string, unknown>>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function signalBoolean(signals: BadgeSignals, key: string): boolean {
  const value = (signals as unknown as Readonly<Record<string, unknown>>)[key]
  return value === true
}

/** Evaluates every catalog condition; returns badges earned but not yet held. */
export function evaluateBadgeAwards(signals: BadgeSignals, earnedIds: ReadonlySet<string>): readonly BadgeDefinition[] {
  const earned = new Set(earnedIds)
  return BADGE_CATALOG.filter((badge) => !earned.has(badge.id) && evaluateBadgeCondition(badge.condition, signals))
}

export function evaluateBadgeCondition(condition: string, signals: BadgeSignals): boolean {
  const [left, operator, right] = parseCondition(condition)
  switch (operator) {
    case '>=': return signalNumber(signals, left) >= Number(right)
    case '==': return signalNumber(signals, left) === Number(right)
    case 'FLAG': return signalBoolean(signals, left)
    default: return false
  }
}

function parseCondition(condition: string): readonly [string, '>=' | '==' | 'FLAG', string] {
  const match = condition.match(/^(\w+)\s*(>=|==)\s*([\d.]+)$/)
  if (match) return [match[1] ?? '', match[2] as '>=' | '==', match[3] ?? '']
  return [condition, 'FLAG', '']
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export type CoachStreak = Readonly<{ currentStreak: number; longestStreak: number; lastActiveDate: string | null }>

/**
 * Computes the streak after a huddle view on `activeDay` (ISO yyyy-mm-dd in
 * the merchant's timezone). A view on the same day does not extend the
 * streak; a gap of more than one day resets it.
 */
export function streakAfterView(previous: CoachStreak | null, activeDay: string): CoachStreak {
  const last = previous?.lastActiveDate ?? null
  const current = previous?.currentStreak ?? 0
  const longest = previous?.longestStreak ?? 0
  if (last === activeDay) return { currentStreak: current, longestStreak: longest, lastActiveDate: activeDay }
  const consecutive = last !== null && daysBetween(last, activeDay) === 1
  const next = consecutive ? current + 1 : 1
  return { currentStreak: next, longestStreak: Math.max(longest, next), lastActiveDate: activeDay }
}

/** True when a store viewed a huddle after its previous streak ended at 3+. */
export function isStreakComeback(previous: CoachStreak | null, activeDay: string): boolean {
  if (!previous || !previous.lastActiveDate) return false
  return previous.currentStreak >= 3 && daysBetween(previous.lastActiveDate, activeDay) > 1
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime()
  const to = new Date(`${toIso}T00:00:00Z`).getTime()
  return Math.round((to - from) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Health score
// ---------------------------------------------------------------------------

export type HealthFactors = Readonly<{
  huddleViewRate: number // 0..1 — viewed huddles / days with a huddle
  priorityCompletionRate: number // 0..1
  goalsActive: number
  chatEngagement: number // 0..1 — chat days / active days
  streakDays: number
  reviewsRead: number
  hasPreferences: boolean
}>

/** Weighted 0-100 engagement score. Missing data degrades gracefully. */
export function calculateHealthScore(factors: HealthFactors): number {
  const clamp = (value: number): number => Math.max(0, Math.min(1, value))
  const huddle = clamp(factors.huddleViewRate) * 25
  const priorities = clamp(factors.priorityCompletionRate) * 20
  const goals = Math.min(factors.goalsActive, 3) / 3 * 15
  const chat = clamp(factors.chatEngagement) * 15
  const streak = Math.min(factors.streakDays, 7) / 7 * 15
  const reviews = Math.min(factors.reviewsRead, 4) / 4 * 5
  const preferences = (factors.hasPreferences ? 1 : 0) * 5
  return Math.round(huddle + priorities + goals + chat + streak + reviews + preferences)
}

export function healthScoreLabel(score: number | null): { label: string; tone: 'good' | 'ok' | 'low' } {
  if (score === null) return { label: 'No activity yet', tone: 'low' }
  if (score >= 70) return { label: 'Highly engaged', tone: 'good' }
  if (score >= 40) return { label: 'Getting into rhythm', tone: 'ok' }
  return { label: 'Just getting started', tone: 'low' }
}

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

export const PRIORITY_CATEGORIES = ['HIGH_IMPACT', 'QUICK_WIN', 'OPPORTUNITY'] as const
export type PriorityCategory = (typeof PRIORITY_CATEGORIES)[number]

export type PriorityCategoryMeta = Readonly<{ label: string; description: string; tone: 'red' | 'green' | 'amber' }>

export const PRIORITY_CATEGORY_META: Readonly<Record<PriorityCategory, PriorityCategoryMeta>> = {
  HIGH_IMPACT: { label: 'High Impact', description: 'Churn risks, revenue leaks, and urgent issues', tone: 'red' },
  QUICK_WIN: { label: 'Quick Win', description: 'Easy tasks with an immediate benefit', tone: 'green' },
  OPPORTUNITY: { label: 'Opportunity', description: 'Growth potential and trends worth leveraging', tone: 'amber' },
}

export type PriorityCandidate = Readonly<{
  category: PriorityCategory
  title: string
  description: string
  impactValue: number
  impactCurrency: string
  impactLabel: string
  timeEstimateMinutes: number
  actionType: string
  actionPayload: Readonly<Record<string, string | number | boolean>>
  confidence: number
}>

/**
 * Impact score drives ordering: impact value (log-scaled so $10k isn't 100x
 * a $100 fix in a way that buries urgent-but-cheap actions) plus confidence.
 */
export function priorityImpactScore(candidate: PriorityCandidate): number {
  const magnitude = Math.log10(Math.max(Math.abs(candidate.impactValue), 1) + 1)
  return magnitude * 10 + candidate.confidence * 5
}

export function sortPriorityCandidates(candidates: readonly PriorityCandidate[]): readonly PriorityCandidate[] {
  return [...candidates].sort((a, b) => priorityImpactScore(b) - priorityImpactScore(a))
}

/** Caps candidates to the plan limit, always keeping at least one per category present in the input. */
export function capPriorityCandidates(candidates: readonly PriorityCandidate[], plan: PlanTier): readonly PriorityCandidate[] {
  const limit = coachLimit(plan, 'prioritiesPerDay')
  const sorted = sortPriorityCandidates(candidates)
  if (sorted.length <= limit) return sorted
  const picked: PriorityCandidate[] = []
  const categorySet = new Set<PriorityCategory>()
  for (const candidate of sorted) {
    if (picked.length >= limit) break
    if (!categorySet.has(candidate.category)) {
      picked.push(candidate)
      categorySet.add(candidate.category)
    }
  }
  // Backfill remaining slots in impact order.
  for (const candidate of sorted) {
    if (picked.length >= limit) break
    if (!picked.includes(candidate)) picked.push(candidate)
  }
  return sortPriorityCandidates(picked)
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const GOAL_TYPES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM'] as const
export type CoachGoalType = (typeof GOAL_TYPES)[number]
export const GOAL_METRICS = ['REVENUE', 'ORDERS', 'CUSTOMERS', 'AOV', 'RETENTION', 'CUSTOM'] as const
export type CoachGoalMetric = (typeof GOAL_METRICS)[number]
export const GOAL_STATUSES = ['ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED'] as const
export type CoachGoalStatus = (typeof GOAL_STATUSES)[number]

export type GoalProgressView = Readonly<{
  goalId: string
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

/** Feasibility compares the required pace against the store's recent trend. */
export function calculateGoalFeasibility(target: number, current: number, daysTotal: number, recentDailyRate: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  const remaining = Math.max(target - current, 0)
  const requiredPerDay = daysTotal > 0 ? remaining / daysTotal : Number.POSITIVE_INFINITY
  if (recentDailyRate >= requiredPerDay) return 'HIGH'
  if (recentDailyRate >= requiredPerDay * 0.6) return 'MEDIUM'
  return 'LOW'
}

export function goalProgressView(goal: Readonly<{ current: number; target: number; startDate: string; endDate: string; feasibility?: 'HIGH' | 'MEDIUM' | 'LOW' }>, todayIso: string): GoalProgressView {
  const start = new Date(`${goal.startDate}T00:00:00Z`).getTime()
  const end = new Date(`${goal.endDate}T00:00:00Z`).getTime()
  const today = new Date(`${todayIso}T00:00:00Z`).getTime()
  const daysTotal = Math.max(Math.round((end - start) / 86_400_000), 1)
  const daysElapsed = Math.max(Math.min(Math.round((today - start) / 86_400_000), daysTotal), 1)
  const daysRemaining = Math.max(daysTotal - daysElapsed, 0)
  const progressPct = goal.target > 0 ? Math.min((goal.current / goal.target) * 100, 100) : 0
  // Linear expectation: by day N of T you should be at N/T of the target.
  const expectedProgressPct = (daysElapsed / daysTotal) * 100
  const delta = progressPct - expectedProgressPct
  const tolerance = 5
  const pace: GoalProgressView['pace'] = delta >= tolerance ? 'AHEAD' : delta <= -tolerance ? 'BEHIND' : 'ON_TRACK'
  const actualDailyPace = goal.current / Math.max(daysElapsed, 1)
  const requiredDailyPace = Math.max(goal.target - goal.current, 0) / Math.max(daysRemaining, 1)
  return {
    goalId: '',
    current: goal.current,
    target: goal.target,
    progressPct: Math.round(progressPct * 10) / 10,
    daysElapsed,
    daysTotal,
    daysRemaining,
    pace,
    requiredDailyPace: Math.round(requiredDailyPace * 100) / 100,
    actualDailyPace: Math.round(actualDailyPace * 100) / 100,
    feasibility: goal.feasibility ?? 'MEDIUM',
  }
}

// ---------------------------------------------------------------------------
// Grounded prompts
// ---------------------------------------------------------------------------

export type CoachEvidence = {
  storeName: string
  currency: string
  yesterdayRevenue: number
  yesterdayOrders: number
  yesterdayAov: number
  yesterdayNewCustomers: number
  trailing7dRevenue: number
  trailing7dOrders: number
  trailing7dRevenueChangePct: number
  trailing7dOrdersChangePct: number
  trailing30dRevenue: number
  trailing30dOrders: number
  aov30d: number
  bestDayRevenue: number
  topSignal: string
  openPriorities: readonly string[]
  activeGoal: string | null
  streakDays: number
}

export function emptyCoachEvidence(storeName: string, currency = 'USD'): CoachEvidence {
  return {
    storeName,
    currency,
    yesterdayRevenue: 0,
    yesterdayOrders: 0,
    yesterdayAov: 0,
    yesterdayNewCustomers: 0,
    trailing7dRevenue: 0,
    trailing7dOrders: 0,
    trailing7dRevenueChangePct: 0,
    trailing7dOrdersChangePct: 0,
    trailing30dRevenue: 0,
    trailing30dOrders: 0,
    aov30d: 0,
    bestDayRevenue: 0,
    topSignal: 'not enough synced order history yet',
    openPriorities: [],
    activeGoal: null,
    streakDays: 0,
  }
}

export function evidenceNumberSet(evidence: CoachEvidence): readonly number[] {
  return [
    evidence.yesterdayRevenue,
    evidence.yesterdayOrders,
    evidence.yesterdayAov,
    evidence.yesterdayNewCustomers,
    evidence.trailing7dRevenue,
    evidence.trailing7dOrders,
    evidence.trailing7dRevenueChangePct,
    evidence.trailing7dOrdersChangePct,
    evidence.trailing30dRevenue,
    evidence.trailing30dOrders,
    evidence.aov30d,
    evidence.bestDayRevenue,
    evidence.streakDays,
  ]
}

function formatEvidence(evidence: CoachEvidence): string {
  return [
    `Store: ${evidence.storeName}`,
    `Currency: ${evidence.currency}`,
    `Yesterday: revenue ${evidence.yesterdayRevenue}, orders ${evidence.yesterdayOrders}, AOV ${evidence.yesterdayAov}, new customers ${evidence.yesterdayNewCustomers}`,
    `Trailing 7 days: revenue ${evidence.trailing7dRevenue} (${evidence.trailing7dRevenueChangePct}% vs prior 7), orders ${evidence.trailing7dOrders} (${evidence.trailing7dOrdersChangePct}%)`,
    `Trailing 30 days: revenue ${evidence.trailing30dRevenue}, orders ${evidence.trailing30dOrders}, AOV ${evidence.aov30d}`,
    `Best single day revenue: ${evidence.bestDayRevenue}`,
    `Strongest signal in synced data: ${evidence.topSignal}`,
    `Open priorities today: ${evidence.openPriorities.length === 0 ? 'none yet' : evidence.openPriorities.join('; ')}`,
    `Active goal: ${evidence.activeGoal ?? 'none'}`,
    `Current huddle streak: ${evidence.streakDays}`,
  ].join('\n')
}

export const HUDDLE_JSON_KEYS = ['greeting', 'yesterdaySnapshot', 'todayPreview', 'keyInsight', 'reviewMinutes'] as const

export function buildHuddlePrompt(evidence: CoachEvidence, personality: CoachPersonality, language: 'en' | 'hi'): { system: string; user: string } {
  const profile = PERSONALITY_CATALOG[personality]
  const system = [
    'You are Store Coach, the AI business advisor inside ProfitPilot. You write a short daily huddle briefing for a Shopify merchant.',
    profile.systemRules,
    language === 'hi' ? 'Respond in Hindi (Devanagari script is acceptable but Latin transliteration is preferred).' : 'Respond in English.',
    'GROUNDING RULES (non-negotiable):',
    '1. Every number you write MUST come from the evidence block below. Never invent, estimate, or extrapolate a number.',
    '2. If the evidence shows zeros or is empty, say so honestly and focus on what to do first (sync orders, set a goal).',
    '3. Never mention email addresses, phone numbers, customer names, or other PII.',
    '4. Do not promise outcomes; frame advice as suggestions.',
    'Respond with STRICT JSON only, with exactly these keys:',
    '{"greeting": "...", "yesterdaySnapshot": "...", "todayPreview": "...", "keyInsight": "...", "reviewMinutes": 2}',
    'reviewMinutes is an integer between 1 and 5 (your estimated reading time).',
  ].join('\n')
  const user = `EVIDENCE (real store data, use only these numbers):\n${formatEvidence(evidence)}\n\nWrite today's huddle.`
  return { system, user }
}

export function buildPrioritiesPrompt(evidence: CoachEvidence, personality: CoachPersonality, language: 'en' | 'hi'): { system: string; user: string } {
  const profile = PERSONALITY_CATALOG[personality]
  const system = [
    'You are Store Coach, the AI business advisor inside ProfitPilot. You propose today\u2019s action priorities for a Shopify merchant.',
    profile.systemRules,
    language === 'hi' ? 'Respond in Hindi.' : 'Respond in English.',
    'GROUNDING RULES (non-negotiable):',
    '1. Every number you write MUST come from the evidence block. Impact values must be one of the provided evidence numbers; when no revenue number supports an action, use impact_value 0 and explain in the description.',
    '2. Base priorities ONLY on what the evidence actually shows (revenue changes, order changes, open issues). Do not invent stockouts, churn, or campaigns.',
    '3. Categories: HIGH_IMPACT (churn risk, revenue leaks, urgent issues), QUICK_WIN (easy, fast benefit), OPPORTUNITY (growth potential, trends).',
    '4. No PII. No promised outcomes.',
    'Respond with STRICT JSON: an object with a "priorities" array. Each item:',
    '{"category": "HIGH_IMPACT|QUICK_WIN|OPPORTUNITY", "title": "...", "description": "...", "impact_value": 0, "impact_currency": "USD", "impact_label": "...", "time_estimate_minutes": 15, "action_type": "review|navigate|goal", "action_payload": {}}',
    'Return between 3 and 9 priorities spread across all three categories when evidence allows; otherwise return what the evidence supports (even an empty array).',
  ].join('\n')
  const user = `EVIDENCE (real store data, use only these numbers):\n${formatEvidence(evidence)}\n\nPropose today's priorities.`
  return { system, user }
}

export function buildGoalSuggestionsPrompt(evidence: CoachEvidence, personality: CoachPersonality, language: 'en' | 'hi'): { system: string; user: string } {
  const profile = PERSONALITY_CATALOG[personality]
  const system = [
    'You are Store Coach, the AI business advisor inside ProfitPilot. You suggest weekly goals for a Shopify merchant.',
    profile.systemRules,
    language === 'hi' ? 'Respond in Hindi.' : 'Respond in English.',
    'GROUNDING RULES (non-negotiable):',
    '1. Target values must be derived arithmetically from the evidence numbers (e.g. trailing 7-day revenue plus 10%). Write the derivation in "rationale".',
    '2. Base suggestions on revenue, orders, customers, AOV, or retention signals that exist in the evidence.',
    '3. Assign feasibility: HIGH (very achievable), MEDIUM (stretch), LOW (ambitious) relative to the trailing numbers.',
    '4. No PII. No promised outcomes.',
    'Respond with STRICT JSON: an object with a "suggestions" array. Each item:',
    '{"title": "...", "description": "...", "metric": "REVENUE|ORDERS|CUSTOMERS|AOV|RETENTION", "target_value": 0, "currency": "USD", "feasibility": "HIGH|MEDIUM|LOW", "rationale": "..."}',
    'Return exactly 3 suggestions.',
  ].join('\n')
  const user = `EVIDENCE (real store data, use only these numbers):\n${formatEvidence(evidence)}\n\nSuggest 3 goals for the coming week.`
  return { system, user }
}

export function buildChatSystemPrompt(evidence: CoachEvidence, personality: CoachPersonality, language: 'en' | 'hi', plan: PlanTier): string {
  const profile = PERSONALITY_CATALOG[personality]
  return [
    'You are Store Coach, the AI business advisor inside ProfitPilot, in a chat with a Shopify merchant.',
    profile.systemRules,
    language === 'hi' ? 'Respond in Hindi.' : 'Respond in English.',
    `The merchant's plan tier is ${plan.toUpperCase()}. Never discuss features as if they are available when they are not on this tier.`,
    'GROUNDING RULES (non-negotiable):',
    '1. Every number you write MUST come from the evidence block below. If asked for a number that is not in the evidence, say you do not have it yet and suggest syncing that data instead of guessing.',
    '2. Never mention email addresses, phone numbers, customer names, or other PII.',
    '3. Give actionable suggestions tied to the evidence, and point to the relevant place in the app (e.g. Analytics, Automation, Recommendations).',
    '4. Keep answers concise (under 220 words). Do not promise outcomes.',
    `EVIDENCE (real store data, refreshed for this conversation):\n${formatEvidence(evidence)}`,
  ].join('\n')
}

export function buildWeeklyReviewPrompt(evidence: CoachEvidence, personality: CoachPersonality, language: 'en' | 'hi'): { system: string; user: string } {
  const profile = PERSONALITY_CATALOG[personality]
  const system = [
    'You are Store Coach, the AI business advisor inside ProfitPilot. You write the Sunday weekly review for a Shopify merchant.',
    profile.systemRules,
    language === 'hi' ? 'Respond in Hindi.' : 'Respond in English.',
    'GROUNDING RULES (non-negotiable):',
    '1. Every number you write MUST come from the evidence block below.',
    '2. Structure: week wins, key metrics vs the previous week, AI-generated learnings, next week focus, and a suggested goal for next week.',
    '3. No PII. No promised outcomes.',
    'Respond with STRICT JSON with exactly these keys:',
    '{"subject": "...", "weekWins": ["..."], "metrics": [{"label": "...", "value": "...", "change": "..."}], "learnings": ["..."], "nextWeekFocus": ["..."], "suggestedGoal": {"title": "...", "description": "..."}}',
  ].join('\n')
  const user = `EVIDENCE (real store data, use only these numbers):\n${formatEvidence(evidence)}\n\nWrite this week's review.`
  return { system, user }
}

// ---------------------------------------------------------------------------
// Structured output parsing + grounded number firewall
// ---------------------------------------------------------------------------

export function parseHuddleJson(text: string, evidence: CoachEvidence): Readonly<Record<string, unknown>> {
  const json = parseJsonBlock(text)
  for (const key of HUDDLE_JSON_KEYS) {
    if (typeof json[key] !== 'string' && key !== 'reviewMinutes') throw new AppError('VALIDATION_ERROR', `Huddle output is missing the ${key} field`, 502)
  }
  const minutes = Number(json.reviewMinutes)
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 5) throw new AppError('VALIDATION_ERROR', 'Huddle reviewMinutes must be between 1 and 5', 502)
  const narrative = HUDDLE_JSON_KEYS.filter((key) => key !== 'reviewMinutes').map((key) => String(json[key])).join(' ')
  assertNumbersGrounded(narrative, evidenceNumberSet(evidence))
  return json
}

export function parsePrioritiesJson(text: string, evidence: CoachEvidence): readonly PriorityCandidate[] {
  const json = parseJsonBlock(text)
  const raw = json.priorities
  if (raw === undefined) throw new AppError('VALIDATION_ERROR', 'Priorities output is missing the priorities array', 502)
  if (!Array.isArray(raw)) throw new AppError('VALIDATION_ERROR', 'Priorities output must be an array', 502)
  return raw.slice(0, 12).map((item, index) => {
    const record = asRecord(item)
    const category = String(record.category ?? '').toUpperCase()
    if (!PRIORITY_CATEGORIES.includes(category as PriorityCategory)) throw new AppError('VALIDATION_ERROR', `Priority ${index + 1} has an invalid category`, 502)
    const title = String(record.title ?? '').trim()
    const description = String(record.description ?? '').trim()
    if (!title || !description) throw new AppError('VALIDATION_ERROR', `Priority ${index + 1} is missing a title or description`, 502)
    const impactValue = Number(record.impact_value ?? 0)
    if (!Number.isFinite(impactValue) || impactValue < 0) throw new AppError('VALIDATION_ERROR', `Priority ${index + 1} has an invalid impact value`, 502)
    if (impactValue > 0 && !evidenceNumberSet(evidence).some((value) => normalizeNumber(value) === normalizeNumber(impactValue))) {
      throw new AppError('VALIDATION_ERROR', `Priority ${index + 1} introduced an unsupported impact number: ${impactValue}`, 502)
    }
    assertNumbersGrounded(`${title} ${description} ${String(record.impact_label ?? '')}`, evidenceNumberSet(evidence))
    const timeEstimateMinutes = Math.max(1, Math.min(Number(record.time_estimate_minutes ?? 15), 240))
    return {
      category: category as PriorityCategory,
      title,
      description,
      impactValue,
      impactCurrency: String(record.impact_currency ?? evidence.currency).toUpperCase(),
      impactLabel: String(record.impact_label ?? ''),
      timeEstimateMinutes: Number.isFinite(timeEstimateMinutes) ? timeEstimateMinutes : 15,
      actionType: String(record.action_type ?? 'review'),
      actionPayload: asRecord(record.action_payload) as Readonly<Record<string, string | number | boolean>>,
      confidence: 1,
    }
  })
}

export function parseGoalSuggestionsJson(text: string, evidence: CoachEvidence): readonly GoalSuggestion[] {
  const json = parseJsonBlock(text)
  const raw = json.suggestions
  if (!Array.isArray(raw)) throw new AppError('VALIDATION_ERROR', 'Goal suggestions output must be an array', 502)
  return raw.slice(0, 3).map((item, index) => {
    const record = asRecord(item)
    const title = String(record.title ?? '').trim()
    const description = String(record.description ?? '').trim()
    if (!title || !description) throw new AppError('VALIDATION_ERROR', `Suggestion ${index + 1} is missing a title or description`, 502)
    const metric = String(record.metric ?? 'REVENUE').toUpperCase()
    if (!GOAL_METRICS.includes(metric as CoachGoalMetric)) throw new AppError('VALIDATION_ERROR', `Suggestion ${index + 1} has an invalid metric`, 502)
    const targetValue = Number(record.target_value ?? 0)
    if (!Number.isFinite(targetValue) || targetValue < 0) throw new AppError('VALIDATION_ERROR', `Suggestion ${index + 1} has an invalid target`, 502)
    const feasibility = String(record.feasibility ?? 'MEDIUM').toUpperCase()
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(feasibility)) throw new AppError('VALIDATION_ERROR', `Suggestion ${index + 1} has an invalid feasibility`, 502)
    assertNumbersGrounded(`${title} ${description} ${String(record.rationale ?? '')}`, evidenceNumberSet(evidence))
    return { title, description, metric: metric as CoachGoalMetric, targetValue, currency: String(record.currency ?? evidence.currency).toUpperCase(), feasibility: feasibility as 'HIGH' | 'MEDIUM' | 'LOW', rationale: String(record.rationale ?? '') }
  })
}

export type GoalSuggestion = Readonly<{
  title: string
  description: string
  metric: CoachGoalMetric
  targetValue: number
  currency: string
  feasibility: 'HIGH' | 'MEDIUM' | 'LOW'
  rationale: string
}>

export function parseWeeklyReviewJson(text: string, evidence: CoachEvidence): Readonly<Record<string, unknown>> {
  const json = parseJsonBlock(text)
  for (const key of ['subject', 'weekWins', 'metrics', 'learnings', 'nextWeekFocus', 'suggestedGoal'] as const) {
    if (json[key] === undefined) throw new AppError('VALIDATION_ERROR', `Weekly review output is missing the ${key} field`, 502)
  }
  const narrative = [String(json.subject ?? ''), ...stringArray(json.weekWins), ...stringArray(json.learnings), ...stringArray(json.nextWeekFocus)].join(' ')
  assertNumbersGrounded(narrative, evidenceNumberSet(evidence))
  return json
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function parseJsonBlock(text: string): Readonly<Record<string, unknown>> {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? (fenced[1] ?? trimmed) : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AppError('VALIDATION_ERROR', 'AI response did not contain a JSON object', 502)
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
    return asRecord(parsed)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'AI response contained malformed JSON', 502)
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}
}

function normalizeNumber(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Percentage tokens the coach may use to frame *relative* changes without
 * introducing a hard statistic (e.g. "a 10% lift" while the absolute numbers
 * are still evidence-grounded). Anything else must match the evidence set.
 */
const ALLOWED_PERCENT_TOKENS = new Set([5, 10, 15, 20, 25, 30, 40, 50, 75, 100])

/**
 * The coach language firewall: every numeric token in a coach output must
 * appear in the provided evidence set (zero is always allowed for honest
 * "nothing yet" statements). Percent signs with standard round percentages
 * are permitted so relative framing does not need a fabricated statistic;
 * absolute counts and currency values remain strictly evidence-bound.
 */
export function assertNumbersGrounded(text: string, evidenceNumbers: readonly number[]): void {
  const allowed = new Set([0, ...evidenceNumbers].map(normalizeNumber))
  // Percentage tokens are allowed when they frame a relative change with a
  // standard round number; the absolute figures still must match evidence.
  const percentageFree = text.replace(/\b\d[\d,]*%(\.[\d]+%)?/g, (token) => {
    const value = Number(token.replace(/%/g, '').replace(/,/g, ''))
    return ALLOWED_PERCENT_TOKENS.has(value) ? '' : token
  })
  // Time-window phrases ("the last 7 days") describe the span, not a store
  // statistic, so they are not treated as fabricated quantities.
  const timePhraseFree = percentageFree.replace(/\b\d[\d,]*\s+(?:day|days|week|weeks|month|months|quarter|quarters|hour|hours|minute|minutes|point|points)\b/gi, '')
  for (const candidate of extractNumbers(timePhraseFree)) {
    if (!allowed.has(normalizeNumber(candidate))) {
      throw new AppError('VALIDATION_ERROR', `AI response introduced an unsupported number: ${candidate}`, 502, { candidate })
    }
  }
}

export function assertCoachChatResponse(text: string, evidence: CoachEvidence): string {
  const trimmed = text.trim()
  if (!trimmed) throw new AppError('VALIDATION_ERROR', 'AI response is empty', 502)
  if (trimmed.length > 2_000) throw new AppError('VALIDATION_ERROR', 'AI response exceeds the chat length cap', 502)
  if (/[\w.+-]+@[\w-]+\.[\w.]+|(email|phone number|street address|credit card|full name|customer name)/i.test(trimmed)) throw new AppError('VALIDATION_ERROR', 'AI response contains restricted PII', 502)
  if (/(ignore (all|any|previous|prior) instructions|you are now|new instructions:)/i.test(trimmed)) throw new AppError('VALIDATION_ERROR', 'AI response echoes prompt-injection markers', 502)
  assertNumbersGrounded(trimmed, evidenceNumberSet(evidence))
  return trimmed
}

// ---------------------------------------------------------------------------
// Suggested chat questions
// ---------------------------------------------------------------------------

export function coachChatSuggestions(evidence: CoachEvidence, plan: PlanTier): readonly string[] {
  const base = [
    'How did my store do yesterday?',
    'What should I focus on today?',
    'Which of my metrics needs attention?',
    'Suggest a goal for this week',
  ]
  const extra: string[] = []
  if (evidence.openPriorities.length > 0) extra.push('Walk me through today\u2019s priorities')
  if (evidence.activeGoal) extra.push('How is my current goal tracking?')
  if (coachFeatureEnabled(plan, 'voice')) extra.push('Explain my 30-day revenue trend')
  return [...base, ...extra].slice(0, 6)
}
