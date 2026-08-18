/**
 * Insights Hub engine — PR #50.
 *
 * Pure, deterministic discovery / learning / understanding logic. Every
 * discovery, pattern, persona, trend, comparison, and prediction produced
 * here is computed from the store's real synchronized data (see
 * {@link InsightsDataset}). Nothing is invented: when the data cannot
 * support an insight, the generators stay silent and the API surfaces the
 * educational empty states documented in docs/INSIGHTS_HUB.md.
 *
 * AI language (OpenRouter, Nemotron models under a dedicated
 * INSIGHTS_HUB_API_KEY) may only REPHRASE deterministic output through the
 * language firewall — it never supplies numbers.
 */

import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'

/* ── Environment configuration ─────────────────────────────────────────── */

export const INSIGHTS_HUB_DEFAULT_MODEL_PRIMARY = 'nvidia/nemotron-3.5-lightning:free'
export const INSIGHTS_HUB_DEFAULT_MODEL_FALLBACK = 'nvidia/nemotron-3-super:free'
export const INSIGHTS_HUB_DEFAULT_RATE_LIMIT = 25
export const INSIGHTS_HUB_DEFAULT_API_RATE_LIMIT = 100
export const INSIGHTS_HUB_DEFAULT_MIN_CONFIDENCE = 0.7
export const INSIGHTS_HUB_CACHE_TTL_MS = 12 * 3_600_000

export type InsightsHubEnvConfig = Readonly<{
  enabled: boolean
  apiKey: string | null
  models: readonly string[]
  rateLimitPerStore: number
  dailyBudgetUsd: number
  autoDiscoveryEnabled: boolean
  discoveryFrequency: 'REALTIME' | 'DAILY' | 'WEEKLY'
  minConfidenceScore: number
  trendMonitoring: boolean
  externalTrends: boolean
  apiAccessEnabled: boolean
  apiRateLimit: number
}>

/** Reads the dedicated Insights Hub environment block (see .env.example). */
export function insightsHubEnvConfig(env: Readonly<Record<string, string | undefined>>): InsightsHubEnvConfig {
  const primary = env.INSIGHTS_HUB_MODEL_PRIMARY?.trim() || INSIGHTS_HUB_DEFAULT_MODEL_PRIMARY
  const fallback = env.INSIGHTS_HUB_MODEL_FALLBACK?.trim() || INSIGHTS_HUB_DEFAULT_MODEL_FALLBACK
  const frequency = (env.INSIGHTS_HUB_DISCOVERY_FREQUENCY?.trim().toUpperCase() ?? 'DAILY')
  return {
    enabled: env.INSIGHTS_HUB_ENABLED?.trim().toLowerCase() !== 'false',
    apiKey: env.INSIGHTS_HUB_API_KEY?.trim() || null,
    models: unique([primary, fallback]),
    rateLimitPerStore: positiveInt(env.INSIGHTS_HUB_RATE_LIMIT_PER_STORE, INSIGHTS_HUB_DEFAULT_RATE_LIMIT),
    dailyBudgetUsd: nonNegativeNumber(env.INSIGHTS_HUB_DAILY_BUDGET_USD, 0),
    autoDiscoveryEnabled: env.INSIGHTS_HUB_AUTO_DISCOVERY_ENABLED?.trim().toLowerCase() !== 'false',
    discoveryFrequency: frequency === 'REALTIME' || frequency === 'WEEKLY' ? frequency : 'DAILY',
    minConfidenceScore: clamp01(nonNegativeNumber(env.INSIGHTS_HUB_MIN_CONFIDENCE_SCORE, INSIGHTS_HUB_DEFAULT_MIN_CONFIDENCE)),
    trendMonitoring: env.INSIGHTS_HUB_TREND_MONITORING?.trim().toLowerCase() !== 'false',
    externalTrends: env.INSIGHTS_HUB_EXTERNAL_TRENDS?.trim().toLowerCase() !== 'false',
    apiAccessEnabled: env.INSIGHTS_HUB_API_ACCESS_ENABLED?.trim().toLowerCase() !== 'false',
    apiRateLimit: positiveInt(env.INSIGHTS_HUB_API_RATE_LIMIT, INSIGHTS_HUB_DEFAULT_API_RATE_LIMIT),
  }
}

/* ── Plan-based feature matrix (PR #50 Part 8) ─────────────────────────── */

export type InsightsFeature =
  | 'discoveries'
  | 'lessons'
  | 'patterns'
  | 'personas'
  | 'investigations'
  | 'trends'
  | 'comparisons'
  | 'knowledge'
  | 'timeline'
  | 'predictions'
  | 'autoDiscovery'
  | 'export'
  | 'share'
  | 'apiAccess'
  | 'externalTrends'
  | 'anomalyAlerts'

export const INSIGHTS_FEATURES: readonly InsightsFeature[] = ['discoveries', 'lessons', 'patterns', 'personas', 'investigations', 'trends', 'comparisons', 'knowledge', 'timeline', 'predictions', 'autoDiscovery', 'export', 'share', 'apiAccess', 'externalTrends', 'anomalyAlerts']

export const INSIGHTS_USAGE_FEATURES = {
  discoveries: 'insights_discoveries_month',
  investigations: 'insights_investigations_month',
  lessonsRead: 'insights_lessons_read',
} as const

export type ComparisonType = 'PRODUCT' | 'PERIOD' | 'SEGMENT' | 'CATEGORY' | 'CHANNEL'
export const COMPARISON_TYPES: readonly ComparisonType[] = ['PRODUCT', 'PERIOD', 'SEGMENT', 'CATEGORY', 'CHANNEL']
export type PredictionHorizon = '7_DAYS' | '30_DAYS' | '90_DAYS'
export const PREDICTION_HORIZONS: readonly PredictionHorizon[] = ['7_DAYS', '30_DAYS', '90_DAYS']
export type InsightsVocabulary = 'en' | 'hi'

export type InsightsPlanLimits = Readonly<{
  discoveriesPerMonth: number
  lessonsTotal: number
  /** null means unlimited custom patterns; viewOnly means read-only gallery. */
  patternsLimit: number | null
  patternsViewOnly: boolean
  personasLimit: number
  investigationsPerMonth: number
  comparisonTypes: readonly ComparisonType[]
  customComparisons: boolean
  knowledge: 'NONE' | 'NOTES' | 'FULL' | 'ADVANCED'
  timelineDays: number | null
  predictionHorizons: readonly PredictionHorizon[]
  autoDiscovery: 'OFF' | 'DAILY' | 'REALTIME'
  export: 'NONE' | 'BASIC' | 'ADVANCED'
  share: 'NONE' | 'BASIC' | 'COLLABORATION'
  apiAccess: boolean
  apiRateLimitPerHour: number | null
  externalTrends: 'NONE' | 'WEEKLY' | 'DAILY' | 'REALTIME'
  anomalyAlerts: 'NONE' | 'DAILY_DIGEST' | 'REALTIME_PUSH'
  trendsFreshness: 'WEEKLY_LIMITED' | 'WEEKLY' | 'DAILY' | 'REALTIME'
  patternAlerts: boolean
  trendAlerts: boolean
}>

export const INSIGHTS_PLAN_LIMITS: Readonly<Record<PlanTier, InsightsPlanLimits>> = {
  trial: {
    discoveriesPerMonth: 1,
    lessonsTotal: 3,
    patternsLimit: 0,
    patternsViewOnly: true,
    personasLimit: 0,
    investigationsPerMonth: 0,
    comparisonTypes: [],
    customComparisons: false,
    knowledge: 'NONE',
    timelineDays: 7,
    predictionHorizons: [],
    autoDiscovery: 'OFF',
    export: 'NONE',
    share: 'NONE',
    apiAccess: false,
    apiRateLimitPerHour: null,
    externalTrends: 'NONE',
    anomalyAlerts: 'NONE',
    trendsFreshness: 'WEEKLY_LIMITED',
    patternAlerts: false,
    trendAlerts: false,
  },
  start: {
    discoveriesPerMonth: 5,
    lessonsTotal: 10,
    patternsLimit: 5,
    patternsViewOnly: false,
    personasLimit: 2,
    investigationsPerMonth: 3,
    comparisonTypes: ['PRODUCT', 'PERIOD'],
    customComparisons: false,
    knowledge: 'NOTES',
    timelineDays: 30,
    predictionHorizons: ['7_DAYS'],
    autoDiscovery: 'DAILY',
    export: 'NONE',
    share: 'NONE',
    apiAccess: false,
    apiRateLimitPerHour: null,
    externalTrends: 'WEEKLY',
    anomalyAlerts: 'NONE',
    trendsFreshness: 'WEEKLY',
    patternAlerts: false,
    trendAlerts: false,
  },
  growth: {
    discoveriesPerMonth: 20,
    lessonsTotal: 30,
    patternsLimit: 20,
    patternsViewOnly: false,
    personasLimit: 5,
    investigationsPerMonth: 15,
    comparisonTypes: COMPARISON_TYPES,
    customComparisons: false,
    knowledge: 'FULL',
    timelineDays: 90,
    predictionHorizons: ['7_DAYS', '30_DAYS'],
    autoDiscovery: 'DAILY',
    export: 'BASIC',
    share: 'BASIC',
    apiAccess: false,
    apiRateLimitPerHour: null,
    externalTrends: 'DAILY',
    anomalyAlerts: 'DAILY_DIGEST',
    trendsFreshness: 'DAILY',
    patternAlerts: true,
    trendAlerts: true,
  },
  commander: {
    discoveriesPerMonth: Number.POSITIVE_INFINITY,
    lessonsTotal: Number.POSITIVE_INFINITY,
    patternsLimit: null,
    patternsViewOnly: false,
    personasLimit: Number.POSITIVE_INFINITY,
    investigationsPerMonth: Number.POSITIVE_INFINITY,
    comparisonTypes: COMPARISON_TYPES,
    customComparisons: true,
    knowledge: 'ADVANCED',
    timelineDays: null,
    predictionHorizons: PREDICTION_HORIZONS,
    autoDiscovery: 'REALTIME',
    export: 'ADVANCED',
    share: 'COLLABORATION',
    apiAccess: true,
    apiRateLimitPerHour: INSIGHTS_HUB_DEFAULT_API_RATE_LIMIT,
    externalTrends: 'REALTIME',
    anomalyAlerts: 'REALTIME_PUSH',
    trendsFreshness: 'REALTIME',
    patternAlerts: true,
    trendAlerts: true,
  },
}

const FEATURE_MIN_PLAN: Readonly<Record<InsightsFeature, PlanTier>> = {
  discoveries: 'start',
  lessons: 'start',
  patterns: 'start',
  personas: 'start',
  investigations: 'start',
  trends: 'trial',
  comparisons: 'start',
  knowledge: 'start',
  timeline: 'trial',
  predictions: 'start',
  autoDiscovery: 'start',
  export: 'growth',
  share: 'growth',
  apiAccess: 'commander',
  externalTrends: 'start',
  anomalyAlerts: 'growth',
}

const PLAN_ORDER: readonly PlanTier[] = ['trial', 'start', 'growth', 'commander']

export function planAtLeastInsights(plan: PlanTier, required: PlanTier): boolean {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(required)
}

export function requiredPlanForInsightsFeature(feature: InsightsFeature): PlanTier {
  return FEATURE_MIN_PLAN[feature]
}

export type InsightsFeatureAccess = Readonly<{ feature: InsightsFeature; allowed: boolean; plan: PlanTier; requiredPlan: PlanTier; reason: string | null }>

/**
 * Gates a feature for a plan. Trial keeps view access to discovery/lesson/
 * timeline surfaces (with clearly labeled samples) — everything generative
 * requires a paid plan. API access is Commander-only.
 */
export function insightsFeatureAccess(plan: PlanTier, feature: InsightsFeature): InsightsFeatureAccess {
  const limits = INSIGHTS_PLAN_LIMITS[plan]
  const requiredPlan = FEATURE_MIN_PLAN[feature]
  let allowed = true
  if (feature === 'apiAccess') allowed = limits.apiAccess
  else if (feature === 'export') allowed = limits.export !== 'NONE'
  else if (feature === 'share') allowed = limits.share !== 'NONE'
  else if (feature === 'autoDiscovery') allowed = limits.autoDiscovery !== 'OFF'
  else if (feature === 'externalTrends') allowed = limits.externalTrends !== 'NONE'
  else if (feature === 'anomalyAlerts') allowed = limits.anomalyAlerts !== 'NONE'
  else if (feature === 'personas') allowed = limits.personasLimit > 0
  else if (feature === 'investigations') allowed = limits.investigationsPerMonth > 0
  else if (feature === 'comparisons') allowed = limits.comparisonTypes.length > 0
  else if (feature === 'knowledge') allowed = limits.knowledge !== 'NONE'
  else if (feature === 'predictions') allowed = limits.predictionHorizons.length > 0
  else if (feature === 'patterns') allowed = !limits.patternsViewOnly && (limits.patternsLimit === null || limits.patternsLimit > 0)
  // Trial discovers/learns through clearly-labeled samples only; the paid
  // generation endpoints stay locked (Part 8.3).
  else if (feature === 'discoveries') allowed = plan !== 'trial'
  else if (feature === 'lessons') allowed = plan !== 'trial' && limits.lessonsTotal > 0
  else if (feature === 'trends') allowed = true
  else if (feature === 'timeline') allowed = true
  return {
    feature,
    allowed,
    plan,
    requiredPlan: allowed ? plan : requiredPlan,
    reason: allowed ? null : `This capability unlocks on a paid plan. Trial includes labeled samples for exploration.`,
  }
}

/** 402 UPGRADE_REQUIRED error raised when a plan wall is hit. */
export function insightsUpgradeError(feature: InsightsFeature, plan: PlanTier): AppError {
  const requiredPlan = requiredPlanForInsightsFeature(feature)
  return new AppError('PAYMENT_REQUIRED', 'This Insights Hub capability is not included in your current plan. Upgrade Plan to unlock it.', 402, {
    reason: 'UPGRADE_REQUIRED',
    feature,
    plan,
    requiredPlan,
    upgradePath: '/billing',
    cta: 'Upgrade Plan',
  })
}

