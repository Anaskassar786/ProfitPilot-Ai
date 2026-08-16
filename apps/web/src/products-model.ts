import type { AnalyticsSnapshot, CatalogProduct, JsonObject, JsonValue, ProductSalesMetric } from './model.js'

export type ProductSortKey = 'name' | 'price' | 'performance' | 'stock' | 'sold'
export type ProductStatusFilter = 'all' | 'active' | 'draft' | 'archived'
export type ProductPerformanceLabel = 'Excellent' | 'Good' | 'Bad' | 'New' | 'Awaiting sales data'
export type ProductPerformanceTone = 'excellent' | 'good' | 'bad' | 'new' | 'muted'

export type ProductSalesSummary = Readonly<{ productId: string; unitsSold: number; grossRevenue: number }>
export type ProductPriceView = Readonly<{ label: string; sortValue: number | null; min: number | null; max: number | null; variantCount: number; source: 'variants' | 'unavailable' }>
export type ProductStockView = Readonly<{ label: string; value: number | null; sortValue: number | null; note: string; variantCount: number }>
export type ProductPerformanceView = Readonly<{ label: ProductPerformanceLabel; tone: ProductPerformanceTone; score: number | null; rank: number | null }>
export type ProductListItem = Readonly<{
  product: CatalogProduct
  productId: string
  title: string
  initials: string
  imageUrl: string | null
  status: string
  vendor: string | null
  productType: string | null
  tags: readonly string[]
  price: ProductPriceView
  stock: ProductStockView
  sales: ProductSalesSummary
  performance: ProductPerformanceView
  syncedAt: number
}>
export type ProductsStats = Readonly<{
  totalProducts: number
  activeProducts: number
  totalUnitsSold: number | null
  totalRevenue: number | null
  winningProduct: ProductListItem | null
  averagePerformanceScore: number | null
  hasSalesData: boolean
}>
export type ProductsViewModel = Readonly<{ products: readonly ProductListItem[]; stats: ProductsStats }>

export function buildProductsViewModel(catalog: readonly CatalogProduct[], analytics: AnalyticsSnapshot | null): ProductsViewModel {
  const salesByProduct = aggregateProductSales(analytics?.productSales ?? [])
  const baseProducts = catalog.map((product) => toProductListItem(product, salesByProduct.get(productKey(product))))
  const rankedProducts = applyPerformance(baseProducts, analytics?.productSales.length ? true : false)
  const sellers = rankedProducts.filter((product) => product.sales.unitsSold > 0 || product.sales.grossRevenue > 0)
  const winningProduct = sellers.length > 0 ? [...sellers].sort(compareWinningProduct)[0] ?? null : null
  const scores = rankedProducts.flatMap((product) => product.performance.score === null ? [] : [product.performance.score])
  const totalUnitsSold = analytics && analytics.productSales.length > 0 ? [...salesByProduct.values()].reduce((sum, row) => sum + row.unitsSold, 0) : null
  const totalRevenue = analytics && analytics.productSales.length > 0 ? [...salesByProduct.values()].reduce((sum, row) => sum + row.grossRevenue, 0) : null
  return {
    products: rankedProducts,
    stats: {
      totalProducts: catalog.length,
      activeProducts: rankedProducts.filter((product) => product.status === 'active').length,
      totalUnitsSold,
      totalRevenue,
      winningProduct,
      averagePerformanceScore: scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      hasSalesData: Boolean(analytics && analytics.productSales.length > 0),
    },
  }
}

export function filterAndSortProducts(products: readonly ProductListItem[], query: string, status: ProductStatusFilter, sort: ProductSortKey): readonly ProductListItem[] {
  const normalized = query.trim().toLowerCase()
  return products
    .filter((product) => status === 'all' || product.status === status)
    .filter((product) => !normalized || product.title.toLowerCase().includes(normalized))
    .sort((left, right) => compareProducts(left, right, sort))
}

export function aggregateProductSales(rows: readonly ProductSalesMetric[]): ReadonlyMap<string, ProductSalesSummary> {
  const sales = new Map<string, ProductSalesSummary>()
  for (const row of rows) {
    const current = sales.get(row.productId) ?? { productId: row.productId, unitsSold: 0, grossRevenue: 0 }
    sales.set(row.productId, { productId: row.productId, unitsSold: current.unitsSold + row.unitsSold, grossRevenue: current.grossRevenue + row.grossRevenue })
  }
  return sales
}

export function productImageUrl(product: CatalogProduct): string | null {
  const image = recordField(product.payload.image)
  const imageSrc = stringField(image?.src)
  if (imageSrc) return imageSrc
  const images = arrayField(product.payload.images)
  for (const item of images) {
    const src = stringField(recordField(item)?.src)
    if (src) return src
  }
  return null
}

export function productPriceView(product: CatalogProduct): ProductPriceView {
  const variants = variantRecords(product)
  const prices = variants.map((variant) => numberField(variant.price)).filter((price): price is number => price !== null && price >= 0)
  if (variants.length === 0 || prices.length === 0) return { label: 'Custom', sortValue: null, min: null, max: null, variantCount: variants.length, source: 'unavailable' }
  if (prices.length !== variants.length) return { label: 'Custom', sortValue: null, min: null, max: null, variantCount: variants.length, source: 'unavailable' }
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return { label: min === max ? formatProductMoney(min) : `${formatProductMoney(min)} – ${formatProductMoney(max)}`, sortValue: min, min, max, variantCount: variants.length, source: 'variants' }
}

