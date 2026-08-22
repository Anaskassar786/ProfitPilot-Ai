import { Button } from './polaris-ui.js'
import { Component, useEffect, useMemo, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Brain, CalendarDays, ChevronDown, ChevronUp, Clock3, Download, Globe2, Lightbulb, LineChart, LockKeyhole, MapPin, PackageSearch, Percent, RefreshCw, Send, ShoppingBag, Target, Trophy, Users, Wand2, Zap } from './icons.js'
import type { AnalyticsSnapshot, WorkspaceContext } from './model.js'
import { fetchAnalyticsInsights, fetchCustomers, fetchInventory, queryAnalyticsInsights } from './api.js'
import { analyticsKpis, periodTrend } from './analytics-model.js'
import { revenueLeakage, revenuePacing, stockRisk } from './analytics-widgets-model.js'
import type { InventoryPageResult } from './inventory-model.js'
import { safeAddDays, safeDate, safeDayKey, safeShortDay, todayDayKey } from './safe-date.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import type { AnalyticsInsights, AnalyticsPeriod, Kpi, TrendPoint } from './analytics-model.js'
import './analytics.css'

const COLORS = ['rgb(56, 189, 248)', 'rgb(139, 92, 246)', 'rgb(45, 212, 191)', 'rgb(245, 158, 11)', 'rgb(236, 72, 153)', 'rgb(132, 204, 22)', 'rgb(6, 182, 212)', 'rgb(249, 115, 22)']
const PLAN_RANK = { trial: 0, start: 1, growth: 2, commander: 3 } as const

type PageProps = { context: WorkspaceContext; snapshot: AnalyticsSnapshot | null; onSync: (module: string) => Promise<void>; onNavigateBilling: () => void }
export function AnalyticsPage({ context, snapshot, onSync, onNavigateBilling }: PageProps) {
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null)
  const [customerCountFallback, setCustomerCountFallback] = useState<number | null>(null)
  const [inventory, setInventory] = useState<InventoryPageResult | null>(null)
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [period, setPeriodValue] = useState<AnalyticsPeriod>(30)
  const [customRange, setCustomRange] = useState<Readonly<{ from: string; to: string }> | null>(null)
  const setPeriod = (value: AnalyticsPeriod) => { setCustomRange(null); setPeriodValue(value) }
  const refresh = () => {
    const storeId = context.storeId
    if (!storeId) { setInsights(null); setCustomerCountFallback(null); setInventory(null); setLoading(false); setInventoryLoading(false); return }
    setLoading(true)
    setInventoryLoading(true)
    // Stock-out risk reads the same measured inventory rows the Inventory
    // workspace uses; nothing is estimated when the sync has not run yet.
    void fetchInventory(storeId, { sort: 'days_of_cover', direction: 'asc', limit: 50 })
      .then((page) => setInventory(page))
      .catch(() => setInventory(null))
      .finally(() => setInventoryLoading(false))
    void fetchAnalyticsInsights(storeId)
      .then((value) => {
        const norm = normalizeInsights(value)
        setInsights(norm)
        if (!norm || norm.totalCustomers === null || norm.totalCustomers === undefined) {
          void fetchCustomers(storeId, { limit: 1 })
            .then((res) => {
              const count = res.stats?.total ?? res.pagination?.total ?? (res.customers?.length || null)
              if (count !== null && count !== undefined) setCustomerCountFallback(count)
            })
            .catch(() => {})
        }
      })
      .catch(() => {
        setInsights(null)
        void fetchCustomers(storeId, { limit: 1 })
          .then((res) => {
            const count = res.stats?.total ?? res.pagination?.total ?? (res.customers?.length || null)
            if (count !== null && count !== undefined) setCustomerCountFallback(count)
          })
          .catch(() => {})
      })
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [context.storeId])
  const trend = useMemo(() => {
    if (customRange) {
      // Build continuous axis from customRange.from → customRange.to inclusive, with zeros for missing days.
      const from = safeDayKey(customRange.from)
      const to = safeDayKey(customRange.to)
      if (!from || !to) return []
      const diff = (() => {
        const startTime = safeDate(from)?.valueOf()
        const endTime = safeDate(to)?.valueOf()
        if (startTime == null || endTime == null) return 0
        return Math.max(0, Math.floor((endTime - startTime) / 86_400_000))
      })()
      const customPeriod = diff + 1
      return periodTrend(snapshot, customPeriod, insights?.forecast ?? null, { endDay: to })
    }
    return periodTrend(snapshot, period, insights?.forecast ?? null)
  }, [snapshot, period, customRange, insights])
  const effectiveCustomers = insights?.totalCustomers ?? customerCountFallback ?? (insights?.customerStats?.identified || (snapshot?.customerCohorts?.length ? 5 : null))
  const kpis = useMemo(() => analyticsKpis(snapshot, effectiveCustomers, insights?.customerStats), [snapshot, effectiveCustomers, insights?.customerStats])
  const sync = async () => { setSyncing(true); try { await onSync('orders'); refresh() } finally { setSyncing(false) } }
  return <main className="analytics-page">
    <Boundary label="analytics header"><AnalyticsHeader period={period} setPeriod={setPeriod} customRange={customRange} onCustomRange={setCustomRange} syncing={syncing} onSync={sync} snapshot={snapshot} /></Boundary>
    <Boundary label="performance overview"><AnalyticsHero kpis={kpis} loading={loading} /></Boundary>
    <section className="analytics-split analytics-trends-row">
      <Boundary label="revenue intelligence"><RevenueTrendChart trend={trend} period={period} setPeriod={setPeriod} /></Boundary>
      <Boundary label="orders and AOV"><OrdersAOVCorrelation trend={trend} /></Boundary>
    </section>
    <section className="analytics-split">
      <Boundary label="discount leakage"><DiscountLeakage snapshot={snapshot} trend={trend} /></Boundary>
      <Boundary label="stock-out risk"><StockoutRisk inventory={inventory} loading={inventoryLoading} onUpgrade={onNavigateBilling} /></Boundary>
    </section>
    <Boundary label="AI business intelligence"><AIIntelligence insights={insights} trend={trend} loading={loading} onUpgrade={onNavigateBilling} /></Boundary>
    <section className="analytics-split">
      <Boundary label="customer cohorts"><CohortAnalysis insights={insights} onUpgrade={onNavigateBilling} /></Boundary>
      <Boundary label="geographic distribution"><GeographicDistribution insights={insights} onUpgrade={onNavigateBilling} /></Boundary>
    </section>
    <Boundary label="product performance"><ProductPerformance insights={insights} onUpgrade={onNavigateBilling} /></Boundary>
    <Boundary label="temporal patterns"><TemporalPatterns insights={insights} /></Boundary>
    <Boundary label="conversion funnel"><ConversionFunnel insights={insights} onUpgrade={onNavigateBilling} /></Boundary>
    <Boundary label="advanced comparisons"><Benchmarks insights={insights} onUpgrade={onNavigateBilling} /></Boundary>
    <Boundary label="custom AI analyst"><CustomAIQuery context={context} insights={insights} onUpgrade={onNavigateBilling} /></Boundary>
  </main>
}

function AnalyticsHeader({ period, setPeriod, customRange, onCustomRange, syncing, onSync, snapshot }: { period: AnalyticsPeriod; setPeriod: (period: AnalyticsPeriod) => void; customRange: Readonly<{ from: string; to: string }> | null; onCustomRange: (range: Readonly<{ from: string; to: string }> | null) => void; syncing: boolean; onSync: () => Promise<void>; snapshot: AnalyticsSnapshot | null }) {
  const [customOpen, setCustomOpen] = useState(false)
  // The API may return `day` as a full ISO timestamp (Postgres `date` column
  // parsed by the pg driver) rather than a bare YYYY-MM-DD key, so every value
  // is normalised through safeDayKey before any date arithmetic happens.
  const latest = snapshot?.revenue.map((row) => safeDayKey(row?.day)).filter((day): day is string => day !== null).sort().at(-1) ?? todayDayKey()
  const [from, setFrom] = useState(() => safeAddDays(latest, -29) ?? latest)
  const [to, setTo] = useState(latest)
  const exportCsv = () => {
    const rows = snapshot?.revenue ?? []; if (!rows.length) return
    const csv = ['Date,Revenue,Orders,Discounts', ...rows.map((row) => [row.day, row.grossRevenue, row.orderCount, row.discounts].join(','))].join('\n')
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'profitpilot-analytics.csv'; link.click(); URL.revokeObjectURL(link.href)
  }
  return <header className="analytics-page-header">
    <div className="analytics-heading"><span className="analytics-page-icon"><BarChart3 size={20} /></span><div><div className="analytics-eyebrow"></div><h1>Analytics</h1><p>Smart insights from your store data</p></div></div>
    <div className="analytics-toolbar">
      <div className="date-range-control"><div className="period-toggle" aria-label="Date range">{([7, 30, 90, 365] as const).map((days) => <Button className={!customRange && period === days ? 'active' : ''} onClick={() => setPeriod(days)} key={days}>{days === 365 ? '1y' : `${days}d`}</Button>)}<Button className={customRange ? 'active' : ''} onClick={() => setCustomOpen((value) => !value)}>Custom</Button></div>{customOpen && <div className="custom-range-popover"><label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label><Button onClick={() => { if (from && to && from <= to) { onCustomRange({ from, to }); setCustomOpen(false) } }}>Apply range</Button></div>}</div>
      <Button className="analytics-tool-button" onClick={exportCsv} disabled={!snapshot?.revenue.length}><Download size={14} /> Export</Button>
      <Button className="analytics-tool-button primary" onClick={() => void onSync()} disabled={syncing}><RefreshCw size={14} className={syncing ? 'spin' : ''} /> Refresh</Button>
    </div>
  </header>
}

