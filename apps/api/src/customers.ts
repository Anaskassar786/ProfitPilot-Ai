import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import type { StoreId } from '@profitpilot/types'

const DAY_MS = 86_400_000

export type CustomerActivity = 'active' | 'inactive' | 'unknown'
export type CustomerMarketingState = 'subscribed' | 'not_subscribed' | 'pending' | 'unknown'
export type CustomerEmailVisibility = 'available' | 'empty' | 'hidden'
export type CustomerSegment = 'vip' | 'churn_risk' | 'new_buyer'

export type CustomerAddress = Readonly<{
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

export type CustomerOrderLine = Readonly<{
  productId: string | null
  title: string | null
  variantTitle: string | null
  sku: string | null
  quantity: number
  unitPrice: number | null
}>

export type CustomerOrder = Readonly<{
  id: string
  orderNumber: string
  createdAt: string
  total: number | null
  currency: string | null
  lines: readonly CustomerOrderLine[]
}>

export type CustomerCoverage = Readonly<{
  ordersSyncCompleted: boolean
  knownComplete90Days: boolean
  cutoffDate: string | null
  lastCompletedSyncAt: string | null
  explanation: string
}>

export type CustomerPurchasePattern =
  | Readonly<{ status: 'available'; averageIntervalDays: number; intervals: number; basisOrders: number }>
  | Readonly<{ status: 'insufficient_data'; minimumOrders: 2 }>

export type CustomerPrediction =
  | Readonly<{ status: 'available'; predictedNextOrderAt: string; averageIntervalDays: number; basisOrders: number }>
  | Readonly<{ status: 'insufficient_data'; minimumOrders: 3 }>

export type CustomerLtvPrediction =
  | Readonly<{ status: 'available'; value: number; currency: string; horizonMonths: 12; averageOrderValue: number; averageIntervalDays: number; basisOrders: number; method: 'cadence_aov_heuristic' }>
  | Readonly<{ status: 'insufficient_data'; reason: 'minimum_orders' | 'mixed_or_missing_currency' | 'missing_order_value'; minimumOrders: 3 }>

export type CustomerView = Readonly<{
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

export type CustomerDataset = Readonly<{
  customers: readonly CustomerView[]
  coverage: CustomerCoverage
}>

export interface CustomerRepository {
  list(storeId: StoreId): Promise<CustomerDataset>
  get(storeId: StoreId, customerId: string): Promise<CustomerView | null>
}

type RawSyncRow = QueryResultRow & { record_id: string; payload: unknown; synced_at: Date }
type CheckpointRow = QueryResultRow & { cursor: string | null; updated_at: Date }

export class PostgresCustomerRepository implements CustomerRepository {
  public constructor(private readonly executor: SqlExecutor, private readonly now: () => number = () => Date.now()) {}

  public list(storeId: StoreId): Promise<CustomerDataset> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const [customerResult, orderResult, checkpointResult] = await Promise.all([
        client.query<RawSyncRow>(
          `SELECT record_id, payload, synced_at
           FROM sync_records
           WHERE store_id = $1 AND module = 'customers'
           ORDER BY COALESCE(payload->>'created_at', '') DESC, record_id DESC`,
          [storeId],
        ),
        client.query<RawSyncRow>(
          `SELECT record_id, payload, synced_at
           FROM sync_records
           WHERE store_id = $1 AND module = 'orders'
           ORDER BY COALESCE(payload->>'created_at', payload->>'processed_at', '') DESC, record_id DESC`,
          [storeId],
        ),
        client.query<CheckpointRow>(
          `SELECT cursor, updated_at
           FROM sync_checkpoints
           WHERE store_id = $1 AND module = 'orders'
           LIMIT 1`,
          [storeId],
        ),
      ])
      const rawOrders = orderResult.rows.flatMap((row) => normalizeJoinedOrder(row.record_id, row.payload))
      const coverage = deriveCustomerCoverage(rawOrders, checkpointResult.rows[0] ?? null, this.now())
      const ordersByCustomer = groupOrdersByCustomer(rawOrders)
      const normalized = customerResult.rows.flatMap((row) => {
        try { return [normalizeCustomer(row.record_id, row.payload, row.synced_at, ordersByCustomer.get(customerKey(row.record_id)) ?? [], coverage, this.now())] } catch { return [] }
      })
      return { customers: classifyCustomerSegments(normalized, coverage, this.now()), coverage }
    })
  }

  public async get(storeId: StoreId, customerId: string): Promise<CustomerView | null> {
    const dataset = await this.list(storeId)
    return dataset.customers.find((customer) => customer.id === customerId) ?? null
  }
}

