/**
 * Client-side contract and humanization layer for the Insights Hub (PR #50).
 *
 * Mirrors `apps/api/src/insights-hub-routes.ts` and `@profitpilot/ai`
 * `insights-hub.ts`. The workspace NEVER derives a metric, a confidence, or a
 * count of its own — it renders what the API returned. Every figure on screen
 * is computed server-side from real synchronized store data; the AI narrator
 * only restyles deterministic engine output through the language firewall.
 *
 * "Curious scientist" tone: discoveries are phrased as questions and
 * observations ("Did you know…"), never as commands or invented numbers.
 */

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
  readiness: InsightsDataReadiness
  preferences: InsightsPreferences
  autoDiscoveryRan: boolean
  trial: boolean
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
  const label = FEATURE_LABELS[feature] ?? 'This Insights Hub feature'
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
  timeline: 'The insights timeline',
  predictions: 'Predictions',
  autoDiscovery: 'Auto-discovery',
  export: 'Insight exports',
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

/* ── Routing (/ai-growth-command/insights/*) ───────────────────────────── */

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

export const INSIGHTS_BASE_PATH = '/ai-growth-command/insights'

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
  const base = INSIGHTS_BASE_PATH
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
  const base = tab === 'overview' ? INSIGHTS_BASE_PATH : `${INSIGHTS_BASE_PATH}/${tab}`
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
    case 'lessons': return 'Lessons'
    case 'patterns': return 'Pattern lab'
    case 'personas': return 'Personas'
    case 'why': return 'Why?'
    case 'trends': return 'Trend watcher'
    case 'comparisons': return 'Compare'
    case 'knowledge': return 'Knowledge base'
    case 'timeline': return 'Timeline'
    case 'predictions': return 'Predictions'
    case 'settings': return 'Settings'
    case 'api-access': return 'API access'
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
export function evidenceRows(evidence: InsightsJsonObject, max = 6): readonly Readonly<{ label: string; value: string }>[] {
  const rows: { label: string; value: string }[] = []
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
