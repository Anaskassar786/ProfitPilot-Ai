/**
 * GrowthIQ — strategic derivations.
 *
 * Pure, deterministic math over the real dashboard payload. These functions
 * power the executive/strategic layers of the GrowthIQ page (business
 * trajectory, strategic position, impact previews, growth milestones, weekly
 * digest, and sidebar insights).
 *
 * The zero-fake-data contract is enforced here:
 *  - projections are least-squares trend extensions of REAL synced revenue
 *    with an honest residual-based confidence band;
 *  - every benchmark comparison uses the curated public ladders returned by
 *    the API and the merchant's measured value — when the merchant value is
 *    not measurable the derivation returns `null`, never a stand-in;
 *  - milestones count real synced orders / customers / days / revenue;
 *  - no constant in this file is ever presented as a store metric.
 *  - all functions validate inputs and return null for invalid/unmeasurable data.
 */
import type { BenchmarkPosition, ExecutiveOpportunity, ExecutiveRisk } from './executive-model.js'

export type DayPoint = Readonly<{ day: string; value: number }>

// Helper to check if a number is valid (not null, undefined, NaN, or Infinity)
function isValidNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

// ────────────────────────────────────────────────────────────────────────────
// Business trajectory (history + trend projection)
// ────────────────────────────────────────────────────────────────────────────

