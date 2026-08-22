import type { AnalyticsSnapshot } from './model.js'
import { safeAddDays, safeDayKey, todayDayKey } from './safe-date.js'

export type AnalyticsPeriod = 7 | 30 | 90 | 365
export type AnalyticsInsights = Readonly<{
  plan: 'trial' | 'start' | 'growth' | 'commander'
  generatedAt: string
  salesHistoryDays: number
  forecast: Readonly<{ status: 'available' | 'insufficient_data'; message: string; points: readonly Readonly<{ day: string; value: number; lower: number; upper: number }>[]; standardDeviation: number }>
  advancedForecast?: Readonly<{ status: 'available' | 'insufficient_data'; message: string; points: readonly Readonly<{ day: string; value: number; lower: number; upper: number }>[]; standardDeviation: number }> | null
  anomalies: readonly Readonly<{ day: string; direction: 'spike' | 'dip'; value: number; average: number; percentFromAverage: number }>[] | null
  categories: readonly Readonly<{ name: string; revenue: number; units: number }>[]
  topProducts: readonly Readonly<{ productId: string; name: string; category?: string; image: string | null; units: number; revenue: number; share: number; trend: 'up' | 'down' | 'flat'; growth?: number | null }>[]
  weekdays: readonly Readonly<{ day: string; revenue: number; orders?: number }>[]
  peakHours: readonly Readonly<{ hour: number; orders: number; revenue?: number }>[] | null
  totalCustomers: number | null
  customerStats?: Readonly<{ identified: number; newCustomers: number; repeatCustomers: number; repeatRate: number | null; loyaltyScore: number | null }>
  channels?: readonly Readonly<{ channel: string; revenue: number; orders: number; share: number; growth: number | null }>[]
  geography?: readonly Readonly<{ country: string; countryCode: string | null; revenue: number; orders: number; share: number }>[] | null
  cohorts?: readonly Readonly<{ cohort: string; periods: readonly Readonly<{ month: number; customers: number; retention: number }>[] }>[] | null
  comparisons?: readonly Readonly<{ metric: string; current: number; previous: number; change: number | null }>[] | null
  funnel?: Readonly<{ scopeAvailable: boolean; stages: readonly Readonly<{ name: string; value: number | null; dropoff: number | null }>[]; message: string }> | null
  opportunities?: readonly Readonly<{ title: string; evidence: string; action: string; tone: 'positive' | 'warning' | 'neutral' }>[] | null
  executiveSummary?: string | null
  available: readonly string[]
  locked: readonly Readonly<{ feature: string; requiredPlan: 'start' | 'growth' | 'commander' }>[]
  usage: Readonly<{ used: number; limit: number | null; remaining: number | null }>
  cached: boolean
}>
export type TrendPoint = Readonly<{ day: string; revenue: number; orders: number; aov: number; previous: number | null; forecast: number | null; lower: number | null; upper: number | null }>
export type Kpi = Readonly<{ label: string; value: number | null; format: 'money' | 'number' | 'percent'; money: boolean; change: number | null; sparkline: readonly number[]; detail: string }>
const finite = (value: unknown, fallback = 0) => { const number = typeof value === 'number' ? value : Number(value); return Number.isFinite(number) ? number : fallback }

/**
 * Rewrite each row's `day` to a bare `YYYY-MM-DD` key, dropping rows whose date
 * cannot be parsed. Guarantees the string comparisons and `safeAddDays` calls
 * downstream operate on a consistent, sortable key format.
 */
function normalizeDays<T extends { day: string }>(rows: readonly T[]): readonly T[] {
  const result: T[] = []
  for (const row of rows) { const day = safeDayKey(row?.day); if (day) result.push({ ...row, day }) }
  return result
}

/** Map of normalised day key -> numeric value, skipping unparseable dates. */
function keyedByDay<T extends { day: string }>(rows: readonly T[], get: (row: T) => number): ReadonlyMap<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) { const day = safeDayKey(row?.day); if (day) map.set(day, get(row)) }
  return map
}

/**
 * Build a continuous inclusive day list from start → end.
 * Returns [] when either bound is unparseable.
 */
export function buildDateRange(startDay: string, endDay: string): readonly string[] {
  const start = safeDayKey(startDay)
  const end = safeDayKey(endDay)
  if (!start || !end) return []
  const result: string[] = []
  let cursor: string | null = start
  let guard = 0
  while (cursor && guard < 2000) {
    result.push(cursor)
    if (cursor === end) break
    cursor = safeAddDays(cursor, 1)
    guard += 1
  }
  return result
}

/**
 * Shared timeseries builder — ensures every consumer gets a continuous axis
 * with explicit zeros for days without sales. Prefer this over per-chart hacks.
 *
 * - start/end inclusive, UTC day keys.
 * - Missing days → revenue 0, orders 0, aov 0 (honest zero, not invented).
 *   AOV = 0 on zero-order days is documented: tooltip shows $0 / 0 orders,
 *   making the downtrend visible. Cumulative/banked lines may stay flat — correct.
 */
