import { randomUUID } from 'node:crypto'
import type { AiGeneration, OpenRouterClient } from '@profitpilot/ai'
import { planAtLeast, planDisplayName, validateLanguageResponse } from '@profitpilot/ai'
import type { BillingRepository } from '@profitpilot/billing'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import { AppError } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { INVENTORY_PREMIUM_FEATURES, inventoryStats } from './inventory.js'
import type { InventoryDataset, InventoryRepository } from './inventory.js'
import {
  aggregateProductStock,
  deadStock,
  overstockAlerts,
  predictiveRestocking,
  reorderRecommendations,
  seasonalTrends,
  stockTurnover,
  DEFAULT_LEAD_TIME_DAYS,
  MIN_SALES_HISTORY_DAYS,
  SEASONAL_MIN_HISTORY_DAYS,
} from './inventory-velocity.js'

/**
 * Inventory intelligence (PR #33 / PR-B).
 *
 * Mirrors the Orders and Customers insight services exactly: plan gating from
 * the billing repository, a five-minute cache, daily usage counters in
 * `billing_usage`, locked-access rows in `billing_audit`, and an LLM that only
 * ever sees aggregate non-identifying facts.
 *
 * Everything numeric is deterministic and computed in `inventory-velocity.ts`.
 * The model is used for one thing only: phrasing a suggestion around numbers
 * that were already calculated, validated against those same numbers before the
 * text is returned.
 */

const CACHE_TTL_MS = 5 * 60_000
/** Daily AI insight generations. Trial/Start get none; Commander is unmetered. */
const AI_LIMIT: Readonly<Record<PlanTier, number | null>> = { trial: 0, start: 0, growth: 20, commander: null }
/** Free-form Commander questions are separately capped at 20 per day. */
const QUERY_LIMIT: Readonly<Record<PlanTier, number | null>> = { trial: 0, start: 0, growth: 0, commander: 20 }
export const INVENTORY_USAGE_FEATURE = 'inventory_ai_insights_day'
export const INVENTORY_QUERY_USAGE_FEATURE = 'inventory_ai_queries_day'
const HISTORY_WINDOWS: readonly number[] = [7, 30, 90, 365]
const MAX_QUESTION_LENGTH = 500

export type InventoryInsightFeature = (typeof INVENTORY_PREMIUM_FEATURES)[number]['feature']
export type RequiredPlan = 'growth' | 'commander'

export type LockedInventoryInsight = Readonly<{ locked: true; feature: string; name: string; required_plan: RequiredPlan }>
export type AvailableInventoryInsight = Readonly<{ feature: string; name: string; data: unknown }>
export type InventoryUsageView = Readonly<{ feature: string; used: number; limit: number | null; remaining: number | null; limitReached: boolean }>

export type InventoryInsightsResult = Readonly<{
  plan: PlanTier
  planLabel: string
  skuCount: number
  available: readonly AvailableInventoryInsight[]
  locked: readonly LockedInventoryInsight[]
  usage: InventoryUsageView
  salesHistory: Readonly<{ days: number; sufficient: boolean; missingDays: number; minimumDays: number; firstDay: string | null }>
  coverage: InventoryDataset['coverage']
  cached: boolean
}>

export type InventoryHistoryPoint = Readonly<{ date: string; units: number; value: number | null; skus: number }>
export type InventoryHistoryResult = Readonly<{
  plan: PlanTier
  days: number
  points: readonly InventoryHistoryPoint[]
  firstSnapshotDate: string | null
  snapshotDays: number
  message: string
}>

export type ReorderDecisionResult = Readonly<{ productId: string; decision: 'approved' | 'dismissed'; recordedAt: string; execution: 'manual_in_shopify' }>

export interface InventoryInsightAudit {
  locked(storeId: StoreId, feature: string, plan: PlanTier, requiredPlan: RequiredPlan): Promise<void>
  reorderDecision(storeId: StoreId, productId: string, decision: 'approved' | 'dismissed', plan: PlanTier): Promise<void>
}

