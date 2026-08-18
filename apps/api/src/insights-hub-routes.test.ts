import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { OrdersMetric, ProductSalesMetric, RevenueMetric } from '@profitpilot/db'
import { Logger } from '@profitpilot/logger'
import { insightsHubEnvConfig, shiftDay } from '@profitpilot/ai'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { StoreSnapshot } from '@profitpilot/ai'
import { createApi } from './app.js'
import { InMemoryInsightsHubRepository, InsightsHubService, InsightsRateLimiter } from './insights-hub.js'

const STORE = 'store-insights'
const LAST_DAY = '2026-08-17'

/** Realistic 90-day analytics + snapshot fixture (all deterministic). */
function seedAnalytics(analytics: InMemoryAnalyticsRepository): void {
  const storeId = STORE as StoreId
  const revenue: RevenueMetric[] = []
  const orders: OrdersMetric[] = []
  const productSales: ProductSalesMetric[] = []
  for (let offset = 89; offset >= 0; offset -= 1) {
    const day = shiftDay(LAST_DAY, -offset)
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    const weekdayFactor = weekday === 6 ? 1.6 : weekday === 1 ? 0.5 : 1
    const orderCount = Math.max(1, Math.round(12 * weekdayFactor))
    const grossRevenue = Math.round(orderCount * 41 * 100) / 100
    revenue.push({ storeId, day, grossRevenue, discounts: 0, orderCount })
    orders.push({ storeId, day, orderCount, fulfilledCount: orderCount, cancelledCount: 0, averageOrderValue: 41 })
    productSales.push({ storeId, day, productId: 'p1', unitsSold: Math.round(orderCount * 0.6), grossRevenue: Math.round(grossRevenue * 0.62 * 100) / 100 })
    productSales.push({ storeId, day, productId: 'p2', unitsSold: Math.round(orderCount * 0.3), grossRevenue: Math.round(grossRevenue * 0.28 * 100) / 100 })
  }
  void analytics.upsert({ revenue, orders, productSales, customerCohorts: [] })
}

function snapshotFixture(): StoreSnapshot {
  type CustomerRow = StoreSnapshot['customers'][number]
  const customers: CustomerRow[] = []
  for (let index = 0; index < 80; index += 1) {
    const loyal = index % 3 === 0
    customers.push({ customerKey: `c${index}`, lifetimeValue: loyal ? 320 + index : 60 + (index % 40), orderCount: loyal ? 5 : index % 4 === 0 ? 2 : 1, daysSinceLastOrder: loyal ? 12 : 40 + (index % 200), firstOrderDay: '2026-01-05' })
  }
  return {
    storeId: STORE as StoreId,
    currency: 'USD',
    timezone: 'UTC',
    asOf: `${LAST_DAY}T00:00:00.000Z`,
    dataFreshAt: LAST_DAY,
    products: [
      { productId: 'p1', title: 'Meridian Hoodie', inventoryUnits: 40, averageDailyUnits: 5, unitPrice: 68, unitCost: 30, unitsSold120d: 400, daysSinceLastSale: 0 },
      { productId: 'p2', title: 'Trail Cap', inventoryUnits: 100, averageDailyUnits: 2, unitPrice: 32, unitCost: 10, unitsSold120d: 210, daysSinceLastSale: 0 },
    ],
    customers,
    checkouts: [],
    orders: [],
    productPairs: [{ productId: 'p1', relatedProductId: 'p2', coPurchaseRate: 0.42, productPrice: 68, relatedProductPrice: 32 }],
    last30dRevenue: 14_760,
    previous30dRevenue: 14_760,
    last30dOrders: 360,
    previous30dOrders: 360,
  }
}

type Harness = Readonly<{ base: string; repository: InMemoryInsightsHubRepository }>

