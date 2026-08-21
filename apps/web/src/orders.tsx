import { Button, RichButton } from './polaris-ui.js'
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  DollarSign,
  Download,
  ExternalLink,
  Filter,
  Lightbulb,
  LockKeyhole,
  MoreHorizontal,
  Package,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  HeartPulse,
  UserRound,
  Users,
  X,
  XCircle,
} from './icons.js'
import { fetchOrder, fetchOrderInsights, fetchOrders } from './api.js'
import { CustomSelect } from './CustomSelect.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import type { WorkspaceContext } from './model.js'
import type { OrderAddress, OrderInsightFeature, OrderInsightsResult, OrderLine, OrderQuery, OrdersPageResult, OrderStatus, OrderView, PaymentStatus } from './orders-model.js'
import { initials, insightByFeature, isInsightData, lockedInsightByFeature, orderStatusLabel, paymentStatusLabel } from './orders-model.js'

type ToastKind = 'success' | 'info' | 'warning' | 'error'
type OrdersWorkspaceProps = Readonly<{
  context: WorkspaceContext
  onSync: (module: string) => Promise<void>
  onNavigate: (page: 'billing' | 'products' | 'orders') => void
  onToast: (message: string, kind?: ToastKind) => void
}>

type FilterState = Readonly<{ orderId: string; customer: string; phone: string; product: string; payment: PaymentStatus | ''; status: OrderStatus | ''; dateFrom: string; dateTo: string }>
const EMPTY_FILTERS: FilterState = { orderId: '', customer: '', phone: '', product: '', payment: '', status: '', dateFrom: '', dateTo: '' }
const EMPTY_PAGE: OrdersPageResult = { orders: [], tabCounts: { all: 0, new: 0, completed: 0, canceled: 0, pending: 0 }, pagination: { page: 1, limit: 20, total: 0, pages: 1 } }

