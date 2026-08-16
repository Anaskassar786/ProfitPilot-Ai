import { describe, expect, it } from 'vitest'
import { analyticsKpis, periodTrend } from './analytics-model.js'
import type { AnalyticsSnapshot } from './model.js'

const twoOrderSnapshot: AnalyticsSnapshot = {
  revenue: [
    { storeId: 's', day: '2026-08-14', grossRevenue: 100, discounts: 0, orderCount: 1 },
    { storeId: 's', day: '2026-08-16', grossRevenue: 300, discounts: 0, orderCount: 3 },
  ],
  orders: [
    { storeId: 's', day: '2026-08-14', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 100 },
    { storeId: 's', day: '2026-08-16', orderCount: 3, fulfilledCount: 3, cancelledCount: 0, averageOrderValue: 100 },
  ],
  productSales: [],
  customerCohorts: [],
}

const oneOrderSnapshot: AnalyticsSnapshot = {
  revenue: [{ storeId: 's', day: '2026-08-16', grossRevenue: 50, discounts: 0, orderCount: 1 }],
  orders: [{ storeId: 's', day: '2026-08-16', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 50 }],
  productSales: [],
  customerCohorts: [],
}

const emptySnapshot: AnalyticsSnapshot = {
  revenue: [],
  orders: [],
  productSales: [],
  customerCohorts: [],
}

describe('analytics model', () => {
  it('fills missing chart periods with honest zero values', () => {
    const points = periodTrend(twoOrderSnapshot, 7, null)
    expect(points).toHaveLength(7)
    expect(points.find((point) => point.day === '2026-08-15')?.revenue).toBe(0)
  })

  it('derives real KPI totals and AOV', () => {
    const kpis = analyticsKpis(twoOrderSnapshot, 7)
    expect(kpis[0]?.value).toBe(400)
    expect(kpis[1]?.value).toBe(4)
    expect(kpis[2]?.value).toBe(100)
    expect(kpis).toHaveLength(6)
    expect(kpis[3]?.label).toBe('Conversion Rate')
    expect(kpis[3]?.value).toBeNull()
    expect(kpis[4]?.value).toBe(7)
  })

  it('returns empty trend and null KPIs for 0 orders', () => {
    expect(periodTrend(emptySnapshot, 30, null)).toEqual([])
    expect(periodTrend(null, 30, null)).toEqual([])
    const kpis = analyticsKpis(emptySnapshot, null)
    expect(kpis.every((kpi) => kpi.value === null)).toBe(true)
    expect(kpis.every((kpi) => kpi.change === null)).toBe(true)
    expect(kpis.every((kpi) => kpi.sparkline.length === 0)).toBe(true)
  })

  it('handles a single-order store without NaN growth', () => {
    const kpis = analyticsKpis(oneOrderSnapshot, 1)
    expect(kpis[0]?.value).toBe(50)
    expect(kpis[1]?.value).toBe(1)
    expect(kpis[2]?.value).toBe(50)
    for (const kpi of kpis) {
      expect(kpi.change === null || Number.isFinite(kpi.change)).toBe(true)
      expect(String(kpi.change)).not.toContain('NaN')
    }
    expect(kpis[0]?.sparkline).toEqual([50])
    const trend = periodTrend(oneOrderSnapshot, 7, null)
    expect(trend).toHaveLength(7)
    expect(trend.every((point) => Number.isFinite(point.revenue))).toBe(true)
  })

  it('handles a 2-order test store without NaN percentages', () => {
    const kpis = analyticsKpis(twoOrderSnapshot, 2)
    for (const kpi of kpis) {
      if (kpi.value !== null) expect(Number.isFinite(kpi.value)).toBe(true)
      if (kpi.change !== null) expect(Number.isFinite(kpi.change)).toBe(true)
      for (const point of kpi.sparkline) expect(Number.isFinite(point)).toBe(true)
    }
  })

  it('never returns NaN when previous period revenue is zero', () => {
    const snapshot: AnalyticsSnapshot = {
      revenue: [
        { storeId: 's', day: '2026-07-01', grossRevenue: 0, discounts: 0, orderCount: 0 },
        { storeId: 's', day: '2026-08-16', grossRevenue: 200, discounts: 0, orderCount: 2 },
      ],
      orders: [
        { storeId: 's', day: '2026-07-01', orderCount: 0, fulfilledCount: 0, cancelledCount: 0, averageOrderValue: 0 },
        { storeId: 's', day: '2026-08-16', orderCount: 2, fulfilledCount: 2, cancelledCount: 0, averageOrderValue: 100 },
      ],
      productSales: [],
      customerCohorts: [],
    }
    const kpis = analyticsKpis(snapshot, null)
    expect(kpis[0]?.change).toBeNull()
    expect(kpis[1]?.change).toBeNull()
  })

  it('attaches forecast points only when status is available', () => {
    const withForecast = periodTrend(twoOrderSnapshot, 7, {
      status: 'available',
      message: 'ok',
      points: [{ day: '2026-08-17', value: 10, lower: 5, upper: 15 }],
      standardDeviation: 1,
    })
    expect(withForecast.some((point) => point.day === '2026-08-17' && point.forecast === 10)).toBe(true)

    const insufficient = periodTrend(twoOrderSnapshot, 7, {
      status: 'insufficient_data',
      message: 'need more',
      points: [{ day: '2026-08-17', value: 10, lower: 5, upper: 15 }],
      standardDeviation: 0,
    })
    expect(insufficient.some((point) => point.day === '2026-08-17')).toBe(false)
  })
})
