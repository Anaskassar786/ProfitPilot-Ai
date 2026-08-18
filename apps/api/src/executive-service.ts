/**
 * PR #49 — AI Executive service layer.
 *
 * Orchestrates plan-gated executive features on top of the deterministic
 * engine, the repository, the benchmark ladder, and the AI narrative
 * service. Routes stay thin; the monthly report tick reuses the exact same
 * generation path as the on-demand endpoint so email output can never
 * diverge from what the merchant sees in the app.
 *
 * Plan gating rules (PR #49 feature matrix):
 * - Every countable feature is metered through `billing_usage` with the
 *   `ai_executive_*` entitlement keys (single source of truth:
 *   `PLAN_ENTITLEMENT_LIMITS`).
 * - Tier-only gates (investor PDF, white-label, monthly email, roadmap
 *   horizons, peer comparison) are asserted via
 *   `UpgradeRequiredError` → HTTP 402 UPGRADE_REQUIRED.
 * - Upgrade CTAs always say "Upgrade Plan" — the UI never names a plan.
 */
import { AppError, limitFor, PLAN_TIERS } from '@profitpilot/types'
import type { EntitlementKey, PlanTier, StoreId } from '@profitpilot/types'
import { UpgradeRequiredError } from '@profitpilot/billing'
import type { AnalyticsSnapshot, CatalogProduct } from '@profitpilot/db'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { ExecutiveAiService, ExecutiveFacts } from './executive-ai.js'
import { buildFinancialForecast } from './executive-ai.js'
import { benchmarkPercentile, decisionAccuracyScore, decisionLessons, diagnoseExecutiveHealth, detectExecutiveRisks, identifyExecutiveOpportunities, projectExecutiveScenario, qualityRatingForAccuracy } from './executive-analytics.js'
import { buildBenchmarkPosition, detectBenchmarkCategory, laddersFromRows, merchantMetricValues } from './executive-benchmarks.js'
import type {
  BenchmarkPosition,
  DecisionQuality,
  ExecutiveBenchmarkCategory,
  ExecutiveDashboard,
  ExecutiveDecision,
  ExecutiveHealthDiagnosis,
  ExecutiveOpportunity,
  ExecutivePreferences,
  ExecutiveReport,
  ExecutiveReportType,
  ExecutiveRisk,
  ExecutiveRoadmap,
  ExecutiveScenario,
  ExecutiveUsage,
  RoadmapMilestone,
  RoadmapType,
  ScenarioType,
} from './executive-model.js'
import { EXECUTIVE_FEATURE_LABELS } from './executive-model.js'
import type { ExecutiveOpportunityDraft, ExecutiveRiskDraft } from './executive-analytics.js'
import type { ExecutiveRepository } from './executive-repository.js'
import type { ExecutiveEmailDelivery } from './executive-email.js'
import type { ExecutivePdfStore } from './executive-pdf.js'
import { renderExecutiveReportPdf } from './executive-pdf.js'
import type { ExecutiveWhiteLabel } from './executive-model.js'

// ────────────────────────────────────────────────────────────────────────────
// Plan gates
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveFeature = 'reports' | 'scenarios' | 'health' | 'risk_scan' | 'opportunities' | 'decisions' | 'roadmaps' | 'benchmarks' | 'pdf' | 'exports' | 'white_label' | 'monthly_email' | 'peer_comparison' | 'custom_sections' | 'roadmap_60' | 'roadmap_90' | 'roadmap_quarterly' | 'roadmap_yearly' | 'real_time_health' | 'real_time_risks'

export const EXECUTIVE_FEATURES: readonly ExecutiveFeature[] = ['reports', 'scenarios', 'health', 'risk_scan', 'opportunities', 'decisions', 'roadmaps', 'benchmarks', 'pdf', 'exports', 'white_label', 'monthly_email', 'peer_comparison', 'custom_sections', 'roadmap_60', 'roadmap_90', 'roadmap_quarterly', 'roadmap_yearly', 'real_time_health', 'real_time_risks']

const FEATURE_ENTITLEMENTS: Readonly<Record<ExecutiveFeature, EntitlementKey | null>> = {
  reports: 'ai_executive_reports_month',
  scenarios: 'ai_executive_scenarios_month',
  health: 'ai_executive_health_month',
  risk_scan: 'ai_executive_risk_scans_month',
  opportunities: 'ai_executive_opportunities',
  decisions: 'ai_executive_decisions',
  roadmaps: 'ai_executive_roadmaps_active',
  benchmarks: 'ai_executive_benchmark_metrics',
  pdf: 'ai_executive_pdf_month',
  exports: 'ai_executive_exports_month',
  white_label: null,
  monthly_email: null,
  peer_comparison: null,
  custom_sections: null,
  roadmap_60: null,
  roadmap_90: null,
  roadmap_quarterly: null,
  roadmap_yearly: null,
  real_time_health: null,
  real_time_risks: null,
}

