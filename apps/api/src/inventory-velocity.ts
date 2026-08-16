import type { InventoryItem } from './inventory.js'

/**
 * Deterministic inventory intelligence.
 *
 * Every number here is derived from two real sources only:
 *  - current stock from `catalog_products` + `sync_records` (module inventory)
 *  - units sold from `analytics_product_sales_daily`
 *
 * The hard rule: when the store has fewer than 30 days of sales history, no
 * velocity, cover, reorder point, or prediction is produced at all. The caller
 * receives an `insufficient_data` result explaining how much history is still
 * missing instead of a fabricated estimate.
 *
 * Shopify's daily product analytics are keyed by *product*, not variant, so
 * every velocity-derived insight is computed per product. Per-variant days of
 * cover is only reported when a product has exactly one variant; otherwise the
 * row honestly says variant-level sales are unavailable.
 */

export const DAY_MS = 86_400_000
/** Below this, nothing velocity-derived is calculated. */
export const MIN_SALES_HISTORY_DAYS = 30
/** Assumed supplier lead time. Fixed and disclosed rather than guessed per item. */
export const DEFAULT_LEAD_TIME_DAYS = 14
/** Safety buffer on top of lead-time demand. */
export const SAFETY_STOCK_RATIO = 0.2
/** An item with more than this many days of cover is flagged as overstock. */
export const OVERSTOCK_COVER_DAYS = 90
export const DEAD_STOCK_WINDOWS: readonly number[] = [90, 60, 30]
/** Seasonality needs a full year of observed snapshots. */
export const SEASONAL_MIN_HISTORY_DAYS = 365

export type ProductSalesDay = Readonly<{ productId: string; day: string; unitsSold: number; grossRevenue: number }>

export type SalesHistory = Readonly<{
  rows: readonly ProductSalesDay[]
  firstDay: string | null
  lastDay: string | null
  /** Distinct days that actually carry a sale. */
  observedDays: number
  /** Calendar days between the first recorded sale and today, inclusive. */
  historyDays: number
  sufficient: boolean
  /** Days of history still required before velocity features activate. */
  missingDays: number
}>

export type DaysOfCoverReason = 'sales_history' | 'no_sales' | 'no_stock_signal' | 'variant_sales_unavailable'
export type DaysOfCover =
  | Readonly<{ status: 'available'; days: number; velocity: number }>
  | Readonly<{ status: 'insufficient_data'; reason: DaysOfCoverReason; message: string }>
  | Readonly<{ status: 'locked'; required_plan: 'growth' }>

export type ProductStock = Readonly<{
  productId: string
  title: string
  category: string | null
  vendor: string | null
  variantCount: number
  /** null when Shopify returned no usable quantity for any variant. */
  quantity: number | null
  /** null when no variant carried a price. */
  value: number | null
  averagePrice: number | null
  currency: string | null
  tracked: boolean
}>

export function buildSalesHistory(rows: readonly ProductSalesDay[], now: number): SalesHistory {
  const clean = rows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Number.isFinite(row.unitsSold))
  if (clean.length === 0) return { rows: [], firstDay: null, lastDay: null, observedDays: 0, historyDays: 0, sufficient: false, missingDays: MIN_SALES_HISTORY_DAYS }
  const days = [...new Set(clean.map((row) => row.day))].sort()
  const firstDay = days[0] ?? null
  const lastDay = days[days.length - 1] ?? null
  const firstAt = firstDay === null ? Number.NaN : Date.parse(`${firstDay}T00:00:00Z`)
  const historyDays = Number.isFinite(firstAt) ? Math.max(1, Math.floor((startOfDay(now) - firstAt) / DAY_MS) + 1) : 0
  return {
    rows: clean,
    firstDay,
    lastDay,
    observedDays: days.length,
    historyDays,
    sufficient: historyDays >= MIN_SALES_HISTORY_DAYS,
    missingDays: Math.max(0, MIN_SALES_HISTORY_DAYS - historyDays),
  }
}

/** Units sold for one product within the trailing `days` window. */
export function unitsSoldWithin(history: SalesHistory, productId: string, days: number, now: number): number {
  const cutoff = dayString(startOfDay(now) - (days - 1) * DAY_MS)
  return history.rows
    .filter((row) => row.productId === productId && row.day >= cutoff)
    .reduce((sum, row) => sum + Math.max(0, row.unitsSold), 0)
}