async function withServer<T>(plan: PlanTier, handler: (harness: Harness) => Promise<T>, options: Readonly<{ rateLimit?: number; env?: Readonly<Record<string, string | undefined>> }> = {}): Promise<T> {
  const analytics = new InMemoryAnalyticsRepository()
  seedAnalytics(analytics)
  const repository = new InMemoryInsightsHubRepository()
  const env = insightsHubEnvConfig({ ...options.env })
  const service = new InsightsHubService({
    dataset: { snapshot: async () => snapshotFixture(), analytics, orders: null },
    repository,
    plan: async () => plan,
    billingState: async () => null,
    narrator: null,
    env,
  })
  const deps: { service: InsightsHubService; env: typeof env; rateLimiter?: InsightsRateLimiter } = { service, env }
  if (options.rateLimit !== undefined) deps.rateLimiter = new InsightsRateLimiter(options.rateLimit)
  const app = createApi({ logger: new Logger(), readinessChecks: [], insightsHub: deps })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler({ base: `http://127.0.0.1:${address.port}`, repository }) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

const getJson = async (base: string, path: string, headers: Record<string, string> = {}) => {
  const response = await fetch(`${base}${path}`, { headers })
  return { status: response.status, body: await response.json() as { ok: boolean; data: never; error?: { code: string; details: Record<string, unknown> } } }
}
const postJson = async (base: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() as { ok: boolean; data: never; error?: { code: string; message: string; details: Record<string, unknown> } } }
}

describe('Insights Hub — overview and usage', () => {
  it('returns the overview envelope with plan, features, counts, and readiness', async () => withServer('growth', async ({ base }) => {
    const { status, body } = await getJson(base, `/insights/overview?storeId=${STORE}`)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    const data = body.data as { plan: string; features: Record<string, boolean>; readiness: { revenueDays: number; canPersonas: boolean }; usage: { discoveries: { limit: number } }; counts: Record<string, number>; trial: boolean }
    expect(data.plan).toBe('growth')
    expect(data.features.apiAccess).toBe(false)
    expect(data.features.export).toBe(true)
    expect(data.readiness.revenueDays).toBe(90)
    expect(data.readiness.canPersonas).toBe(true)
    expect(data.usage.discoveries.limit).toBe(20)
    expect(data.trial).toBe(false)
  }))

  it('runs auto-discovery once when due for a paid plan', async () => withServer('start', async ({ base }) => {
    const { body } = await getJson(base, `/insights/overview?storeId=${STORE}`)
    const data = body.data as { autoDiscoveryRan: boolean; counts: { totalDiscoveries: number } }
    expect(data.autoDiscoveryRan).toBe(true)
    expect(data.counts.totalDiscoveries).toBeGreaterThan(0)
  }))

  it('skips auto-discovery on trial', async () => withServer('trial', async ({ base }) => {
    const { body } = await getJson(base, `/insights/overview?storeId=${STORE}`)
    expect((body.data as { autoDiscoveryRan: boolean }).autoDiscoveryRan).toBe(false)
  }))

  it('reports usage meters with warning/block flags', async () => withServer('start', async ({ base }) => {
    const { status, body } = await getJson(base, `/insights/usage?storeId=${STORE}`)
    expect(status).toBe(200)
    const meters = (body.data as { meters: { feature: string; limit: number | null }[] }).meters
    expect(meters.map((meter) => meter.feature)).toContain('insights_discoveries_month')
    expect(meters[0]?.limit).toBe(5)
  }))

  it('honestly reports the $0 free-model cost summary', async () => withServer('growth', async ({ base }) => {
    const { body } = await getJson(base, `/insights/cost-summary?storeId=${STORE}`)
    const data = body.data as { estimatedCostUsd: number; models: string[] }
    expect(data.estimatedCostUsd).toBe(0)
    expect(data.models).toContain('nvidia/nemotron-3.5-lightning:free')
  }))
})

