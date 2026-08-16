import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CalendarClock, Check, Loader2, PackageX, Repeat, Send, Sparkles, TrendingUp, Truck, X } from 'lucide-react'
import { PlanLockedFeature } from './orders.js'
import { CustomSelect } from './CustomSelect.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import { fetchInventoryHistory, queryInventoryInsights, submitReorderDecision } from './api.js'
import {
  HISTORY_WINDOWS,
  awaitingMessage,
  formatCount,
  formatCurrency,
  formatDay,
  insightByFeature,
  lockedInsightByFeature,
  numberOrNull,
  record,
  rows,
  statusOf,
  text,
  usageLabel,
} from './inventory-insights-model.js'
import type { HistoryWindow, InventoryHistoryResult, InventoryInsightsResult } from './inventory-insights-model.js'

/**
 * Inventory intelligence UI (PR #33 / PR-B).
 *
 * Every card renders one of exactly three states:
 *  - locked   → PlanLockedFeature with the upgrade CTA (unchanged from PR #32)
 *  - awaiting → the API's honest "insufficient data" message
 *  - real     → numbers the API calculated from synced Shopify data
 *
 * No card invents a value, and none of them compute a velocity locally.
 */

type ToastKind = 'success' | 'info' | 'warning' | 'error'

export function AIInventoryInsightsCard({ storeId, insights, loading, error, onUpgrade, onRetry, onToast }: {
  storeId: string
  insights: InventoryInsightsResult | null
  loading: boolean
  error: string | null
  onUpgrade: () => void
  onRetry: () => void
  onToast: (message: string, kind?: ToastKind) => void
}) {
  const [open, setOpen] = useState(true)
  if (error) {
    return <section className="card inventory-ai-card">
      <InsightsHeader insights={insights} open={open} onToggle={() => setOpen((value) => !value)} onUpgrade={onUpgrade} />
      <div className="inventory-ai-error"><AlertTriangle size={15} /><span>{error}</span><button className="button secondary" onClick={onRetry}>Retry</button></div>
    </section>
  }
  return <section className="card inventory-ai-card">
    <InsightsHeader insights={insights} open={open} onToggle={() => setOpen((value) => !value)} onUpgrade={onUpgrade} />
    {open && (loading && !insights ? <div className="inventory-ai-grid">{[1, 2, 3, 4].map((key) => <div key={key} className="inventory-skeleton-block" />)}</div> : <>
      <div className="inventory-ai-grid">
        <DeadStockCard insights={insights} onUpgrade={onUpgrade} />
        <ReorderRecommendationsCard insights={insights} onUpgrade={onUpgrade} />
        <OverstockAlertsCard insights={insights} onUpgrade={onUpgrade} />
        <StockTurnoverCard insights={insights} onUpgrade={onUpgrade} />
      </div>
      <AISuggestionCard insights={insights} onUpgrade={onUpgrade} />
      <HistoricalInventoryChart storeId={storeId} insights={insights} onUpgrade={onUpgrade} onToast={onToast} />
      <div className="inventory-ai-grid commander">
        <PredictiveRestockingCard insights={insights} onUpgrade={onUpgrade} />
        <SeasonalTrendsCard insights={insights} onUpgrade={onUpgrade} />
        <AutoReorderCard storeId={storeId} insights={insights} onUpgrade={onUpgrade} onToast={onToast} />
      </div>
      <CustomInventoryQueryInput storeId={storeId} insights={insights} onUpgrade={onUpgrade} onToast={onToast} />
    </>)}
  </section>
}

function InsightsHeader({ insights, open, onToggle, onUpgrade }: { insights: InventoryInsightsResult | null; open: boolean; onToggle: () => void; onUpgrade: () => void }) {
  return <header className="inventory-insights-header">
    <div className="inventory-insights-title">
      <span className="ai-insights-icon"><Sparkles size={18} /></span>
      <div>
        <div className="section-kicker">AI INVENTORY INTELLIGENCE</div>
        <h2>Stock Intelligence</h2>
        <p>{insights ? `${usageLabel(insights)} · calculated from ${insights.salesHistory.days} day${insights.salesHistory.days === 1 ? '' : 's'} of real sales history.` : 'Grounded in your synced Shopify inventory and order history.'}</p>
      </div>
    </div>
    <div className="inventory-insights-head-actions">
      {insights && <UpgradePlanButton plan={insights.plan} onUpgrade={onUpgrade} />}
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Collapse inventory intelligence' : 'Expand inventory intelligence'}>{open ? '−' : '+'}</button>
    </div>
  </header>
}

/** Renders locked, awaiting, or real states for one feature. */
function InsightSlot({ insights, feature, title, icon, onUpgrade, children, className }: {
  insights: InventoryInsightsResult | null
  feature: string
  title: string
  icon: ReactNode
  onUpgrade: () => void
  children: (data: unknown) => ReactNode
  className?: string
}) {
  const locked = lockedInsightByFeature(insights, feature)
  if (locked) return <PlanLockedFeature featureName={locked.name} requiredPlan={locked.required_plan} onUpgrade={onUpgrade}><InsightMask /></PlanLockedFeature>
  const insight = insightByFeature(insights, feature)
  const status = statusOf(insight?.data)
  return <article className={`inventory-ai-tile${className ? ` ${className}` : ''}`}>
    <div className="inventory-card-label">{icon}<span>{title}</span></div>
    {insight === null ? <InsightAwaiting message="Loading your real numbers…" />
      : status === 'insufficient_data' ? <InsightAwaiting message={awaitingMessage(insight.data, 'Awaiting more sales history.')} />
        : status === 'limit_reached' ? <InsightAwaiting message={awaitingMessage(insight.data, 'Daily AI limit reached.')} />
          : status === 'unavailable' ? <InsightAwaiting message={awaitingMessage(insight.data, 'Temporarily unavailable.')} />
            : children(insight.data)}
  </article>
}

export function DeadStockCard({ insights, onUpgrade }: { insights: InventoryInsightsResult | null; onUpgrade: () => void }) {
  return <InsightSlot insights={insights} feature="dead_stock" title="Dead Stock Detector" icon={<PackageX size={16} />} onUpgrade={onUpgrade}>
    {(data) => {
      const value = record(data)
      const items = rows(value.items)
      if (items.length === 0) return <InsightPositive message={text(value.message) ?? 'All items moving well.'} />
      return <>
        <strong>{formatCount(items.length)} frozen</strong>
        <p>{formatCurrency(numberOrNull(value.totalStuckValue), text(value.currency))} stuck · no sale in {formatCount(numberOrNull(value.windowDays))} days</p>
        <ul className="inventory-ai-list">
          {items.slice(0, 4).map((item) => <li key={text(item.productId) ?? ''}>
            <span>{text(item.title) ?? 'Untitled product'}</span>
            <strong>{formatCurrency(numberOrNull(item.value), text(item.currency))}</strong>
          </li>)}
        </ul>
      </>
    }}
  </InsightSlot>
}

export function ReorderRecommendationsCard({ insights, onUpgrade }: { insights: InventoryInsightsResult | null; onUpgrade: () => void }) {
  return <InsightSlot insights={insights} feature="reorder_recommendations" title="Reorder Recommendations" icon={<Truck size={16} />} onUpgrade={onUpgrade}>
    {(data) => {
      const value = record(data)
      const items = rows(value.items)
      if (items.length === 0) return <InsightPositive message={text(value.message) ?? 'Stock levels healthy.'} />
      return <>
        <strong>{formatCount(items.length)} to reorder</strong>
        <p>{formatCount(numberOrNull(value.leadTimeDays))}-day lead time · 20% safety stock</p>
        <ul className="inventory-ai-list">
          {items.slice(0, 4).map((item) => <li key={text(item.productId) ?? ''}>
            <span>{text(item.title) ?? 'Untitled product'}</span>
            <strong>+{formatCount(numberOrNull(item.suggestedQuantity))} units</strong>
          </li>)}
        </ul>
      </>
    }}
  </InsightSlot>
}

