/**
 * Pure calculators for the redesigned Analytics widgets.
 *
 * Every number produced here is derived from data ProfitPilot actually synced
 * from Shopify (daily revenue rows, daily order rows, inventory rows). Nothing
 * is sampled, seeded, or invented: when a source is missing the calculator
 * returns `null` / an empty result so the UI can state the truth instead of
 * drawing a placeholder curve.
 */
import type { AnalyticsSnapshot } from './model.js'
import type { TrendPoint } from './analytics-model.js'
import type { InventoryPageResult, InventoryRowItem, StockStatus } from './inventory-model.js'
import { safeDayKey } from './safe-date.js'

const finite = (value: unknown, fallback = 0): number => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

/* ────────────────────────────── Revenue pacing ───────────────────────────── */

export type PacingRow = Readonly<{
  day: string
  /** Daily revenue for this day (0 on no-sale days so the line drops to $0). */
  revenue: number
  /** Daily revenue of the comparable previous-period day; null when no baseline. */
  previous: number | null
  /** Daily AI forecast for this day; null on historical days. */
  forecast: number | null
}>

export type RevenuePacing = Readonly<{
  rows: readonly PacingRow[]
  /** True when at least one synced day carries revenue. */
  hasData: boolean
  total: number
  /** Previous-period running total at the same elapsed day (apples to apples). */
  previousToDate: number | null
  /** Previous-period total across the whole comparison window. */
  previousTotal: number | null
  /** Pace difference against `previousToDate`, in percent. */
  pace: number | null
  daysElapsed: number
  daysTotal: number
  runRate: number
  /** Period close projected by the AI forecast, when the forecast is available. */
  projectedClose: number | null
  /** Period close implied by the current run rate. Always available. */
  runRateClose: number
  peak: Readonly<{ day: string; revenue: number }> | null
  lastRealDay: string | null
}>

/**
 * Builds the daily "momentum" rows (the chart's discrete plot — every day is
 * its own revenue value, so zero-sale days visibly drop to $0) while also
 * computing the summary figures the card still narrates: how much the store has
 * banked so far versus the same elapsed point of the previous period, plus the
 * projected close of the current period.
 */
export function revenuePacing(trend: readonly TrendPoint[]): RevenuePacing {
  const rows: PacingRow[] = []
  let running = 0
  let previousRunning = 0
  let projected = 0
  let seenForecast = false
  let daysElapsed = 0
  let hasPrevious = false
  let hasData = false
  let previousToDate: number | null = null
  let peak: Readonly<{ day: string; revenue: number }> | null = null
  let lastRealDay: string | null = null

  for (const point of trend) {
    const day = safeDayKey(point?.day) ?? point?.day
    if (typeof day !== 'string' || !day) continue
    const revenue = finite(point.revenue)
    const previous = point.previous === null || point.previous === undefined ? null : finite(point.previous)
    const forecast = point.forecast === null || point.forecast === undefined ? null : finite(point.forecast)
    if (previous !== null) { previousRunning += previous; if (previous > 0) hasPrevious = true }

    if (forecast === null) {
      running += revenue
      daysElapsed += 1
      projected = running
      if (revenue > 0) { hasData = true; if (!peak || revenue > peak.revenue) peak = { day, revenue } }
      lastRealDay = day
      previousToDate = hasPrevious ? previousRunning : null
      rows.push({ day, revenue, previous: hasPrevious ? previous : null, forecast: null })
    } else {
      seenForecast = true
      projected += forecast
      rows.push({ day, revenue: 0, previous: hasPrevious ? previous : null, forecast })
    }
  }

  const runRate = daysElapsed > 0 ? running / daysElapsed : 0
  const daysTotal = rows.length
  const pace = previousToDate !== null && previousToDate > 0 ? ((running - previousToDate) / previousToDate) * 100 : null
  return {
    rows,
    hasData,
    total: running,
    previousToDate,
    previousTotal: hasPrevious ? previousRunning : null,
    pace,
    daysElapsed,
    daysTotal,
    runRate,
    projectedClose: seenForecast ? projected : null,
    runRateClose: runRate * Math.max(daysElapsed, daysTotal),
    peak,
    lastRealDay,
  }
}

/* ─────────────────────── Discount & revenue leakage ─────────────────────── */

export type LeakageRow = Readonly<{ day: string; collected: number; discounts: number; discountRate: number | null }>