export interface InventoryInsightUsage {
  current(storeId: StoreId, feature: string): Promise<number>
  consume(storeId: StoreId, feature: string, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>>
}

export interface InventorySnapshotRepository {
  /** Daily totals for the chart, oldest first. */
  history(storeId: StoreId, days: number): Promise<readonly InventoryHistoryPoint[]>
  /** Oldest recorded snapshot date, or null before the first inventory sync. */
  firstSnapshotDate(storeId: StoreId): Promise<string | null>
  /** Average recorded units per calendar month, oldest first. */
  monthlyAverages(storeId: StoreId): Promise<readonly Readonly<{ month: string; averageUnits: number }>[]>
}

export class PostgresInventoryInsightAudit implements InventoryInsightAudit {
  public constructor(private readonly executor: SqlExecutor) {}
  public locked(storeId: StoreId, feature: string, plan: PlanTier, requiredPlan: RequiredPlan): Promise<void> {
    return withTenantContext(this.executor, storeId, async (client) => {
      await client.query(`INSERT INTO billing_audit (shop_id, actor, event, payload) VALUES ($1, 'merchant', 'inventory.insight.locked', $2::jsonb)`, [storeId, JSON.stringify({ feature, plan, requiredPlan })])
    })
  }
  public reorderDecision(storeId: StoreId, productId: string, decision: 'approved' | 'dismissed', plan: PlanTier): Promise<void> {
    return withTenantContext(this.executor, storeId, async (client) => {
      await client.query(`INSERT INTO billing_audit (shop_id, actor, event, payload) VALUES ($1, 'merchant', 'inventory.reorder.decision', $2::jsonb)`, [storeId, JSON.stringify({ productId, decision, plan, execution: 'manual_in_shopify' })])
    })
  }
}

export class PostgresInventoryInsightUsage implements InventoryInsightUsage {
  public constructor(private readonly executor: SqlExecutor) {}
  public current(storeId: StoreId, feature: string): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { used: string | number }>(`SELECT used FROM billing_usage WHERE shop_id = $1 AND feature = $2 AND period_start = CURRENT_DATE`, [storeId, feature])
      return Number(result.rows[0]?.used ?? 0)
    })
  }
  public consume(storeId: StoreId, feature: string, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { used: string | number }>(
        `INSERT INTO billing_usage (shop_id, feature, period_start, used)
         VALUES ($1, $2, CURRENT_DATE, 1)
         ON CONFLICT (shop_id, feature, period_start)
         DO UPDATE SET used = billing_usage.used + 1
         WHERE $3::bigint IS NULL OR billing_usage.used < $3::bigint
         RETURNING used`,
        [storeId, feature, limit],
      )
      if (result.rows[0]) return { allowed: true, used: Number(result.rows[0].used) }
      const current = await client.query<QueryResultRow & { used: string | number }>(`SELECT used FROM billing_usage WHERE shop_id = $1 AND feature = $2 AND period_start = CURRENT_DATE`, [storeId, feature])
      return { allowed: false, used: Number(current.rows[0]?.used ?? 0) }
    })
  }
}

