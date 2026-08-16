import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import { planAtLeast } from '@profitpilot/ai'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { aggregateProductStock, buildSalesHistory, variantDaysOfCover } from './inventory-velocity.js'
import type { DaysOfCover, ProductSalesDay, SalesHistory } from './inventory-velocity.js'

/**
 * Real Shopify inventory, assembled from three already-synced sources:
 *
 *  - `catalog_products.payload.variants[]` — SKU, price, image, and the
 *    variant's `inventory_quantity` / `inventory_item_id` / tracking flags.
 *  - `sync_records` where `module = 'inventory'` and the record is a level —
 *    the authoritative per-location `available` quantity.
 *  - `sync_records` where `module = 'inventory'` and the record is a location —
 *    location names, persisted by the sync source.
 *
 * Nothing here estimates, back-fills, or invents a quantity. A variant with no
 * usable Shopify quantity is reported as such rather than defaulted to zero.
 */

/** Shopify caps the `location_ids` filter; mirrored from the sync source. */
export const INVENTORY_LOCATION_QUERY_LIMIT = 50
const LOCATION_RECORD_PREFIX = 'location:'
export const DEFAULT_LOW_STOCK_THRESHOLD = 10
const MAX_LOW_STOCK_THRESHOLD = 100_000

export type StockStatus = 'in_stock' | 'low' | 'out' | 'untracked'
export type InventorySort = 'name' | 'stock' | 'value' | 'category' | 'updated' | 'days_of_cover'
/** Where a variant's on-hand number actually came from. */
export type QuantitySource = 'inventory_levels' | 'variant_inventory_quantity' | 'unavailable'

export type InventoryLocation = Readonly<{
  id: string
  name: string | null
  city: string | null
  province: string | null
  country: string | null
  active: boolean | null
  /** False when the location fell outside Shopify's location_ids filter cap. */
  levelsQueried: boolean
}>

export type VariantLocationLevel = Readonly<{
  locationId: string
  locationName: string | null
  available: number
  updatedAt: string | null
}>

export type InventoryItem = Readonly<{
  variantId: string
  productId: string
  inventoryItemId: string | null
  title: string
  variantTitle: string | null
  sku: string | null
  category: string | null
  vendor: string | null
  productStatus: string | null
  imageUrl: string | null
  price: number | null
  currency: string | null
  quantity: number | null
  quantitySource: QuantitySource
  tracked: boolean
  inventoryPolicy: string | null
  status: StockStatus
  value: number | null
  locations: readonly VariantLocationLevel[]
  updatedAt: string | null
  syncedAt: string
}>

/**
 * A table row: the Shopify item plus the Growth+ days-of-cover column. The
 * value is `locked` metadata for Trial/Start so the column can render an
 * upgrade affordance without ever computing a premium number for them.
 */
export type InventoryRowItem = InventoryItem & Readonly<{ daysOfCover: DaysOfCover }>

export type InventoryStats = Readonly<{
  totalSkus: number
  trackedSkus: number
  untrackedSkus: number
  totalUnits: number
  inStockCount: number
  lowStockCount: number
  outOfStockCount: number
  totalValue: number | null
  valuedSkus: number
  currency: string | null
  minStock: number | null
  averageStock: number | null
  maxStock: number | null
  lowStockThreshold: number
}>

export type StockDistribution = Readonly<{ healthy: number; low: number; out: number; untracked: number }>

export type InventoryHealth = Readonly<{
  score: number | null
  grade: string
  label: string
  tone: 'healthy' | 'warning' | 'critical' | 'muted'
  components: readonly Readonly<{ key: string; label: string; score: number; weight: number; detail: string }>[]
  excluded: readonly string[]
}>

export type TopValueItem = Readonly<{ variantId: string; title: string; variantTitle: string | null; quantity: number; value: number }>

export type InventoryCoverage = Readonly<{
  inventorySyncCompleted: boolean
  levelRowCount: number
  locationRowCount: number
  lastSyncedAt: string | null
  catalogSynced: boolean
  locationsTruncated: boolean
  quantitySource: QuantitySource
  explanation: string
}>

