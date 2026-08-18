/**
 * PR #49 — AI Executive module types.
 *
 * "Your Boardroom in a Box": CEO-level strategic intelligence for Shopify
 * merchants. Every value in these payloads is computed from real synced
 * store rows (analytics, orders, customers, catalog) or curated public
 * industry benchmarks — never invented.
 */
import type { PlanTier, StoreId } from '@profitpilot/types'

// ────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveReportType = 'MONTHLY' | 'QUARTERLY' | 'CUSTOM'
export type ExecutiveStatus = 'STRONG' | 'HEALTHY' | 'AT_RISK' | 'CRITICAL'
export type VitalSignStatus = 'HEALTHY' | 'NEEDS_ATTENTION' | 'RISK' | 'CRITICAL'
export type ScenarioType = 'PRICING' | 'PRODUCT' | 'MARKETING' | 'INVENTORY' | 'CUSTOM'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type OpportunityCategory = 'MARKET_GAP' | 'EXPANSION' | 'SEASONAL' | 'CROSS_SELL' | 'PRICING' | 'PRODUCT'
export type OpportunityStatus = 'NEW' | 'REVIEWING' | 'PURSUING' | 'DISMISSED' | 'COMPLETED'
export type OpportunityTimeline = '30_DAYS' | '60_DAYS' | '90_DAYS' | 'LONG_TERM'
export type EffortLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type DecisionType = 'PRICING' | 'PRODUCT' | 'MARKETING' | 'INVENTORY' | 'STRATEGIC' | 'CUSTOM'
export type DecisionQuality = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'PENDING'
export type RiskType = 'CONCENTRATION' | 'SEASONAL' | 'COMPETITION' | 'CASHFLOW' | 'OPERATIONAL' | 'MARKET'
export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type RiskStatus = 'ACTIVE' | 'MITIGATED' | 'REALIZED' | 'RESOLVED'
export type RoadmapType = '30_DAY' | '60_DAY' | '90_DAY' | 'QUARTERLY' | 'YEARLY'
export type RoadmapStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ABANDONED'

// ────────────────────────────────────────────────────────────────────────────
// Benchmarks
// ────────────────────────────────────────────────────────────────────────────

export const EXECUTIVE_BENCHMARK_CATEGORIES = [
  'Fashion & Apparel',
  'Electronics',
  'Home & Garden',
  'Beauty & Health',
  'Food & Beverages',
  'Sports & Outdoor',
  'Toys & Games',
  'Books & Media',
  'Jewelry & Accessories',
  'Other',
] as const
export type ExecutiveBenchmarkCategory = (typeof EXECUTIVE_BENCHMARK_CATEGORIES)[number]

export const EXECUTIVE_BENCHMARK_METRICS = ['REVENUE', 'AOV', 'CONVERSION', 'REPEAT_PURCHASE', 'CAC', 'INVENTORY_TURNOVER', 'RETURN_RATE'] as const
export type ExecutiveBenchmarkMetric = (typeof EXECUTIVE_BENCHMARK_METRICS)[number]

export type BenchmarkPercentile = 10 | 25 | 50 | 75 | 90

export type ExecutiveBenchmarkRow = Readonly<{
  id: string
  category: string
  metric: string
  percentile: BenchmarkPercentile
  value: number
  currency: string | null
  dataSource: 'SHOPIFY_PUBLIC' | 'ANONYMIZED_INTERNAL'
  sourceLabel: string
  validFrom: string
  validTo: string
}>

export type BenchmarkLadder = Readonly<{ metric: ExecutiveBenchmarkMetric; points: readonly Readonly<{ percentile: BenchmarkPercentile; value: number }>[]; currency: string | null; sourceLabel: string }>

export type BenchmarkMetricPosition = Readonly<{
  metric: ExecutiveBenchmarkMetric
  label: string
  yourValue: number | null
  currency: string | null
  industryMedian: number | null
  top10Target: number | null
  percentile: number | null
  gapToTop10Pct: number | null
  sourceLabel: string
  yourValueMissing: boolean
}>

export type BenchmarkPosition = Readonly<{
  storeId: StoreId
  category: ExecutiveBenchmarkCategory
  categorySource: 'AUTO_DETECTED' | 'PREFERENCE' | 'DEFAULT'
  positions: readonly BenchmarkMetricPosition[]
  visibleMetrics: number
  totalMetrics: number
  asOf: string
}>

