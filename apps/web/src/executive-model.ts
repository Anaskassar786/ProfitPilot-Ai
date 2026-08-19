/**
 * GrowthIQ (formerly "AI Executive") — client model.
 *
 * Types mirror the API payloads from /ai-executive/* plus pure display
 * helpers (status colors, labels, formatters) shared by every executive
 * page. No helper here invents data: formatting-only transformations.
 */
import type { PlanTier } from '@profitpilot/types'

export type ExecutiveReportType = 'MONTHLY' | 'QUARTERLY' | 'CUSTOM'
export type ExecutiveHealthStatus = 'STRONG' | 'HEALTHY' | 'AT_RISK' | 'CRITICAL'
export type VitalSignStatus = 'HEALTHY' | 'NEEDS_ATTENTION' | 'RISK' | 'CRITICAL'
export type ScenarioType = 'PRICING' | 'PRODUCT' | 'MARKETING' | 'INVENTORY' | 'CUSTOM'
export type OpportunityCategory = 'MARKET_GAP' | 'EXPANSION' | 'SEASONAL' | 'CROSS_SELL' | 'PRICING' | 'PRODUCT'
export type OpportunityStatus = 'NEW' | 'REVIEWING' | 'PURSUING' | 'DISMISSED' | 'COMPLETED'
export type DecisionType = 'PRICING' | 'PRODUCT' | 'MARKETING' | 'INVENTORY' | 'STRATEGIC' | 'CUSTOM'
export type DecisionQuality = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'PENDING'
export type RiskType = 'CONCENTRATION' | 'SEASONAL' | 'COMPETITION' | 'CASHFLOW' | 'OPERATIONAL' | 'MARKET'
export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type RiskStatus = 'ACTIVE' | 'MITIGATED' | 'REALIZED' | 'RESOLVED'
export type RoadmapType = '30_DAY' | '60_DAY' | '90_DAY' | 'QUARTERLY' | 'YEARLY'
export type RoadmapStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ABANDONED'

export type ExecutiveVitalSign = Readonly<{
  key: string
  label: string
  status: VitalSignStatus
  value: number | null
  formattedValue: string
  trend: 'up' | 'down' | 'flat' | 'unknown'
  explanation: string
}>

export type ExecutiveHealthDiagnosis = Readonly<{
  id: string
  storeId: string
  overallScore: number
  overallStatus: ExecutiveHealthStatus
  vitalSigns: readonly ExecutiveVitalSign[]
  conditions: readonly Readonly<{ key: string; title: string; severity: VitalSignStatus; causes: string; treatment: string }>[]
  prescriptions: readonly Readonly<{ title: string; action: string; timeframe: string }>[]
  diagnosedAt: string
  nextDiagnosisDue: string | null
}>