export class PostgresInventorySnapshotRepository implements InventorySnapshotRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public history(storeId: StoreId, days: number): Promise<readonly InventoryHistoryPoint[]> {
    const window = normalizeHistoryDays(days)
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { snapshot_date: Date | string; units: string | number; value: string | number | null; skus: string | number }>(
        `SELECT snapshot_date, SUM(quantity) AS units, SUM(value) AS value, COUNT(DISTINCT variant_id) AS skus
         FROM inventory_snapshots_daily
         WHERE store_id = $1 AND snapshot_date >= (CURRENT_DATE - $2::int)
         GROUP BY snapshot_date
         ORDER BY snapshot_date`,
        [storeId, window],
      )
      return result.rows.map((row) => ({
        date: isoDay(row.snapshot_date),
        units: Math.round(Number(row.units) || 0),
        value: row.value === null ? null : round(Number(row.value) || 0),
        skus: Math.round(Number(row.skus) || 0),
      }))
    })
  }

  public firstSnapshotDate(storeId: StoreId): Promise<string | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { first_date: Date | string | null }>(`SELECT MIN(snapshot_date) AS first_date FROM inventory_snapshots_daily WHERE store_id = $1`, [storeId])
      const value = result.rows[0]?.first_date ?? null
      return value === null ? null : isoDay(value)
    })
  }

  public monthlyAverages(storeId: StoreId): Promise<readonly Readonly<{ month: string; averageUnits: number }>[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { month: string; average_units: string | number }>(
        `SELECT to_char(snapshot_date, 'YYYY-MM') AS month, AVG(daily_units) AS average_units
         FROM (
           SELECT snapshot_date, SUM(quantity) AS daily_units
           FROM inventory_snapshots_daily
           WHERE store_id = $1
           GROUP BY snapshot_date
         ) AS daily
         GROUP BY month
         ORDER BY month`,
        [storeId],
      )
      return result.rows.map((row) => ({ month: String(row.month), averageUnits: round(Number(row.average_units) || 0) }))
    })
  }
}

export class InventoryFeatureLockedError extends AppError {
  public constructor(feature: string, requiredPlan: RequiredPlan) {
    super('FORBIDDEN', `Upgrade to ${planDisplayName(requiredPlan)} to unlock ${feature}`, 403, { locked: true, feature, required_plan: requiredPlan })
    this.name = 'InventoryFeatureLockedError'
  }
}

type CachedInsights = Readonly<{ expiresAt: number; result: Omit<InventoryInsightsResult, 'cached'> }>

export class InventoryInsightsService {
  private readonly cache = new Map<string, CachedInsights>()

