/**
 * GrowthIQ (formerly "AI Executive") — API router.
 *
 * All boardroom-grade endpoints behind plan gating (402 UPGRADE_REQUIRED
 * with upgrade context), a per-store rate limit (default 20 req/min,
 * configurable), tenant isolation via the existing session middleware, and
 * the standard `{ ok, data, requestId }` response envelope.
 *
 * Fixed paths are registered before `/:id` paths so a resource name is
 * never parsed as an identifier.
 *
 * The `/ai-executive/*` path namespace is intentionally unchanged: it is
 * the stable backend contract (tables, webhooks, and shared links already
 * use it). The GrowthIQ rebrand is a UI- and copy-level rename.
 */
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import {
  assertExecutiveFeature,
  buildExecutiveFacts,
  decisionAnalyticsFromRows,
  executiveDashboard,
  executiveGates,
  executiveUsage,
  generateBoardReport,
  generateReportPdf,
  generateRoadmap,
  logDecision,
  markRoadmapMilestone,
  regenerateOpportunities,
  reviewDecision,
  runHealthDiagnosis,
  runRiskScan,
  runScenario,
} from './executive-service.js'
import { benchmarkPercentile } from './executive-analytics.js'
import { BENCHMARK_METRIC_LABELS, buildBenchmarkPosition, detectBenchmarkCategory, isBenchmarkCategory, laddersFromRows, merchantMetricValues } from './executive-benchmarks.js'
import type { ExecutiveContext } from './executive-service.js'
import type {
  DecisionType,
  ExecutiveBenchmarkMetric,
  ExecutiveDecision,
  OpportunityStatus,
  ExecutivePdfJob,
  ExecutiveReportType,
  ExecutiveRisk,
  ExecutiveWhiteLabel,
  RoadmapType,
  ScenarioType,
} from './executive-model.js'
import { EXECUTIVE_BENCHMARK_METRICS } from './executive-model.js'
import type { ExecutivePreferences } from './executive-model.js'

export type ExecutiveRouteDependencies = ExecutiveContext &
  Readonly<{
    rateLimitPerStore?: number
    costSummary?: (storeId: StoreId) => Promise<Readonly<{ summary: Readonly<{ day: string; microDollars: number; capMicroDollars: number; calls: number }>; executiveCalls: number; models: readonly string[]; budgetUsd: number }>>
  }>

/** Sliding-window per-store rate limiter (AI generation endpoints). */
export class PerStoreRateLimiter {
  private readonly buckets = new Map<string, number[]>()
  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isFinite(limit) || limit < 1) throw new RangeError('Rate limit must be positive')
  }
  public check(key: string, now = Date.now()): Readonly<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
    const existing = this.buckets.get(key) ?? []
    const active = existing.filter((timestamp) => timestamp > now - this.windowMs)
    if (active.length >= this.limit) {
      this.buckets.set(key, active)
      const first = active[0] ?? now
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, first + this.windowMs - now) }
    }
    active.push(now)
    this.buckets.set(key, active)
    return { allowed: true, remaining: this.limit - active.length, retryAfterMs: 0 }
  }
  public reset(): void { this.buckets.clear() }
}

const SCENARIO_TEMPLATES = [
  { id: 'pricing', scenarioType: 'PRICING', title: 'Price change impact', description: 'Model a price increase or decrease across the catalog with the store’s own demand baseline.', inputs: [{ key: 'priceChangePct', label: 'Price change', unit: 'percent', min: -50, max: 100, step: 1, default: 5 }] },
  { id: 'product', scenarioType: 'PRODUCT', title: 'New product launch', description: 'Project revenue for new products at the store’s measured per-product performance.', inputs: [{ key: 'newProducts', label: 'New products', unit: 'count', min: 1, max: 20, step: 1, default: 1 }] },
  { id: 'marketing', scenarioType: 'MARKETING', title: 'Marketing spend change', description: 'Model a change in monthly marketing spend against an assumed blended return.', inputs: [{ key: 'spendChangeMonthly', label: 'Monthly spend change', unit: 'currency', min: 0, max: 100_000, step: 100, default: 500 }, { key: 'expectedRoas', label: 'Assumed ROAS', unit: 'multiplier', min: 0.5, max: 10, step: 0.5, default: 3 }] },
  { id: 'inventory', scenarioType: 'INVENTORY', title: 'Inventory position change', description: 'Model more or less stock against days-of-cover and stockout probability.', inputs: [{ key: 'stockChangePct', label: 'Stock change', unit: 'percent', min: -90, max: 200, step: 5, default: 20 }] },
  { id: 'custom', scenarioType: 'CUSTOM', title: 'Growth target', description: 'Compounds an annual growth target monthly from the current run rate.', inputs: [{ key: 'annualRevenueGrowthPct', label: 'Annual growth target', unit: 'percent', min: -50, max: 300, step: 5, default: 20 }, { key: 'months', label: 'Horizon (months)', unit: 'count', min: 1, max: 24, step: 1, default: 12 }] },
] as const

