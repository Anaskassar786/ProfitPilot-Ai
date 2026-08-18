/**
 * Insights Hub workspace (PR #50) — "Where data becomes wisdom."
 *
 * The third module of AI Growth Command: DISCOVER hidden patterns, LEARN
 * lessons grounded in the store's own data, UNDERSTAND behavior. The UI is a
 * thin renderer over `/insights/*`: every number on screen was computed
 * server-side from real synced data; locked plans see generic "Upgrade Plan"
 * CTAs; trial explores through clearly labeled samples.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Eye,
  FlaskConical,
  HelpCircle,
  History,
  KeyRound,
  Library,
  Lightbulb,
  Lock,
  Microscope,
  Network,
  RefreshCw,
  Scale,
  Search,
  Settings2,
  Sparkles,
  Star,
  Telescope,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ApiClientError } from './api.js'
import * as api from './api.js'
import type { CatalogProduct, WorkspaceContext } from './model.js'
import {
  COMPARISON_TYPES,
  DISCOVERY_CATEGORIES,
  DISCOVERY_CATEGORY_LABELS,
  DISCOVERY_STATUS_LABELS,
  DISCOVERY_TYPE_LABELS,
  HORIZON_LABELS,
  INSIGHTS_UPGRADE_CTA,
  KNOWLEDGE_TYPE_LABELS,
  LESSON_TYPE_LABELS,
  PATTERN_TYPE_LABELS,
  PREDICTION_TYPE_LABELS,
  SUGGESTED_WHY_QUESTIONS,
  TIMELINE_TYPE_LABELS,
  TREND_FRESHNESS_LABELS,
  TREND_TYPE_LABELS,
  comparisonDelta,
  confidenceLabel,
  confidencePercent,
  confidenceTone,
  evidenceRows,
  formatInsightMoney,
  formatInsightNumber,
  formatPercent,
  formatRelativeTime,
  insightsFeatureLock,
  insightsRoutePath,
  insightsTabLabel,
  meterPercent,
  parseInsightsRoute,
  patternBubbles,
  personaShare,
  subjectLabel,
  tabForTimelineEntity,
  tagCloud,
  trendScatter,
} from './insights-hub-model.js'
import type {
  ComparisonType,
  DiscoveryCategory,
  DiscoveryFeedResult,
  DiscoveryStatus,
  InsightComparison,
  InsightDiscovery,
  InsightInvestigation,
  InsightKnowledgeEntry,
  InsightLesson,
  InsightPattern,
  InsightPersona,
  InsightPrediction,
  InsightsFeature,
  InsightsOverview,
  InsightsPreferences,
  InsightsTab,
  InsightTimelineEvent,
  InsightTrend,
  KnowledgeEntryType,
  PlanTier,
  PredictionHorizon,
  TimelineResult,
} from './insights-hub-model.js'
import {
  InsightsAreaBand,
  InsightsBubbleChart,
  InsightsComparisonBars,
  InsightsFlowChart,
  InsightsHeatmap,
  InsightsNetworkGraph,
  InsightsRadarChart,
  InsightsScatter,
  InsightsTimelineStrip,
  InsightsTreeMap,
  InsightsWordCloud,
  downloadChartSvg,
} from './insights-hub-charts.js'

export type InsightsToastKind = 'success' | 'info' | 'warning' | 'error'
export type InsightsWorkspaceProps = Readonly<{
  context: WorkspaceContext
  catalog?: readonly CatalogProduct[]
  onToast: (message: string, kind?: InsightsToastKind) => void
  onNavigateBilling: () => void
}>

type LoadState<T> = Readonly<{ status: 'loading' | 'ready' | 'error'; data: T | null; upgradeRequired: boolean; message: string | null }>

const idle = <T,>(): LoadState<T> => ({ status: 'loading', data: null, upgradeRequired: false, message: null })

function useResource<T>(load: (() => Promise<T>) | null, deps: readonly unknown[]): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>(idle)
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    const loader = loadRef.current
    if (!loader) return undefined
    let cancelled = false
    setState(idle())
    loader()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, upgradeRequired: false, message: null }) })
      .catch((error: unknown) => {
        if (cancelled) return
        const upgradeRequired = error instanceof ApiClientError && error.status === 402
        const message = error instanceof Error ? error.message : 'The insights service could not be reached.'
        setState({ status: 'error', data: null, upgradeRequired, message })
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])
  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { ...state, reload }
}

/* ── Shared presentation atoms ─────────────────────────────────────────── */

export function InsightsUpgradeCta({ onNavigateBilling, compact = false }: { onNavigateBilling: () => void; compact?: boolean }) {
  return <button className={`button primary ${compact ? 'compact' : ''}`} onClick={onNavigateBilling}>{INSIGHTS_UPGRADE_CTA} <ArrowRight size={12} /></button>
}

export function InsightsLockedPanel({ feature, plan, overview, onNavigateBilling, note }: { feature: InsightsFeature; plan: PlanTier; overview: InsightsOverview | null; onNavigateBilling: () => void; note?: string }) {
  const lock = insightsFeatureLock(plan, feature, overview)
  if (!lock.locked) return null
  return (
    <div className="ih-locked" data-feature={feature}>
      <span className="ih-locked-icon"><Lock size={18} /></span>
      <strong>This lab is locked on your current plan</strong>
      <p>{note ?? insightsUpgradeMessageText(feature)}</p>
      <InsightsUpgradeCta onNavigateBilling={onNavigateBilling} />
    </div>
  )
}

function insightsUpgradeMessageText(feature: InsightsFeature): string {
  switch (feature) {
    case 'personas': return 'Customer personas decode who your buyers are. Unlock persona science with a plan upgrade.'
    case 'investigations': return 'The Why? explorer traces any metric drop to its root causes. Unlock investigations with a plan upgrade.'
    case 'comparisons': return 'Head-to-head comparisons settle product, period, and segment debates with your real numbers.'
    case 'knowledge': return 'The knowledge base compounds every insight into reusable wisdom. Unlock it with a plan upgrade.'
    case 'predictions': return 'Forecasts project revenue, orders, and stockouts with honest confidence intervals.'
    case 'apiAccess': return 'Programmatic insight access for your own tools, with a dedicated API key and hourly quota.'
    case 'externalTrends': return 'External market trends appear here once a verified benchmark feed is connected — we never invent market data.'
    default: return 'This capability is not included in your current plan.'
  }
}

export function InsightsEmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="ih-empty">
      <span className="ih-empty-icon"><Icon size={20} /></span>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  )
}

export function InsightsErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="ih-error" role="alert">
      <strong>The laboratory hit a snag</strong>
      <p>{message}</p>
      <button className="button secondary compact" onClick={onRetry}><RefreshCw size={12} /> Try again</button>
    </div>
  )
}

export function InsightsSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="ih-skeletons" aria-busy="true">{Array.from({ length: rows }, (_, index) => <span key={index} className="ih-skeleton" />)}</div>
}

export function ConfidencePill({ score }: { score: number }) {
  return <span className={`ih-confidence tone-${confidenceTone(score)}`} title={confidenceLabel(score)}><span style={{ width: `${confidencePercent(score)}%` }} />{confidencePercent(score)}%</span>
}

export function SampleBadge() {
  return <span className="ih-sample-badge" title="Generated from a labeled example so you can explore. Paid plans compute these from your synced data.">SAMPLE</span>
}

export function RatingStars({ value, onRate, disabled = false }: { value: number | null; onRate?: (rating: number) => void; disabled?: boolean }) {
  return (
    <span className="ih-stars" role={onRate ? 'radiogroup' : undefined} aria-label="Rate this insight">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} className={`ih-star ${value !== null && star <= value ? 'lit' : ''}`} disabled={disabled || !onRate} onClick={() => onRate?.(star)} aria-label={`${star} star${star === 1 ? '' : 's'}`}>
          <Star size={13} fill={value !== null && star <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  )
}

export function UsageMeterBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const percent = meterPercent(used, limit)
  return (
    <div className="ih-meter">
      <div className="ih-meter-head"><span>{label}</span><strong>{limit === null ? `${used} used` : `${used} / ${limit}`}</strong></div>
      {percent !== null && <div className="ih-meter-track"><span className={percent >= 100 ? 'blocked' : percent >= 80 ? 'warn' : ''} style={{ width: `${percent}%` }} /></div>}
    </div>
  )
}

/** Minimal, safe markdown subset for lesson bodies — no innerHTML. */
export function MarkdownLite({ markdown }: { markdown: string }) {
  const blocks = markdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return (
    <div className="ih-markdown">
      {blocks.map((block, index) => {
        if (block.startsWith('### ')) return <h4 key={index}>{inline(block.slice(4))}</h4>
        if (block.startsWith('## ')) return <h3 key={index}>{inline(block.slice(3))}</h3>
        if (block.startsWith('# ')) return <h3 key={index}>{inline(block.slice(2))}</h3>
        if (/^(-|\d+\.)\s/m.test(block)) {
          const items = block.split('\n').map((line) => line.replace(/^(-|\d+\.)\s*/, '').trim()).filter(Boolean)
          return <ul key={index}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>
        }
        return <p key={index}>{inline(block)}</p>
      })}
    </div>
  )
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => (part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>))
}

