/**
 * PatternAI — client-side contract and humanization layer.
 *
 * Mirrors `apps/api/src/insights-hub-routes.ts` and `@profitpilot/ai`
 * `insights-hub.ts` (storage names keep the original module id for backend
 * compatibility; the product surface is PatternAI). Confidence, impact and
 * evidence originate in the deterministic API engine; the AI narrator only
 * restyles that output through the numeric language firewall.
 *
 * Client summaries below may count, group or divide returned rows, but never
 * introduce a source value: samples are excluded where a live KPI is claimed,
 * currencies stay separate, and missing fields remain visibly unavailable.
 *
 * Voice: discovery-oriented, curious, educational. PatternAI explains what it
 * found and how it knows — it never commands, and it never invents a number.
 */

/** Product identity, used by the shell, the hero, and the empty states. */
export const PATTERN_AI_NAME = 'PatternAI'
export const PATTERN_AI_TAGLINE = 'Discover the patterns that drive your business'
export const PATTERN_AI_SUBTITLE = 'AI-powered pattern intelligence, computed from your real store data — never invented.' 

export type PlanTier = 'trial' | 'start' | 'growth' | 'commander'

export type DiscoveryType = 'PATTERN' | 'ANOMALY' | 'OPPORTUNITY' | 'CORRELATION' | 'TREND' | 'SEGMENT' | 'BEHAVIOR'
export type DiscoveryCategory = 'REVENUE' | 'CUSTOMERS' | 'PRODUCTS' | 'OPERATIONS' | 'MARKETING' | 'TIME'
export type DiscoveryStatus = 'NEW' | 'REVIEWED' | 'SAVED' | 'DISMISSED' | 'ACTED_ON'
export type LessonType = 'PATTERN_STUDY' | 'BEHAVIOR_ANALYSIS' | 'COMPETITOR_INSIGHT' | 'BEST_PRACTICE' | 'CASE_STUDY'
export type InsightPatternType = 'TIME' | 'PRODUCT' | 'CUSTOMER' | 'BEHAVIORAL' | 'SEASONAL' | 'ANOMALY' | 'CORRELATION'
export type PatternStatus = 'ACTIVE' | 'INACTIVE' | 'INVALIDATED'
export type InvestigationStatus = 'PENDING' | 'INVESTIGATING' | 'COMPLETED' | 'FAILED'
export type TrendType = 'BUSINESS' | 'MARKET' | 'EMERGING' | 'DECLINING'
export type TrendDirection = 'UP' | 'DOWN' | 'STABLE'
export type ComparisonType = 'PRODUCT' | 'PERIOD' | 'SEGMENT' | 'CATEGORY' | 'CHANNEL'
export type KnowledgeEntryType = 'DISCOVERY' | 'LESSON' | 'NOTE' | 'PATTERN' | 'INVESTIGATION' | 'CUSTOM'
export type TimelineEntityType = 'DISCOVERY' | 'LESSON' | 'PATTERN' | 'PERSONA' | 'INVESTIGATION' | 'TREND' | 'COMPARISON' | 'PREDICTION'
export type PredictionType = 'REVENUE' | 'ORDERS' | 'CUSTOMERS' | 'INVENTORY' | 'TREND' | 'RISK'
export type PredictionHorizon = '7_DAYS' | '30_DAYS' | '90_DAYS'
export type InsightsFeature = 'discoveries' | 'lessons' | 'patterns' | 'personas' | 'investigations' | 'trends' | 'comparisons' | 'knowledge' | 'timeline' | 'predictions' | 'autoDiscovery' | 'export' | 'share' | 'apiAccess' | 'externalTrends' | 'anomalyAlerts'

export const DISCOVERY_TYPES: readonly DiscoveryType[] = ['PATTERN', 'ANOMALY', 'OPPORTUNITY', 'CORRELATION', 'TREND', 'SEGMENT', 'BEHAVIOR']
export const DISCOVERY_CATEGORIES: readonly DiscoveryCategory[] = ['REVENUE', 'CUSTOMERS', 'PRODUCTS', 'OPERATIONS', 'MARKETING', 'TIME']
export const COMPARISON_TYPES: readonly ComparisonType[] = ['PRODUCT', 'PERIOD', 'SEGMENT', 'CATEGORY', 'CHANNEL']

export type InsightsJsonObject = Readonly<Record<string, unknown>>

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
  dataEvidence: InsightsJsonObject
  visualizationData: InsightsJsonObject
  discoveredAt: string
  status: DiscoveryStatus
  sample: boolean
  viewedAt: string | null
  actionTakenAt: string | null
  expiresAt: string | null
}>

export type InsightLesson = Readonly<{
  id: string
  storeId: string
  lessonType: LessonType
  category: DiscoveryCategory
  title: string
  summary: string
  contentMarkdown: string
  readingTimeMinutes: number
  basedOnData: InsightsJsonObject
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
  patternData: InsightsJsonObject
  occurrenceCount: number
  confidenceScore: number
  firstDetected: string
  lastConfirmed: string
  status: PatternStatus
  alertsEnabled: boolean
}>

export type PersonaRadarTrait = Readonly<{ trait: string; score: number }>
export type InsightPersona = Readonly<{
  id: string
  storeId: string
  personaName: string
  personaEmoji: string
  segmentCriteria: InsightsJsonObject
  percentageOfCustomers: number
  behaviorPatterns: readonly string[]
  motivations: readonly string[]
  howToReach: readonly string[]
  estimatedRevenueImpact: number
  revenueCurrency: string
  confidenceScore: number
  customerCount: number
  radar: readonly PersonaRadarTrait[]
  generatedAt: string
}>

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

export type InsightTrend = Readonly<{
  id: string
  storeId: string
  trendType: TrendType
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

export type ComparisonMetric = Readonly<{ metric: string; a: number | null; b: number | null; delta: number | null; winner: 'A' | 'B' | 'TIE' }>
export type InsightComparison = Readonly<{
  id: string
  storeId: string
  comparisonType: ComparisonType
  title: string
  subjectA: InsightsJsonObject
  subjectB: InsightsJsonObject
  metrics: readonly ComparisonMetric[]
  winner: 'A' | 'B' | 'TIE' | 'INSUFFICIENT_DATA'
  insights: readonly string[]
  createdAt: string
}>

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
  entityType: TimelineEntityType
  entityId: string
  description: string
  eventAt: string
}>

export type PredictionSeriesPoint = Readonly<{ day: string; value: number; lower: number; upper: number }>
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
  series: readonly PredictionSeriesPoint[]
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
  language: 'en' | 'hi'
  updatedAt: string
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

export type InsightsOverview = Readonly<{
  plan: PlanTier
  features: Readonly<Record<InsightsFeature, boolean>>
  requiredPlans: Readonly<Record<InsightsFeature, PlanTier>>
  usage: Readonly<{
    discoveries: Readonly<{ used: number; limit: number | null; remaining: number | null }>
    investigations: Readonly<{ used: number; limit: number | null; remaining: number | null }>
  }>
  counts: Readonly<{ newDiscoveries: number; totalDiscoveries: number; patterns: number; lessons: number; lessonsRead: number; personas: number; investigations: number; trends: number; predictions: number; comparisons: number; knowledge: number }>
  /** Real 8-week activity trend per hero metric, from stored timestamps. */
  countsTrends?: Readonly<{ discoveries: InsightCountTrend; patterns: InsightCountTrend; personas: InsightCountTrend; investigations: InsightCountTrend; trends: InsightCountTrend; predictions: InsightCountTrend }>
  readiness: InsightsDataReadiness
  preferences: InsightsPreferences
  autoDiscoveryRan: boolean
  trial: boolean
  /** Sections the API could not load this render (it still returned a page). */
  degraded?: readonly string[]
  generatedAt: string
}>

