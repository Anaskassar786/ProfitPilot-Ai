import { randomUUID } from 'node:crypto'
import type { AiGeneration, OpenRouterClient } from '@profitpilot/ai'
import { planAtLeast, planDisplayName, validateLanguageResponse } from '@profitpilot/ai'
import type { BillingRepository } from '@profitpilot/billing'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import { AppError } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { CustomerDataset, CustomerRepository, CustomerSegment, CustomerView } from './customers.js'

const DAY_MS = 86_400_000
const CACHE_TTL_MS = 5 * 60_000
const AI_LIMIT: Readonly<Record<PlanTier, number | null>> = { trial: 0, start: 0, growth: 20, commander: null }

export type CustomerSegmentFilter = 'all' | 'inactive' | CustomerSegment
export type CustomerSort = 'name' | 'spent' | 'orders' | 'last_order' | 'created'
export type CustomerInsightFeature = 'premium_segments' | 'retention_suggestion' | 'purchase_patterns' | 'predicted_next_order' | 'predictive_ltv' | 'custom_ai_queries' | 'auto_retention_workflows'

export type CustomerFilters = Readonly<{
  query: string
  segment: CustomerSegmentFilter
  sort: CustomerSort
  direction: 'asc' | 'desc'
  page: number
  limit: number
}>

export type CustomerSummary = Readonly<{
  id: string
  displayName: string
  hasRealName: boolean
  email: string | null
  emailVisibility: CustomerView['emailVisibility']
  marketingState: CustomerView['marketingState']
  canEmail: boolean
  emailDisabledReason: string | null
  phone: string | null
  createdAt: string | null
  lifetimeOrders: number
  totalSpent: number | null
  currency: string | null
  lastOrderAt: string | null
  activity: CustomerView['activity']
  segments: readonly CustomerSegment[]
  primarySegment: CustomerSegment | null
  purchasePattern: CustomerView['purchasePattern'] | null
}>

export type CustomerStats = Readonly<{
  total: number
  active: number
  inactive: number
  unknown: number
  newCustomersLast30Days: number
  topSpender: Readonly<{ customerId: string; displayName: string; value: number; currency: string | null }> | null
}>

export type CustomersPageResult = Readonly<{
  plan: PlanTier
  customers: readonly CustomerSummary[]
  stats: CustomerStats
  coverage: CustomerDataset['coverage']
  lockedFilters: readonly Readonly<{ locked: true; feature: 'premium_segments'; segment: CustomerSegment; required_plan: 'growth' }>[]
  pagination: Readonly<{ page: number; limit: number; total: number; pages: number }>
}>

export type LockedCustomerInsight = Readonly<{ locked: true; feature: CustomerInsightFeature; name: string; required_plan: 'growth' | 'commander' }>
export type AvailableCustomerInsight = Readonly<{ feature: CustomerInsightFeature; name: string; data: unknown }>
export type CustomerInsightsResult = Readonly<{
  plan: PlanTier
  planLabel: string
  customerCount: number
  available: readonly AvailableCustomerInsight[]
  locked: readonly LockedCustomerInsight[]
  usage: Readonly<{ feature: 'customers_ai_insights_day'; used: number; limit: number | null; remaining: number | null; limitReached: boolean }>
  coverage: CustomerDataset['coverage']
  cached: boolean
}>

export interface CustomerInsightAudit {
  locked(storeId: StoreId, feature: CustomerInsightFeature, plan: PlanTier, requiredPlan: 'growth' | 'commander'): Promise<void>
}