export function createExecutiveRouter(dependencies: ExecutiveRouteDependencies): Router {
  const router = Router()
  const limiter = new PerStoreRateLimiter(dependencies.rateLimitPerStore ?? 20, 60_000)
  const pdfJobs = new Map<string, ExecutivePdfJob>()

  const limited = (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) => async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const tenant = queryStoreId(request)
      const decision = limiter.check(tenant)
      if (!decision.allowed) throw new AppError('RATE_LIMITED', `GrowthIQ rate limit reached (${dependencies.rateLimitPerStore ?? 20} requests per minute).`, 429, { retryAfterMs: decision.retryAfterMs, storeId: tenant })
      await handler(request, response, next)
    } catch (error: unknown) { next(error) }
  }

  const run = (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) => async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try { await handler(request, response, next) } catch (error: unknown) { next(error) }
  }

  // ── Dashboard & usage ────────────────────────────────────────────────────
  router.get('/ai-executive/dashboard', run(async (request, response) => {
    const tenant = queryStoreId(request)
    response.status(200).json(success(await executiveDashboard(dependencies, tenant), requestIdFrom(request)))
  }))

  router.get('/ai-executive/usage', run(async (request, response) => {
    const tenant = queryStoreId(request)
    response.status(200).json(success(await executiveUsage(dependencies, tenant), requestIdFrom(request)))
  }))

  router.get('/ai-executive/cost-summary', run(async (request, response) => {
    const tenant = queryStoreId(request)
    if (!dependencies.costSummary) throw new AppError('DEPENDENCY_ERROR', 'Cost summary is not configured', 503)
    response.status(200).json(success(await dependencies.costSummary(tenant), requestIdFrom(request)))
  }))

  // ── Board reports ────────────────────────────────────────────────────────
  router.get('/ai-executive/reports', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const type = optionalStringParam(request, 'type')
    const limit = Math.min(numberParam(request, 'limit') ?? 12, 100)
    const reports = await dependencies.repository.listReports(tenant, limit)
    const filtered = type ? reports.filter((report) => report.reportType === type) : reports
    response.status(200).json(success(filtered, requestIdFrom(request)))
  }))

  router.post('/ai-executive/reports/generate', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const plan = await dependencies.plan(tenant)
    assertExecutiveFeature(plan, 'reports', await dependencies.usage.current(tenant, 'ai_executive_reports_month'))
    const reportType = parseReportType(body.reportType)
    const now = dependencies.now()
    const periodStart = typeof body.periodStart === 'string' && body.periodStart ? body.periodStart : new Date(now - 30 * 86_400_000).toISOString().slice(0, 10)
    const periodEnd = typeof body.periodEnd === 'string' && body.periodEnd ? body.periodEnd : new Date(now).toISOString().slice(0, 10)
    const preferences = await dependencies.repository.getPreferences(tenant)
    const report = await generateBoardReport(dependencies, tenant, { reportType, periodStart, periodEnd, language: preferences.language })
    response.status(201).json(success(report, requestIdFrom(request)))
  }))

  router.get('/ai-executive/reports/:id', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const report = await dependencies.repository.getReport(tenant, paramId(request))
    if (!report) throw new AppError('NOT_FOUND', 'Board report not found', 404, { id: paramId(request) })
    response.status(200).json(success(report, requestIdFrom(request)))
  }))

  router.post('/ai-executive/reports/:id/mark-viewed', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const report = await dependencies.repository.markReportViewed(tenant, paramId(request))
    if (!report) throw new AppError('NOT_FOUND', 'Board report not found', 404, { id: paramId(request) })
    response.status(200).json(success(report, requestIdFrom(request)))
  }))

  router.post('/ai-executive/reports/:id/pdf', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const id = paramId(request)
    const plan = await dependencies.plan(tenant)
    assertExecutiveFeature(plan, 'pdf', 0)
    const body = recordBody(request)
    const whiteLabel = parseWhiteLabel(body.whiteLabel)
    const jobId = randomUUID()
    pdfJobs.set(`${tenant}:${jobId}`, { jobId, storeId: tenant, reportId: id, status: 'QUEUED', filename: null, error: null, createdAt: new Date(dependencies.now()).toISOString(), completedAt: null })
    void generateReportPdf(dependencies, tenant, id, whiteLabel ?? undefined)
      .then((result) => {
        const job = pdfJobs.get(`${tenant}:${jobId}`)
        if (job) pdfJobs.set(`${tenant}:${jobId}`, { ...job, status: 'COMPLETED', filename: result.filename, completedAt: new Date(dependencies.now()).toISOString() })
        void dependencies.pdf.store.sweep(30 * 86_400_000, dependencies.now()).catch(() => undefined)
      })
      .catch((error: unknown) => {
        const job = pdfJobs.get(`${tenant}:${jobId}`)
        if (job) pdfJobs.set(`${tenant}:${jobId}`, { ...job, status: 'FAILED', error: error instanceof Error ? error.message : 'PDF generation failed', completedAt: new Date(dependencies.now()).toISOString() })
      })
    response.status(202).json(success({ jobId, status: 'QUEUED' }, requestIdFrom(request)))
  }))

  router.get('/ai-executive/reports/:id/pdf/status', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const jobId = requiredStringParam(request, 'jobId')
    const job = pdfJobs.get(`${tenant}:${jobId}`)
    if (!job) throw new AppError('NOT_FOUND', 'PDF job not found', 404, { jobId })
    response.status(200).json(success(job, requestIdFrom(request)))
  }))

  router.get('/ai-executive/reports/:id/pdf/download', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const id = paramId(request)
    const plan = await dependencies.plan(tenant)
    assertExecutiveFeature(plan, 'pdf', 0)
    const pdf = await dependencies.pdf.store.get(`${tenant}:${id}`)
    if (!pdf) throw new AppError('NOT_FOUND', 'No generated PDF for this report yet', 404, { id })
    response.status(200)
    response.setHeader('content-type', 'application/pdf')
    response.setHeader('content-disposition', `attachment; filename="board-report-${id}.pdf"`)
    response.setHeader('cache-control', 'private, max-age=300')
    response.end(pdf)
  }))

  router.post('/ai-executive/reports/:id/email', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const id = paramId(request)
    const plan = await dependencies.plan(tenant)
    if (plan !== 'growth' && plan !== 'commander') {
      assertExecutiveFeature(plan, 'monthly_email', 0)
    }
    if (!dependencies.email.available) throw new AppError('DEPENDENCY_ERROR', 'Email delivery is not configured', 503)
    const report = await dependencies.repository.getReport(tenant, id)
    if (!report) throw new AppError('NOT_FOUND', 'Board report not found', 404, { id })
    const body = recordBody(request)
    const preferences = await dependencies.repository.getPreferences(tenant)
    const recipient = typeof body.email === 'string' && /^\S+@\S+\.\S+$/.test(body.email) ? body.email : preferences.reportEmail
    if (!recipient) throw new AppError('VALIDATION_ERROR', 'A recipient email is required (save one in Executive settings or pass email in the body)', 400)
    const { facts } = await dependenciesEmailFacts(dependencies, tenant, preferences.benchmarkCategory)
    let pdfBuffer: Buffer | null = null
    const includePdf = plan === 'commander' && dependencies.pdf.enabled
    if (includePdf) {
      try {
        const result = await generateReportPdf(dependencies, tenant, id)
        pdfBuffer = await dependencies.pdf.store.get(result.pdfKey)
      } catch { pdfBuffer = null }
    }
    const message = await dependencies.email.send(recipient, {
      report,
      facts,
      appUrl: `${dependencies.appUrl()}/?storeId=${encodeURIComponent(tenant)}#/ai-growth-command/growthiq/reports`,
      unsubscribeUrl: `${dependencies.appUrl()}/?storeId=${encodeURIComponent(tenant)}#/ai-growth-command/growthiq/settings`,
      includePdf,
      pdfBuffer,
    })
    response.status(200).json(success({ sent: true, messageId: message.messageId }, requestIdFrom(request)))
  }))

  // ── Benchmarks ───────────────────────────────────────────────────────────
  router.get('/ai-executive/benchmarks', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const preferences = await dependencies.repository.getPreferences(tenant)
    const category = optionalStringParam(request, 'category') ?? preferences.benchmarkCategory
    if (!isBenchmarkCategory(category)) throw new AppError('VALIDATION_ERROR', 'Unknown benchmark category', 400, { category })
    const rows = await dependencies.repository.benchmarkRows(category)
    const plan = await dependencies.plan(tenant)
    const gates = await executiveGates(dependencies, tenant)
    // A `null` limit means "unlimited" (Commander) — never fall back to a
    // number, or the top tier silently loses metrics.
    const allLadders = laddersFromRows(rows)
    const limit = gates.benchmarks?.limit
    const visibleMetrics = limit === null || limit === undefined ? allLadders.length : Math.min(limit, allLadders.length)
    const ladders = allLadders.slice(0, Math.max(visibleMetrics, 0))
    response.status(200).json(success({ category, ladders, sourceMode: 'SHOPIFY_PUBLIC', visibleMetrics, totalMetrics: allLadders.length }, requestIdFrom(request)))
  }))

  router.get('/ai-executive/benchmarks/position', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const preferences = await dependencies.repository.getPreferences(tenant)
    const category = optionalStringParam(request, 'category') ?? preferences.benchmarkCategory
    if (!isBenchmarkCategory(category)) throw new AppError('VALIDATION_ERROR', 'Unknown benchmark category', 400, { category })
    const [snapshot, analytics, catalog, rows] = await Promise.all([
      dependencies.snapshot(tenant),
      dependencies.analytics(tenant),
      dependencies.catalog(tenant),
      dependencies.repository.benchmarkRows(category),
    ])
    const detected = detectBenchmarkCategory(catalog)
    const effectiveCategory = preferences.benchmarkCategory !== 'Other' ? preferences.benchmarkCategory : detected ?? 'Other'
    const categorySource = preferences.benchmarkCategory !== 'Other' ? 'PREFERENCE' as const : detected !== null ? 'AUTO_DETECTED' as const : 'DEFAULT' as const
    const gates = await executiveGates(dependencies, tenant)
    const allLadders = laddersFromRows(rows)
    // A `null` limit means "unlimited" (Commander) — never fall back to a
    // number, or the top tier silently loses metrics.
    const limit = gates.benchmarks?.limit
    const position = buildBenchmarkPosition({
      storeId: tenant,
      category: effectiveCategory,
      categorySource,
      ladders: allLadders,
      merchantValues: merchantMetricValues(snapshot, analytics, catalog),
      visibleMetrics: limit === null || limit === undefined ? allLadders.length : Math.min(limit, allLadders.length),
      now: new Date(dependencies.now()),
    })
    response.status(200).json(success(position, requestIdFrom(request)))
  }))

  router.get('/ai-executive/benchmarks/comparison', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const metric = requiredStringParam(request, 'metric')
    if (!(EXECUTIVE_BENCHMARK_METRICS as readonly string[]).includes(metric)) throw new AppError('VALIDATION_ERROR', 'Unknown benchmark metric', 400, { metric })
    const preferences = await dependencies.repository.getPreferences(tenant)
    const category = optionalStringParam(request, 'category') ?? preferences.benchmarkCategory
    if (!isBenchmarkCategory(category)) throw new AppError('VALIDATION_ERROR', 'Unknown benchmark category', 400, { category })
    const [snapshot, analytics, catalog, rows] = await Promise.all([
      dependencies.snapshot(tenant),
      dependencies.analytics(tenant),
      dependencies.catalog(tenant),
      dependencies.repository.benchmarkRows(category),
    ])
    const ladder = laddersFromRows(rows).find((entry) => entry.metric === metric)
    if (!ladder) throw new AppError('NOT_FOUND', 'No benchmark ladder for this metric and category', 404, { metric, category })
    const values = merchantMetricValues(snapshot, analytics, catalog)
    const yourValue = values[metric]
    const percentile = yourValue === undefined ? null : benchmarkPercentile(ladder.points, yourValue)
    const median = ladder.points.find((point) => point.percentile === 50)?.value ?? null
    const top10 = ladder.points.find((point) => point.percentile === 90)?.value ?? null
    response.status(200).json(success({
      metric,
      label: BENCHMARK_METRIC_LABELS[metric as ExecutiveBenchmarkMetric],
      category,
      yourValue: yourValue === undefined ? null : yourValue,
      currency: ladder.currency,
      industryMedian: median,
      top10Target: top10,
      percentile: percentile === null ? null : Math.round(percentile),
      gapToTop10Pct: yourValue === undefined || top10 === null || yourValue <= 0 ? null : Math.max(0, Math.round((top10 / yourValue - 1) * 100)),
      ladder: ladder.points,
      sourceLabel: ladder.sourceLabel,
      narrative: comparisonNarrative(metric as ExecutiveBenchmarkMetric, yourValue ?? null, median, top10, percentile === null ? null : Math.round(percentile), ladder.currency ?? ''),
    }, requestIdFrom(request)))
  }))

  router.post('/ai-executive/benchmarks/refresh', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const plan = await dependencies.plan(tenant)
    if (plan !== 'growth' && plan !== 'commander') assertExecutiveFeature(plan, 'peer_comparison', 0)
    const preferences = await dependencies.repository.getPreferences(tenant)
    const rows = await dependencies.repository.benchmarkRows(preferences.benchmarkCategory)
    response.status(200).json(success({ refreshed: true, asOf: new Date(dependencies.now()).toISOString(), rows: rows.length, sourceMode: 'SHOPIFY_PUBLIC' }, requestIdFrom(request)))
  }))

  // ── Scenarios ────────────────────────────────────────────────────────────
  router.get('/ai-executive/scenarios/templates', (request, response) => {
    response.status(200).json(success(SCENARIO_TEMPLATES, requestIdFrom(request)))
  })

  router.post('/ai-executive/scenarios', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const plan = await dependencies.plan(tenant)
    assertExecutiveFeature(plan, 'scenarios', await dependencies.usage.current(tenant, 'ai_executive_scenarios_month'))
    const scenarioType = parseScenarioType(body.scenarioType)
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : `${scenarioType} scenario`
    const description = typeof body.description === 'string' ? body.description : ''
    const inputs = parseScenarioInputs(body.inputs)
    const scenario = await runScenario(dependencies, tenant, { scenarioType, title, description, inputs })
    response.status(201).json(success(scenario, requestIdFrom(request)))
  }))

  router.get('/ai-executive/scenarios', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const limit = Math.min(numberParam(request, 'limit') ?? 20, 100)
    response.status(200).json(success(await dependencies.repository.listScenarios(tenant, limit), requestIdFrom(request)))
  }))

  router.get('/ai-executive/scenarios/:id', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const scenario = await dependencies.repository.getScenario(tenant, paramId(request))
    if (!scenario) throw new AppError('NOT_FOUND', 'Scenario not found', 404, { id: paramId(request) })
    response.status(200).json(success(scenario, requestIdFrom(request)))
  }))

  router.delete('/ai-executive/scenarios/:id', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const deleted = await dependencies.repository.deleteScenario(tenant, paramId(request))
    if (!deleted) throw new AppError('NOT_FOUND', 'Scenario not found', 404, { id: paramId(request) })
    response.status(200).json(success({ deleted: true }, requestIdFrom(request)))
  }))

  // ── Health ───────────────────────────────────────────────────────────────
  router.get('/ai-executive/health/current', run(async (request, response) => {
    const tenant = queryStoreId(request)
    response.status(200).json(success(await dependencies.repository.latestDiagnosis(tenant), requestIdFrom(request)))
  }))

  router.post('/ai-executive/health/diagnose', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const plan = await dependencies.plan(tenant)
    assertExecutiveFeature(plan, 'health', await dependencies.usage.current(tenant, 'ai_executive_health_month'))
    const diagnosis = await runHealthDiagnosis(dependencies, tenant)
    response.status(201).json(success(diagnosis, requestIdFrom(request)))
  }))

  router.get('/ai-executive/health/history', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const limit = Math.min(numberParam(request, 'limit') ?? 12, 100)
    response.status(200).json(success(await dependencies.repository.diagnosisHistory(tenant, limit), requestIdFrom(request)))
  }))

  router.get('/ai-executive/health/trends', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const history = await dependencies.repository.diagnosisHistory(tenant, 24)
    const trends = [...history].reverse().map((diagnosis) => ({ diagnosedAt: diagnosis.diagnosedAt, score: diagnosis.overallScore, status: diagnosis.overallStatus }))
    response.status(200).json(success({ points: trends, latest: trends.at(-1) ?? null }, requestIdFrom(request)))
  }))

  // ── Opportunities ────────────────────────────────────────────────────────
  router.get('/ai-executive/opportunities', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const status = optionalStringParam(request, 'status')
    const opportunities = await dependencies.repository.listOpportunities(tenant)
    const filtered = status ? opportunities.filter((opportunity) => opportunity.status === status) : opportunities
    response.status(200).json(success(filtered, requestIdFrom(request)))
  }))

  router.post('/ai-executive/opportunities/generate', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const plan = await dependencies.plan(tenant)
    assertExecutiveFeature(plan, 'opportunities', await dependencies.usage.current(tenant, 'ai_executive_opportunities'))
    const opportunities = await regenerateOpportunities(dependencies, tenant)
    response.status(201).json(success({ opportunities, generated: opportunities.length }, requestIdFrom(request)))
  }))

  router.get('/ai-executive/opportunities/:id', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const opportunity = await dependencies.repository.getOpportunity(tenant, paramId(request))
    if (!opportunity) throw new AppError('NOT_FOUND', 'Opportunity not found', 404, { id: paramId(request) })
    response.status(200).json(success(opportunity, requestIdFrom(request)))
  }))

  router.patch('/ai-executive/opportunities/:id/status', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const status = parseOpportunityStatus(body.status)
    const opportunity = await dependencies.repository.updateOpportunityStatus(tenant, paramId(request), status)
    if (!opportunity) throw new AppError('NOT_FOUND', 'Opportunity not found', 404, { id: paramId(request) })
    response.status(200).json(success(opportunity, requestIdFrom(request)))
  }))

  // ── Decisions ────────────────────────────────────────────────────────────
  router.get('/ai-executive/decisions', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const limit = Math.min(numberParam(request, 'limit') ?? 50, 200)
    response.status(200).json(success(await dependencies.repository.listDecisions(tenant, limit), requestIdFrom(request)))
  }))

  router.post('/ai-executive/decisions', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const plan = await dependencies.plan(tenant)
    assertExecutiveFeature(plan, 'decisions', await dependencies.usage.current(tenant, 'ai_executive_decisions'))
    const decisionType = parseDecisionType(body.decisionType)
    const title = requiredStringField(body, 'title', 160)
    const description = typeof body.description === 'string' ? body.description.slice(0, 800) : ''
    const decisionDate = typeof body.decisionDate === 'string' && body.decisionDate ? body.decisionDate : new Date(dependencies.now()).toISOString().slice(0, 10)
    const predictedOutcome = parseOutcome(body.predictedOutcome)
    const actualOutcome = parseOutcome(body.actualOutcome)
    const createdBy = typeof body.createdBy === 'string' && body.createdBy.trim() ? body.createdBy.trim().slice(0, 60) : 'merchant'
    const decision = await logDecision(dependencies, tenant, { decisionType, title, description, decisionDate, predictedOutcome, actualOutcome, createdBy })
    response.status(201).json(success(decision, requestIdFrom(request)))
  }))

  router.get('/ai-executive/decisions/analytics', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const decisions = await dependencies.repository.listDecisions(tenant, 200)
    response.status(200).json(success(decisionAnalyticsFromRows(decisions), requestIdFrom(request)))
  }))

  router.patch('/ai-executive/decisions/:id', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const patch = {
      ...(typeof body.title === 'string' ? { title: body.title.slice(0, 160) } : {}),
      ...(typeof body.description === 'string' ? { description: body.description.slice(0, 800) } : {}),
      ...(body.predictedOutcome !== undefined ? { predictedOutcome: parseOutcome(body.predictedOutcome) } : {}),
      ...(body.actualOutcome !== undefined ? { actualOutcome: parseOutcome(body.actualOutcome) } : {}),
    }
    const decision = await dependencies.repository.updateDecision(tenant, paramId(request), patch)
    if (!decision) throw new AppError('NOT_FOUND', 'Decision not found', 404, { id: paramId(request) })
    response.status(200).json(success(decision, requestIdFrom(request)))
  }))

  router.post('/ai-executive/decisions/:id/review', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const actualOutcome = parseOutcome(body.actualOutcome)
    if (actualOutcome === null || Object.keys(actualOutcome).length === 0) throw new AppError('VALIDATION_ERROR', 'actualOutcome with at least one value is required', 400)
    const decision = await reviewDecision(dependencies, tenant, paramId(request), actualOutcome)
    if (!decision) throw new AppError('NOT_FOUND', 'Decision not found', 404, { id: paramId(request) })
    response.status(200).json(success(decision, requestIdFrom(request)))
  }))

  router.delete('/ai-executive/decisions/:id', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const deleted = await dependencies.repository.deleteDecision(tenant, paramId(request))
    if (!deleted) throw new AppError('NOT_FOUND', 'Decision not found', 404, { id: paramId(request) })
    response.status(200).json(success({ deleted: true }, requestIdFrom(request)))
  }))

  // ── Risks ────────────────────────────────────────────────────────────────
  router.get('/ai-executive/risks', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const severity = optionalStringParam(request, 'severity')
    const risks = await dependencies.repository.listRisks(tenant)
    const filtered = severity && severity !== 'all' ? risks.filter((risk) => risk.severity === severity) : risks
    response.status(200).json(success(filtered, requestIdFrom(request)))
  }))

  router.post('/ai-executive/risks/scan', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const plan = await dependencies.plan(tenant)
    assertExecutiveFeature(plan, 'risk_scan', await dependencies.usage.current(tenant, 'ai_executive_risk_scans_month'))
    const risks = await runRiskScan(dependencies, tenant)
    response.status(201).json(success({ risks, active: risks.filter((risk) => risk.status === 'ACTIVE').length }, requestIdFrom(request)))
  }))

  router.patch('/ai-executive/risks/:id/mitigate', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const mitigationPlan = parseMitigationPlan(body.mitigationPlan)
    const risk = await dependencies.repository.updateRiskMitigation(tenant, paramId(request), mitigationPlan)
    if (!risk) throw new AppError('NOT_FOUND', 'Risk not found', 404, { id: paramId(request) })
    response.status(200).json(success(risk, requestIdFrom(request)))
  }))

  router.post('/ai-executive/risks/:id/resolve', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const risk = await dependencies.repository.resolveRisk(tenant, paramId(request))
    if (!risk) throw new AppError('NOT_FOUND', 'Risk not found', 404, { id: paramId(request) })
    response.status(200).json(success(risk, requestIdFrom(request)))
  }))

  router.get('/ai-executive/risks/trends', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const risks = await dependencies.repository.listRisks(tenant)
    const byDay = new Map<string, { active: number; critical: number; high: number }>()
    for (const risk of risks) {
      const day = risk.detectedAt.slice(0, 10)
      const entry = byDay.get(day) ?? { active: 0, critical: 0, high: 0 }
      if (risk.status === 'ACTIVE') {
        entry.active += 1
        if (risk.severity === 'CRITICAL') entry.critical += 1
        if (risk.severity === 'HIGH') entry.high += 1
      }
      byDay.set(day, entry)
    }
    const points = [...byDay.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([periodStart, counts]) => ({ periodStart, ...counts }))
    response.status(200).json(success({ points, latest: points.at(-1) ?? null }, requestIdFrom(request)))
  }))

  // ── Roadmaps ─────────────────────────────────────────────────────────────
  router.get('/ai-executive/roadmaps', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const status = optionalStringParam(request, 'status')
    const roadmaps = await dependencies.repository.listRoadmaps(tenant)
    const filtered = status ? roadmaps.filter((roadmap) => roadmap.status === status) : roadmaps
    response.status(200).json(success(filtered, requestIdFrom(request)))
  }))

  router.post('/ai-executive/roadmaps', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const plan = await dependencies.plan(tenant)
    const active = await dependencies.repository.countActiveRoadmaps(tenant)
    assertExecutiveFeature(plan, 'roadmaps', active)
    const roadmapType = parseRoadmapType(body.roadmapType)
    if (roadmapType !== '30_DAY') {
      const feature = roadmapType === '60_DAY' || roadmapType === '90_DAY' ? 'roadmap_90' : roadmapType === 'QUARTERLY' ? 'roadmap_quarterly' : 'roadmap_yearly'
      assertExecutiveFeature(plan, feature, 0)
    }
    const now = dependencies.now()
    const periodStart = typeof body.periodStart === 'string' && body.periodStart ? body.periodStart : new Date(now).toISOString().slice(0, 10)
    const days = roadmapType === '30_DAY' ? 30 : roadmapType === '60_DAY' ? 60 : roadmapType === '90_DAY' ? 90 : roadmapType === 'QUARTERLY' ? 90 : 365
    const periodEnd = typeof body.periodEnd === 'string' && body.periodEnd ? body.periodEnd : new Date(now + days * 86_400_000).toISOString().slice(0, 10)
    const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim().slice(0, 200) : null
    const roadmap = await generateRoadmap(dependencies, tenant, { roadmapType, periodStart, periodEnd, goal })
    response.status(201).json(success(roadmap, requestIdFrom(request)))
  }))

  router.post('/ai-executive/roadmaps/:id/generate', limited(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const plan = await dependencies.plan(tenant)
    const active = await dependencies.repository.countActiveRoadmaps(tenant)
    assertExecutiveFeature(plan, 'roadmaps', active)
    const existing = await dependencies.repository.getRoadmap(tenant, paramId(request))
    if (!existing) throw new AppError('NOT_FOUND', 'Roadmap not found', 404, { id: paramId(request) })
    const roadmapType = parseRoadmapType(body.roadmapType ?? existing.roadmapType)
    if (roadmapType !== existing.roadmapType) {
      const feature = roadmapType === '60_DAY' || roadmapType === '90_DAY' ? 'roadmap_90' : roadmapType === 'QUARTERLY' ? 'roadmap_quarterly' : 'roadmap_yearly'
      if (roadmapType !== '30_DAY') assertExecutiveFeature(plan, feature, 0)
    }
    const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim().slice(0, 200) : null
    const generated = await generateRoadmap(dependencies, tenant, { roadmapType, periodStart: existing.periodStart, periodEnd: existing.periodEnd, goal })
    const roadmap = await dependencies.repository.updateRoadmap(tenant, existing.id, {
      title: generated.title,
      milestones: generated.milestones,
      expectedOutcomes: generated.expectedOutcomes,
      confidenceScore: generated.confidenceScore,
    })
    response.status(200).json(success(roadmap ?? existing, requestIdFrom(request)))
  }))

  router.patch('/ai-executive/roadmaps/:id', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const patch = {
      ...(typeof body.title === 'string' ? { title: body.title.slice(0, 160) } : {}),
      ...(body.milestones !== undefined ? { milestones: parseMilestones(body.milestones) } : {}),
      ...(body.expectedOutcomes !== undefined ? { expectedOutcomes: asStringArray(body.expectedOutcomes).slice(0, 10) } : {}),
      ...(typeof body.status === 'string' ? { status: parseRoadmapStatus(body.status) } : {}),
      ...(typeof body.confidenceScore === 'number' ? { confidenceScore: Math.min(Math.max(body.confidenceScore, 0), 1) } : {}),
    }
    const roadmap = await dependencies.repository.updateRoadmap(tenant, paramId(request), patch)
    if (!roadmap) throw new AppError('NOT_FOUND', 'Roadmap not found', 404, { id: paramId(request) })
    response.status(200).json(success(roadmap, requestIdFrom(request)))
  }))

  router.post('/ai-executive/roadmaps/:id/mark-milestone', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const milestoneKey = requiredStringField(body, 'milestoneKey', 80)
    const roadmap = await markRoadmapMilestone(dependencies, tenant, paramId(request), milestoneKey)
    if (!roadmap) throw new AppError('NOT_FOUND', 'Roadmap not found', 404, { id: paramId(request) })
    response.status(200).json(success(roadmap, requestIdFrom(request)))
  }))

  router.delete('/ai-executive/roadmaps/:id', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const deleted = await dependencies.repository.deleteRoadmap(tenant, paramId(request))
    if (!deleted) throw new AppError('NOT_FOUND', 'Roadmap not found', 404, { id: paramId(request) })
    response.status(200).json(success({ deleted: true }, requestIdFrom(request)))
  }))

  // ── Preferences ──────────────────────────────────────────────────────────
  router.get('/ai-executive/preferences', run(async (request, response) => {
    const tenant = queryStoreId(request)
    response.status(200).json(success(await dependencies.repository.getPreferences(tenant), requestIdFrom(request)))
  }))

  router.patch('/ai-executive/preferences', run(async (request, response) => {
    const tenant = queryStoreId(request)
    const body = recordBody(request)
    const patch: { monthlyReportEnabled?: boolean; monthlyReportEmailEnabled?: boolean; reportEmail?: string | null; reportGenerationDay?: number; riskAlertsEnabled?: boolean; riskAlertSeverity?: ExecutivePreferences['riskAlertSeverity']; benchmarkCategory?: import('./executive-model.js').ExecutiveBenchmarkCategory; language?: ExecutivePreferences['language'] } = {}
    if (typeof body.monthlyReportEnabled === 'boolean') patch.monthlyReportEnabled = body.monthlyReportEnabled
    if (typeof body.monthlyReportEmailEnabled === 'boolean') patch.monthlyReportEmailEnabled = body.monthlyReportEmailEnabled
    if (body.reportEmail !== undefined) {
      if (body.reportEmail !== null && (typeof body.reportEmail !== 'string' || !/^\S+@\S+\.\S+$/.test(body.reportEmail))) throw new AppError('VALIDATION_ERROR', 'reportEmail must be a valid email address', 400)
      patch.reportEmail = body.reportEmail
    }
    if (typeof body.reportGenerationDay === 'number') {
      if (!Number.isInteger(body.reportGenerationDay) || body.reportGenerationDay < 1 || body.reportGenerationDay > 28) throw new AppError('VALIDATION_ERROR', 'reportGenerationDay must be an integer between 1 and 28', 400)
      patch.reportGenerationDay = body.reportGenerationDay
    }
    if (typeof body.riskAlertsEnabled === 'boolean') patch.riskAlertsEnabled = body.riskAlertsEnabled
    if (body.riskAlertSeverity !== undefined) {
      if (body.riskAlertSeverity !== 'all' && body.riskAlertSeverity !== 'HIGH' && body.riskAlertSeverity !== 'CRITICAL') throw new AppError('VALIDATION_ERROR', 'riskAlertSeverity must be all, HIGH, or CRITICAL', 400)
      patch.riskAlertSeverity = body.riskAlertSeverity
    }
    if (body.benchmarkCategory !== undefined) {
      if (typeof body.benchmarkCategory !== 'string' || !isBenchmarkCategory(body.benchmarkCategory)) throw new AppError('VALIDATION_ERROR', 'Unknown benchmark category', 400)
      patch.benchmarkCategory = body.benchmarkCategory
    }
    if (body.language !== undefined) {
      if (body.language !== 'en' && body.language !== 'hi') throw new AppError('VALIDATION_ERROR', 'language must be en or hi', 400)
      patch.language = body.language
    }
    const preferences = await dependencies.repository.savePreferences(tenant, patch)
    response.status(200).json(success(preferences, requestIdFrom(request)))
  }))

  return router
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function dependenciesEmailFacts(dependencies: ExecutiveRouteDependencies, tenant: StoreId, benchmarkCategory: import('./executive-model.js').ExecutiveBenchmarkCategory): Promise<Readonly<{ facts: import('./executive-ai.js').ExecutiveFacts }>> {
  return buildExecutiveFacts(dependencies, tenant, benchmarkCategory)
}

