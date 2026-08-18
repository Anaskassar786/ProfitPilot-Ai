import type { AnalyticsSnapshot } from './model.js'
import type { ForecastBundle, ReportRun } from './f8-model.js'
import { safeDate, safeDayKey } from './safe-date.js'

export type ReportPlan = 'trial' | 'start' | 'growth' | 'commander'
export type ReportKind = 'MONTHLY' | 'QUARTERLY' | 'CUSTOM'
export type ReportStatusTone = 'ready' | 'generating' | 'failed' | 'emailed'

export type ReportAccess = Readonly<{
  monthlyLimit: number | null
  quarterlyLimit: number | null
  custom: boolean
  pdf: boolean
  email: boolean
  whiteLabel: boolean
  apiAccess: boolean
}>

export type ReportGate = Readonly<{
  allowed: boolean
  reason: string | null
  used: number
  limit: number | null
}>

export type ClosedReportPeriod = Readonly<{ start: string; end: string; label: string }>

export type ReportStatusView = Readonly<{
  label: string
  tone: ReportStatusTone
  emailed: boolean
}>

export type ReportPreviewMetric = Readonly<{ label: string; value: string | null; source: string }>

export type ReportPreview = Readonly<{
  title: string
  periodLabel: string
  summary: string
  metrics: readonly ReportPreviewMetric[]
  revenuePoints: readonly Readonly<{ day: string; value: number }>[]
  topProducts: readonly Readonly<{ title: string; value: number }>[]
  customers: readonly ReportPreviewMetric[]
  dataAvailable: boolean
}>

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

const PLAN_ACCESS: Readonly<Record<ReportPlan, ReportAccess>> = {
  trial: { monthlyLimit: 1, quarterlyLimit: 0, custom: false, pdf: true, email: false, whiteLabel: false, apiAccess: false },
  start: { monthlyLimit: 3, quarterlyLimit: 1, custom: false, pdf: true, email: false, whiteLabel: false, apiAccess: false },
  growth: { monthlyLimit: null, quarterlyLimit: null, custom: true, pdf: true, email: true, whiteLabel: false, apiAccess: false },
  commander: { monthlyLimit: null, quarterlyLimit: null, custom: true, pdf: true, email: true, whiteLabel: true, apiAccess: true },
}

export function resolveReportPlan(raw: string | null | undefined): ReportPlan {
  const value = raw?.trim().toLowerCase()
  if (value === 'commander') return 'commander'
  if (value === 'growth') return 'growth'
  if (value === 'start') return 'start'
  return 'trial'
}

export function reportAccessFor(plan: ReportPlan): ReportAccess {
  return PLAN_ACCESS[plan]
}

export function planDisplayName(plan: ReportPlan): string {
  if (plan === 'commander') return 'Commander'
  if (plan === 'growth') return 'Growth'
  if (plan === 'start') return 'Start'
  return 'Trial'
}

export function reportKindLabel(kind: ReportKind | ReportRun['frequency']): string {
  if (kind === 'QUARTERLY') return 'Quarterly Report'
  if (kind === 'MONTHLY') return 'Monthly Report'
  if (kind === 'CUSTOM') return 'Custom Report'
  if (kind === 'WEEKLY') return 'Weekly Report'
  return 'Daily Report'
}