export function continuousSeries(
  snapshot: AnalyticsSnapshot | null,
  startDay: string,
  endDay: string,
): readonly TrendPoint[] {
  const revenue = keyedByDay(snapshot?.revenue ?? [], (row) => finite(row.grossRevenue))
  const orders = keyedByDay(snapshot?.orders ?? [], (row) => finite(row.orderCount))
  const aovMap = keyedByDay(snapshot?.orders ?? [], (row) => finite(row.averageOrderValue))
  const days = buildDateRange(startDay, endDay)
  const points: TrendPoint[] = []
  for (const day of days) {
    const rev = revenue.get(day) ?? 0
    const ord = orders.get(day) ?? 0
    // AOV: when no orders, show 0 so the line visibly drops. Tooltip will show $0 / 0 orders honestly.
    const aov = ord > 0 ? (aovMap.get(day) ?? (rev > 0 ? rev / ord : 0)) : 0
    // Previous period comparison — same calendar distance as period length, approximated by 28d for continuous builder
    // For the generic builder we keep previous null; periodTrend will compute it with period offset.
    points.push({ day, revenue: rev, orders: ord, aov, previous: null, forecast: null, lower: null, upper: null })
  }
  return points
}

export function periodTrend(
  snapshot: AnalyticsSnapshot | null,
  period: AnalyticsPeriod | number,
  forecast: AnalyticsInsights['forecast'] | null,
  options?: Readonly<{ endDay?: string | null }>,
): readonly TrendPoint[] {
  const revenueRows = snapshot?.revenue ?? []
  const orderRows = snapshot?.orders ?? []
  if (!revenueRows.length && !orderRows.length) return []
  // `day` arrives as a full ISO timestamp when Postgres `date` columns are
  // serialised by the pg driver, so every key is normalised to YYYY-MM-DD
  // before it is used for lookups or arithmetic.
  const revenue = keyedByDay(revenueRows, (row) => finite(row.grossRevenue))
  const orders = keyedByDay(orderRows, (row) => finite(row.orderCount))
  const aov = keyedByDay(orderRows, (row) => finite(row.averageOrderValue))

  // Latest day that actually had sales (for fallback)
  const latestRevenue = [...revenue.keys()].filter(Boolean).sort().at(-1) ?? null
  const latestOrders = [...orders.keys()].filter(Boolean).sort().at(-1) ?? null
  const latest = [latestRevenue, latestOrders].filter((d): d is string => Boolean(d)).sort().at(-1) ?? null
  if (!latest) return []

  // End day: explicit option > today > latest. Using today ensures trailing zero days
  // (e.g. Aug 20-21 with no sales) are plotted as $0 / 0 orders so the merchant sees the drop.
  // If latest is in the future (future-dated order), respect it to avoid truncating data.
  const today = todayDayKey()
  const rawEnd = options?.endDay ? safeDayKey(options.endDay) : null
  const candidateEnd = rawEnd ?? today
  const endDay = candidateEnd && latest && latest > candidateEnd ? latest : candidateEnd ?? latest

  if (!endDay) return []
  const startDay = safeAddDays(endDay, -(period - 1))
  if (!startDay) return []

  const days = buildDateRange(startDay, endDay)
  const points: TrendPoint[] = []
  for (const day of days) {
    const previousDay = safeAddDays(day, -period)
    const previous = previousDay !== null && revenue.has(previousDay) ? revenue.get(previousDay)! : null
    const rev = revenue.get(day) ?? 0
    const ord = orders.get(day) ?? 0
    const aovVal = ord > 0 ? (aov.get(day) ?? (rev > 0 ? rev / ord : 0)) : 0
    points.push({ day, revenue: rev, orders: ord, aov: aovVal, previous, forecast: null, lower: null, upper: null })
  }
  if (forecast?.status === 'available') {
    for (const row of forecast.points ?? []) {
      const day = safeDayKey(row?.day)
      if (day) points.push({ day, revenue: 0, orders: 0, aov: 0, previous: null, forecast: finite(row.value), lower: finite(row.lower), upper: finite(row.upper) })
    }
  }
  return points
}