export interface CustomerInsightUsage {
  current(storeId: StoreId): Promise<number>
  consume(storeId: StoreId, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>>
}

export class PostgresCustomerInsightAudit implements CustomerInsightAudit {
  public constructor(private readonly executor: SqlExecutor) {}
  public locked(storeId: StoreId, feature: CustomerInsightFeature, plan: PlanTier, requiredPlan: 'growth' | 'commander'): Promise<void> {
    return withTenantContext(this.executor, storeId, async (client) => {
      await client.query(`INSERT INTO billing_audit (shop_id, actor, event, payload) VALUES ($1, 'merchant', 'customers.insight.locked', $2::jsonb)`, [storeId, JSON.stringify({ feature, plan, requiredPlan })])
    })
  }
}

export class PostgresCustomerInsightUsage implements CustomerInsightUsage {
  public constructor(private readonly executor: SqlExecutor) {}
  public current(storeId: StoreId): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { used: string | number }>(`SELECT used FROM billing_usage WHERE shop_id = $1 AND feature = 'customers_ai_insights_day' AND period_start = CURRENT_DATE`, [storeId])
      return Number(result.rows[0]?.used ?? 0)
    })
  }
  public consume(storeId: StoreId, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { used: string | number }>(
        `INSERT INTO billing_usage (shop_id, feature, period_start, used)
         VALUES ($1, 'customers_ai_insights_day', CURRENT_DATE, 1)
         ON CONFLICT (shop_id, feature, period_start)
         DO UPDATE SET used = billing_usage.used + 1
         WHERE $2::bigint IS NULL OR billing_usage.used < $2::bigint
         RETURNING used`,
        [storeId, limit],
      )
      if (result.rows[0]) return { allowed: true, used: Number(result.rows[0].used) }
      const current = await client.query<QueryResultRow & { used: string | number }>(`SELECT used FROM billing_usage WHERE shop_id = $1 AND feature = 'customers_ai_insights_day' AND period_start = CURRENT_DATE`, [storeId])
      return { allowed: false, used: Number(current.rows[0]?.used ?? 0) }
    })
  }
}

export class CustomerFeatureLockedError extends AppError {
  public constructor(feature: CustomerInsightFeature, requiredPlan: 'growth' | 'commander') {
    super('FORBIDDEN', `Upgrade to ${planDisplayName(requiredPlan)} to unlock ${feature}`, 403, { locked: true, feature, required_plan: requiredPlan })
    this.name = 'CustomerFeatureLockedError'
  }
}