/** Free-tier facts. Everything velocity-derived is deliberately absent here. */
export type InventoryBasicInsights = Readonly<{
  topSellingItem:
    | Readonly<{ status: 'available'; productId: string; title: string; unitsSold: number; grossRevenue: number; currency: string | null }>
    | Readonly<{ status: 'insufficient_data'; message: string }>
  itemsNeedingAttention: Readonly<{ count: number; lowStock: number; outOfStock: number }>
  healthGrade: Readonly<{ grade: string; score: number | null; label: string }>
}>

export type LockedInventoryFeature = Readonly<{
  locked: true
  feature: string
  name: string
  required_plan: 'growth' | 'commander'
}>

export type InventoryFilters = Readonly<{
  query: string
  status: StockStatus | ''
  category: string
  vendor: string
  locationId: string
  sort: InventorySort
  direction: 'asc' | 'desc'
  page: number
  limit: number
  lowStockThreshold: number
}>

export type InventoryPageResult = Readonly<{
  plan: PlanTier
  items: readonly InventoryRowItem[]
  stats: InventoryStats
  distribution: StockDistribution
  health: InventoryHealth
  topValueItems: readonly TopValueItem[]
  basicInsights: InventoryBasicInsights
  lockedFeatures: readonly LockedInventoryFeature[]
  tabCounts: Readonly<{ all: number; in_stock: number; low: number; out: number; untracked: number }>
  locations: readonly InventoryLocation[]
  multiLocation: boolean
  categories: readonly string[]
  vendors: readonly string[]
  coverage: InventoryCoverage
  pagination: Readonly<{ page: number; limit: number; total: number; pages: number }>
}>

export type InventoryDataset = Readonly<{
  items: readonly InventoryItem[]
  locations: readonly InventoryLocation[]
  coverage: InventoryCoverage
  topProduct: Readonly<{ productId: string; unitsSold: number; grossRevenue: number }> | null
  currency: string | null
  /** Real per-product daily sales, the only input to every velocity insight. */
  sales: SalesHistory
}>

/**
 * Premium inventory intelligence. PR-A returns these as locked metadata only;
 * the calculations land in PR-B. Declaring the full matrix now keeps the
 * upgrade surface honest and the gating identical to Orders/Customers.
 */
export const INVENTORY_PREMIUM_FEATURES: readonly Readonly<{ feature: string; name: string; minimumPlan: PlanTier }>[] = [
  { feature: 'dead_stock', name: 'Dead Stock Detector', minimumPlan: 'growth' },
  { feature: 'reorder_recommendations', name: 'Reorder Recommendations', minimumPlan: 'growth' },
  { feature: 'stock_turnover', name: 'Stock Turnover Analysis', minimumPlan: 'growth' },
  { feature: 'overstock_alerts', name: 'Overstock Alerts', minimumPlan: 'growth' },
  { feature: 'ai_suggestion', name: 'AI Suggestions', minimumPlan: 'growth' },
  { feature: 'days_of_cover', name: 'Days of Cover', minimumPlan: 'growth' },
  { feature: 'stock_history', name: 'Stock History Chart', minimumPlan: 'growth' },
  { feature: 'predictive_restocking', name: 'Predictive Restocking', minimumPlan: 'commander' },
  { feature: 'seasonal_trends', name: 'Seasonal Trends', minimumPlan: 'commander' },
  { feature: 'auto_reorder', name: 'Auto-Reorder Suggestions', minimumPlan: 'commander' },
  { feature: 'custom_ai_queries', name: 'Custom AI Queries', minimumPlan: 'commander' },
]

type CatalogRow = QueryResultRow & { product_id: string; payload: unknown; synced_at: Date }
type InventoryRow = QueryResultRow & { record_id: string; payload: unknown; synced_at: Date }
type CheckpointRow = QueryResultRow & { cursor: string | null; updated_at: Date }
type ProductSalesRow = QueryResultRow & { product_id: string; units_sold: string | number; gross_revenue: string | number }
type ProductSalesDayRow = QueryResultRow & { product_id: string; day: Date | string; units_sold: string | number; gross_revenue: string | number }
type CurrencyRow = QueryResultRow & { currency: string | null }

export interface InventoryRepository {
  list(storeId: StoreId, threshold?: number): Promise<InventoryDataset>
  get(storeId: StoreId, variantId: string, threshold?: number): Promise<InventoryItem | null>
}

