import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { BillingRepository } from '@profitpilot/billing'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { Logger } from '@profitpilot/logger'
import { storeId } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { createApi } from './app.js'
import {
  deriveOrderStatus,
  filterOrders,
  InMemoryOrderInsightAudit,
  InMemoryOrderInsightUsage,
  normalizeOrder,
  normalizePaymentStatus,
  OrderInsightsService,
  OrderInsightLockedError,
  parseOrderFilters,
  PostgresOrderRepository,
} from './orders.js'
import type { OrderRepository, OrderView } from './orders.js'

const TENANT = storeId('store-orders')

function rawOrder(id: number, extras: Readonly<Record<string, unknown>> = {}): OrderView {
  return normalizeOrder(String(id), {
    id,
    name: `#${id}`,
    order_number: id,
    created_at: `2026-08-${String(Math.max(1, Math.min(28, id))).padStart(2, '0')}T10:30:00+05:30`,
    financial_status: 'paid',
    fulfillment_status: null,
    total_price: String(id * 10),
    currency: 'INR',
    customer: { id: `customer-${id}`, first_name: `Customer${id}`, last_name: 'Real', email: `customer${id}@example.com`, phone: `+9199990000${id}` },
    line_items: [{ id: `line-${id}`, product_id: id % 2 ? 'product-a' : 'product-b', title: id % 2 ? 'Blue Shirt' : 'Green Hat', sku: `SKU-${id}`, quantity: id, price: '10.00' }],
    ...extras,
  }, new Date('2026-08-16T00:00:00Z'))
}

const generation = { text: 'Review 5 orders.', model: 'free-model', keyIndex: 0, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, attempts: 1 }
const provider = { async generate() { return generation } }
function repository(orders: readonly OrderView[]): OrderRepository { return { async list() { return orders }, async get(_store, id) { return orders.find((order) => order.id === id) ?? null } } }
function billing(plan: PlanTier): Pick<BillingRepository, 'get'> { return { async get() { return { storeId: TENANT, state: 'ACTIVE_MONTHLY', plan, currentPeriodEnd: null, version: 0, priceLockedAt: null, grandfathered: false, interval: 'MONTHLY', chargeId: null } } } }

function service(plan: PlanTier, orders: readonly OrderView[], usage = new InMemoryOrderInsightUsage(), audit = new InMemoryOrderInsightAudit()) {
  return { service: new OrderInsightsService(repository(orders), billing(plan), usage, audit, provider, null, () => Date.parse('2026-08-16T12:00:00Z')), usage, audit }
}

describe('Shopify order normalization', () => {
  it('uses exact canceled, completed, pending, and new precedence', () => {
    expect(deriveOrderStatus({ cancelledAt: '2026-08-01', fulfillmentStatus: 'fulfilled', financialStatus: 'paid' })).toBe('canceled')
    expect(deriveOrderStatus({ cancelledAt: null, fulfillmentStatus: 'fulfilled', financialStatus: 'pending' })).toBe('completed')
    expect(deriveOrderStatus({ cancelledAt: null, fulfillmentStatus: 'partial', financialStatus: 'paid' })).toBe('pending')
    expect(deriveOrderStatus({ cancelledAt: null, fulfillmentStatus: null, financialStatus: 'authorized' })).toBe('pending')
    expect(deriveOrderStatus({ cancelledAt: null, fulfillmentStatus: null, financialStatus: 'paid' })).toBe('new')
  })

  it.each([
    ['paid', 'paid'], ['pending', 'pending'], ['authorized', 'pending'], ['partially_paid', 'pending'],
    ['unpaid', 'not_paid'], ['voided', 'not_paid'], ['refunded', 'refunded'],
    ['partially_refunded', 'partially_refunded'], ['unexpected', 'unknown'], [null, 'unknown'],
  ] as const)('maps payment %s to %s', (input, expected) => expect(normalizePaymentStatus(input)).toBe(expected))

  it('normalizes full real fields and legacy nested payloads without inventing values', () => {
    const result = normalizeOrder('42', { id: '42', payload: JSON.stringify({ name: '#1042', financial_status: 'partially_refunded', fulfillment_status: 'partial', line_items: [{ title: 'Real product', quantity: 2, price: '9.50' }], shipping_address: { first_name: 'A', city: 'Moradabad' }, tags: 'one, two' }) }, new Date('2026-08-16T00:00:00Z'))
    expect(result.orderNumber).toBe('#1042')
    expect(result.paymentStatus).toBe('partially_refunded')
    expect(result.status).toBe('pending')
    expect(result.lineItems[0]).toMatchObject({ title: 'Real product', quantity: 2, price: 9.5 })
    expect(result.shippingAddress).toMatchObject({ firstName: 'A', city: 'Moradabad' })
    expect(result.tags).toEqual(['one', 'two'])
    expect(result.customer.name).toBe('A')
  })
})