export type RevenueLeakage = Readonly<{
  rows: readonly LeakageRow[]
  hasData: boolean
  /** Money actually captured (Shopify order totals). */
  collected: number
  /** Money given away through discount codes and automatic discounts. */
  discounts: number
  /** collected + discounts — what the basket was worth before markdowns. */
  merchandiseValue: number
  /** Share of merchandise value handed back as discounts. */
  discountRate: number | null
  /** Days in the period where at least one discount was applied. */
  discountDays: number
  heaviestDay: Readonly<{ day: string; discounts: number; rate: number | null }> | null
  orders: number
  cancelledOrders: number
  cancelRate: number | null
  fulfilledOrders: number
  /** Money recovered by trimming the discount rate by one percentage point. */
  onePointValue: number
}>

/**
 * Reconstructs the discount waterfall for the days currently on screen.
 *
 * `grossRevenue` in `analytics_revenue_daily` is the Shopify order total *after*
 * discounts, and `discounts` is the amount taken off, so merchandise value is
 * the sum of the two. Cancellations are reported as counts because Shopify's
 * daily aggregate does not carry a cancelled-order value — an estimate would be
 * fabrication.
 */
export function revenueLeakage(snapshot: AnalyticsSnapshot | null, days: readonly string[]): RevenueLeakage {
  // `days` is the continuous axis from periodTrend (now includes zero days).
  // Build a map of real revenue/discounts, then emit a row for EVERY day in the scope
  // with explicit 0 so the chart visibly drops on zero-sale days.
  const normalizedScope = days.map((day) => safeDayKey(day) ?? day).filter((d): d is string => Boolean(d)).sort()
  const scope = new Set(normalizedScope)
  const byDay = new Map<string, { collected: number; discounts: number }>()
  for (const row of snapshot?.revenue ?? []) {
    const day = safeDayKey(row?.day)
    if (!day || (scope.size > 0 && !scope.has(day))) continue
    const current = byDay.get(day) ?? { collected: 0, discounts: 0 }
    byDay.set(day, { collected: current.collected + finite(row.grossRevenue), discounts: current.discounts + finite(row.discounts) })
  }

  let orders = 0
  let cancelledOrders = 0
  let fulfilledOrders = 0
  for (const row of snapshot?.orders ?? []) {
    const day = safeDayKey(row?.day)
    if (!day || (scope.size > 0 && !scope.has(day))) continue
    orders += finite(row.orderCount)
    cancelledOrders += finite(row.cancelledCount)
    fulfilledOrders += finite(row.fulfilledCount)
  }

  const rows: LeakageRow[] = (scope.size > 0 ? normalizedScope : [...byDay.keys()].sort()).map((day) => {
    const value = byDay.get(day) ?? { collected: 0, discounts: 0 }
    const merchandise = value.collected + value.discounts
    return { day, collected: value.collected, discounts: value.discounts, discountRate: merchandise > 0 ? (value.discounts / merchandise) * 100 : null }
  })

  const collected = rows.reduce((sum, row) => sum + row.collected, 0)
  const discounts = rows.reduce((sum, row) => sum + row.discounts, 0)
  const merchandiseValue = collected + discounts
  const discountDays = rows.filter((row) => row.discounts > 0).length
  const heaviest = rows.filter((row) => row.discounts > 0).sort((a, b) => b.discounts - a.discounts)[0] ?? null

  return {
    rows,
    hasData: rows.some((row) => row.collected > 0 || row.discounts > 0),
    collected,
    discounts,
    merchandiseValue,
    discountRate: merchandiseValue > 0 ? (discounts / merchandiseValue) * 100 : null,
    discountDays,
    heaviestDay: heaviest ? { day: heaviest.day, discounts: heaviest.discounts, rate: heaviest.discountRate } : null,
    orders,
    cancelledOrders,
    cancelRate: orders > 0 ? (cancelledOrders / orders) * 100 : null,
    fulfilledOrders,
    onePointValue: merchandiseValue * 0.01,
  }
}

/* ───────────────────────── Stock-out risk & cover ───────────────────────── */

export type StockRiskItem = Readonly<{
  variantId: string
  label: string
  sku: string | null
  status: StockStatus
  quantity: number | null
  /** Days of stock left at the measured sales velocity, when Shopify data allows it. */
  days: number | null
  /** Units per day measured from synced order history. */
  velocity: number | null
  price: number | null
  /** Revenue exposed over the next 30 days if the item is not restocked. */
  exposure: number | null
}>