const FEATURE_MIN_TIER: Readonly<Record<ExecutiveFeature, PlanTier>> = {
  reports: 'start', // 1 on-demand / month
  scenarios: 'start',
  health: 'start',
  risk_scan: 'start',
  opportunities: 'trial', // 1 preview slot
  decisions: 'start',
  roadmaps: 'start',
  benchmarks: 'trial', // 3 sample metrics
  pdf: 'commander',
  exports: 'growth',
  white_label: 'commander',
  monthly_email: 'growth',
  peer_comparison: 'growth',
  custom_sections: 'commander',
  roadmap_60: 'growth',
  roadmap_90: 'growth',
  roadmap_quarterly: 'commander',
  roadmap_yearly: 'commander',
  real_time_health: 'commander',
  real_time_risks: 'commander',
}

export type ExecutiveGateDecision = Readonly<{ allowed: boolean; requiredPlan: PlanTier; used: number; limit: number | null; remaining: number | null }>

export type ExecutiveUsageMeter = Readonly<{
  current(storeId: StoreId, feature: string): Promise<number>
  add(storeId: StoreId, feature: string, count: number): Promise<void>
}>

export type ExecutiveContext = Readonly<{
  repository: ExecutiveRepository
  snapshot: (storeId: StoreId) => Promise<StoreSnapshot>
  analytics: (storeId: StoreId) => Promise<AnalyticsSnapshot>
  catalog: (storeId: StoreId) => Promise<readonly CatalogProduct[]>
  plan: (storeId: StoreId) => Promise<PlanTier>
  usage: ExecutiveUsageMeter
  ai: ExecutiveAiService
  email: ExecutiveEmailDelivery
  pdf: Readonly<{ enabled: boolean; store: ExecutivePdfStore; whiteLabel: (storeId: StoreId) => Promise<ExecutiveWhiteLabel> | ExecutiveWhiteLabel }>
  shopName: (storeId: StoreId) => Promise<string | null>
  appUrl: () => string
  recordCost: (storeId: StoreId, input: Readonly<{ model: string | null; promptTokens: number; completionTokens: number; agent: string }>) => Promise<void>
  now: () => number
}>

export function executiveGate(plan: PlanTier, feature: ExecutiveFeature, used: number): ExecutiveGateDecision {
  const requiredPlan = FEATURE_MIN_TIER[feature]
  const tierOk = PLAN_TIERS.indexOf(plan) >= PLAN_TIERS.indexOf(requiredPlan)
  const entitlementKey = FEATURE_ENTITLEMENTS[feature]
  const limit = entitlementKey ? limitFor(plan, entitlementKey) : tierOk ? null : 0
  const overLimit = limit !== null && used >= limit
  const allowed = tierOk && !overLimit && (limit === null || limit > 0)
  return { allowed, requiredPlan, used, limit, remaining: limit === null ? null : Math.max(0, limit - used) }
}

export function assertExecutiveFeature(plan: PlanTier, feature: ExecutiveFeature, used: number): ExecutiveGateDecision {
  const decision = executiveGate(plan, feature, used)
  if (!decision.allowed) {
    const entitlementKey = FEATURE_ENTITLEMENTS[feature]
    throw new UpgradeRequiredError(entitlementKey ?? `ai_executive:${feature}`, plan, decision.requiredPlan)
  }
  return decision
}

// ────────────────────────────────────────────────────────────────────────────
// Usage
// ────────────────────────────────────────────────────────────────────────────

export async function executiveUsage(context: ExecutiveContext, storeId: StoreId): Promise<ExecutiveUsage> {
  const plan = await context.plan(storeId)
  const features = await Promise.all(
    EXECUTIVE_FEATURES.map(async (feature) => {
      const entitlementKey = FEATURE_ENTITLEMENTS[feature]
      const used = entitlementKey ? await context.usage.current(storeId, entitlementKey) : 0
      const decision = executiveGate(plan, feature, used)
      return {
        feature,
        label: entitlementKey ? (EXECUTIVE_FEATURE_LABELS[entitlementKey] ?? feature) : feature.replaceAll('_', ' '),
        used,
        limit: decision.limit,
        remaining: decision.remaining,
        percent: decision.limit === null ? 0 : decision.limit === 0 ? 100 : Math.min(100, Math.round((used / decision.limit) * 100)),
      }
    }),
  )
  return { plan, features }
}

