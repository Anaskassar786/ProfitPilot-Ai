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
})
