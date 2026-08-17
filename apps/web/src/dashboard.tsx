import { useState, useMemo, useEffect } from 'react'
import type { CSSProperties, ComponentType } from 'react'
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import {
  WalletCards,
  ShoppingBag,
  Target,
  Package,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  RefreshCw,
  Clock3,
  LineChart,
  User,
  Box,
  DollarSign,
  Award,
  Calendar,
} from 'lucide-react'
import type { AnalyticsSnapshot, StoreHealthView } from './model.js'
import { formatMoney, formatNumber, storeHealthView, latestSyncLabel } from './model.js'
import {
  aggregateRevenueByPeriod,
  buildCalendarMonth,
  aggregateByCategory,
  buildRecentOrders,
  generateSummary,
  calculateGrowth,
  formatGrowth,
  revenueForPeriod,
} from './dashboard-utils.js'
import type {
  PeriodView,
  BarChartPoint,
  CalendarMonth,
  CalendarDay,
  CategorySales,
  RecentOrder,
  GrowthResult,
} from './dashboard-utils.js'
import { fetchOrders } from './api.js'
import type { OrderView } from './orders-model.js'

type LoadState = 'idle' | 'loading' | 'ready' | 'partial' | 'offline'

type DashboardData = {
  analytics: AnalyticsSnapshot | null
  catalog: readonly { productId: string; payload: Record<string, unknown> }[]
  loadState: LoadState
}

const BAR_COLOR = '#3B82F6'
const BAR_CURRENT_COLOR = '#72A7FF'
const BAR_EMPTY_COLOR = '#6B7280'
const GRID_COLOR = 'rgba(107,114,128,.12)'
const TEXT_COLOR = '#9CA3AF'

interface DashboardLayoutProps {
  data: DashboardData
  onSync: (module: string) => Promise<void>
  onSyncAll: () => Promise<void>
  syncAllRunning: boolean
  onNavigate: (page: string) => void
  storeName: string | null
  storeId: string | null
}

