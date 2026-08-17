import { Component, useEffect, useMemo, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Brain, CalendarDays, ChevronDown, ChevronUp, Clock3, Download, Globe2, Lightbulb, LineChart, LockKeyhole, MapPin, PackageSearch, RefreshCw, Send, ShoppingBag, Target, Trophy, Users, Wand2, Zap } from 'lucide-react'
import type { AnalyticsSnapshot, WorkspaceContext } from './model.js'
import { fetchAnalyticsInsights, fetchCustomers, queryAnalyticsInsights } from './api.js'
import { analyticsKpis, periodTrend } from './analytics-model.js'
import { safeAddDays, safeDate, safeDayKey, safeShortDay, todayDayKey } from './safe-date.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import type { AnalyticsInsights, AnalyticsPeriod, Kpi, TrendPoint } from './analytics-model.js'
import './analytics.css'

const COLORS = ['#38bdf8', '#8b5cf6', '#2dd4bf', '#f59e0b', '#ec4899', '#84cc16', '#06b6d4', '#f97316']
const PLAN_RANK = { trial: 0, start: 1, growth: 2, commander: 3 } as const

type PageProps = { context: WorkspaceContext; snapshot: AnalyticsSnapshot | null; onSync: (module: string) => Promise<void>; onNavigateBilling: () => void }
export function AnalyticsPage({ context, snapshot, onSync, onNavigateBilling }: PageProps) {
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null)
  const [customerCountFallback, setCustomerCountFallback] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [period, setPeriodValue] = useState<AnalyticsPeriod>(30)
  const [customRange, setCustomRange] = useState<Readonly<{ from: string; to: string }> | null>(null)
  const setPeriod = (value: AnalyticsPeriod) => { setCustomRange(null); setPeriodValue(value) }
  const refresh = () => {
    if (!context.storeId) { setInsights(null); setCustomerCountFallback(null); setLoading(false); return }
    setLoading(true)
    void fetchAnalyticsInsights(context.storeId)
      .then((value) => {
        const norm = normalizeInsights(value)
        setInsights(norm)
        if (!norm || norm.totalCustomers === null || norm.totalCustomers === undefined) {
          void fetchCustomers(context.storeId, { limit: 1 })
            .then((res) => {
              const count = res.stats?.total ?? res.pagination?.total ?? (res.customers?.length || null)
              if (count !== null && count !== undefined) setCustomerCountFallback(count)
            })
            .catch(() => {})
        }
      })
      .catch(() => {
        setInsights(null)
        void fetchCustomers(context.storeId, { limit: 1 })
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
    const points = periodTrend(snapshot, customRange ? 365 : period, insights?.forecast ?? null)
    return customRange ? points.filter((point) => point.day >= customRange.from && point.day <= customRange.to) : points
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
      <Boundary label="sales channels"><SalesByChannel channels={insights?.channels ?? []} /></Boundary>
      <Boundary label="category distribution"><CategoryDistribution categories={insights?.categories ?? []} /></Boundary>
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
      <div className="date-range-control"><div className="period-toggle" aria-label="Date range">{([7, 30, 90, 365] as const).map((days) => <button className={!customRange && period === days ? 'active' : ''} onClick={() => setPeriod(days)} key={days}>{days === 365 ? '1y' : `${days}d`}</button>)}<button className={customRange ? 'active' : ''} onClick={() => setCustomOpen((value) => !value)}>Custom</button></div>{customOpen && <div className="custom-range-popover"><label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label><button onClick={() => { if (from && to && from <= to) { onCustomRange({ from, to }); setCustomOpen(false) } }}>Apply range</button></div>}</div>
      <button className="analytics-tool-button" onClick={exportCsv} disabled={!snapshot?.revenue.length}><Download size={14} /> Export</button>
      <button className="analytics-tool-button primary" onClick={() => void onSync()} disabled={syncing}><RefreshCw size={14} className={syncing ? 'spin' : ''} /> Refresh</button>
    </div>
  </header>
}

export function AnalyticsHero({ kpis, loading }: { kpis: readonly Kpi[]; loading: boolean }) { return <section className="analytics-kpis">{kpis.map((kpi, index) => <KpiCard key={kpi.label} kpi={kpi} index={index} loading={loading} />)}</section> }
function KpiCard({ kpi, index, loading }: { kpi: Kpi; index: number; loading: boolean }) {
  const data = kpi.sparkline.filter(Number.isFinite).map((value, point) => ({ point, value }))
  const icons = [BarChart3, ShoppingBag, Target, Activity, Users, Zap]; const Icon = icons[index] ?? Activity
  if (loading) return <article className="analytics-kpi skeleton-card"><div className="skeleton-line short" /><div className="skeleton-line value" /><div className="skeleton-line" /></article>
  const toneColor = COLORS[index % COLORS.length] ?? '#38bdf8'
  const isFlat = data.length >= 2 && data.every((d) => d.value === data[0]?.value)
  const chartData = data.map((d, i) => ({
    ...d,
    plotValue: isFlat ? d.value * (1 + (i % 2 === 0 ? -0.04 : 0.04)) : d.value,
  }))
  return <article className={`analytics-kpi tone-${index}`}>
    <header>
      <span className="kpi-icon"><Icon size={14} /></span>
      <small>{kpi.label}</small>
      {kpi.change !== null && <b className={kpi.change >= 0 ? 'positive' : 'negative'}>{kpi.change >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(kpi.change).toFixed(1)}%</b>}
    </header>
    <strong>{formatKpi(kpi)}</strong>
    <p>{kpi.detail}</p>
    <div className="sparkline">
      {data.length >= 2 ? (
        <ResponsiveContainer width="100%" height={36} minWidth={0} minHeight={0}>
          <ComposedChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <defs>
              <linearGradient id={`kpi-grad-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={toneColor} stopOpacity={0.4} />
                <stop offset="100%" stopColor={toneColor} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <YAxis domain={['dataMin - 1', 'dataMax + 1']} hide />
            <Area
              type="monotone"
              dataKey="plotValue"
              stroke={toneColor}
              strokeWidth={2}
              fill={`url(#kpi-grad-${index})`}
              isAnimationActive={true}
              animationDuration={500}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="sparkline-guide"><i /><i /><i /></div>
      )}
    </div>
  </article>
}

export function RevenueTrendChart({ trend, period, setPeriod }: { trend: readonly TrendPoint[]; period: AnalyticsPeriod; setPeriod: (period: AnalyticsPeriod) => void }) {
  const real = trend.some((row) => row.revenue > 0); const now = trend.filter((row) => row.forecast === null).reduce((sum, row) => sum + row.revenue, 0); const before = trend.reduce((sum, row) => sum + (row.previous ?? 0), 0); const growth = before > 0 ? (now - before) / before * 100 : null
  return <Widget className="revenue-trend" eyebrow="Revenue Analysis" title="Revenue momentum" action={<div className="period-toggle compact">{([7, 30, 90, 365] as const).map((value) => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{value === 365 ? '1y' : `${value}d`}</button>)}</div>}>
    {real ? <><div className="chart-large"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><ComposedChart data={[...trend]} margin={{ top: 12, right: 12, left: -12 }}><defs><linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity=".38"/><stop offset="1" stopColor="#38bdf8" stopOpacity="0"/></linearGradient><linearGradient id="confidence" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b5cf6" stopOpacity=".22"/><stop offset="1" stopColor="#8b5cf6" stopOpacity=".02"/></linearGradient></defs><CartesianGrid stroke="rgba(148,163,184,.09)" strokeDasharray="3 7" vertical={false}/><XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill:'#728197', fontSize:9 }} axisLine={false} tickLine={false} minTickGap={32}/><YAxis tickFormatter={compactMoney} tick={{ fill:'#728197', fontSize:9 }} axisLine={false} tickLine={false}/><Tooltip content={<RevenueTooltip/>}/><Bar dataKey="revenue" fill="#38bdf8" opacity={.09} barSize={12}/><Area type="monotone" dataKey="revenue" fill="url(#revFill)" stroke="none"/><Line type="monotone" dataKey="previous" name="Previous" stroke="#64748b" strokeDasharray="5 6" dot={false}/><Area type="monotone" dataKey="upper" fill="url(#confidence)" stroke="none"/><Line type="monotone" dataKey="revenue" name="Current" stroke="#38bdf8" strokeWidth={2.8} dot={{r:2,fill:'#dbeafe'}}/><Line type="monotone" dataKey="forecast" name="AI forecast" stroke="#a78bfa" strokeWidth={2} strokeDasharray="5 5" dot={false}/></ComposedChart></ResponsiveContainer></div><div className="chart-caption"><span><i className="legend current"/>Current</span><span><i className="legend previous"/>Previous</span><span><i className="legend forecast"/>AI forecast</span><b className={growth !== null && growth < 0 ? 'negative' : 'positive'}>{growth === null ? 'Baseline building' : `${growth >= 0 ? '↗' : '↘'} ${Math.abs(growth).toFixed(1)}% period change`}</b></div></> : <RichEmpty icon={LineChart} title="Your revenue story starts here" message="Sync your first orders to turn this canvas into a current-vs-previous revenue narrative." progress={0} goal="First revenue day" />}
  </Widget>
}

export function OrdersAOVCorrelation({ trend }: { trend: readonly TrendPoint[] }) {
  const real = trend.some((row) => row.orders > 0)
  const orders = trend.reduce((sum, row) => sum + row.orders, 0)
  const avg = orders ? trend.reduce((sum, row) => sum + row.revenue, 0) / orders : 0
  return <Widget eyebrow="Volume & Value" title="Orders & AOV correlation" badge={real ? `${orders} orders` : undefined}>
    {real ? <><div className="chart-large"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><ComposedChart data={trend.filter((row) => row.forecast === null)} margin={{ top: 12, right: 0, left: -20 }}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false}/><XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: '#728197', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={30}/><YAxis yAxisId="orders" tick={{ fill: '#728197', fontSize: 9 }} axisLine={false} tickLine={false}/><YAxis yAxisId="aov" orientation="right" tickFormatter={compactMoney} tick={{ fill: '#728197', fontSize: 9 }} axisLine={false} tickLine={false}/><Tooltip content={<OrdersAovTooltip />} /><Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#818cf8" radius={[4, 4, 0, 0]}/><Line yAxisId="aov" type="monotone" dataKey="aov" name="AOV" stroke="#2dd4bf" strokeWidth={2.4} dot={false}/></ComposedChart></ResponsiveContainer></div><div className="insight-strip"><Brain size={14}/><span>Your average order value is <b>{money(avg)}</b>. Higher AOV means customers buy more per order.</span></div></> : <RichEmpty icon={ShoppingBag} title="See value and volume together" message="Order bars and AOV will reveal whether growth comes from more buyers or larger baskets." progress={0} goal="Sync an order" />}
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
                {categories.map((row, index) => <Cell key={row.name} fill={COLORS[index % COLORS.length] ?? '#38bdf8'} />)}
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
        <button className="icon-button" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse AI intelligence' : 'Expand AI intelligence'}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
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
                    <Area type="monotone" dataKey="upper" fill="#8b5cf6" fillOpacity={0.12} stroke="none" />
                    <Line type="monotone" dataKey="revenue" stroke="#38bdf8" dot={false} />
                    <Line type="monotone" dataKey="forecast" stroke="#a78bfa" strokeDasharray="4 4" dot={false} />
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

export function GeographicDistribution({insights,onUpgrade}:{insights:AnalyticsInsights|null;onUpgrade:()=>void}) { if(!hasPlan(insights,'growth')) return <LockedWidget icon={Globe2} title="Geographic distribution" eyebrow="Geographic Sales" plan="Growth" message="See where your sales come from." onUpgrade={onUpgrade}/>; const geo=insights?.geography??[]; return <Widget eyebrow="Geographic Sales" title="Geographic distribution" badge={geo.length?`${geo.length} markets`:undefined}>{geo.length?<div className="geo-layout"><div className="geo-orb"><Globe2 size={80}/><span className="geo-ping p1"/><span className="geo-ping p2"/><span className="geo-ping p3"/></div><div className="geo-list">{geo.slice(0,6).map((row,index)=><div key={row.country}><b>{index+1}</b><span><strong>{row.country}</strong><small>{row.orders} orders · {row.share.toFixed(1)}%</small></span><em>{money(row.revenue)}</em></div>)}</div></div>:<RichEmpty icon={MapPin} title="Building your geographic sales map" message="Sync orders with shipping addresses to see where your customers are." progress={0} goal="Sync orders with addresses" />}</Widget> }

export function ProductPerformance({insights,onUpgrade}:{insights:AnalyticsInsights|null;onUpgrade:()=>void}) { const products=insights?.topProducts??[]; return <section className="product-performance"><Widget className="products-table-card" eyebrow="Top Products" title="Top products by revenue" badge={products.length?`Top ${Math.min(15,products.length)}`:undefined}>{products.length?<div className="products-scroll"><table><thead><tr><th>Rank</th><th>Product</th><th>Category</th><th>Units</th><th>Revenue</th><th>Share</th><th>Momentum</th></tr></thead><tbody>{products.map((product,index)=><tr key={product.productId}><td><b className={index<3?'rank':''}>{index+1}</b></td><td><div className="product-cell">{product.image?<img src={product.image} alt=""/>:<span>{product.name.slice(0,1)}</span>}<strong>{product.name}</strong></div></td><td>{product.category??'Uncategorized'}</td><td>{product.units.toLocaleString()}</td><td><strong>{money(product.revenue)}</strong></td><td>{product.share.toFixed(1)}%</td><td className={product.trend}>{product.trend==='up'?<ArrowUpRight size={15}/>:product.trend==='down'?<ArrowDownRight size={15}/>:<Activity size={14}/>} {product.growth!=null?`${Math.abs(product.growth).toFixed(0)}%`:'Building'}</td></tr>)}</tbody></table></div>:<RichEmpty icon={PackageSearch} title="Top products will appear here" message="Sync product sales to see your bestsellers ranked by revenue and units." progress={0} goal="Sync orders to build product rankings" />}</Widget><Widget className="product-insights" eyebrow="Product Insights" title="Product insights">{!hasPlan(insights,'growth')?<LockedInline plan="Growth" message="Discover trending products and categories." onUpgrade={onUpgrade}/>:products.length?<div className="merch-list"><MerchSignal icon={ArrowUpRight} tone="green" label="Rising star" value={products.find((p)=>p.trend==='up')?.name??'No rising product yet'} /><MerchSignal icon={ArrowDownRight} tone="red" label="Needs attention" value={products.find((p)=>p.trend==='down')?.name??'No decline detected'} /><MerchSignal icon={Trophy} tone="amber" label="Revenue leader" value={products[0]?.name??'Building'} /></div>:<EducationalState title="Building product insights" message="Sync more sales to see trending products." current={insights?.salesHistoryDays??0} total={14}/>}</Widget></section> }
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
              <XAxis dataKey="day" tick={{ fill: '#8090a5', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compactMoney} tick={{ fill: '#8090a5', fontSize: 8 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => money(safe(value))} />
              <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                {weekdays.map((row) => <Cell key={row.day} fill={row.day === best?.day ? '#38bdf8' : 'rgba(56,189,248,.22)'} />)}
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

export function ConversionFunnel({insights,onUpgrade}:{insights:AnalyticsInsights|null;onUpgrade:()=>void}) { if(!hasPlan(insights,'growth')) return <LockedWidget wide icon={Target} title="Conversion funnel" eyebrow="Conversion Journey" plan="Growth" message="See how visitors move from browsing to buying." onUpgrade={onUpgrade}/>; const funnel=insights?.funnel; return <Widget eyebrow="Conversion Journey" title="Conversion funnel" action={<span className="scope-pill"><Activity size={12}/> Order-based view</span>}><div className="funnel-layout"><div className="funnel-bars">{(funnel?.stages??[]).map((stage,index)=><div className={stage.value===null?'unavailable':''} style={{width:`${100-index*10}%`}} key={stage.name}><span>{stage.name}</span><strong>{stage.value===null?'Connect Shopify Analytics':stage.value.toLocaleString()}</strong></div>)}</div><div className="funnel-note"><Target size={22}/><div><strong>Order data is ready. Connect Shopify Analytics to track visitors.</strong><p>{funnel?.message??'Connect Shopify Analytics to track visitors and product views.'}</p><button className="text-button">View connection roadmap →</button></div></div></div></Widget> }

export function Benchmarks({insights,onUpgrade}:{insights:AnalyticsInsights|null;onUpgrade:()=>void}) { if(!hasPlan(insights,'commander')) return <LockedWidget wide icon={BarChart3} title="Benchmarks & advanced comparisons" eyebrow="Executive Overview" plan="Commander" message="Compare your performance across different time periods." onUpgrade={onUpgrade}/>; const comparisons=insights?.comparisons??[]; return <Widget eyebrow="Executive Overview" title="Benchmarks & advanced comparisons" badge="Commander">{comparisons.length?<div className="comparison-grid">{comparisons.map((row)=><div key={row.metric}><small>{row.metric}</small><strong>{row.metric==='Revenue'?money(row.current):row.current.toLocaleString()}</strong><span>Previous: {row.metric==='Revenue'?money(row.previous):row.previous.toLocaleString()}</span><b className={row.change!==null&&row.change<0?'negative':'positive'}>{row.change===null?'Baseline needed':`${row.change>=0?'↑':'↓'} ${Math.abs(row.change).toFixed(1)}%`}</b></div>)}{insights?.advancedForecast?.status==='available'&&<div><small>30-day predictive revenue</small><strong>{money(insights.advancedForecast.points.reduce((sum,row)=>sum+row.value,0))}</strong><span>Confidence range included</span><b className="positive">AI projection</b></div>}<div className="benchmark-pending"><Globe2 size={18}/><p><strong>Industry comparison</strong><small>Available when industry data is connected.</small></p></div></div>:<RichEmpty icon={BarChart3} title="Building comparison data" message="Sync more sales to compare different time periods." progress={Math.min(60,insights?.salesHistoryDays??0)} goal="60 sales days" />}</Widget> }

export function CustomAIQuery({context,insights,onUpgrade}:{context:WorkspaceContext;insights:AnalyticsInsights|null;onUpgrade:()=>void}) { const [question,setQuestion]=useState(''); const [answer,setAnswer]=useState(''); const [asking,setAsking]=useState(false); if(!hasPlan(insights,'commander')) return <LockedWidget wide icon={Brain} title="Ask your AI business analyst" eyebrow="AI Assistant" plan="Commander" message="Ask AI anything about your store data." onUpgrade={onUpgrade}/>; const ask=async(value=question)=>{if(!context.storeId||!value.trim())return;setQuestion(value);setAsking(true);try{const result=await queryAnalyticsInsights(context.storeId,value);setAnswer(result.text)}catch{setAnswer('AI is temporarily unavailable. Your dashboard data is still current.')}finally{setAsking(false)}}; const suggestions=['Which products should I promote this weekend?','Why did revenue change last period?','What is my strongest growth opportunity?']; return <Widget className="ai-query-widget" eyebrow="AI Assistant" title="Ask your AI business analyst" badge={insights?.usage.limit===null?'Unlimited':`${insights?.usage.remaining??0} left today`}><div className="query-shell">{answer?<div className="analyst-answer"><span><Brain size={17}/></span><p>{answer}</p></div>:<div className="query-welcome"><Brain size={28}/><div><strong>Ask anything about your store</strong><p>AI uses only your store totals, never customer details.</p></div></div>}<div className="query-suggestions">{suggestions.map((item)=><button key={item} onClick={()=>void ask(item)}>{item}</button>)}</div><div className="query-input"><input value={question} onChange={(event)=>setQuestion(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter')void ask()}} placeholder="Ask about revenue, products, customers, or timing…"/><button onClick={()=>void ask()} disabled={!question.trim()||asking}>{asking?<RefreshCw size={16} className="spin"/>:<Send size={16}/>}</button></div></div></Widget> }

function Widget({eyebrow,title,badge,action,className='',children}:{eyebrow:string;title:string;badge?:ReactNode;action?:ReactNode;className?:string;children:ReactNode}) {
  return <article className={`analytics-widget ${className}`}><header className="widget-header"><div className="widget-title">{eyebrow ? <small>{eyebrow}</small> : null}<h2>{title}</h2></div>{action??(badge?<span className="widget-badge">{badge}</span>:null)}</header><div className="widget-body">{children}</div></article>
}
function LockedWidget({
  icon: Icon,
  title,
  eyebrow,
  plan: _plan,
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
          <b>Premium feature</b>
          <p>{message}</p>
        </div>
        <button onClick={onUpgrade}>
          Upgrade to unlock <ArrowUpRight size={13} />
        </button>
      </div>
    </Widget>
  )
}
function LockedInline({
  plan: _plan,
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
      <strong>Premium insight</strong>
      <p>{message}</p>
      <button onClick={onUpgrade}>
        Upgrade to unlock <ArrowUpRight size={12} />
      </button>
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

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number | null; color?: string; dataKey?: string; payload?: TrendPoint }>; label?: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const formattedDate = formatDateLabel(label ?? point?.day)
  const revenue = point?.revenue ?? Number(payload.find((p) => (p.dataKey === 'revenue' || p.name === 'Current'))?.value ?? 0)
  const previous = point?.previous ?? null
  const forecast = point?.forecast ?? null

  return (
    <div className="analytics-tooltip">
      <strong>{formattedDate}</strong>
      <div className="tooltip-metrics">
        <div className="tooltip-row">
          <i style={{ background: '#38bdf8' }} />
          <span>Revenue:</span>
          <strong>{money(revenue)}</strong>
        </div>
        {previous !== null && previous > 0 && (
          <div className="tooltip-row">
            <i style={{ background: '#64748b' }} />
            <span>vs Previous:</span>
            <strong>{money(previous)}</strong>
          </div>
        )}
        {forecast !== null && (
          <div className="tooltip-row">
            <i style={{ background: '#a78bfa' }} />
            <span>AI Forecast:</span>
            <strong>{money(forecast)}</strong>
          </div>
        )}
      </div>
    </div>
  )
}

function OrdersAovTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number | null; color?: string; dataKey?: string; payload?: TrendPoint }>; label?: string }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const formattedDate = formatDateLabel(label ?? point?.day)
  const orders = point?.orders ?? Number(payload.find((p) => p.dataKey === 'orders')?.value ?? 0)
  const aov = point?.aov ?? Number(payload.find((p) => p.dataKey === 'aov')?.value ?? 0)
  const revenue = point?.revenue ?? orders * aov

  return (
    <div className="analytics-tooltip">
      <strong>{formattedDate}</strong>
      <div className="tooltip-metrics">
        <div className="tooltip-row">
          <i style={{ background: '#818cf8' }} />
          <span>Orders:</span>
          <strong>{orders}</strong>
        </div>
        <div className="tooltip-row">
          <i style={{ background: '#2dd4bf' }} />
          <span>AOV:</span>
          <strong>{money(aov)}</strong>
        </div>
        {revenue > 0 && (
          <div className="tooltip-row">
            <i style={{ background: '#38bdf8' }} />
            <span>Revenue:</span>
            <strong>{money(revenue)}</strong>
          </div>
        )}
      </div>
    </div>
  )
}
class Boundary extends Component<{label:string;children:ReactNode},{error:string|null}> { public state={error:null as string|null}; static getDerivedStateFromError(error:unknown){return{error:error instanceof Error?error.message:'Render error'}} componentDidCatch(error:unknown,info:ErrorInfo){console.error(`[analytics:${this.props.label}]`,error,info.componentStack)} render(){return this.state.error?<div className="section-fallback" role="alert"><AlertTriangle size={20}/><strong>{this.props.label} is taking a pause</strong><p>The rest of your analytics are still available.</p><button onClick={()=>this.setState({error:null})}>Retry section</button></div>:this.props.children} }
export const AnalyticsSectionBoundary = Boundary
function hasPlan(insights:AnalyticsInsights|null,required:'growth'|'commander'){return Boolean(insights&&PLAN_RANK[insights.plan]>=PLAN_RANK[required])}
function normalizeInsights(value:AnalyticsInsights|null|undefined):AnalyticsInsights|null { if(!value||typeof value!=='object')return null; return {...value,categories:Array.isArray(value.categories)?value.categories:[],topProducts:Array.isArray(value.topProducts)?value.topProducts:[],weekdays:Array.isArray(value.weekdays)?value.weekdays:[],peakHours:Array.isArray(value.peakHours)?value.peakHours:null,anomalies:Array.isArray(value.anomalies)?value.anomalies:value.anomalies===null?null:[],channels:Array.isArray(value.channels)?value.channels:[],geography:Array.isArray(value.geography)?value.geography:value.geography===null?null:[],cohorts:Array.isArray(value.cohorts)?value.cohorts:value.cohorts===null?null:[],comparisons:Array.isArray(value.comparisons)?value.comparisons:value.comparisons===null?null:[],opportunities:Array.isArray(value.opportunities)?value.opportunities:value.opportunities===null?null:[],locked:Array.isArray(value.locked)?value.locked:[],available:Array.isArray(value.available)?value.available:[],forecast:value.forecast??{status:'insufficient_data',message:'Connect your first sales days to begin forecasting.',points:[],standardDeviation:0}} }
function formatKpi(kpi:Kpi){if(kpi.value===null||!Number.isFinite(kpi.value))return '—';if(kpi.format==='money')return money(kpi.value);if(kpi.format==='percent')return `${kpi.value.toFixed(1)}%`;return Math.round(kpi.value).toLocaleString()}
const safe=(value:unknown)=>{const number=typeof value==='number'?value:Number(value);return Number.isFinite(number)?number:0}
const money=(value:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:Math.abs(value)>=1000?0:2}).format(safe(value))
const compactMoney=(value:number)=>`$${Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(safe(value))}`
// Accepts bare day keys, full ISO timestamps, null and undefined. Never throws.
const shortDay=(value:unknown)=>safeShortDay(value)
// Cohort keys are `YYYY-MM`. Render them as "Aug 2026" when parseable, else verbatim.
function cohortLabel(value:unknown):string{ if(typeof value!=='string'||!value.trim())return '—'; const raw=value.trim(); const date=/^\d{4}-\d{2}$/.test(raw)?safeDate(`${raw}-01`):safeDate(raw); return date?date.toLocaleDateString(undefined,{month:'short',year:'numeric',timeZone:'UTC'}):raw }
