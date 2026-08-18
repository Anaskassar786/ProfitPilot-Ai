import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger } from '@profitpilot/logger'
import { storeId } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { StoreSnapshot } from '@profitpilot/ai'
import { OpenRouterClient } from '@profitpilot/ai'
import type { AnalyticsSnapshot } from '@profitpilot/db'
import { createApi } from './app.js'
import { InMemoryExecutiveRepository } from './executive-repository.js'
import { createExecutiveAiService } from './executive-ai.js'
import type { ExecutiveAiService } from './executive-ai.js'
import { createExecutiveEmailDelivery } from './executive-email.js'
import { InMemoryExecutivePdfStore } from './executive-pdf.js'
import type { ExecutiveContext } from './executive-service.js'
import type { ExecutiveRouteDependencies } from './executive-routes.js'

const snapshot: StoreSnapshot = {
  storeId: storeId('s'), currency: 'USD', timezone: 'UTC', asOf: '2026-08-18T00:00:00.000Z', dataFreshAt: '2026-08-17',
  products: [
    { productId: 'p1', title: 'Hero Hoodie', inventoryUnits: 40, averageDailyUnits: 2, unitPrice: 60, unitCost: 20, unitsSold120d: 180, daysSinceLastSale: 1 },
    { productId: 'p2', title: 'Tee', inventoryUnits: 120, averageDailyUnits: 1.2, unitPrice: 25, unitCost: 8, unitsSold120d: 90, daysSinceLastSale: 2 },
    { productId: 'p3', title: 'Cap', inventoryUnits: 0, averageDailyUnits: 0.8, unitPrice: 22, unitCost: 7, unitsSold120d: 70, daysSinceLastSale: 3 },
  ],
  customers: [
    { customerKey: 'c1', lifetimeValue: 500, orderCount: 4, daysSinceLastOrder: 5, firstOrderDay: '2026-04-01' },
    { customerKey: 'c2', lifetimeValue: 200, orderCount: 2, daysSinceLastOrder: 20, firstOrderDay: '2026-05-01' },
    { customerKey: 'c3', lifetimeValue: 90, orderCount: 1, daysSinceLastOrder: 60, firstOrderDay: '2026-06-01' },
  ],
  checkouts: [], orders: [], productPairs: [{ productId: 'p1', relatedProductId: 'p2', coPurchaseRate: 0.4, productPrice: 60, relatedProductPrice: 25 }],
  last30dRevenue: 8400, previous30dRevenue: 7000, last30dOrders: 120, previous30dOrders: 100,
}

const day = (offset: number): string => new Date(Date.parse('2026-08-18T00:00:00.000Z') - offset * 86_400_000).toISOString().slice(0, 10)
const analytics: AnalyticsSnapshot = {
  revenue: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s'), day: day(59 - index), grossRevenue: 280, discounts: 0, orderCount: 4 })),
  orders: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s'), day: day(59 - index), orderCount: 4, fulfilledCount: 4, cancelledCount: 0, averageOrderValue: 70 })),
  productSales: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s'), day: day(59 - index), productId: index % 3 === 0 ? 'p1' : index % 3 === 1 ? 'p2' : 'p3', unitsSold: index % 3 === 0 ? 6 : index % 3 === 1 ? 4 : 2, grossRevenue: index % 3 === 0 ? 360 : index % 3 === 1 ? 100 : 44 })),
  customerCohorts: [],
}

type HarnessOptions = Readonly<{ plan?: PlanTier; usage?: Readonly<Record<string, number>>; rateLimit?: number }>

type Harness = Readonly<{ base: string; repository: InMemoryExecutiveRepository; usage: Map<string, number>; resetLimiter: () => void }>