export type InsightsUsageMeter = Readonly<{ feature: string; used: number; limit: number | null; percent: number; warning: boolean; blocked: boolean }>
export type InsightsUsageSummary = Readonly<{ plan: PlanTier; meters: readonly InsightsUsageMeter[] }>

export type DiscoveryFeedResult = Readonly<{ plan: PlanTier; trial: boolean; readiness: InsightsDataReadiness; discoveries: readonly InsightDiscovery[] }>
export type PersonaListResult = Readonly<{ plan: PlanTier; personas: readonly InsightPersona[]; readiness: InsightsDataReadiness }>
export type TrendListResult = Readonly<{ plan: PlanTier; freshness: string; trends: readonly InsightTrend[] }>
export type MarketTrendsResult = Readonly<{ available: boolean; message: string; trends: readonly InsightTrend[] }>
export type TimelineResult = Readonly<{ plan: PlanTier; windowDays: number | null; events: readonly InsightTimelineEvent[] }>
export type PredictionListResult = Readonly<{ plan: PlanTier; horizons: readonly PredictionHorizon[]; predictions: readonly InsightPrediction[]; readiness: InsightsDataReadiness }>
export type ApiAccessStatus = Readonly<{
  plan: PlanTier
  enabled: boolean
  maskedKey: string | null
  rateLimitPerHour: number | null
  usage: Readonly<{ requestsThisHour: number; requestsToday: number }>
  recent: readonly Readonly<{ endpoint: string; calledAt: string; rateLimitRemaining: number | null }>[]
}>
export type ApiKeyReveal = Readonly<{ apiKey: string; masked: string; rateLimitPerHour: number | null }>
export type GeneratedDiscoveries = Readonly<{ generated: number; discoveries: readonly InsightDiscovery[]; usage: Readonly<{ used: number; limit: number; percent: number; warning: boolean; blocked: boolean }> }>
export type PersonaCustomersResult = Readonly<{ personaId: string; customerCount: number; aggregate: Readonly<{ avgOrders: number; avgLifetimeValue: number; currency: string }>; anonymizedSample: readonly string[] }>
export type GenerateResult<Value> = Readonly<{ generated: number }> & Readonly<Record<string, Value>>

/* ── Plan matrix (progressive disclosure mirror — API stays the truth) ─── */

export const INSIGHTS_FEATURE_MIN_PLAN: Readonly<Record<InsightsFeature, PlanTier>> = {
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

const PLAN_RANK: Readonly<Record<PlanTier, number>> = { trial: 0, start: 1, growth: 2, commander: 3 }

export function planAtLeast(plan: PlanTier, required: PlanTier): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[required]
}

export type InsightsFeatureLock = Readonly<{ feature: InsightsFeature; locked: boolean; plan: PlanTier; requiredPlan: PlanTier }>

/**
 * Lock state for progressive disclosure. When the overview is unavailable the
 * static matrix is used; once loaded, `overview.features` is authoritative.
 */
export function insightsFeatureLock(plan: PlanTier, feature: InsightsFeature, overview: InsightsOverview | null = null): InsightsFeatureLock {
  const requiredPlan = overview?.requiredPlans[feature] ?? INSIGHTS_FEATURE_MIN_PLAN[feature]
  const allowed = overview ? overview.features[feature] : planAtLeast(plan, requiredPlan)
  return { feature, locked: !allowed, plan, requiredPlan }
}

/** Generic CTA — never a plan name. Routes to billing. */
export const INSIGHTS_UPGRADE_CTA = 'Upgrade Plan'
export const INSIGHTS_UPGRADE_PATH = '/billing'

export function insightsUpgradeMessage(feature: InsightsFeature): string {
  const label = FEATURE_LABELS[feature] ?? 'This PatternAI capability'
  return `${label} is not included in your current plan. ${INSIGHTS_UPGRADE_CTA} to keep exploring.`
}

export const FEATURE_LABELS: Readonly<Record<InsightsFeature, string>> = {
  discoveries: 'AI discoveries',
  lessons: 'Learning lessons',
  patterns: 'Custom pattern detection',
  personas: 'Customer personas',
  investigations: 'Why? investigations',
  trends: 'Trend watching',
  comparisons: 'Head-to-head comparisons',
  knowledge: 'The knowledge base',
  timeline: 'The discovery timeline',
  predictions: 'Predictions',
  autoDiscovery: 'Auto-discovery',
  export: 'Pattern exports',
  share: 'Sharing',
  apiAccess: 'API access',
  externalTrends: 'External market trends',
  anomalyAlerts: 'Anomaly alerts',
}

/* ── Humanization maps (no enum leakage) ───────────────────────────────── */

export const DISCOVERY_TYPE_LABELS: Readonly<Record<DiscoveryType, string>> = {
  PATTERN: 'Pattern',
  ANOMALY: 'Anomaly',
  OPPORTUNITY: 'Opportunity',
  CORRELATION: 'Correlation',
  TREND: 'Trend',
  SEGMENT: 'Segment',
  BEHAVIOR: 'Behavior',
}

export const DISCOVERY_CATEGORY_LABELS: Readonly<Record<DiscoveryCategory, string>> = {
  REVENUE: 'Revenue',
  CUSTOMERS: 'Customers',
  PRODUCTS: 'Products',
  OPERATIONS: 'Operations',
  MARKETING: 'Marketing',
  TIME: 'Time & rhythm',
}

export const DISCOVERY_STATUS_LABELS: Readonly<Record<DiscoveryStatus, string>> = {
  NEW: 'New',
  REVIEWED: 'Reviewed',
  SAVED: 'Saved',
  DISMISSED: 'Not useful',
  ACTED_ON: 'Acted on',
}

export const LESSON_TYPE_LABELS: Readonly<Record<LessonType, string>> = {
  PATTERN_STUDY: 'Pattern study',
  BEHAVIOR_ANALYSIS: 'Behavior analysis',
  COMPETITOR_INSIGHT: 'Competitor insight',
  BEST_PRACTICE: 'Best practice',
  CASE_STUDY: 'Case study',
}

export const PATTERN_TYPE_LABELS: Readonly<Record<InsightPatternType, string>> = {
  TIME: 'Time pattern',
  PRODUCT: 'Product pattern',
  CUSTOMER: 'Customer pattern',
  BEHAVIORAL: 'Behavioral',
  SEASONAL: 'Seasonal',
  ANOMALY: 'Anomaly',
  CORRELATION: 'Correlation',
}

export const TREND_TYPE_LABELS: Readonly<Record<TrendType, string>> = {
  BUSINESS: 'Your business',
  MARKET: 'Market',
  EMERGING: 'Emerging',
  DECLINING: 'Declining',
}

export const TREND_FRESHNESS_LABELS: Readonly<Record<string, string>> = {
  WEEKLY_LIMITED: 'Refreshed weekly',
  WEEKLY: 'Refreshed weekly',
  DAILY: 'Refreshed daily',
  REALTIME: 'Real-time monitoring',
}

export const COMPARISON_TYPE_LABELS: Readonly<Record<ComparisonType, string>> = {
  PRODUCT: 'Product vs product',
  PERIOD: 'Period vs period',
  SEGMENT: 'Segment vs segment',
  CATEGORY: 'Category vs category',
  CHANNEL: 'Channel vs channel',
}

export const KNOWLEDGE_TYPE_LABELS: Readonly<Record<KnowledgeEntryType, string>> = {
  DISCOVERY: 'Discovery',
  LESSON: 'Lesson',
  NOTE: 'Note',
  PATTERN: 'Pattern',
  INVESTIGATION: 'Investigation',
  CUSTOM: 'Custom',
}