function queryStoreId(request: Request): StoreId {
  const value = request.query.storeId ?? (typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>).storeId : undefined)
  if (typeof value !== 'string' || value.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
  return storeId(value)
}

function requestIdFrom(request: Request): ReturnType<typeof requestId> {
  return requestId(request.header('x-request-id') || randomUUID())
}

function paramId(request: Request): string {
  const raw = request.params.id
  const id = typeof raw === 'string' ? raw : raw?.[0]
  if (!id) throw new AppError('VALIDATION_ERROR', 'id is required', 400)
  return id
}

function recordBody(request: Request): Readonly<Record<string, unknown>> {
  return typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? request.body as Readonly<Record<string, unknown>> : {}
}

function optionalStringParam(request: Request, key: string): string | null {
  const value = request.query[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function requiredStringParam(request: Request, key: string): string {
  const value = optionalStringParam(request, key)
  if (!value) throw new AppError('VALIDATION_ERROR', `${key} is required`, 400)
  return value
}

function numberParam(request: Request, key: string): number | null {
  const raw = optionalStringParam(request, key)
  if (raw === null) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new AppError('VALIDATION_ERROR', `${key} must be a number`, 400)
  return parsed
}

function requiredStringField(body: Readonly<Record<string, unknown>>, key: string, max: number): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim().length === 0) throw new AppError('VALIDATION_ERROR', `${key} is required`, 400)
  return value.trim().slice(0, max)
}