export class CustomerService {
  public constructor(
    private readonly repository: CustomerRepository,
    private readonly billing: Pick<BillingRepository, 'get'>,
    private readonly audit: CustomerInsightAudit,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async list(storeId: StoreId, filters: CustomerFilters): Promise<CustomersPageResult> {
    const plan = await this.plan(storeId)
    if (isPremiumSegment(filters.segment) && !planAtLeast(plan, 'growth')) {
      await this.audit.locked(storeId, 'premium_segments', plan, 'growth')
      throw new CustomerFeatureLockedError('premium_segments', 'growth')
    }
    const dataset = await this.repository.list(storeId)
    const premium = planAtLeast(plan, 'growth')
    const query = filters.query.toLowerCase()
    const filtered = dataset.customers.filter((customer) => {
      if (query && ![customer.displayName, customer.email, customer.phone, customer.id].some((value) => value?.toLowerCase().includes(query))) return false
      if (filters.segment === 'inactive' && customer.activity !== 'inactive') return false
      if (isPremiumSegment(filters.segment) && !customer.segments.includes(filters.segment)) return false
      return true
    })
    const sorted = [...filtered].sort((left, right) => compareCustomers(left, right, filters.sort, filters.direction))
    const pages = Math.max(1, Math.ceil(sorted.length / filters.limit))
    const page = Math.min(filters.page, pages)
    const start = (page - 1) * filters.limit
    const stats = customerStats(dataset.customers, this.now())
    const lockedFilters = premium ? [] : (['vip', 'churn_risk', 'new_buyer'] as const).map((segment) => ({ locked: true as const, feature: 'premium_segments' as const, segment, required_plan: 'growth' as const }))
    return { plan, customers: sorted.slice(start, start + filters.limit).map((customer) => customerSummary(customer, premium)), stats, coverage: dataset.coverage, lockedFilters, pagination: { page, limit: filters.limit, total: sorted.length, pages } }
  }

  public async get(storeId: StoreId, customerId: string): Promise<CustomerView | null> {
    const plan = await this.plan(storeId)
    const customer = await this.repository.get(storeId, customerId)
    if (!customer) return null
    return redactPremiumCustomerFields(customer, plan)
  }

  private async plan(storeId: StoreId): Promise<PlanTier> { return (await this.billing.get(storeId))?.plan ?? 'trial' }
}

const INSIGHTS: readonly Readonly<{ feature: CustomerInsightFeature; name: string; minimumPlan: PlanTier }>[] = [
  { feature: 'premium_segments', name: 'Customer segments', minimumPlan: 'growth' },
  { feature: 'retention_suggestion', name: 'AI retention suggestion', minimumPlan: 'growth' },
  { feature: 'purchase_patterns', name: 'Purchase patterns', minimumPlan: 'growth' },
  { feature: 'predicted_next_order', name: 'Predicted next order', minimumPlan: 'commander' },
  { feature: 'predictive_ltv', name: 'Predictive LTV', minimumPlan: 'commander' },
  { feature: 'custom_ai_queries', name: 'Custom customer query', minimumPlan: 'commander' },
  { feature: 'auto_retention_workflows', name: 'Retention workflows', minimumPlan: 'commander' },
]

type CachedCustomerInsights = Readonly<{ expiresAt: number; result: Omit<CustomerInsightsResult, 'cached'> }>

export class CustomerInsightsService {
  private readonly cache = new Map<string, CachedCustomerInsights>()
  public constructor(
    private readonly repository: CustomerRepository,
    private readonly billing: Pick<BillingRepository, 'get'>,
    private readonly usage: CustomerInsightUsage,
    private readonly audit: CustomerInsightAudit,
    private readonly provider: Pick<OpenRouterClient, 'generate'>,
    private readonly recordGeneration: ((storeId: StoreId, generation: AiGeneration) => void) | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async get(storeId: StoreId, requestedFeature?: CustomerInsightFeature): Promise<CustomerInsightsResult> {
    if (requestedFeature === 'custom_ai_queries') throw new AppError('VALIDATION_ERROR', 'Custom customer questions must use POST /customers/insights/query', 400)
    const plan = await this.plan(storeId)
    const selected = requestedFeature ? INSIGHTS.filter((definition) => definition.feature === requestedFeature) : INSIGHTS.filter((definition) => definition.feature !== 'custom_ai_queries')
    const availableDefinitions = selected.filter((definition) => planAtLeast(plan, definition.minimumPlan))
    const lockedDefinitions = selected.filter((definition) => !planAtLeast(plan, definition.minimumPlan))
    const locked = lockedDefinitions.map((definition): LockedCustomerInsight => ({ locked: true, feature: definition.feature, name: definition.name, required_plan: requiredPlan(definition.minimumPlan) }))
    for (const item of locked) await this.audit.locked(storeId, item.feature, plan, item.required_plan)
    if (requestedFeature && locked[0]) throw new CustomerFeatureLockedError(locked[0].feature, locked[0].required_plan)

    const cacheKey = `${storeId}:${plan}:${requestedFeature ?? 'all'}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) return { ...cached.result, cached: true }

    const dataset = await this.repository.list(storeId)
    let used = await this.usage.current(storeId)
    const limit = AI_LIMIT[plan]
    const available: AvailableCustomerInsight[] = []
    for (const definition of availableDefinitions) {
      let data: unknown
      if (definition.feature === 'premium_segments') data = segmentInsight(dataset)
      else if (definition.feature === 'purchase_patterns') data = purchasePatternInsight(dataset)
      else if (definition.feature === 'predicted_next_order') data = predictionInsight(dataset)
      else if (definition.feature === 'predictive_ltv') data = ltvInsight(dataset)
      else if (definition.feature === 'auto_retention_workflows') data = { status: 'available', execution: 'manual_send_only', scheduling: false, message: 'Review a customer and send manually. Autonomous retention scheduling is not enabled.' }
      else {
        if (dataset.customers.length === 0) data = { status: 'insufficient_data', message: 'Sync customers before requesting a retention suggestion.' }
        else {
          const reservation = await this.usage.consume(storeId, limit)
          used = reservation.used
          data = reservation.allowed ? await this.generate(storeId, dataset, '') : limitReached()
        }
      }
      available.push({ feature: definition.feature, name: definition.name, data })
    }
    const result: Omit<CustomerInsightsResult, 'cached'> = { plan, planLabel: planDisplayName(plan), customerCount: dataset.customers.length, available, locked, usage: usageView(used, limit), coverage: dataset.coverage }
    this.cache.set(cacheKey, { expiresAt: this.now() + CACHE_TTL_MS, result })
    return { ...result, cached: false }
  }

  public async query(storeId: StoreId, question: string): Promise<CustomerInsightsResult> {
    const plan = await this.plan(storeId)
    if (!planAtLeast(plan, 'commander')) {
      await this.audit.locked(storeId, 'custom_ai_queries', plan, 'commander')
      throw new CustomerFeatureLockedError('custom_ai_queries', 'commander')
    }
    const normalized = question.trim()
    if (!normalized || normalized.length > 500) throw new AppError('VALIDATION_ERROR', 'question must contain between 1 and 500 characters', 400)
    const dataset = await this.repository.list(storeId)
    const limit = AI_LIMIT[plan]
    let used = await this.usage.current(storeId)
    let data: unknown
    if (dataset.customers.length === 0) data = { status: 'insufficient_data', message: 'Sync customers before asking a customer intelligence question.' }
    else {
      const reservation = await this.usage.consume(storeId, limit)
      used = reservation.used
      data = reservation.allowed ? await this.generate(storeId, dataset, redactQuestion(normalized, dataset.customers)) : limitReached()
    }
    return { plan, planLabel: planDisplayName(plan), customerCount: dataset.customers.length, available: [{ feature: 'custom_ai_queries', name: 'Custom customer query', data }], locked: [], usage: usageView(used, limit), coverage: dataset.coverage, cached: false }
  }

  private async generate(storeId: StoreId, dataset: CustomerDataset, question: string): Promise<unknown> {
    const facts = groundedCustomerFacts(dataset)
    if (facts.length === 0) return { status: 'insufficient_data', message: 'There are not enough non-personal aggregate facts to generate an answer.' }
    try {
      const generation = await this.provider.generate(
        'You are ProfitPilot customer intelligence. Use only the supplied aggregate, non-personal facts. Never infer or request names, email addresses, phone numbers, addresses, customer IDs, notes, or tags. Never invent a number, date, currency, cause, or action already completed. Keep the response to two short sentences.',
        `${question ? `Question with personal data removed: ${question}` : 'Give one practical, manual retention suggestion.'}\n\nGrounded aggregate facts:\n${facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n')}\n\nUse only numeric values shown above. If evidence is insufficient, say so.`,
        { maxTokens: 180 },
      )
      this.recordGeneration?.(storeId, generation)
      return { status: 'generated', text: validateLanguageResponse(generation.text, facts, 0), model: generation.model }
    } catch {
      return { status: 'unavailable', message: 'AI customer intelligence is temporarily unavailable. Deterministic segments remain available.' }
    }
  }

