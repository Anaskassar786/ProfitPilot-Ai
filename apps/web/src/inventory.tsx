import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Coins,
  HeartPulse,
  Layers,
  LineChart,
  MapPin,
  MoreHorizontal,
  PackageX,
  RefreshCw,
  Repeat,
  Search,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  X,
} from 'lucide-react'
import { fetchInventory, fetchInventoryItem } from './api.js'
import { PlanLockedFeature } from './orders.js'
import type { WorkspaceContext } from './model.js'
import type { InventoryItem, InventoryPageResult, InventoryQuery, InventorySort, InventoryTab, StockStatus } from './inventory-model.js'
import { EMPTY_INVENTORY_PAGE, distributionSegments, formatDateTime, formatMoney, formatUnits, locationBreakdown, locationLabel, lockedFeature, quantityLabel, stockStatusLabel } from './inventory-model.js'

type ToastKind = 'success' | 'info' | 'warning' | 'error'
type InventoryWorkspaceProps = Readonly<{
  context: WorkspaceContext
  onSync: (module: string) => Promise<void>
  onNavigate: (page: 'billing') => void
  onToast: (message: string, kind?: ToastKind) => void
}>

type FilterState = Readonly<{ category: string; vendor: string; locationId: string }>
const EMPTY_FILTERS: FilterState = { category: '', vendor: '', locationId: '' }