/** Units per day over the trailing 30 days. `null` while history is too short. */
export function productVelocity(history: SalesHistory, productId: string, now: number): number | null {
  if (!history.sufficient) return null
  return round(unitsSoldWithin(history, productId, MIN_SALES_HISTORY_DAYS, now) / MIN_SALES_HISTORY_DAYS, 4)
}

export function reorderPoint(velocity: number, leadTimeDays = DEFAULT_LEAD_TIME_DAYS): number {
  const leadTimeDemand = velocity * leadTimeDays
  return round(leadTimeDemand * (1 + SAFETY_STOCK_RATIO), 2)
}

/** Groups variant rows into the product grain that sales analytics use. */
export function aggregateProductStock(items: readonly InventoryItem[]): readonly ProductStock[] {
  const grouped = new Map<string, InventoryItem[]>()
  for (const item of items) {
    const bucket = grouped.get(item.productId) ?? []
    bucket.push(item)
    grouped.set(item.productId, bucket)
  }
  return [...grouped.entries()].map(([productId, variants]) => {
    const quantities = variants.flatMap((variant) => variant.quantity === null ? [] : [Math.max(0, variant.quantity)])
    const values = variants.flatMap((variant) => variant.value === null ? [] : [variant.value])
    const prices = variants.flatMap((variant) => variant.price === null ? [] : [variant.price])
    const first = variants[0]
    return {
      productId,
      title: first?.title ?? `Product ${productId}`,
      category: first?.category ?? null,
      vendor: first?.vendor ?? null,
      variantCount: variants.length,
      quantity: quantities.length > 0 ? quantities.reduce((sum, value) => sum + value, 0) : null,
      value: values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0), 2) : null,
      averagePrice: prices.length > 0 ? round(prices.reduce((sum, value) => sum + value, 0) / prices.length, 2) : null,
      currency: first?.currency ?? null,
      tracked: variants.some((variant) => variant.tracked),
    }
  }).sort((left, right) => left.productId.localeCompare(right.productId))
}

/**
 * Per-variant days of cover. Product-grain sales cannot be split across
 * variants without inventing an allocation, so multi-variant products report
 * `variant_sales_unavailable` rather than a fabricated per-variant number.
 */
export function variantDaysOfCover(item: InventoryItem, variantCount: number, history: SalesHistory, now: number): DaysOfCover {
  if (!history.sufficient) {
    return { status: 'insufficient_data', reason: 'sales_history', message: `Awaiting ${history.missingDays} more day${history.missingDays === 1 ? '' : 's'} of sales history.` }
  }
  if (item.quantity === null || !item.tracked) return { status: 'insufficient_data', reason: 'no_stock_signal', message: 'Shopify returned no tracked quantity for this variant.' }
  if (variantCount > 1) return { status: 'insufficient_data', reason: 'variant_sales_unavailable', message: 'Shopify reports sales per product, so cover cannot be split across this product\u2019s variants.' }
  const velocity = productVelocity(history, item.productId, now)
  if (velocity === null || velocity <= 0) return { status: 'insufficient_data', reason: 'no_sales', message: 'No units sold in the last 30 days, so cover is unlimited rather than measurable.' }
  return { status: 'available', days: round(item.quantity / velocity, 1), velocity }
}

export type DeadStockItem = Readonly<{ productId: string; title: string; category: string | null; quantity: number; value: number | null; daysWithoutSale: number; currency: string | null }>
export type DeadStockResult =
  | Readonly<{ status: 'available'; items: readonly DeadStockItem[]; totalStuckValue: number | null; currency: string | null; windowDays: number; message: string }>
  | Readonly<{ status: 'insufficient_data'; message: string }>