  private async plan(storeId: StoreId): Promise<PlanTier> { return (await this.billing.get(storeId))?.plan ?? 'trial' }
}

export function parseCustomerFilters(query: Readonly<Record<string, unknown>>): CustomerFilters {
  return { query: bounded(query.q, 200), segment: isCustomerSegmentFilter(query.segment) ? query.segment : 'all', sort: isCustomerSort(query.sort) ? query.sort : 'created', direction: query.direction === 'asc' ? 'asc' : 'desc', page: boundedInteger(query.page, 1, 100_000, 1), limit: boundedInteger(query.limit, 1, 100, 20) }
}

export function isCustomerInsightFeature(value: unknown): value is CustomerInsightFeature { return typeof value === 'string' && INSIGHTS.some((definition) => definition.feature === value) }

export function customerStats(customers: readonly CustomerView[], now = Date.now()): CustomerStats {
  const topSpender = [...customers].filter((customer) => customer.totalSpent !== null).sort((left, right) => (right.totalSpent ?? 0) - (left.totalSpent ?? 0) || left.id.localeCompare(right.id))[0]
  return {
    total: customers.length,
    active: customers.filter((customer) => customer.activity === 'active').length,
    inactive: customers.filter((customer) => customer.activity === 'inactive').length,
    unknown: customers.filter((customer) => customer.activity === 'unknown').length,
    newCustomersLast30Days: customers.filter((customer) => customer.createdAt !== null && Date.parse(customer.createdAt) >= now - 30 * DAY_MS).length,
    topSpender: topSpender?.totalSpent !== null && topSpender?.totalSpent !== undefined ? { customerId: topSpender.id, displayName: topSpender.displayName, value: topSpender.totalSpent, currency: topSpender.currency } : null,
  }
}

function customerSummary(customer: CustomerView, premium: boolean): CustomerSummary {
  return { id: customer.id, displayName: customer.displayName, hasRealName: customer.hasRealName, email: customer.email, emailVisibility: customer.emailVisibility, marketingState: customer.marketingState, canEmail: customer.canEmail, emailDisabledReason: customer.emailDisabledReason, phone: customer.phone, createdAt: customer.createdAt, lifetimeOrders: customer.lifetimeOrders, totalSpent: customer.totalSpent, currency: customer.currency, lastOrderAt: customer.lastOrderAt, activity: customer.activity, segments: premium ? customer.segments : [], primarySegment: premium ? customer.primarySegment : null, purchasePattern: premium ? customer.purchasePattern : null }
}

function redactPremiumCustomerFields(customer: CustomerView, plan: PlanTier): CustomerView {
  const growth = planAtLeast(plan, 'growth')
  const commander = planAtLeast(plan, 'commander')
  return { ...customer, segments: growth ? customer.segments : [], primarySegment: growth ? customer.primarySegment : null, purchasePattern: growth ? customer.purchasePattern : { status: 'insufficient_data', minimumOrders: 2 }, predictedNextOrder: commander ? customer.predictedNextOrder : { status: 'insufficient_data', minimumOrders: 3 }, predictiveLtv: commander ? customer.predictiveLtv : { status: 'insufficient_data', reason: 'minimum_orders', minimumOrders: 3 } }
}

function segmentInsight(dataset: CustomerDataset) { return { status: dataset.customers.length ? 'available' : 'insufficient_data', vip: countSegment(dataset, 'vip'), churnRisk: countSegment(dataset, 'churn_risk'), newBuyer: countSegment(dataset, 'new_buyer'), churnCoverageKnown: dataset.coverage.knownComplete90Days } }
function purchasePatternInsight(dataset: CustomerDataset) { const values = dataset.customers.flatMap((customer) => customer.purchasePattern.status === 'available' ? [customer.purchasePattern.averageIntervalDays] : []); return values.length ? { status: 'available', customersWithPattern: values.length, averageCadenceDays: round(values.reduce((sum, value) => sum + value, 0) / values.length) } : { status: 'insufficient_data', message: 'At least two dated qualifying orders per customer are required.' } }
function predictionInsight(dataset: CustomerDataset) { const available = dataset.customers.filter((customer) => customer.predictedNextOrder.status === 'available').length; return available ? { status: 'available', customersWithPrediction: available, method: 'average_order_interval' } : { status: 'insufficient_data', message: 'At least three dated qualifying orders per customer are required.' } }
function ltvInsight(dataset: CustomerDataset) { const values = dataset.customers.flatMap((customer) => customer.predictiveLtv.status === 'available' ? [customer.predictiveLtv] : []); const currencies = [...new Set(values.map((value) => value.currency))]; if (values.length === 0) return { status: 'insufficient_data', message: 'At least three valued orders in one currency per customer are required.' }; return { status: 'available', customersWithPrediction: values.length, currencies, aggregateValue: currencies.length === 1 ? round(values.reduce((sum, value) => sum + value.value, 0)) : null, aggregateCurrency: currencies.length === 1 ? currencies[0] : null, mixedCurrencyAggregateBlocked: currencies.length > 1, method: 'cadence_aov_heuristic', horizonMonths: 12 } }
function countSegment(dataset: CustomerDataset, segment: CustomerSegment): number { return dataset.customers.filter((customer) => customer.segments.includes(segment)).length }

function groundedCustomerFacts(dataset: CustomerDataset) {
  const customers = dataset.customers
  const stats = customerStats(customers)
  const totalOrders = customers.reduce((sum, customer) => sum + customer.lifetimeOrders, 0)
  const facts: Array<{ key: string; label: string; value: string | number; source: string }> = [
    { key: 'customers', label: 'Customer count', value: stats.total, source: 'sync_records.customers' },
    { key: 'active', label: 'Active customers with a matched order in 30 days', value: stats.active, source: 'sync_records.orders' },
    { key: 'unknown_activity', label: 'Customers with unknown activity because 90-day coverage is not proven', value: stats.unknown, source: 'sync_coverage' },
    { key: 'lifetime_orders', label: 'Lifetime order count reported across customers', value: totalOrders, source: 'sync_records.customers.orders_count' },
    { key: 'vip', label: 'VIP customers by deterministic top-20-percent rule', value: countSegment(dataset, 'vip'), source: 'calculated' },
    { key: 'churn', label: 'Churn-risk customers with proven coverage', value: countSegment(dataset, 'churn_risk'), source: 'calculated' },
    { key: 'new_buyer', label: 'New buyers with one matched order in 30 days', value: countSegment(dataset, 'new_buyer'), source: 'calculated' },
  ]
  const spendRows = customers.filter((customer) => customer.totalSpent !== null)
  const currencies = [...new Set(spendRows.map((customer) => customer.currency))]
  if (spendRows.length > 0 && currencies.length === 1 && currencies[0] !== null) {
    facts.push({ key: 'spend', label: `Customer lifetime spend total (${currencies[0]})`, value: round(spendRows.reduce((sum, customer) => sum + (customer.totalSpent ?? 0), 0)), source: 'sync_records.customers.total_spent' })
  }
  return facts
}

function redactQuestion(question: string, customers: readonly CustomerView[]): string {
  let redacted = question.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]').replace(/\+?[\d][\d\s().-]{7,}\d/g, '[redacted phone or id]').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[redacted id]')
  const personalValues = customers.flatMap((customer) => [customer.id, customer.displayName !== 'Guest customer' ? customer.displayName : null, customer.firstName, customer.lastName, customer.email, customer.phone]).filter((value): value is string => Boolean(value && value.length >= 2)).sort((left, right) => right.length - left.length)
  for (const value of personalValues) redacted = redacted.replace(new RegExp(escapeRegex(value), 'gi'), '[redacted]')
  return redacted
}

