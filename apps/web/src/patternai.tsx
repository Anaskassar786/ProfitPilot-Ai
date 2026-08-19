/**
 * PatternAI workspace — "Discover the patterns that drive your business."
 *
 * The discovery module of AI Growth Command: FIND hidden patterns, LEARN from
 * the store's own history, UNDERSTAND why the business moves. PatternAI
 * deliberately does not coach (Store Coach), does not write strategy decks
 * (GrowthIQ), does not queue actions (Recommendations) and does not run agents
 * (AI Command Center) — it explains.
 *
 * The UI is a thin renderer over `/patternai/*` (served alongside the original
 * `/insights/*` prefix): source values come from the API and client summaries
 * only count or group those returned rows; locked plans see the generic
 * "Upgrade Plan" CTA; trial explores through clearly labelled samples.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Compass,
  Copy,
  Download,
  HelpCircle,
  History,
  KeyRound,
  Library,
  Lightbulb,
  Lock,
  Megaphone,
  Network,
  Package,
  Radar,
  RefreshCw,
  Scale,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  Waypoints,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ApiClientError } from './api.js'
import * as api from './api.js'
import type { CatalogProduct, WorkspaceContext } from './model.js'
import { PatternAiDiscoverGlyph, PatternAiMark } from './patternai-logo.js'
import {
  DiscoveryPipelineFunnel,
  FeedbackBalance,
  MiniCauseWeb,
  MiniDivergingBars,
  MiniProbabilityWave,
  MiniRadar,
  MiniScatter,
  MiniWordCloud,
  MomentumCompare,
  MoneyInPlay,
  MonthlyDiscoveryRing,
  PatternStrengthMeter,
  StatVisualization,
} from './patternai-viz.js'
import {
  COMPARISON_TYPES,
  DISCOVERY_CATEGORIES,
  DISCOVERY_CATEGORY_LABELS,
  DISCOVERY_STATUS_LABELS,
  DISCOVERY_TYPE_LABELS,
  HORIZON_LABELS,
  INSIGHTS_UPGRADE_CTA,
  PATTERN_AI_LEGACY_BASE_PATH,
  PATTERN_AI_TAGLINE,
  PLAN_LABELS,
  DISCOVERY_TYPE_HEADLINES,
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
  discoveryTone,
  insightsTabPurpose,
  isPatternAiPath,
  degradedNotice,
  decisionWindowSummary,
  discoveryFunnel,
  discoveryHeadline,
  discoveryImpactSummary,
  discoveryMomentum,
  humanEvidenceRows,
  investigationCauseNodes,
  lessonTopicCloud,
  meterPercent,
  monthlyDiscoveryProgress,
  patternStrengthRows,
  personaRadarAverage,
  predictionWavePoints,
  reviewBacklogSummary,
  signalFeedbackSummary,
  signalQualitySummary,
  trendDivergingRows,
  parseInsightsRoute,
  patternAiPlanSummary,
  patternAiStats,
  readinessChecklist,
  readinessPercent,
  patternBubbles,
  personaShare,
  subjectLabel,
  tabForTimelineEntity,
  tagCloud,
  trendScatter,
} from './patternai-model.js'
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
  InsightsDataReadiness,
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
} from './patternai-model.js'
import {
  InsightsAreaBand,
  InsightsBubbleChart,
  InsightsComparisonBars,
  InsightsHeatmap,
  InsightsNetworkGraph,
  InsightsRadarChart,
  InsightsScatter,
  InsightsTimelineStrip,
  InsightsTreeMap,
  InsightsWordCloud,
  downloadChartSvg,
} from './patternai-charts.js'

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

const LOCKED_FEATURE_PREVIEWS: Partial<Record<InsightsFeature, readonly string[]>> = {
  discoveries: ['On-demand sweeps of newly synced orders', 'Evidence, confidence and measured impact on every finding', 'A review-to-action discovery pipeline'],
  lessons: ['Briefings compiled from your own store history', 'Reading progress and merchant ratings', 'A private library that becomes more specific over time'],
  patterns: ['Recurring rhythms and affinities', 'Occurrence counts and confidence evidence', 'Alerts when an established pattern breaks'],
  personas: ['Behaviour-based customer groups', 'Measured customer share and lifetime value', 'Anonymized traits with the source evidence attached'],
  investigations: ['Plain-language “why?” questions', 'Root causes ranked by measured impact', 'The exact store sources used to build each answer'],
  comparisons: ['Product, period and segment comparisons', 'Side-by-side measured metrics', 'Honest insufficient-data verdicts when evidence is thin'],
  knowledge: ['Searchable discoveries, lessons and notes', 'Links between related store learnings', 'Merchant-authored notes alongside PatternAI evidence'],
  predictions: ['Forecast ranges rather than a single promise', 'Confidence, method and evidence disclosure', 'Accuracy grading after the forecast window closes'],
  apiAccess: ['Read-only discovery and pattern endpoints', 'A revocable key with visible usage limits', 'OpenAPI documentation for your own tools'],
  externalTrends: ['Verified benchmark sources only', 'Clear source and freshness labels', 'No generated or unverified market claims'],
}

export function InsightsLockedPanel({ feature, plan, overview, onNavigateBilling, note }: { feature: InsightsFeature; plan: PlanTier; overview: InsightsOverview | null; onNavigateBilling: () => void; note?: string }) {
  const lock = insightsFeatureLock(plan, feature, overview)
  if (!lock.locked) return null
  const preview = LOCKED_FEATURE_PREVIEWS[feature] ?? ['Evidence-backed analysis from your synced store data', 'Clear sources and confidence on every result', 'A focused workspace for reviewing what PatternAI learns']
  return (
    <div className="pa-locked" data-feature={feature}>
      <div className="pa-locked-heading">
        <span className="pa-locked-icon"><Lock size={18} /></span>
        <div>
          <span className="pa-eyebrow">Locked preview</span>
          <strong>This capability is locked on your current plan</strong>
        </div>
      </div>
      <p>{note ?? insightsUpgradeMessageText(feature)}</p>
      <div className="pa-locked-preview" aria-label="Preview of this capability">
        <span>What you&rsquo;ll be able to explore</span>
        <ul>{preview.map((item) => <li key={item}><CheckCircle2 size={13} /> {item}</li>)}</ul>
        <small>Preview only — no sample metrics or invented store results.</small>
      </div>
      <InsightsUpgradeCta onNavigateBilling={onNavigateBilling} />
    </div>
  )
}

function insightsUpgradeMessageText(feature: InsightsFeature): string {
  switch (feature) {
    case 'personas': return 'Customer personas group your buyers by measured behaviour, not guesswork. Unlock persona modelling with a plan upgrade.'
    case 'investigations': return 'The Why? explorer traces any metric drop to its root causes. Unlock investigations with a plan upgrade.'
    case 'comparisons': return 'Head-to-head comparisons settle product, period, and segment debates with your real numbers.'
    case 'knowledge': return 'The knowledge base compounds every discovery into a private library you can search later. Unlock it with a plan upgrade.'
    case 'predictions': return 'Forecasts project revenue, orders, and stockouts with honest confidence intervals.'
    case 'apiAccess': return 'Programmatic insight access for your own tools, with a dedicated API key and hourly quota.'
    case 'externalTrends': return 'External market trends appear here once a verified benchmark feed is connected — we never invent market data.'
    default: return 'This capability is not included in your current plan.'
  }
}

export function InsightsEmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="pa-empty">
      <span className="pa-empty-icon"><Icon size={20} /></span>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  )
}

/**
 * Honest, non-blaming failure state. A single failing section never removes
 * the rest of the page: this panel replaces only the section that failed and
 * always offers a retry, which is exactly what the old crash screen did not.
 */
export function InsightsErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="pa-error" role="alert">
      <span className="pa-error-icon"><TriangleAlert size={16} /></span>
      <div className="pa-error-copy">
        <strong>This section could not load</strong>
        <p>{message}</p>
      </div>
      <button className="pa-button ghost compact" onClick={onRetry}><RefreshCw size={12} /> Try again</button>
    </div>
  )
}

/**
 * Educational first-run state. Instead of an empty box, a merchant with no
 * discoveries yet sees exactly what PatternAI will show them and what data it
 * still needs — with real, API-computed progress on every requirement.
 */