/** All feature gates for the dashboard's lock rendering. */
export async function executiveGates(context: ExecutiveContext, storeId: StoreId): Promise<Readonly<Record<string, ExecutiveGateDecision>>> {
  const plan = await context.plan(storeId)
  const entries: Array<readonly [string, ExecutiveGateDecision]> = []
  for (const feature of EXECUTIVE_FEATURES) {
    const entitlementKey = FEATURE_ENTITLEMENTS[feature]
    const used = entitlementKey ? await context.usage.current(storeId, entitlementKey) : 0
    entries.push([feature, executiveGate(plan, feature, used)])
  }
  return Object.fromEntries(entries)
}

// ────────────────────────────────────────────────────────────────────────────
// Fact building (shared by reports, PDF, and email)
// ────────────────────────────────────────────────────────────────────────────

export async function buildExecutiveFacts(context: ExecutiveContext, storeId: StoreId, benchmarkCategory: ExecutiveBenchmarkCategory): Promise<Readonly<{ facts: ExecutiveFacts; snapshot: StoreSnapshot; analytics: AnalyticsSnapshot; catalog: readonly CatalogProduct[] }>> {
  const [snapshot, analytics, catalog, shopName] = await Promise.all([context.snapshot(storeId), context.analytics(storeId), context.catalog(storeId), context.shopName(storeId)])
  const health = diagnoseExecutiveHealth(snapshot, analytics, context.now())
  const risks = detectExecutiveRisks(snapshot, analytics, context.now())
  const opportunities = identifyExecutiveOpportunities(snapshot, analytics, context.now())
  const ladders = laddersFromRows(await context.repository.benchmarkRows(benchmarkCategory))
  const merchantValues = merchantMetricValues(snapshot, analytics, catalog)
  const position = buildBenchmarkPosition({ storeId, category: benchmarkCategory, categorySource: 'PREFERENCE', ladders, merchantValues, visibleMetrics: ladders.length })
  const revenuePosition = position.positions.find((entry) => entry.metric === 'REVENUE') ?? null
  const aovPosition = position.positions.find((entry) => entry.metric === 'AOV') ?? null
  const last30Revenue = Math.max(snapshot.last30dRevenue, 0)
  const previous30Revenue = Math.max(snapshot.previous30dRevenue, 0)
  const revenueGrowthPct = previous30Revenue > 0 ? ((last30Revenue / previous30Revenue) - 1) * 100 : 0
  const ordersGrowthPct = snapshot.previous30dOrders > 0 ? ((snapshot.last30dOrders / snapshot.previous30dOrders) - 1) * 100 : 0
  const aov = snapshot.last30dOrders > 0 ? last30Revenue / snapshot.last30dOrders : 0
  const repeatRatePct = snapshot.customers.length > 0 ? (snapshot.customers.filter((customer) => customer.orderCount >= 2).length / snapshot.customers.length) * 100 : 0
  const cancellationPct = analytics.orders.length > 0 ? (analytics.orders.reduce((sum, row) => sum + row.cancelledCount, 0) / Math.max(analytics.orders.reduce((sum, row) => sum + row.fulfilledCount + row.cancelledCount, 0), 1)) * 100 : 0
  const inventoryValue = snapshot.products.reduce((sum, product) => sum + product.inventoryUnits * (product.unitCost ?? product.unitPrice), 0)
  const turnoverVital = health.vitals.find((vital) => vital.key === 'inventory_turnover') ?? null
  const productRevenue = new Map<string, number>()
  for (const row of analytics.productSales) productRevenue.set(row.productId, (productRevenue.get(row.productId) ?? 0) + row.grossRevenue)
  const totalProductRevenue = [...productRevenue.values()].reduce((sum, value) => sum + value, 0)
  const topProducts = [...productRevenue.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([productId, revenue]) => {
      const product = snapshot.products.find((entry) => entry.productId === productId)
      return { title: product?.title ?? productId, revenue120d: revenue, sharePct: totalProductRevenue > 0 ? (revenue / totalProductRevenue) * 100 : 0 }
    })
  const facts: ExecutiveFacts = {
    storeName: shopName ?? 'Your store',
    currency: snapshot.currency,
    asOf: new Date(context.now()).toISOString().slice(0, 10),
    last30dRevenue: last30Revenue,
    previous30dRevenue: previous30Revenue,
    revenueGrowthPct,
    last30dOrders: snapshot.last30dOrders,
    previous30dOrders: snapshot.previous30dOrders,
    ordersGrowthPct,
    aov,
    repeatRatePct,
    customerCount: snapshot.customers.length,
    inventoryValue,
    inventoryTurnover: turnoverVital?.value ?? null,
    cancellationPct,
    topProducts,
    healthScore: health.overallScore,
    healthStatus: health.overallStatus,
    vitals: health.vitals.map((vital) => ({ label: vital.label, status: vital.status, value: vital.value })),
    risks: risks.map((risk) => ({ title: risk.title, severity: risk.severity, impactIfRealized: risk.impactIfRealized })),
    opportunities: opportunities.map((opportunity) => ({ title: opportunity.title, estimatedImpactAnnual: opportunity.estimatedImpactAnnual })),
    benchmarkCategory,
    revenuePercentile: revenuePosition?.percentile ?? null,
    aovPercentile: aovPosition?.percentile ?? null,
  }
  return { facts, snapshot, analytics, catalog }
}