/** 402 UPGRADE_REQUIRED error for quota exhaustion (e.g. monthly discovery cap). */
export function insightsLimitError(feature: InsightsFeature, plan: PlanTier, used: number, limit: number, unit: string): AppError {
  return new AppError('PAYMENT_REQUIRED', `Your plan includes ${limit} ${unit} and ${used} are used this period. Upgrade Plan to keep exploring.`, 402, {
    reason: 'UPGRADE_REQUIRED',
    feature,
    plan,
    requiredPlan: plan === 'trial' ? 'start' : plan === 'start' ? 'growth' : 'commander',
    used,
    limit,
    upgradePath: '/billing',
    cta: 'Upgrade Plan',
  })
}

/* ── Shared entity vocabulary ──────────────────────────────────────────── */

export const DISCOVERY_TYPES = ['PATTERN', 'ANOMALY', 'OPPORTUNITY', 'CORRELATION', 'TREND', 'SEGMENT', 'BEHAVIOR'] as const
export type DiscoveryType = (typeof DISCOVERY_TYPES)[number]
export const DISCOVERY_CATEGORIES = ['REVENUE', 'CUSTOMERS', 'PRODUCTS', 'OPERATIONS', 'MARKETING', 'TIME'] as const
export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number]
export type DiscoveryStatus = 'NEW' | 'REVIEWED' | 'SAVED' | 'DISMISSED' | 'ACTED_ON'
export const DISCOVERY_STATUSES: readonly DiscoveryStatus[] = ['NEW', 'REVIEWED', 'SAVED', 'DISMISSED', 'ACTED_ON']

export const PATTERN_TYPES = ['TIME', 'PRODUCT', 'CUSTOMER', 'BEHAVIORAL', 'SEASONAL', 'ANOMALY', 'CORRELATION'] as const
export type InsightPatternType = (typeof PATTERN_TYPES)[number]

export type InsightJsonValue = string | number | boolean | null | InsightJsonObject | readonly InsightJsonValue[]
export interface InsightJsonObject { readonly [key: string]: InsightJsonValue }

export type InsightDiscovery = Readonly<{
  id: string
  storeId: string
  discoveryType: DiscoveryType
  category: DiscoveryCategory
  title: string
  description: string
  explanation: string
  confidenceScore: number
  impactEstimate: number | null
  impactCurrency: string
  dataEvidence: InsightJsonObject
  visualizationData: InsightJsonObject
  discoveredAt: string
  status: DiscoveryStatus
  sample: boolean
  viewedAt: string | null
  actionTakenAt: string | null
  expiresAt: string | null
}>

export type LessonType = 'PATTERN_STUDY' | 'BEHAVIOR_ANALYSIS' | 'COMPETITOR_INSIGHT' | 'BEST_PRACTICE' | 'CASE_STUDY'
export const LESSON_TYPES: readonly LessonType[] = ['PATTERN_STUDY', 'BEHAVIOR_ANALYSIS', 'COMPETITOR_INSIGHT', 'BEST_PRACTICE', 'CASE_STUDY']

export type InsightLesson = Readonly<{
  id: string
  storeId: string
  lessonType: LessonType
  category: DiscoveryCategory
  title: string
  summary: string
  contentMarkdown: string
  readingTimeMinutes: number
  basedOnData: InsightJsonObject
  personalized: boolean
  sample: boolean
  generatedAt: string
  readAt: string | null
  rating: number | null
  bookmarked: boolean
  actionItems: readonly string[]
}>

export type InsightPattern = Readonly<{
  id: string
  storeId: string
  patternType: InsightPatternType
  title: string
  description: string
  patternData: InsightJsonObject
  occurrenceCount: number
  confidenceScore: number
  firstDetected: string
  lastConfirmed: string
  status: 'ACTIVE' | 'INACTIVE' | 'INVALIDATED'
  alertsEnabled: boolean
}>

export type InsightPersona = Readonly<{
  id: string
  storeId: string
  personaName: string
  personaEmoji: string
  segmentCriteria: InsightJsonObject
  percentageOfCustomers: number
  behaviorPatterns: readonly string[]
  motivations: readonly string[]
  howToReach: readonly string[]
  estimatedRevenueImpact: number
  revenueCurrency: string
  confidenceScore: number
  customerCount: number
  radar: readonly Readonly<{ trait: string; score: number }>[]
  generatedAt: string
}>

export type InvestigationStatus = 'PENDING' | 'INVESTIGATING' | 'COMPLETED' | 'FAILED'
export type RootCause = Readonly<{ cause: string; impactShare: number; evidence: string; confidence: number }>
export type InsightInvestigation = Readonly<{
  id: string
  storeId: string
  question: string
  status: InvestigationStatus
  steps: readonly string[]
  dataSourcesAnalyzed: readonly string[]
  rootCauses: readonly RootCause[]
  confidenceScore: number
  whatToDo: readonly string[]
  preventionTips: readonly string[]
  createdAt: string
  completedAt: string | null
}>

export type TrendDirection = 'UP' | 'DOWN' | 'STABLE'
export type InsightTrend = Readonly<{
  id: string
  storeId: string
  trendType: 'BUSINESS' | 'MARKET' | 'EMERGING' | 'DECLINING'
  category: DiscoveryCategory
  title: string
  description: string
  direction: TrendDirection
  magnitude: number
  timePeriod: string
  dataSource: 'INTERNAL' | 'EXTERNAL' | 'HYBRID'
  confidenceScore: number
  detectedAt: string
  alertsEnabled: boolean
}>

export type InsightComparison = Readonly<{
  id: string
  storeId: string
  comparisonType: ComparisonType
  title: string
  subjectA: InsightJsonObject
  subjectB: InsightJsonObject
  metrics: readonly Readonly<{ metric: string; a: number | null; b: number | null; delta: number | null; winner: 'A' | 'B' | 'TIE' }>[]
  winner: 'A' | 'B' | 'TIE' | 'INSUFFICIENT_DATA'
  insights: readonly string[]
  createdAt: string
}>

export type KnowledgeEntryType = 'DISCOVERY' | 'LESSON' | 'NOTE' | 'PATTERN' | 'INVESTIGATION' | 'CUSTOM'
export type InsightKnowledgeEntry = Readonly<{
  id: string
  storeId: string
  entryType: KnowledgeEntryType
  title: string
  contentMarkdown: string
  tags: readonly string[]
  linkedInsights: readonly string[]
  author: 'AI' | 'MERCHANT'
  createdAt: string
  updatedAt: string
  referenceCount: number
}>

export type InsightTimelineEvent = Readonly<{
  id: string
  storeId: string
  eventType: string
  entityType: 'DISCOVERY' | 'LESSON' | 'PATTERN' | 'PERSONA' | 'INVESTIGATION' | 'TREND' | 'COMPARISON' | 'PREDICTION'
  entityId: string
  description: string
  eventAt: string
}>

export type PredictionType = 'REVENUE' | 'ORDERS' | 'CUSTOMERS' | 'INVENTORY' | 'TREND' | 'RISK'
export type InsightPrediction = Readonly<{
  id: string
  storeId: string
  predictionType: PredictionType
  horizon: PredictionHorizon
  title: string
  description: string
  predictedValue: number
  predictedLow: number
  predictedHigh: number
  currency: string
  confidenceScore: number
  method: string
  series: readonly Readonly<{ day: string; value: number; lower: number; upper: number }>[]
  basedOn: readonly string[]
  predictedFor: string
  actualValue: number | null
  accuracyScore: number | null
  createdAt: string
}>

export type InsightsPreferences = Readonly<{
  storeId: string
  autoDiscoveryEnabled: boolean
  discoveryFrequency: 'REALTIME' | 'DAILY' | 'WEEKLY'
  discoveryCategories: readonly DiscoveryCategory[]
  notificationPreferences: Readonly<{ highConfidenceDiscoveries: boolean; trendAlerts: boolean; weeklyDigest: boolean; anomalyAlerts: boolean }>
  trendMonitoringEnabled: boolean
  personaUpdatesEnabled: boolean
  apiAccessEnabled: boolean
  apiKeyMasked: string | null
  language: InsightsVocabulary
  updatedAt: string
}>

export function defaultInsightsPreferences(storeId: string, now = new Date().toISOString()): InsightsPreferences {
  return {
    storeId,
    autoDiscoveryEnabled: true,
    discoveryFrequency: 'DAILY',
    discoveryCategories: DISCOVERY_CATEGORIES,
    notificationPreferences: { highConfidenceDiscoveries: true, trendAlerts: true, weeklyDigest: false, anomalyAlerts: true },
    trendMonitoringEnabled: true,
    personaUpdatesEnabled: true,
    apiAccessEnabled: false,
    apiKeyMasked: null,
    language: 'en',
    updatedAt: now,
  }
}

/* ── Dataset contract (all real synchronized store data) ───────────────── */

export type InsightsDataset = Readonly<{
  storeId: string
  currency: string
  revenueDaily: readonly Readonly<{ day: string; grossRevenue: number; orderCount: number }>[]
  ordersDaily: readonly Readonly<{ day: string; orderCount: number; averageOrderValue: number }>[]
  productSalesDaily: readonly Readonly<{ day: string; productId: string; unitsSold: number; grossRevenue: number }>[]
  products: readonly Readonly<{ productId: string; title: string; price: number | null; category?: string | null }>[]
  customers: readonly Readonly<{ customerKey: string; lifetimeValue: number; orderCount: number; daysSinceLastOrder: number; firstOrderDay: string }>[]
  productPairs: readonly Readonly<{ productId: string; relatedProductId: string; coPurchaseRate: number }>[]
  hours?: readonly Readonly<{ hour: number; orders: number; revenue: number }>[]
}>

export type InsightsDataReadiness = Readonly<{
  revenueDays: number
  totalOrders: number
  customerCount: number
  productsWithSales: number
  canDiscover: boolean
  canPersonas: boolean
  canTrends: boolean
  canPatterns: boolean
  canPredict: boolean
  discoverRequirement: string
  personasRequirement: Readonly<{ met: boolean; have: number; need: number }>
  trendsRequirement: Readonly<{ met: boolean; have: number; need: number }>
  predictRequirement: Readonly<{ met: boolean; have: number; need: number }>
}>

export const PERSONA_MIN_CUSTOMERS = 50
export const TREND_MIN_DAYS = 60
export const DISCOVERY_MIN_DAYS = 7
export const DISCOVERY_MIN_ORDERS = 10
export const PREDICTION_MIN_DAYS = 14

/** Computes which Insights Hub surfaces have enough real data to run. */
export function insightsDataReadiness(dataset: InsightsDataset): InsightsDataReadiness {
  const revenueDays = new Set(dataset.revenueDaily.filter((row) => row.grossRevenue > 0 || row.orderCount > 0).map((row) => row.day)).size
  const totalOrders = dataset.ordersDaily.reduce((sum, row) => sum + row.orderCount, 0)
  const productsWithSales = new Set(dataset.productSalesDaily.filter((row) => row.unitsSold > 0).map((row) => row.productId)).size
  const canDiscover = revenueDays >= DISCOVERY_MIN_DAYS || totalOrders >= DISCOVERY_MIN_ORDERS
  const canPersonas = dataset.customers.length >= PERSONA_MIN_CUSTOMERS
  const canTrends = revenueDays >= TREND_MIN_DAYS
  const canPatterns = revenueDays >= DISCOVERY_MIN_DAYS || productsWithSales >= 2
  const canPredict = revenueDays >= PREDICTION_MIN_DAYS
  return {
    revenueDays,
    totalOrders,
    customerCount: dataset.customers.length,
    productsWithSales,
    canDiscover,
    canPersonas,
    canTrends,
    canPatterns,
    canPredict,
    discoverRequirement: `Discoveries need ${DISCOVERY_MIN_DAYS} days of revenue history or ${DISCOVERY_MIN_ORDERS} orders.`,
    personasRequirement: { met: canPersonas, have: dataset.customers.length, need: PERSONA_MIN_CUSTOMERS },
    trendsRequirement: { met: canTrends, have: revenueDays, need: TREND_MIN_DAYS },
    predictRequirement: { met: canPredict, have: revenueDays, need: PREDICTION_MIN_DAYS },
  }
}

/* ── Statistics helpers ────────────────────────────────────────────────── */

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function linearSlope(points: readonly Readonly<{ x: number; y: number }>[]): number {
  if (points.length < 2) return 0
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const xMean = mean(xs)
  const yMean = mean(ys)
  let numerator = 0
  let denominator = 0
  for (const point of points) {
    numerator += (point.x - xMean) * (point.y - yMean)
    denominator += (point.x - xMean) ** 2
  }
  return denominator === 0 ? 0 : numerator / denominator
}