export function PatternAiWelcome({ readiness, plan, onRunDiscovery, onNavigateBilling, canRun }: {
  readiness: InsightsDataReadiness | null
  plan: PlanTier
  onRunDiscovery: () => void
  onNavigateBilling: () => void
  canRun: boolean
}) {
  const checks = readinessChecklist(readiness)
  const capabilities: readonly Readonly<{ icon: LucideIcon; title: string; body: string }>[] = [
    { icon: Network, title: 'Hidden patterns', body: 'Weekly rhythms, product affinities and repeat-purchase structures found in your order history.' },
    { icon: BookOpen, title: 'Personalised lessons', body: 'Short briefings written from your numbers — not generic ecommerce advice.' },
    { icon: Users, title: 'Customer personas', body: 'Behaviour-based groups with real share, value and reach guidance.' },
    { icon: HelpCircle, title: 'Answers to "why?"', body: 'Trace a drop or a spike to ranked root causes with the evidence attached.' },
    { icon: TrendingUp, title: 'Trends, early', body: 'Movements flagged while they are still small enough to act on.' },
    { icon: Radar, title: 'Forecasts with ranges', body: 'Revenue, orders and stockout projections that state their own confidence.' },
  ]
  return (
    <section className="pa-welcome">
      <header className="pa-welcome-head">
        <PatternAiMark size={40} variant="badge" />
        <div>
          <h3>Welcome to PatternAI</h3>
          <p>{PATTERN_AI_TAGLINE}. Here is what appears on this page as your store data lands.</p>
        </div>
      </header>
      <div className="pa-welcome-grid">
        {capabilities.map(({ icon: Icon, title, body }) => (
          <article key={title} className="pa-welcome-card">
            <span className="pa-welcome-icon"><Icon size={16} /></span>
            <strong>{title}</strong>
            <p>{body}</p>
          </article>
        ))}
      </div>
      {checks.length > 0 && (
        <div className="pa-readiness">
          <span className="pa-eyebrow">Growing your pattern intelligence</span>
          <p className="pa-muted">PatternAI gets sharper as your store grows. These thresholds come from the engine — no discovery is published before its evidence exists.</p>
          <ul>
            {checks.map((check) => (
              <li key={check.id} className={check.met ? 'met' : ''}>
                <span className="pa-readiness-label">{check.met ? <CheckCircle2 size={13} /> : <Clock3 size={13} />} {check.label}</span>
                <span className="pa-readiness-track"><span style={{ width: `${readinessPercent(check)}%` }} /></span>
                <span className="pa-readiness-count">{formatInsightNumber(check.have)} / {formatInsightNumber(check.need)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <footer className="pa-welcome-actions">
        {canRun
          ? <button className="pa-button primary" onClick={onRunDiscovery}><Sparkles size={13} /> Run your first discovery</button>
          : <InsightsUpgradeCta onNavigateBilling={onNavigateBilling} />}
        {plan === 'trial' && <span className="pa-muted">Trial stores explore labelled samples; paid plans compute discoveries from your own data.</span>}
      </footer>
    </section>
  )
}

export function InsightsSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="pa-skeletons" aria-busy="true">{Array.from({ length: rows }, (_, index) => <span key={index} className="pa-skeleton" />)}</div>
}

export function ConfidencePill({ score }: { score: number }) {
  return <span className={`pa-confidence tone-${confidenceTone(score)}`} title={confidenceLabel(score)}><span style={{ width: `${confidencePercent(score)}%` }} />{confidencePercent(score)}%</span>
}

export function SampleBadge() {
  return <span className="pa-sample-badge" title="Generated from a labeled example so you can explore. Paid plans compute these from your synced data.">SAMPLE</span>
}

export function RatingStars({ value, onRate, disabled = false }: { value: number | null; onRate?: (rating: number) => void; disabled?: boolean }) {
  return (
    <span className="pa-stars" role={onRate ? 'radiogroup' : undefined} aria-label="Rate this insight">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} className={`pa-star ${value !== null && star <= value ? 'lit' : ''}`} disabled={disabled || !onRate} onClick={() => onRate?.(star)} aria-label={`${star} star${star === 1 ? '' : 's'}`}>
          <Star size={13} fill={value !== null && star <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  )
}

export function UsageMeterBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const percent = meterPercent(used, limit)
  return (
    <div className="pa-meter">
      <div className="pa-meter-head"><span>{label}</span><strong>{limit === null ? `${used} used` : `${used} / ${limit}`}</strong></div>
      {percent !== null && <div className="pa-meter-track"><span className={percent >= 100 ? 'blocked' : percent >= 80 ? 'warn' : ''} style={{ width: `${percent}%` }} /></div>}
    </div>
  )
}

/** Minimal, safe markdown subset for lesson bodies — no innerHTML. */
export function MarkdownLite({ markdown }: { markdown: string }) {
  const blocks = markdown.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return (
    <div className="pa-markdown">
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
  if (!enabled) return <button className="button ghost compact pa-export-locked" onClick={onLocked} title="Export unlocks with a plan upgrade"><Lock size={11} /> Export</button>
  return <button className="button ghost compact" onClick={() => void downloadChartSvg(targetRef.current, filename)} title="Download this chart as an SVG"><Download size={11} /> Export</button>
}

/* ── Section navigation ────────────────────────────────────────────────── */

type NavEntry = Readonly<{ tab: InsightsTab; icon: LucideIcon; feature: InsightsFeature | null }>
type NavGroup = Readonly<{ label: string; tone: 'discover' | 'understand' | 'remember' | 'workspace'; entries: readonly NavEntry[] }>

/**
 * Count badge for a nav row. Every badge is an API count — the sidebar never
 * shows a number the overview did not report, and it shows nothing at all
 * until the overview has answered.
 */
export function navBadgeCount(tab: InsightsTab, overview: InsightsOverview | null): number | null {
  if (!overview) return null
  const counts = overview.counts
  switch (tab) {
    case 'overview': return counts.newDiscoveries
    case 'discoveries': return counts.totalDiscoveries
    case 'lessons': return counts.lessons
    case 'patterns': return counts.patterns
    case 'personas': return counts.personas
    case 'why': return counts.investigations
    case 'trends': return counts.trends
    case 'comparisons': return counts.comparisons
    case 'knowledge': return counts.knowledge
    case 'predictions': return counts.predictions
    default: return null
  }
}

/**
 * Grouped navigation. PatternAI is a discovery product, so the order follows
 * the merchant's journey: see what was found → learn from it → go deeper →
 * look ahead → configure.
 */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Discover',
    tone: 'discover',
    entries: [
      { tab: 'overview', icon: Compass, feature: null },
      { tab: 'lessons', icon: BookOpen, feature: null },
      { tab: 'patterns', icon: Network, feature: null },
      { tab: 'personas', icon: Users, feature: 'personas' },
    ],
  },
  {
    label: 'Understand',
    tone: 'understand',
    entries: [
      { tab: 'why', icon: HelpCircle, feature: 'investigations' },
      { tab: 'trends', icon: TrendingUp, feature: 'trends' },
      { tab: 'comparisons', icon: Scale, feature: 'comparisons' },
    ],
  },
  {
    label: 'Remember & look ahead',
    tone: 'remember',
    entries: [
      { tab: 'knowledge', icon: Library, feature: 'knowledge' },
      { tab: 'timeline', icon: History, feature: 'timeline' },
      { tab: 'predictions', icon: Radar, feature: 'predictions' },
    ],
  },
  {
    label: 'Workspace',
    tone: 'workspace',
    entries: [
      { tab: 'settings', icon: Settings2, feature: null },
      { tab: 'api-access', icon: KeyRound, feature: 'apiAccess' },
    ],
  },
]

const ALL_NAV_ENTRIES: readonly NavEntry[] = NAV_GROUPS.flatMap((group) => group.entries)

/**
 * Compact data-quality snapshot for the hero. These are raw readiness fields
 * returned by PatternAI's API — never estimates — and they explain what the
 * discovery engine currently has available to study.
 */
export function PatternAiSnapshot({ overview }: { overview: InsightsOverview | null }) {
  const readiness = overview?.readiness ?? null
  const measures = [
    { id: 'history', label: 'Days observed', value: readiness ? formatInsightNumber(readiness.revenueDays) : '—' },
    { id: 'orders', label: 'Orders synced', value: readiness ? formatInsightNumber(readiness.totalOrders) : '—' },
    { id: 'customers', label: 'Customers seen', value: readiness ? formatInsightNumber(readiness.customerCount) : '—' },
    { id: 'products', label: 'Products selling', value: readiness ? formatInsightNumber(readiness.productsWithSales) : '—' },
  ] as const
  return (
    <aside className="pa-snapshot" aria-label="Your discovery snapshot">
      <div className="pa-snapshot-head">
        <span className="pa-eyebrow">Your discovery snapshot</span>
        <span className={`pa-data-status ${readiness?.canDiscover ? 'ready' : 'learning'}`}>
          <span />{readiness ? (readiness.canDiscover ? 'Ready to discover' : 'Building evidence') : 'Checking data'}
        </span>
      </div>
      <div className="pa-snapshot-measures">
        {measures.map((measure) => <span key={measure.id}><strong>{measure.value}</strong><small>{measure.label}</small></span>)}
      </div>
      <p>{readiness?.discoverRequirement ?? 'PatternAI is checking the synced history available for evidence-backed discoveries.'}</p>
    </aside>
  )
}

function discoveryCadenceLabel(overview: InsightsOverview | null): string {
  const preferences = overview?.preferences
  if (!preferences?.autoDiscoveryEnabled) return 'Manual discovery sweeps'
  if (preferences.discoveryFrequency === 'REALTIME') return 'Real-time discovery monitoring'
  if (preferences.discoveryFrequency === 'WEEKLY') return 'Weekly auto-discovery'
  return 'Daily auto-discovery'
}

/* ── Root workspace ────────────────────────────────────────────────────── */

export function PatternAiWorkspace({ context, catalog = [], onToast, onNavigateBilling }: InsightsWorkspaceProps) {
  const [route, setRoute] = useState(() => parseInsightsRoute(typeof window === 'undefined' ? '' : window.location.pathname))
  const overviewState = useResource<InsightsOverview>(context.storeId ? () => api.fetchInsightsOverview(context.storeId ?? '') : null, [context.storeId])
  const [planPanelOpen, setPlanPanelOpen] = useState(false)
  const [runningDiscovery, setRunningDiscovery] = useState(false)

  const go = useCallback((tab: InsightsTab, id: string | null = null) => {
    const path = insightsRoutePath(tab, id, typeof window === 'undefined' ? '' : window.location.search)
    try { window.history.pushState({}, '', path) } catch { /* embedded browsers may restrict history */ }
    setRoute({ tab, id })
  }, [])

  // Legacy /ai-growth-command/insights links are normalised to the PatternAI
  // path on first paint so shared URLs keep working after the rebrand.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.location.pathname.startsWith(PATTERN_AI_LEGACY_BASE_PATH)) return
    const parsed = parseInsightsRoute(window.location.pathname)
    try { window.history.replaceState({}, '', insightsRoutePath(parsed.tab, parsed.id, window.location.search)) } catch { /* embedded browsers may restrict history */ }
  }, [])

  useEffect(() => {
    const onPop = () => {
      if (isPatternAiPath(window.location.pathname)) setRoute(parseInsightsRoute(window.location.pathname))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const overview = overviewState.data
  const plan: PlanTier = overview?.plan ?? 'trial'
  const lockedFor = (feature: InsightsFeature): boolean => insightsFeatureLock(plan, feature, overview).locked
  const stats = patternAiStats(overview)
  const monthly = monthlyDiscoveryProgress(overview)
  const degraded = degradedNotice(overview)
  const activeEntry = ALL_NAV_ENTRIES.find((entry) => entry.tab === route.tab) ?? ALL_NAV_ENTRIES[0]!

  const shared = { storeId: context.storeId, overview, plan, catalog, go, onToast, onNavigateBilling, exportEnabled: !lockedFor('export'), onExportLocked: () => { onToast('Chart export unlocks with a plan upgrade.', 'info') } }

  const runDiscovery = async () => {
    if (!context.storeId) { onToast('Connect your store to run a discovery sweep.', 'info'); return }
    if (lockedFor('discoveries')) { onToast('The discovery engine unlocks with a plan upgrade.', 'warning'); onNavigateBilling(); return }
    if (runningDiscovery) return
    setRunningDiscovery(true)
    try {
      const result = await api.generateInsightsDiscoveries(context.storeId)
      onToast(result.generated > 0 ? `PatternAI found ${result.generated} new discover${result.generated === 1 ? 'y' : 'ies'} in your data.` : 'Nothing new crossed the confidence bar — PatternAI stays quiet rather than guessing.', 'success')
      overviewState.reload()
      go('overview')
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) { onToast('Your discovery allowance for this month is used up. Upgrade Plan to run another sweep.', 'warning'); onNavigateBilling() }
      else onToast(error instanceof Error ? error.message : 'The discovery sweep could not start.', 'error')
    } finally {
      setRunningDiscovery(false)
    }
  }

  return (
    <div className="pa-root" data-plan={plan}>
      <header className="pa-hero">
        <div className="pa-hero-main">
          <div className="pa-hero-identity">
            <PatternAiMark size={44} variant="badge" />
            <div>
              <h2 className="pa-hero-title">Pattern<em>AI</em></h2>
              <p className="pa-hero-tagline">{PATTERN_AI_TAGLINE}</p>
            </div>
          </div>
          <p className="pa-hero-body">PatternAI reads your synced Shopify history and surfaces the structures underneath it — the rhythms, the segments, the correlations you would never spot by eye. Every number below is computed from your store; nothing here is invented or borrowed from another shop.</p>
          <div className="pa-hero-actions">
            <button className="pa-button primary" onClick={() => void runDiscovery()} disabled={runningDiscovery} aria-busy={runningDiscovery}>
              {runningDiscovery ? <RefreshCw size={15} className="pa-spin" /> : <PatternAiDiscoverGlyph size={15} />} {runningDiscovery ? 'Examining your data…' : 'Run discovery'}
            </button>
            <button className="pa-button ghost" onClick={() => go('settings')}><Settings2 size={14} /> Settings</button>
            <button className="pa-plan-chip" onClick={() => setPlanPanelOpen((open) => !open)} aria-expanded={planPanelOpen}>
              <ShieldCheck size={13} /> {PLAN_LABELS[plan]} plan
              <ChevronRight size={13} className={planPanelOpen ? 'pa-chip-caret open' : 'pa-chip-caret'} />
            </button>
          </div>
          <PatternAiSnapshot overview={overview} />
        </div>
        <div className="pa-hero-stats" role="list" aria-label="PatternAI at a glance">
          {stats.map((stat) => (
            <div key={stat.id} className={`pa-stat viz-${stat.visual} ${(stat.count ?? 0) > 0 ? 'has-data' : 'is-empty'}`} role="listitem">
              <span className="pa-stat-label">{stat.label}</span>
              <strong className="pa-stat-value">{stat.value}</strong>
              <span className="pa-stat-caption">{stat.caption}</span>
              <StatVisualization visual={stat.visual} count={stat.count} pending={stat.pending} label={stat.label} />
            </div>
          ))}
        </div>
        {monthly && (
          <aside className="pa-allowance" aria-label="Discoveries this month">
            <span className="pa-eyebrow">Discoveries this month</span>
            <MonthlyDiscoveryRing progress={monthly} />
            <p className="pa-allowance-caption">{monthly.caption}</p>
            <div className="pa-allowance-guide">
              <span><RefreshCw size={11} /> {discoveryCadenceLabel(overview)}</span>
              <span><ShieldCheck size={11} /> Evidence threshold enforced</span>
            </div>
            <p className="pa-allowance-next">{(overview?.counts.newDiscoveries ?? 0) > 0 ? `${formatInsightNumber(overview?.counts.newDiscoveries ?? 0)} unread signal${overview?.counts.newDiscoveries === 1 ? '' : 's'} ready to review` : 'Your discovery feed is caught up'}</p>
            {monthly.unlimited
              ? <span className="pa-allowance-note">Your plan runs discovery on demand.</span>
              : <button className="text-button" onClick={onNavigateBilling}>{INSIGHTS_UPGRADE_CTA}</button>}
          </aside>
        )}
      </header>

      {planPanelOpen && <PlanPanel plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} onClose={() => setPlanPanelOpen(false)} />}

      {degraded && <div className="pa-banner warn"><TriangleAlert size={13} /> {degraded}</div>}
      {overview?.autoDiscoveryRan && <div className="pa-banner info"><Sparkles size={13} /> Auto-discovery just ran — this page reflects your freshest synced data.</div>}
      {overview?.trial && <div className="pa-banner trial"><Compass size={13} /> <strong>Trial mode:</strong> clearly labelled samples show the shape of what PatternAI finds once a paid plan starts computing from your own store.</div>}
      {overviewState.status === 'error' && (overviewState.upgradeRequired
        ? <InsightsLockedPanel feature="discoveries" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} note="PatternAI is paused on this workspace. Upgrade Plan to resume evidence-backed discovery." />
        : <InsightsErrorPanel message={overviewState.message ?? 'The overview could not be loaded.'} onRetry={overviewState.reload} />)}

      <div className="pa-layout">
        <nav className="pa-nav" aria-label="PatternAI sections">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className={`pa-nav-group tone-${group.tone}`}>
              <span className="pa-nav-group-label">{group.label}</span>
              {group.entries.map(({ tab, icon: Icon, feature }) => {
                const locked = feature !== null && lockedFor(feature)
                const active = route.tab === tab || (route.tab === 'discoveries' && tab === 'overview')
                const badge = navBadgeCount(tab, overview)
                return (
                  <button
                    key={tab}
                    className={`pa-nav-item ${active ? 'active' : ''} ${locked ? 'locked' : ''}`}
                    onClick={() => go(tab)}
                    aria-current={active ? 'page' : undefined}
                    title={locked ? 'Locked on your current plan — Upgrade Plan to open this section' : insightsTabPurpose(tab)}
                  >
                    <Icon size={15} />
                    <span>{insightsTabLabel(tab)}</span>
                    {badge !== null && badge > 0 && <span className="pa-nav-badge">{formatInsightNumber(badge)}</span>}
                    {locked && <Lock size={11} className="pa-nav-lock" />}
                  </button>
                )
              })}
            </div>
          ))}
          <p className="pa-nav-note"><Lock size={10} /> Locked sections open with a plan upgrade.</p>
        </nav>

        <main className="pa-tab-panel">
          <div className="pa-section-head">
            <div>
              <h3>{insightsTabLabel(route.tab)}</h3>
              <p>{insightsTabPurpose(route.tab)}</p>
            </div>
            <activeEntry.icon size={18} className="pa-section-icon" />
          </div>
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
    </div>
  )
}