export function OrdersWorkspace({ context, onSync, onNavigate, onToast }: OrdersWorkspaceProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | OrderStatus>('all')
  const [sort, setSort] = useState<'date' | 'price' | 'status'>('date')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<OrdersPageResult>(EMPTY_PAGE)
  const [insights, setInsights] = useState<OrderInsightsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1) }, 260)
    return () => window.clearTimeout(timer)
  }, [query])

  const requestQuery = useMemo<OrderQuery>(() => ({ q: debouncedQuery, ...filters, status: activeTab === 'all' ? filters.status : activeTab, sort, direction, page, limit: 20 }), [debouncedQuery, filters, activeTab, sort, direction, page])

  useEffect(() => {
    if (!context.storeId) { setData(EMPTY_PAGE); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchOrders(context.storeId, requestQuery).then((result) => { if (!cancelled) setData(result) }).catch((reason: unknown) => { if (!cancelled) setError(errorText(reason)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [context.storeId, requestQuery, refreshVersion])

  useEffect(() => {
    if (!context.storeId) { setInsights(null); setInsightsLoading(false); return }
    let cancelled = false
    setInsightsLoading(true)
    void fetchOrderInsights(context.storeId).then((result) => { if (!cancelled) setInsights(result) }).catch((reason: unknown) => { if (!cancelled) onToast(errorText(reason), 'error') }).finally(() => { if (!cancelled) setInsightsLoading(false) })
    return () => { cancelled = true }
  }, [context.storeId, refreshVersion])

  const sync = async () => {
    setSyncing(true)
    try { await onSync('orders'); setRefreshVersion((value) => value + 1) } finally { setSyncing(false) }
  }

  const exportCsv = async () => {
    if (!context.storeId) return
    setExporting(true)
    try {
      const rows: OrderView[] = []
      let nextPage = 1
      let pages = 1
      do {
        const result = await fetchOrders(context.storeId, { ...requestQuery, page: nextPage, limit: 100 })
        rows.push(...result.orders)
        pages = result.pagination.pages
        nextPage += 1
      } while (nextPage <= pages)
      downloadOrders(rows)
      onToast(`${rows.length} real order${rows.length === 1 ? '' : 's'} exported.`, 'success')
    } catch (reason: unknown) { onToast(errorText(reason), 'error') } finally { setExporting(false) }
  }

  if (!context.storeId) return <OrdersEmptyState title="Connect Shopify to view orders" description="ProfitPilot only displays orders returned by your connected Shopify store." action="Open billing" onAction={() => onNavigate('billing')} />

  return <div className="orders-workspace">
    <div className="orders-page-actions">
      <Button className="button secondary" disabled={syncing} onClick={() => void sync()}><RefreshCw size={15} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing…' : 'Sync orders'}</Button>
    </div>

    <OrderTabs counts={data.tabCounts} active={activeTab} onSelect={(tab) => { setActiveTab(tab); setPage(1) }} />

    <OrdersInsightsCard result={insights} loading={insightsLoading} storeId={context.storeId} onNavigateBilling={() => onNavigate('billing')} onToast={onToast} orders={data.orders} ordersTotal={data.pagination.total} onNavigate={onNavigate} />

    <section className="card orders-table-card">
      <div className="orders-toolbar">
        <label className="orders-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by order ID or customer" aria-label="Search orders" />{query && <Button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></Button>}</label>
        <div className="orders-toolbar-actions">
          <Button className={`button secondary ${filterOpen ? 'active' : ''}`} onClick={() => { setDraftFilters(filters); setFilterOpen((value) => !value) }}><Filter size={14} /> Filters{activeFilterCount(filters) > 0 && <span className="filter-count">{activeFilterCount(filters)}</span>}</Button>
          <SortControl sort={sort} direction={direction} onSort={(value) => { setSort(value); setPage(1) }} onDirection={() => { setDirection((value) => value === 'asc' ? 'desc' : 'asc'); setPage(1) }} />
          <Button className="button secondary" disabled={exporting || data.pagination.total === 0} onClick={() => void exportCsv()}><Download size={14} /> {exporting ? 'Exporting…' : 'Export'}</Button>
        </div>
      </div>

      {filterOpen && <OrderFilterPanel value={draftFilters} onChange={setDraftFilters} onApply={() => { setFilters(draftFilters); setActiveTab(draftFilters.status || activeTab); setPage(1); setFilterOpen(false) }} onClear={() => { setDraftFilters(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setActiveTab('all'); setPage(1) }} />}

      {error ? <OrdersErrorState message={error} onRetry={() => setRefreshVersion((value) => value + 1)} /> : loading ? <OrdersTableSkeleton /> : data.orders.length === 0 ? <OrdersEmptyState compact title={data.tabCounts.all === 0 ? 'No synced orders yet' : 'No orders match these filters'} description={data.tabCounts.all === 0 ? 'Sync Shopify orders to populate this page. No demo records will be inserted.' : 'Change the active tab, search, or filter fields.'} action={data.tabCounts.all === 0 ? 'Sync orders' : 'Clear filters'} onAction={data.tabCounts.all === 0 ? () => void sync() : () => { setQuery(''); setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); setActiveTab('all'); setPage(1) }} /> : <OrdersTable orders={data.orders} onSelect={setSelectedId} />}

      {!loading && data.pagination.total > 0 && <OrdersPagination pagination={data.pagination} onPage={setPage} />}
    </section>

    {selectedId && <OrderDetailsDrawer storeId={context.storeId} orderId={selectedId} shop={context.shop} onClose={() => setSelectedId(null)} onToast={onToast} />}
  </div>
}

function OrderTabs({ counts, active, onSelect }: { counts: OrdersPageResult['tabCounts']; active: 'all' | OrderStatus; onSelect: (tab: 'all' | OrderStatus) => void }) {
  const tabs: readonly { id: 'all' | OrderStatus; label: string; count: number }[] = [
    { id: 'all', label: 'All Orders', count: counts.all },
    { id: 'new', label: 'New', count: counts.new },
    { id: 'completed', label: 'Completed', count: counts.completed },
    { id: 'canceled', label: 'Canceled', count: counts.canceled },
    { id: 'pending', label: 'Pending', count: counts.pending },
  ]
  return <div className="orders-tabs" role="tablist" aria-label="Order status">
    {tabs.map((tab) => <RichButton key={tab.id} role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'active' : ''} onClick={() => onSelect(tab.id)}><span>{tab.label}</span><strong>{tab.count}</strong></RichButton>)}
  </div>
}

function OrdersInsightsCard({ result, loading, storeId, onNavigateBilling, onToast, orders, ordersTotal, onNavigate }: { result: OrderInsightsResult | null; loading: boolean; storeId: string; onNavigateBilling: () => void; onToast: (message: string, kind?: ToastKind) => void; orders?: readonly OrderView[]; ordersTotal?: number; onNavigate?: (page: 'billing' | 'products' | 'orders') => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [customInsight, setCustomInsight] = useState<ReturnType<typeof insightByFeature>>(null)
  const available = (feature: OrderInsightFeature) => insightByFeature(result, feature)
  const locked = (feature: OrderInsightFeature) => lockedInsightByFeature(result, feature)
  const ask = async () => {
    if (!question.trim()) return
    setAsking(true)
    try { const response = await fetchOrderInsights(storeId, { feature: 'custom_ai_queries', question }); setCustomInsight(insightByFeature(response, 'custom_ai_queries')); setQuestion('') } catch (reason: unknown) { onToast(errorText(reason), 'error') } finally { setAsking(false) }
  }

  return <section className={`card orders-insights ${collapsed ? 'collapsed' : ''}`}>
    <header className="orders-insights-header">
      <div className="orders-insights-title"><span className="ai-insights-icon"><ShoppingBag size={18} /></span><div><div className="section-kicker">ORDER INTELLIGENCE</div><h2>AI Insights</h2><p>Smart analysis from your Shopify orders.</p></div></div>
      <div className="orders-insights-head-actions">{result && <UpgradePlanButton plan={result.plan} onUpgrade={onNavigateBilling} />}<Button onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand AI insights' : 'Collapse AI insights'}>{collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}</Button></div>
    </header>
    {!collapsed && <div className="orders-insights-body">
      {loading ? <InsightsSkeleton /> : !result ? <div className="orders-insight-unavailable"><AlertTriangle size={18} /> Insights could not be loaded.</div> : <>
        {!result.sufficientData && <div className="orders-insufficient"><Clock3 size={15} /><span><strong>Early signal mode</strong> — advanced insights are available after 5 real orders. Basic facts below remain exact.</span></div>}
        <div className="orders-basic-insights">
          <TopProductInsight insight={available('top_selling_product')} orders={orders ?? []} ordersTotal={ordersTotal ?? 0} onNavigate={onNavigate} />
          <CancellationRateCard insight={available('cancellation_rate')} orders={orders ?? []} />
          <FulfillmentRateCard insight={available('fulfillment_rate')} orders={orders ?? []} />
          <OrderHealthInsight insight={available('order_health_score')} totalOrders={result.orderCount} orders={orders ?? []} />
        </div>
        <div className="orders-premium-insights">
          <InsightSlot feature="peak_times" title="Peak Order Times" icon={<Clock3 size={16} />} available={available('peak_times')} locked={locked('peak_times')} onUpgrade={onNavigateBilling}><PeakTimeContent insight={available('peak_times')} /></InsightSlot>
          <InsightSlot feature="repeat_customers" title="Repeat Customers" icon={<Users size={16} />} available={available('repeat_customers')} locked={locked('repeat_customers')} onUpgrade={onNavigateBilling}><RepeatContent insight={available('repeat_customers')} /></InsightSlot>
          <InsightSlot feature="ai_suggestion" title="AI Suggestion" icon={<Lightbulb size={16} />} available={available('ai_suggestion')} locked={locked('ai_suggestion')} onUpgrade={onNavigateBilling}><AiSuggestionContent insight={available('ai_suggestion')} usage={result.usage} /></InsightSlot>
          <InsightSlot feature="trend_comparisons" title="Period Comparison" icon={<TrendingUp size={16} />} available={available('trend_comparisons')} locked={locked('trend_comparisons')} onUpgrade={onNavigateBilling}><TrendComparisonContent insight={available('trend_comparisons')} /></InsightSlot>
        </div>
        <div className="orders-commander-row">
          <CommanderCapability title="Anomaly alerts" icon={<AlertTriangle size={15} />} insight={available('anomaly_alerts')} locked={locked('anomaly_alerts')} onUpgrade={onNavigateBilling} />
          <CommanderCapability title="Auto-action suggestions" icon={<Bot size={15} />} insight={available('auto_action_suggestions')} locked={locked('auto_action_suggestions')} onUpgrade={onNavigateBilling} />
          <CommanderCapability title="Custom AI queries" icon={<ShoppingBag size={15} />} insight={available('custom_ai_queries')} locked={locked('custom_ai_queries')} onUpgrade={onNavigateBilling} />
        </div>
        {available('custom_ai_queries') && <div className="orders-custom-query"><div><ShoppingBag size={16} /><span><strong>Ask order intelligence</strong><small>Commander answers from aggregate order facts only.</small></span></div><div><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should I review in my orders?" aria-label="Custom order insight query" /><Button disabled={!question.trim() || asking} onClick={() => void ask()}>{asking ? <RefreshCw size={14} className="spin" /> : <Send size={14} />}</Button></div><CustomQueryAnswer insight={customInsight ?? available('custom_ai_queries')} /></div>}
      </>}
    </div>}
  </section>
}

export function PlanLockedFeature({
  featureName,
  requiredPlan: _requiredPlan,
  description,
  children,
  onUpgrade,
}: {
  featureName: string
  requiredPlan?: 'growth' | 'commander'
  description?: string
  children: ReactNode
  onUpgrade: () => void
}) {
  const tagline = description ?? (_requiredPlan === 'commander' ? 'Upgrade to Commander to unlock' : 'Upgrade to unlock')
  return (
    <RichButton
      className="plan-locked-feature"
      onClick={onUpgrade}
      aria-label={`Upgrade to unlock ${featureName}`}
      title={tagline}
    >
      <span className="plan-locked-blur" aria-hidden="true">
        {children}
      </span>
      <span className="plan-locked-overlay">
        <LockKeyhole size={18} />
        <span className="plan-locked-text">
          <strong>{featureName}</strong>
          <small>{tagline}</small>
        </span>
        <span className="plan-locked-cta" aria-hidden="true">Upgrade</span>
      </span>
    </RichButton>
  )
}

function InsightSlot({ title, icon, available, locked, children, onUpgrade }: { feature: OrderInsightFeature; title: string; icon: ReactNode; available: unknown; locked: ReturnType<typeof lockedInsightByFeature>; children: ReactNode; onUpgrade: () => void }) {
  if (locked) return <PlanLockedFeature featureName={title} requiredPlan={locked.required_plan} onUpgrade={onUpgrade}><InsightMask /></PlanLockedFeature>
  return <article className="orders-premium-card"><div className="orders-insight-label">{icon}<span>{title}</span></div>{available ? children : <InsightUnavailable />}</article>
}

export function TopProductInsight({ insight, orders, ordersTotal, onNavigate }: { insight: ReturnType<typeof insightByFeature>; orders: readonly OrderView[]; ordersTotal: number; onNavigate: ((page: 'billing' | 'products' | 'orders') => void) | undefined }) {
  const data = record(insight?.data)
  if (data.status !== 'available') return <article className="orders-basic-card top-product"><div className="orders-insight-label"><Package size={16} /><span>Top Selling Product</span></div><InsightUnavailable /></article>
  const title = text(data.title) ?? 'Product title unavailable'
  const productId = text(data.productId)
  const quantity = numberOrNull(data.quantity) ?? 0
  const revenue = numberOrNull(data.revenue)
  const currency = text(data.currency)
  const unitPrice = quantity > 0 && revenue !== null ? revenue / quantity : null
  // The stats below are computed from the real order rows currently loaded, so
  // they are labeled with the exact scope they cover and never extrapolated.
  const valid = orders.filter((order) => order.status !== 'canceled' && order.paymentStatus !== 'refunded' && order.paymentStatus !== 'not_paid')
  const isMatch = (line: OrderLine) => (productId !== null ? line.productId === productId : line.title?.toLowerCase() === title.toLowerCase())
  const matching = valid.filter((order) => order.lineItems.some(isMatch))
  const totalLineRevenue = valid.reduce((sum, order) => sum + order.lineItems.reduce((lineSum, line) => lineSum + (line.price ?? 0) * line.quantity, 0), 0)
  const productLineRevenue = matching.reduce((sum, order) => sum + order.lineItems.reduce((lineSum, line) => lineSum + (isMatch(line) ? (line.price ?? 0) * line.quantity : 0), 0), 0)
  const revenueShare = totalLineRevenue > 0 ? (productLineRevenue / totalLineRevenue) * 100 : null
  const matchingUnits = matching.reduce((sum, order) => sum + order.lineItems.reduce((lineSum, line) => lineSum + (isMatch(line) ? line.quantity : 0), 0), 0)
  const avgUnitsWhenOrdered = matching.length > 0 ? matchingUnits / matching.length : null
  const productUnits = new Map<string, number>()
  for (const order of valid) for (const line of order.lineItems) {
    const key = line.productId ?? line.title ?? 'custom'
    productUnits.set(key, (productUnits.get(key) ?? 0) + line.quantity)
  }
  const unitValues = [...productUnits.values()]
  const avgProductUnits = unitValues.length > 0 ? unitValues.reduce((sum, value) => sum + value, 0) / unitValues.length : 0
  const multipleOfAverage = avgProductUnits > 0 ? quantity / avgProductUnits : null
  const scope = ordersTotal > 0 && orders.length < ordersTotal ? `across ${orders.length} loaded orders` : ordersTotal > 0 ? `across ${ordersTotal} orders` : null
  return <article className="orders-basic-card top-product">
    <div className="orders-insight-label"><Package size={16} /><span>Top Selling Product</span></div>
    <div className="top-product-layout">
      <div className="top-product-head">
        <span className="top-product-thumb">{title.slice(0, 1).toUpperCase()}</span>
        <div><strong title={title}>{title}</strong><p>{quantity} sold · {money(revenue, currency)}</p></div>
      </div>
      <div className="top-product-stats">
        <div><strong>{money(unitPrice, currency)}</strong><span>Avg sale price</span></div>
        <div><strong>{matching.length}</strong><span>Orders featuring it</span></div>
        <div><strong>{revenueShare === null ? '—' : `${revenueShare.toFixed(0)}%`}</strong><span>Of line revenue{scope ? ` ${scope}` : ''}</span></div>
      </div>
      <div className="top-product-insights">
        <p><TrendingUp size={13} /><span><b>Baseline building</b><small>Growth vs the prior period appears as order history accumulates</small></span></p>
        {avgUnitsWhenOrdered !== null && <p><ShoppingBag size={13} /><span><b>{avgUnitsWhenOrdered.toFixed(2)} units</b><small>per order when this product is featured</small></span></p>}
        {multipleOfAverage !== null && <p><Sparkles size={13} /><span><b>{multipleOfAverage.toFixed(1)}x the average product</b><small>by units sold across synced orders</small></span></p>}
      </div>
      <div className="top-product-actions">
        <Button type="button" onClick={() => onNavigate?.('products')}>View Product Details</Button>
        <Button type="button" onClick={() => document.querySelector('.orders-table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>See All Orders</Button>
      </div>
    </div>
  </article>
}
export function CancellationRateCard({ insight, orders = [] }: { insight: ReturnType<typeof insightByFeature>; orders?: readonly OrderView[] }) {
  const data = record(insight?.data)
  const rate = numberOrNull(data.rate)
  const canceled = numberOrNull(data.canceled) ?? 0
  const total = numberOrNull(data.total) ?? 0
  const completed = Math.max(0, total - canceled)
  const tone = rate === null ? 'muted' : rate === 0 ? 'excellent' : rate < 5 ? 'good' : rate < 10 ? 'watch' : 'attention'
  const sweep = total > 0 ? Math.max(2, Math.round((completed / total) * 360)) : 360
  const refunded = refundedAmount(orders)
  const comparison = refundComparison(orders)
  const status = cancellationStatus(rate)
  return <article className={`orders-basic-card rate-card cancellation ${tone}`}>
    <div className="orders-insight-label"><AlertTriangle size={16} /><span>Cancellation Rate</span><i className={`rate-dot ${tone}`} /></div>
    <div className="rate-card-body">
      <div className="rate-donut" role="img" aria-label={`${rate === null ? '—' : `${rate}%`} of orders canceled, ${completed} of ${total} completed`} style={{ background: rate === null ? 'conic-gradient(rgba(107,114,128,.18) 360deg, rgba(107,114,128,.18) 0)' : `conic-gradient(rgb(16, 185, 129) ${sweep}deg, rgb(239, 68, 68) 0)` }}>
        <div><strong>{rate === null ? '—' : `${rate}%`}</strong><span>Cancelled</span></div>
      </div>
      <p className="rate-subtitle">{total === 0 ? 'No orders synced yet' : `${canceled} of ${total} order${total === 1 ? '' : 's'} cancelled`}</p>
    </div>
    <div className="rate-divider" />
    <div className="rate-metrics" aria-label="Cancellation details">
      <div className="rate-detail-row" title="Sum of fully refunded order totals from loaded Shopify orders">
        <span className="rate-detail-label"><DollarSign size={15} /><span>Refunded</span></span>
        <strong>{refunded === null ? '—' : money(refunded, currencyOf(orders))}</strong>
      </div>
      <div className="rate-detail-row" title={comparison.tooltip}>
        <span className="rate-detail-label"><TrendingUp size={15} /><span>vs Last Period</span></span>
        <strong className={`cmp-${comparison.tone}`}>{comparison.label}</strong>
      </div>
    </div>
    <div className={`rate-status-bar ${status.tone}`}>{status.icon}<span>{status.label}</span></div>
  </article>
}
export function FulfillmentRateCard({ insight, orders = [] }: { insight: ReturnType<typeof insightByFeature>; orders?: readonly OrderView[] }) {
  const data = record(insight?.data)
  const rate = numberOrNull(data.rate)
  const fulfilled = numberOrNull(data.fulfilled) ?? 0
  const total = numberOrNull(data.total) ?? 0
  const remaining = Math.max(0, total - fulfilled)
  const tone = rate === null ? 'muted' : rate === 100 ? 'excellent' : rate >= 80 ? 'good' : rate >= 50 ? 'watch' : 'attention'
  const sweep = total > 0 ? Math.max(2, Math.round((fulfilled / total) * 360)) : 360
  const restColor = rate === 0 && total > 0 ? 'rgb(239, 68, 68)' : 'rgb(245, 158, 11)'
  const avgDays = averageFulfillmentDays(orders)
  const status = fulfillmentStatus(rate, total)
  return <article className={`orders-basic-card rate-card fulfillment ${tone}`}>
    <div className="orders-insight-label"><CheckCircle2 size={16} /><span>Fulfillment Rate</span><i className={`rate-dot ${tone}`} /></div>
    <div className="rate-card-body">
      <div className="rate-donut" role="img" aria-label={`${rate === null ? '—' : `${rate}%`} of orders fulfilled, ${fulfilled} of ${total}`} style={{ background: rate === null ? 'conic-gradient(rgba(107,114,128,.18) 360deg, rgba(107,114,128,.18) 0)' : `conic-gradient(rgb(37, 99, 235) ${sweep}deg, ${restColor} 0)` }}>
        <div><strong>{rate === null ? '—' : `${rate}%`}</strong><span>Fulfilled</span></div>
      </div>
      <p className="rate-subtitle">{total === 0 ? 'No orders synced yet' : `${fulfilled} of ${total} order${total === 1 ? '' : 's'} fulfilled`}</p>
    </div>
    <div className="rate-divider" />
    <div className="rate-metrics" aria-label="Fulfillment details">
      <div className="rate-detail-row" title="Unfulfilled orders from the current order data">
        <span className="rate-detail-label"><Package size={15} /><span>Pending</span></span>
        <strong>{total === 0 ? '—' : `${remaining} order${remaining === 1 ? '' : 's'}`}</strong>
      </div>
      <div className="rate-detail-row" title={avgDays === null ? 'Awaiting fulfillment data' : 'Average of Shopify order timestamps (created → last updated) for fulfilled orders'}>
        <span className="rate-detail-label"><Clock3 size={15} /><span>Avg Fulfill Time</span></span>
        <strong>{avgDays === null ? '—' : `${avgDays.toFixed(1)} days`}</strong>
      </div>
    </div>
    <div className={`rate-status-bar ${status.tone}`}>{status.icon}<span>{status.label}</span></div>
  </article>
}
export function OrderHealthInsight({ insight, totalOrders, orders = [] }: { insight: ReturnType<typeof insightByFeature>; totalOrders: number; orders?: readonly OrderView[] }) {
  const data = record(insight?.data)
  const insufficient = data.status === 'insufficient_data'
  const score = numberOrNull(data.score)
  const grade = text(data.grade) ?? '—'
  const fulfilledRate = numberOrNull(data.fulfilledRate)
  const cancelledRate = numberOrNull(data.cancelledRate)
  const paidRate = numberOrNull(data.paidRate)
  const gradeColor = grade === 'A' || grade === 'A+' ? 'green' : grade === 'B' ? 'blue' : grade === 'C' ? 'amber' : grade === 'D' || grade === 'F' ? 'red' : 'muted'
  const statusLabel = score === null || insufficient ? 'Awaiting data' : score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 50 ? 'Fair' : 'Needs attention'
  const insightMessage = orderHealthMessage({ insufficient, totalOrders, fulfilledRate, paidRate })
  const currency = currencyOf(orders)
  const validOrders = orders.filter((o) => o.status !== 'canceled' && o.paymentStatus !== 'refunded')
  const aov = validOrders.length > 0 ? validOrders.reduce((sum, o) => sum + (o.totalPrice ?? 0), 0) / validOrders.length : null
  const atRiskOrders = orders.filter((o) => o.status === 'canceled' || o.paymentStatus === 'not_paid' || o.paymentStatus === 'pending')
  const revenueAtRisk = atRiskOrders.reduce((sum, o) => sum + (o.totalPrice ?? 0), 0)
  const hasAtRisk = atRiskOrders.length > 0
  const customerOrders = new Map<string, number>()
  for (const order of orders) {
    const key = order.customer?.id ?? order.customer?.email ?? order.customer?.name
    if (key) customerOrders.set(key, (customerOrders.get(key) ?? 0) + 1)
  }
  const totalCustomers = customerOrders.size
  const repeatCount = [...customerOrders.values()].filter((count) => count > 1).length
  const repeatRate = totalCustomers > 0 ? Math.round((repeatCount / totalCustomers) * 100) : null

  return <article className={`orders-basic-card order-health-card horizontal ${gradeColor}`}>
    <div className="orders-insight-label">
      <HeartPulse size={16} />
      <span>Order Health</span>
      {!insufficient && grade !== '—' && <span className={`grade-badge ${gradeColor}`}>{grade}</span>}
    </div>
    <div className="order-health-score">
      <div className="order-health-score-value"><strong>{insufficient ? '—' : score}</strong>{!insufficient && score !== null && <span>/100</span>}</div>
      <span className={`order-health-status ${gradeColor}`}>{statusLabel}</span>
    </div>
    <div className="order-health-scale" role="img" aria-label={score === null ? 'Order health score awaiting data' : `Order health score ${score} out of 100, ${statusLabel}`}>
      <div className="order-health-scale-track"><i style={{ width: `${score ?? 0}%` }} /></div>
      <div className="order-health-scale-labels"><span>Poor</span><span>Fair</span><span>Good</span><span>Excellent</span></div>
    </div>
    <div className="order-health-metrics">
      <div className="order-health-metric">
        <span className="order-health-metric-icon"><DollarSign size={14} /></span>
        <div className="order-health-metric-body">
          <strong>{aov === null ? '—' : money(aov, currency)}</strong>
          <span>Avg Order Value</span>
        </div>
      </div>
      <div className="order-health-metric">
        <span className={`order-health-metric-icon${hasAtRisk ? ' warning' : ''}`}><AlertTriangle size={14} /></span>
        <div className="order-health-metric-body">
          <strong>{hasAtRisk ? money(revenueAtRisk, currency) : '—'}</strong>
          <span>Revenue at Risk</span>
        </div>
      </div>
      <div className="order-health-metric">
        <span className="order-health-metric-icon"><Users size={14} /></span>
        <div className="order-health-metric-body">
          <strong>{repeatRate === null ? '—' : `${repeatRate}%`}</strong>
          <span>Repeat Buyers</span>
        </div>
      </div>
    </div>
    <div className={`order-health-insight ${gradeColor}`}><Lightbulb size={13} /><span>{insightMessage}</span></div>
  </article>
}

function orderHealthMessage(input: Readonly<{ insufficient: boolean; totalOrders: number; fulfilledRate: number | null; paidRate: number | null }>): string {
  if (input.insufficient || input.paidRate === null || input.fulfilledRate === null) return 'More Shopify orders are needed to assess health'
  if (input.paidRate === 100 && input.fulfilledRate === 100) return 'All orders paid and fulfilled — perfect'
  if (input.paidRate === 100 && input.fulfilledRate === 0) return `${input.totalOrders} order${input.totalOrders === 1 ? '' : 's'} paid, awaiting fulfillment`
  if (input.paidRate < 100) return 'Payment collection needs attention'
  return 'Paid orders are moving through fulfillment'
}

function PeakTimeContent({ insight }: { insight: ReturnType<typeof insightByFeature> }) { const data = record(insight?.data); return data.status === 'available' ? <><strong>{text(data.day)} · {text(data.hourLabel)}</strong><p>{number(data.ordersAtPeakHour)} orders at the peak hour</p></> : <InsightUnavailable message={text(data.message)} /> }
function RepeatContent({ insight }: { insight: ReturnType<typeof insightByFeature> }) { const data = record(insight?.data); return data.status === 'available' ? <><strong>{number(data.repeatCustomers)} repeat</strong><p>{number(data.newCustomers)} new · {number(data.guestOrders)} guest orders</p></> : <InsightUnavailable message={text(data.message)} /> }
function AiSuggestionContent({ insight, usage }: { insight: ReturnType<typeof insightByFeature>; usage: OrderInsightsResult['usage'] }) { const data = record(insight?.data); return <>{data.status === 'generated' ? <p className="ai-suggestion-text">{text(data.text)}</p> : <InsightUnavailable message={text(data.message)} />}<small className="ai-usage-label">{usage.limitReached ? 'Daily limit reached, upgrade or wait' : usage.limit === null ? 'Unlimited AI insights' : `${usage.used}/${usage.limit} AI insights today`}</small></> }
function TrendComparisonContent({ insight }: { insight: ReturnType<typeof insightByFeature> }) { const data = record(insight?.data); const change = numberOrNull(data.changePercent); return data.status === 'available' ? <><strong>{change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}</strong><p>{number(data.currentOrders)} current · {number(data.previousOrders)} previous</p></> : <InsightUnavailable message={text(data.message)} /> }

function CommanderCapability({ title, icon, insight, locked, onUpgrade }: { title: string; icon: ReactNode; insight: ReturnType<typeof insightByFeature>; locked: ReturnType<typeof lockedInsightByFeature>; onUpgrade: () => void }) {
  if (locked) return <PlanLockedFeature featureName={title} requiredPlan={locked.required_plan} onUpgrade={onUpgrade}><InsightMask compact /></PlanLockedFeature>
  const data = record(insight?.data)
  const summary = data.status === 'ready' ? 'Ready for a grounded question' : data.status === 'insufficient_data' ? text(data.message) : Array.isArray(data.alerts) ? `${data.alerts.length} alert${data.alerts.length === 1 ? '' : 's'}` : Array.isArray(data.suggestions) ? `${data.suggestions.length} review suggestion${data.suggestions.length === 1 ? '' : 's'}` : 'Unlocked'
  return <article className="commander-capability"><span>{icon}</span><div><strong>{title}</strong><small>{summary}</small></div></article>
}
function CustomQueryAnswer({ insight }: { insight: ReturnType<typeof insightByFeature> }) { const data = record(insight?.data); return data.status === 'generated' && text(data.text) ? <p className="custom-query-answer"><ShoppingBag size={13} />{text(data.text)}</p> : null }
function InsightMask({ compact = false }: { compact?: boolean }) { return <span className={`insight-mask ${compact ? 'compact' : ''}`}><i /><i /><i /></span> }
function InsightUnavailable({ message = 'Insights available after more orders.' }: { message?: string | null }) { return <div className="insight-unavailable"><span>—</span><small>{message ?? 'Insight unavailable'}</small></div> }
function InsightsSkeleton() { return <div className="insights-skeleton">{[1, 2, 3, 4, 5, 6].map((value) => <span key={value} />)}</div> }

function OrderFilterPanel({ value, onChange, onApply, onClear }: { value: FilterState; onChange: (value: FilterState) => void; onApply: () => void; onClear: () => void }) {
  const update = <Key extends keyof FilterState>(key: Key, next: FilterState[Key]) => onChange({ ...value, [key]: next })
  return <div className="orders-filter-panel">
    <div className="orders-filter-grid">
      <FilterField label="Order ID"><input value={value.orderId} onChange={(event) => update('orderId', event.target.value)} placeholder="#1001" /></FilterField>
      <FilterField label="Customer"><input value={value.customer} onChange={(event) => update('customer', event.target.value)} placeholder="Name or email" /></FilterField>
      <FilterField label="Phone"><input value={value.phone} onChange={(event) => update('phone', event.target.value)} placeholder="Available Shopify phone" /></FilterField>
      <FilterField label="Product"><input value={value.product} onChange={(event) => update('product', event.target.value)} placeholder="Title, SKU, or ID" /></FilterField>
      <FilterField label="Payment"><select value={value.payment} onChange={(event) => update('payment', event.target.value as PaymentStatus | '')}><option value="">All payments</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="not_paid">Not paid</option><option value="refunded">Refunded</option><option value="partially_refunded">Partially refunded</option><option value="unknown">Unknown</option></select></FilterField>
      <FilterField label="Status"><select value={value.status} onChange={(event) => update('status', event.target.value as OrderStatus | '')}><option value="">All statuses</option><option value="new">New</option><option value="completed">Completed</option><option value="canceled">Canceled</option><option value="pending">Pending</option></select></FilterField>
      <FilterField label="From"><input type="date" value={value.dateFrom} onChange={(event) => update('dateFrom', event.target.value)} /></FilterField>
      <FilterField label="To"><input type="date" value={value.dateTo} onChange={(event) => update('dateTo', event.target.value)} /></FilterField>
    </div><div className="orders-filter-actions"><Button className="button secondary" onClick={onClear}>Clear all</Button><Button className="button primary" onClick={onApply}>Apply filters</Button></div>
  </div>
}
function FilterField({ label, children }: { label: string; children: ReactNode }) { return <label className="orders-filter-field"><span>{label}</span>{children}</label> }

function SortControl({ sort, direction, onSort, onDirection }: { sort: 'date' | 'price' | 'status'; direction: 'asc' | 'desc'; onSort: (value: 'date' | 'price' | 'status') => void; onDirection: () => void }) {
  return <div className="orders-sort-control"><CustomSelect ariaLabel="Sort orders" value={sort} onChange={onSort} label="Sort" options={[{ value: 'date', label: 'Date' }, { value: 'price', label: 'Price' }, { value: 'status', label: 'Status' }]} /><Button onClick={onDirection} aria-label={`Sort ${direction === 'asc' ? 'descending' : 'ascending'}`}>{direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</Button></div>
}

function OrdersTable({ orders, onSelect }: { orders: readonly OrderView[]; onSelect: (id: string) => void }) {
  return <div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>Order ID</th><th>Date</th><th>Customer</th><th>Product(s)</th><th>Price</th><th>Payment</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{orders.map((order) => <OrderTableRow key={order.id} order={order} onSelect={onSelect} />)}</tbody></table></div>
}
function OrderTableRow({ order, onSelect }: { order: OrderView; onSelect: (id: string) => void }) {
  const customerInitials = initials(order.customer.name)
  return <tr tabIndex={0} onClick={() => onSelect(order.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(order.id) } }}>
    <td data-label="Order ID"><strong className="order-id">{order.orderNumber}</strong><small>{shortId(order.id)}</small></td>
    <td data-label="Date"><span>{formatDate(order.createdAt)}</span><small>{formatTime(order.createdAt)}</small></td>
    <td data-label="Customer"><div className="order-customer">{customerInitials && <span>{customerInitials}</span>}<div><strong>{order.customer.name ?? 'Customer name unavailable'}</strong>{order.customer.email && <small>{order.customer.email}</small>}</div></div></td>
    <td data-label="Products"><ProductSummary order={order} /></td>
    <td data-label="Price"><strong>{money(order.totalPrice, order.currency)}</strong><small>{order.currency ?? 'Currency unavailable'}</small></td>
    <td data-label="Payment"><PaymentBadge status={order.paymentStatus} /></td>
    <td data-label="Status"><OrderStatusBadge status={order.status} /></td>
    <td data-label="Actions"><Button className="order-action-button" aria-label={`View ${order.orderNumber}`} onClick={(event) => { event.stopPropagation(); onSelect(order.id) }}><MoreHorizontal size={17} /></Button></td>
  </tr>
}
function ProductSummary({ order }: { order: OrderView }) { const first = order.lineItems[0]; const quantity = order.lineItems.reduce((sum, line) => sum + line.quantity, 0); return <div className="order-product-summary"><strong>{first?.title ?? 'Product details unavailable'}</strong><small>{quantity} item{quantity === 1 ? '' : 's'}{order.lineItems.length > 1 ? ` · ${order.lineItems.length} products` : ''}</small></div> }
function PaymentBadge({ status }: { status: PaymentStatus }) { return <span className={`order-badge payment-${status}`}>{paymentStatusLabel(status)}</span> }
function OrderStatusBadge({ status }: { status: OrderStatus }) { return <span className={`order-badge status-${status}`}>{orderStatusLabel(status)}</span> }

function OrdersPagination({ pagination, onPage }: { pagination: OrdersPageResult['pagination']; onPage: (page: number) => void }) { return <footer className="orders-pagination"><span>Showing {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} real orders</span><div><Button disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><ChevronLeft size={15} /></Button><strong>Page {pagination.page} of {pagination.pages}</strong><Button disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}><ChevronRight size={15} /></Button></div></footer> }

function OrderDetailsDrawer({ storeId, orderId, shop, onClose, onToast }: { storeId: string; orderId: string; shop: string | null; onClose: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [order, setOrder] = useState<OrderView | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { let cancelled = false; setLoading(true); void fetchOrder(storeId, orderId).then((value) => { if (!cancelled) setOrder(value) }).catch((reason: unknown) => { if (!cancelled) onToast(errorText(reason), 'error') }).finally(() => { if (!cancelled) setLoading(false) }); return () => { cancelled = true } }, [storeId, orderId])
  return <div className="order-drawer-layer"><Button className="order-drawer-backdrop" onClick={onClose} aria-label="Close order details" /><aside className="order-details-drawer" aria-label="Order details">{loading || !order ? <DrawerSkeleton onClose={onClose} /> : <>
    <header><div><div className="section-kicker">SHOPIFY ORDER · READ ONLY</div><h2>{order.orderNumber}</h2><span><OrderStatusBadge status={order.status} /><PaymentBadge status={order.paymentStatus} /></span></div><Button onClick={onClose} aria-label="Close order details"><X size={19} /></Button></header>
    <div className="order-drawer-scroll">
      <DetailSection title="Order summary" icon={<ShoppingBag size={16} />}><DetailGrid items={[['Created', formatDateTime(order.createdAt)], ['Processed', formatDateTime(order.processedAt)], ['Updated', formatDateTime(order.updatedAt)], ['Last synced', formatDateTime(order.syncedAt)], ['Financial status', order.financialStatus], ['Fulfillment status', order.fulfillmentStatus], ['Shopify ID', order.id]]} /></DetailSection>
      <DetailSection title="Customer" icon={<UserRound size={16} />}><DetailGrid items={[['Name', order.customer.name], ['Email', order.customer.email], ['Phone', order.customer.phone], ['Customer ID', order.customer.id]]} /></DetailSection>
      <DetailSection title="Products" icon={<Package size={16} />}><div className="order-detail-lines">{order.lineItems.map((line, index) => <div key={line.id ?? `${line.productId ?? 'line'}-${index}`}><div><strong>{line.title ?? 'Product details unavailable'}</strong><small>{[line.variantTitle, line.sku].filter(Boolean).join(' · ') || 'No variant details'}</small></div><span>{line.quantity} × {money(line.price, order.currency)}</span></div>)}</div></DetailSection>
      <DetailSection title="Payment summary" icon={<CheckCircle2 size={16} />}><div className="order-totals"><TotalLine label="Subtotal" value={money(order.subtotalPrice, order.currency)} /><TotalLine label="Discounts" value={money(order.totalDiscounts, order.currency)} /><TotalLine label="Shipping" value={money(order.shippingPrice, order.currency)} /><TotalLine label="Tax" value={money(order.totalTax, order.currency)} /><TotalLine label="Total" value={money(order.totalPrice, order.currency)} total /></div></DetailSection>
      <DetailSection title="Shipping address" icon={<ExternalLink size={16} />}><AddressBlock address={order.shippingAddress} /></DetailSection>
      {order.billingAddress && <DetailSection title="Billing address" icon={<CheckCircle2 size={16} />}><AddressBlock address={order.billingAddress} /></DetailSection>}
      {(order.cancelledAt || order.cancelReason) && <DetailSection title="Cancellation" icon={<AlertTriangle size={16} />}><DetailGrid items={[['Canceled at', formatDateTime(order.cancelledAt)], ['Reason', order.cancelReason]]} /></DetailSection>}
      {(order.tags.length > 0 || order.note) && <DetailSection title="Tags & note" icon={<CalendarDays size={16} />}>{order.tags.length > 0 && <div className="order-detail-tags">{order.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}{order.note && <p className="order-note">{order.note}</p>}</DetailSection>}
    </div>
    <footer><span><LockKeyhole size={14} /> Shopify is the source of truth</span>{shop && <a className="button primary" href={`https://${shop}/admin/orders/${encodeURIComponent(order.id)}`} target="_blank" rel="noreferrer">Open in Shopify <ExternalLink size={14} /></a>}</footer>
  </>}</aside></div>
}
function DetailSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) { return <section className="order-detail-section"><h3>{icon}{title}</h3>{children}</section> }
function DetailGrid({ items }: { items: readonly (readonly [string, string | null])[] }) { return <dl className="order-detail-grid">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl> }
function TotalLine({ label, value, total = false }: { label: string; value: string; total?: boolean }) { return <div className={total ? 'total' : ''}><span>{label}</span><strong>{value}</strong></div> }
function AddressBlock({ address }: { address: OrderAddress | null }) { if (!address) return <p className="order-detail-empty">No shipping address was returned by Shopify.</p>; const lines = [[address.firstName, address.lastName].filter(Boolean).join(' '), address.company, address.address1, address.address2, [address.city, address.province, address.zip].filter(Boolean).join(', '), [address.country, address.countryCode].filter(Boolean).join(' · '), address.phone].filter(Boolean); return <address>{lines.map((line) => <span key={line}>{line}</span>)}</address> }
function DrawerSkeleton({ onClose }: { onClose: () => void }) { return <div className="drawer-skeleton"><Button onClick={onClose}><X size={18} /></Button><span /><span /><span /><span /></div> }

function OrdersTableSkeleton() { return <div className="orders-table-skeleton">{[1, 2, 3, 4, 5].map((row) => <div key={row}>{[1, 2, 3, 4, 5, 6].map((cell) => <span key={cell} />)}</div>)}</div> }
function OrdersErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="orders-error"><AlertTriangle size={21} /><strong>Orders could not be loaded</strong><p>{message}</p><Button className="button secondary" onClick={onRetry}><RefreshCw size={14} /> Retry</Button></div> }
export function OrdersEmptyState({ title, description, action, onAction, compact = false }: { title: string; description: string; action: string; onAction: () => void; compact?: boolean }) { return <div className={`orders-empty ${compact ? 'compact' : ''}`}><span><ShoppingBag size={23} /></span><strong>{title}</strong><p>{description}</p><Button className="button secondary" onClick={onAction}>{action}</Button></div> }

function activeFilterCount(filters: FilterState): number { return Object.values(filters).filter(Boolean).length }
/** Sum of fully refunded order totals from the loaded Shopify order rows. */
function refundedAmount(orders: readonly OrderView[]): number | null {
  if (orders.length === 0) return null
  return orders.reduce((sum, order) => sum + (order.paymentStatus === 'refunded' ? (order.totalPrice ?? 0) : 0), 0)
}
function currencyOf(orders: readonly OrderView[]): string | null { return orders[0]?.currency ?? null }
/**
 * Average time from order creation to its last Shopify update for fulfilled
 * orders, in days. Only real timestamps are used; null when no fulfilled
 * orders are loaded yet.
 */
function averageFulfillmentDays(orders: readonly OrderView[]): number | null {
  const durations: number[] = []
  for (const order of orders) {
    if (order.status !== 'completed' || !order.createdAt || !order.updatedAt) continue
    const created = Date.parse(order.createdAt)
    const updated = Date.parse(order.updatedAt)
    if (!Number.isFinite(created) || !Number.isFinite(updated)) continue
    durations.push((updated - created) / 86_400_000)
  }
  if (durations.length === 0) return null
  return durations.reduce((sum, days) => sum + days, 0) / durations.length
}
/** Real refunded-amount change between the trailing 30 days and the 30 days before it. */
function refundComparison(orders: readonly OrderView[]): Readonly<{ label: string; tone: 'good' | 'worse' | 'neutral'; tooltip: string }> {
  const dated = orders.filter((order) => order.createdAt && Number.isFinite(Date.parse(order.createdAt)))
  const latest = dated.reduce((max, order) => Math.max(max, Date.parse(order.createdAt!)), Number.NEGATIVE_INFINITY)
  if (!Number.isFinite(latest)) return { label: '—', tone: 'neutral', tooltip: 'Awaiting data' }
  const currentStart = latest - 30 * 86_400_000
  const previousStart = latest - 60 * 86_400_000
  const refundedIn = (rows: readonly OrderView[]) => rows.reduce((sum, order) => sum + (order.paymentStatus === 'refunded' ? (order.totalPrice ?? 0) : 0), 0)
  const current = dated.filter((order) => Date.parse(order.createdAt!) >= currentStart)
  const previous = dated.filter((order) => { const value = Date.parse(order.createdAt!); return value >= previousStart && value < currentStart })
  const currentRefunded = refundedIn(current)
  const previousRefunded = refundedIn(previous)
  if (previous.length === 0) return { label: '—', tone: 'neutral', tooltip: 'Awaiting data — no orders in the prior 30 days' }
  if (previousRefunded === 0 && currentRefunded === 0) return { label: 'Same', tone: 'neutral', tooltip: 'No refunds in either period' }
  if (previousRefunded === 0) return { label: '↑ New', tone: 'worse', tooltip: 'Refunds appeared this period (from loaded orders)' }
  const pct = Math.round(((currentRefunded - previousRefunded) / previousRefunded) * 100)
  if (pct === 0) return { label: 'Same', tone: 'neutral', tooltip: 'Refunded amount unchanged vs the prior 30 days' }
  return { label: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%`, tone: pct > 0 ? 'worse' : 'good', tooltip: 'Refunded amount vs the prior 30 days (from loaded orders)' }
}
function cancellationStatus(rate: number | null): Readonly<{ tone: 'good' | 'watch' | 'attention' | 'neutral'; icon: ReactNode; label: string }> {
  if (rate === null) return { tone: 'neutral', icon: <Clock3 size={13} />, label: 'Awaiting order data' }
  if (rate === 0) return { tone: 'good', icon: <CheckCircle2 size={13} />, label: 'Excellent — no cancellations this period' }
  if (rate < 2) return { tone: 'good', icon: <CheckCircle2 size={13} />, label: 'Healthy cancellation rate' }
  if (rate <= 5) return { tone: 'watch', icon: <AlertTriangle size={13} />, label: 'Monitor cancellation trends' }
  return { tone: 'attention', icon: <AlertTriangle size={13} />, label: 'High cancellation rate — review orders' }
}
function fulfillmentStatus(rate: number | null, total: number): Readonly<{ tone: 'good' | 'watch' | 'attention' | 'neutral'; icon: ReactNode; label: string }> {
  if (rate === null) return { tone: 'neutral', icon: <Clock3 size={13} />, label: 'Awaiting order data' }
  if (rate === 100) return { tone: 'good', icon: <CheckCircle2 size={13} />, label: 'All orders fulfilled' }
  if (rate > 80) return { tone: 'good', icon: <CheckCircle2 size={13} />, label: 'Healthy fulfillment rate' }
  if (rate >= 50) return { tone: 'watch', icon: <AlertTriangle size={13} />, label: 'Fulfillment in progress' }
  if (rate === 0 && total > 0) return { tone: 'attention', icon: <AlertTriangle size={13} />, label: 'Attention — orders need fulfillment' }
  return { tone: 'watch', icon: <AlertTriangle size={13} />, label: 'Many orders awaiting fulfillment' }
}
function shortId(value: string): string { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value }
function formatDate(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : '—' }
function formatTime(value: string | null): string { if (!value) return ''; const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date) : '' }
function formatDateTime(value: string | null): string | null { if (!value) return null; const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : null }
function money(value: number | null, currency: string | null): string { if (value === null) return '—'; try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 2 }).format(value) } catch { return `${value.toFixed(2)} ${currency ?? ''}`.trim() } }
function errorText(value: unknown): string { return value instanceof Error ? value.message : 'Request failed' }
function titleCase(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1) }
function record(value: unknown): Readonly<Record<string, unknown>> { return isInsightData(value) ? value : {} }
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null }
function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function number(value: unknown): string { const parsed = numberOrNull(value); return parsed === null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(parsed) }
function downloadOrders(orders: readonly OrderView[]): void { const headers = ['Order ID', 'Date', 'Customer', 'Products', 'Price', 'Currency', 'Payment', 'Status']; const lines = orders.map((order) => [order.orderNumber, order.createdAt ?? '', order.customer.name ?? '', order.lineItems.map((line) => `${line.title ?? ''} × ${line.quantity}`).join('; '), order.totalPrice ?? '', order.currency ?? '', paymentStatusLabel(order.paymentStatus), orderStatusLabel(order.status)]); const csv = [headers, ...lines].map((row) => row.map(csvCell).join(',')).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `shopify-orders-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url) }
function csvCell(value: unknown): string { const textValue = String(value); return /[",\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue }
