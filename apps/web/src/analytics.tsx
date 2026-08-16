import { Component, useEffect, useMemo, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Clock3, LockKeyhole, RefreshCw, Send, Sparkles, Trophy } from 'lucide-react'
import type { AnalyticsSnapshot, WorkspaceContext } from './model.js'
import { fetchAnalyticsInsights, queryAnalyticsInsights } from './api.js'
import { analyticsKpis, periodTrend } from './analytics-model.js'
import type { AnalyticsInsights, AnalyticsPeriod } from './analytics-model.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'

const COLORS = ['#3b82f6', '#8b5cf6', '#14b8a6', '#f59e0b', '#ec4899', '#22c55e', '#06b6d4', '#f97316']
const FEATURE_NAMES: Readonly<Record<string, string>> = {
  anomaly_detection: 'Anomaly Detection',
  product_trends: 'Product Performance Trends',
  customer_segments: 'Customer Segment Analysis',
  natural_language_insight: 'AI Natural Language Insight',
  period_comparisons: 'Period Comparisons',
  geographic_distribution: 'Geographic Distribution',
  predictive_revenue: 'Predictive Revenue (Advanced)',
  cohort_analysis: 'Cohort Analysis',
  growth_opportunities: 'Growth Opportunity Detection',
  custom_ai_queries: 'Custom AI Analytics Queries',
  executive_report: 'Executive AI Report',
}