/** Backwards-compatible alias for the pre-rebrand component name. */
export const InsightsHubWorkspace = PatternAiWorkspace

/**
 * Plan panel: exactly what this store can use today and what a paid plan adds.
 * The CTA is always the generic "Upgrade Plan" — never a named target tier.
 */
export function PlanPanel({ plan, overview, onNavigateBilling, onClose }: { plan: PlanTier; overview: InsightsOverview | null; onNavigateBilling: () => void; onClose?: () => void }) {
  const summary = patternAiPlanSummary(plan, overview)
  return (
    <section className="pa-plan-panel" aria-label="Plan features">
      <header>
        <div>
          <span className="pa-eyebrow">Your plan</span>
          <strong>{summary.planLabel}</strong>
        </div>
        {onClose && <button className="pa-icon-button" onClick={onClose} aria-label="Close plan details"><X size={14} /></button>}
      </header>
      <div className="pa-plan-columns">
        <div className="pa-plan-column">
          <span className="pa-plan-column-head unlocked"><CheckCircle2 size={13} /> Available now</span>
          <ul>{summary.unlocked.map((entry) => <li key={entry.feature}><CheckCircle2 size={12} /> {entry.label}</li>)}</ul>
        </div>
        <div className="pa-plan-column">
          <span className="pa-plan-column-head locked"><Lock size={13} /> Unlocks with a paid plan</span>
          {summary.locked.length === 0
            ? <p className="pa-muted">Everything PatternAI offers is unlocked on this store.</p>
            : <ul>{summary.locked.map((entry) => <li key={entry.feature} className="locked"><Lock size={12} /> {entry.label}</li>)}</ul>}
        </div>
      </div>
      {summary.locked.length > 0 && (
        <footer>
          <InsightsUpgradeCta onNavigateBilling={onNavigateBilling} />
          <span className="pa-muted">Pricing and limits live on the billing page — PatternAI never quotes a tier at you mid-task.</span>
        </footer>
      )}
    </section>
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

const CATEGORY_ICONS: Readonly<Record<DiscoveryCategory, LucideIcon>> = {
  REVENUE: CircleDollarSign,
  CUSTOMERS: Users,
  PRODUCTS: Package,
  OPERATIONS: Settings2,
  MARKETING: Megaphone,
  TIME: Clock3,
}

/**
 * Professional replacement for the old single-block treemap. It always shows
 * the complete category vocabulary, with each count and share calculated from
 * the discoveries supplied by the API. Zero categories are visibly empty —
 * they are not populated with illustrative values.
 */
export function CategorySignalBreakdown({ impact, activeCategory = 'ALL', onSelect }: {
  impact: ReturnType<typeof discoveryImpactSummary>
  activeCategory?: 'ALL' | DiscoveryCategory
  onSelect?: (category: DiscoveryCategory) => void
}) {
  const counts = new Map(impact.blocks.map((block) => [block.id, block.value]))
  return (
    <div className="pa-category-breakdown" role="group" aria-label="Filter signals by category">
      {DISCOVERY_CATEGORIES.map((category) => {
        const Icon = CATEGORY_ICONS[category]
        const count = counts.get(category) ?? 0
        const share = impact.total > 0 ? Math.round((count / impact.total) * 100) : 0
        return (
          <button
            key={category}
            type="button"
            className={`pa-category-signal tone-${category.toLowerCase()} ${activeCategory === category ? 'active' : ''} ${count === 0 ? 'empty' : ''}`}
            onClick={() => onSelect?.(category)}
            aria-pressed={activeCategory === category}
            title={`Filter the discovery feed to ${DISCOVERY_CATEGORY_LABELS[category].toLowerCase()}`}
          >
            <span className="pa-category-signal-head"><span className="pa-category-signal-icon"><Icon size={14} /></span><strong>{DISCOVERY_CATEGORY_LABELS[category]}</strong></span>
            <span className="pa-category-signal-count">{formatInsightNumber(count)} signal{count === 1 ? '' : 's'}</span>
            <span className="pa-category-signal-meter"><span style={{ width: `${share}%` }} /></span>
            <span className="pa-category-signal-share">{share}%</span>
          </button>
        )
      })}
    </div>
  )
}

function DiscoveryWorkflowGuide() {
  const steps = [
    { title: 'Discover', body: 'A signal clears the evidence threshold.' },
    { title: 'Review', body: 'Open it and inspect the source numbers.' },
    { title: 'Save or dismiss', body: 'Keep useful patterns or mark noise in your own review record.' },
    { title: 'Close the loop', body: 'Mark acted on to measure discovery conversion.' },
  ] as const
  return (
    <div className="pa-workflow-guide" aria-label="How to use discoveries">
      <span className="pa-eyebrow">How the workflow works</span>
      <ol>{steps.map((step, index) => <li key={step.title}><span>{index + 1}</span><div><strong>{step.title}</strong><small>{step.body}</small></div></li>)}</ol>
    </div>
  )
}

function DiscoveryReadingGuide() {
  return (
    <section className="pa-reading-guide" aria-label="How to read a discovery">
      <div className="pa-reading-guide-title"><Lightbulb size={16} /><div><span className="pa-eyebrow">Read any discovery in three passes</span><p>Separate what happened from how certain it is and what is worth investigating next.</p></div></div>
      <div className="pa-reading-guide-steps">
        <span><strong>1 · Evidence</strong><small>The measured order, product, customer or time values behind the signal.</small></span>
        <span><strong>2 · Confidence</strong><small>How strongly the available history supports the pattern — never a guarantee.</small></span>
        <span><strong>3 · Impact</strong><small>“In play” appears only when the engine can attach an observed monetary value.</small></span>
      </div>
    </section>
  )
}

function SignalQualityKpi({ discoveries }: { discoveries: readonly InsightDiscovery[] }) {
  const summary = useMemo(() => signalQualitySummary(discoveries), [discoveries])
  const empty = summary.total === 0
  return (
    <div className="pa-card pa-kpi-card pa-kpi-quality">
      <div className="pa-card-head">
        <span className="section-kicker"><ShieldCheck size={11} /> SIGNAL QUALITY</span>
        <small>Confidence distribution of your discoveries</small>
      </div>
      {empty ? (
        <p className="pa-muted">No signals yet — quality metrics appear after your first discovery sweep.</p>
      ) : (
        <>
          <div className="pa-kpi-hero">
            <strong>{summary.avgPercent}%</strong>
            <span>average confidence</span>
            <em className={`pa-confidence tone-${summary.avgConfidence >= 0.7 ? 'high' : summary.avgConfidence >= 0.5 ? 'medium' : 'low'}`}>{summary.highCount} high · {summary.mediumCount} medium · {summary.lowCount} early</em>
          </div>
          <div className="pa-kpi-dist" role="img" aria-label={`${summary.highCount} high, ${summary.mediumCount} medium, ${summary.lowCount} early signals`}>
            <span className="pa-kpi-dist-track">
              {summary.highCount > 0 && <i className="seg high" style={{ width: `${Math.round((summary.highCount / summary.total) * 100)}%` }} />}
              {summary.mediumCount > 0 && <i className="seg medium" style={{ width: `${Math.round((summary.mediumCount / summary.total) * 100)}%` }} />}
              {summary.lowCount > 0 && <i className="seg low" style={{ width: `${Math.round((summary.lowCount / summary.total) * 100)}%` }} />}
            </span>
            <span className="pa-kpi-dist-labels"><b>{summary.highShare}% high confidence</b><span>{summary.total} total signals</span></span>
          </div>
          {summary.strongest && (
            <p className="pa-kpi-foot">Strongest: <strong>{summary.strongest.title}</strong> · {confidencePercent(summary.strongest.confidence)}%</p>
          )}
          <p className="pa-muted" style={{ fontSize: '11px' }}>High means ≥70% confidence — these are the signals worth acting on first.</p>
        </>
      )}
    </div>
  )
}

function ActionBacklogKpi({ discoveries, funnel, onReview }: { discoveries: readonly InsightDiscovery[]; funnel: ReturnType<typeof discoveryFunnel>; onReview: () => void }) {
  const summary = useMemo(() => reviewBacklogSummary(discoveries, funnel), [discoveries, funnel])
  const empty = summary.total === 0
  return (
    <div className={`pa-card pa-kpi-card pa-kpi-backlog ${summary.urgent ? 'urgent' : ''}`}>
      <div className="pa-card-head">
        <span className="section-kicker"><Clock3 size={11} /> ACTION BACKLOG</span>
        <small>What needs your review next</small>
      </div>
      {empty ? (
        <p className="pa-muted">Your backlog fills as PatternAI publishes discoveries — run a sweep to start.</p>
      ) : (
        <>
          <div className="pa-kpi-hero">
            <strong>{formatInsightNumber(summary.newCount)}</strong>
            <span>new signal{summary.newCount === 1 ? '' : 's'} to review</span>
            {summary.oldestNewLabel && <em className={summary.urgent ? 'urgent' : ''}>Oldest waiting {summary.oldestNewLabel}{summary.urgent ? ' · needs attention' : ''}</em>}
          </div>
          <div className="pa-kpi-stats">
            <span><b>{formatInsightNumber(summary.reviewedCount)}</b><small>reviewed</small></span>
            <span><b>{summary.conversion === null ? '—' : `${Math.round(summary.conversion * 100)}%`}</b><small>acted → conversion</small></span>
            <span><b>{formatInsightNumber(summary.actedOn)}</b><small>acted on</small></span>
          </div>
          <p className="pa-kpi-foot">{summary.hint}</p>
          {summary.newCount > 0 && (
            <button className="pa-button secondary compact" onClick={onReview}><Search size={12} /> Review new signals</button>
          )}
          {summary.newCount === 0 && summary.total > 0 && (
            <p className="pa-muted" style={{ fontSize: '11px' }}>Saved discoveries remain available from the Saved status filter.</p>
          )}
        </>
      )}
    </div>
  )
}

function decisionTimeLabel(remainingMs: number): string {
  if (remainingMs <= 0) return 'Window passed'
  const hours = Math.ceil(remainingMs / 3_600_000)
  if (hours < 24) return `${hours}h left`
  return `${Math.ceil(hours / 24)}d left`
}

/** Explicit expiresAt only; samples and inferred deadlines never enter this card. */
export function DecisionWindowKpi({ discoveries, onOpen }: { discoveries: readonly InsightDiscovery[]; onOpen: (id: string) => void }) {
  const summary = useMemo(() => decisionWindowSummary(discoveries), [discoveries])
  const headline = summary.overdue > 0
    ? `${formatInsightNumber(summary.overdue)} overdue`
    : summary.dueSoon > 0
      ? `${formatInsightNumber(summary.dueSoon)} due soon`
      : summary.next
        ? decisionTimeLabel(summary.next.remainingMs)
        : 'No deadline'
  return (
    <article className={`pa-card pa-merchant-kpi-card pa-decision-window ${summary.overdue > 0 ? 'urgent' : ''}`}>
      <div className="pa-card-head">
        <span className="section-kicker"><Clock3 size={11} /> DECISION WINDOW</span>
        <small>Only deadlines recorded on real discoveries</small>
      </div>
      <div className="pa-merchant-kpi-hero">
        <strong>{headline}</strong>
        <span>{summary.overdue > 0 ? 'real signals past their recorded window' : summary.dueSoon > 0 ? 'real signals closing within 7 days' : summary.next ? 'until the next recorded deadline' : 'attached to active real signals'}</span>
      </div>
      <dl className="pa-window-facts">
        <div><dt>With a deadline</dt><dd>{formatInsightNumber(summary.withDeadline)}</dd></div>
        <div><dt>Due in 7 days</dt><dd>{formatInsightNumber(summary.dueSoon)}</dd></div>
        <div><dt>Past window</dt><dd>{formatInsightNumber(summary.overdue)}</dd></div>
      </dl>
      {summary.next ? (
        <div className="pa-next-window">
          <span className="pa-eyebrow">Next recorded window</span>
          <strong>{summary.next.title}</strong>
          <time dateTime={summary.next.expiresAt}>{decisionTimeLabel(summary.next.remainingMs)}</time>
        </div>
      ) : (
        <div className="pa-kpi-empty-note">
          <Clock3 size={18} />
          <p>{summary.excludedSamples > 0 ? 'This sample is excluded. A live deadline appears only when a real discovery carries an expiry date.' : 'No active real discovery currently carries an expiry date.'}</p>
        </div>
      )}
      {summary.urgentImpact.length > 0 && (
        <div className="pa-window-impact">
          <span className="pa-eyebrow">Measured impact on urgent signals</span>
          <div>{summary.urgentImpact.map((impact) => <strong key={impact.currency}>{formatInsightMoney(impact.amount, impact.currency)}</strong>)}</div>
        </div>
      )}
      <footer className="pa-merchant-kpi-footer">
        <p>Missing or invalid dates are never guessed. Different currencies are never combined.</p>
        {summary.next && <button className="pa-button secondary compact" onClick={() => onOpen(summary.next!.id)}><Search size={12} /> Review this signal</button>}
      </footer>
    </article>
  )
}

/** Current Save / Acted on / Dismissed statuses only — no inferred learning score. */
export function SignalFeedbackKpi({ discoveries }: { discoveries: readonly InsightDiscovery[] }) {
  const summary = useMemo(() => signalFeedbackSummary(discoveries), [discoveries])
  return (
    <article className="pa-card pa-merchant-kpi-card pa-feedback-card">
      <div className="pa-card-head">
        <span className="section-kicker"><Scale size={11} /> YOUR SIGNAL DECISIONS</span>
        <small>A factual record of current outcomes</small>
      </div>
      <div className="pa-merchant-kpi-hero">
        <strong>{formatInsightNumber(summary.classified)}</strong>
        <span>real signal{summary.classified === 1 ? '' : 's'} currently classified</span>
      </div>
      <FeedbackBalance kept={summary.kept} dismissed={summary.dismissed} />
      <dl className="pa-feedback-facts">
        <div><dt>Kept share</dt><dd>{summary.keptShare === null ? '—' : `${Math.round(summary.keptShare * 100)}%`}</dd></div>
        <div><dt>Most kept category</dt><dd>{summary.topKeptCategory?.label ?? '—'}</dd></div>
      </dl>
      {summary.classified === 0 && (
        <div className="pa-kpi-empty-note">
          <Scale size={18} />
          <p>{summary.excludedSamples > 0 ? 'Sample cards do not count. This record starts only after a real signal is Saved, Acted on or Dismissed.' : 'No real signal has a Saved, Acted on or Dismissed outcome yet.'}</p>
        </div>
      )}
      <footer className="pa-merchant-kpi-footer">
        <p>Kept means currently Saved or Acted on. Views and samples never imply a preference; this card reports choices, not model training.</p>
      </footer>
    </article>
  )
}

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
  // The feed is the unfiltered source of truth for summary visuals. Toolbar
  // filters affect the cards only, so clicking a stage/category never rewrites
  // its own denominator or turns one category into a misleading 100% block.
  const allDiscoveries = feed.data?.discoveries ?? discoveries
  const readiness = feed.data?.readiness ?? overview?.readiness ?? null
  const generationLocked = overview ? !overview.features.discoveries : plan === 'trial'
  const filtered = statusFilter !== 'ALL' || categoryFilter !== 'ALL'
  const weekdayCells = useMemo(() => weekdayHeatCells(allDiscoveries), [allDiscoveries])
  const hourCells = useMemo(() => hourHeatCells(allDiscoveries), [allDiscoveries])
  const funnel = useMemo(() => discoveryFunnel(allDiscoveries), [allDiscoveries])
  const impact = useMemo(() => discoveryImpactSummary(allDiscoveries), [allDiscoveries])
  const strengthRows = useMemo(() => patternStrengthRows(readiness), [readiness])
  const activeStage = funnel.stages.find((stage) => statusFilter !== 'ALL' && stage.statuses[0] === statusFilter)?.id ?? (statusFilter === 'ALL' ? 'discovered' : null)

  if (!storeId) return <InsightsEmptyState icon={Compass} title="Connect your store first" body="PatternAI reads your synced Shopify history. Connect a store and run a sync, and the first discoveries appear here." />

  if (props.detailId) return <DiscoveryDetail storeId={storeId} id={props.detailId} plan={plan} onBack={() => go('discoveries', null)} onToast={onToast} onNavigateBilling={onNavigateBilling} />

  return (
    <section className="pa-discoveries">
      <div className="pa-toolbar">
        <div className="pa-toolbar-filters">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | DiscoveryStatus)} aria-label="Filter by status">
            <option value="ALL">All statuses</option>
            {(Object.keys(DISCOVERY_STATUS_LABELS) as DiscoveryStatus[]).map((status) => <option key={status} value={status}>{DISCOVERY_STATUS_LABELS[status]}</option>)}
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'ALL' | DiscoveryCategory)} aria-label="Filter by category">
            <option value="ALL">All categories</option>
            {DISCOVERY_CATEGORIES.map((category) => <option key={category} value={category}>{DISCOVERY_CATEGORY_LABELS[category]}</option>)}
          </select>
        </div>
        <div className="pa-toolbar-actions">
          {filtered && <button className="pa-button ghost compact subtle" onClick={() => { setStatusFilter('ALL'); setCategoryFilter('ALL') }}><X size={11} /> Clear filters</button>}
          <ChartExportButton targetRef={chartRef} filename="patternai-discovery-charts" enabled={exportEnabled} onLocked={onExportLocked} />
          {generationLocked
            ? <button className="button primary" onClick={onNavigateBilling} title="On-demand discovery generation unlocks with a plan upgrade"><Lock size={12} /> {INSIGHTS_UPGRADE_CTA}</button>
            : <button className="button primary" onClick={() => void generate()} disabled={generating}><PatternAiDiscoverGlyph size={14} /> {generating ? 'Examining your data…' : 'Run discovery'}</button>}
        </div>
      </div>

      {generating && (
        <div className="pa-progress-steps" role="status" aria-live="polite">
          <span className="pa-eyebrow">Discovery in progress</span>
          <ol>
            <li className="done">Reading your synced orders</li>
            <li className="done">Testing rhythms, baskets and segments</li>
            <li className="active">Scoring what clears the confidence bar</li>
          </ol>
          <p className="pa-muted">PatternAI publishes nothing it cannot evidence — a quiet sweep is a valid result.</p>
        </div>
      )}

      {(feed.status === 'loading' || list.status === 'loading') && <InsightsSkeleton rows={4} />}
      {feed.status === 'error' && (feed.upgradeRequired
        ? <InsightsLockedPanel feature="discoveries" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />
        : <InsightsErrorPanel message={feed.message ?? 'The discovery feed failed to load.'} onRetry={feed.reload} />)}
      {list.status === 'error' && <InsightsErrorPanel message={list.message ?? 'The filtered discovery list failed to load.'} onRetry={list.reload} />}

      {allDiscoveries.length > 0 && (
        <div className="pa-value-grid">
          <div className="pa-card pa-funnel-card">
            <div className="pa-card-head">
              <span className="section-kicker"><PatternAiDiscoverGlyph size={12} /> DISCOVERY PIPELINE</span>
              <small>Your discoveries&rsquo; journey — click a stage to filter the feed</small>
            </div>
            <DiscoveryPipelineFunnel
              funnel={funnel}
              activeStage={activeStage}
              onSelect={(stage) => {
                if (stage.id === 'discovered') { setStatusFilter('ALL'); return }
                const target = stage.statuses[0]
                if (target) setStatusFilter(statusFilter === target ? 'ALL' : target)
              }}
              onAction={() => setStatusFilter('NEW')}
            />
            <DiscoveryWorkflowGuide />
          </div>

          <div className="pa-card pa-impact-card">
            <div className="pa-card-head">
              <span className="section-kicker"><Lightbulb size={11} /> WHAT PATTERNAI HAS FOUND</span>
              <small>Signals by category, counted from your own data</small>
            </div>
            <CategorySignalBreakdown
              impact={impact}
              activeCategory={categoryFilter}
              onSelect={(category) => setCategoryFilter(categoryFilter === category ? 'ALL' : category)}
            />
            <div className="pa-category-context">
              <div><span className="pa-eyebrow">Pattern coverage</span><strong>{formatInsightNumber(impact.blocks.length)} of {formatInsightNumber(DISCOVERY_CATEGORIES.length)} categories active</strong></div>
              <span className="pa-category-coverage" role="img" aria-label={`${impact.blocks.length} of ${DISCOVERY_CATEGORIES.length} categories have signals`}>
                {DISCOVERY_CATEGORIES.map((category) => <i key={category} className={impact.blocks.some((block) => block.id === category) ? 'active' : ''} />)}
              </span>
              <p>Each discovery belongs to one measured category. Select a card to focus the feed; shares stay anchored to the complete discovery set.</p>
            </div>
            <ul className="pa-impact-facts">
              {impact.mostActive && <li>Most active category: <strong>{impact.mostActive.label}</strong> ({formatInsightNumber(impact.mostActive.value)} signal{impact.mostActive.value === 1 ? '' : 's'})</li>}
              {impact.strongest && <li>Strongest insight: <strong>{impact.strongest.title}</strong> ({confidencePercent(impact.strongest.confidence)}% confidence)</li>}
            </ul>
            <MoneyInPlay amount={impact.moneyInPlay} currency={impact.currency} />
          </div>
        </div>
      )}

      {(strengthRows.length > 0 || allDiscoveries.length > 0) && (
        <div className="pa-kpi-row">
          {strengthRows.length > 0 && (
            <div className="pa-card pa-strength-card">
              <div className="pa-card-head">
                <span className="section-kicker"><Radar size={11} /> PATTERN CONFIDENCE</span>
                <small>How much evidence your store has for each family of pattern</small>
              </div>
              <PatternStrengthMeter rows={strengthRows} tip="More synced orders mean stronger patterns — every bar is your real count against the engine's own threshold." />
            </div>
          )}
          <SignalQualityKpi discoveries={allDiscoveries} />
          <ActionBacklogKpi discoveries={allDiscoveries} funnel={funnel} onReview={() => setStatusFilter('NEW')} />
        </div>
      )}

      {feed.status === 'ready' && discoveries.length === 0 && (
        filtered
          ? <InsightsEmptyState icon={Compass} title="No discoveries match this filter" body="Widen the filters above, or run a fresh sweep against your latest synced data." />
          : <PatternAiWelcome readiness={readiness} plan={plan} canRun={!generationLocked} onRunDiscovery={() => void generate()} onNavigateBilling={onNavigateBilling} />
      )}

      {weekdayCells.length > 0 && (
        <div className="pa-card" ref={chartRef}>
          <div className="pa-card-head"><span className="section-kicker"><Clock3 size={11} /> WHEN YOUR STORE HUMS</span><small>Revenue share by weekday — measured from your orders</small></div>
          <InsightsHeatmap cells={weekdayCells} xLabels={[...DAY_LABELS]} yLabels={['Revenue']} />
        </div>
      )}
      {hourCells.length > 0 && (
        <div className="pa-card">
          <div className="pa-card-head"><span className="section-kicker"><Clock3 size={11} /> YOUR STORE BY THE HOUR</span><small>Orders by hour of day (UTC) — measured, not modeled</small></div>
          <InsightsHeatmap cells={hourCells} xLabels={[...HOUR_LABELS]} yLabels={['Orders']} />
        </div>
      )}

      {discoveries[0] && (
        <div className="pa-discovery-feature-row">
          <DiscoveryCard discovery={discoveries[0]} storeId={storeId} onOpen={() => go('discoveries', discoveries[0]!.id)} onChanged={() => { list.reload(); feed.reload() }} onToast={onToast} onNavigateBilling={onNavigateBilling} />
          <DecisionWindowKpi discoveries={allDiscoveries} onOpen={(id) => go('discoveries', id)} />
          <SignalFeedbackKpi discoveries={allDiscoveries} />
        </div>
      )}

      {discoveries.length > 1 && (
        <div className="pa-masonry pa-masonry-continuation">
          {discoveries.slice(1).map((discovery) => <DiscoveryCard key={discovery.id} discovery={discovery} storeId={storeId} onOpen={() => go('discoveries', discovery.id)} onChanged={() => { list.reload(); feed.reload() }} onToast={onToast} onNavigateBilling={onNavigateBilling} />)}
        </div>
      )}

      {allDiscoveries.length > 0 && <DiscoveryReadingGuide />}

      <ExploreFurther go={go} storeId={storeId} overview={overview} plan={plan} />
    </section>
  )
}

