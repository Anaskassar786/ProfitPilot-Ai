import type { AnalyticsSnapshot, RevenuePoint, ChartPeriod } from './model.js'

/** Period label key used for toggling chart views */
export type PeriodView = 'weekly' | 'monthly' | 'yearly' | 'range'

/** A single bar data point for the bar chart */
export type BarChartPoint = {
  label: string
  value: number
  isCurrent: boolean
  day?: string
  /** True when the period has no revenue rows — rendered as a dim placeholder bar */
  isEmpty?: boolean
}

/** Growth result for KPIs */
export type GrowthResult = {
  current: number | null
  previous: number | null
  percent: number | null
  direction: 'up' | 'down' | 'flat' | 'none'
}

/** Product category sales aggregation */
export type CategorySales = {
  name: string
  value: number
  color: string
}

/** Recent order display */
export type RecentOrder = {
  id: string
  orderNumber: string
  customer: string
  amount: number
  status: 'paid' | 'pending' | 'cancelled' | 'fulfilled'
  date: string
  /** Orders recorded on that day */
  orderCount: number
  /** Fulfilled orders recorded on that day */
  fulfilledCount: number
  /** Cancelled orders recorded on that day */
  cancelledCount: number
  /** Average order value for that day */
  averageOrderValue: number
}

/** Calendar day data for heatmap */
export type CalendarDay = {
  date: string
  day: number
  value: number | null
  isCurrentMonth: boolean
}

/** Calendar month data */
export type CalendarMonth = {
  year: number
  month: number
  days: readonly CalendarDay[]
  total: number
}

/**
 * Calculate growth: (current - previous) / previous * 100
 * Compares two equal-length periods.
 */
export function calculateGrowth(
  current: number | null,
  previous: number | null,
): GrowthResult {
  if (current === null || previous === null || previous === 0) {
    return { current, previous, percent: null, direction: 'none' }
  }
  const diff = current - previous
  const percent = (diff / previous) * 100
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
  return { current, previous, percent, direction }
}

/**
 * Format growth for display: ▲8.3% vs last month
 */
export function formatGrowth(
  growth: GrowthResult,
  periodLabel = 'last period',
): string {
  if (growth.percent === null || growth.direction === 'none') return `— vs ${periodLabel}`
  const arrow = growth.direction === 'up' ? '▲' : growth.direction === 'down' ? '▼' : '→'
  const sign = growth.percent > 0 ? '+' : ''
  return `${arrow} ${sign}${growth.percent.toFixed(1)}% vs ${periodLabel}`
}

/**
 * Minimum number of bars the revenue chart renders so that a store with a
 * single day/week/month of data still shows a structured chart instead of one
 * lonely bar. Missing periods render as dim `isEmpty` bars worth $0.
 */
export const MIN_BAR_PERIODS = 8

/**
 * Aggregate daily revenue into periods for bar chart.
 */
export function aggregateRevenueByPeriod(
  snapshot: AnalyticsSnapshot | null,
  view: PeriodView,
  rangeStart?: string,
  rangeEnd?: string,
): BarChartPoint[] {
  if (!snapshot || snapshot.revenue.length === 0) return []

  const sorted = [...snapshot.revenue].sort((a, b) => a.day.localeCompare(b.day))

  if (view === 'weekly') {
    return aggregateWeekly(sorted, 12)
  }
  if (view === 'monthly') {
    return aggregateMonthly(sorted, 12)
  }
  if (view === 'yearly') {
    return aggregateYearly(sorted, 5)
  }
  if (view === 'range' && rangeStart && rangeEnd) {
    return aggregateRange(sorted, rangeStart, rangeEnd)
  }
  return aggregateMonthly(sorted, 12)
}

// ─── Period key arithmetic (used for gap filling / padding) ──────

type Granularity = 'week' | 'month' | 'year'