export function analyticsKpis(snapshot: AnalyticsSnapshot | null, totalCustomers: number | null, customerStats?: AnalyticsInsights['customerStats']): readonly Kpi[] {
  // Rows are normalised up front: a raw `day` may be a bare day key or a full
  // ISO timestamp depending on how the API serialised the Postgres date.
  const revenue = normalizeDays(snapshot?.revenue ?? [])
  const orders = normalizeDays(snapshot?.orders ?? [])
  const revenueByDay = keyedByDay(revenue, (row) => finite(row.grossRevenue))
  const ordersByDay = keyedByDay(orders, (row) => finite(row.orderCount))
  const aovByDay = keyedByDay(orders, (row) => finite(row.averageOrderValue))

  const latestRevenue = [...revenueByDay.keys()].filter(Boolean).sort().at(-1) ?? null
  const latestOrders = [...ordersByDay.keys()].filter(Boolean).sort().at(-1) ?? null
  const latest = [latestRevenue, latestOrders].filter((d): d is string => Boolean(d)).sort().at(-1) ?? null

  // Use today as the effective end so trailing zero days are visible in sparklines.
  const today = todayDayKey()
  const effectiveLatest = latest && latest > today ? latest : (latest ? (today > latest ? today : latest) : null)

  const currentStart = effectiveLatest ? (safeAddDays(effectiveLatest, -27) ?? '') : ''
  const previousStart = effectiveLatest ? (safeAddDays(effectiveLatest, -55) ?? '') : ''
  const previousEnd = effectiveLatest ? (safeAddDays(effectiveLatest, -28) ?? '') : ''

  const sumContinuous = (byDay: ReadonlyMap<string, number>, start: string, finish: string): number => {
    if (!start || !finish) return 0
    const days = buildDateRange(start, finish)
    let total = 0
    for (const day of days) total += byDay.get(day) ?? 0
    return total
  }

  const revNow = effectiveLatest ? sumContinuous(revenueByDay, currentStart, effectiveLatest) : 0
  const revBefore = effectiveLatest ? sumContinuous(revenueByDay, previousStart, previousEnd) : 0
  const ordNow = effectiveLatest ? sumContinuous(ordersByDay, currentStart, effectiveLatest) : 0
  const ordBefore = effectiveLatest ? sumContinuous(ordersByDay, previousStart, previousEnd) : 0

  const change = (current: number, previous: number) => previous > 0 && Number.isFinite(current) ? (current - previous) / previous * 100 : null
  const aovNow = ordNow > 0 ? revNow / ordNow : null
  const aovBefore = ordBefore > 0 ? revBefore / ordBefore : null
  const bestAov = orders.length ? Math.max(...orders.map((row) => finite(row.averageOrderValue))) : null

  // Continuous sparklines — 28 days inclusive ending at effectiveLatest, with explicit 0 for missing days.
  const sparkDays = effectiveLatest && currentStart ? buildDateRange(currentStart, effectiveLatest) : []
  const revenueSpark = sparkDays.map((day) => revenueByDay.get(day) ?? 0)
  const ordersSpark = sparkDays.map((day) => ordersByDay.get(day) ?? 0)
  const aovSpark = sparkDays.map((day) => {
    const ord = ordersByDay.get(day) ?? 0
    if (ord === 0) return 0
    return aovByDay.get(day) ?? 0
  })

  const spark = (values: readonly number[]) => values.map((value) => finite(value, Number.NaN)).filter(Number.isFinite)
  const days = sparkDays.length || 28

  // Fix 6.2 — fallback to customerStats.identified or cohorts when totalCustomers null
  let customers: number | null = null
  if (totalCustomers !== null && Number.isFinite(totalCustomers)) {
    customers = totalCustomers
  } else if (customerStats?.identified !== undefined && Number.isFinite(customerStats.identified)) {
    customers = customerStats.identified
  } else if (customerStats?.newCustomers !== undefined && Number.isFinite(customerStats.newCustomers)) {
    customers = customerStats.newCustomers
  } else if (snapshot?.customerCohorts && snapshot.customerCohorts.length > 0) {
    const cohortSum = snapshot.customerCohorts.reduce((sum, c) => sum + finite(c.customerCount), 0)
    if (cohortSum > 0) customers = cohortSum
  }
  const repeatRate = customerStats?.repeatRate ?? null
  return [
    { label: 'Total Revenue', value: revenue.length ? revNow : null, format: 'money', money: true, change: change(revNow, revBefore), sparkline: spark(revenueSpark), detail: `${revenue.length} sales days synced` },
    { label: 'Total Orders', value: orders.length ? ordNow : null, format: 'number', money: false, change: change(ordNow, ordBefore), sparkline: spark(ordersSpark), detail: ordNow ? `${(ordNow / days).toFixed(1)} average per day` : 'Sync orders to establish your baseline' },
    { label: 'Average Order Value', value: aovNow, format: 'money', money: true, change: aovNow !== null && aovBefore !== null ? change(aovNow, aovBefore) : null, sparkline: spark(aovSpark), detail: bestAov !== null ? `Best daily AOV ${currency(bestAov)}` : 'Calculated from completed order totals' },
    { label: 'Conversion Rate', value: null, format: 'percent', money: false, change: null, sparkline: [], detail: 'Requires Shopify Analytics — visitor sessions not available' },
    { label: 'Total Customers', value: customers, format: 'number', money: false, change: null, sparkline: spark(snapshot?.customerCohorts.slice(-28).map((row) => row.customerCount) ?? []), detail: customerStats ? `${customerStats.newCustomers} new customers in synced orders` : customers !== null ? `${customers} customer${customers === 1 ? '' : 's'} identified · synced store records` : 'Sync customers to see total' },
    { label: 'Repeat Purchase Rate', value: repeatRate, format: 'percent', money: false, change: null, sparkline: [], detail: customerStats?.loyaltyScore !== null && customerStats?.loyaltyScore !== undefined ? `Loyalty score ${customerStats.loyaltyScore}/100 · based on real customer orders` : 'Needs repeat customer data to calculate loyalty' },
  ]
}
function currency(value: number) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) }
