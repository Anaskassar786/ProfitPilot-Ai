import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { BillingRepository } from '@profitpilot/billing'
import { Logger } from '@profitpilot/logger'
import { storeId } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { createApi } from './app.js'
import {
  CustomerFeatureLockedError,
  CustomerInsightsService,
  CustomerService,
  InMemoryCustomerInsightAudit,
  InMemoryCustomerInsightUsage,
  parseCustomerFilters,
} from './customer-insights.js'
import { classifyCustomerSegments, normalizeCustomer } from './customers.js'
import type { CustomerCoverage, CustomerDataset, CustomerRepository, CustomerView } from './customers.js'

const TENANT = storeId('customer-insights-store')
const NOW = Date.parse('2026-08-16T12:00:00Z')
const COVERAGE: CustomerCoverage = { ordersSyncCompleted: true, knownComplete90Days: true, cutoffDate: '2026-04-01T00:00:00.000Z', lastCompletedSyncAt: '2026-08-16T00:00:00.000Z', explanation: 'Known coverage' }
const generation = { text: 'Review the 2 churn-risk customers.', model: 'free-model', keyIndex: 0, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, attempts: 1 }

function billing(plan: PlanTier): Pick<BillingRepository, 'get'> { return { async get() { return { storeId: TENANT, state: 'ACTIVE_MONTHLY', plan, currentPeriodEnd: null, version: 0, priceLockedAt: null, grandfathered: false, interval: 'MONTHLY', chargeId: null } } } }
function rawCustomer(id: string, spent: number, orders: number, extras: Readonly<Record<string, unknown>> = {}): CustomerView {
  return normalizeCustomer(id, { id, first_name: `Real${id}`, last_name: 'Customer', email: `${id}@example.com`, phone: `+9199900000${id}`, email_marketing_consent: { state: 'subscribed' }, total_spent: spent, orders_count: orders, created_at: '2026-08-01T00:00:00Z', ...extras }, new Date('2026-08-16T00:00:00Z'), [], COVERAGE, NOW)
}
function dataset(): CustomerDataset {
  const customers = classifyCustomerSegments([
    { ...rawCustomer('1', 1000, 3), lastOrderAt: '2026-05-01T00:00:00Z', activity: 'inactive' },
    { ...rawCustomer('2', 500, 2), lastOrderAt: '2026-05-02T00:00:00Z', activity: 'inactive' },
    { ...rawCustomer('3', 100, 1), lastOrderAt: '2026-08-10T00:00:00Z', activity: 'active' },
    rawCustomer('4', 50, 0),
    rawCustomer('5', 25, 0),
  ], COVERAGE, NOW)
  return { customers, coverage: COVERAGE }
}
function repository(data = dataset()): CustomerRepository { return { async list() { return data }, async get(_store, id) { return data.customers.find((customer) => customer.id === id) ?? null } } }
function fixture(plan: PlanTier, provider: Pick<import('@profitpilot/ai').OpenRouterClient, 'generate'> = { async generate() { return generation } }) {
  const audit = new InMemoryCustomerInsightAudit()
  const usage = new InMemoryCustomerInsightUsage()
  const rows = repository()
  return { customers: new CustomerService(rows, billing(plan), audit, () => NOW), insights: new CustomerInsightsService(rows, billing(plan), usage, audit, provider, null, () => NOW), audit, usage }
}

describe('customer list plan isolation', () => {
  it.each(['trial', 'start'] as const)('never exposes premium membership to %s', async (plan) => {
    const result = await fixture(plan).customers.list(TENANT, parseCustomerFilters({}))
    expect(result.customers).toHaveLength(5)
    expect(result.customers.every((customer) => customer.segments.length === 0 && customer.primarySegment === null && customer.purchasePattern === null)).toBe(true)
    expect(result.lockedFilters).toHaveLength(3)
    expect(result.stats).toMatchObject({ total: 5, active: 1, inactive: 4, newCustomersLast30Days: 5 })
    expect(JSON.stringify(result)).not.toContain('churnRisk')
  })

  it('returns exact 403 lock metadata before repository reads for a premium filter', async () => {
    let reads = 0
    const audit = new InMemoryCustomerInsightAudit()
    const service = new CustomerService({ async list() { reads += 1; return dataset() }, async get() { return null } }, billing('start'), audit)
    await expect(service.list(TENANT, parseCustomerFilters({ segment: 'vip' }))).rejects.toMatchObject({ status: 403, details: { locked: true, feature: 'premium_segments', required_plan: 'growth' } } satisfies Partial<CustomerFeatureLockedError>)
    expect(reads).toBe(0)
    expect(audit.entries).toHaveLength(1)
  })

  it('allows basic Inactive filtering while keeping Unknown customers out', async () => {
    const result = await fixture('trial').customers.list(TENANT, parseCustomerFilters({ segment: 'inactive' }))
    expect(result.customers.map((customer) => customer.id)).toEqual(['1', '2', '4', '5'])
    expect(result.customers.every((customer) => customer.activity === 'inactive')).toBe(true)
  })

  it('returns premium segments for Growth and stable search/sort/pagination', async () => {
    const result = await fixture('growth').customers.list(TENANT, parseCustomerFilters({ segment: 'churn_risk', sort: 'spent', direction: 'desc', limit: '1' }))
    expect(result.customers).toHaveLength(1)
    expect(result.customers[0]).toMatchObject({ id: '1', primarySegment: 'churn_risk' })
    expect(result.pagination).toMatchObject({ total: 2, limit: 1, pages: 2 })
    expect(result.lockedFilters).toHaveLength(0)
  })
})

