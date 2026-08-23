export type SectionId =
  | 'dashboard'
  | 'products'
  | 'orders'
  | 'customers'
  | 'inventory'
  | 'analytics'
  | 'command-center'
  | 'ai-growth-command'
  | 'store-coach'
  | 'ai-executive'
  | 'recommendations'
  | 'automation'
  | 'patternai'
  | 'campaigns'
  | 'copilot'
  | 'ai-command'
  | 'jarvis'
  | 'reports'
  | 'exports'
  | 'support'
  | 'billing'
  | 'settings'
  | 'admin-ops'
  | 'qa-board'

export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[]
export interface JsonObject { readonly [key: string]: JsonValue }

export type RevenueMetric = Readonly<{ storeId: string; day: string; grossRevenue: number; discounts: number; orderCount: number }>
export type OrdersMetric = Readonly<{ storeId: string; day: string; orderCount: number; fulfilledCount: number; cancelledCount: number; averageOrderValue: number }>
export type ProductSalesMetric = Readonly<{ storeId: string; day: string; productId: string; unitsSold: number; grossRevenue: number }>
export type CustomerCohortMetric = Readonly<{ storeId: string; cohortDay: string; activityDay: string; customerCount: number; grossRevenue: number }>
export type AnalyticsSnapshot = Readonly<{ revenue: readonly RevenueMetric[]; orders: readonly OrdersMetric[]; productSales: readonly ProductSalesMetric[]; customerCohorts: readonly CustomerCohortMetric[] }>
export type CatalogProduct = Readonly<{ storeId: string; productId: string; payload: JsonObject; syncedAt: number }>
export type AgentStatus = Readonly<{ id: string; label: string; promptVersion: string; enabled: boolean; execution: 'READY' | 'UNCONFIGURED' | 'RUNNING' | 'PAUSED'; languageOnly: true }>
export type BillingPlan = Readonly<{ code: 'START' | 'GROWTH' | 'COMMANDER'; tier: 'start' | 'growth' | 'commander'; monthlyPrice: number; annualPrice: number; annualMonthsFree: number; recommended?: boolean; headline?: string; storeLimit?: number | null; features?: readonly string[]; limits: Readonly<Record<string, number | null>> }>
export type BillingAccount = Readonly<{ subscription: Readonly<{ storeId?: string; plan: string; state: string; currentPeriodEnd: number | null; version: number }> | null; trial: Readonly<{ expiresAt: number; state: string; startedAt?: number }> | null; gift: Readonly<{ code: string; expiresAt: number }> | null; trialDays?: number }>
export type RevenuePoint = Readonly<{ day: string; value: number }>
export type StoreHealthView = Readonly<{ score: number | null; grade: string; label: string; tone: 'healthy' | 'warning' | 'critical' | 'muted' }>
export type ChartPeriod = '7d' | '30d' | '90d' | 'all'
export type UsageMeter = Readonly<{ feature: string; used: number; limit: number | null }>
export type RoiMetrics = Readonly<{ attributedRevenue: number; aiCostDollars: number; netReturn: number; multiple: number | null }>
export type Recommendation = Readonly<{ id: string; storeId: string; agent: string; ruleId: string; title: string; reason: string; impactValue: number; impactLabel: string; currency: string; confidence: number; confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW'; actionType: string; actionRisk: 'SAFE' | 'APPROVAL_REQUIRED' | 'MANUAL_ONLY'; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED'; evidencePack: JsonObject; explanation: string | null; explanationStatus: 'AI_GENERATED' | 'AI_UNAVAILABLE' | 'AI_REJECTED'; model: string | null; version: number; createdAt: string; entityKey?: string | null; expiresAt?: string | null; decidedAt?: string | null; decidedBy?: string | null; rejectReason?: string | null; snoozedUntil?: string | null }>

export type ApiMeta = Readonly<{ requestId: string; timestamp: string }>
export type ApiSuccess<Value> = Readonly<{ ok: true; data: Value; meta: ApiMeta }>
export type ApiFailure = Readonly<{ ok: false; error: Readonly<{ code: string; message: string; details?: Readonly<Record<string, JsonValue>> }>; meta?: ApiMeta }>
export type ApiEnvelope<Value> = ApiSuccess<Value> | ApiFailure

export type WorkspaceContext = Readonly<{ storeId: string | null; shop: string | null; installed?: boolean }>

export function workspaceContext(search: string): WorkspaceContext {
  const params = new URLSearchParams(search)
  return { storeId: nonEmpty(params.get('storeId')), shop: nonEmpty(params.get('shop')) }
}

export function formatMoney(value: number | null, currency = 'USD'): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

export function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export function catalogProductTitle(product: CatalogProduct): string {
  const title = product.payload.title
  return typeof title === 'string' && title.trim() ? title : product.productId
}

