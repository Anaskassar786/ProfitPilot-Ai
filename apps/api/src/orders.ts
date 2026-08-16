import { randomUUID } from 'node:crypto'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import type { BillingRepository } from '@profitpilot/billing'
import { extractNumbers, planAtLeast, planDisplayName, validateLanguageResponse } from '@profitpilot/ai'
import type { AiGeneration, OpenRouterClient } from '@profitpilot/ai'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { AppError } from '@profitpilot/types'

export type OrderStatus = 'new' | 'completed' | 'canceled' | 'pending'
export type PaymentStatus = 'paid' | 'pending' | 'not_paid' | 'refunded' | 'partially_refunded' | 'unknown'
export type OrderInsightFeature =
  | 'top_selling_product'
  | 'cancellation_rate'
  | 'fulfillment_rate'
  | 'order_health_score'
  | 'peak_times'
  | 'repeat_customers'
  | 'ai_suggestion'
  | 'trend_comparisons'
  | 'anomaly_alerts'
  | 'auto_action_suggestions'
  | 'custom_ai_queries'

export type OrderLine = Readonly<{
  id: string | null
  productId: string | null
  variantId: string | null
  title: string | null
  variantTitle: string | null
  sku: string | null
  quantity: number
  price: number | null
  totalDiscount: number | null
}>

export type OrderAddress = Readonly<{
  firstName: string | null
  lastName: string | null
  company: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  zip: string | null
  country: string | null
  countryCode: string | null
  phone: string | null
}>

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

export type OrderFilters = Readonly<{
  query: string
  orderId: string
  customer: string
  phone: string
  product: string
  payment: PaymentStatus | ''
  status: OrderStatus | ''
  dateFrom: string
  dateTo: string
  sort: 'date' | 'price' | 'status'
  direction: 'asc' | 'desc'
  page: number
  limit: number
}>

export type OrdersPageResult = Readonly<{
  orders: readonly OrderView[]
  tabCounts: Readonly<{ all: number; new: number; completed: number; canceled: number; pending: number }>
  pagination: Readonly<{ page: number; limit: number; total: number; pages: number }>
}>

export type LockedOrderInsight = Readonly<{
  locked: true
  feature: OrderInsightFeature
  required_plan: 'growth' | 'commander'
}>

export type AvailableOrderInsight = Readonly<{
  feature: OrderInsightFeature
  name: string
  data: unknown
}>

export type OrderInsightsResult = Readonly<{
  plan: PlanTier
  planLabel: string
  planBadge: string
  orderCount: number
  sufficientData: boolean
  available: readonly AvailableOrderInsight[]
  locked: readonly LockedOrderInsight[]
  usage: Readonly<{ feature: 'orders_ai_insights_day'; used: number; limit: number | null; remaining: number | null; limitReached: boolean }>
  cached: boolean
}>

type RawOrderRow = QueryResultRow & { record_id: string; payload: unknown; synced_at: Date }

export interface OrderRepository {
  list(storeId: StoreId): Promise<readonly OrderView[]>
  get(storeId: StoreId, orderId: string): Promise<OrderView | null>
}

export class PostgresOrderRepository implements OrderRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public list(storeId: StoreId): Promise<readonly OrderView[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<RawOrderRow>(
        `SELECT record_id, payload, synced_at
         FROM sync_records
         WHERE store_id = $1 AND module = 'orders'
         ORDER BY COALESCE(payload->>'created_at', payload->>'processed_at', '') DESC, record_id DESC`,
        [storeId],
      )
      return result.rows.flatMap((row) => {
        try { return [normalizeOrder(row.record_id, row.payload, row.synced_at)] } catch { return [] }
      })
    })
  }

  public get(storeId: StoreId, orderId: string): Promise<OrderView | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<RawOrderRow>(
        `SELECT record_id, payload, synced_at
         FROM sync_records
         WHERE store_id = $1 AND module = 'orders' AND record_id = $2
         LIMIT 1`,
        [storeId, orderId],
      )
      const row = result.rows[0]
      return row ? normalizeOrder(row.record_id, row.payload, row.synced_at) : null
    })
  }
}

export interface OrderInsightAudit {
  locked(storeId: StoreId, feature: OrderInsightFeature, plan: PlanTier, requiredPlan: 'growth' | 'commander'): Promise<void>
}

export class PostgresOrderInsightAudit implements OrderInsightAudit {
  public constructor(private readonly executor: SqlExecutor) {}

