import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import type { AnalyticsSnapshot } from '@profitpilot/db'
import type { StoreSnapshot } from '@profitpilot/ai'
import { benchmarkPercentile, decisionAccuracyScore, detectExecutiveRisks, diagnoseExecutiveHealth, identifyExecutiveOpportunities, projectExecutiveScenario, qualityRatingForAccuracy, roadmapProgressFromMilestones } from './executive-analytics.js'
import type { RoadmapMilestone } from './executive-model.js'

const NOW = Date.parse('2026-08-18T00:00:00.000Z')
const day = (offset: number): string => new Date(NOW - offset * 86_400_000).toISOString().slice(0, 10)

function snapshot(overrides: Partial<StoreSnapshot> = {}): StoreSnapshot {
  return {
    storeId: storeId('s1'),
    currency: 'USD',
    timezone: 'UTC',
    asOf: '2026-08-18T00:00:00.000Z',
    dataFreshAt: '2026-08-17',
    products: [
      { productId: 'p1', title: 'Hero Hoodie', inventoryUnits: 40, averageDailyUnits: 2, unitPrice: 60, unitCost: 20, unitsSold120d: 180, daysSinceLastSale: 1 },
      { productId: 'p2', title: 'Tee', inventoryUnits: 120, averageDailyUnits: 1.2, unitPrice: 25, unitCost: 8, unitsSold120d: 90, daysSinceLastSale: 2 },
      { productId: 'p3', title: 'Cap', inventoryUnits: 0, averageDailyUnits: 0.8, unitPrice: 22, unitCost: 7, unitsSold120d: 70, daysSinceLastSale: 3 },
      { productId: 'p4', title: 'Socks', inventoryUnits: 300, averageDailyUnits: 0.4, unitPrice: 9, unitCost: 3, unitsSold120d: 30, daysSinceLastSale: 12 },
      { productId: 'p5', title: 'Limited Pin', inventoryUnits: 60, averageDailyUnits: 0.6, unitPrice: 45, unitCost: 8, unitsSold120d: 60, daysSinceLastSale: 1 },
    ],
    customers: [
      { customerKey: 'c1', lifetimeValue: 500, orderCount: 4, daysSinceLastOrder: 5, firstOrderDay: day(120) },
      { customerKey: 'c2', lifetimeValue: 200, orderCount: 2, daysSinceLastOrder: 20, firstOrderDay: day(90) },
      { customerKey: 'c3', lifetimeValue: 90, orderCount: 1, daysSinceLastOrder: 60, firstOrderDay: day(40) },
      { customerKey: 'c4', lifetimeValue: 60, orderCount: 1, daysSinceLastOrder: 10, firstOrderDay: day(10) },
      { customerKey: 'c5', lifetimeValue: 40, orderCount: 1, daysSinceLastOrder: 3, firstOrderDay: day(2) },
    ],
    checkouts: [],
    orders: [],
    productPairs: [{ productId: 'p1', relatedProductId: 'p2', coPurchaseRate: 0.4, productPrice: 60, relatedProductPrice: 25 }],
    last30dRevenue: 8400,
    previous30dRevenue: 7000,
    last30dOrders: 120,
    previous30dOrders: 100,
    ...overrides,
  }
}

function analytics(overrides: Partial<AnalyticsSnapshot> = {}): AnalyticsSnapshot {
  return {
    revenue: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s1'), day: day(59 - index), grossRevenue: 280, discounts: 0, orderCount: 4 })),
    orders: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s1'), day: day(59 - index), orderCount: 4, fulfilledCount: 3, cancelledCount: 0, averageOrderValue: 70 })),
    productSales: Array.from({ length: 60 }, (_, dayIndex) => Array.from({ length: 8 }, (_, productIndex) => ({
      storeId: storeId('s1'),
      day: day(59 - dayIndex),
      productId: `p${productIndex + 1}`,
      unitsSold: 2,
      grossRevenue: 45,
    }))).flat(),
    customerCohorts: [],
    ...overrides,
  }
}