type JoinedOrder = Readonly<CustomerOrder & { customerId: string; qualifies: boolean }>

export function normalizeCustomer(recordId: string, rawValue: unknown, syncedAt: Date, orders: readonly JoinedOrder[] = [], coverage: CustomerCoverage = unknownCoverage(), now = Date.now()): CustomerView {
  const raw = unwrapLegacy(rawValue, 'Customer')
  const id = scalarString(raw.id) ?? recordId
  const firstName = nullableString(raw.first_name ?? objectValue(raw.defaultEmailAddress)?.firstName)
  const lastName = nullableString(raw.last_name ?? objectValue(raw.defaultEmailAddress)?.lastName)
  const joined = [firstName, lastName].filter(Boolean).join(' ').trim()
  const hasRealName = joined.length > 0
  const emailResult = normalizeCustomerEmail(raw)
  const addresses = arrayValue(raw.addresses).map(normalizeCustomerAddress).filter((value): value is CustomerAddress => value !== null)
  const defaultAddress = normalizeCustomerAddress(raw.default_address ?? raw.defaultAddress)
  const qualifyingOrders = [...orders].filter((order) => order.qualifies).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const lastOrder = qualifyingOrders.at(-1) ?? null
  const activity = lastOrder && now - Date.parse(lastOrder.createdAt) <= 30 * DAY_MS ? 'active' : coverage.knownComplete90Days ? 'inactive' : 'unknown'
  const rawLifetimeOrders = nonNegativeIntegerOrNull(raw.orders_count ?? raw.numberOfOrders)
  const lifetimeOrders = rawLifetimeOrders ?? qualifyingOrders.length
  const amountSpent = objectValue(raw.amountSpent ?? raw.amount_spent)
  const totalSpent = money(raw.total_spent ?? amountSpent?.amount)
  const rawCurrency = currency(amountSpent?.currencyCode ?? amountSpent?.currency_code)
  const joinedCurrencies = uniqueCurrencies(qualifyingOrders)
  const derivedCurrency = joinedCurrencies.length === 1 ? joinedCurrencies[0] ?? null : null
  const prediction = predictNextOrder(qualifyingOrders)
  const pattern = purchasePattern(qualifyingOrders)
  const ltv = predictLtv12Months(qualifyingOrders)
  const currentOrder = objectValue(raw.lastOrder ?? raw.last_order)
  const lastOrderId = scalarString(raw.last_order_id ?? currentOrder?.id) ?? lastOrder?.id ?? null
  const lastOrderName = nullableString(raw.last_order_name ?? currentOrder?.name) ?? lastOrder?.orderNumber ?? null
  const products = productsFromOrders(qualifyingOrders)
  const cumulativeValue = cumulativeOrderValue(qualifyingOrders)
  const marketingState = emailResult.marketingState
  return {
    id,
    adminGraphqlApiId: nullableString(raw.admin_graphql_api_id),
    firstName,
    lastName,
    displayName: hasRealName ? joined : 'Guest customer',
    hasRealName,
    email: emailResult.email,
    emailVisibility: emailResult.visibility,
    marketingState,
    canEmail: emailResult.email !== null && marketingState === 'subscribed',
    emailDisabledReason: emailResult.email === null ? (emailResult.visibility === 'hidden' ? 'Email hidden by Shopify data access' : 'Customer has no email') : marketingState === 'subscribed' ? null : marketingState === 'not_subscribed' ? 'Customer opted out' : marketingState === 'pending' ? 'Marketing consent is pending' : 'Marketing consent is unavailable',
    phone: nullableString(raw.phone ?? objectValue(raw.defaultPhoneNumber)?.phoneNumber),
    createdAt: isoDateTime(raw.created_at ?? raw.createdAt),
    updatedAt: isoDateTime(raw.updated_at ?? raw.updatedAt),
    syncedAt: syncedAt.toISOString(),
    lifetimeOrders,
    totalSpent,
    currency: rawCurrency ?? derivedCurrency,
    lastOrderId,
    lastOrderName,
    lastOrderAt: lastOrder?.createdAt ?? null,
    activity,
    tags: normalizeTags(raw.tags),
    note: nullableString(raw.note),
    addresses,
    defaultAddress,
    orders: qualifyingOrders.map(({ customerId: _customerId, qualifies: _qualifies, ...order }) => order),
    products,
    cumulativeValue,
    purchasePattern: pattern,
    predictedNextOrder: prediction,
    predictiveLtv: ltv,
    segments: [],
    primarySegment: null,
    coverage,
  }
}