  public locked(storeId: StoreId, feature: OrderInsightFeature, plan: PlanTier, requiredPlan: 'growth' | 'commander'): Promise<void> {
    return withTenantContext(this.executor, storeId, async (client) => {
      await client.query(
        `INSERT INTO billing_audit (shop_id, actor, event, payload)
         VALUES ($1, 'merchant', 'orders.insight.locked', $2::jsonb)`,
        [storeId, JSON.stringify({ feature, plan, requiredPlan })],
      )
    })
  }
}

export type DailyUsageResult = Readonly<{ allowed: boolean; used: number }>
export interface OrderInsightUsage {
  current(storeId: StoreId): Promise<number>
  consume(storeId: StoreId, limit: number | null): Promise<DailyUsageResult>
}

export class PostgresOrderInsightUsage implements OrderInsightUsage {
  public constructor(private readonly executor: SqlExecutor) {}

  public current(storeId: StoreId): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { used: string | number }>(
        `SELECT used FROM billing_usage
         WHERE shop_id = $1 AND feature = 'orders_ai_insights_day' AND period_start = CURRENT_DATE`,
        [storeId],
      )
      return Number(result.rows[0]?.used ?? 0)
    })
  }

  public consume(storeId: StoreId, limit: number | null): Promise<DailyUsageResult> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { used: string | number }>(
        `INSERT INTO billing_usage (shop_id, feature, period_start, used)
         VALUES ($1, 'orders_ai_insights_day', CURRENT_DATE, 1)
         ON CONFLICT (shop_id, feature, period_start)
         DO UPDATE SET used = billing_usage.used + 1
         WHERE $2::bigint IS NULL OR billing_usage.used < $2::bigint
         RETURNING used`,
        [storeId, limit],
      )
      const row = result.rows[0]
      if (row) return { allowed: true, used: Number(row.used) }
      const current = await client.query<QueryResultRow & { used: string | number }>(
        `SELECT used FROM billing_usage
         WHERE shop_id = $1 AND feature = 'orders_ai_insights_day' AND period_start = CURRENT_DATE`,
        [storeId],
      )
      return { allowed: false, used: Number(current.rows[0]?.used ?? 0) }
    })
  }
}

export class OrderInsightLockedError extends AppError {
  public constructor(feature: OrderInsightFeature, requiredPlan: 'growth' | 'commander') {
    super('FORBIDDEN', `Upgrade to ${planDisplayName(requiredPlan)} to unlock ${feature}`, 403, { locked: true, feature, required_plan: requiredPlan })
    this.name = 'OrderInsightLockedError'
  }
}

const INSIGHTS: readonly Readonly<{ feature: OrderInsightFeature; name: string; minimumPlan: PlanTier }>[] = [
  { feature: 'top_selling_product', name: 'Top Selling Product', minimumPlan: 'trial' },
  { feature: 'cancellation_rate', name: 'Cancellation Rate', minimumPlan: 'trial' },
  { feature: 'fulfillment_rate', name: 'Fulfillment Rate', minimumPlan: 'trial' },
  { feature: 'order_health_score', name: 'Order Health', minimumPlan: 'trial' },
  { feature: 'peak_times', name: 'Peak Order Times', minimumPlan: 'growth' },
  { feature: 'repeat_customers', name: 'Repeat Customers', minimumPlan: 'growth' },
  { feature: 'ai_suggestion', name: 'AI Suggestion', minimumPlan: 'growth' },
  { feature: 'trend_comparisons', name: 'Trend Comparisons', minimumPlan: 'growth' },
  { feature: 'anomaly_alerts', name: 'Anomaly Detection', minimumPlan: 'commander' },
  { feature: 'auto_action_suggestions', name: 'Auto-action Suggestions', minimumPlan: 'commander' },
  { feature: 'custom_ai_queries', name: 'Custom AI Queries', minimumPlan: 'commander' },
]

const AI_DAILY_LIMIT: Readonly<Record<PlanTier, number | null>> = { trial: 0, start: 0, growth: 20, commander: null }
const CACHE_TTL_MS = 5 * 60_000

type CachedInsights = Readonly<{ expiresAt: number; result: Omit<OrderInsightsResult, 'cached'> }>

export class OrderInsightsService {
  private readonly cache = new Map<string, CachedInsights>()