describe('tenant-safe order persistence reads', () => {
  it('scopes list and detail SQL to the requested tenant and orders module', async () => {
    const calls: Array<Readonly<{ text: string; parameters: readonly unknown[] }>> = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string, parameters: readonly unknown[] = []) { calls.push({ text, parameters }); const row = { record_id: '9', payload: { id: 9, name: '#9', financial_status: 'paid' }, synced_at: new Date('2026-08-16T00:00:00Z') }; return { rows: [row as unknown as Row], rowCount: 1 } } }
    const persisted = new PostgresOrderRepository(executor)
    expect((await persisted.list(TENANT))[0]?.id).toBe('9')
    expect((await persisted.get(TENANT, '9'))?.orderNumber).toBe('#9')
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.text.includes("module = 'orders'") && call.text.includes('store_id = $1'))).toBe(true)
    expect(calls[0]?.parameters).toEqual([TENANT])
    expect(calls[1]?.parameters).toEqual([TENANT, '9'])
  })
})

describe('server-side order filtering', () => {
  const orders = [
    rawOrder(1, { cancelled_at: '2026-08-02T00:00:00Z' }),
    rawOrder(2, { fulfillment_status: 'fulfilled' }),
    rawOrder(3, { financial_status: 'pending' }),
    rawOrder(4),
  ]

  it('returns real global tab counts and combines search filters', () => {
    const result = filterOrders(orders, parseOrderFilters({ q: 'Customer2', product: 'Green Hat', payment: 'paid', sort: 'price', direction: 'asc', page: '1', limit: '2' }))
    expect(result.tabCounts).toEqual({ all: 4, new: 1, completed: 1, canceled: 1, pending: 1 })
    expect(result.orders.map((order) => order.id)).toEqual(['2'])
    expect(result.pagination).toMatchObject({ total: 1, page: 1, limit: 2 })
  })

  it('supports status, phone, order id, date, sort, and bounded pagination', () => {
    const result = filterOrders(orders, parseOrderFilters({ status: 'new', phone: '00004', orderId: '#4', dateFrom: '2026-08-04', dateTo: '2026-08-04', sort: 'price', direction: 'desc', page: '999', limit: '1000' }))
    expect(result.orders.map((order) => order.id)).toEqual(['4'])
    expect(result.pagination).toEqual({ total: 1, page: 1, limit: 100, pages: 1 })
  })

  it('returns a stable empty page instead of demo rows', () => {
    expect(filterOrders([], parseOrderFilters({}))).toEqual({ orders: [], tabCounts: { all: 0, new: 0, completed: 0, canceled: 0, pending: 0 }, pagination: { page: 1, limit: 20, total: 0, pages: 1 } })
  })
})

