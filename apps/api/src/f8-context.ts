import type { AnalyticsRepository, CatalogProduct } from '@profitpilot/db'
import type { Recommendation, RecommendationRepository } from '@profitpilot/ai'
import type { CopilotEvidence, CopilotEvidenceProvider, CopilotIntent, CopilotFact, JarvisActionPlan, JarvisEvidence, JarvisEvidenceProvider, JarvisPage } from '@profitpilot/ai'
import type { StoreId } from '@profitpilot/types'

export type F8ContextDependencies = Readonly<{ analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>; recommendations: Pick<RecommendationRepository, 'list'>; usage?: (storeId: string) => Promise<readonly Readonly<{ feature: string; used: number; limit: number | null }>[]> }>

type RevenueRows = readonly Readonly<{ day: string; grossRevenue: number }>[]
type OrderRows = readonly Readonly<{ day: string; orderCount: number }>[]
type CohortRows = readonly Readonly<{ cohortDay: string; activityDay: string; customerCount: number }>[]

export class F8ContextProvider implements JarvisEvidenceProvider, CopilotEvidenceProvider {
  private readonly dependencies: F8ContextDependencies
  private readonly now: () => number
  public constructor(dependencies: F8ContextDependencies, now: () => number = () => Date.now()) { this.dependencies = dependencies; this.now = now }

  public async get(storeId: StoreId, page: JarvisPage): Promise<JarvisEvidence>
  public async get(storeId: StoreId, intent: CopilotIntent, page: JarvisPage): Promise<CopilotEvidence>
  public async get(storeId: StoreId, selector: JarvisPage | CopilotIntent, maybePage?: JarvisPage): Promise<JarvisEvidence | CopilotEvidence> {
    const page = maybePage ?? selector as JarvisPage
    const context = await this.facts(storeId, page)
    const confidence = context.facts.length > 0 ? .9 : .35
    const base = { page, generatedAt: new Date(this.now()).toISOString(), facts: context.facts, confidence, confidenceLevel: confidence >= .9 ? 'HIGH' as const : confidence >= .6 ? 'MEDIUM' as const : 'LOW' as const }
    if (maybePage !== undefined) return { intent: selector as CopilotIntent, ...base }
    return { ...base, currency: context.currency, suggestedAction: await this.suggestedAction(storeId) }
  }

  public async factsForIntent(storeId: StoreId, intent: CopilotIntent, page: JarvisPage): Promise<CopilotEvidence> { return this.get(storeId, intent, page) }