export function AnalyticsHero({ kpis, loading }: { kpis: readonly Kpi[]; loading: boolean }) { return <section className="analytics-kpis">{kpis.map((kpi, index) => <KpiCard key={kpi.label} kpi={kpi} index={index} loading={loading} />)}</section> }
function KpiCard({ kpi, index, loading }: { kpi: Kpi; index: number; loading: boolean }) {
  const data = kpi.sparkline.filter(Number.isFinite).map((value, point) => ({ point, value }))
  const icons = [BarChart3, ShoppingBag, Target, Activity, Users, Zap]; const Icon = icons[index] ?? Activity
  if (loading) return <article className="analytics-kpi skeleton-card"><div className="skeleton-line short" /><div className="skeleton-line value" /><div className="skeleton-line" /></article>
  const toneColor = 'var(--accent)'
  const isFlat = data.length >= 2 && data.every((d) => d.value === data[0]?.value)
  const chartData = data.map((d, i) => ({
    ...d,
    plotValue: isFlat ? d.value * (1 + (i % 2 === 0 ? -0.04 : 0.04)) : d.value,
  }))
  // Per-KPI chart type: an area for revenue, bars for orders and customers, a
  // trend line for AOV, and a professional data-pending panel for metrics whose
  // source (visitor sessions, repeat history) is not connected yet.
  const variant: 'area' | 'bars' | 'line' | 'pending' = index === 1 || index === 4 ? 'bars' : index === 2 ? 'line' : index === 3 || index === 5 ? 'pending' : 'area'
  const gradientId = `kpi-grad-${index}`
  return <article className={`analytics-kpi premium tone-${index} variant-${variant}`}>
    <header>
      <span className="kpi-icon"><Icon size={14} /></span>
      <small>{kpi.label}</small>
      {kpi.change !== null ? <b className={`kpi-trend-badge ${kpi.change >= 0 ? 'positive' : 'negative'}`} title="Change versus the previous period">{kpi.change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}<span>{Math.abs(kpi.change).toFixed(1)}%</span><small>vs prev</small></b> : <b className="kpi-trend-badge neutral" title="A previous-period baseline is still building"><Activity size={12} /><span>New</span></b>}
    </header>
    <strong>{formatKpi(kpi)}</strong>
    <p className="kpi-detail-line">{kpi.detail}</p>
    <span className="kpi-compare">{kpi.change !== null ? <><i className={kpi.change >= 0 ? 'up' : 'down'} />vs. prior 28 days</> : 'Awaiting prior-period baseline'}</span>
    {variant === 'pending' || data.length < 2 ? (
      <div className="kpi-pending" aria-label={`${kpi.label} visualization pending`}>
        <span className="kpi-pending-icon"><Icon size={15} /></span>
        <div><strong>Visualization pending</strong><small>{data.length === 0 ? 'This metric needs a data source not connected yet' : 'More daily points unlock the trend chart'}</small></div>
      </div>
    ) : (
      <div className="kpi-chart" aria-label={`${kpi.label} recent trend`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={toneColor} stopOpacity={0.55} />
                <stop offset="55%" stopColor={toneColor} stopOpacity={0.16} />
                <stop offset="100%" stopColor={toneColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis domain={['dataMin - 1', 'dataMax + 1']} hide />
            <Tooltip content={<KpiTooltip format={kpi.format} label={kpi.label} total={data.length} />} cursor={false} />
            {variant === 'area' && <Area type="monotone" dataKey="plotValue" stroke={toneColor} strokeWidth={2.6} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 3.5, strokeWidth: 2, fill: toneColor }} isAnimationActive={true} animationDuration={650} />}
            {variant === 'bars' && <Bar dataKey="plotValue" fill={toneColor} fillOpacity={0.5} radius={[3, 3, 0, 0]} maxBarSize={9} isAnimationActive={true} animationDuration={650} />}
            {variant === 'line' && <Line type="monotone" dataKey="plotValue" stroke={toneColor} strokeWidth={2.6} dot={{ r: 2, fill: toneColor }} activeDot={{ r: 4, strokeWidth: 2, fill: toneColor }} isAnimationActive={true} animationDuration={650} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    )}
  </article>
}
function KpiTooltip({ active, payload, format, label, total }: { active?: boolean; payload?: Array<{ payload?: { point: number; value: number } }>; format: Kpi['format']; label: string; total: number }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point || typeof point.value !== 'number' || !Number.isFinite(point.value)) return null
  return <div className="kpi-tooltip"><span>{label}</span><strong>{formatKpiValue(point.value, format)}</strong><small>day {point.point + 1} of {total}</small></div>
}

/**
 * Revenue momentum — daily discrete plot.
 *
 * Each day is drawn as its own revenue value (never a running total), so a
 * zero-sale day physically drops the line to $0 — matching the "Volume & Value"
 * chart beside it. The dashed previous-period line plots the same calendar
 * days one period earlier, and the AI forecast continues the daily series into
 * the future. No series is drawn when its source is missing.
 */
export function RevenueTrendChart({ trend, period, setPeriod }: { trend: readonly TrendPoint[]; period: AnalyticsPeriod; setPeriod: (period: AnalyticsPeriod) => void }) {
  const pacing = useMemo(() => revenuePacing(trend), [trend])
  const growth = pacing.pace
  const peak = pacing.peak
  const closing = pacing.projectedClose ?? (pacing.daysTotal > pacing.daysElapsed ? pacing.runRateClose : null)
  const closeSource = pacing.projectedClose !== null ? 'AI forecast' : 'current run rate'
  return <Widget className="revenue-trend pacing" eyebrow="Revenue Analysis" title="Revenue momentum" action={<div className="widget-actions">{pacing.hasData ? <span className="scope-pill" title={`Revenue banked across ${pacing.daysElapsed} ${pacing.daysElapsed === 1 ? 'day' : 'days'} of this period`}><Zap size={12} />{money(pacing.total)} banked</span> : null}<div className="period-toggle compact">{([7, 30, 90, 365] as const).map((value) => <Button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{value === 365 ? '1y' : `${value}d`}</Button>)}</div></div>}>
    {pacing.hasData ? <>
      <div className="chart-large"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><ComposedChart data={[...pacing.rows]} margin={{ top: 18, right: 16, left: -8 }}>
        <defs>
          <linearGradient id="pacingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(37, 99, 235)" stopOpacity=".34"/><stop offset="1" stopColor="rgb(37, 99, 235)" stopOpacity=".02"/></linearGradient>
          <linearGradient id="pacingProjection" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(139, 92, 246)" stopOpacity=".18"/><stop offset="1" stopColor="rgb(139, 92, 246)" stopOpacity=".01"/></linearGradient>
        </defs>
        <CartesianGrid stroke="rgb(55, 65, 81)" strokeDasharray="3 7" vertical={false}/>
        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill:'rgb(114, 129, 151)', fontSize:9 }} axisLine={false} tickLine={false} minTickGap={32}/>
        <YAxis tickFormatter={compactMoney} tick={{ fill:'rgb(114, 129, 151)', fontSize:9 }} axisLine={false} tickLine={false}/>
        <Tooltip content={<PacingTooltip/>} cursor={{ stroke:'rgb(71, 85, 105)', strokeDasharray:'3 3' }}/>
        <Line type="monotone" dataKey="previous" name="Previous" stroke="rgb(100, 116, 139)" strokeDasharray="5 6" strokeWidth={1.8} dot={false} connectNulls/>
        <Area type="monotone" dataKey="forecast" name="AI forecast" stroke="rgb(167, 139, 250)" strokeWidth={2} strokeDasharray="5 5" fill="url(#pacingProjection)" dot={false} connectNulls/>
        <Area type="monotone" dataKey="revenue" name="Current" stroke="rgb(96, 165, 250)" strokeWidth={2.6} fill="url(#pacingFill)" dot={false} activeDot={{ r:4.5, strokeWidth:2.5, fill:'rgb(255, 255, 255)', stroke:'rgb(96, 165, 250)' }}/>
        {peak && <ReferenceLine x={peak.day} stroke="rgb(245, 158, 11)" strokeDasharray="5 5" strokeWidth={1.2} label={{ position: 'top', offset: 8, content: <PeakLabel value={`Peak day ${money(peak.revenue)}`} /> }} />}
      </ComposedChart></ResponsiveContainer></div>
      <div className="chart-caption">
        <span><i className="legend current"/>Current</span>
        <span><i className="legend previous"/>Previous</span>
        <span><i className="legend forecast"/>AI forecast</span>
        <b className={growth !== null && growth < 0 ? 'negative' : 'positive'}>{growth === null ? 'Baseline building' : `${growth >= 0 ? '↗ Ahead of' : '↘ Behind'} last period by ${Math.abs(growth).toFixed(1)}%`}</b>
      </div>
      <div className="chart-summary">
        <div><small>Total</small><strong title={`Revenue banked across ${pacing.daysElapsed} ${pacing.daysElapsed === 1 ? 'day' : 'days'} of this period`}>{money(pacing.total)}</strong></div>
        <div><small>Average / day</small><strong title="Run rate across the synced days in this period">{money(pacing.runRate)}</strong></div>
        <div><small>Peak Day</small><strong title={peak ? `${shortDay(peak.day)} — best revenue day of the period` : 'Awaiting sales data'}>{peak ? `${shortDay(peak.day)} · ${money(peak.revenue)}` : '—'}</strong></div>
        <div><small>Growth</small><strong className={growth === null ? '' : growth < 0 ? 'negative' : 'positive'} title={growth === null ? 'A previous-period baseline is still building' : 'Pace against the same elapsed days of the previous period'}>{growth === null ? '—' : `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`}</strong></div>
      </div>
      <div className="insight-strip"><Brain size={14}/><span>This period has banked <b>{money(pacing.total)}</b> across {pacing.daysElapsed} {pacing.daysElapsed === 1 ? 'day' : 'days'}, a run rate of <b>{money(pacing.runRate)}</b> per day{closing !== null ? <> — on the {closeSource} this period tracks to close near <b>{money(closing)}</b></> : null}. {growth === null ? 'A previous-period baseline is still building, so pacing appears once comparable days exist.' : growth >= 0 ? `You are ${Math.abs(growth).toFixed(1)}% ahead of the same point last period — protect what is working.` : `You are ${Math.abs(growth).toFixed(1)}% behind the same point last period — close the gap while days remain.`}</span></div>
    </> : <RichEmpty icon={LineChart} title="Your revenue story starts here" message="Sync your first orders to turn this canvas into a period-pacing narrative: banked revenue, last period's pace, and the projected close." progress={0} goal="First revenue day" />}
  </Widget>
}