export function OverstockAlertsCard({ insights, onUpgrade }: { insights: InventoryInsightsResult | null; onUpgrade: () => void }) {
  return <InsightSlot insights={insights} feature="overstock_alerts" title="Overstock Alerts" icon={<TrendingUp size={16} />} onUpgrade={onUpgrade}>
    {(data) => {
      const value = record(data)
      const items = rows(value.items)
      if (items.length === 0) return <InsightPositive message={text(value.message) ?? 'No excess inventory detected.'} />
      return <>
        <strong>{formatCount(items.length)} overstocked</strong>
        <p>{formatCurrency(numberOrNull(value.totalExcessValue), text(value.currency))} tied up · consider a sale or promotion</p>
        <ul className="inventory-ai-list">
          {items.slice(0, 4).map((item) => <li key={text(item.productId) ?? ''}>
            <span>{text(item.title) ?? 'Untitled product'}</span>
            <strong>{formatCount(numberOrNull(item.excessUnits))} excess</strong>
          </li>)}
        </ul>
      </>
    }}
  </InsightSlot>
}

export function StockTurnoverCard({ insights, onUpgrade }: { insights: InventoryInsightsResult | null; onUpgrade: () => void }) {
  return <InsightSlot insights={insights} feature="stock_turnover" title="Stock Turnover" icon={<Repeat size={16} />} onUpgrade={onUpgrade}>
    {(data) => {
      const value = record(data)
      const top = rows(value.topMovers)
      const slow = rows(value.slowMovers)
      return <>
        <strong>{formatCount(numberOrNull(value.fast))} fast · {formatCount(numberOrNull(value.medium))} medium · {formatCount(numberOrNull(value.slow))} slow</strong>
        <p>Annualized from {formatCount(numberOrNull(value.windowDays))} days of sales</p>
        <ul className="inventory-ai-list">
          {top.slice(0, 2).map((item) => <li key={`fast-${text(item.productId) ?? ''}`}><span>↑ {text(item.title) ?? 'Untitled product'}</span><strong>{formatCount(numberOrNull(item.turnover))}×/yr</strong></li>)}
          {slow.slice(0, 2).map((item) => <li key={`slow-${text(item.productId) ?? ''}`}><span>↓ {text(item.title) ?? 'Untitled product'}</span><strong>{formatCount(numberOrNull(item.turnover))}×/yr</strong></li>)}
        </ul>
      </>
    }}
  </InsightSlot>
}

export function AISuggestionCard({ insights, onUpgrade }: { insights: InventoryInsightsResult | null; onUpgrade: () => void }) {
  return <InsightSlot insights={insights} feature="ai_suggestion" title="AI Suggestion" icon={<Sparkles size={16} />} onUpgrade={onUpgrade} className="wide">
    {(data) => {
      const value = record(data)
      return <>
        <p className="inventory-ai-suggestion">{text(value.text) ?? 'No suggestion was returned.'}</p>
        <small className="inventory-ai-footnote">Grounded in aggregate stock facts only — no product names, customers, or orders are sent to the model.{text(value.model) ? ` Model: ${text(value.model)}.` : ''}</small>
      </>
    }}
  </InsightSlot>
}

export function PredictiveRestockingCard({ insights, onUpgrade }: { insights: InventoryInsightsResult | null; onUpgrade: () => void }) {
  return <InsightSlot insights={insights} feature="predictive_restocking" title="Predictive Restocking" icon={<CalendarClock size={16} />} onUpgrade={onUpgrade}>
    {(data) => {
      const value = record(data)
      const items = rows(value.items)
      if (items.length === 0) return <InsightAwaiting message={text(value.message) ?? 'No product has enough recent sales to project a reorder date.'} />
      return <>
        <strong>{formatCount(items.length)} projected</strong>
        <p>{text(value.method) === 'velocity_trend_projection' ? 'Velocity plus 30-vs-previous-30 trend' : 'Deterministic projection'}</p>
        <ul className="inventory-ai-list">
          {items.slice(0, 4).map((item) => <li key={text(item.productId) ?? ''}>
            <span>{text(item.title) ?? 'Untitled product'}</span>
            <strong>{formatDay(text(item.predictedReorderDate))} · {text(item.confidence) ?? 'low'}</strong>
          </li>)}
        </ul>
      </>
    }}
  </InsightSlot>
}