/** Ordinary least squares over y = f(index). Returns null if values are invalid. */
function fitLine(values: readonly number[]): Readonly<{ slope: number; intercept: number; r2: number; residualStd: number }> | null {
  const n = values.length
  if (n < 2) return null
  
  // Filter out invalid values
  const validValues = values.filter((v) => isValidNumber(v))
  if (validValues.length < 2) return null
  
  const meanX = (n - 1) / 2
  const meanY = validValues.reduce((sum, value) => sum + value, 0) / validValues.length
  let sxx = 0
  let sxy = 0
  for (let index = 0; index < validValues.length; index += 1) {
    sxx += (index - meanX) ** 2
    sxy += (index - meanX) * (validValues[index]! - meanY)
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  const intercept = meanY - slope * meanX
  let sse = 0
  let sst = 0
  for (let index = 0; index < validValues.length; index += 1) {
    const residual = validValues[index]! - (slope * index + intercept)
    sse += residual ** 2
    sst += (validValues[index]! - meanY) ** 2
  }
  const r2 = sst > 0 ? Math.max(0, 1 - sse / sst) : 0
  const residualStd = Math.sqrt(sse / Math.max(validValues.length - 2, 1))
  return { slope, intercept, r2, residualStd }
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  const result = new Date(date.getTime() + count * 86_400_000)
  if (Number.isNaN(result.getTime())) return day
  return result.toISOString().slice(0, 10)
}

export type TrajectoryProjection = Readonly<{
  /** Up to the last 30 REAL synced days used for the fit. */
  historical: readonly DayPoint[]
  /** Next 30 days from the measured trend (never below zero). */
  projected: readonly DayPoint[]
  /** 80%-style band around the projection, widening with horizon. */
  band: readonly Readonly<{ day: string; low: number; high: number }>[]
  /** Real average daily revenue over the fitted window × 30. */
  currentMonthlyRunRate: number
  /** Sum of the 30 projected days. */
  projectedMonthlyRevenue: number
  /** (projected / run-rate − 1) × 100; null when the run-rate is zero. */
  growthRatePct: number | null
  /** Fit quality × data coverage, capped — shown as projection confidence. */
  confidencePct: number
  direction: 'growing' | 'stable' | 'declining'
  dataDays: number
}>

/**
 * Projects the next 30 days from the store's REAL revenue trend. Returns
 * `null` when fewer than two synced days exist — the honest state, which the
 * UI turns into an educational note rather than a fabricated chart.
 */
export function projectTrajectory(series: readonly DayPoint[]): TrajectoryProjection | null {
  const usable = series.filter((point) => point !== null && point !== undefined && Number.isFinite(point.value))
  if (usable.length < 2) return null
  const historical = usable.slice(-30)
  const fitResult = fitLine(historical.map((point) => point.value))
  if (!fitResult) return null
  const { slope, intercept, r2, residualStd } = fitResult
  const lastDay = historical.at(-1)!.day
  const startIndex = historical.length - 1
  const projected: DayPoint[] = []
  const band: { day: string; low: number; high: number }[] = []
  for (let ahead = 1; ahead <= 30; ahead += 1) {
    const trend = slope * (startIndex + ahead) + intercept
    const value = Math.max(0, trend)
    const day = addDays(lastDay, ahead)
    // Widen the band with distance from the last real observation.
    const spread = Math.max(residualStd, 0) * 1.28 * Math.sqrt(1 + ahead / 15)
    projected.push({ day, value })
    band.push({ day, low: Math.max(0, value - spread), high: value + spread })
  }
  const historicalSum = historical.reduce((sum, point) => sum + point.value, 0)
  const currentMonthlyRunRate = historical.length > 0 ? (historicalSum / historical.length) * 30 : 0
  const projectedMonthlyRevenue = projected.reduce((sum, point) => sum + point.value, 0)
  const growthRatePct = currentMonthlyRunRate > 0 && isValidNumber(currentMonthlyRunRate) && isValidNumber(projectedMonthlyRevenue) 
    ? (projectedMonthlyRevenue / currentMonthlyRunRate - 1) * 100 
    : null
  const direction = growthRatePct === null ? 'stable' : growthRatePct > 2 ? 'growing' : growthRatePct < -2 ? 'declining' : 'stable'
  const coverage = Math.min(1, usable.length / 60)
  const confidencePct = Math.round(Math.min(92, Math.max(8, (35 + 55 * Math.max(r2, 0)) * (0.55 + 0.45 * coverage))))
  return { historical, projected, band, currentMonthlyRunRate, projectedMonthlyRevenue, growthRatePct, confidencePct, direction, dataDays: usable.length }
}

// ────────────────────────────────────────────────────────────────────────────
// Strategic position (growth momentum × market presence quadrant)
// ────────────────────────────────────────────────────────────────────────────

export type StrategicPosition = Readonly<{
  /** Market presence, 0..100 — the merchant's REAL revenue percentile. */
  x: number | null
  /** Growth momentum, 0..100 — mapped from the REAL month-over-month rate. */
  y: number | null
  stage: string | null
  focus: string | null
  quadrant: 'foundation' | 'early-growth' | 'established' | 'momentum' | null
}>

/** Maps a MoM growth rate into a 0..100 momentum score (−20% → 0, +20% → 100). */
export function momentumScore(growthRatePct: number | null): number | null {
  if (growthRatePct === null || !isValidNumber(growthRatePct)) return null
  return Math.round(Math.min(100, Math.max(0, ((growthRatePct + 20) / 40) * 100)))
}

export function strategicPosition(input: Readonly<{ revenuePercentile: number | null; growthRatePct: number | null }>): StrategicPosition {
  const x = input.revenuePercentile === null || !isValidNumber(input.revenuePercentile) ? null : Math.min(100, Math.max(0, input.revenuePercentile))
  const y = momentumScore(input.growthRatePct)
  if (x === null || y === null) return { x, y, stage: null, focus: null, quadrant: null }
  const highGrowth = y >= 50
  const highPresence = x >= 50
  if (highGrowth && highPresence) return { x, y, stage: 'Market momentum', focus: 'Scale acquisition while protecting margin', quadrant: 'momentum' }
  if (highGrowth) return { x, y, stage: 'Early growth', focus: 'Customer acquisition & repeat purchase', quadrant: 'early-growth' }
  if (highPresence) return { x, y, stage: 'Established', focus: 'Efficiency, retention & expansion revenue', quadrant: 'established' }
  return { x, y, stage: 'Foundation', focus: 'Product-market fit & first repeatable channel', quadrant: 'foundation' }
}

// ────────────────────────────────────────────────────────────────────────────
// Month-over-month helpers (from the REAL daily series)
// ────────────────────────────────────────────────────────────────────────────

export function trailingWindows(series: readonly DayPoint[], days: number): Readonly<{ current: number; prior: number | null }> {
  const current = series.slice(-days).reduce((sum, point) => sum + (point?.value ?? 0), 0)
  const priorSlice = series.slice(-days * 2, -days)
  const prior = priorSlice.length > 0 ? priorSlice.reduce((sum, point) => sum + (point?.value ?? 0), 0) : null
  return { current, prior }
}

export function growthBetween(current: number, prior: number | null): number | null {
  if (prior === null || !isValidNumber(prior) || !isValidNumber(current) || prior <= 0) return null
  return (current / prior - 1) * 100
}

// ────────────────────────────────────────────────────────────────────────────
// Impact previews (computed from real benchmark gaps and real opportunities)
// ────────────────────────────────────────────────────────────────────────────

export type ImpactPreviewKey = 'revenue' | 'customers' | 'product' | 'market'

export type ImpactPreview = Readonly<{
  key: ImpactPreviewKey
  /** Headline, e.g. "+$412/mo at the industry median" — null when not measurable. */
  impactLabel: string | null
  /** Supporting line explaining the number's provenance. */
  detail: string | null
  /** Tone for the impact chip: real shortfalls warn, strengths celebrate. */
  tone: 'positive' | 'warning' | 'neutral'
}>

const money0 = (value: number, currency: string): string => {
  if (!isValidNumber(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(value))
}

export function impactPreviews(input: Readonly<{
  position: BenchmarkPosition | null
  opportunities: readonly ExecutiveOpportunity[]
  orders30: number
  currency: string
  topProductSharePct: number | null
}>): readonly ImpactPreview[] {
  const metricFor = (metric: string) => input.position?.positions.find((entry) => entry.metric === metric) ?? null
  const previews: ImpactPreview[] = []
  const validOrders30 = isValidNumber(input.orders30) && input.orders30 > 0

  // Revenue focus — closing the REAL AOV gap to the curated industry median.
  const aov = metricFor('AOV')
  if (aov && isValidNumber(aov.yourValue) && isValidNumber(aov.industryMedian) && validOrders30) {
    if (aov.industryMedian > aov.yourValue) {
      previews.push({ key: 'revenue', impactLabel: `+${money0((aov.industryMedian - aov.yourValue) * input.orders30, input.currency)}/mo`, detail: `if average order value reaches the ${input.position?.category ?? 'industry'} median of ${money0(aov.industryMedian, input.currency)}`, tone: 'positive' })
    } else {
      previews.push({ key: 'revenue', impactLabel: 'Above the median', detail: `your ${money0(aov.yourValue, input.currency)} AOV already beats the ${money0(aov.industryMedian, input.currency)} industry median — defend it`, tone: 'positive' })
    }
  } else {
    previews.push({ key: 'revenue', impactLabel: null, detail: 'measurable once orders and the benchmark ladder are synced', tone: 'neutral' })
  }

  // Customer focus — REAL repeat-purchase gap to the industry median.
  const repeat = metricFor('REPEAT_PURCHASE')
  if (repeat && isValidNumber(repeat.yourValue) && isValidNumber(repeat.industryMedian)) {
    if (repeat.industryMedian > repeat.yourValue) {
      previews.push({ key: 'customers', impactLabel: `+${Math.round(repeat.industryMedian - repeat.yourValue)} pts retention`, detail: `repeat purchase ${repeat.yourValue.toFixed(1)}% vs the ${repeat.industryMedian.toFixed(1)}% industry median`, tone: 'warning' })
    } else {
      previews.push({ key: 'customers', impactLabel: 'Retention leads', detail: `repeat purchase ${repeat.yourValue.toFixed(1)}% is at or above the industry median`, tone: 'positive' })
    }
  } else {
    previews.push({ key: 'customers', impactLabel: null, detail: 'measurable as soon as customers sync', tone: 'neutral' })
  }

  // Product focus — REAL revenue concentration or a real product opportunity.
  const topShare = input.topProductSharePct
  const productOpportunity = input.opportunities.find((opportunity) => opportunity.category === 'PRODUCT' || opportunity.category === 'CROSS_SELL' || opportunity.category === 'PRICING') ?? null
  if (isValidNumber(topShare) && topShare >= 45) {
    previews.push({ key: 'product', impactLabel: `${Math.round(topShare)}% on one product`, detail: 'of synced revenue rides on your top SKU — a diversification review is due', tone: 'warning' })
  } else if (productOpportunity) {
    previews.push({ key: 'product', impactLabel: `+${money0(productOpportunity.estimatedImpactAnnual / 12, input.currency)}/mo`, detail: productOpportunity.title, tone: 'positive' })
  } else {
    previews.push({ key: 'product', impactLabel: null, detail: 'product-level impact appears once sales distribute across your catalog', tone: 'neutral' })
  }

  // Market focus — first REAL expansion-shaped opportunity on file.
  const market = input.opportunities.find((opportunity) => opportunity.category === 'EXPANSION' || opportunity.category === 'MARKET_GAP' || opportunity.category === 'SEASONAL') ?? null
  if (market) {
    previews.push({ key: 'market', impactLabel: `+${money0(market.estimatedImpactAnnual / 12, input.currency)}/mo`, detail: market.title, tone: 'positive' })
  } else {
    previews.push({ key: 'market', impactLabel: null, detail: 'run an opportunity analysis to reveal market expansion moves', tone: 'neutral' })
  }

  return previews
}

// ────────────────────────────────────────────────────────────────────────────
// Growth milestones (counted from real synced totals only)
// ────────────────────────────────────────────────────────────────────────────

export type MilestoneMetric = 'orders' | 'customers' | 'days' | 'revenue' | 'engagement'

export type GrowthMilestone = Readonly<{
  key: string
  title: string
  target: number
  current: number
  metric: MilestoneMetric
  /**
   * complete → done with real data · current → the metric milestone in
   * progress · locked → further out on the ladder · action → an engagement
   * milestone one merchant action away (never pace-estimated, never blocking
   * the metric ladder).
   */
  status: 'complete' | 'current' | 'locked' | 'action'
  progressPct: number
}>

export type GrowthMilestonesResult = Readonly<{
  milestones: readonly GrowthMilestone[]
  /** First incomplete milestone — the one the merchant is working toward. */
  active: GrowthMilestone | null
  /** Honest pace-based estimate, e.g. "≈3–4 weeks", null when pace is zero. */
  eta: string | null
  completedCount: number
  /** Lifecycle stage derived from the furthest REAL business milestone. */
  stage: 'Foundation' | 'Launch' | 'Early growth' | 'Expansion'
}>

export function growthMilestones(input: Readonly<{
  syncedOrders: number
  customers: number
  daysSynced: number
  syncedRevenue: number
  decisionsLogged: number
  hasReport: boolean
  hasDiagnosis: boolean
  currency: string
}>): GrowthMilestonesResult {
  const money = (value: number) => money0(value, input.currency)
  const defs: readonly Readonly<{ key: string; title: string; target: number; metric: MilestoneMetric; current: number }>[] = [
    { key: 'first-sale', title: 'First sale', target: 1, metric: 'orders', current: input.syncedOrders },
    { key: 'first-decision', title: 'First strategic decision logged', target: 1, metric: 'engagement', current: input.decisionsLogged },
    { key: 'orders-10', title: '10 synced orders', target: 10, metric: 'orders', current: input.syncedOrders },
    { key: 'customers-25', title: '25 customers', target: 25, metric: 'customers', current: input.customers },
    { key: 'orders-30', title: '30 synced orders — full analysis baseline', target: 30, metric: 'orders', current: input.syncedOrders },
    { key: 'customers-50', title: '50 customers', target: 50, metric: 'customers', current: input.customers },
    { key: 'days-60', title: '60 days of synced history', target: 60, metric: 'days', current: input.daysSynced },
    { key: 'first-report', title: 'First board report generated', target: 1, metric: 'engagement', current: input.hasReport ? 1 : 0 },
    { key: 'revenue-1k', title: `${money(1_000)} in synced revenue`, target: 1_000, metric: 'revenue', current: input.syncedRevenue },
    { key: 'customers-100', title: '100 customers', target: 100, metric: 'customers', current: input.customers },
    { key: 'revenue-10k', title: `${money(10_000)} in synced revenue`, target: 10_000, metric: 'revenue', current: input.syncedRevenue },
  ]
  let sawCurrent = false
  const milestones: GrowthMilestone[] = defs.map((def) => {
    const current = isValidNumber(def.current) ? def.current : 0
    const target = isValidNumber(def.target) ? def.target : 1
    const complete = current >= target
    let status: GrowthMilestone['status']
    if (complete) status = 'complete'
    else if (def.metric === 'engagement') status = 'action'
    else if (!sawCurrent) { status = 'current'; sawCurrent = true }
    else status = 'locked'
    const safeTarget = target > 0 ? target : 1
    return { key: def.key, title: def.title, target: def.target, current, metric: def.metric, status, progressPct: Math.min(100, Math.max(0, Math.round((current / safeTarget) * 100))) }
  })
  const active = milestones.find((milestone) => milestone.status === 'current') ?? null

  // Pace from the REAL window: units per day over synced history → weeks to go,
  // shown as a conservative range. Never computed for zero pace.
  let eta: string | null = null
  if (active && isValidNumber(input.daysSynced) && input.daysSynced > 0) {
    const pace = active.current / input.daysSynced
    if (isValidNumber(pace) && pace > 0 && active.current < active.target) {
      const weeks = (active.target - active.current) / (pace * 7)
      if (isValidNumber(weeks) && weeks > 0) {
        const low = Math.max(1, Math.round(weeks))
        const high = Math.max(low + 1, Math.round(weeks * 1.4))
        eta = `≈${low}–${high} weeks at your current pace`
      }
    } else if (active.current === 0) {
      eta = 'Pace appears once the first units sync'
    }
  }

  const stage: GrowthMilestonesResult['stage'] =
    (isValidNumber(input.customers) && input.customers >= 50) || (isValidNumber(input.syncedOrders) && input.syncedOrders >= 100) ? 'Expansion'
      : (isValidNumber(input.syncedOrders) && input.syncedOrders >= 10) || (isValidNumber(input.customers) && input.customers >= 10) ? 'Early growth'
        : (isValidNumber(input.syncedOrders) && input.syncedOrders >= 1) ? 'Launch'
          : 'Foundation'
  return { milestones, active, eta, completedCount: milestones.filter((milestone) => milestone.status === 'complete').length, stage }
}

// ────────────────────────────────────────────────────────────────────────────
// Weekly executive digest (last 7 REAL days vs the prior 7)
// ────────────────────────────────────────────────────────────────────────────

export type WeeklyDigest = Readonly<{
  revenue7: number
  revenueWowPct: number | null
  orders7: number
  ordersWowPct: number | null
  bestProduct: string | null
  focus: Readonly<{ title: string; reason: string }> | null
  opportunities: readonly string[]
  attention: readonly string[]
}>

/**
 * Builds the digest from the real series. Returns `null` when fewer than 7
 * synced days exist — the UI shows the honest "unlocks after 7 days" note
 * (with the real count) instead of an invented snapshot.
 */
export function weeklyDigest(input: Readonly<{
  revenueSeries: readonly DayPoint[]
  ordersSeries: readonly DayPoint[]
  topProducts: readonly Readonly<{ title: string; revenue: number; sharePct: number }>[]
  opportunities: readonly ExecutiveOpportunity[]
  risks: readonly ExecutiveRisk[]
  repeatRatePct: number | null
  repeatMedianPct: number | null
}>): WeeklyDigest | null {
  if (!input || !input.revenueSeries || input.revenueSeries.length < 7) return null
  if (!input.ordersSeries) return null
  
  const revenue = trailingWindows(input.revenueSeries, 7)
  const orders = trailingWindows(input.ordersSeries, 7)
  const revenueWowPct = growthBetween(revenue.current, revenue.prior)
  const ordersWowPct = growthBetween(orders.current, orders.prior)
  const bestProduct = input.topProducts?.[0]?.title ?? null
  const topShare = input.topProducts?.[0]?.sharePct ?? null

  let focus: WeeklyDigest['focus'] = null
  if (isValidNumber(revenueWowPct) && revenueWowPct <= -8) {
    focus = { title: 'Stabilize revenue momentum', reason: `Week-over-week revenue is down ${Math.abs(revenueWowPct).toFixed(1)}% — protect the top line before expanding spend.` }
  } else if (isValidNumber(topShare) && topShare >= 55) {
    focus = { title: 'Diversify beyond your top product', reason: `${Math.round(topShare)}% of synced revenue comes from "${input.topProducts[0]!.title}" — concentration is the top strategic exposure.` }
  } else if (isValidNumber(input.repeatRatePct) && isValidNumber(input.repeatMedianPct) && input.repeatRatePct < input.repeatMedianPct) {
    focus = { title: 'Retention & repeat purchase', reason: `Repeat purchase at ${input.repeatRatePct.toFixed(1)}% trails the ${input.repeatMedianPct.toFixed(1)}% industry median — cheap growth hides there.` }
  } else if (isValidNumber(revenueWowPct) && revenueWowPct >= 10) {
    focus = { title: 'Scale what is working', reason: `Momentum is compounding (+${revenueWowPct.toFixed(1)}% WoW) — reinforce the channel and SKUs driving it.` }
  }

  return {
    revenue7: revenue.current,
    revenueWowPct,
    orders7: orders.current,
    ordersWowPct,
    bestProduct,
    focus,
    opportunities: (input.opportunities ?? []).slice(0, 2).map((opportunity) => opportunity.title),
    attention: (input.risks ?? []).filter((risk) => risk.status === 'ACTIVE').slice(0, 2).map((risk) => risk.title),
  }
}