export function InventoryWorkspace({ context, onSync, onNavigate, onToast }: InventoryWorkspaceProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeTab, setActiveTab] = useState<InventoryTab>('all')
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [sort, setSort] = useState<InventorySort>('name')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<InventoryPageResult>(EMPTY_INVENTORY_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1) }, 260)
    return () => window.clearTimeout(timer)
  }, [query])

  const requestQuery = useMemo<InventoryQuery>(
    () => ({ q: debouncedQuery, ...filters, status: activeTab === 'all' ? '' : activeTab, sort, direction, page, limit: 20 }),
    [debouncedQuery, filters, activeTab, sort, direction, page],
  )

  useEffect(() => {
    if (!context.storeId) { setData(EMPTY_INVENTORY_PAGE); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchInventory(context.storeId, requestQuery)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((reason: unknown) => { if (!cancelled) setError(errorText(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [context.storeId, requestQuery, refreshVersion])

  const sync = async () => {
    setSyncing(true)
    try {
      // Products carry the variant catalog, inventory carries the levels.
      // Both are required before this page can show a real stock number.
      await onSync('products')
      await onSync('inventory')
      setRefreshVersion((value) => value + 1)
    } catch (reason: unknown) { onToast(errorText(reason), 'error') } finally { setSyncing(false) }
  }

  const upgrade = () => onNavigate('billing')
  const clearFilters = () => { setQuery(''); setFilters(EMPTY_FILTERS); setActiveTab('all'); setPage(1) }

  if (!context.storeId) {
    return <InventoryEmptyState
      title="Connect Shopify to view inventory"
      description="ProfitPilot only displays stock levels returned by your connected Shopify store."
      action="Open billing"
      onAction={upgrade}
    />
  }

  const nothingSynced = data.stats.totalSkus === 0 && !loading && !error

  return <div className="inventory-workspace">
    <div className="inventory-page-actions">
      <button className="button secondary" disabled={syncing} onClick={() => void sync()}>
        <RefreshCw size={15} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing…' : 'Sync inventory'}
      </button>
    </div>

    {error ? <InventoryErrorState message={error} onRetry={() => setRefreshVersion((value) => value + 1)} /> : nothingSynced ? <>
      <InventoryEmptyState
        title="Sync your inventory to see stock levels"
        description="No Shopify products or inventory levels are synced yet. Nothing on this page is estimated — it stays empty until your store returns real data."
        action={syncing ? 'Syncing…' : 'Sync inventory'}
        onAction={() => void sync()}
        busy={syncing}
      />
      <CoverageNote coverage={data.coverage} />
    </> : <>
      <InventoryStatsGrid data={data} loading={loading} />

      <div className="inventory-overview-grid">
        <InventoryHealthCard data={data} loading={loading} />
        <StockDistributionChart data={data} loading={loading} />
        <InventoryValueSummary data={data} loading={loading} />
      </div>

      <BasicInsightsCard data={data} onUpgrade={upgrade} />

      <PremiumPreviewGrid data={data} onUpgrade={upgrade} />

      <section className="card inventory-table-card">
        <InventoryToolbar
          query={query}
          onQuery={setQuery}
          sort={sort}
          direction={direction}
          onSort={(value) => { setSort(value); setPage(1) }}
          onDirection={() => { setDirection((value) => value === 'asc' ? 'desc' : 'asc'); setPage(1) }}
          filters={filters}
          onFilters={(value) => { setFilters(value); setPage(1) }}
          categories={data.categories}
          vendors={data.vendors}
          locations={data.locations}
        />

        <InventoryTabs counts={data.tabCounts} active={activeTab} onSelect={(tab) => { setActiveTab(tab); setPage(1) }} />

        {loading ? <InventoryTableSkeleton /> : data.items.length === 0 ? (
          <InventoryEmptyState compact title="No items match these filters" description="Change the active tab, search text, or filters to see your synced stock." action="Clear filters" onAction={clearFilters} />
        ) : (
          <InventoryTable items={data.items} multiLocation={data.multiLocation} onSelect={setSelectedId} />
        )}

        {!loading && data.pagination.total > 0 && <InventoryPagination pagination={data.pagination} onPage={setPage} />}
        <CoverageNote coverage={data.coverage} />
      </section>
    </>}

    {selectedId && <InventoryDetailDrawer storeId={context.storeId} variantId={selectedId} shop={context.shop} onClose={() => setSelectedId(null)} onToast={onToast} />}
  </div>
}

export function InventoryStatsGrid({ data, loading }: { data: InventoryPageResult; loading: boolean }) {
  const { stats } = data
  const cards: readonly Readonly<{ key: string; label: string; value: string; hint: string; icon: ReactNode; tone: string }>[] = [
    { key: 'skus', label: 'Total SKUs', value: formatUnits(stats.totalSkus), hint: `${formatUnits(stats.trackedSkus)} tracked by Shopify`, icon: <Layers size={17} />, tone: 'blue' },
    { key: 'units', label: 'Units in Stock', value: formatUnits(stats.totalUnits), hint: stats.averageStock === null ? 'No tracked quantities yet' : `Average ${formatUnits(stats.averageStock)} per tracked SKU`, icon: <Boxes size={17} />, tone: 'green' },
    { key: 'low', label: 'Low Stock Alerts', value: formatUnits(stats.lowStockCount), hint: `Below ${stats.lowStockThreshold} units on hand`, icon: <TrendingDown size={17} />, tone: 'amber' },
    { key: 'out', label: 'Out of Stock', value: formatUnits(stats.outOfStockCount), hint: stats.untrackedSkus > 0 ? `${formatUnits(stats.untrackedSkus)} more are not tracked` : 'Tracked items at zero units', icon: <PackageX size={17} />, tone: 'red' },
  ]
  return <div className={`inventory-stats-grid ${loading ? 'loading' : ''}`}>
    {cards.map((card) => <article key={card.key} className={`card inventory-stat-card tone-${card.tone}`}>
      <div className="inventory-stat-head"><span className="inventory-stat-icon">{card.icon}</span><span>{card.label}</span></div>
      <strong>{card.value}</strong>
      <small>{card.hint}</small>
    </article>)}
  </div>
}

export function InventoryHealthCard({ data, loading }: { data: InventoryPageResult; loading: boolean }) {
  const { health } = data
  const unavailable = health.score === null
  const sweep = unavailable ? 0 : Math.max(8, Math.round(health.score * 2.4))
  return <article className="card inventory-health-card">
    <div className="inventory-card-label"><HeartPulse size={16} /><span>Inventory Health</span></div>
    {loading ? <div className="inventory-skeleton-block" /> : <>
      <div className="inventory-health-gauge-wrap">
        <div
          className={`health-gauge compact ${unavailable ? 'no-data' : health.tone}`}
          style={unavailable ? undefined : { background: `conic-gradient(from 220deg, var(--health-color) ${sweep}deg, rgba(107,114,128,.14) 0)` } as CSSProperties}
        >
          <div className="gauge-inner">
            <strong>{unavailable ? '—' : health.score}</strong>
            <span>{unavailable ? 'No inventory data' : `${health.grade} · ${health.label}`}</span>
          </div>
        </div>
      </div>
      <ul className="inventory-health-components">
        {health.components.map((component) => <li key={component.key}>
          <div><span>{component.label}</span><strong>{component.score}%</strong></div>
          <div className="inventory-health-bar" role="presentation"><i style={{ width: `${component.score}%` }} /></div>
          <small>{component.detail}</small>
        </li>)}
        {health.components.length === 0 && <li className="inventory-health-empty">Health is calculated from your real stock levels once inventory is synced.</li>}
      </ul>
    </>}
  </article>
}

export function StockDistributionChart({ data, loading }: { data: InventoryPageResult; loading: boolean }) {
  const segments = distributionSegments(data.distribution)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  return <article className="card inventory-distribution-card">
    <div className="inventory-card-label"><LineChart size={16} /><span>Stock Distribution</span></div>
    {loading ? <div className="inventory-skeleton-block" /> : total === 0 ? (
      <p className="inventory-card-empty">No stock levels to chart yet.</p>
    ) : <>
      <div className="inventory-donut">
        <ResponsiveContainer width="100%" height={168}>
          <PieChart>
            <Pie data={segments as unknown as Record<string, unknown>[]} dataKey="value" nameKey="label" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
              {segments.map((segment) => <Cell key={segment.key} fill={segment.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: 'rgba(15,23,42,.96)', border: '1px solid rgba(148,163,184,.25)', borderRadius: 10, color: '#E2E8F0' }} formatter={(value: unknown, name: unknown) => [`${String(value)} SKUs`, String(name)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="inventory-donut-center"><strong>{formatUnits(total)}</strong><span>SKUs</span></div>
      </div>
      <ul className="inventory-distribution-legend">
        {segments.map((segment) => <li key={segment.key}>
          <span className="legend-dot" style={{ background: segment.color }} />
          <span>{segment.label}</span>
          <strong>{segment.value}</strong>
          <small>{Math.round((segment.value / total) * 100)}%</small>
        </li>)}
      </ul>
    </>}
  </article>
}

export function InventoryValueSummary({ data, loading }: { data: InventoryPageResult; loading: boolean }) {
  const { stats, topValueItems } = data
  return <article className="card inventory-value-card">
    <div className="inventory-card-label"><Coins size={16} /><span>Inventory Value</span></div>
    {loading ? <div className="inventory-skeleton-block" /> : <>
      <strong className="inventory-value-total">{formatMoney(stats.totalValue, stats.currency)}</strong>
      <small>{stats.totalValue === null ? 'No variant prices were returned by Shopify.' : `Retail value across ${formatUnits(stats.valuedSkus)} priced SKUs`}</small>
      {topValueItems.length > 0 && <ul className="inventory-top-value">
        {topValueItems.map((item) => <li key={item.variantId}>
          <div><strong>{item.title}</strong>{item.variantTitle && <small>{item.variantTitle}</small>}</div>
          <div className="inventory-top-value-amount"><strong>{formatMoney(item.value, stats.currency)}</strong><small>{formatUnits(item.quantity)} units</small></div>
        </li>)}
      </ul>}
    </>}
  </article>
}

export function BasicInsightsCard({ data, onUpgrade }: { data: InventoryPageResult; onUpgrade: () => void }) {
  const { topSellingItem, itemsNeedingAttention, healthGrade } = data.basicInsights
  return <section className="card inventory-insights">
    <header className="inventory-insights-header">
      <div className="inventory-insights-title">
        <span className="ai-insights-icon"><Sparkles size={18} /></span>
        <div>
          <div className="section-kicker">INVENTORY INTELLIGENCE</div>
          <h2>Stock Insights</h2>
          <p>Calculated from your synced Shopify inventory. Nothing here is estimated.</p>
        </div>
      </div>
      <span className={`inventory-plan-badge ${data.plan}`}>{planLabel(data.plan)}</span>
    </header>
    <div className="inventory-basic-insights">
      <article className="inventory-basic-card">
        <div className="inventory-card-label"><ShoppingCart size={16} /><span>Top Selling Item</span></div>
        {topSellingItem.status === 'available'
          ? <><strong>{topSellingItem.title}</strong><p>{formatUnits(topSellingItem.unitsSold)} sold · {formatMoney(topSellingItem.grossRevenue, topSellingItem.currency)}</p></>
          : <InsightPending message={topSellingItem.message} />}
      </article>
      <article className="inventory-basic-card">
        <div className="inventory-card-label"><AlertTriangle size={16} /><span>Needs Attention</span></div>
        <strong>{formatUnits(itemsNeedingAttention.count)}</strong>
        <p>{formatUnits(itemsNeedingAttention.lowStock)} low stock · {formatUnits(itemsNeedingAttention.outOfStock)} out of stock</p>
      </article>
      <article className="inventory-basic-card">
        <div className="inventory-card-label"><HeartPulse size={16} /><span>Health Grade</span></div>
        <strong>{healthGrade.grade}</strong>
        <p>{healthGrade.score === null ? healthGrade.label : `${healthGrade.score}/100 · ${healthGrade.label}`}</p>
      </article>
      <LockedSlot data={data} feature="days_of_cover" title="Days of Cover" icon={<CalendarClock size={16} />} onUpgrade={onUpgrade} />
    </div>
  </section>
}

/**
 * Premium inventory intelligence. PR-A renders these as blurred previews from
 * the backend's locked-feature metadata; no premium value is ever computed or
 * sent to a plan that has not unlocked it.
 */
export function PremiumPreviewGrid({ data, onUpgrade }: { data: InventoryPageResult; onUpgrade: () => void }) {
  const previews: readonly Readonly<{ feature: string; title: string; icon: ReactNode }>[] = [
    { feature: 'dead_stock', title: 'Dead Stock Detector', icon: <PackageX size={16} /> },
    { feature: 'reorder_recommendations', title: 'Reorder Recommendations', icon: <Truck size={16} /> },
    { feature: 'stock_turnover', title: 'Stock Turnover Analysis', icon: <Repeat size={16} /> },
    { feature: 'overstock_alerts', title: 'Overstock Alerts', icon: <TrendingUp size={16} /> },
    { feature: 'ai_suggestion', title: 'AI Suggestions', icon: <Sparkles size={16} /> },
    { feature: 'predictive_restocking', title: 'Predictive Restocking', icon: <LineChart size={16} /> },
    { feature: 'seasonal_trends', title: 'Seasonal Trends', icon: <CalendarClock size={16} /> },
    { feature: 'auto_reorder', title: 'Auto-Reorder Suggestions', icon: <Truck size={16} /> },
    { feature: 'custom_ai_queries', title: 'Custom AI Queries', icon: <Sparkles size={16} /> },
  ]
  const visible = previews.filter((preview) => lockedFeature(data, preview.feature))
  if (visible.length === 0) return null
  return <section className="card inventory-premium">
    <header><div className="section-kicker">PREMIUM INVENTORY INTELLIGENCE</div><p>Unlock forecasting and reorder guidance built on your real sales history.</p></header>
    <div className="inventory-premium-grid">
      {visible.map((preview) => <LockedSlot key={preview.feature} data={data} feature={preview.feature} title={preview.title} icon={preview.icon} onUpgrade={onUpgrade} compact />)}
    </div>
  </section>
}

function LockedSlot({ data, feature, title, icon, onUpgrade, compact = false }: { data: InventoryPageResult; feature: string; title: string; icon: ReactNode; onUpgrade: () => void; compact?: boolean }) {
  const locked = lockedFeature(data, feature)
  if (locked) return <PlanLockedFeature featureName={locked.name} requiredPlan={locked.required_plan} onUpgrade={onUpgrade}><InventoryMask compact={compact} /></PlanLockedFeature>
  // Unlocked plans see an honest "in progress" state rather than a fabricated
  // number; the calculations ship in the follow-up inventory intelligence work.
  return <article className={`inventory-basic-card ${compact ? 'compact' : ''}`}>
    <div className="inventory-card-label">{icon}<span>{title}</span></div>
    <InsightPending message="Awaiting more sales history. This unlocks once your store has enough order data." />
  </article>
}

function InventoryMask({ compact = false }: { compact?: boolean }) { return <span className={`insight-mask ${compact ? 'compact' : ''}`}><i /><i /><i /></span> }
function InsightPending({ message }: { message: string }) { return <div className="insight-unavailable"><span>—</span><small>{message}</small></div> }

function InventoryTabs({ counts, active, onSelect }: { counts: InventoryPageResult['tabCounts']; active: InventoryTab; onSelect: (tab: InventoryTab) => void }) {
  const tabs: readonly Readonly<{ id: InventoryTab; label: string; count: number }>[] = [
    { id: 'all', label: 'All Items', count: counts.all },
    { id: 'in_stock', label: 'In Stock', count: counts.in_stock },
    { id: 'low', label: 'Low Stock', count: counts.low },
    { id: 'out', label: 'Out of Stock', count: counts.out },
    { id: 'untracked', label: 'Not Tracked', count: counts.untracked },
  ]
  return <div className="inventory-tabs" role="tablist" aria-label="Stock status">
    {tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'active' : ''} onClick={() => onSelect(tab.id)}>
      <span>{tab.label}</span><strong>{tab.count}</strong>
    </button>)}
  </div>
}

function InventoryToolbar({ query, onQuery, sort, direction, onSort, onDirection, filters, onFilters, categories, vendors, locations }: {
  query: string
  onQuery: (value: string) => void
  sort: InventorySort
  direction: 'asc' | 'desc'
  onSort: (value: InventorySort) => void
  onDirection: () => void
  filters: FilterState
  onFilters: (value: FilterState) => void
  categories: readonly string[]
  vendors: readonly string[]
  locations: InventoryPageResult['locations']
}) {
  return <div className="inventory-toolbar">
    <label className="inventory-search">
      <Search size={16} />
      <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search by product name or SKU" aria-label="Search inventory" />
      {query && <button onClick={() => onQuery('')} aria-label="Clear search"><X size={14} /></button>}
    </label>
    <div className="inventory-toolbar-actions">
      {categories.length > 0 && <select aria-label="Filter by category" value={filters.category} onChange={(event) => onFilters({ ...filters, category: event.target.value })}>
        <option value="">All categories</option>
        {categories.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>}
      {vendors.length > 0 && <select aria-label="Filter by vendor" value={filters.vendor} onChange={(event) => onFilters({ ...filters, vendor: event.target.value })}>
        <option value="">All vendors</option>
        {vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
      </select>}
      {locations.length > 1 && <select aria-label="Filter by location" value={filters.locationId} onChange={(event) => onFilters({ ...filters, locationId: event.target.value })}>
        <option value="">All locations</option>
        {locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
      </select>}
      <div className="inventory-sort-control">
        <select aria-label="Sort inventory" value={sort} onChange={(event) => onSort(event.target.value as InventorySort)}>
          <option value="name">Sort: Name</option>
          <option value="stock">Sort: Stock</option>
          <option value="value">Sort: Value</option>
          <option value="category">Sort: Category</option>
          <option value="updated">Sort: Updated</option>
        </select>
        <button onClick={onDirection} aria-label={`Sort ${direction === 'asc' ? 'descending' : 'ascending'}`}>{direction === 'asc' ? '↑' : '↓'}</button>
      </div>
    </div>
  </div>
}

export function InventoryTable({ items, multiLocation, onSelect }: { items: readonly InventoryItem[]; multiLocation: boolean; onSelect: (id: string) => void }) {
  return <div className="inventory-table-wrap">
    <table className="inventory-table">
      <thead><tr>
        <th>Item</th><th>Category</th><th>Stock</th>{multiLocation && <th>Locations</th>}<th>Value</th><th>Status</th><th><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>{items.map((item) => <InventoryTableRow key={item.variantId} item={item} multiLocation={multiLocation} onSelect={onSelect} />)}</tbody>
    </table>
  </div>
}

function InventoryTableRow({ item, multiLocation, onSelect }: { item: InventoryItem; multiLocation: boolean; onSelect: (id: string) => void }) {
  return <tr tabIndex={0} onClick={() => onSelect(item.variantId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.variantId) } }}>
    <td data-label="Item">
      <div className="inventory-item-cell">
        <ProductThumbnail item={item} />
        <div><strong>{item.title}</strong><small>{[item.variantTitle, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(' · ') || 'No SKU'}</small></div>
      </div>
    </td>
    <td data-label="Category"><span>{item.category ?? '—'}</span>{item.vendor && <small>{item.vendor}</small>}</td>
    <td data-label="Stock"><StockQuantity item={item} /></td>
    {multiLocation && <td data-label="Locations"><LocationCell item={item} /></td>}
    <td data-label="Value"><strong>{formatMoney(item.value, item.currency)}</strong>{item.price !== null && <small>{formatMoney(item.price, item.currency)} each</small>}</td>
    <td data-label="Status"><StockLevelBadge status={item.status} /></td>
    <td data-label="Actions"><button className="inventory-action-button" aria-label={`View ${item.title}`} onClick={(event) => { event.stopPropagation(); onSelect(item.variantId) }}><MoreHorizontal size={17} /></button></td>
  </tr>
}

function ProductThumbnail({ item }: { item: InventoryItem }) {
  if (!item.imageUrl) return <span className="inventory-thumb placeholder" aria-hidden="true"><Boxes size={16} /></span>
  return <img className="inventory-thumb" src={item.imageUrl} alt="" loading="lazy" />
}

function StockQuantity({ item }: { item: InventoryItem }) {
  const tone = item.status === 'out' ? 'red' : item.status === 'low' ? 'amber' : item.status === 'untracked' ? 'muted' : 'green'
  return <div className="inventory-stock-cell">
    <strong className={`stock-quantity tone-${tone}`}>{quantityLabel(item)}</strong>
    {item.tracked && item.quantity !== null && <small>units on hand</small>}
  </div>
}

function LocationCell({ item }: { item: InventoryItem }) {
  const breakdown = locationBreakdown(item)
  if (breakdown.length === 0) return <small className="inventory-muted">No location data</small>
  const first = breakdown[0]
  if (!first) return <small className="inventory-muted">No location data</small>
  return <div className="inventory-location-cell">
    <span><MapPin size={13} /> {first.label}</span>
    {breakdown.length > 1 && <small>+{breakdown.length - 1} more location{breakdown.length === 2 ? '' : 's'}</small>}
  </div>
}

export function StockLevelBadge({ status }: { status: StockStatus }) {
  return <span className={`inventory-badge status-${status}`}>{stockStatusLabel(status)}</span>
}

function InventoryPagination({ pagination, onPage }: { pagination: InventoryPageResult['pagination']; onPage: (page: number) => void }) {
  return <footer className="inventory-pagination">
    <span>Showing {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} real items</span>
    <div>
      <button disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
      <strong>Page {pagination.page} of {pagination.pages}</strong>
      <button disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
    </div>
  </footer>
}

function InventoryDetailDrawer({ storeId, variantId, shop, onClose, onToast }: { storeId: string; variantId: string; shop: string | null; onClose: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [item, setItem] = useState<InventoryItem | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchInventoryItem(storeId, variantId)
      .then((value) => { if (!cancelled) setItem(value) })
      .catch((reason: unknown) => { if (!cancelled) onToast(errorText(reason), 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [storeId, variantId])

  return <div className="inventory-drawer-layer">
    <button className="inventory-drawer-backdrop" onClick={onClose} aria-label="Close inventory details" />
    <aside className="inventory-details-drawer" aria-label="Inventory item details">
      {loading || !item ? <div className="drawer-skeleton"><button onClick={onClose} aria-label="Close inventory details"><X size={18} /></button><span /><span /><span /><span /></div> : <>
        <header>
          <div>
            <div className="section-kicker">SHOPIFY INVENTORY · READ ONLY</div>
            <h2>{item.title}</h2>
            <span><StockLevelBadge status={item.status} />{item.sku && <small className="inventory-drawer-sku">SKU {item.sku}</small>}</span>
          </div>
          <button onClick={onClose} aria-label="Close inventory details"><X size={19} /></button>
        </header>
        <div className="inventory-drawer-scroll">
          <section className="inventory-detail-section">
            <h3><Boxes size={16} />Stock</h3>
            <dl className="inventory-detail-grid">
              <div><dt>On hand</dt><dd>{quantityLabel(item)}</dd></div>
              <div><dt>Unit price</dt><dd>{formatMoney(item.price, item.currency)}</dd></div>
              <div><dt>Stock value</dt><dd>{formatMoney(item.value, item.currency)}</dd></div>
              <div><dt>Tracking</dt><dd>{item.tracked ? 'Enabled in Shopify' : 'Not tracked in Shopify'}</dd></div>
              <div><dt>Oversell policy</dt><dd>{item.inventoryPolicy === 'continue' ? 'Continue selling when out of stock' : item.inventoryPolicy === 'deny' ? 'Stop selling when out of stock' : '—'}</dd></div>
              <div><dt>Source</dt><dd>{item.quantitySource === 'inventory_levels' ? 'Shopify inventory locations' : item.quantitySource === 'variant_inventory_quantity' ? 'Shopify variant quantity' : 'Not returned by Shopify'}</dd></div>
            </dl>
          </section>
          <section className="inventory-detail-section">
            <h3><MapPin size={16} />Locations</h3>
            {item.locations.length === 0 ? <p className="inventory-detail-empty">Shopify returned no per-location levels for this item.</p> : <ul className="inventory-location-list">
              {locationBreakdown(item).map((location) => <li key={location.id}>
                <div><strong>{location.label}</strong><small>{location.share}% of this item&apos;s stock</small></div>
                <strong>{formatUnits(location.available)}</strong>
              </li>)}
            </ul>}
          </section>
          <section className="inventory-detail-section">
            <h3><Layers size={16} />Product</h3>
            <dl className="inventory-detail-grid">
              <div><dt>Category</dt><dd>{item.category ?? '—'}</dd></div>
              <div><dt>Vendor</dt><dd>{item.vendor ?? '—'}</dd></div>
              <div><dt>Variant</dt><dd>{item.variantTitle ?? 'Single variant'}</dd></div>
              <div><dt>Product status</dt><dd>{item.productStatus ?? '—'}</dd></div>
              <div><dt>Stock updated</dt><dd>{formatDateTime(item.updatedAt)}</dd></div>
              <div><dt>Last synced</dt><dd>{formatDateTime(item.syncedAt)}</dd></div>
            </dl>
          </section>
        </div>
        <footer>
          <span>Shopify is the source of truth</span>
          {shop && <a className="button primary" href={`https://${shop}/admin/products/${encodeURIComponent(item.productId)}`} target="_blank" rel="noreferrer">Open in Shopify</a>}
        </footer>
      </>}
    </aside>
  </div>
}

function CoverageNote({ coverage }: { coverage: InventoryPageResult['coverage'] }) {
  return <p className="inventory-coverage-note">
    {coverage.explanation}
    {coverage.lastSyncedAt && ` Last synced ${formatDateTime(coverage.lastSyncedAt)}.`}
  </p>
}

export function InventoryEmptyState({ title, description, action, onAction, compact = false, busy = false }: { title: string; description: string; action: string; onAction: () => void; compact?: boolean; busy?: boolean }) {
  return <div className={`inventory-empty ${compact ? 'compact' : ''}`}>
    <span className="inventory-empty-icon"><Boxes size={compact ? 20 : 26} /></span>
    <strong>{title}</strong>
    <p>{description}</p>
    <button className="button primary" disabled={busy} onClick={onAction}>{action}</button>
  </div>
}

function InventoryErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="inventory-error"><AlertTriangle size={18} /><div><strong>Inventory could not be loaded</strong><p>{message}</p></div><button className="button secondary" onClick={onRetry}>Retry</button></div>
}

function InventoryTableSkeleton() {
  return <div className="inventory-table-skeleton">{[1, 2, 3, 4, 5].map((row) => <div key={row}>{[1, 2, 3, 4, 5, 6].map((cell) => <span key={cell} />)}</div>)}</div>
}

function planLabel(plan: InventoryPageResult['plan']): string {
  if (plan === 'commander') return 'Commander'
  if (plan === 'growth') return 'Growth'
  if (plan === 'start') return 'Start'
  return 'Trial'
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : 'Something went wrong'
}
