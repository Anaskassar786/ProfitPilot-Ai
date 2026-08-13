export type SectionId =
  | 'dashboard'
  | 'products'
  | 'orders'
  | 'customers'
  | 'inventory'
  | 'analytics'
  | 'command-center'
  | 'recommendations'
  | 'automation'
  | 'campaigns'
  | 'copilot'
  | 'reports'
  | 'exports'
  | 'support'
  | 'billing'
  | 'settings'

export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[]
export interface JsonObject { readonly [key: string]: JsonValue }

export type RevenueMetric = Readonly<{ storeId: string; day: string; grossRevenue: number; discounts: number; orderCount: number }>
export type OrdersMetric = Readonly<{ storeId: string; day: string; orderCount: number; fulfilledCount: number; cancelledCount: number; averageOrderValue: number }>
export type ProductSalesMetric = Readonly<{ storeId: string; day: string; productId: string; unitsSold: number; grossRevenue: number }>
export type CustomerCohortMetric = Readonly<{ storeId: string; cohortDay: string; activityDay: string; customerCount: number; grossRevenue: number }>
export type AnalyticsSnapshot = Readonly<{ revenue: readonly RevenueMetric[]; orders: readonly OrdersMetric[]; productSales: readonly ProductSalesMetric[]; customerCohorts: readonly CustomerCohortMetric[] }>
export type CatalogProduct = Readonly<{ storeId: string; productId: string; payload: JsonObject; syncedAt: number }>

export type ApiMeta = Readonly<{ requestId: string; timestamp: string }>
export type ApiSuccess<Value> = Readonly<{ ok: true; data: Value; meta: ApiMeta }>
export type ApiFailure = Readonly<{ ok: false; error: Readonly<{ code: string; message: string; details?: Readonly<Record<string, JsonValue>> }>; meta?: ApiMeta }>
export type ApiEnvelope<Value> = ApiSuccess<Value> | ApiFailure

export type WorkspaceContext = Readonly<{ storeId: string | null; shop: string | null }>

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
  return snapshot ? [...snapshot.revenue].sort((left, right) => left.day.localeCompare(right.day)).map((row) => row.grossRevenue) : []
}

export function latestSyncLabel(snapshot: AnalyticsSnapshot | null): string {
  if (!snapshot || (snapshot.revenue.length === 0 && snapshot.orders.length === 0)) return 'No analytics sync yet'
  return 'Live data from analytics tables'
}

function nonEmpty(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}