  public constructor(
    private readonly orders: OrderRepository,
    private readonly billing: Pick<BillingRepository, 'get'>,
    private readonly usage: OrderInsightUsage,
    private readonly audit: OrderInsightAudit,
    private readonly provider: Pick<OpenRouterClient, 'generate'>,
    private readonly recordGeneration: ((storeId: StoreId, generation: AiGeneration) => void) | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async get(storeId: StoreId, requestedFeature?: OrderInsightFeature, question?: string): Promise<OrderInsightsResult> {
    const account = await this.billing.get(storeId)
    const plan = account?.plan ?? 'trial'
    const selected = requestedFeature ? INSIGHTS.filter((definition) => definition.feature === requestedFeature) : INSIGHTS
    if (requestedFeature && selected.length === 0) throw new AppError('VALIDATION_ERROR', 'Unknown order insight feature', 400, { feature: requestedFeature })

    // Entitlement checks happen before raw orders are loaded or a calculation is run.
    const availableDefinitions = selected.filter((definition) => planAtLeast(plan, definition.minimumPlan))
    const lockedDefinitions = selected.filter((definition) => !planAtLeast(plan, definition.minimumPlan))
    const locked = lockedDefinitions.map((definition): LockedOrderInsight => ({ locked: true, feature: definition.feature, required_plan: requiredPlan(definition.minimumPlan) }))
    for (const item of locked) await this.audit.locked(storeId, item.feature, plan, item.required_plan)
    if (requestedFeature && locked[0]) throw new OrderInsightLockedError(locked[0].feature, locked[0].required_plan)

    const normalizedQuestion = question?.trim().slice(0, 500) ?? ''
    const cacheKey = `${storeId}:${plan}:${requestedFeature ?? 'all'}:${normalizedQuestion.toLowerCase()}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) return { ...cached.result, cached: true }

    const orderRows = await this.orders.list(storeId)
    const limit = AI_DAILY_LIMIT[plan]
    let used = await this.usage.current(storeId)
    const available: AvailableOrderInsight[] = []
    const context = createInsightContext(orderRows, this.now())

    for (const definition of availableDefinitions) {
      let data: unknown
      if (definition.feature === 'top_selling_product') data = topSellingProduct(orderRows)
      else if (definition.feature === 'cancellation_rate') data = cancellationRate(orderRows)
      else if (definition.feature === 'fulfillment_rate') data = fulfillmentRate(orderRows)
      else if (definition.feature === 'order_health_score') data = orderHealthScore(orderRows)
      else if (definition.feature === 'peak_times') data = context.sufficientData ? peakTimes(orderRows) : insufficientData()
      else if (definition.feature === 'repeat_customers') data = context.sufficientData ? repeatCustomers(orderRows) : insufficientData()
      else if (definition.feature === 'trend_comparisons') data = context.sufficientData ? trendComparison(orderRows, this.now()) : insufficientData()
      else if (definition.feature === 'anomaly_alerts') data = context.sufficientData ? anomalyAlerts(orderRows) : insufficientData()
      else if (definition.feature === 'auto_action_suggestions') data = context.sufficientData ? autoActionSuggestions(orderRows) : insufficientData()
      else if (definition.feature === 'custom_ai_queries' && !normalizedQuestion) data = { status: 'ready', answer: null }
      else {
        if (!context.sufficientData) data = insufficientData()
        else {
          const reservation = await this.usage.consume(storeId, limit)
          used = reservation.used
          if (!reservation.allowed) data = { status: 'limit_reached', message: 'Daily limit reached, upgrade or wait until tomorrow.' }
          else data = await this.generateSuggestion(storeId, orderRows, definition.feature === 'custom_ai_queries' ? normalizedQuestion : '')
        }
      }
      available.push({ feature: definition.feature, name: definition.name, data })
    }

    const result: Omit<OrderInsightsResult, 'cached'> = {
      plan,
      planLabel: planDisplayName(plan),
      planBadge: planBadge(plan),
      orderCount: orderRows.length,
      sufficientData: context.sufficientData,
      available,
      locked,
      usage: { feature: 'orders_ai_insights_day', used, limit, remaining: limit === null ? null : Math.max(0, limit - used), limitReached: limit !== null && used >= limit },
    }
    this.cache.set(cacheKey, { expiresAt: this.now() + CACHE_TTL_MS, result })
    return { ...result, cached: false }
  }

  private async generateSuggestion(storeId: StoreId, orders: readonly OrderView[], question: string): Promise<unknown> {
    const facts = groundedFacts(orders)
    const request = question
      ? `Answer this order-analysis question: ${question}`
      : 'Give one short, practical suggestion based on the strongest order pattern.'
    try {
      const generation = await this.provider.generate(
        'You are ProfitPilot order intelligence. Use only the supplied aggregate facts. Never mention or infer customer PII. Never invent a number, date, amount, cause, or action already completed. Keep the answer to one or two short sentences.',
        `${request}\n\nGrounded facts:\n${facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n')}\n\nUse only numeric values shown above. If evidence is weak, say more orders are needed.`,
        { maxTokens: 180 },
      )
      this.recordGeneration?.(storeId, generation)
      const text = validateLanguageResponse(generation.text, facts, 0)
      return { status: 'generated', text, model: generation.model }
    } catch {
      return { status: 'unavailable', message: 'AI suggestion is temporarily unavailable. Deterministic insights remain available.' }
    }
  }
}