  public constructor(
    private readonly repository: InventoryRepository,
    private readonly snapshots: InventorySnapshotRepository,
    private readonly billing: Pick<BillingRepository, 'get'>,
    private readonly usage: InventoryInsightUsage,
    private readonly audit: InventoryInsightAudit,
    private readonly provider: Pick<OpenRouterClient, 'generate'>,
    private readonly recordGeneration: ((storeId: StoreId, generation: AiGeneration) => void) | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public async get(storeId: StoreId, requestedFeature?: string): Promise<InventoryInsightsResult> {
    if (requestedFeature === 'custom_ai_queries') throw new AppError('VALIDATION_ERROR', 'Custom inventory questions must use POST /inventory/insights/query', 400)
    if (requestedFeature !== undefined && !isInventoryInsightFeature(requestedFeature)) throw new AppError('VALIDATION_ERROR', 'Unknown inventory insight feature', 400, { feature: requestedFeature })
    const plan = await this.plan(storeId)
    const selected = requestedFeature ? INVENTORY_PREMIUM_FEATURES.filter((definition) => definition.feature === requestedFeature) : INVENTORY_PREMIUM_FEATURES.filter((definition) => definition.feature !== 'custom_ai_queries')
    const availableDefinitions = selected.filter((definition) => planAtLeast(plan, definition.minimumPlan))
    const lockedDefinitions = selected.filter((definition) => !planAtLeast(plan, definition.minimumPlan))
    const locked = lockedDefinitions.map((definition): LockedInventoryInsight => ({ locked: true, feature: definition.feature, name: definition.name, required_plan: requiredPlan(definition.minimumPlan) }))
    for (const item of locked) await this.audit.locked(storeId, item.feature, plan, item.required_plan)
    if (requestedFeature && locked[0]) throw new InventoryFeatureLockedError(locked[0].feature, locked[0].required_plan)

    const cacheKey = `${storeId}:${plan}:${requestedFeature ?? 'all'}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) return { ...cached.result, cached: true }

    const at = this.now()
    const dataset = await this.repository.list(storeId)
    const products = aggregateProductStock(dataset.items)
    const history = dataset.sales
    let used = await this.usage.current(storeId, INVENTORY_USAGE_FEATURE)
    const limit = AI_LIMIT[plan]

    const available: AvailableInventoryInsight[] = []
    for (const definition of availableDefinitions) {
      let data: unknown
      if (definition.feature === 'dead_stock') data = deadStock(products, history, at)
      else if (definition.feature === 'reorder_recommendations') data = reorderRecommendations(products, history, at)
      else if (definition.feature === 'overstock_alerts') data = overstockAlerts(products, history, at)
      else if (definition.feature === 'stock_turnover') data = stockTurnover(products, history, at)
      else if (definition.feature === 'days_of_cover') data = daysOfCoverSummary(dataset, history, at)
      else if (definition.feature === 'stock_history') data = await this.stockHistorySummary(storeId)
      else if (definition.feature === 'predictive_restocking') data = predictiveRestocking(products, history, at)
      else if (definition.feature === 'seasonal_trends') data = await this.seasonalSummary(storeId)
      else if (definition.feature === 'auto_reorder') data = autoReorderSummary(products, history, at)
      else if (definition.feature === 'ai_suggestion') {
        if (dataset.items.length === 0) data = { status: 'insufficient_data', message: 'Sync your Shopify inventory before requesting an AI suggestion.' }
        else {
          const reservation = await this.usage.consume(storeId, INVENTORY_USAGE_FEATURE, limit)
          used = reservation.used
          data = reservation.allowed ? await this.generate(storeId, dataset, at, '') : limitReached()
        }
      }
      else data = { status: 'insufficient_data', message: 'This insight is not available yet.' }
      available.push({ feature: definition.feature, name: definition.name, data })
    }

    const result: Omit<InventoryInsightsResult, 'cached'> = {
      plan,
      planLabel: planDisplayName(plan),
      skuCount: dataset.items.length,
      available,
      locked,
      usage: usageView(INVENTORY_USAGE_FEATURE, used, limit),
      salesHistory: { days: history.historyDays, sufficient: history.sufficient, missingDays: history.missingDays, minimumDays: MIN_SALES_HISTORY_DAYS, firstDay: history.firstDay },
      coverage: dataset.coverage,
    }
    this.cache.set(cacheKey, { expiresAt: this.now() + CACHE_TTL_MS, result })
    return { ...result, cached: false }
  }

  /** Free-form Commander question, grounded in aggregate facts only. */
  public async query(storeId: StoreId, question: string): Promise<InventoryInsightsResult> {
    const plan = await this.plan(storeId)
    if (!planAtLeast(plan, 'commander')) {
      await this.audit.locked(storeId, 'custom_ai_queries', plan, 'commander')
      throw new InventoryFeatureLockedError('custom_ai_queries', 'commander')
    }
    const normalized = question.trim()
    if (!normalized || normalized.length > MAX_QUESTION_LENGTH) throw new AppError('VALIDATION_ERROR', `question must contain between 1 and ${MAX_QUESTION_LENGTH} characters`, 400)
    const at = this.now()
    const dataset = await this.repository.list(storeId)
    const limit = QUERY_LIMIT[plan]
    let used = await this.usage.current(storeId, INVENTORY_QUERY_USAGE_FEATURE)
    let data: unknown
    if (dataset.items.length === 0) data = { status: 'insufficient_data', message: 'Sync your Shopify inventory before asking an inventory question.' }
    else {
      const reservation = await this.usage.consume(storeId, INVENTORY_QUERY_USAGE_FEATURE, limit)
      used = reservation.used
      data = reservation.allowed ? await this.generate(storeId, dataset, at, redactInventoryQuestion(normalized, dataset)) : limitReached()
    }
    return {
      plan,
      planLabel: planDisplayName(plan),
      skuCount: dataset.items.length,
      available: [{ feature: 'custom_ai_queries', name: 'Custom AI Queries', data }],
      locked: [],
      usage: usageView(INVENTORY_QUERY_USAGE_FEATURE, used, limit),
      salesHistory: { days: dataset.sales.historyDays, sufficient: dataset.sales.sufficient, missingDays: dataset.sales.missingDays, minimumDays: MIN_SALES_HISTORY_DAYS, firstDay: dataset.sales.firstDay },
      coverage: dataset.coverage,
      cached: false,
    }
  }

  /** Growth+ stock history for the chart. */
  public async history(storeId: StoreId, days: number): Promise<InventoryHistoryResult> {
    const plan = await this.plan(storeId)
    if (!planAtLeast(plan, 'growth')) {
      await this.audit.locked(storeId, 'stock_history', plan, 'growth')
      throw new InventoryFeatureLockedError('stock_history', 'growth')
    }
    const window = normalizeHistoryDays(days)
    const [points, firstSnapshotDate] = await Promise.all([this.snapshots.history(storeId, window), this.snapshots.firstSnapshotDate(storeId)])
    return {
      plan,
      days: window,
      points,
      firstSnapshotDate,
      snapshotDays: snapshotDaySpan(firstSnapshotDate, this.now()),
      message: points.length === 0
        ? 'Building your inventory history \u2014 the chart appears after your next inventory sync.'
        : points.length === 1
          ? 'One snapshot recorded so far. The chart fills in as sync history builds.'
          : `${points.length} daily snapshots recorded in the last ${window} days.`,
    }
  }

  /** Commander manual review of a reorder suggestion. Nothing is ordered here. */
  public async recordReorderDecision(storeId: StoreId, productId: string, decision: string): Promise<ReorderDecisionResult> {
    const plan = await this.plan(storeId)
    if (!planAtLeast(plan, 'commander')) {
      await this.audit.locked(storeId, 'auto_reorder', plan, 'commander')
      throw new InventoryFeatureLockedError('auto_reorder', 'commander')
    }
    const id = productId.trim()
    if (!id || id.length > 200) throw new AppError('VALIDATION_ERROR', 'A valid productId is required', 400)
    if (decision !== 'approved' && decision !== 'dismissed') throw new AppError('VALIDATION_ERROR', 'decision must be approved or dismissed', 400)
    await this.audit.reorderDecision(storeId, id, decision, plan)
    return { productId: id, decision, recordedAt: new Date(this.now()).toISOString(), execution: 'manual_in_shopify' }
  }

  private async stockHistorySummary(storeId: StoreId): Promise<unknown> {
    const [points, firstSnapshotDate] = await Promise.all([this.snapshots.history(storeId, 90), this.snapshots.firstSnapshotDate(storeId)])
    if (points.length === 0) return { status: 'insufficient_data', message: 'Building your inventory history \u2014 charts will appear after the next sync.', points: [], firstSnapshotDate: null }
    return { status: 'available', points, firstSnapshotDate, windows: HISTORY_WINDOWS, message: points.length === 1 ? 'One snapshot recorded so far. The chart fills in as sync history builds.' : `${points.length} daily snapshots recorded.` }
  }

  private async seasonalSummary(storeId: StoreId): Promise<unknown> {
    const [firstSnapshotDate, months] = await Promise.all([this.snapshots.firstSnapshotDate(storeId), this.snapshots.monthlyAverages(storeId)])
    return seasonalTrends(snapshotDaySpan(firstSnapshotDate, this.now()), months)
  }

  /**
   * The only place a model is called. It receives store-level aggregates —
   * counts, unit totals, money totals — and never a product name, SKU, product
   * id, customer, or order. The reply is then validated so it cannot introduce
   * a number that was not supplied.
   */
  private async generate(storeId: StoreId, dataset: InventoryDataset, at: number, question: string): Promise<unknown> {
    const facts = groundedInventoryFacts(dataset, at)
    if (facts.length === 0) return { status: 'insufficient_data', message: 'There are not enough aggregate inventory facts to generate an answer.' }
    try {
      const generation = await this.provider.generate(
        'You are ProfitPilot inventory intelligence. Use only the supplied aggregate facts. Never invent a number, product name, SKU, customer, or completed action. Never ask for product-level or customer-level detail. Keep the response to two short sentences of practical advice.',
        `${question ? `Question with identifiers removed: ${question}` : 'Give one practical inventory action for this store.'}\n\nGrounded aggregate facts:\n${facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n')}\n\nUse only numeric values shown above. If the evidence is insufficient, say so plainly.`,
        { maxTokens: 180 },
      )
      this.recordGeneration?.(storeId, generation)
      return { status: 'generated', text: validateLanguageResponse(generation.text, facts, 0), model: generation.model, facts: facts.map((fact) => ({ label: fact.label, value: fact.value })) }
    } catch {
      return { status: 'unavailable', message: 'AI inventory intelligence is temporarily unavailable. The deterministic insights above remain accurate.' }
    }
  }

