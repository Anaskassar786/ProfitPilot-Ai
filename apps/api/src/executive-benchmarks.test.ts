import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import type { CatalogProduct } from '@profitpilot/db'
import type { StoreSnapshot } from '@profitpilot/ai'
import { detectBenchmarkCategory, laddersFromRows, merchantMetricValues, buildBenchmarkPosition } from './executive-benchmarks.js'
import type { ExecutiveBenchmarkRow } from './executive-model.js'

const rows: readonly ExecutiveBenchmarkRow[] = [
  { id: 'b1', category: 'Fashion & Apparel', metric: 'AOV', percentile: 10, value: 38, currency: 'USD', dataSource: 'SHOPIFY_PUBLIC', sourceLabel: 'Littledata (public)', validFrom: '2026-01-01', validTo: '2027-01-01' },
  { id: 'b2', category: 'Fashion & Apparel', metric: 'AOV', percentile: 50, value: 74, currency: 'USD', dataSource: 'SHOPIFY_PUBLIC', sourceLabel: 'Littledata (public)', validFrom: '2026-01-01', validTo: '2027-01-01' },
  { id: 'b3', category: 'Fashion & Apparel', metric: 'AOV', percentile: 90, value: 132, currency: 'USD', dataSource: 'SHOPIFY_PUBLIC', sourceLabel: 'Littledata (public)', validFrom: '2026-01-01', validTo: '2027-01-01' },
  { id: 'b4', category: 'Fashion & Apparel', metric: 'REVENUE', percentile: 50, value: 10400, currency: 'USD', dataSource: 'SHOPIFY_PUBLIC', sourceLabel: 'Littledata (public)', validFrom: '2026-01-01', validTo: '2027-01-01' },
]

const snapshot: StoreSnapshot = {
  storeId: storeId('s'), currency: 'USD', timezone: 'UTC', asOf: '2026-08-18T00:00:00.000Z', dataFreshAt: '2026-08-17',
  products: [], customers: [
    { customerKey: 'c1', lifetimeValue: 100, orderCount: 2, daysSinceLastOrder: 1, firstOrderDay: '2026-07-01' },
    { customerKey: 'c2', lifetimeValue: 40, orderCount: 1, daysSinceLastOrder: 2, firstOrderDay: '2026-08-01' },
  ],
  checkouts: [], orders: [], productPairs: [], last30dRevenue: 9000, previous30dRevenue: 8000, last30dOrders: 100, previous30dOrders: 90,
}

const emptyAnalytics = { revenue: [], orders: [], productSales: [], customerCohorts: [] }

describe('PR49 benchmark ladders', () => {
  it('groups rows into per-metric ladders sorted by value', () => {
    const ladders = laddersFromRows(rows)
    const aov = ladders.find((ladder) => ladder.metric === 'AOV')
    expect(aov).toBeDefined()
    expect(aov!.points.map((point) => point.value)).toEqual([38, 74, 132])
    expect(aov!.currency).toBe('USD')
  })
})

describe('PR49 merchant metric values', () => {
  it('measures only what the data supports', () => {
    const values = merchantMetricValues(snapshot, emptyAnalytics, [])
    expect(values.REVENUE).toBe(9000)
    expect(values.AOV).toBe(90)
    expect(values.REPEAT_PURCHASE).toBe(50)
    // CAC and CONVERSION must never be invented.
    expect(values.CAC).toBeUndefined()
    expect(values.CONVERSION).toBeUndefined()
  })
})

describe('PR49 benchmark position', () => {
  it('computes percentile and gap, and reports missing metrics honestly', () => {
    const position = buildBenchmarkPosition({
      storeId: storeId('s'),
      category: 'Fashion & Apparel',
      categorySource: 'PREFERENCE',
      ladders: laddersFromRows(rows),
      merchantValues: merchantMetricValues(snapshot, emptyAnalytics, []),
      visibleMetrics: 2,
    })
    const aov = position.positions.find((entry) => entry.metric === 'AOV')!
    expect(aov.yourValue).toBe(90)
    expect(aov.percentile).toBeGreaterThan(50)
    expect(aov.percentile).toBeLessThan(90)
    expect(aov.gapToTop10Pct).toBeGreaterThan(0)
    const revenue = position.positions.find((entry) => entry.metric === 'REVENUE')!
    expect(revenue.percentile).toBeLessThanOrEqual(50)
  })
})

describe('PR49 category auto-detection', () => {
  const product = (type: string): CatalogProduct => ({ storeId: storeId('s'), productId: 'p', payload: { product_type: type }, syncedAt: 0 })
  it('maps Shopify product types to benchmark categories', () => {
    expect(detectBenchmarkCategory([product('Apparel & Accessories')])).toBe('Fashion & Apparel')
    expect(detectBenchmarkCategory([product('Electronics')])).toBe('Electronics')
    expect(detectBenchmarkCategory([product('')])).toBeNull()
  })
})