export function deadStock(products: readonly ProductStock[], history: SalesHistory, now: number): DeadStockResult {
  if (!history.sufficient) return { status: 'insufficient_data', message: insufficientMessage(history) }
  const windows = DEAD_STOCK_WINDOWS.filter((window) => window <= history.historyDays)
  const windowDays = windows[0] ?? MIN_SALES_HISTORY_DAYS
  const items: DeadStockItem[] = []
  for (const product of products) {
    if (product.quantity === null || product.quantity <= 0) continue
    if (unitsSoldWithin(history, product.productId, windowDays, now) > 0) continue
    items.push({ productId: product.productId, title: product.title, category: product.category, quantity: product.quantity, value: product.value, daysWithoutSale: windowDays, currency: product.currency })
  }
  const valued = items.filter((item) => item.value !== null)
  const sorted = [...items].sort((left, right) => (right.value ?? 0) - (left.value ?? 0) || right.quantity - left.quantity)
  return {
    status: 'available',
    items: sorted,
    totalStuckValue: valued.length > 0 ? round(valued.reduce((sum, item) => sum + (item.value ?? 0), 0), 2) : null,
    currency: sorted[0]?.currency ?? null,
    windowDays,
    message: sorted.length === 0 ? 'All items moving well \u2014 every stocked product sold in this window.' : `${sorted.length} product${sorted.length === 1 ? '' : 's'} held stock with no sale in ${windowDays} days.`,
  }
}

export type ReorderItem = Readonly<{ productId: string; title: string; currentStock: number; velocity: number; reorderPoint: number; suggestedQuantity: number; daysOfCover: number | null; leadTimeDays: number; currency: string | null }>
export type ReorderResult =
  | Readonly<{ status: 'available'; items: readonly ReorderItem[]; leadTimeDays: number; safetyStockRatio: number; message: string }>
  | Readonly<{ status: 'insufficient_data'; message: string }>

export function reorderRecommendations(products: readonly ProductStock[], history: SalesHistory, now: number, leadTimeDays = DEFAULT_LEAD_TIME_DAYS): ReorderResult {
  if (!history.sufficient) return { status: 'insufficient_data', message: insufficientMessage(history) }
  const items: ReorderItem[] = []
  for (const product of products) {
    if (product.quantity === null) continue
    const velocity = productVelocity(history, product.productId, now)
    if (velocity === null || velocity <= 0) continue
    const point = reorderPoint(velocity, leadTimeDays)
    if (product.quantity > point) continue
    // Bring stock back to 30 days of demand plus the same safety buffer, then
    // subtract what is already on hand. Never below one unit.
    const target = velocity * MIN_SALES_HISTORY_DAYS * (1 + SAFETY_STOCK_RATIO)
    items.push({
      productId: product.productId,
      title: product.title,
      currentStock: product.quantity,
      velocity,
      reorderPoint: point,
      suggestedQuantity: Math.max(1, Math.ceil(target - product.quantity)),
      daysOfCover: velocity > 0 ? round(product.quantity / velocity, 1) : null,
      leadTimeDays,
      currency: product.currency,
    })
  }
  const sorted = [...items].sort((left, right) => (left.daysOfCover ?? 0) - (right.daysOfCover ?? 0))
  return {
    status: 'available',
    items: sorted,
    leadTimeDays,
    safetyStockRatio: SAFETY_STOCK_RATIO,
    message: sorted.length === 0 ? 'Stock levels healthy \u2014 nothing is at or below its reorder point.' : `${sorted.length} product${sorted.length === 1 ? '' : 's'} at or below the ${leadTimeDays}-day reorder point.`,
  }
}

export type OverstockItem = Readonly<{ productId: string; title: string; currentStock: number; velocity: number; daysOfCover: number; excessUnits: number; excessValue: number | null; currency: string | null; suggestedAction: string }>
export type OverstockResult =
  | Readonly<{ status: 'available'; items: readonly OverstockItem[]; totalExcessValue: number | null; currency: string | null; coverThresholdDays: number; message: string }>
  | Readonly<{ status: 'insufficient_data'; message: string }>