  private async plan(storeId: StoreId): Promise<PlanTier> { return (await this.billing.get(storeId))?.plan ?? 'trial' }
}

export function isInventoryInsightFeature(value: unknown): value is InventoryInsightFeature {
  return typeof value === 'string' && INVENTORY_PREMIUM_FEATURES.some((definition) => definition.feature === value)
}

export function normalizeHistoryDays(value: unknown): number {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return 30
  return HISTORY_WINDOWS.reduce((best, window) => Math.abs(window - parsed) < Math.abs(best - parsed) ? window : best, 30)
}

/** Days between the first snapshot and now; 0 when nothing has been recorded. */
export function snapshotDaySpan(firstSnapshotDate: string | null, now: number): number {
  if (!firstSnapshotDate) return 0
  const first = Date.parse(`${firstSnapshotDate}T00:00:00Z`)
  if (!Number.isFinite(first)) return 0
  return Math.max(1, Math.floor((Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - first) / 86_400_000) + 1)
}

function daysOfCoverSummary(dataset: InventoryDataset, history: InventoryDataset['sales'], at: number) {
  if (!history.sufficient) {
    return { status: 'insufficient_data', message: history.historyDays === 0 ? 'Awaiting sales history. Days of cover activates once orders are synced.' : `Awaiting ${history.missingDays} more day${history.missingDays === 1 ? '' : 's'} of sales history.`, minimumDays: MIN_SALES_HISTORY_DAYS }
  }
  const products = aggregateProductStock(dataset.items)
  const covers = products.flatMap((product) => {
    if (product.quantity === null || product.quantity <= 0) return []
    const sold = dataset.sales.rows.filter((row) => row.productId === product.productId && row.day >= new Date(at - 29 * 86_400_000).toISOString().slice(0, 10)).reduce((sum, row) => sum + row.unitsSold, 0)
    if (sold <= 0) return []
    return [{ productId: product.productId, days: round(product.quantity / (sold / MIN_SALES_HISTORY_DAYS)) }]
  })
  if (covers.length === 0) return { status: 'insufficient_data', message: 'No stocked product sold in the last 30 days, so cover cannot be measured.', minimumDays: MIN_SALES_HISTORY_DAYS }
  const sorted = [...covers].sort((left, right) => left.days - right.days)
  return {
    status: 'available',
    productsWithCover: covers.length,
    medianDays: sorted[Math.floor(sorted.length / 2)]?.days ?? null,
    lowestDays: sorted[0]?.days ?? null,
    highestDays: sorted[sorted.length - 1]?.days ?? null,
    message: 'Per-item cover is shown in the Days of Cover column.',
  }
}

