import { describe, expect, it } from 'vitest'
import { F8ContextProvider } from './f8-context.js'
import { computeForecast } from './f8-forecast.js'

const analytics = {
  revenue: Array.from({ length: 14 }, (_value, index) => ({ storeId: 'store-1' as never, day: `2024-05-${String(index + 1).padStart(2, '0')}`, grossRevenue: 10 + index, discounts: 0, orderCount: 1 })),
  orders: [{ storeId: 'store-1' as never, day: '2024-05-14', orderCount: 4, fulfilledCount: 3, cancelledCount: 1, averageOrderValue: 50 }],
  productSales: [{ storeId: 'store-1' as never, day: '2024-05-14', productId: 'p1', unitsSold: 4, grossRevenue: 189 }],
  customerCohorts: [],
}
const catalog = [{ storeId: 'store-1' as never, productId: 'p1', payload: { title: 'Hoodie', inventory: 5, averageDailyUnits: 1, units14d: 14, units30d: 30 }, syncedAt: 1_000 }]
const recommendations = [{ id: 'r1', storeId: 'store-1' as never, agent: 'CAMPAIGN_AGENT' as const, ruleId: 'CHURN_RISK' as const, title: 'Win back', reason: 'inactive', impactValue: 189, impactLabel: 'LTV', currency: 'USD', confidence: .92, confidenceLevel: 'HIGH' as const, actionType: 'SEND_EMAIL' as const, actionRisk: 'APPROVAL_REQUIRED' as const, status: 'PENDING' as const, evidencePack: {}, explanation: null, explanationStatus: 'AI_UNAVAILABLE' as const, model: null, version: 0, createdAt: '2024-05-14T00:00:00.000Z' }]

function provider(): F8ContextProvider { return new F8ContextProvider({ analytics: { read: async () => analytics, readCatalog: async () => catalog }, recommendations: { list: async () => recommendations }, usage: async () => [{ feature: 'ai', used: 2, limit: 10 }] }, () => 1_000) }

describe('F8 real data context adapter', () => {
  it('builds page-aware Jarvis evidence without PII', async () => {
    const context = provider()
    const evidence = await context.get('store-1' as never, 'inventory')
    expect(evidence.facts.map((fact) => fact.key)).toContain('inventory_low_count')
    expect(evidence.suggestedAction?.recommendationId).toBe('r1')
    expect(JSON.stringify(evidence)).not.toMatch(/customer@example|phone number|postal address/i)
    const billing = await context.get('store-1' as never, 'BILLING_USAGE' as never, 'billing')
    expect(billing.facts).toContainEqual(expect.objectContaining({ key: 'usage_ai' }))
  })

  it('enriches Jarvis evidence with currency, AOV, health, and recent days', async () => {
    const context = provider()
    const evidence = await context.get('store-1' as never, 'dashboard')
    expect(evidence.currency).toBe('USD')
    const byKey = new Map(evidence.facts.map((fact) => [fact.key, fact]))
    // 14 closed revenue days of 10..23 sum to 231, with 4 orders -> AOV 57.75.
    expect(byKey.get('revenue_total')?.value).toBe(231)
    expect(byKey.get('revenue_display')?.value).toBe('$231')
    expect(byKey.get('orders_total')?.value).toBe(4)
    expect(byKey.get('aov')?.value).toBe(57.75)
    expect(byKey.get('aov_display')?.value).toBe('$58')
    expect(byKey.get('catalog_count')?.value).toBe(1)
    // Mirrors the dashboard health formula: 35 + 25 (revenue) + 20 (orders) + 10 (catalog).
    expect(byKey.get('health_score')?.value).toBe(90)
    expect(byKey.get('health_label')?.value).toBe('A+ · Healthy')
    expect(byKey.get('pending_recommendations')?.value).toBe(1)
    expect(String(byKey.get('recent_revenue_days')?.value)).toContain('05-14: $23')
    expect(String(byKey.get('top_recommendation')?.value)).toContain('Win back')
  })

  it('serves Copilot intent evidence and forecast calculations from catalog/analytics', async () => {
    const context = provider()
    const evidence = await context.factsForIntent('store-1' as never, 'TOP_PRODUCTS', 'products')
    expect(evidence.intent).toBe('TOP_PRODUCTS')
    expect(evidence.facts).toContainEqual(expect.objectContaining({ key: 'top_product_revenue', value: 189 }))
    const forecast = await computeForecast('store-1', { analytics: { read: async () => analytics, readCatalog: async () => catalog }, customers: async () => [{ customerKey: 'opaque-customer', recencyDays: 90, frequency: 2, monetaryValue: 80 }], now: () => 1_000 })
    expect(forecast.dataAvailable).toBe(true)
    expect(forecast.churn[0]?.segment).toBe('AT_RISK')
    expect(forecast.revenue?.method.method).toContain('seasonality')
    expect(forecast.stockout[0]?.forecast.risk).toBe('high')
  })

  it('degrades a failed source instead of throwing when a source rejects on cold start', async () => {
    // Regression: before this fix a single rejected source (missing table, RLS
    // error, transient outage) made Promise.all reject and 500 every message.
    const resilient = new F8ContextProvider({
      analytics: { read: async () => analytics, readCatalog: async () => { throw new Error('catalog unavailable') } },
      recommendations: { list: async () => { throw new Error('relation "ai_recommendations" does not exist') } },
    }, () => 1_000)
    const evidence = await resilient.get('store-1' as never, 'dashboard')
    expect(evidence.currency).toBe('USD')
    // Analytics still loads, so revenue facts remain; the rejected sources are
    // treated as empty. The important contract is: no throw, USD fallback.
    expect(evidence.facts.find((fact) => fact.key === 'revenue_total')?.value).toBe(231)
    expect(evidence.facts.find((fact) => fact.key === 'pending_recommendations')?.value).toBe(0)
    expect(evidence.suggestedAction).toBeNull()
  })

  it('falls back to USD when a recommendation carries an invalid currency code', async () => {
    // Regression: an invalid/short currency from the database made Intl throw
    // RangeError: Invalid currency code, which 500'd the request.
    const badCurrency = [{ ...recommendations[0], currency: 'RUPEES' }] as unknown as typeof recommendations
    const resilient = new F8ContextProvider({
      analytics: { read: async () => ({ revenue: [{ storeId: 'store-1' as never, day: '2024-05-14', grossRevenue: 189, discounts: 0, orderCount: 2 }], orders: [], productSales: [], customerCohorts: [] }), readCatalog: async () => catalog },
      recommendations: { list: async () => badCurrency },
    }, () => 1_000)
    const evidence = await resilient.get('store-1' as never, 'dashboard')
    expect(evidence.currency).toBe('USD')
    // Money formatting must not throw for the bad currency and must render USD.
    expect(evidence.facts.find((fact) => fact.key === 'revenue_display')?.value).toBe('$189')
  })

  it('survives all three evidence sources being unavailable (cold cache / cold start)', async () => {
    const resilient = new F8ContextProvider({
      analytics: { read: async () => { throw new Error('connection refused') }, readCatalog: async () => { throw new Error('connection refused') } },
      recommendations: { list: async () => { throw new Error('connection refused') } },
    }, () => 1_000)
    const evidence = await resilient.get('store-1' as never, 'orders')
    // No throw — safe null/zero facts, USD fallback, no suggested action.
    expect(evidence.currency).toBe('USD')
    expect(evidence.suggestedAction).toBeNull()
    expect(evidence.facts.find((fact) => fact.key === 'orders_total')?.value).toBeNull()
    expect(evidence.facts.find((fact) => fact.key === 'revenue_total')?.value).toBeNull()
  })
})
