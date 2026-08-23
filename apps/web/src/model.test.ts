import { describe, expect, it } from 'vitest'
import { averageOrderValue, catalogProductTitle, formatMoney, formatNumber, latestSyncLabel, revenuePoints, revenueSeries, storeHealthView, sumOrders, sumRevenue, workspaceContext } from './model.js'
import type { AnalyticsSnapshot } from './model.js'

const snapshot: AnalyticsSnapshot = {
  revenue: [
    { storeId: 's', day: '2024-06-02', grossRevenue: 80, discounts: 2, orderCount: 1 },
    { storeId: 's', day: '2024-06-01', grossRevenue: 100, discounts: 5, orderCount: 2 },
  ],
  orders: [
    { storeId: 's', day: '2024-06-01', orderCount: 2, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 50 },
    { storeId: 's', day: '2024-06-02', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 80 },
  ],
  productSales: [],
  customerCohorts: [],
}

describe('F3 workspace model', () => {
  it('reads embedded store context from the URL', () => expect(workspaceContext('?storeId=s1&shop=demo.myshopify.com')).toEqual({ storeId: 's1', shop: 'demo.myshopify.com' }))
  it('turns blank query values into null context', () => expect(workspaceContext('?storeId=%20&shop=')).toEqual({ storeId: null, shop: null }))
  it('formats a USD value', () => expect(formatMoney(1234)).toBe('$1,234'))
  it('returns an em dash for unavailable money', () => expect(formatMoney(null)).toBe('—'))
  it('returns an em dash for non-finite money', () => expect(formatMoney(Number.NaN)).toBe('—'))
  it('formats counts without inventing decimals', () => expect(formatNumber(1234)).toBe('1,234'))
  it('returns an em dash for unavailable counts', () => expect(formatNumber(null)).toBe('—'))
  it('sums revenue from analytics rows', () => expect(sumRevenue(snapshot)).toBe(180))
  it('returns null when revenue has no rows', () => expect(sumRevenue({ ...snapshot, revenue: [] })).toBeNull())
  it('sums orders from analytics rows', () => expect(sumOrders(snapshot)).toBe(3))
  it('returns null when orders have no rows', () => expect(sumOrders(null)).toBeNull())
  it('calculates average order value from aggregate totals', () => expect(averageOrderValue(snapshot)).toBe(60))
  it('returns null when order denominator is zero', () => expect(averageOrderValue({ ...snapshot, orders: [{ ...snapshot.orders[0]!, orderCount: 0 }] })).toBeNull())
  it('returns null when orders exist but revenue rows do not', () => expect(averageOrderValue({ ...snapshot, revenue: [] })).toBeNull())
  it('sorts the revenue series by closed day', () => expect(revenueSeries(snapshot)).toEqual([100, 80]))
  it('returns an empty revenue series without data', () => expect(revenueSeries(null)).toEqual([]))
  it('labels a live analytics snapshot', () => expect(latestSyncLabel(snapshot)).toBe('Live data from analytics tables'))
  it('labels a missing snapshot honestly', () => expect(latestSyncLabel(null)).toBe('No analytics sync yet'))
  it('labels an empty snapshot honestly', () => expect(latestSyncLabel({ ...snapshot, revenue: [], orders: [] })).toBe('No analytics sync yet'))
  it('preserves configured currency', () => expect(formatMoney(10, 'EUR')).toBe('€10'))
  it('renders a normalized catalog title directly from product.payload.title', () => {
    const product = { storeId: 's', productId: 'gid://shopify/Product/123', payload: { id: '123', title: 'Commander Mug' }, syncedAt: 100 }
    expect(product.payload.title).toBe('Commander Mug')
    expect(catalogProductTitle(product)).toBe('Commander Mug')
  })
  it('falls back to the stable product id when Shopify has no usable title', () => expect(catalogProductTitle({ storeId: 's', productId: 'p1', payload: {}, syncedAt: 100 })).toBe('p1'))
  it('scores store health from real analytics coverage', () => {
    // Fresh snapshot: same shape as `snapshot` but with activity inside the last 7 days.
    const today = new Date().toISOString().slice(0, 10)
    const fresh: AnalyticsSnapshot = {
      revenue: [{ storeId: 's', day: today, grossRevenue: 180, discounts: 5, orderCount: 3 }],
      orders: [{ storeId: 's', day: today, orderCount: 3, fulfilledCount: 2, cancelledCount: 0, averageOrderValue: 60 }],
      productSales: [],
      customerCohorts: [],
    }
    const health = storeHealthView(fresh, 2)
    expect(health.score).toBeGreaterThan(70)
    expect(health.tone).toBe('healthy')
    expect(storeHealthView(null).score).toBeNull()
  })
  it('never scores 100 when there are zero orders in the last 7 days (BUG-1)', () => {
    const now = Date.parse('2026-08-23T12:00:00Z')
    const staleDay = '2026-08-10' // 13 days before now: inside 30d, outside 7d
    const stale: AnalyticsSnapshot = {
      revenue: [{ storeId: 's', day: staleDay, grossRevenue: 5_000, discounts: 0, orderCount: 40 }],
      orders: [{ storeId: 's', day: staleDay, orderCount: 40, fulfilledCount: 40, cancelledCount: 0, averageOrderValue: 125 }],
      productSales: [{ storeId: 's', day: staleDay, productId: 'p1', unitsSold: 40, grossRevenue: 5_000 }],
      customerCohorts: [{ storeId: 's', cohortDay: staleDay, activityDay: staleDay, customerCount: 12, grossRevenue: 5_000 }],
    }
    const health = storeHealthView(stale, 25, now)
    expect(health.score).not.toBeNull()
    expect(health.score!).toBeLessThan(60)
    expect(health.score!).toBeLessThanOrEqual(45)
    expect(health.tone).not.toBe('healthy')
  })
  it('caps the score at 30 when the whole last 30 days are silent', () => {
    const now = Date.parse('2026-08-23T12:00:00Z')
    const ancient: AnalyticsSnapshot = {
      revenue: [{ storeId: 's', day: '2026-01-05', grossRevenue: 9_000, discounts: 0, orderCount: 90 }],
      orders: [{ storeId: 's', day: '2026-01-05', orderCount: 90, fulfilledCount: 90, cancelledCount: 0, averageOrderValue: 100 }],
      productSales: [],
      customerCohorts: [],
    }
    const health = storeHealthView(ancient, 10, now)
    expect(health.score).not.toBeNull()
    expect(health.score!).toBeLessThanOrEqual(30)
    expect(health.tone).toBe('critical')
  })
  it('filters revenue points by closed period', () => {
    expect(revenuePoints(snapshot, 'all')).toHaveLength(2)
    expect(revenuePoints(snapshot, '7d')).toEqual([])
  })
})