export class PostgresInventoryRepository implements InventoryRepository {
  public constructor(private readonly executor: SqlExecutor, private readonly now: () => number = () => Date.now()) {}

  public list(storeId: StoreId, threshold = DEFAULT_LOW_STOCK_THRESHOLD): Promise<InventoryDataset> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const [catalogResult, inventoryResult, checkpointResult, salesResult, salesHistoryResult, currencyResult] = await Promise.all([
        client.query<CatalogRow>(
          `SELECT product_id, payload, synced_at
           FROM catalog_products
           WHERE store_id = $1
           ORDER BY product_id`,
          [storeId],
        ),
        client.query<InventoryRow>(
          `SELECT record_id, payload, synced_at
           FROM sync_records
           WHERE store_id = $1 AND module = 'inventory'`,
          [storeId],
        ),
        client.query<CheckpointRow>(
          `SELECT cursor, updated_at
           FROM sync_checkpoints
           WHERE store_id = $1 AND module = 'inventory'
           LIMIT 1`,
          [storeId],
        ),
        client.query<ProductSalesRow>(
          `SELECT product_id, SUM(units_sold) AS units_sold, SUM(gross_revenue) AS gross_revenue
           FROM analytics_product_sales_daily
           WHERE store_id = $1
           GROUP BY product_id
           ORDER BY SUM(units_sold) DESC, SUM(gross_revenue) DESC
           LIMIT 1`,
          [storeId],
        ),
        // Daily per-product sales power every velocity insight. 400 days keeps
        // a full year plus the trailing window used for trend comparisons.
        client.query<ProductSalesDayRow>(
          `SELECT product_id, day, units_sold, gross_revenue
           FROM analytics_product_sales_daily
           WHERE store_id = $1 AND day >= (CURRENT_DATE - 400)
           ORDER BY day`,
          [storeId],
        ),
        client.query<CurrencyRow>(
          `SELECT payload->>'currency' AS currency
           FROM sync_records
           WHERE store_id = $1 AND module = 'orders' AND payload->>'currency' IS NOT NULL
           ORDER BY COALESCE(payload->>'created_at', payload->>'processed_at', '') DESC
           LIMIT 1`,
          [storeId],
        ),
      ])
      return buildInventoryDataset({
        catalog: catalogResult.rows,
        inventory: inventoryResult.rows,
        checkpoint: checkpointResult.rows[0] ?? null,
        topSales: salesResult.rows[0] ?? null,
        salesHistory: salesHistoryResult.rows.map(toProductSalesDay),
        currency: normalizeCurrency(currencyResult.rows[0]?.currency),
        threshold,
        now: this.now(),
      })
    })
  }

  public async get(storeId: StoreId, variantId: string, threshold = DEFAULT_LOW_STOCK_THRESHOLD): Promise<InventoryItem | null> {
    const dataset = await this.list(storeId, threshold)
    return dataset.items.find((item) => item.variantId === variantId) ?? null
  }
}