export function productStockView(product: CatalogProduct): ProductStockView {
  const variants = variantRecords(product)
  const quantities = variants.map((variant) => numberField(variant.inventory_quantity)).filter((quantity): quantity is number => quantity !== null && quantity >= 0)
  if (variants.length === 0 || quantities.length === 0) return { label: '—', value: null, sortValue: null, note: 'No variant stock field', variantCount: variants.length }
  const total = quantities.reduce((sum, quantity) => sum + quantity, 0)
  return { label: formatCount(total), value: total, sortValue: total, note: variants.length > 1 ? `${variants.length} variants · Variant-level` : 'Variant-level', variantCount: variants.length }
}

function toProductListItem(product: CatalogProduct, sales: ProductSalesSummary | undefined): ProductListItem {
  const title = productTitle(product)
  const vendor = stringField(product.payload.vendor)
  const productType = stringField(product.payload.product_type)
  const status = stringField(product.payload.status)?.toLowerCase() ?? 'unknown'
  return {
    product,
    productId: productKey(product),
    title,
    initials: initialsFor(title),
    imageUrl: productImageUrl(product),
    status,
    vendor,
    productType,
    tags: tagList(product.payload.tags),
    price: productPriceView(product),
    stock: productStockView(product),
    sales: sales ?? { productId: productKey(product), unitsSold: 0, grossRevenue: 0 },
    performance: { label: 'Awaiting sales data', tone: 'muted', score: null, rank: null },
    syncedAt: product.syncedAt,
  }
}

function applyPerformance(products: readonly ProductListItem[], hasSalesData: boolean): readonly ProductListItem[] {
  if (!hasSalesData) return products
  const sellers = products
    .filter((product) => product.sales.unitsSold > 0 || product.sales.grossRevenue > 0)
    .sort(compareWinningProduct)
  if (sellers.length === 0) return products.map((product) => ({ ...product, performance: { label: 'New', tone: 'new', score: 0, rank: null } }))
  const rankByProduct = new Map(sellers.map((product, index) => [product.productId, index + 1]))
  const topUnits = Math.max(...sellers.map((product) => product.sales.unitsSold), 1)
  const topRevenue = Math.max(...sellers.map((product) => product.sales.grossRevenue), 1)
  const excellentMax = Math.max(1, Math.ceil(sellers.length * 0.2))
  const goodMax = Math.max(excellentMax, Math.ceil(sellers.length * 0.6))
  return products.map((product) => {
    const rank = rankByProduct.get(product.productId) ?? null
    if (rank === null) return { ...product, performance: { label: 'New', tone: 'new', score: 0, rank: null } }
    const salesScore = product.sales.unitsSold / topUnits
    const revenueScore = product.sales.grossRevenue / topRevenue
    const score = Math.max(1, Math.round(((salesScore + revenueScore) / 2) * 100))
    const label: ProductPerformanceLabel = rank <= excellentMax ? 'Excellent' : rank <= goodMax ? 'Good' : 'Bad'
    const tone: ProductPerformanceTone = label === 'Excellent' ? 'excellent' : label === 'Good' ? 'good' : 'bad'
    return { ...product, performance: { label, tone, score, rank } }
  })
}

function compareProducts(left: ProductListItem, right: ProductListItem, sort: ProductSortKey): number {
  if (sort === 'name') return left.title.localeCompare(right.title)
  if (sort === 'price') return compareNullable(left.price.sortValue, right.price.sortValue, true) || left.title.localeCompare(right.title)
  if (sort === 'performance') return compareNullable(left.performance.score, right.performance.score, false) || compareWinningProduct(left, right)
  if (sort === 'stock') return compareNullable(left.stock.sortValue, right.stock.sortValue, false) || left.title.localeCompare(right.title)
  return right.sales.unitsSold - left.sales.unitsSold || right.sales.grossRevenue - left.sales.grossRevenue || left.title.localeCompare(right.title)
}

function compareWinningProduct(left: ProductListItem, right: ProductListItem): number {
  return right.sales.unitsSold - left.sales.unitsSold || right.sales.grossRevenue - left.sales.grossRevenue || left.title.localeCompare(right.title)
}

function compareNullable(left: number | null, right: number | null, ascending: boolean): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return ascending ? left - right : right - left
}

function productKey(product: CatalogProduct): string {
  const payloadId = product.payload.id
  if (typeof payloadId === 'string' || typeof payloadId === 'number') return String(payloadId)
  return product.productId
}

function productTitle(product: CatalogProduct): string {
  const title = stringField(product.payload.title)
  return title ?? product.productId
}

function variantRecords(product: CatalogProduct): readonly JsonObject[] {
  return arrayField(product.payload.variants).flatMap((item) => {
    const record = recordField(item)
    return record ? [record] : []
  })
}

function tagList(value: JsonValue | undefined): readonly string[] {
  if (typeof value === 'string') return value.split(',').map((tag) => tag.trim()).filter(Boolean)
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
  return []
}

function initialsFor(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  const letters = words.length >= 2 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : title.slice(0, 2)
  return letters.toUpperCase() || 'PP'
}

function formatProductMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function stringField(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberField(value: JsonValue | undefined): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function recordField(value: JsonValue | undefined): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null
}

function arrayField(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : []
}