export function formatUtcDate(value: string | number | Date, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  const date = value instanceof Date ? value : safeDate(value)
  if (!date) return '—'
  return date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

export function formatPeriodRange(start: string, end: string): string {
  const startDay = safeDayKey(start)
  const endDay = safeDayKey(end)
  if (!startDay || !endDay) return '—'
  const sameYear = startDay.slice(0, 4) === endDay.slice(0, 4)
  const left = formatUtcDate(startDay, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  const right = formatUtcDate(endDay, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${left} – ${right}`
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function reportDisplayName(run: Pick<ReportRun, 'frequency' | 'period'>): string {
  const start = safeDate(run.period.start)
  if (!start) return reportKindLabel(run.frequency)
  if (run.frequency === 'MONTHLY') {
    const startDay = safeDayKey(run.period.start)
    if (startDay && !startDay.endsWith('-01')) return `${reportKindLabel('CUSTOM')} — ${formatPeriodRange(run.period.start, run.period.end)}`
    return `${reportKindLabel('MONTHLY')} — ${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`
  }
  if (run.frequency === 'QUARTERLY') return `${reportKindLabel('QUARTERLY')} — Q${quarterOf(start)} ${start.getUTCFullYear()}`
  if (run.frequency === 'WEEKLY') return `${reportKindLabel('WEEKLY')} — ${formatPeriodRange(run.period.start, run.period.end)}`
  if (run.frequency === 'DAILY') return `${reportKindLabel('DAILY')} — ${formatUtcDate(run.period.start, { month: 'long', day: 'numeric', year: 'numeric' })}`
  return `${reportKindLabel('CUSTOM')} — ${formatPeriodRange(run.period.start, run.period.end)}`
}

export function looksLikeRawFilename(value: string): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value)
}

export function reportStatusView(run: Pick<ReportRun, 'status' | 'emailStatus'>): ReportStatusView {
  if (run.status === 'FAILED') return { label: 'Failed', tone: 'failed', emailed: false }
  if (run.status === 'GENERATING') return { label: 'Generating…', tone: 'generating', emailed: false }
  if (run.emailStatus === 'SENT') return { label: 'Emailed', tone: 'emailed', emailed: true }
  return { label: 'Ready', tone: 'ready', emailed: false }
}

export function countReportsInWindow(
  runs: readonly Pick<ReportRun, 'frequency' | 'createdAt' | 'status'>[],
  frequency: ReportRun['frequency'],
  now: Date = new Date(),
): number {
  const windowStart = frequency === 'QUARTERLY' ? startOfUtcQuarter(now) : startOfUtcMonth(now)
  return runs.filter((run) => run.frequency === frequency && run.status !== 'FAILED' && run.createdAt >= windowStart.getTime()).length
}

export function canGenerateReport(
  plan: ReportPlan,
  kind: ReportKind,
  runs: readonly Pick<ReportRun, 'frequency' | 'createdAt' | 'status'>[],
  now: Date = new Date(),
): ReportGate {
  const access = reportAccessFor(plan)
  if (kind === 'CUSTOM') {
    return access.custom
      ? { allowed: true, reason: null, used: 0, limit: null }
      : { allowed: false, reason: 'Custom date ranges unlock when you Upgrade Plan.', used: 0, limit: 0 }
  }
  if (kind === 'QUARTERLY') {
    const used = countReportsInWindow(runs, 'QUARTERLY', now)
    if (access.quarterlyLimit === 0) return { allowed: false, reason: 'Quarterly reports unlock when you Upgrade Plan.', used, limit: 0 }
    if (access.quarterlyLimit !== null && used >= access.quarterlyLimit) {
      return { allowed: false, reason: 'You have used this quarter’s reports. Upgrade Plan for more.', used, limit: access.quarterlyLimit }
    }
    return { allowed: true, reason: null, used, limit: access.quarterlyLimit }
  }
  const used = countReportsInWindow(runs, 'MONTHLY', now)
  if (access.monthlyLimit !== null && used >= access.monthlyLimit) {
    return { allowed: false, reason: 'You have used this month’s reports. Upgrade Plan for more.', used, limit: access.monthlyLimit }
  }
  return { allowed: true, reason: null, used, limit: access.monthlyLimit }
}

export function usageCopy(plan: ReportPlan, runs: readonly Pick<ReportRun, 'frequency' | 'createdAt' | 'status'>[], now: Date = new Date()): string {
  const access = reportAccessFor(plan)
  const used = countReportsInWindow(runs, 'MONTHLY', now)
  if (access.monthlyLimit === null) return 'Unlimited monthly reports this month'
  return `Reports this month: ${used}/${access.monthlyLimit} used`
}

export function closedPeriodFor(kind: ReportKind, now: Date = new Date(), custom?: Readonly<{ start: string; end: string }>): ClosedReportPeriod {
  if (kind === 'CUSTOM' && custom) {
    const startDay = safeDayKey(custom.start)
    const endDay = safeDayKey(custom.end)
    if (!startDay || !endDay) throw new RangeError('Choose a valid start and end date.')
    if (startDay >= endDay) throw new RangeError('The end date must be after the start date.')
    const yesterday = utcYesterday(now)
    if (endDay > yesterday) throw new RangeError('Reports only cover closed days — choose an end date before today.')
    return { start: `${startDay}T00:00:00.000Z`, end: `${endDay}T23:59:59.000Z`, label: formatPeriodRange(startDay, endDay) }
  }
  const yesterday = utcYesterdayDate(now)
  if (kind === 'QUARTERLY') {
    const quarterStart = startOfUtcQuarter(yesterday)
    return {
      start: isoStart(quarterStart),
      end: isoEnd(yesterday),
      label: `Q${quarterOf(quarterStart)} ${quarterStart.getUTCFullYear()} · ${formatPeriodRange(isoStart(quarterStart), isoEnd(yesterday))}`,
    }
  }
  const monthStart = startOfUtcMonth(yesterday)
  return {
    start: isoStart(monthStart),
    end: isoEnd(yesterday),
    label: `${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()} · ${formatPeriodRange(isoStart(monthStart), isoEnd(yesterday))}`,
  }
}

export function assertCustomRange(start: string, end: string, now: Date = new Date()): void {
  closedPeriodFor('CUSTOM', now, { start, end })
}

export function forecastReadiness(forecast: ForecastBundle | null): Readonly<{ ready: boolean; detail: string }> {
  if (forecast?.revenue) return { ready: true, detail: 'Enough closed weekly periods are synced to ground the forecast.' }
  return { ready: false, detail: 'At least two closed weekly periods are required. Currently: building baseline — sync more store data.' }
}

export function buildReportPreview(
  run: Pick<ReportRun, 'frequency' | 'period'>,
  analytics: AnalyticsSnapshot | null,
  forecast: ForecastBundle | null,
): ReportPreview {
  const startDay = safeDayKey(run.period.start)
  const endDay = safeDayKey(run.period.end)
  const title = reportDisplayName(run)
  const periodLabel = startDay && endDay ? formatPeriodRange(startDay, endDay) : '—'
  const revenueRows = (analytics?.revenue ?? []).filter((row) => inRange(row.day, startDay, endDay))
  const orderRows = (analytics?.orders ?? []).filter((row) => inRange(row.day, startDay, endDay))
  const productRows = (analytics?.productSales ?? []).filter((row) => inRange(row.day, startDay, endDay))
  const cohortRows = (analytics?.customerCohorts ?? []).filter((row) => inRange(row.activityDay, startDay, endDay))
  const revenue = sum(revenueRows.map((row) => row.grossRevenue))
  const orders = sum(orderRows.map((row) => row.orderCount))
  const customers = sum(cohortRows.map((row) => row.customerCount))
  const aov = orders > 0 ? revenue / orders : null
  const topProducts = topProductTotals(productRows, forecast)
  const dataAvailable = revenueRows.length > 0 || orderRows.length > 0 || productRows.length > 0
  const summary = dataAvailable
    ? `${title} covers ${periodLabel}. Every figure below is computed from your synced Shopify rows for that closed period.`
    : `${title} is ready as a PDF, but this period does not yet have measurable synced rows to preview. Sync more store data to fill the summary.`
  return {
    title,
    periodLabel,
    summary,
    metrics: [
      { label: 'Revenue', value: dataAvailable ? formatNumber(revenue) : null, source: 'analytics_revenue_daily' },
      { label: 'Orders', value: orderRows.length > 0 ? formatNumber(orders, 0) : null, source: 'analytics_orders_daily' },
      { label: 'Average order value', value: aov === null ? null : formatNumber(aov), source: 'orders ÷ revenue' },
      { label: 'Forecast band', value: forecast?.revenue ? `${formatNumber(forecast.revenue.lower)} – ${formatNumber(forecast.revenue.upper)}` : null, source: 'deterministic forecast from closed weeks' },
    ],
    revenuePoints: revenueRows.map((row) => ({ day: safeDayKey(row.day) ?? String(row.day), value: row.grossRevenue })),
    topProducts,
    customers: [
      { label: 'Active customers in period', value: cohortRows.length > 0 ? formatNumber(customers, 0) : null, source: 'analytics_customer_cohorts' },
      { label: 'Customers at churn risk', value: forecast?.churn ? formatNumber(forecast.churn.filter((item) => item.churnRisk >= 0.5).length, 0) : null, source: 'forecast from real customer recency' },
    ],
    dataAvailable,
  }
}

export function higherPlanHighlights(plan: ReportPlan): readonly string[] {
  if (plan === 'trial') return ['More monthly reports', 'Quarterly overviews', 'Custom date ranges', 'Email delivery']
  if (plan === 'start') return ['Unlimited monthly and quarterly reports', 'Custom date ranges', 'Email delivery']
  if (plan === 'growth') return ['White-label PDFs', 'API access for generated reports']
  return []
}

function quarterOf(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0))
}

function startOfUtcQuarter(date: Date): Date {
  const month = Math.floor(date.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(date.getUTCFullYear(), month, 1, 0, 0, 0, 0))
}

function utcYesterdayDate(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0))
}

function utcYesterday(now: Date): string {
  return utcYesterdayDate(now).toISOString().slice(0, 10)
}

function isoStart(date: Date): string {
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`
}

function isoEnd(date: Date): string {
  return `${date.toISOString().slice(0, 10)}T23:59:59.000Z`
}

function inRange(day: string, start: string | null, end: string | null): boolean {
  const key = safeDayKey(day)
  if (!key || !start || !end) return false
  return key >= start && key <= end
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(digits, 2) }).format(value)
}

function topProductTotals(
  rows: AnalyticsSnapshot['productSales'],
  forecast: ForecastBundle | null,
): readonly Readonly<{ title: string; value: number }>[] {
  const titles = new Map((forecast?.demand ?? []).map((item) => [item.productId, item.title]))
  const totals = new Map<string, { title: string; value: number }>()
  for (const row of rows) {
    const current = totals.get(row.productId)
    const next = (current?.value ?? 0) + (Number.isFinite(row.unitsSold) ? row.unitsSold : 0)
    totals.set(row.productId, { title: titles.get(row.productId) ?? row.productId, value: next })
  }
  return [...totals.values()].sort((left, right) => right.value - left.value).slice(0, 5)
}