// ────────────────────────────────────────────────────────────────────────────
// Board report generation
// ────────────────────────────────────────────────────────────────────────────

export async function generateBoardReport(context: ExecutiveContext, storeId: StoreId, input: Readonly<{ reportType: ExecutiveReportType; periodStart: string; periodEnd: string; language: 'en' | 'hi' }>): Promise<ExecutiveReport> {
  const plan = await context.plan(storeId)
  const used = await context.usage.current(storeId, 'ai_executive_reports_month')
  assertExecutiveFeature(plan, 'reports', used)
  const preferences = await context.repository.getPreferences(storeId)
  const { facts } = await buildExecutiveFacts(context, storeId, preferences.benchmarkCategory)
  const sections = await context.ai.generateBoardReport(facts, input.language)
  const forecast = sections.financialForecast ?? buildFinancialForecast(facts)
  const appendix = {
    ...sections.appendix,
    risks: Object.fromEntries(facts.risks.map((risk) => [risk.title, `${risk.severity} · impact ${facts.currency} ${Math.round(risk.impactIfRealized).toLocaleString('en-US')}`])),
    opportunities: Object.fromEntries(facts.opportunities.map((opportunity) => [opportunity.title, `${facts.currency} ${Math.round(opportunity.estimatedImpactAnnual).toLocaleString('en-US')}/yr`])),
  }
  const report = await context.repository.createReport(storeId, {
    reportType: input.reportType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    executiveSummary: sections.executiveSummary,
    content: {
      strategicPosition: sections.strategicPosition,
      keyInsights: sections.keyInsights,
      recommendedDecisions: sections.recommendedDecisions,
      financialForecast: forecast,
      appendix,
      aiNarrativeAvailable: sections.aiNarrativeAvailable,
      generatedWithModel: sections.generatedWithModel,
    },
  })
  await context.usage.add(storeId, 'ai_executive_reports_month', 1)
  return report
}

// ────────────────────────────────────────────────────────────────────────────
// Health diagnosis
// ────────────────────────────────────────────────────────────────────────────