export function overstockAlerts(products: readonly ProductStock[], history: SalesHistory, now: number): OverstockResult {
  if (!history.sufficient) return { status: 'insufficient_data', message: insufficientMessage(history) }
  const items: OverstockItem[] = []
  for (const product of products) {
    if (product.quantity === null || product.quantity <= 0) continue
    const velocity = productVelocity(history, product.productId, now)
    // Zero-velocity stock is dead stock, not overstock; counting it in both
    // places would double-report the same tied-up money.
    if (velocity === null || velocity <= 0) continue
    const cover = product.quantity / velocity
    if (cover <= OVERSTOCK_COVER_DAYS) continue
    const excessUnits = Math.floor(product.quantity - velocity * OVERSTOCK_COVER_DAYS)
    if (excessUnits <= 0) continue
    items.push({
      productId: product.productId,
      title: product.title,
      currentStock: product.quantity,
      velocity,
      daysOfCover: round(cover, 1),
      excessUnits,
      excessValue: product.averagePrice === null ? null : round(product.averagePrice * excessUnits, 2),
      currency: product.currency,
      suggestedAction: 'Consider a sale or promotion to release the tied-up cash.',
    })
  }
  const valued = items.filter((item) => item.excessValue !== null)
  const sorted = [...items].sort((left, right) => (right.excessValue ?? 0) - (left.excessValue ?? 0) || right.excessUnits - left.excessUnits)
  return {
    status: 'available',
    items: sorted,
    totalExcessValue: valued.length > 0 ? round(valued.reduce((sum, item) => sum + (item.excessValue ?? 0), 0), 2) : null,
    currency: sorted[0]?.currency ?? null,
    coverThresholdDays: OVERSTOCK_COVER_DAYS,
    message: sorted.length === 0 ? 'No excess inventory detected \u2014 nothing carries more than 90 days of cover.' : `${sorted.length} product${sorted.length === 1 ? '' : 's'} hold more than ${OVERSTOCK_COVER_DAYS} days of cover.`,
  }
}

export type TurnoverBand = 'fast' | 'medium' | 'slow'
export type TurnoverItem = Readonly<{ productId: string; title: string; unitsSold: number; averageInventory: number; turnover: number; band: TurnoverBand }>
export type TurnoverResult =
  | Readonly<{ status: 'available'; windowDays: number; items: readonly TurnoverItem[]; fast: number; medium: number; slow: number; topMovers: readonly TurnoverItem[]; slowMovers: readonly TurnoverItem[]; message: string }>
  | Readonly<{ status: 'insufficient_data'; message: string }>

/** Annualized turnover: units sold in the observed window, scaled to a year, over current stock. */
export function stockTurnover(products: readonly ProductStock[], history: SalesHistory, now: number): TurnoverResult {
  if (!history.sufficient) return { status: 'insufficient_data', message: insufficientMessage(history) }
  const windowDays = Math.min(365, history.historyDays)
  const items: TurnoverItem[] = []
  for (const product of products) {
    if (product.quantity === null || product.quantity <= 0) continue
    const unitsSold = unitsSoldWithin(history, product.productId, windowDays, now)
    const annualized = unitsSold * (365 / windowDays)
    const turnover = round(annualized / product.quantity, 2)
    items.push({ productId: product.productId, title: product.title, unitsSold, averageInventory: product.quantity, turnover, band: turnover > 4 ? 'fast' : turnover >= 2 ? 'medium' : 'slow' })
  }
  if (items.length === 0) return { status: 'insufficient_data', message: 'No product currently holds stock, so turnover cannot be calculated.' }
  const sorted = [...items].sort((left, right) => right.turnover - left.turnover)
  return {
    status: 'available',
    windowDays,
    items: sorted,
    fast: sorted.filter((item) => item.band === 'fast').length,
    medium: sorted.filter((item) => item.band === 'medium').length,
    slow: sorted.filter((item) => item.band === 'slow').length,
    topMovers: sorted.slice(0, 5),
    slowMovers: [...sorted].reverse().slice(0, 5),
    message: `Turnover annualized from ${windowDays} days of real sales.`,
  }
}

export type RestockPrediction = Readonly<{ productId: string; title: string; currentStock: number; velocity: number; trendPercent: number | null; predictedReorderDate: string; daysUntilReorder: number; confidence: 'low' | 'medium' | 'high'; basis: string }>
export type PredictiveRestockingResult =
  | Readonly<{ status: 'available'; items: readonly RestockPrediction[]; method: string; message: string }>
  | Readonly<{ status: 'insufficient_data'; message: string }>

/**
 * Deterministic prediction: when will stock fall to the reorder point at the
 * observed 30-day velocity, adjusted by the 30-vs-previous-30 trend when at
 * least 60 days of history exist. Confidence reflects how much history backs it.
 */