export function classifyCustomerSegments(customers: readonly CustomerView[], coverage: CustomerCoverage, now = Date.now()): readonly CustomerView[] {
  const eligible = customers.filter((customer) => customer.totalSpent !== null && customer.totalSpent > 0)
  const vipSlots = eligible.length === 0 ? 0 : Math.max(1, Math.ceil(eligible.length * 0.2))
  const vipIds = new Set([...eligible].sort((left, right) => (right.totalSpent ?? 0) - (left.totalSpent ?? 0) || left.id.localeCompare(right.id)).slice(0, vipSlots).map((customer) => customer.id))
  return customers.map((customer) => {
    const segments: CustomerSegment[] = []
    const last = customer.lastOrderAt ? Date.parse(customer.lastOrderAt) : Number.NEGATIVE_INFINITY
    if (coverage.knownComplete90Days && customer.lifetimeOrders >= 2 && last < now - 60 * DAY_MS) segments.push('churn_risk')
    if (vipIds.has(customer.id)) segments.push('vip')
    if (customer.lifetimeOrders === 1 && Number.isFinite(last) && last >= now - 30 * DAY_MS) segments.push('new_buyer')
    const primarySegment = segments.includes('churn_risk') ? 'churn_risk' : segments.includes('vip') ? 'vip' : segments.includes('new_buyer') ? 'new_buyer' : null
    return { ...customer, segments, primarySegment }
  })
}

export function purchasePattern(orders: readonly CustomerOrder[]): CustomerPurchasePattern {
  const intervals = orderIntervals(orders)
  if (intervals.length < 1) return { status: 'insufficient_data', minimumOrders: 2 }
  return { status: 'available', averageIntervalDays: round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length), intervals: intervals.length, basisOrders: intervals.length + 1 }
}

export function predictNextOrder(orders: readonly CustomerOrder[]): CustomerPrediction {
  const sorted = validDatedOrders(orders)
  const intervals = orderIntervals(sorted)
  if (sorted.length < 3 || intervals.length < 2) return { status: 'insufficient_data', minimumOrders: 3 }
  const averageIntervalDays = round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length)
  const last = sorted.at(-1)
  if (!last) return { status: 'insufficient_data', minimumOrders: 3 }
  return { status: 'available', predictedNextOrderAt: new Date(Date.parse(last.createdAt) + averageIntervalDays * DAY_MS).toISOString(), averageIntervalDays, basisOrders: sorted.length }
}

export function predictLtv12Months(orders: readonly CustomerOrder[]): CustomerLtvPrediction {
  const sorted = validDatedOrders(orders)
  const intervals = orderIntervals(sorted)
  if (sorted.length < 3 || intervals.length < 2) return { status: 'insufficient_data', reason: 'minimum_orders', minimumOrders: 3 }
  const currencies = uniqueCurrencies(sorted)
  if (currencies.length !== 1) return { status: 'insufficient_data', reason: 'mixed_or_missing_currency', minimumOrders: 3 }
  const values = sorted.map((order) => order.total)
  if (values.some((value) => value === null)) return { status: 'insufficient_data', reason: 'missing_order_value', minimumOrders: 3 }
  const averageOrderValue = round((values as readonly number[]).reduce((sum, value) => sum + value, 0) / values.length)
  const averageIntervalDays = round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length)
  if (averageIntervalDays <= 0) return { status: 'insufficient_data', reason: 'minimum_orders', minimumOrders: 3 }
  return { status: 'available', value: round(averageOrderValue * (365 / averageIntervalDays)), currency: currencies[0]!, horizonMonths: 12, averageOrderValue, averageIntervalDays, basisOrders: sorted.length, method: 'cadence_aov_heuristic' }
}