export function buildInventoryDataset(input: Readonly<{
  catalog: readonly CatalogRow[]
  inventory: readonly InventoryRow[]
  checkpoint: Readonly<{ cursor: string | null; updated_at: Date }> | null
  topSales: ProductSalesRow | null
  salesHistory?: readonly ProductSalesDay[]
  currency: string | null
  threshold?: number
  now?: number
}>): InventoryDataset {
  const threshold = normalizeThreshold(input.threshold)
  const locations: InventoryLocation[] = []
  const levelsByItem = new Map<string, VariantLocationLevel[]>()
  let lastSyncedAt: number | null = null

  for (const row of input.inventory) {
    const payload = objectValue(unwrapLegacy(row.payload))
    if (!payload) continue
    const synced = row.synced_at instanceof Date ? row.synced_at.getTime() : Date.parse(String(row.synced_at))
    if (Number.isFinite(synced)) lastSyncedAt = lastSyncedAt === null ? synced : Math.max(lastSyncedAt, synced)
    if (row.record_id.startsWith(LOCATION_RECORD_PREFIX) || payload.record_kind === 'location') {
      const id = scalarString(payload.location_id ?? payload.id)?.replace(LOCATION_RECORD_PREFIX, '')
      if (!id) continue
      locations.push({
        id,
        name: nullableString(payload.name),
        city: nullableString(payload.city),
        province: nullableString(payload.province),
        country: nullableString(payload.country),
        active: typeof payload.active === 'boolean' ? payload.active : null,
        levelsQueried: payload.levels_queried !== false,
      })
      continue
    }
    const inventoryItemId = scalarString(payload.inventory_item_id)
    const locationId = scalarString(payload.location_id)
    const available = integerOrNull(payload.available)
    if (!inventoryItemId || available === null) continue
    const bucket = levelsByItem.get(inventoryItemId) ?? []
    bucket.push({ locationId: locationId ?? 'unknown', locationName: null, available, updatedAt: isoDateTime(payload.updated_at) })
    levelsByItem.set(inventoryItemId, bucket)
  }

  const locationNames = new Map(locations.map((location) => [location.id, location.name]))
  const items: InventoryItem[] = []
  for (const row of input.catalog) {
    const product = objectValue(unwrapLegacy(row.payload))
    if (!product) continue
    const syncedAt = row.synced_at instanceof Date ? row.synced_at : new Date(row.synced_at)
    for (const variant of arrayValue(product.variants)) {
      const item = normalizeInventoryItem(row.product_id, product, variant, levelsByItem, locationNames, syncedAt, input.currency, threshold)
      if (item) items.push(item)
    }
  }

  const usesLevels = items.some((item) => item.quantitySource === 'inventory_levels')
  const usesVariantField = items.some((item) => item.quantitySource === 'variant_inventory_quantity')
  const levelRowCount = [...levelsByItem.values()].reduce((total, levels) => total + levels.length, 0)
  const inventorySyncCompleted = input.checkpoint !== null && input.checkpoint.cursor === null
  const locationsTruncated = locations.some((location) => !location.levelsQueried)
  const quantitySource: QuantitySource = usesLevels ? 'inventory_levels' : usesVariantField ? 'variant_inventory_quantity' : 'unavailable'

  return {
    items,
    locations: [...locations].sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id)),
    coverage: {
      inventorySyncCompleted,
      levelRowCount,
      locationRowCount: locations.length,
      lastSyncedAt: lastSyncedAt === null ? null : new Date(lastSyncedAt).toISOString(),
      catalogSynced: input.catalog.length > 0,
      locationsTruncated,
      quantitySource,
      explanation: coverageExplanation({ catalogSynced: input.catalog.length > 0, levelRowCount, inventorySyncCompleted, quantitySource, locationsTruncated, locationCount: locations.length }),
    },
    topProduct: input.topSales
      ? { productId: input.topSales.product_id, unitsSold: Math.round(Number(input.topSales.units_sold) || 0), grossRevenue: round(Number(input.topSales.gross_revenue) || 0) }
      : null,
    currency: input.currency,
    sales: buildSalesHistory(input.salesHistory ?? [], input.now ?? Date.now()),
  }
}

function toProductSalesDay(row: ProductSalesDayRow): ProductSalesDay {
  const day = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10)
  return { productId: String(row.product_id), day, unitsSold: Math.round(Number(row.units_sold) || 0), grossRevenue: Number(row.gross_revenue) || 0 }
}