export function AnalyticsPage({ context, snapshot, onSync, onNavigateBilling }: {
  context: WorkspaceContext
  snapshot: AnalyticsSnapshot | null
  onSync: (module: string) => Promise<void>
  onNavigateBilling: () => void
}) {
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState<AnalyticsPeriod>(30)
  const [open, setOpen] = useState(true)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)

  const refresh = () => {
    if (!context.storeId) {
      setInsights(null)
      return
    }
    setLoading(true)
    void fetchAnalyticsInsights(context.storeId)
      .then((result) => setInsights(normalizeInsights(result)))
      .catch(() => setInsights(null))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [context.storeId])

  const trend = useMemo(
    () => periodTrend(snapshot, period, insights?.forecast ?? null),
    [snapshot, period, insights],
  )
  const kpis = useMemo(
    () => analyticsKpis(snapshot, insights?.totalCustomers ?? null),
    [snapshot, insights],
  )
  const categories = insights?.categories ?? []
  const topProducts = insights?.topProducts ?? []
  const weekdays = insights?.weekdays ?? []
  const peakHours = Array.isArray(insights?.peakHours) && insights.peakHours.length > 0 ? insights.peakHours : null
  const totalCategory = categories.reduce((sum, row) => sum + safeNumber(row.revenue), 0)
  const peakDay = bestDay(weekdays)

  const ask = async () => {
    if (!context.storeId || !question.trim()) return
    setAsking(true)
    try {
      const result = await queryAnalyticsInsights(context.storeId, question)
      setAnswer(result.text)
    } catch {
      setAnswer('Unable to answer right now. Try again in a moment.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <main className="analytics-page">
      <header className="analytics-page-header">
        <div>
          <div className="section-kicker"><span className="kicker-dot blue" /> STORE PERFORMANCE</div>
          <h1>Analytics</h1>
          <p>AI-powered insights into your store performance</p>
        </div>
        <button className="button primary" onClick={() => void onSync('orders')}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh data
        </button>
      </header>

      <AnalyticsSectionBoundary label="KPI cards">
        <section className="analytics-kpis">
          {kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
        </section>
      </AnalyticsSectionBoundary>

      <section className="analytics-deep-dive">
        <AnalyticsSectionBoundary label="Revenue trend">
          <article className="analytics-card revenue-trend">
            <header>
              <div><span>Revenue deep dive</span><h2>Revenue Trend</h2></div>
              <div className="period-toggle">
                {([7, 30, 90, 365] as const).map((days) => (
                  <button className={period === days ? 'active' : ''} onClick={() => setPeriod(days)} key={days}>
                    {days === 365 ? '1y' : `${days}d`}
                  </button>
                ))}
              </div>
            </header>
            {trend.length > 0 ? (
              <div className="chart-large">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <ComposedChart data={[...trend]} margin={{ top: 12, right: 14, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#3b82f6" stopOpacity=".4" />
                        <stop offset="1" stopColor="#3b82f6" stopOpacity=".02" />
                      </linearGradient>
                      <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#8b5cf6" stopOpacity=".22" />
                        <stop offset="1" stopColor="#8b5cf6" stopOpacity=".01" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(148,163,184,.11)" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: '#718096', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={28} />
                    <YAxis tickFormatter={compactMoney} tick={{ fill: '#718096', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<RevenueTooltip />} />
                    <Bar dataKey="revenue" fill="#3b82f6" opacity={.13} radius={[3, 3, 0, 0]} barSize={12} />
                    <Area type="monotone" dataKey="revenue" fill="url(#revenueFill)" stroke="none" isAnimationActive={false} />
                    <Line type="monotone" dataKey="previous" name="Previous period" stroke="#64748b" strokeDasharray="4 5" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                    <Area type="monotone" dataKey="forecast" fill="url(#forecastFill)" stroke="none" connectNulls={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#60a5fa" strokeWidth={2.7} dot={{ r: 2.5, fill: '#bfdbfe', stroke: '#3b82f6', strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="forecast" name="Basic forecast" stroke="#a78bfa" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty message="Sync orders to see your revenue trend." />
            )}
            <footer>
              <span><i className="legend-line actual" /> Actual</span>
              <span><i className="legend-line previous" /> Previous period</span>
              <span><i className="legend-line forecast" /> Basic forecast</span>
              {insights?.forecast?.status === 'insufficient_data' && <small>{insights.forecast.message}</small>}
            </footer>
          </article>
        </AnalyticsSectionBoundary>

        <AnalyticsSectionBoundary label="Sales by category">
          <article className="analytics-card category-card">
            <header><div><span>Revenue mix</span><h2>Sales by Category</h2></div></header>
            <CategorySection categories={categories} totalCategory={totalCategory} />
          </article>
        </AnalyticsSectionBoundary>
      </section>

      <AnalyticsSectionBoundary label="AI analytics">
        <section className={`analytics-card ai-analytics ${open ? '' : 'collapsed'}`}>
          <header>
            <div className="ai-title">
              <span><Sparkles size={18} /></span>
              <div>
                <small>SMART SIGNALS</small>
                <h2>AI Analytics Intelligence</h2>
                <p>Forecasts and store signals grounded in your synced sales.</p>
              </div>
            </div>
            <div className="ai-actions">
              {insights && <UpgradePlanButton plan={insights.plan} onUpgrade={onNavigateBilling} />}
              <button onClick={() => setOpen((value) => !value)} aria-label={open ? 'Collapse AI analytics' : 'Expand AI analytics'}>
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
          </header>
          {open && (
            <div className="ai-body">
              <div className="ai-feature-grid">
                <article className="ai-feature basic">
                  <span><ArrowUpRight size={16} /></span>
                  <div>
                    <small>AVAILABLE ON EVERY PLAN</small>
                    <h3>AI Sales Forecast</h3>
                    <p>{insights?.forecast?.message ?? 'Loading forecast…'}</p>
                    <em>Basic forecast · upgrade for advanced AI</em>
                  </div>
                </article>
                <AnomalyCard insights={insights} />
                {Object.entries(FEATURE_NAMES)
                  .filter(([feature]) => feature !== 'anomaly_detection')
                  .map(([feature, title]) => (
                    <FeatureCard key={feature} feature={feature} title={title} insights={insights} onUpgrade={onNavigateBilling} />
                  ))}
              </div>
              {insights?.plan === 'commander' && (
                <div className="analytics-query">
                  <div>
                    <Sparkles size={15} />
                    <span>
                      <strong>Ask your analytics</strong>
                      <small>Only aggregate, non-identifying store facts are sent.</small>
                    </span>
                  </div>
                  <div>
                    <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What changed in my sales?" />
                    <button onClick={() => void ask()} disabled={!question.trim() || asking}>
                      {asking ? <RefreshCw className="spin" size={14} /> : <Send size={14} />}
                    </button>
                  </div>
                  {answer && <p>{answer}</p>}
                </div>
              )}
            </div>
          )}
        </section>
      </AnalyticsSectionBoundary>

      <AnalyticsSectionBoundary label="Top products">
        <section className="analytics-card top-products">
          <header><div><span>Revenue leaders</span><h2>Top Products by Revenue</h2></div></header>
          {topProducts.length > 0 ? (
            <div className="top-products-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Product</th>
                    <th>Units sold</th>
                    <th>Revenue</th>
                    <th>% of total</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((product, index) => {
                    const name = product.name?.trim() || product.productId || 'Product'
                    const share = Number.isFinite(product.share) ? product.share : 0
                    return (
                      <tr key={product.productId || `${name}-${index}`}>
                        <td><b className={index < 3 ? 'top-rank' : ''}>{index + 1}</b></td>
                        <td>
                          <div className="product-cell">
                            {product.image ? <img src={product.image} alt="" /> : <span>{name.slice(0, 1)}</span>}
                            <strong>{name}</strong>
                          </div>
                        </td>
                        <td>{safeNumber(product.units).toLocaleString()}</td>
                        <td><strong>{money(safeNumber(product.revenue))}</strong></td>
                        <td>{share.toFixed(1)}%</td>
                        <td className={product.trend}>
                          {product.trend === 'up' ? <ArrowUpRight size={15} /> : product.trend === 'down' ? <ArrowDownRight size={15} /> : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty message="Top products appear after product sales are synced." />
          )}
        </section>
      </AnalyticsSectionBoundary>

      <section className="patterns-grid">
        <AnalyticsSectionBoundary label="Best performing day">
          <article className="analytics-card pattern-card">
            <header>
              <div><span>Weekly rhythm</span><h2>Best Performing Day</h2></div>
              {peakDay && peakDay.revenue > 0 && <b><Trophy size={13} />{peakDay.day}</b>}
            </header>
            {weekdays.some((row) => safeNumber(row.revenue) > 0) ? (
              <div className="weekday-chart">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={[...weekdays]}>
                    <CartesianGrid stroke="rgba(148,163,184,.09)" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: '#718096', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={compactMoney} tick={{ fill: '#718096', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => money(safeNumber(value))} />
                    <Bar dataKey="revenue" radius={[5, 5, 0, 0]} isAnimationActive={false}>
                      {weekdays.map((row) => (
                        <Cell key={row.day} fill={row.day === peakDay?.day ? '#60a5fa' : 'rgba(59,130,246,.3)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty message="Awaiting daily sales history." />
            )}
          </article>
        </AnalyticsSectionBoundary>

        <AnalyticsSectionBoundary label="Peak sales hours">
          <article className="analytics-card pattern-card">
            <header>
              <div><span>Shopping rhythm</span><h2>Peak Sales Hours</h2></div>
              <Clock3 size={17} />
            </header>
            {peakHours ? (
              <div className="hour-chart">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={[...peakHours]}>
                    <XAxis dataKey="hour" tickFormatter={(hour) => `${hour}:00`} tick={{ fill: '#718096', fontSize: 8 }} interval={3} axisLine={false} />
                    <Tooltip labelFormatter={(hour) => `${hour}:00–${Number(hour) + 1}:00`} />
                    <Bar dataKey="orders" fill="#8b5cf6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty message="Awaiting order-level timestamps." />
            )}
          </article>
        </AnalyticsSectionBoundary>
      </section>
    </main>
  )
}

function CategorySection({ categories, totalCategory }: {
  categories: readonly Readonly<{ name: string; revenue: number; units: number }>[]
  totalCategory: number
}) {
  if (categories.length === 0) {
    return <Empty message="Product categories appear after product sales are synced." />
  }

  if (categories.length === 1) {
    const only = categories[0]!
    const name = only.name?.trim() || 'Uncategorized'
    return (
      <div className="category-single">
        <div className="category-single-card" style={{ borderColor: COLORS[0] }}>
          <small>Only 1 category</small>
          <strong>{name}</strong>
          <span>{money(safeNumber(only.revenue))} · 100% of revenue</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="donut-wrap">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <PieChart>
            <Pie data={[...categories]} dataKey="revenue" nameKey="name" innerRadius="60%" outerRadius="83%" paddingAngle={3} isAnimationActive={false}>
              {categories.map((row, index) => (
                <Cell key={row.name || index} fill={COLORS[index % COLORS.length] ?? '#3b82f6'} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => money(safeNumber(value))} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <strong>{money(totalCategory)}</strong>
          <span>Total revenue</span>
        </div>
      </div>
      <div className="category-legend">
        {categories.map((row, index) => {
          const revenue = safeNumber(row.revenue)
          const percent = totalCategory > 0 && Number.isFinite(revenue / totalCategory)
            ? `${((revenue / totalCategory) * 100).toFixed(1)}%`
            : '—'
          return (
            <div key={row.name || index}>
              <i style={{ background: COLORS[index % COLORS.length] ?? '#3b82f6' }} />
              <span>{row.name?.trim() || 'Uncategorized'}</span>
              <strong>{percent}</strong>
              <small>{money(revenue)}</small>
            </div>
          )
        })}
      </div>
    </>
  )
}

function KpiCard({ label, value, money: isMoney, change, sparkline }: ReturnType<typeof analyticsKpis>[number]) {
  const points = (sparkline ?? []).filter((amount) => Number.isFinite(amount))
  const data = points.map((amount, index) => ({ index, amount }))
  const changeLabel = formatChange(change)

  return (
    <article className="analytics-kpi">
      <div>
        <span>{label}</span>
        <strong>
          {value === null || !Number.isFinite(value)
            ? '—'
            : isMoney
              ? money(value)
              : Math.round(value).toLocaleString()}
        </strong>
        {changeLabel === null
          ? <small>Comparison awaits prior-period data</small>
          : <small className={changeLabel.positive ? 'positive' : 'negative'}>
              {changeLabel.positive ? '▲' : '▼'} {changeLabel.text}% vs last 28 days
            </small>}
      </div>
      <div className="sparkline">
        {data.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={data}>
              <Area type="monotone" dataKey="amount" stroke="#60a5fa" fill="rgba(59,130,246,.12)" strokeWidth={1.8} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : data.length === 1 ? (
          <span className="sparkline-placeholder" aria-hidden="true" />
        ) : null}
      </div>
    </article>
  )
}

function AnomalyCard({ insights }: { insights: AnalyticsInsights | null }) {
  const locked = insights?.locked?.find((item) => item.feature === 'anomaly_detection')
  if (locked) {
    return (
      <article className="ai-feature locked">
        <LockKeyhole size={16} />
        <div>
          <small>START+</small>
          <h3>Anomaly Detection</h3>
          <p>Upgrade to spot unusual revenue spikes and dips.</p>
        </div>
      </article>
    )
  }
  const anomalies = insights?.anomalies ?? []
  const first = anomalies[0]
  const percent = first && Number.isFinite(first.percentFromAverage) ? Math.abs(first.percentFromAverage).toFixed(0) : null
  return (
    <article className="ai-feature">
      <Sparkles size={16} />
      <div>
        <small>DETERMINISTIC SIGNAL</small>
        <h3>Anomaly Detection</h3>
        <p>
          {!insights
            ? 'Loading…'
            : (insights.salesHistoryDays ?? 0) < 14
              ? 'Need 14+ days for anomaly detection.'
              : first && percent !== null
                ? `${first.direction === 'spike' ? 'Revenue spike' : 'Revenue dip'} on ${first.day} (${percent}% vs average)`
                : 'No unusual revenue days detected.'}
        </p>
      </div>
    </article>
  )
}

function FeatureCard({ feature, title, insights, onUpgrade }: {
  feature: string
  title: string
  insights: AnalyticsInsights | null
  onUpgrade: () => void
}) {
  const locked = insights?.locked?.find((item) => item.feature === feature)
  if (locked) {
    return (
      <button className="ai-feature locked" onClick={onUpgrade}>
        <LockKeyhole size={16} />
        <div>
          <small>{(locked.requiredPlan ?? 'growth').toUpperCase()}+</small>
          <h3>{title}</h3>
          <p>Upgrade to unlock this deeper analysis.</p>
        </div>
      </button>
    )
  }
  return (
    <article className="ai-feature">
      <Sparkles size={16} />
      <div>
        <small>AVAILABLE</small>
        <h3>{title}</h3>
        <p>
          {feature === 'cohort_analysis'
            ? 'Built from your customer retention history.'
            : feature === 'custom_ai_queries'
              ? 'Ask questions using aggregate store facts.'
              : 'Ready when enough supporting sales history is available.'}
        </p>
      </div>
    </article>
  )
}

function RevenueTooltip({ active, payload, label }: {
  active?: boolean
  payload?: readonly { name?: string; value?: number | null; color?: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((item) => item.value !== null && item.value !== undefined && Number.isFinite(Number(item.value)))
  if (!rows.length) return null
  return (
    <div className="analytics-tooltip">
      <strong>{label}</strong>
      {rows.map((item) => (
        <span key={String(item.name)}>
          <i style={{ background: item.color ?? '#60a5fa' }} />
          {item.name}: {money(Number(item.value))}
        </span>
      ))}
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="analytics-empty">
      <Sparkles size={20} />
      <p>{message}</p>
    </div>
  )
}

/** Isolates a section crash so the rest of Analytics still paints. */
class AnalyticsSectionBoundary extends Component<
  { label: string; children: ReactNode },
  { error: string | null }
> {
  public state: { error: string | null } = { error: null }

  public static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : 'Unexpected render error' }
  }

  public componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[analytics:${this.props.label}]`, error, info.componentStack)
  }

  public render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="analytics-section-fallback" role="alert">
          <Sparkles size={18} />
          <strong>{this.props.label} unavailable</strong>
          <p>This section could not render. Other analytics below still work.</p>
          <button type="button" className="button secondary" onClick={() => this.setState({ error: null })}>
            Retry section
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function bestDay(weekdays: readonly Readonly<{ day: string; revenue: number }>[]) {
  if (!weekdays.length) return null
  return weekdays.reduce(
    (best, row) => (safeNumber(row.revenue) > safeNumber(best.revenue) ? row : best),
    weekdays[0]!,
  )
}

function formatChange(change: number | null): { positive: boolean; text: string } | null {
  if (change === null || !Number.isFinite(change)) return null
  return { positive: change >= 0, text: Math.abs(change).toFixed(1) }
}

function normalizeInsights(value: AnalyticsInsights | null | undefined): AnalyticsInsights | null {
  if (!value || typeof value !== 'object') return null
  return {
    ...value,
    categories: Array.isArray(value.categories) ? value.categories : [],
    topProducts: Array.isArray(value.topProducts) ? value.topProducts : [],
    weekdays: Array.isArray(value.weekdays) ? value.weekdays : [],
    peakHours: Array.isArray(value.peakHours) ? value.peakHours : null,
    anomalies: Array.isArray(value.anomalies) ? value.anomalies : value.anomalies === null ? null : [],
    locked: Array.isArray(value.locked) ? value.locked : [],
    available: Array.isArray(value.available) ? value.available : [],
    forecast: value.forecast ?? { status: 'insufficient_data', message: 'Awaiting more data — at least 7 sales days are needed.', points: [], standardDeviation: 0 },
  }
}

function safeNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

const money = (value: number) => {
  const amount = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount)
}

const compactMoney = (value: number) => {
  const amount = Number.isFinite(value) ? value : 0
  return `$${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(amount)}`
}

const shortDay = (value: string) => {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.valueOf())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