/** Sample-size-aware confidence: more evidence days → higher confidence, capped. */
function evidenceConfidence(evidenceDays: number, observations: number, base = 0.55): number {
  const dayBoost = Math.min(0.25, Math.log10(Math.max(1, evidenceDays)) / 8)
  const obsBoost = Math.min(0.2, Math.log10(Math.max(1, observations)) / 10)
  return Math.round(Math.min(0.95, base + dayBoost + obsBoost) * 100) / 100
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/* ── Discovery generation ──────────────────────────────────────────────── */

export type DiscoveryOptions = Readonly<{
  limit?: number
  minConfidence?: number
  categories?: readonly DiscoveryCategory[]
  now?: string
  sample?: boolean
}>

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export function weekdayProfile(dataset: InsightsDataset): readonly Readonly<{ weekday: number; name: string; revenue: number; orders: number; revenueShare: number }>[] {
  const totals = Array.from({ length: 7 }, () => ({ revenue: 0, orders: 0 }))
  for (const row of dataset.revenueDaily) {
    const weekday = new Date(`${row.day}T00:00:00Z`).getUTCDay()
    const bucket = totals[weekday]
    if (!bucket) continue
    bucket.revenue += row.grossRevenue
    bucket.orders += row.orderCount
  }
  const revenueTotal = totals.reduce((sum, bucket) => sum + bucket.revenue, 0)
  return totals.map((bucket, weekday) => ({
    weekday,
    name: WEEKDAY_NAMES[weekday] ?? `Day ${weekday}`,
    revenue: round2(bucket.revenue),
    orders: bucket.orders,
    revenueShare: revenueTotal > 0 ? round2((bucket.revenue / revenueTotal) * 100) : 0,
  }))
}

export function detectRevenueAnomalies(dataset: InsightsDataset): readonly Readonly<{ day: string; direction: 'spike' | 'dip'; value: number; expected: number; deviationPercent: number }>[] {
  const series = [...dataset.revenueDaily].sort((left, right) => left.day.localeCompare(right.day)).map((row) => row.grossRevenue)
  if (series.length < 10) return []
  const avg = mean(series)
  const sd = stdev(series)
  if (sd === 0) return []
  const results: Array<{ day: string; direction: 'spike' | 'dip'; value: number; expected: number; deviationPercent: number }> = []
  const sorted = [...dataset.revenueDaily].sort((left, right) => left.day.localeCompare(right.day))
  for (const row of sorted) {
    const z = (row.grossRevenue - avg) / sd
    if (Math.abs(z) >= 2 && avg > 0) {
      results.push({
        day: row.day,
        direction: z > 0 ? 'spike' : 'dip',
        value: round2(row.grossRevenue),
        expected: round2(avg),
        deviationPercent: round2(((row.grossRevenue - avg) / avg) * 100),
      })
    }
  }
  return results
}

export function coPurchaseOpportunities(dataset: InsightsDataset): readonly Readonly<{ productId: string; productTitle: string; relatedProductId: string; relatedProductTitle: string; coPurchaseRate: number; estimatedMonthlyImpact: number }>[] {
  const titleById = new Map(dataset.products.map((product) => [product.productId, product.title]))
  const priceById = new Map(dataset.products.map((product) => [product.productId, product.price ?? 0]))
  const anchorOrders = new Map<string, number>()
  const revenueDays = Math.max(1, new Set(dataset.revenueDaily.map((row) => row.day)).size)
  const monthlyFactor = 30 / revenueDays
  const totalRevenue = dataset.revenueDaily.reduce((sum, row) => sum + row.grossRevenue, 0)
  return dataset.productPairs
    .filter((pair) => pair.coPurchaseRate >= 0.25)
    .map((pair) => {
      const anchorCount = (anchorOrders.get(pair.productId) ?? 0) + 1
      anchorOrders.set(pair.productId, anchorCount)
      const relatedPrice = priceById.get(pair.relatedProductId) ?? 0
      const estimatedMonthlyImpact = totalRevenue > 0 ? round2(pair.coPurchaseRate * relatedPrice * Math.max(1, dataset.ordersDaily.reduce((sum, row) => sum + row.orderCount, 0) / Math.max(1, new Set(dataset.ordersDaily.map((row) => row.day)).size)) * monthlyFactor * 0.1) : 0
      return {
        productId: pair.productId,
        productTitle: titleById.get(pair.productId) ?? pair.productId,
        relatedProductId: pair.relatedProductId,
        relatedProductTitle: titleById.get(pair.relatedProductId) ?? pair.relatedProductId,
        coPurchaseRate: pair.coPurchaseRate,
        estimatedMonthlyImpact,
      }
    })
    .sort((left, right) => right.coPurchaseRate - left.coPurchaseRate)
    .slice(0, 10)
}

export function repeatCustomerSegment(dataset: InsightsDataset): Readonly<{ repeatCustomers: number; oneTimeCustomers: number; repeatShare: number; repeatLtvShare: number }> {
  const repeat = dataset.customers.filter((customer) => customer.orderCount >= 2)
  const oneTime = dataset.customers.filter((customer) => customer.orderCount < 2)
  const ltvTotal = dataset.customers.reduce((sum, customer) => sum + customer.lifetimeValue, 0)
  const repeatLtv = repeat.reduce((sum, customer) => sum + customer.lifetimeValue, 0)
  return {
    repeatCustomers: repeat.length,
    oneTimeCustomers: oneTime.length,
    repeatShare: dataset.customers.length === 0 ? 0 : round2((repeat.length / dataset.customers.length) * 100),
    repeatLtvShare: ltvTotal === 0 ? 0 : round2((repeatLtv / ltvTotal) * 100),
  }
}

export function periodOverPeriod(dataset: InsightsDataset, daysBack = 30): Readonly<{ current: Readonly<{ revenue: number; orders: number; aov: number | null }>; previous: Readonly<{ revenue: number; orders: number; aov: number | null }>; revenueChange: number | null; ordersChange: number | null; aovChange: number | null }> {
  const lastDay = dataset.revenueDaily.reduce((max, row) => (row.day > max ? row.day : max), '')
  if (!lastDay) {
    return {
      current: { revenue: 0, orders: 0, aov: null },
      previous: { revenue: 0, orders: 0, aov: null },
      revenueChange: null,
      ordersChange: null,
      aovChange: null,
    }
  }
  const currentStart = shiftDay(lastDay, -(daysBack - 1))
  const previousStart = shiftDay(lastDay, -(2 * daysBack - 1))
  const previousEnd = shiftDay(currentStart, -1)
  const inRange = (day: string, start: string, end: string) => day >= start && day <= end
  const currentRevenue = dataset.revenueDaily.filter((row) => inRange(row.day, currentStart, lastDay)).reduce((sum, row) => sum + row.grossRevenue, 0)
  const previousRevenue = dataset.revenueDaily.filter((row) => inRange(row.day, previousStart, previousEnd)).reduce((sum, row) => sum + row.grossRevenue, 0)
  const currentOrders = dataset.ordersDaily.filter((row) => inRange(row.day, currentStart, lastDay)).reduce((sum, row) => sum + row.orderCount, 0)
  const previousOrders = dataset.ordersDaily.filter((row) => inRange(row.day, previousStart, previousEnd)).reduce((sum, row) => sum + row.orderCount, 0)
  const pct = (current: number, previous: number): number | null => (previous > 0 ? round2(((current - previous) / previous) * 100) : null)
  return {
    current: { revenue: round2(currentRevenue), orders: currentOrders, aov: currentOrders > 0 ? round2(currentRevenue / currentOrders) : null },
    previous: { revenue: round2(previousRevenue), orders: previousOrders, aov: previousOrders > 0 ? round2(previousRevenue / previousOrders) : null },
    revenueChange: pct(currentRevenue, previousRevenue),
    ordersChange: pct(currentOrders, previousOrders),
    aovChange: currentOrders > 0 && previousOrders > 0 ? pct(currentRevenue / currentOrders, previousRevenue / previousOrders) : null,
  }
}

export function risingProducts(dataset: InsightsDataset, windowDays = 14): readonly Readonly<{ productId: string; productTitle: string; recentUnits: number; priorUnits: number; growthPercent: number; recentRevenue: number }>[] {
  const lastDay = dataset.productSalesDaily.reduce((max, row) => (row.day > max ? row.day : max), '0000-00-00')
  if (lastDay === '0000-00-00') return []
  const recentStart = shiftDay(lastDay, -(windowDays - 1))
  const priorStart = shiftDay(lastDay, -(2 * windowDays - 1))
  const priorEnd = shiftDay(recentStart, -1)
  const aggregates = new Map<string, { recentUnits: number; priorUnits: number; recentRevenue: number }>()
  for (const row of dataset.productSalesDaily) {
    const entry = aggregates.get(row.productId) ?? { recentUnits: 0, priorUnits: 0, recentRevenue: 0 }
    if (row.day >= recentStart && row.day <= lastDay) {
      entry.recentUnits += row.unitsSold
      entry.recentRevenue += row.grossRevenue
    } else if (row.day >= priorStart && row.day <= priorEnd) {
      entry.priorUnits += row.unitsSold
    }
    aggregates.set(row.productId, entry)
  }
  const titleById = new Map(dataset.products.map((product) => [product.productId, product.title]))
  return [...aggregates.entries()]
    .filter(([, entry]) => entry.recentUnits >= 2 && entry.recentUnits > entry.priorUnits)
    .map(([productId, entry]) => ({
      productId,
      productTitle: titleById.get(productId) ?? productId,
      recentUnits: entry.recentUnits,
      priorUnits: entry.priorUnits,
      growthPercent: entry.priorUnits > 0 ? round2(((entry.recentUnits - entry.priorUnits) / entry.priorUnits) * 100) : 100,
      recentRevenue: round2(entry.recentRevenue),
    }))
    .sort((left, right) => right.growthPercent - left.growthPercent)
    .slice(0, 8)
}

export function revenueConcentration(dataset: InsightsDataset): Readonly<{ topProductId: string | null; topProductTitle: string | null; topShare: number; top3Share: number }> {
  const revenueByProduct = new Map<string, number>()
  for (const row of dataset.productSalesDaily) revenueByProduct.set(row.productId, (revenueByProduct.get(row.productId) ?? 0) + row.grossRevenue)
  const total = [...revenueByProduct.values()].reduce((sum, value) => sum + value, 0)
  const sorted = [...revenueByProduct.entries()].sort((left, right) => right[1] - left[1])
  const titleById = new Map(dataset.products.map((product) => [product.productId, product.title]))
  const top = sorted[0] ?? null
  const top3 = sorted.slice(0, 3).reduce((sum, [, value]) => sum + value, 0)
  return {
    topProductId: top?.[0] ?? null,
    topProductTitle: top ? titleById.get(top[0]) ?? top[0] : null,
    topShare: total > 0 && top ? round2((top[1] / total) * 100) : 0,
    top3Share: total > 0 ? round2((top3 / total) * 100) : 0,
  }
}

/**
 * The discovery engine. Runs every deterministic detector against the real
 * dataset, scores confidence, and returns discoveries ranked by impact.
 * Returns an empty array when the data cannot support any discovery — the
 * UI then shows the educational empty state (never fabricated content).
 */
export function generateDiscoveries(dataset: InsightsDataset, options: DiscoveryOptions = {}): readonly InsightDiscovery[] {
  const readiness = insightsDataReadiness(dataset)
  if (!readiness.canDiscover && !options.sample) return []
  const now = options.now ?? new Date().toISOString()
  const today = now.slice(0, 10)
  const minConfidence = options.minConfidence ?? INSIGHTS_HUB_DEFAULT_MIN_CONFIDENCE
  const categories = options.categories && options.categories.length > 0 ? new Set(options.categories) : null
  const sample = options.sample === true
  const discoveries: InsightDiscovery[] = []

  const push = (entry: Omit<InsightDiscovery, 'id' | 'storeId' | 'discoveredAt' | 'status' | 'sample' | 'viewedAt' | 'actionTakenAt' | 'expiresAt'>): void => {
    if (entry.confidenceScore < minConfidence) return
    if (categories && !categories.has(entry.category)) return
    discoveries.push({
      ...entry,
      id: deterministicId('disc', dataset.storeId, entry.discoveryType, entry.category, entry.title),
      storeId: dataset.storeId,
      discoveredAt: now,
      status: 'NEW',
      sample,
      viewedAt: null,
      actionTakenAt: null,
      expiresAt: `${shiftDay(today, 30)}T00:00:00.000Z`,
    })
  }

  // 1. Time pattern: strongest/weakest weekday.
  const profile = weekdayProfile(dataset)
  if (readiness.revenueDays >= 2 * DISCOVERY_MIN_DAYS) {
    const sorted = [...profile].sort((left, right) => right.revenueShare - left.revenueShare)
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    if (best && worst && best.revenueShare > 0 && best.revenueShare - worst.revenueShare >= 5) {
      push({
        discoveryType: 'PATTERN',
        category: 'TIME',
        title: `${best.name} consistently outperforms ${worst.name}`,
        description: `${best.name} drives ${best.revenueShare}% of weekly revenue while ${worst.name} contributes ${worst.revenueShare}%.`,
        explanation: `Across ${readiness.revenueDays} days of order history, revenue concentrates on ${best.name}. This recurrence is stable enough to plan campaigns, staffing, and launches around it.`,
        confidenceScore: evidenceConfidence(readiness.revenueDays, readiness.totalOrders, 0.68),
        impactEstimate: best.revenue > 0 ? round2(best.revenue * 0.05) : null,
        impactCurrency: dataset.currency,
        dataEvidence: { weekdayProfile: profile.map((row) => ({ name: row.name, revenue: row.revenue, share: row.revenueShare, orders: row.orders })) },
        visualizationData: { chart: 'heatmap', weekdayProfile: profile.map((row) => ({ name: row.name, revenue: row.revenue, share: row.revenueShare })) },
      })
    }
  }

  // 2. Anomaly spikes/dips.
  for (const anomaly of detectRevenueAnomalies(dataset).slice(-3)) {
    push({
      discoveryType: 'ANOMALY',
      category: 'REVENUE',
      title: anomaly.direction === 'spike' ? `Revenue spiked ${Math.abs(anomaly.deviationPercent)}% on ${anomaly.day}` : `Revenue dipped ${Math.abs(anomaly.deviationPercent)}% on ${anomaly.day}`,
      description: `${anomaly.day} closed at ${anomaly.value} ${dataset.currency} vs an expected ${anomaly.expected} ${dataset.currency} (a ${anomaly.deviationPercent}% deviation).`,
      explanation: anomaly.direction === 'spike'
        ? 'This day sits more than two standard deviations above your norm. Worth understanding: a promotion, an influencer mention, or a seasonal lift may be repeatable.'
        : 'This day sits more than two standard deviations below your norm. Look for stockouts, checkout issues, or campaign pauses on this date.',
      confidenceScore: evidenceConfidence(readiness.revenueDays, 1, 0.7),
      impactEstimate: round2(Math.abs(anomaly.value - anomaly.expected)),
      impactCurrency: dataset.currency,
      dataEvidence: { day: anomaly.day, value: anomaly.value, expected: anomaly.expected, deviationPercent: anomaly.deviationPercent, method: 'z-score ≥ 2 over daily revenue' },
      visualizationData: { chart: 'area-gradient', day: anomaly.day, value: anomaly.value, expected: anomaly.expected },
    })
  }

  // 3. Co-purchase opportunity.
  const pairs = coPurchaseOpportunities(dataset)
  const topPair = pairs[0]
  if (topPair) {
    push({
      discoveryType: 'OPPORTUNITY',
      category: 'PRODUCTS',
      title: `${topPair.productTitle} and ${topPair.relatedProductTitle} are bought together ${Math.round(topPair.coPurchaseRate * 100)}% of the time`,
      description: `When a customer buys ${topPair.productTitle}, they also buy ${topPair.relatedProductTitle} in ${Math.round(topPair.coPurchaseRate * 100)}% of those orders.`,
      explanation: 'Bundles and cross-sells work when affinity is real — and this affinity is measured from your actual order line items. A bundle or a post-purchase cross-sell on this pair is grounded in observed behavior.',
      confidenceScore: evidenceConfidence(readiness.totalOrders, Math.round(1 / Math.max(0.01, topPair.coPurchaseRate)), 0.66),
      impactEstimate: topPair.estimatedMonthlyImpact > 0 ? topPair.estimatedMonthlyImpact : null,
      impactCurrency: dataset.currency,
      dataEvidence: { product: topPair.productTitle, related: topPair.relatedProductTitle, coPurchaseRate: topPair.coPurchaseRate },
      visualizationData: { chart: 'network', nodes: [topPair.productTitle, topPair.relatedProductTitle], linkStrength: topPair.coPurchaseRate },
    })
  }

  // 4. Repeat-customer segment.
  const segments = repeatCustomerSegment(dataset)
  if (segments.repeatCustomers > 0 && dataset.customers.length >= 10) {
    push({
      discoveryType: 'SEGMENT',
      category: 'CUSTOMERS',
      title: `${segments.repeatCustomers} repeat customers drive ${segments.repeatLtvShare}% of lifetime value`,
      description: `${segments.repeatCustomers} of ${dataset.customers.length} customers ordered more than once — they hold ${segments.repeatLtvShare}% of total customer lifetime value.`,
      explanation: 'Repeat buyers are your compounding asset. Knowing exactly how much value they concentrate tells you how much a retention email or loyalty nudge is worth.',
      confidenceScore: evidenceConfidence(dataset.customers.length, segments.repeatCustomers, 0.7),
      impactEstimate: null,
      impactCurrency: dataset.currency,
      dataEvidence: { repeatCustomers: segments.repeatCustomers, oneTimeCustomers: segments.oneTimeCustomers, repeatShare: segments.repeatShare, repeatLtvShare: segments.repeatLtvShare },
      visualizationData: { chart: 'treemap', repeat: segments.repeatCustomers, oneTime: segments.oneTimeCustomers },
    })
  }

  // 5. Period momentum (revenue + AOV).
  const momentum = periodOverPeriod(dataset)
  if (momentum.revenueChange !== null && Math.abs(momentum.revenueChange) >= 8) {
    const up = momentum.revenueChange > 0
    push({
      discoveryType: 'TREND',
      category: 'REVENUE',
      title: up ? `Revenue is up ${momentum.revenueChange}% vs the previous 30 days` : `Revenue is down ${Math.abs(momentum.revenueChange)}% vs the previous 30 days`,
      description: `The last 30 days closed at ${momentum.current.revenue} ${dataset.currency} (${momentum.current.orders} orders) after ${momentum.previous.revenue} ${dataset.currency} (${momentum.previous.orders} orders) in the prior window.`,
      explanation: up
        ? 'Momentum is real when it holds across two full windows. Dig into which products and which days are carrying the lift so you can double down deliberately.'
        : 'A two-window decline deserves a root-cause look: Ask Why can decompose this into orders vs average order value vs product mix.',
      confidenceScore: evidenceConfidence(readiness.revenueDays, readiness.totalOrders, 0.7),
      impactEstimate: round2(Math.abs(momentum.current.revenue - momentum.previous.revenue)),
      impactCurrency: dataset.currency,
      dataEvidence: { current: momentum.current, previous: momentum.previous, revenueChange: momentum.revenueChange, ordersChange: momentum.ordersChange, aovChange: momentum.aovChange },
      visualizationData: { chart: 'area-gradient', current: momentum.current.revenue, previous: momentum.previous.revenue },
    })
  }

  // 6. Rising product.
  const rising = risingProducts(dataset)[0]
  if (rising) {
    push({
      discoveryType: 'TREND',
      category: 'PRODUCTS',
      title: `${rising.productTitle} demand jumped ${rising.growthPercent}% in the last 14 days`,
      description: `${rising.productTitle} sold ${rising.recentUnits} units in the last 14 days after ${rising.priorUnits} units in the prior 14 — ${rising.recentRevenue} ${dataset.currency} in recent revenue.`,
      explanation: 'Early momentum in a single product is the cheapest growth you ever get. Feature placement and inventory checks done this week compound; next month they are just maintenance.',
      confidenceScore: evidenceConfidence(readiness.revenueDays, rising.recentUnits, 0.68),
      impactEstimate: rising.recentRevenue > 0 ? round2(rising.recentRevenue) : null,
      impactCurrency: dataset.currency,
      dataEvidence: { productId: rising.productId, recentUnits: rising.recentUnits, priorUnits: rising.priorUnits, growthPercent: rising.growthPercent, recentRevenue: rising.recentRevenue },
      visualizationData: { chart: 'bubble', recentUnits: rising.recentUnits, growthPercent: rising.growthPercent },
    })
  }

  // 7. Concentration risk.
  const concentration = revenueConcentration(dataset)
  if (concentration.topProductId && concentration.topShare >= 40) {
    push({
      discoveryType: 'PATTERN',
      category: 'PRODUCTS',
      title: `${concentration.topShare}% of product revenue depends on ${concentration.topProductTitle}`,
      description: `One product carries ${concentration.topShare}% of product revenue; the top three carry ${concentration.top3Share}%.`,
      explanation: 'Concentration is neither good nor bad — it is exposure. Knowing the exact share lets you decide whether to protect the hero product or grow a second pillar.',
      confidenceScore: evidenceConfidence(readiness.revenueDays, readiness.productsWithSales, 0.72),
      impactEstimate: null,
      impactCurrency: dataset.currency,
      dataEvidence: { topProduct: concentration.topProductTitle, topShare: concentration.topShare, top3Share: concentration.top3Share },
      visualizationData: { chart: 'treemap', topShare: concentration.topShare, top3Share: concentration.top3Share },
    })
  }

  // 8. Peak hours behavior (when hourly order data is available).
  const hours = dataset.hours ?? []
  if (hours.length >= 6) {
    const totalOrders = hours.reduce((sum, row) => sum + row.orders, 0)
    const sortedHours = [...hours].sort((left, right) => right.orders - left.orders)
    const peak = sortedHours[0]
    if (peak && totalOrders >= DISCOVERY_MIN_ORDERS) {
      push({
        discoveryType: 'BEHAVIOR',
        category: 'TIME',
        title: `${Math.round((peak.orders / totalOrders) * 100)}% of orders arrive around ${formatHour(peak.hour)}`,
        description: `The hour starting ${formatHour(peak.hour)} captures ${peak.orders} of ${totalOrders} tracked orders.`,
        explanation: 'Order timing is buyer rhythm. Scheduling campaigns and support coverage inside this window meets customers exactly when they are ready to act.',
        confidenceScore: evidenceConfidence(readiness.revenueDays, totalOrders, 0.66),
        impactEstimate: null,
        impactCurrency: dataset.currency,
        dataEvidence: { peakHour: peak.hour, peakOrders: peak.orders, totalOrders },
        visualizationData: { chart: 'heatmap', hours: hours.map((row) => ({ hour: row.hour, orders: row.orders })) },
      })
    }
  }

  return discoveries
    .sort((left, right) => (right.impactEstimate ?? 0) - (left.impactEstimate ?? 0) || right.confidenceScore - left.confidenceScore)
    .slice(0, Math.max(1, options.limit ?? 12))
}

/**
 * ONE clearly-labeled sample discovery for trial stores, computed from real
 * data when available. When the store has no usable history, the sample is
 * an illustrative template explicitly flagged `sample: true` with
 * `basedOnRealData: false` in its evidence — never presented as real.
 */
export function trialSampleDiscoveries(dataset: InsightsDataset, now = new Date().toISOString()): readonly InsightDiscovery[] {
  const real = generateDiscoveries(dataset, { limit: 1, minConfidence: 0, now, sample: true })
  if (real.length > 0) return real
  return [{
    id: deterministicId('disc', dataset.storeId, 'SAMPLE', 'PRODUCTS', 'sample-co-purchase'),
    storeId: dataset.storeId,
    discoveryType: 'OPPORTUNITY',
    category: 'PRODUCTS',
    title: 'Sample discovery — product pairs you might be missing',
    description: 'This is a labeled sample. Once your store has 7 days of synced orders, Insights Hub shows real discoveries here, like products customers buy together.',
    explanation: 'Real discoveries are computed from your synced orders, revenue, and customer data — never invented. Sync your store to replace this sample.',
    confidenceScore: 0,
    impactEstimate: null,
    impactCurrency: dataset.currency,
    dataEvidence: { basedOnRealData: false, sampleReason: 'trial-preview-no-data' },
    visualizationData: { chart: 'network', nodes: ['Product A', 'Product B'], linkStrength: 0 },
    discoveredAt: now,
    status: 'NEW',
    sample: true,
    viewedAt: null,
    actionTakenAt: null,
    expiresAt: null,
  }]
}

/* ── Pattern recognition ───────────────────────────────────────────────── */

export function detectPatterns(dataset: InsightsDataset, limit = 20, now = new Date().toISOString()): readonly InsightPattern[] {
  const readiness = insightsDataReadiness(dataset)
  if (!readiness.canPatterns) return []
  const patterns: InsightPattern[] = []
  const push = (pattern: Omit<InsightPattern, 'id' | 'storeId' | 'firstDetected' | 'lastConfirmed' | 'status' | 'alertsEnabled'>): void => {
    patterns.push({
      ...pattern,
      id: deterministicId('pat', dataset.storeId, pattern.patternType, pattern.title),
      storeId: dataset.storeId,
      firstDetected: now,
      lastConfirmed: now,
      status: 'ACTIVE',
      alertsEnabled: false,
    })
  }

  const profile = weekdayProfile(dataset)
  const byShare = [...profile].sort((left, right) => right.revenueShare - left.revenueShare)
  const bestDay = byShare[0]
  if (bestDay && readiness.revenueDays >= DISCOVERY_MIN_DAYS && bestDay.revenueShare > 0) {
    push({
      patternType: 'TIME',
      title: `${bestDay.name}s are peak revenue days`,
      description: `${bestDay.name} holds the highest revenue share (${bestDay.revenueShare}%) across ${readiness.revenueDays} observed days.`,
      patternData: { weekdayProfile: profile.map((row) => ({ name: row.name, share: row.revenueShare, orders: row.orders })) },
      occurrenceCount: Math.max(1, Math.floor(readiness.revenueDays / 7)),
      confidenceScore: evidenceConfidence(readiness.revenueDays, readiness.totalOrders, 0.62),
    })
  }

  const hours = dataset.hours ?? []
  if (hours.length >= 6) {
    const peakHour = [...hours].sort((left, right) => right.orders - left.orders)[0]
    if (peakHour && peakHour.orders >= 2) {
      push({
        patternType: 'BEHAVIORAL',
        title: `Order volume clusters near ${formatHour(peakHour.hour)}`,
        description: `The ${formatHour(peakHour.hour)} hour leads with ${peakHour.orders} orders across the observed window.`,
        patternData: { hours: hours.map((row) => ({ hour: row.hour, orders: row.orders })) },
        occurrenceCount: peakHour.orders,
        confidenceScore: evidenceConfidence(readiness.revenueDays, peakHour.orders, 0.6),
      })
    }
  }

  const concentration = revenueConcentration(dataset)
  if (concentration.topProductId && concentration.topShare >= 25) {
    push({
      patternType: 'PRODUCT',
      title: `Revenue concentrates in ${concentration.topProductTitle}`,
      description: `${concentration.topProductTitle} accounts for ${concentration.topShare}% of all product revenue.`,
      patternData: { topProduct: concentration.topProductTitle, topShare: concentration.topShare, top3Share: concentration.top3Share },
      occurrenceCount: readiness.productsWithSales,
      confidenceScore: evidenceConfidence(readiness.revenueDays, readiness.productsWithSales, 0.66),
    })
  }

  const pairs = coPurchaseOpportunities(dataset).slice(0, 3)
  for (const pair of pairs) {
    push({
      patternType: 'CORRELATION',
      title: `${pair.productTitle} × ${pair.relatedProductTitle}`,
      description: `These products co-occur in ${Math.round(pair.coPurchaseRate * 100)}% of orders containing ${pair.productTitle}.`,
      patternData: { product: pair.productTitle, related: pair.relatedProductTitle, rate: pair.coPurchaseRate },
      occurrenceCount: Math.max(2, Math.round(pair.coPurchaseRate * 10)),
      confidenceScore: evidenceConfidence(readiness.totalOrders, Math.round(1 / Math.max(0.01, pair.coPurchaseRate)), 0.6),
    })
  }

  const segments = repeatCustomerSegment(dataset)
  if (dataset.customers.length >= 10 && segments.repeatCustomers > 0) {
    push({
      patternType: 'CUSTOMER',
      title: `${segments.repeatShare}% of customers come back for a second order`,
      description: `${segments.repeatCustomers} repeat customers vs ${segments.oneTimeCustomers} one-time buyers — repeat buyers hold ${segments.repeatLtvShare}% of lifetime value.`,
      patternData: { repeatShare: segments.repeatShare, repeatLtvShare: segments.repeatLtvShare, repeatCustomers: segments.repeatCustomers },
      occurrenceCount: segments.repeatCustomers,
      confidenceScore: evidenceConfidence(dataset.customers.length, segments.repeatCustomers, 0.66),
    })
  }

  const anomalies = detectRevenueAnomalies(dataset)
  if (anomalies.length > 0) {
    const latest = anomalies[anomalies.length - 1]
    if (latest) {
      push({
        patternType: 'ANOMALY',
        title: `${anomalies.length} unusual revenue day${anomalies.length === 1 ? '' : 's'} detected`,
        description: `Latest: ${latest.day} (${latest.direction}, ${latest.deviationPercent}% from the daily norm).`,
        patternData: { anomalies: anomalies.map((row) => ({ day: row.day, direction: row.direction, deviationPercent: row.deviationPercent })) },
        occurrenceCount: anomalies.length,
        confidenceScore: evidenceConfidence(readiness.revenueDays, anomalies.length, 0.6),
      })
    }
  }

  // Seasonal proxy: month-over-month direction repeated in the same months.
  const monthly = monthlyTotals(dataset)
  if (monthly.length >= 3) {
    const slopes = monthly.map((point, index) => (index === 0 ? 0 : point.revenue - (monthly[index - 1]?.revenue ?? 0)))
    const rises = slopes.slice(1).filter((slope) => slope > 0).length
    push({
      patternType: 'SEASONAL',
      title: rises >= slopes.length - 1 - rises ? 'Monthly revenue has been rising' : 'Monthly revenue has been easing',
      description: `${monthly.length} closed months observed; the latest month closed at ${monthly[monthly.length - 1]?.revenue ?? 0} ${dataset.currency}.`,
      patternData: { months: monthly },
      occurrenceCount: monthly.length,
      confidenceScore: evidenceConfidence(readiness.revenueDays, monthly.length, 0.58),
    })
  }

  return patterns
    .filter((pattern) => pattern.confidenceScore >= 0.5)
    .sort((left, right) => right.confidenceScore - left.confidenceScore)
    .slice(0, Math.max(1, limit))
}

export function monthlyTotals(dataset: InsightsDataset): readonly Readonly<{ month: string; revenue: number; orders: number }>[] {
  const map = new Map<string, { revenue: number; orders: number }>()
  for (const row of dataset.revenueDaily) {
    const month = row.day.slice(0, 7)
    const entry = map.get(month) ?? { revenue: 0, orders: 0 }
    entry.revenue += row.grossRevenue
    entry.orders += row.orderCount
    map.set(month, entry)
  }
  return [...map.entries()]
    .map(([month, entry]) => ({ month, revenue: round2(entry.revenue), orders: entry.orders }))
    .sort((left, right) => left.month.localeCompare(right.month))
}

/* ── Customer psychology: RFM personas ─────────────────────────────────── */

const PERSONA_POOL = [
  { key: 'champions', name: 'High-Value Champions', emoji: '🏆', minRecency: 30, minOrders: 4, minLtvQuantile: 0.75, motivation: 'Consistency and early access — they buy to stay ahead', reach: 'Loyalty emails, early product drops, VIP bundles' },
  { key: 'loyal', name: 'Loyal Regulars', emoji: '💜', minRecency: 45, minOrders: 3, minLtvQuantile: 0.5, motivation: 'Reliability and routine replenishment', reach: 'Replenishment reminders, subscribe-and-save offers' },
  { key: 'explorers', name: 'New Explorers', emoji: '🌱', minRecency: 30, minOrders: 1, minLtvQuantile: 0, motivation: 'First impressions — they are still deciding if they trust the store', reach: 'Welcome series, first-purchase follow-ups, social proof' },
  { key: 'drifting', name: 'Drifting Regulars', emoji: '🌫️', minRecency: 90, minOrders: 2, minLtvQuantile: 0.25, motivation: 'They bought before — a timely reason to return matters more than discounts', reach: 'Win-back campaigns, "what is new" digests' },
  { key: 'onetime', name: 'One-Time Shoppers', emoji: '🧭', minRecency: 365, minOrders: 1, minLtvQuantile: 0, motivation: 'A single need brought them in; relevance brings them back', reach: 'Cross-sell of complementary products, review requests' },
] as const

/**
 * Clusters the store's real customers into personas using RFM scoring.
 * Deterministic: the same customer list always yields the same personas.
 * Returns an empty array below the data threshold (50 customers) — the UI
 * then shows the honest progress-toward-data empty state.
 */
export function buildPersonas(dataset: InsightsDataset, limit = 5, now = new Date().toISOString()): readonly InsightPersona[] {
  if (dataset.customers.length < PERSONA_MIN_CUSTOMERS) return []
  const ltvSorted = [...dataset.customers.map((customer) => customer.lifetimeValue)].sort((left, right) => left - right)
  const quantile = (q: number): number => ltvSorted[Math.min(ltvSorted.length - 1, Math.floor(q * ltvSorted.length))] ?? 0
  const buckets = new Map<string, typeof dataset.customers>()
  for (const customer of dataset.customers) {
    const key = personaKey(customer, quantile)
    const bucket = buckets.get(key) ?? []
    buckets.set(key, [...bucket, customer])
  }
  const total = dataset.customers.length
  const totalLtv = dataset.customers.reduce((sum, customer) => sum + customer.lifetimeValue, 0)
  const personas: InsightPersona[] = []
  for (const definition of PERSONA_POOL) {
    const members = buckets.get(definition.key) ?? []
    if (members.length === 0) continue
    const memberLtv = members.reduce((sum, customer) => sum + customer.lifetimeValue, 0)
    const avgOrders = mean(members.map((customer) => customer.orderCount))
    const avgLtv = mean(members.map((customer) => customer.lifetimeValue))
    const avgRecency = mean(members.map((customer) => customer.daysSinceLastOrder))
    const recencyScore = clamp01(1 - avgRecency / 180)
    const frequencyScore = clamp01(avgOrders / 6)
    const monetaryScore = clamp01(avgLtv / Math.max(1, quantile(0.9) || avgLtv || 1))
    personas.push({
      id: deterministicId('pers', dataset.storeId, definition.key),
      storeId: dataset.storeId,
      personaName: definition.name,
      personaEmoji: definition.emoji,
      segmentCriteria: { ordersAtLeast: definition.minOrders, lastOrderWithinDays: definition.minRecency, ltvQuantileAtLeast: definition.minLtvQuantile },
      percentageOfCustomers: round2((members.length / total) * 100),
      behaviorPatterns: [
        `Average ${round2(avgOrders)} orders per customer`,
        `Average lifetime value ${round2(avgLtv)} ${dataset.currency}`,
        `Typical gap since last order: ${Math.round(avgRecency)} days`,
      ],
      motivations: [definition.motivation],
      howToReach: [definition.reach],
      estimatedRevenueImpact: round2(memberLtv),
      revenueCurrency: dataset.currency,
      confidenceScore: evidenceConfidence(total, members.length, 0.62),
      customerCount: members.length,
      radar: [
        { trait: 'Recency', score: round2(recencyScore * 100) },
        { trait: 'Frequency', score: round2(frequencyScore * 100) },
        { trait: 'Monetary', score: round2(monetaryScore * 100) },
        { trait: 'Loyalty', score: round2(clamp01((avgOrders - 1) / 4) * 100) },
        { trait: 'Engagement', score: round2(clamp01(1 - avgRecency / 365) * 100) },
      ],
      generatedAt: now,
    })
  }
  return personas.sort((left, right) => right.estimatedRevenueImpact - left.estimatedRevenueImpact).slice(0, Math.max(1, limit))
}

function personaKey(customer: InsightsDataset['customers'][number], quantile: (q: number) => number): string {
  const recent = customer.daysSinceLastOrder <= 45
  const fresh = customer.daysSinceLastOrder <= 30
  const drifting = customer.daysSinceLastOrder > 60 && customer.daysSinceLastOrder <= 120
  if (customer.orderCount >= 4 && recent && customer.lifetimeValue >= quantile(0.75)) return 'champions'
  if (customer.orderCount >= 3 && recent && customer.lifetimeValue >= quantile(0.5)) return 'loyal'
  if (customer.orderCount >= 2 && drifting) return 'drifting'
  if (customer.orderCount <= 1 && fresh) return 'explorers'
  if (customer.orderCount >= 4 && customer.lifetimeValue >= quantile(0.75)) return 'champions'
  if (customer.orderCount >= 3) return 'loyal'
  if (customer.orderCount === 2) return 'drifting'
  return fresh ? 'explorers' : 'onetime'
}

/* ── Why? investigations ───────────────────────────────────────────────── */

const QUESTION_TOPICS: readonly Readonly<{ keys: readonly string[]; topic: 'revenue' | 'orders' | 'aov' | 'product' | 'customers' }>[] = [
  { keys: ['revenue', 'sales', 'money', 'income', 'turnover'], topic: 'revenue' },
  { keys: ['order', 'orders', 'checkout', 'purchase'], topic: 'orders' },
  { keys: ['aov', 'average order', 'basket', 'cart value', 'spend per'], topic: 'aov' },
  { keys: ['customer', 'repeat', 'retention', 'loyalty', 'churn'], topic: 'customers' },
  { keys: ['product', 'sku', 'item', 'inventory', 'stock'], topic: 'product' },
]

/**
 * Decomposes a merchant's question into data-backed root causes. The classic
 * revenue identity (revenue = orders × AOV) plus product-mix deltas give
 * honest, evidence-carrying causes. No language model is involved here, so
 * no hallucination is possible — the AI layer may only restyle the text.
 */
export function investigate(question: string, dataset: InsightsDataset, now = new Date().toISOString()): InsightInvestigation {
  const normalized = question.trim().toLowerCase()
  if (normalized.length < 4) throw new AppError('VALIDATION_ERROR', 'Ask a full question (at least 4 characters).', 400, { field: 'question' })
  if (normalized.length > 400) throw new AppError('VALIDATION_ERROR', 'Keep the question under 400 characters.', 400, { field: 'question' })
  const topic = QUESTION_TOPICS.find((candidate) => candidate.keys.some((key) => normalized.includes(key)))?.topic ?? 'revenue'
  const momentum = periodOverPeriod(dataset)
  const readiness = insightsDataReadiness(dataset)
  const dataSources: string[] = ['analytics_revenue_daily', 'analytics_orders_daily']
  const rootCauses: RootCause[] = []
  const steps = ['Parsed the question and chose the analysis lens', 'Compared the last 30 days against the prior 30 days', 'Ranked candidate causes by measured impact']

  if (momentum.previous.revenue > 0 && momentum.current.revenue !== momentum.previous.revenue) {
    const revenueDelta = momentum.current.revenue - momentum.previous.revenue
    const orderEffect = momentum.previous.aov ? (momentum.current.orders - momentum.previous.orders) * momentum.previous.aov : 0
    const aovEffect = momentum.current.aov && momentum.previous.aov ? (momentum.current.aov - momentum.previous.aov) * momentum.current.orders : 0
    const totalEffect = Math.abs(orderEffect) + Math.abs(aovEffect)
    const share = (effect: number): number => (revenueDelta === 0 || totalEffect === 0 ? 0 : Math.min(100, round2((Math.abs(effect) / Math.max(Math.abs(revenueDelta), totalEffect)) * 100)))
    if (Math.abs(orderEffect) > 1) {
      rootCauses.push({
        cause: topic === 'aov' ? 'Order volume moved while basket size was the lever you asked about' : `Order volume ${momentum.current.orders >= momentum.previous.orders ? 'rose' : 'fell'} (${momentum.previous.orders} → ${momentum.current.orders})`,
        impactShare: share(orderEffect),
        evidence: `Orders changed by ${momentum.ordersChange ?? 0}% between the two 30-day windows; at the prior AOV this alone moves revenue by ${round2(orderEffect)} ${dataset.currency}.`,
        confidence: evidenceConfidence(readiness.revenueDays, readiness.totalOrders, 0.66),
      })
    }
    if (Math.abs(aovEffect) > 1) {
      rootCauses.push({
        cause: `Average order value ${(momentum.aovChange ?? 0) >= 0 ? 'improved' : 'slipped'} (${momentum.previous.aov ?? 0} → ${momentum.current.aov ?? 0} ${dataset.currency})`,
        impactShare: share(aovEffect),
        evidence: `AOV changed by ${momentum.aovChange ?? 0}% — at current order volume this shifts revenue by ${round2(aovEffect)} ${dataset.currency}.`,
        confidence: evidenceConfidence(readiness.revenueDays, readiness.totalOrders, 0.64),
      })
    }
    steps.push('Decomposed the change into order-volume and basket-size effects')
  }

  // Product-mix contribution.
  const productShift = topProductShift(dataset)
  if (productShift) {
    dataSources.push('analytics_product_sales_daily')
    rootCauses.push({
      cause: `Product mix shifted — ${productShift.title} moved ${Math.abs(productShift.deltaPercent)}%`,
      impactShare: Math.min(100, round2(Math.abs(productShift.deltaPercent))),
      evidence: `${productShift.title}: ${productShift.priorRevenue} → ${productShift.recentRevenue} ${dataset.currency} (last 14 days vs prior 14).`,
      confidence: evidenceConfidence(readiness.revenueDays, readiness.productsWithSales, 0.58),
    })
    steps.push('Checked which products carried or dragged the change')
  }

  const segments = repeatCustomerSegment(dataset)
  if (topic === 'customers' && dataset.customers.length > 0) {
    dataSources.push('synced customer records')
    rootCauses.push({
      cause: `Repeat-purchase structure: ${segments.repeatShare}% of customers buy again`,
      impactShare: segments.repeatLtvShare,
      evidence: `${segments.repeatCustomers} repeat customers hold ${segments.repeatLtvShare}% of lifetime value; ${segments.oneTimeCustomers} bought once.`,
      confidence: evidenceConfidence(dataset.customers.length, segments.repeatCustomers, 0.6),
    })
  }

  const ranked = rootCauses.sort((left, right) => right.impactShare - left.impactShare)
  const confidence = ranked.length === 0 ? 0.4 : round2(mean(ranked.map((cause) => cause.confidence)))
  const dominant = ranked[0]
  const whatToDo: string[] = []
  if (dominant) {
    whatToDo.push(`Start with the leading cause (${dominant.impactShare}% of the measured change): ${dominant.cause}`)
    if (momentum.aovChange !== null && momentum.aovChange < 0) whatToDo.push('Test a bundle or tiered free-shipping threshold to rebuild basket size.')
    if ((momentum.ordersChange ?? 0) < 0) whatToDo.push('Re-engage your best weekday and peak hour with a scheduled campaign (see the Time patterns in the Pattern Lab).')
  } else {
    whatToDo.push('The last two 30-day windows look statistically flat. Try Ask Why with a specific product or segment to go deeper.')
  }
  const preventionTips = [
    'Watch the Trend Watcher daily — a sustained two-week move is visible there before it hits a monthly report.',
    'Save this investigation to the Knowledge Base so the evidence is one search away next time.',
  ]
  if (topic === 'customers') preventionTips.push('Keep the repeat-customer pattern above its current level — a dipping repeat LTV share is the earliest churn warning.')

  return {
    id: deterministicId('inv', dataset.storeId, normalized.slice(0, 48), now),
    storeId: dataset.storeId,
    question: question.trim(),
    status: 'COMPLETED',
    steps,
    dataSourcesAnalyzed: unique(dataSources),
    rootCauses: ranked,
    confidenceScore: confidence,
    whatToDo,
    preventionTips,
    createdAt: now,
    completedAt: now,
  }
}

export function topProductShift(dataset: InsightsDataset, windowDays = 14): Readonly<{ productId: string; title: string; recentRevenue: number; priorRevenue: number; deltaPercent: number }> | null {
  const lastDay = dataset.productSalesDaily.reduce((max, row) => (row.day > max ? row.day : max), '0000-00-00')
  if (lastDay === '0000-00-00') return null
  const recentStart = shiftDay(lastDay, -(windowDays - 1))
  const priorStart = shiftDay(lastDay, -(2 * windowDays - 1))
  const priorEnd = shiftDay(recentStart, -1)
  const map = new Map<string, { recent: number; prior: number }>()
  for (const row of dataset.productSalesDaily) {
    const entry = map.get(row.productId) ?? { recent: 0, prior: 0 }
    if (row.day >= recentStart && row.day <= lastDay) entry.recent += row.grossRevenue
    else if (row.day >= priorStart && row.day <= priorEnd) entry.prior += row.grossRevenue
    map.set(row.productId, entry)
  }
  const titleById = new Map(dataset.products.map((product) => [product.productId, product.title]))
  let best: { productId: string; title: string; recentRevenue: number; priorRevenue: number; deltaPercent: number } | null = null
  for (const [productId, entry] of map) {
    if (entry.prior <= 0 && entry.recent <= 0) continue
    const deltaPercent = entry.prior > 0 ? round2(((entry.recent - entry.prior) / entry.prior) * 100) : entry.recent > 0 ? 100 : 0
    if (!best || Math.abs(deltaPercent) > Math.abs(best.deltaPercent)) {
      best = { productId, title: titleById.get(productId) ?? productId, recentRevenue: round2(entry.recent), priorRevenue: round2(entry.prior), deltaPercent }
    }
  }
  return best && Math.abs(best.deltaPercent) >= 15 ? best : null
}

export const SUGGESTED_WHY_QUESTIONS: readonly string[] = [
  'Why did my revenue change this month?',
  'Why are my orders down this week?',
  'Why did my average order value drop?',
  'Why are customers not coming back?',
  'Why is one product suddenly selling more?',
]

/* ── Trend watcher ─────────────────────────────────────────────────────── */

export function detectTrends(dataset: InsightsDataset, now = new Date().toISOString()): readonly InsightTrend[] {
  const readiness = insightsDataReadiness(dataset)
  if (!readiness.canDiscover) return []
  const trends: InsightTrend[] = []
  const push = (trend: Omit<InsightTrend, 'id' | 'storeId' | 'detectedAt' | 'alertsEnabled'>): void => {
    trends.push({ ...trend, id: deterministicId('trnd', dataset.storeId, trend.trendType, trend.title), storeId: dataset.storeId, detectedAt: now, alertsEnabled: false })
  }
  const momentum = periodOverPeriod(dataset, 14)
  const classify = (change: number | null): TrendDirection => (change === null || Math.abs(change) < 5 ? 'STABLE' : change > 0 ? 'UP' : 'DOWN')

  if (momentum.revenueChange !== null) {
    push({
      trendType: 'BUSINESS',
      category: 'REVENUE',
      title: classify(momentum.revenueChange) === 'UP' ? 'Revenue is trending up' : classify(momentum.revenueChange) === 'DOWN' ? 'Revenue is trending down' : 'Revenue is stable',
      description: `14-day revenue ${momentum.revenueChange}% vs the prior 14 days (${momentum.previous.revenue} → ${momentum.current.revenue} ${dataset.currency}).`,
      direction: classify(momentum.revenueChange),
      magnitude: Math.abs(momentum.revenueChange),
      timePeriod: 'LAST_14_DAYS',
      dataSource: 'INTERNAL',
      confidenceScore: evidenceConfidence(readiness.revenueDays, readiness.totalOrders, 0.6),
    })
  }
  if (momentum.ordersChange !== null) {
    push({
      trendType: 'BUSINESS',
      category: 'OPERATIONS',
      title: classify(momentum.ordersChange) === 'UP' ? 'Order volume is growing' : classify(momentum.ordersChange) === 'DOWN' ? 'Order volume is softening' : 'Order volume is flat',
      description: `14-day orders ${momentum.ordersChange}% (${momentum.previous.orders} → ${momentum.current.orders}).`,
      direction: classify(momentum.ordersChange),
      magnitude: Math.abs(momentum.ordersChange),
      timePeriod: 'LAST_14_DAYS',
      dataSource: 'INTERNAL',
      confidenceScore: evidenceConfidence(readiness.revenueDays, readiness.totalOrders, 0.58),
    })
  }
  if (momentum.aovChange !== null) {
    push({
      trendType: 'BUSINESS',
      category: 'REVENUE',
      title: classify(momentum.aovChange) === 'UP' ? 'Baskets are getting bigger' : classify(momentum.aovChange) === 'DOWN' ? 'Baskets are getting smaller' : 'Basket size is steady',
      description: `Average order value ${momentum.aovChange}% (${momentum.previous.aov ?? 0} → ${momentum.current.aov ?? 0} ${dataset.currency}).`,
      direction: classify(momentum.aovChange),
      magnitude: Math.abs(momentum.aovChange),
      timePeriod: 'LAST_14_DAYS',
      dataSource: 'INTERNAL',
      confidenceScore: evidenceConfidence(readiness.revenueDays, readiness.totalOrders, 0.56),
    })
  }

  for (const product of risingProducts(dataset)) {
    push({
      trendType: product.priorUnits === 0 ? 'EMERGING' : 'BUSINESS',
      category: 'PRODUCTS',
      title: product.priorUnits === 0 ? `${product.productTitle} just started selling` : `${product.productTitle} demand is rising`,
      description: `${product.recentUnits} units in the last 14 days vs ${product.priorUnits} before (+${product.growthPercent}%).`,
      direction: 'UP',
      magnitude: product.growthPercent,
      timePeriod: 'LAST_14_DAYS',
      dataSource: 'INTERNAL',
      confidenceScore: evidenceConfidence(readiness.revenueDays, product.recentUnits, 0.58),
    })
  }

  // Declining products.
  const declining = decliningProducts(dataset)
  for (const product of declining) {
    push({
      trendType: 'DECLINING',
      category: 'PRODUCTS',
      title: `${product.productTitle} is cooling off`,
      description: `${product.recentUnits} units in the last 14 days vs ${product.priorUnits} before (${product.growthPercent}%).`,
      direction: 'DOWN',
      magnitude: Math.abs(product.growthPercent),
      timePeriod: 'LAST_14_DAYS',
      dataSource: 'INTERNAL',
      confidenceScore: evidenceConfidence(readiness.revenueDays, product.priorUnits, 0.56),
    })
  }

  return trends.sort((left, right) => right.confidenceScore - left.confidenceScore).slice(0, 24)
}

export function decliningProducts(dataset: InsightsDataset, windowDays = 14): readonly Readonly<{ productId: string; productTitle: string; recentUnits: number; priorUnits: number; growthPercent: number }>[] {
  const lastDay = dataset.productSalesDaily.reduce((max, row) => (row.day > max ? row.day : max), '0000-00-00')
  if (lastDay === '0000-00-00') return []
  const recentStart = shiftDay(lastDay, -(windowDays - 1))
  const priorStart = shiftDay(lastDay, -(2 * windowDays - 1))
  const priorEnd = shiftDay(recentStart, -1)
  const map = new Map<string, { recent: number; prior: number }>()
  for (const row of dataset.productSalesDaily) {
    const entry = map.get(row.productId) ?? { recent: 0, prior: 0 }
    if (row.day >= recentStart && row.day <= lastDay) entry.recent += row.unitsSold
    else if (row.day >= priorStart && row.day <= priorEnd) entry.prior += row.unitsSold
    map.set(row.productId, entry)
  }
  const titleById = new Map(dataset.products.map((product) => [product.productId, product.title]))
  return [...map.entries()]
    .filter(([, entry]) => entry.prior >= 3 && entry.recent < entry.prior * 0.7)
    .map(([productId, entry]) => ({
      productId,
      productTitle: titleById.get(productId) ?? productId,
      recentUnits: entry.recent,
      priorUnits: entry.prior,
      growthPercent: round2(((entry.recent - entry.prior) / entry.prior) * 100),
    }))
    .sort((left, right) => left.growthPercent - right.growthPercent)
    .slice(0, 6)
}

/* ── Comparative studies ───────────────────────────────────────────────── */

export function runComparison(dataset: InsightsDataset, comparisonType: ComparisonType, subjectAId: string, subjectBId: string, now = new Date().toISOString()): InsightComparison {
  if (comparisonType === 'PRODUCT') return compareProducts(dataset, subjectAId, subjectBId, now)
  if (comparisonType === 'PERIOD') return comparePeriods(dataset, subjectAId, subjectBId, now)
  if (comparisonType === 'SEGMENT') return compareSegments(dataset, subjectAId, subjectBId, now)
  if (comparisonType === 'CATEGORY') return compareCategories(dataset, subjectAId, subjectBId, now)
  return {
    id: deterministicId('cmp', dataset.storeId, comparisonType, subjectAId, subjectBId, now),
    storeId: dataset.storeId,
    comparisonType,
    title: 'Channel comparison',
    subjectA: { id: subjectAId },
    subjectB: { id: subjectBId },
    metrics: [],
    winner: 'INSUFFICIENT_DATA',
    insights: ['Channel attribution is not available in the synced data yet — Shopify channel fields begin appearing after the next sync. No comparison will be invented.'],
    createdAt: now,
  }
}

function productStats(dataset: InsightsDataset, productId: string): Readonly<{ units: number; revenue: number; averageDailyUnits: number; days: number }> {
  const rows = dataset.productSalesDaily.filter((row) => row.productId === productId)
  const units = rows.reduce((sum, row) => sum + row.unitsSold, 0)
  const revenue = rows.reduce((sum, row) => sum + row.grossRevenue, 0)
  const days = new Set(rows.filter((row) => row.unitsSold > 0).map((row) => row.day)).size
  return { units, revenue: round2(revenue), averageDailyUnits: days > 0 ? round2(units / days) : 0, days }
}

function compareProducts(dataset: InsightsDataset, aId: string, bId: string, now: string): InsightComparison {
  const a = productStats(dataset, aId)
  const b = productStats(dataset, bId)
  const titleA = dataset.products.find((product) => product.productId === aId)?.title ?? aId
  const titleB = dataset.products.find((product) => product.productId === bId)?.title ?? bId
  if (a.days === 0 && b.days === 0) {
    return { id: deterministicId('cmp', dataset.storeId, 'PRODUCT', aId, bId, now), storeId: dataset.storeId, comparisonType: 'PRODUCT', title: `${titleA} vs ${titleB}`, subjectA: { id: aId, title: titleA }, subjectB: { id: bId, title: titleB }, metrics: [], winner: 'INSUFFICIENT_DATA', insights: ['Neither product has recorded sales yet — sync more order history for a meaningful comparison.'], createdAt: now }
  }
  const metrics = [
    compareMetric('units_sold', a.units, b.units),
    compareMetric('revenue', a.revenue, b.revenue),
    compareMetric('daily_velocity', a.averageDailyUnits, b.averageDailyUnits),
    compareMetric('active_days', a.days, b.days),
  ]
  const wins = metrics.filter((metric) => metric.winner === 'A').length
  const winner = wins === metrics.length - wins ? 'TIE' : wins > metrics.length - wins ? 'A' : 'B'
  return {
    id: deterministicId('cmp', dataset.storeId, 'PRODUCT', aId, bId, now),
    storeId: dataset.storeId,
    comparisonType: 'PRODUCT',
    title: `${titleA} vs ${titleB}`,
    subjectA: { id: aId, title: titleA, ...a },
    subjectB: { id: bId, title: titleB, ...b },
    metrics,
    winner,
    insights: [
      winner === 'TIE' ? 'The two products are statistically neck-and-neck across the measured window.' : `${winner === 'A' ? titleA : titleB} leads on ${Math.max(wins, metrics.length - wins)} of ${metrics.length} metrics.`,
      `${titleA}: ${a.units} units / ${a.revenue} ${dataset.currency}. ${titleB}: ${b.units} units / ${b.revenue} ${dataset.currency}.`,
    ],
    createdAt: now,
  }
}

function comparePeriods(dataset: InsightsDataset, startDayA: string, startDayB: string, now: string): InsightComparison {
  const windowStats = (startDay: string): Readonly<{ revenue: number; orders: number; aov: number | null; label: string }> => {
    const end = shiftDay(startDay, 29)
    const revenue = dataset.revenueDaily.filter((row) => row.day >= startDay && row.day <= end).reduce((sum, row) => sum + row.grossRevenue, 0)
    const orders = dataset.ordersDaily.filter((row) => row.day >= startDay && row.day <= end).reduce((sum, row) => sum + row.orderCount, 0)
    return { revenue: round2(revenue), orders, aov: orders > 0 ? round2(revenue / orders) : null, label: `${startDay} → ${end}` }
  }
  const a = windowStats(startDayA)
  const b = windowStats(startDayB)
  if (a.revenue === 0 && b.revenue === 0 && a.orders === 0 && b.orders === 0) {
    return { id: deterministicId('cmp', dataset.storeId, 'PERIOD', startDayA, startDayB, now), storeId: dataset.storeId, comparisonType: 'PERIOD', title: `${a.label} vs ${b.label}`, subjectA: { label: a.label }, subjectB: { label: b.label }, metrics: [], winner: 'INSUFFICIENT_DATA', insights: ['Both selected windows are empty in the synced data. Pick windows inside your analytics history.'], createdAt: now }
  }
  const metrics = [
    compareMetric('revenue', a.revenue, b.revenue),
    compareMetric('orders', a.orders, b.orders),
    compareMetric('aov', a.aov, b.aov),
  ]
  const wins = metrics.filter((metric) => metric.winner === 'A').length
  const winner = wins === metrics.length - wins ? 'TIE' : wins > metrics.length - wins ? 'A' : 'B'
  return {
    id: deterministicId('cmp', dataset.storeId, 'PERIOD', startDayA, startDayB, now),
    storeId: dataset.storeId,
    comparisonType: 'PERIOD',
    title: `${a.label} vs ${b.label}`,
    subjectA: { label: a.label, revenue: a.revenue, orders: a.orders, aov: a.aov },
    subjectB: { label: b.label, revenue: b.revenue, orders: b.orders, aov: b.aov },
    metrics,
    winner,
    insights: [
      `Revenue moved ${percentDelta(a.revenue, b.revenue) ?? '—'} between the two windows.`,
      winner === 'TIE' ? 'No window dominates — performance was consistent.' : `${winner === 'A' ? 'The first window' : 'The second window'} leads on ${Math.max(wins, metrics.length - wins)} of ${metrics.length} metrics.`,
    ],
    createdAt: now,
  }
}

function segmentMembers(dataset: InsightsDataset, segment: 'REPEAT' | 'ONE_TIME' | 'HIGH_VALUE' | 'AT_RISK'): readonly InsightsDataset['customers'][number][] {
  if (segment === 'REPEAT') return dataset.customers.filter((customer) => customer.orderCount >= 2)
  if (segment === 'ONE_TIME') return dataset.customers.filter((customer) => customer.orderCount < 2)
  if (segment === 'HIGH_VALUE') {
    const sorted = [...dataset.customers.map((customer) => customer.lifetimeValue)].sort((left, right) => left - right)
    const q75 = sorted[Math.floor(sorted.length * 0.75)] ?? Number.POSITIVE_INFINITY
    return dataset.customers.filter((customer) => customer.lifetimeValue >= q75)
  }
  return dataset.customers.filter((customer) => customer.daysSinceLastOrder > 60)
}

export const SEGMENT_IDS = ['REPEAT', 'ONE_TIME', 'HIGH_VALUE', 'AT_RISK'] as const
export type SegmentId = (typeof SEGMENT_IDS)[number]

function compareSegments(dataset: InsightsDataset, aId: string, bId: string, now: string): InsightComparison {
  const safeA = (SEGMENT_IDS as readonly string[]).includes(aId) ? (aId as SegmentId) : null
  const safeB = (SEGMENT_IDS as readonly string[]).includes(bId) ? (bId as SegmentId) : null
  if (!safeA || !safeB) throw new AppError('VALIDATION_ERROR', `Segment ids must be one of: ${SEGMENT_IDS.join(', ')}`, 400, { a: aId, b: bId })
  const membersA = segmentMembers(dataset, safeA)
  const membersB = segmentMembers(dataset, safeB)
  if (membersA.length === 0 || membersB.length === 0) {
    return { id: deterministicId('cmp', dataset.storeId, 'SEGMENT', aId, bId, now), storeId: dataset.storeId, comparisonType: 'SEGMENT', title: `${safeA} vs ${safeB}`, subjectA: { id: safeA }, subjectB: { id: safeB }, metrics: [], winner: 'INSUFFICIENT_DATA', insights: ['One of the segments is empty — segments populate as more customers sync.'], createdAt: now }
  }
  const ltv = (members: readonly InsightsDataset['customers'][number][]): number => round2(members.reduce((sum, customer) => sum + customer.lifetimeValue, 0))
  const avgOrders = (members: readonly InsightsDataset['customers'][number][]): number => round2(mean(members.map((customer) => customer.orderCount)))
  const metrics = [
    compareMetric('customers', membersA.length, membersB.length),
    compareMetric('lifetime_value', ltv(membersA), ltv(membersB)),
    compareMetric('avg_orders', avgOrders(membersA), avgOrders(membersB)),
  ]
  const wins = metrics.filter((metric) => metric.winner === 'A').length
  const winner = wins === metrics.length - wins ? 'TIE' : wins > metrics.length - wins ? 'A' : 'B'
  return {
    id: deterministicId('cmp', dataset.storeId, 'SEGMENT', aId, bId, now),
    storeId: dataset.storeId,
    comparisonType: 'SEGMENT',
    title: `${safeA.replaceAll('_', ' ')} vs ${safeB.replaceAll('_', ' ')}`,
    subjectA: { id: safeA, customers: membersA.length, ltv: ltv(membersA) },
    subjectB: { id: safeB, customers: membersB.length, ltv: ltv(membersB) },
    metrics,
    winner,
    insights: [`${safeA.replaceAll('_', ' ')} holds ${membersA.length} customers worth ${ltv(membersA)} ${dataset.currency}; ${safeB.replaceAll('_', ' ')} holds ${membersB.length} worth ${ltv(membersB)} ${dataset.currency}.`],
    createdAt: now,
  }
}

function compareCategories(dataset: InsightsDataset, aName: string, bName: string, now: string): InsightComparison {
  const categoryProducts = (name: string): readonly string[] => dataset.products.filter((product) => (product.category ?? '').toLowerCase() === name.toLowerCase()).map((product) => product.productId)
  const setA = new Set(categoryProducts(aName))
  const setB = new Set(categoryProducts(bName))
  if (setA.size === 0 || setB.size === 0) {
    return { id: deterministicId('cmp', dataset.storeId, 'CATEGORY', aName, bName, now), storeId: dataset.storeId, comparisonType: 'CATEGORY', title: `${aName} vs ${bName}`, subjectA: { name: aName }, subjectB: { name: bName }, metrics: [], winner: 'INSUFFICIENT_DATA', insights: ['Category data comes from your synced product types — one of these categories has no products yet.'], createdAt: now }
  }
  const stats = (ids: ReadonlySet<string>): Readonly<{ units: number; revenue: number; products: number }> => {
    const rows = dataset.productSalesDaily.filter((row) => ids.has(row.productId))
    return { units: rows.reduce((sum, row) => sum + row.unitsSold, 0), revenue: round2(rows.reduce((sum, row) => sum + row.grossRevenue, 0)), products: ids.size }
  }
  const a = stats(setA)
  const b = stats(setB)
  const metrics = [compareMetric('revenue', a.revenue, b.revenue), compareMetric('units', a.units, b.units), compareMetric('catalog_size', a.products, b.products)]
  const wins = metrics.filter((metric) => metric.winner === 'A').length
  const winner = wins === metrics.length - wins ? 'TIE' : wins > metrics.length - wins ? 'A' : 'B'
  return {
    id: deterministicId('cmp', dataset.storeId, 'CATEGORY', aName, bName, now),
    storeId: dataset.storeId,
    comparisonType: 'CATEGORY',
    title: `${aName} vs ${bName}`,
    subjectA: { name: aName, ...a },
    subjectB: { name: bName, ...b },
    metrics,
    winner,
    insights: [`${aName}: ${a.revenue} ${dataset.currency} across ${a.products} products; ${bName}: ${b.revenue} ${dataset.currency} across ${b.products}.`],
    createdAt: now,
  }
}

function compareMetric(metric: string, a: number | null, b: number | null): Readonly<{ metric: string; a: number | null; b: number | null; delta: number | null; winner: 'A' | 'B' | 'TIE' }> {
  const delta = a !== null && b !== null && b !== 0 ? round2(((a - b) / Math.abs(b)) * 100) : null
  const winner = a === null || b === null || a === b ? 'TIE' : a > b ? 'A' : 'B'
  return { metric, a, b, delta, winner }
}

/* ── Predictive insights ───────────────────────────────────────────────── */

const HORIZON_DAYS: Readonly<Record<PredictionHorizon, number>> = { '7_DAYS': 7, '30_DAYS': 30, '90_DAYS': 90 }

/**
 * Weekday-seasonal + linear-trend blend forecast. Honest by construction:
 * confidence scales with history length, and intervals widen with residual
 * volatility. Returns null when history is too thin to predict anything.
 */
export function forecastRevenue(dataset: InsightsDataset, horizon: PredictionHorizon, now = new Date().toISOString()): InsightPrediction | null {
  const readiness = insightsDataReadiness(dataset)
  if (!readiness.canPredict) return null
  const days = HORIZON_DAYS[horizon]
  const sorted = [...dataset.revenueDaily].sort((left, right) => left.day.localeCompare(right.day))
  const lastDay = sorted[sorted.length - 1]?.day ?? now.slice(0, 10)
  const values = sorted.map((row) => row.grossRevenue)
  const slope = linearSlope(values.map((value, index) => ({ x: index, y: value })))
  const weekdayAvg = new Map<number, number>()
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const dayValues = sorted.filter((row) => new Date(`${row.day}T00:00:00Z`).getUTCDay() === weekday).map((row) => row.grossRevenue)
    weekdayAvg.set(weekday, dayValues.length > 0 ? mean(dayValues) : mean(values))
  }
  const n = values.length
  const residuals = values.map((value, index) => value - ((weekdayAvg.get(new Date(`${sorted[index]?.day}T00:00:00Z`).getUTCDay()) ?? mean(values)) + slope * (index - n / 2)))
  const sd = Math.max(1, stdev(residuals))
  const series: Array<{ day: string; value: number; lower: number; upper: number }> = []
  for (let offset = 1; offset <= days; offset += 1) {
    const day = shiftDay(lastDay, offset)
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    const base = (weekdayAvg.get(weekday) ?? mean(values)) + slope * (n / 2 + offset)
    const value = Math.max(0, round2(base))
    series.push({ day, value, lower: Math.max(0, round2(base - 1.28 * sd)), upper: round2(base + 1.28 * sd) })
  }
  const predictedValue = round2(series.reduce((sum, point) => sum + point.value, 0))
  const confidence = evidenceConfidence(readiness.revenueDays, n, horizon === '7_DAYS' ? 0.66 : horizon === '30_DAYS' ? 0.58 : 0.5)
  return {
    id: deterministicId('pred', dataset.storeId, 'REVENUE', horizon, lastDay),
    storeId: dataset.storeId,
    predictionType: 'REVENUE',
    horizon,
    title: `${days}-day revenue forecast`,
    description: `Expected revenue over the next ${days} days, blended from your weekday seasonality and the linear trend of ${n} days of history.`,
    predictedValue,
    predictedLow: round2(series.reduce((sum, point) => sum + point.lower, 0)),
    predictedHigh: round2(series.reduce((sum, point) => sum + point.upper, 0)),
    currency: dataset.currency,
    confidenceScore: confidence,
    method: 'weekday-seasonal mean + linear trend, 80% interval from residuals',
    series,
    basedOn: ['analytics_revenue_daily'],
    predictedFor: shiftDay(lastDay, days),
    actualValue: null,
    accuracyScore: null,
    createdAt: now,
  }
}