function parseReportType(value: unknown): ExecutiveReportType {
  if (value === undefined) return 'CUSTOM'
  if (value === 'MONTHLY' || value === 'QUARTERLY' || value === 'CUSTOM') return value
  throw new AppError('VALIDATION_ERROR', 'reportType must be MONTHLY, QUARTERLY, or CUSTOM', 400)
}

function parseScenarioType(value: unknown): ScenarioType {
  if (value === 'PRICING' || value === 'PRODUCT' || value === 'MARKETING' || value === 'INVENTORY' || value === 'CUSTOM') return value
  throw new AppError('VALIDATION_ERROR', 'scenarioType must be PRICING, PRODUCT, MARKETING, INVENTORY, or CUSTOM', 400)
}

function parseScenarioInputs(value: unknown): Readonly<Record<string, number | string | boolean>> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AppError('VALIDATION_ERROR', 'inputs must be an object', 400)
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter((entry): entry is [string, number | string | boolean] => typeof entry[1] === 'number' || typeof entry[1] === 'string' || typeof entry[1] === 'boolean')
      .slice(0, 12),
  )
}

function parseOpportunityStatus(value: unknown): OpportunityStatus {
  if (value === 'NEW' || value === 'REVIEWING' || value === 'PURSUING' || value === 'DISMISSED' || value === 'COMPLETED') return value
  throw new AppError('VALIDATION_ERROR', 'status must be NEW, REVIEWING, PURSUING, DISMISSED, or COMPLETED', 400)
}