describe('plan-enforced order insights', () => {
  const orders = [rawOrder(1), rawOrder(2), rawOrder(3), rawOrder(4), rawOrder(5)]

  it.each([
    ['trial', 4, 7], ['start', 4, 7], ['growth', 8, 3], ['commander', 11, 0],
  ] as const)('returns only allowed data for %s', async (plan, available, locked) => {
    const fixture = service(plan, orders)
    const result = await fixture.service.get(TENANT)
    expect(result.available).toHaveLength(available)
    expect(result.locked).toHaveLength(locked)
    expect(result.locked.every((item) => item.locked && item.required_plan !== undefined)).toBe(true)
    if (result.locked[0]) expect(Object.keys(result.locked[0]).sort()).toEqual(['feature', 'locked', 'required_plan'])
    expect(fixture.audit.entries).toHaveLength(locked)
  })

  it('checks entitlement before reading orders and exposes exact 403 lock metadata', async () => {
    let reads = 0
    const audit = new InMemoryOrderInsightAudit()
    const lockedService = new OrderInsightsService({ async list() { reads += 1; return orders }, async get() { return null } }, billing('start'), new InMemoryOrderInsightUsage(), audit, provider)
    await expect(lockedService.get(TENANT, 'peak_times')).rejects.toMatchObject({ status: 403, details: { locked: true, feature: 'peak_times', required_plan: 'growth' } } satisfies Partial<OrderInsightLockedError>)
    expect(reads).toBe(0)
    expect(audit.entries).toHaveLength(1)
  })

  it('guards every advanced calculation below five real orders', async () => {
    const result = await service('commander', orders.slice(0, 4)).service.get(TENANT)
    for (const feature of ['peak_times', 'repeat_customers', 'trend_comparisons', 'anomaly_alerts', 'auto_action_suggestions'] as const) {
      expect(result.available.find((item) => item.feature === feature)?.data).toMatchObject({ status: 'insufficient_data', minimumOrders: 5, message: 'Insights available after more orders.' })
    }
  })

  it('enforces the Growth daily generation limit atomically before provider use', async () => {
    const usage = new InMemoryOrderInsightUsage()
    for (let count = 0; count < 20; count += 1) expect((await usage.consume(TENANT, 20)).allowed).toBe(true)
    let providerCalls = 0
    const limited = new OrderInsightsService(repository(orders), billing('growth'), usage, new InMemoryOrderInsightAudit(), { async generate() { providerCalls += 1; return generation } })
    const result = await limited.get(TENANT, 'ai_suggestion')
    expect(result.usage).toMatchObject({ used: 20, limit: 20, remaining: 0, limitReached: true })
    expect(result.available[0]?.data).toMatchObject({ status: 'limit_reached', message: 'Daily limit reached, upgrade or wait until tomorrow.' })
    expect(providerCalls).toBe(0)
  })

  it('does not increment usage when five-order evidence is unavailable', async () => {
    const fixture = service('growth', orders.slice(0, 2))
    const result = await fixture.service.get(TENANT, 'ai_suggestion')
    expect(result.usage.used).toBe(0)
    expect(await fixture.usage.current(TENANT)).toBe(0)
  })

  it('caches computed content for five minutes but still rechecks and audits locks', async () => {
    let providerCalls = 0
    const audit = new InMemoryOrderInsightAudit()
    let now = Date.parse('2026-08-16T12:00:00Z')
    const cached = new OrderInsightsService(repository(orders), billing('growth'), new InMemoryOrderInsightUsage(), audit, { async generate() { providerCalls += 1; return generation } }, null, () => now)
    expect((await cached.get(TENANT)).cached).toBe(false)
    expect((await cached.get(TENANT)).cached).toBe(true)
    expect(providerCalls).toBe(1)
    expect(audit.entries).toHaveLength(6)
    now += 5 * 60_000 + 1
    expect((await cached.get(TENANT)).cached).toBe(false)
    expect(providerCalls).toBe(2)
  })

  it('sends aggregate facts but no customer PII to the shared provider', async () => {
    let prompt = ''
    const grounded = new OrderInsightsService(repository(orders), billing('commander'), new InMemoryOrderInsightUsage(), new InMemoryOrderInsightAudit(), { async generate(_system, user) { prompt = user; return generation } })
    await grounded.get(TENANT, 'custom_ai_queries', 'What needs review?')
    expect(prompt).toContain('Total orders: 5')
    expect(prompt).not.toContain('customer1@example.com')
    expect(prompt).not.toContain('+91999900001')
    expect(prompt).not.toContain('Customer1 Real')
  })
})

describe('orders HTTP routes', () => {
  it('returns tenant-scoped list/detail data and locked metadata from the error envelope', async () => {
    const orders = [rawOrder(1), rawOrder(2)]
    const insights = service('trial', orders).service
    const app = createApi({ logger: new Logger(), readinessChecks: [], orders: { repository: repository(orders), insights } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
    const base = `http://127.0.0.1:${address.port}`
    try {
      const list = await fetch(`${base}/orders?storeId=${TENANT}`)
      expect(list.status).toBe(200)
      expect((await list.json()).data.pagination.total).toBe(2)
      const detail = await fetch(`${base}/orders/1?storeId=${TENANT}`)
      expect(detail.status).toBe(200)
      expect((await detail.json()).data.id).toBe('1')
      const locked = await fetch(`${base}/orders/insights?storeId=${TENANT}&feature=peak_times`)
      expect(locked.status).toBe(403)
      expect((await locked.json()).error.details).toEqual({ locked: true, feature: 'peak_times', required_plan: 'growth' })
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