export function deriveCustomerCoverage(orders: readonly CustomerOrder[], checkpoint: Readonly<{ cursor: string | null; updated_at: Date }> | null, now = Date.now()): CustomerCoverage {
  const dates = validDatedOrders(orders).map((order) => Date.parse(order.createdAt))
  const earliest = dates.length > 0 ? Math.min(...dates) : null
  const ordersSyncCompleted = checkpoint !== null && checkpoint.cursor === null
  // A completed page walk proves the authorized result set was exhausted. It
  // proves a 90-day window only when an actual dated row reaches that boundary;
  // otherwise Shopify's normal 60-day order scope and a genuinely young store
  // are indistinguishable, so the status must remain Unknown.
  const knownComplete90Days = ordersSyncCompleted && earliest !== null && earliest <= now - 90 * DAY_MS
  const cutoffDate = earliest === null ? null : new Date(earliest).toISOString()
  return {
    ordersSyncCompleted,
    knownComplete90Days,
    cutoffDate,
    lastCompletedSyncAt: ordersSyncCompleted ? checkpoint.updated_at.toISOString() : null,
    explanation: knownComplete90Days
      ? `Synced order history reaches ${cutoffDate?.slice(0, 10) ?? 'the 90-day boundary'}.`
      : 'A complete 90-day order window cannot be proven from the currently authorized Shopify history. Inactive and churn classifications remain Unknown.',
  }
}

function normalizeJoinedOrder(recordId: string, rawValue: unknown): readonly JoinedOrder[] {
  try {
    const raw = unwrapLegacy(rawValue, 'Order')
    const customer = objectValue(raw.customer)
    const customerId = scalarString(customer?.id)
    const createdAt = isoDateTime(raw.created_at ?? raw.processed_at)
    if (!customerId || !createdAt) return []
    const financial = nullableString(raw.financial_status)?.toLowerCase() ?? ''
    const cancelled = isoDateTime(raw.cancelled_at) !== null
    const qualifies = !cancelled && financial !== 'refunded' && financial !== 'voided' && financial !== 'unpaid'
    const lines = arrayValue(raw.line_items).map((value): CustomerOrderLine => {
      const line = objectValue(value) ?? {}
      return { productId: scalarString(line.product_id), title: nullableString(line.title ?? line.name), variantTitle: nullableString(line.variant_title), sku: nullableString(line.sku), quantity: nonNegativeIntegerOrNull(line.quantity) ?? 0, unitPrice: money(line.price) }
    })
    const name = nullableString(raw.name)
    const number = scalarString(raw.order_number)
    return [{ customerId, qualifies, id: scalarString(raw.id) ?? recordId, orderNumber: name ?? (number ? `#${number.replace(/^#/, '')}` : recordId), createdAt, total: money(raw.current_total_price ?? raw.total_price), currency: currency(raw.currency ?? raw.presentment_currency), lines }]
  } catch { return [] }
}

function groupOrdersByCustomer(orders: readonly JoinedOrder[]): Map<string, JoinedOrder[]> {
  const result = new Map<string, JoinedOrder[]>()
  for (const order of orders) {
    const key = customerKey(order.customerId)
    const current = result.get(key) ?? []
    current.push(order)
    result.set(key, current)
  }
  return result
}

function normalizeCustomerEmail(raw: Readonly<Record<string, unknown>>): Readonly<{ email: string | null; visibility: CustomerEmailVisibility; marketingState: CustomerMarketingState }> {
  const graphEmail = objectValue(raw.defaultEmailAddress ?? raw.default_email_address)
  const hasEmailField = Object.hasOwn(raw, 'email') || graphEmail !== null
  const rawEmail = graphEmail?.emailAddress ?? graphEmail?.email ?? raw.email
  const email = nullableString(rawEmail)
  const visibility: CustomerEmailVisibility = email ? 'available' : hasEmailField && rawEmail === '' ? 'empty' : 'hidden'
  // The current consent object is authoritative whenever present, including an
  // unknown/null state. Legacy accepts_marketing is consulted only when the
  // current object is wholly absent.
  const restConsent = objectValue(raw.email_marketing_consent)
  const consentObjectPresent = restConsent !== null || graphEmail !== null
  const currentState = restConsent?.state ?? graphEmail?.marketingState ?? graphEmail?.marketing_state
  let marketingState = normalizeMarketingState(currentState)
  if (!consentObjectPresent && typeof raw.accepts_marketing === 'boolean') marketingState = raw.accepts_marketing ? 'subscribed' : 'not_subscribed'
  return { email, visibility, marketingState }
}