function normalizeInventoryItem(
  productId: string,
  product: Readonly<Record<string, unknown>>,
  rawVariant: unknown,
  levelsByItem: ReadonlyMap<string, readonly VariantLocationLevel[]>,
  locationNames: ReadonlyMap<string, string | null>,
  syncedAt: Date,
  currency: string | null,
  threshold: number,
): InventoryItem | null {
  const variant = objectValue(rawVariant)
  if (!variant) return null
  const variantId = scalarString(variant.id)
  if (!variantId) return null
  const inventoryItemId = scalarString(variant.inventory_item_id)
  const management = nullableString(variant.inventory_management)
  // Shopify only tracks a variant when inventory_management is set. Untracked
  // variants have no meaningful stock number and must never be counted as
  // "out of stock" — that would invent a stockout the merchant does not have.
  const tracked = management !== null && management.toLowerCase() !== 'null'
  const rawLevels = inventoryItemId ? levelsByItem.get(inventoryItemId) ?? [] : []
  const locations = rawLevels
    .map((level) => ({ ...level, locationName: locationNames.get(level.locationId) ?? null }))
    .sort((left, right) => (left.locationName ?? left.locationId).localeCompare(right.locationName ?? right.locationId))

  const variantQuantity = integerOrNull(variant.inventory_quantity)
  let quantity: number | null = null
  let quantitySource: QuantitySource = 'unavailable'
  if (locations.length > 0) {
    quantity = locations.reduce((total, level) => total + level.available, 0)
    quantitySource = 'inventory_levels'
  } else if (variantQuantity !== null) {
    quantity = variantQuantity
    quantitySource = 'variant_inventory_quantity'
  }

  const price = money(variant.price)
  const status = classifyStock(quantity, tracked, threshold)
  const updatedAt = locations.reduce<string | null>((latest, level) => {
    if (!level.updatedAt) return latest
    return latest === null || level.updatedAt > latest ? level.updatedAt : latest
  }, null)

  return {
    variantId,
    productId: scalarString(product.id) ?? productId,
    inventoryItemId,
    title: nullableString(product.title) ?? `Product ${productId}`,
    variantTitle: normalizeVariantTitle(variant.title),
    sku: nullableString(variant.sku),
    category: nullableString(product.product_type),
    vendor: nullableString(product.vendor),
    productStatus: nullableString(product.status)?.toLowerCase() ?? null,
    imageUrl: variantImageUrl(product, variant),
    price,
    currency,
    quantity,
    quantitySource,
    tracked,
    inventoryPolicy: nullableString(variant.inventory_policy),
    status,
    value: price !== null && quantity !== null && quantity > 0 ? round(price * quantity) : price !== null && quantity !== null ? 0 : null,
    locations,
    updatedAt,
    syncedAt: Number.isFinite(syncedAt.valueOf()) ? syncedAt.toISOString() : new Date(0).toISOString(),
  }
}

export function classifyStock(quantity: number | null, tracked: boolean, threshold = DEFAULT_LOW_STOCK_THRESHOLD): StockStatus {
  // An untracked variant, or one Shopify returned no quantity for, is never
  // reported as a stockout.
  if (!tracked || quantity === null) return 'untracked'
  if (quantity <= 0) return 'out'
  if (quantity < threshold) return 'low'
  return 'in_stock'
}

/**
 * Real inventory health, computed only from inventory signals. This replaces
 * the store-wide revenue heuristic that previously rendered a misleading
 * 100/100 on an empty page. Component weights renormalize over the components
 * that actually have data, so an absent signal can never inflate the score.
 */
export function inventoryHealth(items: readonly InventoryItem[], threshold = DEFAULT_LOW_STOCK_THRESHOLD): InventoryHealth {
  const tracked = items.filter((item) => item.status !== 'untracked')
  if (items.length === 0) return { score: null, grade: '—', label: 'No inventory data', tone: 'muted', components: [], excluded: ['stock_coverage', 'low_stock_ratio', 'tracking_coverage'] }

  const components: Array<Readonly<{ key: string; label: string; score: number; weight: number; detail: string }>> = []
  const excluded: string[] = []

  if (tracked.length > 0) {
    const inStock = tracked.filter((item) => item.status === 'in_stock' || item.status === 'low').length
    components.push({ key: 'stock_coverage', label: 'Items in stock', score: percentage(inStock, tracked.length), weight: 0.5, detail: `${inStock} of ${tracked.length} tracked items have stock on hand` })
    const healthy = tracked.filter((item) => item.status === 'in_stock').length
    components.push({ key: 'low_stock_ratio', label: 'Above low-stock threshold', score: percentage(healthy, tracked.length), weight: 0.3, detail: `${healthy} of ${tracked.length} tracked items are at or above ${threshold} units` })
  } else {
    excluded.push('stock_coverage', 'low_stock_ratio')
  }

  const trackingCoverage = percentage(tracked.length, items.length)
  components.push({ key: 'tracking_coverage', label: 'Inventory tracking enabled', score: trackingCoverage, weight: 0.2, detail: `${tracked.length} of ${items.length} variants have Shopify inventory tracking enabled` })

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0)
  if (totalWeight === 0) return { score: null, grade: '—', label: 'No inventory data', tone: 'muted', components, excluded }
  const score = Math.round(components.reduce((sum, component) => sum + component.score * component.weight, 0) / totalWeight)
  const tone = score >= 75 ? 'healthy' : score >= 50 ? 'warning' : 'critical'
  return {
    score,
    grade: score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D',
    label: tone === 'healthy' ? 'Healthy' : tone === 'warning' ? 'Needs attention' : 'Critical',
    tone,
    components,
    excluded,
  }
}