export type ExecutiveReport = Readonly<{
  id: string
  storeId: string
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

export type ExecutiveScenario = Readonly<{
  id: string
  storeId: string
  scenarioType: ScenarioType
  title: string
  description: string
  inputs: Readonly<Record<string, number>>
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
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  recommendation: string
  narrative: string | null
  createdAt: string
}>

export type ExecutiveOpportunity = Readonly<{
  id: string
  storeId: string
  category: OpportunityCategory
  title: string
  description: string
  estimatedImpactAnnual: number
  impactCurrency: string
  confidence: number
  effortLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  timeline: '30_DAYS' | '60_DAYS' | '90_DAYS' | 'LONG_TERM'
  actionPlan: readonly Readonly<{ step: string; detail: string }>[]
  status: OpportunityStatus
  identifiedAt: string
  updatedAt: string
}>

export type ExecutiveRisk = Readonly<{
  id: string
  storeId: string
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

export type ExecutiveDecision = Readonly<{
  id: string
  storeId: string
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

export type ExecutiveRoadmap = Readonly<{
  id: string
  storeId: string
  roadmapType: RoadmapType
  periodStart: string
  periodEnd: string
  title: string
  milestones: readonly Readonly<{ key: string; title: string; description: string; dueDate: string; status: 'PENDING' | 'CURRENT' | 'COMPLETE'; successMetrics: readonly string[]; dependencies: readonly string[] }>[]
  expectedOutcomes: readonly string[]
  confidenceScore: number
  currentProgress: number
  status: RoadmapStatus
  createdAt: string
  updatedAt: string
}>

export type ExecutivePreferences = Readonly<{
  storeId: string
  monthlyReportEnabled: boolean
  monthlyReportEmailEnabled: boolean
  reportEmail: string | null
  reportGenerationDay: number
  riskAlertsEnabled: boolean
  riskAlertSeverity: 'all' | 'HIGH' | 'CRITICAL'
  benchmarkCategory: string
  language: 'en' | 'hi'
  updatedAt: string
}>

export type ExecutiveGate = Readonly<{ allowed: boolean; requiredPlan: PlanTier; used: number; limit: number | null }>

export type ExecutiveUsage = Readonly<{
  plan: PlanTier
  features: readonly Readonly<{ feature: string; label: string; used: number; limit: number | null; remaining: number | null; percent: number }>[]
}>

export type ExecutiveDashboard = Readonly<{
  storeId: string
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
  gates: Readonly<Record<string, ExecutiveGate>>
  revenueSeries: readonly Readonly<{ day: string; value: number }>[]
  ordersSeries: readonly Readonly<{ day: string; value: number }>[]
  /** Real synced totals — strategic sections count from these, never estimates. */
  totals: Readonly<{ customers: number; products: number; syncedOrders: number; syncedRevenue: number; daysSynced: number }>
  /** Real top products by synced revenue (empty when nothing has sold yet). */
  topProducts: readonly Readonly<{ title: string; revenue: number; sharePct: number }>[]
  generatedAt: string
}>

export type BenchmarkMetricPosition = Readonly<{
  metric: string
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
  storeId: string
  category: string
  categorySource: 'AUTO_DETECTED' | 'PREFERENCE' | 'DEFAULT'
  positions: readonly BenchmarkMetricPosition[]
  visibleMetrics: number
  totalMetrics: number
  asOf: string
}>

export type ScenarioTemplate = Readonly<{
  id: string
  scenarioType: ScenarioType
  title: string
  description: string
  inputs: readonly Readonly<{ key: string; label: string; unit: 'currency' | 'percent' | 'count' | 'multiplier'; min: number; max: number; step: number; default: number }>[]
}>

export type ExecutivePdfJob = Readonly<{ jobId: string; status: 'QUEUED' | 'GENERATING' | 'COMPLETED' | 'FAILED'; filename: string | null; error: string | null }>

// ────────────────────────────────────────────────────────────────────────────
// Display helpers (formatting only)
// ────────────────────────────────────────────────────────────────────────────

// Helper to check if a number is valid (not null, undefined, NaN, or Infinity)
export function isValidNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

export const EXECUTIVE_FEATURE_NAMES: Readonly<Record<string, string>> = {
  reports: 'Board reports',
  scenarios: 'Scenario planning',
  health: 'Health diagnosis',
  risk_scan: 'Risk radar scans',
  opportunities: 'Strategic opportunities',
  decisions: 'Decision log',
  roadmaps: 'Strategic roadmaps',
  benchmarks: 'Industry benchmarks',
  pdf: 'Investor PDF reports',
  exports: 'Report exports',
  white_label: 'White-label PDFs',
  monthly_email: 'Monthly email reports',
  peer_comparison: 'Peer comparisons',
  custom_sections: 'Custom report sections',
  roadmap_60: '60-day roadmaps',
  roadmap_90: '90-day roadmaps',
  roadmap_quarterly: 'Quarterly roadmaps',
  roadmap_yearly: 'Yearly roadmaps',
  real_time_health: 'Real-time health',
  real_time_risks: 'Real-time risk monitoring',
}

export function formatExecutiveMoney(value: number | null, currency: string | null, digits = 0): string {
  if (value === null || !isValidNumber(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)
}

export function formatExecutiveNumber(value: number | null, digits = 1): string {
  if (value === null || !isValidNumber(value)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
}

export function formatExecutivePct(value: number | null, digits = 0): string {
  if (value === null || !isValidNumber(value)) return '—'
  return `${value >= 0 && digits === 0 ? '' : ''}${value.toFixed(digits)}%`
}

export function executiveStatusTone(status: string): string {
  if (status === 'STRONG' || status === 'HEALTHY' || status === 'COMPLETED' || status === 'RESOLVED' || status === 'EXCELLENT' || status === 'GOOD' || status === 'PURSUING') return 'positive'
  if (status === 'AT_RISK' || status === 'MEDIUM' || status === 'FAIR' || status === 'REVIEWING' || status === 'MITIGATED' || status === 'NEEDS_ATTENTION') return 'warning'
  if (status === 'CRITICAL' || status === 'RISK' || status === 'POOR' || status === 'HIGH') return 'danger'
  return 'neutral'
}

export function executiveSeverityTone(severity: RiskSeverity): string {
  if (severity === 'CRITICAL') return 'danger'
  if (severity === 'HIGH') return 'danger'
  if (severity === 'MEDIUM') return 'warning'
  return 'positive'
}

export function executiveTimelineLabel(timeline: string): string {
  if (timeline === '30_DAYS') return '30 days'
  if (timeline === '60_DAYS') return '60 days'
  if (timeline === '90_DAYS') return '90 days'
  return 'Long term'
}

export function executiveRoadmapTypeLabel(type: RoadmapType): string {
  if (type === '30_DAY') return '30-day plan'
  if (type === '60_DAY') return '60-day plan'
  if (type === '90_DAY') return '90-day plan'
  if (type === 'QUARTERLY') return 'Quarterly plan'
  return 'Yearly plan'
}

export function executiveDateLabel(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function executiveMonthLabel(iso: string): string {
  const date = new Date(iso.length === 7 ? `${iso}-02T00:00:00Z` : iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