export function predictiveRestocking(products: readonly ProductStock[], history: SalesHistory, now: number, leadTimeDays = DEFAULT_LEAD_TIME_DAYS): PredictiveRestockingResult {
  if (!history.sufficient) return { status: 'insufficient_data', message: insufficientMessage(history) }
  const items: RestockPrediction[] = []
  for (const product of products) {
    if (product.quantity === null) continue
    const velocity = productVelocity(history, product.productId, now)
    if (velocity === null || velocity <= 0) continue
    const trendPercent = velocityTrendPercent(history, product.productId, now)
    const adjusted = trendPercent === null ? velocity : Math.max(velocity * 0.25, velocity * (1 + trendPercent / 100))
    const point = reorderPoint(velocity, leadTimeDays)
    const daysUntilReorder = Math.max(0, Math.round((product.quantity - point) / adjusted))
    items.push({
      productId: product.productId,
      title: product.title,
      currentStock: product.quantity,
      velocity,
      trendPercent,
      predictedReorderDate: dayString(startOfDay(now) + daysUntilReorder * DAY_MS),
      daysUntilReorder,
      confidence: history.historyDays >= 90 && history.observedDays >= 12 ? 'high' : history.historyDays >= 60 ? 'medium' : 'low',
      basis: trendPercent === null ? '30-day velocity' : '30-day velocity adjusted for the 30-vs-previous-30 trend',
    })
  }
  const sorted = [...items].sort((left, right) => left.daysUntilReorder - right.daysUntilReorder)
  return {
    status: 'available',
    items: sorted,
    method: 'velocity_trend_projection',
    message: sorted.length === 0 ? 'No product has enough recent sales to project a reorder date.' : `${sorted.length} product${sorted.length === 1 ? '' : 's'} projected against the ${leadTimeDays}-day reorder point.`,
  }
}

/** Percentage change between the last 30 days and the 30 before them. */
export function velocityTrendPercent(history: SalesHistory, productId: string, now: number): number | null {
  if (history.historyDays < MIN_SALES_HISTORY_DAYS * 2) return null
  const recent = unitsSoldWithin(history, productId, 30, now)
  const previous = unitsSoldWithin(history, productId, 60, now) - recent
  if (previous <= 0) return null
  return round(((recent - previous) / previous) * 100, 1)
}

export type SeasonalResult =
  | Readonly<{ status: 'available'; months: readonly Readonly<{ month: string; averageUnits: number }>[]; peakMonth: string | null; troughMonth: string | null; message: string }>
  | Readonly<{ status: 'insufficient_data'; message: string; snapshotDays: number; requiredDays: number }>

/**
 * Seasonality is only claimed with a full year of observed snapshots. With
 * less, the honest answer is that the feature is not available yet.
 */
export function seasonalTrends(snapshotDays: number, monthlyUnits: readonly Readonly<{ month: string; averageUnits: number }>[]): SeasonalResult {
  if (snapshotDays < SEASONAL_MIN_HISTORY_DAYS || monthlyUnits.length < 12) {
    return { status: 'insufficient_data', message: 'Available after 12 months of data. ProfitPilot records one inventory snapshot per sync, so this activates once a year of history exists.', snapshotDays, requiredDays: SEASONAL_MIN_HISTORY_DAYS }
  }
  const sorted = [...monthlyUnits].sort((left, right) => right.averageUnits - left.averageUnits)
  return { status: 'available', months: monthlyUnits, peakMonth: sorted[0]?.month ?? null, troughMonth: sorted[sorted.length - 1]?.month ?? null, message: 'Seasonal pattern derived from 12 months of recorded snapshots.' }
}

function insufficientMessage(history: SalesHistory): string {
  if (history.historyDays === 0) return 'Awaiting sales history. Sync your Shopify orders to activate this insight.'
  return `Awaiting ${history.missingDays} more day${history.missingDays === 1 ? '' : 's'} of sales history (${history.historyDays} of ${MIN_SALES_HISTORY_DAYS} recorded).`
}

export function startOfDay(at: number): number { return Date.parse(`${new Date(at).toISOString().slice(0, 10)}T00:00:00Z`) }
export function dayString(at: number): string { return new Date(at).toISOString().slice(0, 10) }
function round(value: number, precision = 2): number { const factor = 10 ** precision; return Math.round(value * factor) / factor }