export type StockRisk = Readonly<{
  items: readonly StockRiskItem[]
  hasInventory: boolean
  /** False when the plan does not include days-of-cover (never guessed). */
  coverAvailable: boolean
  /**
   * True ONLY when days-of-cover is locked behind the plan (an Upgrade CTA is
   * appropriate). False on Commander and on young stores that simply have not
   * collected enough sales history yet — those show an "awaiting baseline"
   * note instead of an upgrade button.
   */
  coverLocked: boolean
  outCount: number
  lowCount: number
  healthyCount: number
  untrackedCount: number
  trackedCount: number
  /** Items that will run dry inside the reorder window. */
  urgentCount: number
  /** Sum of the 30-day exposure across measurable at-risk items. */
  exposure: number | null
  /** Items whose exposure could be measured (velocity and price both known). */
  exposureItems: number
  currency: string | null
  reorderWindowDays: number
  explanation: string
}>

const REORDER_WINDOW_DAYS = 14
const EXPOSURE_HORIZON_DAYS = 30

function riskLabel(item: InventoryRowItem): string {
  const variant = item.variantTitle && item.variantTitle !== 'Default Title' ? ` · ${item.variantTitle}` : ''
  return `${item.title}${variant}`
}

/**
 * Ranks the SKUs closest to running out, using Shopify stock levels and the
 * sales velocity ProfitPilot already computes for the Inventory workspace.
 * Untracked SKUs are counted but never ranked — they have no stock signal.
 */
export function stockRisk(page: InventoryPageResult | null, limit = 6): StockRisk {
  const items = page?.items ?? []
  const coverAvailable = items.some((item) => item.daysOfCover.status === 'available')
  const locked = items.some((item) => item.daysOfCover.status === 'locked')
  // The Upgrade CTA is keyed STRICTLY on a plan-locked days-of-cover status.
  // A store on Commander (or any plan) whose days-of-cover is missing because
  // there is not yet a 30-day sales baseline is NOT locked — it is awaiting
  // history, and showing an Upgrade button there is a false upsell.
  const coverLocked = locked
  const distribution = page?.distribution ?? { healthy: 0, low: 0, out: 0, untracked: 0 }
  const stats = page?.stats

  const ranked: StockRiskItem[] = items
    .filter((item) => item.status === 'out' || item.status === 'low' || item.daysOfCover.status === 'available')
    .map((item) => {
      const cover = item.daysOfCover
      const days = cover.status === 'available' ? cover.days : null
      const velocity = cover.status === 'available' ? cover.velocity : null
      const price = item.price
      const missedUnits = velocity !== null && velocity > 0 && days !== null ? Math.max(0, EXPOSURE_HORIZON_DAYS - days) * velocity : null
      const exposure = missedUnits !== null && price !== null ? missedUnits * price : null
      return { variantId: item.variantId, label: riskLabel(item), sku: item.sku, status: item.status, quantity: item.quantity, days, velocity, price, exposure }
    })
    .sort((a, b) => {
      const rank = (row: StockRiskItem) => (row.status === 'out' ? 0 : row.status === 'low' ? 1 : 2)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      if (a.days !== null && b.days !== null) return a.days - b.days
      if (a.days !== null) return -1
      if (b.days !== null) return 1
      return (b.exposure ?? 0) - (a.exposure ?? 0)
    })

  const exposureItems = ranked.filter((item) => item.exposure !== null && item.exposure > 0)
  const urgentCount = ranked.filter((item) => item.status === 'out' || (item.days !== null && item.days <= REORDER_WINDOW_DAYS)).length

  // Cover missing for a non-locked store = not enough synced sales history yet
  // (young stores, Commander included). That is an "awaiting baseline" state,
  // never an upsell.
  const awaitingBaseline = items.length > 0 && !coverAvailable && !coverLocked
  return {
    items: ranked.slice(0, limit),
    hasInventory: items.length > 0,
    coverAvailable,
    coverLocked,
    outCount: distribution.out || stats?.outOfStockCount || 0,
    lowCount: distribution.low || stats?.lowStockCount || 0,
    healthyCount: distribution.healthy || stats?.inStockCount || 0,
    untrackedCount: distribution.untracked || stats?.untrackedSkus || 0,
    trackedCount: stats?.trackedSkus ?? 0,
    urgentCount,
    exposure: exposureItems.length ? exposureItems.reduce((sum, item) => sum + (item.exposure ?? 0), 0) : null,
    exposureItems: exposureItems.length,
    currency: stats?.currency ?? null,
    reorderWindowDays: REORDER_WINDOW_DAYS,
    explanation: coverLocked
      ? 'Days of cover is a Growth feature. Stock counts below come straight from Shopify.'
      : awaitingBaseline
        ? 'Awaiting sales history baseline — days of cover appear once enough daily sales history has synced.'
        : page?.coverage.explanation ?? 'Sync your Shopify products to measure stock-out risk.',
  }
}