function parseDecisionType(value: unknown): DecisionType {
  if (value === 'PRICING' || value === 'PRODUCT' || value === 'MARKETING' || value === 'INVENTORY' || value === 'STRATEGIC' || value === 'CUSTOM') return value
  throw new AppError('VALIDATION_ERROR', 'decisionType must be PRICING, PRODUCT, MARKETING, INVENTORY, STRATEGIC, or CUSTOM', 400)
}

function parseOutcome(value: unknown): Readonly<Record<string, number | string>> | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new AppError('VALIDATION_ERROR', 'outcome must be an object of metric values', 400)
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter((entry): entry is [string, number | string] => typeof entry[1] === 'number' || typeof entry[1] === 'string')
    .slice(0, 20)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function parseMitigationPlan(value: unknown): ExecutiveRisk['mitigationPlan'] {
  if (!Array.isArray(value)) throw new AppError('VALIDATION_ERROR', 'mitigationPlan must be an array', 400)
  return value.slice(0, 6).map((item) => {
    const record = typeof item === 'object' && item !== null ? item as Readonly<Record<string, unknown>> : {}
    const step = typeof record.step === 'string' ? record.step.trim().slice(0, 240) : ''
    const timeline = typeof record.timeline === 'string' ? record.timeline.trim().slice(0, 40) : ''
    if (!step) throw new AppError('VALIDATION_ERROR', 'each mitigation step needs a step string', 400)
    return { step, timeline }
  })
}