function compareCustomers(left: CustomerView, right: CustomerView, sort: CustomerSort, direction: 'asc' | 'desc'): number { let value = 0; if (sort === 'name') value = left.displayName.localeCompare(right.displayName); else if (sort === 'spent') value = nullableNumberCompare(left.totalSpent, right.totalSpent); else if (sort === 'orders') value = left.lifetimeOrders - right.lifetimeOrders; else if (sort === 'last_order') value = (left.lastOrderAt ?? '').localeCompare(right.lastOrderAt ?? ''); else value = (left.createdAt ?? '').localeCompare(right.createdAt ?? ''); return direction === 'asc' ? value : -value }
function nullableNumberCompare(left: number | null, right: number | null): number { if (left === null) return right === null ? 0 : -1; if (right === null) return 1; return left - right }
function isPremiumSegment(value: CustomerSegmentFilter): value is CustomerSegment { return value === 'vip' || value === 'churn_risk' || value === 'new_buyer' }
function isCustomerSegmentFilter(value: unknown): value is CustomerSegmentFilter { return value === 'all' || value === 'inactive' || value === 'vip' || value === 'churn_risk' || value === 'new_buyer' }
function isCustomerSort(value: unknown): value is CustomerSort { return value === 'name' || value === 'spent' || value === 'orders' || value === 'last_order' || value === 'created' }
function requiredPlan(plan: PlanTier): 'growth' | 'commander' { return plan === 'commander' ? 'commander' : 'growth' }
function usageView(used: number, limit: number | null) { return { feature: 'customers_ai_insights_day' as const, used, limit, remaining: limit === null ? null : Math.max(0, limit - used), limitReached: limit !== null && used >= limit } }
function limitReached() { return { status: 'limit_reached', message: 'Daily limit reached, upgrade or wait until tomorrow.' } }
function bounded(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function boundedInteger(value: unknown, min: number, max: number, fallback: number): number { const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN; return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback }
function round(value: number): number { return Math.round(value * 100) / 100 }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export class InMemoryCustomerInsightUsage implements CustomerInsightUsage {
  private readonly used = new Map<string, number>()
  public async current(storeId: StoreId): Promise<number> { return this.used.get(storeId) ?? 0 }
  public async consume(storeId: StoreId, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>> { const current = this.used.get(storeId) ?? 0; if (limit !== null && current >= limit) return { allowed: false, used: current }; const next = current + 1; this.used.set(storeId, next); return { allowed: true, used: next } }
}

export class InMemoryCustomerInsightAudit implements CustomerInsightAudit {
  public readonly entries: Array<Readonly<{ id: string; storeId: StoreId; feature: CustomerInsightFeature; plan: PlanTier; requiredPlan: 'growth' | 'commander' }>> = []
  public async locked(storeId: StoreId, feature: CustomerInsightFeature, plan: PlanTier, requiredPlan: 'growth' | 'commander'): Promise<void> { this.entries.push({ id: randomUUID(), storeId, feature, plan, requiredPlan }) }
}