function shiftKey(key: string, granularity: Granularity, delta: number): string {
  if (granularity === 'year') {
    return String(Number(key) + delta)
  }
  if (granularity === 'month') {
    const [yearStr = '1970', monthStr = '01'] = key.split('-')
    const index = Number(yearStr) * 12 + (Number(monthStr) - 1) + delta
    const year = Math.floor(index / 12)
    const month = index - year * 12 + 1
    return `${year}-${String(month).padStart(2, '0')}`
  }
  const date = new Date(key + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + delta * 7)
  return date.toISOString().slice(0, 10)
}

function currentKey(granularity: Granularity): string {
  const now = new Date()
  if (granularity === 'year') return String(now.getFullYear())
  if (granularity === 'month') {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }
  return new Date(getWeekStart(now)).toISOString().slice(0, 10)
}

/**
 * Take the aggregated period keys and return a dense, padded key list:
 * internal gaps are filled and the series is extended (forwards up to the
 * current period, then backwards) until it holds at least `minPeriods` keys.
 * Never returns more than `maxPeriods` keys.
 */
export function densePeriodKeys(
  keys: readonly string[],
  granularity: Granularity,
  minPeriods = MIN_BAR_PERIODS,
  maxPeriods = 12,
): string[] {
  if (keys.length === 0) return []

  const sorted = [...keys].sort((a, b) => a.localeCompare(b))
  const first = sorted[0] as string
  const last = sorted[sorted.length - 1] as string

  // 1. Fill internal gaps.
  const dense: string[] = [first]
  let cursor = first
  let guard = 0
  while (cursor !== last && guard < 600) {
    cursor = shiftKey(cursor, granularity, 1)
    dense.push(cursor)
    guard += 1
  }

  const target = Math.min(Math.max(minPeriods, 1), maxPeriods)

  // 2. Extend forwards, but never past the current (in-progress) period.
  const today = currentKey(granularity)
  let tail = dense[dense.length - 1] as string
  while (dense.length < target && tail.localeCompare(today) < 0) {
    tail = shiftKey(tail, granularity, 1)
    dense.push(tail)
  }

  // 3. Still short? Extend backwards so the chart keeps its full width.
  let head = dense[0] as string
  while (dense.length < target) {
    head = shiftKey(head, granularity, -1)
    dense.unshift(head)
  }

  return dense.slice(-maxPeriods)
}

function aggregateWeekly(
  sorted: readonly { day: string; grossRevenue: number }[],
  count = 12,
): BarChartPoint[] {
  const weeks: Map<string, number> = new Map()
  for (const row of sorted) {
    const d = new Date(row.day + 'T00:00:00')
    const dayOfWeek = d.getUTCDay()
    const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
    const monday = new Date(d)
    monday.setUTCDate(diff)
    const key = monday.toISOString().slice(0, 10)
    weeks.set(key, (weeks.get(key) ?? 0) + row.grossRevenue)
  }

  const recent = densePeriodKeys([...weeks.keys()], 'week', MIN_BAR_PERIODS, count)

  const now = new Date()
  const currentWeekStart = getWeekStart(now)

  return recent.map((key) => {
    const raw = weeks.get(key)
    const monday = new Date(key + 'T00:00:00')
    const isCurrent = monday.getTime() === currentWeekStart
    const month = monday.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    const day = monday.getUTCDate()
    return {
      label: `${month} ${day}`,
      value: raw === undefined ? 0 : Math.round(raw),
      isCurrent,
      day: key,
      isEmpty: raw === undefined,
    }
  })
}