describe('PR49 executive health diagnosis', () => {
  it('computes all eight vital signs from real rows', () => {
    const diagnosis = diagnoseExecutiveHealth(snapshot(), analytics(), NOW)
    expect(diagnosis.vitals.map((vital) => vital.key)).toEqual(['revenue_growth', 'retention', 'inventory_turnover', 'cash_conversion', 'marketing_roi', 'product_diversity', 'order_velocity', 'acquisition'])
    const revenue = diagnosis.vitals[0]!
    expect(revenue.value).toBeCloseTo(0.2, 2)
    expect(revenue.status).toBe('HEALTHY')
    const retention = diagnosis.vitals[1]!
    expect(retention.value).toBeCloseTo(0.4, 2)
    expect(retention.status).toBe('HEALTHY')
    // Marketing ROI must stay honest: no spend data, no invented number.
    const roi = diagnosis.vitals[4]!
    expect(roi.value).toBeNull()
    expect(roi.status).toBe('NEEDS_ATTENTION')
  })

  it('scores a healthy store STRONG and flags conditions honestly', () => {
    const diagnosis = diagnoseExecutiveHealth(snapshot(), analytics(), NOW)
    expect(diagnosis.overallStatus).toBe('STRONG')
    expect(diagnosis.overallScore).toBeGreaterThanOrEqual(80)
  })

  it('scores a contracting, concentrated, churning store as AT_RISK or CRITICAL', () => {
    const bad = snapshot({
      last30dRevenue: 3000,
      previous30dRevenue: 8000,
      last30dOrders: 30,
      previous30dOrders: 90,
      products: [snapshot().products[0]!, snapshot().products[1]!].map((product, index) => ({ ...product, unitsSold120d: index === 0 ? 3000 : 10 })),
      customers: Array.from({ length: 12 }, (_, index) => ({ customerKey: `c${index}`, lifetimeValue: 30, orderCount: 1, daysSinceLastOrder: 90, firstOrderDay: day(300) })),
    })
    const badAnalytics = analytics({
      orders: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s1'), day: day(59 - index), orderCount: 2, fulfilledCount: 1, cancelledCount: 1, averageOrderValue: 70 })),
    })
    const diagnosis = diagnoseExecutiveHealth(bad, badAnalytics, NOW)
    expect(['AT_RISK', 'CRITICAL']).toContain(diagnosis.overallStatus)
    expect(diagnosis.conditions.length).toBeGreaterThan(0)
  })

  it('returns a null-free, weighted score of 0 when nothing is measurable', () => {
    const empty = snapshot({ products: [], customers: [], last30dRevenue: 0, previous30dRevenue: 0, last30dOrders: 0, previous30dOrders: 0, productPairs: [] })
    const diagnosis = diagnoseExecutiveHealth(empty, { revenue: [], orders: [], productSales: [], customerCohorts: [] }, NOW)
    expect(diagnosis.overallScore).toBe(0)
    expect(diagnosis.overallStatus).toBe('CRITICAL')
  })
})

describe('PR49 risk radar', () => {
  it('detects revenue concentration and stockout exposure', () => {
    const concentrated = analytics({
      productSales: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s1'), day: day(59 - index), productId: index % 5 === 0 ? 'p2' : 'p1', unitsSold: index % 5 === 0 ? 1 : 8, grossRevenue: index % 5 === 0 ? 25 : 480 })),
    })
    const risks = detectExecutiveRisks(snapshot(), concentrated, NOW)
    const concentration = risks.find((risk) => risk.title === 'Revenue concentration in few products')
    expect(concentration).toBeDefined()
    expect(concentration!.probability).toBeGreaterThan(0)
    expect(concentration!.impactIfRealized).toBeGreaterThan(0)
    const stockouts = risks.find((risk) => risk.riskType === 'OPERATIONAL')
    expect(stockouts).toBeDefined()
  })

  it('detects cash-flow leakage from cancellations', () => {
    const risks = detectExecutiveRisks(snapshot(), analytics({
      orders: Array.from({ length: 30 }, (_, index) => ({ storeId: storeId('s1'), day: day(index), orderCount: 10, fulfilledCount: 8, cancelledCount: 2, averageOrderValue: 70 })),
    }), NOW)
    expect(risks.some((risk) => risk.riskType === 'CASHFLOW')).toBe(true)
  })

  it('detects revenue contraction as a market risk', () => {
    const risks = detectExecutiveRisks(snapshot({ last30dRevenue: 4000, previous30dRevenue: 10000 }), analytics(), NOW)
    expect(risks.some((risk) => risk.riskType === 'MARKET')).toBe(true)
  })

  it('reports no risks when the store is healthy and diversified', () => {
    const diversified = snapshot({
      products: snapshot().products.map((product) => ({ ...product, inventoryUnits: 100 })),
      customers: Array.from({ length: 20 }, (_, index) => ({ customerKey: `c${index}`, lifetimeValue: 100, orderCount: 2, daysSinceLastOrder: 5, firstOrderDay: day(60 + index) })),
    })
    const risks = detectExecutiveRisks(diversified, analytics({
      productSales: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s1'), day: day(59 - index), productId: `p${index % 12}`, unitsSold: 2, grossRevenue: 30 })),
      orders: Array.from({ length: 60 }, (_, index) => ({ storeId: storeId('s1'), day: day(59 - index), orderCount: 4, fulfilledCount: 4, cancelledCount: 0, averageOrderValue: 70 })),
    }), NOW)
    expect(risks).toHaveLength(0)
  })
})

