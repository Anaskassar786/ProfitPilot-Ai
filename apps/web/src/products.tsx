import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ArrowUpRight, Award, BarChart3, Box, Database, Gauge, Package, RefreshCw, Search, ShoppingBag, SlidersHorizontal, Tag, TrendingUp } from 'lucide-react'
import { CustomSelect } from './CustomSelect.js'
import type { AnalyticsSnapshot, CatalogProduct, WorkspaceContext } from './model.js'
import { formatMoney, formatNumber } from './model.js'
import { buildProductsViewModel, filterAndSortProducts } from './products-model.js'
import type { ProductListItem, ProductSortKey, ProductStatusFilter } from './products-model.js'

export function ProductsWorkspace({ context, catalog, analytics, onSync }: { context: WorkspaceContext; catalog: readonly CatalogProduct[]; analytics: AnalyticsSnapshot | null; onSync: (module: string) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProductSortKey>('performance')
  const [status, setStatus] = useState<ProductStatusFilter>('all')
  const view = useMemo(() => buildProductsViewModel(catalog, analytics), [catalog, analytics])
  const products = useMemo(() => filterAndSortProducts(view.products, query, status, sort), [view.products, query, status, sort])
  if (catalog.length === 0) {
    return <ProductsEmptyState
      title="No products found"
      description={context.storeId ? 'Run a real Shopify products sync to populate this page. ProfitPilot will not show demo catalog rows.' : 'Connect a Shopify store before loading product data.'}
      action={context.storeId ? 'Sync products' : 'Connect Shopify'}
      onAction={() => void onSync(context.storeId ? 'products' : 'install')}
    />
  }
  return <div className="products-redesign">
    <ProductsStatsGrid view={view} onSync={onSync} />
    <section className="card products-list-card">
      <ProductsToolbar query={query} sort={sort} status={status} resultCount={products.length} totalCount={view.products.length} onQuery={setQuery} onSort={setSort} onStatus={setStatus} />
      {products.length === 0 ? <ProductsEmptyState compact title="No products found" description="No real product matches the current search and status filters." action="Clear filters" onAction={() => { setQuery(''); setStatus('all'); setSort('performance') }} /> : <ProductList products={products} hasSalesData={view.stats.hasSalesData} />}
    </section>
  </div>
}

function ProductsStatsGrid({ view, onSync }: { view: ReturnType<typeof buildProductsViewModel>; onSync: (module: string) => Promise<void> }) {
  return <section className="products-stat-grid" aria-label="Product statistics">
    <ProductStatCard tone="blue" icon={<Package size={18} />} label="Active Products" value={formatNumber(view.stats.activeProducts)} sub={`${formatNumber(view.stats.totalProducts)} synced products`} />
    <WinningProductCard product={view.stats.winningProduct} onSync={onSync} />
    <AveragePerformanceMeter score={view.stats.averagePerformanceScore} hasSalesData={view.stats.hasSalesData} />
    <ProductStatCard tone="green" icon={<ShoppingBag size={18} />} label="Product Sold" value={formatNumber(view.stats.totalUnitsSold)} sub={view.stats.totalRevenue === null ? 'Awaiting order sync' : `${formatMoney(view.stats.totalRevenue)} product revenue`} />
  </section>
}

function ProductStatCard({ tone, icon, label, value, sub }: { tone: string; icon: ReactNode; label: string; value: string; sub: string }) {
  return <article className={`card product-stat-card ${tone}`}>
    <div className="product-stat-head"><span className="product-stat-icon">{icon}</span><span className="real-data-pill"><Database size={11} /> Real</span></div>
    <span className="product-stat-label">{label}</span>
    <strong>{value}</strong>
    <small>{sub}</small>
  </article>
}

function WinningProductCard({ product, onSync }: { product: ProductListItem | null; onSync: (module: string) => Promise<void> }) {
  if (!product) return <article className="card product-stat-card winning empty">
    <div className="product-stat-head"><span className="product-stat-icon"><Award size={18} /></span><span className="real-data-pill muted">No sales</span></div>
    <span className="product-stat-label">Winning Product</span>
    <strong>No sales data yet</strong>
    <small>Sync orders to calculate the top seller.</small>
    <button className="text-button product-stat-action" onClick={() => void onSync('orders')}><RefreshCw size={13} /> Sync orders</button>
  </article>
  return <article className="card product-stat-card winning">
    <div className="product-stat-head"><span className="product-stat-icon"><Award size={18} /></span><span className="real-data-pill"><TrendingUp size={11} /> Top seller</span></div>
    <span className="product-stat-label">Winning Product</span>
    <div className="winning-product-main"><ProductThumbnail product={product} size="small" /><div><strong title={product.title}>{product.title}</strong><small>{formatNumber(product.sales.unitsSold)} sold · {formatMoney(product.sales.grossRevenue)}</small></div></div>
  </article>
}

function AveragePerformanceMeter({ score, hasSalesData }: { score: number | null; hasSalesData: boolean }) {
  const value = score ?? 0
  return <article className="card product-stat-card performance">
    <div className="product-stat-head"><span className="product-stat-icon"><Gauge size={18} /></span><span className={`real-data-pill ${hasSalesData ? '' : 'muted'}`}>{hasSalesData ? 'Calculated' : 'No sales'}</span></div>
    <span className="product-stat-label">Average Performance</span>
    <div className={`average-performance-meter ${score === null ? 'muted' : ''}`} style={{ '--meter-score': `${Math.min(100, Math.max(0, value))}%` } as CSSProperties}>
      <div><strong>{score === null ? '—' : score}</strong><small>{score === null ? '' : '/100'}</small></div>
    </div>
    <small>{score === null ? 'Awaiting order sync' : 'Average real product sales score'}</small>
  </article>
}

const PRODUCT_SORT_OPTIONS: readonly { value: ProductSortKey; label: string }[] = [
  { value: 'performance', label: 'Performance' },
  { value: 'name', label: 'Name' },
  { value: 'price', label: 'Price' },
  { value: 'stock', label: 'Stock' },
  { value: 'sold', label: 'Sold' },
]

const PRODUCT_STATUS_OPTIONS: readonly { value: ProductStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
]

function ProductsToolbar({ query, sort, status, resultCount, totalCount, onQuery, onSort, onStatus }: { query: string; sort: ProductSortKey; status: ProductStatusFilter; resultCount: number; totalCount: number; onQuery: (query: string) => void; onSort: (sort: ProductSortKey) => void; onStatus: (status: ProductStatusFilter) => void }) {
  return <div className="products-toolbar">
    <div className="products-toolbar-title"><div className="section-kicker"><span className="kicker-dot blue" /> All product list</div><h2>Catalog performance</h2><span>{formatNumber(resultCount)} of {formatNumber(totalCount)} real products</span></div>
    <div className="products-controls">
      <label className="products-search"><Search size={15} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search by product name" aria-label="Search by product name" /></label>
      <CustomSelect icon={<SlidersHorizontal size={14} />} label="Sort by" value={sort} options={PRODUCT_SORT_OPTIONS} onChange={onSort} ariaLabel="Sort products" />
      <CustomSelect icon={<Tag size={14} />} label="Show" value={status} options={PRODUCT_STATUS_OPTIONS} onChange={onStatus} ariaLabel="Filter by status" />
    </div>
  </div>
}

function ProductList({ products, hasSalesData }: { products: readonly ProductListItem[]; hasSalesData: boolean }) {
  return <div className="product-list" role="list" aria-label="Products">
    {products.map((product) => <ProductRow key={product.productId} product={product} hasSalesData={hasSalesData} />)}
  </div>
}

function ProductRow({ product, hasSalesData }: { product: ProductListItem; hasSalesData: boolean }) {
  return <article className="product-row" role="listitem">
    <div className="product-row-main">
      <ProductThumbnail product={product} />
      <div className="product-title-block">
        <div><h3>{product.title}</h3><span className={`product-status ${product.status}`}>{product.status}</span></div>
        <p>{[product.vendor, product.productType].filter(Boolean).join(' · ') || 'No vendor/type in Shopify payload'}</p>
        {product.tags.length > 0 && <div className="product-tags">{product.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
      </div>
    </div>
    <div className="product-row-metrics">
      <div className="product-metric performance-cell"><PerformanceBadge product={product} hasSalesData={hasSalesData} /><PerformanceGauge score={product.performance.score} tone={product.performance.tone} /></div>
      <div className="product-metric"><span>Sales</span><strong>{formatNumber(product.sales.unitsSold)}</strong><small>{formatMoney(product.sales.grossRevenue)}</small></div>
      <StockIndicator product={product} />
      <PriceCell product={product} />
    </div>
  </article>
}

function ProductThumbnail({ product, size = 'default' }: { product: ProductListItem; size?: 'default' | 'small' }) {
  if (product.imageUrl) return <span className={`product-thumb ${size}`}><img src={product.imageUrl} alt={`${product.title} product image`} loading="lazy" /></span>
  return <span className={`product-thumb fallback ${size}`} title="No real product image synced"><Package size={size === 'small' ? 14 : 18} /><strong>{product.initials}</strong><em>No image</em></span>
}

function PerformanceBadge({ product, hasSalesData }: { product: ProductListItem; hasSalesData: boolean }) {
  const label = hasSalesData ? product.performance.label : 'Awaiting sales data'
  const tone = hasSalesData ? product.performance.tone : 'muted'
  return <span className={`performance-badge ${tone}`}><BarChart3 size={12} />{label}</span>
}

function PerformanceGauge({ score, tone }: { score: number | null; tone: string }) {
  if (score === null || tone === 'new' || tone === 'muted') {
    return <div className="performance-gauge-cell awaiting">
      <div className="performance-gauge awaiting" style={{ '--gauge-score': '50%' } as CSSProperties}><span>—</span></div>
      <small className="performance-gauge-caption">Awaiting sales</small>
    </div>
  }
  const value = Math.min(100, Math.max(0, score))
  return <div className="performance-gauge-cell">
    <div className={`performance-gauge ${tone}`} style={{ '--gauge-score': `${value}%` } as CSSProperties}><span>{score}</span></div>
  </div>
}

function StockIndicator({ product }: { product: ProductListItem }) {
  return <div className="product-metric stock-cell"><span><Box size={13} /> Stock</span><strong>{product.stock.label}</strong><small>{product.stock.note}</small></div>
}

function PriceCell({ product }: { product: ProductListItem }) {
  return <div className="product-metric price-cell"><span>Price</span><strong>{product.price.label}</strong><small>{product.price.source === 'variants' ? `${product.price.variantCount} variant${product.price.variantCount === 1 ? '' : 's'}` : 'Variant price unavailable'}</small></div>
}

function ProductsEmptyState({ title, description, action, onAction, compact = false }: { title: string; description: string; action: string; onAction: () => void; compact?: boolean }) {
  return <div className={`products-empty-state ${compact ? 'compact' : ''}`}>
    <span className="empty-icon"><Package size={22} /></span>
    <h3>{title}</h3>
    <p>{description}</p>
    <button className="button secondary" onClick={onAction}>{action} <ArrowUpRight size={14} /></button>
  </div>
}
