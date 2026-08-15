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
    const health = storeHealthView(snapshot, 2)
    expect(health.score).toBeGreaterThan(70)
    expect(health.tone).toBe('healthy')
    expect(storeHealthView(null).score).toBeNull()
  })
  it('filters revenue points by closed period', () => {
    expect(revenuePoints(snapshot, 'all')).toHaveLength(2)
    expect(revenuePoints(snapshot, '7d')).toEqual([])
  })
})