export function sumRevenue(snapshot: AnalyticsSnapshot | null): number | null {
  if (!snapshot || snapshot.revenue.length === 0) return null
  return snapshot.revenue.reduce((total, row) => total + row.grossRevenue, 0)
}

export function sumOrders(snapshot: AnalyticsSnapshot | null): number | null {
  if (!snapshot || snapshot.orders.length === 0) return null
  return snapshot.orders.reduce((total, row) => total + row.orderCount, 0)
}

export function averageOrderValue(snapshot: AnalyticsSnapshot | null): number | null {
  if (!snapshot || snapshot.orders.length === 0) return null
  const orders = sumOrders(snapshot)
  if (!orders) return null
  const revenue = sumRevenue(snapshot)
  return revenue === null ? null : revenue / orders
}

export function revenueSeries(snapshot: AnalyticsSnapshot | null): readonly number[] {
  return revenuePoints(snapshot, 'all').map((point) => point.value)
}

export function revenuePoints(snapshot: AnalyticsSnapshot | null, period: ChartPeriod = 'all'): readonly RevenuePoint[] {
  if (!snapshot) return []
  const cutoff = periodCutoff(period)
  return [...snapshot.revenue]
    .filter((row) => !cutoff || row.day >= cutoff)
    .sort((left, right) => left.day.localeCompare(right.day))
    .map((row) => ({ day: row.day, value: row.grossRevenue }))
}

/**
 * Store health / Performance Score.
 *
 * Recency-aware: a store's score is driven by activity in the last 7 and 30
 * days, never by all-time totals alone. A store with zero sales in the last
 * 7 days can NEVER score above 50 (and above 30 when the last 30 days are
 * also empty) — "no recent data" is treated as a problem, not as perfection.
 */
export function storeHealthView(snapshot: AnalyticsSnapshot | null, catalogCount = 0, nowMs: number = Date.now()): StoreHealthView {
  if (!snapshot || (snapshot.revenue.length === 0 && snapshot.orders.length === 0)) {
    return { score: null, grade: '—', label: 'No data', tone: 'muted' }
  }
  const day7 = new Date(nowMs - 7 * 86_400_000).toISOString().slice(0, 10)
  const day30 = new Date(nowMs - 30 * 86_400_000).toISOString().slice(0, 10)
  const revenue7 = snapshot.revenue.reduce((total, row) => total + (row.day >= day7 ? row.grossRevenue : 0), 0)
  const orders7 = snapshot.orders.reduce((total, row) => total + (row.day >= day7 ? row.orderCount : 0), 0)
  const revenue30 = snapshot.revenue.reduce((total, row) => total + (row.day >= day30 ? row.grossRevenue : 0), 0)
  const orders30 = snapshot.orders.reduce((total, row) => total + (row.day >= day30 ? row.orderCount : 0), 0)

  let score = 20 // has synced analytics rows at all
  if (revenue7 > 0) score += 25
  if (orders7 > 0) score += 20
  if (revenue30 > 0) score += 10
  if (orders30 > 0) score += 5
  if (snapshot.productSales.length > 0 || catalogCount > 0) score += 10
  if (snapshot.customerCohorts.length > 0) score += 10

  // Data-freshness caps: no orders AND no revenue in the last 7 days is never
  // "Healthy"; a fully stale 30-day window is Critical.
  const stale7 = orders7 === 0 && revenue7 === 0
  const stale30 = orders30 === 0 && revenue30 === 0
  if (stale30) score = Math.min(score, 30)
  else if (stale7) score = Math.min(score, 45)

  score = Math.min(100, score)
  const tone = score >= 75 ? 'healthy' : score >= 45 ? 'warning' : 'critical'
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D'
  return { score, grade, label: tone === 'healthy' ? 'Healthy' : tone === 'warning' ? 'Needs attention' : 'Critical', tone }
}

function periodCutoff(period: ChartPeriod): string | null {
  if (period === 'all') return null
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

export function latestSyncLabel(snapshot: AnalyticsSnapshot | null): string {
  if (!snapshot || (snapshot.revenue.length === 0 && snapshot.orders.length === 0)) return 'No analytics sync yet'
  return 'Live data from analytics tables'
}

function nonEmpty(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

/**
 * Format a Shopify shop domain into a human-friendly display name.
 * e.g. "anas-apparel.myshopify.com" => "Anas Apparel"
 * The name resolves purely from the workspace shop domain — no demo-store
 * special cases are hardcoded.
 */
export function formatStoreDisplayName(domain: string | null): string | null {
  if (!domain) return null
  const trimmed = domain.trim().toLowerCase()
  if (!trimmed) return null
  // Strip .myshopify.com suffix
  const withoutSuffix = trimmed.replace(/\.myshopify\.com$/, '')
  if (!withoutSuffix) return null
  // Replace hyphens/underscores with spaces, split, Title Case each word
  const words = withoutSuffix.split(/[-_]+/).filter(Boolean)
  if (words.length === 0) return null
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}