function aggregateMonthly(
  sorted: readonly { day: string; grossRevenue: number }[],
  count = 12,
): BarChartPoint[] {
  const months: Map<string, number> = new Map()
  for (const row of sorted) {
    const key = row.day.slice(0, 7)
    months.set(key, (months.get(key) ?? 0) + row.grossRevenue)
  }

  const recent = densePeriodKeys([...months.keys()], 'month', MIN_BAR_PERIODS, count)

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return recent.map((key) => {
    const raw = months.get(key)
    const parts = key.split('-')
    const yearStr = parts[0] ?? ''
    const monthDate = new Date(`${key}-01T00:00:00`)
    const monthName = monthDate.toLocaleDateString('en-US', {
      month: 'short',
      timeZone: 'UTC',
    })
    const yearLabel = yearStr && yearStr !== String(now.getFullYear()) ? `'${yearStr.slice(2)}` : ''
    return {
      label: `${monthName} ${yearLabel}`.trim(),
      value: raw === undefined ? 0 : Math.round(raw),
      isCurrent: key === currentMonth,
      day: `${key}-01`,
      isEmpty: raw === undefined,
    }
  })
}

function aggregateYearly(
  sorted: readonly { day: string; grossRevenue: number }[],
  count = 5,
): BarChartPoint[] {
  const years: Map<string, number> = new Map()
  for (const row of sorted) {
    const key = row.day.slice(0, 4)
    years.set(key, (years.get(key) ?? 0) + row.grossRevenue)
  }

  const recent = densePeriodKeys([...years.keys()], 'year', Math.min(MIN_BAR_PERIODS, count), count)

  const currentYear = String(new Date().getFullYear())

  return recent.map((key) => {
    const raw = years.get(key)
    return {
      label: key,
      value: raw === undefined ? 0 : Math.round(raw),
      isCurrent: key === currentYear,
      day: `${key}-01-01`,
      isEmpty: raw === undefined,
    }
  })
}