export async function runHealthDiagnosis(context: ExecutiveContext, storeId: StoreId): Promise<ExecutiveHealthDiagnosis> {
  const plan = await context.plan(storeId)
  const used = await context.usage.current(storeId, 'ai_executive_health_month')
  assertExecutiveFeature(plan, 'health', used)
  const [snapshot, analytics] = await Promise.all([context.snapshot(storeId), context.analytics(storeId)])
  const computation = diagnoseExecutiveHealth(snapshot, analytics, context.now())
  const nextDue = new Date(context.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const diagnosis = await context.repository.saveDiagnosis(storeId, {
    overallScore: computation.overallScore,
    overallStatus: computation.overallStatus,
    vitalSigns: computation.vitals,
    conditions: computation.conditions,
    prescriptions: computation.prescriptions,
    diagnosedAt: new Date(context.now()).toISOString(),
    nextDiagnosisDue: nextDue,
  })
  await context.usage.add(storeId, 'ai_executive_health_month', 1)
  return diagnosis
}

// ────────────────────────────────────────────────────────────────────────────
// Risk scans
// ────────────────────────────────────────────────────────────────────────────

export async function runRiskScan(context: ExecutiveContext, storeId: StoreId): Promise<readonly ExecutiveRisk[]> {
  const plan = await context.plan(storeId)
  const used = await context.usage.current(storeId, 'ai_executive_risk_scans_month')
  assertExecutiveFeature(plan, 'risk_scan', used)
  const [snapshot, analytics] = await Promise.all([context.snapshot(storeId), context.analytics(storeId)])
  const drafts: readonly ExecutiveRiskDraft[] = detectExecutiveRisks(snapshot, analytics, context.now())
  const risks = await context.repository.applyRiskScan(storeId, drafts)
  await context.usage.add(storeId, 'ai_executive_risk_scans_month', 1)
  return risks
}

// ────────────────────────────────────────────────────────────────────────────
// Opportunities
// ────────────────────────────────────────────────────────────────────────────

export async function regenerateOpportunities(context: ExecutiveContext, storeId: StoreId): Promise<readonly ExecutiveOpportunity[]> {
  const plan = await context.plan(storeId)
  const used = await context.usage.current(storeId, 'ai_executive_opportunities')
  assertExecutiveFeature(plan, 'opportunities', used)
  const [snapshot, analytics] = await Promise.all([context.snapshot(storeId), context.analytics(storeId)])
  const drafts: readonly ExecutiveOpportunityDraft[] = identifyExecutiveOpportunities(snapshot, analytics, context.now())
  return context.repository.replaceActiveOpportunities(storeId, drafts)
}

// ────────────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────────────

export async function runScenario(context: ExecutiveContext, storeId: StoreId, input: Readonly<{ scenarioType: ScenarioType; title: string; description: string; inputs: Readonly<Record<string, number | string | boolean>> }>): Promise<ExecutiveScenario> {
  const plan = await context.plan(storeId)
  const used = await context.usage.current(storeId, 'ai_executive_scenarios_month')
  assertExecutiveFeature(plan, 'scenarios', used)
  const [snapshot, analytics] = await Promise.all([context.snapshot(storeId), context.analytics(storeId)])
  const numericInputs: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(input.inputs).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
  const result = projectExecutiveScenario(snapshot, analytics, input.scenarioType, numericInputs)
  const narrative = await context.ai.generateScenarioNarrative({
    scenarioType: input.scenarioType,
    title: input.title,
    recommendation: result.recommendation,
    predictions: { ...result.predictions, currency: snapshot.currency },
    currency: snapshot.currency,
  })
  const scenario = await context.repository.createScenario(storeId, {
    scenarioType: input.scenarioType,
    title: input.title,
    description: input.description,
    inputs: numericInputs,
    predictions: { ...result.predictions, narrative, currency: snapshot.currency },
    confidence: result.confidence,
    riskLevel: result.riskLevel,
    recommendation: result.recommendation,
    narrative,
  })
  await context.usage.add(storeId, 'ai_executive_scenarios_month', 1)
  return scenario
}

// ────────────────────────────────────────────────────────────────────────────
// Decisions
// ────────────────────────────────────────────────────────────────────────────

export async function logDecision(context: ExecutiveContext, storeId: StoreId, input: Readonly<{ decisionType: ExecutiveDecision['decisionType']; title: string; description: string; decisionDate: string; predictedOutcome: Readonly<Record<string, number | string>> | null; actualOutcome: Readonly<Record<string, number | string>> | null; createdBy: string }>): Promise<ExecutiveDecision> {
  const plan = await context.plan(storeId)
  const used = await context.usage.current(storeId, 'ai_executive_decisions')
  assertExecutiveFeature(plan, 'decisions', used)
  const decision = await context.repository.createDecision(storeId, input)
  await context.usage.add(storeId, 'ai_executive_decisions', 1)
  return decision
}

export async function reviewDecision(context: ExecutiveContext, storeId: StoreId, id: string, actualOutcome: Readonly<Record<string, number | string>>): Promise<ExecutiveDecision | null> {
  const decision = await context.repository.getDecision(storeId, id)
  if (!decision) return null
  const accuracy = decision.predictedOutcome ? decisionAccuracyScore(decision.predictedOutcome, actualOutcome) : null
  const rating: DecisionQuality = accuracy === null ? 'PENDING' : qualityRatingForAccuracy(accuracy)
  const lessons = decision.predictedOutcome && accuracy !== null
    ? await context.ai.generateDecisionLessons(decision.predictedOutcome, actualOutcome, accuracy)
    : ''
  const patch = {
    actualOutcome,
    title: decision.title,
    description: decision.description,
    ...(decision.predictedOutcome ? { predictedOutcome: decision.predictedOutcome } : {}),
  }
  const reviewed = await context.repository.updateDecision(storeId, id, patch)
  if (!reviewed) return null
  return { ...reviewed, qualityRating: rating, accuracyScore: accuracy ?? reviewed.accuracyScore, lessonsLearned: lessons || (decision.predictedOutcome && accuracy !== null ? decisionLessons(decision.predictedOutcome, actualOutcome, accuracy) : reviewed.lessonsLearned) }
}

export function decisionAnalyticsFromRows(rows: readonly ExecutiveDecision[]): Readonly<{ total: number; reviewed: number; averageAccuracy: number | null; qualityDistribution: Readonly<Record<DecisionQuality, number>>; bestDecisions: readonly ExecutiveDecision[]; improvementAreas: readonly string[] }> {
  const reviewed = rows.filter((decision) => decision.accuracyScore !== null)
  const averageAccuracy = reviewed.length > 0 ? reviewed.reduce((sum, decision) => sum + (decision.accuracyScore ?? 0), 0) / reviewed.length : null
  const qualityDistribution: Record<DecisionQuality, number> = { EXCELLENT: 0, GOOD: 0, FAIR: 0, POOR: 0, PENDING: 0 }
  for (const decision of rows) qualityDistribution[decision.qualityRating] += 1
  const bestDecisions = [...reviewed].sort((left, right) => (right.accuracyScore ?? 0) - (left.accuracyScore ?? 0)).slice(0, 3)
  const improvementAreas: string[] = []
  if (reviewed.length >= 3 && (averageAccuracy ?? 0) < 0.7) improvementAreas.push('Forecast accuracy is below 70% — recalibrate the assumptions behind your largest-miss decisions.')
  const weakKeys = new Map<string, number>()
  for (const decision of reviewed) {
    if (!decision.predictedOutcome || !decision.actualOutcome) continue
    for (const key of Object.keys(decision.predictedOutcome)) {
      if (typeof decision.predictedOutcome[key] === 'number' && typeof decision.actualOutcome[key] === 'number') {
        const gap = Math.abs(Number(decision.actualOutcome[key]) - Number(decision.predictedOutcome[key])) / Math.max(Math.abs(Number(decision.predictedOutcome[key])), 1)
        weakKeys.set(key, (weakKeys.get(key) ?? 0) + gap)
      }
    }
  }
  const topWeak = [...weakKeys.entries()].sort((left, right) => right[1] - left[1]).slice(0, 2)
  for (const [key] of topWeak) improvementAreas.push(`Metric "${key}" carries the largest forecast error — review how it is estimated.`)
  if (improvementAreas.length === 0) improvementAreas.push('No improvement patterns detected yet — keep logging decisions with numeric outcomes.')
  return { total: rows.length, reviewed: reviewed.length, averageAccuracy, qualityDistribution, bestDecisions, improvementAreas }
}

// ────────────────────────────────────────────────────────────────────────────
// Roadmaps
// ────────────────────────────────────────────────────────────────────────────

const ROADMAP_FEATURE: Readonly<Record<RoadmapType, ExecutiveFeature>> = {
  '30_DAY': 'roadmaps',
  '60_DAY': 'roadmap_60',
  '90_DAY': 'roadmap_90',
  QUARTERLY: 'roadmap_quarterly',
  YEARLY: 'roadmap_yearly',
}

export async function generateRoadmap(context: ExecutiveContext, storeId: StoreId, input: Readonly<{ roadmapType: RoadmapType; periodStart: string; periodEnd: string; goal: string | null }>): Promise<ExecutiveRoadmap> {
  const plan = await context.plan(storeId)
  const feature = ROADMAP_FEATURE[input.roadmapType]
  const active = await context.repository.countActiveRoadmaps(storeId)
  assertExecutiveFeature(plan, feature, feature === 'roadmaps' ? active : 0)
  const preferences = await context.repository.getPreferences(storeId)
  const { facts } = await buildExecutiveFacts(context, storeId, preferences.benchmarkCategory)
  const opportunities = (await context.repository.listOpportunities(storeId)).slice(0, 3)
  const risks = (await context.repository.listRisks(storeId)).filter((risk) => risk.status === 'ACTIVE').slice(0, 3)
  const planOutput = await context.ai.generateRoadmapPlan({ roadmapType: input.roadmapType, facts, opportunities, risks, goal: input.goal })
  return context.repository.createRoadmap(storeId, {
    roadmapType: input.roadmapType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    title: planOutput.title,
    milestones: planOutput.milestones,
    expectedOutcomes: planOutput.expectedOutcomes,
    confidenceScore: planOutput.confidenceScore,
  })
}

export async function markRoadmapMilestone(context: ExecutiveContext, storeId: StoreId, id: string, milestoneKey: string): Promise<ExecutiveRoadmap | null> {
  const roadmap = await context.repository.getRoadmap(storeId, id)
  if (!roadmap) return null
  const milestones: readonly RoadmapMilestone[] = roadmap.milestones.map((milestone) => (milestone.key === milestoneKey ? { ...milestone, status: 'COMPLETE' as const } : milestone))
  const updated = await context.repository.updateRoadmap(storeId, id, { milestones })
  if (!updated) return null
  if (updated.milestones.every((milestone) => milestone.status === 'COMPLETE')) {
    return context.repository.updateRoadmap(storeId, id, { status: 'COMPLETED' })
  }
  return updated
}

// ────────────────────────────────────────────────────────────────────────────
// PDF generation (Commander)
// ────────────────────────────────────────────────────────────────────────────

export async function generateReportPdf(context: ExecutiveContext, storeId: StoreId, reportId: string, whiteLabelOverride?: ExecutiveWhiteLabel): Promise<Readonly<{ pdfKey: string; filename: string; bytes: number }>> {
  const plan = await context.plan(storeId)
  assertExecutiveFeature(plan, 'pdf', 0)
  if (!context.pdf.enabled) throw new AppError('DEPENDENCY_ERROR', 'Investor PDF generation is not enabled', 503)
  const report = await context.repository.getReport(storeId, reportId)
  if (!report) throw new AppError('NOT_FOUND', 'Board report not found', 404, { id: reportId })
  const preferences = await context.repository.getPreferences(storeId)
  const { facts, analytics } = await buildExecutiveFacts(context, storeId, preferences.benchmarkCategory)
  const defaultWhiteLabel = await context.pdf.whiteLabel(storeId)
  const whiteLabel = whiteLabelOverride ?? defaultWhiteLabel
  const revenueDays = analytics.revenue.slice(-30).map((row) => row.grossRevenue)
  const pdf = renderExecutiveReportPdf({
    report,
    storeName: facts.storeName,
    currency: facts.currency,
    revenueSeries: revenueDays,
    healthScore: facts.healthScore,
    healthStatus: facts.healthStatus,
    benchmarkCategory: facts.benchmarkCategory,
    revenuePercentile: facts.revenuePercentile,
    aovPercentile: facts.aovPercentile,
    topProducts: facts.topProducts.map((product) => ({ title: product.title, revenue: product.revenue120d, sharePct: product.sharePct })),
    whiteLabel,
  })
  const pdfKey = `${storeId}:${reportId}`
  await context.pdf.store.put(pdfKey, pdf)
  await context.repository.setReportPdfUrl(storeId, reportId, `/ai-executive/reports/${reportId}/pdf/download`)
  return { pdfKey, filename: `board-report-${report.periodStart}-${report.reportType.toLowerCase()}.pdf`, bytes: pdf.length }
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard rollup
// ────────────────────────────────────────────────────────────────────────────

export async function executiveDashboard(context: ExecutiveContext, storeId: StoreId): Promise<ExecutiveDashboard> {
  const [plan, preferences, latestReport, latestDiagnosis, opportunities, risks, scenarios, roadmaps, decisions] = await Promise.all([
    context.plan(storeId),
    context.repository.getPreferences(storeId),
    context.repository.latestReport(storeId),
    context.repository.latestDiagnosis(storeId),
    context.repository.listOpportunities(storeId),
    context.repository.listRisks(storeId),
    context.repository.listScenarios(storeId, 3),
    context.repository.listRoadmaps(storeId),
    context.repository.listDecisions(storeId, 3),
  ])
  const usage = await executiveUsage(context, storeId)
  const gates = await executiveGates(context, storeId)
  const ladders = laddersFromRows(await context.repository.benchmarkRows(preferences.benchmarkCategory))
  const { snapshot, analytics, catalog } = await buildExecutiveFacts(context, storeId, preferences.benchmarkCategory)
  const detected = detectBenchmarkCategory(catalog)
  const category = preferences.benchmarkCategory !== 'Other' ? preferences.benchmarkCategory : detected ?? 'Other'
  const categorySource = preferences.benchmarkCategory !== 'Other' ? 'PREFERENCE' as const : detected !== null ? 'AUTO_DETECTED' as const : 'DEFAULT' as const
  const visibleMetrics = gates.benchmarks?.limit ?? 3
  const position = buildBenchmarkPosition({ storeId, category, categorySource, ladders, merchantValues: merchantMetricValues(snapshot, analytics, catalog), visibleMetrics })
  const activeRoadmap = roadmaps.find((roadmap) => roadmap.status === 'ACTIVE') ?? null
  const now = context.now()
  const day = preferences.reportGenerationDay
  const nextReportDue = computeNextReportDue(now, day)
  // Real daily series for the executive charts (never synthesized).
  const revenueSeries = analytics.revenue.slice(-60).map((row) => ({ day: row.day, value: row.grossRevenue }))
  const ordersSeries = analytics.orders.slice(-60).map((row) => ({ day: row.day, value: row.orderCount }))
  return {
    storeId,
    plan,
    currency: snapshot.currency,
    health: latestDiagnosis,
    latestReport,
    nextReportDue,
    benchmarkPosition: position,
    opportunities: opportunities.slice(0, 3),
    risks: risks.filter((risk) => risk.status === 'ACTIVE'),
    scenarios,
    roadmap: activeRoadmap,
    decisions,
    usage,
    gates,
    revenueSeries,
    ordersSeries,
    generatedAt: new Date(now).toISOString(),
  }
}

export function computeNextReportDue(now: number, generationDay: number): string {
  const date = new Date(now)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const candidate = new Date(Date.UTC(year, month, generationDay))
  const target = candidate.getTime() > now ? candidate : new Date(Date.UTC(year, month + 1, generationDay))
  return target.toISOString().slice(0, 10)
}

// ────────────────────────────────────────────────────────────────────────────
// Monthly report tick
// ────────────────────────────────────────────────────────────────────────────

export type MonthlyTickResult = Readonly<{ scanned: number; due: number; generated: number; emailed: number; skippedNoEmail: number; failed: number }>

/** Generates and emails monthly board reports for stores whose day has arrived. */
export async function runMonthlyReportTick(context: ExecutiveContext, logger: Readonly<{ info(message: string, meta?: Readonly<Record<string, unknown>>): void; error(message: string, meta?: Readonly<Record<string, unknown>>): void }>): Promise<MonthlyTickResult> {
  const now = new Date(context.now())
  const day = now.getUTCDate()
  const monthStart = now.toISOString().slice(0, 7) + '-01'
  const dueStores = await context.repository.storesDueForMonthlyReport(day, monthStart)
  let generated = 0
  let emailed = 0
  let skippedNoEmail = 0
  let failed = 0
  for (const storeId of dueStores) {
    try {
      const plan = await context.plan(storeId)
      if (plan !== 'growth' && plan !== 'commander') continue
      const preferences = await context.repository.getPreferences(storeId)
      const periodStart = monthStart
      const periodEnd = now.toISOString().slice(0, 10)
      const report = await generateBoardReport(context, storeId, { reportType: 'MONTHLY', periodStart, periodEnd, language: preferences.language })
      generated += 1
      const recipient = preferences.reportEmail
      if (!preferences.monthlyReportEmailEnabled || !recipient || !context.email.available) {
        if (!recipient) skippedNoEmail += 1
        continue
      }
      try {
        const includePdf = plan === 'commander' && context.pdf.enabled
        let pdfBuffer: Buffer | null = null
        if (includePdf) {
          const pdfResult = await generateReportPdf(context, storeId, report.id)
          pdfBuffer = await context.pdf.store.get(pdfResult.pdfKey)
        }
        const { facts } = await buildExecutiveFacts(context, storeId, preferences.benchmarkCategory)
        await context.email.send(recipient, {
          report,
          facts,
          appUrl: `${context.appUrl()}/?storeId=${encodeURIComponent(storeId)}#/ai-growth-command/executive/reports`,
          unsubscribeUrl: `${context.appUrl()}/?storeId=${encodeURIComponent(storeId)}#/ai-growth-command/executive/settings`,
          includePdf,
          pdfBuffer,
        })
        emailed += 1
      } catch (error: unknown) {
        failed += 1
        logger.error('AI Executive monthly report email failed', { storeId, error: error instanceof Error ? error.message : String(error) })
      }
    } catch (error: unknown) {
      failed += 1
      logger.error('AI Executive monthly report generation failed', { storeId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { scanned: dueStores.length, due: dueStores.length, generated, emailed, skippedNoEmail, failed }
}

/** Percentile convenience re-export for benchmarks route. */
export { benchmarkPercentile }
