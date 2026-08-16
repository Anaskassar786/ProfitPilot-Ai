import { describe, expect, it } from 'vitest'
import { AnalyticsInsightsService, InMemoryAnalyticsQueryUsage, detectAnomalies, groupCategories, linearForecast } from './analytics-insights.js'
import { storeId } from '@profitpilot/types'
import type { AnalyticsSnapshot, CatalogProduct } from '@profitpilot/db'

const tenant = storeId('store-analytics')
const revenue = Array.from({ length: 20 }, (_, index) => ({ storeId: tenant, day: `2026-07-${String(index + 1).padStart(2, '0')}`, grossRevenue: index === 19 ? 1000 : 100 + index * 10, discounts: 0, orderCount: 2 }))
const snapshot: AnalyticsSnapshot = { revenue, orders: revenue.map((row) => ({ storeId: tenant, day: row.day, orderCount: 2, fulfilledCount: 2, cancelledCount: 0, averageOrderValue: row.grossRevenue / 2 })), productSales: [{ storeId: tenant, day: '2026-07-01', productId: 'p1', unitsSold: 2, grossRevenue: 50 }], customerCohorts: [] }
const catalog: readonly CatalogProduct[] = [{ storeId: tenant, productId: 'p1', payload: { title: 'Shirt', productType: 'Apparel' }, syncedAt: 1 }]

describe('analytics deterministic insights', () => {
  it('projects seven non-negative values with confidence bands', () => { const result = linearForecast(revenue); expect(result.status).toBe('available'); expect(result.points).toHaveLength(7); expect(result.points.every((point) => point.lower <= point.value && point.upper >= point.value)).toBe(true) })
  it('returns an honest insufficient state below seven days', () => expect(linearForecast(revenue.slice(0, 6)).status).toBe('insufficient_data'))
  it('flags values more than two standard deviations from average', () => { const rows = Array.from({ length: 20 }, (_, index) => ({ day: `2026-08-${String(index + 1).padStart(2, '0')}`, grossRevenue: index === 19 ? 1000 : 100 })); expect(detectAnomalies(rows)).toEqual([expect.objectContaining({ direction: 'spike', day: '2026-08-20' })]) })
  it('joins real catalog product type into category totals', () => expect(groupCategories(snapshot.productSales, catalog)).toEqual([{ name: 'Apparel', revenue: 50, units: 2 }]))
  it('enforces plan gating before returning anomaly and premium features', async () => { const analytics = { read: async () => snapshot, readCatalog: async () => catalog }; const orders = { list: async () => [] }; const trial = new AnalyticsInsightsService(analytics, { get: async () => null }, orders, new InMemoryAnalyticsQueryUsage(), null, () => 1); const result = await trial.get(tenant); expect(result.anomalies).toBeNull(); expect(result.locked).toContainEqual({ feature: 'anomaly_detection', requiredPlan: 'start' }); expect(result.locked).toContainEqual({ feature: 'custom_ai_queries', requiredPlan: 'commander' }) })
})