describe('Insights Hub — discoveries', () => {
  it('gives trial users exactly one clearly-labeled sample', async () => withServer('trial', async ({ base }) => {
    const { status, body } = await getJson(base, `/insights/discoveries/feed?storeId=${STORE}`)
    expect(status).toBe(200)
    const data = body.data as { trial: boolean; discoveries: { sample: boolean; title: string }[] }
    expect(data.trial).toBe(true)
    expect(data.discoveries).toHaveLength(1)
    expect(data.discoveries[0]?.sample).toBe(true)
  }))

  it('blocks trial generation with a 402 Upgrade Plan (never a plan name)', async () => withServer('trial', async ({ base }) => {
    const { status, body } = await postJson(base, '/insights/discoveries/generate', { storeId: STORE })
    expect(status).toBe(402)
    expect(body.error?.code).toBe('PAYMENT_REQUIRED')
    expect(body.error?.details.reason).toBe('UPGRADE_REQUIRED')
    expect(body.error?.details.cta).toBe('Upgrade Plan')
    expect(body.error?.message).not.toContain('Upgrade to')
  }))

  it('generates real discoveries from synced data on paid plans', async () => withServer('growth', async ({ base }) => {
    const created = await postJson(base, '/insights/discoveries/generate', { storeId: STORE })
    expect(created.status).toBe(201)
    const result = created.body.data as { generated: number; discoveries: { id: string; sample: boolean; confidenceScore: number }[] }
    expect(result.generated).toBeGreaterThan(0)
    expect(result.discoveries.every((discovery) => discovery.sample === false)).toBe(true)
    expect(result.discoveries.every((discovery) => discovery.confidenceScore >= 0.7)).toBe(true)
    const list = await getJson(base, `/insights/discoveries?storeId=${STORE}&status=NEW`)
    expect((list.body.data as { items: unknown[] }).items.length).toBeGreaterThan(0)
  }))

  it('enforces the monthly discovery cap with upgrade context', async () => withServer('start', async ({ base }) => {
    const first = await postJson(base, '/insights/discoveries/generate', { storeId: STORE })
    expect(first.status).toBe(201)
    const second = await postJson(base, '/insights/discoveries/generate', { storeId: STORE })
    if ((first.body.data as { generated: number }).generated >= 5) {
      expect(second.status).toBe(402)
      expect(second.body.error?.details.limit).toBe(5)
      expect(second.body.error?.details.cta).toBe('Upgrade Plan')
    } else {
      expect(second.status).toBe(201)
    }
  }))

  it('supports discovery detail and status transitions', async () => withServer('growth', async ({ base, repository }) => {
    await postJson(base, '/insights/discoveries/generate', { storeId: STORE })
    const list = await repository.listDiscoveries(STORE as StoreId, { limit: 1, cursor: 0 })
    const id = list[0]?.id ?? ''
    const detail = await getJson(base, `/insights/discoveries/${id}?storeId=${STORE}`)
    expect(detail.status).toBe(200)
    const updated = await postJson(base, `/insights/discoveries/${id}/status`, { storeId: STORE, status: 'SAVED' })
    expect(updated.status).toBe(200)
    expect((updated.body.data as { status: string }).status).toBe('SAVED')
    const acted = await postJson(base, `/insights/discoveries/${id}/status`, { storeId: STORE, status: 'ACTED_ON' })
    expect((acted.body.data as { actionTakenAt: string | null }).actionTakenAt).not.toBeNull()
    await repository.setDiscoveryStatus(STORE as StoreId, id, 'DISMISSED', new Date().toISOString())
  }))

  it('404s unknown discovery ids and validates status values', async () => withServer('growth', async ({ base }) => {
    expect((await getJson(base, `/insights/discoveries/disc_nope?storeId=${STORE}`)).status).toBe(404)
    expect((await postJson(base, '/insights/discoveries/disc_nope/status', { storeId: STORE, status: 'LOST' })).status).toBe(400)
  }))
})

describe('Insights Hub — lessons', () => {
  it('blocks lesson generation for trial with a 402', async () => withServer('trial', async ({ base }) => {
    const { status } = await postJson(base, '/insights/lessons/generate', { storeId: STORE })
    expect(status).toBe(402)
    const list = await getJson(base, `/insights/lessons?storeId=${STORE}`)
    const items = (list.body.data as { items: { sample: boolean }[] }).items
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((lesson) => lesson.sample)).toBe(true)
  }))

  it('generates personalized lessons with read, rate, and bookmark flows', async () => withServer('growth', async ({ base }) => {
    const generated = await postJson(base, '/insights/lessons/generate', { storeId: STORE, category: 'TIME' })
    expect(generated.status).toBe(201)
    const lessons = (generated.body.data as { lessons: { id: string; personalized: boolean; contentMarkdown: string }[] }).lessons
    expect(lessons.length).toBeGreaterThan(0)
    expect(lessons[0]?.personalized).toBe(true)
    expect(lessons[0]?.contentMarkdown).toContain('##')
    const id = lessons[0]?.id ?? ''
    expect((await postJson(base, `/insights/lessons/${id}/read`, { storeId: STORE })).status).toBe(200)
    expect((await postJson(base, `/insights/lessons/${id}/rate`, { storeId: STORE, rating: 5 })).status).toBe(200)
    expect((await postJson(base, `/insights/lessons/${id}/rate`, { storeId: STORE, rating: 9 })).status).toBe(400)
    expect(((await postJson(base, `/insights/lessons/${id}/bookmark`, { storeId: STORE, bookmarked: true })).body.data as { bookmarked: boolean }).bookmarked).toBe(true)
    const recommended = await getJson(base, `/insights/lessons/recommended?storeId=${STORE}`)
    expect(recommended.status).toBe(200)
  }))
})

