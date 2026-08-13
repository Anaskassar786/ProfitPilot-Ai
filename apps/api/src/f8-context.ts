import type { AnalyticsRepository, CatalogProduct } from '@profitpilot/db'
import type { Recommendation, RecommendationRepository } from '@profitpilot/ai'
import type { CopilotEvidence, CopilotEvidenceProvider, CopilotIntent, CopilotFact, JarvisActionPlan, JarvisEvidence, JarvisEvidenceProvider, JarvisPage } from '@profitpilot/ai'
import type { StoreId } from '@profitpilot/types'

export type F8ContextDependencies = Readonly<{ analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>; recommendations: Pick<RecommendationRepository, 'list'>; usage?: (storeId: string) => Promise<readonly Readonly<{ feature: string; used: number; limit: number | null }>[]> }>

export class F8ContextProvider implements JarvisEvidenceProvider, CopilotEvidenceProvider {
  private readonly dependencies: F8ContextDependencies
  private readonly now: () => number
  public constructor(dependencies: F8ContextDependencies, now: () => number = () => Date.now()) { this.dependencies = dependencies; this.now = now }

  public async get(storeId: StoreId, page: JarvisPage): Promise<JarvisEvidence>
  public async get(storeId: StoreId, intent: CopilotIntent, page: JarvisPage): Promise<CopilotEvidence>
  public async get(storeId: StoreId, selector: JarvisPage | CopilotIntent, maybePage?: JarvisPage): Promise<JarvisEvidence | CopilotEvidence> {
    const page = maybePage ?? selector as JarvisPage
    const facts = await this.facts(storeId, page)
    const confidence = facts.length > 0 ? .9 : .35
    const base = { page, generatedAt: new Date(this.now()).toISOString(), facts, confidence, confidenceLevel: confidence >= .9 ? 'HIGH' as const : confidence >= .6 ? 'MEDIUM' as const : 'LOW' as const }
    if (maybePage !== undefined) return { intent: selector as CopilotIntent, ...base }
    return { ...base, suggestedAction: await this.suggestedAction(storeId) }
  }

  public async factsForIntent(storeId: StoreId, intent: CopilotIntent, page: JarvisPage): Promise<CopilotEvidence> { return this.get(storeId, intent, page) }

  private async facts(storeId: StoreId, page: JarvisPage): Promise<readonly CopilotFact[]> {
    const [analytics, catalog, recommendations] = await Promise.all([this.dependencies.analytics.read(storeId), this.dependencies.analytics.readCatalog(storeId), this.dependencies.recommendations.list(storeId)])
    const revenue = analytics.revenue.map((row) => row.grossRevenue)
    const orders = analytics.orders.map((row) => row.orderCount)
    const totalRevenue = sum(revenue)
    const totalOrders = sum(orders)
    const base: CopilotFact[] = [fact('data_freshness', 'Data freshness', analytics.revenue.length > 0 ? analytics.revenue.at(-1)?.day ?? null : null, 'analytics_revenue_daily'), fact('revenue_total', 'Revenue in available closed rows', totalRevenue, 'analytics_revenue_daily'), fact('orders_total', 'Orders in available closed rows', totalOrders, 'analytics_orders_daily')]
    const productSales = [...analytics.productSales].sort((a, b) => b.grossRevenue - a.grossRevenue)
    const top = productSales[0]
    const inventoryRows = catalog.map(toInventoryRow).filter((row): row is InventoryRow => row !== null)
    if (page === 'products' || page === 'inventory') return [...base, fact('catalog_count', 'Catalog products', catalog.length, 'catalog_products'), fact('inventory_low_count', 'Products with seven or fewer days of cover', inventoryRows.filter((row) => row.cover !== null && row.cover <= 7).length, 'catalog_products'), ...(top ? [fact('top_product_revenue', 'Top product revenue row', top.grossRevenue, 'analytics_product_sales_daily'), fact('top_product_id', 'Top product', top.productId, 'analytics_product_sales_daily')] : [])]
    if (page === 'customers') return [...base, fact('churn_recommendations', 'Churn recommendations', countRule(recommendations, 'CHURN_RISK'), 'ai_recommendations'), fact('customer_recommendations', 'Customer recommendations', recommendations.filter((recommendation) => recommendation.agent === 'CUSTOMER_AGENT').length, 'ai_recommendations')]
    if (page === 'orders') return [...base, fact('fulfilled_orders', 'Fulfilled order rows', sum(analytics.orders.map((row) => row.fulfilledCount)), 'analytics_orders_daily'), fact('cancelled_orders', 'Cancelled order rows', sum(analytics.orders.map((row) => row.cancelledCount)), 'analytics_orders_daily')]
    if (page === 'campaigns') return [...base, fact('campaign_recommendations', 'Campaign recommendations', countRule(recommendations, 'CART_ABANDONMENT') + countRule(recommendations, 'CHURN_RISK'), 'ai_recommendations')]
    if (page === 'billing' && this.dependencies.usage) { const usage = await this.dependencies.usage(storeId); return [...base, ...usage.slice(0, 5).map((meter) => fact(`usage_${meter.feature}`, meter.feature, meter.used, 'billing_usage')), ...usage.filter((meter) => meter.limit !== null).slice(0, 3).map((meter) => fact(`limit_${meter.feature}`, `${meter.feature} limit`, meter.limit, 'billing_usage'))] }
    if (page === 'analytics') return [...base, fact('revenue_days', 'Closed revenue days', analytics.revenue.length, 'analytics_revenue_daily'), fact('product_sales_rows', 'Product sales rows', analytics.productSales.length, 'analytics_product_sales_daily')]
    return [...base, fact('pending_recommendations', 'Pending recommendations', recommendations.filter((recommendation) => recommendation.status === 'PENDING').length, 'ai_recommendations'), fact('high_confidence_recommendations', 'High-confidence recommendations', recommendations.filter((recommendation) => recommendation.confidence >= .9).length, 'ai_recommendations')]
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