async function withExecutiveServer(options: HarnessOptions, handler: (harness: Harness) => Promise<void>): Promise<void> {
  const repository = new InMemoryExecutiveRepository()
  repository.seedPreference(storeId('s'), { benchmarkCategory: 'Fashion & Apparel' })
  const usage = new Map<string, number>(Object.entries(options.usage ?? {}))
  const ai: ExecutiveAiService = createExecutiveAiService(new OpenRouterClient({ keys: [] }), null, null)
  const context: ExecutiveContext = {
    repository,
    snapshot: async () => snapshot,
    analytics: async () => analytics,
    catalog: async () => [],
    plan: async () => options.plan ?? 'growth',
    usage: {
      current: async (_store: StoreId, feature: string) => usage.get(feature) ?? 0,
      add: async (_store: StoreId, feature: string, count: number) => { usage.set(feature, (usage.get(feature) ?? 0) + count) },
    },
    ai,
    email: createExecutiveEmailDelivery({ transport: null, from: 'reports@profitpilot.example', fromName: 'ProfitPilot' }),
    pdf: { enabled: true, store: new InMemoryExecutivePdfStore(), whiteLabel: () => ({ brandName: null, logoText: null, primaryColor: null, footerText: null }) },
    shopName: async () => 'acme-store.myshopify.com',
    appUrl: () => 'http://localhost:3000',
    recordCost: async () => undefined,
    now: () => Date.parse('2026-08-18T12:00:00.000Z'),
  }
  const routes: ExecutiveRouteDependencies = { ...context, rateLimitPerStore: options.rateLimit ?? 20 }
  const app = createApi({ logger: new Logger(), readinessChecks: [], executive: routes })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try {
    await handler({ base: `http://127.0.0.1:${address.port}`, repository, usage, resetLimiter: () => { /* in-memory limiter resets per instance */ } })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const json = { 'content-type': 'application/json' }
const get = async (url: string): Promise<Response> => fetch(url)
const post = async (url: string, body: Readonly<Record<string, unknown>> = {}): Promise<Response> => fetch(url, { method: 'POST', headers: json, body: JSON.stringify(body) })

describe('PR49 executive endpoints', () => {
  it('serves the dashboard with real store data and plan gates', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base }) => {
      const response = await get(`${base}/ai-executive/dashboard?storeId=s`)
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.ok).toBe(true)
      const dashboard = payload.data
      expect(dashboard.plan).toBe('growth')
      expect(dashboard.currency).toBe('USD')
      expect(dashboard.revenueSeries.length).toBeGreaterThan(0)
      expect(dashboard.gates.pdf.allowed).toBe(false)
      expect(dashboard.gates.reports.allowed).toBe(true)
      expect(dashboard.usage.features.length).toBeGreaterThan(10)
    })
  })

  it('generates a board report grounded in store facts and meters usage', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base, usage }) => {
      const response = await post(`${base}/ai-executive/reports/generate`, { storeId: 's', reportType: 'MONTHLY' })
      expect(response.status).toBe(201)
      const report = (await response.json()).data
      expect(report.content.aiNarrativeAvailable).toBe(false)
      expect(report.executiveSummary).toContain('8,400')
      expect(report.content.financialForecast.currency).toBe('USD')
      expect(report.content.financialForecast.projections).toHaveLength(3)
      expect(usage.get('ai_executive_reports_month')).toBe(1)
      // Listing + fetching + viewing work.
      const list = await get(`${base}/ai-executive/reports?storeId=s`)
      expect((await list.json()).data).toHaveLength(1)
      const viewed = await post(`${base}/ai-executive/reports/${report.id}/mark-viewed`, { storeId: 's' })
      expect((await viewed.json()).data.viewedAt).not.toBeNull()
    })
  })

  it('blocks reports with 402 UPGRADE_REQUIRED for the trial plan', async () => {
    await withExecutiveServer({ plan: 'trial' }, async ({ base }) => {
      const response = await post(`${base}/ai-executive/reports/generate`, { storeId: 's' })
      expect(response.status).toBe(402)
      const payload = await response.json()
      expect(payload.error.details.reason).toBe('UPGRADE_REQUIRED')
      expect(payload.error.details.feature).toBe('ai_executive_reports_month')
      expect(payload.error.details.plan).toBe('trial')
      expect(payload.error.details.requiredPlan).toBe('start')
    })
  })

  it('blocks the investor PDF for non-Commander plans with 402', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base, repository }) => {
      const report = await repository.createReport(storeId('s'), {
        reportType: 'MONTHLY', periodStart: '2026-08-01', periodEnd: '2026-08-18', executiveSummary: 'x',
        content: { strategicPosition: null, keyInsights: [], recommendedDecisions: [], financialForecast: { horizonDays: 365, currency: 'USD', projections: [] }, appendix: {}, aiNarrativeAvailable: false, generatedWithModel: null },
      })
      const response = await post(`${base}/ai-executive/reports/${report.id}/pdf`, { storeId: 's' })
      expect(response.status).toBe(402)
      expect((await response.json()).error.details.feature).toBe('ai_executive_pdf_month')
    })
  })

  it('generates and downloads an investor PDF for Commander', async () => {
    await withExecutiveServer({ plan: 'commander' }, async ({ base, repository }) => {
      const report = await repository.createReport(storeId('s'), {
        reportType: 'MONTHLY', periodStart: '2026-08-01', periodEnd: '2026-08-18', executiveSummary: 'Grounded.',
        content: { strategicPosition: null, keyInsights: ['One'], recommendedDecisions: ['Two'], financialForecast: { horizonDays: 365, currency: 'USD', projections: [{ label: '30 days', low: 100, expected: 120, high: 140 }] }, appendix: { metrics: { revenue30d: 8400 } }, aiNarrativeAvailable: false, generatedWithModel: null },
      })
      const start = await post(`${base}/ai-executive/reports/${report.id}/pdf`, { storeId: 's' })
      expect(start.status).toBe(202)
      const job = (await start.json()).data
      // Poll until the async job completes.
      let status = 'QUEUED'
      for (let attempt = 0; attempt < 30 && status !== 'COMPLETED'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        const poll = await get(`${base}/ai-executive/reports/${report.id}/pdf/status?storeId=s&jobId=${job.jobId}`)
        status = (await poll.json()).data.status
      }
      expect(status).toBe('COMPLETED')
      const download = await get(`${base}/ai-executive/reports/${report.id}/pdf/download?storeId=s`)
      expect(download.status).toBe(200)
      expect(download.headers.get('content-type')).toBe('application/pdf')
      expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(1000)
    })
  })

  it('serves benchmark position, scenario templates, and scenario projections', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base, repository }) => {
      repository.seedBenchmarks('Fashion & Apparel', [
        { id: 'b1', category: 'Fashion & Apparel', metric: 'REVENUE', percentile: 10, value: 2500, currency: 'USD', dataSource: 'SHOPIFY_PUBLIC', sourceLabel: 'Public', validFrom: '2026-01-01', validTo: '2027-01-01' },
        { id: 'b2', category: 'Fashion & Apparel', metric: 'REVENUE', percentile: 50, value: 10400, currency: 'USD', dataSource: 'SHOPIFY_PUBLIC', sourceLabel: 'Public', validFrom: '2026-01-01', validTo: '2027-01-01' },
        { id: 'b3', category: 'Fashion & Apparel', metric: 'REVENUE', percentile: 90, value: 42000, currency: 'USD', dataSource: 'SHOPIFY_PUBLIC', sourceLabel: 'Public', validFrom: '2026-01-01', validTo: '2027-01-01' },
      ])
      const positionResponse = await get(`${base}/ai-executive/benchmarks/position?storeId=s`)
      expect(positionResponse.status).toBe(200)
      const position = (await positionResponse.json()).data
      expect(position.category).toBe('Fashion & Apparel')
      expect(position.categorySource).toBe('PREFERENCE')
      const templates = await get(`${base}/ai-executive/scenarios/templates`)
      expect((await templates.json()).data).toHaveLength(5)
      const scenarioResponse = await post(`${base}/ai-executive/scenarios`, { storeId: 's', scenarioType: 'PRICING', title: 'Price +10%', description: '', inputs: { priceChangePct: 10 } })
      expect(scenarioResponse.status).toBe(201)
      const scenario = (await scenarioResponse.json()).data
      expect(scenario.predictions.assumptions.length).toBeGreaterThan(0)
      expect(scenario.predictions.currency).toBe('USD')
      expect(['LOW', 'MEDIUM']).toContain(scenario.riskLevel)
    })
  })

  it('runs health diagnosis and returns history + trends', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base }) => {
      const diagnose = await post(`${base}/ai-executive/health/diagnose`, { storeId: 's' })
      expect(diagnose.status).toBe(201)
      const diagnosis = (await diagnose.json()).data
      expect(diagnosis.vitalSigns).toHaveLength(8)
      const trends = await get(`${base}/ai-executive/health/trends?storeId=s`)
      expect((await trends.json()).data.points).toHaveLength(1)
    })
  })

  it('scans risks and identifies opportunities from real rows', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base }) => {
      const scan = await post(`${base}/ai-executive/risks/scan`, { storeId: 's' })
      expect(scan.status).toBe(201)
      const scanPayload = (await scan.json()).data
      expect(scanPayload.active).toBeGreaterThanOrEqual(0)
      const generate = await post(`${base}/ai-executive/opportunities/generate`, { storeId: 's' })
      expect(generate.status).toBe(201)
      const generated = (await generate.json()).data
      expect(generated.generated).toBeGreaterThan(0)
      const list = await get(`${base}/ai-executive/opportunities?storeId=s`)
      const opportunities = (await list.json()).data
      expect(opportunities.length).toBe(generated.generated)
      const patch = await fetch(`${base}/ai-executive/opportunities/${opportunities[0].id}/status?storeId=s`, { method: 'PATCH', headers: json, body: JSON.stringify({ storeId: 's', status: 'PURSUING' }) })
      expect((await patch.json()).data.status).toBe('PURSUING')
    })
  })

  it('logs and reviews decisions with accuracy analytics', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base }) => {
      const created = await post(`${base}/ai-executive/decisions`, { storeId: 's', decisionType: 'PRICING', title: 'Raise prices', description: '', decisionDate: '2026-08-01', predictedOutcome: { revenue: 1000 }, actualOutcome: null })
      expect(created.status).toBe(201)
      const decision = (await created.json()).data
      expect(decision.qualityRating).toBe('PENDING')
      const reviewed = await post(`${base}/ai-executive/decisions/${decision.id}/review`, { storeId: 's', actualOutcome: { revenue: 900 } })
      expect(reviewed.status).toBe(200)
      const reviewedPayload = (await reviewed.json()).data
      expect(reviewedPayload.accuracyScore).toBeCloseTo(0.9, 2)
      expect(reviewedPayload.qualityRating).toBe('EXCELLENT')
      const analyticsResponse = await get(`${base}/ai-executive/decisions/analytics?storeId=s`)
      const stats = (await analyticsResponse.json()).data
      expect(stats.total).toBe(1)
      expect(stats.averageAccuracy).toBeCloseTo(0.9, 2)
    })
  })

  it('generates a roadmap with milestone completion', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base }) => {
      const created = await post(`${base}/ai-executive/roadmaps`, { storeId: 's', roadmapType: '30_DAY', goal: 'Grow retention' })
      expect(created.status).toBe(201)
      const roadmap = (await created.json()).data
      expect(roadmap.milestones.length).toBeGreaterThan(0)
      const milestone = roadmap.milestones[0]
      const marked = await post(`${base}/ai-executive/roadmaps/${roadmap.id}/mark-milestone`, { storeId: 's', milestoneKey: milestone.key })
      expect(marked.status).toBe(200)
      const updated = (await marked.json()).data
      expect(updated.milestones.find((entry: { key: string }) => entry.key === milestone.key).status).toBe('COMPLETE')
      expect(updated.currentProgress).toBeGreaterThan(0)
    })
  })

  it('enforces the per-store rate limit with 429', async () => {
    await withExecutiveServer({ plan: 'commander', rateLimit: 3 }, async ({ base }) => {
      let last: Response | null = null
      for (let attempt = 0; attempt < 4; attempt += 1) {
        last = await post(`${base}/ai-executive/scenarios`, { storeId: 's', scenarioType: 'CUSTOM', title: 'x', description: '', inputs: { annualRevenueGrowthPct: 10, months: 6 } })
      }
      expect(last!.status).toBe(429)
      const payload = await last!.json()
      expect(payload.error.code).toBe('RATE_LIMITED')
      expect(payload.error.details.retryAfterMs).toBeGreaterThan(0)
    })
  })

  it('persists preferences with validation', async () => {
    await withExecutiveServer({ plan: 'growth' }, async ({ base }) => {
      const bad = await fetch(`${base}/ai-executive/preferences?storeId=s`, { method: 'PATCH', headers: json, body: JSON.stringify({ storeId: 's', reportGenerationDay: 31 }) })
      expect(bad.status).toBe(400)
      const ok = await fetch(`${base}/ai-executive/preferences?storeId=s`, { method: 'PATCH', headers: json, body: JSON.stringify({ storeId: 's', reportGenerationDay: 12, language: 'hi', reportEmail: 'merchant@example.com' }) })
      expect(ok.status).toBe(200)
      const prefs = (await ok.json()).data
      expect(prefs.reportGenerationDay).toBe(12)
      expect(prefs.language).toBe('hi')
      expect(prefs.reportEmail).toBe('merchant@example.com')
      const badCategory = await fetch(`${base}/ai-executive/preferences?storeId=s`, { method: 'PATCH', headers: json, body: JSON.stringify({ storeId: 's', benchmarkCategory: 'Nope' }) })
      expect(badCategory.status).toBe(400)
    })
  })

  it('returns usage and cost summary', async () => {
    await withExecutiveServer({ plan: 'start', usage: { ai_executive_scenarios_month: 1 } }, async ({ base }) => {
      const usageResponse = await get(`${base}/ai-executive/usage?storeId=s`)
      expect(usageResponse.status).toBe(200)
      const usage = (await usageResponse.json()).data
      expect(usage.plan).toBe('start')
      const scenarios = usage.features.find((entry: { feature: string }) => entry.feature === 'scenarios')
      expect(scenarios.used).toBe(1)
      expect(scenarios.limit).toBe(1)
      expect(scenarios.remaining).toBe(0)
    })
  })
})