describe('Insights Hub — patterns', () => {
  it('marks the pattern lab view-only for trials and blocks detection', async () => withServer('trial', async ({ base }) => {
    const list = await getJson(base, `/insights/patterns?storeId=${STORE}`)
    expect((list.body.data as { viewOnly: boolean }).viewOnly).toBe(true)
    expect((await postJson(base, '/insights/patterns/detect', { storeId: STORE })).status).toBe(402)
  }))

  it('detects real patterns, supports alerts and invalidation', async () => withServer('growth', async ({ base }) => {
    const detection = await postJson(base, '/insights/patterns/detect', { storeId: STORE })
    expect(detection.status).toBe(201)
    const patterns = (detection.body.data as { patterns: { id: string; patternType: string; confidenceScore: number }[] }).patterns
    expect(patterns.length).toBeGreaterThan(0)
    expect(new Set(patterns.map((pattern) => pattern.patternType)).size).toBeGreaterThan(2)
    const id = patterns[0]?.id ?? ''
    const alerted = await postJson(base, `/insights/patterns/${id}/alert`, { storeId: STORE, enabled: true })
    expect((alerted.body.data as { alertsEnabled: boolean }).alertsEnabled).toBe(true)
    const detail = await getJson(base, `/insights/patterns/${id}?storeId=${STORE}`)
    expect(detail.status).toBe(200)
    const removed = await fetch(`${base}/insights/patterns/${id}?storeId=${STORE}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
  }))

  it('re-detecting increments occurrence counts instead of duplicating', async () => withServer('growth', async ({ base, repository }) => {
    await postJson(base, '/insights/patterns/detect', { storeId: STORE })
    await postJson(base, '/insights/patterns/detect', { storeId: STORE })
    const patterns = await repository.listPatterns(STORE as StoreId, null)
    expect(patterns.some((pattern) => pattern.occurrenceCount >= 2)).toBe(true)
  }))
})

describe('Insights Hub — personas', () => {
  it('blocks persona generation for trial with 402 but reports readiness', async () => withServer('trial', async ({ base }) => {
    expect((await postJson(base, '/insights/personas/generate', { storeId: STORE })).status).toBe(402)
    const list = await getJson(base, `/insights/personas?storeId=${STORE}`)
    const data = list.body.data as { personas: unknown[]; readiness: { customerCount: number } }
    expect(data.personas).toEqual([])
    expect(data.readiness.customerCount).toBe(80)
  }))

  it('builds RFM personas from real customers with anonymized samples', async () => withServer('start', async ({ base }) => {
    const generated = await postJson(base, '/insights/personas/generate', { storeId: STORE })
    expect(generated.status).toBe(201)
    const personas = (generated.body.data as { personas: { id: string; personaName: string; percentageOfCustomers: number }[] }).personas
    expect(personas.length).toBeGreaterThan(0)
    expect(personas.length).toBeLessThanOrEqual(2) // start plan cap
    const id = personas[0]?.id ?? ''
    const sample = await getJson(base, `/insights/personas/${id}/customers?storeId=${STORE}`)
    const sampleData = sample.body.data as { anonymizedSample: string[]; aggregate: { avgLifetimeValue: number } }
    expect(sampleData.anonymizedSample.join(' ')).not.toContain('@')
    expect(sampleData.aggregate.avgLifetimeValue).toBeGreaterThan(0)
  }))
})

describe('Insights Hub — why? investigations', () => {
  it('blocks trial investigations and meters the start quota', async () => withServer('start', async ({ base }) => {
    // start allows 3/month
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await postJson(base, '/insights/investigations', { storeId: STORE, question: `Why did revenue move? (attempt ${attempt})` })
      expect(response.status).toBe(201)
    }
    const blocked = await postJson(base, '/insights/investigations', { storeId: STORE, question: 'Why did revenue move again beyond the quota?' })
    expect(blocked.status).toBe(402)
    expect(blocked.body.error?.details.limit).toBe(3)
  }))

  it('blocks trial questions with 402', async () => withServer('trial', async ({ base }) => {
    const blocked = await postJson(base, '/insights/investigations', { storeId: STORE, question: 'Why did revenue change?' })
    expect(blocked.status).toBe(402)
  }))

  it('returns ranked root causes with evidence for real questions', async () => withServer('growth', async ({ base }) => {
    const created = await postJson(base, '/insights/investigations', { storeId: STORE, question: 'Why did my revenue change this month?' })
    expect(created.status).toBe(201)
    const investigation = created.body.data as { id: string; status: string; rootCauses: { cause: string; impactShare: number; evidence: string }[]; steps: string[]; dataSourcesAnalyzed: string[]; whatToDo: string[] }
    expect(investigation.status).toBe('COMPLETED')
    expect(investigation.steps.length).toBeGreaterThanOrEqual(3)
    expect(investigation.dataSourcesAnalyzed.length).toBeGreaterThan(0)
    expect(investigation.whatToDo.length).toBeGreaterThan(0)
    const detail = await getJson(base, `/insights/investigations/${investigation.id}?storeId=${STORE}`)
    expect(detail.status).toBe(200)
    expect((await postJson(base, `/insights/investigations/${investigation.id}/rate`, { storeId: STORE, rating: 4 })).status).toBe(200)
    const list = await getJson(base, `/insights/investigations?storeId=${STORE}&limit=5`)
    expect((list.body.data as { items: unknown[] }).items).toHaveLength(1)
  }))

  it('rejects empty and oversized questions', async () => withServer('growth', async ({ base }) => {
    expect((await postJson(base, '/insights/investigations', { storeId: STORE, question: '  ' })).status).toBe(400)
    expect((await postJson(base, '/insights/investigations', { storeId: STORE, question: 'x'.repeat(401) })).status).toBe(400)
  }))
})

describe('Insights Hub — trends', () => {
  it('lists business trends computed from real data', async () => withServer('growth', async ({ base }) => {
    const { status, body } = await getJson(base, `/insights/trends?storeId=${STORE}&type=all`)
    expect(status).toBe(200)
    const trends = (body.data as { trends: { trendType: string; direction: string; magnitude: number; dataSource: string }[] }).trends
    expect(trends.length).toBeGreaterThan(0)
    expect(trends.every((trend) => trend.dataSource === 'INTERNAL')).toBe(true)
    const business = await getJson(base, `/insights/trends/business?storeId=${STORE}`)
    expect(business.status).toBe(200)
  }))

  it('answers market trends honestly (no external feed = no invented data)', async () => withServer('growth', async ({ base }) => {
    const { status, body } = await getJson(base, `/insights/trends/market?storeId=${STORE}`)
    expect(status).toBe(200)
    const data = body.data as { available: boolean; message: string; trends: unknown[] }
    expect(data.available).toBe(false)
    expect(data.trends).toEqual([])
    expect(data.message.toLowerCase()).toContain('never invents')
  }))

  it('gates market trends for trial with a 402', async () => withServer('trial', async ({ base }) => {
    expect((await getJson(base, `/insights/trends/market?storeId=${STORE}`)).status).toBe(402)
  }))

  it('gates trend alerts by plan and toggles them on growth', async () => withServer('growth', async ({ base }) => {
    const trends = (await getJson(base, `/insights/trends?storeId=${STORE}`)).body.data as { trends: { id: string }[] }
    const id = trends.trends[0]?.id ?? ''
    const toggled = await postJson(base, `/insights/trends/${id}/alert`, { storeId: STORE, enabled: true })
    expect((toggled.body.data as { alertsEnabled: boolean }).alertsEnabled).toBe(true)
  }))

  it('blocks trend alerts on start plan', async () => withServer('start', async ({ base }) => {
    const trends = (await getJson(base, `/insights/trends?storeId=${STORE}`)).body.data as { trends: { id: string }[] }
    if (trends.trends[0]) {
      const blocked = await postJson(base, `/insights/trends/${trends.trends[0].id}/alert`, { storeId: STORE, enabled: true })
      expect(blocked.status).toBe(402)
    }
  }))
})

describe('Insights Hub — comparisons', () => {
  it('creates product comparisons with a winner on start', async () => withServer('start', async ({ base }) => {
    const created = await postJson(base, '/insights/comparisons', { storeId: STORE, comparisonType: 'PRODUCT', subjectA: 'p1', subjectB: 'p2' })
    expect(created.status).toBe(201)
    const comparison = created.body.data as { id: string; winner: string; metrics: { metric: string }[] }
    expect(comparison.winner).toBe('A')
    expect(comparison.metrics.length).toBeGreaterThan(0)
    const list = await getJson(base, `/insights/comparisons?storeId=${STORE}&type=PRODUCT`)
    expect((list.body.data as { items: unknown[] }).items).toHaveLength(1)
    const detail = await getJson(base, `/insights/comparisons/${comparison.id}?storeId=${STORE}`)
    expect(detail.status).toBe(200)
    const removed = await fetch(`${base}/insights/comparisons/${comparison.id}?storeId=${STORE}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
  }))

  it('gates comparison types not in the plan (segment on start → 402)', async () => withServer('start', async ({ base }) => {
    const blocked = await postJson(base, '/insights/comparisons', { storeId: STORE, comparisonType: 'SEGMENT', subjectA: 'REPEAT', subjectB: 'ONE_TIME' })
    expect(blocked.status).toBe(402)
    expect(blocked.body.error?.details.cta).toBe('Upgrade Plan')
  }))

  it('validates comparison types and subject presence', async () => withServer('growth', async ({ base }) => {
    expect((await postJson(base, '/insights/comparisons', { storeId: STORE, comparisonType: 'MOON', subjectA: 'a', subjectB: 'b' })).status).toBe(400)
    expect((await postJson(base, '/insights/comparisons', { storeId: STORE, comparisonType: 'PRODUCT', subjectA: 'p1' })).status).toBe(400)
  }))

  it('trial cannot create comparisons', async () => withServer('trial', async ({ base }) => {
    expect((await postJson(base, '/insights/comparisons', { storeId: STORE, comparisonType: 'PRODUCT', subjectA: 'p1', subjectB: 'p2' })).status).toBe(402)
  }))
})

describe('Insights Hub — knowledge base', () => {
  it('supports full CRUD with AI tag suggestions and search', async () => withServer('growth', async ({ base }) => {
    const created = await postJson(base, '/insights/knowledge', { storeId: STORE, entryType: 'NOTE', title: 'Saturday revenue pattern', contentMarkdown: 'Customers buy more on Saturdays. #revenue' })
    expect(created.status).toBe(201)
    const entry = created.body.data as { id: string; tags: string[]; author: string }
    expect(entry.author).toBe('MERCHANT')
    expect(entry.tags).toContain('revenue')
    const fetched = await getJson(base, `/insights/knowledge/${entry.id}?storeId=${STORE}`)
    expect(fetched.status).toBe(200)
    const patched = await fetch(`${base}/insights/knowledge/${entry.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: STORE, title: 'Saturday revenue pattern (updated)' }) })
    expect(patched.status).toBe(200)
    const search = await postJson(base, '/insights/knowledge/search', { storeId: STORE, q: 'saturday' })
    expect((search.body.data as { items: unknown[] }).items.length).toBeGreaterThan(0)
    const removed = await fetch(`${base}/insights/knowledge/${entry.id}?storeId=${STORE}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    expect((await getJson(base, `/insights/knowledge/${entry.id}?storeId=${STORE}`)).status).toBe(404)
  }))

  it('blocks knowledge creation for trial', async () => withServer('trial', async ({ base }) => {
    expect((await postJson(base, '/insights/knowledge', { storeId: STORE, title: 'Note' })).status).toBe(402)
  }))
})

describe('Insights Hub — timeline', () => {
  it('returns chronologically ordered events after generation activity', async () => withServer('growth', async ({ base }) => {
    await postJson(base, '/insights/discoveries/generate', { storeId: STORE })
    const { status, body } = await getJson(base, `/insights/timeline?storeId=${STORE}&days=30`)
    expect(status).toBe(200)
    const events = (body.data as { events: { eventAt: string; entityType: string }[] }).events
    expect(events.length).toBeGreaterThan(0)
    for (let index = 1; index < events.length; index += 1) expect(events[index - 1]!.eventAt >= events[index]!.eventAt).toBe(true)
    const filtered = await getJson(base, `/insights/timeline/filter?storeId=${STORE}&type=DISCOVERY`)
    expect((filtered.body.data as { events: { entityType: string }[] }).events.every((event) => event.entityType === 'DISCOVERY')).toBe(true)
  }))

  it('402s requests beyond the plan history window', async () => withServer('trial', async ({ base }) => {
    const { status } = await getJson(base, `/insights/timeline?storeId=${STORE}&days=30`)
    expect(status).toBe(402)
  }))

  it('allows commander unlimited history', async () => withServer('commander', async ({ base }) => {
    expect((await getJson(base, `/insights/timeline?storeId=${STORE}&days=365`)).status).toBe(200)
  }))
})

describe('Insights Hub — predictions', () => {
  it('generates 7-day forecasts on start and validates accuracy', async () => withServer('start', async ({ base }) => {
    const generated = await postJson(base, '/insights/predictions/generate', { storeId: STORE })
    expect(generated.status).toBe(201)
    const predictions = (generated.body.data as { predictions: { id: string; horizon: string; predictedValue: number }[] }).predictions
    expect(predictions.length).toBeGreaterThan(0)
    expect(predictions.every((prediction) => prediction.horizon === '7_DAYS')).toBe(true)
    const id = predictions[0]?.id ?? ''
    const validated = await postJson(base, `/insights/predictions/${id}/validate`, { storeId: STORE, actualValue: 420 })
    expect(validated.status).toBe(200)
    expect((validated.body.data as { accuracyScore: number | null }).accuracyScore).not.toBeNull()
  }))

  it('supports 30/90-day horizons on commander only', async () => withServer('commander', async ({ base }) => {
    const generated = await postJson(base, '/insights/predictions/generate', { storeId: STORE })
    const horizons = new Set((generated.body.data as { predictions: { horizon: string }[] }).predictions.map((prediction) => prediction.horizon))
    expect(horizons.has('7_DAYS')).toBe(true)
    expect(horizons.has('30_DAYS')).toBe(true)
    expect(horizons.has('90_DAYS')).toBe(true)
    const list = await getJson(base, `/insights/predictions?storeId=${STORE}&horizon=90_DAYS`)
    expect(((list.body.data as { predictions: unknown[] }).predictions).length).toBeGreaterThan(0)
    expect((await getJson(base, `/insights/predictions?storeId=${STORE}&horizon=MOON`)).status).toBe(400)
  }))

  it('blocks predictions for trial', async () => withServer('trial', async ({ base }) => {
    expect((await postJson(base, '/insights/predictions/generate', { storeId: STORE })).status).toBe(402)
    const list = await getJson(base, `/insights/predictions?storeId=${STORE}`)
    expect((list.body.data as { predictions: unknown[] }).predictions).toEqual([])
  }))
})

describe('Insights Hub — preferences', () => {
  it('returns documented defaults and accepts valid patches', async () => withServer('growth', async ({ base }) => {
    const defaults = await getJson(base, `/insights/preferences?storeId=${STORE}`)
    expect((defaults.body.data as { discoveryFrequency: string }).discoveryFrequency).toBe('DAILY')
    const patched = await fetch(`${base}/insights/preferences`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: STORE, discoveryFrequency: 'WEEKLY', trendMonitoringEnabled: false, notificationPreferences: { weeklyDigest: true } }) })
    expect(patched.status).toBe(200)
    const data = (await patched.json()).data as { discoveryFrequency: string; trendMonitoringEnabled: boolean; notificationPreferences: { weeklyDigest: boolean } }
    expect(data.discoveryFrequency).toBe('WEEKLY')
    expect(data.trendMonitoringEnabled).toBe(false)
    expect(data.notificationPreferences.weeklyDigest).toBe(true)
  }))

  it('rejects invalid frequency and realtime for non-commander plans', async () => withServer('growth', async ({ base }) => {
    expect((await fetch(`${base}/insights/preferences`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: STORE, discoveryFrequency: 'HOURLY' }) })).status).toBe(400)
    expect((await fetch(`${base}/insights/preferences`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: STORE, discoveryFrequency: 'REALTIME' }) })).status).toBe(402)
  }))

  it('accepts REALTIME frequency on commander', async () => withServer('commander', async ({ base }) => {
    expect((await fetch(`${base}/insights/preferences`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: STORE, discoveryFrequency: 'REALTIME' }) })).status).toBe(200)
  }))
})

