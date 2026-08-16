export type OrderStatus = 'new' | 'completed' | 'canceled' | 'pending'
export type PaymentStatus = 'paid' | 'pending' | 'not_paid' | 'refunded' | 'partially_refunded' | 'unknown'
export type OrderInsightFeature = 'top_selling_product' | 'cancellation_rate' | 'fulfillment_rate' | 'order_health_score' | 'peak_times' | 'repeat_customers' | 'ai_suggestion' | 'trend_comparisons' | 'anomaly_alerts' | 'auto_action_suggestions' | 'custom_ai_queries'

export type OrderLine = Readonly<{ id: string | null; productId: string | null; variantId: string | null; title: string | null; variantTitle: string | null; sku: string | null; quantity: number; price: number | null; totalDiscount: number | null }>
export type OrderAddress = Readonly<{ firstName: string | null; lastName: string | null; company: string | null; address1: string | null; address2: string | null; city: string | null; province: string | null; zip: string | null; country: string | null; countryCode: string | null; phone: string | null }>
export type OrderView = Readonly<{
  id: string
  adminGraphqlApiId: string | null
  orderNumber: string
  name: string | null
  createdAt: string | null
  updatedAt: string | null
  processedAt: string | null
  syncedAt: string
  customer: Readonly<{ id: string | null; name: string | null; email: string | null; phone: string | null }>
  lineItems: readonly OrderLine[]
  totalPrice: number | null
  subtotalPrice: number | null
  totalTax: number | null
  shippingPrice: number | null
  totalDiscounts: number | null
  currency: string | null
  financialStatus: string | null
  paymentStatus: PaymentStatus
  fulfillmentStatus: string | null
  status: OrderStatus
  cancelledAt: string | null
  cancelReason: string | null
  shippingAddress: OrderAddress | null
  billingAddress: OrderAddress | null
  tags: readonly string[]
  note: string | null
}>

export type OrdersPageResult = Readonly<{
  orders: readonly OrderView[]
  tabCounts: Readonly<{ all: number; new: number; completed: number; canceled: number; pending: number }>
  pagination: Readonly<{ page: number; limit: number; total: number; pages: number }>
}>

export type AvailableOrderInsight = Readonly<{ feature: OrderInsightFeature; name: string; data: unknown }>
export type LockedOrderInsight = Readonly<{ locked: true; feature: OrderInsightFeature; required_plan: 'growth' | 'commander' }>
export type OrderInsightsResult = Readonly<{
  plan: 'trial' | 'start' | 'growth' | 'commander'
  planLabel: string
  planBadge: string
  orderCount: number
  sufficientData: boolean
  available: readonly AvailableOrderInsight[]
  locked: readonly LockedOrderInsight[]
  usage: Readonly<{ feature: 'orders_ai_insights_day'; used: number; limit: number | null; remaining: number | null; limitReached: boolean }>
  cached: boolean
}>

export type OrderQuery = Readonly<{
  q?: string
  orderId?: string
  customer?: string
  phone?: string
  product?: string
  payment?: PaymentStatus | ''
  status?: OrderStatus | ''
  dateFrom?: string
  dateTo?: string
  sort?: 'date' | 'price' | 'status'
  direction?: 'asc' | 'desc'
  page?: number
  limit?: number
}>

export function orderStatusLabel(status: OrderStatus): string {
  if (status === 'completed') return 'Completed'
  if (status === 'canceled') return 'Canceled'
  if (status === 'pending') return 'Pending'
  return 'New'
}

export function paymentStatusLabel(status: PaymentStatus): string {
  if (status === 'paid') return 'Paid'
  if (status === 'pending') return 'Pending'
  if (status === 'not_paid') return 'Not paid'
  if (status === 'refunded') return 'Refunded'
  if (status === 'partially_refunded') return 'Partially refunded'
  return 'Unknown'
}

export function insightByFeature(result: OrderInsightsResult | null, feature: OrderInsightFeature): AvailableOrderInsight | null {
  return result?.available.find((item) => item.feature === feature) ?? null
}

export function lockedInsightByFeature(result: OrderInsightsResult | null, feature: OrderInsightFeature): LockedOrderInsight | null {
  return result?.locked.find((item) => item.feature === feature) ?? null
}

export function initials(name: string | null): string | null {
  if (!name) return null
  const value = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
  return value || null
}

export function isInsightData(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