export function forecastOrders(dataset: InsightsDataset, horizon: PredictionHorizon, now = new Date().toISOString()): InsightPrediction | null {
  const mapped: InsightsDataset = { ...dataset, revenueDaily: dataset.revenueDaily.map((row) => ({ day: row.day, grossRevenue: row.orderCount, orderCount: row.orderCount })) }
  const base = forecastRevenue(mapped, horizon, now)
  if (!base) return null
  const days = HORIZON_DAYS[horizon]
  return { ...base, id: deterministicId('pred', dataset.storeId, 'ORDERS', horizon, now.slice(0, 10)), predictionType: 'ORDERS', title: `${days}-day order forecast`, description: `Expected order count over the next ${days} days from your observed weekday rhythm and volume trend.`, currency: dataset.currency, basedOn: ['analytics_orders_daily'] }
}

export function predictStockouts(dataset: InsightsDataset, now = new Date().toISOString()): readonly InsightPrediction[] {
  // Uses sales velocity from productSalesDaily against zero assumed on-hand
  // knowledge — inventory positions come from the inventory module, so this
  // predictor only fires when we can compute a real velocity.
  const readiness = insightsDataReadiness(dataset)
  if (readiness.productsWithSales === 0) return []
  const lastDay = dataset.productSalesDaily.reduce((max, row) => (row.day > max ? row.day : max), '0000-00-00')
  const since = shiftDay(lastDay, -29)
  const byProduct = new Map<string, number>()
  for (const row of dataset.productSalesDaily) {
    if (row.day >= since) byProduct.set(row.productId, (byProduct.get(row.productId) ?? 0) + row.unitsSold)
  }
  const titleById = new Map(dataset.products.map((product) => [product.productId, product.title]))
  const predictions: InsightPrediction[] = []
  let rank = 0
  for (const [productId, units30] of [...byProduct.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3)) {
    rank += 1
    const velocity = units30 / 30
    if (velocity <= 0) continue
    predictions.push({
      id: deterministicId('pred', dataset.storeId, 'INVENTORY', productId, lastDay),
      storeId: dataset.storeId,
      predictionType: 'INVENTORY',
      horizon: '30_DAYS',
      title: `${titleById.get(productId) ?? productId} is selling ~${round2(velocity)} units/day`,
      description: `At the measured 30-day velocity (${units30} units), every 10 units of stock cover ~${Math.max(1, Math.round(10 / velocity))} days. Pair this with live stock levels in Inventory.`,
      predictedValue: round2(units30),
      predictedLow: round2(units30 * 0.8),
      predictedHigh: round2(units30 * 1.2),
      currency: dataset.currency,
      confidenceScore: evidenceConfidence(readiness.revenueDays, units30, 0.56),
      method: 'trailing 30-day sell-through velocity',
      series: [],
      basedOn: ['analytics_product_sales_daily'],
      predictedFor: shiftDay(lastDay, 30),
      actualValue: null,
      accuracyScore: null,
      createdAt: now,
    })
    if (rank >= 3) break
  }
  return predictions
}