describe('plan-enforced customer intelligence', () => {
  it.each([
    ['trial', 0, 6], ['start', 0, 6], ['growth', 3, 3], ['commander', 6, 0],
  ] as const)('returns only entitled aggregate insights for %s', async (plan, available, locked) => {
    const result = await fixture(plan).insights.get(TENANT)
    expect(result.available).toHaveLength(available)
    expect(result.locked).toHaveLength(locked)
    expect(result.locked.every((item) => Object.keys(item).sort().join(',') === 'feature,locked,name,required_plan')).toBe(true)
  })

  it('enforces Growth twenty-per-day generation usage', async () => {
    const item = fixture('growth')
    for (let count = 0; count < 20; count += 1) await item.usage.consume(TENANT, 20)
    let providerCalls = 0
    const insights = new CustomerInsightsService(repository(), billing('growth'), item.usage, item.audit, { async generate() { providerCalls += 1; return generation } })
    const result = await insights.get(TENANT, 'retention_suggestion')
    expect(result.available[0]?.data).toMatchObject({ status: 'limit_reached' })
    expect(result.usage).toMatchObject({ used: 20, limit: 20, remaining: 0, limitReached: true })
    expect(providerCalls).toBe(0)
  })

  it('returns locked features with display names for Trial plan', async () => {
    const result = await fixture('trial').insights.get(TENANT)
    expect(result.available).toHaveLength(0)
    expect(result.locked.length).toBeGreaterThanOrEqual(6)
    for (const item of result.locked) {
      expect(item.locked).toBe(true)
      expect(typeof item.name).toBe('string')
      expect(item.name.length).toBeGreaterThan(0)
      expect(['growth', 'commander']).toContain(item.required_plan)
    }
    const growthLocked = result.locked.filter((item) => item.required_plan === 'growth')
    const commanderLocked = result.locked.filter((item) => item.required_plan === 'commander')
    expect(growthLocked.length).toBeGreaterThanOrEqual(3)
    expect(commanderLocked.length).toBeGreaterThanOrEqual(2)
  })

  it('rechecks the plan before serving a five-minute cached insight', async () => {
    let plan: PlanTier = 'growth'
    let providerCalls = 0
    const audit = new InMemoryCustomerInsightAudit()
    const service = new CustomerInsightsService(repository(), { async get() { return { storeId: TENANT, state: 'ACTIVE_MONTHLY', plan, currentPeriodEnd: null, version: 0, priceLockedAt: null, grandfathered: false, interval: 'MONTHLY', chargeId: null } } }, new InMemoryCustomerInsightUsage(), audit, { async generate() { providerCalls += 1; return generation } }, null, () => NOW)
    expect((await service.get(TENANT, 'retention_suggestion')).cached).toBe(false)
    expect((await service.get(TENANT, 'retention_suggestion')).cached).toBe(true)
    plan = 'start'
    await expect(service.get(TENANT, 'retention_suggestion')).rejects.toMatchObject({ status: 403 })
    expect(providerCalls).toBe(1)
    expect(audit.entries).toHaveLength(1)
  })

  it('sends only aggregate facts and redacts known or pattern PII from custom questions', async () => {
    let systemPrompt = ''
    let userPrompt = ''
    const item = fixture('commander', { async generate(system, user) { systemPrompt = system; userPrompt = user; return generation } })
    await item.insights.query(TENANT, 'Why is Real1 Customer at 1@example.com or +91999000001 at risk?')
    expect(userPrompt).toContain('Customer count: 5')
    expect(systemPrompt).toContain('Never infer or request names')
    expect(userPrompt).not.toContain('Real1 Customer')
    expect(userPrompt).not.toContain('1@example.com')
    expect(userPrompt).not.toContain('+91999000001')
    expect(userPrompt).not.toContain('customer-insights-store')
  })

  it('rejects GET custom questions and overlong POST questions', async () => {
    const service = fixture('commander').insights
    await expect(service.get(TENANT, 'custom_ai_queries')).rejects.toMatchObject({ status: 400 })
    await expect(service.query(TENANT, 'x'.repeat(501))).rejects.toMatchObject({ status: 400 })
  })
})

describe('customer HTTP routes', () => {
  it('serves list/detail/insights and backend lock responses', async () => {
    const trial = fixture('trial')
    const app = createApi({ logger: new Logger(), readinessChecks: [], customers: { customers: trial.customers, insights: trial.insights } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
    const base = `http://127.0.0.1:${address.port}`
    try {
      const list = await fetch(`${base}/customers?storeId=${TENANT}`)
      expect(list.status).toBe(200)
      expect((await list.json()).data.pagination.total).toBe(5)
      const detail = await fetch(`${base}/customers/1?storeId=${TENANT}`)
      expect(detail.status).toBe(200)
      expect((await detail.json()).data.id).toBe('1')
      const locked = await fetch(`${base}/customers?storeId=${TENANT}&segment=vip`)
      expect(locked.status).toBe(403)
      expect((await locked.json()).error.details).toEqual({ locked: true, feature: 'premium_segments', required_plan: 'growth' })
      const insights = await fetch(`${base}/customers/insights?storeId=${TENANT}`)
      expect(insights.status).toBe(200)
      expect((await insights.json()).data.available).toHaveLength(0)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