// ────────────────────────────────────────────────────────────────────────────
// Health diagnosis
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveVitalSign = Readonly<{
  key: string
  label: string
  status: VitalSignStatus
  value: number | null
  formattedValue: string
  trend: 'up' | 'down' | 'flat' | 'unknown'
  explanation: string
  evidence: Readonly<Record<string, string | number | boolean | null>>
}>

export type ExecutiveHealthDiagnosis = Readonly<{
  id: string
  storeId: StoreId
  overallScore: number
  overallStatus: ExecutiveStatus
  vitalSigns: readonly ExecutiveVitalSign[]
  conditions: readonly Readonly<{ key: string; title: string; severity: VitalSignStatus; causes: string; treatment: string }>[]
  prescriptions: readonly Readonly<{ title: string; action: string; timeframe: string }>[]
  diagnosedAt: string
  nextDiagnosisDue: string | null
}>

// ────────────────────────────────────────────────────────────────────────────
// Risks
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveRisk = Readonly<{
  id: string
  storeId: StoreId
  riskType: RiskType
  title: string
  description: string
  severity: RiskSeverity
  probability: number
  impactIfRealized: number
  impactCurrency: string
  mitigationPlan: readonly Readonly<{ step: string; timeline: string }>[]
  status: RiskStatus
  detectedAt: string
  resolvedAt: string | null
}>

export type RiskTrendPoint = Readonly<{ periodStart: string; active: number; critical: number }>

// ────────────────────────────────────────────────────────────────────────────
// Opportunities
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveOpportunity = Readonly<{
  id: string
  storeId: StoreId
  category: OpportunityCategory
  title: string
  description: string
  estimatedImpactAnnual: number
  impactCurrency: string
  confidence: number
  effortLevel: EffortLevel
  timeline: OpportunityTimeline
  actionPlan: readonly Readonly<{ step: string; detail: string }>[]
  status: OpportunityStatus
  identifiedAt: string
  updatedAt: string
}>

// ────────────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────────────

export type ScenarioInput = Readonly<Record<string, number | string | boolean>>

export type ExecutiveScenario = Readonly<{
  id: string
  storeId: StoreId
  scenarioType: ScenarioType
  title: string
  description: string
  inputs: ScenarioInput
  predictions: Readonly<{
    baseline: Readonly<Record<string, number>>
    projected: Readonly<Record<string, number>>
    delta: Readonly<Record<string, number>>
    horizonMonths: number
    assumptions: readonly string[]
    narrative: string | null
    currency: string
  }>
  confidence: number
  riskLevel: RiskLevel
  recommendation: string
  narrative: string | null
  createdAt: string
}>

export type ScenarioTemplate = Readonly<{
  id: string
  scenarioType: ScenarioType
  title: string
  description: string
  inputs: readonly Readonly<{ key: string; label: string; unit: 'currency' | 'percent' | 'count' | 'multiplier'; min: number; max: number; step: number; default: number }>[]
}>

// ────────────────────────────────────────────────────────────────────────────
// Board reports
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveReport = Readonly<{
  id: string
  storeId: StoreId
  reportType: ExecutiveReportType
  periodStart: string
  periodEnd: string
  executiveSummary: string
  content: Readonly<{
    strategicPosition: string | null
    keyInsights: readonly string[]
    recommendedDecisions: readonly string[]
    financialForecast: Readonly<{ horizonDays: number; currency: string; projections: readonly Readonly<{ label: string; low: number; expected: number; high: number }>[] }> | null
    appendix: Readonly<Record<string, Readonly<Record<string, string | number | null>>>>
    aiNarrativeAvailable: boolean
    generatedWithModel: string | null
  }>
  pdfUrl: string | null
  generatedAt: string
  viewedAt: string | null
}>

// ────────────────────────────────────────────────────────────────────────────
// Decisions
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveDecision = Readonly<{
  id: string
  storeId: StoreId
  decisionType: DecisionType
  title: string
  description: string
  decisionDate: string
  predictedOutcome: Readonly<Record<string, number | string>> | null
  actualOutcome: Readonly<Record<string, number | string>> | null
  accuracyScore: number | null
  qualityRating: DecisionQuality
  lessonsLearned: string
  createdBy: string
  createdAt: string
  reviewedAt: string | null
}>