export function deriveOrderStatus(input: Readonly<{ cancelledAt: string | null; fulfillmentStatus: string | null; financialStatus: string | null }>): OrderStatus {
  if (input.cancelledAt) return 'canceled'
  const fulfillment = input.fulfillmentStatus?.trim().toLowerCase() ?? ''
  if (fulfillment === 'fulfilled') return 'completed'
  if (fulfillment === 'partial' || pendingFinancialStatus(input.financialStatus)) return 'pending'
  return 'new'
}

export function normalizePaymentStatus(value: string | null): PaymentStatus {
  const status = value?.trim().toLowerCase() ?? ''
  if (status === 'paid') return 'paid'
  if (status === 'pending' || status === 'authorized' || status === 'partially_paid') return 'pending'
  if (status === 'unpaid' || status === 'voided') return 'not_paid'
  if (status === 'refunded') return 'refunded'
  if (status === 'partially_refunded') return 'partially_refunded'
  return 'unknown'
}

export function normalizeOrder(recordId: string, rawValue: unknown, syncedAt: Date): OrderView {
  const raw = unwrapLegacy(rawValue)
  const id = scalarString(raw.id) ?? recordId
  const customer = objectValue(raw.customer)
  const shippingAddress = normalizeAddress(raw.shipping_address)
  const billingAddress = normalizeAddress(raw.billing_address)
  const customerName = joinedName(customer) ?? addressName(shippingAddress) ?? addressName(billingAddress)
  const financialStatus = nullableString(raw.financial_status)
  const fulfillmentStatus = nullableString(raw.fulfillment_status)
  const cancelledAt = nullableString(raw.cancelled_at)
  const lineItems = arrayValue(raw.line_items).map(normalizeLine)
  const rawName = nullableString(raw.name)
  const rawNumber = scalarString(raw.order_number)
  const orderNumber = rawName ?? (rawNumber ? `#${rawNumber.replace(/^#/, '')}` : id)
  return {
    id,
    adminGraphqlApiId: nullableString(raw.admin_graphql_api_id),
    orderNumber,
    name: rawName,
    createdAt: isoDateTime(raw.created_at),
    updatedAt: isoDateTime(raw.updated_at),
    processedAt: isoDateTime(raw.processed_at),
    syncedAt: syncedAt.toISOString(),
    customer: {
      id: scalarString(customer?.id),
      name: customerName,
      email: nullableString(raw.email) ?? nullableString(customer?.email),
      phone: nullableString(raw.phone) ?? nullableString(customer?.phone) ?? shippingAddress?.phone ?? billingAddress?.phone ?? null,
    },
    lineItems,
    totalPrice: money(raw.current_total_price ?? raw.total_price),
    subtotalPrice: money(raw.current_subtotal_price ?? raw.subtotal_price),
    totalTax: money(raw.current_total_tax ?? raw.total_tax),
    shippingPrice: shippingMoney(raw),
    totalDiscounts: money(raw.current_total_discounts ?? raw.total_discounts),
    currency: currency(raw.currency ?? raw.presentment_currency),
    financialStatus,
    paymentStatus: normalizePaymentStatus(financialStatus),
    fulfillmentStatus,
    status: deriveOrderStatus({ cancelledAt, fulfillmentStatus, financialStatus }),
    cancelledAt,
    cancelReason: nullableString(raw.cancel_reason),
    shippingAddress,
    billingAddress,
    tags: tags(raw.tags),
    note: nullableString(raw.note),
  }
}

