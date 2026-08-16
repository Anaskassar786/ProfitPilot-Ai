/**
 * Client-side view types for the Inventory workspace. These mirror the API
 * contract in `apps/api/src/inventory.ts` exactly — the workspace never
 * synthesises a quantity, a value, or a velocity of its own.
 */

export type StockStatus = 'in_stock' | 'low' | 'out' | 'untracked'
export type InventorySort = 'name' | 'stock' | 'value' | 'category' | 'updated' | 'days_of_cover'
export type QuantitySource = 'inventory_levels' | 'variant_inventory_quantity' | 'unavailable'
export type InventoryTab = 'all' | StockStatus

export type InventoryLocation = Readonly<{
  id: string
  name: string | null
  city: string | null
  province: string | null
  country: string | null
  active: boolean | null
  levelsQueried: boolean
}>

export type VariantLocationLevel = Readonly<{ locationId: string; locationName: string | null; available: number; updatedAt: string | null }>

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

/** Days of cover mirrors `apps/api/src/inventory-velocity.ts` exactly. */
export type DaysOfCoverReason = 'sales_history' | 'no_sales' | 'no_stock_signal' | 'variant_sales_unavailable'
export type DaysOfCover =
  | Readonly<{ status: 'available'; days: number; velocity: number }>
  | Readonly<{ status: 'insufficient_data'; reason: DaysOfCoverReason; message: string }>
  | Readonly<{ status: 'locked'; required_plan: 'growth' }>

/** A table row: the Shopify item plus its plan-gated days-of-cover cell. */
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
export type InventoryHealthComponent = Readonly<{ key: string; label: string; score: number; weight: number; detail: string }>
export type InventoryHealth = Readonly<{
  score: number | null
  grade: string
  label: string
  tone: 'healthy' | 'warning' | 'critical' | 'muted'
  components: readonly InventoryHealthComponent[]
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

export type TopSellingItem =
  | Readonly<{ status: 'available'; productId: string; title: string; unitsSold: number; grossRevenue: number; currency: string | null }>
  | Readonly<{ status: 'insufficient_data'; message: string }>

export type InventoryBasicInsights = Readonly<{
  topSellingItem: TopSellingItem
  itemsNeedingAttention: Readonly<{ count: number; lowStock: number; outOfStock: number }>
  healthGrade: Readonly<{ grade: string; score: number | null; label: string }>
}>

export type LockedInventoryFeature = Readonly<{ locked: true; feature: string; name: string; required_plan: 'growth' | 'commander' }>

export type InventoryQuery = Readonly<Partial<{
  q: string
  status: StockStatus | ''
  category: string
  vendor: string
  locationId: string
  sort: InventorySort
  direction: 'asc' | 'desc'
  page: number
  limit: number
  lowStockThreshold: number
}>>

export type InventoryPageResult = Readonly<{
  plan: 'trial' | 'start' | 'growth' | 'commander'
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

export const EMPTY_INVENTORY_PAGE: InventoryPageResult = {
  plan: 'trial',
  items: [],
  stats: { totalSkus: 0, trackedSkus: 0, untrackedSkus: 0, totalUnits: 0, inStockCount: 0, lowStockCount: 0, outOfStockCount: 0, totalValue: null, valuedSkus: 0, currency: null, minStock: null, averageStock: null, maxStock: null, lowStockThreshold: 10 },
  distribution: { healthy: 0, low: 0, out: 0, untracked: 0 },
  health: { score: null, grade: '—', label: 'No inventory data', tone: 'muted', components: [], excluded: [] },
  topValueItems: [],
  basicInsights: {
    topSellingItem: { status: 'insufficient_data', message: 'Awaiting more sales history. Your top seller appears once orders are synced.' },
    itemsNeedingAttention: { count: 0, lowStock: 0, outOfStock: 0 },
    healthGrade: { grade: '—', score: null, label: 'No inventory data' },
  },
  lockedFeatures: [],
  tabCounts: { all: 0, in_stock: 0, low: 0, out: 0, untracked: 0 },
  locations: [],
  multiLocation: false,
  categories: [],
  vendors: [],
  coverage: { inventorySyncCompleted: false, levelRowCount: 0, locationRowCount: 0, lastSyncedAt: null, catalogSynced: false, locationsTruncated: false, quantitySource: 'unavailable', explanation: 'No Shopify products are synced yet. Sync your products to see stock levels.' },
  pagination: { page: 1, limit: 20, total: 0, pages: 1 },
}

/** Honest label for the Days of Cover column; never renders a fabricated number. */
export function daysOfCoverLabel(cover: DaysOfCover): string {
  if (cover.status === 'available') return `${cover.days.toLocaleString(undefined, { maximumFractionDigits: 1 })} days`
  if (cover.status === 'locked') return 'Growth'
  return 'Insufficient data'
}

export function daysOfCoverTone(cover: DaysOfCover): 'red' | 'amber' | 'green' | 'muted' {
  if (cover.status !== 'available') return 'muted'
  if (cover.days < 14) return 'red'
  if (cover.days < 30) return 'amber'
  return 'green'
}

export function stockStatusLabel(status: StockStatus): string {
  if (status === 'in_stock') return 'In Stock'
  if (status === 'low') return 'Low Stock'
  if (status === 'out') return 'Out of Stock'
  return 'Not Tracked'
}

/** Human copy for why a quantity is missing. Never renders a fabricated zero. */
export function quantityLabel(item: InventoryItem): string {
  if (item.quantity !== null) return String(item.quantity)
  return item.tracked ? 'Unavailable' : 'Not tracked'
}

export function locationLabel(location: Readonly<{ name: string | null; id: string; city?: string | null }>): string {
  if (location.name) return location.name
  return `Location ${location.id}`
}

/** Aggregates a variant's per-location levels into display rows, largest first. */
export function locationBreakdown(item: InventoryItem): readonly Readonly<{ id: string; label: string; available: number; share: number }>[] {
  const total = item.locations.reduce((sum, level) => sum + Math.max(0, level.available), 0)
  return [...item.locations]
    .sort((left, right) => right.available - left.available)
    .map((level) => ({
      id: level.locationId,
      label: locationLabel({ name: level.locationName, id: level.locationId }),
      available: level.available,
      share: total > 0 ? Math.round((Math.max(0, level.available) / total) * 100) : 0,
    }))
}

export function lockedFeature(result: InventoryPageResult | null, feature: string): LockedInventoryFeature | null {
  return result?.lockedFeatures.find((entry) => entry.feature === feature) ?? null
}

export function distributionSegments(distribution: StockDistribution): readonly Readonly<{ key: keyof StockDistribution; label: string; value: number; color: string }>[] {
  const segments: readonly Readonly<{ key: keyof StockDistribution; label: string; value: number; color: string }>[] = [
    { key: 'healthy', label: 'Healthy', value: distribution.healthy, color: 'var(--green)' },
    { key: 'low', label: 'Low stock', value: distribution.low, color: 'var(--amber)' },
    { key: 'out', label: 'Out of stock', value: distribution.out, color: 'var(--red)' },
    { key: 'untracked', label: 'Not tracked', value: distribution.untracked, color: 'rgba(148,163,184,.55)' },
  ]
  return segments.filter((segment) => segment.value > 0)
}

export function formatMoney(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const amount = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${amount}` : amount
}

export function formatUnits(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toLocaleString()
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isFinite(parsed.valueOf()) ? parsed.toLocaleString() : '—'
}