function normalizeMarketingState(value: unknown): CustomerMarketingState {
  const state = nullableString(value)?.toLowerCase()
  if (state === 'subscribed') return 'subscribed'
  if (state === 'not_subscribed' || state === 'unsubscribed') return 'not_subscribed'
  if (state === 'pending' || state === 'redacted') return 'pending'
  return 'unknown'
}

function normalizeCustomerAddress(value: unknown): CustomerAddress | null {
  const raw = objectValue(value)
  if (!raw) return null
  return { firstName: nullableString(raw.first_name ?? raw.firstName), lastName: nullableString(raw.last_name ?? raw.lastName), company: nullableString(raw.company), address1: nullableString(raw.address1), address2: nullableString(raw.address2), city: nullableString(raw.city), province: nullableString(raw.province), zip: nullableString(raw.zip), country: nullableString(raw.country), countryCode: nullableString(raw.country_code ?? raw.countryCode), phone: nullableString(raw.phone) }
}

function productsFromOrders(orders: readonly CustomerOrder[]) {
  const products = new Map<string, { productId: string | null; title: string; quantity: number }>()
  for (const order of orders) for (const line of order.lines) {
    if (!line.title && !line.productId) continue
    const key = line.productId ?? line.title ?? 'product'
    const current = products.get(key) ?? { productId: line.productId, title: line.title ?? 'Product details unavailable', quantity: 0 }
    products.set(key, { ...current, quantity: current.quantity + line.quantity })
  }
  return [...products.values()].sort((left, right) => right.quantity - left.quantity || left.title.localeCompare(right.title))
}

function cumulativeOrderValue(orders: readonly CustomerOrder[]) {
  const sorted = validDatedOrders(orders)
  const currencies = uniqueCurrencies(sorted)
  if (currencies.length !== 1 || sorted.some((order) => order.total === null)) return []
  let total = 0
  return sorted.map((order) => { total = round(total + (order.total ?? 0)); return { date: order.createdAt, value: total, currency: currencies[0]! } })
}

function orderIntervals(orders: readonly CustomerOrder[]): number[] {
  const sorted = validDatedOrders(orders)
  const intervals: number[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (!previous || !current) continue
    const days = (Date.parse(current.createdAt) - Date.parse(previous.createdAt)) / DAY_MS
    if (Number.isFinite(days) && days > 0) intervals.push(days)
  }
  return intervals
}

function validDatedOrders(orders: readonly CustomerOrder[]): CustomerOrder[] { return [...orders].filter((order) => Number.isFinite(Date.parse(order.createdAt))).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)) }
function uniqueCurrencies(orders: readonly CustomerOrder[]): string[] { return [...new Set(orders.map((order) => order.currency).filter((value): value is string => value !== null))].filter((value) => orders.every((order) => order.currency === value)) }
function customerKey(value: string): string { return value.replace(/^gid:\/\/shopify\/Customer\//, '').trim() }
function unknownCoverage(): CustomerCoverage { return { ordersSyncCompleted: false, knownComplete90Days: false, cutoffDate: null, lastCompletedSyncAt: null, explanation: 'A complete 90-day order window cannot be proven from the currently authorized Shopify history. Inactive and churn classifications remain Unknown.' } }
function unwrapLegacy(value: unknown, label: string): Readonly<Record<string, unknown>> { const raw = objectValue(value); if (!raw) throw new RangeError(`${label} payload must be an object`); if (typeof raw.payload !== 'string') return raw; try { const parsed = objectValue(JSON.parse(raw.payload)); return parsed ? { ...parsed, id: parsed.id ?? raw.id } : raw } catch { return raw } }
function objectValue(value: unknown): Readonly<Record<string, unknown>> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null }
function arrayValue(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function scalarString(value: unknown): string | null { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null }
function nonNegativeIntegerOrNull(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; return Number.isInteger(parsed) && parsed >= 0 ? parsed : null }
function money(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null }
function currency(value: unknown): string | null { const code = nullableString(value)?.toUpperCase() ?? ''; return /^[A-Z]{3}$/.test(code) ? code : null }
function isoDateTime(value: unknown): string | null { const text = nullableString(value); return text && Number.isFinite(Date.parse(text)) ? text : null }
function normalizeTags(value: unknown): readonly string[] { if (Array.isArray(value)) return value.flatMap((item) => nullableString(item) ? [String(item).trim()] : []); const text = nullableString(value); return text ? text.split(',').map((tag) => tag.trim()).filter(Boolean) : [] }
function round(value: number): number { return Math.round(value * 100) / 100 }
