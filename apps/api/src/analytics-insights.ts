import { withTenantContext } from '@profitpilot/db'
import type { AnalyticsRepository, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { BillingRepository } from '@profitpilot/billing'
import type { OpenRouterClient } from '@profitpilot/ai'
import { planAtLeast, validateLanguageResponse } from '@profitpilot/ai'
import { AppError } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { OrderRepository } from './orders.js'

const CACHE_MS = 5 * 60_000
const QUERY_LIMIT: Readonly<Record<PlanTier, number | null>> = { trial: 0, start: 5, growth: 20, commander: null }
const GROWTH = ['product_trends', 'customer_segments', 'natural_language_insight', 'period_comparisons', 'geographic_distribution'] as const
const COMMANDER = ['predictive_revenue', 'cohort_analysis', 'growth_opportunities', 'custom_ai_queries', 'executive_report'] as const
export type AnalyticsFeature = 'anomaly_detection' | (typeof GROWTH)[number] | (typeof COMMANDER)[number]
export type ForecastPoint = Readonly<{ day: string; value: number; lower: number; upper: number }>
export type AnalyticsInsightsResult = Readonly<{
  plan: PlanTier
  generatedAt: string
  salesHistoryDays: number
  forecast: Readonly<{ status: 'available' | 'insufficient_data'; message: string; points: readonly ForecastPoint[]; standardDeviation: number }>
  anomalies: readonly Readonly<{ day: string; direction: 'spike' | 'dip'; value: number; average: number; percentFromAverage: number }>[] | null
  categories: readonly Readonly<{ name: string; revenue: number; units: number }>[]
  topProducts: readonly Readonly<{ productId: string; name: string; image: string | null; units: number; revenue: number; share: number; trend: 'up' | 'down' | 'flat' }>[]
  weekdays: readonly Readonly<{ day: string; revenue: number }>[]
  peakHours: readonly Readonly<{ hour: number; orders: number }>[] | null
  totalCustomers: number | null
  available: readonly AnalyticsFeature[]
  locked: readonly Readonly<{ feature: AnalyticsFeature; requiredPlan: 'start' | 'growth' | 'commander' }>[]
  usage: Readonly<{ used: number; limit: number | null; remaining: number | null }>
  cached: boolean
}>

export interface AnalyticsQueryUsage {
  current(storeId: StoreId): Promise<number>
  consume(storeId: StoreId, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>>
}

export class PostgresAnalyticsQueryUsage implements AnalyticsQueryUsage {
  public constructor(private readonly database: SqlExecutor) {}
  public current(storeId: StoreId): Promise<number> { return withTenantContext(this.database, storeId, async (client) => { const result = await client.query<QueryResultRow & { used: string | number }>(`SELECT used FROM billing_usage WHERE shop_id = $1 AND feature = 'analytics_ai_queries_day' AND period_start = CURRENT_DATE`, [storeId]); return Number(result.rows[0]?.used ?? 0) }) }
  public consume(storeId: StoreId, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>> { return withTenantContext(this.database, storeId, async (client) => { const result = await client.query<QueryResultRow & { used: string | number }>(`INSERT INTO billing_usage (shop_id, feature, period_start, used) VALUES ($1, 'analytics_ai_queries_day', CURRENT_DATE, 1) ON CONFLICT (shop_id, feature, period_start) DO UPDATE SET used = billing_usage.used + 1 WHERE $2::bigint IS NULL OR billing_usage.used < $2::bigint RETURNING used`, [storeId, limit]); if (result.rows[0]) return { allowed: true, used: Number(result.rows[0].used) }; return { allowed: false, used: await this.current(storeId) } }) }
}

export class InMemoryAnalyticsQueryUsage implements AnalyticsQueryUsage {
  private readonly values = new Map<string, number>()
  public async current(storeId: StoreId) { return this.values.get(`${storeId}:${new Date().toISOString().slice(0, 10)}`) ?? 0 }
  public async consume(storeId: StoreId, limit: number | null) { const key = `${storeId}:${new Date().toISOString().slice(0, 10)}`; const used = this.values.get(key) ?? 0; if (limit !== null && used >= limit) return { allowed: false, used }; this.values.set(key, used + 1); return { allowed: true, used: used + 1 } }
}

type Cached = Readonly<{ expires: number; value: Omit<AnalyticsInsightsResult, 'cached'> }>
export class AnalyticsInsightsService {
  private readonly cache = new Map<string, Cached>()
  public constructor(
    private readonly analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>,
    private readonly billing: Pick<BillingRepository, 'get'>,
    private readonly orders: Pick<OrderRepository, 'list'> | null,
    private readonly usage: AnalyticsQueryUsage,
    private readonly provider: Pick<OpenRouterClient, 'generate'> | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async get(storeId: StoreId): Promise<AnalyticsInsightsResult> {
    const plan = (await this.billing.get(storeId))?.plan ?? 'trial'
    const cached = this.cache.get(`${storeId}:${plan}`)
    if (cached && cached.expires > this.now()) return { ...cached.value, cached: true }
    const [snapshot, catalog, orders] = await Promise.all([this.analytics.read(storeId), this.analytics.readCatalog(storeId), this.orders?.list(storeId).catch(() => []) ?? Promise.resolve([])])
    const forecast = linearForecast(snapshot.revenue)
    const categories = groupCategories(snapshot.productSales, catalog)
    const topProducts = rankProducts(snapshot.productSales, catalog)
    const weekdays = groupWeekdays(snapshot.revenue)
    const timestamps = orders.flatMap((order) => order.createdAt ? [new Date(order.createdAt)] : []).filter((date) => Number.isFinite(date.valueOf()))
    const peakHours = timestamps.length ? Array.from({ length: 24 }, (_, hour) => ({ hour, orders: timestamps.filter((date) => date.getUTCHours() === hour).length })) : null
    const available: AnalyticsFeature[] = []
    if (planAtLeast(plan, 'start')) available.push('anomaly_detection')
    if (planAtLeast(plan, 'growth')) available.push(...GROWTH)
    if (planAtLeast(plan, 'commander')) available.push(...COMMANDER)
    const locked: Array<{ feature: AnalyticsFeature; requiredPlan: 'start' | 'growth' | 'commander' }> = []
    if (!planAtLeast(plan, 'start')) locked.push({ feature: 'anomaly_detection', requiredPlan: 'start' })
    if (!planAtLeast(plan, 'growth')) locked.push(...GROWTH.map((feature) => ({ feature, requiredPlan: 'growth' as const })))
    if (!planAtLeast(plan, 'commander')) locked.push(...COMMANDER.map((feature) => ({ feature, requiredPlan: 'commander' as const })))
    const used = await this.usage.current(storeId)
    const limit = QUERY_LIMIT[plan]
    const value: Omit<AnalyticsInsightsResult, 'cached'> = {
      plan, generatedAt: new Date(this.now()).toISOString(), salesHistoryDays: snapshot.revenue.length, forecast,
      anomalies: planAtLeast(plan, 'start') ? detectAnomalies(snapshot.revenue) : null,
      categories, topProducts, weekdays, peakHours,
      totalCustomers: cohortCustomerTotal(snapshot.customerCohorts),
      available, locked, usage: { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) },
    }
    this.cache.set(`${storeId}:${plan}`, { expires: this.now() + CACHE_MS, value })
    return { ...value, cached: false }
  }

  public async query(storeId: StoreId, question: string): Promise<Readonly<{ text: string; model: string; usage: { used: number; limit: number | null } }>> {
    const normalized = question.trim().slice(0, 500)
    if (!normalized) throw new AppError('VALIDATION_ERROR', 'A question is required', 400)
    const plan = (await this.billing.get(storeId))?.plan ?? 'trial'
    if (plan !== 'commander') throw new AppError('FORBIDDEN', 'Commander is required for custom analytics queries', 403, { locked: true, required_plan: 'commander' })
    if (!this.provider) throw new AppError('DEPENDENCY_ERROR', 'AI analytics is temporarily unavailable', 503)
    const reserved = await this.usage.consume(storeId, QUERY_LIMIT[plan])
    if (!reserved.allowed) throw new AppError('RATE_LIMITED', 'Daily analytics query limit reached', 429)
    const snapshot = await this.analytics.read(storeId)
    const facts = aggregateFacts(snapshot)
    const generation = await this.provider.generate('Answer using only the aggregate store facts supplied. Never infer customers, identities, or unsupported numbers. Be concise.', `Question: ${normalized}\nAggregate facts:\n${facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n')}`)
    return { text: validateLanguageResponse(generation.text, facts, 0), model: generation.model, usage: { used: reserved.used, limit: QUERY_LIMIT[plan] } }
  }
}

export function linearForecast(rows: readonly Readonly<{ day: string; grossRevenue: number }>[]) {
  const values = [...rows].sort((a, b) => a.day.localeCompare(b.day)).slice(-30)
  if (values.length < 7) return { status: 'insufficient_data' as const, message: 'Awaiting more data — at least 7 sales days are needed.', points: [], standardDeviation: 0 }
  const n = values.length; const xMean = (n - 1) / 2; const yMean = values.reduce((sum, row) => sum + row.grossRevenue, 0) / n
  const denominator = values.reduce((sum, _row, index) => sum + (index - xMean) ** 2, 0)
  const slope = denominator ? values.reduce((sum, row, index) => sum + (index - xMean) * (row.grossRevenue - yMean), 0) / denominator : 0
  const intercept = yMean - slope * xMean
  const residuals = values.map((row, index) => row.grossRevenue - (intercept + slope * index))
  const deviation = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / n)
  const last = new Date(`${values.at(-1)?.day}T00:00:00Z`)
  const points = Array.from({ length: 7 }, (_, offset) => { const value = Math.max(0, intercept + slope * (n + offset)); const day = new Date(last.valueOf() + (offset + 1) * 86_400_000).toISOString().slice(0, 10); return { day, value, lower: Math.max(0, value - deviation), upper: value + deviation } })
  return { status: 'available' as const, message: 'Based on the last 30 days of sales history.', points, standardDeviation: deviation }
}

export function detectAnomalies(rows: readonly Readonly<{ day: string; grossRevenue: number }>[]) {
  if (rows.length < 14) return []
  const mean = rows.reduce((sum, row) => sum + row.grossRevenue, 0) / rows.length
  const deviation = Math.sqrt(rows.reduce((sum, row) => sum + (row.grossRevenue - mean) ** 2, 0) / rows.length)
  if (!deviation) return []
  return rows.filter((row) => Math.abs(row.grossRevenue - mean) > 2 * deviation).map((row) => ({ day: row.day, direction: row.grossRevenue > mean ? 'spike' as const : 'dip' as const, value: row.grossRevenue, average: mean, percentFromAverage: mean ? (row.grossRevenue - mean) / mean * 100 : 0 }))
}

export function groupCategories(sales: readonly Readonly<{ productId: string; grossRevenue: number; unitsSold: number }>[], catalog: readonly Readonly<{ productId: string; payload: Readonly<Record<string, unknown>> }>[]) {
  const products = new Map(catalog.map((item) => [item.productId, item.payload]))
  const totals = new Map<string, { revenue: number; units: number }>()
  for (const row of sales) { const payload = products.get(row.productId); const raw = payload?.productType ?? payload?.product_type; const name = typeof raw === 'string' && raw.trim() ? raw.trim() : 'Uncategorized'; const current = totals.get(name) ?? { revenue: 0, units: 0 }; totals.set(name, { revenue: current.revenue + row.grossRevenue, units: current.units + row.unitsSold }) }
  return [...totals].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.revenue - a.revenue)
}

function rankProducts(sales: readonly Readonly<{ productId: string; day: string; grossRevenue: number; unitsSold: number }>[], catalog: readonly Readonly<{ productId: string; payload: Readonly<Record<string, unknown>> }>[]) {
  const products = new Map(catalog.map((item) => [item.productId, item.payload])); const totals = new Map<string, { revenue: number; units: number; first: number; last: number }>(); const days = [...new Set(sales.map((row) => row.day))].sort(); const midpoint = days[Math.floor(days.length / 2)] ?? ''
  for (const row of sales) { const current = totals.get(row.productId) ?? { revenue: 0, units: 0, first: 0, last: 0 }; current.revenue += row.grossRevenue; current.units += row.unitsSold; if (row.day < midpoint) current.first += row.grossRevenue; else current.last += row.grossRevenue; totals.set(row.productId, current) }
  const total = [...totals.values()].reduce((sum, value) => sum + value.revenue, 0)
  return [...totals].map(([productId, value]) => { const payload = products.get(productId); const image = payload?.image; return { productId, name: typeof payload?.title === 'string' ? payload.title : productId, image: typeof image === 'object' && image !== null && typeof (image as Record<string, unknown>).src === 'string' ? String((image as Record<string, unknown>).src) : null, units: value.units, revenue: value.revenue, share: total ? value.revenue / total * 100 : 0, trend: value.last > value.first ? 'up' as const : value.last < value.first ? 'down' as const : 'flat' as const } }).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
}

function cohortCustomerTotal(rows: readonly Readonly<{ cohortDay: string; customerCount: number }>[]): number | null { if (!rows.length) return null; const cohorts = new Map<string, number>(); for (const row of rows) cohorts.set(row.cohortDay, Math.max(cohorts.get(row.cohortDay) ?? 0, row.customerCount)); return [...cohorts.values()].reduce((sum, value) => sum + value, 0) }
function groupWeekdays(rows: readonly Readonly<{ day: string; grossRevenue: number }>[]) { const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const totals = labels.map((day) => ({ day, revenue: 0 })); for (const row of rows) { const index = new Date(`${row.day}T00:00:00Z`).getUTCDay(); if (Number.isFinite(index) && totals[index]) totals[index].revenue += row.grossRevenue } return [...totals.slice(1), totals[0]!] }
function aggregateFacts(snapshot: Awaited<ReturnType<AnalyticsRepository['read']>>) { const revenue = snapshot.revenue.reduce((sum, row) => sum + row.grossRevenue, 0); const orders = snapshot.orders.reduce((sum, row) => sum + row.orderCount, 0); return [{ key: 'total_revenue', label: 'Total revenue', value: revenue, source: 'aggregate analytics' }, { key: 'total_orders', label: 'Total orders', value: orders, source: 'aggregate analytics' }, { key: 'sales_days', label: 'Sales days', value: snapshot.revenue.length, source: 'aggregate analytics' }, { key: 'products_with_sales', label: 'Products with sales rows', value: new Set(snapshot.productSales.map((row) => row.productId)).size, source: 'aggregate analytics' }] }
