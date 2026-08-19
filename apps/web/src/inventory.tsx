import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  HeartPulse,
  Layers,
  LineChart,
  LockKeyhole,
  MapPin,
  MoreHorizontal,
  PackageX,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingDown,
  TrendingUp,
  Truck,
  X,
} from 'lucide-react'
import { fetchInventory, fetchInventoryHistory, fetchInventoryInsights, fetchInventoryItem } from './api.js'
import { PlanLockedFeature } from './orders.js'
import { CustomSelect } from './CustomSelect.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import type { SelectOption } from './CustomSelect.js'
import { AIInventoryInsightsCard } from './inventory-insights.js'
import type { InventoryHistoryResult, InventoryInsightsResult } from './inventory-insights-model.js'
import type { WorkspaceContext } from './model.js'
import type { DaysOfCover, InventoryItem, InventoryPageResult, InventoryQuery, InventoryRowItem, InventorySort, InventoryTab, StockStatus } from './inventory-model.js'
import { EMPTY_INVENTORY_PAGE, daysOfCoverLabel, daysOfCoverTone, distributionSegments, formatDateTime, formatMoney, formatUnits, locationBreakdown, locationLabel, lockedFeature, quantityLabel, stockStatusLabel } from './inventory-model.js'

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
  const [insights, setInsights] = useState<InventoryInsightsResult | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [insightsError, setInsightsError] = useState<string | null>(null)

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

  // Intelligence is fetched independently of the table so a slow AI call never
  // delays the real stock numbers.
  useEffect(() => {
    if (!context.storeId) { setInsights(null); setInsightsLoading(false); return }
    let cancelled = false
    setInsightsLoading(true)
    setInsightsError(null)
    void fetchInventoryInsights(context.storeId)
      .then((result) => { if (!cancelled) setInsights(result) })
      .catch((reason: unknown) => { if (!cancelled) setInsightsError(errorText(reason)) })
      .finally(() => { if (!cancelled) setInsightsLoading(false) })
    return () => { cancelled = true }
  }, [context.storeId, refreshVersion])

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
        <InventoryHealthCard data={data} loading={loading} storeId={context.storeId} />
        <StockDistributionChart data={data} loading={loading} onSelectTab={setActiveTab} />
        <InventoryValueSummary data={data} loading={loading} />
      </div>

      <BasicInsightsCard data={data} onUpgrade={upgrade} />

      <AIInventoryInsightsCard
        storeId={context.storeId}
        insights={insights}
        loading={insightsLoading}
        error={insightsError}
        onUpgrade={upgrade}
        onRetry={() => setRefreshVersion((value) => value + 1)}
        onToast={onToast}
      />

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
          onClear={() => { setQuery(''); setFilters(EMPTY_FILTERS); setPage(1) }}
          categories={data.categories}
          vendors={data.vendors}
          locations={data.locations}
          sortOptions={inventorySortOptions(lockedFeature(data, 'days_of_cover') === null)}
        />

        <InventoryTabs counts={data.tabCounts} active={activeTab} onSelect={(tab) => { setActiveTab(tab); setPage(1) }} />

        {loading ? <InventoryTableSkeleton /> : data.items.length === 0 ? (
          <InventoryEmptyState compact title="No items match these filters" description="Change the active tab, search text, or filters to see your synced stock." action="Clear filters" onAction={clearFilters} />
        ) : (
          <InventoryTable items={data.items} multiLocation={data.multiLocation} showDaysOfCover={lockedFeature(data, 'days_of_cover') === null} onSelect={setSelectedId} />
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
    { key: 'skus', label: 'Total Products', value: formatUnits(stats.totalSkus), hint: `${formatUnits(stats.trackedSkus)} tracked products`, icon: <Layers size={17} />, tone: 'blue' },
    { key: 'units', label: 'Units in Stock', value: formatUnits(stats.totalUnits), hint: stats.averageStock === null ? 'No tracked quantities yet' : `Average ${formatUnits(stats.averageStock)} per tracked product`, icon: <Boxes size={17} />, tone: 'green' },
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

export function InventoryHealthCard({ data, loading, storeId }: { data: InventoryPageResult; loading: boolean; storeId?: string }) {
  const { health } = data
  const [history, setHistory] = useState<InventoryHistoryResult | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  useEffect(() => {
    if (!storeId) { setHistory(null); setHistoryLoading(false); return }
    let cancelled = false
    setHistoryLoading(true)
    void fetchInventoryHistory(storeId, 30)
      .then((result) => { if (!cancelled) setHistory(result) })
      .catch(() => { if (!cancelled) setHistory(null) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [storeId])
  const unavailable = health.score === null
  const sweep = unavailable ? 0 : Math.max(8, Math.round(health.score * 2.4))
  const gradeColor = health.grade === 'A' || health.grade === 'A+' ? 'green' : health.grade === 'B' ? 'blue' : health.grade === 'C' ? 'amber' : health.grade === 'D' || health.grade === 'F' ? 'red' : 'muted'
  const labelText = unavailable ? 'No inventory data' : `${health.grade ? `${health.grade} · ` : ''}${health.label}`
  const trendPoints = (history?.points ?? []).filter((point) => point && Number.isFinite(point.units)).map((point) => ({ date: point.date, units: point.units }))
  const trendReady = trendPoints.length >= 2
  const change = trendReady ? healthTrendChange(trendPoints) : null
  const criticalItems = data.items
    .filter((item) => item.status === 'out' || item.status === 'low' || item.status === 'untracked')
    .sort((a, b) => criticalPriority(a.status) - criticalPriority(b.status))
    .slice(0, 3)
  return <article className="card inventory-health-card modern">
    <div className="inventory-card-label"><HeartPulse size={16} /><span>Inventory Health</span><span className={`grade-badge ${gradeColor}`}>{health.grade}</span></div>
    {loading ? <div className="inventory-skeleton-block" /> : <>
      <div className="inventory-health-gauge-wrap large">
        <div
          className={`health-gauge ${unavailable ? 'compact no-data' : `large ${health.tone}`} inventory-health-gauge`}
          style={unavailable ? undefined : { '--inventory-health-sweep': `${sweep}deg` } as CSSProperties}
          role="img"
          aria-label={unavailable ? 'Inventory health unavailable' : `Inventory health score ${health.score}, grade ${health.grade}, ${health.label}`}
        >
          <div className="gauge-inner">
            <strong>{unavailable ? '—' : health.score}</strong>
            <span>{labelText}</span>
          </div>
        </div>
      </div>
      <ul className="inventory-health-components modern">
        {health.components.map((component) => {
          const icon = component.key.includes('stockout') || component.key.includes('out') ? PackageX : component.key.includes('low') ? TrendingDown : component.key.includes('value') ? Coins : component.key.includes('turnover') ? TrendingUp : Boxes
          const Icon = icon as any
          return <li key={component.key}>
            <div><span className="metric-row-icon"><Icon size={14} /></span><span>{component.label}</span><strong>{component.score}%</strong></div>
            <div className="inventory-health-bar" role="presentation"><i style={{ width: `${component.score}%` }} className="animated" /></div>
            <small>{component.detail}</small>
          </li>
        })}
        {health.components.length === 0 && <li className="inventory-health-empty">Health is calculated from your real stock levels once inventory is synced.</li>}
      </ul>
      <div className="health-divider" />
      <div className="health-trend-block">
        <div className="health-trend-head">
          <span>Health Score Trend (30d)</span>
          {change && <em className={`health-trend-change ${change.tone}`} title={change.title}>{change.label}</em>}
        </div>
        {historyLoading ? <div className="health-trend-skeleton" /> : trendReady ? <>
          <div className="health-trend-wrap"><HealthTrendSparkline points={trendPoints} /></div>
          <small className="health-trend-note">Real stock snapshots · one recorded per inventory sync</small>
        </> : <div className="health-trend-empty"><strong>Building history…</strong><small>Health snapshots are recorded per inventory sync — the 30-day trend appears as real sync history accumulates.</small></div>}
      </div>
      <div className="health-divider" />
      <span className="health-critical-head">Needs Attention</span>
      {criticalItems.length > 0 ? <ul className="health-critical-list">
        {criticalItems.map((item) => <li key={item.variantId}>
          <i className={item.status} />
          <span title={item.title}>{item.title}</span>
          <strong>{item.status === 'out' ? 'Out of stock' : item.status === 'untracked' ? 'Untracked' : quantityLabel(item)}</strong>
        </li>)}
      </ul> : <p className="health-all-good"><CheckCircle2 size={13} /> All items healthy</p>}
      <button type="button" className="health-recs-button" onClick={() => document.querySelector('.inventory-ai-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>View All Recommendations →</button>
    </>}
  </article>
}

function criticalPriority(status: StockStatus): number { return status === 'out' ? 0 : status === 'low' ? 1 : 2 }

/** Real units-on-hand change over the trailing ~7 days of stock snapshots. */
function healthTrendChange(points: readonly Readonly<{ date: string; units: number }>[]): Readonly<{ label: string; tone: 'good' | 'watch' | 'neutral'; title: string }> | null {
  if (points.length < 2) return null
  const last = points[points.length - 1]!
  const lastDate = Date.parse(`${last.date}T00:00:00Z`)
  const weekAgo = lastDate - 7 * 86_400_000
  let reference = points[0]!
  for (const point of points) {
    const ts = Date.parse(`${point.date}T00:00:00Z`)
    if (Number.isFinite(ts) && ts <= weekAgo) reference = point
  }
  const delta = last.units - reference.units
  if (delta === 0) return { label: '— stable', tone: 'neutral', title: 'Stock level unchanged over the last 7 days' }
  return { label: `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} this week`, tone: delta > 0 ? 'good' : 'watch', title: 'Units on hand change over the last 7 days (real stock snapshots)' }
}

function HealthTrendSparkline({ points }: { points: readonly Readonly<{ date: string; units: number }>[] }) {
  const width = 240
  const height = 40
  const values = points.map((point) => point.units)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = width / Math.max(1, values.length - 1)
  const coords = values.map((value, index) => [index * stepX, height - 4 - ((value - min) / span) * (height - 8)] as const)
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = coords[coords.length - 1]!
  return <svg className="health-trend-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Inventory health score trend over the last 30 days">
    <polygon points={`0,${height} ${line} ${width},${height}`} className="health-trend-area" />
    <polyline points={line} className="health-trend-line" />
    <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r={2.4} className="health-trend-dot" />
  </svg>
}

export function StockDistributionChart({ data, loading, onSelectTab }: { data: InventoryPageResult; loading: boolean; onSelectTab?: (tab: InventoryTab) => void }) {
  const segments = distributionSegments(data.distribution)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const { stats, health } = data
  const reorderCount = stats.lowStockCount + stats.outOfStockCount
  const coveragePct = stats.totalSkus > 0 ? Math.round((stats.trackedSkus / stats.totalSkus) * 100) : 0
  const exportStockReport = () => {
    if (data.items.length === 0) return
    const headers = ['Title', 'Variant', 'SKU', 'Category', 'Quantity', 'Status', 'Value']
    const lines = data.items.map((item) => [item.title, item.variantTitle ?? '', item.sku ?? '', item.category ?? '', item.quantity ?? '', stockStatusLabel(item.status), item.value !== null ? String(item.value) : ''])
    const csv = [headers, ...lines].map((row) => row.map(csvCell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `profitpilot-stock-report-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return <article className="card inventory-distribution-card modern">
    <div className="inventory-card-label"><LineChart size={16} /><span>Stock Distribution</span></div>
    {loading ? <div className="inventory-skeleton-block" /> : total === 0 ? (
      <p className="inventory-card-empty">No stock levels to chart yet.</p>
    ) : <>
      <div className="inventory-donut">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={segments as unknown as Record<string, unknown>[]}
              dataKey="value"
              nameKey="label"
              innerRadius={55}
              outerRadius={82}
              paddingAngle={3}
              stroke="none"
            >
              {segments.map((segment) => <Cell key={segment.key} fill={segment.color} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13 }}
              formatter={(value: unknown, name: unknown) => [`${String(value)} SKUs`, String(name)]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="inventory-donut-center"><strong>{formatUnits(total)}</strong><span>SKUs</span></div>
      </div>
      <ul className="inventory-distribution-legend modern">
        {segments.map((segment) => {
          const pct = total > 0 ? Math.round((segment.value / total) * 100) : 0
          const tone = segment.key === 'healthy' ? 'stable' : segment.key === 'low' ? 'watch' : segment.key === 'out' ? 'action' : 'muted'
          const trendLabel = segment.key === 'healthy' ? 'Stable' : segment.key === 'low' ? 'Watch' : segment.key === 'out' ? 'Reorder' : 'Untracked'
          return <li key={segment.key}>
            <span className="legend-dot" style={{ background: segment.color }} />
            <span className="legend-status">{segment.label}</span>
            <strong className="legend-count">{segment.value}</strong>
            <small className="legend-pct">{pct}%</small>
            <em className={`distribution-trend ${tone}`}>{trendLabel}</em>
          </li>
        })}
      </ul>
      <div className="distribution-insights">
        <div className="distribution-callouts">
          <p><AlertTriangle size={14} /><span><b>{reorderCount} item{reorderCount === 1 ? '' : 's'} need reorder attention</b><small>{stats.lowStockCount} low stock · {stats.outOfStockCount} out of stock</small></span></p>
          <p><HeartPulse size={14} /><span><b>Stock health {health.grade} · {health.label}</b><small>{health.score === null ? 'Score unavailable until stock is synced' : `Score ${health.score}/100`}</small></span></p>
          <p><Layers size={14} /><span><b>{coveragePct}% of SKUs tracked</b><small>{formatUnits(stats.trackedSkus)} of {formatUnits(stats.totalSkus)} products have stock levels</small></span></p>
        </div>
        <div className="distribution-stats">
          <div><strong>{formatUnits(reorderCount)}</strong><span>Restock alerts</span></div>
          <div><strong>{coveragePct}%</strong><span>Stock coverage</span></div>
          <div><strong>{formatUnits(stats.averageStock)}</strong><span>Avg units / SKU</span></div>
        </div>
        <div className="distribution-actions">
          <button type="button" onClick={() => onSelectTab?.('low')} disabled={!onSelectTab}>View Low Stock Items</button>
          <button type="button" onClick={() => document.querySelector('.inventory-ai-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Reorder Recommendations</button>
          <button type="button" onClick={exportStockReport} disabled={data.items.length === 0}>Export Stock Report</button>
        </div>
      </div>
    </>}
  </article>
}

export function InventoryValueSummary({ data, loading }: { data: InventoryPageResult; loading: boolean }) {
  const { stats, topValueItems } = data
  const imageMap = new Map<string, string | null>()
  for (const row of data.items) {
    if (row.variantId && row.imageUrl) imageMap.set(row.variantId, row.imageUrl)
  }
  const totalValue = stats.totalValue ?? 0
  const topValue = topValueItems.reduce((sum, item) => sum + (item.value ?? 0), 0)
  const topSharePct = totalValue > 0 ? Math.round((topValue / totalValue) * 100) : 0
  const avgPerSku = stats.totalValue !== null && stats.valuedSkus > 0 ? stats.totalValue / stats.valuedSkus : null
  const exportValuation = () => {
    if (topValueItems.length === 0) return
    const headers = ['Title', 'Variant', 'Quantity', 'Value', 'Share %']
    const lines = topValueItems.map((item) => [item.title, item.variantTitle ?? '', item.quantity, item.value, totalValue > 0 ? Math.round((item.value / totalValue) * 100) : 0])
    const csv = [headers, ...lines].map((row) => row.map(csvCell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `profitpilot-inventory-valuation-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return <article className="card inventory-value-card modern">
    <div className="inventory-card-label"><Coins size={16} /><span>Inventory Value</span></div>
    {loading ? <div className="inventory-skeleton-block" /> : <>
      <strong className="inventory-value-total">{formatMoney(stats.totalValue, stats.currency)}</strong>
      <small>{stats.totalValue === null ? 'No variant prices were returned by Shopify.' : `Retail value across ${formatUnits(stats.valuedSkus)} priced products`}</small>
      {stats.totalValue !== null && <div className="value-metrics">
        <div><strong>{formatMoney(avgPerSku, stats.currency)}</strong><span>Avg value / SKU</span></div>
        <div><strong>{topValueItems.length > 0 ? `${topSharePct}%` : '—'}</strong><span>Top {topValueItems.length} product{topValueItems.length === 1 ? '' : 's'} hold</span></div>
        <div><strong>{formatUnits(stats.valuedSkus)}</strong><span>Valued SKUs</span></div>
      </div>}
      {topValueItems.length > 0 && <>
        <div className="value-insight-strip"><TrendingUp size={14} /><span>Top products hold <b>{topSharePct}%</b> of inventory value — concentrated stock means restock decisions matter more.</span></div>
        <ul className="inventory-top-value modern">
          {topValueItems.map((item) => {
            const img = imageMap.get(item.variantId) ?? null
            const pct = totalValue > 0 && item.value ? Math.round((item.value / totalValue) * 100) : 0
            return <li key={item.variantId} title={`${item.title}${item.variantTitle ? ` · ${item.variantTitle}` : ''} — ${formatMoney(item.value, stats.currency)} (${pct}% of total value)`}>
              <div className="value-item-main">
                {img ? <img src={img} alt="" className="value-item-thumb" /> : <span className="value-item-thumb placeholder"><PackageX size={14} /></span>}
                <div><strong title={item.title}>{item.title}</strong>{item.variantTitle && <small>{item.variantTitle}</small>}<div className="value-distribution-bar"><i style={{ width: `${pct}%` }} /><b>{pct}%</b></div></div>
              </div>
              <div className="inventory-top-value-amount"><strong>{formatMoney(item.value, stats.currency)}</strong><small>{formatUnits(item.quantity)} units</small></div>
            </li>
          })}
        </ul>
        <div className="value-actions">
          <button type="button" onClick={() => document.querySelector('.inventory-table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>View Full Report</button>
          <button type="button" onClick={exportValuation} disabled={topValueItems.length === 0}>Export Valuation</button>
        </div>
      </>}
    </>}
  </article>
}

export function BasicInsightsCard({ data, onUpgrade }: { data: InventoryPageResult; onUpgrade: () => void }) {
  const { topSellingItem, itemsNeedingAttention, healthGrade } = data.basicInsights
  return <section className="card inventory-insights">
    <header className="inventory-insights-header">
      <div className="inventory-insights-title">
        <span className="ai-insights-icon"><Boxes size={18} /></span>
        <div>
          <div className="section-kicker">INVENTORY INSIGHTS</div>
          <h2>Stock Insights</h2>
          <p>Calculated from your synced Shopify inventory. Nothing here is estimated.</p>
        </div>
      </div>
      <UpgradePlanButton plan={data.plan} onUpgrade={onUpgrade} />
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
      <LockedSlot data={data} feature="days_of_cover" title="Days of Cover" icon={<CalendarClock size={16} />} onUpgrade={onUpgrade} unlockedHint="Shown per item in the Days of Cover column below." />
    </div>
  </section>
}

/**
 * Locked-state slot for a premium feature inside the free insights grid. Growth+
 * plans see where the unlocked value now lives rather than a duplicate number.
 */
function LockedSlot({ data, feature, title, icon, onUpgrade, unlockedHint, compact = false }: { data: InventoryPageResult; feature: string; title: string; icon: ReactNode; onUpgrade: () => void; unlockedHint: string; compact?: boolean }) {
  const locked = lockedFeature(data, feature)
  if (locked) return <PlanLockedFeature featureName={locked.name} requiredPlan={locked.required_plan} onUpgrade={onUpgrade}><InventoryMask compact={compact} /></PlanLockedFeature>
  return <article className={`inventory-basic-card ${compact ? 'compact' : ''}`}>
    <div className="inventory-card-label">{icon}<span>{title}</span></div>
    <InsightPending message={unlockedHint} />
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

/** Sort choices. Days of cover only appears when the plan actually computes it. */
export function inventorySortOptions(daysOfCoverUnlocked: boolean): readonly SelectOption<InventorySort>[] {
  const base: readonly SelectOption<InventorySort>[] = [
    { value: 'name', label: 'Product name' },
    { value: 'stock', label: 'Stock level' },
    { value: 'value', label: 'Stock value' },
    { value: 'category', label: 'Category' },
    { value: 'updated', label: 'Last updated' },
  ]
  return daysOfCoverUnlocked ? [...base, { value: 'days_of_cover', label: 'Days of cover' }] : base
}

export function InventoryToolbar({ query, onQuery, sort, direction, onSort, onDirection, filters, onFilters, onClear, categories, vendors, locations, sortOptions }: {
  query: string
  onQuery: (value: string) => void
  sort: InventorySort
  direction: 'asc' | 'desc'
  onSort: (value: InventorySort) => void
  onDirection: () => void
  filters: FilterState
  onFilters: (value: FilterState) => void
  onClear?: () => void
  categories: readonly string[]
  vendors: readonly string[]
  locations: InventoryPageResult['locations']
  sortOptions: readonly SelectOption<InventorySort>[]
}) {
  const categoryOptions: readonly SelectOption<string>[] = [{ value: '', label: 'All categories' }, ...categories.map((category) => ({ value: category, label: category }))]
  const vendorOptions: readonly SelectOption<string>[] = [{ value: '', label: 'All vendors' }, ...vendors.map((vendor) => ({ value: vendor, label: vendor }))]
  const locationOptions: readonly SelectOption<string>[] = [{ value: '', label: 'All locations' }, ...locations.map((location) => ({ value: location.id, label: locationLabel(location) }))]
  const showFilters = categories.length > 0 || vendors.length > 0 || locations.length > 1
  const hasActiveFilters = Boolean(query || filters.category || filters.vendor || filters.locationId)
  const nextDirection = direction === 'asc' ? 'descending' : 'ascending'
  return <div className="inventory-toolbar">
    <div className="inventory-toolbar-primary">
      <label className="inventory-search">
        <Search size={16} />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search by product name or SKU" aria-label="Search inventory" />
        {query && <button type="button" onClick={() => onQuery('')} aria-label="Clear search"><X size={14} /></button>}
      </label>
      <div className="inventory-sort-control" role="group" aria-label="Sort inventory">
        <CustomSelect
          className="inventory-select inventory-sort-select"
          ariaLabel="Sort inventory by"
          value={sort}
          options={sortOptions}
          onChange={onSort}
          icon={<ArrowUpDown size={14} />}
          label="Sort by"
        />
        <button
          type="button"
          onClick={onDirection}
          aria-label={`Sort ${nextDirection}`}
          title={`Currently ${direction === 'asc' ? 'ascending' : 'descending'}. Switch to ${nextDirection}.`}
        >
          {direction === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
        </button>
      </div>
    </div>
    {showFilters && <div className="inventory-toolbar-filters">
      {categories.length > 0 && <CustomSelect className="inventory-select" ariaLabel="Filter by category" value={filters.category} options={categoryOptions} onChange={(value) => onFilters({ ...filters, category: value })} icon={<Tag size={13} />} />}
      {vendors.length > 0 && <CustomSelect className="inventory-select" ariaLabel="Filter by vendor" value={filters.vendor} options={vendorOptions} onChange={(value) => onFilters({ ...filters, vendor: value })} icon={<Truck size={13} />} />}
      {locations.length > 1 && <CustomSelect className="inventory-select" ariaLabel="Filter by location" value={filters.locationId} options={locationOptions} onChange={(value) => onFilters({ ...filters, locationId: value })} icon={<MapPin size={13} />} />}
      {hasActiveFilters && onClear && <button type="button" className="inventory-clear-filters" onClick={onClear}>Clear filters</button>}
    </div>}
  </div>
}

export function InventoryTable({ items, multiLocation, onSelect, showDaysOfCover = false }: { items: readonly InventoryRowItem[]; multiLocation: boolean; onSelect: (id: string) => void; showDaysOfCover?: boolean }) {
  return <div className="inventory-table-wrap">
    <table className="inventory-table">
      <thead><tr>
        <th>Item</th><th>Category</th><th>Stock</th>{multiLocation && <th>Locations</th>}{showDaysOfCover && <th>Days of Cover</th>}<th>Value</th><th>Status</th><th><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>{items.map((item) => <InventoryTableRow key={item.variantId} item={item} multiLocation={multiLocation} showDaysOfCover={showDaysOfCover} onSelect={onSelect} />)}</tbody>
    </table>
  </div>
}

function InventoryTableRow({ item, multiLocation, showDaysOfCover, onSelect }: { item: InventoryRowItem; multiLocation: boolean; showDaysOfCover: boolean; onSelect: (id: string) => void }) {
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
    {showDaysOfCover && <td data-label="Days of Cover"><DaysOfCoverCell cover={item.daysOfCover} /></td>}
    <td data-label="Value"><strong>{formatMoney(item.value, item.currency)}</strong>{item.price !== null && <small>{formatMoney(item.price, item.currency)} each</small>}</td>
    <td data-label="Status"><StockLevelBadge status={item.status} /></td>
    <td data-label="Actions"><button className="inventory-action-button" aria-label={`View ${item.title}`} onClick={(event) => { event.stopPropagation(); onSelect(item.variantId) }}><MoreHorizontal size={17} /></button></td>
  </tr>
}

/**
 * Growth+ column. An item without 30 days of sales history, or a variant of a
 * multi-variant product (Shopify reports sales per product), says so instead of
 * showing a number that would be invented.
 */export function DaysOfCoverCell({ cover }: { cover: DaysOfCover }) {
  const label = daysOfCoverLabel(cover)
  if (cover.status === 'available') return <div className="inventory-cover-cell"><strong className={`tone-${daysOfCoverTone(cover)}`}>{label}</strong><small>{cover.velocity.toLocaleString(undefined, { maximumFractionDigits: 2 })} units/day</small></div>
  if (cover.status === 'locked') return <div className="inventory-cover-cell"><strong className="tone-muted" title="Upgrade to unlock"><LockKeyhole size={12} /> Upgrade</strong><small>Unlock to calculate</small></div>
  return <div className="inventory-cover-cell"><strong className="tone-muted">{label}</strong><small title={cover.message}>{cover.reason === 'variant_sales_unavailable' ? 'Sales are per product' : cover.reason === 'no_sales' ? 'No sales in 30 days' : cover.reason === 'no_stock_signal' ? 'No tracked quantity' : 'Awaiting sales history'}</small></div>
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

function csvCell(value: unknown): string {
  const text = String(value)
  return /[\",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