export function filterOrders(orders: readonly OrderView[], filters: OrderFilters): OrdersPageResult {
  const tabCounts = countStatuses(orders)
  const query = filters.query.trim().toLowerCase()
  const matches = orders.filter((order) => {
    if (query && !searchableOrder(order).some((value) => value.toLowerCase().includes(query))) return false
    if (!containsAny([order.id, order.orderNumber, order.name], filters.orderId)) return false
    if (!containsAny([order.customer.name, order.customer.email], filters.customer)) return false
    if (!containsAny([order.customer.phone, order.shippingAddress?.phone, order.billingAddress?.phone], filters.phone)) return false
    if (!containsAny(order.lineItems.flatMap((line) => [line.title, line.variantTitle, line.sku, line.productId, line.variantId]), filters.product)) return false
    if (filters.payment && order.paymentStatus !== filters.payment) return false
    if (filters.status && order.status !== filters.status) return false
    const day = order.createdAt?.slice(0, 10) ?? ''
    if (filters.dateFrom && (!day || day < filters.dateFrom)) return false
    if (filters.dateTo && (!day || day > filters.dateTo)) return false
    return true
  })
  const sorted = [...matches].sort((left, right) => compareOrders(left, right, filters.sort, filters.direction))
  const page = Math.min(filters.page, Math.max(1, Math.ceil(sorted.length / filters.limit)))
  const start = (page - 1) * filters.limit
  return {
    orders: sorted.slice(start, start + filters.limit),
    tabCounts,
    pagination: { page, limit: filters.limit, total: sorted.length, pages: Math.max(1, Math.ceil(sorted.length / filters.limit)) },
  }
}

export function parseOrderFilters(query: Readonly<Record<string, unknown>>): OrderFilters {
  return {
    query: bounded(query.q, 200),
    orderId: bounded(query.orderId, 100),
    customer: bounded(query.customer, 200),
    phone: bounded(query.phone, 80),
    product: bounded(query.product, 200),
    payment: isPaymentStatus(query.payment) ? query.payment : '',
    status: isOrderStatus(query.status) ? query.status : '',
    dateFrom: isoDayQuery(query.dateFrom),
    dateTo: isoDayQuery(query.dateTo),
    sort: query.sort === 'price' || query.sort === 'status' ? query.sort : 'date',
    direction: query.direction === 'asc' ? 'asc' : 'desc',
    page: boundedInteger(query.page, 1, 100000, 1),
    limit: boundedInteger(query.limit, 1, 100, 20),
  }
}

export function isOrderInsightFeature(value: unknown): value is OrderInsightFeature {
  return typeof value === 'string' && INSIGHTS.some((definition) => definition.feature === value)
}

function countStatuses(orders: readonly OrderView[]) {
  const counts = { all: orders.length, new: 0, completed: 0, canceled: 0, pending: 0 }
  for (const order of orders) counts[order.status] += 1
  return counts
}

function topSellingProduct(orders: readonly OrderView[]): unknown {
  const products = new Map<string, { productId: string | null; title: string | null; quantity: number; revenue: number; currency: string | null }>()
  for (const order of orders) {
    if (order.status === 'canceled' || order.paymentStatus === 'refunded' || order.paymentStatus === 'not_paid') continue
    for (const line of order.lineItems) {
      const key = line.productId ?? `${line.title ?? 'custom'}:${line.variantTitle ?? ''}`
      const current = products.get(key) ?? { productId: line.productId, title: line.title, quantity: 0, revenue: 0, currency: order.currency }
      products.set(key, { ...current, quantity: current.quantity + line.quantity, revenue: round(current.revenue + (line.price ?? 0) * line.quantity) })
    }
  }
  const top = [...products.values()].sort((left, right) => right.quantity - left.quantity || right.revenue - left.revenue)[0]
  return top ? { status: 'available', ...top } : { status: 'unavailable', message: 'No completed product sales are available yet.' }
}

function cancellationRate(orders: readonly OrderView[]): unknown {
  const canceled = orders.filter((order) => order.status === 'canceled').length
  return { status: orders.length ? 'available' : 'unavailable', canceled, total: orders.length, rate: percentage(canceled, orders.length) }
}

function fulfillmentRate(orders: readonly OrderView[]): unknown {
  const fulfilled = orders.filter((order) => order.status === 'completed').length
  return { status: orders.length ? 'available' : 'unavailable', fulfilled, total: orders.length, rate: percentage(fulfilled, orders.length), basis: 'Shopify fulfillment status' }
}