export function DashboardLayout(props: DashboardLayoutProps) {
  const { data, onSync, onSyncAll, syncAllRunning, onNavigate, storeName, storeId } = props

  const [periodView, setPeriodView] = useState<PeriodView>('monthly')
  const [barRangeStart, setBarRangeStart] = useState<string>('')
  const [barRangeEnd, setBarRangeEnd] = useState<string>('')

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1)

  const revenue = calcRevenue(data.analytics)
  const orders = calcOrders(data.analytics)
  const aov = calcAov(data.analytics)
  const catalogCount = data.catalog.length
  const health = storeHealthView(data.analytics, catalogCount)

  const revenue30d = useMemo(() => revenueForPeriod(data.analytics, '30d'), [data.analytics])
  const prevRevenue30d = useMemo(() => getPrevious30dRevenue(data.analytics), [data.analytics])
  const revenueGrowthResult = useMemo(() => calculateGrowth(revenue30d, prevRevenue30d), [revenue30d, prevRevenue30d])

  const ordersGrowthResult = useMemo(() => {
    if (data.analytics && data.analytics.orders.length > 0) {
      const total = data.analytics.orders.reduce((s, o) => s + o.orderCount, 0)
      return calculateGrowth(total, null)
    }
    return calculateGrowth(null, null)
  }, [data.analytics])

  const aovGrowthResult = useMemo(() => {
    const aovVal = calcAov(data.analytics)
    return calculateGrowth(aovVal, null)
  }, [data.analytics])

  const barData = useMemo(
    () => aggregateRevenueByPeriod(data.analytics, periodView, barRangeStart || undefined, barRangeEnd || undefined),
    [data.analytics, periodView, barRangeStart, barRangeEnd],
  )

  const calendarMonth = useMemo(() => buildCalendarMonth(data.analytics, calYear, calMonth), [data.analytics, calYear, calMonth])

  const prevCalendarMonth = useMemo(() => {
    const year = calMonth === 1 ? calYear - 1 : calYear
    const month = calMonth === 1 ? 12 : calMonth - 1
    return buildCalendarMonth(data.analytics, year, month)
  }, [data.analytics, calYear, calMonth])

  const calendarGrowth = useMemo(
    () => calculateGrowth(calendarMonth.total || null, prevCalendarMonth.total || null),
    [calendarMonth.total, prevCalendarMonth.total],
  )

  const goPrevMonth = () => {
    if (calMonth === 1) {
      setCalMonth(12)
      setCalYear(calYear - 1)
    } else {
      setCalMonth(calMonth - 1)
    }
  }
  const goNextMonth = () => {
    if (calMonth === 12) {
      setCalMonth(1)
      setCalYear(calYear + 1)
    } else {
      setCalMonth(calMonth + 1)
    }
  }

  const categoryData = useMemo(() => aggregateByCategory(data.analytics, data.catalog), [data.analytics, data.catalog])
  const recentOrders = useMemo(() => buildRecentOrders(data.analytics), [data.analytics])
  const summary = useMemo(() => generateSummary(data.analytics, data.catalog), [data.analytics, data.catalog])

  const loading = data.loadState === 'loading'

  // Recent Activity real orders fetch — Fix 1.5
  const [realOrders, setRealOrders] = useState<readonly OrderView[] | null>(null)
  const [realOrdersLoading, setRealOrdersLoading] = useState(false)
  useEffect(() => {
    if (!storeId) {
      setRealOrders(null)
      return
    }
    let cancelled = false
    setRealOrdersLoading(true)
    void fetchOrders(storeId, { sort: 'date', direction: 'desc', page: 1, limit: 5 })
      .then((result) => {
        if (!cancelled) setRealOrders(result.orders)
      })
      .catch(() => {
        if (!cancelled) setRealOrders(null)
      })
      .finally(() => {
        if (!cancelled) setRealOrdersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  return (
    <div className="dashboard-modern">
      <div className="dash-row kpi-row">
        <EnhancedMetricCard label="Revenue" value={formatMoney(revenue)} icon={WalletCards as ComponentType<{ size?: number; className?: string }>} tone="gold" growth={revenueGrowthResult} periodLabel="last 30 days" loading={loading} />
        <EnhancedMetricCard label="Orders" value={formatNumber(orders)} icon={ShoppingBag as ComponentType<{ size?: number; className?: string }>} tone="blue" growth={ordersGrowthResult} periodLabel="all time" loading={loading} />
        <EnhancedMetricCard label="Average Order Value" value={formatMoney(aov)} icon={Target as ComponentType<{ size?: number; className?: string }>} tone="purple" growth={aovGrowthResult} periodLabel="all time" loading={loading} />
        <EnhancedMetricCard label="Catalog Products" value={formatNumber(catalogCount || null)} icon={Package as ComponentType<{ size?: number; className?: string }>} tone="green" growth={calculateGrowth(catalogCount, null)} periodLabel="all time" loading={loading} detail={catalogCount > 0 ? `${catalogCount} synced from Shopify` : 'Sync to populate'} />
      </div>

      <div className="dash-row chart-cal-health-row">
        <div className="dash-card revenue-chart-card">
          <div className="dash-card-header">
            <div>
              <div className="dash-kicker"><span className="kicker-dot blue" />Revenue by period</div>
              <h3>Revenue Overview</h3>
            </div>
            <div className="period-toggle-group">
              <button className={`period-toggle-btn ${periodView === 'weekly' ? 'active' : ''}`} onClick={() => setPeriodView('weekly')}>Weekly</button>
              <button className={`period-toggle-btn ${periodView === 'monthly' ? 'active' : ''}`} onClick={() => setPeriodView('monthly')}>Monthly</button>
              <button className={`period-toggle-btn ${periodView === 'yearly' ? 'active' : ''}`} onClick={() => setPeriodView('yearly')}>Yearly</button>
              <button className={`period-toggle-btn ${periodView === 'range' ? 'active' : ''}`} onClick={() => setPeriodView('range')}>Range</button>
            </div>
          </div>
          {periodView === 'range' && (
            <div className="range-picker">
              <input type="date" value={barRangeStart} onChange={(e) => setBarRangeStart(e.target.value)} placeholder="Start" />
              <span>→</span>
              <input type="date" value={barRangeEnd} onChange={(e) => setBarRangeEnd(e.target.value)} placeholder="End" />
            </div>
          )}
          <div className="dash-chart-legend">
            <span><i className="legend-line blue" />Revenue</span>
            <span className="chart-updated"><Clock3 size={11} /> {latestSyncLabel(data.analytics)}</span>
          </div>
          {loading ? <ChartSkeleton /> : barData.length > 0 ? <RevenueBarChart data={barData} /> : <EmptyChart onSync={() => void onSync('orders')} message="No revenue data for this period. Sync orders to populate." />}
        </div>
        <div className="dash-card calendar-card-compact">
          <div className="dash-kicker"><span className="kicker-dot green" />Daily Revenue</div>
          <div className="cal-compact-header">
            <button className="cal-nav-btn" onClick={goPrevMonth} aria-label="Previous month"><ChevronLeft size={14} /></button>
            <button className="cal-month-label" onClick={() => { setCalYear(now.getFullYear()); setCalMonth(now.getMonth() + 1) }} title="Jump to current month">{new Date(calYear, calMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</button>
            <button className="cal-nav-btn" onClick={goNextMonth} aria-label="Next month"><ChevronRight size={14} /></button>
          </div>
          <CompactCalendar month={calendarMonth} loading={loading} />
          <div className="cal-total-block">
            <span className="cal-total-label">Total revenue</span>
            <div className="cal-total-row">
              <strong className="cal-total-value">{formatMoney(calendarMonth.total || null)}</strong>
              {calendarGrowth.percent !== null && (
                <span className={`growth-badge ${calendarGrowth.direction === 'up' ? 'up' : calendarGrowth.direction === 'down' ? 'down' : 'flat'}`}>
                  {calendarGrowth.direction === 'up' ? <TrendingUp size={10} /> : calendarGrowth.direction === 'down' ? <TrendingDown size={10} /> : <Minus size={10} />}
                  {`${calendarGrowth.percent > 0 ? '+' : ''}${calendarGrowth.percent.toFixed(1)}%`}
                </span>
              )}
            </div>
            <span className="cal-total-sub">{calendarGrowth.percent !== null ? 'vs previous month' : 'Daily revenue heatmap'}</span>
          </div>
        </div>
        <div className="dash-card health-card-compact">
          <div className="dash-card-header">
            <div>
              <div className="dash-kicker"><span className="kicker-dot green" />Store Health</div>
              <h3>Performance Score</h3>
            </div>
          </div>
          <HealthGaugeWidget health={health} loading={loading} />
          <div className="health-metrics">
            <HealthRow label="Revenue data" value={data.analytics?.revenue.length ? `${data.analytics.revenue.length} days` : 'No data'} healthy={!!data.analytics?.revenue.length} />
            <HealthRow label="Orders" value={orders ? `${orders} total` : 'No data'} healthy={!!orders} />
            <HealthRow label="Catalog" value={catalogCount ? `${catalogCount} products` : 'Not synced'} healthy={!!catalogCount} />
            <HealthRow label="Customers" value={data.analytics?.customerCohorts.length ? 'Cohort data present' : 'No data'} healthy={!!data.analytics?.customerCohorts.length} />
          </div>
          <button className="dash-text-link" onClick={() => onNavigate('analytics')}>View details →</button>
        </div>
      </div>

      <div className="dash-row three-col-row">
        {/* Fix 1.3 Store Summary redesign */}
        <div className="dash-card ai-summary-card">
          <div className="dash-card-header">
            <div>
              <div className="dash-kicker"><span className="kicker-dot purple" />AI Insights</div>
              <h3>Store Summary</h3>
            </div>
            <Lightbulb size={18} className="ai-sparkle" />
          </div>
          <div className="ai-summary-body">
            {loading ? (
              <div className="summary-loading"><Lightbulb size={14} className="spin" /> Analyzing your store data...</div>
            ) : (
              <div className="ai-summary-modern">
                <div className="ai-summary-highlights">
                  <div className="summary-pill"><WalletCards size={14} /><span><strong>{formatMoney(revenue30d)}</strong><small>Last 30 days {revenueGrowthResult.percent !== null ? `${revenueGrowthResult.percent > 0 ? '+' : ''}${revenueGrowthResult.percent.toFixed(1)}%` : ''}</small></span></div>
                  <div className="summary-pill"><ShoppingBag size={14} /><span><strong>{formatNumber(orders)}</strong><small>Total orders</small></span></div>
                  <div className="summary-pill"><Package size={14} /><span><strong>{formatNumber(catalogCount)}</strong><small>Products synced</small></span></div>
                </div>
                <div className="ai-summary-insight">
                  <Award size={16} />
                  <p>{summary}</p>
                </div>
              </div>
            )}
          </div>
          {data.analytics && data.analytics.revenue.length > 0 && (
            <div className="ai-summary-footer">
              <span><TrendingUp size={12} /> Based on {data.analytics.revenue.length} days of data • AI-generated insight</span>
            </div>
          )}
        </div>

        {/* Fix 1.4 By Category pie enhancement */}
        <div className="dash-card pie-card">
          <div className="dash-card-header">
            <div>
              <div className="dash-kicker"><span className="kicker-dot gold" />Revenue</div>
              <h3>By Category</h3>
            </div>
          </div>
          {loading ? <ChartSkeleton /> : categoryData.length > 0 ? <CategoryPieChart data={categoryData} /> : <EmptyChart onSync={() => void onSync('products')} message="Sync products to see category breakdown." />}
        </div>

        {/* Fix 1.5 Recent Activity timeline */}
        <div className="dash-card orders-card">
          <div className="dash-card-header">
            <div>
              <div className="dash-kicker"><span className="kicker-dot blue" />Orders</div>
              <h3>Recent Activity</h3>
            </div>
            <button className="dash-text-link" onClick={() => onNavigate('orders')}>View all →</button>
          </div>
          {loading || realOrdersLoading ? (
            <div className="orders-loading">{[1, 2, 3, 4].map((i) => <div key={i} className="order-row-skeleton"><span /><span /><span /></div>)}</div>
          ) : realOrders && realOrders.length > 0 ? (
            <div className="activity-timeline">
              {realOrders.map((order) => (
                <RealOrderRow key={order.id} order={order} />
              ))}
            </div>
          ) : recentOrders.length > 0 ? (
            <div className={`orders-list ${recentOrders.length <= 3 ? 'sparse' : ''}`}>
              {recentOrders.map((order) => <OrderRow key={order.id} order={order} detailed={recentOrders.length <= 3} />)}
              {recentOrders.length <= 3 && <button className="orders-cta" onClick={() => void onSync('orders')}><RefreshCw size={12} /> Sync more orders</button>}
            </div>
          ) : (
            <EmptyChart onSync={() => void onSync('orders')} message="Sync orders to see recent activity." />
          )}
        </div>
      </div>
    </div>
  )
}

function calcRevenue(snapshot: AnalyticsSnapshot | null): number | null {
  if (!snapshot || snapshot.revenue.length === 0) return null
  return snapshot.revenue.reduce((total, row) => total + row.grossRevenue, 0)
}
function calcOrders(snapshot: AnalyticsSnapshot | null): number | null {
  if (!snapshot || snapshot.orders.length === 0) return null
  return snapshot.orders.reduce((total, row) => total + row.orderCount, 0)
}
function calcAov(snapshot: AnalyticsSnapshot | null): number | null {
  if (!snapshot || snapshot.orders.length === 0) return null
  const orders = calcOrders(snapshot)
  if (!orders) return null
  const revenue = calcRevenue(snapshot)
  return revenue === null ? null : revenue / orders
}
function getPrevious30dRevenue(snapshot: AnalyticsSnapshot | null): number | null {
  if (!snapshot) return null
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const filtered = snapshot.revenue.filter((row) => row.day >= sixtyDaysAgo && row.day < thirtyDaysAgo)
  if (filtered.length === 0) return null
  return filtered.reduce((sum, row) => sum + row.grossRevenue, 0)
}

function EnhancedMetricCard({ label, value, icon: Icon, tone, growth, periodLabel, loading, detail }: { label: string; value: string; icon: ComponentType<{ size?: number; className?: string }>; tone: string; growth: GrowthResult; periodLabel?: string; loading?: boolean; detail?: string }) {
  const growthLabel = periodLabel ? formatGrowth(growth, periodLabel) : null
  const isPositive = growth.direction === 'up'
  const isNegative = growth.direction === 'down'
  const hasGrowth = growth.direction !== 'none'
  return (
    <div className="dash-card metric-card-enhanced">
      <div className="metric-card-top">
        <span className={`metric-icon ${tone}`}><Icon size={18} /></span>
        {hasGrowth && <span className={`growth-badge ${isPositive ? 'up' : isNegative ? 'down' : 'flat'}`}>{isPositive ? <TrendingUp size={11} /> : isNegative ? <TrendingDown size={11} /> : <Minus size={11} />}{growth.percent !== null ? `${growth.percent > 0 ? '+' : ''}${growth.percent.toFixed(1)}%` : '—'}</span>}
      </div>
      <div className="metric-value">{loading ? <span className="metric-skeleton-value" /> : value}</div>
      <div className="metric-label-row">
        <span className="metric-label">{label}</span>
        {growthLabel && <span className="metric-growth-label">{growthLabel}</span>}
        {detail && !growthLabel && <span className="metric-detail">{detail}</span>}
      </div>
    </div>
  )
}

function BarTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; payload: BarChartPoint }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0]?.payload
  if (!point) return null
  return <div className="recharts-tooltip-custom"><strong>{point.isEmpty ? '$0' : formatMoney(point.value)}</strong><span>{point.isEmpty ? `${point.label} · no sales` : point.label}</span></div>
}

function RevenueBarChart({ data }: { data: BarChartPoint[] }) {
  const maxValue = data.reduce((max, point) => (point.value > max ? point.value : max), 0)
  const placeholder = maxValue > 0 ? Math.max(maxValue * 0.03, 1) : 1
  const chartData = data.map((point) => ({ ...point, plotted: point.isEmpty || point.value === 0 ? placeholder : point.value }))
  const emptyCount = data.filter((point) => point.isEmpty).length
  return (
    <div className="dash-chart-container">
      <ResponsiveContainer width="100%" height={260}>
        <RechartsBarChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: TEXT_COLOR, fontSize: 10 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: TEXT_COLOR, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => value >= 1000 ? `$${(value / 1000).toFixed(0)}K` : `$${value}`} />
          <Tooltip content={BarTooltip as any} cursor={{ fill: 'rgba(59,130,246,.06)' }} />
          <Bar dataKey="plotted" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={true} animationDuration={400}>
            {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.isEmpty ? BAR_EMPTY_COLOR : entry.isCurrent ? BAR_CURRENT_COLOR : BAR_COLOR} opacity={entry.isEmpty ? 0.18 : entry.isCurrent ? 1 : 0.7} />)}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
      {emptyCount > 0 && <div className="chart-empty-note"><span className="empty-bar-swatch" /> {emptyCount} period{emptyCount > 1 ? 's' : ''} with no sales</div>}
    </div>
  )
}

