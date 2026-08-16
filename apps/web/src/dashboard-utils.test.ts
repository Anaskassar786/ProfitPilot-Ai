import { describe, it, expect } from 'vitest'
import {
  calculateGrowth,
  formatGrowth,
  aggregateRevenueByPeriod,
  aggregateByCategory,
  buildCalendarMonth,
  buildRecentOrders,
  generateSummary,
} from './dashboard-utils.js'

// ─── calculateGrowth ──────────────────────────────────────────

describe('calculateGrowth', () => {
  it('returns none when both values are null', () => {
    const result = calculateGrowth(null, null)
    expect(result.direction).toBe('none')
    expect(result.percent).toBeNull()
  })

  it('returns none when previous is null', () => {
    const result = calculateGrowth(100, null)
    expect(result.direction).toBe('none')
    expect(result.percent).toBeNull()
  })

  it('returns none when current is null', () => {
    const result = calculateGrowth(null, 100)
    expect(result.direction).toBe('none')
    expect(result.percent).toBeNull()
  })

  it('returns none when previous is 0', () => {
    const result = calculateGrowth(100, 0)
    expect(result.direction).toBe('none')
  })

  it('calculates positive growth', () => {
    const result = calculateGrowth(200, 100)
    expect(result.direction).toBe('up')
    expect(result.percent).toBeCloseTo(100)
  })

  it('calculates negative growth', () => {
    const result = calculateGrowth(50, 100)
    expect(result.direction).toBe('down')
    expect(result.percent).toBeCloseTo(-50)
  })

  it('returns flat when no change', () => {
    const result = calculateGrowth(100, 100)
    expect(result.direction).toBe('flat')
    expect(result.percent).toBeCloseTo(0)
  })
})

// ─── formatGrowth ─────────────────────────────────────────────

describe('formatGrowth', () => {
  it('formats positive growth', () => {
    const result = formatGrowth(calculateGrowth(150, 100), 'last month')
    expect(result).toContain('▲')
    expect(result).toContain('50.0%')
    expect(result).toContain('last month')
  })

  it('formats negative growth', () => {
    const result = formatGrowth(calculateGrowth(50, 100), 'last week')
    expect(result).toContain('▼')
    expect(result).toContain('50.0%')
    expect(result).toContain('last week')
  })

  it('shows dash when no data', () => {
    const result = formatGrowth(calculateGrowth(null, null), 'last period')
    expect(result).toBe('— vs last period')
  })
})

// ─── aggregateRevenueByPeriod ─────────────────────────────────

const mockSnapshot = {
  revenue: [
    { storeId: 's1', day: '2025-01-01', grossRevenue: 100, discounts: 0, orderCount: 5 },
    { storeId: 's1', day: '2025-01-15', grossRevenue: 200, discounts: 0, orderCount: 8 },
    { storeId: 's1', day: '2025-02-01', grossRevenue: 300, discounts: 0, orderCount: 12 },
    { storeId: 's1', day: '2025-02-15', grossRevenue: 150, discounts: 0, orderCount: 6 },
  ],
  orders: [],
  productSales: [],
  customerCohorts: [],
}

describe('aggregateRevenueByPeriod', () => {
  it('returns empty array for null snapshot', () => {
    expect(aggregateRevenueByPeriod(null, 'monthly')).toEqual([])
  })

  it('aggregates monthly correctly', () => {
    const result = aggregateRevenueByPeriod(mockSnapshot as any, 'monthly')
    expect(result.length).toBeGreaterThanOrEqual(1)
    // Check that values are aggregated correctly
    const janEntry = result.find((r) => r.label.startsWith('Jan'))
    expect(janEntry).toBeDefined()
    if (janEntry) expect(janEntry.value).toBe(300) // 100 + 200
  })

  it('aggregates yearly correctly', () => {
    const result = aggregateRevenueByPeriod(mockSnapshot as any, 'yearly')
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── aggregateByCategory ──────────────────────────────────────

describe('aggregateByCategory', () => {
  const mockProducts = [
    { productId: 'p1', payload: { title: 'Widget', product_type: 'Gadgets' } },
    { productId: 'p2', payload: { title: 'Gizmo', product_type: 'Gadgets' } },
    { productId: 'p3', payload: { title: 'Hat', product_type: 'Apparel' } },
  ]

  const mockSalesSnapshot = {
    ...mockSnapshot,
    productSales: [
      { storeId: 's1', day: '2025-01-01', productId: 'p1', unitsSold: 5, grossRevenue: 100 },
      { storeId: 's1', day: '2025-01-01', productId: 'p2', unitsSold: 3, grossRevenue: 60 },
      { storeId: 's1', day: '2025-01-01', productId: 'p3', unitsSold: 2, grossRevenue: 40 },
    ],
  }

  it('returns empty array for null snapshot', () => {
    expect(aggregateByCategory(null, [])).toEqual([])
  })

  it('aggregates by product type', () => {
    const result = aggregateByCategory(mockSalesSnapshot as any, mockProducts as any)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const gadgets = result.find((r) => r.name === 'Gadgets')
    expect(gadgets).toBeDefined()
    if (gadgets) expect(gadgets.value).toBe(160) // 100 + 60
  })

  it('uses "Uncategorized" for products without type', () => {
    const products = [
      { productId: 'p1', payload: { title: 'Generic' } },
    ]
    const sales = {
      ...mockSnapshot,
      productSales: [
        { storeId: 's1', day: '2025-01-01', productId: 'p1', unitsSold: 1, grossRevenue: 50 },
      ],
    }
    const result = aggregateByCategory(sales as any, products as any)
    const uncat = result.find((r) => r.name === 'Uncategorized')
    expect(uncat).toBeDefined()
    if (uncat) expect(uncat.value).toBe(50)
  })
})

// ─── buildCalendarMonth ───────────────────────────────────────

describe('buildCalendarMonth', () => {
  it('returns a month with days', () => {
    const result = buildCalendarMonth(mockSnapshot as any, 2025, 1)
    expect(result.year).toBe(2025)
    expect(result.month).toBe(1)
    expect(result.days.length).toBeGreaterThan(0)
    expect(result.total).toBeGreaterThan(0)
  })

  it('returns empty month data for null snapshot', () => {
    const result = buildCalendarMonth(null, 2025, 1)
    expect(result.days.length).toBeGreaterThan(0)
    expect(result.total).toBe(0)
  })
})

// ─── buildRecentOrders ────────────────────────────────────────

describe('buildRecentOrders', () => {
  it('returns empty array for null snapshot', () => {
    expect(buildRecentOrders(null)).toEqual([])
  })

  it('returns order summaries from order data', () => {
    const snap = {
      revenue: mockSnapshot.revenue,
      orders: [
        { storeId: 's1', day: '2025-02-15', orderCount: 6, fulfilledCount: 5, cancelledCount: 1, averageOrderValue: 25 },
        { storeId: 's1', day: '2025-02-01', orderCount: 12, fulfilledCount: 10, cancelledCount: 2, averageOrderValue: 25 },
      ],
      productSales: [],
      customerCohorts: [],
    }
    const result = buildRecentOrders(snap as any)
    expect(result.length).toBe(2)
    expect(result[0]?.status).toBe('fulfilled')
    expect(result[0]?.amount).toBeGreaterThan(0)
  })
})

// ─── generateSummary ──────────────────────────────────────────

describe('generateSummary', () => {
  it('returns no-data message for null snapshot', () => {
    const result = generateSummary(null, [])
    expect(result).toContain('No data')
  })

  it('returns insight for snapshot with data', () => {
    const result = generateSummary(mockSnapshot as any, [])
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(20)
  })
})