export function inventoryStats(items: readonly InventoryItem[], currency: string | null, threshold = DEFAULT_LOW_STOCK_THRESHOLD): InventoryStats {
  const tracked = items.filter((item) => item.status !== 'untracked')
  const quantities = tracked.flatMap((item) => item.quantity === null ? [] : [item.quantity])
  const valued = items.filter((item) => item.value !== null)
  const totalValue = valued.length > 0 ? round(valued.reduce((sum, item) => sum + (item.value ?? 0), 0)) : null
  return {
    totalSkus: items.length,
    trackedSkus: tracked.length,
    untrackedSkus: items.length - tracked.length,
    totalUnits: quantities.reduce((sum, quantity) => sum + Math.max(0, quantity), 0),
    inStockCount: items.filter((item) => item.status === 'in_stock').length,
    lowStockCount: items.filter((item) => item.status === 'low').length,
    outOfStockCount: items.filter((item) => item.status === 'out').length,
    totalValue,
    valuedSkus: valued.length,
    currency,
    minStock: quantities.length > 0 ? Math.min(...quantities) : null,
    averageStock: quantities.length > 0 ? round(quantities.reduce((sum, quantity) => sum + quantity, 0) / quantities.length) : null,
    maxStock: quantities.length > 0 ? Math.max(...quantities) : null,
    lowStockThreshold: threshold,
  }
}

export function stockDistribution(items: readonly InventoryItem[]): StockDistribution {
  return {
    healthy: items.filter((item) => item.status === 'in_stock').length,
    low: items.filter((item) => item.status === 'low').length,
    out: items.filter((item) => item.status === 'out').length,
    untracked: items.filter((item) => item.status === 'untracked').length,
  }
}

export function topValueItems(items: readonly InventoryItem[], limit = 5): readonly TopValueItem[] {
  return items
    .flatMap((item) => item.value !== null && item.value > 0 ? [{ variantId: item.variantId, title: item.title, variantTitle: item.variantTitle, quantity: item.quantity ?? 0, value: item.value }] : [])
    .sort((left, right) => right.value - left.value)
    .slice(0, limit)
}

function basicInsights(items: readonly InventoryItem[], dataset: InventoryDataset, health: InventoryHealth): InventoryBasicInsights {
  const stats = { low: items.filter((item) => item.status === 'low').length, out: items.filter((item) => item.status === 'out').length }
  const top = dataset.topProduct
  const match = top ? items.find((item) => item.productId === top.productId) : undefined
  return {
    topSellingItem: top && top.unitsSold > 0
      ? { status: 'available', productId: top.productId, title: match?.title ?? `Product ${top.productId}`, unitsSold: top.unitsSold, grossRevenue: top.grossRevenue, currency: dataset.currency }
      : { status: 'insufficient_data', message: 'Awaiting more sales history. Your top seller appears once orders are synced.' },
    itemsNeedingAttention: { count: stats.low + stats.out, lowStock: stats.low, outOfStock: stats.out },
    healthGrade: { grade: health.grade, score: health.score, label: health.label },
  }
}

export function lockedInventoryFeatures(plan: PlanTier): readonly LockedInventoryFeature[] {
  return INVENTORY_PREMIUM_FEATURES
    .filter((definition) => !planAtLeast(plan, definition.minimumPlan))
    .map((definition) => ({ locked: true, feature: definition.feature, name: definition.name, required_plan: definition.minimumPlan === 'commander' ? 'commander' : 'growth' }))
}