function percentDelta(a: number, b: number): string | null {
  if (b === 0) return null
  return `${round2(((a - b) / Math.abs(b)) * 100)}%`
}

/* ── Learning library ──────────────────────────────────────────────────── */

/**
 * Builds a personalized lesson from real store metrics. The markdown embeds
 * only numbers measured from the dataset, so the language firewall can
 * verify every claim. `sample` marks trial-preview lessons explicitly.
 */
export function generateLesson(dataset: InsightsDataset, category: DiscoveryCategory, options: Readonly<{ now?: string; sample?: boolean }> = {}): InsightLesson | null {
  const now = options.now ?? new Date().toISOString()
  const readiness = insightsDataReadiness(dataset)
  if (!readiness.canDiscover && !options.sample) return null
  const sample = options.sample === true
  const profile = weekdayProfile(dataset)
  const best = [...profile].sort((left, right) => right.revenueShare - left.revenueShare)[0]
  const momentum = periodOverPeriod(dataset)
  const segments = repeatCustomerSegment(dataset)
  const concentration = revenueConcentration(dataset)

  let title = ''
  let sections: Array<{ heading: string; body: string }> = []
  let lessonType: LessonType = 'PATTERN_STUDY'
  let actionItems: string[] = []

  if (category === 'TIME' && best) {
    lessonType = 'PATTERN_STUDY'
    title = `Your store's weekly rhythm: why ${best.name}s matter`
    sections = [
      { heading: 'The pattern in your data', body: `Across your synced history, ${best.name} carries the largest revenue share at ${best.revenueShare}%. Every store has a rhythm — yours is measurable, not guessed.` },
      { heading: 'Why rhythms happen', body: `Buyer routines (paydays, weekends, commute hours) repeat. When ${best.name} consistently leads, customers are shopping on a schedule you can meet instead of chase.` },
      { heading: 'Using this lesson', body: `Schedule campaigns, drops, and restocks inside the winning window. The Pattern Lab keeps this profile updated as new orders sync.` },
    ]
    actionItems = [`Plan your next campaign for ${best.name}`, 'Check hourly peaks in the Pattern Lab', 'Save this lesson to your Knowledge Base']
  } else if (category === 'CUSTOMERS' && dataset.customers.length > 0) {
    lessonType = 'BEHAVIOR_ANALYSIS'
    title = 'Repeat buyers: understanding who really funds your store'
    sections = [
      { heading: 'Your repeat structure', body: `${segments.repeatCustomers} of your ${dataset.customers.length} customers ordered more than once. They hold ${segments.repeatLtvShare}% of lifetime value — the compounding core of the business.` },
      { heading: 'Why repeat behavior matters', body: 'A store that grows repeat share grows without buying attention twice. Your repeat LTV share is the single number that tells you whether marketing is building an asset or renting one.' },
      { heading: 'What to watch', body: 'If repeat share falls while revenue rises, growth is acquisition-heavy — great this month, expensive next quarter. The personas page shows this split as it moves.' },
    ]
    actionItems = ['Open Customer Personas to see these segments as profiles', 'Compare REPEAT vs ONE_TIME segments in Comparative Studies']
  } else if (category === 'PRODUCTS' && concentration.topProductId) {
    lessonType = 'BEST_PRACTICE'
    title = 'Hero products: riding winners without becoming fragile'
    sections = [
      { heading: 'Your concentration today', body: `${concentration.topProductTitle} carries ${concentration.topShare}% of product revenue; the top three carry ${concentration.top3Share}%.` },
      { heading: 'The trade-off', body: 'A hero product lowers marketing cost per order — but concentrates risk. Merchants usually balance by protecting the hero (inventory depth, ad support) while seeding one challenger product.' },
      { heading: 'From your own catalog', body: 'The co-purchase pairs in your Discovery feed show which products naturally attach to the hero — those are your cheapest second pillars.' },
    ]
    actionItems = ['Review stock depth for the hero product', 'Try one bundle using your top co-purchase pair']
  } else if (category === 'REVENUE' && momentum.revenueChange !== null) {
    lessonType = 'CASE_STUDY'
    title = 'Reading a revenue move: orders, baskets, or mix?'
    sections = [
      { heading: 'Your last two windows', body: `Last 30 days: ${momentum.current.revenue} ${dataset.currency} across ${momentum.current.orders} orders. Prior 30 days: ${momentum.previous.revenue} ${dataset.currency} across ${momentum.previous.orders} orders — a ${momentum.revenueChange}% move.` },
      { heading: 'Decomposing the change', body: `Revenue = orders × average order value. Your orders changed ${momentum.ordersChange ?? 0}% and basket size changed ${momentum.aovChange ?? 0}%. One of these two numbers explains most of any revenue move.` },
      { heading: 'Asking better questions', body: '“Why did revenue move?” becomes precise once you know which lever moved. Try Ask Why with the exact lever — orders or AOV — for a ranked root-cause list.' },
    ]
    actionItems = ['Run a Why? investigation on the lever that moved most', 'Watch the 14-day trend cards to catch the next move early']
  } else {
    if (sample) {
      lessonType = 'BEST_PRACTICE'
      title = 'Sample lesson — how Insights Hub teaches with your numbers'
      sections = [
        { heading: 'This is a sample', body: 'Once your store syncs 7+ days of orders, lessons are written from your real metrics — weekday rhythms, repeat-buyer structure, hero products, and baskets.' },
        { heading: 'What personalized means', body: 'Every number in a real lesson is computed from your synced data and verified by the language firewall before it is shown.' },
        { heading: 'Start here', body: 'Generate your first discovery after the next sync, and the learning library will build lessons around what it finds.' },
      ]
      actionItems = ['Sync your store data', 'Come back after 7 days of history']
    } else {
      return null
    }
  }

  const markdown = [`# ${title}`, '', ...sections.flatMap((section) => [`## ${section.heading}`, '', section.body, ''])].join('\n')
  const words = markdown.split(/\s+/).length
  return {
    id: deterministicId('lesson', dataset.storeId, category, title),
    storeId: dataset.storeId,
    lessonType,
    category,
    title,
    summary: sections[0]?.body.slice(0, 180) ?? title,
    contentMarkdown: markdown,
    readingTimeMinutes: Math.max(3, Math.min(15, Math.round(words / 200))),
    basedOnData: { revenueDays: readiness.revenueDays, orders: readiness.totalOrders, customers: readiness.customerCount },
    personalized: !sample,
    sample,
    generatedAt: now,
    readAt: null,
    rating: null,
    bookmarked: false,
    actionItems,
  }
}