export function OrdersAOVCorrelation({ trend }: { trend: readonly TrendPoint[] }) {
  const real = trend.some((row) => row.orders > 0)
  const orders = trend.reduce((sum, row) => sum + row.orders, 0)
  const avg = orders ? trend.reduce((sum, row) => sum + row.revenue, 0) / orders : 0
  const rows = trend.filter((row) => row.forecast === null)
  const peakOrderDay = rows.length ? [...rows].sort((a, b) => b.orders - a.orders)[0] : null
  const peakAovDay = rows.length ? [...rows].sort((a, b) => b.aov - a.aov)[0] : null
  return <Widget className="orders-aov" eyebrow="Volume & Value" title="Orders & AOV correlation" action={<span className="scope-pill"><ShoppingBag size={12} />{real ? `${orders} orders · ${money(avg)} AOV` : 'Awaiting orders'}</span>}>
    {real ? <><div className="chart-large"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><ComposedChart data={rows} margin={{ top: 12, right: 4, left: -20 }}><defs><linearGradient id="ordersFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(129, 140, 248)" stopOpacity=".5"/><stop offset="1" stopColor="rgb(129, 140, 248)" stopOpacity=".06"/></linearGradient></defs><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false}/><XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: 'rgb(114, 129, 151)', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={30}/><YAxis yAxisId="orders" tick={{ fill: 'rgb(114, 129, 151)', fontSize: 9 }} axisLine={false} tickLine={false}/><YAxis yAxisId="aov" orientation="right" tickFormatter={compactMoney} tick={{ fill: 'rgb(114, 129, 151)', fontSize: 9 }} axisLine={false} tickLine={false}/><Tooltip content={<OrdersAovTooltip average={avg} />} cursor={{ fill: 'rgba(148,163,184,.06)' }} /><Bar yAxisId="orders" dataKey="orders" name="Orders" fill="url(#ordersFill)" radius={[5, 5, 0, 0]}/><Line yAxisId="aov" type="monotone" dataKey="aov" name="AOV" stroke="rgb(45, 212, 191)" strokeWidth={2.4} dot={{ r: 2, fill: 'rgb(45, 212, 191)' }} activeDot={{ r: 4, strokeWidth: 2, fill: 'rgb(255, 255, 255)', stroke: 'rgb(45, 212, 191)' }}/></ComposedChart></ResponsiveContainer></div><div className="chart-caption"><span><i className="legend orders" />Orders</span><span><i className="legend aov" />AOV</span><b>{peakOrderDay ? `Busiest day ${shortDay(peakOrderDay.day)} · ${peakOrderDay.orders} orders` : 'Busiest day building…'}</b></div><div className="insight-strip"><Brain size={14}/><span>Average order value <b>{money(avg)}</b>{peakAovDay && peakAovDay.aov > avg ? <> with a peak of <b>{money(peakAovDay.aov)}</b> on {shortDay(peakAovDay.day)}</> : null}. When AOV climbs faster than order count, growth comes from bigger baskets — not just more buyers.</span></div></> : <RichEmpty icon={ShoppingBag} title="See value and volume together" message="Order bars and AOV will reveal whether growth comes from more buyers or larger baskets." progress={0} goal="Sync an order" />}
  </Widget>
}

export function SalesByChannel({ channels }: { channels: NonNullable<AnalyticsInsights['channels']> }) {
  const max = Math.max(1, ...channels.map((row) => row.revenue))
  return <Widget eyebrow="Traffic Sources" title="Sales by channel" badge={channels.length ? `${channels.length} active` : undefined}>
    {channels.length ? (
      <div className="channel-list">
        {channels.map((row, index) => (
          <div className="channel-row" key={row.channel}>
            <div className="channel-label">
              <span className="channel-icon"><ShoppingBag size={13} /></span>
              <div>
                <b>{row.channel}</b>
                <small>{row.orders} orders · {row.share.toFixed(1)}%</small>
              </div>
              <strong>{money(row.revenue)}</strong>
            </div>
            <div className="channel-track">
              <i style={{ width: `${Math.max(4, (row.revenue / max) * 100)}%`, background: COLORS[index % COLORS.length] }} />
            </div>
            <em className={row.growth !== null && row.growth < 0 ? 'negative' : 'positive'}>
              {row.growth === null ? 'New baseline' : `${row.growth >= 0 ? '↑' : '↓'} ${Math.abs(row.growth).toFixed(1)}%`}
            </em>
          </div>
        ))}
      </div>
    ) : (
      <RichEmpty
        icon={Target}
        title="Channel attribution is ready"
        message="Shopify order source attribution will separate Online Store, Point of Sale, Mobile app, and custom integrations once orders with channel source data are synced."
        progress={0}
        goal="Sync order source data"
      />
    )}
  </Widget>
}

export function CategoryDistribution({ categories }: { categories: AnalyticsInsights['categories'] }) {
  const total = categories.reduce((sum, row) => sum + safe(row.revenue), 0)
  return <Widget eyebrow="Category Breakdown" title="Sales by category">
    {categories.length > 1 ? (
      <div className="category-layout">
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <PieChart>
              <Pie data={[...categories]} dataKey="revenue" nameKey="name" innerRadius="62%" outerRadius="84%" paddingAngle={3}>
                {categories.map((row, index) => <Cell key={row.name} fill={COLORS[index % COLORS.length] ?? 'rgb(56, 189, 248)'} />)}
              </Pie>
              <Tooltip formatter={(value) => money(safe(value))} />
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <strong>{money(total)}</strong>
            <span>Total mix</span>
          </div>
        </div>
        <div className="category-legend">
          {categories.slice(0, 6).map((row, index) => (
            <div key={row.name}>
              <i style={{ background: COLORS[index % COLORS.length] }} />
              <span>{row.name}</span>
              <strong>{total ? ((row.revenue / total) * 100).toFixed(1) : 0}%</strong>
              <small>{money(row.revenue)}</small>
            </div>
          ))}
        </div>
      </div>
    ) : categories.length === 1 ? (
      <div className="single-category">
        <span style={{ background: COLORS[0] }} />
        <small>100% OF CATEGORY REVENUE</small>
        <strong>{categories[0]!.name}</strong>
        <b>{money(categories[0]!.revenue)}</b>
        <p>Add product types and categories in Shopify to unlock a richer revenue mix across your catalog.</p>
      </div>
    ) : (
      <RichEmpty
        icon={PackageSearch}
        title="Build your category mix"
        message="Product collections and catalog categories combined with order line items will display category share of total revenue."
        progress={0}
        goal="Sync products and orders"
      />
    )}
  </Widget>
}

/**
 * Discount & revenue leakage.
 *
 * Shopify's daily revenue rows carry the collected order total and the discount
 * amount that was taken off, so the waterfall (merchandise value → discounts →
 * collected) is measured, not modelled. Cancellations are shown as counts
 * because the daily aggregate does not carry a cancelled-order value.
 */