export function SeasonalTrendsCard({ insights, onUpgrade }: { insights: InventoryInsightsResult | null; onUpgrade: () => void }) {
  return <InsightSlot insights={insights} feature="seasonal_trends" title="Seasonal Trends" icon={<CalendarClock size={16} />} onUpgrade={onUpgrade}>
    {(data) => {
      const value = record(data)
      return <>
        <strong>Peak {text(value.peakMonth) ?? '—'}</strong>
        <p>Quietest {text(value.troughMonth) ?? '—'} · from 12 months of recorded snapshots</p>
      </>
    }}
  </InsightSlot>
}

/**
 * Commander auto-reorder review. Approving records the merchant's decision in
 * the audit trail; the purchase order itself is still placed in Shopify.
 */
export function AutoReorderCard({ storeId, insights, onUpgrade, onToast }: { storeId: string; insights: InventoryInsightsResult | null; onUpgrade: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [decided, setDecided] = useState<Readonly<Record<string, 'approved' | 'dismissed'>>>({})
  const [pending, setPending] = useState<string | null>(null)

  const decide = async (productId: string, decision: 'approved' | 'dismissed') => {
    setPending(productId)
    try {
      await submitReorderDecision(storeId, productId, decision)
      setDecided((current) => ({ ...current, [productId]: decision }))
      onToast(decision === 'approved' ? 'Reorder approved and logged. Place the purchase order in Shopify.' : 'Reorder suggestion dismissed.', 'success')
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : 'Could not record that decision', 'error')
    } finally { setPending(null) }
  }

  return <InsightSlot insights={insights} feature="auto_reorder" title="Auto-Reorder Review" icon={<Truck size={16} />} onUpgrade={onUpgrade}>
    {(data) => {
      const value = record(data)
      const items = rows(value.items)
      if (items.length === 0) return <InsightPositive message={text(value.message) ?? 'Stock levels healthy.'} />
      return <>
        <strong>{formatCount(items.length)} awaiting review</strong>
        <p>Manual review only — ProfitPilot never places an order for you.</p>
        <ul className="inventory-ai-list decisions">
          {items.slice(0, 4).map((item) => {
            const productId = text(item.productId) ?? ''
            const decision = decided[productId]
            return <li key={productId}>
              <span>{text(item.title) ?? 'Untitled product'}</span>
              {decision ? <em className={`inventory-decision ${decision}`}>{decision === 'approved' ? 'Approved' : 'Dismissed'}</em> : <span className="inventory-decision-actions">
                <button type="button" disabled={pending === productId} aria-label={`Approve reorder for ${text(item.title) ?? productId}`} onClick={() => void decide(productId, 'approved')}>{pending === productId ? <Loader2 size={12} className="spin" /> : <Check size={12} />}</button>
                <button type="button" disabled={pending === productId} aria-label={`Dismiss reorder for ${text(item.title) ?? productId}`} onClick={() => void decide(productId, 'dismissed')}><X size={12} /></button>
              </span>}
            </li>
          })}
        </ul>
      </>
    }}
  </InsightSlot>
}