export function generateLessonLibrary(dataset: InsightsDataset, limit: number, now = new Date().toISOString()): readonly InsightLesson[] {
  if (!Number.isFinite(limit)) limit = 30
  const lessons: InsightLesson[] = []
  for (const category of DISCOVERY_CATEGORIES) {
    if (lessons.length >= limit) break
    const lesson = generateLesson(dataset, category, { now })
    if (lesson) lessons.push(lesson)
  }
  return lessons.slice(0, Math.max(1, limit))
}

/* ── Knowledge-base assistance ─────────────────────────────────────────── */

const TAG_VOCABULARY = ['revenue', 'customers', 'products', 'time', 'operations', 'marketing', 'retention', 'bundle', 'seasonal', 'aov', 'persona', 'trend', 'pattern', 'prediction'] as const

/** Suggests tags from real entry text; deterministic keyword matching only. */
export function suggestKnowledgeTags(title: string, content: string): readonly string[] {
  const haystack = `${title} ${content}`.toLowerCase()
  return TAG_VOCABULARY.filter((tag) => haystack.includes(tag)).slice(0, 5)
}

/** Case-insensitive substring search across title, content, and tags. */
export function searchKnowledge(entries: readonly InsightKnowledgeEntry[], query: string): readonly InsightKnowledgeEntry[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return entries
  return entries.filter((entry) =>
    entry.title.toLowerCase().includes(normalized) ||
    entry.contentMarkdown.toLowerCase().includes(normalized) ||
    entry.tags.some((tag) => tag.toLowerCase().includes(normalized)),
  )
}