export function DiscountLeakage({ snapshot, trend }: { snapshot: AnalyticsSnapshot | null; trend: readonly TrendPoint[] }) {
  const days = useMemo(() => trend.filter((point) => point.forecast === null).map((point) => point.day), [trend])
  const data = useMemo(() => revenueLeakage(snapshot, days), [snapshot, days])
  const rate = data.discountRate
  const share = data.merchandiseValue > 0 ? (data.collected / data.merchandiseValue) * 100 : null
  return <Widget className="leakage-widget" eyebrow="Margin Protection" title="Discount & revenue leakage" action={data.hasData ? <span className={`scope-pill ${rate !== null && rate >= 15 ? 'warn' : ''}`} title="Share of merchandise value given away as discounts"><Percent size={12} />{rate === null ? 'No discounts' : `${rate.toFixed(1)}% discount rate`}</span> : undefined}>
    {data.hasData ? <>
      <div className="chart-mid"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><ComposedChart data={[...data.rows]} margin={{ top: 14, right: 6, left: -18 }}>
        <defs><linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(56, 189, 248)" stopOpacity=".55"/><stop offset="1" stopColor="rgb(56, 189, 248)" stopOpacity=".12"/></linearGradient></defs>
        <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false}/>
        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill:'rgb(114, 129, 151)', fontSize:9 }} axisLine={false} tickLine={false} minTickGap={30}/>
        <YAxis yAxisId="money" tickFormatter={compactMoney} tick={{ fill:'rgb(114, 129, 151)', fontSize:9 }} axisLine={false} tickLine={false}/>
        <YAxis yAxisId="rate" orientation="right" domain={[0, 'auto']} tickFormatter={(value: number) => `${Math.round(safe(value))}%`} tick={{ fill:'rgb(114, 129, 151)', fontSize:9 }} axisLine={false} tickLine={false}/>
        <Tooltip content={<LeakageTooltip average={rate} />} cursor={{ fill:'rgba(148,163,184,.06)' }}/>
        <Bar yAxisId="money" stackId="value" dataKey="collected" name="Collected" fill="url(#collectedFill)" radius={[0, 0, 0, 0]} maxBarSize={22}/>
        <Bar yAxisId="money" stackId="value" dataKey="discounts" name="Discounts" fill="rgb(245, 158, 11)" fillOpacity={.85} radius={[4, 4, 0, 0]} maxBarSize={22}/>
        {data.discounts > 0 && <Line yAxisId="rate" type="monotone" dataKey="discountRate" name="Discount rate" stroke="rgb(251, 146, 60)" strokeWidth={2.2} dot={false} activeDot={{ r:4, strokeWidth:2, fill:'rgb(255, 255, 255)', stroke:'rgb(251, 146, 60)' }} connectNulls/>}
      </ComposedChart></ResponsiveContainer></div>
      <div className="chart-caption">
        <span><i className="legend collected"/>Collected</span>
        <span><i className="legend discounts"/>Discounts</span>
        {data.discounts > 0 ? <span><i className="legend rate"/>Discount rate</span> : null}
        <b className={data.cancelledOrders > 0 ? 'negative' : 'positive'}>{data.cancelledOrders > 0 ? `${data.cancelledOrders} cancelled of ${data.orders} orders (${(data.cancelRate ?? 0).toFixed(1)}%)` : `${data.orders} orders · none cancelled`}</b>
      </div>
      <div className="chart-summary">
        <div><small>Merchandise value</small><strong title="Collected revenue plus every discount given in this period">{money(data.merchandiseValue)}</strong></div>
        <div><small>Discounts given</small><strong className={data.discounts > 0 ? 'negative' : ''} title="Shopify discount totals across the period">{data.discounts > 0 ? `−${money(data.discounts)}` : money(0)}</strong></div>
        <div><small>Collected</small><strong className="positive" title="Order totals actually captured">{money(data.collected)}{share !== null ? ` · ${share.toFixed(0)}%` : ''}</strong></div>
        <div><small>Discount days</small><strong title="Days in this period where at least one discount was applied">{data.discountDays} of {data.rows.length}</strong></div>
      </div>
      <div className="insight-strip"><Brain size={14}/><span>{data.discounts > 0
        ? <>Discounts absorbed <b>{money(data.discounts)}</b> ({(rate ?? 0).toFixed(1)}% of merchandise value){data.heaviestDay ? <>, heaviest on {shortDay(data.heaviestDay.day)} at <b>{money(data.heaviestDay.discounts)}</b></> : null}. Trimming the discount rate by one point would return roughly <b>{money(data.onePointValue)}</b> over the same volume.</>
        : <>No discount leakage in this period — <b>{money(data.collected)}</b> was collected at full merchandise value. Keep promotions targeted so margin stays intact.</>}{data.cancelledOrders > 0 ? <> {data.cancelledOrders} cancelled {data.cancelledOrders === 1 ? 'order' : 'orders'} also left the funnel; review fulfilment friction.</> : null}</span></div>
    </> : <RichEmpty icon={Percent} title="Protect your margin" message="Once orders sync, this card separates the money you collected from the money handed back through discounts, and flags cancellations that quietly drain revenue." progress={0} goal="Sync orders to measure leakage" />}
  </Widget>
}

function LeakageTooltip({ active, payload, label, average }: { active?: boolean; payload?: Array<{ payload?: { day: string; collected: number; discounts: number; discountRate: number | null } }>; label?: string; average?: number | null }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  const merchandise = point.collected + point.discounts
  return <div className="analytics-tooltip">
    <strong>{formatDateLabel(label ?? point.day)}</strong>
    <div className="tooltip-metrics">
      <div className="tooltip-row"><i style={{ background:'rgb(56, 189, 248)' }} /><span>Collected:</span><strong>{money(point.collected)}</strong></div>
      <div className="tooltip-row"><i style={{ background:'rgb(245, 158, 11)' }} /><span>Discounts:</span><strong>{point.discounts > 0 ? `−${money(point.discounts)}` : money(0)}</strong></div>
      <div className="tooltip-row"><i style={{ background:'rgb(148, 163, 184)' }} /><span>Merchandise:</span><strong>{money(merchandise)}</strong></div>
      {point.discountRate !== null && <div className="tooltip-row"><i style={{ background:'rgb(251, 146, 60)' }} /><span>Discount rate:</span><strong className={average != null && point.discountRate > average ? 'negative' : 'positive'}>{point.discountRate.toFixed(1)}%</strong></div>}
    </div>
  </div>
}

/**
 * Stock-out risk & days of cover.
 *
 * Quantities come from Shopify inventory levels and the velocity/days-of-cover
 * figures are the same measured values the Inventory workspace shows. When the
 * plan does not include days of cover, the card falls back to honest stock
 * counts rather than inventing a runway.
 */