/** Growth+ stock-level history. Empty until snapshots accumulate. */
export function HistoricalInventoryChart({ storeId, insights, onUpgrade, onToast }: { storeId: string; insights: InventoryInsightsResult | null; onUpgrade: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [window, setWindow] = useState<HistoryWindow>(30)
  const [history, setHistory] = useState<InventoryHistoryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const locked = lockedInsightByFeature(insights, 'stock_history')
  const unlocked = insights !== null && locked === null

  useEffect(() => {
    if (!unlocked || !storeId) return
    let cancelled = false
    setLoading(true)
    void fetchInventoryHistory(storeId, window)
      .then((result) => { if (!cancelled) setHistory(result) })
      .catch((reason: unknown) => { if (!cancelled) onToast(reason instanceof Error ? reason.message : 'Inventory history could not be loaded', 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [storeId, window, unlocked])

  const points = useMemo(() => (history?.points ?? []).map((point) => ({ ...point, label: formatDay(point.date) })), [history])

  if (locked) return <PlanLockedFeature featureName={locked.name} requiredPlan={locked.required_plan} onUpgrade={onUpgrade}><InsightMask tall /></PlanLockedFeature>

  return <article className="inventory-ai-tile chart">
    <div className="inventory-chart-head">
      <div className="inventory-card-label"><TrendingUp size={16} /><span>Stock History</span></div>
      <CustomSelect
        className="inventory-select"
        ariaLabel="Stock history range"
        value={String(window)}
        options={HISTORY_WINDOWS.map((entry) => ({ value: String(entry.value), label: entry.label }))}
        onChange={(value) => setWindow(Number(value) as HistoryWindow)}
      />
    </div>
    {loading && points.length === 0 ? <div className="inventory-skeleton-block" /> : points.length === 0 ? (
      <InsightAwaiting message={history?.message ?? 'Building your inventory history — charts will appear after next sync.'} />
    ) : <>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={points as unknown as Record<string, unknown>[]} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="rgba(148,163,184,.12)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#94A3B8', fontSize: 8 }} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tick={{ fill: '#94A3B8', fontSize: 8 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip contentStyle={{ background: 'rgba(15,23,42,.96)', border: '1px solid rgba(148,163,184,.25)', borderRadius: 10, color: '#E2E8F0', fontSize: 10 }} formatter={(value: unknown, name: unknown) => [String(value), name === 'units' ? 'Units in stock' : String(name)]} />
          <Line type="monotone" dataKey="units" stroke="var(--blue-bright)" strokeWidth={2} dot={points.length < 12} />
        </LineChart>
      </ResponsiveContainer>
      <small className="inventory-ai-footnote">{history?.message ?? ''} One snapshot is recorded per inventory sync.</small>
    </>}
  </article>
}

/** Commander free-form question. The API redacts identifiers before the model. */
export function CustomInventoryQueryInput({ storeId, insights, onUpgrade, onToast }: { storeId: string; insights: InventoryInsightsResult | null; onUpgrade: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const locked = lockedInsightByFeature(insights, 'custom_ai_queries')

  if (locked) return <PlanLockedFeature featureName={locked.name} requiredPlan={locked.required_plan} onUpgrade={onUpgrade}><InsightMask /></PlanLockedFeature>
  if (!insights || insights.plan !== 'commander') return null

  const ask = async () => {
    const trimmed = question.trim()
    if (!trimmed) return
    setPending(true)
    try {
      const result = await queryInventoryInsights(storeId, trimmed)
      const data = record(result.available[0]?.data)
      setAnswer(text(data.text) ?? text(data.message) ?? 'No answer was returned.')
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : 'That question could not be answered', 'error')
    } finally { setPending(false) }
  }

  return <article className="inventory-ai-tile query">
    <div className="inventory-card-label"><Sparkles size={16} /><span>Ask about your inventory</span></div>
    <div className="inventory-query-row">
      <input
        value={question}
        maxLength={500}
        placeholder="Which products should I discount?"
        aria-label="Ask a question about your inventory"
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') void ask() }}
      />
      <button type="button" className="button primary" disabled={pending || question.trim().length === 0} onClick={() => void ask()}>
        {pending ? <Loader2 size={13} className="spin" /> : <Send size={13} />} Ask
      </button>
    </div>
    {answer && <p className="inventory-ai-suggestion">{answer}</p>}
    <small className="inventory-ai-footnote">Questions are stripped of product names, SKUs, and ids before they reach the model. 20 questions per day.</small>
  </article>
}

function InsightMask({ tall = false }: { tall?: boolean }) { return <span className={`insight-mask ${tall ? 'tall' : ''}`}><i /><i /><i /></span> }
function InsightAwaiting({ message }: { message: string }) { return <div className="insight-unavailable"><span>—</span><small>{message}</small></div> }
function InsightPositive({ message }: { message: string }) { return <div className="insight-positive"><Check size={13} /><small>{message}</small></div> }