function aggregateRange(
  sorted: readonly { day: string; grossRevenue: number }[],
  start: string,
  end: string,
): BarChartPoint[] {
  const filtered = sorted.filter((row) => row.day >= start && row.day <= end)
  const months: Map<string, number> = new Map()
  for (const row of filtered) {
    const key = row.day.slice(0, 7)
    months.set(key, (months.get(key) ?? 0) + row.grossRevenue)
  }

  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  // Anchor the dense series to the requested range so empty months inside the
  // selection still render as placeholder bars.
  const keys = months.size > 0
    ? [...months.keys(), start.slice(0, 7), end.slice(0, 7)]
    : []

  return densePeriodKeys(keys, 'month', MIN_BAR_PERIODS, 12).map((key) => {
    const raw = months.get(key)
    const monthName = new Date(`${key}-01T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      timeZone: 'UTC',
    })
    return {
      label: monthName,
      value: raw === undefined ? 0 : Math.round(raw),
      isCurrent: key === currentMonth,
      day: `${key}-01`,
      isEmpty: raw === undefined,
    }
  })
}

/**
 * Get the total revenue for a given period.
 */
export function revenueForPeriod(
  snapshot: AnalyticsSnapshot | null,
  period: ChartPeriod,
): number | null {
  if (!snapshot) return null
  const cutoff = periodCutoff(period)
  const filtered = cutoff
    ? snapshot.revenue.filter((row) => row.day >= cutoff)
    : snapshot.revenue
  if (filtered.length === 0) return null
  return filtered.reduce((sum, row) => sum + row.grossRevenue, 0)
}

function periodCutoff(period: ChartPeriod): string | null {
  if (period === 'all') return null
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Get revenue for a previous equal-length period for growth calculation.
 */
export function previousPeriodRevenue(
  snapshot: AnalyticsSnapshot | null,
  period: ChartPeriod,
): number | null {
  if (!snapshot) return null
  const cutoff = periodCutoff(period)
  if (!cutoff) return null
  const currentStart = new Date(cutoff + 'T00:00:00')
  const periodMs = Date.now() - currentStart.getTime()
  const prevStart = new Date(currentStart.getTime() - periodMs)
  const prevStartStr = prevStart.toISOString().slice(0, 10)
  const prevEndStr = cutoff

  const filtered = snapshot.revenue.filter(
    (row) => row.day >= prevStartStr && row.day < prevEndStr,
  )
  if (filtered.length === 0) return null
  return filtered.reduce((sum, row) => sum + row.grossRevenue, 0)
}

const CATEGORY_COLORS = [
  'rgb(59, 130, 246)', 'rgb(16, 185, 129)', 'rgb(245, 158, 11)', 'rgb(155, 124, 246)', 'rgb(239, 68, 68)',
  'rgb(87, 198, 233)', 'rgb(249, 115, 22)', 'rgb(139, 92, 246)', 'rgb(236, 72, 153)', 'rgb(20, 184, 166)',
]

/**
 * Aggregate revenue by product category using catalog payload.
 */
export function aggregateByCategory(
  snapshot: AnalyticsSnapshot | null,
  products: ReadonlyArray<{ productId: string; payload: Record<string, unknown> }>,
): CategorySales[] {
  if (!snapshot || snapshot.productSales.length === 0) return []

  const productCategory = new Map<string, string>()
  for (const product of products) {
    const payload = product.payload
    const category =
      typeof payload.product_type === 'string' && (payload.product_type as string).trim()
        ? (payload.product_type as string).trim()
        : typeof payload.type === 'string' && (payload.type as string).trim()
          ? (payload.type as string).trim()
          : 'Uncategorized'
    productCategory.set(product.productId, category)
  }

  const byCategory = new Map<string, number>()
  for (const sale of snapshot.productSales) {
    const category = productCategory.get(sale.productId) ?? 'Uncategorized'
    byCategory.set(category, (byCategory.get(category) ?? 0) + sale.grossRevenue)
  }

  const sorted = [...byCategory.entries()]
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)

  const pickColor = (index: number): string => {
    return CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? 'rgb(107, 114, 128)'
  }

  if (sorted.length <= 6) {
    return sorted.map((item, index) => ({
      ...item,
      color: pickColor(index),
    }))
  }

  const top = sorted.slice(0, 5)
  const others = sorted.slice(5).reduce((sum, item) => sum + item.value, 0)

  return [
    ...top.map((item, index) => ({
      ...item,
      color: pickColor(index),
    })),
    { name: 'Others', value: others, color: 'rgb(107, 114, 128)' },
  ]
}

/**
 * Build a calendar month grid from daily revenue data.
 */
export function buildCalendarMonth(
  snapshot: AnalyticsSnapshot | null,
  year: number,
  month: number,
): CalendarMonth {
  const revenueByDay = new Map<string, number>()
  if (snapshot) {
    for (const row of snapshot.revenue) {
      revenueByDay.set(row.day, row.grossRevenue)
    }
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()

  const days: CalendarDay[] = []

  for (let i = 0; i < firstDayOfWeek; i++) {
    const padDate = new Date(year, month - 1, -firstDayOfWeek + i + 1)
    const dateStr = padDate.toISOString().slice(0, 10)
    days.push({
      date: dateStr,
      day: padDate.getDate(),
      value: null,
      isCurrentMonth: false,
    })
  }

  let total = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const value = revenueByDay.get(dateStr) ?? null
    if (value !== null) total += value
    days.push({
      date: dateStr,
      day: d,
      value: value !== null ? Math.round(value) : null,
      isCurrentMonth: true,
    })
  }

  const remaining = 7 - ((firstDayOfWeek + daysInMonth) % 7)
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      const padDate = new Date(year, month, i)
      const dateStr = padDate.toISOString().slice(0, 10)
      days.push({
        date: dateStr,
        day: padDate.getDate(),
        value: null,
        isCurrentMonth: false,
      })
    }
  }

  return { year, month, days, total: Math.round(total) }
}

/**
 * Build recent orders list from analytics data.
 */
export function buildRecentOrders(
  snapshot: AnalyticsSnapshot | null,
): RecentOrder[] {
  if (!snapshot || snapshot.orders.length === 0) return []

  const sortedOrders = [...snapshot.orders].sort((a, b) => b.day.localeCompare(a.day))

  return sortedOrders.slice(0, 8).map((order) => {
    const matchingRevenue = snapshot.revenue.find((r) => r.day === order.day)
    const revenuePerOrder = order.orderCount > 0 && matchingRevenue
      ? Math.round(matchingRevenue.grossRevenue / order.orderCount)
      : 0

    return {
      id: order.day,
      orderNumber: `${order.day.slice(5)}-${order.orderCount}`,
      customer: `${order.orderCount} order${order.orderCount > 1 ? 's' : ''}`,
      amount: revenuePerOrder * order.orderCount,
      status: order.fulfilledCount > 0 ? 'fulfilled' as const : 'paid' as const,
      date: order.day,
      orderCount: order.orderCount,
      fulfilledCount: order.fulfilledCount,
      cancelledCount: order.cancelledCount,
      averageOrderValue: order.orderCount > 0 ? Math.round(revenuePerOrder) : 0,
    }
  })
}

function getWeekStart(date: Date): number {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Generate a deterministic AI-style summary from analytics data.
 */
export function generateSummary(
  snapshot: AnalyticsSnapshot | null,
  products: ReadonlyArray<{ productId: string; payload: Record<string, unknown> }>,
): string {
  if (!snapshot || snapshot.revenue.length === 0) {
    return 'No data available yet. Sync your Shopify store to see insights.'
  }

  const totalRevenue = snapshot.revenue.reduce((s, r) => s + r.grossRevenue, 0)
  const totalOrders = snapshot.orders.reduce((s, o) => s + o.orderCount, 0)
  const cutoff30d = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const recentRevenue = snapshot.revenue
    .filter((r) => r.day >= cutoff30d)
    .reduce((s, r) => s + r.grossRevenue, 0)
  const recentOrders = snapshot.orders
    .filter((o) => o.day >= cutoff30d)
    .reduce((s, o) => s + o.orderCount, 0)

  const productSales = [...snapshot.productSales]
    .sort((a, b) => b.grossRevenue - a.grossRevenue)
    .slice(0, 5)

  const productNames = new Map<string, string>()
  for (const product of products) {
    const payload = product.payload
    const title =
      typeof payload.title === 'string' && (payload.title as string).trim()
        ? (payload.title as string).trim()
        : product.productId
    productNames.set(product.productId, title)
  }

  const topProduct = productSales[0]
  const topProductName = topProduct
    ? productNames.get(topProduct.productId) ?? `Product #${topProduct.productId}`
    : null

  const parts: string[] = []

  if (recentRevenue > 0) {
    const aov = recentOrders > 0 ? recentRevenue / recentOrders : 0
    const formattedRevenue = formatMoneyShort(recentRevenue)
    parts.push(
      `Your store generated **${formattedRevenue}** in the last 30 days across **${recentOrders} orders** (AOV **${formatMoneyShort(aov)}**).`,
    )
  }

  if (topProductName && topProduct) {
    const formatted = formatMoneyShort(topProduct.grossRevenue)
    parts.push(
      `Top performer: **${topProductName}** with **${formatted}** in sales.`,
    )
  }

  const totalFulfilled = snapshot.orders.reduce((s, o) => s + o.fulfilledCount, 0)
  const totalCancelled = snapshot.orders.reduce((s, o) => s + o.cancelledCount, 0)
  if (totalOrders > 0) {
    const fulfillmentRate = (totalFulfilled / totalOrders) * 100
    const cancelRate = (totalCancelled / totalOrders) * 100
    if (fulfillmentRate > 0) {
      parts.push(
        `Fulfillment rate: **${fulfillmentRate.toFixed(0)}%** (${cancelRate.toFixed(1)}% cancelled).`,
      )
    }
  }

  const totalDiscounts = snapshot.revenue.reduce((s, r) => s + r.discounts, 0)
  if (totalDiscounts > 0) {
    parts.push(`Discounts applied: **${formatMoneyShort(totalDiscounts)}**.`)
  }

  if (parts.length === 0) {
    return 'Your store data is loaded. No significant insights to report yet — check back after more orders come in.'
  }

  return parts.join(' ')
}

function formatMoneyShort(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
  return `$${Math.round(value).toLocaleString()}`
}