function orderHealthScore(orders: readonly OrderView[]): unknown {
  if (orders.length < 2) return { status: 'insufficient_data', message: 'At least 2 real orders are needed for an accurate health score.' }
  const total = orders.length
  const canceled = orders.filter((order) => order.status === 'canceled').length
  const fulfilled = orders.filter((order) => order.status === 'completed').length
  const paid = orders.filter((order) => order.paymentStatus === 'paid').length
  const cancellationRate = total > 0 ? canceled / total : 0
  const unfulfilledRate = total > 0 ? (total - fulfilled) / total : 0
  const unpaidRate = total > 0 ? (total - paid) / total : 0
  const score = Math.max(0, Math.min(100, Math.round(100 - 30 * cancellationRate - 20 * unfulfilledRate - 10 * unpaidRate)))
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 50 ? 'C' : 'D'
  const tone = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical'
  return {
    status: 'available',
    score,
    grade,
    tone,
    fulfilledRate: Math.round((fulfilled / total) * 100),
    cancelledRate: Math.round(cancellationRate * 100),
    paidRate: Math.round((paid / total) * 100),
    basis: 'Real Shopify orders',
  }
}

function peakTimes(orders: readonly OrderView[]): unknown {
  const hours = new Map<number, number>()
  const weekdays = new Map<string, number>()
  for (const order of orders) {
    if (!order.createdAt) continue
    const local = /^(\d{4}-\d{2}-\d{2})T(\d{2})/.exec(order.createdAt)
    if (!local?.[1] || !local[2]) continue
    const hour = Number(local[2])
    const calendarDate = new Date(`${local[1]}T12:00:00Z`)
    if (!Number.isInteger(hour) || !Number.isFinite(calendarDate.valueOf())) continue
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(calendarDate)
    hours.set(hour, (hours.get(hour) ?? 0) + 1)
    weekdays.set(day, (weekdays.get(day) ?? 0) + 1)
  }
  const peakHour = [...hours.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]
  const peakDay = [...weekdays.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]
  return peakHour && peakDay ? { status: 'available', day: peakDay[0], hour: peakHour[0], hourLabel: hourLabel(peakHour[0]), ordersAtPeakHour: peakHour[1], ordersOnPeakDay: peakDay[1] } : insufficientData()
}

function repeatCustomers(orders: readonly OrderView[]): unknown {
  const counts = new Map<string, number>()
  let guestOrders = 0
  for (const order of orders) {
    if (!order.customer.id) { guestOrders += 1; continue }
    counts.set(order.customer.id, (counts.get(order.customer.id) ?? 0) + 1)
  }
  const repeat = [...counts.values()].filter((count) => count > 1).length
  const firstTime = [...counts.values()].filter((count) => count === 1).length
  return { status: 'available', repeatCustomers: repeat, newCustomers: firstTime, identifiedCustomers: counts.size, guestOrders, basis: 'Customers within synced order history' }
}

function trendComparison(orders: readonly OrderView[], now: number): unknown {
  const currentStart = now - 30 * 86_400_000
  const previousStart = now - 60 * 86_400_000
  const current = orders.filter((order) => timestamp(order.createdAt) >= currentStart).length
  const previous = orders.filter((order) => { const value = timestamp(order.createdAt); return value >= previousStart && value < currentStart }).length
  if (previous === 0) return { status: 'insufficient_data', currentOrders: current, previousOrders: previous, changePercent: null, message: 'A previous period is required for comparison.' }
  return { status: 'available', currentOrders: current, previousOrders: previous, changePercent: round(((current - previous) / previous) * 100) }
}

