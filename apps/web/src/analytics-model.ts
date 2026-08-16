import type { AnalyticsSnapshot } from './model.js'

export type AnalyticsPeriod = 7 | 30 | 90 | 365

export type AnalyticsInsights = Readonly<{
  plan: 'trial' | 'start' | 'growth' | 'commander'
  generatedAt: string
  salesHistoryDays: number
  forecast: Readonly<{
    status: 'available' | 'insufficient_data'
    message: string
    points: readonly Readonly<{ day: string; value: number; lower: number; upper: number }>[]
    standardDeviation: number
  }>
  anomalies: readonly Readonly<{
    day: string
    direction: 'spike' | 'dip'
    value: number
    average: number
    percentFromAverage: number
  }>[] | null
  categories: readonly Readonly<{ name: string; revenue: number; units: number }>[]
  topProducts: readonly Readonly<{
    productId: string
    name: string
    image: string | null
    units: number
    revenue: number
    share: number
    trend: 'up' | 'down' | 'flat'
  }>[]
  weekdays: readonly Readonly<{ day: string; revenue: number }>[]
  peakHours: readonly Readonly<{ hour: number; orders: number }>[] | null
  totalCustomers: number | null
  available: readonly string[]
  locked: readonly Readonly<{ feature: string; requiredPlan: 'start' | 'growth' | 'commander' }>[]
  usage: Readonly<{ used: number; limit: number | null; remaining: number | null }>
  cached: boolean
}>

export type TrendPoint = Readonly<{
  day: string
  revenue: number
  orders: number
  previous: number | null
  forecast: number | null
  lower: number | null
  upper: number | null
}>

export type Kpi = Readonly<{
  label: string
  value: number | null
  money: boolean
  change: number | null
  sparkline: readonly number[]
}>

function finite(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function periodTrend(
  snapshot: AnalyticsSnapshot | null,
  period: AnalyticsPeriod,
  forecast: AnalyticsInsights['forecast'] | null,
): readonly TrendPoint[] {
  const revenueRows = snapshot?.revenue ?? []
  if (!revenueRows.length) return []

  const revenue = new Map(revenueRows.map((row) => [row.day, finite(row.grossRevenue)]))
  const orders = new Map((snapshot?.orders ?? []).map((row) => [row.day, finite(row.orderCount)]))
  const latest = [...revenue.keys()].filter(Boolean).sort().at(-1)
  if (!latest) return []

  const end = new Date(`${latest}T00:00:00Z`)
  if (!Number.isFinite(end.valueOf())) return []

  const points: TrendPoint[] = []
  for (let offset = period - 1; offset >= 0; offset -= 1) {
    const date = new Date(end.valueOf() - offset * 86_400_000)
    const day = date.toISOString().slice(0, 10)
    const previousDay = new Date(date.valueOf() - period * 86_400_000).toISOString().slice(0, 10)
    points.push({
      day,
      revenue: revenue.get(day) ?? 0,
      orders: orders.get(day) ?? 0,
      previous: revenue.has(previousDay) ? (revenue.get(previousDay) ?? 0) : null,
      forecast: null,
      lower: null,
      upper: null,
    })
  }

  if (forecast?.status === 'available' && Array.isArray(forecast.points)) {
    for (const row of forecast.points) {
      if (!row?.day) continue
      points.push({
        day: row.day,
        revenue: 0,
        orders: 0,
        previous: null,
        forecast: finite(row.value),
        lower: finite(row.lower),
        upper: finite(row.upper),
      })
    }
  }

  return points
}

export function analyticsKpis(
  snapshot: AnalyticsSnapshot | null,
  totalCustomers: number | null,
): readonly Kpi[] {
  const revenue = snapshot?.revenue ?? []
  const orders = snapshot?.orders ?? []
  const latest = [...new Set([
    ...revenue.map((row) => row.day).filter(Boolean),
    ...orders.map((row) => row.day).filter(Boolean),
  ])].sort().at(-1)

  const cutoff = latest ? new Date(`${latest}T00:00:00Z`) : null
  const validCutoff = cutoff && Number.isFinite(cutoff.valueOf()) ? cutoff : null
  const currentStart = validCutoff ? new Date(validCutoff.valueOf() - 27 * 86_400_000).toISOString().slice(0, 10) : ''
  const previousStart = validCutoff ? new Date(validCutoff.valueOf() - 55 * 86_400_000).toISOString().slice(0, 10) : ''

  const sumRange = <T extends { day: string }>(
    rows: readonly T[],
    start: string,
    end: string,
    value: (row: T) => number,
  ) => rows
    .filter((row) => row.day >= start && row.day <= end)
    .reduce((sum, row) => sum + finite(value(row)), 0)

  const revNow = latest ? sumRange(revenue, currentStart, latest, (row) => row.grossRevenue) : 0
  const revBefore = latest
    ? sumRange(revenue, previousStart, currentStart, (row) => row.grossRevenue)
      - finite(revenue.find((row) => row.day === currentStart)?.grossRevenue)
    : 0
  const ordNow = latest ? sumRange(orders, currentStart, latest, (row) => row.orderCount) : 0
  const ordBefore = latest
    ? sumRange(orders, previousStart, currentStart, (row) => row.orderCount)
      - finite(orders.find((row) => row.day === currentStart)?.orderCount)
    : 0

  /** Honest growth: no prior baseline → null (UI shows "—"), never NaN. */
  const change = (current: number, previous: number): number | null => {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
    const percent = ((current - previous) / previous) * 100
    return Number.isFinite(percent) ? percent : null
  }

  const aovNow = ordNow > 0 ? revNow / ordNow : null
  const aovBefore = ordBefore > 0 && revBefore > 0 ? revBefore / ordBefore : null

  const spark = (values: readonly number[]) => values
    .map((value) => finite(value, Number.NaN))
    .filter((value) => Number.isFinite(value))

  return [
    {
      label: 'Total Revenue',
      value: revenue.length ? revNow : null,
      money: true,
      change: change(revNow, revBefore),
      sparkline: spark(revenue.slice(-28).map((row) => row.grossRevenue)),
    },
    {
      label: 'Total Orders',
      value: orders.length ? ordNow : null,
      money: false,
      change: change(ordNow, ordBefore),
      sparkline: spark(orders.slice(-28).map((row) => row.orderCount)),
    },
    {
      label: 'Average Order Value',
      value: aovNow,
      money: true,
      change: aovNow !== null && aovBefore !== null ? change(aovNow, aovBefore) : null,
      sparkline: spark(orders.slice(-28).map((row) => row.averageOrderValue)),
    },
    {
      label: 'Total Customers',
      value: totalCustomers !== null && Number.isFinite(totalCustomers) ? totalCustomers : null,
      money: false,
      change: null,
      sparkline: spark(snapshot?.customerCohorts.slice(-28).map((row) => row.customerCount) ?? []),
    },
  ]
}