function CategoryPieChart({ data }: { data: CategorySales[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const topCategory = data.length > 0 ? [...data].sort((a, b) => b.value - a.value)[0] : null

  if (data.length === 0) return null
  if (data.length === 1) {
    const only = data[0] as CategorySales
    return (
      <div className="single-category">
        <div className="single-category-ring" style={{ borderColor: only.color, boxShadow: `0 0 24px ${only.color}22` } as CSSProperties}>
          <strong>{formatMoney(only.value)}</strong>
          <span>revenue</span>
        </div>
        <div className="single-category-meta">
          <span className="single-category-name" style={{ color: only.color } as CSSProperties}>{only.name}</span>
          <span className="single-category-note">1 category active · 100% of tracked sales</span>
        </div>
      </div>
    )
  }

  return (
    <div className="dash-chart-container pie-container pie-enhanced">
      <div className="pie-chart-wrap">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={3}
              dataKey="value"
              nameKey="name"
              isAnimationActive={true}
              animationDuration={600}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  stroke={activeIndex === index ? '#fff' : 'transparent'}
                  strokeWidth={activeIndex === index ? 2 : 0}
                  style={{ filter: activeIndex === index ? 'brightness(1.15)' : undefined, cursor: 'pointer', transition: 'all 150ms ease' } as CSSProperties}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pie-center-total">
          <strong>{formatMoney(total)}</strong>
          <span>Total</span>
        </div>
      </div>
      <div className="pie-side-legend">
        {data.map((entry, index) => {
          const percent = total > 0 ? (entry.value / total) * 100 : 0
          const isTop = topCategory && entry.name === topCategory.name
          return (
            <div key={entry.name} className={`legend-row ${activeIndex === index ? 'active' : ''} ${isTop ? 'top' : ''}`} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}>
              <span className="legend-dot" style={{ background: entry.color } as CSSProperties} />
              <span className="legend-name">{entry.name} {isTop && <em className="top-badge">Top</em>}</span>
              <span className="legend-value">{percent.toFixed(1)}% · {formatMoney(entry.value)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompactCalendar({ month, loading }: { month: CalendarMonth; loading?: boolean }) {
  const [hoveredDay, setHoveredDay] = useState<CalendarDay | null>(null)
  const values = month.days.filter((d): d is CalendarDay & { value: number } => d.value !== null).map((d) => d.value)
  const maxVal = values.length > 0 ? Math.max(...values) : 1
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const today = new Date().toISOString().slice(0, 10)
  if (loading) {
    return (
      <div className="calendar-compact loading" aria-hidden="true">
        <div className="cal-day-names">{dayNames.map((name, i) => <span key={i} className="cal-day-name">{name}</span>)}</div>
        <div className="cal-grid">{Array.from({ length: 35 }, (_, i) => <div key={i} className="cal-cell skeleton" />)}</div>
      </div>
    )
  }
  return (
    <div className="calendar-compact">
      <div className="cal-day-names">{dayNames.map((name, i) => <span key={i} className="cal-day-name">{name}</span>)}</div>
      <div className="cal-grid">
        {month.days.map((day, index) => {
          const intensity = day.value !== null && maxVal > 0 ? day.value / maxVal : 0
          const isHovered = hoveredDay?.date === day.date
          return (
            <div key={index} className={`cal-cell ${day.isCurrentMonth ? 'current' : 'other'} ${day.value !== null ? 'has-data' : ''} ${day.date === today ? 'today' : ''} ${isHovered ? 'hovered' : ''}`} style={{ backgroundColor: day.value !== null ? `rgba(16, 185, 129, ${0.12 + intensity * 0.75})` : 'rgba(107,114,128,.06)', borderColor: isHovered ? 'rgba(59,130,246,.5)' : 'transparent' } as CSSProperties} onMouseEnter={() => setHoveredDay(day)} onMouseLeave={() => setHoveredDay(null)} title={day.value !== null ? `${day.date}: ${formatMoney(day.value)}` : day.date}>
              <span className="cal-day-number">{day.day}</span>
            </div>
          )
        })}
      </div>
      <div className="cal-hover-line">
        {hoveredDay && hoveredDay.value !== null ? <><strong>{formatMoney(hoveredDay.value)}</strong><span>{new Date(hoveredDay.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></> : <div className="cal-legend"><span>Less</span><div className="cal-legend-bar"><span /><span /><span /><span /></div><span>More</span></div>}
      </div>
    </div>
  )
}

function RealOrderRow({ order }: { order: OrderView }) {
  const customerName = order.customer.name?.trim() || 'Guest'
  const initials = customerName === 'Guest' ? 'G' : customerName.split(/\s+/).slice(0,2).map(p=>p[0]?.toUpperCase()??'').join('') || 'U'
  const productTitle = order.lineItems[0]?.title || 'Product'
  const productCount = order.lineItems.length
  const amount = order.totalPrice ?? 0
  const status = order.status
  const statusLabel = status === 'completed' ? 'Completed' : status === 'pending' ? 'Pending' : status === 'canceled' ? 'Canceled' : 'New'
  const statusClass = status === 'completed' ? 'green' : status === 'pending' ? 'amber' : status === 'canceled' ? 'red' : 'blue'

  return (
    <div className="activity-timeline-row">
      <div className="timeline-dot" />
      <div className="timeline-content">
        <div className="timeline-top">
          <span className="customer-avatar-timeline">{initials}</span>
          <span className="timeline-customer">{customerName}</span>
          <span className={`order-status status-badge ${statusClass}`}>{statusLabel}</span>
        </div>
        <div className="timeline-middle">
          <span className="timeline-product"><Box size={12} /> {productTitle} {productCount > 1 ? `+${productCount - 1} more` : ''}</span>
          <span className="timeline-amount">{formatMoney(amount)}</span>
        </div>
        <div className="timeline-bottom">
          <span className="timeline-id">#{order.orderNumber}</span>
          <span className="timeline-date">{order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
        </div>
      </div>
    </div>
  )
}

function OrderRow({ order, detailed }: { order: RecentOrder; detailed?: boolean }) {
  const statusConfig: Record<string, { label: string; className: string }> = {
    paid: { label: 'Paid', className: 'green' },
    pending: { label: 'Pending', className: 'amber' },
    cancelled: { label: 'Cancelled', className: 'red' },
    fulfilled: { label: 'Fulfilled', className: 'blue' },
  }
  const config = statusConfig[order.status] ?? { label: order.status, className: 'neutral' }
  return (
    <div className={`order-row ${detailed ? 'detailed' : ''}`}>
      <div className="order-row-main">
        <span className="order-id">#{order.orderNumber}</span>
        <span className="order-customer">{order.customer}</span>
      </div>
      <div className="order-row-right">
        <span className="order-amount">{formatMoney(order.amount)}</span>
        <span className={`order-status status-badge ${config.className}`}>{config.label}</span>
        <span className="order-date">{order.date.slice(5)}</span>
      </div>
      {detailed && (
        <div className="order-row-detail">
          <span><em>Date</em>{new Date(order.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          <span><em>AOV</em>{formatMoney(order.averageOrderValue || null)}</span>
          <span><em>Fulfilled</em>{order.fulfilledCount}/{order.orderCount}</span>
          <span><em>Cancelled</em>{order.cancelledCount}</span>
        </div>
      )}
    </div>
  )
}

function HealthGaugeWidget({ health, loading }: { health: StoreHealthView; loading?: boolean }) {
  const sweep = health.score === null ? 0 : Math.max(8, Math.round(health.score * 2.4))
  return (
    <div className="health-gauge-wrap">
      <div className={`health-gauge ${health.tone} compact`} style={health.score !== null && !loading ? { background: `conic-gradient(from 220deg, var(--health-color) ${sweep}deg, rgba(107,114,128,.14) 0)` } as CSSProperties : undefined}>
        <div className="gauge-inner">
          {loading ? <><strong>—</strong><span>Loading</span></> : <><strong>{health.score === null ? '—' : health.score}{health.score !== null && <small>/100</small>}</strong><span>{health.score === null ? 'NO DATA' : `${health.grade} · ${health.label}`}</span></>}
        </div>
      </div>
    </div>
  )
}
function HealthRow({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return <div className="health-row"><span className={`health-dot ${healthy ? 'green' : 'muted'}`} /><span className="health-label">{label}</span><span className={`health-value ${healthy ? 'green' : 'muted'}`}>{value}</span></div>
}
function ChartSkeleton() {
  return <div className="chart-skeleton-wrap"><div className="chart-skeleton"><span /><span /><span /><span /><span /></div></div>
}
function EmptyChart({ onSync, message }: { onSync?: () => void; message: string }) {
  return <div className="empty-chart"><LineChart size={28} /><strong>No data yet</strong><span>{message}</span>{onSync && <button className="dash-text-link" onClick={onSync}><RefreshCw size={13} /> Sync data</button>}</div>
}
export type { DashboardData }