/** Internal daily order counts for anomaly detection (not a public insight feature). */
function dailyOrderPoints(orders: readonly OrderView[]): { points: readonly { day: string; orders: number }[] } {
  const counts = new Map<string, number>()
  for (const order of orders) {
    if (!order.createdAt) continue
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(order.createdAt)
    if (!match?.[1]) continue
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  const points = [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([day, orderCount]) => ({ day, orders: orderCount }))
  return { points }
}

function anomalyAlerts(orders: readonly OrderView[]): unknown {
  const trends = dailyOrderPoints(orders)
  const values = trends.points.map((point) => point.orders)
  if (orders.length < 14 || values.length < 7) return { status: 'insufficient_data', alerts: [], message: 'More order history is required for anomaly detection.' }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
  const alerts = trends.points.filter((point) => point.orders > mean + 2 * deviation).map((point) => ({ day: point.day, orders: point.orders, type: 'order_spike' }))
  return { status: 'available', alerts }
}

function autoActionSuggestions(orders: readonly OrderView[]): unknown {
  const cancellation = cancellationRate(orders) as { rate: number | null }
  const fulfillment = fulfillmentRate(orders) as { rate: number | null }
  const suggestions: string[] = []
  if ((cancellation.rate ?? 0) > 10) suggestions.push('Review cancellation reasons and affected products in Shopify.')
  if ((fulfillment.rate ?? 100) < 80) suggestions.push('Review unfulfilled and partially fulfilled orders in Shopify.')
  return { status: 'available', suggestions, execution: 'manual_review_only' }
}

function groundedFacts(orders: readonly OrderView[]) {
  const canceled = orders.filter((order) => order.status === 'canceled').length
  const fulfilled = orders.filter((order) => order.status === 'completed').length
  const top = topSellingProduct(orders) as { quantity?: number; revenue?: number }
  const repeats = repeatCustomers(orders) as { repeatCustomers?: number; newCustomers?: number }
  return [
    { key: 'orders', label: 'Total orders', value: orders.length, source: 'sync_records.orders' },
    { key: 'cancelled', label: 'Canceled orders', value: canceled, source: 'sync_records.orders.cancelled_at' },
    { key: 'cancellation_rate', label: 'Cancellation rate percent', value: percentage(canceled, orders.length) ?? 0, source: 'calculated' },
    { key: 'fulfilled', label: 'Fulfilled orders', value: fulfilled, source: 'sync_records.orders.fulfillment_status' },
    { key: 'fulfillment_rate', label: 'Fulfillment rate percent', value: percentage(fulfilled, orders.length) ?? 0, source: 'calculated' },
    { key: 'top_units', label: 'Top product units', value: top.quantity ?? 0, source: 'sync_records.orders.line_items' },
    { key: 'top_revenue', label: 'Top product gross revenue', value: top.revenue ?? 0, source: 'sync_records.orders.line_items' },
    { key: 'repeat_customers', label: 'Repeat customers', value: repeats.repeatCustomers ?? 0, source: 'calculated' },
    { key: 'new_customers', label: 'New customers', value: repeats.newCustomers ?? 0, source: 'calculated' },
  ]
}

function createInsightContext(orders: readonly OrderView[], _now: number) { return { sufficientData: orders.length >= 5 } }
function insufficientData() { return { status: 'insufficient_data', minimumOrders: 5, message: 'Insights available after more orders.' } }
function requiredPlan(plan: PlanTier): 'growth' | 'commander' { return plan === 'commander' ? 'commander' : 'growth' }
function planBadge(plan: PlanTier): string { return plan === 'commander' ? 'Commander intelligence unlocked' : plan === 'growth' ? 'Growth insights unlocked' : 'Free insights' }
function pendingFinancialStatus(value: string | null): boolean { return normalizePaymentStatus(value) === 'pending' }
function percentage(count: number, total: number): number | null { return total > 0 ? round((count / total) * 100) : null }
function round(value: number): number { return Math.round(value * 100) / 100 }
function timestamp(value: string | null): number { const parsed = value ? Date.parse(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY }
function hourLabel(hour: number): string { const suffix = hour >= 12 ? 'PM' : 'AM'; const normalized = hour % 12 || 12; return `${normalized}:00 ${suffix}` }

function compareOrders(left: OrderView, right: OrderView, sort: OrderFilters['sort'], direction: OrderFilters['direction']): number {
  let value = 0
  if (sort === 'price') value = nullableCompare(left.totalPrice, right.totalPrice)
  else if (sort === 'status') value = left.status.localeCompare(right.status)
  else value = (left.createdAt ?? '').localeCompare(right.createdAt ?? '')
  return direction === 'asc' ? value : -value
}
function nullableCompare(left: number | null, right: number | null): number { if (left === null) return right === null ? 0 : -1; if (right === null) return 1; return left - right }
function containsAny(values: readonly (string | null | undefined)[], query: string): boolean { const normalized = query.trim().toLowerCase(); return !normalized || values.some((value) => value?.toLowerCase().includes(normalized)) }
function searchableOrder(order: OrderView): readonly string[] { return [order.id, order.orderNumber, order.name, order.customer.name, order.customer.email, order.customer.phone, ...order.lineItems.flatMap((line) => [line.title, line.variantTitle, line.sku])].filter((value): value is string => Boolean(value)) }

function normalizeLine(rawValue: unknown): OrderLine {
  const raw = objectValue(rawValue) ?? {}
  return { id: scalarString(raw.id), productId: scalarString(raw.product_id), variantId: scalarString(raw.variant_id), title: nullableString(raw.title ?? raw.name), variantTitle: nullableString(raw.variant_title), sku: nullableString(raw.sku), quantity: nonNegativeInteger(raw.quantity), price: money(raw.price), totalDiscount: money(raw.total_discount) }
}
function normalizeAddress(value: unknown): OrderAddress | null {
  const raw = objectValue(value)
  if (!raw) return null
  return { firstName: nullableString(raw.first_name), lastName: nullableString(raw.last_name), company: nullableString(raw.company), address1: nullableString(raw.address1), address2: nullableString(raw.address2), city: nullableString(raw.city), province: nullableString(raw.province), zip: nullableString(raw.zip), country: nullableString(raw.country), countryCode: nullableString(raw.country_code), phone: nullableString(raw.phone) }
}
function shippingMoney(raw: Readonly<Record<string, unknown>>): number | null {
  const set = objectValue(raw.current_total_shipping_price_set ?? raw.total_shipping_price_set)
  const shopMoney = objectValue(set?.shop_money)
  const direct = money(shopMoney?.amount)
  if (direct !== null) return direct
  const values = arrayValue(raw.shipping_lines).map((line) => money(objectValue(line)?.discounted_price ?? objectValue(line)?.price)).filter((value): value is number => value !== null)
  return values.length ? round(values.reduce((sum, value) => sum + value, 0)) : null
}
function unwrapLegacy(value: unknown): Readonly<Record<string, unknown>> {
  const raw = objectValue(value)
  if (!raw) throw new RangeError('Order payload must be an object')
  if (typeof raw.payload !== 'string') return raw
  try { const parsed: unknown = JSON.parse(raw.payload); const order = objectValue(parsed); return order ? { ...order, id: order.id ?? raw.id } : raw } catch { return raw }
}
function objectValue(value: unknown): Readonly<Record<string, unknown>> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null }
function arrayValue(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function scalarString(value: unknown): string | null { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null }
function joinedName(value: Readonly<Record<string, unknown>> | null): string | null { if (!value) return null; const name = [nullableString(value.first_name), nullableString(value.last_name)].filter(Boolean).join(' ').trim(); return name || null }
function addressName(value: OrderAddress | null): string | null { if (!value) return null; const name = [value.firstName, value.lastName].filter(Boolean).join(' ').trim(); return name || null }
function money(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null }
function nonNegativeInteger(value: unknown): number { const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN; return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0 }
function currency(value: unknown): string | null { const code = nullableString(value)?.toUpperCase() ?? ''; return /^[A-Z]{3}$/.test(code) ? code : null }
function isoDateTime(value: unknown): string | null { const text = nullableString(value); return text && Number.isFinite(Date.parse(text)) ? text : null }
function tags(value: unknown): readonly string[] { if (Array.isArray(value)) return value.flatMap((item) => nullableString(item) ? [String(item).trim()] : []); const text = nullableString(value); return text ? text.split(',').map((tag) => tag.trim()).filter(Boolean) : [] }
function bounded(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function boundedInteger(value: unknown, min: number, max: number, fallback: number): number { const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN; return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback }
function isoDayQuery(value: unknown): string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '' }
function isPaymentStatus(value: unknown): value is PaymentStatus { return value === 'paid' || value === 'pending' || value === 'not_paid' || value === 'refunded' || value === 'partially_refunded' || value === 'unknown' }
function isOrderStatus(value: unknown): value is OrderStatus { return value === 'new' || value === 'completed' || value === 'canceled' || value === 'pending' }

/** Used by tests to prove generated insight text cannot introduce unsupported figures. */
export function unsupportedInsightNumbers(text: string, orders: readonly OrderView[]): readonly number[] {
  const allowed = new Set(groundedFacts(orders).map((fact) => String(fact.value)))
  return extractNumbers(text).filter((value) => !allowed.has(String(value)))
}

export class InMemoryOrderInsightUsage implements OrderInsightUsage {
  private readonly used = new Map<string, number>()
  public async current(storeId: StoreId): Promise<number> { return this.used.get(storeId) ?? 0 }
  public async consume(storeId: StoreId, limit: number | null): Promise<DailyUsageResult> { const current = this.used.get(storeId) ?? 0; if (limit !== null && current >= limit) return { allowed: false, used: current }; const next = current + 1; this.used.set(storeId, next); return { allowed: true, used: next } }
}

export class InMemoryOrderInsightAudit implements OrderInsightAudit {
  public readonly entries: Array<Readonly<{ storeId: StoreId; feature: OrderInsightFeature; plan: PlanTier; requiredPlan: 'growth' | 'commander'; id: string }>> = []
  public async locked(storeId: StoreId, feature: OrderInsightFeature, plan: PlanTier, requiredPlan: 'growth' | 'commander'): Promise<void> { this.entries.push({ storeId, feature, plan, requiredPlan, id: randomUUID() }) }
}