export type DecisionAnalytics = Readonly<{
  total: number
  reviewed: number
  averageAccuracy: number | null
  qualityDistribution: Readonly<Record<DecisionQuality, number>>
  bestDecisions: readonly ExecutiveDecision[]
  improvementAreas: readonly string[]
}>

// ────────────────────────────────────────────────────────────────────────────
// Roadmaps
// ────────────────────────────────────────────────────────────────────────────

export type RoadmapMilestone = Readonly<{
  key: string
  title: string
  description: string
  dueDate: string
  status: 'PENDING' | 'CURRENT' | 'COMPLETE'
  successMetrics: readonly string[]
  dependencies: readonly string[]
}>

export type ExecutiveRoadmap = Readonly<{
  id: string
  storeId: StoreId
  roadmapType: RoadmapType
  periodStart: string
  periodEnd: string
  title: string
  milestones: readonly RoadmapMilestone[]
  expectedOutcomes: readonly string[]
  confidenceScore: number
  currentProgress: number
  status: RoadmapStatus
  createdAt: string
  updatedAt: string
}>

// ────────────────────────────────────────────────────────────────────────────
// Preferences & usage
// ────────────────────────────────────────────────────────────────────────────

export type ExecutivePreferences = Readonly<{
  storeId: StoreId
  monthlyReportEnabled: boolean
  monthlyReportEmailEnabled: boolean
  reportEmail: string | null
  reportGenerationDay: number
  riskAlertsEnabled: boolean
  riskAlertSeverity: 'all' | 'HIGH' | 'CRITICAL'
  benchmarkCategory: ExecutiveBenchmarkCategory
  language: 'en' | 'hi'
  updatedAt: string
}>

export type ExecutiveUsage = Readonly<{
  plan: PlanTier
  features: readonly Readonly<{ feature: string; label: string; used: number; limit: number | null; remaining: number | null; percent: number }>[]
}>

// ────────────────────────────────────────────────────────────────────────────
// Dashboard rollup
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveDashboard = Readonly<{
  storeId: StoreId
  plan: PlanTier
  currency: string
  health: ExecutiveHealthDiagnosis | null
  latestReport: ExecutiveReport | null
  nextReportDue: string | null
  benchmarkPosition: BenchmarkPosition | null
  opportunities: readonly ExecutiveOpportunity[]
  risks: readonly ExecutiveRisk[]
  scenarios: readonly ExecutiveScenario[]
  roadmap: ExecutiveRoadmap | null
  decisions: readonly ExecutiveDecision[]
  usage: ExecutiveUsage
  gates: Readonly<Record<string, Readonly<{ allowed: boolean; requiredPlan: PlanTier; used: number; limit: number | null }>>>
  revenueSeries: readonly Readonly<{ day: string; value: number }>[]
  ordersSeries: readonly Readonly<{ day: string; value: number }>[]
  generatedAt: string
}>

// ────────────────────────────────────────────────────────────────────────────
// PDF
// ────────────────────────────────────────────────────────────────────────────

export type ExecutivePdfJob = Readonly<{
  jobId: string
  storeId: StoreId
  reportId: string
  status: 'QUEUED' | 'GENERATING' | 'COMPLETED' | 'FAILED'
  filename: string | null
  error: string | null
  createdAt: string
  completedAt: string | null
}>

export type ExecutiveWhiteLabel = Readonly<{
  brandName: string | null
  logoText: string | null
  primaryColor: string | null
  footerText: string | null
}>

export const EXECUTIVE_FEATURE_LABELS: Readonly<Record<string, string>> = {
  'ai_executive_reports_month': 'Board reports generated',
  'ai_executive_scenarios_month': 'Scenarios run',
  'ai_executive_health_month': 'Health diagnoses run',
  'ai_executive_risk_scans_month': 'Risk scans run',
  'ai_executive_pdf_month': 'Investor PDF reports',
  'ai_executive_exports_month': 'Exports generated',
  'ai_executive_opportunities': 'Opportunities tracked',
  'ai_executive_decisions': 'Decisions logged',
  'ai_executive_roadmaps_active': 'Active roadmaps',
  'ai_executive_benchmark_metrics': 'Benchmark metrics visible',
} as const
