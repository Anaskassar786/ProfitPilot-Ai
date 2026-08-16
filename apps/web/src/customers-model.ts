export type CustomerActivity = 'active' | 'inactive' | 'unknown'
export type CustomerSegment = 'vip' | 'churn_risk' | 'new_buyer'
export type CustomerMarketingState = 'subscribed' | 'not_subscribed' | 'pending' | 'unknown'
export type CustomerEmailVisibility = 'available' | 'empty' | 'hidden'
export type CustomerSegmentFilter = 'all' | 'inactive' | CustomerSegment
export type CustomerInsightFeature = 'premium_segments' | 'retention_suggestion' | 'purchase_patterns' | 'predicted_next_order' | 'predictive_ltv' | 'custom_ai_queries' | 'auto_retention_workflows'

export type CustomerCoverage = Readonly<{ ordersSyncCompleted: boolean; knownComplete90Days: boolean; cutoffDate: string | null; lastCompletedSyncAt: string | null; explanation: string }>
export type CustomerPurchasePattern = Readonly<{ status: 'available'; averageIntervalDays: number; intervals: number; basisOrders: number }> | Readonly<{ status: 'insufficient_data'; minimumOrders: 2 }>
export type CustomerPrediction = Readonly<{ status: 'available'; predictedNextOrderAt: string; averageIntervalDays: number; basisOrders: number }> | Readonly<{ status: 'insufficient_data'; minimumOrders: 3 }>
export type CustomerLtvPrediction = Readonly<{ status: 'available'; value: number; currency: string; horizonMonths: 12; averageOrderValue: number; averageIntervalDays: number; basisOrders: number; method: 'cadence_aov_heuristic' }> | Readonly<{ status: 'insufficient_data'; reason: 'minimum_orders' | 'mixed_or_missing_currency' | 'missing_order_value'; minimumOrders: 3 }>

export type CustomerSummary = Readonly<{
  id: string
  displayName: string
  hasRealName: boolean
  email: string | null
  emailVisibility: CustomerEmailVisibility
  marketingState: CustomerMarketingState
  canEmail: boolean
  emailDisabledReason: string | null
  phone: string | null
  createdAt: string | null
  lifetimeOrders: number
  totalSpent: number | null
  currency: string | null
  lastOrderAt: string | null
  activity: CustomerActivity
  segments: readonly CustomerSegment[]
  primarySegment: CustomerSegment | null
  purchasePattern: CustomerPurchasePattern | null
}>

export type CustomerAddress = Readonly<{ firstName: string | null; lastName: string | null; company: string | null; address1: string | null; address2: string | null; city: string | null; province: string | null; zip: string | null; country: string | null; countryCode: string | null; phone: string | null }>
export type CustomerOrderLine = Readonly<{ productId: string | null; title: string | null; variantTitle: string | null; sku: string | null; quantity: number; unitPrice: number | null }>
export type CustomerOrder = Readonly<{ id: string; orderNumber: string; createdAt: string; total: number | null; currency: string | null; lines: readonly CustomerOrderLine[] }>
export type CustomerDetail = Readonly<{
  id: string
  adminGraphqlApiId: string | null
  firstName: string | null
  lastName: string | null
  displayName: string
  hasRealName: boolean
  email: string | null
  emailVisibility: CustomerEmailVisibility
  marketingState: CustomerMarketingState
  canEmail: boolean
  emailDisabledReason: string | null
  phone: string | null
  createdAt: string | null
  updatedAt: string | null
  syncedAt: string
  lifetimeOrders: number
  totalSpent: number | null
  currency: string | null
  lastOrderId: string | null
  lastOrderName: string | null
  lastOrderAt: string | null
  activity: CustomerActivity
  tags: readonly string[]
  note: string | null
  addresses: readonly CustomerAddress[]
  defaultAddress: CustomerAddress | null
  orders: readonly CustomerOrder[]
  products: readonly Readonly<{ productId: string | null; title: string; quantity: number }>[]
  cumulativeValue: readonly Readonly<{ date: string; value: number; currency: string }>[]
  purchasePattern: CustomerPurchasePattern
  predictedNextOrder: CustomerPrediction
  predictiveLtv: CustomerLtvPrediction
  segments: readonly CustomerSegment[]
  primarySegment: CustomerSegment | null
  coverage: CustomerCoverage
}>

export type CustomerStats = Readonly<{ total: number; active: number; inactive: number; unknown: number; newCustomersLast30Days: number; topSpender: Readonly<{ customerId: string; displayName: string; value: number; currency: string | null }> | null }>
export type CustomersPageResult = Readonly<{
  plan: 'trial' | 'start' | 'growth' | 'commander'
  customers: readonly CustomerSummary[]
  stats: CustomerStats
  coverage: CustomerCoverage
  lockedFilters: readonly Readonly<{ locked: true; feature: 'premium_segments'; segment: CustomerSegment; required_plan: 'growth' }>[]
  pagination: Readonly<{ page: number; limit: number; total: number; pages: number }>
}>
export type CustomerQuery = Readonly<{ q?: string; segment?: CustomerSegmentFilter; sort?: 'name' | 'spent' | 'orders' | 'last_order' | 'created'; direction?: 'asc' | 'desc'; page?: number; limit?: number }>

export type CustomerInsightsResult = Readonly<{
  plan: CustomersPageResult['plan']
  planLabel: string
  customerCount: number
  available: readonly Readonly<{ feature: CustomerInsightFeature; name: string; data: unknown }>[]
  locked: readonly Readonly<{ locked: true; feature: CustomerInsightFeature; name: string; required_plan: 'growth' | 'commander' }>[]
  usage: Readonly<{ feature: 'customers_ai_insights_day'; used: number; limit: number | null; remaining: number | null; limitReached: boolean }>
  coverage: CustomerCoverage
  cached: boolean
}>

export function initialsForCustomer(customer: Pick<CustomerSummary, 'displayName' | 'hasRealName'>): string | null {
  if (!customer.hasRealName) return null
  const initials = customer.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
  return initials || null
}

export function customerAvatarColor(id: string): string {
  const colors = ['blue', 'purple', 'green', 'amber', 'cyan'] as const
  let hash = 0
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length] ?? 'blue'
}

export function primaryBehaviorLabel(segment: CustomerSegment | null): string | null {
  if (segment === 'churn_risk') return 'At Risk'
  if (segment === 'vip') return 'VIP'
  if (segment === 'new_buyer') return 'New Buyer'
  return null
}

export function customerEmailLabel(customer: Pick<CustomerSummary, 'email' | 'emailVisibility'>): string {
  if (customer.email) return customer.email
  return customer.emailVisibility === 'hidden' ? 'Email hidden' : '—'
}

export function customerMoney(value: number | null, currency: string | null): string {
  if (value === null) return '—'
  if (!currency) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value) } catch { return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} ${currency}` }
}

export function insightData(result: CustomerInsightsResult | null, feature: CustomerInsightFeature): Readonly<Record<string, unknown>> | null {
  const value = result?.available.find((item) => item.feature === feature)?.data
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null
}

export function lockedCustomerInsight(result: CustomerInsightsResult | null, feature: CustomerInsightFeature) { return result?.locked.find((item) => item.feature === feature) ?? null }