/**
 * Where to go next. Each destination is a distinct way of *understanding* the
 * store — deliberately none of them duplicate Store Coach's daily plan,
 * GrowthIQ's strategy reports or the Recommendations queue.
 */
export function ExploreFurther({ go, storeId, overview, plan }: {
  go: (tab: InsightsTab, id?: string | null) => void
  storeId: string | null
  overview: InsightsOverview | null
  plan: PlanTier
}) {
  const counts = overview?.counts
  const unlocked = (feature: InsightsFeature): boolean => !insightsFeatureLock(plan, feature, overview).locked
  const enabled = (feature: InsightsFeature, count: number | undefined): boolean => Boolean(storeId) && unlocked(feature) && (count ?? 0) > 0

  // Each card only fetches when the overview already says there is something
  // to draw and the plan allows it — so a locked or empty card costs nothing
  // and, critically, never renders a shape without real data behind it.
  const lessons = useResource<readonly InsightLesson[]>(
    enabled('lessons', counts?.lessons) ? () => api.fetchInsightLessons(storeId ?? '').then((result) => result.items) : null, [storeId, counts?.lessons])
  const patterns = useResource<readonly InsightPattern[]>(
    enabled('patterns', counts?.patterns) ? () => api.fetchInsightPatterns(storeId ?? '').then((result) => result.patterns) : null, [storeId, counts?.patterns])
  const personas = useResource<readonly InsightPersona[]>(
    enabled('personas', counts?.personas) ? () => api.fetchInsightPersonas(storeId ?? '').then((result) => result.personas) : null, [storeId, counts?.personas])
  const investigations = useResource<readonly InsightInvestigation[]>(
    enabled('investigations', counts?.investigations) ? () => api.fetchInsightInvestigations(storeId ?? '', 5).then((result) => result.items) : null, [storeId, counts?.investigations])
  const trends = useResource<readonly InsightTrend[]>(
    enabled('trends', counts?.trends) ? () => api.fetchInsightTrends(storeId ?? '').then((result) => result.trends) : null, [storeId, counts?.trends])
  const predictions = useResource<readonly InsightPrediction[]>(
    enabled('predictions', counts?.predictions) ? () => api.fetchInsightPredictions(storeId ?? '').then((result) => result.predictions) : null, [storeId, counts?.predictions])

  const lockedNote = 'Opens with a plan upgrade'

  const destinations: readonly Readonly<{ tab: InsightsTab; icon: LucideIcon; feature: InsightsFeature; blurb: string; viz: ReactNode }>[] = [
    {
      tab: 'lessons', icon: BookOpen, feature: 'lessons',
      blurb: 'Briefings written from your numbers.',
      viz: <MiniWordCloud words={lessonTopicCloud(lessons.data ?? [])} emptyLabel={unlocked('lessons') ? 'Topics appear with your first lesson' : lockedNote} />,
    },
    {
      tab: 'patterns', icon: Network, feature: 'patterns',
      blurb: 'Recurring structures by confidence.',
      viz: <MiniScatter points={patternBubbles(patterns.data ?? []).map((point) => ({ id: point.id, label: point.label, x: point.x, y: point.y }))} emptyLabel={unlocked('patterns') ? 'Patterns plot here once detected' : lockedNote} />,
    },
    {
      tab: 'personas', icon: Users, feature: 'personas',
      blurb: 'Behaviour groups in your revenue.',
      viz: <MiniRadar traits={personaRadarAverage(personas.data ?? [])} emptyLabel={unlocked('personas') ? 'Traits appear with your first persona' : lockedNote} />,
    },
    {
      tab: 'why', icon: HelpCircle, feature: 'investigations',
      blurb: 'Ranked root causes, with evidence.',
      viz: <MiniCauseWeb causes={investigationCauseNodes(investigations.data ?? [])} emptyLabel={unlocked('investigations') ? 'Ask a question to map its causes' : lockedNote} />,
    },
    {
      tab: 'trends', icon: TrendingUp, feature: 'trends',
      blurb: 'What is rising and what is fading.',
      viz: <MiniDivergingBars rows={trendDivergingRows(trends.data ?? [])} emptyLabel={unlocked('trends') ? 'Rises and falls appear here' : lockedNote} />,
    },
    {
      tab: 'predictions', icon: Radar, feature: 'predictions',
      blurb: 'Forecasts with honest ranges.',
      viz: <MiniProbabilityWave points={predictionWavePoints(predictions.data ?? [])} emptyLabel={unlocked('predictions') ? 'Forecast ranges appear here' : lockedNote} />,
    },
  ]

  return (
    <section className="pa-explore">
      <span className="pa-eyebrow">Keep exploring</span>
      <div className="pa-explore-grid">
        {destinations.map(({ tab, icon: Icon, feature, blurb, viz }) => {
          const locked = !unlocked(feature)
          return (
            <button key={tab} className={`pa-explore-card ${locked ? 'locked' : ''}`} onClick={() => go(tab)} title={locked ? 'Locked on your current plan — Upgrade Plan to open this section' : insightsTabPurpose(tab)}>
              <span className="pa-explore-head">
                <span className="pa-explore-icon"><Icon size={15} /></span>
                <strong>{insightsTabLabel(tab)}</strong>
                {locked && <Lock size={11} className="pa-explore-lock" />}
              </span>
              <span className="pa-explore-viz">{viz}</span>
              <p>{blurb}</p>
              {locked && <span className="pa-explore-locked-note"><Lock size={10} /> Opens with a plan upgrade</span>}
              <span className="pa-explore-go">Open <ArrowRight size={12} /></span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const HOUR_LABELS = ['12am', '4am', '8am', '12pm', '4pm', '8pm'] as const

type HeatCell = Readonly<{ x: number; y: number; value: number; label: string }>

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
      onToast(status === 'DISMISSED' ? 'Dismissed — this signal is now recorded with a dismissed outcome.' : `Discovery ${DISCOVERY_STATUS_LABELS[status].toLowerCase()}.`, 'success')
      onChanged()
    } catch (error: unknown) {
      if (error instanceof ApiClientError && error.status === 402) { onToast('Discovery actions unlock with a plan upgrade.', 'warning'); onNavigateBilling() }
      else onToast(error instanceof Error ? error.message : 'Could not update the discovery.', 'error')
    } finally { setBusy(false) }
  }
  // Evidence rows are the engine's own numbers with storage plumbing (product
  // ids, method strings) filtered out; the detail view still shows the full
  // bundle. Nothing on this card is computed locally.
  const evidence = humanEvidenceRows(discovery.dataEvidence, 3)
  const momentum = discoveryMomentum(discovery)
  return (
    <article className={`pa-discovery-card tone-${discoveryTone(discovery.discoveryType)} ${discovery.status === 'NEW' ? 'fresh' : ''}`}>
      <header className="pa-discovery-head">
        <span className={`pa-type-badge type-${discovery.discoveryType.toLowerCase()}`}>{DISCOVERY_TYPE_HEADLINES[discovery.discoveryType]}</span>
        {discovery.sample && <SampleBadge />}
        <time dateTime={discovery.discoveredAt}>{formatRelativeTime(discovery.discoveredAt)}</time>
      </header>

      <p className="pa-discovery-headline">{discoveryHeadline(discovery)}</p>
      <h3 className="pa-discovery-title">{discovery.title}</h3>
      <p className="pa-discovery-body">{discovery.description}</p>

      {momentum && <MomentumCompare momentum={momentum} />}

      {discovery.explanation && (
        <blockquote className="pa-narration">
          <Lightbulb size={12} />
          <span><strong>What this means for you:</strong> {discovery.explanation}</span>
        </blockquote>
      )}

      {evidence.length > 0 && (
        <dl className="pa-evidence-inline">
          {evidence.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        </dl>
      )}

      <div className="pa-discovery-meta">
        <ConfidencePill score={discovery.confidenceScore} />
        <span className="pa-category">{DISCOVERY_CATEGORY_LABELS[discovery.category]}</span>
        {discovery.impactEstimate !== null && <span className="pa-impact"><Zap size={11} /> {formatInsightMoney(discovery.impactEstimate, discovery.impactCurrency)} in play</span>}
      </div>

      <footer className="pa-discovery-actions">
        <button className="pa-button secondary compact" onClick={onOpen}><Search size={12} /> Explore</button>
        <button className="pa-button ghost compact" disabled={busy || discovery.status === 'SAVED'} onClick={() => void setStatus('SAVED')}><Star size={12} /> Save</button>
        <button className="pa-button ghost compact" disabled={busy || discovery.status === 'ACTED_ON'} onClick={() => void setStatus('ACTED_ON')}><CheckCircle2 size={12} /> Acted on it</button>
        <button className="pa-button ghost compact subtle" disabled={busy || discovery.status === 'DISMISSED'} onClick={() => void setStatus('DISMISSED')} title="Dismiss this discovery"><X size={12} /> Dismiss</button>
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
    <section className="pa-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to discoveries</button>
      <article className="pa-card pa-detail-card">
        <header className="pa-detail-head">
          <span className={`pa-type-badge type-${discovery.discoveryType.toLowerCase()}`}>{DISCOVERY_TYPE_LABELS[discovery.discoveryType]}</span>
          <span className="pa-category">{DISCOVERY_CATEGORY_LABELS[discovery.category]}</span>
          {discovery.sample && <SampleBadge />}
          <ConfidencePill score={discovery.confidenceScore} />
        </header>
        <h2>{discovery.title}</h2>
        <p className="pa-detail-description">{discovery.description}</p>
        {discovery.explanation && <blockquote className="pa-narration"><Waypoints size={13} /> {discovery.explanation}</blockquote>}
        {plan === 'trial' && <div className="pa-banner sample"><Compass size={13} /> This is a labeled sample. Paid plans compute discoveries entirely from your synced store data. <button className="text-button" onClick={onNavigateBilling}>{INSIGHTS_UPGRADE_CTA}</button></div>}
        <div className="pa-evidence">
          <h4><Network size={13} /> The evidence — pulled from your real data</h4>
          {rows.length === 0 ? <p className="pa-muted">Evidence bundle is empty for this discovery.</p> : (
            <dl>{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          )}
        </div>
        {discovery.impactEstimate !== null && <p className="pa-detail-impact"><Zap size={13} /> Estimated potential: <strong>{formatInsightMoney(discovery.impactEstimate, discovery.impactCurrency)}</strong> — computed from observed order values, never a guess.</p>}
        {discoveryTreemapBlocks(discovery).length > 0 && (
          <div className="pa-detail-chart">
            <h4>How it splits</h4>
            <InsightsTreeMap blocks={discoveryTreemapBlocks(discovery)} />
          </div>
        )}
        <footer className="pa-detail-actions"><DiscoveryStatusActions storeId={storeId} discovery={discovery} onChanged={() => state.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} /></footer>
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
    <div className="pa-action-row">
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
      <div className="pa-toolbar">
        <div className="pa-toolbar-filters"><span className="pa-muted">{items.length} lesson{items.length === 1 ? '' : 's'} · {items.filter((lesson) => lesson.readAt).length} read</span></div>
        <div className="pa-toolbar-actions">
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
        <div className="pa-recommended">
          <span className="section-kicker"><Lightbulb size={11} /> RECOMMENDED FOR YOU — FROM YOUR PATTERNS</span>
          <div className="pa-recommended-row">
            {recommended.data.slice(0, 3).map((lesson) => (
              <button key={lesson.id} className="pa-recommended-chip" onClick={() => go('lessons', lesson.id)}>{lesson.sample && <SampleBadge />} {lesson.title} <ChevronRight size={12} /></button>
            ))}
          </div>
        </div>
      )}

      <div className="pa-lesson-grid">
        {items.map((lesson) => (
          <button key={lesson.id} className={`pa-lesson-card ${lesson.readAt ? 'read' : ''}`} onClick={() => go('lessons', lesson.id)}>
            <header><span className="pa-type-badge lesson">{LESSON_TYPE_LABELS[lesson.lessonType]}</span><span className="pa-category">{DISCOVERY_CATEGORY_LABELS[lesson.category]}</span>{lesson.sample && <SampleBadge />}{lesson.bookmarked && <Star size={11} className="pa-bookmarked" />}</header>
            <h3>{lesson.title}</h3>
            <p>{lesson.summary}</p>
            <footer><span><Clock3 size={11} /> {lesson.readingTimeMinutes} min read</span>{lesson.rating !== null && <span className="pa-muted">Rated {lesson.rating}/5</span>}{lesson.readAt ? <span className="pa-read-flag"><CheckCircle2 size={11} /> Read</span> : <span className="pa-unread-flag">Unread</span>}</footer>
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
    <section className="pa-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to the library</button>
      <article className="pa-card pa-detail-card pa-reader">
        <header className="pa-detail-head"><span className="pa-type-badge lesson">{LESSON_TYPE_LABELS[lesson.lessonType]}</span><span className="pa-category">{DISCOVERY_CATEGORY_LABELS[lesson.category]}</span>{lesson.sample && <SampleBadge />}<span className="pa-muted"><Clock3 size={11} /> {lesson.readingTimeMinutes} min</span></header>
        <h2>{lesson.title}</h2>
        <p className="pa-detail-description">{lesson.summary}</p>
        <MarkdownLite markdown={lesson.contentMarkdown} />
        {lesson.actionItems.length > 0 && (
          <div className="pa-actions-list">
            <h4><Lightbulb size={13} /> Do this next</h4>
            <ul>{lesson.actionItems.map((item) => <li key={item}><CheckCircle2 size={12} /> {item}</li>)}</ul>
          </div>
        )}
        <footer className="pa-detail-actions">
          <RatingStars value={lesson.rating} onRate={async (rating) => { try { await api.rateInsightLesson(storeId, id, rating); onToast('Thanks — your lesson rating was recorded.', 'success'); state.reload() } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Rating failed.', 'error') } }} />
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

  if (!storeId) return <InsightsEmptyState icon={Network} title="Connect your store first" body="The pattern lab studies your real order rhythm — it needs synced history first." />
  const items = patterns.data?.patterns ?? []
  const detectionLocked = overview ? !overview.features.patterns : plan === 'trial'
  const bubbles = patternBubbles(items.filter((pattern) => pattern.status === 'ACTIVE'))

  return (
    <section>
      <div className="pa-toolbar">
        <div className="pa-toolbar-filters"><span className="pa-muted">{items.filter((pattern) => pattern.status === 'ACTIVE').length} active pattern{items.filter((pattern) => pattern.status === 'ACTIVE').length === 1 ? '' : 's'}{patterns.data?.viewOnly ? ' · view-only gallery on your plan' : ''}</span></div>
        <div className="pa-toolbar-actions">
          <ChartExportButton targetRef={chartRef} filename="insights-pattern-bubbles" enabled={exportEnabled} onLocked={onExportLocked} />
          {detectionLocked
            ? <button className="button primary" onClick={onNavigateBilling}><Lock size={12} /> {INSIGHTS_UPGRADE_CTA}</button>
            : <button className="button primary" onClick={() => void detect()} disabled={detecting}><Network size={13} /> {detecting ? 'Watching for patterns…' : 'Detect patterns'}</button>}
        </div>
      </div>

      {patterns.status === 'loading' && <InsightsSkeleton rows={4} />}
      {patterns.status === 'error' && <InsightsErrorPanel message={patterns.message ?? 'Patterns failed to load.'} onRetry={patterns.reload} />}
      {patterns.status === 'ready' && items.length === 0 && (
        <InsightsEmptyState icon={Network} title="No patterns on record yet" body="Patterns are structures the engine has seen repeat across your data — weekly rhythms, product affinities, seasonal swells. Run detection once you have a few weeks of synced history." />
      )}

      {bubbles.length > 0 && (
        <div className="pa-card" ref={chartRef}>
          <div className="pa-card-head"><span className="section-kicker"><Network size={11} /> PATTERN STRENGTH MAP</span><small>Bubble size = confirmed occurrences · axis = engine confidence</small></div>
          <InsightsBubbleChart points={bubbles.map((bubble) => ({ ...bubble, tone: bubble.type.toLowerCase() }))} xLabel="Confidence →" yLabel="Recurrence →" />
        </div>
      )}

      <div className="pa-pattern-list">
        {items.map((pattern) => (
          <article key={pattern.id} className={`pa-pattern-row status-${pattern.status.toLowerCase()}`}>
            <span className={`pa-type-badge pattern-${pattern.patternType.toLowerCase()}`}>{PATTERN_TYPE_LABELS[pattern.patternType]}</span>
            <div className="pa-pattern-copy">
              <strong>{pattern.title}</strong>
              <p>{pattern.description}</p>
              <small>Seen {pattern.occurrenceCount}× · first detected {formatRelativeTime(pattern.firstDetected)} · last confirmed {formatRelativeTime(pattern.lastConfirmed)}</small>
            </div>
            <ConfidencePill score={pattern.confidenceScore} />
            <div className="pa-pattern-actions">
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
      <div className="pa-toolbar">
        <div className="pa-toolbar-filters"><span className="pa-muted">{items.length} persona{items.length === 1 ? '' : 's'} identified</span></div>
        <div className="pa-toolbar-actions"><button className="button primary" onClick={() => void generate()} disabled={generating}><Users size={13} /> {generating ? 'Studying your customers…' : items.length > 0 ? 'Rebuild personas' : 'Identify personas'}</button></div>
      </div>
      {personas.status === 'loading' && <InsightsSkeleton rows={3} />}
      {personas.status === 'error' && <InsightsErrorPanel message={personas.message ?? 'Customer personas failed to load.'} onRetry={personas.reload} />}
      {personas.status === 'ready' && items.length === 0 && readiness && (
        <InsightsEmptyState
          icon={Users}
          title={readiness.canPersonas ? 'Ready when you are' : `Personas require at least ${readiness.personasRequirement.need} customers`}
          body={readiness.canPersonas ? 'Run persona identification to cluster your customer base into named, actionable segments.' : `Persona science clusters real customers — it needs ${readiness.personasRequirement.need} of them and you currently have ${readiness.personasRequirement.have}. Every synced customer gets you closer.`}
          action={<div className="pa-readiness"><span style={{ width: `${Math.min(100, (readiness.personasRequirement.have / readiness.personasRequirement.need) * 100)}%` }} /></div>}
        />
      )}
      <div className="pa-persona-grid">
        {items.map((persona) => (
          <button key={persona.id} className="pa-persona-card" onClick={() => go('personas', persona.id)}>
            <span className="pa-persona-emoji" aria-hidden="true">{persona.personaEmoji}</span>
            <h3>{persona.personaName}</h3>
            <span className="pa-persona-share">{personaShare(persona)} · {formatInsightNumber(persona.customerCount)} people</span>
            <span className="pa-persona-impact">{formatInsightMoney(persona.estimatedRevenueImpact, persona.revenueCurrency)} lifetime value</span>
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
    <section className="pa-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to personas</button>
      <article className="pa-card pa-detail-card">
        <header className="pa-detail-head"><span className="pa-persona-emoji large">{data.personaEmoji}</span><div><h2>{data.personaName}</h2><p className="pa-detail-description">{personaShare(data)} — {formatInsightMoney(data.estimatedRevenueImpact, data.revenueCurrency)} lifetime value across {formatInsightNumber(data.customerCount)} customers.</p></div><ConfidencePill score={data.confidenceScore} /></header>
        <div className="pa-persona-detail-grid">
          <div className="pa-persona-radar"><InsightsRadarChart traits={data.radar} /></div>
          <div className="pa-persona-lists">
            <h4>How they behave</h4>
            <ul>{data.behaviorPatterns.map((item) => <li key={item}>{item}</li>)}</ul>
            <h4>What motivates them</h4>
            <ul>{data.motivations.map((item) => <li key={item}>{item}</li>)}</ul>
            <h4>How to reach them</h4>
            <ul>{data.howToReach.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
        {customers.data && (
          <div className="pa-persona-customers">
            <h4><Users size={13} /> The segment, anonymized</h4>
            <p className="pa-muted">Average {customers.data.aggregate.avgOrders} orders · average {formatInsightMoney(customers.data.aggregate.avgLifetimeValue, customers.data.aggregate.currency)} lifetime value. Customer identities stay private — aggregates only.</p>
            <div className="pa-anon-chips">{customers.data.anonymizedSample.map((label) => <span key={label}>{label}</span>)}</div>
          </div>
        )}
        <footer className="pa-detail-actions"><button className="button secondary compact" onClick={() => { navigator.clipboard?.writeText(`${data.personaName} — ${personaShare(data)}`).then(() => onToast('Persona summary copied.', 'success'), () => onToast('Copy failed.', 'error')) }}><Copy size={12} /> Copy summary</button></footer>
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
      <div className="pa-why-box">
        <h3><Waypoints size={15} /> Ask why anything happened</h3>
        <p>The explorer decomposes your real metrics — revenue into orders and basket size, products into mix shifts — and ranks root causes by measured impact.</p>
        <form className="pa-why-form" onSubmit={(event) => { event.preventDefault(); void ask(question) }}>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Why did revenue drop last week?" maxLength={400} aria-label="Ask a why question" />
          <button className="button primary" type="submit" disabled={asking || !question.trim()}>{asking ? 'Investigating…' : 'Investigate'}</button>
        </form>
        <div className="pa-why-suggestions">
          {SUGGESTED_WHY_QUESTIONS.map((suggestion) => <button key={suggestion} className="pa-suggestion" onClick={() => void ask(suggestion)} disabled={asking}>{suggestion}</button>)}
        </div>
        {quota && quota.limit !== null && <UsageMeterBar label="Investigations this month" used={quota.used} limit={quota.limit} />}
      </div>

      {investigations.status === 'loading' && <InsightsSkeleton rows={3} />}
      {investigations.status === 'error' && <InsightsErrorPanel message={investigations.message ?? 'Why? investigations failed to load.'} onRetry={investigations.reload} />}
      {investigations.status === 'ready' && (investigations.data?.length ?? 0) === 0 && (
        <InsightsEmptyState icon={HelpCircle} title="No investigations yet" body="Ask your first Why? question above. Every answer cites the exact rows of your data that support it." />
      )}
      <div className="pa-investigation-list">
        {(investigations.data ?? []).map((investigation) => (
          <button key={investigation.id} className="pa-investigation-row" onClick={() => go('why', investigation.id)}>
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
    <section className="pa-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to Why?</button>
      <article className="pa-card pa-detail-card">
        <header className="pa-detail-head"><span className={`pa-type-badge status-${item.status.toLowerCase()}`}>{item.status === 'COMPLETED' ? 'Solved' : 'In progress'}</span><ConfidencePill score={item.confidenceScore} /></header>
        <h2>{item.question}</h2>
        <div className="pa-steps">
          <h4>How the answer was built</h4>
          <ol>{item.steps.map((step, index) => <li key={index}><span className="pa-step-index">{index + 1}</span>{step}</li>)}</ol>
          <p className="pa-muted">Data examined: {item.dataSourcesAnalyzed.join(' · ')}</p>
        </div>
        <div className="pa-causes">
          <h4>Root causes, ranked by measured impact</h4>
          {item.rootCauses.length === 0 && <p className="pa-muted">No dominant cause surfaced — the movement is within normal variance.</p>}
          {item.rootCauses.map((cause) => (
            <div key={cause.cause} className="pa-cause">
              <div className="pa-cause-head"><strong>{cause.cause}</strong><span>{Math.round(cause.impactShare * 100)}% of the movement</span></div>
              <div className="pa-cause-bar"><span style={{ width: `${Math.round(cause.impactShare * 100)}%` }} /></div>
              <p>{cause.evidence}</p>
            </div>
          ))}
        </div>
        {item.whatToDo.length > 0 && <div className="pa-actions-list"><h4><Lightbulb size={13} /> What to do</h4><ul>{item.whatToDo.map((tip) => <li key={tip}><CheckCircle2 size={12} /> {tip}</li>)}</ul></div>}
        {item.preventionTips.length > 0 && <div className="pa-actions-list"><h4>Prevent the repeat</h4><ul>{item.preventionTips.map((tip) => <li key={tip}>{tip}</li>)}</ul></div>}
        <footer className="pa-detail-actions"><span className="pa-muted">Was this answer useful?</span><RatingStars value={null} onRate={async (rating) => { try { await api.rateInsightInvestigation(storeId, id, rating); onToast('Thanks — your investigation rating was recorded.', 'success') } catch { onToast('Rating failed.', 'error') } }} /></footer>
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
      <div className="pa-toolbar">
        <div className="pa-toolbar-filters"><span className="pa-muted">{trends.length} signal{trends.length === 1 ? '' : 's'} under watch{freshness ? ` · ${freshness.toLowerCase()}` : ''}</span></div>
        <div className="pa-toolbar-actions"><ChartExportButton targetRef={chartRef} filename="insights-trend-scatter" enabled={exportEnabled} onLocked={onExportLocked} /></div>
      </div>

      {readiness && !readiness.canTrends && (
        <div className="pa-banner info"><Clock3 size={13} /> Trend watching sharpens with history — {readiness.trendsRequirement.have} of {readiness.trendsRequirement.need} days synced. Signals strengthen automatically as data lands.</div>
      )}

      {business.status === 'loading' && <InsightsSkeleton rows={4} />}
      {business.status === 'error' && <InsightsErrorPanel message={business.message ?? 'Trends failed to load.'} onRetry={business.reload} />}

      {trends.length > 0 && (
        <div className="pa-card" ref={chartRef}>
          <div className="pa-card-head"><span className="section-kicker"><Compass size={11} /> SIGNAL MAP</span><small>Magnitude vs confidence — click a signal to filter it below</small></div>
          <InsightsScatter points={trendScatter(trends).map((point) => ({ ...point, tone: point.up ? 'cyan' : 'rose' }))} xLabel="Magnitude →" yLabel="Confidence →" />
        </div>
      )}

      <TrendSection title="Your business" tone="up" trends={trends.filter((trend) => trend.trendType === 'BUSINESS')} storeId={storeId ?? ''} onChanged={() => business.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />
      <TrendSection title="Emerging" tone="up" trends={trends.filter((trend) => trend.trendType === 'EMERGING')} storeId={storeId ?? ''} onChanged={() => business.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />
      <TrendSection title="Declining" tone="down" trends={trends.filter((trend) => trend.trendType === 'DECLINING')} storeId={storeId ?? ''} onChanged={() => business.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />

      <div className="pa-trend-section">
        <h3><Compass size={14} /> Market</h3>
        {locked
          ? <InsightsLockedPanel feature="externalTrends" plan={plan} overview={overview} onNavigateBilling={onNavigateBilling} />
          : market.status === 'loading'
            ? <InsightsSkeleton rows={2} />
            : market.status === 'error'
              ? <InsightsErrorPanel message={market.message ?? 'Verified market signals failed to load.'} onRetry={market.reload} />
              : market.data && !market.data.available
                ? <div className="pa-honest-note"><Compass size={14} /><div><strong>Outside signals stay honest here</strong><p>{market.data.message}</p></div></div>
                : (market.data?.trends ?? []).map((trend) => <TrendRow key={trend.id} trend={trend} storeId={storeId ?? ''} onChanged={() => market.reload()} onToast={onToast} onNavigateBilling={onNavigateBilling} />)}
      </div>
    </section>
  )
}

function TrendSection({ title, tone, trends, storeId, onChanged, onToast, onNavigateBilling }: { title: string; tone: 'up' | 'down'; trends: readonly InsightTrend[]; storeId: string; onChanged: () => void; onToast: (m: string, k?: InsightsToastKind) => void; onNavigateBilling: () => void }) {
  return (
    <div className="pa-trend-section">
      <h3>{tone === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {title}</h3>
      {trends.length === 0 && <p className="pa-muted">Nothing here yet — the watcher only speaks when your data says something.</p>}
      {trends.map((trend) => <TrendRow key={trend.id} trend={trend} storeId={storeId} onChanged={onChanged} onToast={onToast} onNavigateBilling={onNavigateBilling} />)}
    </div>
  )
}

function TrendRow({ trend, storeId, onChanged, onToast, onNavigateBilling }: { trend: InsightTrend; storeId: string; onChanged: () => void; onToast: (m: string, k?: InsightsToastKind) => void; onNavigateBilling: () => void }) {
  return (
    <article className={`pa-trend-row dir-${trend.direction.toLowerCase()}`}>
      <span className="pa-trend-arrow">{trend.direction === 'UP' ? <TrendingUp size={15} /> : trend.direction === 'DOWN' ? <TrendingDown size={15} /> : <ChevronRight size={15} />}</span>
      <div className="pa-trend-copy"><strong>{trend.title}</strong><p>{trend.description}</p><small>{TREND_TYPE_LABELS[trend.trendType]} · {trend.timePeriod} · {trend.dataSource === 'INTERNAL' ? 'your data' : trend.dataSource.toLowerCase()} · {formatPercent(trend.magnitude, 1)} movement</small></div>
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
      <div className="pa-toolbar">
        <div className="pa-toolbar-filters"><span className="pa-muted">{list.data?.length ?? 0} comparison{(list.data?.length ?? 0) === 1 ? '' : 's'} run</span></div>
        <div className="pa-toolbar-actions">{!props.createMode && <button className="button primary" onClick={() => go('comparisons', 'new')}><Scale size={13} /> New comparison</button>}</div>
      </div>

      {(props.createMode || (list.data?.length ?? 0) === 0) && (
        <div className="pa-card pa-builder">
          <h3><Scale size={15} /> Build a comparison</h3>
          <div className="pa-builder-grid">
            <label>Type
              <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as ComparisonType }))}>
                {COMPARISON_TYPES.map((type) => <option key={type} value={type} disabled={!allowedTypes.includes(type)}>{COMPARISON_TYPE_LABELS_TEXT[type]}{allowedTypes.includes(type) ? '' : ' — plan upgrade'}</option>)}
              </select>
            </label>
            <label>Subject A{form.type === 'PRODUCT' ? <select value={form.a} onChange={(event) => setForm((current) => ({ ...current, a: event.target.value }))}><option value="">Pick a product…</option>{catalog.map((product) => <option key={product.productId} value={product.productId}>{productTitle(product)}</option>)}</select> : form.type === 'SEGMENT' ? <select value={form.a} onChange={(event) => setForm((current) => ({ ...current, a: event.target.value }))}><option value="">Pick a segment…</option>{SEGMENT_OPTIONS.map((segment) => <option key={segment.value} value={segment.value}>{segment.label}</option>)}</select> : <input value={form.a} onChange={(event) => setForm((current) => ({ ...current, a: event.target.value }))} placeholder={subjectPlaceholder(form.type, thirtyBack)} />}</label>
            <label>Subject B{form.type === 'PRODUCT' ? <select value={form.b} onChange={(event) => setForm((current) => ({ ...current, b: event.target.value }))}><option value="">Pick another product…</option>{catalog.map((product) => <option key={product.productId} value={product.productId}>{productTitle(product)}</option>)}</select> : form.type === 'SEGMENT' ? <select value={form.b} onChange={(event) => setForm((current) => ({ ...current, b: event.target.value }))}><option value="">Pick a segment…</option>{SEGMENT_OPTIONS.map((segment) => <option key={segment.value} value={segment.value}>{segment.label}</option>)}</select> : <input value={form.b} onChange={(event) => setForm((current) => ({ ...current, b: event.target.value }))} placeholder={subjectPlaceholder(form.type, sixtyBack)} />}</label>
          </div>
          {form.type === 'PERIOD' && <p className="pa-muted">Each period subject is a start day (YYYY-MM-DD); the engine compares the following 30-day windows. Today is {today}. Try {thirtyBack} vs {sixtyBack}.</p>}
          {form.type === 'CHANNEL' && <p className="pa-muted">Channel attribution depends on Shopify channel fields; if sync has not captured them, the comparison will tell you honestly instead of inventing a split.</p>}
          <div className="pa-builder-actions">
            {props.createMode && <button className="button ghost" onClick={() => go('comparisons', null)}><X size={12} /> Cancel</button>}
            <button className="button primary" disabled={busy || !form.a.trim() || !form.b.trim() || form.a.trim() === form.b.trim()} onClick={() => void run()}>{busy ? 'Measuring…' : 'Run comparison'}</button>
          </div>
        </div>
      )}

      {list.status === 'loading' && <InsightsSkeleton rows={3} />}
      {list.status === 'error' && <InsightsErrorPanel message={list.message ?? 'Comparisons failed to load.'} onRetry={list.reload} />}
      <div className="pa-comparison-list">
        {(list.data ?? []).map((comparison) => (
          <button key={comparison.id} className="pa-comparison-row" onClick={() => go('comparisons', comparison.id)}>
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
    <section className="pa-detail">
      <button className="text-button" onClick={onBack}><ArrowLeft size={12} /> Back to comparisons</button>
      <article className="pa-card pa-detail-card">
        <header className="pa-detail-head"><span className="pa-type-badge compare">{COMPARISON_TYPE_LABELS_TEXT[item.comparisonType]}</span><span className="pa-muted">{formatRelativeTime(item.createdAt)}</span></header>
        <h2>{item.title}</h2>
        {item.winner === 'INSUFFICIENT_DATA'
          ? <div className="pa-honest-note"><Scale size={14} /><div><strong>Not enough data to call this one</strong><p>{item.insights[0] ?? 'Both subjects need more synced history before a fair verdict.'}</p></div></div>
          : <>
            <div className="pa-winner-banner">{item.winner === 'TIE' ? 'Statistical tie — neither side dominates.' : `${subjectLabel(item.winner === 'A' ? item.subjectA : item.subjectB, item.winner)} wins on the measured metrics.`}</div>
            <InsightsComparisonBars rows={item.metrics} />
            <div className="pa-delta-table">
              {item.metrics.map((metric) => <div key={metric.metric} className="pa-delta-row"><span>{metric.metric.replaceAll('_', ' ')}</span><strong className={metric.winner === 'TIE' ? '' : 'pa-delta'}>{comparisonDelta(metric)}</strong></div>)}
            </div>
            <ul className="pa-insight-bullets">{item.insights.map((insight) => <li key={insight}>{insight}</li>)}</ul>
          </>}
        <footer className="pa-detail-actions"><button className="button ghost compact subtle" onClick={async () => { try { await api.deleteInsightComparison(storeId, id); onToast('Comparison removed.', 'info'); onBack() } catch { onToast('Delete failed.', 'error') } }}><Trash2 size={12} /> Delete</button></footer>
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
      <div className="pa-toolbar">
        <form className="pa-search" onSubmit={(event) => { event.preventDefault(); void search() }}>
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search everything PatternAI has learned…" aria-label="Search knowledge base" />
          {searchResults && <button type="button" className="icon-button" onClick={() => { setSearchResults(null); setQuery('') }} aria-label="Clear search"><X size={13} /></button>}
        </form>
        <div className="pa-toolbar-actions"><button className="button primary" onClick={() => setEditor({ id: null, title: '', content: '', tags: '' })}><Library size={13} /> Add note</button></div>
      </div>

      {network.nodes.length > 1 && (
        <div className="pa-card pa-network-card">
          <div className="pa-card-head"><span className="section-kicker"><Network size={11} /> HOW YOUR KNOWLEDGE CONNECTS</span><small>Linked insights and notes</small></div>
          <InsightsNetworkGraph nodes={network.nodes} edges={network.edges} onSelect={(id) => go('knowledge', id)} />
        </div>
      )}

      {cloud.length > 0 && <InsightsWordCloud words={cloud} onSelect={(tag) => { setActiveTag((current) => (current === tag ? null : tag)); setSearchResults(null) }} />}
      {activeTag && <div className="pa-banner info"><Network size={13} /> Filtering by tag “{activeTag}”. <button className="text-button" onClick={() => setActiveTag(null)}>Clear</button></div>}

      {list.status === 'loading' && <InsightsSkeleton rows={4} />}
      {list.status === 'error' && <InsightsErrorPanel message={list.message ?? 'The knowledge base failed to load.'} onRetry={list.reload} />}
      {list.status === 'ready' && items.length === 0 && (
        <InsightsEmptyState icon={Library} title={searchResults ? 'Nothing matches that search' : 'The knowledge base is empty'} body={searchResults ? 'Try different words — the index searches titles, bodies, and tags.' : 'Insights, lessons, and your own notes accumulate here into a searchable company brain. Add your first note to start.'} />
      )}

      <div className="pa-knowledge-list">
        {items.map((entry) => (
          <article key={entry.id} className="pa-knowledge-row">
            <span className="pa-type-badge knowledge">{KNOWLEDGE_TYPE_LABELS[entry.entryType]}</span>
            <div className="pa-knowledge-copy">
              <strong>{entry.title}</strong>
              <p>{entry.contentMarkdown.slice(0, 160)}{entry.contentMarkdown.length > 160 ? '…' : ''}</p>
              <small>{entry.author === 'AI' ? 'Written by PatternAI' : 'Your note'} · updated {formatRelativeTime(entry.updatedAt)}{entry.tags.length > 0 ? ` · ${entry.tags.join(', ')}` : ''}</small>
            </div>
            <div className="pa-pattern-actions">
              <button className="icon-button" title="Edit" onClick={() => setEditor({ id: entry.id, title: entry.title, content: entry.contentMarkdown, tags: entry.tags.join(', ') })}><BookOpen size={14} /></button>
              <button className="icon-button" title="Delete" onClick={async () => { try { await api.deleteInsightsKnowledge(storeId, entry.id); list.reload() } catch { onToast('Delete failed.', 'error') } }}><Trash2 size={14} /></button>
            </div>
          </article>
        ))}
      </div>

      {editor && (
        <div className="modal-overlay"><div className="modal-card pa-editor">
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

  if (!storeId) return <InsightsEmptyState icon={History} title="Connect your store first" body="Your discovery timeline fills in as PatternAI studies your store." />
  const events = timeline.data?.events ?? []
  const windowDays = timeline.data?.windowDays ?? null

  return (
    <section>
      <div className="pa-toolbar">
        <div className="pa-toolbar-filters">
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter timeline by type">
            <option value="ALL">Everything</option>
            {TIMELINE_TYPES.map((type) => <option key={type} value={type}>{TIMELINE_TYPE_LABELS[type]}</option>)}
          </select>
          <span className="pa-muted">{windowDays === null ? 'Full history' : `Last ${windowDays} days on your plan`}</span>
        </div>
        <div className="pa-toolbar-actions">{windowDays !== null && windowDays <= 30 && <InsightsUpgradeCta onNavigateBilling={onNavigateBilling} compact />}</div>
      </div>

      {timeline.status === 'loading' && <InsightsSkeleton rows={5} />}
      {timeline.status === 'error' && <InsightsErrorPanel message={timeline.message ?? 'The PatternAI timeline failed to load.'} onRetry={timeline.reload} />}
      {timeline.status === 'ready' && events.length === 0 && <InsightsEmptyState icon={History} title="The timeline is waiting for its first entry" body="Every discovery, lesson, pattern, persona, investigation, trend, comparison, and prediction lands here as it happens. Run a discovery sweep to begin." />}
      {events.length > 0 && <InsightsTimelineStrip events={events.map((event) => ({ id: event.id, at: event.eventAt, label: `${TIMELINE_TYPE_LABELS[event.entityType]}: ${event.description}`, tone: event.entityType.toLowerCase() }))} onSelect={(id) => { const event = events.find((entry) => entry.id === id); if (event) go(tabForTimelineEntity(event.entityType), event.entityId) }} />}
      <ol className="pa-timeline">
        {events.map((event) => (
          <li key={event.id} className={`pa-timeline-event type-${event.entityType.toLowerCase()}`}>
            <button onClick={() => go(tabForTimelineEntity(event.entityType), event.entityId)}>
              <span className="pa-timeline-badge">{TIMELINE_TYPE_LABELS[event.entityType]}</span>
              <span className="pa-timeline-text">{event.description}</span>
              <time>{formatRelativeTime(event.eventAt)}</time>
            </button>
          </li>
        ))}
      </ol>
      {overview?.trial && <div className="pa-banner sample"><History size={13} /> Trial sees the last week of the timeline. {INSIGHTS_UPGRADE_CTA} for the full memory.</div>}
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
      <div className="pa-toolbar">
        <div className="pa-toolbar-filters">
          <select value={horizon} onChange={(event) => setHorizon(event.target.value as 'ALL' | PredictionHorizon)} aria-label="Filter by horizon">
            <option value="ALL">All horizons</option>
            {(Object.keys(HORIZON_LABELS) as PredictionHorizon[]).map((value) => <option key={value} value={value} disabled={allowedHorizons.length > 0 && !allowedHorizons.includes(value)}>{HORIZON_LABELS[value]}{allowedHorizons.length > 0 && !allowedHorizons.includes(value) ? ' — plan upgrade' : ''}</option>)}
          </select>
        </div>
        <div className="pa-toolbar-actions"><button className="button primary" onClick={() => void generate()} disabled={generating}><Sparkles size={13} /> {generating ? 'Projecting…' : 'Refresh forecasts'}</button></div>
      </div>

      {readiness && !readiness.canPredict && <div className="pa-banner info"><Clock3 size={13} /> Forecasting needs {readiness.predictRequirement.need} days of revenue history — you have {readiness.predictRequirement.have}. The model gets more honest every day you sync.</div>}
      {predictions.status === 'loading' && <InsightsSkeleton rows={3} />}
      {predictions.status === 'error' && <InsightsErrorPanel message={predictions.message ?? 'Predictions failed to load.'} onRetry={predictions.reload} />}
      {predictions.status === 'ready' && items.length === 0 && <InsightsEmptyState icon={Sparkles} title="No forecasts yet" body="Refresh forecasts and the engine projects revenue, orders, and stockouts from your real trend lines — every prediction ships with a confidence interval and an accuracy score once reality votes." />}
      <div className="pa-prediction-grid">
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
    <article className={`pa-card pa-prediction type-${prediction.predictionType.toLowerCase()}`}>
      <header className="pa-detail-head"><span className="pa-type-badge predict">{PREDICTION_TYPE_LABELS[prediction.predictionType]}</span><span className="pa-category">{HORIZON_LABELS[prediction.horizon]}</span><ConfidencePill score={prediction.confidenceScore} /></header>
      <h3>{prediction.title}</h3>
      <p>{prediction.description}</p>
      <div className="pa-prediction-figure">
        <strong>{isMoney ? formatInsightMoney(prediction.predictedValue, prediction.currency) : formatInsightNumber(prediction.predictedValue)}</strong>
        <span>range {isMoney ? formatInsightMoney(prediction.predictedLow, prediction.currency) : formatInsightNumber(prediction.predictedLow)} – {isMoney ? formatInsightMoney(prediction.predictedHigh, prediction.currency) : formatInsightNumber(prediction.predictedHigh)}</span>
      </div>
      <InsightsAreaBand series={prediction.series} formatValue={(value) => (isMoney ? formatInsightMoney(value, prediction.currency) : formatInsightNumber(value))} />
      <small className="pa-muted">Method: {prediction.method} · based on {prediction.basedOn.join(', ')}</small>
      {prediction.accuracyScore !== null
        ? <p className="pa-accuracy"><CheckCircle2 size={12} /> Actual: {isMoney ? formatInsightMoney(prediction.actualValue, prediction.currency) : formatInsightNumber(prediction.actualValue)} — accuracy {Math.round(prediction.accuracyScore * 100)}%</p>
        : <div className="pa-validate"><input value={actual} onChange={(event) => setActual(event.target.value)} placeholder="Actual value when the window closes" aria-label="Actual value" /><button className="button ghost compact" disabled={validating || !actual.trim()} onClick={() => void validate()}>Grade it</button></div>}
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

  if (!storeId) return <InsightsEmptyState icon={Settings2} title="Connect your store first" body="Preferences shape how PatternAI studies your data." />
  if (preferences.status === 'loading') return <InsightsSkeleton rows={4} />
  if (preferences.status === 'error' || !preferences.data) return <InsightsErrorPanel message={preferences.message ?? 'PatternAI settings failed to load.'} onRetry={preferences.reload} />
  const prefs = preferences.data
  const autoDiscoveryPlanLocked = overview ? !overview.features.autoDiscovery : plan === 'trial'

  return (
    <section className="pa-settings">
      <div className="pa-card pa-settings-card">
        <h3><Network size={15} /> Auto-discovery</h3>
        <p className="pa-muted">The nightly sweep (2:00 AM UTC; Sundays for weekly) studies your newest synced data and files discoveries, patterns, and trends while you sleep.</p>
        <ToggleRow label="Auto-discovery" hint={autoDiscoveryPlanLocked ? 'Unlocks with a plan upgrade' : 'Run discovery automatically'} checked={prefs.autoDiscoveryEnabled && !autoDiscoveryPlanLocked} disabled={autoDiscoveryPlanLocked || saving} onChange={(value) => void patch({ autoDiscoveryEnabled: value })} />
        <div className="pa-field"><span>Frequency</span><div className="pa-choice-row">{(['DAILY', 'WEEKLY', 'REALTIME'] as const).map((frequency) => { const realtimeLocked = frequency === 'REALTIME' && plan !== 'commander'; return <button key={frequency} className={`pa-choice ${prefs.discoveryFrequency === frequency ? 'active' : ''}`} disabled={realtimeLocked || saving} onClick={() => void patch({ discoveryFrequency: frequency })} title={realtimeLocked ? 'Real-time unlocks on the highest plan' : undefined}>{frequency === 'REALTIME' ? 'Real-time' : frequency === 'DAILY' ? 'Daily 2:00 AM' : 'Weekly (Sunday)'}{realtimeLocked && <Lock size={10} />}</button> })}</div></div>
        <div className="pa-field"><span>Categories studied</span><div className="pa-choice-row wrap">{DISCOVERY_CATEGORIES.map((category) => { const active = prefs.discoveryCategories.includes(category); return <button key={category} className={`pa-choice ${active ? 'active' : ''}`} disabled={saving} onClick={() => void patch({ discoveryCategories: active ? prefs.discoveryCategories.filter((item) => item !== category) : [...prefs.discoveryCategories, category] })}>{DISCOVERY_CATEGORY_LABELS[category]}</button> })}</div></div>
      </div>

      <div className="pa-card pa-settings-card">
        <h3><Bell size={15} /> Notifications</h3>
        <ToggleRow label="High-confidence discoveries" hint="Ping me when confidence clears 85%" checked={prefs.notificationPreferences.highConfidenceDiscoveries} disabled={saving} onChange={(value) => void patch({ notificationPreferences: { ...prefs.notificationPreferences, highConfidenceDiscoveries: value } })} />
        <ToggleRow label="Trend alerts" hint="A watched trend accelerates or breaks" checked={prefs.notificationPreferences.trendAlerts} disabled={saving} onChange={(value) => void patch({ notificationPreferences: { ...prefs.notificationPreferences, trendAlerts: value } })} />
        <ToggleRow label="Anomaly alerts" hint="A day steps outside its normal band" checked={prefs.notificationPreferences.anomalyAlerts} disabled={saving} onChange={(value) => void patch({ notificationPreferences: { ...prefs.notificationPreferences, anomalyAlerts: value } })} />
        <ToggleRow label="Weekly digest" hint="A Sunday summary of the week’s learnings" checked={prefs.notificationPreferences.weeklyDigest} disabled={saving} onChange={(value) => void patch({ notificationPreferences: { ...prefs.notificationPreferences, weeklyDigest: value } })} />
      </div>

      <div className="pa-card pa-settings-card">
        <h3><Waypoints size={15} /> Study behavior</h3>
        <ToggleRow label="Trend monitoring" hint="Keep business trend signals under watch" checked={prefs.trendMonitoringEnabled} disabled={saving} onChange={(value) => void patch({ trendMonitoringEnabled: value })} />
        <ToggleRow label="Persona refresh" hint="Re-cluster personas as customers evolve" checked={prefs.personaUpdatesEnabled} disabled={saving} onChange={(value) => void patch({ personaUpdatesEnabled: value })} />
        <div className="pa-field"><span>Insight language</span><div className="pa-choice-row"><button className={`pa-choice ${prefs.language === 'en' ? 'active' : ''}`} disabled={saving} onClick={() => void patch({ language: 'en' })}>English</button><button className={`pa-choice ${prefs.language === 'hi' ? 'active' : ''}`} disabled={saving} onClick={() => void patch({ language: 'hi' })}>हिन्दी</button></div></div>
        <p className="pa-muted">API access lives on its own page — {plan === 'commander' ? 'available on your plan.' : 'it unlocks on the highest plan.'} {plan !== 'commander' && <button className="text-button" onClick={onNavigateBilling}>{INSIGHTS_UPGRADE_CTA}</button>}</p>
      </div>
    </section>
  )
}

function ToggleRow({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="pa-toggle-row">
      <div><strong>{label}</strong><small>{hint}</small></div>
      <button className={`pa-toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
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
    <section className="pa-api">
      <div className="pa-card pa-settings-card">
        <h3><KeyRound size={15} /> Programmatic access</h3>
        <p className="pa-muted">Your insights as JSON — discoveries, patterns, personas, predictions, trends — for your own dashboards and automations. {data?.rateLimitPerHour !== null && data?.rateLimitPerHour !== undefined ? `${data.rateLimitPerHour} requests/hour · ${data.rateLimitPerHour * 10}/day.` : ''}</p>
        {data?.maskedKey
          ? <div className="pa-key-row"><code>{data.maskedKey}</code><button className="button secondary compact" disabled={busy} onClick={() => void generate(true)}>Regenerate</button><small className="pa-muted">Regenerating invalidates the old key instantly.</small></div>
          : <button className="button primary" disabled={busy} onClick={() => void generate(false)}>{busy ? 'Issuing…' : 'Generate API key'}</button>}
        {revealed && (
          <div className="pa-key-reveal">
            <strong>Your new key — shown once</strong>
            <div className="pa-key-row"><code>{revealed}</code><button className="button ghost compact" onClick={() => { navigator.clipboard?.writeText(revealed).then(() => onToast('Key copied.', 'success'), () => onToast('Copy failed.', 'error')) }}><Copy size={12} /> Copy</button></div>
            <button className="text-button" onClick={() => setRevealed(null)}>I have stored it safely — hide it</button>
          </div>
        )}
      </div>

      {data && (
        <div className="pa-card pa-settings-card">
          <h3><Zap size={15} /> Usage</h3>
          <div className="pa-usage-grid">
            <div className="pa-stat"><span>Requests this hour</span><strong>{formatInsightNumber(data.usage.requestsThisHour)}</strong>{data.rateLimitPerHour !== null && <small>of {data.rateLimitPerHour}</small>}</div>
            <div className="pa-stat"><span>Requests today</span><strong>{formatInsightNumber(data.usage.requestsToday)}</strong>{data.rateLimitPerHour !== null && <small>of {data.rateLimitPerHour * 10}</small>}</div>
          </div>
          {data.recent.length > 0 && <ol className="pa-api-recent">{data.recent.map((call, index) => <li key={`${call.calledAt}-${index}`}><code>{call.endpoint}</code><time>{formatRelativeTime(call.calledAt)}</time></li>)}</ol>}
        </div>
      )}

      <div className="pa-card pa-settings-card">
        <h3><BookOpen size={15} /> Quick start</h3>
        <pre className="pa-code">{`curl -H "Authorization: Bearer ihk_your_key" \\
  ${typeof window === 'undefined' ? 'https://your-profitpilot-host' : window.location.origin}/public-api/insights/discoveries?status=NEW`}</pre>
        <pre className="pa-code">{`// JavaScript
const res = await fetch('/public-api/insights/predictions', {
  headers: { Authorization: 'Bearer ihk_your_key' },
})
const { data } = await res.json()`}</pre>
        <pre className="pa-code">{`# Python
import requests
requests.get('https://your-profitpilot-host/public-api/insights/trends',
             headers={'Authorization': 'Bearer ihk_your_key'}).json()`}</pre>
        <p className="pa-muted">OpenAPI 3.1 spec: <a href={docs.data?.specUrl ?? '/public-api/insights/openapi.json'} target="_blank" rel="noreferrer">{docs.data?.specUrl ?? '/public-api/insights/openapi.json'}</a></p>
      </div>
    </section>
  )
}