  private async facts(storeId: StoreId, page: JarvisPage): Promise<Readonly<{ facts: readonly CopilotFact[]; currency: string }>> {
    const [analytics, catalog, recommendations] = await Promise.all([this.dependencies.analytics.read(storeId), this.dependencies.analytics.readCatalog(storeId), this.dependencies.recommendations.list(storeId)])
    // The store currency comes from the same Shopify store context the rest of
    // the app formats money with (the recommendation/store snapshot currency),
    // so Jarvis always matches the dashboard's symbol and rounding.
    const currency = storeCurrency(recommendations)
    const money = (value: number | null): string | null => value === null ? null : formatMoney(value, currency)
    const revenue = analytics.revenue.map((row) => row.grossRevenue)
    const orders = analytics.orders.map((row) => row.orderCount)
    const totalRevenue = sum(revenue)
    const totalOrders = sum(orders)
    const aov = totalRevenue !== null && totalOrders !== null && totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : null
    const newCustomers = newCustomerCount(analytics.customerCohorts)
    const health = storeHealth(totalRevenue, totalOrders, analytics.productSales.length, catalog.length, analytics.customerCohorts.length)
    const base: CopilotFact[] = [
      fact('data_freshness', 'Data freshness', analytics.revenue.length > 0 ? analytics.revenue.at(-1)?.day ?? null : null, 'analytics_revenue_daily'),
      fact('revenue_total', 'Revenue in available closed rows', totalRevenue, 'analytics_revenue_daily'),
      fact('revenue_display', 'Revenue shown on the dashboard', money(totalRevenue), 'store_analytics'),
      fact('orders_total', 'Orders in available closed rows', totalOrders, 'analytics_orders_daily'),
      fact('aov', 'Average order value', aov, 'analytics_orders_daily'),
      fact('aov_display', 'Average order value shown on the dashboard', money(aov), 'store_analytics'),
      fact('customer_count', 'New customers in closed cohort rows', newCustomers, 'analytics_customer_cohorts_daily'),
      fact('catalog_count', 'Catalog products', catalog.length, 'catalog_products'),
      fact('health_score', 'Store health score', health.score, 'store_health'),
      fact('health_label', 'Store health label', health.label, 'store_health'),
      fact('pending_recommendations', 'Pending recommendations', recommendations.filter((recommendation) => recommendation.status === 'PENDING').length, 'ai_recommendations'),
    ]
    const top = topRecommendationFact(recommendations, money)
    if (top) base.push(top)
    const recent = recentRevenueFact(analytics.revenue, analytics.orders, money, currency)
    if (recent) base.push(recent)
    const productSales = [...analytics.productSales].sort((a, b) => b.grossRevenue - a.grossRevenue)
    const topProduct = productSales[0]
    const inventoryRows = catalog.map(toInventoryRow).filter((row): row is InventoryRow => row !== null)
    if (page === 'products' || page === 'inventory') return { facts: [...base, fact('inventory_low_count', 'Products with seven or fewer days of cover', inventoryRows.filter((row) => row.cover !== null && row.cover <= 7).length, 'catalog_products'), ...(topProduct ? [fact('top_product_revenue', 'Top product revenue row', topProduct.grossRevenue, 'analytics_product_sales_daily'), fact('top_product_id', 'Top product', topProduct.productId, 'analytics_product_sales_daily')] : [])], currency }
    if (page === 'customers') return { facts: [...base, fact('churn_recommendations', 'Churn recommendations', countRule(recommendations, 'CHURN_RISK'), 'ai_recommendations'), fact('customer_recommendations', 'Customer recommendations', recommendations.filter((recommendation) => recommendation.agent === 'CUSTOMER_AGENT').length, 'ai_recommendations')], currency }
    if (page === 'orders') return { facts: [...base, fact('fulfilled_orders', 'Fulfilled order rows', sum(analytics.orders.map((row) => row.fulfilledCount)), 'analytics_orders_daily'), fact('cancelled_orders', 'Cancelled order rows', sum(analytics.orders.map((row) => row.cancelledCount)), 'analytics_orders_daily')], currency }
    if (page === 'campaigns') return { facts: [...base, fact('campaign_recommendations', 'Campaign recommendations', countRule(recommendations, 'CART_ABANDONMENT') + countRule(recommendations, 'CHURN_RISK'), 'ai_recommendations')], currency }
    if (page === 'billing' && this.dependencies.usage) { const usage = await this.dependencies.usage(storeId); return { facts: [...base, ...usage.slice(0, 5).map((meter) => fact(`usage_${meter.feature}`, meter.feature, meter.used, 'billing_usage')), ...usage.filter((meter) => meter.limit !== null).slice(0, 3).map((meter) => fact(`limit_${meter.feature}`, `${meter.feature} limit`, meter.limit, 'billing_usage'))], currency } }
    if (page === 'analytics') return { facts: [...base, fact('revenue_days', 'Closed revenue days', analytics.revenue.length, 'analytics_revenue_daily'), fact('product_sales_rows', 'Product sales rows', analytics.productSales.length, 'analytics_product_sales_daily')], currency }
    return { facts: [...base, fact('high_confidence_recommendations', 'High-confidence recommendations', recommendations.filter((recommendation) => recommendation.confidence >= .9).length, 'ai_recommendations')], currency }
  }