export function filterInventory(dataset: InventoryDataset, filters: InventoryFilters, plan: PlanTier, now = Date.now()): InventoryPageResult {
  const all = dataset.items
  const health = inventoryHealth(all, filters.lowStockThreshold)
  const query = filters.query.trim().toLowerCase()
  const matches = all.filter((item) => {
    if (query && !searchableInventory(item).some((value) => value.toLowerCase().includes(query))) return false
    if (filters.status && item.status !== filters.status) return false
    if (filters.category && (item.category ?? '').toLowerCase() !== filters.category.toLowerCase()) return false
    if (filters.vendor && (item.vendor ?? '').toLowerCase() !== filters.vendor.toLowerCase()) return false
    if (filters.locationId && !item.locations.some((level) => level.locationId === filters.locationId)) return false
    return true
  })
  // Days of cover is a Growth+ calculation. Lower plans receive locked
  // metadata for the column and never a computed value.
  const coverUnlocked = planAtLeast(plan, 'growth')
  const variantCounts = new Map(aggregateProductStock(all).map((product) => [product.productId, product.variantCount]))
  const rows: readonly InventoryRowItem[] = matches.map((item) => ({
    ...item,
    daysOfCover: coverUnlocked
      ? variantDaysOfCover(item, variantCounts.get(item.productId) ?? 1, dataset.sales, now)
      : { status: 'locked', required_plan: 'growth' },
  }))
  const sorted = [...rows].sort((left, right) => compareInventory(left, right, filters.sort, filters.direction))
  const pages = Math.max(1, Math.ceil(sorted.length / filters.limit))
  const page = Math.min(filters.page, pages)
  const start = (page - 1) * filters.limit

  return {
    plan,
    items: sorted.slice(start, start + filters.limit),
    stats: inventoryStats(all, dataset.currency, filters.lowStockThreshold),
    distribution: stockDistribution(all),
    health,
    topValueItems: topValueItems(all),
    basicInsights: basicInsights(all, dataset, health),
    lockedFeatures: lockedInventoryFeatures(plan),
    tabCounts: {
      all: all.length,
      in_stock: all.filter((item) => item.status === 'in_stock').length,
      low: all.filter((item) => item.status === 'low').length,
      out: all.filter((item) => item.status === 'out').length,
      untracked: all.filter((item) => item.status === 'untracked').length,
    },
    locations: dataset.locations,
    multiLocation: dataset.locations.length > 1 || new Set(all.flatMap((item) => item.locations.map((level) => level.locationId))).size > 1,
    categories: [...new Set(all.flatMap((item) => item.category ? [item.category] : []))].sort((left, right) => left.localeCompare(right)),
    vendors: [...new Set(all.flatMap((item) => item.vendor ? [item.vendor] : []))].sort((left, right) => left.localeCompare(right)),
    coverage: dataset.coverage,
    pagination: { page, limit: filters.limit, total: sorted.length, pages },
  }
}

export function parseInventoryFilters(query: Readonly<Record<string, unknown>>): InventoryFilters {
  return {
    query: bounded(query.q, 200),
    status: isStockStatus(query.status) ? query.status : '',
    category: bounded(query.category, 120),
    vendor: bounded(query.vendor, 120),
    locationId: bounded(query.locationId, 80),
    sort: isInventorySort(query.sort) ? query.sort : 'name',
    direction: query.direction === 'desc' ? 'desc' : 'asc',
    page: boundedInteger(query.page, 1, 100_000, 1),
    limit: boundedInteger(query.limit, 1, 100, 20),
    lowStockThreshold: boundedInteger(query.lowStockThreshold, 1, MAX_LOW_STOCK_THRESHOLD, DEFAULT_LOW_STOCK_THRESHOLD),
  }
}

function coverageExplanation(input: Readonly<{ catalogSynced: boolean; levelRowCount: number; inventorySyncCompleted: boolean; quantitySource: QuantitySource; locationsTruncated: boolean; locationCount: number }>): string {
  if (!input.catalogSynced) return 'No Shopify products are synced yet. Sync your products to see stock levels.'
  if (input.locationCount === 0 && input.levelRowCount === 0) {
    return input.inventorySyncCompleted
      ? 'Shopify returned no inventory locations for this store, so per-location stock is unavailable. Stock shown comes from each product variant.'
      : 'Inventory has not been synced yet. Stock shown comes from each product variant.'
  }
  if (input.quantitySource === 'variant_inventory_quantity') return 'Stock is read from each product variant because Shopify returned no matching inventory levels.'
  if (input.locationsTruncated) return `Stock is aggregated across the first ${INVENTORY_LOCATION_QUERY_LIMIT} Shopify locations. Additional locations are listed but their levels were not requested.`
  return 'Stock levels come directly from your Shopify inventory locations.'
}