/* ── Timeline assembly ─────────────────────────────────────────────────── */

export function timelineFromEntities(input: Readonly<{
  discoveries?: readonly InsightDiscovery[]
  lessons?: readonly InsightLesson[]
  patterns?: readonly InsightPattern[]
  personas?: readonly InsightPersona[]
  investigations?: readonly InsightInvestigation[]
  trends?: readonly InsightTrend[]
  comparisons?: readonly InsightComparison[]
  predictions?: readonly InsightPrediction[]
}>): readonly InsightTimelineEvent[] {
  const events: InsightTimelineEvent[] = []
  const push = (storeId: string, eventType: string, entityType: InsightTimelineEvent['entityType'], entityId: string, description: string, eventAt: string): void => {
    events.push({ id: deterministicId('evt', storeId, entityType, entityId, eventAt), storeId, eventType, entityType, entityId, description, eventAt })
  }
  for (const discovery of input.discoveries ?? []) push(discovery.storeId, discovery.status === 'NEW' ? 'discovery.generated' : `discovery.${discovery.status.toLowerCase()}`, 'DISCOVERY', discovery.id, discovery.title, discovery.discoveredAt)
  for (const lesson of input.lessons ?? []) push(lesson.storeId, 'lesson.generated', 'LESSON', lesson.id, lesson.title, lesson.generatedAt)
  for (const pattern of input.patterns ?? []) push(pattern.storeId, 'pattern.detected', 'PATTERN', pattern.id, pattern.title, pattern.lastConfirmed)
  for (const persona of input.personas ?? []) push(persona.storeId, 'persona.generated', 'PERSONA', persona.id, persona.personaName, persona.generatedAt)
  for (const investigation of input.investigations ?? []) push(investigation.storeId, 'investigation.completed', 'INVESTIGATION', investigation.id, investigation.question, investigation.completedAt ?? investigation.createdAt)
  for (const trend of input.trends ?? []) push(trend.storeId, 'trend.detected', 'TREND', trend.id, trend.title, trend.detectedAt)
  for (const comparison of input.comparisons ?? []) push(comparison.storeId, 'comparison.created', 'COMPARISON', comparison.id, comparison.title, comparison.createdAt)
  for (const prediction of input.predictions ?? []) push(prediction.storeId, 'prediction.generated', 'PREDICTION', prediction.id, prediction.title, prediction.createdAt)
  return events.sort((left, right) => right.eventAt.localeCompare(left.eventAt))
}