  private async suggestedAction(storeId: StoreId): Promise<JarvisActionPlan | null> {
    const recommendations = await this.dependencies.recommendations.list(storeId)
    const candidate = recommendations.find((recommendation) => recommendation.status === 'PENDING' && recommendation.actionRisk === 'APPROVAL_REQUIRED')
    if (!candidate) return null
    return { id: `recommendation:${candidate.id}`, recommendationId: candidate.id, actionType: candidate.actionType, label: candidate.title, risk: candidate.actionRisk, undoWindowSeconds: 120, requiresVoiceConfirmation: true }
  }
}

function fact(key: string, label: string, value: string | number | boolean | null, source: string): CopilotFact { return { key, label, value, source } }
function sum(values: readonly number[]): number | null { return values.length > 0 ? Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100 : null }
function countRule(recommendations: readonly Recommendation[], ruleId: string): number { return recommendations.filter((recommendation) => recommendation.ruleId === ruleId && recommendation.status === 'PENDING').length }
type InventoryRow = Readonly<{ cover: number | null }>
function toInventoryRow(product: CatalogProduct): InventoryRow | null { const inventory = numeric(product.payload.inventory); const velocity = numeric(product.payload.averageDailyUnits); if (inventory === null || velocity === null || velocity <= 0) return null; return { cover: inventory / velocity } }
function numeric(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }

/** Mirrors the dashboard's formatMoney so Jarvis quotes the exact same figures. */
function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

function storeCurrency(recommendations: readonly Recommendation[]): string {
  const found = recommendations.find((recommendation) => typeof recommendation.currency === 'string' && recommendation.currency.trim().length > 0)
  return found?.currency ?? 'USD'
}

function newCustomerCount(cohorts: CohortRows): number | null {
  const rows = cohorts.filter((row) => row.cohortDay === row.activityDay)
  return rows.length > 0 ? sum(rows.map((row) => row.customerCount)) : null
}

/** Mirrors the dashboard's storeHealthView so Jarvis and the UI agree. */
function storeHealth(revenue: number | null, orders: number | null, productSalesRows: number, catalogCount: number, cohortRows: number): Readonly<{ score: number | null; label: string }> {
  if (revenue === null && orders === null) return { score: null, label: 'No data' }
  let score = 35
  if ((revenue ?? 0) > 0) score += 25
  if ((orders ?? 0) > 0) score += 20
  if (productSalesRows > 0 || catalogCount > 0) score += 10
  if (cohortRows > 0) score += 10
  score = Math.min(100, score)
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D'
  const label = score >= 75 ? 'Healthy' : score >= 50 ? 'Needs attention' : 'Critical'
  return { score, label: `${grade} · ${label}` }
}

function topRecommendationFact(recommendations: readonly Recommendation[], money: (value: number | null) => string | null): CopilotFact | null {
  const pending = recommendations.filter((recommendation) => recommendation.status === 'PENDING').sort((left, right) => right.confidence - left.confidence)
  const top = pending[0]
  if (!top) return null
  return fact('top_recommendation', 'Top pending recommendation', `${top.title} — ${top.impactLabel}: ${money(top.impactValue)} (${top.confidenceLevel})`, 'ai_recommendations')
}

function recentRevenueFact(revenue: RevenueRows, orders: OrderRows, money: (value: number | null) => string | null, currency: string): CopilotFact | null {
  const orderByDay = new Map(orders.map((row) => [row.day, row.orderCount]))
  const days = [...revenue].sort((left, right) => left.day.localeCompare(right.day)).slice(-14)
  if (days.length === 0) return null
  const lines = days.map((row) => `${row.day.slice(5)}: ${money(row.grossRevenue)} · ${orderByDay.get(row.day) ?? 0} orders`)
  return fact('recent_revenue_days', `Revenue by closed day (${currency}, last ${days.length} days)`, lines.join(' | '), 'analytics_revenue_daily')
}
