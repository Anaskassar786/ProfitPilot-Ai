import type { AnalyticsSnapshot } from './model.js'
import { safeAddDays, safeDayKey } from './safe-date.js'

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

export function periodTrend(snapshot: AnalyticsSnapshot | null, period: AnalyticsPeriod, forecast: AnalyticsInsights['forecast'] | null): readonly TrendPoint[] {
  const revenueRows = snapshot?.revenue ?? []
  if (!revenueRows.length) return []
  // `day` arrives as a full ISO timestamp when Postgres `date` columns are
  // serialised by the pg driver, so every key is normalised to YYYY-MM-DD
  // before it is used for lookups or arithmetic.
  const revenue = keyedByDay(revenueRows, (row) => finite(row.grossRevenue))
  const orders = keyedByDay(snapshot?.orders ?? [], (row) => finite(row.orderCount))
  const aov = keyedByDay(snapshot?.orders ?? [], (row) => finite(row.averageOrderValue))
  const latest = [...revenue.keys()].filter(Boolean).sort().at(-1)
  if (!latest) return []
  const points: TrendPoint[] = []
  for (let offset = period - 1; offset >= 0; offset -= 1) {
    const day = safeAddDays(latest, -offset)
    if (!day) continue
    const previousDay = safeAddDays(day, -period)
    const previous = previousDay !== null && revenue.has(previousDay) ? revenue.get(previousDay)! : null
    points.push({ day, revenue: revenue.get(day) ?? 0, orders: orders.get(day) ?? 0, aov: aov.get(day) ?? 0, previous, forecast: null, lower: null, upper: null })
  }
  if (forecast?.status === 'available') for (const row of forecast.points ?? []) { const day = safeDayKey(row?.day); if (day) points.push({ day, revenue: 0, orders: 0, aov: 0, previous: null, forecast: finite(row.value), lower: finite(row.lower), upper: finite(row.upper) }) }
  return points
}

export function analyticsKpis(snapshot: AnalyticsSnapshot | null, totalCustomers: number | null, customerStats?: AnalyticsInsights['customerStats']): readonly Kpi[] {
  // Rows are normalised up front: a raw `day` may be a bare day key or a full
  // ISO timestamp depending on how the API serialised the Postgres date.
  const revenue = normalizeDays(snapshot?.revenue ?? []); const orders = normalizeDays(snapshot?.orders ?? [])
  const latest = [...new Set([...revenue.map((row) => row.day), ...orders.map((row) => row.day)])].filter(Boolean).sort().at(-1)
  const currentStart = safeAddDays(latest, -27) ?? ''
  const previousStart = safeAddDays(latest, -55) ?? ''
  const sum = <T extends { day: string }>(rows: readonly T[], start: string, finish: string, get: (row: T) => number) => rows.filter((row) => row.day >= start && row.day <= finish).reduce((total, row) => total + finite(get(row)), 0)
  const previousEnd = safeAddDays(latest, -28) ?? ''
  const revNow = latest ? sum(revenue, currentStart, latest, (row) => row.grossRevenue) : 0; const revBefore = latest ? sum(revenue, previousStart, previousEnd, (row) => row.grossRevenue) : 0
  const ordNow = latest ? sum(orders, currentStart, latest, (row) => row.orderCount) : 0; const ordBefore = latest ? sum(orders, previousStart, previousEnd, (row) => row.orderCount) : 0
  const change = (current: number, previous: number) => previous > 0 && Number.isFinite(current) ? (current - previous) / previous * 100 : null
  const aovNow = ordNow > 0 ? revNow / ordNow : null; const aovBefore = ordBefore > 0 ? revBefore / ordBefore : null
  const bestAov = orders.length ? Math.max(...orders.map((row) => finite(row.averageOrderValue))) : null
  const spark = (values: readonly number[]) => values.map((value) => finite(value, Number.NaN)).filter(Number.isFinite)
  const days = new Set([...revenue.filter((row) => row.day >= currentStart).map((row) => row.day), ...orders.filter((row) => row.day >= currentStart).map((row) => row.day)]).size || 28
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
    { label: 'Total Revenue', value: revenue.length ? revNow : null, format: 'money', money: true, change: change(revNow, revBefore), sparkline: spark(revenue.slice(-28).map((row) => row.grossRevenue)), detail: `${revenue.length} sales days synced` },
    { label: 'Total Orders', value: orders.length ? ordNow : null, format: 'number', money: false, change: change(ordNow, ordBefore), sparkline: spark(orders.slice(-28).map((row) => row.orderCount)), detail: ordNow ? `${(ordNow / days).toFixed(1)} average per day` : 'Sync orders to establish your baseline' },
    { label: 'Average Order Value', value: aovNow, format: 'money', money: true, change: aovNow !== null && aovBefore !== null ? change(aovNow, aovBefore) : null, sparkline: spark(orders.slice(-28).map((row) => row.averageOrderValue)), detail: bestAov !== null ? `Best daily AOV ${currency(bestAov)}` : 'Calculated from completed order totals' },
    { label: 'Conversion Rate', value: null, format: 'percent', money: false, change: null, sparkline: [], detail: 'Requires Shopify Analytics — visitor sessions not available' },
    { label: 'Total Customers', value: customers, format: 'number', money: false, change: null, sparkline: spark(snapshot?.customerCohorts.slice(-28).map((row) => row.customerCount) ?? []), detail: customerStats ? `${customerStats.newCustomers} new customers in synced orders` : customers !== null ? `${customers} customer${customers === 1 ? '' : 's'} identified · synced store records` : 'Sync customers to see total' },
    { label: 'Repeat Purchase Rate', value: repeatRate, format: 'percent', money: false, change: null, sparkline: [], detail: customerStats?.loyaltyScore !== null && customerStats?.loyaltyScore !== undefined ? `Loyalty score ${customerStats.loyaltyScore}/100 · based on real customer orders` : 'Needs repeat customer data to calculate loyalty' },
  ]
}
function currency(value: number) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) }
