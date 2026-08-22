import { withTenantContext } from '@profitpilot/db'
import type { AnalyticsRepository, AnalyticsSnapshot, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { BillingRepository } from '@profitpilot/billing'
import type { OpenRouterClient } from '@profitpilot/ai'
import { planAtLeast, validateLanguageResponse } from '@profitpilot/ai'
import { AppError } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { OrderRepository, OrderView } from './orders.js'

const CACHE_MS = 5 * 60_000
const QUERY_LIMIT: Readonly<Record<PlanTier, number | null>> = { trial: 0, start: 5, growth: 20, commander: null }

/**
 * Analytics copilot persona (QA Bug #4e).
 *
 * The previous one-line instruction let the model narrate its own internal
 * reasoning ("I don't have enough rows, so I will…"), which reached merchants
 * as raw developer-style thought process. The copilot must talk like a human
 * analyst: when the historical baseline is missing it says so warmly and
 * honestly instead of exposing internals.
 */
export const ANALYTICS_COPILOT_SYSTEM_PROMPT = [
  'You are ProfitPilot\'s analytics copilot — a warm, human e-commerce analyst advising a busy store owner.',
  'Answer using only the aggregate store facts supplied. Never infer customers, identities, causes, or unsupported numbers.',
  'Give one concise answer and one practical next step, in a friendly conversational tone.',
  'If the historical baseline is missing or thin (few or no sales days synced), respond humanly and honestly — for example: "Since your store was recently connected, we are building your historical baseline. Keep syncing daily and this insight will sharpen within a couple of weeks."',
  'Never output your internal reasoning, debugging details, data-source names, or developer-facing diagnostics. Speak to the merchant, not to yourself.',
].join(' ')
const GROWTH = ['product_trends', 'customer_segments', 'natural_language_insight', 'geographic_distribution', 'cohort_analysis', 'growth_opportunities', 'conversion_funnel', 'executive_summary'] as const
// `industry_benchmarks` was removed (QA Bug #4b): the card was a fake
// "available when industry data is connected" placeholder with no backing
// data source, so the entitlement no longer exists either.
const COMMANDER = ['period_comparisons', 'predictive_revenue', 'custom_ai_queries', 'executive_report'] as const
export type AnalyticsFeature = 'anomaly_detection' | (typeof GROWTH)[number] | (typeof COMMANDER)[number]
export type ForecastPoint = Readonly<{ day: string; value: number; lower: number; upper: number }>
export type ChannelMetric = Readonly<{ channel: string; revenue: number; orders: number; share: number; growth: number | null }>
export type GeographyMetric = Readonly<{ country: string; countryCode: string | null; revenue: number; orders: number; share: number }>
export type CohortMetric = Readonly<{ cohort: string; periods: readonly Readonly<{ month: number; customers: number; retention: number }>[] }>
export type ComparisonMetric = Readonly<{ metric: string; current: number; previous: number; change: number | null }>

export type AnalyticsInsightsResult = Readonly<{
  plan: PlanTier
  generatedAt: string
  salesHistoryDays: number
  forecast: Readonly<{ status: 'available' | 'insufficient_data'; message: string; points: readonly ForecastPoint[]; standardDeviation: number }>
  advancedForecast: Readonly<{ status: 'available' | 'insufficient_data'; message: string; points: readonly ForecastPoint[]; standardDeviation: number }> | null
  anomalies: readonly Readonly<{ day: string; direction: 'spike' | 'dip'; value: number; average: number; percentFromAverage: number }>[] | null
  categories: readonly Readonly<{ name: string; revenue: number; units: number }>[]
  topProducts: readonly Readonly<{ productId: string; name: string; category: string; image: string | null; units: number; revenue: number; share: number; trend: 'up' | 'down' | 'flat'; growth: number | null }>[]
  weekdays: readonly Readonly<{ day: string; revenue: number; orders: number }>[]
  peakHours: readonly Readonly<{ hour: number; orders: number; revenue: number }>[] | null
  totalCustomers: number | null
  customerStats: Readonly<{ identified: number; newCustomers: number; repeatCustomers: number; repeatRate: number | null; loyaltyScore: number | null }>
  channels: readonly ChannelMetric[]
  geography: readonly GeographyMetric[] | null
  cohorts: readonly CohortMetric[] | null
  comparisons: readonly ComparisonMetric[] | null
  funnel: Readonly<{ scopeAvailable: boolean; stages: readonly Readonly<{ name: string; value: number | null; dropoff: number | null }>[]; message: string }> | null
  opportunities: readonly Readonly<{ title: string; evidence: string; action: string; tone: 'positive' | 'warning' | 'neutral' }>[] | null
  executiveSummary: string | null
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
    const cacheKey = `${storeId}:${plan}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expires > this.now()) return { ...cached.value, cached: true }
    const [snapshot, catalog, orders] = await Promise.all([
      this.analytics.read(storeId),
      this.analytics.readCatalog(storeId),
      this.orders?.list(storeId).catch(() => []) ?? Promise.resolve([]),
    ])
    const forecast = linearForecast(snapshot.revenue)
    const categories = groupCategories(snapshot.productSales, catalog)
    const topProducts = rankProducts(snapshot.productSales, catalog)
    const weekdays = groupWeekdays(snapshot, orders)
    const peakHours = groupHours(orders)
    const channels = groupChannels(orders)
    const customerStats = customerMetrics(orders)
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
    const opportunities = planAtLeast(plan, 'growth') ? growthOpportunities(snapshot, topProducts, weekdays) : null
    const value: Omit<AnalyticsInsightsResult, 'cached'> = {
      plan,
      generatedAt: new Date(this.now()).toISOString(),
      salesHistoryDays: new Set(snapshot.revenue.map((row) => row.day)).size,
      forecast,
      advancedForecast: planAtLeast(plan, 'commander') ? linearForecast(snapshot.revenue, 30) : null,
      anomalies: planAtLeast(plan, 'start') ? detectAnomalies(snapshot.revenue) : null,
      categories,
      topProducts,
      weekdays,
      peakHours,
      totalCustomers: cohortCustomerTotal(snapshot.customerCohorts) ?? (customerStats.identified || null),
      customerStats,
      channels,
      geography: planAtLeast(plan, 'growth') ? groupGeography(orders) : null,
      cohorts: planAtLeast(plan, 'growth') ? cohortMatrix(snapshot.customerCohorts) : null,
      comparisons: planAtLeast(plan, 'commander') ? periodComparisons(snapshot) : null,
      funnel: planAtLeast(plan, 'growth') ? orderFunnel(orders) : null,
      opportunities,
      executiveSummary: planAtLeast(plan, 'growth') ? summary(snapshot, weekdays, topProducts) : null,
      available,
      locked,
      usage: { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) },
    }
    this.cache.set(cacheKey, { expires: this.now() + CACHE_MS, value })
    return { ...value, cached: false }
  }

  public async channels(storeId: StoreId) { return (await this.get(storeId)).channels }
  public async geography(storeId: StoreId) { const value = await this.get(storeId); if (value.geography === null) throw locked('Growth', 'geographic distribution'); return value.geography }
  public async cohorts(storeId: StoreId) { const value = await this.get(storeId); if (value.cohorts === null) throw locked('Growth', 'cohort analysis'); return value.cohorts }
  public async comparisons(storeId: StoreId) { const value = await this.get(storeId); if (value.comparisons === null) throw locked('Commander', 'advanced comparisons'); return value.comparisons }
  public async funnel(storeId: StoreId) { const value = await this.get(storeId); if (value.funnel === null) throw locked('Growth', 'conversion funnel'); return value.funnel }

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
    const generation = await this.provider.generate(ANALYTICS_COPILOT_SYSTEM_PROMPT, `Question: ${normalized}\nAggregate facts:\n${facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n')}\nSales days of history available: ${snapshot.revenue.length}`)
    return { text: validateLanguageResponse(generation.text, facts, 0), model: generation.model, usage: { used: reserved.used, limit: QUERY_LIMIT[plan] } }
  }
}

function locked(plan: string, feature: string) { return new AppError('FORBIDDEN', `${plan} is required for ${feature}`, 403, { locked: true, required_plan: plan.toLowerCase() }) }
export function linearForecast(rows: readonly Readonly<{ day: string; grossRevenue: number }>[], horizon = 7) {
  const values = [...rows].sort((a, b) => a.day.localeCompare(b.day)).slice(-30)
  if (values.length < 7) return { status: 'insufficient_data' as const, message: `${values.length} of 7 sales days collected. Sync daily to unlock your forecast.`, points: [], standardDeviation: 0 }
  const n = values.length; const xMean = (n - 1) / 2; const yMean = values.reduce((sum, row) => sum + row.grossRevenue, 0) / n
  const denominator = values.reduce((sum, _row, index) => sum + (index - xMean) ** 2, 0)
  const slope = denominator ? values.reduce((sum, row, index) => sum + (index - xMean) * (row.grossRevenue - yMean), 0) / denominator : 0
  const intercept = yMean - slope * xMean
  const residuals = values.map((row, index) => row.grossRevenue - (intercept + slope * index))
  const deviation = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / n)
  const last = new Date(`${values.at(-1)?.day}T00:00:00Z`)
  const points = Array.from({ length: horizon }, (_, offset) => { const value = Math.max(0, intercept + slope * (n + offset)); const day = new Date(last.valueOf() + (offset + 1) * 86_400_000).toISOString().slice(0, 10); return { day, value, lower: Math.max(0, value - deviation), upper: value + deviation } })
  return { status: 'available' as const, message: `${horizon}-day projection from your latest 30 sales days.`, points, standardDeviation: deviation }
}
export function detectAnomalies(rows: readonly Readonly<{ day: string; grossRevenue: number }>[]) { if (rows.length < 14) return []; const mean = rows.reduce((sum, row) => sum + row.grossRevenue, 0) / rows.length; const deviation = Math.sqrt(rows.reduce((sum, row) => sum + (row.grossRevenue - mean) ** 2, 0) / rows.length); if (!deviation) return []; return rows.filter((row) => Math.abs(row.grossRevenue - mean) > 2 * deviation).map((row) => ({ day: row.day, direction: row.grossRevenue > mean ? 'spike' as const : 'dip' as const, value: row.grossRevenue, average: mean, percentFromAverage: mean ? (row.grossRevenue - mean) / mean * 100 : 0 })).slice(-5).reverse() }
export function groupCategories(sales: readonly Readonly<{ productId: string; grossRevenue: number; unitsSold: number }>[], catalog: readonly Readonly<{ productId: string; payload: Readonly<Record<string, unknown>> }>[]) { const products = new Map(catalog.map((item) => [item.productId, item.payload])); const totals = new Map<string, { revenue: number; units: number }>(); for (const row of sales) { const payload = products.get(row.productId); const raw = payload?.productType ?? payload?.product_type; const name = typeof raw === 'string' && raw.trim() ? raw.trim() : 'Uncategorized'; const current = totals.get(name) ?? { revenue: 0, units: 0 }; totals.set(name, { revenue: current.revenue + row.grossRevenue, units: current.units + row.unitsSold }) } return [...totals].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.revenue - a.revenue) }
function rankProducts(sales: readonly Readonly<{ productId: string; day: string; grossRevenue: number; unitsSold: number }>[], catalog: readonly Readonly<{ productId: string; payload: Readonly<Record<string, unknown>> }>[]) { const products = new Map(catalog.map((item) => [item.productId, item.payload])); const totals = new Map<string, { revenue: number; units: number; first: number; last: number }>(); const days = [...new Set(sales.map((row) => row.day))].sort(); const midpoint = days[Math.floor(days.length / 2)] ?? ''; for (const row of sales) { const current = totals.get(row.productId) ?? { revenue: 0, units: 0, first: 0, last: 0 }; current.revenue += row.grossRevenue; current.units += row.unitsSold; if (row.day < midpoint) current.first += row.grossRevenue; else current.last += row.grossRevenue; totals.set(row.productId, current) } const total = [...totals.values()].reduce((sum, value) => sum + value.revenue, 0); return [...totals].map(([productId, value]) => { const payload = products.get(productId); const image = payload?.image; const rawCategory = payload?.productType ?? payload?.product_type; const growth = value.first > 0 ? (value.last - value.first) / value.first * 100 : null; return { productId, name: typeof payload?.title === 'string' ? payload.title : productId, category: typeof rawCategory === 'string' && rawCategory.trim() ? rawCategory : 'Uncategorized', image: typeof image === 'object' && image !== null && typeof (image as Record<string, unknown>).src === 'string' ? String((image as Record<string, unknown>).src) : null, units: value.units, revenue: value.revenue, share: total ? value.revenue / total * 100 : 0, trend: value.last > value.first ? 'up' as const : value.last < value.first ? 'down' as const : 'flat' as const, growth } }).sort((a, b) => b.revenue - a.revenue).slice(0, 15) }
function cohortCustomerTotal(rows: readonly Readonly<{ cohortDay: string; customerCount: number }>[]): number | null { if (!rows.length) return null; const cohorts = new Map<string, number>(); for (const row of rows) cohorts.set(row.cohortDay, Math.max(cohorts.get(row.cohortDay) ?? 0, row.customerCount)); return [...cohorts.values()].reduce((sum, value) => sum + value, 0) }
function groupWeekdays(snapshot: AnalyticsSnapshot, orders: readonly OrderView[]) { const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const totals = labels.map((day) => ({ day, revenue: 0, orders: 0 })); for (const row of snapshot.revenue) { const index = new Date(`${row.day}T00:00:00Z`).getUTCDay(); if (totals[index]) { totals[index]!.revenue += row.grossRevenue; totals[index]!.orders += row.orderCount } } if (!snapshot.revenue.length) for (const order of orders) { const date = order.createdAt ? new Date(order.createdAt) : null; if (date && Number.isFinite(date.valueOf()) && totals[date.getUTCDay()]) { totals[date.getUTCDay()]!.orders += 1; totals[date.getUTCDay()]!.revenue += order.totalPrice ?? 0 } } return [...totals.slice(1), totals[0]!] }
function groupHours(orders: readonly OrderView[]) { const valid = orders.filter((order) => order.createdAt && Number.isFinite(Date.parse(order.createdAt))); if (!valid.length) return null; return Array.from({ length: 24 }, (_, hour) => { const rows = valid.filter((order) => new Date(order.createdAt!).getUTCHours() === hour); return { hour, orders: rows.length, revenue: rows.reduce((sum, order) => sum + (order.totalPrice ?? 0), 0) } }) }
function channelName(value: string | null | undefined) { const name = value?.trim().toLowerCase() ?? ''; if (!name || name === 'web' || name.includes('online')) return 'Online Store'; if (name.includes('pos')) return 'Point of Sale'; if (name.includes('mobile')) return 'Mobile'; return value?.trim() || 'Third-party' }
function groupChannels(orders: readonly OrderView[]): readonly ChannelMetric[] { if (!orders.length) return []; const totals = new Map<string, { revenue: number; orders: number; current: number; previous: number }>(); const dates = orders.flatMap((order) => order.createdAt ? [Date.parse(order.createdAt)] : []).filter(Number.isFinite); const midpoint = dates.length ? Math.min(...dates) + (Math.max(...dates) - Math.min(...dates)) / 2 : 0; for (const order of orders) { const channel = channelName(order.sourceName); const row = totals.get(channel) ?? { revenue: 0, orders: 0, current: 0, previous: 0 }; const revenue = order.totalPrice ?? 0; row.revenue += revenue; row.orders += 1; if ((order.createdAt ? Date.parse(order.createdAt) : 0) >= midpoint) row.current += revenue; else row.previous += revenue; totals.set(channel, row) } const total = [...totals.values()].reduce((sum, row) => sum + row.revenue, 0); return [...totals].map(([channel, row]) => ({ channel, revenue: row.revenue, orders: row.orders, share: total ? row.revenue / total * 100 : 0, growth: row.previous > 0 ? (row.current - row.previous) / row.previous * 100 : null })).sort((a, b) => b.revenue - a.revenue) }
function groupGeography(orders: readonly OrderView[]): readonly GeographyMetric[] { const values = new Map<string, { code: string | null; revenue: number; orders: number }>(); for (const order of orders) { const address = order.shippingAddress ?? order.billingAddress; const country = address?.country?.trim(); if (!country) continue; const row = values.get(country) ?? { code: address?.countryCode ?? null, revenue: 0, orders: 0 }; row.revenue += order.totalPrice ?? 0; row.orders += 1; values.set(country, row) } const total = [...values.values()].reduce((sum, row) => sum + row.revenue, 0); return [...values].map(([country, row]) => ({ country, countryCode: row.code, revenue: row.revenue, orders: row.orders, share: total ? row.revenue / total * 100 : 0 })).sort((a, b) => b.revenue - a.revenue).slice(0, 12) }
function customerMetrics(orders: readonly OrderView[]) { const counts = new Map<string, number>(); for (const order of orders) if (order.customer.id) counts.set(order.customer.id, (counts.get(order.customer.id) ?? 0) + 1); const repeatCustomers = [...counts.values()].filter((value) => value > 1).length; const newCustomers = [...counts.values()].filter((value) => value === 1).length; const repeatRate = counts.size ? repeatCustomers / counts.size * 100 : null; return { identified: counts.size, newCustomers, repeatCustomers, repeatRate, loyaltyScore: repeatRate === null ? null : Math.min(100, Math.round(repeatRate * 1.25)) } }
function cohortMatrix(rows: AnalyticsSnapshot['customerCohorts']): readonly CohortMetric[] { const groups = new Map<string, Array<{ month: number; customers: number; retention: number }>>(); const sorted = [...rows].sort((a, b) => a.cohortDay.localeCompare(b.cohortDay) || a.activityDay.localeCompare(b.activityDay)); for (const row of sorted) { const start = new Date(`${row.cohortDay}T00:00:00Z`); const active = new Date(`${row.activityDay}T00:00:00Z`); const month = Math.max(0, (active.getUTCFullYear() - start.getUTCFullYear()) * 12 + active.getUTCMonth() - start.getUTCMonth()); const cohort = row.cohortDay.slice(0, 7); const current = groups.get(cohort) ?? []; const initial = rows.filter((item) => item.cohortDay === row.cohortDay).sort((a, b) => a.activityDay.localeCompare(b.activityDay))[0]?.customerCount ?? 0; current.push({ month, customers: row.customerCount, retention: initial ? row.customerCount / initial * 100 : 0 }); groups.set(cohort, current) } return [...groups].slice(-8).map(([cohort, periods]) => ({ cohort, periods: periods.slice(0, 7) })) }
function periodComparisons(snapshot: AnalyticsSnapshot): readonly ComparisonMetric[] { const revenue = [...snapshot.revenue].sort((a, b) => a.day.localeCompare(b.day)); const orders = [...snapshot.orders].sort((a, b) => a.day.localeCompare(b.day)); const split = <T,>(rows: readonly T[]) => [rows.slice(-30), rows.slice(-60, -30)] as const; const [revenueNow, revenueBefore] = split(revenue); const [ordersNow, ordersBefore] = split(orders); const metric = (name: string, current: number, previous: number): ComparisonMetric => ({ metric: name, current, previous, change: previous > 0 ? (current - previous) / previous * 100 : null }); return [metric('Revenue', revenueNow.reduce((s, r) => s + r.grossRevenue, 0), revenueBefore.reduce((s, r) => s + r.grossRevenue, 0)), metric('Orders', ordersNow.reduce((s, r) => s + r.orderCount, 0), ordersBefore.reduce((s, r) => s + r.orderCount, 0))] }
function orderFunnel(orders: readonly OrderView[]) { const purchased = orders.filter((order) => order.status !== 'canceled').length; return { scopeAvailable: false, stages: [{ name: 'Visitors', value: null, dropoff: null }, { name: 'Product views', value: null, dropoff: null }, { name: 'Added to cart', value: null, dropoff: null }, { name: 'Checkout', value: null, dropoff: null }, { name: 'Purchased', value: purchased, dropoff: null }], message: 'Purchase completion is live. Visitor and cart stages require Shopify Analytics access.' } }
function growthOpportunities(snapshot: AnalyticsSnapshot, products: ReturnType<typeof rankProducts>, weekdays: ReturnType<typeof groupWeekdays>) { const opportunities: Array<{ title: string; evidence: string; action: string; tone: 'positive' | 'warning' | 'neutral' }> = []; const rising = products.find((product) => product.growth !== null && product.growth > 10); if (rising) opportunities.push({ title: `${rising.name} is gaining momentum`, evidence: `${rising.growth!.toFixed(0)}% growth between available halves`, action: 'Review inventory cover and consider featuring it.', tone: 'positive' }); const best = [...weekdays].sort((a, b) => b.revenue - a.revenue)[0]; if (best && best.revenue > 0) opportunities.push({ title: `${best.day} is your revenue leader`, evidence: `${best.day} generated the most revenue in synced history`, action: 'Test campaign timing before this demand peak.', tone: 'positive' }); const cancellations = snapshot.orders.reduce((sum, row) => sum + row.cancelledCount, 0); if (cancellations > 0) opportunities.push({ title: 'Recover avoidable cancellations', evidence: `${cancellations} cancellations in the available period`, action: 'Review affected orders and fulfillment friction.', tone: 'warning' }); return opportunities.slice(0, 3) }
function summary(snapshot: AnalyticsSnapshot, weekdays: ReturnType<typeof groupWeekdays>, products: ReturnType<typeof rankProducts>) { const revenue = snapshot.revenue.reduce((sum, row) => sum + row.grossRevenue, 0); const orders = snapshot.orders.reduce((sum, row) => sum + row.orderCount, 0); if (!orders && !revenue) return 'Your intelligence brief will activate as soon as the first synced sale arrives.'; const best = [...weekdays].sort((a, b) => b.revenue - a.revenue)[0]; const top = products[0]; return `${best?.revenue ? `${best.day} leads your weekly revenue pattern.` : 'A weekly pattern is still forming.'}${top ? ` ${top.name} is your top product by revenue.` : ''} Focus the next decision on the strongest verified signal while more history builds.` }
function aggregateFacts(snapshot: AnalyticsSnapshot) { const revenue = snapshot.revenue.reduce((sum, row) => sum + row.grossRevenue, 0); const orders = snapshot.orders.reduce((sum, row) => sum + row.orderCount, 0); return [{ key: 'total_revenue', label: 'Total revenue', value: revenue, source: 'analytics_revenue_daily' }, { key: 'total_orders', label: 'Total orders', value: orders, source: 'analytics_orders_daily' }, { key: 'sales_days', label: 'Sales days', value: snapshot.revenue.length, source: 'analytics_revenue_daily' }, { key: 'products_with_sales', label: 'Products with sales rows', value: new Set(snapshot.productSales.map((row) => row.productId)).size, source: 'analytics_product_sales_daily' }] }