/**
 * Commander auto-reorder: the same deterministic reorder list, explicitly
 * flagged as review-only. ProfitPilot never places an order.
 */
function autoReorderSummary(products: ReturnType<typeof aggregateProductStock>, history: InventoryDataset['sales'], at: number) {
  const recommendations = reorderRecommendations(products, history, at, DEFAULT_LEAD_TIME_DAYS)
  if (recommendations.status === 'insufficient_data') return recommendations
  return {
    status: 'available',
    execution: 'manual_review_only' as const,
    autonomous: false,
    items: recommendations.items,
    message: recommendations.items.length === 0 ? 'Stock levels healthy \u2014 nothing is queued for review.' : `${recommendations.items.length} product${recommendations.items.length === 1 ? '' : 's'} ready for your review. Approving records the decision; the purchase order is still placed in Shopify.`,
  }
}

/**
 * Aggregate, non-identifying facts handed to the model. Deliberately excludes
 * product titles, SKUs, ids, customers, and individual orders.
 */
export function groundedInventoryFacts(dataset: InventoryDataset, at: number): readonly Readonly<{ key: string; label: string; value: string | number; source: string }>[] {
  const stats = inventoryStats(dataset.items, dataset.currency)
  const products = aggregateProductStock(dataset.items)
  const facts: Array<Readonly<{ key: string; label: string; value: string | number; source: string }>> = [
    { key: 'skus', label: 'Tracked SKU count', value: stats.totalSkus, source: 'catalog_products' },
    { key: 'units', label: 'Units in stock', value: stats.totalUnits, source: 'sync_records.inventory' },
    { key: 'out_of_stock', label: 'Items out of stock', value: stats.outOfStockCount, source: 'calculated' },
    { key: 'low_stock', label: 'Items low on stock', value: stats.lowStockCount, source: 'calculated' },
    { key: 'sales_history_days', label: 'Days of sales history recorded', value: dataset.sales.historyDays, source: 'analytics_product_sales_daily' },
  ]
  if (stats.totalValue !== null) facts.push({ key: 'value', label: `Retail stock value${stats.currency ? ` (${stats.currency})` : ''}`, value: round(stats.totalValue), source: 'calculated' })
  if (dataset.sales.sufficient) {
    const dead = deadStock(products, dataset.sales, at)
    const over = overstockAlerts(products, dataset.sales, at)
    const reorder = reorderRecommendations(products, dataset.sales, at)
    const turnover = stockTurnover(products, dataset.sales, at)
    if (dead.status === 'available') {
      facts.push({ key: 'dead_stock', label: 'Products with stock and no sale in the dead-stock window', value: dead.items.length, source: 'calculated' })
      if (dead.totalStuckValue !== null) facts.push({ key: 'dead_value', label: `Value frozen in non-moving stock${dead.currency ? ` (${dead.currency})` : ''}`, value: dead.totalStuckValue, source: 'calculated' })
    }
    if (over.status === 'available') {
      facts.push({ key: 'overstock', label: 'Products holding more than 90 days of cover', value: over.items.length, source: 'calculated' })
      if (over.totalExcessValue !== null) facts.push({ key: 'overstock_value', label: `Value tied up in excess stock${over.currency ? ` (${over.currency})` : ''}`, value: over.totalExcessValue, source: 'calculated' })
    }
    if (reorder.status === 'available') facts.push({ key: 'reorder', label: 'Products at or below their reorder point', value: reorder.items.length, source: 'calculated' })
    if (turnover.status === 'available') {
      facts.push({ key: 'fast_movers', label: 'Fast-moving products turning over more than four times a year', value: turnover.fast, source: 'calculated' })
      facts.push({ key: 'slow_movers', label: 'Slow-moving products turning over less than twice a year', value: turnover.slow, source: 'calculated' })
    }
  }
  return facts
}