function parseRoadmapType(value: unknown): RoadmapType {
  if (value === '30_DAY' || value === '60_DAY' || value === '90_DAY' || value === 'QUARTERLY' || value === 'YEARLY') return value
  throw new AppError('VALIDATION_ERROR', 'roadmapType must be 30_DAY, 60_DAY, 90_DAY, QUARTERLY, or YEARLY', 400)
}

function parseRoadmapStatus(value: unknown): import('./executive-model.js').RoadmapStatus {
  if (value === 'DRAFT' || value === 'ACTIVE' || value === 'COMPLETED' || value === 'ABANDONED') return value
  throw new AppError('VALIDATION_ERROR', 'status must be DRAFT, ACTIVE, COMPLETED, or ABANDONED', 400)
}

function parseMilestones(value: unknown): readonly import('./executive-model.js').RoadmapMilestone[] {
  if (!Array.isArray(value)) throw new AppError('VALIDATION_ERROR', 'milestones must be an array', 400)
  return value.slice(0, 26).map((item, index) => {
    const record = typeof item === 'object' && item !== null ? item as Readonly<Record<string, unknown>> : {}
    const status = record.status === 'COMPLETE' || record.status === 'CURRENT' ? record.status : 'PENDING'
    return {
      key: typeof record.key === 'string' ? record.key : `m${index + 1}`,
      title: typeof record.title === 'string' ? record.title.trim().slice(0, 120) : `Milestone ${index + 1}`,
      description: typeof record.description === 'string' ? record.description.slice(0, 300) : '',
      dueDate: typeof record.dueDate === 'string' ? record.dueDate : '',
      status: status as import('./executive-model.js').RoadmapMilestone['status'],
      successMetrics: asStringArray(record.successMetrics).slice(0, 4),
      dependencies: asStringArray(record.dependencies).slice(0, 4),
    }
  })
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(0, 10)
}

