import type { AnalyticsSnapshot } from './model.js'
export type AnalyticsPeriod = 7 | 30 | 90 | 365
export type AnalyticsInsights = Readonly<{
  plan: 'trial' | 'start' | 'growth' | 'commander'
  generatedAt: string
  salesHistoryDays: number
  forecast: Readonly<{ status: 'available' | 'insufficient_data'; message: string; points: readonly Readonly<{ day: string; value: number; lower: number; upper: number }>[]; standardDeviation: number }>
  anomalies: readonly Readonly<{ day: string; direction: 'spike' | 'dip'; value: number; average: number; percentFromAverage: number }>[] | null
  categories: readonly Readonly<{ name: string; revenue: number; units: number }>[]
  topProducts: readonly Readonly<{ productId: string; name: string; image: string | null; units: number; revenue: number; share: number; trend: 'up' | 'down' | 'flat' }>[]
  weekdays: readonly Readonly<{ day: string; revenue: number }>[]
  peakHours: readonly Readonly<{ hour: number; orders: number }>[] | null
  totalCustomers: number | null
  available: readonly string[]
  locked: readonly Readonly<{ feature: string; requiredPlan: 'start' | 'growth' | 'commander' }>[]
  usage: Readonly<{ used: number; limit: number | null; remaining: number | null }>
  cached: boolean
}>
export type TrendPoint = Readonly<{ day: string; revenue: number; orders: number; previous: number | null; forecast: number | null; lower: number | null; upper: number | null }>
export type Kpi = Readonly<{ label: string; value: number | null; money: boolean; change: number | null; sparkline: readonly number[] }>

export function periodTrend(snapshot: AnalyticsSnapshot | null, period: AnalyticsPeriod, forecast: AnalyticsInsights['forecast'] | null): readonly TrendPoint[] {
  if (!snapshot?.revenue.length) return []
  const revenue = new Map(snapshot.revenue.map((row) => [row.day, row.grossRevenue])); const orders = new Map(snapshot.orders.map((row) => [row.day, row.orderCount])); const latest = [...revenue.keys()].sort().at(-1); if (!latest) return []
  const end = new Date(`${latest}T00:00:00Z`); const points: TrendPoint[] = []
  for (let offset = period - 1; offset >= 0; offset -= 1) { const date = new Date(end.valueOf() - offset * 86_400_000); const day = date.toISOString().slice(0, 10); const previousDay = new Date(date.valueOf() - period * 86_400_000).toISOString().slice(0, 10); points.push({ day, revenue: revenue.get(day) ?? 0, orders: orders.get(day) ?? 0, previous: revenue.get(previousDay) ?? null, forecast: null, lower: null, upper: null }) }
  if (forecast?.status === 'available') for (const row of forecast.points) points.push({ day: row.day, revenue: 0, orders: 0, previous: null, forecast: row.value, lower: row.lower, upper: row.upper })
  return points
}

export function analyticsKpis(snapshot: AnalyticsSnapshot | null, totalCustomers: number | null): readonly Kpi[] {
  const revenue = snapshot?.revenue ?? []; const orders = snapshot?.orders ?? []; const latest = [...new Set([...revenue.map((row) => row.day), ...orders.map((row) => row.day)])].sort().at(-1)
  const cutoff = latest ? new Date(`${latest}T00:00:00Z`) : null
  const currentStart = cutoff ? new Date(cutoff.valueOf() - 27 * 86_400_000).toISOString().slice(0, 10) : ''; const previousStart = cutoff ? new Date(cutoff.valueOf() - 55 * 86_400_000).toISOString().slice(0, 10) : ''
  const sumRange = <T extends { day: string }>(rows: readonly T[], start: string, end: string, value: (row: T) => number) => rows.filter((row) => row.day >= start && row.day <= end).reduce((sum, row) => sum + value(row), 0)
  const revNow = latest ? sumRange(revenue, currentStart, latest, (row) => row.grossRevenue) : 0; const revBefore = latest ? sumRange(revenue, previousStart, currentStart, (row) => row.grossRevenue) - (revenue.find((row) => row.day === currentStart)?.grossRevenue ?? 0) : 0
  const ordNow = latest ? sumRange(orders, currentStart, latest, (row) => row.orderCount) : 0; const ordBefore = latest ? sumRange(orders, previousStart, currentStart, (row) => row.orderCount) - (orders.find((row) => row.day === currentStart)?.orderCount ?? 0) : 0
  const change = (current: number, previous: number) => previous > 0 ? (current - previous) / previous * 100 : null
  return [
    { label: 'Total Revenue', value: revenue.length ? revNow : null, money: true, change: change(revNow, revBefore), sparkline: revenue.slice(-28).map((row) => row.grossRevenue) },
    { label: 'Total Orders', value: orders.length ? ordNow : null, money: false, change: change(ordNow, ordBefore), sparkline: orders.slice(-28).map((row) => row.orderCount) },
    { label: 'Average Order Value', value: ordNow ? revNow / ordNow : null, money: true, change: ordBefore && revBefore ? change(revNow / ordNow, revBefore / ordBefore) : null, sparkline: orders.slice(-28).map((row) => row.averageOrderValue) },
    { label: 'Total Customers', value: totalCustomers, money: false, change: null, sparkline: snapshot?.customerCohorts.slice(-28).map((row) => row.customerCount) ?? [] },
  ]
}