export const TIMELINE_TYPE_LABELS: Readonly<Record<TimelineEntityType, string>> = {
  DISCOVERY: 'Discovery',
  LESSON: 'Lesson',
  PATTERN: 'Pattern',
  PERSONA: 'Persona',
  INVESTIGATION: 'Investigation',
  TREND: 'Trend',
  COMPARISON: 'Comparison',
  PREDICTION: 'Prediction',
}

export const PREDICTION_TYPE_LABELS: Readonly<Record<PredictionType, string>> = {
  REVENUE: 'Revenue',
  ORDERS: 'Orders',
  CUSTOMERS: 'Customers',
  INVENTORY: 'Inventory',
  TREND: 'Trend',
  RISK: 'Risk',
}

export const HORIZON_LABELS: Readonly<Record<PredictionHorizon, string>> = {
  '7_DAYS': 'Next 7 days',
  '30_DAYS': 'Next 30 days',
  '90_DAYS': 'Next 90 days',
}

export const SUGGESTED_WHY_QUESTIONS: readonly string[] = [
  'Why did revenue drop last week?',
  'Why do customers buy on Saturdays?',
  'Why is my best seller slowing down?',
  'Why do some customers come back and others never return?',
]

/* ── Routing (/ai-growth-command/patternai/*) ──────────────────────────── */

export type InsightsTab =
  | 'overview'
  | 'discoveries'
  | 'lessons'
  | 'patterns'
  | 'personas'
  | 'why'
  | 'trends'
  | 'comparisons'
  | 'knowledge'
  | 'timeline'
  | 'predictions'
  | 'settings'
  | 'api-access'

export type InsightsRoute = Readonly<{ tab: InsightsTab; id: string | null }>

export const PATTERN_AI_BASE_PATH = '/ai-growth-command/patternai'
/** Pre-rebrand path: still parsed so old bookmarks and emails keep working. */
export const PATTERN_AI_LEGACY_BASE_PATH = '/ai-growth-command/insights'
/** @deprecated Use PATTERN_AI_BASE_PATH. Kept for import compatibility. */
export const INSIGHTS_BASE_PATH = PATTERN_AI_BASE_PATH

/** True for both the PatternAI path and the legacy Insights Hub path. */
export function isPatternAiPath(pathname: string): boolean {
  const path = pathname.replace(/\?.*$/, '')
  return path.startsWith(PATTERN_AI_BASE_PATH) || path.startsWith(PATTERN_AI_LEGACY_BASE_PATH)
}

const TAB_SEGMENTS: Readonly<Record<string, InsightsTab>> = {
  discoveries: 'discoveries',
  lessons: 'lessons',
  patterns: 'patterns',
  personas: 'personas',
  why: 'why',
  trends: 'trends',
  comparisons: 'comparisons',
  knowledge: 'knowledge',
  timeline: 'timeline',
  predictions: 'predictions',
  settings: 'settings',
  'api-access': 'api-access',
}

export function parseInsightsRoute(pathname: string): InsightsRoute {
  const path = pathname.replace(/\?.*$/, '').replace(/\/+$/, '')
  const base = path.startsWith(PATTERN_AI_LEGACY_BASE_PATH) ? PATTERN_AI_LEGACY_BASE_PATH : PATTERN_AI_BASE_PATH
  if (!path.startsWith(base)) return { tab: 'overview', id: null }
  const rest = path.slice(base.length).replace(/^\/+/, '')
  if (!rest) return { tab: 'overview', id: null }
  const [segment = '', second] = rest.split('/')
  const tab = TAB_SEGMENTS[segment]
  if (!tab) return { tab: 'overview', id: null }
  if (second && second !== 'new' && /^[A-Za-z0-9_-]{1,80}$/.test(second)) return { tab, id: second }
  return { tab, id: second === 'new' ? 'new' : null }
}

export function insightsRoutePath(tab: InsightsTab, id: string | null, search = ''): string {
  const base = tab === 'overview' ? PATTERN_AI_BASE_PATH : `${PATTERN_AI_BASE_PATH}/${tab}`
  return `${id ? `${base}/${id}` : base}${search}`
}

/** The tab a deep-linked entity belongs to, used when opening from timeline/search. */
export function tabForTimelineEntity(entityType: TimelineEntityType): InsightsTab {
  switch (entityType) {
    case 'DISCOVERY': return 'discoveries'
    case 'LESSON': return 'lessons'
    case 'PATTERN': return 'patterns'
    case 'PERSONA': return 'personas'
    case 'INVESTIGATION': return 'why'
    case 'TREND': return 'trends'
    case 'COMPARISON': return 'comparisons'
    case 'PREDICTION': return 'predictions'
  }
}

/** Read the tab out of a tab+sub-route while deep-linking detail id. */
export function insightsTabLabel(tab: InsightsTab): string {
  switch (tab) {
    case 'overview': return 'Discovery feed'
    case 'discoveries': return 'Discoveries'
    case 'lessons': return 'Learning library'
    case 'patterns': return 'Pattern lab'
    case 'personas': return 'Customer personas'
    case 'why': return 'Why? explorer'
    case 'trends': return 'Trend watcher'
    case 'comparisons': return 'Comparisons'
    case 'knowledge': return 'Knowledge base'
    case 'timeline': return 'Timeline'
    case 'predictions': return 'Predictions'
    case 'settings': return 'Settings'
    case 'api-access': return 'API access'
  }
}

/** One-line "what this surface is for", shown under each section heading. */
export function insightsTabPurpose(tab: InsightsTab): string {
  switch (tab) {
    case 'overview': return 'Everything PatternAI noticed in your store, newest first.'
    case 'discoveries': return 'Every discovery on record, filterable by type and category.'
    case 'lessons': return 'Short, personalised briefings written from your own numbers.'
    case 'patterns': return 'The recurring structures behind your sales, mapped visually.'
    case 'personas': return 'Who your buyers actually are, grouped by measured behaviour.'
    case 'why': return 'Ask why something happened and trace it to root causes.'
    case 'trends': return 'What is rising, what is fading, and how confident we are.'
    case 'comparisons': return 'Settle a question with a measured head-to-head study.'
    case 'knowledge': return 'Your own wiki of saved patterns, notes, and conclusions.'
    case 'timeline': return 'A chronological record of everything PatternAI has learned.'
    case 'predictions': return 'Forecasts with honest ranges and stated confidence.'
    case 'settings': return 'Discovery cadence, categories, and notification preferences.'
    case 'api-access': return 'Programmatic access to your patterns for your own tools.'
  }
}

/* ── Pure display helpers ──────────────────────────────────────────────── */

export function formatInsightMoney(value: number | null, currency = 'USD'): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

export function formatInsightNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
}

export function formatPlainPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

export function confidencePercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

export function confidenceLabel(score: number): string {
  if (score >= 0.85) return 'Very high confidence'
  if (score >= 0.7) return 'High confidence'
  if (score >= 0.5) return 'Moderate confidence'
  return 'Early signal'
}