describe('Insights Hub — API access (Commander only)', () => {
  it('blocks key generation on growth with 402', async () => withServer('growth', async ({ base }) => {
    expect((await postJson(base, '/insights/api-access/generate-key', { storeId: STORE })).status).toBe(402)
  }))

  it('generates an API key, authenticates public calls, and tracks usage', async () => withServer('commander', async ({ base }) => {
    const generated = await postJson(base, '/insights/api-access/generate-key', { storeId: STORE })
    expect(generated.status).toBe(201)
    const key = (generated.body.data as { apiKey: string; masked: string }).apiKey
    expect(key.startsWith('ihk_')).toBe(true)
    expect((generated.body.data as { masked: string }).masked).not.toBe(key)

    const keyStatus = await getJson(base, `/insights/api-access/key?storeId=${STORE}`)
    expect((keyStatus.body.data as { maskedKey: string }).maskedKey).toContain('ihk_')

    await postJson(base, '/insights/discoveries/generate', { storeId: STORE })
    const publicFeed = await fetch(`${base}/public-api/insights/discoveries`, { headers: { authorization: `Bearer ${key}` } })
    expect(publicFeed.status).toBe(200)
    const publicPatterns = await fetch(`${base}/public-api/insights/patterns`, { headers: { authorization: `Bearer ${key}` } })
    expect(publicPatterns.status).toBe(200)
    const publicPersonas = await fetch(`${base}/public-api/insights/personas`, { headers: { authorization: `Bearer ${key}` } })
    expect(publicPersonas.status).toBe(200)
    const publicPredictions = await fetch(`${base}/public-api/insights/predictions`, { headers: { authorization: `Bearer ${key}` } })
    expect(publicPredictions.status).toBe(200)
    const publicTrends = await fetch(`${base}/public-api/insights/trends`, { headers: { authorization: `Bearer ${key}` } })
    expect(publicTrends.status).toBe(200)

    const usage = await getJson(base, `/insights/api-access/usage?storeId=${STORE}`)
    const usageData = usage.body.data as { usage: { requestsThisHour: number }; recent: { endpoint: string }[] }
    expect(usageData.usage.requestsThisHour).toBe(5)
    expect(usageData.recent.length).toBeGreaterThan(0)

    // Regeneration invalidates the old key immediately.
    const regenerated = await postJson(base, '/insights/api-access/regenerate', { storeId: STORE })
    expect(regenerated.status).toBe(201)
    const oldKeyCall = await fetch(`${base}/public-api/insights/discoveries`, { headers: { authorization: `Bearer ${key}` } })
    expect(oldKeyCall.status).toBe(401)
  }))

  it('rejects missing and invalid Bearer keys on the public API', async () => withServer('commander', async ({ base }) => {
    expect((await fetch(`${base}/public-api/insights/discoveries`)).status).toBe(401)
    expect((await fetch(`${base}/public-api/insights/discoveries`, { headers: { authorization: 'Bearer ihk_wrong' } })).status).toBe(401)
  }))

  it('serves the OpenAPI description of the public API', async () => withServer('commander', async ({ base }) => {
    const spec = await getJson(base, '/public-api/insights/openapi.json')
    expect(spec.status).toBe(200)
    const data = spec.body.data as { openapi: string; paths: Record<string, unknown> }
    expect(data.openapi).toBe('3.1.0')
    expect(Object.keys(data.paths)).toContain('/public-api/insights/discoveries')
    const docs = await getJson(base, `/insights/api-access/documentation?storeId=${STORE}`)
    expect(docs.status).toBe(200)
  }))
})

describe('Insights Hub — rate limiting and kill switch', () => {
  it('enforces 25 req/min per store (tested with a small test limit)', async () => withServer('growth', async ({ base }) => {
    expect((await getJson(base, `/insights/usage?storeId=${STORE}`)).status).toBe(200)
    expect((await getJson(base, `/insights/usage?storeId=${STORE}`)).status).toBe(200)
    const limited = await getJson(base, `/insights/usage?storeId=${STORE}`)
    expect(limited.status).toBe(429)
    expect(limited.body.error?.details.retryAfterSeconds).toBeGreaterThan(0)
  }, { rateLimit: 2 }))

  it('503s every endpoint when INSIGHTS_HUB_ENABLED=false', async () => withServer('growth', async ({ base }) => {
    expect((await getJson(base, `/insights/overview?storeId=${STORE}`)).status).toBe(503)
  }, { env: { INSIGHTS_HUB_ENABLED: 'false' } }))
})