/**
 * Strips product-specific identifiers from a merchant question before it ever
 * reaches the model: emails, phone-like digit runs, uuids, and every synced
 * product title, SKU, variant id, and product id.
 */
export function redactInventoryQuestion(question: string, dataset: InventoryDataset): string {
  let redacted = question
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\+?[\d][\d\s().-]{7,}\d/g, '[redacted number]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[redacted id]')
  const identifiers = dataset.items
    .flatMap((item) => [item.title, item.variantTitle, item.sku, item.variantId, item.productId, item.inventoryItemId])
    .filter((value): value is string => Boolean(value && value.trim().length >= 3))
    .sort((left, right) => right.length - left.length)
  for (const value of [...new Set(identifiers)]) redacted = redacted.replace(new RegExp(escapeRegex(value), 'gi'), '[redacted product]')
  return redacted
}

function usageView(feature: string, used: number, limit: number | null): InventoryUsageView {
  return { feature, used, limit, remaining: limit === null ? null : Math.max(0, limit - used), limitReached: limit !== null && used >= limit }
}
function limitReached() { return { status: 'limit_reached', message: 'Daily AI limit reached. Upgrade your plan or try again tomorrow.' } }
function requiredPlan(plan: PlanTier): RequiredPlan { return plan === 'commander' ? 'commander' : 'growth' }
function isoDay(value: Date | string): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10) }
function round(value: number): number { return Math.round(value * 100) / 100 }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export const INVENTORY_SEASONAL_MIN_DAYS = SEASONAL_MIN_HISTORY_DAYS