function ChartExportButton({ targetRef, filename, enabled, onLocked }: { targetRef: React.RefObject<HTMLDivElement | null>; filename: string; enabled: boolean; onLocked: () => void }) {
  if (!enabled) return <button className="button ghost compact ih-export-locked" onClick={onLocked} title="Export unlocks with a plan upgrade"><Lock size={11} /> Export</button>
  return <button className="button ghost compact" onClick={() => void downloadChartSvg(targetRef.current, filename)} title="Download this chart as an SVG"><Download size={11} /> Export</button>
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

const TABS: readonly Readonly<{ tab: InsightsTab; icon: LucideIcon; feature: InsightsFeature | null }>[] = [
  { tab: 'overview', icon: Telescope, feature: null },
  { tab: 'lessons', icon: BookOpen, feature: null },
  { tab: 'patterns', icon: Brain, feature: null },
  { tab: 'personas', icon: Users, feature: 'personas' },
  { tab: 'why', icon: HelpCircle, feature: 'investigations' },
  { tab: 'trends', icon: TrendingUp, feature: 'trends' },
  { tab: 'comparisons', icon: Scale, feature: 'comparisons' },
  { tab: 'knowledge', icon: Library, feature: 'knowledge' },
  { tab: 'timeline', icon: History, feature: 'timeline' },
  { tab: 'predictions', icon: Sparkles, feature: 'predictions' },
  { tab: 'settings', icon: Settings2, feature: null },
  { tab: 'api-access', icon: KeyRound, feature: 'apiAccess' },
]

/* ── Root workspace ────────────────────────────────────────────────────── */

export function InsightsHubWorkspace({ context, catalog = [], onToast, onNavigateBilling }: InsightsWorkspaceProps) {
  const [route, setRoute] = useState(() => parseInsightsRoute(typeof window === 'undefined' ? '' : window.location.pathname))
  const overviewState = useResource<InsightsOverview>(context.storeId ? () => api.fetchInsightsOverview(context.storeId ?? '') : null, [context.storeId])

  const go = useCallback((tab: InsightsTab, id: string | null = null) => {
    const path = insightsRoutePath(tab, id, typeof window === 'undefined' ? '' : window.location.search)
    try { window.history.pushState({}, '', path) } catch { /* embedded browsers may restrict history */ }
    setRoute({ tab, id })
  }, [])

  useEffect(() => {
    const onPop = () => {
      const parsed = parseInsightsRoute(window.location.pathname)
      if (window.location.pathname.startsWith('/ai-growth-command/insights')) setRoute(parsed)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const overview = overviewState.data
  const plan: PlanTier = overview?.plan ?? 'trial'
  const lockedFor = (feature: InsightsFeature): boolean => insightsFeatureLock(plan, feature, overview).locked

  const shared = { storeId: context.storeId, overview, plan, catalog, go, onToast, onNavigateBilling, exportEnabled: !lockedFor('export'), onExportLocked: () => { onToast('Chart export unlocks with a plan upgrade.', 'info') } }

  return (
    <div className="ih-root" data-plan={plan}>
      <header className="ih-hero">
        <div className="ih-hero-copy">
          <span className="ih-hero-kicker"><FlaskConical size={12} /> AI GROWTH COMMAND · INSIGHTS HUB</span>
          <h2>Where data becomes wisdom.</h2>
          <p>Discover hidden patterns, learn from your own data, and understand why your business moves — every figure computed from your synced store, nothing invented.</p>
        </div>
        <div className="ih-hero-stats">
          <div className="ih-stat"><span>New discoveries</span><strong>{overview ? formatInsightNumber(overview.counts.newDiscoveries) : '—'}</strong></div>
          <div className="ih-stat"><span>Active patterns</span><strong>{overview ? formatInsightNumber(overview.counts.patterns) : '—'}</strong></div>
          <div className="ih-stat"><span>Lessons read</span><strong>{overview ? `${overview.counts.lessonsRead}/${overview.counts.lessons}` : '—'}</strong></div>
          <div className="ih-stat"><span>Personas</span><strong>{overview ? formatInsightNumber(overview.counts.personas) : '—'}</strong></div>
          {overview && overview.usage.discoveries.limit !== null && (
            <div className="ih-stat ih-stat-meter"><UsageMeterBar label="Discoveries this month" used={overview.usage.discoveries.used} limit={overview.usage.discoveries.limit} /></div>
          )}
        </div>
      </header>

      {overview?.autoDiscoveryRan && <div className="ih-banner info"><Sparkles size={13} /> Auto-discovery just ran — the feed below reflects your freshest synced data.</div>}
      {overview?.trial && <div className="ih-banner sample"><Eye size={13} /> You are exploring trial mode: clearly labeled samples show what the Hub finds once a paid plan starts generating from your store.</div>}
      {overviewState.status === 'error' && !overviewState.upgradeRequired && <InsightsErrorPanel message={overviewState.message ?? 'Overview failed to load.'} onRetry={overviewState.reload} />}

      <nav className="ih-tabs" aria-label="Insights Hub sections">
        {TABS.map(({ tab, icon: Icon, feature }) => {
          const locked = feature !== null && lockedFor(feature)
          const active = route.tab === tab
          return (
            <button key={tab} className={`ih-tab ${active ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={() => go(tab)} aria-current={active ? 'page' : undefined}>
              <Icon size={13} />
              <span>{insightsTabLabel(tab)}</span>
              {locked && <Lock size={10} />}
            </button>
          )
        })}
      </nav>

      <main className="ih-tab-panel">
        {route.tab === 'overview' && <DiscoveriesTab {...shared} detailId={null} />}
        {route.tab === 'discoveries' && <DiscoveriesTab {...shared} detailId={route.id} />}
        {route.tab === 'lessons' && <LessonsTab {...shared} detailId={route.id} />}
        {route.tab === 'patterns' && <PatternsTab {...shared} />}
        {route.tab === 'personas' && <PersonasTab {...shared} detailId={route.id} />}
        {route.tab === 'why' && <WhyTab {...shared} detailId={route.id} />}
        {route.tab === 'trends' && <TrendsTab {...shared} />}
        {route.tab === 'comparisons' && <ComparisonsTab {...shared} createMode={route.id === 'new'} detailId={route.id === 'new' ? null : route.id} />}
        {route.tab === 'knowledge' && <KnowledgeTab {...shared} detailId={route.id} />}
        {route.tab === 'timeline' && <TimelineTab {...shared} />}
        {route.tab === 'predictions' && <PredictionsTab {...shared} />}
        {route.tab === 'settings' && <SettingsTab {...shared} />}
        {route.tab === 'api-access' && <ApiAccessTab {...shared} />}
      </main>
    </div>
  )
}

type TabProps = Readonly<{
  storeId: string | null
  overview: InsightsOverview | null
  plan: PlanTier
  catalog: readonly CatalogProduct[]
  go: (tab: InsightsTab, id?: string | null) => void
  onToast: (message: string, kind?: InsightsToastKind) => void
  onNavigateBilling: () => void
  exportEnabled: boolean
  onExportLocked: () => void
}>

/* ── Discoveries ───────────────────────────────────────────────────────── */

function DiscoveriesTab(props: TabProps & { detailId: string | null }) {
  const { storeId, overview, plan, go, onToast, onNavigateBilling, exportEnabled, onExportLocked } = props
  const [statusFilter, setStatusFilter] = useState<'ALL' | DiscoveryStatus>('ALL')
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | DiscoveryCategory>('ALL')
  const [generating, setGenerating] = useState(false)
  const feed = useResource<DiscoveryFeedResult>(storeId ? () => api.fetchDiscoveryFeed(storeId) : null, [storeId])
  const list = useResource<readonly InsightDiscovery[]>(storeId ? () => api.fetchDiscoveries(storeId, { ...(statusFilter === 'ALL' ? {} : { status: statusFilter }), ...(categoryFilter === 'ALL' ? {} : { category: categoryFilter }), limit: 40 }).then((result) => result.items) : null, [storeId, statusFilter, categoryFilter, feed.data])
  const chartRef = useRef<HTMLDivElement>(null)

  const generate = async () => {
    if (!storeId) return
    setGenerating(true)
    try {
      const result = await api.generateInsightsDiscoveries(storeId)
      onToast(`Discovery sweep complete — ${result.generated} new finding${result.generated === 1 ? '' : 's'} from your real data.`, 'success')
      feed.reload()
      list.reload()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) onToast('Discovery limit reached on your plan. Upgrade Plan to keep exploring.', 'warning')
      else onToast(error instanceof Error ? error.message : 'Discovery sweep failed.', 'error')
    } finally { setGenerating(false) }
  }

  const discoveries = list.data ?? feed.data?.discoveries ?? []
  const readiness = feed.data?.readiness ?? overview?.readiness ?? null
  const generationLocked = overview ? !overview.features.discoveries : plan === 'trial'
  const weekdayCells = useMemo(() => weekdayHeatCells(discoveries), [discoveries])
  const hourCells = useMemo(() => hourHeatCells(discoveries), [discoveries])

  if (!storeId) return <InsightsEmptyState icon={Telescope} title="Connect your store first" body="Insights Hub reads metrics from your synced Shopify store. Connect a store and run a sync to start the science." />

  if (props.detailId) return <DiscoveryDetail storeId={storeId} id={props.detailId} plan={plan} onBack={() => go('discoveries', null)} onToast={onToast} onNavigateBilling={onNavigateBilling} />

  return (
    <section className="ih-discoveries">
      <div className="ih-toolbar">
        <div className="ih-toolbar-filters">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | DiscoveryStatus)} aria-label="Filter by status">
            <option value="ALL">All statuses</option>
            {(Object.keys(DISCOVERY_STATUS_LABELS) as DiscoveryStatus[]).map((status) => <option key={status} value={status}>{DISCOVERY_STATUS_LABELS[status]}</option>)}
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'ALL' | DiscoveryCategory)} aria-label="Filter by category">
            <option value="ALL">All categories</option>
            {DISCOVERY_CATEGORIES.map((category) => <option key={category} value={category}>{DISCOVERY_CATEGORY_LABELS[category]}</option>)}
          </select>
        </div>
        <div className="ih-toolbar-actions">
          <ChartExportButton targetRef={chartRef} filename="insights-discovery-heatmap" enabled={exportEnabled} onLocked={onExportLocked} />
          {generationLocked
            ? <button className="button primary" onClick={onNavigateBilling} title="On-demand discovery generation unlocks with a plan upgrade"><Lock size={12} /> {INSIGHTS_UPGRADE_CTA}</button>
            : <button className="button primary" onClick={() => void generate()} disabled={generating}><FlaskConical size={13} /> {generating ? 'Examining your data…' : 'Run discovery'}</button>}
        </div>
      </div>

      {(feed.status === 'loading' || list.status === 'loading') && <InsightsSkeleton rows={4} />}
      {feed.status === 'error' && (feed.upgradeRequired
        ? <InsightsLockedPanel feature="discoveries" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />
        : <InsightsErrorPanel message={feed.message ?? 'The discovery feed failed to load.'} onRetry={feed.reload} />)}

      {discoveries.length > 0 && (
        <div className="ih-card ih-funnel-card">
          <div className="ih-card-head"><span className="section-kicker"><Zap size={11} /> FROM SIGNAL TO ACTION</span><small>Where your discoveries stand in review</small></div>
          <InsightsFlowChart stages={funnelStages(discoveries)} />
        </div>
      )}

      {feed.status === 'ready' && discoveries.length === 0 && (
        <InsightsEmptyState
          icon={Telescope}
          title={readiness && !readiness.canDiscover ? 'Not enough history to discover yet' : 'No discoveries match this filter'}
          body={readiness && !readiness.canDiscover ? `${readiness.discoverRequirement} You currently have ${readiness.revenueDays} day${readiness.revenueDays === 1 ? '' : 's'} of revenue history and ${formatInsightNumber(readiness.totalOrders)} orders — sync your store and check back as data accumulates.` : 'Try widening the filters, or run a fresh discovery sweep against your latest synced data.'}
        />
      )}

      {weekdayCells.length > 0 && (
        <div className="ih-card" ref={chartRef}>
          <div className="ih-card-head"><span className="section-kicker"><Clock3 size={11} /> WHEN YOUR STORE HUMS</span><small>Revenue share by weekday — measured from your orders</small></div>
          <InsightsHeatmap cells={weekdayCells} xLabels={[...DAY_LABELS]} yLabels={['Revenue']} />
        </div>
      )}
      {hourCells.length > 0 && (
        <div className="ih-card">
          <div className="ih-card-head"><span className="section-kicker"><Clock3 size={11} /> YOUR STORE BY THE HOUR</span><small>Orders by hour of day (UTC) — measured, not modeled</small></div>
          <InsightsHeatmap cells={hourCells} xLabels={[...HOUR_LABELS]} yLabels={['Orders']} />
        </div>
      )}

      <div className="ih-masonry">
        {discoveries.map((discovery) => <DiscoveryCard key={discovery.id} discovery={discovery} storeId={storeId} onOpen={() => go('discoveries', discovery.id)} onChanged={() => list.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />)}
      </div>
    </section>
  )
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const HOUR_LABELS = ['12am', '4am', '8am', '12pm', '4pm', '8pm'] as const

type HeatCell = Readonly<{ x: number; y: number; value: number; label: string }>

/** Discovery review funnel — a count of the visible list's statuses. */
export function funnelStages(discoveries: readonly InsightDiscovery[]): readonly Readonly<{ id: string; label: string; value: number }>[] {
  const count = (statuses: readonly DiscoveryStatus[]) => discoveries.filter((discovery) => statuses.includes(discovery.status)).length
  return [
    { id: 'new', label: 'New', value: count(['NEW']) },
    { id: 'reviewed', label: 'Reviewed', value: count(['REVIEWED']) },
    { id: 'saved', label: 'Saved', value: count(['SAVED']) },
    { id: 'acted', label: 'Acted on', value: count(['ACTED_ON']) },
  ]
}

/** Weekday revenue-share cells from the engine's TIME discovery profile. */
export function weekdayHeatCells(discoveries: readonly InsightDiscovery[]): readonly HeatCell[] {
  for (const discovery of discoveries) {
    const profile = discovery.visualizationData.weekdayProfile
    if (!Array.isArray(profile)) continue
    const cells: HeatCell[] = []
    profile.slice(0, 7).forEach((row, index) => {
      if (typeof row !== 'object' || row === null) return
      const record = row as Readonly<Record<string, unknown>>
      const share = typeof record.share === 'number' ? record.share : 0
      const revenue = typeof record.revenue === 'number' ? record.revenue : 0
      cells.push({ x: index, y: 0, value: share > 0 ? share : revenue, label: `${DAY_LABELS[index] ?? ''}: ${Math.round(share * 100)}% of weekly revenue` })
    })
    if (cells.length > 0) return cells
  }
  return []
}

/** Hour-of-day order cells from the engine's BEHAVIOR discovery. */
export function hourHeatCells(discoveries: readonly InsightDiscovery[]): readonly HeatCell[] {
  for (const discovery of discoveries) {
    const hours = discovery.visualizationData.hours
    if (!Array.isArray(hours)) continue
    const buckets = new Array<number>(HOUR_LABELS.length).fill(0)
    for (const row of hours) {
      if (typeof row !== 'object' || row === null) continue
      const record = row as Readonly<Record<string, unknown>>
      const hour = typeof record.hour === 'number' ? record.hour : -1
      const orders = typeof record.orders === 'number' ? record.orders : 0
      if (hour < 0 || hour > 23) continue
      const bucket = Math.min(HOUR_LABELS.length - 1, Math.floor(hour / 4))
      buckets[bucket] = (buckets[bucket] ?? 0) + orders
    }
    const cells = buckets.map((value, index) => ({ x: index, y: 0, value, label: `${HOUR_LABELS[index] ?? ''}–${index === HOUR_LABELS.length - 1 ? '12am' : (HOUR_LABELS[index + 1] ?? '')}: ${value} orders` })).filter((cell) => cell.value > 0)
    if (cells.length > 0) return cells
  }
  return []
}

/** Treemap blocks from a discovery's concentration/segment visualization. */
export function discoveryTreemapBlocks(discovery: InsightDiscovery): readonly Readonly<{ id: string; label: string; value: number }>[] {
  const data = discovery.visualizationData
  if (data.chart !== 'treemap') return []
  if (typeof data.repeat === 'number' || typeof data.oneTime === 'number') {
    const repeat = typeof data.repeat === 'number' ? data.repeat : 0
    const oneTime = typeof data.oneTime === 'number' ? data.oneTime : 0
    return repeat + oneTime > 0 ? [{ id: 'repeat', label: 'Repeat customers', value: repeat }, { id: 'one-time', label: 'One-time customers', value: oneTime }] : []
  }
  if (typeof data.topShare === 'number') {
    const top = data.topShare
    const top3 = typeof data.top3Share === 'number' ? data.top3Share : top
    return [
      { id: 'top', label: 'Best seller', value: top },
      { id: 'top3', label: 'Rest of top 3', value: Math.max(0, top3 - top) },
      { id: 'rest', label: 'Everything else', value: Math.max(0, 1 - top3) },
    ].filter((block) => block.value > 0)
  }
  return []
}

export function DiscoveryCard({ discovery, storeId, onOpen, onChanged, onToast, onNavigateBilling }: {
  discovery: InsightDiscovery
  storeId: string
  onOpen: () => void
  onChanged: () => void
  onToast: (message: string, kind?: InsightsToastKind) => void
  onNavigateBilling: () => void
}) {
  const [busy, setBusy] = useState(false)
  const setStatus = async (status: DiscoveryStatus) => {
    setBusy(true)
    try {
      await api.setInsightDiscoveryStatus(storeId, discovery.id, status)
      onToast(status === 'DISMISSED' ? 'Marked not useful — the engine learns from this.' : `Discovery ${DISCOVERY_STATUS_LABELS[status].toLowerCase()}.`, 'success')
      onChanged()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) { onToast('Discovery actions unlock with a plan upgrade.', 'warning'); onNavigateBilling() }
      else onToast(error instanceof Error ? error.message : 'Could not update the discovery.', 'error')
    } finally { setBusy(false) }
  }
  return (
    <article className={`ih-discovery-card category-${discovery.category.toLowerCase()} ${discovery.status === 'NEW' ? 'fresh' : ''}`}>
      <header>
        <span className={`ih-type-badge type-${discovery.discoveryType.toLowerCase()}`}>{DISCOVERY_TYPE_LABELS[discovery.discoveryType]}</span>
        <span className="ih-category">{DISCOVERY_CATEGORY_LABELS[discovery.category]}</span>
        {discovery.sample && <SampleBadge />}
        <time>{formatRelativeTime(discovery.discoveredAt)}</time>
      </header>
      <h3>{discovery.title}</h3>
      <p>{discovery.description}</p>
      {discovery.explanation && <blockquote className="ih-narration"><Microscope size={12} /> {discovery.explanation}</blockquote>}
      <div className="ih-discovery-meta">
        <ConfidencePill score={discovery.confidenceScore} />
        {discovery.impactEstimate !== null && <span className="ih-impact">≈ {formatInsightMoney(discovery.impactEstimate, discovery.impactCurrency)} potential</span>}
      </div>
      <footer>
        <button className="button secondary compact" onClick={onOpen}><Eye size={12} /> Evidence</button>
        <button className="button ghost compact" disabled={busy || discovery.status === 'SAVED'} onClick={() => void setStatus('SAVED')}>Save</button>
        <button className="button ghost compact" disabled={busy || discovery.status === 'ACTED_ON'} onClick={() => void setStatus('ACTED_ON')}>Acted on it</button>
        <button className="button ghost compact subtle" disabled={busy || discovery.status === 'DISMISSED'} onClick={() => void setStatus('DISMISSED')}>Not useful</button>
      </footer>
    </article>
  )
}

function DiscoveryDetail({ storeId, id, plan, onBack, onToast, onNavigateBilling }: { storeId: string; id: string; plan: PlanTier; onBack: () => void; onToast: (m: string, k?: InsightsToastKind) => void; onNavigateBilling: () => void }) {
  const state = useResource<InsightDiscovery>(() => api.fetchInsightDiscovery(storeId, id), [storeId, id])
  if (state.status === 'loading') return <InsightsSkeleton rows={5} />
  if (state.status === 'error' || !state.data) return <InsightsErrorPanel message={state.message ?? 'Discovery not found.'} onRetry={state.reload} />
  const discovery = state.data
  const rows = evidenceRows(discovery.dataEvidence, 8)
  return (
    <section className="ih-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to discoveries</button>
      <article className="ih-card ih-detail-card">
        <header className="ih-detail-head">
          <span className={`ih-type-badge type-${discovery.discoveryType.toLowerCase()}`}>{DISCOVERY_TYPE_LABELS[discovery.discoveryType]}</span>
          <span className="ih-category">{DISCOVERY_CATEGORY_LABELS[discovery.category]}</span>
          {discovery.sample && <SampleBadge />}
          <ConfidencePill score={discovery.confidenceScore} />
        </header>
        <h2>{discovery.title}</h2>
        <p className="ih-detail-description">{discovery.description}</p>
        {discovery.explanation && <blockquote className="ih-narration"><Microscope size={13} /> {discovery.explanation}</blockquote>}
        {plan === 'trial' && <div className="ih-banner sample"><Eye size={13} /> This is a labeled sample. Paid plans compute discoveries entirely from your synced store data. <button className="text-button" onClick={onNavigateBilling}>{INSIGHTS_UPGRADE_CTA}</button></div>}
        <div className="ih-evidence">
          <h4><FlaskConical size={13} /> The evidence — pulled from your real data</h4>
          {rows.length === 0 ? <p className="ih-muted">Evidence bundle is empty for this discovery.</p> : (
            <dl>{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          )}
        </div>
        {discovery.impactEstimate !== null && <p className="ih-detail-impact"><Zap size={13} /> Estimated potential: <strong>{formatInsightMoney(discovery.impactEstimate, discovery.impactCurrency)}</strong> — computed from observed order values, never a guess.</p>}
        {discoveryTreemapBlocks(discovery).length > 0 && (
          <div className="ih-detail-chart">
            <h4>How it splits</h4>
            <InsightsTreeMap blocks={discoveryTreemapBlocks(discovery)} />
          </div>
        )}
        <footer className="ih-detail-actions"><DiscoveryStatusActions storeId={storeId} discovery={discovery} onChanged={() => state.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} /></footer>
      </article>
    </section>
  )
}

function DiscoveryStatusActions({ storeId, discovery, onChanged, onToast, onNavigateBilling }: { storeId: string; discovery: InsightDiscovery; onChanged: () => void; onToast: (m: string, k?: InsightsToastKind) => void; onNavigateBilling: () => void }) {
  const [busy, setBusy] = useState(false)
  const act = async (status: DiscoveryStatus) => {
    setBusy(true)
    try { await api.setInsightDiscoveryStatus(storeId, discovery.id, status); onChanged() } catch (error: unknown) { if (error instanceof ApiClientError && error.status === 402) onNavigateBilling(); else onToast(error instanceof Error ? error.message : 'Update failed.', 'error') } finally { setBusy(false) }
  }
  return (
    <div className="ih-action-row">
      {(['REVIEWED', 'SAVED', 'ACTED_ON', 'DISMISSED'] as const).map((status) => <button key={status} className={`button compact ${discovery.status === status ? 'primary' : 'secondary'}`} disabled={busy} onClick={() => void act(status)}>{DISCOVERY_STATUS_LABELS[status]}</button>)}
    </div>
  )
}

/* ── Lessons ───────────────────────────────────────────────────────────── */

function LessonsTab(props: TabProps & { detailId: string | null }) {
  const { storeId, overview, plan, go, onToast, onNavigateBilling } = props
  const lessons = useResource<readonly InsightLesson[]>(storeId ? () => api.fetchInsightLessons(storeId).then((result) => result.items) : null, [storeId])
  const recommended = useResource<readonly InsightLesson[]>(storeId ? () => api.fetchRecommendedLessons(storeId) : null, [storeId])
  const [generating, setGenerating] = useState(false)

  const generate = async () => {
    if (!storeId) return
    setGenerating(true)
    try {
      const result = await api.generateInsightLessons(storeId)
      onToast(result.generated > 0 ? `Compiled ${result.generated} lesson${result.generated === 1 ? '' : 's'} from your data.` : 'No new lessons yet — the library stays honest when data is thin.', 'success')
      lessons.reload(); recommended.reload()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) onToast('Lesson generation limit reached. Upgrade Plan for a deeper library.', 'warning')
      else onToast(error instanceof Error ? error.message : 'Lesson generation failed.', 'error')
    } finally { setGenerating(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={BookOpen} title="Connect your store first" body="Lessons are compiled from your store's own history." />
  if (props.detailId) return <LessonReader storeId={storeId} id={props.detailId} onBack={() => go('lessons', null)} onToast={onToast} />

  const generationLocked = overview ? !overview.features.lessons : plan === 'trial'
  const items = lessons.data ?? []

  return (
    <section>
      <div className="ih-toolbar">
        <div className="ih-toolbar-filters"><span className="ih-muted">{items.length} lesson{items.length === 1 ? '' : 's'} · {items.filter((lesson) => lesson.readAt).length} read</span></div>
        <div className="ih-toolbar-actions">
          {generationLocked
            ? <button className="button primary" onClick={onNavigateBilling}><Lock size={12} /> {INSIGHTS_UPGRADE_CTA}</button>
            : <button className="button primary" onClick={() => void generate()} disabled={generating}><BookOpen size={13} /> {generating ? 'Writing lessons…' : 'Generate lessons'}</button>}
        </div>
      </div>

      {lessons.status === 'loading' && <InsightsSkeleton rows={4} />}
      {lessons.status === 'error' && <InsightsErrorPanel message={lessons.message ?? 'Lessons failed to load.'} onRetry={lessons.reload} />}
      {lessons.status === 'ready' && items.length === 0 && (
        <InsightsEmptyState icon={BookOpen} title="Your learning library is empty" body="Lessons are short, data-grounded briefings compiled from your store's own patterns. Generate your first batch — nothing here is generic blog filler." action={!generationLocked ? <button className="button primary compact" onClick={() => void generate()}>Generate lessons</button> : <InsightsUpgradeCta onNavigateBilling={onNavigateBilling} compact />} />
      )}

      {recommended.data && recommended.data.length > 0 && (
        <div className="ih-recommended">
          <span className="section-kicker"><Lightbulb size={11} /> RECOMMENDED FOR YOU — FROM YOUR PATTERNS</span>
          <div className="ih-recommended-row">
            {recommended.data.slice(0, 3).map((lesson) => (
              <button key={lesson.id} className="ih-recommended-chip" onClick={() => go('lessons', lesson.id)}>{lesson.sample && <SampleBadge />} {lesson.title} <ChevronRight size={12} /></button>
            ))}
          </div>
        </div>
      )}

      <div className="ih-lesson-grid">
        {items.map((lesson) => (
          <button key={lesson.id} className={`ih-lesson-card ${lesson.readAt ? 'read' : ''}`} onClick={() => go('lessons', lesson.id)}>
            <header><span className="ih-type-badge lesson">{LESSON_TYPE_LABELS[lesson.lessonType]}</span><span className="ih-category">{DISCOVERY_CATEGORY_LABELS[lesson.category]}</span>{lesson.sample && <SampleBadge />}{lesson.bookmarked && <Star size={11} className="ih-bookmarked" />}</header>
            <h3>{lesson.title}</h3>
            <p>{lesson.summary}</p>
            <footer><span><Clock3 size={11} /> {lesson.readingTimeMinutes} min read</span>{lesson.rating !== null && <span className="ih-muted">Rated {lesson.rating}/5</span>}{lesson.readAt ? <span className="ih-read-flag"><CheckCircle2 size={11} /> Read</span> : <span className="ih-unread-flag">Unread</span>}</footer>
          </button>
        ))}
      </div>
    </section>
  )
}

function LessonReader({ storeId, id, onBack, onToast }: { storeId: string; id: string; onBack: () => void; onToast: (m: string, k?: InsightsToastKind) => void }) {
  const state = useResource<InsightLesson>(() => api.fetchInsightLesson(storeId, id), [storeId, id])
  const lesson = state.data
  useEffect(() => {
    if (lesson && !lesson.readAt) void api.markInsightLessonRead(storeId, id).catch(() => undefined)
  }, [lesson, storeId, id])
  if (state.status === 'loading') return <InsightsSkeleton rows={6} />
  if (!lesson) return <InsightsErrorPanel message={state.message ?? 'Lesson not found.'} onRetry={state.reload} />
  return (
    <section className="ih-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to the library</button>
      <article className="ih-card ih-detail-card ih-reader">
        <header className="ih-detail-head"><span className="ih-type-badge lesson">{LESSON_TYPE_LABELS[lesson.lessonType]}</span><span className="ih-category">{DISCOVERY_CATEGORY_LABELS[lesson.category]}</span>{lesson.sample && <SampleBadge />}<span className="ih-muted"><Clock3 size={11} /> {lesson.readingTimeMinutes} min</span></header>
        <h2>{lesson.title}</h2>
        <p className="ih-detail-description">{lesson.summary}</p>
        <MarkdownLite markdown={lesson.contentMarkdown} />
        {lesson.actionItems.length > 0 && (
          <div className="ih-actions-list">
            <h4><Lightbulb size={13} /> Do this next</h4>
            <ul>{lesson.actionItems.map((item) => <li key={item}><CheckCircle2 size={12} /> {item}</li>)}</ul>
          </div>
        )}
        <footer className="ih-detail-actions">
          <RatingStars value={lesson.rating} onRate={async (rating) => { try { await api.rateInsightLesson(storeId, id, rating); onToast('Thanks — ratings tune future lessons.', 'success'); state.reload() } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Rating failed.', 'error') } }} />
          <button className="button ghost compact" onClick={async () => { try { await api.bookmarkInsightLesson(storeId, id, !lesson.bookmarked); state.reload() } catch { onToast('Bookmark failed.', 'error') } }}><Star size={12} fill={lesson.bookmarked ? 'currentColor' : 'none'} /> {lesson.bookmarked ? 'Bookmarked' : 'Bookmark'}</button>
        </footer>
      </article>
    </section>
  )
}

/* ── Pattern lab ───────────────────────────────────────────────────────── */

function PatternsTab({ storeId, overview, plan, onToast, onNavigateBilling, exportEnabled, onExportLocked }: TabProps) {
  const patterns = useResource(storeId ? () => api.fetchInsightPatterns(storeId) : null, [storeId])
  const [detecting, setDetecting] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)

  const detect = async () => {
    if (!storeId) return
    setDetecting(true)
    try {
      const result = await api.detectInsightPatterns(storeId)
      onToast(result.detected > 0 ? `Pattern sweep found ${result.detected} recurring structure${result.detected === 1 ? '' : 's'}.` : 'No recurring patterns at the current confidence bar yet.', 'success')
      patterns.reload()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) onToast('Custom pattern detection unlocks with a plan upgrade.', 'warning')
      else onToast(error instanceof Error ? error.message : 'Pattern sweep failed.', 'error')
    } finally { setDetecting(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={Brain} title="Connect your store first" body="The pattern lab watches your real order rhythm." />
  const items = patterns.data?.patterns ?? []
  const detectionLocked = overview ? !overview.features.patterns : plan === 'trial'
  const bubbles = patternBubbles(items.filter((pattern) => pattern.status === 'ACTIVE'))

  return (
    <section>
      <div className="ih-toolbar">
        <div className="ih-toolbar-filters"><span className="ih-muted">{items.filter((pattern) => pattern.status === 'ACTIVE').length} active pattern{items.filter((pattern) => pattern.status === 'ACTIVE').length === 1 ? '' : 's'}{patterns.data?.viewOnly ? ' · view-only gallery on your plan' : ''}</span></div>
        <div className="ih-toolbar-actions">
          <ChartExportButton targetRef={chartRef} filename="insights-pattern-bubbles" enabled={exportEnabled} onLocked={onExportLocked} />
          {detectionLocked
            ? <button className="button primary" onClick={onNavigateBilling}><Lock size={12} /> {INSIGHTS_UPGRADE_CTA}</button>
            : <button className="button primary" onClick={() => void detect()} disabled={detecting}><Brain size={13} /> {detecting ? 'Watching for patterns…' : 'Detect patterns'}</button>}
        </div>
      </div>

      {patterns.status === 'loading' && <InsightsSkeleton rows={4} />}
      {patterns.status === 'error' && <InsightsErrorPanel message={patterns.message ?? 'Patterns failed to load.'} onRetry={patterns.reload} />}
      {patterns.status === 'ready' && items.length === 0 && (
        <InsightsEmptyState icon={Brain} title="No patterns on record yet" body="Patterns are structures the engine has seen repeat across your data — weekly rhythms, product affinities, seasonal swells. Run detection once you have a few weeks of synced history." />
      )}

      {bubbles.length > 0 && (
        <div className="ih-card" ref={chartRef}>
          <div className="ih-card-head"><span className="section-kicker"><Brain size={11} /> PATTERN STRENGTH MAP</span><small>Bubble size = confirmed occurrences · axis = engine confidence</small></div>
          <InsightsBubbleChart points={bubbles.map((bubble) => ({ ...bubble, tone: bubble.type.toLowerCase() }))} xLabel="Confidence →" yLabel="Recurrence →" />
        </div>
      )}

      <div className="ih-pattern-list">
        {items.map((pattern) => (
          <article key={pattern.id} className={`ih-pattern-row status-${pattern.status.toLowerCase()}`}>
            <span className={`ih-type-badge pattern-${pattern.patternType.toLowerCase()}`}>{PATTERN_TYPE_LABELS[pattern.patternType]}</span>
            <div className="ih-pattern-copy">
              <strong>{pattern.title}</strong>
              <p>{pattern.description}</p>
              <small>Seen {pattern.occurrenceCount}× · first detected {formatRelativeTime(pattern.firstDetected)} · last confirmed {formatRelativeTime(pattern.lastConfirmed)}</small>
            </div>
            <ConfidencePill score={pattern.confidenceScore} />
            <div className="ih-pattern-actions">
              <button className={`icon-button ${pattern.alertsEnabled ? 'armed' : ''}`} title={pattern.alertsEnabled ? 'Alerting when this pattern breaks' : 'Enable break alerts'} onClick={async () => { try { await api.setInsightPatternAlerts(storeId, pattern.id, !pattern.alertsEnabled); patterns.reload() } catch (error: unknown) { if (error instanceof ApiClientError && error.status === 402) { onToast('Pattern alerts unlock with a plan upgrade.', 'warning'); onNavigateBilling() } else onToast('Could not toggle the alert.', 'error') } }}>{pattern.alertsEnabled ? <Bell size={14} /> : <BellOff size={14} />}</button>
              {pattern.status === 'ACTIVE' && <button className="icon-button" title="Invalidate pattern" onClick={async () => { try { await api.invalidateInsightPattern(storeId, pattern.id); onToast('Pattern invalidated — it will need fresh evidence to return.', 'info'); patterns.reload() } catch { onToast('Could not invalidate the pattern.', 'error') } }}><Trash2 size={14} /></button>}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ── Personas ──────────────────────────────────────────────────────────── */

function PersonasTab(props: TabProps & { detailId: string | null }) {
  const { storeId, overview, plan, go, onToast, onNavigateBilling } = props
  const personas = useResource(storeId ? () => api.fetchInsightPersonas(storeId) : null, [storeId])
  const [generating, setGenerating] = useState(false)

  const generate = async () => {
    if (!storeId) return
    setGenerating(true)
    try {
      const result = await api.generateInsightPersonas(storeId)
      if (result.generated === 0) onToast(`Not enough customers yet — personas need at least ${result.readiness.personasRequirement.need} (you have ${result.readiness.personasRequirement.have}).`, 'info')
      else onToast(`Identified ${result.generated} persona${result.generated === 1 ? '' : 's'} in your customer base.`, 'success')
      personas.reload()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) { onToast('Persona science unlocks with a plan upgrade.', 'warning'); onNavigateBilling() }
      else onToast(error instanceof Error ? error.message : 'Persona generation failed.', 'error')
    } finally { setGenerating(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={Users} title="Connect your store first" body="Personas are built from your real customer history." />
  const locked = overview ? !overview.features.personas : plan === 'trial'
  if (locked) return <InsightsLockedPanel feature="personas" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />
  if (props.detailId) return <PersonaDetail storeId={storeId} id={props.detailId} onBack={() => go('personas', null)} onToast={onToast} />

  const readiness = personas.data?.readiness ?? overview?.readiness ?? null
  const items = personas.data?.personas ?? []

  return (
    <section>
      <div className="ih-toolbar">
        <div className="ih-toolbar-filters"><span className="ih-muted">{items.length} persona{items.length === 1 ? '' : 's'} identified</span></div>
        <div className="ih-toolbar-actions"><button className="button primary" onClick={() => void generate()} disabled={generating}><Users size={13} /> {generating ? 'Studying your customers…' : items.length > 0 ? 'Rebuild personas' : 'Identify personas'}</button></div>
      </div>
      {personas.status === 'loading' && <InsightsSkeleton rows={3} />}
      {personas.status === 'ready' && items.length === 0 && readiness && (
        <InsightsEmptyState
          icon={Users}
          title={readiness.canPersonas ? 'Ready when you are' : `Personas require at least ${readiness.personasRequirement.need} customers`}
          body={readiness.canPersonas ? 'Run persona identification to cluster your customer base into named, actionable segments.' : `Persona science clusters real customers — it needs ${readiness.personasRequirement.need} of them and you currently have ${readiness.personasRequirement.have}. Every synced customer gets you closer.`}
          action={<div className="ih-readiness"><span style={{ width: `${Math.min(100, (readiness.personasRequirement.have / readiness.personasRequirement.need) * 100)}%` }} /></div>}
        />
      )}
      <div className="ih-persona-grid">
        {items.map((persona) => (
          <button key={persona.id} className="ih-persona-card" onClick={() => go('personas', persona.id)}>
            <span className="ih-persona-emoji" aria-hidden="true">{persona.personaEmoji}</span>
            <h3>{persona.personaName}</h3>
            <span className="ih-persona-share">{personaShare(persona)} · {formatInsightNumber(persona.customerCount)} people</span>
            <span className="ih-persona-impact">{formatInsightMoney(persona.estimatedRevenueImpact, persona.revenueCurrency)} lifetime value</span>
            <ConfidencePill score={persona.confidenceScore} />
          </button>
        ))}
      </div>
    </section>
  )
}

function PersonaDetail({ storeId, id, onBack, onToast }: { storeId: string; id: string; onBack: () => void; onToast: (m: string, k?: InsightsToastKind) => void }) {
  const persona = useResource<InsightPersona>(() => api.fetchInsightPersona(storeId, id), [storeId, id])
  const customers = useResource(() => api.fetchInsightPersonaCustomers(storeId, id), [storeId, id])
  if (persona.status === 'loading') return <InsightsSkeleton rows={5} />
  if (!persona.data) return <InsightsErrorPanel message={persona.message ?? 'Persona not found.'} onRetry={persona.reload} />
  const data = persona.data
  return (
    <section className="ih-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to personas</button>
      <article className="ih-card ih-detail-card">
        <header className="ih-detail-head"><span className="ih-persona-emoji large">{data.personaEmoji}</span><div><h2>{data.personaName}</h2><p className="ih-detail-description">{personaShare(data)} — {formatInsightMoney(data.estimatedRevenueImpact, data.revenueCurrency)} lifetime value across {formatInsightNumber(data.customerCount)} customers.</p></div><ConfidencePill score={data.confidenceScore} /></header>
        <div className="ih-persona-detail-grid">
          <div className="ih-persona-radar"><InsightsRadarChart traits={data.radar} /></div>
          <div className="ih-persona-lists">
            <h4>How they behave</h4>
            <ul>{data.behaviorPatterns.map((item) => <li key={item}>{item}</li>)}</ul>
            <h4>What motivates them</h4>
            <ul>{data.motivations.map((item) => <li key={item}>{item}</li>)}</ul>
            <h4>How to reach them</h4>
            <ul>{data.howToReach.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
        {customers.data && (
          <div className="ih-persona-customers">
            <h4><Users size={13} /> The segment, anonymized</h4>
            <p className="ih-muted">Average {customers.data.aggregate.avgOrders} orders · average {formatInsightMoney(customers.data.aggregate.avgLifetimeValue, customers.data.aggregate.currency)} lifetime value. Customer identities stay private — aggregates only.</p>
            <div className="ih-anon-chips">{customers.data.anonymizedSample.map((label) => <span key={label}>{label}</span>)}</div>
          </div>
        )}
        <footer className="ih-detail-actions"><button className="button secondary compact" onClick={() => { navigator.clipboard?.writeText(`${data.personaName} — ${personaShare(data)}`).then(() => onToast('Persona summary copied.', 'success'), () => onToast('Copy failed.', 'error')) }}><Copy size={12} /> Copy summary</button></footer>
      </article>
    </section>
  )
}

/* ── Why? explorer ─────────────────────────────────────────────────────── */

function WhyTab(props: TabProps & { detailId: string | null }) {
  const { storeId, overview, plan, go, onToast, onNavigateBilling } = props
  const investigations = useResource(storeId ? () => api.fetchInsightInvestigations(storeId).then((result) => result.items) : null, [storeId])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)

  const ask = async (text: string) => {
    if (!storeId || !text.trim()) return
    setAsking(true)
    try {
      const result = await api.askInsightsWhy(storeId, text.trim())
      onToast('Investigation complete — root causes ranked by impact.', 'success')
      setQuestion('')
      investigations.reload()
      go('why', result.id)
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) { onToast('Your Why? quota for this period is used up. Upgrade Plan for more investigations.', 'warning') }
      else onToast(error instanceof Error ? error.message : 'Investigation failed.', 'error')
    } finally { setAsking(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={HelpCircle} title="Connect your store first" body="Why? answers come from your own numbers." />
  const locked = overview ? !overview.features.investigations : plan === 'trial'
  if (locked) return <InsightsLockedPanel feature="investigations" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />
  if (props.detailId) return <InvestigationDetail storeId={storeId} id={props.detailId} onBack={() => go('why', null)} onToast={onToast} />

  const quota = overview?.usage.investigations ?? null
  return (
    <section>
      <div className="ih-why-box">
        <h3><Microscope size={15} /> Ask why anything happened</h3>
        <p>The explorer decomposes your real metrics — revenue into orders and basket size, products into mix shifts — and ranks root causes by measured impact.</p>
        <form className="ih-why-form" onSubmit={(event) => { event.preventDefault(); void ask(question) }}>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Why did revenue drop last week?" maxLength={400} aria-label="Ask a why question" />
          <button className="button primary" type="submit" disabled={asking || !question.trim()}>{asking ? 'Investigating…' : 'Investigate'}</button>
        </form>
        <div className="ih-why-suggestions">
          {SUGGESTED_WHY_QUESTIONS.map((suggestion) => <button key={suggestion} className="ih-suggestion" onClick={() => void ask(suggestion)} disabled={asking}>{suggestion}</button>)}
        </div>
        {quota && quota.limit !== null && <UsageMeterBar label="Investigations this month" used={quota.used} limit={quota.limit} />}
      </div>

      {investigations.status === 'loading' && <InsightsSkeleton rows={3} />}
      {investigations.status === 'ready' && (investigations.data?.length ?? 0) === 0 && (
        <InsightsEmptyState icon={HelpCircle} title="No investigations yet" body="Ask your first Why? question above. Every answer cites the exact rows of your data that support it." />
      )}
      <div className="ih-investigation-list">
        {(investigations.data ?? []).map((investigation) => (
          <button key={investigation.id} className="ih-investigation-row" onClick={() => go('why', investigation.id)}>
            <HelpCircle size={15} />
            <div><strong>{investigation.question}</strong><small>{investigation.rootCauses.length} root cause{investigation.rootCauses.length === 1 ? '' : 's'} · {formatRelativeTime(investigation.createdAt)}</small></div>
            <ConfidencePill score={investigation.confidenceScore} />
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
    </section>
  )
}

function InvestigationDetail({ storeId, id, onBack, onToast }: { storeId: string; id: string; onBack: () => void; onToast: (m: string, k?: InsightsToastKind) => void }) {
  const state = useResource<InsightInvestigation>(() => api.fetchInsightInvestigation(storeId, id), [storeId, id])
  if (state.status === 'loading') return <InsightsSkeleton rows={6} />
  if (!state.data) return <InsightsErrorPanel message={state.message ?? 'Investigation not found.'} onRetry={state.reload} />
  const item = state.data
  return (
    <section className="ih-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to Why?</button>
      <article className="ih-card ih-detail-card">
        <header className="ih-detail-head"><span className={`ih-type-badge status-${item.status.toLowerCase()}`}>{item.status === 'COMPLETED' ? 'Solved' : 'In progress'}</span><ConfidencePill score={item.confidenceScore} /></header>
        <h2>{item.question}</h2>
        <div className="ih-steps">
          <h4>How the answer was built</h4>
          <ol>{item.steps.map((step, index) => <li key={index}><span className="ih-step-index">{index + 1}</span>{step}</li>)}</ol>
          <p className="ih-muted">Data examined: {item.dataSourcesAnalyzed.join(' · ')}</p>
        </div>
        <div className="ih-causes">
          <h4>Root causes, ranked by measured impact</h4>
          {item.rootCauses.length === 0 && <p className="ih-muted">No dominant cause surfaced — the movement is within normal variance.</p>}
          {item.rootCauses.map((cause) => (
            <div key={cause.cause} className="ih-cause">
              <div className="ih-cause-head"><strong>{cause.cause}</strong><span>{Math.round(cause.impactShare * 100)}% of the movement</span></div>
              <div className="ih-cause-bar"><span style={{ width: `${Math.round(cause.impactShare * 100)}%` }} /></div>
              <p>{cause.evidence}</p>
            </div>
          ))}
        </div>
        {item.whatToDo.length > 0 && <div className="ih-actions-list"><h4><Lightbulb size={13} /> What to do</h4><ul>{item.whatToDo.map((tip) => <li key={tip}><CheckCircle2 size={12} /> {tip}</li>)}</ul></div>}
        {item.preventionTips.length > 0 && <div className="ih-actions-list"><h4>Prevent the repeat</h4><ul>{item.preventionTips.map((tip) => <li key={tip}>{tip}</li>)}</ul></div>}
        <footer className="ih-detail-actions"><span className="ih-muted">Was this answer useful?</span><RatingStars value={null} onRate={async (rating) => { try { await api.rateInsightInvestigation(storeId, id, rating); onToast('Thanks — this tunes future investigations.', 'success') } catch { onToast('Rating failed.', 'error') } }} /></footer>
      </article>
    </section>
  )
}

/* ── Trends ────────────────────────────────────────────────────────────── */

function TrendsTab({ storeId, overview, plan, onToast, onNavigateBilling, exportEnabled, onExportLocked }: TabProps) {
  const business = useResource(storeId ? () => api.fetchBusinessTrends(storeId) : null, [storeId])
  const market = useResource(storeId ? () => api.fetchMarketTrends(storeId) : null, [storeId])
  const chartRef = useRef<HTMLDivElement>(null)

  if (!storeId) return <InsightsEmptyState icon={TrendingUp} title="Connect your store first" body="Trend watching needs synced history." />
  const trends = business.data?.trends ?? []
  const freshness = TREND_FRESHNESS_LABELS[business.data?.freshness ?? ''] ?? business.data?.freshness ?? ''
  const locked = overview ? !overview.features.externalTrends : plan === 'trial'
  const readiness = overview?.readiness ?? null

  return (
    <section>
      <div className="ih-toolbar">
        <div className="ih-toolbar-filters"><span className="ih-muted">{trends.length} signal{trends.length === 1 ? '' : 's'} under watch{freshness ? ` · ${freshness.toLowerCase()}` : ''}</span></div>
        <div className="ih-toolbar-actions"><ChartExportButton targetRef={chartRef} filename="insights-trend-scatter" enabled={exportEnabled} onLocked={onExportLocked} /></div>
      </div>

      {readiness && !readiness.canTrends && (
        <div className="ih-banner info"><Clock3 size={13} /> Trend watching sharpens with history — {readiness.trendsRequirement.have} of {readiness.trendsRequirement.need} days synced. Signals strengthen automatically as data lands.</div>
      )}

      {business.status === 'loading' && <InsightsSkeleton rows={4} />}
      {business.status === 'error' && <InsightsErrorPanel message={business.message ?? 'Trends failed to load.'} onRetry={business.reload} />}

      {trends.length > 0 && (
        <div className="ih-card" ref={chartRef}>
          <div className="ih-card-head"><span className="section-kicker"><Telescope size={11} /> SIGNAL MAP</span><small>Magnitude vs confidence — click a signal to filter it below</small></div>
          <InsightsScatter points={trendScatter(trends).map((point) => ({ ...point, tone: point.up ? 'cyan' : 'rose' }))} xLabel="Magnitude →" yLabel="Confidence →" />
        </div>
      )}

      <TrendSection title="Your business" tone="up" trends={trends.filter((trend) => trend.trendType === 'BUSINESS')} storeId={storeId ?? ''} onChanged={() => business.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />
      <TrendSection title="Emerging" tone="up" trends={trends.filter((trend) => trend.trendType === 'EMERGING')} storeId={storeId ?? ''} onChanged={() => business.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />
      <TrendSection title="Declining" tone="down" trends={trends.filter((trend) => trend.trendType === 'DECLINING')} storeId={storeId ?? ''} onChanged={() => business.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />

      <div className="ih-trend-section">
        <h3><Telescope size={14} /> Market</h3>
        {locked
          ? <InsightsLockedPanel feature="externalTrends" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />
          : market.status === 'ready' && market.data && !market.data.available
            ? <div className="ih-honest-note"><Telescope size={14} /><div><strong>Outside signals stay honest here</strong><p>{market.data.message}</p></div></div>
            : (market.data?.trends ?? []).map((trend) => <TrendRow key={trend.id} trend={trend} storeId={storeId ?? ''} onChanged={() => market.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />)}
      </div>
    </section>
  )
}

function TrendSection({ title, tone, trends, storeId, onChanged, onToast, onNavigateBilling }: { title: string; tone: 'up' | 'down'; trends: readonly InsightTrend[]; storeId: string; onChanged: () => void; onToast: (m: string, k?: InsightsToastKind) => void; onNavigateBilling: () => void }) {
  return (
    <div className="ih-trend-section">
      <h3>{tone === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {title}</h3>
      {trends.length === 0 && <p className="ih-muted">Nothing here yet — the watcher only speaks when your data says something.</p>}
      {trends.map((trend) => <TrendRow key={trend.id} trend={trend} storeId={storeId} onChanged={onChanged} onToast={onToast} onNavigateBilling={onNavigateBilling} />)}
    </div>
  )
}

function TrendRow({ trend, storeId, onChanged, onToast, onNavigateBilling }: { trend: InsightTrend; storeId: string; onChanged: () => void; onToast: (m: string, k?: InsightsToastKind) => void; onNavigateBilling: () => void }) {
  return (
    <article className={`ih-trend-row dir-${trend.direction.toLowerCase()}`}>
      <span className="ih-trend-arrow">{trend.direction === 'UP' ? <TrendingUp size={15} /> : trend.direction === 'DOWN' ? <TrendingDown size={15} /> : <ChevronRight size={15} />}</span>
      <div className="ih-trend-copy"><strong>{trend.title}</strong><p>{trend.description}</p><small>{TREND_TYPE_LABELS[trend.trendType]} · {trend.timePeriod} · {trend.dataSource === 'INTERNAL' ? 'your data' : trend.dataSource.toLowerCase()} · {formatPercent(trend.magnitude, 1)} movement</small></div>
      <ConfidencePill score={trend.confidenceScore} />
      <button className={`icon-button ${trend.alertsEnabled ? 'armed' : ''}`} title={trend.alertsEnabled ? 'Alerting on this trend' : 'Enable alerts'} onClick={async () => { try { await api.setInsightTrendAlerts(storeId, trend.id, !trend.alertsEnabled); onChanged() } catch (error: unknown) { if (error instanceof ApiClientError && error.status === 402) { onToast('Trend alerts unlock with a plan upgrade.', 'warning'); onNavigateBilling() } else onToast('Could not toggle the alert.', 'error') } }}>{trend.alertsEnabled ? <Bell size={14} /> : <BellOff size={14} />}</button>
    </article>
  )
}

/* ── Comparisons ───────────────────────────────────────────────────────── */

function ComparisonsTab(props: TabProps & { createMode: boolean; detailId: string | null }) {
  const { storeId, overview, plan, catalog, go, onToast, onNavigateBilling } = props
  const list = useResource(storeId ? () => api.fetchInsightComparisons(storeId).then((result) => result.items) : null, [storeId])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<{ type: ComparisonType; a: string; b: string }>({ type: 'PRODUCT', a: '', b: '' })

  const allowedTypes: readonly ComparisonType[] = useMemo(() => {
    if (!overview) return plan === 'trial' ? [] : plan === 'start' ? ['PRODUCT', 'PERIOD'] : COMPARISON_TYPES
    return overview.features.comparisons ? COMPARISON_TYPES.filter((type) => plan !== 'start' || type === 'PRODUCT' || type === 'PERIOD') : []
  }, [overview, plan])

  const run = async () => {
    if (!storeId || !form.a.trim() || !form.b.trim()) return
    setBusy(true)
    try {
      const comparison = await api.createInsightComparison(storeId, form.type, form.a.trim(), form.b.trim())
      onToast('Comparison complete — the winner is measured, not guessed.', 'success')
      list.reload()
      go('comparisons', comparison.id)
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) onToast('That comparison type is not included in your plan. Upgrade Plan to unlock all types.', 'warning')
      else onToast(error instanceof Error ? error.message : 'Comparison failed.', 'error')
    } finally { setBusy(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={Scale} title="Connect your store first" body="Comparisons settle debates with your synced numbers." />
  const locked = overview ? !overview.features.comparisons : plan === 'trial'
  if (locked) return <InsightsLockedPanel feature="comparisons" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />
  if (props.detailId) return <ComparisonDetail storeId={storeId} id={props.detailId} onBack={() => go('comparisons', null)} onToast={onToast} />

  const today = new Date().toISOString().slice(0, 10)
  const thirtyBack = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const sixtyBack = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)

  return (
    <section>
      <div className="ih-toolbar">
        <div className="ih-toolbar-filters"><span className="ih-muted">{list.data?.length ?? 0} comparison{(list.data?.length ?? 0) === 1 ? '' : 's'} run</span></div>
        <div className="ih-toolbar-actions">{!props.createMode && <button className="button primary" onClick={() => go('comparisons', 'new')}><Scale size={13} /> New comparison</button>}</div>
      </div>

      {(props.createMode || (list.data?.length ?? 0) === 0) && (
        <div className="ih-card ih-builder">
          <h3><Scale size={15} /> Build a comparison</h3>
          <div className="ih-builder-grid">
            <label>Type
              <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as ComparisonType }))}>
                {COMPARISON_TYPES.map((type) => <option key={type} value={type} disabled={!allowedTypes.includes(type)}>{COMPARISON_TYPE_LABELS_TEXT[type]}{allowedTypes.includes(type) ? '' : ' — plan upgrade'}</option>)}
              </select>
            </label>
            <label>Subject A{form.type === 'PRODUCT' ? <select value={form.a} onChange={(event) => setForm((current) => ({ ...current, a: event.target.value }))}><option value="">Pick a product…</option>{catalog.map((product) => <option key={product.productId} value={product.productId}>{productTitle(product)}</option>)}</select> : form.type === 'SEGMENT' ? <select value={form.a} onChange={(event) => setForm((current) => ({ ...current, a: event.target.value }))}><option value="">Pick a segment…</option>{SEGMENT_OPTIONS.map((segment) => <option key={segment.value} value={segment.value}>{segment.label}</option>)}</select> : <input value={form.a} onChange={(event) => setForm((current) => ({ ...current, a: event.target.value }))} placeholder={subjectPlaceholder(form.type, thirtyBack)} />}</label>
            <label>Subject B{form.type === 'PRODUCT' ? <select value={form.b} onChange={(event) => setForm((current) => ({ ...current, b: event.target.value }))}><option value="">Pick another product…</option>{catalog.map((product) => <option key={product.productId} value={product.productId}>{productTitle(product)}</option>)}</select> : form.type === 'SEGMENT' ? <select value={form.b} onChange={(event) => setForm((current) => ({ ...current, b: event.target.value }))}><option value="">Pick a segment…</option>{SEGMENT_OPTIONS.map((segment) => <option key={segment.value} value={segment.value}>{segment.label}</option>)}</select> : <input value={form.b} onChange={(event) => setForm((current) => ({ ...current, b: event.target.value }))} placeholder={subjectPlaceholder(form.type, sixtyBack)} />}</label>
          </div>
          {form.type === 'PERIOD' && <p className="ih-muted">Each period subject is a start day (YYYY-MM-DD); the engine compares the following 30-day windows. Today is {today}. Try {thirtyBack} vs {sixtyBack}.</p>}
          {form.type === 'CHANNEL' && <p className="ih-muted">Channel attribution depends on Shopify channel fields; if sync has not captured them, the comparison will tell you honestly instead of inventing a split.</p>}
          <div className="ih-builder-actions">
            {props.createMode && <button className="button ghost" onClick={() => go('comparisons', null)}><X size={12} /> Cancel</button>}
            <button className="button primary" disabled={busy || !form.a.trim() || !form.b.trim() || form.a.trim() === form.b.trim()} onClick={() => void run()}>{busy ? 'Measuring…' : 'Run comparison'}</button>
          </div>
        </div>
      )}

      {list.status === 'loading' && <InsightsSkeleton rows={3} />}
      {list.status === 'ready' && (list.data?.length ?? 0) === 0 && !props.createMode && null}
      <div className="ih-comparison-list">
        {(list.data ?? []).map((comparison) => (
          <button key={comparison.id} className="ih-comparison-row" onClick={() => go('comparisons', comparison.id)}>
            <Scale size={15} />
            <div><strong>{comparison.title}</strong><small>{COMPARISON_TYPE_LABELS_TEXT[comparison.comparisonType]} · {comparison.winner === 'INSUFFICIENT_DATA' ? 'not enough data yet' : comparison.winner === 'TIE' ? 'statistical tie' : `${subjectLabel(comparison.winner === 'A' ? comparison.subjectA : comparison.subjectB, comparison.winner)} leads`} · {formatRelativeTime(comparison.createdAt)}</small></div>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
    </section>
  )
}

export const COMPARISON_TYPE_LABELS_TEXT: Readonly<Record<ComparisonType, string>> = {
  PRODUCT: 'Product vs product',
  PERIOD: 'Period vs period',
  SEGMENT: 'Segment vs segment',
  CATEGORY: 'Category vs category',
  CHANNEL: 'Channel vs channel',
}

const SEGMENT_OPTIONS = [
  { value: 'REPEAT', label: 'Repeat buyers' },
  { value: 'ONE_TIME', label: 'One-time buyers' },
  { value: 'HIGH_VALUE', label: 'High value (top quartile)' },
  { value: 'AT_RISK', label: 'At risk (60+ days quiet)' },
] as const

function productTitle(product: CatalogProduct): string {
  const title = product.payload.title
  return typeof title === 'string' && title.trim() ? title : product.productId
}

function subjectPlaceholder(type: ComparisonType, example: string): string {
  if (type === 'PERIOD') return `Start day, e.g. ${example}`
  if (type === 'CATEGORY') return 'Category name from your product types'
  if (type === 'CHANNEL') return 'Channel name, e.g. online-store'
  return 'Subject identifier'
}

function ComparisonDetail({ storeId, id, onBack, onToast }: { storeId: string; id: string; onBack: () => void; onToast: (m: string, k?: InsightsToastKind) => void }) {
  const state = useResource<InsightComparison>(() => api.fetchInsightComparison(storeId, id), [storeId, id])
  if (state.status === 'loading') return <InsightsSkeleton rows={5} />
  if (!state.data) return <InsightsErrorPanel message={state.message ?? 'Comparison not found.'} onRetry={state.reload} />
  const item = state.data
  return (
    <section className="ih-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to comparisons</button>
      <article className="ih-card ih-detail-card">
        <header className="ih-detail-head"><span className="ih-type-badge compare">{COMPARISON_TYPE_LABELS_TEXT[item.comparisonType]}</span><span className="ih-muted">{formatRelativeTime(item.createdAt)}</span></header>
        <h2>{item.title}</h2>
        {item.winner === 'INSUFFICIENT_DATA'
          ? <div className="ih-honest-note"><Scale size={14} /><div><strong>Not enough data to call this one</strong><p>{item.insights[0] ?? 'Both subjects need more synced history before a fair verdict.'}</p></div></div>
          : <>
            <div className="ih-winner-banner">{item.winner === 'TIE' ? 'Statistical tie — neither side dominates.' : `${subjectLabel(item.winner === 'A' ? item.subjectA : item.subjectB, item.winner)} wins on the measured metrics.`}</div>
            <InsightsComparisonBars rows={item.metrics} />
            <div className="ih-delta-table">
              {item.metrics.map((metric) => <div key={metric.metric} className="ih-delta-row"><span>{metric.metric.replaceAll('_', ' ')}</span><strong className={metric.winner === 'TIE' ? '' : 'ih-delta'}>{comparisonDelta(metric)}</strong></div>)}
            </div>
            <ul className="ih-insight-bullets">{item.insights.map((insight) => <li key={insight}>{insight}</li>)}</ul>
          </>}
        <footer className="ih-detail-actions"><button className="button ghost compact subtle" onClick={async () => { try { await api.deleteInsightComparison(storeId, id); onToast('Comparison removed.', 'info'); onBack() } catch { onToast('Delete failed.', 'error') } }}><Trash2 size={12} /> Delete</button></footer>
      </article>
    </section>
  )
}

/* ── Knowledge base ────────────────────────────────────────────────────── */

function KnowledgeTab(props: TabProps & { detailId: string | null }) {
  const { storeId, overview, plan, go, onToast, onNavigateBilling } = props
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const list = useResource(storeId ? () => api.fetchInsightsKnowledge(storeId, { ...(activeTag ? { tag: activeTag } : {}), limit: 60 }).then((result) => result.items) : null, [storeId, activeTag])
  const [searchResults, setSearchResults] = useState<readonly InsightKnowledgeEntry[] | null>(null)
  const [editor, setEditor] = useState<null | { id: string | null; title: string; content: string; tags: string }>(null)
  const [saving, setSaving] = useState(false)

  const search = async () => {
    if (!storeId || !query.trim()) { setSearchResults(null); return }
    try { setSearchResults((await api.searchInsightsKnowledge(storeId, query.trim())).items) } catch { onToast('Search failed.', 'error') }
  }

  const save = async () => {
    if (!storeId || !editor || !editor.title.trim()) return
    setSaving(true)
    const tags = editor.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8)
    try {
      if (editor.id) await api.updateInsightsKnowledge(storeId, editor.id, { title: editor.title.trim(), contentMarkdown: editor.content, tags })
      else await api.createInsightsKnowledge(storeId, { entryType: 'NOTE', title: editor.title.trim(), contentMarkdown: editor.content, tags })
      onToast('Saved to your knowledge base.', 'success')
      setEditor(null)
      list.reload()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) onToast('Knowledge notes reach their plan limit. Upgrade Plan for unlimited notes.', 'warning')
      else onToast(error instanceof Error ? error.message : 'Save failed.', 'error')
    } finally { setSaving(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={Library} title="Connect your store first" body="Your knowledge base compounds insights." />
  const locked = overview ? !overview.features.knowledge : plan === 'trial'
  if (locked) return <InsightsLockedPanel feature="knowledge" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />

  const items = searchResults ?? list.data ?? []
  const cloud = tagCloud(list.data ?? [])
  const network = knowledgeNetwork(list.data ?? [])

  return (
    <section>
      <div className="ih-toolbar">
        <form className="ih-search" onSubmit={(event) => { event.preventDefault(); void search() }}>
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search everything the Hub has learned…" aria-label="Search knowledge base" />
          {searchResults && <button type="button" className="icon-button" onClick={() => { setSearchResults(null); setQuery('') }} aria-label="Clear search"><X size={13} /></button>}
        </form>
        <div className="ih-toolbar-actions"><button className="button primary" onClick={() => setEditor({ id: null, title: '', content: '', tags: '' })}><Library size={13} /> Add note</button></div>
      </div>

      {network.nodes.length > 1 && (
        <div className="ih-card ih-network-card">
          <div className="ih-card-head"><span className="section-kicker"><Network size={11} /> HOW YOUR KNOWLEDGE CONNECTS</span><small>Linked insights and notes</small></div>
          <InsightsNetworkGraph nodes={network.nodes} edges={network.edges} onSelect={(id) => go('knowledge', id)} />
        </div>
      )}

      {cloud.length > 0 && <InsightsWordCloud words={cloud} onSelect={(tag) => { setActiveTag((current) => (current === tag ? null : tag)); setSearchResults(null) }} />}
      {activeTag && <div className="ih-banner info"><Network size={13} /> Filtering by tag “{activeTag}”. <button className="text-button" onClick={() => setActiveTag(null)}>Clear</button></div>}

      {list.status === 'loading' && <InsightsSkeleton rows={4} />}
      {list.status === 'ready' && items.length === 0 && (
        <InsightsEmptyState icon={Library} title={searchResults ? 'Nothing matches that search' : 'The knowledge base is empty'} body={searchResults ? 'Try different words — the index searches titles, bodies, and tags.' : 'Insights, lessons, and your own notes accumulate here into a searchable company brain. Add your first note to start.'} />
      )}

      <div className="ih-knowledge-list">
        {items.map((entry) => (
          <article key={entry.id} className="ih-knowledge-row">
            <span className="ih-type-badge knowledge">{KNOWLEDGE_TYPE_LABELS[entry.entryType]}</span>
            <div className="ih-knowledge-copy">
              <strong>{entry.title}</strong>
              <p>{entry.contentMarkdown.slice(0, 160)}{entry.contentMarkdown.length > 160 ? '…' : ''}</p>
              <small>{entry.author === 'AI' ? 'Written by the Hub' : 'Your note'} · updated {formatRelativeTime(entry.updatedAt)}{entry.tags.length > 0 ? ` · ${entry.tags.join(', ')}` : ''}</small>
            </div>
            <div className="ih-pattern-actions">
              <button className="icon-button" title="Edit" onClick={() => setEditor({ id: entry.id, title: entry.title, content: entry.contentMarkdown, tags: entry.tags.join(', ') })}><BookOpen size={14} /></button>
              <button className="icon-button" title="Delete" onClick={async () => { try { await api.deleteInsightsKnowledge(storeId, entry.id); list.reload() } catch { onToast('Delete failed.', 'error') } }}><Trash2 size={14} /></button>
            </div>
          </article>
        ))}
      </div>

      {editor && (
        <div className="modal-overlay"><div className="modal-card ih-editor">
          <div className="modal-card-top"><div><div className="section-kicker"><Library size={12} /> KNOWLEDGE NOTE</div><h2>{editor.id ? 'Edit note' : 'New note'}</h2></div><button className="icon-button" onClick={() => setEditor(null)}><X size={17} /></button></div>
          <label>Title<input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="What did we learn?" maxLength={180} /></label>
          <label>Note<textarea value={editor.content} onChange={(event) => setEditor({ ...editor, content: event.target.value })} placeholder="Markdown supported — headings, lists, **bold**." rows={7} /></label>
          <label>Tags (comma separated)<input value={editor.tags} onChange={(event) => setEditor({ ...editor, tags: event.target.value })} placeholder="pricing, weekends, hoodies" /></label>
          <div className="modal-actions"><button className="button secondary" onClick={() => setEditor(null)}>Cancel</button><button className="button primary" disabled={saving || !editor.title.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save note'}</button></div>
        </div></div>
      )}
    </section>
  )
}

/** Nodes/edges between knowledge entries and the insights they link. */
export function knowledgeNetwork(entries: readonly InsightKnowledgeEntry[]): { nodes: readonly Readonly<{ id: string; label: string; kind: string }>[]; edges: readonly Readonly<{ from: string; to: string }>[] } {
  const withLinks = entries.filter((entry) => entry.linkedInsights.length > 0).slice(0, 8)
  const plain = entries.filter((entry) => entry.linkedInsights.length === 0).slice(0, Math.max(0, 10 - withLinks.length))
  const chosen = [...withLinks, ...plain]
  const ids = new Set(chosen.map((entry) => entry.id))
  const nodes = chosen.map((entry) => ({ id: entry.id, label: entry.title, kind: entry.entryType }))
  const edges: { from: string; to: string }[] = []
  for (const entry of chosen) for (const linked of entry.linkedInsights) if (ids.has(linked)) edges.push({ from: entry.id, to: linked })
  return { nodes, edges }
}

/* ── Timeline ──────────────────────────────────────────────────────────── */

function TimelineTab({ storeId, overview, plan, go, onNavigateBilling }: TabProps) {
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const timeline = useResource<TimelineResult>(storeId ? () => api.fetchInsightsTimeline(storeId, typeFilter === 'ALL' ? {} : { type: typeFilter as TimelineEntityTypeForApi }) : null, [storeId, typeFilter])

  if (!storeId) return <InsightsEmptyState icon={History} title="Connect your store first" body="Your insight timeline builds as the Hub works." />
  const events = timeline.data?.events ?? []
  const windowDays = timeline.data?.windowDays ?? null

  return (
    <section>
      <div className="ih-toolbar">
        <div className="ih-toolbar-filters">
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter timeline by type">
            <option value="ALL">Everything</option>
            {TIMELINE_TYPES.map((type) => <option key={type} value={type}>{TIMELINE_TYPE_LABELS[type]}</option>)}
          </select>
          <span className="ih-muted">{windowDays === null ? 'Full history' : `Last ${windowDays} days on your plan`}</span>
        </div>
        <div className="ih-toolbar-actions">{windowDays !== null && windowDays <= 30 && <InsightsUpgradeCta onNavigateBilling={onNavigateBilling} compact />}</div>
      </div>

      {timeline.status === 'loading' && <InsightsSkeleton rows={5} />}
      {timeline.status === 'ready' && events.length === 0 && <InsightsEmptyState icon={History} title="The timeline is waiting for its first entry" body="Every discovery, lesson, pattern, persona, investigation, trend, comparison, and prediction lands here as it happens. Run a discovery sweep to begin." />}
      {events.length > 0 && <InsightsTimelineStrip events={events.map((event) => ({ id: event.id, at: event.eventAt, label: `${TIMELINE_TYPE_LABELS[event.entityType]}: ${event.description}`, tone: event.entityType.toLowerCase() }))} onSelect={(id) => { const event = events.find((entry) => entry.id === id); if (event) go(tabForTimelineEntity(event.entityType), event.entityId) }} />}
      <ol className="ih-timeline">
        {events.map((event) => (
          <li key={event.id} className={`ih-timeline-event type-${event.entityType.toLowerCase()}`}>
            <button onClick={() => go(tabForTimelineEntity(event.entityType), event.entityId)}>
              <span className="ih-timeline-badge">{TIMELINE_TYPE_LABELS[event.entityType]}</span>
              <span className="ih-timeline-text">{event.description}</span>
              <time>{formatRelativeTime(event.eventAt)}</time>
            </button>
          </li>
        ))}
      </ol>
      {overview?.trial && <div className="ih-banner sample"><History size={13} /> Trial sees the last week of the timeline. {INSIGHTS_UPGRADE_CTA} for the full memory.</div>}
    </section>
  )
}

const TIMELINE_TYPES = ['DISCOVERY', 'LESSON', 'PATTERN', 'PERSONA', 'INVESTIGATION', 'TREND', 'COMPARISON', 'PREDICTION'] as const
type TimelineEntityTypeForApi = (typeof TIMELINE_TYPES)[number]

/* ── Predictions ───────────────────────────────────────────────────────── */

function PredictionsTab({ storeId, overview, plan, onToast, onNavigateBilling }: TabProps) {
  const [horizon, setHorizon] = useState<'ALL' | PredictionHorizon>('ALL')
  const predictions = useResource(storeId ? () => api.fetchInsightPredictions(storeId, horizon === 'ALL' ? undefined : horizon) : null, [storeId, horizon])
  const [generating, setGenerating] = useState(false)

  const generate = async () => {
    if (!storeId) return
    setGenerating(true)
    try {
      const result = await api.generateInsightPredictions(storeId)
      onToast(result.generated > 0 ? `Forecast updated — ${result.generated} projection${result.generated === 1 ? '' : 's'} with honest intervals.` : 'Not enough history yet to forecast responsibly.', 'success')
      predictions.reload()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) onToast('Predictions unlock with a plan upgrade.', 'warning')
      else onToast(error instanceof Error ? error.message : 'Forecast failed.', 'error')
    } finally { setGenerating(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={Sparkles} title="Connect your store first" body="Forecasts project your synced history." />
  const locked = overview ? !overview.features.predictions : plan === 'trial'
  if (locked) return <InsightsLockedPanel feature="predictions" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />

  const items = predictions.data?.predictions ?? []
  const allowedHorizons = predictions.data?.horizons ?? []
  const readiness = predictions.data?.readiness ?? overview?.readiness ?? null

  return (
    <section>
      <div className="ih-toolbar">
        <div className="ih-toolbar-filters">
          <select value={horizon} onChange={(event) => setHorizon(event.target.value as 'ALL' | PredictionHorizon)} aria-label="Filter by horizon">
            <option value="ALL">All horizons</option>
            {(Object.keys(HORIZON_LABELS) as PredictionHorizon[]).map((value) => <option key={value} value={value} disabled={allowedHorizons.length > 0 && !allowedHorizons.includes(value)}>{HORIZON_LABELS[value]}{allowedHorizons.length > 0 && !allowedHorizons.includes(value) ? ' — plan upgrade' : ''}</option>)}
          </select>
        </div>
        <div className="ih-toolbar-actions"><button className="button primary" onClick={() => void generate()} disabled={generating}><Sparkles size={13} /> {generating ? 'Projecting…' : 'Refresh forecasts'}</button></div>
      </div>

      {readiness && !readiness.canPredict && <div className="ih-banner info"><Clock3 size={13} /> Forecasting needs {readiness.predictRequirement.need} days of revenue history — you have {readiness.predictRequirement.have}. The model gets more honest every day you sync.</div>}
      {predictions.status === 'loading' && <InsightsSkeleton rows={3} />}
      {predictions.status === 'ready' && items.length === 0 && <InsightsEmptyState icon={Sparkles} title="No forecasts yet" body="Refresh forecasts and the engine projects revenue, orders, and stockouts from your real trend lines — every prediction ships with a confidence interval and an accuracy score once reality votes." />}
      <div className="ih-prediction-grid">
        {items.map((prediction) => <PredictionCard key={prediction.id} prediction={prediction} storeId={storeId} onChanged={() => predictions.reload()} onToast={onToast} />)}
      </div>
    </section>
  )
}

export function PredictionCard({ prediction, storeId, onChanged, onToast }: { prediction: InsightPrediction; storeId: string; onChanged: () => void; onToast: (m: string, k?: InsightsToastKind) => void }) {
  const [validating, setValidating] = useState(false)
  const [actual, setActual] = useState('')
  const isMoney = prediction.predictionType === 'REVENUE'
  const validate = async () => {
    const value = Number(actual)
    if (!Number.isFinite(value)) return
    setValidating(true)
    try { await api.validateInsightPrediction(storeId, prediction.id, value); onToast('Accuracy recorded — the model just got graded.', 'success'); onChanged() } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Validation failed.', 'error') } finally { setValidating(false); setActual('') }
  }
  return (
    <article className={`ih-card ih-prediction type-${prediction.predictionType.toLowerCase()}`}>
      <header className="ih-detail-head"><span className="ih-type-badge predict">{PREDICTION_TYPE_LABELS[prediction.predictionType]}</span><span className="ih-category">{HORIZON_LABELS[prediction.horizon]}</span><ConfidencePill score={prediction.confidenceScore} /></header>
      <h3>{prediction.title}</h3>
      <p>{prediction.description}</p>
      <div className="ih-prediction-figure">
        <strong>{isMoney ? formatInsightMoney(prediction.predictedValue, prediction.currency) : formatInsightNumber(prediction.predictedValue)}</strong>
        <span>range {isMoney ? formatInsightMoney(prediction.predictedLow, prediction.currency) : formatInsightNumber(prediction.predictedLow)} – {isMoney ? formatInsightMoney(prediction.predictedHigh, prediction.currency) : formatInsightNumber(prediction.predictedHigh)}</span>
      </div>
      <InsightsAreaBand series={prediction.series} formatValue={(value) => (isMoney ? formatInsightMoney(value, prediction.currency) : formatInsightNumber(value))} />
      <small className="ih-muted">Method: {prediction.method} · based on {prediction.basedOn.join(', ')}</small>
      {prediction.accuracyScore !== null
        ? <p className="ih-accuracy"><CheckCircle2 size={12} /> Actual: {isMoney ? formatInsightMoney(prediction.actualValue, prediction.currency) : formatInsightNumber(prediction.actualValue)} — accuracy {Math.round(prediction.accuracyScore * 100)}%</p>
        : <div className="ih-validate"><input value={actual} onChange={(event) => setActual(event.target.value)} placeholder="Actual value when the window closes" aria-label="Actual value" /><button className="button ghost compact" disabled={validating || !actual.trim()} onClick={() => void validate()}>Grade it</button></div>}
    </article>
  )
}

/* ── Settings ──────────────────────────────────────────────────────────── */

function SettingsTab({ storeId, plan, overview, onToast, onNavigateBilling }: TabProps) {
  const preferences = useResource<InsightsPreferences>(storeId ? () => api.fetchInsightsPreferences(storeId) : null, [storeId])
  const [saving, setSaving] = useState(false)

  const patch = async (body: Readonly<Record<string, unknown>>) => {
    if (!storeId) return
    setSaving(true)
    try { await api.updateInsightsPreferences(storeId, body); preferences.reload() } catch (error: unknown) { if (error instanceof ApiClientError && error.status === 402) { onToast('That setting unlocks with a plan upgrade.', 'warning'); onNavigateBilling() } else onToast(error instanceof Error ? error.message : 'Could not save preferences.', 'error') } finally { setSaving(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={Settings2} title="Connect your store first" body="Preferences shape how the Hub studies your data." />
  if (preferences.status === 'loading' || !preferences.data) return <InsightsSkeleton rows={4} />
  const prefs = preferences.data
  const autoDiscoveryPlanLocked = overview ? !overview.features.autoDiscovery : plan === 'trial'

  return (
    <section className="ih-settings">
      <div className="ih-card ih-settings-card">
        <h3><FlaskConical size={15} /> Auto-discovery</h3>
        <p className="ih-muted">The nightly sweep (2:00 AM UTC; Sundays for weekly) studies your newest synced data and files discoveries, patterns, and trends while you sleep.</p>
        <ToggleRow label="Auto-discovery" hint={autoDiscoveryPlanLocked ? 'Unlocks with a plan upgrade' : 'Run discovery automatically'} checked={prefs.autoDiscoveryEnabled && !autoDiscoveryPlanLocked} disabled={autoDiscoveryPlanLocked || saving} onChange={(value) => void patch({ autoDiscoveryEnabled: value })} />
        <div className="ih-field"><span>Frequency</span><div className="ih-choice-row">{(['DAILY', 'WEEKLY', 'REALTIME'] as const).map((frequency) => { const realtimeLocked = frequency === 'REALTIME' && plan !== 'commander'; return <button key={frequency} className={`ih-choice ${prefs.discoveryFrequency === frequency ? 'active' : ''}`} disabled={realtimeLocked || saving} onClick={() => void patch({ discoveryFrequency: frequency })} title={realtimeLocked ? 'Real-time unlocks on the highest plan' : undefined}>{frequency === 'REALTIME' ? 'Real-time' : frequency === 'DAILY' ? 'Daily 2:00 AM' : 'Weekly (Sunday)'}{realtimeLocked && <Lock size={10} />}</button> })}</div></div>
        <div className="ih-field"><span>Categories studied</span><div className="ih-choice-row wrap">{DISCOVERY_CATEGORIES.map((category) => { const active = prefs.discoveryCategories.includes(category); return <button key={category} className={`ih-choice ${active ? 'active' : ''}`} disabled={saving} onClick={() => void patch({ discoveryCategories: active ? prefs.discoveryCategories.filter((item) => item !== category) : [...prefs.discoveryCategories, category] })}>{DISCOVERY_CATEGORY_LABELS[category]}</button> })}</div></div>
      </div>

      <div className="ih-card ih-settings-card">
        <h3><Bell size={15} /> Notifications</h3>
        <ToggleRow label="High-confidence discoveries" hint="Ping me when confidence clears 85%" checked={prefs.notificationPreferences.highConfidenceDiscoveries} disabled={saving} onChange={(value) => void patch({ notificationPreferences: { ...prefs.notificationPreferences, highConfidenceDiscoveries: value } })} />
        <ToggleRow label="Trend alerts" hint="A watched trend accelerates or breaks" checked={prefs.notificationPreferences.trendAlerts} disabled={saving} onChange={(value) => void patch({ notificationPreferences: { ...prefs.notificationPreferences, trendAlerts: value } })} />
        <ToggleRow label="Anomaly alerts" hint="A day steps outside its normal band" checked={prefs.notificationPreferences.anomalyAlerts} disabled={saving} onChange={(value) => void patch({ notificationPreferences: { ...prefs.notificationPreferences, anomalyAlerts: value } })} />
        <ToggleRow label="Weekly digest" hint="A Sunday summary of the week’s learnings" checked={prefs.notificationPreferences.weeklyDigest} disabled={saving} onChange={(value) => void patch({ notificationPreferences: { ...prefs.notificationPreferences, weeklyDigest: value } })} />
      </div>

      <div className="ih-card ih-settings-card">
        <h3><Microscope size={15} /> Study behavior</h3>
        <ToggleRow label="Trend monitoring" hint="Keep business trend signals under watch" checked={prefs.trendMonitoringEnabled} disabled={saving} onChange={(value) => void patch({ trendMonitoringEnabled: value })} />
        <ToggleRow label="Persona refresh" hint="Re-cluster personas as customers evolve" checked={prefs.personaUpdatesEnabled} disabled={saving} onChange={(value) => void patch({ personaUpdatesEnabled: value })} />
        <div className="ih-field"><span>Insight language</span><div className="ih-choice-row"><button className={`ih-choice ${prefs.language === 'en' ? 'active' : ''}`} disabled={saving} onClick={() => void patch({ language: 'en' })}>English</button><button className={`ih-choice ${prefs.language === 'hi' ? 'active' : ''}`} disabled={saving} onClick={() => void patch({ language: 'hi' })}>हिन्दी</button></div></div>
        <p className="ih-muted">API access lives on its own page — {plan === 'commander' ? 'available on your plan.' : 'it unlocks on the highest plan.'} {plan !== 'commander' && <button className="text-button" onClick={onNavigateBilling}>{INSIGHTS_UPGRADE_CTA}</button>}</p>
      </div>
    </section>
  )
}

function ToggleRow({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="ih-toggle-row">
      <div><strong>{label}</strong><small>{hint}</small></div>
      <button className={`ih-toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
    </div>
  )
}

/* ── API access (Commander) ────────────────────────────────────────────── */

function ApiAccessTab({ storeId, plan, overview, onToast, onNavigateBilling }: TabProps) {
  const status = useResource(storeId ? () => api.fetchInsightsApiAccess(storeId) : null, [storeId])
  const docs = useResource(storeId ? () => api.fetchInsightsApiDocs(storeId) : null, [storeId])
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const generate = async (regenerate: boolean) => {
    if (!storeId) return
    setBusy(true)
    try {
      const result = regenerate ? await api.regenerateInsightsApiKey(storeId) : await api.generateInsightsApiKey(storeId)
      setRevealed(result.apiKey)
      onToast(regenerate ? 'New key issued — the previous key stopped working immediately.' : 'API key issued. Store it somewhere safe; this is the only reveal.', 'success')
      status.reload()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) onToast('API access unlocks on the highest plan.', 'warning')
      else onToast(error instanceof Error ? error.message : 'Could not issue a key.', 'error')
    } finally { setBusy(false) }
  }

  if (!storeId) return <InsightsEmptyState icon={KeyRound} title="Connect your store first" body="API access streams your insights to your own tools." />
  const locked = overview ? !overview.features.apiAccess : plan !== 'commander'
  if (locked) return <InsightsLockedPanel feature="apiAccess" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />
  if (status.status === 'loading') return <InsightsSkeleton rows={3} />
  if (status.status === 'error') return <InsightsErrorPanel message={status.message ?? 'API status failed to load.'} onRetry={status.reload} />
  const data = status.data

  return (
    <section className="ih-api">
      <div className="ih-card ih-settings-card">
        <h3><KeyRound size={15} /> Programmatic access</h3>
        <p className="ih-muted">Your insights as JSON — discoveries, patterns, personas, predictions, trends — for your own dashboards and automations. {data?.rateLimitPerHour !== null && data?.rateLimitPerHour !== undefined ? `${data.rateLimitPerHour} requests/hour · ${data.rateLimitPerHour * 10}/day.` : ''}</p>
        {data?.maskedKey
          ? <div className="ih-key-row"><code>{data.maskedKey}</code><button className="button secondary compact" disabled={busy} onClick={() => void generate(true)}>Regenerate</button><small className="ih-muted">Regenerating invalidates the old key instantly.</small></div>
          : <button className="button primary" disabled={busy} onClick={() => void generate(false)}>{busy ? 'Issuing…' : 'Generate API key'}</button>}
        {revealed && (
          <div className="ih-key-reveal">
            <strong>Your new key — shown once</strong>
            <div className="ih-key-row"><code>{revealed}</code><button className="button ghost compact" onClick={() => { navigator.clipboard?.writeText(revealed).then(() => onToast('Key copied.', 'success'), () => onToast('Copy failed.', 'error')) }}><Copy size={12} /> Copy</button></div>
            <button className="text-button" onClick={() => setRevealed(null)}>I have stored it safely — hide it</button>
          </div>
        )}
      </div>

      {data && (
        <div className="ih-card ih-settings-card">
          <h3><Zap size={15} /> Usage</h3>
          <div className="ih-usage-grid">
            <div className="ih-stat"><span>Requests this hour</span><strong>{formatInsightNumber(data.usage.requestsThisHour)}</strong>{data.rateLimitPerHour !== null && <small>of {data.rateLimitPerHour}</small>}</div>
            <div className="ih-stat"><span>Requests today</span><strong>{formatInsightNumber(data.usage.requestsToday)}</strong>{data.rateLimitPerHour !== null && <small>of {data.rateLimitPerHour * 10}</small>}</div>
          </div>
          {data.recent.length > 0 && <ol className="ih-api-recent">{data.recent.map((call, index) => <li key={`${call.calledAt}-${index}`}><code>{call.endpoint}</code><time>{formatRelativeTime(call.calledAt)}</time></li>)}</ol>}
        </div>
      )}

      <div className="ih-card ih-settings-card">
        <h3><BookOpen size={15} /> Quick start</h3>
        <pre className="ih-code">{`curl -H "Authorization: Bearer ihk_your_key" \\
  ${typeof window === 'undefined' ? 'https://your-profitpilot-host' : window.location.origin}/public-api/insights/discoveries?status=NEW`}</pre>
        <pre className="ih-code">{`// JavaScript
const res = await fetch('/public-api/insights/predictions', {
  headers: { Authorization: 'Bearer ihk_your_key' },
})
const { data } = await res.json()`}</pre>
        <pre className="ih-code">{`# Python
import requests
requests.get('https://your-profitpilot-host/public-api/insights/trends',
             headers={'Authorization': 'Bearer ihk_your_key'}).json()`}</pre>
        <p className="ih-muted">OpenAPI 3.1 spec: <a href={docs.data?.specUrl ?? '/public-api/insights/openapi.json'} target="_blank" rel="noreferrer">{docs.data?.specUrl ?? '/public-api/insights/openapi.json'}</a></p>
      </div>
    </section>
  )
}