/* ── Auto-discovery scheduler helpers ──────────────────────────────────── */

/** Decides whether a store is due for an auto-discovery run. */
export function autoDiscoveryDue(preferences: Pick<InsightsPreferences, 'autoDiscoveryEnabled' | 'discoveryFrequency'>, plan: PlanTier, lastRunAt: string | null, now: number): boolean {
  if (!preferences.autoDiscoveryEnabled) return false
  const limits = INSIGHTS_PLAN_LIMITS[plan]
  if (limits.autoDiscovery === 'OFF') return false
  if (!lastRunAt) return true
  const last = Date.parse(lastRunAt)
  if (!Number.isFinite(last)) return true
  const elapsed = now - last
  if (limits.autoDiscovery === 'REALTIME') return elapsed >= 3_600_000
  if (preferences.discoveryFrequency === 'WEEKLY') return elapsed >= 7 * 86_400_000
  return elapsed >= 86_400_000
}

/* ── Discovery hub summary (quick stats bar) ───────────────────────────── */

export type InsightsHubSummary = Readonly<{
  plan: PlanTier
  newDiscoveries: number
  totalDiscoveries: number
  patternsDetected: number
  lessonsAvailable: number
  lessonsRead: number
  predictionsReady: number
  trendsActive: number
  personasCount: number
  investigationsRun: number
  apiUsage: Readonly<{ requestsThisHour: number; limitPerHour: number | null }>
  usage: Readonly<{ discoveriesThisMonth: Readonly<{ used: number; limit: number }>; investigationsThisMonth: Readonly<{ used: number; limit: number }> }>
  readiness: InsightsDataReadiness | null
}>

export function summarizeUsage(used: number, limit: number): Readonly<{ used: number; limit: number; percent: number; warning: boolean; blocked: boolean }> {
  const finite = Number.isFinite(limit)
  const percent = finite && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return { used, limit, percent, warning: finite && limit > 0 && percent >= 80 && percent < 100, blocked: finite && used >= limit }
}

/* ── Prompt builders (language-only AI layer) ──────────────────────────── */

export const INSIGHTS_HUB_SYSTEM_PROMPT = `You are the Insights Hub narrator for ProfitPilot, a Shopify analytics product. Your tone is that of a curious, precise scientist: "Interesting...", "Did you know...". Ground rules you must obey:
1. You receive deterministic findings computed from the store's REAL data. Never add, remove, or alter any number.
2. Explain WHY, not just WHAT — offer one plausible, clearly-hedged reason and one way to explore further.
3. Keep it under 120 words. Plain language, no jargon, no emojis.
4. Never mention emails, phone numbers, names, or any personal data.
5. If the findings look thin, say exactly that instead of dressing them up.`

export function discoveryExplanationPrompt(input: Readonly<{ title: string; description: string; evidenceNumbers: readonly number[]; category: DiscoveryCategory }>): string {
  return [
    `Rewrite this ${input.category.toLowerCase()} discovery for a busy merchant in the Insights Hub voice.`,
    `Do not introduce any new numbers — only these verified values may appear: ${input.evidenceNumbers.join(', ')}.`,
    `Title: ${input.title}`,
    `Finding: ${input.description}`,
    'Return one short paragraph.',
  ].join('\n')
}

export function lessonSummaryPrompt(input: Readonly<{ title: string; facts: readonly string[] }>): string {
  return [
    'Write a 2-sentence curious summary for a personalized lesson.',
    `Verified facts (the only numbers allowed): ${input.facts.join(' | ')}`,
    `Lesson: ${input.title}`,
  ].join('\n')
}

/* ── Small utilities ───────────────────────────────────────────────────── */

function deterministicId(prefix: string, ...parts: readonly string[]): string {
  const input = parts.join('::')
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  let hash2 = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash2 ^= input.charCodeAt(index)
    hash2 = Math.imul(hash2, 16777619)
  }
  const hex2 = (hash2 >>> 0).toString(16).padStart(8, '0')
  return `${prefix}_${hex}${hex2}`
}

export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function formatHour(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24
  if (normalized === 0) return '12am'
  if (normalized < 12) return `${normalized}am`
  if (normalized === 12) return '12pm'
  return `${normalized - 12}pm`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function unique<Value>(values: readonly Value[]): readonly Value[] {
  return [...new Set(values)]
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function nonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