/** In-memory doubles used by tests and local development. */
export class InMemoryInventoryInsightUsage implements InventoryInsightUsage {
  private readonly used = new Map<string, number>()
  public async current(storeId: StoreId, feature: string): Promise<number> { return this.used.get(`${storeId}:${feature}`) ?? 0 }
  public async consume(storeId: StoreId, feature: string, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>> {
    const key = `${storeId}:${feature}`
    const current = this.used.get(key) ?? 0
    if (limit !== null && current >= limit) return { allowed: false, used: current }
    const next = current + 1
    this.used.set(key, next)
    return { allowed: true, used: next }
  }
}

export class InMemoryInventoryInsightAudit implements InventoryInsightAudit {
  public readonly entries: Array<Readonly<{ id: string; storeId: StoreId; feature: string; plan: PlanTier; requiredPlan: RequiredPlan }>> = []
  public readonly decisions: Array<Readonly<{ storeId: StoreId; productId: string; decision: 'approved' | 'dismissed'; plan: PlanTier }>> = []
  public async locked(storeId: StoreId, feature: string, plan: PlanTier, requiredPlan: RequiredPlan): Promise<void> { this.entries.push({ id: randomUUID(), storeId, feature, plan, requiredPlan }) }
  public async reorderDecision(storeId: StoreId, productId: string, decision: 'approved' | 'dismissed', plan: PlanTier): Promise<void> { this.decisions.push({ storeId, productId, decision, plan }) }
}

export class InMemoryInventorySnapshotRepository implements InventorySnapshotRepository {
  public constructor(private readonly points: readonly InventoryHistoryPoint[] = []) {}
  public async history(_storeId: StoreId, days: number): Promise<readonly InventoryHistoryPoint[]> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    return this.points.filter((point) => point.date >= cutoff)
  }
  public async firstSnapshotDate(): Promise<string | null> { return this.points[0]?.date ?? null }
  public async monthlyAverages(): Promise<readonly Readonly<{ month: string; averageUnits: number }>[]> {
    const months = new Map<string, number[]>()
    for (const point of this.points) {
      const month = point.date.slice(0, 7)
      months.set(month, [...(months.get(month) ?? []), point.units])
    }
    return [...months.entries()].map(([month, units]) => ({ month, averageUnits: round(units.reduce((sum, value) => sum + value, 0) / units.length) })).sort((left, right) => left.month.localeCompare(right.month))
  }
}