export function confidenceTone(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.7) return 'high'
  if (score >= 0.5) return 'medium'
  return 'low'
}

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const value = Date.parse(iso)
  if (!Number.isFinite(value)) return 'never'
  const deltaMs = now - value
  if (deltaMs < 45_000) return 'just now'
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function formatDayLabel(day: string): string {
  const parsed = Date.parse(day.includes('T') ? day : `${day}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return day
  return new Date(parsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Evidence panels render only primitive pairs — nested JSON is summarized. */
export function evidenceRows(evidence: InsightsJsonObject | null | undefined, max = 6): readonly Readonly<{ label: string; value: string }>[] {
  const rows: { label: string; value: string }[] = []
  if (typeof evidence !== 'object' || evidence === null) return rows
  for (const [key, value] of Object.entries(evidence)) {
    if (rows.length >= max) break
    const label = key.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
    if (typeof value === 'number') rows.push({ label, value: Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2) })
    else if (typeof value === 'boolean') rows.push({ label, value: value ? 'yes' : 'no' })
    else if (typeof value === 'string') rows.push({ label, value: value.length > 48 ? `${value.slice(0, 48)}…` : value })
    else if (value === null) rows.push({ label, value: '—' })
    else if (Array.isArray(value)) rows.push({ label, value: `${value.length} item${value.length === 1 ? '' : 's'}` })
  }
  return rows
}

/** Readiness progress pairs used by the educational empty states. */
export function readinessProgress(readiness: InsightsDataReadiness, kind: 'personas' | 'trends' | 'predictions'): Readonly<{ have: number; need: number; unit: string }> {
  if (kind === 'personas') return { have: readiness.personasRequirement.have, need: readiness.personasRequirement.need, unit: 'customers' }
  if (kind === 'trends') return { have: readiness.trendsRequirement.have, need: readiness.trendsRequirement.need, unit: 'days of history' }
  return { have: readiness.predictRequirement.have, need: readiness.predictRequirement.need, unit: 'days of history' }
}

export function subjectLabel(subject: InsightsJsonObject, fallback: string): string {
  const direct = subject.label ?? subject.title ?? subject.name ?? subject.id
  return typeof direct === 'string' && direct.trim() ? direct : fallback
}

/** Word-cloud entries from tag frequencies — real counts, stable ordering. */
export function tagCloud(entries: readonly InsightKnowledgeEntry[], limit = 18): readonly Readonly<{ tag: string; weight: number }>[] {
  const counts = new Map<string, number>()
  for (const entry of entries) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, weight: count }))
}

/** Bubble-chart points from patterns: real confidence × occurrences. */
export function patternBubbles(patterns: readonly InsightPattern[]): readonly Readonly<{ id: string; label: string; x: number; y: number; r: number; type: InsightPatternType }>[] {
  const maxOccurrences = Math.max(1, ...patterns.map((pattern) => pattern.occurrenceCount))
  return patterns.map((pattern) => ({
    id: pattern.id,
    label: pattern.title,
    x: Math.max(0.02, Math.min(0.98, pattern.confidenceScore)),
    y: Math.max(0.02, Math.min(0.98, pattern.occurrenceCount / maxOccurrences)),
    r: 8 + 16 * (pattern.occurrenceCount / maxOccurrences),
    type: pattern.patternType,
  }))
}

/** Scatter points from trends: magnitude (|Δ%|) vs confidence. */
export function trendScatter(trends: readonly InsightTrend[]): readonly Readonly<{ id: string; label: string; x: number; y: number; up: boolean }>[] {
  const maxMagnitude = Math.max(1, ...trends.map((trend) => Math.abs(trend.magnitude)))
  return trends.map((trend) => ({
    id: trend.id,
    label: trend.title,
    x: Math.max(0.02, Math.min(0.98, Math.abs(trend.magnitude) / maxMagnitude)),
    y: Math.max(0.02, Math.min(0.98, trend.confidenceScore)),
    up: trend.direction !== 'DOWN',
  }))
}

export function comparisonDelta(display: ComparisonMetric): string {
  if (display.delta === null) return '—'
  const sign = display.delta >= 0 ? '+' : ''
  return `${sign}${display.delta.toFixed(1)}%`
}

export function personaShare(persona: InsightPersona): string {
  return `${Math.round(persona.percentageOfCustomers)}% of customers`
}

/** Usage-meter percent capped for the progress bar. */
export function meterPercent(used: number, limit: number | null): number | null {
  if (limit === null || !Number.isFinite(limit) || limit <= 0) return null
  return Math.min(100, Math.round((used / limit) * 100))
}

/* ── PatternAI presentation model (pure, unit-tested) ──────────────────── */

export type DiscoveryTone = 'pattern' | 'anomaly' | 'opportunity' | 'correlation' | 'trend' | 'segment' | 'behavior'

/** Stable colour tone per discovery type — used for card accents and badges. */
export function discoveryTone(type: DiscoveryType): DiscoveryTone {
  return type.toLowerCase() as DiscoveryTone
}

/** Short, human "what kind of finding is this" label used on card headers. */
export const DISCOVERY_TYPE_HEADLINES: Readonly<Record<DiscoveryType, string>> = {
  PATTERN: 'New pattern detected',
  ANOMALY: 'Anomaly detected',
  OPPORTUNITY: 'Opportunity spotted',
  CORRELATION: 'Correlation found',
  TREND: 'Trend forming',
  SEGMENT: 'Segment identified',
  BEHAVIOR: 'Behaviour observed',
}

/**
 * Micro-visualization kind for a hero tile. Every tile draws a *different*
 * shape so the header reads as six distinct signals rather than a grid of
 * numbers — and every shape is unique to PatternAI inside this app.
 */
export type PatternAiStatVisual = 'bubbles' | 'network' | 'cohort' | 'answers' | 'arrows' | 'wave'

/** Real 8-week activity trend for a hero tile (from stored timestamps). */
export type InsightCountTrend = Readonly<{
  series: readonly number[]
  direction: 'up' | 'down' | 'flat' | 'none'
  windowLabel: string
}>

/** True direction of a trend series, or null when there is no activity. */
export function trendDirection(trend: InsightCountTrend | undefined): 'up' | 'down' | 'flat' | 'none' {
  if (!trend || trend.direction === 'none') return 'none'
  return trend.direction
}

export type PatternAiStat = Readonly<{
  id: string
  label: string
  value: string
  caption: string
  /** Raw count behind `value`; null while the overview has not answered yet. */
  count: number | null
  visual: PatternAiStatVisual
  /** What the tile is doing while it is still empty (never a fake number). */
  pending: string
  /** Real 8-week activity series for this tile; undefined before it loads. */
  trend: InsightCountTrend | undefined
}>

const TREND_KEYS: Readonly<Record<string, keyof NonNullable<InsightsOverview['countsTrends']>>> = {
  discoveries: 'discoveries',
  patterns: 'patterns',
  personas: 'personas',
  investigations: 'investigations',
  trends: 'trends',
  predictions: 'predictions',
}

/**
 * The six hero tiles. Values come straight from the API's counts — this
 * function only formats, it never derives a number of its own. Each tile also
 * names the micro-visualization it renders, the honest "still working"
 * caption used while the count is zero, and a real 8-week activity trend
 * computed by the server from stored timestamps (undefined before it loads).
 */
export function patternAiStats(overview: InsightsOverview | null): readonly PatternAiStat[] {
  const value = (count: number | undefined): string => (overview ? formatInsightNumber(count ?? 0) : '—')
  const raw = (count: number | undefined): number | null => (overview ? count ?? 0 : null)
  const counts = overview?.counts
  const trends = overview?.countsTrends
  const trendFor = (id: string): InsightCountTrend | undefined => trends ? trends[TREND_KEYS[id] as keyof typeof trends] : undefined
  return [
    { id: 'discoveries', label: 'Discoveries', value: value(counts?.newDiscoveries), caption: 'new and unread', count: raw(counts?.newDiscoveries), visual: 'bubbles', pending: 'waiting…', trend: trendFor('discoveries') },
    { id: 'patterns', label: 'Patterns', value: value(counts?.patterns), caption: 'active right now', count: raw(counts?.patterns), visual: 'network', pending: 'discovering…', trend: trendFor('patterns') },
    { id: 'personas', label: 'Personas', value: value(counts?.personas), caption: 'identified', count: raw(counts?.personas), visual: 'cohort', pending: 'analysing…', trend: trendFor('personas') },
    { id: 'investigations', label: 'Investigations', value: value(counts?.investigations), caption: 'answered', count: raw(counts?.investigations), visual: 'answers', pending: 'ask first', trend: trendFor('investigations') },
    { id: 'trends', label: 'Trends', value: value(counts?.trends), caption: 'under watch', count: raw(counts?.trends), visual: 'arrows', pending: 'monitoring…', trend: trendFor('trends') },
    { id: 'predictions', label: 'Predictions', value: value(counts?.predictions), caption: 'forecasts live', count: raw(counts?.predictions), visual: 'wave', pending: 'learning…', trend: trendFor('predictions') },
  ]
}

/* ── Discovery pipeline (funnel) ───────────────────────────────────────── */

export type DiscoveryFunnelStage = Readonly<{
  id: 'discovered' | 'reviewed' | 'saved' | 'acted'
  label: string
  value: number
  /** Share of the "discovered" stage, 0–1. 0 when nothing was discovered. */
  share: number
  /** The statuses this stage counts — used to filter the feed on click. */
  statuses: readonly DiscoveryStatus[]
}>

export type DiscoveryFunnel = Readonly<{
  stages: readonly DiscoveryFunnelStage[]
  discovered: number
  actedOn: number
  /** Acted-on ÷ discovered, 0–1. Null when there is nothing to convert yet. */
  conversion: number | null
  hint: string
}>

/**
 * The discovery pipeline. Stages are cumulative — a saved discovery has by
 * definition been reviewed — so the funnel narrows honestly instead of
 * double-counting. Dismissed findings leave the pipeline and are not counted
 * as progress; they stay in the "discovered" total because they happened.
 */
export function discoveryFunnel(discoveries: readonly InsightDiscovery[]): DiscoveryFunnel {
  const count = (statuses: readonly DiscoveryStatus[]): number => discoveries.filter((discovery) => statuses.includes(discovery.status)).length
  const discovered = discoveries.length
  const reviewedStatuses: readonly DiscoveryStatus[] = ['REVIEWED', 'SAVED', 'ACTED_ON']
  const savedStatuses: readonly DiscoveryStatus[] = ['SAVED', 'ACTED_ON']
  const actedStatuses: readonly DiscoveryStatus[] = ['ACTED_ON']
  const reviewed = count(reviewedStatuses)
  const saved = count(savedStatuses)
  const acted = count(actedStatuses)
  const share = (value: number): number => (discovered > 0 ? value / discovered : 0)
  const conversion = discovered > 0 ? acted / discovered : null
  const hint = discovered === 0
    ? 'Run a discovery sweep to start the pipeline.'
    : acted > 0
      ? `${acted} of ${discovered} discover${discovered === 1 ? 'y has' : 'ies have'} turned into action.`
      : 'Take action on a discovery to close the loop.'
  return {
    stages: [
      { id: 'discovered', label: 'Discovered', value: discovered, share: discovered > 0 ? 1 : 0, statuses: ['NEW', 'REVIEWED', 'SAVED', 'ACTED_ON', 'DISMISSED'] },
      { id: 'reviewed', label: 'Reviewed', value: reviewed, share: share(reviewed), statuses: reviewedStatuses },
      { id: 'saved', label: 'Saved', value: saved, share: share(saved), statuses: savedStatuses },
      { id: 'acted', label: 'Acted on', value: acted, share: share(acted), statuses: actedStatuses },
    ],
    discovered,
    actedOn: acted,
    conversion,
    hint,
  }
}

/* ── Human framing for a discovery card ────────────────────────────────── */

/**
 * A friendly, human headline for the card. It states the *kind* of finding in
 * plain language — it never restates or invents a number, so the engine's own
 * sentence stays the single source of every figure.
 */
export function discoveryHeadline(discovery: InsightDiscovery): string {
  const key = `${discovery.discoveryType}:${discovery.category}`
  switch (key) {
    case 'TREND:PRODUCTS': return 'Rising product spotted'
    case 'TREND:REVENUE': return 'Your revenue momentum shifted'
    case 'TREND:CUSTOMERS': return 'Customer demand is moving'
    case 'PATTERN:TIME': return 'Your week has a rhythm'
    case 'PATTERN:PRODUCTS': return 'One product carries the load'
    case 'ANOMALY:REVENUE': return 'One day broke the pattern'
    case 'OPPORTUNITY:PRODUCTS': return 'These products travel together'
    case 'SEGMENT:CUSTOMERS': return 'A customer group stands out'
    case 'BEHAVIOR:TIME': return 'Your buyers have a favourite hour'
    default: break
  }
  switch (discovery.discoveryType) {
    case 'PATTERN': return 'A pattern keeps repeating'
    case 'ANOMALY': return 'Something broke the pattern'
    case 'OPPORTUNITY': return 'There is room to grow here'
    case 'CORRELATION': return 'Two things move together'
    case 'TREND': return 'A trend is forming'
    case 'SEGMENT': return 'A group behaves differently'
    case 'BEHAVIOR': return 'A buying behaviour showed up'
  }
}

export type MomentumUnit = 'units' | 'money' | 'customers' | 'orders'
export type DiscoveryMomentum = Readonly<{
  title: string
  beforeLabel: string
  afterLabel: string
  before: number
  after: number
  unit: MomentumUnit
  currency: string
  /** Change between the two bars, 0–1 based; null when "before" was zero. */
  change: number | null
}>

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const nestedNumber = (value: unknown, key: string): number | null => {
  if (typeof value !== 'object' || value === null) return null
  return asNumber((value as Record<string, unknown>)[key])
}

/**
 * Before/after pair for the card's momentum bars — read *only* from the
 * engine's own evidence. Returns null when the discovery has no measured pair,
 * so the card simply omits the visual rather than inventing one.
 */
export function discoveryMomentum(discovery: InsightDiscovery): DiscoveryMomentum | null {
  const evidence = discovery.dataEvidence
  if (typeof evidence !== 'object' || evidence === null) return null
  const currency = discovery.impactCurrency || 'USD'
  const pair = (before: number, after: number, extras: Omit<DiscoveryMomentum, 'before' | 'after' | 'currency' | 'change'>): DiscoveryMomentum => ({
    ...extras,
    before,
    after,
    currency,
    change: before > 0 ? (after - before) / before : null,
  })

  const recentUnits = asNumber(evidence.recentUnits)
  const priorUnits = asNumber(evidence.priorUnits)
  if (recentUnits !== null && priorUnits !== null) {
    return pair(priorUnits, recentUnits, { title: 'Units sold', beforeLabel: 'Prior 14 days', afterLabel: 'Last 14 days', unit: 'units' })
  }

  const currentRevenue = nestedNumber(evidence.current, 'revenue')
  const previousRevenue = nestedNumber(evidence.previous, 'revenue')
  if (currentRevenue !== null && previousRevenue !== null) {
    return pair(previousRevenue, currentRevenue, { title: 'Revenue', beforeLabel: 'Previous 30 days', afterLabel: 'Last 30 days', unit: 'money' })
  }

  const actual = asNumber(evidence.value)
  const expected = asNumber(evidence.expected)
  if (actual !== null && expected !== null) {
    return pair(expected, actual, { title: 'That day vs the norm', beforeLabel: 'Expected', afterLabel: 'Actual', unit: 'money' })
  }

  const repeat = asNumber(evidence.repeatCustomers)
  const oneTime = asNumber(evidence.oneTimeCustomers)
  if (repeat !== null && oneTime !== null) {
    return pair(oneTime, repeat, { title: 'Customers', beforeLabel: 'Bought once', afterLabel: 'Came back', unit: 'customers' })
  }

  return null
}

/** Formats one side of the momentum pair in its own unit. */
export function formatMomentumValue(momentum: DiscoveryMomentum, value: number): string {
  if (momentum.unit === 'money') return formatInsightMoney(value, momentum.currency)
  const rounded = formatInsightNumber(Math.round(value))
  if (momentum.unit === 'units') return `${rounded} sold`
  if (momentum.unit === 'orders') return `${rounded} orders`
  return `${rounded} customers`
}

/** Bar widths for the momentum pair, 0–100, scaled to the larger side. */
export function momentumWidths(momentum: DiscoveryMomentum): Readonly<{ before: number; after: number }> {
  const max = Math.max(Math.abs(momentum.before), Math.abs(momentum.after))
  if (max <= 0) return { before: 0, after: 0 }
  return { before: Math.round((Math.abs(momentum.before) / max) * 100), after: Math.round((Math.abs(momentum.after) / max) * 100) }
}

/**
 * Evidence keys that are storage plumbing, not merchant information. They are
 * hidden from cards so a shopper-facing surface never shows a product id.
 */
const TECHNICAL_EVIDENCE_KEYS: ReadonlySet<string> = new Set(['productId', 'storeId', 'id', 'method', 'basedOnRealData', 'sampleReason', 'entityId'])

const EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  recentUnits: 'Sold in the last 14 days',
  priorUnits: 'Sold in the prior 14 days',
  growthPercent: 'Growth',
  recentRevenue: 'Recent revenue',
  coPurchaseRate: 'Bought together',
  repeatCustomers: 'Repeat customers',
  oneTimeCustomers: 'One-time customers',
  repeatShare: 'Share of customers',
  repeatLtvShare: 'Share of lifetime value',
  topShare: 'Top product share',
  top3Share: 'Top three share',
  peakHour: 'Busiest hour',
  peakOrders: 'Orders in that hour',
  totalOrders: 'Orders analysed',
  deviationPercent: 'Deviation from normal',
  revenueChange: 'Revenue change',
  ordersChange: 'Orders change',
  aovChange: 'Average order value change',
  expected: 'Expected',
  value: 'Actual',
  day: 'Day',
  product: 'Product',
  related: 'Bought with',
}

/**
 * Merchant-readable evidence rows: technical identifiers removed, keys given
 * plain-English labels. Values are still the engine's own numbers, untouched.
 */
export function humanEvidenceRows(evidence: InsightsJsonObject | null | undefined, max = 3): readonly Readonly<{ label: string; value: string }>[] {
  const filtered: Record<string, unknown> = {}
  if (typeof evidence !== 'object' || evidence === null) return []
  for (const [key, value] of Object.entries(evidence)) {
    if (TECHNICAL_EVIDENCE_KEYS.has(key)) continue
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) continue
    filtered[key] = value
  }
  return evidenceRows(filtered, max).map((row) => {
    const key = Object.keys(filtered).find((candidate) => candidate.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2') === row.label)
    const label = key && EVIDENCE_LABELS[key] ? EVIDENCE_LABELS[key]! : row.label.charAt(0).toUpperCase() + row.label.slice(1)
    return { label, value: row.value }
  })
}

/* ── Discovery impact summary (treemap + strongest signal) ─────────────── */

export type DiscoveryCategoryBlock = Readonly<{ id: string; label: string; value: number }>

/** Signal counts per category — the treemap's blocks. Real counts only. */
export function discoveryCategoryBlocks(discoveries: readonly InsightDiscovery[]): readonly DiscoveryCategoryBlock[] {
  const counts = new Map<DiscoveryCategory, number>()
  for (const discovery of discoveries) counts.set(discovery.category, (counts.get(discovery.category) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, value]) => ({ id: category, label: DISCOVERY_CATEGORY_LABELS[category], value }))
}

export type DiscoveryImpactSummary = Readonly<{
  total: number
  blocks: readonly DiscoveryCategoryBlock[]
  mostActive: DiscoveryCategoryBlock | null
  strongest: Readonly<{ title: string; confidence: number }> | null
  /** Total money the engine attached to the visible discoveries, if any. */
  moneyInPlay: number | null
  currency: string
}>

/** Everything the "what PatternAI has found" panel needs, all measured. */
export function discoveryImpactSummary(discoveries: readonly InsightDiscovery[]): DiscoveryImpactSummary {
  const blocks = discoveryCategoryBlocks(discoveries)
  const withImpact = discoveries.filter((discovery) => typeof discovery.impactEstimate === 'number')
  const moneyInPlay = withImpact.length > 0 ? withImpact.reduce((sum, discovery) => sum + (discovery.impactEstimate ?? 0), 0) : null
  const strongestDiscovery = [...discoveries].sort((left, right) => right.confidenceScore - left.confidenceScore)[0] ?? null
  return {
    total: discoveries.length,
    blocks,
    mostActive: blocks[0] ?? null,
    strongest: strongestDiscovery ? { title: strongestDiscovery.title, confidence: strongestDiscovery.confidenceScore } : null,
    moneyInPlay,
    currency: withImpact[0]?.impactCurrency ?? 'USD',
  }
}

/* ── Pattern strength meter ────────────────────────────────────────────── */

/**
 * Engine thresholds, mirrored from `@profitpilot/ai` `insights-hub.ts`. They
 * are the same constants the backend gates on, so the meter can never promise
 * a pattern the engine would refuse to publish.
 */
export const ENGINE_MIN_ORDERS_FOR_DISCOVERY = 10
export const ENGINE_MIN_PRODUCTS_FOR_PATTERNS = 2

export type PatternStrengthState = 'strong' | 'good' | 'moderate' | 'building' | 'learning'
export type PatternStrengthRow = Readonly<{
  id: string
  label: string
  /** 0–100, always have ÷ need from the API's readiness block. */
  percent: number
  state: PatternStrengthState
  stateLabel: string
  detail: string
}>

export function patternStrengthState(percent: number): PatternStrengthState {
  if (percent >= 80) return 'strong'
  if (percent >= 60) return 'good'
  if (percent >= 40) return 'moderate'
  if (percent >= 20) return 'building'
  return 'learning'
}

const STRENGTH_STATE_LABELS: Readonly<Record<PatternStrengthState, string>> = {
  strong: 'Strong',
  good: 'Good',
  moderate: 'Moderate',
  building: 'Building',
  learning: 'Learning',
}

/**
 * How much evidence the store has for each family of pattern. Every row is
 * have ÷ need against a real engine threshold — nothing is modelled, and the
 * detail line always states the raw counts behind the bar.
 */
export function patternStrengthRows(readiness: InsightsDataReadiness | null): readonly PatternStrengthRow[] {
  if (!readiness) return []
  const row = (id: string, label: string, have: number, need: number, unit: string): PatternStrengthRow => {
    const percent = need <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((have / need) * 100)))
    const state = patternStrengthState(percent)
    return {
      id,
      label,
      percent,
      state,
      stateLabel: STRENGTH_STATE_LABELS[state],
      detail: `${formatInsightNumber(have)} of ${formatInsightNumber(need)} ${unit}`,
    }
  }
  return [
    row('orders', 'Order evidence', readiness.totalOrders, ENGINE_MIN_ORDERS_FOR_DISCOVERY, 'orders'),
    row('products', 'Product patterns', readiness.productsWithSales, ENGINE_MIN_PRODUCTS_FOR_PATTERNS, 'products with sales'),
    row('personas', 'Customer behaviour', readiness.personasRequirement.have, readiness.personasRequirement.need, 'customers'),
    row('predictions', 'Forecasting', readiness.predictRequirement.have, readiness.predictRequirement.need, 'days of history'),
    row('trends', 'Trend detection', readiness.trendsRequirement.have, readiness.trendsRequirement.need, 'days of history'),
  ]
}

/* ── Signal quality + review backlog (fill the empty KPI slots) ────────── */

export type SignalQualitySummary = Readonly<{
  total: number
  avgConfidence: number
  avgPercent: number
  highCount: number
  mediumCount: number
  lowCount: number
  highShare: number
  strongest: Readonly<{ title: string; confidence: number }> | null
}>

export function signalQualitySummary(discoveries: readonly InsightDiscovery[]): SignalQualitySummary {
  const total = discoveries.length
  if (total === 0) return { total: 0, avgConfidence: 0, avgPercent: 0, highCount: 0, mediumCount: 0, lowCount: 0, highShare: 0, strongest: null }
  const high = discoveries.filter((d) => d.confidenceScore >= 0.7).length
  const medium = discoveries.filter((d) => d.confidenceScore >= 0.5 && d.confidenceScore < 0.7).length
  const low = total - high - medium
  const avg = discoveries.reduce((sum, d) => sum + d.confidenceScore, 0) / total
  const strongest = [...discoveries].sort((a, b) => b.confidenceScore - a.confidenceScore)[0] ?? null
  return {
    total,
    avgConfidence: avg,
    avgPercent: Math.round(avg * 100),
    highCount: high,
    mediumCount: medium,
    lowCount: low,
    highShare: Math.round((high / total) * 100),
    strongest: strongest ? { title: strongest.title, confidence: strongest.confidenceScore } : null,
  }
}

export type ReviewBacklogSummary = Readonly<{
  total: number
  newCount: number
  reviewedCount: number
  actedOn: number
  conversion: number | null
  oldestNewLabel: string | null
  oldestNewDays: number | null
  urgent: boolean
  hint: string
}>

export function reviewBacklogSummary(discoveries: readonly InsightDiscovery[], funnel: DiscoveryFunnel): ReviewBacklogSummary {
  const total = discoveries.length
  const newCount = discoveries.filter((d) => d.status === 'NEW').length
  const reviewedCount = funnel.stages.find((s) => s.id === 'reviewed')?.value ?? 0
  const oldestNew = [...discoveries].filter((d) => d.status === 'NEW').sort((a, b) => Date.parse(a.discoveredAt) - Date.parse(b.discoveredAt))[0] ?? null
  let oldestNewDays: number | null = null
  let oldestNewLabel: string | null = null
  let urgent = false
  if (oldestNew) {
    const ageMs = Date.now() - Date.parse(oldestNew.discoveredAt)
    oldestNewDays = Math.floor(ageMs / 86_400_000)
    oldestNewLabel = formatRelativeTime(oldestNew.discoveredAt)
    urgent = oldestNewDays >= 3
  }
  const hint = total === 0
    ? 'Signals appear here after your first sweep.'
    : newCount === 0
      ? 'All caught up — every signal has been reviewed.'
      : urgent
        ? `${newCount} need review — oldest waiting ${oldestNewLabel}.`
        : `${newCount} new signal${newCount === 1 ? '' : 's'} ready to review.`
  return { total, newCount, reviewedCount, actedOn: funnel.actedOn, conversion: funnel.conversion, oldestNewLabel, oldestNewDays, urgent, hint }
}

/* ── Merchant value cards beside the lead discovery ───────────────────── */

const DECISION_WINDOW_MS = 7 * 86_400_000
const ACTIONABLE_DISCOVERY_STATUSES: readonly DiscoveryStatus[] = ['NEW', 'REVIEWED', 'SAVED']

export type DecisionWindowImpact = Readonly<{ currency: string; amount: number }>
export type DecisionWindowSignal = Readonly<{
  id: string
  title: string
  expiresAt: string
  remainingMs: number
  overdue: boolean
}>
export type DecisionWindowSummary = Readonly<{
  /** Real, non-sample, still-actionable signals carrying a valid expiresAt. */
  withDeadline: number
  dueSoon: number
  overdue: number
  next: DecisionWindowSignal | null
  /** Impact is grouped by currency; unlike a single total, currencies are never mixed. */
  urgentImpact: readonly DecisionWindowImpact[]
  excludedSamples: number
}>

/**
 * The next explicit action window. Samples, terminal statuses and invalid or
 * missing dates are excluded. "Due soon" means a future expiresAt no more
 * than seven days away; overdue and due-soon amounts are grouped by currency.
 */
export function decisionWindowSummary(discoveries: readonly InsightDiscovery[], now = Date.now()): DecisionWindowSummary {
  const excludedSamples = discoveries.filter((discovery) => discovery.sample).length
  const dated = discoveries.flatMap((discovery) => {
    if (discovery.sample || !ACTIONABLE_DISCOVERY_STATUSES.includes(discovery.status) || !discovery.expiresAt) return []
    const expiresAtMs = Date.parse(discovery.expiresAt)
    if (!Number.isFinite(expiresAtMs)) return []
    return [{ discovery, expiresAtMs, remainingMs: expiresAtMs - now }]
  }).sort((left, right) => left.expiresAtMs - right.expiresAtMs)
  const overdue = dated.filter((entry) => entry.remainingMs <= 0)
  const dueSoon = dated.filter((entry) => entry.remainingMs > 0 && entry.remainingMs <= DECISION_WINDOW_MS)
  const urgent = [...overdue, ...dueSoon]
  const byCurrency = new Map<string, number>()
  for (const { discovery } of urgent) {
    if (typeof discovery.impactEstimate !== 'number' || !Number.isFinite(discovery.impactEstimate)) continue
    byCurrency.set(discovery.impactCurrency, (byCurrency.get(discovery.impactCurrency) ?? 0) + discovery.impactEstimate)
  }
  const first = dated[0]
  return {
    withDeadline: dated.length,
    dueSoon: dueSoon.length,
    overdue: overdue.length,
    next: first ? { id: first.discovery.id, title: first.discovery.title, expiresAt: first.discovery.expiresAt!, remainingMs: first.remainingMs, overdue: first.remainingMs <= 0 } : null,
    urgentImpact: [...byCurrency.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) => ({ currency, amount })),
    excludedSamples,
  }
}

export type SignalFeedbackSummary = Readonly<{
  kept: number
  dismissed: number
  classified: number
  keptShare: number | null
  topKeptCategory: Readonly<{ category: DiscoveryCategory; label: string; count: number }> | null
  excludedSamples: number
}>

/**
 * A factual record of current discovery statuses — not a model-learning score.
 * "Kept" means the signal is currently Saved or Acted on; samples are never
 * counted, and views/reviews do not imply a preference.
 */
export function signalFeedbackSummary(discoveries: readonly InsightDiscovery[]): SignalFeedbackSummary {
  const real = discoveries.filter((discovery) => !discovery.sample)
  const keptSignals = real.filter((discovery) => discovery.status === 'SAVED' || discovery.status === 'ACTED_ON')
  const dismissed = real.filter((discovery) => discovery.status === 'DISMISSED').length
  const kept = keptSignals.length
  const classified = kept + dismissed
  const categoryCounts = new Map<DiscoveryCategory, number>()
  for (const discovery of keptSignals) categoryCounts.set(discovery.category, (categoryCounts.get(discovery.category) ?? 0) + 1)
  const top = DISCOVERY_CATEGORIES
    .map((category) => ({ category, label: DISCOVERY_CATEGORY_LABELS[category], count: categoryCounts.get(category) ?? 0 }))
    .sort((left, right) => right.count - left.count || DISCOVERY_CATEGORIES.indexOf(left.category) - DISCOVERY_CATEGORIES.indexOf(right.category))[0]
  return {
    kept,
    dismissed,
    classified,
    keptShare: classified > 0 ? kept / classified : null,
    topKeptCategory: top && top.count > 0 ? top : null,
    excludedSamples: discoveries.length - real.length,
  }
}

/* ── Monthly discovery allowance ───────────────────────────────────────── */

export type MonthlyDiscoveryProgress = Readonly<{
  used: number
  limit: number | null
  remaining: number | null
  /** 0–100 for the ring; 0 when the plan has no monthly cap. */
  percent: number
  unlimited: boolean
  atLimit: boolean
  caption: string
}>

/** Ring model for "discoveries this month" — API usage numbers, formatted. */
export function monthlyDiscoveryProgress(overview: InsightsOverview | null): MonthlyDiscoveryProgress | null {
  if (!overview) return null
  const { used, limit, remaining } = overview.usage.discoveries
  const unlimited = limit === null
  const percent = unlimited ? 0 : Math.max(0, Math.min(100, Math.round((used / Math.max(1, limit)) * 100)))
  const left = remaining ?? (limit === null ? null : Math.max(0, limit - used))
  const atLimit = !unlimited && (left ?? 0) <= 0
  const caption = unlimited
    ? 'No monthly cap on your plan'
    : atLimit
      ? 'Allowance used for this month'
      : `${formatInsightNumber(left ?? 0)} discover${(left ?? 0) === 1 ? 'y' : 'ies'} left this month`
  return { used, limit, remaining: left, percent, unlimited, atLimit, caption }
}

export type PatternAiPlanFeature = Readonly<{ feature: InsightsFeature; label: string; unlocked: boolean; requiredPlan: PlanTier }>
export type PatternAiPlanSummary = Readonly<{ plan: PlanTier; planLabel: string; unlocked: readonly PatternAiPlanFeature[]; locked: readonly PatternAiPlanFeature[] }>

export const PLAN_LABELS: Readonly<Record<PlanTier, string>> = {
  trial: 'Trial',
  start: 'Start',
  growth: 'Growth',
  commander: 'Commander',
}

/**
 * Plan-based feature display. The overview is authoritative when present;
 * otherwise the static minimum-plan matrix is used. Copy never names a target
 * plan in a CTA — the CTA is always the generic "Upgrade Plan".
 */
export function patternAiPlanSummary(plan: PlanTier, overview: InsightsOverview | null): PatternAiPlanSummary {
  const features = (Object.keys(INSIGHTS_FEATURE_MIN_PLAN) as InsightsFeature[]).map((feature) => {
    const lock = insightsFeatureLock(plan, feature, overview)
    return { feature, label: FEATURE_LABELS[feature], unlocked: !lock.locked, requiredPlan: lock.requiredPlan }
  })
  return {
    plan,
    planLabel: PLAN_LABELS[plan],
    unlocked: features.filter((entry) => entry.unlocked),
    locked: features.filter((entry) => !entry.unlocked),
  }
}

export type ReadinessCheck = Readonly<{ id: string; label: string; met: boolean; have: number; need: number }>

/**
 * The "growing your pattern intelligence" checklist. Requirements come from
 * the API's readiness block so the thresholds can never drift from the engine.
 */
export function readinessChecklist(readiness: InsightsDataReadiness | null): readonly ReadinessCheck[] {
  if (!readiness) return []
  return [
    { id: 'discoveries', label: 'Orders synced for discovery', met: readiness.canDiscover, have: readiness.totalOrders, need: readiness.totalOrders > 0 && readiness.canDiscover ? readiness.totalOrders : Math.max(readiness.totalOrders, 1) },
    { id: 'personas', label: 'Customers for persona modelling', met: readiness.personasRequirement.met, have: readiness.personasRequirement.have, need: readiness.personasRequirement.need },
    { id: 'trends', label: 'Days of history for trend watching', met: readiness.trendsRequirement.met, have: readiness.trendsRequirement.have, need: readiness.trendsRequirement.need },
    { id: 'predictions', label: 'Days of history for forecasting', met: readiness.predictRequirement.met, have: readiness.predictRequirement.have, need: readiness.predictRequirement.need },
  ]
}

/** Percentage complete for a readiness row, capped at 100. */
export function readinessPercent(check: ReadinessCheck): number {
  if (check.need <= 0) return check.met ? 100 : 0
  return Math.max(0, Math.min(100, Math.round((check.have / check.need) * 100)))
}

/**
 * Human sentence for degraded sections, e.g. after a partial storage outage.
 * Empty string when everything answered — the banner then never renders.
 */
export function degradedNotice(overview: InsightsOverview | null): string {
  const sections = overview?.degraded ?? []
  if (sections.length === 0) return ''
  const list = [...sections].sort().join(', ')
  return `PatternAI rendered this page without ${list}. Those sections are retrying in the background — nothing shown here is estimated.`
}

/* ── Explore-card mini-visualization models ────────────────────────────── */

/**
 * Word-cloud entries for the learning card. Weights are how often a real
 * lesson category/type appears in the store's own library — never a canned
 * vocabulary list.
 */
export function lessonTopicCloud(lessons: readonly InsightLesson[], limit = 8): readonly Readonly<{ tag: string; weight: number }>[] {
  const counts = new Map<string, number>()
  for (const lesson of lessons) {
    for (const word of [DISCOVERY_CATEGORY_LABELS[lesson.category], LESSON_TYPE_LABELS[lesson.lessonType]]) {
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, weight]) => ({ tag, weight }))
}

export type DivergingRow = Readonly<{ id: string; label: string; magnitude: number; direction: TrendDirection }>

/** Diverging bars for the trend card: signed magnitude straight from the API. */
export function trendDivergingRows(trends: readonly InsightTrend[], limit = 5): readonly DivergingRow[] {
  return [...trends]
    .sort((left, right) => Math.abs(right.magnitude) - Math.abs(left.magnitude))
    .slice(0, limit)
    .map((trend) => ({ id: trend.id, label: trend.title, magnitude: trend.magnitude, direction: trend.direction }))
}

export type CauseNode = Readonly<{ id: string; label: string; weight: number }>

/** Root-cause web for the Why? card — ranked causes with their real shares. */
export function investigationCauseNodes(investigations: readonly InsightInvestigation[], limit = 5): readonly CauseNode[] {
  const latest = [...investigations].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
  if (!latest) return []
  return latest.rootCauses.slice(0, limit).map((cause, index) => ({ id: `${latest.id}-${index}`, label: cause.cause, weight: Math.max(0, Math.min(1, cause.impactShare)) }))
}

export type WavePoint = Readonly<{ day: string; value: number; lower: number; upper: number }>

/** Probability-wave points for the predictions card — the API's own series. */
export function predictionWavePoints(predictions: readonly InsightPrediction[], limit = 10): readonly WavePoint[] {
  const first = predictions.find((prediction) => prediction.series.length > 0)
  if (!first) return []
  return first.series.slice(0, limit).map((point) => ({ day: point.day, value: point.value, lower: point.lower, upper: point.upper }))
}

/** Average persona radar across the store's personas — measured traits only. */
export function personaRadarAverage(personas: readonly InsightPersona[]): readonly PersonaRadarTrait[] {
  const totals = new Map<string, { sum: number; count: number }>()
  for (const persona of personas) {
    for (const trait of persona.radar) {
      const entry = totals.get(trait.trait) ?? { sum: 0, count: 0 }
      totals.set(trait.trait, { sum: entry.sum + trait.score, count: entry.count + 1 })
    }
  }
  return [...totals.entries()].map(([trait, entry]) => ({ trait, score: entry.count > 0 ? entry.sum / entry.count : 0 }))
}