function parseWhiteLabel(value: unknown): ExecutiveWhiteLabel | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new AppError('VALIDATION_ERROR', 'whiteLabel must be an object', 400)
  const record = value as Readonly<Record<string, unknown>>
  const whiteLabel: ExecutiveWhiteLabel = {
    brandName: typeof record.brandName === 'string' && record.brandName.trim() ? record.brandName.trim().slice(0, 60) : null,
    logoText: typeof record.logoText === 'string' && record.logoText.trim() ? record.logoText.trim().slice(0, 4) : null,
    primaryColor: typeof record.primaryColor === 'string' && /^#[0-9a-fA-F]{3,6}$/.test(record.primaryColor) ? record.primaryColor : null,
    footerText: typeof record.footerText === 'string' && record.footerText.trim() ? record.footerText.trim().slice(0, 120) : null,
  }
  return whiteLabel
}

function comparisonNarrative(metric: ExecutiveBenchmarkMetric, yourValue: number | null, median: number | null, top10: number | null, percentile: number | null, currency: string): string {
  if (yourValue === null || median === null) return 'This metric is not measurable yet — sync more order and customer history and it will appear automatically.'
  const label = BENCHMARK_METRIC_LABELS[metric].toLowerCase()
  if (percentile === null) return `Your ${label} is ${currency ? `${currency} ` : ''}${formatNumber(yourValue)} versus an industry median of ${currency ? `${currency} ` : ''}${formatNumber(median)}.`
  const tier = percentile >= 90 ? 'top 10%' : percentile >= 75 ? 'top 25%' : percentile >= 50 ? 'above the median' : percentile >= 25 ? 'below the median' : 'in the bottom quartile'
  const gap = top10 !== null && yourValue > 0 && yourValue < top10 ? ` Reaching the top 10% target (${currency ? `${currency} ` : ''}${formatNumber(top10)}) needs ${Math.round((top10 / yourValue - 1) * 100)}% improvement.` : ''
  return `Your ${label} is ${currency ? `${currency} ` : ''}${formatNumber(yourValue)} — ${tier} at the ${percentile}th percentile.${gap}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: value < 100 ? 1 : 0 }).format(value)
}
