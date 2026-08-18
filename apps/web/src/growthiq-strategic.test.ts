import { describe, expect, it } from 'vitest'
import type { BenchmarkPosition, ExecutiveOpportunity, ExecutiveRisk } from './executive-model.js'
import {
  growthBetween,
  growthMilestones,
  impactPreviews,
  momentumScore,
  projectTrajectory,
  strategicPosition,
  trailingWindows,
  weeklyDigest,
} from './growthiq-strategic.js'

const series = (values: readonly number[], startDay = '2026-07-01') =>
  values.map((value, index) => ({ day: new Date(Date.parse(`${startDay}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10), value }))

const benchmarkPosition = (overrides: Partial<Record<'REVENUE' | 'AOV' | 'REPEAT_PURCHASE', Readonly<{ yourValue: number | null; industryMedian: number | null; percentile: number | null }>>> = {}): BenchmarkPosition => ({
  storeId: 's',
  category: 'Fashion & Apparel',
  categorySource: 'AUTO_DETECTED',
  visibleMetrics: 7,
  totalMetrics: 7,
  asOf: '2026-08-01',
  positions: (['REVENUE', 'AOV', 'REPEAT_PURCHASE'] as const).map((metric) => ({
    metric,
    label: metric,
    yourValue: overrides[metric]?.yourValue ?? null,
    currency: metric === 'REPEAT_PURCHASE' ? null : 'USD',
    industryMedian: overrides[metric]?.industryMedian ?? null,
    top10Target: null,
    percentile: overrides[metric]?.percentile ?? null,
    gapToTop10Pct: null,
    sourceLabel: 'curated',
    yourValueMissing: (overrides[metric]?.yourValue ?? null) === null,
  })),
})

const opportunity = (category: ExecutiveOpportunity['category'], title: string, impactAnnual: number): ExecutiveOpportunity => ({
  id: title,
  storeId: 's',
  category,
  title,
  description: '',
  estimatedImpactAnnual: impactAnnual,
  impactCurrency: 'USD',
  confidence: 0.6,
  effortLevel: 'LOW',
  timeline: '30_DAYS',
  actionPlan: [],
  status: 'NEW',
  identifiedAt: '2026-08-01',
  updatedAt: '2026-08-01',
})

const risk = (title: string, status: ExecutiveRisk['status'] = 'ACTIVE'): ExecutiveRisk => ({
  id: title,
  storeId: 's',
  riskType: 'CONCENTRATION',
  title,
  description: '',
  severity: 'HIGH',
  probability: 0.5,
  impactIfRealized: 1000,
  impactCurrency: 'USD',
  mitigationPlan: [],
  status,
  detectedAt: '2026-08-01',
  resolvedAt: null,
})

describe('projectTrajectory — trend projection over REAL data only', () => {
  it('returns null with fewer than two real points — never invents a chart', () => {
    expect(projectTrajectory([])).toBeNull()
    expect(projectTrajectory([{ day: '2026-08-01', value: 100 }])).toBeNull()
  })

  it('extends a perfectly linear trend with a precise slope', () => {
    // +10/day for 30 days → next month grows by exactly 300 over the window mean.
    const result = projectTrajectory(series(Array.from({ length: 30 }, (_, i) => 100 + i * 10)))!
    expect(result).not.toBeNull()
    expect(result.projected).toHaveLength(30)
    // The projection continues the +10/day line: day 30 → 400, day 59 → 690.
    expect(result.projected[0]!.value).toBeCloseTo(400, 5)
    expect(result.projected.at(-1)!.value).toBeCloseTo(690, 5)
    expect(result.direction).toBe('growing')
    expect(result.growthRatePct).toBeGreaterThan(0)
    expect(result.confidencePct).toBeGreaterThanOrEqual(8)
    expect(result.confidencePct).toBeLessThanOrEqual(92)
  })

  it('keeps a flat series stable and clamps falling projections at zero', () => {
    const flat = projectTrajectory(series(Array.from({ length: 14 }, () => 50)))!
    expect(flat.direction).toBe('stable')
    expect(flat.projectedMonthlyRevenue).toBeCloseTo(1500, 0)
    const falling = projectTrajectory(series(Array.from({ length: 14 }, (_, i) => Math.max(0, 200 - i * 30))))!
    for (const point of falling.projected) expect(point.value).toBeGreaterThanOrEqual(0)
    for (const band of falling.band) expect(band.low).toBeGreaterThanOrEqual(0)
  })

  it('widens the confidence band with distance from the last real day', () => {
    const noisy = projectTrajectory(series([100, 140, 90, 150, 95, 160, 100, 170]))!
    const firstSpread = noisy.band[0]!.high - noisy.band[0]!.low
    const lastSpread = noisy.band.at(-1)!.high - noisy.band.at(-1)!.low
    expect(lastSpread).toBeGreaterThan(firstSpread)
    // Day labels continue from the last REAL day.
    expect(noisy.projected[0]!.day > noisy.historical.at(-1)!.day).toBe(true)
  })
})

describe('strategicPosition — quadrant from measured inputs only', () => {
  it('maps momentum scores with clamping', () => {
    expect(momentumScore(null)).toBeNull()
    expect(momentumScore(-20)).toBe(0)
    expect(momentumScore(20)).toBe(100)
    expect(momentumScore(0)).toBe(50)
  })

  it('returns honest nulls when an axis is not measurable', () => {
    const noPercentile = strategicPosition({ revenuePercentile: null, growthRatePct: 12 })
    expect(noPercentile.quadrant).toBeNull()
    expect(noPercentile.y).toBe(80)
    const noGrowth = strategicPosition({ revenuePercentile: 62, growthRatePct: null })
    expect(noGrowth.x).toBe(62)
    expect(noGrowth.stage).toBeNull()
  })

  it('places each quadrant with an executive focus', () => {
    expect(strategicPosition({ revenuePercentile: 70, growthRatePct: 10 }).quadrant).toBe('momentum')
    expect(strategicPosition({ revenuePercentile: 70, growthRatePct: -10 }).quadrant).toBe('established')
    expect(strategicPosition({ revenuePercentile: 20, growthRatePct: 10 }).stage).toBe('Early growth')
    expect(strategicPosition({ revenuePercentile: 20, growthRatePct: -10 }).stage).toBe('Foundation')
  })
})

describe('trailingWindows + growthBetween', () => {
  it('never fabricates a prior period', () => {
    const points = series([10, 20, 30])
    expect(trailingWindows(points, 3).prior).toBeNull()
    expect(growthBetween(30, null)).toBeNull()
    expect(growthBetween(30, 0)).toBeNull()
    expect(growthBetween(40, 20)).toBeCloseTo(100)
  })
})

describe('impactPreviews — computed from real gaps, honest when unmeasurable', () => {
  it('prices the AOV gap with real monthly orders', () => {
    const previews = impactPreviews({ position: benchmarkPosition({ AOV: { yourValue: 40, industryMedian: 60, percentile: 30 } }), opportunities: [], orders30: 50, currency: 'USD', topProductSharePct: null })
    const revenue = previews.find((preview) => preview.key === 'revenue')!
    expect(revenue.impactLabel).toBe('+$1,000/mo') // (60 − 40) × 50 real orders
    expect(revenue.detail).toContain('$60')
  })

  it('celebrates real strengths instead of inventing gaps', () => {
    const previews = impactPreviews({ position: benchmarkPosition({ AOV: { yourValue: 80, industryMedian: 60, percentile: 85 }, REPEAT_PURCHASE: { yourValue: 31, industryMedian: 25, percentile: 70 } }), opportunities: [], orders30: 10, currency: 'USD', topProductSharePct: null })
    expect(previews.find((preview) => preview.key === 'revenue')!.impactLabel).toBe('Above the median')
    expect(previews.find((preview) => preview.key === 'customers')!.impactLabel).toBe('Retention leads')
  })

  it('stays silent where nothing is measurable', () => {
    const previews = impactPreviews({ position: benchmarkPosition(), opportunities: [], orders30: 0, currency: 'USD', topProductSharePct: null })
    for (const preview of previews) expect(preview.impactLabel).toBeNull()
    expect(previews.find((preview) => preview.key === 'revenue')!.detail).toContain('measurable once')
  })

  it('surfaces real concentration and real opportunity impacts', () => {
    const concentrated = impactPreviews({ position: null, opportunities: [], orders30: 0, currency: 'USD', topProductSharePct: 62 })
    expect(concentrated.find((preview) => preview.key === 'product')!.impactLabel).toBe('62% on one product')
    const withMarket = impactPreviews({ position: null, opportunities: [opportunity('EXPANSION', 'Open wholesale channel', 12_000)], orders30: 0, currency: 'USD', topProductSharePct: null })
    expect(withMarket.find((preview) => preview.key === 'market')!.impactLabel).toBe('+$1,000/mo')
    expect(withMarket.find((preview) => preview.key === 'market')!.detail).toBe('Open wholesale channel')
  })
})

describe('growthMilestones — a ladder counted from real totals', () => {
  const base = { syncedOrders: 0, customers: 0, daysSynced: 0, syncedRevenue: 0, decisionsLogged: 0, hasReport: false, hasDiagnosis: false, currency: 'USD' }

  it('starts at the very first milestone with an honest zero-pace note', () => {
    const result = growthMilestones(base)
    expect(result.completedCount).toBe(0)
    expect(result.active?.key).toBe('first-sale')
    expect(result.active?.progressPct).toBe(0)
    expect(result.stage).toBe('Foundation')
  })

  it('marks progress in order and estimates pace from the real window', () => {
    const result = growthMilestones({ ...base, syncedOrders: 7, customers: 5, daysSynced: 14, decisionsLogged: 1 })
    expect(result.milestones.find((milestone) => milestone.key === 'first-sale')!.status).toBe('complete')
    expect(result.active?.key).toBe('orders-10')
    expect(result.active?.progressPct).toBe(70)
    // 7 orders / 14 days = 0.5/day → 3 remaining ≈ 6/7 day ≈ ~1 week → honest range.
    expect(result.eta).toMatch(/^≈\d+–\d+ weeks at your current pace$/)
    expect(result.stage).toBe('Launch')
    // Later milestones stay locked behind the current one.
    expect(result.milestones.find((milestone) => milestone.key === 'customers-25')!.status).toBe('locked')
  })

  it('derives the lifecycle stage from the furthest real milestone', () => {
    expect(growthMilestones({ ...base, syncedOrders: 12, customers: 9, daysSynced: 20 }).stage).toBe('Early growth')
    expect(growthMilestones({ ...base, syncedOrders: 140, customers: 80, daysSynced: 90 }).stage).toBe('Expansion')
  })

  it('labels revenue milestones in the store currency', () => {
    const result = growthMilestones({ ...base, syncedRevenue: 1200 })
    const money = result.milestones.find((milestone) => milestone.key === 'revenue-1k')!
    expect(money.title).toContain('$1,000')
    expect(money.status).toBe('complete')
  })
})

describe('weeklyDigest — last 7 real days vs the prior 7', () => {
  const baseInput = {
    topProducts: [] as readonly { title: string; revenue: number; sharePct: number }[],
    opportunities: [] as readonly ExecutiveOpportunity[],
    risks: [] as readonly ExecutiveRisk[],
    repeatRatePct: null,
    repeatMedianPct: null,
  }

  it('returns null below 7 synced days — the honest locked state', () => {
    expect(weeklyDigest({ ...baseInput, revenueSeries: series([10, 20, 30]), ordersSeries: series([1, 2, 3]) })).toBeNull()
  })

  it('computes the week-over-week snapshot from the series', () => {
    const revenueSeries = series([...Array(7).fill(100), ...Array(7).fill(150)])
    const ordersSeries = series([...Array(7).fill(4), ...Array(7).fill(6)])
    const digest = weeklyDigest({ ...baseInput, revenueSeries, ordersSeries })!
    expect(digest.revenue7).toBe(1050)
    expect(digest.revenueWowPct).toBeCloseTo(50)
    expect(digest.orders7).toBe(42)
    expect(digest.ordersWowPct).toBeCloseTo(50)
    expect(digest.bestProduct).toBeNull()
  })

  it('picks the strategic focus from the strongest real signal', () => {
    const declining = weeklyDigest({ ...baseInput, revenueSeries: series([...Array(7).fill(200), ...Array(7).fill(150)]), ordersSeries: series(Array(14).fill(5)) })!
    expect(declining.focus?.title).toBe('Stabilize revenue momentum')
    const concentrated = weeklyDigest({ ...baseInput, topProducts: [{ title: 'Hero SKU', revenue: 900, sharePct: 72 }], revenueSeries: series(Array(14).fill(100)), ordersSeries: series(Array(14).fill(5)) })!
    expect(concentrated.focus?.title).toBe('Diversify beyond your top product')
    const retention = weeklyDigest({ ...baseInput, revenueSeries: series(Array(14).fill(100)), ordersSeries: series(Array(14).fill(5)), repeatRatePct: 12, repeatMedianPct: 24 })!
    expect(retention.focus?.title).toBe('Retention & repeat purchase')
    const scaling = weeklyDigest({ ...baseInput, revenueSeries: series([...Array(7).fill(100), ...Array(7).fill(130)]), ordersSeries: series(Array(14).fill(5)) })!
    expect(scaling.focus?.title).toBe('Scale what is working')
    const quiet = weeklyDigest({ ...baseInput, revenueSeries: series(Array(14).fill(100)), ordersSeries: series(Array(14).fill(5)) })!
    expect(quiet.focus).toBeNull()
  })

  it('lists only real opportunities and only ACTIVE risks', () => {
    const digest = weeklyDigest({
      ...baseInput,
      revenueSeries: series(Array(14).fill(100)),
      ordersSeries: series(Array(14).fill(5)),
      opportunities: [opportunity('MARKET_GAP', 'Bundle bestsellers', 4000), opportunity('PRICING', 'Raise hero price', 3000), opportunity('SEASONAL', 'Holiday push', 2000)],
      risks: [risk('One channel carries 88% of revenue'), risk('Resolved risk', 'RESOLVED')],
    })!
    expect(digest.opportunities).toEqual(['Bundle bestsellers', 'Raise hero price'])
    expect(digest.attention).toEqual(['One channel carries 88% of revenue'])
  })
})