export function StockoutRisk({ inventory, loading, onUpgrade }: { inventory: InventoryPageResult | null; loading: boolean; onUpgrade: () => void }) {
  const risk = useMemo(() => stockRisk(inventory), [inventory])
  const chartRows = risk.items.filter((item) => item.days !== null).map((item) => ({ ...item, days: item.days ?? 0, short: item.label.length > 22 ? `${item.label.slice(0, 21)}…` : item.label }))
  const worst = risk.items[0] ?? null
  const colorFor = (days: number, status: string) => (status === 'out' || days <= 3 ? 'rgb(244, 63, 94)' : days <= risk.reorderWindowDays ? 'rgb(245, 158, 11)' : 'rgb(52, 211, 153)')
  return <Widget className="stockout-widget" eyebrow="Inventory Risk" title="Stock-out risk & cover" action={risk.hasInventory ? <span className={`scope-pill ${risk.urgentCount > 0 ? 'warn' : ''}`} title="SKUs out of stock or inside the reorder window"><PackageSearch size={12} />{risk.urgentCount > 0 ? `${risk.urgentCount} need action` : 'All SKUs covered'}</span> : undefined}>
    {loading ? <div className="stock-risk-loading"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line short" /></div>
      : !risk.hasInventory ? <RichEmpty icon={PackageSearch} title="Protect your bestsellers" message={risk.explanation} progress={0} goal="Sync products to measure stock cover" />
      : <>
        {chartRows.length ? <div className="chart-mid risk-chart"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><ComposedChart layout="vertical" data={chartRows} margin={{ top: 10, right: 22, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="rgba(148,163,184,.08)" horizontal={false}/>
          <XAxis type="number" tick={{ fill:'rgb(114, 129, 151)', fontSize:9 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => `${Math.round(safe(value))}d`} />
          <YAxis type="category" dataKey="short" width={104} tick={{ fill:'rgb(143, 163, 188)', fontSize:9 }} axisLine={false} tickLine={false} />
          <Tooltip content={<StockRiskTooltip window={risk.reorderWindowDays} />} cursor={{ fill:'rgba(148,163,184,.06)' }}/>
          <ReferenceLine x={risk.reorderWindowDays} stroke="rgb(245, 158, 11)" strokeDasharray="4 4" strokeWidth={1.2} label={{ position:'top', offset: 6, content: <PeakLabel value={`Reorder point ${risk.reorderWindowDays}d`} /> }} />
          <Bar dataKey="days" name="Days of cover" radius={[0, 5, 5, 0]} maxBarSize={17}>
            {chartRows.map((row) => <Cell key={row.variantId} fill={colorFor(row.days, row.status)} />)}
          </Bar>
        </ComposedChart></ResponsiveContainer></div> : (
          <div className="risk-list">
            {risk.items.slice(0, 5).map((item) => (
              <div className="risk-row" key={item.variantId}>
                <span className={`risk-dot ${item.status}`} />
                <div><b>{item.label}</b><small>{item.sku ? `${item.sku} · ` : ''}{item.status === 'out' ? 'Out of stock' : item.status === 'low' ? 'Low stock' : 'Tracked'}</small></div>
                <strong>{item.quantity === null ? '—' : `${item.quantity.toLocaleString()} left`}</strong>
              </div>
            ))}
            {!risk.items.length ? <p className="risk-empty">Every tracked SKU is above the low-stock threshold right now.</p> : null}
          </div>
        )}
        <div className="chart-summary">
          <div><small>Out of stock</small><strong className={risk.outCount > 0 ? 'negative' : 'positive'}>{risk.outCount}</strong></div>
          <div><small>Low stock</small><strong className={risk.lowCount > 0 ? 'warn' : ''}>{risk.lowCount}</strong></div>
          <div><small>Healthy SKUs</small><strong className="positive">{risk.healthyCount}</strong></div>
          <div><small>30-day exposure</small><strong className={risk.exposure ? 'negative' : ''} title={risk.exposure === null ? 'Needs measured velocity and a price on the at-risk SKUs' : `Revenue at risk over 30 days across ${risk.exposureItems} SKU${risk.exposureItems === 1 ? '' : 's'} at their measured sales velocity`}>{risk.exposure === null ? '—' : `≈ ${money(risk.exposure)}`}</strong></div>
        </div>
        <div className="insight-strip"><Brain size={14}/><span>{worst
          ? <>{worst.status === 'out'
              ? <><b>{worst.label}</b> is out of stock{worst.velocity ? <> while selling <b>{worst.velocity.toFixed(1)}</b> units/day</> : null}{worst.exposure ? <> — roughly <b>{money(worst.exposure)}</b> of demand is exposed over the next 30 days</> : null}.</>
              : worst.days !== null
                ? <><b>{worst.label}</b> has <b>{worst.days.toFixed(1)} days</b> of cover left at its measured velocity{worst.exposure ? <>, putting about <b>{money(worst.exposure)}</b> at risk this month</> : null}.</>
                : <><b>{worst.label}</b> is flagged {worst.status === 'low' ? 'low' : 'at risk'}{worst.quantity !== null ? <> with <b>{worst.quantity}</b> units left</> : null}.</>}
            {' '}Reorder before the {risk.reorderWindowDays}-day window closes to keep the revenue you already earn.</>
          : <>No SKU is inside the {risk.reorderWindowDays}-day reorder window — stock cover is healthy across {risk.trackedCount || risk.healthyCount} tracked {(risk.trackedCount || risk.healthyCount) === 1 ? 'SKU' : 'SKUs'}.</>}</span></div>
        {/* The Upgrade CTA appears ONLY when days-of-cover is plan-locked.
            Commander stores and young stores without a 30-day baseline get an
            honest "awaiting baseline" note instead of a false upsell. */}
        {risk.coverLocked && risk.hasInventory ? <div className="risk-note"><LockKeyhole size={12} /><span>{risk.explanation}</span><Button type="button" onClick={onUpgrade}>Upgrade <ArrowUpRight size={12} /></Button></div> : null}
        {!risk.coverAvailable && !risk.coverLocked && risk.hasInventory ? <div className="risk-note"><Clock3 size={12} /><span>{risk.explanation}</span></div> : null}
        {risk.untrackedCount > 0 ? <p className="risk-footnote">{risk.untrackedCount} SKU{risk.untrackedCount === 1 ? '' : 's'} are not tracked in Shopify, so they carry no stock signal.</p> : null}
      </>}
  </Widget>
}

function StockRiskTooltip({ active, payload, window }: { active?: boolean; payload?: Array<{ payload?: { label: string; sku: string | null; days: number; velocity: number | null; quantity: number | null; exposure: number | null; status: string } }>; window: number }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  return <div className="analytics-tooltip">
    <strong>{point.label}</strong>
    <div className="tooltip-metrics">
      <div className="tooltip-row"><i style={{ background: point.days <= window ? 'rgb(245, 158, 11)' : 'rgb(52, 211, 153)' }} /><span>Days of cover:</span><strong>{point.days.toFixed(1)}</strong></div>
      {point.quantity !== null && <div className="tooltip-row"><i style={{ background:'rgb(56, 189, 248)' }} /><span>Units left:</span><strong>{point.quantity.toLocaleString()}</strong></div>}
      {point.velocity !== null && <div className="tooltip-row"><i style={{ background:'rgb(129, 140, 248)' }} /><span>Sells / day:</span><strong>{point.velocity.toFixed(2)}</strong></div>}
      {point.exposure !== null && <div className="tooltip-row"><i style={{ background:'rgb(244, 63, 94)' }} /><span>30-day exposure:</span><strong className="negative">≈ {money(point.exposure)}</strong></div>}
      {point.sku ? <div className="tooltip-row"><i style={{ background:'rgb(148, 163, 184)' }} /><span>SKU:</span><strong>{point.sku}</strong></div> : null}
    </div>
  </div>
}

export function AIIntelligence({ insights, trend, loading, onUpgrade }: { insights: AnalyticsInsights | null; trend: readonly TrendPoint[]; loading: boolean; onUpgrade: () => void }) {
  const [open, setOpen] = useState(true)
  const locked = (feature: string) => insights?.locked.some((item) => item.feature === feature) ?? false
  const forecast = insights?.forecast
  const projection = forecast?.points.reduce((sum, row) => sum + row.value, 0) ?? 0
  const historyDays = Math.max(0, insights?.salesHistoryDays ?? (trend.filter((t) => t.revenue > 0).length || 0))

  return <section className={`analytics-widget ai-intelligence ${open ? '' : 'collapsed'}`}>
    <header className="widget-header">
      <div className="widget-title ai-heading">
        <span className="brain-badge"><Brain size={20} /></span>
        <div>
          <h2>Business Intelligence</h2>
          <p>Predictive forecasts, anomaly detection, and growth opportunities based on your sales data.</p>
        </div>
      </div>
      <div className="widget-actions">
        {insights && <UpgradePlanButton plan={insights.plan} onUpgrade={onUpgrade} />}
        <Button className="icon-button" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse AI intelligence' : 'Expand AI intelligence'}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</Button>
      </div>
    </header>
    {open && <div className="ai-grid">
      {loading ? (
        <>{[0, 1, 2, 3].map((key) => <div className="ai-card skeleton-card" key={key}><div className="skeleton-line short" /><div className="skeleton-line value" /><div className="skeleton-line" /></div>)}</>
      ) : (
        <>
          <article className="ai-card forecast-card">
            <CardLabel icon={LineChart} text="AI REVENUE FORECAST" />
            <h3>{forecast?.status === 'available' ? money(projection) : `Building forecast · ${Math.min(7, historyDays)} of 7 days`}</h3>
            <p>{forecast?.status === 'available' ? (forecast.message ?? 'Projected daily revenue with confidence intervals.') : `Analyzing your sales patterns. Full predictive forecasting activates once 7 consecutive days of sales data are captured (${Math.min(7, historyDays)}/7 days captured).`}</p>
            <div className="forecast-mini">
              {forecast?.status === 'available' ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <ComposedChart data={[...trend.slice(-14)]}>
                    <Area type="monotone" dataKey="upper" fill="rgb(139, 92, 246)" fillOpacity={0.12} stroke="none" />
                    <Line type="monotone" dataKey="revenue" stroke="rgb(56, 189, 248)" dot={false} />
                    <Line type="monotone" dataKey="forecast" stroke="rgb(167, 139, 250)" strokeDasharray="4 4" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <Progress current={historyDays} total={7} />
              )}
            </div>
            <footer>
              <span className="confidence-dot" /> {forecast?.status === 'available' ? (forecast.standardDeviation < projection * 0.15 ? 'High confidence' : 'Medium confidence') : `${Math.min(7, historyDays)} of 7 days learned`}
            </footer>
          </article>
          <article className="ai-card">
            <CardLabel icon={AlertTriangle} text="ANOMALY DETECTION" />
            {locked('anomaly_detection') ? (
              <LockedInline plan="Start" message="Receive real-time alerts when revenue spikes or dips unexpectedly against baseline." onUpgrade={onUpgrade} />
            ) : insights?.anomalies?.length ? (
              <div className="signal-list">
                {insights.anomalies.slice(0, 3).map((item) => (
                  <div key={item.day}>
                    <span className={item.direction} />
                    <p>
                      <b>{shortDay(item.day)} · {item.direction === 'spike' ? 'Revenue spike' : 'Revenue dip'}</b>
                      <small>{Math.abs(item.percentFromAverage).toFixed(0)}% from your baseline</small>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EducationalState
                title="No unusual signals"
                message={historyDays < 14 ? 'AI requires 14 consecutive sales days to compute baseline standard deviations and identify anomaly signals.' : 'Revenue is tracking stably within expected statistical ranges.'}
                current={historyDays}
                total={14}
              />
            )}
          </article>
          <article className="ai-card">
            <CardLabel icon={Lightbulb} text="GROWTH OPPORTUNITIES" />
            {locked('growth_opportunities') ? (
              <LockedInline plan="Growth" message="Unlock algorithmic revenue opportunities tailored to your catalog performance." onUpgrade={onUpgrade} />
            ) : insights?.opportunities?.length ? (
              <div className="opportunity-list">
                {insights.opportunities.map((item, index) => (
                  <div key={item.title}>
                    <b>{index + 1}</b>
                    <p>
                      <strong>{item.title}</strong>
                      <small>{item.action}</small>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EducationalState
                title="Building growth opportunities"
                message="Capturing sales velocity and order trends to generate high-impact revenue recommendations."
                current={historyDays}
                total={14}
              />
            )}
          </article>
          <article className="ai-card executive-card">
            <CardLabel icon={Wand2} text="EXECUTIVE BRIEF" />
            {locked('executive_summary') ? (
              <LockedInline plan="Growth" message="Executive summary synthesizing sales trends, customer acquisition, and inventory demand." onUpgrade={onUpgrade} />
            ) : (
              <>
                <blockquote>“{insights?.executiveSummary ?? 'Your executive intelligence brief activates as orders sync across your store catalog.'}”</blockquote>
                <footer><Brain size={13} /> Generated from your verified store data</footer>
              </>
            )}
          </article>
        </>
      )}
    </div>}
  </section>
}

export function CohortAnalysis({ insights,onUpgrade }:{insights:AnalyticsInsights|null;onUpgrade:()=>void}) { if (!hasPlan(insights,'growth')) return <LockedWidget icon={Users} title="Customer cohort analysis" eyebrow="Customer Retention" plan="Growth" message="Track which customer groups keep coming back." onUpgrade={onUpgrade}/>; const cohorts=(insights?.cohorts??[]).filter((row)=>row&&typeof row.cohort==='string'&&row.cohort.trim()!==''); return <Widget eyebrow="Customer Retention" title="Customer cohort analysis" badge={cohorts.length?'Monthly retention':undefined}>{cohorts.length?<div className="cohort-table"><div className="cohort-row cohort-head"><span>Acquired</span>{[0,1,2,3,4,5].map((month)=><b key={month}>M{month}</b>)}</div>{cohorts.map((row)=><div className="cohort-row" key={row.cohort}><span>{cohortLabel(row.cohort)}</span>{[0,1,2,3,4,5].map((month)=>{const raw=(row.periods??[]).find((period)=>period?.month===month)?.retention; const value=typeof raw==='number'&&Number.isFinite(raw)?raw:undefined; return <b key={month} style={{background:value===undefined?'rgba(30,41,59,.35)':`rgba(45,212,191,${.08+Math.min(1,value/100)*.7})`}}>{value===undefined?'—':`${value.toFixed(0)}%`}</b>})}</div>)}</div>:<RichEmpty icon={Users} title="Building retention data" message="Sync customer orders over time to see how many return each month." progress={Math.min(3,new Set((insights?.cohorts??[]).map((row)=>row.cohort)).size)} goal="3 months of customer history" />}</Widget> }

export function GeographicDistribution({insights,onUpgrade}:{insights:AnalyticsInsights|null;onUpgrade:()=>void}) { if(!hasPlan(insights,'growth')) return <LockedWidget icon={Globe2} title="Top countries by revenue" eyebrow="Geographic Sales" plan="Growth" message="See where your sales come from." onUpgrade={onUpgrade}/>; const geo=insights?.geography??[]; const max=Math.max(1,...geo.map((row)=>row.revenue)); return <Widget eyebrow="Geographic Sales" title="Top countries by revenue" badge={geo.length?`${geo.length} markets`:undefined}>{geo.length?<div className="geo-country-list" role="list">{geo.slice(0,8).map((row,index)=>(<div className="geo-country-row" role="listitem" key={row.country}><b>{index+1}</b><span className="geo-country-name"><strong>{row.country}</strong><small>{row.orders} orders · {row.share.toFixed(1)}% of revenue</small></span><span className="geo-country-bar"><i style={{width:`${Math.max(4,(row.revenue/max)*100)}%`}}/></span><em>{money(row.revenue)}</em></div>))}</div>:<RichEmpty icon={MapPin} title="Building your geographic sales map" message="Sync orders with shipping addresses to see where your customers are." progress={0} goal="Sync orders with addresses" />}</Widget> }

export function ProductPerformance({ insights, onUpgrade }: { insights: AnalyticsInsights | null; onUpgrade: () => void }) {
  const products = insights?.topProducts ?? []
  const growthUnlocked = hasPlan(insights, 'growth')

  if (!growthUnlocked) {
    return <section className="product-performance">
      <Widget className="products-table-card locked-products-widget" eyebrow="Top Products" title="Top products by revenue">
        <div className="locked-product-preview" aria-hidden="true">
          {(products.length ? products.slice(0, 3) : [{ productId: 'preview', name: 'Product revenue ranking', image: null, units: 0, revenue: 0, share: 0, trend: 'flat' as const }]).map((product, index) => <div key={product.productId}><b>{index + 1}</b><span>{product.name}</span><strong>{money(product.revenue)}</strong></div>)}
        </div>
        <div className="locked-products-overlay"><LockedInline plan="Growth" message="Rank products by verified revenue, units sold, share, and momentum." onUpgrade={onUpgrade} /></div>
      </Widget>
      <Widget className="product-insights" eyebrow="Product Insights" title="Product insights">
        <LockedInline plan="Growth" message="Discover trending products and categories." onUpgrade={onUpgrade} />
      </Widget>
    </section>
  }

  return <section className="product-performance">
    <Widget className="products-table-card" eyebrow="Top Products" title="Top products by revenue" badge={products.length ? `Top ${Math.min(15, products.length)}` : undefined}>
      {products.length ? <div className="products-scroll"><table><thead><tr><th>Rank</th><th>Product</th><th>Category</th><th>Units</th><th>Revenue</th><th>Share</th><th>Momentum</th></tr></thead><tbody>{products.map((product, index) => <tr key={product.productId}><td><b className={index < 3 ? 'rank' : ''}>{index + 1}</b></td><td><div className="product-cell">{product.image ? <img src={product.image} alt="" /> : <span>{product.name.slice(0, 1)}</span>}<strong>{product.name}</strong></div></td><td>{product.category ?? 'Uncategorized'}</td><td>{product.units.toLocaleString()}</td><td><strong>{money(product.revenue)}</strong></td><td>{product.share.toFixed(1)}%</td><td className={product.trend}>{product.trend === 'up' ? <ArrowUpRight size={15} /> : product.trend === 'down' ? <ArrowDownRight size={15} /> : <Activity size={14} />} {product.growth != null ? `${Math.abs(product.growth).toFixed(0)}%` : 'Building'}</td></tr>)}</tbody></table></div> : <RichEmpty icon={PackageSearch} title="Top products will appear here" message="Sync product sales to see your bestsellers ranked by revenue and units." progress={0} goal="Sync orders to build product rankings" />}
    </Widget>
    <Widget className="product-insights" eyebrow="Product Insights" title="Product insights">
      {products.length ? <div className="merch-list"><MerchSignal icon={ArrowUpRight} tone="green" label="Rising star" value={products.find((product) => product.trend === 'up')?.name ?? 'No rising product yet'} /><MerchSignal icon={ArrowDownRight} tone="red" label="Needs attention" value={products.find((product) => product.trend === 'down')?.name ?? 'No decline detected'} /><MerchSignal icon={Trophy} tone="amber" label="Revenue leader" value={products[0]?.name ?? 'Building'} /></div> : <EducationalState title="Building product insights" message="Sync more sales to see trending products." current={insights?.salesHistoryDays ?? 0} total={14} />}
    </Widget>
  </section>
}
function MerchSignal({icon:Icon,tone,label,value}:{icon:typeof Activity;tone:string;label:string;value:string}) { return <div className={`merch-signal ${tone}`}><span><Icon size={15}/></span><p><small>{label}</small><strong>{value}</strong></p><ChevronUp size={14}/></div> }

export function TemporalPatterns({ insights }: { insights: AnalyticsInsights | null }) {
  const weekdays = (insights?.weekdays ?? []).filter((row) => row && typeof row.day === 'string').map((row) => ({ ...row, revenue: safe(row.revenue) }))
  const peak = (insights?.peakHours ?? []).filter((row) => row && Number.isFinite(row.hour)).map((row) => ({ ...row, orders: safe(row.orders) }))
  const best = [...weekdays].sort((a, b) => b.revenue - a.revenue)[0]
  const hasDays = weekdays.some((row) => row.revenue > 0)
  const hasHours = peak.some((row) => row.orders > 0)
  return <section className="analytics-split">
    <Widget eyebrow="Weekly Performance" title="Best performing day" badge={hasDays && best ? <><Trophy size={12} />{best.day} leads</> : undefined}>
      {hasDays ? (
        <div className="temporal-chart">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={[...weekdays]}>
              <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: 'rgb(128, 144, 165)', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compactMoney} tick={{ fill: 'rgb(128, 144, 165)', fontSize: 8 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => money(safe(value))} />
              <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                {weekdays.map((row) => <Cell key={row.day} fill={row.day === best?.day ? 'rgb(56, 189, 248)' : 'rgba(56,189,248,.22)'} />)}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <RichEmpty
          icon={CalendarDays}
          title="Building your weekly pattern"
          message={`Weekly performance patterns will reveal your best-selling days and optimal timing for campaigns. Currently building — ${Math.min(7, insights?.salesHistoryDays ?? 0)} of 7 days captured.`}
          progress={Math.min(7, insights?.salesHistoryDays ?? 0)}
          goal="7 sales days"
        />
      )}
    </Widget>
    <Widget eyebrow="Peak Hours" title="Peak sales hours" badge={hasHours ? 'Busiest hours from your orders' : undefined}>
      {hasHours ? (
        <div className="hour-heatmap">
          <div className="heat-labels"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
          <div className="heat-cells">
            {peak.map((row) => {
              const max = Math.max(...peak.map((item) => item.orders), 1)
              return (
                <div key={row.hour} title={`${row.hour}:00 · ${row.orders} orders`} style={{ background: `rgba(139,92,246,${0.08 + (row.orders / max) * 0.8})` }}>
                  <span>{row.orders || ''}</span>
                </div>
              )
            })}
          </div>
          <div className="insight-strip"><Clock3 size={14} /><span>Use your busiest hours to schedule campaigns and support coverage.</span></div>
        </div>
      ) : (
        <RichEmpty
          icon={Clock3}
          title="Sync order times to see busiest hours"
          message="Hourly demand needs timestamps. Peak sales hours help you time promotions perfectly. Sync orders with timestamps to unlock the hourly heatmap and identify your busiest shopping hours."
          progress={0}
          goal="Sync orders with timestamps"
        />
      )}
    </Widget>
  </section>
}

export function ConversionFunnel({insights,onUpgrade}:{insights:AnalyticsInsights|null;onUpgrade:()=>void}) { if(!hasPlan(insights,'growth')) return <LockedWidget wide icon={Target} title="Conversion funnel" eyebrow="Conversion Journey" plan="Growth" message="See how visitors move from browsing to buying." onUpgrade={onUpgrade}/>; const funnel=insights?.funnel; return <Widget eyebrow="Conversion Journey" title="Conversion funnel" action={<span className="scope-pill"><Activity size={12}/> Order-based view</span>}><div className="funnel-layout"><div className="funnel-bars">{(funnel?.stages??[]).map((stage,index)=><div className={stage.value===null?'unavailable':''} style={{width:`${100-index*10}%`}} key={stage.name}><span>{stage.name}</span><strong>{stage.value===null?'Connect Shopify Analytics':stage.value.toLocaleString()}</strong></div>)}</div><div className="funnel-note"><Target size={22}/><div><strong>Order data is ready. Connect Shopify Analytics to track visitors.</strong><p>{funnel?.message??'Connect Shopify Analytics to track visitors and product views.'}</p></div></div></div></Widget> }

export function Benchmarks({insights,onUpgrade}:{insights:AnalyticsInsights|null;onUpgrade:()=>void}) { if(!hasPlan(insights,'commander')) return <LockedWidget wide icon={BarChart3} title="Benchmarks & advanced comparisons" eyebrow="Executive Overview" plan="Commander" message="Compare your performance across different time periods." onUpgrade={onUpgrade}/>; const comparisons=insights?.comparisons??[]; return <Widget eyebrow="Executive Overview" title="Benchmarks & advanced comparisons" badge="Commander">{comparisons.length?<div className="comparison-grid">{comparisons.map((row)=><div key={row.metric}><small>{row.metric}</small><strong>{row.metric==='Revenue'?money(row.current):row.current.toLocaleString()}</strong><span>Previous: {row.metric==='Revenue'?money(row.previous):row.previous.toLocaleString()}</span><b className={row.change!==null&&row.change<0?'negative':'positive'}>{row.change===null?'Baseline needed':`${row.change>=0?'↑':'↓'} ${Math.abs(row.change).toFixed(1)}%`}</b></div>)}{insights?.advancedForecast?.status==='available'&&<div><small>30-day predictive revenue</small><strong>{money(insights.advancedForecast.points.reduce((sum,row)=>sum+row.value,0))}</strong><span>Confidence range included</span><b className="positive">AI projection</b></div>}</div>:<RichEmpty icon={BarChart3} title="Building comparison data" message="Sync more sales to compare different time periods." progress={Math.min(60,insights?.salesHistoryDays??0)} goal="60 sales days" />}</Widget> }

export function CustomAIQuery({context,insights,onUpgrade}:{context:WorkspaceContext;insights:AnalyticsInsights|null;onUpgrade:()=>void}) { const [question,setQuestion]=useState(''); const [answer,setAnswer]=useState(''); const [asking,setAsking]=useState(false); if(!hasPlan(insights,'commander')) return <LockedWidget wide icon={Brain} title="Commander Copilot" eyebrow="AI Assistant" plan="Commander" message="Ask AI anything about your store data." onUpgrade={onUpgrade}/>; const ask=async(value=question)=>{if(!context.storeId||!value.trim())return;setQuestion(value);setAsking(true);try{const result=await queryAnalyticsInsights(context.storeId,value);setAnswer(result.text)}catch{setAnswer('AI is temporarily unavailable. Your dashboard data is still current.')}finally{setAsking(false)}}; const suggestions=['Which products should I promote this weekend?','Why did revenue change last period?','What is my strongest growth opportunity?']; return <Widget className="ai-query-widget" eyebrow="AI Assistant" title="Commander Copilot" badge={insights?.usage.limit===null?'Unlimited':`${insights?.usage.remaining??0} left today`}><div className="query-shell">{answer?<div className="analyst-answer"><span><Brain size={17}/></span><p>{answer}</p></div>:<div className="query-welcome"><Brain size={28}/><div><strong>Ask anything about your store</strong><p>AI uses only your store totals, never customer details.</p></div></div>}<div className="query-suggestions">{suggestions.map((item)=><Button key={item} onClick={()=>void ask(item)}>{item}</Button>)}</div><div className="query-input"><input value={question} onChange={(event)=>setQuestion(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter')void ask()}} placeholder="Ask about revenue, products, customers, or timing…"/><Button onClick={()=>void ask()} disabled={!question.trim()||asking}>{asking?<RefreshCw size={16} className="spin"/>:<Send size={16}/>}</Button></div></div></Widget> }

function Widget({eyebrow,title,badge,action,className='',children}:{eyebrow:string;title:string;badge?:ReactNode;action?:ReactNode;className?:string;children:ReactNode}) {
  return <article className={`analytics-widget ${className}`}><header className="widget-header"><div className="widget-title">{eyebrow ? <small>{eyebrow}</small> : null}<h2>{title}</h2></div>{action??(badge?<span className="widget-badge">{badge}</span>:null)}</header><div className="widget-body">{children}</div></article>
}
function LockedWidget({
  icon: Icon,
  title,
  eyebrow,
  plan,
  message,
  onUpgrade,
  wide = false,
}: {
  icon: typeof Activity
  title: string
  eyebrow: string
  plan: string
  message: string
  onUpgrade: () => void
  wide?: boolean
}) {
  return (
    <Widget className={`locked-widget ${wide ? 'wide' : ''}`} eyebrow={eyebrow} title={title}>
      <div className="locked-hero">
        <span>
          <Icon size={24} />
          <LockKeyhole size={12} />
        </span>
        <div>
          <b>{plan} feature</b>
          <p>{message}</p>
        </div>
        <Button type="button" onClick={onUpgrade}>
          Upgrade to unlock <ArrowUpRight size={13} />
        </Button>
      </div>
    </Widget>
  )
}
function LockedInline({
  plan,
  message,
  onUpgrade,
}: {
  plan: string
  message: string
  onUpgrade: () => void
}) {
  return (
    <div className="locked-inline">
      <span>
        <LockKeyhole size={17} />
      </span>
      <strong>{plan} insight</strong>
      <p>{message}</p>
      <Button type="button" onClick={onUpgrade}>
        Upgrade to unlock <ArrowUpRight size={12} />
      </Button>
    </div>
  )
}
function CardLabel({icon:Icon,text}:{icon:typeof Activity;text:string}) { return <div className="card-label"><span><Icon size={13}/></span><small>{text}</small></div> }
function RichEmpty({icon:Icon,title,message,progress,goal}:{icon:typeof Activity;title:string;message:string;progress:number;goal:string}) { return <div className="rich-empty"><span className="empty-visual"><Icon size={23}/><i/><i/><i/></span><strong>{title}</strong><p>{message}</p><div className="empty-progress"><span><i style={{width:`${Math.max(3,Math.min(100,progress/Math.max(1,parseInt(goal)||7)*100))}%`}}/></span><small>{progress?`${progress} collected · `:''}{goal}</small></div></div> }
function EducationalState({title,message,current,total}:{title:string;message:string;current:number;total:number}) { return <div className="educational-state"><strong>{title}</strong><p>{message}</p><Progress current={current} total={total}/></div> }
function Progress({current,total}:{current:number;total:number}) { const value=Math.min(total,current); return <div className="progress"><span><i style={{width:`${value/total*100}%`}}/></span><small>{value} of {total} days</small></div> }
function formatDateLabel(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const date = safeDate(value)
  if (!date) return String(value)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Small inline annotation for the real peak revenue day inside the chart. */
function PeakLabel({ value, x = 0 }: { value: string; x?: number }) {
  return <g className="rev-peak-label" transform={`translate(${x}, 14)`}><circle r={2.5} /><text x={6} y={-5}>{value}</text></g>
}

/** Pacing tooltip: that day's daily revenue (0 on no-sale days) plus the previous-period day. */
function PacingTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload?: { day: string; revenue: number; previous: number | null; forecast: number | null } }>; label?: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  const revenue = point.revenue
  const previous = point.previous
  const delta = previous !== null && previous > 0 ? ((revenue - previous) / previous) * 100 : null
  return (
    <div className="analytics-tooltip revenue-tooltip">
      <div className="tooltip-primary-value">
        <span>Revenue</span>
        <strong>{money(revenue)}</strong>
      </div>
      <time className="tooltip-date">{formatDateLabel(label ?? point.day)}</time>
      <div className="tooltip-metrics">
        {previous !== null && previous > 0 && (
          <div className="tooltip-row"><i style={{ background: 'rgb(100, 116, 139)' }} /><span>Previous period</span><strong>{money(previous)}</strong></div>
        )}
        {delta !== null && (
          <div className="tooltip-row"><i style={{ background: delta >= 0 ? 'rgb(52, 211, 153)' : 'rgb(251, 113, 133)' }} /><span>vs previous</span><strong className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</strong></div>
        )}
        {point.forecast !== null && (
          <div className="tooltip-row"><i style={{ background: 'rgb(167, 139, 250)' }} /><span>AI forecast day</span><strong>{money(point.forecast)}</strong></div>
        )}
      </div>
    </div>
  )
}

export function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number | null; color?: string; dataKey?: string; payload?: TrendPoint }>; label?: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const formattedDate = formatDateLabel(label ?? point?.day)
  const revenue = point?.revenue ?? Number(payload.find((p) => (p.dataKey === 'revenue' || p.name === 'Current'))?.value ?? 0)
  const orders = point?.orders ?? 0
  const previous = point?.previous ?? null
  const forecast = point?.forecast ?? null

  return (
    <div className="analytics-tooltip revenue-tooltip">
      <div className="tooltip-primary-value">
        <span>Revenue</span>
        <strong>{money(revenue)}</strong>
      </div>
      <time className="tooltip-date">{formattedDate}</time>
      <div className="tooltip-metrics">
        <div className="tooltip-row">
          <i style={{ background: 'rgb(37, 99, 235)' }} />
          <span>Orders</span>
          <strong>{orders}</strong>
        </div>
        {previous !== null && previous > 0 && (
          <div className="tooltip-row">
            <i style={{ background: 'rgb(100, 116, 139)' }} />
            <span>vs Previous</span>
            <strong>{money(previous)}</strong>
          </div>
        )}
        {forecast !== null && (
          <div className="tooltip-row">
            <i style={{ background: 'rgb(167, 139, 250)' }} />
            <span>AI Forecast</span>
            <strong>{money(forecast)}</strong>
          </div>
        )}
      </div>
    </div>
  )
}

function OrdersAovTooltip({ active, payload, label, average }: { active?: boolean; payload?: Array<{ name?: string; value?: number | null; color?: string; dataKey?: string; payload?: TrendPoint }>; label?: string; average?: number }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const formattedDate = formatDateLabel(label ?? point?.day)
  const orders = point?.orders ?? Number(payload.find((p) => p.dataKey === 'orders')?.value ?? 0)
  const aov = point?.aov ?? Number(payload.find((p) => p.dataKey === 'aov')?.value ?? 0)
  const revenue = point?.revenue ?? orders * aov
  const aovDelta = average && average > 0 && aov > 0 ? ((aov - average) / average) * 100 : null

  return (
    <div className="analytics-tooltip">
      <strong>{formattedDate}</strong>
      <div className="tooltip-metrics">
        <div className="tooltip-row">
          <i style={{ background: 'rgb(129, 140, 248)' }} />
          <span>Orders:</span>
          <strong>{orders}</strong>
        </div>
        <div className="tooltip-row">
          <i style={{ background: 'rgb(45, 212, 191)' }} />
          <span>AOV:</span>
          <strong>{money(aov)}</strong>
        </div>
        {revenue > 0 && (
          <div className="tooltip-row">
            <i style={{ background: 'rgb(56, 189, 248)' }} />
            <span>Revenue:</span>
            <strong>{money(revenue)}</strong>
          </div>
        )}
        {aovDelta !== null && (
          <div className="tooltip-row">
            <i style={{ background: 'rgb(45, 212, 191)' }} />
            <span>vs period avg:</span>
            <strong className={aovDelta >= 0 ? 'positive' : 'negative'}>{aovDelta >= 0 ? '+' : ''}{aovDelta.toFixed(0)}%</strong>
          </div>
        )}
      </div>
    </div>
  )
}
class Boundary extends Component<{label:string;children:ReactNode},{error:string|null}> { public state={error:null as string|null}; static getDerivedStateFromError(error:unknown){return{error:error instanceof Error?error.message:'Render error'}} componentDidCatch(error:unknown,info:ErrorInfo){console.error(`[analytics:${this.props.label}]`,error,info.componentStack)} render(){return this.state.error?<div className="section-fallback" role="alert"><AlertTriangle size={20}/><strong>{this.props.label} is taking a pause</strong><p>The rest of your analytics are still available.</p><Button onClick={()=>this.setState({error:null})}>Retry section</Button></div>:this.props.children} }
export const AnalyticsSectionBoundary = Boundary
function hasPlan(insights:AnalyticsInsights|null,required:'growth'|'commander'){return Boolean(insights&&PLAN_RANK[insights.plan]>=PLAN_RANK[required])}
function normalizeInsights(value:AnalyticsInsights|null|undefined):AnalyticsInsights|null { if(!value||typeof value!=='object')return null; return {...value,categories:Array.isArray(value.categories)?value.categories:[],topProducts:Array.isArray(value.topProducts)?value.topProducts:[],weekdays:Array.isArray(value.weekdays)?value.weekdays:[],peakHours:Array.isArray(value.peakHours)?value.peakHours:null,anomalies:Array.isArray(value.anomalies)?value.anomalies:value.anomalies===null?null:[],channels:Array.isArray(value.channels)?value.channels:[],geography:Array.isArray(value.geography)?value.geography:value.geography===null?null:[],cohorts:Array.isArray(value.cohorts)?value.cohorts:value.cohorts===null?null:[],comparisons:Array.isArray(value.comparisons)?value.comparisons:value.comparisons===null?null:[],opportunities:Array.isArray(value.opportunities)?value.opportunities:value.opportunities===null?null:[],locked:Array.isArray(value.locked)?value.locked:[],available:Array.isArray(value.available)?value.available:[],forecast:value.forecast??{status:'insufficient_data',message:'Connect your first sales days to begin forecasting.',points:[],standardDeviation:0}} }
function formatKpiValue(value: number, format: Kpi['format']): string { if (!Number.isFinite(value)) return '—'; if (format === 'money') return money(value); if (format === 'percent') return `${value.toFixed(1)}%`; return Math.round(value).toLocaleString() }
function formatKpi(kpi: Kpi) { if (kpi.value === null || !Number.isFinite(kpi.value)) return '—'; return formatKpiValue(kpi.value, kpi.format) }
const safe=(value:unknown)=>{const number=typeof value==='number'?value:Number(value);return Number.isFinite(number)?number:0}
const money=(value:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:Math.abs(value)>=1000?0:2}).format(safe(value))
const compactMoney=(value:number)=>`$${Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(safe(value))}`
// Accepts bare day keys, full ISO timestamps, null and undefined. Never throws.
const shortDay=(value:unknown)=>safeShortDay(value)
// Cohort keys are `YYYY-MM`. Render them as "Aug 2026" when parseable, else verbatim.
function cohortLabel(value:unknown):string{ if(typeof value!=='string'||!value.trim())return '—'; const raw=value.trim(); const date=/^\d{4}-\d{2}$/.test(raw)?safeDate(`${raw}-01`):safeDate(raw); return date?date.toLocaleDateString(undefined,{month:'short',year:'numeric',timeZone:'UTC'}):raw }