function searchableInventory(item: InventoryItem): readonly string[] {
  return [item.title, item.variantTitle, item.sku, item.category, item.vendor, item.variantId, item.productId].filter((value): value is string => Boolean(value))
}

function compareInventory(left: InventoryRowItem, right: InventoryRowItem, sort: InventorySort, direction: 'asc' | 'desc'): number {
  let value = 0
  if (sort === 'days_of_cover') {
    // "Insufficient data" rows sink to the bottom in both directions rather
    // than being ranked as if their cover were zero.
    const leftDays = coverDays(left)
    const rightDays = coverDays(right)
    if (leftDays === null && rightDays !== null) return 1
    if (rightDays === null && leftDays !== null) return -1
    value = (leftDays ?? 0) - (rightDays ?? 0)
  }
  else if (sort === 'stock') value = nullableCompare(left.quantity, right.quantity)
  else if (sort === 'value') value = nullableCompare(left.value, right.value)
  else if (sort === 'category') value = (left.category ?? '').localeCompare(right.category ?? '')
  else if (sort === 'updated') value = (left.updatedAt ?? '').localeCompare(right.updatedAt ?? '')
  else value = `${left.title} ${left.variantTitle ?? ''}`.localeCompare(`${right.title} ${right.variantTitle ?? ''}`)
  if (value === 0) value = left.variantId.localeCompare(right.variantId)
  return direction === 'asc' ? value : -value
}

function coverDays(item: InventoryRowItem): number | null { return item.daysOfCover.status === 'available' ? item.daysOfCover.days : null }

function variantImageUrl(product: Readonly<Record<string, unknown>>, variant: Readonly<Record<string, unknown>>): string | null {
  const variantImageId = scalarString(variant.image_id)
  if (variantImageId) {
    for (const image of arrayValue(product.images)) {
      const record = objectValue(image)
      if (record && scalarString(record.id) === variantImageId) {
        const source = nullableString(record.src)
        if (source) return source
      }
    }
  }
  const primary = nullableString(objectValue(product.image)?.src)
  if (primary) return primary
  for (const image of arrayValue(product.images)) {
    const source = nullableString(objectValue(image)?.src)
    if (source) return source
  }
  return null
}

function normalizeVariantTitle(value: unknown): string | null {
  const title = nullableString(value)
  // Shopify uses this literal for single-variant products; it is noise in a UI.
  return title === null || title === 'Default Title' ? null : title
}

function normalizeThreshold(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LOW_STOCK_THRESHOLD
  return Math.min(MAX_LOW_STOCK_THRESHOLD, Math.max(1, Math.round(value)))
}

function unwrapLegacy(value: unknown): unknown {
  const raw = objectValue(value)
  if (!raw || typeof raw.payload !== 'string') return value
  try {
    const parsed: unknown = JSON.parse(raw.payload)
    const record = objectValue(parsed)
    return record ? { ...record, id: record.id ?? raw.id } : value
  } catch { return value }
}

function percentage(count: number, total: number): number { return total > 0 ? Math.round((count / total) * 100) : 0 }
function round(value: number): number { return Math.round(value * 100) / 100 }
function nullableCompare(left: number | null, right: number | null): number { if (left === null) return right === null ? 0 : -1; if (right === null) return 1; return left - right }
function objectValue(value: unknown): Readonly<Record<string, unknown>> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null }
function arrayValue(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function nullableString(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function scalarString(value: unknown): string | null { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null }
function integerOrNull(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? Math.round(parsed) : null }
function money(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null }
function normalizeCurrency(value: unknown): string | null { const code = nullableString(value)?.toUpperCase() ?? ''; return /^[A-Z]{3}$/.test(code) ? code : null }
function isoDateTime(value: unknown): string | null { const text = nullableString(value); return text && Number.isFinite(Date.parse(text)) ? text : null }
function bounded(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function boundedInteger(value: unknown, min: number, max: number, fallback: number): number { const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback }
function isStockStatus(value: unknown): value is StockStatus { return value === 'in_stock' || value === 'low' || value === 'out' || value === 'untracked' }
function isInventorySort(value: unknown): value is InventorySort { return value === 'name' || value === 'stock' || value === 'value' || value === 'category' || value === 'updated' || value === 'days_of_cover' }