describe('PR49 opportunities', () => {
  it('identifies pricing and cross-sell opportunities with real math', () => {
    const opportunities = identifyExecutiveOpportunities(snapshot(), analytics(), NOW)
    const pricing = opportunities.find((opportunity) => opportunity.category === 'PRICING')
    expect(pricing).toBeDefined()
    expect(pricing!.estimatedImpactAnnual).toBeGreaterThan(0)
    const crossSell = opportunities.find((opportunity) => opportunity.category === 'CROSS_SELL')
    expect(crossSell).toBeDefined()
  })

  it('returns nothing when there is no data', () => {
    const empty = snapshot({ products: [], customers: [], last30dRevenue: 0, previous30dRevenue: 0, last30dOrders: 0, previous30dOrders: 0, productPairs: [] })
    const opportunities = identifyExecutiveOpportunities(empty, { revenue: [], orders: [], productSales: [], customerCohorts: [] }, NOW)
    expect(opportunities).toHaveLength(0)
  })
})

describe('PR49 scenario projections', () => {
  it('projects a price increase with explicit assumptions and confidence', () => {
    const result = projectExecutiveScenario(snapshot(), analytics(), 'PRICING', { priceChangePct: 10 })
    // At the assumed inelastic demand (-0.8), a 10% price rise lifts revenue
    // 1.2% while order volume falls 8% — both visible in the projection.
    expect(result.predictions.assumptions.length).toBeGreaterThan(0)
    expect(result.predictions.delta.monthlyRevenue).toBeGreaterThan(0)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(0.85)
  })

  it('projects product, marketing, inventory, and custom scenarios', () => {
    for (const scenarioType of ['PRODUCT', 'MARKETING', 'INVENTORY', 'CUSTOM'] as const) {
      const result = projectExecutiveScenario(snapshot(), analytics(), scenarioType, { newProducts: 2, spendChangeMonthly: 500, expectedRoas: 3, stockChangePct: 20, annualRevenueGrowthPct: 20, months: 12 })
      expect(result.predictions.assumptions.length).toBeGreaterThan(0)
      expect(result.recommendation.length).toBeGreaterThan(20)
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(result.riskLevel)
    }
  })

  it('keeps confidence bounded and lower when history is thin', () => {
    const empty = snapshot({ products: [], customers: [], last30dRevenue: 0, previous30dRevenue: 0, last30dOrders: 0, previous30dOrders: 0, productPairs: [] })
    const result = projectExecutiveScenario(empty, { revenue: [], orders: [], productSales: [], customerCohorts: [] }, 'PRICING', { priceChangePct: 5 })
    expect(result.confidence).toBeGreaterThanOrEqual(0.1)
    expect(result.confidence).toBeLessThanOrEqual(0.85)
  })
})

describe('PR49 decision accuracy', () => {
  it('scores exact predictions as 1 and grades EXCELLENT', () => {
    const score = decisionAccuracyScore({ revenue: 1000, orders: 10 }, { revenue: 1000, orders: 10 })
    expect(score).toBe(1)
    expect(qualityRatingForAccuracy(score)).toBe('EXCELLENT')
  })

  it('penalises misses proportionally and grades honestly', () => {
    const score = decisionAccuracyScore({ revenue: 1000 }, { revenue: 500 })
    expect(score).toBeCloseTo(0.5, 2)
    expect(qualityRatingForAccuracy(score)).toBe('FAIR')
  })

  it('ignores non-numeric keys and returns 0 for empty overlap', () => {
    expect(decisionAccuracyScore({ note: 'text' }, { note: 'text' })).toBe(0)
    expect(decisionAccuracyScore({}, {})).toBe(0)
  })
})

describe('PR49 roadmap progress', () => {
  const milestones: readonly RoadmapMilestone[] = [
    { key: 'm1', title: 'One', description: '', dueDate: '2026-08-01', status: 'COMPLETE', successMetrics: [], dependencies: [] },
    { key: 'm2', title: 'Two', description: '', dueDate: '2026-08-08', status: 'CURRENT', successMetrics: [], dependencies: ['m1'] },
    { key: 'm3', title: 'Three', description: '', dueDate: '2026-08-15', status: 'PENDING', successMetrics: [], dependencies: ['m2'] },
  ]
  it('computes progress from completed milestones', () => {
    expect(roadmapProgressFromMilestones(milestones, NOW)).toBeCloseTo(1 / 3, 4)
  })
})

describe('PR49 benchmark percentile interpolation', () => {
  const ladder = [
    { percentile: 10 as const, value: 2500 },
    { percentile: 25 as const, value: 5200 },
    { percentile: 50 as const, value: 10400 },
    { percentile: 75 as const, value: 21000 },
    { percentile: 90 as const, value: 42000 },
  ]
  it('interpolates between ladder points', () => {
    expect(benchmarkPercentile(ladder, 10400)).toBeCloseTo(50, 1)
    expect(benchmarkPercentile(ladder, 2500)).toBeLessThanOrEqual(10)
    expect(benchmarkPercentile(ladder, 52000)).toBeGreaterThan(90)
    expect(benchmarkPercentile(ladder, 5200)).toBeCloseTo(25, 1)
  })
  it('handles empty ladders safely', () => {
    expect(benchmarkPercentile([], 100)).toBe(0)
  })
})
