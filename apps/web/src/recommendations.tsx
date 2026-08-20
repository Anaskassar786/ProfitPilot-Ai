import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Box,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Crosshair,
  Database,
  Eye,
  FlaskConical,
  Gauge,
  Heart,
  History,
  Info,
  Layers,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Package,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Tag,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  UserX,
  Workflow,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  ApiClientError,
  analyzeRecommendations,
  bulkDecideRecommendations,
  decideRecommendationWithReason,
  fetchRecommendation,
  fetchRecommendationPage,
  fetchRecommendationSummary,
  snoozeRecommendation,
  undoRecommendationDecision,
  verifyRecommendationEvidence,
} from './api.js'
import type { SectionId, WorkspaceContext } from './model.js'
import {
  ACTION_TYPE_PREVIEWS,
  AGENT_DESCRIPTIONS,
  AGENT_UNLOCK_ORDER,
  EXPLANATION_STATUS_LABELS,
  KPI_TOOLTIPS,
  PLAN_LABELS,
  REJECT_REASON_LABELS,
  REJECT_REASON_OPTIONS,
  RULE_AGENT,
  RULE_DATA_SOURCES,
  RULE_DESCRIPTIONS,
  RULE_DETAILS,
  RULE_EMOJIS,
  RULE_LABELS,
  RULE_TAGLINES,
  STATUS_TABS,
  STATUS_TAB_TOOLTIPS,
  TEAM_FIND_BULLETS,
  greetingForHour,
  shopDisplayName,
  actionTypeLabel,
  agentLabel,
  agentLockedForPlan,
  applyDecisionLocally,
  expiryBadge,
  formatCurrencyAmounts,
  formatDecisionDelay,
  formatDurationMs,
  formatImpact,
  formatRelativeTime,
  groupRecommendations,
  healthTone,
  impactLabelText,
  impactRatio,
  parseRecommendationsHash,
  planRequiredForAgent,
  recommendationsHash,
  riskLabel,
  ruleLabel,
  searchRecommendations,
  snoozeBadge,
  statusLabel,
  statusTabCount,
  statusTabLabel,
  usageState,
} from './recommendations-model.js'
import type {
  AgentId,
  AnalysisReport,
  EvidenceVerification,
  GroupMode,
  RecommendationSort,
  RecommendationStatus,
  RecommendationSummary,
  RecommendationView,
  RejectReason,
  RuleId,
  StatusTab,
} from './recommendations-model.js'

type ToastKind = 'success' | 'info' | 'warning' | 'error'
type LoadPhase = 'loading' | 'ready' | 'error'

type WorkspaceProps = Readonly<{
  context: WorkspaceContext
  onToast: (message: string, kind?: ToastKind) => void
  onNavigateBilling: () => void
  /** Cross-section navigation for the report panel's follow-up CTAs. */
  onNavigateSection?: (section: SectionId) => void
}>

const AGENT_ICONS: Readonly<Record<AgentId, LucideIcon>> = {
  REVENUE_AGENT: TrendingUp,
  INVENTORY_AGENT: Box,
  CUSTOMER_AGENT: Users,
  PRICING_AGENT: Tag,
  PRODUCT_AGENT: Package,
  EXECUTIVE_AGENT: Briefcase,
}

const AGENT_COLORS: Readonly<Record<AgentId, string>> = {
  REVENUE_AGENT: '#10B981',
  INVENTORY_AGENT: '#3B82F6',
  CUSTOMER_AGENT: '#9B7CF6',
  PRICING_AGENT: '#F59E0B',
  PRODUCT_AGENT: '#EF4444',
  EXECUTIVE_AGENT: '#FBBF24',
}

const SORT_OPTIONS: readonly Readonly<{ id: RecommendationSort; direction: 'asc' | 'desc'; label: string }>[] = [
  { id: 'impact', direction: 'desc', label: 'Highest impact' },
  { id: 'confidence', direction: 'desc', label: 'Highest confidence' },
  { id: 'created', direction: 'desc', label: 'Newest first' },
  { id: 'created', direction: 'asc', label: 'Oldest first' },
  { id: 'decided', direction: 'desc', label: 'Recently decided' },
]

const SORT_TOOLTIP = 'How your AI team ranks this list — by money at stake, confidence, or how new it is.'

const RULE_ICONS: Readonly<Record<RuleId, LucideIcon>> = {
  STOCKOUT_RISK: Box,
  DEAD_STOCK: Package,
  CHURN_RISK: UserX,
  PRICING_UPLIFT: Tag,
  REPEAT_PURCHASE: Repeat,
  CART_ABANDONMENT: ShoppingCart,
  CROSS_SELL: ShoppingBag,
  NEW_CUSTOMER_WELCOME: UserPlus,
}

const RULE_ORDER = Object.keys(RULE_LABELS) as readonly RuleId[]

/** Stages of a real analysis run, mirrored in the progress modal while the engine works. */
export const ANALYSIS_STEPS: readonly Readonly<{ label: string; detail: string }>[] = [
  { label: 'Scanning your products', detail: 'Stock cover, sales speed, and what is selling' },
  { label: 'Analyzing customer behavior', detail: 'Who buys, who is quiet, who might leave' },
  { label: 'Checking inventory levels', detail: 'Bestsellers at risk and cash sitting idle' },
  { label: 'Reviewing recent orders', detail: 'What people buy together and what they leave behind' },
  { label: 'Finding patterns', detail: 'Matching your store data to opportunities that matter' },
  { label: 'Preparing your wins', detail: 'Pricing the impact so you can decide with confidence' },
]

/** Day-of-week letters for the mini weekly bars (0=Sunday). */
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

/** Sample activity heights (clearly labeled) for the empty 30-day chart preview. */
const SAMPLE_ACTIVITY_HEIGHTS: readonly number[] = [8, 22, 14, 34, 12, 26, 44, 18, 30, 24, 10, 38, 20, 28, 16, 42, 24, 12, 34, 26, 18, 46, 22, 14, 30, 20, 36, 16, 28, 40]

type PendingConfirm = Readonly<{ kind: 'approve'; recommendation: RecommendationView }> | Readonly<{ kind: 'reject'; recommendation: RecommendationView }>
type UndoState = Readonly<{ recommendation: RecommendationView; decision: 'approved' | 'rejected'; expiresAt: number }>

export function RecommendationsWorkspace({ context, onToast, onNavigateBilling, onNavigateSection }: WorkspaceProps) {
  const storeId = context.storeId
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [items, setItems] = useState<readonly RecommendationView[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [summary, setSummary] = useState<RecommendationSummary | null>(null)
  const [statusTab, setStatusTab] = useState<StatusTab>('ALL')
  const [agentFilter, setAgentFilter] = useState<AgentId | null>(null)
  const [sortIndex, setSortIndex] = useState(0)
  const [groupMode, setGroupMode] = useState<GroupMode>('none')
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [drawer, setDrawer] = useState<RecommendationView | null>(null)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisStep, setAnalysisStep] = useState(0)
  const [analysisElapsedMs, setAnalysisElapsedMs] = useState(0)
  const [analysisModalHidden, setAnalysisModalHidden] = useState(false)
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [reportDismissed, setReportDismissed] = useState(false)
  const [ruleModal, setRuleModal] = useState<RuleId | null>(null)
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null)
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [busyDecisionIds, setBusyDecisionIds] = useState<ReadonlySet<string>>(new Set())
  const undoTimer = useRef<number | null>(null)
  const sort = SORT_OPTIONS[sortIndex] ?? SORT_OPTIONS[0]!

  const load = useCallback(async (options: Readonly<{ silent?: boolean }> = {}) => {
    if (!storeId) { setPhase('ready'); setItems([]); setSummary(null); return }
    if (!options.silent) { setPhase('loading'); setLoadError(null) }
    const filters: Record<string, unknown> = { sort: sort.id, direction: sort.direction, limit: 50 }
    if (statusTab !== 'ALL') filters.status = statusTab
    if (agentFilter) filters.agent = agentFilter
    if (dateFrom) filters.dateFrom = `${dateFrom}T00:00:00.000Z`
    if (dateTo) filters.dateTo = `${dateTo}T23:59:59.999Z`
    const [pageResult, summaryResult] = await Promise.allSettled([
      fetchRecommendationPage(storeId, filters),
      fetchRecommendationSummary(storeId),
    ])
    if (pageResult.status === 'rejected') {
      setPhase('error')
      setLoadError(errorText(pageResult.reason))
      return
    }
    setItems(pageResult.value.items)
    setTotal(pageResult.value.total)
    setHasMore(pageResult.value.hasMore)
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value)
    setPhase('ready')
    setRefreshedAt(Date.now())
  }, [storeId, statusTab, agentFilter, sort.id, sort.direction, dateFrom, dateTo])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => { if (undoTimer.current !== null) window.clearTimeout(undoTimer.current) }, [])

  // Deep link support: #/recommendations/:id?evidence=true opens the drawer
  // for that recommendation on mount and on back/forward navigation. A record
  // outside the current filter page is fetched individually by id.
  useEffect(() => {
    let cancelled = false
    const applyHash = () => {
      const route = parseRecommendationsHash(window.location.hash)
      if (!route || !route.recommendationId) return
      const match = items.find((item) => item.id === route.recommendationId)
      if (match) { setDrawer(match); return }
      if (storeId) {
        void fetchRecommendation(storeId, route.recommendationId)
          .then((record) => { if (!cancelled) setDrawer(record) })
          .catch(() => { if (!cancelled) onToast('That recommendation link could not be found for this store.', 'warning') })
      }
    }
    applyHash()
    window.addEventListener('popstate', applyHash)
    window.addEventListener('hashchange', applyHash)
    return () => { cancelled = true; window.removeEventListener('popstate', applyHash); window.removeEventListener('hashchange', applyHash) }
  }, [items, storeId, onToast])

  const openDrawer = (recommendation: RecommendationView) => {
    setDrawer(recommendation)
    try { window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${recommendationsHash(recommendation.id, true)}`) } catch { /* embedded browsers may restrict history */ }
  }
  const closeDrawer = () => {
    setDrawer(null)
    try { window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${recommendationsHash(null)}`) } catch { /* ignore */ }
  }

  const usage = usageState(summary?.usage.used ?? null, summary?.usage.limit ?? null)
  const plan = summary?.plan ?? null
  const analyzeBlocked = usage.atLimit && usage.limit !== null

  // While an analysis is genuinely in flight, advance the staged progress
  // display. The final stage holds until the API responds — the bar never
  // claims completion the request has not earned.
  useEffect(() => {
    if (!analyzing) return
    setAnalysisStep(0)
    setAnalysisElapsedMs(0)
    const started = Date.now()
    const timer = window.setInterval(() => {
      setAnalysisElapsedMs(Date.now() - started)
      setAnalysisStep((current) => Math.min(ANALYSIS_STEPS.length - 1, current + 1))
    }, 900)
    return () => window.clearInterval(timer)
  }, [analyzing])

  const runAnalysis = async () => {
    if (!storeId) { onToast('Connect Shopify first — then we can look through your store.', 'info'); return }
    if (analyzeBlocked) { onToast('You have used this month\'s recommendations. Upgrade Plan to keep discovering more.', 'warning'); return }
    setAnalyzing(true)
    setAnalysisModalHidden(false)
    const started = Date.now()
    try {
      const result = await analyzeRecommendations(storeId)
      const received: AnalysisReport = { ...result, receivedAt: new Date().toISOString(), elapsedMs: Date.now() - started }
      setReport(received)
      setReportDismissed(false)
      setLastAnalyzedAt(received.receivedAt)
      if (result.recommendations.length > 0) {
        onToast(`Nice! We found ${result.recommendations.length} opportunit${result.recommendations.length === 1 ? 'y' : 'ies'} for you.`, 'success')
      }
      // Zero findings is a rich result, not a toast: the health-check panel
      // below renders exactly what was analyzed and why nothing fired.
      await load({ silent: true })
    } catch (error: unknown) {
      if (isUpgradeRequired(error)) onToast(errorText(error), 'warning')
      else onToast(errorText(error), 'error')
    } finally { setAnalyzing(false) }
  }

  const applyLocal = (updated: RecommendationView) => {
    setItems((current) => applyDecisionLocally(current, updated))
    setDrawer((current) => (current?.id === updated.id ? updated : current))
    // Re-read the current filtered page as soon as the server confirms the
    // decision. This removes a decided card from the Pending tab and makes the
    // destination tab/counts reflect the same durable state as the API.
    void load({ silent: true })
  }

  const startUndoWindow = (recommendation: RecommendationView, decision: 'approved' | 'rejected') => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    setUndo({ recommendation, decision, expiresAt: Date.now() + 30_000 })
    undoTimer.current = window.setTimeout(() => setUndo(null), 30_000)
  }

  const decide = async (recommendation: RecommendationView, decision: 'approve' | 'reject', reason: RejectReason | null) => {
    if (!storeId || busyDecisionIds.has(recommendation.id)) return
    setBusyDecisionIds((current) => new Set(current).add(recommendation.id))
    try {
      const updated = await decideRecommendationWithReason(storeId, recommendation.id, recommendation.version, decision, reason)
      applyLocal(updated)
      startUndoWindow(updated, decision === 'approve' ? 'approved' : 'rejected')
      onToast(decision === 'approve' ? 'Recommendation approved' : 'Recommendation skipped', 'success')
    } catch (error: unknown) {
      onToast(errorText(error), 'error')
      await load({ silent: true })
    } finally {
      setBusyDecisionIds((current) => {
        const next = new Set(current)
        next.delete(recommendation.id)
        return next
      })
    }
  }

  const requestApprove = (recommendation: RecommendationView) => {
    if (recommendation.actionRisk === 'SAFE') { void decide(recommendation, 'approve', null); return }
    setConfirm({ kind: 'approve', recommendation })
  }
  // Skipping is intentionally one click. A reason is optional and remains
  // available to other decision surfaces; the primary card action should not
  // make a merchant open a second dialog before the recommendation leaves the
  // pending queue.
  const requestReject = (recommendation: RecommendationView) => { void decide(recommendation, 'reject', null) }

  const performUndo = async () => {
    if (!storeId || !undo) return
    try {
      const reverted = await undoRecommendationDecision(storeId, undo.recommendation.id)
      applyLocal(reverted)
      setUndo(null)
      onToast('Undone — it is waiting for you again.', 'info')
    } catch (error: unknown) { onToast(errorText(error), 'error'); setUndo(null) }
  }

  const snooze = async (recommendation: RecommendationView, hours: number) => {
    if (!storeId) return
    try {
      const updated = await snoozeRecommendation(storeId, recommendation.id, hours)
      applyLocal(updated)
      onToast(`Snoozed for ${hours >= 24 ? `${Math.round(hours / 24)} day${hours >= 48 ? 's' : ''}` : `${hours} hour${hours === 1 ? '' : 's'}`}.`, 'info')
    } catch (error: unknown) { onToast(errorText(error), 'error') }
  }

  const copyLink = (recommendation: RecommendationView) => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${recommendationsHash(recommendation.id, true)}`
    void navigator.clipboard?.writeText(url).then(() => onToast('Link copied to clipboard.', 'success')).catch(() => onToast('Could not copy the link.', 'error'))
  }

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const bulkDecide = async (decision: 'approve' | 'reject') => {
    if (!storeId || selected.size === 0) return
    const chosen = items.filter((item) => selected.has(item.id) && item.status === 'PENDING')
    if (chosen.length === 0) { onToast('Select waiting recommendations first.', 'info'); return }
    setBulkBusy(true)
    try {
      const result = await bulkDecideRecommendations(storeId, chosen.slice(0, 20).map((item) => ({ id: item.id, expectedVersion: item.version, decision })))
      const succeeded = result.results.filter((entry) => entry.ok)
      const failed = result.results.filter((entry) => !entry.ok)
      for (const entry of succeeded) { if (entry.recommendation) setItems((current) => applyDecisionLocally(current, entry.recommendation!)) }
      setSelected(new Set())
      void load({ silent: true })
      onToast(failed.length > 0 ? `${succeeded.length} ${decision === 'approve' ? 'approved' : 'skipped'}, ${failed.length} failed (${failed[0]?.error?.message ?? 'conflict'}).` : `${succeeded.length} recommendation${succeeded.length === 1 ? '' : 's'} ${decision === 'approve' ? 'approved' : 'skipped'}. Keep going — you are growing!`, failed.length > 0 ? 'warning' : 'success')
    } catch (error: unknown) { onToast(errorText(error), 'error') } finally { setBulkBusy(false) }
  }

  const loadMore = async () => {
    if (!storeId || loadingMore) return
    setLoadingMore(true)
    try {
      const filters: Record<string, unknown> = { sort: sort.id, direction: sort.direction, limit: 50, cursor: items.length }
      if (statusTab !== 'ALL') filters.status = statusTab
      if (agentFilter) filters.agent = agentFilter
      if (dateFrom) filters.dateFrom = `${dateFrom}T00:00:00.000Z`
      if (dateTo) filters.dateTo = `${dateTo}T23:59:59.999Z`
      const page = await fetchRecommendationPage(storeId, filters)
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))])
      setHasMore(page.hasMore)
      setTotal(page.total)
    } catch (error: unknown) { onToast(errorText(error), 'error') } finally { setLoadingMore(false) }
  }

  const visibleItems = useMemo(() => searchRecommendations(items, query), [items, query])
  const maxImpact = useMemo(() => visibleItems.reduce((max, item) => Math.max(max, item.impactValue), 0), [visibleItems])
  const groups = useMemo(() => groupRecommendations(visibleItems, groupMode), [visibleItems, groupMode])
  const counts = summary?.counts ?? { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 }
  const pendingSelectable = visibleItems.filter((item) => item.status === 'PENDING')

  if (!storeId) {
    return <div className="recs-workspace"><RecsEmptyCard icon={Sparkles} title="Connect your store to meet your AI team" description="Your AI assistants only look at your real store data. Connect Shopify and we will start finding opportunities — we never invent filler insights." action={null} /></div>
  }

  return (
    <div className="recs-workspace">
      <div className="recs-topline">
        <div className="recs-topline-copy">
          <span className="recs-kicker"><Sparkles size={14} /> Your AI team · action items</span>
          <h2 className="recs-welcome"><GreetingMark /> {greetingForHour(new Date().getHours())}{shopDisplayName(context.shop) ? `, ${shopDisplayName(context.shop)}` : ''} <span aria-hidden>🎯</span></h2>
          <p>Your AI team has been watching your store. Here are opportunities to grow your business — review and take action.</p>
        </div>
        <div className="recs-topline-actions">
          {lastAnalyzedAt && (
            <span className="recs-last-run" title={`Finished ${new Date(lastAnalyzedAt).toLocaleString()}. Come back anytime for a fresh look.`}>
              <History size={14} /> Last look {formatRelativeTime(lastAnalyzedAt)}
            </span>
          )}
          <button className="button secondary" onClick={() => setHowItWorksOpen(true)}><Info size={14} /> How it works</button>
          <button className={`button primary recs-discover ${analyzeBlocked ? 'blocked' : ''}`} onClick={() => void runAnalysis()} disabled={analyzing} title={analyzeBlocked ? `Monthly limit reached (${usage.label}). Upgrade Plan to continue.` : lastAnalyzedAt ? `Last look ${formatRelativeTime(lastAnalyzedAt)}` : 'Ask your AI team to look through your store'}>
            {analyzing ? <RefreshCw size={15} className="spin" /> : analyzeBlocked ? <LockKeyhole size={15} /> : <Sparkles size={15} />}
            {analyzing ? 'Discovering opportunities…' : analyzeBlocked ? 'Limit reached' : 'Discover Opportunities'}
          </button>
        </div>
      </div>

      {usage.nearLimit && !usage.atLimit && (
        <div className="recs-banner warning"><AlertTriangle size={16} /><span><strong>{usage.remaining} recommendation{usage.remaining === 1 ? '' : 's'} left this month</strong> on your {plan ? PLAN_LABELS[plan] : ''} plan ({usage.label}).</span><button className="button secondary compact" onClick={onNavigateBilling}>View plans <ArrowUpRight size={13} /></button></div>
      )}
      {usage.atLimit && usage.limit !== null && (
        <div className="recs-banner blocked"><LockKeyhole size={16} /><span><strong>Monthly limit reached — {usage.label}.</strong> Your AI team found value {usage.limit} times this month. Upgrade Plan to keep the recommendations coming.</span><button className="button primary compact" onClick={onNavigateBilling}>Upgrade Plan <ArrowUpRight size={13} /></button></div>
      )}

      <section className="recs-section" aria-label="Overview">
        <div className="recs-section-head">
          <h3><Target size={16} /> Overview</h3>
          <p>A quick pulse on the money waiting, how you are deciding, and this month's usage.</p>
        </div>
        {phase === 'loading' ? <KpiSkeleton /> : summary && <KpiHero summary={summary} usage={usage} plan={plan} onUpgrade={onNavigateBilling} />}
      </section>

      <div className="recs-body">
        <div className="recs-main">
          <section className="recs-section recs-section-main" aria-label="Active recommendations">
          <div className="recs-section-head">
            <h3><ListChecks size={16} /> Your action items</h3>
            <p>Review what your AI team found. Approve the ones that feel right — skip the rest.</p>
          </div>
          <div className="recs-toolbar">
            <div className="recs-tabs" role="tablist" aria-label="Recommendation status">
              {STATUS_TABS.map((tab) => (
                <button key={tab} role="tab" aria-selected={statusTab === tab} className={`recs-tab recs-tip-anchor ${statusTab === tab ? 'active' : ''}`} data-tip={STATUS_TAB_TOOLTIPS[tab]} data-tip-align={tab === 'ALL' ? 'left' : tab === 'EXECUTED' ? 'right' : 'center'} onClick={() => { setStatusTab(tab); setSelected(new Set()) }}>
                  {statusTabLabel(tab)}
                  <span className="recs-tab-count">{statusTabCount(tab, counts)}</span>
                </button>
              ))}
            </div>
            <div className="recs-toolbar-row">
              <div className="recs-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search by title, product, customer, or rule…" aria-label="Search recommendations by title, product, customer, or rule" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>}</div>
              <span className="recs-tip-anchor recs-sort-wrap" data-tip={SORT_TOOLTIP}>
                <select className="recs-select" value={sortIndex} onChange={(event) => setSortIndex(Number(event.target.value))} aria-label={`Sort recommendations. ${SORT_TOOLTIP}`}>
                  {SORT_OPTIONS.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
                </select>
              </span>
              <div className="recs-group-toggle" role="group" aria-label="Group recommendations">
                <button className={groupMode === 'none' ? 'active' : ''} onClick={() => setGroupMode('none')}>List</button>
                <button className={groupMode === 'agent' ? 'active' : ''} onClick={() => setGroupMode('agent')}>By agent</button>
                <button className={groupMode === 'rule' ? 'active' : ''} onClick={() => setGroupMode('rule')}>By rule</button>
              </div>
              <div className="recs-dates">
                <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} onInput={(event) => setDateFrom(event.currentTarget.value)} aria-label="From date" />
                <span>–</span>
                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} onInput={(event) => setDateTo(event.currentTarget.value)} aria-label="To date" />
              </div>
              <button className="icon-button recs-refresh" onClick={() => void load()} title={refreshedAt ? `Refreshed ${formatRelativeTime(new Date(refreshedAt).toISOString())}` : 'Refresh'} aria-label="Refresh recommendations"><RefreshCw size={15} /></button>
            </div>
            <div className="recs-agent-chips" role="group" aria-label="Filter by agent">
              <button className={`recs-chip ${agentFilter === null ? 'active' : ''}`} onClick={() => setAgentFilter(null)}>All agents</button>
              {AGENT_UNLOCK_ORDER.map((agent) => {
                const Icon = AGENT_ICONS[agent]
                const locked = agentLockedForPlan(agent, plan)
                if (locked) {
                  return <button key={agent} className="recs-chip locked" onClick={onNavigateBilling} title={`${agentLabel(agent)} unlocks on a higher plan. Upgrade Plan to add this teammate.`}><LockKeyhole size={11} /> {agentLabel(agent)}<small>{PLAN_LABELS[planRequiredForAgent(agent)]}</small></button>
                }
                return <button key={agent} className={`recs-chip ${agentFilter === agent ? 'active' : ''}`} style={{ ['--chip-color' as never]: AGENT_COLORS[agent] }} onClick={() => setAgentFilter((current) => (current === agent ? null : agent))}><Icon size={12} /> {agentLabel(agent)}</button>
              })}
            </div>
          </div>

          {selected.size > 0 && (
            <div className="recs-bulk-bar" role="toolbar" aria-label="Bulk actions">
              <span><strong>{selected.size}</strong> selected</span>
              <button className="button approve compact" disabled={bulkBusy} onClick={() => void bulkDecide('approve')}><Check size={13} /> Approve {selected.size}</button>
              <button className="button reject compact" disabled={bulkBusy} onClick={() => void bulkDecide('reject')}><X size={13} /> Skip {selected.size}</button>
              <button className="text-button" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          {phase === 'loading' && <CardSkeletons />}
          {phase === 'error' && (
            <div className="recs-error-state" role="alert">
              <AlertCircle size={22} />
              <strong>We could not load your recommendations</strong>
              <p>{loadError ?? 'We could not reach the server just now.'}</p>
              <button className="button primary" onClick={() => void load()}><RefreshCw size={14} /> Retry</button>
            </div>
          )}
          {phase === 'ready' && visibleItems.length === 0 && (
            summary && summary.total === 0
              ? (report && report.recommendations.length === 0 && !reportDismissed
                ? <AnalysisReportPanel report={report} onDismiss={() => setReportDismissed(true)} onNavigateSection={onNavigateSection} onHow={() => setHowItWorksOpen(true)} onRerun={() => void runAnalysis()} rerunBlocked={analyzing || analyzeBlocked} />
                : usage.used > 0
                  ? <AllClearState summary={summary} onAnalyze={() => void runAnalysis()} analyzing={analyzing} />
                  : <FirstRunState onAnalyze={() => void runAnalysis()} analyzing={analyzing} onHow={() => setHowItWorksOpen(true)} onInspectRule={(rule) => setRuleModal(rule)} hasRun={lastAnalyzedAt !== null} />)
              : <RecsEmptyCard icon={Search} title={statusTab === 'ALL' ? 'Nothing matches these filters' : `No ${statusTabLabel(statusTab).toLowerCase()} recommendations yet`} description="Try another tab, a different teammate, or clear the search and dates." action={<button className="button secondary" onClick={() => { setStatusTab('ALL'); setAgentFilter(null); setQuery(''); setDateFrom(''); setDateTo('') }}>Clear filters</button>} />
          )}
          {phase === 'ready' && visibleItems.length > 0 && (
            <div className="recs-list">
              {groups.map((group) => (
                <div className="recs-group" key={group.key}>
                  {group.label && <div className="recs-group-heading"><Layers size={13} /> {group.label} <span>{group.items.length}</span></div>}
                  {group.items.map((item) => (
                    <RecommendationCard
                      key={item.id}
                      recommendation={item}
                      maxImpact={maxImpact}
                      selected={selected.has(item.id)}
                      onSelect={() => toggleSelected(item.id)}
                      onEvidence={() => openDrawer(item)}
                      onApprove={() => requestApprove(item)}
                      onReject={() => requestReject(item)}
                      busy={busyDecisionIds.has(item.id)}
                      onSnooze={(hours) => void snooze(item, hours)}
                      onCopyLink={() => copyLink(item)}
                      undoAvailable={undo?.recommendation.id === item.id}
                      onUndo={() => void performUndo()}
                    />
                  ))}
                </div>
              ))}
              {hasMore && <button className="button secondary recs-load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <RefreshCw size={14} className="spin" /> : <ChevronDown size={14} />} Load more ({total - items.length} remaining)</button>}
            </div>
          )}
          </section>
        </div>

        <aside className="recs-sidebar" aria-label="Insights">
          <div className="recs-section-head recs-section-head-side">
            <h3><Heart size={16} /> Insights</h3>
            <p>Your team, your timeline, your patterns.</p>
          </div>
          {phase === 'loading' ? <SidebarSkeleton /> : summary && <InsightsSidebar summary={summary} plan={plan} onFilterAgent={(agent) => setAgentFilter(agent)} onInspectRule={(rule) => setRuleModal(rule)} onUpgrade={onNavigateBilling} />}
        </aside>
      </div>

      {drawer && <EvidenceDrawer recommendation={drawer} storeId={storeId} onClose={closeDrawer} />}
      {confirm && confirm.kind === 'approve' && <ApproveConfirmSheet recommendation={confirm.recommendation} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void decide(confirm.recommendation, 'approve', null) }} />}
      {confirm && confirm.kind === 'reject' && <RejectReasonSheet recommendation={confirm.recommendation} onCancel={() => setConfirm(null)} onReject={(reason) => { setConfirm(null); void decide(confirm.recommendation, 'reject', reason) }} />}
      {undo && <UndoSnackbar undo={undo} onUndo={() => void performUndo()} onDismiss={() => setUndo(null)} />}
      {ruleModal && <RuleDetailModal ruleId={ruleModal} plan={plan} onClose={() => setRuleModal(null)} onUpgrade={onNavigateBilling} />}
      {analyzing && !analysisModalHidden && <AnalysisProgressModal step={analysisStep} elapsedMs={analysisElapsedMs} onHide={() => setAnalysisModalHidden(true)} />}
      {howItWorksOpen && <HowItWorksModal onClose={() => setHowItWorksOpen(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tooltip — a focusable info dot with a CSS bubble (hover + keyboard focus)
// and an accessible name, so every metric on this page explains itself.
// ---------------------------------------------------------------------------


function GreetingMark() {
  const hour = new Date().getHours()
  if (hour < 12) return <Sunrise size={18} aria-hidden />
  if (hour < 17) return <Sun size={18} aria-hidden />
  return <Sunset size={18} aria-hidden />
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="recs-tip" tabIndex={0} aria-label={label}>
      {children}
      <Info size={11} className="recs-tip-dot" aria-hidden />
      <span className="recs-tip-bubble" role="tooltip">{label}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// KPI hero — renamed labels per merchant feedback plus hover explanations and
// honest empty states (a zero never borrows a currency it doesn't have).
// ---------------------------------------------------------------------------

function KpiHero({ summary, usage, plan, onUpgrade }: { summary: RecommendationSummary; usage: ReturnType<typeof usageState>; plan: RecommendationSummary['plan']; onUpgrade: () => void }) {
  const approvalRate = summary.approvalRate.last30d ?? summary.approvalRate.allTime
  const trendUp = summary.approvalRate.last30d !== null && summary.approvalRate.allTime !== null && summary.approvalRate.last30d >= summary.approvalRate.allTime
  const rateDelta = summary.approvalRate.last30d !== null && summary.approvalRate.allTime !== null ? summary.approvalRate.last30d - summary.approvalRate.allTime : null
  const pendingCount = summary.counts.PENDING
  const approvedCount = summary.approvedThisMonth.count
  // Prefer a currency the store actually uses when formatting an honest zero.
  const knownCurrency = summary.pendingImpact[0]?.currency ?? summary.approvedThisMonth.impact[0]?.currency ?? summary.recentDecisions[0]?.currency ?? null
  const zeroImpact = knownCurrency ? formatImpact(0, knownCurrency) : '0'
  // Last 7 days of approved activity from the trend data (real backend values).
  const last7Days = summary.generatedTrend.slice(-7)
  const last7DaysApproved = last7Days.map((day) => day.approved)
  const last7DayCodes = last7Days.map((day) => dayOfWeekCode(day.day))
  // Who holds the money waiting — real pending counts from the summary, tinted per agent.
  const pendingAgents = summary.byAgent.filter((entry) => entry.pending > 0)
  const totalPending = pendingAgents.reduce((sum, entry) => sum + entry.pending, 0)
  // Calendar honesty for "this month": computed from the merchant's local clock.
  const today = new Date()
  const monthDay = today.getDate()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const monthElapsed = Math.round((monthDay / daysInMonth) * 100)
  const monthName = today.toLocaleString('en-US', { month: 'long' }).toUpperCase()
  return (
    <div className="recs-kpis">
      <div className="recs-kpi recs-kpi-hero">
        <Tip label={KPI_TOOLTIPS.pendingImpact}><span className="recs-kpi-head"><span className="recs-kpi-chip" style={{ ['--chip-color' as never]: 'var(--green)' }}><Gauge size={14} /></span><span className="recs-kpi-label">Revenue opportunity pending</span></span></Tip>
        <div className="recs-kpi-row">
          <RevenueRing hasImpact={pendingCount > 0} pendingCount={pendingCount} totalCount={summary.total} />
          <div className="recs-kpi-value-stack">
            <strong className="recs-kpi-value accent">{summary.pendingImpact.length > 0 ? formatCurrencyAmounts(summary.pendingImpact) : zeroImpact}</strong>
            {pendingCount === 0
              ? <small>No pending recommendations yet</small>
              : <small>{pendingCount} pending recommendation{pendingCount === 1 ? '' : 's'} awaiting your call</small>}
          </div>
        </div>
        {pendingAgents.length > 0 && (
          <div className="recs-kpi-foot">
            <span className="recs-kpi-foot-title"><Users size={12} /> Across {pendingAgents.length} teammate{pendingAgents.length === 1 ? '' : 's'}</span>
            <span className="recs-kpi-share" aria-hidden title={`Pending by teammate: ${pendingAgents.map((entry) => `${agentShortName(entry.agent)} ${entry.pending}`).join(', ')}`}>
              {pendingAgents.map((entry) => <i key={entry.agent} style={{ width: `${(entry.pending / totalPending) * 100}%`, background: AGENT_COLORS[entry.agent] }} />)}
            </span>
            <span className="recs-kpi-share-legend">
              {pendingAgents.slice(0, 4).map((entry) => <span key={entry.agent} title={`${agentLabel(entry.agent)} — ${entry.pending} pending`}><i style={{ background: AGENT_COLORS[entry.agent] }} />{agentShortName(entry.agent)}<b>{entry.pending}</b></span>)}
              {pendingAgents.length > 4 && <span className="recs-kpi-share-more">+{pendingAgents.length - 4} more</span>}
            </span>
          </div>
        )}
      </div>
      <div className="recs-kpi recs-kpi-approved">
        <Tip label={KPI_TOOLTIPS.approvedThisMonth}><span className="recs-kpi-head"><span className="recs-kpi-chip" style={{ ['--chip-color' as never]: 'var(--green)' }}><CheckCircle2 size={14} /></span><span className="recs-kpi-label">Approved this month</span></span></Tip>
        <div className="recs-kpi-row">
          <div className="recs-kpi-value-stack">
            <strong className="recs-kpi-value">{approvedCount}</strong>
            {approvedCount === 0
              ? <small>Approve recommendations to see the impact here</small>
              : <>
                  <small>{approvedCount} approval{approvedCount === 1 ? '' : 's'} this month</small>
                  {summary.approvedThisMonth.impact.length > 0 && <span className="recs-kpi-impact-pill">≈ {formatCurrencyAmounts(summary.approvedThisMonth.impact)} modeled</span>}
                </>}
          </div>
          <ApprovedBars values={last7DaysApproved} dayCodes={last7DayCodes} />
        </div>
        <div className="recs-kpi-month">
          <span className="recs-kpi-month-label">{monthName} · DAY {monthDay}</span>
          <span className="recs-kpi-month-track" aria-hidden>
            {Array.from({ length: daysInMonth }, (_, index) => <i key={index} className={index < monthDay ? 'elapsed' : ''} />)}
          </span>
          <span className="recs-kpi-month-caption">{monthElapsed}% of month elapsed</span>
        </div>
      </div>
      <div className="recs-kpi">
        <Tip label={KPI_TOOLTIPS.approvalRate}><span className="recs-kpi-head"><span className="recs-kpi-chip" style={{ ['--chip-color' as never]: 'var(--purple)' }}><TrendingUp size={14} /></span><span className="recs-kpi-label">Approval rate</span></span></Tip>
        <div className="recs-kpi-rate-stack">
          <strong className="recs-kpi-value">{approvalRate === null ? '—' : `${approvalRate}%`}</strong>
          {rateDelta !== null && rateDelta !== 0 && approvalRate !== null && (
            <span className={`recs-kpi-delta ${trendUp ? 'up' : 'down'}`} title={`Last 30 days vs all-time approval rate`}>{trendUp ? '▲' : '▼'} {formatRateDelta(Math.abs(rateDelta))}% vs all-time</span>
          )}
        </div>
        <small className="recs-kpi-rate-caption">{approvalRate === null ? 'Need decisions to calculate' : summary.approvalRate.last30d !== null ? 'of decisions approved · last 30 days' : 'of all-time decisions approved'}</small>
        <ApprovalRateBar rate={approvalRate} />
      </div>
      <div className="recs-kpi">
        <Tip label={KPI_TOOLTIPS.averageDecision}><span className="recs-kpi-head"><span className="recs-kpi-chip" style={{ ['--chip-color' as never]: 'var(--blue-bright)' }}><Clock3 size={14} /></span><span className="recs-kpi-label">Avg time to decide</span></span></Tip>
        <div className="recs-kpi-row">
          <DecideSpeedometer ms={summary.averageDecisionMs} />
          <div className="recs-kpi-value-stack">
            <strong className="recs-kpi-value">{summary.averageDecisionMs === null ? '—' : formatDurationMs(summary.averageDecisionMs)}</strong>
            <small>{summary.averageDecisionMs === null ? 'Decide recommendations to track this' : 'How fast you review new findings'}</small>
          </div>
        </div>
        <div className="recs-kpi-speedo-legend" aria-hidden><span><i className="fast" /> Fast &lt;1h</span><span><i className="mid" /> OK 1–4h</span><span><i className="slow" /> Slow &gt;4h</span></div>
      </div>
      <div className="recs-kpi usage">
        <Tip label={KPI_TOOLTIPS.monthlyUsage}><span className="recs-kpi-head"><span className="recs-kpi-chip" style={{ ['--chip-color' as never]: 'var(--purple)' }}><Sparkles size={14} /></span><span className="recs-kpi-label">Monthly usage</span></span></Tip>
        <div className="recs-usage-row">
          <UsageRing ratio={usage.ratio} atLimit={usage.atLimit} nearLimit={usage.nearLimit} />
          <div className="recs-usage-copy">
            <strong>{usage.limit === null ? `${usage.used}` : `${usage.used}/${usage.limit}`}</strong>
            <small>{usage.limit === null ? `Unlimited on ${plan ? PLAN_LABELS[plan] : 'your'} plan` : `${plan ? PLAN_LABELS[plan] : ''} plan · ${usage.remaining} left`}</small>
            {usage.atLimit && <small className="recs-usage-limit-message">Come back next month or Upgrade Plan</small>}
          </div>
        </div>
        {usage.limit !== null && <button className="text-button recs-upgrade-link" onClick={onUpgrade}>Upgrade Plan <ArrowUpRight size={12} /></button>}
      </div>
    </div>
  )
}

/** Per-card unique micro-visualizations (PR light-theme polish pass). */
function RevenueRing({ hasImpact, pendingCount, totalCount }: { hasImpact: boolean; pendingCount: number; totalCount: number }) {
  // Honest denominator: the ring shows how much of the store's total
  // recommendation volume is still waiting on a decision (pending / total).
  // No invented scale — with no recommendations at all the ring stays empty
  // and a checkmark replaces the count so the empty state reads intentional.
  const radius = 19
  const circumference = 2 * Math.PI * radius
  const ratio = hasImpact && totalCount > 0 ? Math.min(1, pendingCount / totalCount) : 0
  return (
    <div className="recs-kpi-visual recs-kpi-radial" aria-hidden>
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={radius} fill="none" className="recs-kpi-radial-track" strokeWidth="2.5" />
        <circle cx="24" cy="24" r={radius} fill="none" className="recs-kpi-radial-fill" strokeWidth="2.5" strokeDasharray={`${ratio * circumference} ${circumference}`} transform="rotate(-90 24 24)" />
      </svg>
      {hasImpact
        ? <strong className="recs-kpi-ring-count">{pendingCount}</strong>
        : <CheckCircle2 size={14} style={{ position: 'absolute', color: 'var(--text-tertiary)' }} />}
    </div>
  )
}

function ApprovedBars({ values, dayCodes }: { values: readonly number[]; dayCodes: readonly number[] }) {
  const days = values.length === 0 ? [0, 0, 0, 0, 0, 0, 0] : values
  const codes = dayCodes.length === days.length ? dayCodes : [1, 2, 3, 4, 5, 6, 0]
  const max = Math.max(1, ...days)
  return (
    <div className="recs-kpi-visual recs-kpi-week" aria-hidden>
      <div className="recs-kpi-bars">
        {days.map((value, index) => (
          <span key={index} className="recs-kpi-bar-col">
            <i className={`bar ${value > 0 ? 'filled' : ''}`} style={{ height: `${Math.max(4, (value / max) * 30)}px` }} title={`${value} approved`} />
            <span className="recs-kpi-bar-letter">{DAY_LETTERS[codes[index]! % 7]!}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function ApprovalRateBar({ rate }: { rate: number | null }) {
  // Empty state: do not draw a track that looks like a broken gauge. The
  // headline and helper copy already explain that a decision is needed.
  if (rate === null) {
    return (
      <div className="recs-kpi-progress recs-kpi-progress-empty" aria-label="Approval rate unavailable until a decision is made">
        <span className="recs-kpi-empty-state">No decisions yet</span>
      </div>
    )
  }
  // With data: red/amber/green zones, a green fill up to the current rate and
  // a marker that floats on the fill — padded so it never hugs the card edge.
  const value = Math.min(100, Math.max(0, rate))
  return (
    <div className="recs-kpi-progress" aria-hidden>
      <div className="recs-kpi-progress-track">
        <span className="recs-kpi-progress-zone low" />
        <span className="recs-kpi-progress-zone mid" />
        <span className="recs-kpi-progress-zone good" />
        <span className="recs-kpi-progress-fill" style={{ width: `${value}%` }} />
        <span className="recs-kpi-progress-marker" style={{ left: `${value}%` }} title={`${value}% approval rate`} />
        <span className="recs-kpi-target" style={{ left: '80%' }} title="Target approval rate (80%)"><i />80%</span>
      </div>
      <div className="recs-kpi-progress-axis"><span>Low</span><span>Medium</span><span>Good</span></div>
    </div>
  )
}

function DecideSpeedometer({ ms }: { ms: number | null }) {
  // Map 0 → 8h onto -90° → +90°. <1h is the fast (green) zone, 1–4h normal
  // (amber), >4h slow (red). A null reading shows a neutral, needle-free arc
  // with a "No data yet" label instead of an empty-looking gauge.
  const FAST = 60 * 60 * 1000
  const SLOW = 4 * 60 * 60 * 1000
  const MAX = 8 * 60 * 60 * 1000
  const point = (angleDeg: number): { x: number; y: number } => {
    const rad = (angleDeg * Math.PI) / 180
    return { x: Math.round((50 + 40 * Math.sin(rad)) * 100) / 100, y: Math.round((46 - 40 * Math.cos(rad)) * 100) / 100 }
  }
  const arc = (from: number, to: number): string => {
    const start = point(from)
    const end = point(to)
    return `M ${start.x},${start.y} A 40,40 0 0,1 ${end.x},${end.y}`
  }
  const zone = ms === null ? 'idle' : ms <= FAST ? 'fast' : ms <= SLOW ? 'mid' : 'slow'
  if (ms === null) {
    return (
      <div className="recs-kpi-visual recs-kpi-visual-speedo" aria-hidden>
        <svg className="recs-kpi-speedo" viewBox="0 0 100 56">
          <path d="M 10,46 A 40,40 0 0,1 90,46" fill="none" className="recs-kpi-speedo-track" strokeWidth="6" strokeLinecap="round" />
        </svg>
        <span className="recs-kpi-speedo-label" data-zone={zone}>No data yet</span>
      </div>
    )
  }
  const angle = Math.min(90, Math.max(-90, (ms / MAX) * 180 - 90))
  return (
    <div className="recs-kpi-visual recs-kpi-visual-speedo" aria-hidden>
      <svg className="recs-kpi-speedo" viewBox="0 0 100 56">
        <path d="M 10,46 A 40,40 0 0,1 90,46" fill="none" className="recs-kpi-speedo-track" strokeWidth="6" strokeLinecap="round" />
        <path d={arc(-90, -67.5)} fill="none" className="recs-kpi-speedo-zone-fast" strokeWidth="6" strokeLinecap="round" />
        <path d={arc(-67.5, 0)} fill="none" className="recs-kpi-speedo-zone-mid" strokeWidth="6" />
        <path d={arc(0, 90)} fill="none" className="recs-kpi-speedo-zone-slow" strokeWidth="6" strokeLinecap="round" />
        <line x1="50" y1="46" x2="50" y2="16" stroke="var(--text)" strokeWidth="2.5" className="recs-kpi-speedo-needle" transform={`rotate(${angle} 50 46)`} />
        <circle cx="50" cy="46" r="3.5" fill="var(--text)" className="recs-kpi-speedo-hub" />
      </svg>
      <span className="recs-kpi-speedo-label" data-zone={zone}>{zone === 'fast' ? 'Fast' : zone === 'mid' ? 'OK' : 'Slow'}</span>
    </div>
  )
}

function UsageRing({ ratio, atLimit, nearLimit }: { ratio: number | null; atLimit: boolean; nearLimit: boolean }) {
  const value = ratio === null ? 1 : ratio
  const circumference = 2 * Math.PI * 15
  const stroke = ratio === null ? 'var(--green)' : atLimit ? 'var(--red)' : nearLimit ? 'var(--amber)' : 'var(--purple)'
  return (
    <svg className="recs-usage-ring" viewBox="0 0 36 36" width={40} height={40} aria-hidden>
      <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="3.5" />
      <circle cx="18" cy="18" r="15" fill="none" stroke={stroke} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${value * circumference} ${circumference}`} transform="rotate(-90 18 18)" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Recommendation card
// ---------------------------------------------------------------------------

function RecommendationCard({ recommendation, maxImpact, selected, onSelect, onEvidence, onApprove, onReject, onSnooze, onCopyLink, undoAvailable, onUndo, busy = false }: {
  recommendation: RecommendationView
  maxImpact: number
  selected: boolean
  onSelect: () => void
  onEvidence: () => void
  onApprove: () => void
  onReject: () => void
  onSnooze: (hours: number) => void
  onCopyLink: () => void
  undoAvailable: boolean
  busy?: boolean
  onUndo: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const Icon = AGENT_ICONS[recommendation.agent] ?? Sparkles
  const expiry = recommendation.status === 'PENDING' ? expiryBadge(recommendation.expiresAt) : null
  const snooze = recommendation.status === 'PENDING' ? snoozeBadge(recommendation.snoozedUntil) : null
  const explanationBadge = EXPLANATION_STATUS_LABELS[recommendation.explanationStatus]
  const decisionDelay = formatDecisionDelay(recommendation.createdAt, recommendation.decidedAt)
  const pending = recommendation.status === 'PENDING'
  const highRisk = recommendation.actionRisk !== 'SAFE'
  const urgent = Boolean(expiry && expiry !== 'Expired')
  return (
    <article className={`recs-card status-${recommendation.status.toLowerCase()} ${selected ? 'selected' : ''} ${urgent ? 'urgent' : ''}`}>
      {pending && <label className="recs-card-check"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${recommendation.title}`} /><span /></label>}
      <div className="recs-card-main">
        <div className="recs-card-top">
          {urgent && <span className="recs-urgent-pill"><AlertTriangle size={12} /> Urgent</span>}
          <span className="recs-agent-pill" style={{ ['--chip-color' as never]: AGENT_COLORS[recommendation.agent] }}><Icon size={12} /> {agentLabel(recommendation.agent)}</span>
          <span className="recs-rule-name">{RULE_EMOJIS[recommendation.ruleId]} {ruleLabel(recommendation.ruleId)}</span>
          <ConfidenceMeter confidence={recommendation.confidence} level={recommendation.confidenceLevel} />
          {expiry && <span className={`recs-expiry ${expiry === 'Expired' ? 'expired' : ''}`}><Clock3 size={12} /> {expiry}</span>}
          {snooze && <span className="recs-snoozed-chip" title={`Snoozed until ${new Date(recommendation.snoozedUntil ?? '').toLocaleString()}. This recommendation stays in your queue.`}><Clock3 size={12} /> {snooze}</span>}
          {explanationBadge && <span className="recs-explanation-badge" title={recommendation.explanationStatus === 'AI_REJECTED' ? 'The extra explanation was filtered. The numbers below are still real and unaffected.' : 'The numbers are complete — only the optional extra explanation is missing.'}><Info size={12} /> {explanationBadge}</span>}
          <span className="recs-card-time" title={new Date(recommendation.createdAt).toLocaleString()}>{formatRelativeTime(recommendation.createdAt)}</span>
        </div>
        <h3 className="recs-card-title">{recommendation.title}</h3>
        <div className="recs-card-story">
          <div className="recs-story-block what">
            <strong><Lightbulb size={13} /> What to do</strong>
            <p>{recommendation.title}</p>
          </div>
          <div className="recs-story-block impact">
            <strong><TrendingUp size={13} /> Impact if you act</strong>
            <p><em>{formatImpact(recommendation.impactValue, recommendation.currency)}</em> {impactLabelText(recommendation.impactLabel).toLowerCase()}</p>
          </div>
          <div className="recs-story-block why">
            <strong><Search size={13} /> Why we are telling you</strong>
            <p>{recommendation.reason}</p>
          </div>
        </div>
        {recommendation.explanation && <blockquote className="recs-card-explanation"><MessageSquare size={13} /> {recommendation.explanation}</blockquote>}
        <div className="recs-card-meta">
          {recommendation.entityKey && <span className="recs-entity-chip" title="The product, customer, or checkout this is about"><Database size={12} /> {entityChipLabel(recommendation)}</span>}
          <span className="recs-rule-chip" title={RULE_DESCRIPTIONS[recommendation.ruleId]}>{ruleLabel(recommendation.ruleId)}{typeof recommendation.evidencePack.ruleVersion === 'string' ? ` v${recommendation.evidencePack.ruleVersion}` : ''}</span>
          <span className={`recs-action-chip ${recommendation.actionRisk === 'SAFE' ? 'safe' : ''}`}><ShieldCheck size={12} /> {riskLabel(recommendation.actionRisk)}{highRisk ? '' : ' (Low risk)'}</span>
        </div>
      </div>
      <div className="recs-card-side">
        <span className="recs-impact-label">{impactLabelText(recommendation.impactLabel)}</span>
        <strong className="recs-impact-value">{formatImpact(recommendation.impactValue, recommendation.currency)}</strong>
        <span className="recs-impact-bar" aria-hidden><i style={{ width: `${impactRatio(recommendation.impactValue, maxImpact) * 100}%` }} /></span>
        <button className="text-button recs-evidence-link" onClick={onEvidence}><Eye size={14} /> View Full Details</button>
        {pending ? (
          <div className="recs-card-actions">
            <button className="button reject compact" onClick={onReject} disabled={busy}><X size={13} /> {busy ? 'Saving…' : 'Skip This'}</button>
            <button className="button approve compact" onClick={onApprove} disabled={busy}><Check size={13} /> {busy ? 'Saving…' : highRisk ? 'Review & Approve' : 'Approve & Take Action'}</button>
            <div className="recs-card-menu-wrap">
              <button className="icon-button compact" aria-label="More actions" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={14} /></button>
              {menuOpen && (
                <div className="recs-card-menu" onMouseLeave={() => setMenuOpen(false)}>
                  <button onClick={() => { setMenuOpen(false); onSnooze(1) }}><Clock3 size={13} /> Remind me in 1 hour</button>
                  <button onClick={() => { setMenuOpen(false); onSnooze(24) }}><Clock3 size={13} /> Remind me tomorrow</button>
                  <button onClick={() => { setMenuOpen(false); onCopyLink() }}><Copy size={13} /> Copy link</button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={`recs-resolved ${recommendation.status.toLowerCase()}`}>
            {recommendation.status === 'APPROVED' && <><CheckCircle2 size={14} /> Approved</>}
            {recommendation.status === 'REJECTED' && <><XCircle size={14} /> Rejected{recommendation.rejectReason ? ` · ${REJECT_REASON_LABELS[recommendation.rejectReason]}` : ''}</>}
            {recommendation.status === 'EXECUTED' && <><Zap size={14} /> Done</>}
            {recommendation.status === 'FAILED' && <><AlertCircle size={14} /> Could not finish</>}
            {recommendation.status === 'EXPIRED' && <><Clock3 size={14} /> Expired</>}
            {decisionDelay && <small>{decisionDelay}</small>}
            {undoAvailable && <button className="text-button" onClick={onUndo}><RotateCcw size={13} /> Undo</button>}
          </div>
        )}
      </div>
    </article>
  )
}

function entityChipLabel(recommendation: RecommendationView): string {
  // Product rules carry the product title inside the deterministic title/reason;
  // customer rules keep an opaque key by design (no PII on this surface).
  if (recommendation.agent === 'CUSTOMER_AGENT' || recommendation.actionType === 'SEND_EMAIL') return `Customer ${maskKey(recommendation.entityKey ?? '')}`
  if (recommendation.ruleId === 'CART_ABANDONMENT') return `Checkout ${maskKey(recommendation.entityKey ?? '')}`
  return `Product ${maskKey(recommendation.entityKey ?? '')}`
}

function maskKey(key: string): string {
  return key.length <= 6 ? key : `…${key.slice(-6)}`
}

function ConfidenceMeter({ confidence, level }: { confidence: number; level: RecommendationView['confidenceLevel'] }) {
  const percent = Math.round(confidence * 100)
  return (
    <span className={`recs-confidence ${level.toLowerCase()}`} title={`We are ${percent}% confident. Your AI team earns higher confidence as you approve their work.`}>
      <span className="recs-confidence-bar" aria-hidden><i style={{ width: `${percent}%` }} /></span>
      {percent}% · {level === 'HIGH' ? 'High' : level === 'MEDIUM' ? 'Medium' : 'Low'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Evidence drawer — opens for the specific card, renders facts + sources, and
// verifies the sha256 server-side.
// ---------------------------------------------------------------------------

function EvidenceDrawer({ recommendation, storeId, onClose }: { recommendation: RecommendationView; storeId: string; onClose: () => void }) {
  const [verification, setVerification] = useState<EvidenceVerification | null>(null)
  const [verifyFailed, setVerifyFailed] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setVerification(null)
    setVerifyFailed(false)
    verifyRecommendationEvidence(storeId, recommendation.id)
      .then((result) => { if (!cancelled) setVerification(result) })
      .catch(() => { if (!cancelled) setVerifyFailed(true) })
    return () => { cancelled = true }
  }, [storeId, recommendation.id])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const fields = Array.isArray(recommendation.evidencePack.fields) ? recommendation.evidencePack.fields : []
  const sha = typeof recommendation.evidencePack.sha256 === 'string' ? recommendation.evidencePack.sha256 : null
  const generatedAt = typeof recommendation.evidencePack.generatedAt === 'string' ? recommendation.evidencePack.generatedAt : recommendation.createdAt
  const copy = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => { setCopied(label); window.setTimeout(() => setCopied(null), 1600) }).catch(() => undefined)
  }
  return (
    <>
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close evidence drawer" />
      <aside className="evidence-drawer recs-drawer" role="dialog" aria-label="Recommendation evidence">
        <div className="drawer-header">
          <div>
            <span className="drawer-kicker"><ShieldCheck size={13} /> WHY WE ARE TELLING YOU</span>
            <h2>{recommendation.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-scroll">
          <div className="drawer-hero recs-drawer-hero">
            <span>{impactLabelText(recommendation.impactLabel)}</span>
            <strong>{formatImpact(recommendation.impactValue, recommendation.currency)}</strong>
            <small>{agentLabel(recommendation.agent)} · {ruleLabel(recommendation.ruleId)} · {formatRelativeTime(recommendation.createdAt)}</small>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title"><Database size={15} /> The facts, and where they came from</div>
            {fields.length > 0 ? (
              <div className="evidence-stack">
                {fields.map((field, index) => (
                  <div className="evidence-line recs-evidence-line" key={field.key}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div className="recs-evidence-copy">
                      <strong>{field.label}: {String(field.value ?? '—')}</strong>
                      <small className="mono">{field.source}</small>
                    </div>
                    <button className="icon-button compact" onClick={() => copy(field.key, `${field.label}: ${String(field.value ?? '—')} (${field.source})`)} aria-label={`Copy ${field.label}`}>{copied === field.key ? <Check size={13} /> : <Copy size={13} />}</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="recs-drawer-note">This recommendation was generated before field-level evidence was recorded. The deterministic reason above still reflects the data that triggered it.</p>
            )}
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title"><ShieldCheck size={15} /> Verification</div>
            <div className="recs-verify">
              {verification === null && !verifyFailed && <span className="recs-verify-status pending"><RefreshCw size={13} className="spin" /> Verifying evidence hash…</span>}
              {verification?.verified === true && <span className="recs-verify-status ok"><CheckCircle2 size={13} /> Evidence verified — the pack has not been altered since generation</span>}
              {verification?.verified === false && <span className="recs-verify-status bad"><AlertTriangle size={13} /> Verification incomplete — this pack predates field-level sealing</span>}
              {verifyFailed && <span className="recs-verify-status bad"><AlertTriangle size={13} /> Verification service unavailable right now</span>}
              {sha && (
                <button className="recs-hash" onClick={() => copy('sha', sha)} title="Copy full SHA-256">
                  <span className="mono">SHA-256: {sha.slice(0, 18)}…</span>
                  {copied === 'sha' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              )}
              <small>Generated {new Date(generatedAt).toLocaleString()}{typeof recommendation.evidencePack.ruleVersion === 'string' ? ` · Rule ${ruleLabel(recommendation.ruleId)} v${recommendation.evidencePack.ruleVersion}` : ''}</small>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title"><LockKeyhole size={15} /> Action safety</div>
            <div className="safety-list">
              <span><Zap size={14} /> {actionTypeLabel(recommendation.actionType)} — {ACTION_TYPE_PREVIEWS[recommendation.actionType]}</span>
              <span><ShieldCheck size={14} /> {riskLabel(recommendation.actionRisk)}{recommendation.actionRisk === 'APPROVAL_REQUIRED' ? ' — you confirm before anything reaches a customer' : ''}</span>
              <span><Check size={14} /> Personal customer data never enters AI evidence packs</span>
            </div>
          </div>

          {recommendation.explanation && (
            <div className="drawer-section">
              <div className="drawer-section-title"><MessageSquare size={15} /> AI explanation</div>
              <blockquote className="recs-drawer-explanation">{recommendation.explanation}</blockquote>
              <small className="recs-drawer-note">Written by {recommendation.model ?? 'the AI layer'} · validated so it cannot introduce numbers absent from the evidence.</small>
            </div>
          )}
          {!recommendation.explanation && EXPLANATION_STATUS_LABELS[recommendation.explanationStatus] && (
            <div className="drawer-section">
              <div className="drawer-section-title"><MessageSquare size={15} /> AI explanation</div>
              <p className="recs-drawer-note">{recommendation.explanationStatus === 'AI_REJECTED' ? 'The AI wrote an explanation that failed validation (it introduced an unsupported number or restricted term), so it was filtered. Deterministic numbers are unaffected.' : 'The AI language layer was unavailable when this was generated. All numbers on this recommendation are deterministic and complete without it.'}</p>
            </div>
          )}

          <div className="drawer-section">
            <div className="drawer-section-title"><Info size={15} /> Decision trail</div>
            <div className="recs-trail">
              <span><i className="dot" /> Created {new Date(recommendation.createdAt).toLocaleString()}</span>
              {recommendation.expiresAt && <span><i className="dot amber" /> {Date.parse(recommendation.expiresAt) > Date.now() ? 'Expires' : 'Expired'} {new Date(recommendation.expiresAt).toLocaleString()}</span>}
              {recommendation.snoozedUntil && Date.parse(recommendation.snoozedUntil) > Date.now() && <span><i className="dot blue" /> Snoozed until {new Date(recommendation.snoozedUntil).toLocaleString()}</span>}
              {recommendation.decidedAt && <span><i className={`dot ${recommendation.status === 'REJECTED' ? 'red' : 'green'}`} /> {statusLabel(recommendation.status)} {new Date(recommendation.decidedAt).toLocaleString()}{/* 🛑 'via Jarvis' attribution temporarily hidden */ recommendation.decidedBy === 'system' ? ' automatically' : ''}</span>}
              <span><i className="dot" /> Version {recommendation.version} · concurrency-safe decisions</span>
            </div>
          </div>
        </div>
        <div className="drawer-footer"><button className="button secondary" onClick={onClose}>Close</button></div>
      </aside>
    </>
  )
}

// ---------------------------------------------------------------------------
// Decision sheets
// ---------------------------------------------------------------------------

function ApproveConfirmSheet({ recommendation, onCancel, onConfirm }: { recommendation: RecommendationView; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-overlay">
      <div className="modal-card recs-confirm-card" role="dialog" aria-label="Confirm approval">
        <div className="section-kicker"><ShieldCheck size={13} /> CONFIRM & APPROVE</div>
        <h2>{recommendation.title}</h2>
        <p className="recs-confirm-what"><strong>What happens next:</strong> {ACTION_TYPE_PREVIEWS[recommendation.actionType]}</p>
        <div className="recs-confirm-facts">
          <span><Gauge size={13} /> {impactLabelText(recommendation.impactLabel)}: <strong>{formatImpact(recommendation.impactValue, recommendation.currency)}</strong></span>
          <span><ShieldCheck size={13} /> {riskLabel(recommendation.actionRisk)} — nothing reaches a customer without your review</span>
          {recommendation.entityKey && <span><Database size={13} /> Applies to {entityChipLabel(recommendation).toLowerCase()}</span>}
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onCancel}>Cancel</button>
          <button className="button approve" onClick={onConfirm}><Check size={14} /> Confirm & Approve</button>
        </div>
      </div>
    </div>
  )
}

function RejectReasonSheet({ recommendation, onCancel, onReject }: { recommendation: RecommendationView; onCancel: () => void; onReject: (reason: RejectReason | null) => void }) {
  const [reason, setReason] = useState<RejectReason | null>(null)
  return (
    <div className="modal-overlay">
      <div className="modal-card recs-confirm-card" role="dialog" aria-label="Reject recommendation">
        <div className="section-kicker"><XCircle size={13} /> SKIP THIS ONE</div>
        <h2>{recommendation.title}</h2>
        <p className="recs-confirm-what">Telling your AI team <em>why</em> makes future recommendations better — skipping lowers a teammate's confidence until it earns your trust back.</p>
        <div className="recs-reason-chips" role="group" aria-label="Rejection reason">
          {REJECT_REASON_OPTIONS.map((option) => (
            <button key={option} className={`recs-chip ${reason === option ? 'active' : ''}`} onClick={() => setReason((current) => (current === option ? null : option))}>{REJECT_REASON_LABELS[option]}</button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onCancel}>Cancel</button>
          <button className="text-button" onClick={() => onReject(null)}>Reject without reason</button>
          <button className="button reject" disabled={reason === null} onClick={() => onReject(reason)}><X size={14} /> Reject</button>
        </div>
      </div>
    </div>
  )
}

function UndoSnackbar({ undo, onUndo, onDismiss }: { undo: UndoState; onUndo: () => void; onDismiss: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((undo.expiresAt - Date.now()) / 1000)))
  useEffect(() => {
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((undo.expiresAt - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left === 0) onDismiss()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [undo.expiresAt, onDismiss])
  return (
    <div className="recs-undo-snackbar" role="status">
      <span>{undo.decision === 'approved' ? <CheckCircle2 size={14} /> : <XCircle size={14} />} Recommendation {undo.decision}.</span>
      <button className="button secondary compact" onClick={onUndo}><RotateCcw size={13} /> Undo ({secondsLeft}s)</button>
      <button className="icon-button compact" onClick={onDismiss} aria-label="Dismiss"><X size={13} /></button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function InsightsSidebar({ summary, plan, onFilterAgent, onInspectRule, onUpgrade }: { summary: RecommendationSummary; plan: RecommendationSummary['plan']; onFilterAgent: (agent: AgentId) => void; onInspectRule: (rule: RuleId) => void; onUpgrade: () => void }) {
  const byAgent = new Map(summary.byAgent.map((entry) => [entry.agent, entry]))
  const hasData = summary.total > 0
  const pendingByAgent = summary.byAgent.filter((entry) => entry.pending > 0)
  const maxPending = pendingByAgent.reduce((max, entry) => Math.max(max, entry.pending), 0)
  const trend = summary.generatedTrend
  const trendGenerated = trend.reduce((sum, day) => sum + day.generated, 0)
  const trendApproved = trend.reduce((sum, day) => sum + day.approved, 0)
  const maxRuleTotal = summary.byRule.reduce((max, entry) => Math.max(max, entry.total), 0)
  return (
    <>
      <div className="card recs-side-card">
        <div className="recs-side-title"><Sparkles size={14} /> Your AI Team</div>
        <p className="recs-side-lead">Tap a teammate to filter the list. Green dots mean they have something waiting.</p>
        <div className="recs-agent-roster">
          {AGENT_UNLOCK_ORDER.map((agent) => {
            const Icon = AGENT_ICONS[agent]
            const locked = agentLockedForPlan(agent, plan)
            const pending = byAgent.get(agent)?.pending ?? 0
            if (locked) {
              return (
                <button key={agent} className="recs-agent-row locked" onClick={onUpgrade} title={`${agentLabel(agent)} unlocks on a higher plan. ${AGENT_DESCRIPTIONS[agent]}`}>
                  <span className="recs-agent-row-icon"><LockKeyhole size={13} /></span>
                  <span className="recs-agent-row-copy"><strong>{agentLabel(agent)}</strong><small>{AGENT_DESCRIPTIONS[agent]}</small></span>
                  <span className="recs-agent-row-plan">{PLAN_LABELS[planRequiredForAgent(agent)]}</span>
                </button>
              )
            }
            return (
              <button key={agent} className="recs-agent-row" onClick={() => onFilterAgent(agent)} title={`${AGENT_DESCRIPTIONS[agent]} — click to see only ${agentLabel(agent)}.`}>
                <span className="recs-agent-row-icon" style={{ ['--chip-color' as never]: AGENT_COLORS[agent] }}>
                  <Icon size={13} />
                  <i className={`recs-live-dot ${pending > 0 ? 'on' : ''}`} aria-hidden />
                </span>
                <span className="recs-agent-row-copy"><strong>{agentLabel(agent)}</strong><small>{AGENT_DESCRIPTIONS[agent]}</small></span>
                <span className="recs-agent-row-count">{pending}<small>waiting</small></span>
                <span className="recs-agent-row-bar" aria-hidden><i style={{ width: `${maxPending > 0 ? Math.max(0, (pending / maxPending) * 100) : 0}%`, background: AGENT_COLORS[agent] }} /></span>
              </button>
            )
          })}
        </div>
        {!hasData && <p className="recs-side-empty">No recommendations yet — your team reports here after the first look.</p>}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><Activity size={14} /> Your Activity Timeline</div>
        {trend.length > 0 ? (
          <>
            <ActivityAreaChart trend={trend} />
            <div className="recs-trend-metrics">
              <span className="recs-trend-metric"><strong>{trendGenerated}</strong><span className="recs-trend-metric-label">found</span></span>
              <span className="recs-trend-metric"><strong>{trendApproved}</strong><span className="recs-trend-metric-label">approved</span></span>
              <span className="recs-trend-metric recs-trend-conversion" title="Approved as a share of everything found this month"><strong>{trendGenerated > 0 ? Math.round((trendApproved / trendGenerated) * 100) : 0}%</strong><span className="recs-trend-metric-label">conversion</span></span>
              <span className="recs-trend-metric recs-trend-window" title="The chart window — the last 30 days of your AI team's activity"><strong>{trend.length}</strong><span className="recs-trend-metric-label">day window</span></span>
            </div>
          </>
        ) : (
          <SampleActivityChart />
        )}
        {trend.length > 0 && <div className="recs-trend-legend"><span><i className="generated" /> Found</span><span><i className="approved" /> Approved</span></div>}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><Layers size={14} /> Top Categories</div>
        {summary.byRule.length > 0 ? (
          <div className="recs-rule-list">
            {summary.byRule.slice(0, 5).map((entry) => (
              <button key={entry.ruleId} className="recs-rule-row interactive" onClick={() => onInspectRule(entry.ruleId)} title={`${RULE_DESCRIPTIONS[entry.ruleId]} — click to learn more.`}>
                <span>{RULE_EMOJIS[entry.ruleId]} {ruleLabel(entry.ruleId)}</span>
                <span className="recs-rule-row-share" aria-hidden><i style={{ width: `${maxRuleTotal > 0 ? Math.max(6, (entry.total / maxRuleTotal) * 100) : 0}%` }} /></span>
                <strong>{entry.total}</strong>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="recs-rule-list">
              {RULE_ORDER.map((ruleId) => (
                <button key={ruleId} className="recs-rule-row interactive" onClick={() => onInspectRule(ruleId)} title={`${RULE_DESCRIPTIONS[ruleId]} — click to learn more.`}>
                  <span>{RULE_EMOJIS[ruleId]} {RULE_LABELS[ruleId]}</span>
                  <strong>0</strong>
                </button>
              ))}
            </div>
            <p className="recs-side-empty">We alert you when something important happens — each trigger shows up here.</p>
          </>
        )}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><Clock3 size={14} /> Recent Decisions</div>
        {summary.recentDecisions.length > 0 ? (
          <>
            <div className="recs-decision-feed">
              {summary.recentDecisions.slice(0, 6).map((decision) => (
                <div key={decision.id} className="recs-decision-row">
                  <i className={`dot ${decision.status === 'REJECTED' ? 'red' : decision.status === 'EXPIRED' ? 'amber' : 'green'}`} />
                  <div>
                    <strong>{decision.title}</strong>
                    <small>{statusLabel(decision.status)}{decision.decidedAt ? ` · ${formatRelativeTime(decision.decidedAt)}` : ''}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="recs-decision-stats">
              {summary.approvalRate.allTime !== null && <span><strong>{summary.approvalRate.allTime}%</strong> approved</span>}
              {summary.averageDecisionMs !== null && <span><strong>{formatDurationMs(summary.averageDecisionMs)}</strong> avg to decide</span>}
            </div>
          </>
        ) : (
          <>
            <p className="recs-side-empty">Approve or skip recommendations to build history — every decision teaches your AI team.</p>
            <div className="recs-decision-row sample">
              <i className="dot green" />
              <div>
                <strong>Restock the Everyday Hoodie before stockout <span className="recs-sample-chip">Sample</span></strong>
                <small>Approved · example of what lands here</small>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

/** Analytics-style area chart for the sidebar timeline — "Found" as a gradient
 *  area, "Approved" as a line. Pure SVG (recharts-free, SSR-safe): every value
 *  comes from summary.generatedTrend, nothing is invented. */
function ActivityAreaChart({ trend }: { trend: readonly Readonly<{ day: string; generated: number; approved: number }>[] }) {
  const W = 280
  const H = 120
  const pad = 3
  const n = trend.length
  if (n === 0) return null
  const maxV = Math.max(1, ...trend.map((day) => Math.max(day.generated, day.approved)))
  const step = n === 1 ? 0 : (W - pad * 2) / (n - 1)
  const X = (i: number) => pad + i * step
  const Y = (value: number) => pad + (H - pad * 2) - (value / maxV) * (H - pad * 2)
  const line = (pick: (day: { day: string; generated: number; approved: number }) => number) => trend.map((day, i) => `${i === 0 ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(pick(day)).toFixed(1)}`).join(' ')
  const first = trend[0]!
  const last = trend[n - 1]!
  const mid = trend[Math.floor(n / 2)]!
  const label = (day: string) => new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return (
    <div className="recs-trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="recs-trend-svg" role="img" aria-label={`Recommendations generated versus approved, last ${n} days`}>
        <defs>
          <linearGradient id="recs-trend-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--purple)" stopOpacity=".45" />
            <stop offset="100%" stopColor="var(--purple)" stopOpacity=".04" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => <line key={fraction} className="recs-trend-grid" x1={pad} x2={W - pad} y1={pad + (H - pad * 2) * fraction} y2={pad + (H - pad * 2) * fraction} />)}
        <path d={`${line((day) => day.generated)} L ${X(n - 1).toFixed(1)} ${H - pad} L ${X(0).toFixed(1)} ${H - pad} Z`} className="recs-trend-area" />
        <path d={line((day) => day.approved)} className="recs-trend-line" />
        <circle className="recs-trend-dot generated" cx={X(n - 1)} cy={Y(last.generated)} r="3"><title>{`${last.day}: ${last.generated} found, ${last.approved} approved`}</title></circle>
        <circle className="recs-trend-dot approved" cx={X(n - 1)} cy={Y(last.approved)} r="3"><title>{`${last.day}: ${last.generated} found, ${last.approved} approved`}</title></circle>
      </svg>
      <div className="recs-trend-xlabels" aria-hidden>
        <span>{label(first.day)}</span>
        {n > 2 && <span>{label(mid.day)}</span>}
        <span>{label(last.day)}</span>
      </div>
    </div>
  )
}

/** Day-of-week code (0=Sunday … 6=Saturday) from a YYYY-MM-DD trend day. */
function dayOfWeekCode(day: string): number {
  const parsed = Date.parse(`${day}T00:00:00.000Z`)
  return Number.isFinite(parsed) ? new Date(parsed).getUTCDay() : 0
}

/** "Inventory Agent" → "Inventory" for the compact teammate legend. */
function agentShortName(agent: string): string {
  return agentLabel(agent).replace(/ Agent$/, '')
}

/** Whole percentages stay bare; fractional deltas get one decimal. */
function formatRateDelta(delta: number): string {
  return Number.isInteger(delta) ? String(delta) : delta.toFixed(1)
}

/** Empty 30-day chart with labeled axes plus an opt-in, clearly-labeled sample overlay. */
function SampleActivityChart() {
  const [showSample, setShowSample] = useState(false)
  return (
    <div className="recs-trend-empty">
      <div className="recs-trend-plot" aria-hidden={showSample ? undefined : true} aria-label={showSample ? 'Sample activity preview — not your real data' : undefined}>
        <span className="recs-trend-axis"><i /><i /><i /></span>
        {showSample
          ? <div className="recs-trend sample">{SAMPLE_ACTIVITY_HEIGHTS.map((height, index) => <span key={index} className="recs-trend-bar"><i className="generated" style={{ height: `${height}%` }} /></span>)}</div>
          : <div className="recs-trend placeholder">{SAMPLE_ACTIVITY_HEIGHTS.map((_, index) => <span key={index} className="recs-trend-bar" />)}</div>}
        {showSample && <span className="recs-sample-chip floating"><FlaskConical size={9} /> Sample preview</span>}
      </div>
      <div className="recs-trend-axis-labels"><span>30 days ago</span><span>today</span></div>
      <p className="recs-side-empty">Your timeline fills in as your AI team works — generated vs approved, day by day.</p>
      <button className="text-button" onClick={() => setShowSample((value) => !value)}>{showSample ? 'Hide sample' : 'See sample activity'}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty / loading / educational states
// ---------------------------------------------------------------------------

function FirstRunState({ onAnalyze, analyzing, onHow, onInspectRule, hasRun }: { onAnalyze: () => void; analyzing: boolean; onHow: () => void; onInspectRule: (rule: RuleId) => void; hasRun: boolean }) {
  return (
    <div className="recs-first-run">
      <div className="recs-first-hero">
        <span className="recs-first-orb" aria-hidden><Sparkles size={28} /></span>
        <h2>{hasRun ? 'Time to see what your AI team found for you' : "Let's find your growth opportunities! 🚀"}</h2>
        <p>Your smart AI assistants are ready to explore your store and find real opportunities to boost your revenue, retain customers, and grow your business. Just click below to get started!</p>
        <div className="recs-first-actions">
          <button className="button primary recs-cta-primary recs-discover" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <RefreshCw size={16} className="spin" /> : <Sparkles size={16} />} {analyzing ? 'Discovering opportunities…' : 'Discover Opportunities'}</button>
          <button className="button secondary" onClick={onHow}><Info size={14} /> How it works</button>
        </div>
      </div>

      <div className="recs-finds">
        <div className="recs-finds-title"><Lightbulb size={15} /> What your AI team can find</div>
        <ul className="recs-finds-list">
          {TEAM_FIND_BULLETS.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

      <div className="recs-expect">
        <div className="recs-expect-title"><ListChecks size={14} /> What happens after you click</div>
        <div className="recs-expect-grid">
          <span><strong>Clear next steps</strong> Each finding names the exact product, customer, or checkout to act on.</span>
          <span><strong>Real money attached</strong> Every card is priced in your store's currency before you commit.</span>
          <span><strong>You stay in control</strong> Approve or skip. Anything that reaches a customer stays a draft you review.</span>
          <span><strong>Nothing gets lost</strong> Your decisions feed the overview above so you can see the progress.</span>
        </div>
      </div>

      <div className="recs-rule-grid">
        {RULE_ORDER.map((ruleId) => {
          return (
            <button className="recs-rule-card" key={ruleId} onClick={() => onInspectRule(ruleId)} title={`${RULE_TAGLINES[ruleId]} — tap to see how this works.`}>
              <span className="recs-rule-card-head"><span className="recs-rule-card-icon">{RULE_EMOJIS[ruleId]}</span><strong>{RULE_LABELS[ruleId]}</strong></span>
              <p className="recs-rule-card-tagline">{RULE_TAGLINES[ruleId]}</p>
              <p>{RULE_DESCRIPTIONS[ruleId]}</p>
              <span className="recs-rule-card-uses"><Database size={12} /> Analyzes: {RULE_DATA_SOURCES[ruleId]}</span>
            </button>
          )
        })}
      </div>

      <HowRulesWork />
      <SampleRecommendationPreview />
      <p className="recs-sample-note"><ShieldCheck size={14} /> We never invent a recommendation. If your store looks healthy, you will see an honest all-clear — not filler.</p>
    </div>
  )
}

function HowRulesWork() {
  return (
    <details className="recs-how-strip">
      <summary><Info size={14} /> How it works <ChevronDown size={14} className="recs-how-strip-caret" /></summary>
      <div className="recs-how-strip-body">
        <p>Your AI team uses the same <strong>smart triggers</strong> every time it looks at your store data. No one guesses a number — we only write the plain-language explanation, and it is checked against the real facts before you ever see it.</p>
        <div className="recs-flow" aria-label="Data flow: your store data, smart triggers, recommendations with clear value, your approval">
          <span><Database size={14} /> Your store data</span>
          <ArrowRight size={14} />
          <span><Layers size={14} /> 8 smart triggers</span>
          <ArrowRight size={14} />
          <span><Gauge size={14} /> Smart recommendations</span>
          <ArrowRight size={14} />
          <span><ShieldCheck size={14} /> Ready for your approval</span>
        </div>
        <div className="recs-trust-row">
          <span><CheckCircle2 size={13} /> Never invents numbers</span>
          <span><Database size={13} /> Backed by real data</span>
          <span><LockKeyhole size={13} /> You approve every action</span>
          <span><ShieldCheck size={13} /> Evidence sealed with SHA-256</span>
        </div>
      </div>
    </details>
  )
}

function SampleRecommendationPreview() {
  return (
    <div className="recs-sample-wrap">
      <div className="recs-sample-banner">
        <span className="recs-sample-badge-wrap"><span className="recs-sample-badge"><FlaskConical size={13} /> Sample Preview</span></span>
        <p className="recs-sample-explanation">This is a preview of what a real recommendation looks like once your AI team discovers opportunities in your store — <em>not your data</em>. Click <strong>Discover Opportunities</strong> above to generate real recommendations.</p>
      </div>
      <article className="recs-card recs-sample-card" aria-label="Sample recommendation preview. Not generated from your store.">
        <div className="recs-card-main">
          <div className="recs-card-top">
            <span className="recs-urgent-pill"><AlertTriangle size={12} /> Urgent</span>
            <span className="recs-agent-pill" style={{ ['--chip-color' as never]: AGENT_COLORS.INVENTORY_AGENT }}><Box size={12} /> Inventory Agent</span>
            <span className="recs-rule-name">🚨 Stockout Alerts</span>
            <span className="recs-confidence medium"><span className="recs-confidence-bar" aria-hidden><i style={{ width: '62%' }} /></span> 62% · Medium</span>
            <span className="recs-sample-chip"><FlaskConical size={10} /> Sample</span>
          </div>
          <h3 className="recs-card-title">Restock "Everyday Hoodie — Black / M" before it sells out</h3>
          <div className="recs-card-story">
            <div className="recs-story-block what">
              <strong><Lightbulb size={13} /> What to do</strong>
              <p>Restock this product — it will sell out in 5 days</p>
            </div>
            <div className="recs-story-block impact">
              <strong><TrendingUp size={13} /> Impact if you act</strong>
              <p><em>$1,240</em> potential revenue</p>
            </div>
            <div className="recs-story-block why">
              <strong><Search size={13} /> Why we are telling you</strong>
              <p>Based on the last 7 days of sales, you will run out before your usual reorder window.</p>
            </div>
          </div>
          <div className="recs-card-meta">
            <span className="recs-rule-chip">Stockout Alerts</span>
            <span className="recs-action-chip safe"><ShieldCheck size={12} /> Safe to execute (Low risk)</span>
          </div>
        </div>
        <div className="recs-card-side">
          <span className="recs-impact-label">Revenue at risk</span>
          <strong className="recs-impact-value">$1,240</strong>
          <span className="recs-impact-bar" aria-hidden><i style={{ width: '62%' }} /></span>
          <span className="recs-sample-actions">
            <span className="recs-tip-anchor" data-tip="This is a preview — discover opportunities to get real recommendations">
              <button className="button reject compact" disabled tabIndex={-1} aria-label="Skip This — preview only, action unavailable">Skip This</button>
            </span>
            <span className="recs-tip-anchor" data-tip="This is a preview — discover opportunities to get real recommendations">
              <button className="button approve compact" disabled tabIndex={-1} aria-label="Approve — preview only, action unavailable"><Check size={13} /> Approve & Take Action</button>
            </span>
          </span>
        </div>
      </article>
      <p className="recs-sample-helper">This is a preview of what real recommendations look like. Click <strong>Discover Opportunities</strong> to generate real ones for your store.</p>
      <p className="recs-sample-note"><Lightbulb size={13} /> When you have real recommendations, these buttons will be active.</p>
    </div>
  )
}

function AllClearState({ summary, onAnalyze, analyzing }: { summary: RecommendationSummary; onAnalyze: () => void; analyzing: boolean }) {
  return (
    <div className="recs-all-clear">
      <span className="recs-all-clear-icon"><CheckCircle2 size={26} /></span>
      <h2>🎉 Great news! Your store looks healthy</h2>
      <p>We looked through what we watch and nothing urgent popped up. That is a healthy store, not a missing feature — come back tomorrow for new insights as your data changes.</p>
      <div className="recs-all-clear-rules">
        {RULE_ORDER.map((ruleId) => (
          <span key={ruleId}><Check size={13} /> {RULE_LABELS[ruleId]}</span>
        ))}
      </div>
      <div className="recs-all-clear-actions">
        <button className="button secondary compact recs-discover" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} Discover Opportunities</button>
        {summary.usage.used !== null && summary.usage.used > 0 && <small>{summary.usage.used} recommendation{summary.usage.used === 1 ? '' : 's'} generated this month across earlier runs.</small>}
      </div>
    </div>
  )
}

function RuleDetailModal({ ruleId, plan, onClose, onUpgrade }: { ruleId: RuleId; plan: RecommendationSummary['plan']; onClose: () => void; onUpgrade: () => void }) {
  const detail = RULE_DETAILS[ruleId]
  const agent = RULE_AGENT[ruleId]
  const locked = agentLockedForPlan(agent, plan)
  const Icon = RULE_ICONS[ruleId]
  const AgentIcon = AGENT_ICONS[agent]
  return (
    <div className="modal-overlay">
      <div className="modal-card recs-confirm-card recs-rule-modal" role="dialog" aria-label={`Rule detail: ${RULE_LABELS[ruleId]}`}>
        <div className="modal-card-top">
          <span className="recs-rule-modal-icon"><Icon size={17} /></span>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="section-kicker"><Layers size={13} /> SMART TRIGGER</div>
        <h2>{RULE_EMOJIS[ruleId]} {RULE_LABELS[ruleId]}</h2>
        <p className="recs-confirm-what"><strong>{RULE_TAGLINES[ruleId]}.</strong> {RULE_DESCRIPTIONS[ruleId]}</p>
        <div className="recs-rule-modal-facts">
          <span><Crosshair size={13} /><div><strong>Fires when</strong>{detail.trigger}</div></span>
          <span><Gauge size={13} /><div><strong>Impact if you act</strong>{detail.impact}</div></span>
          <span><Database size={13} /><div><strong>Analyzes</strong>{RULE_DATA_SOURCES[ruleId]}</div></span>
          <span><AgentIcon size={13} /><div><strong>Handled by</strong>{agentLabel(agent)}{locked ? ` — locked on your plan (needs ${PLAN_LABELS[planRequiredForAgent(agent)]})` : ''}</div></span>
          <span><CheckCircle2 size={13} /><div><strong>When it's quiet</strong>{detail.healthy}</div></span>
        </div>
        <div className="modal-actions">
          {locked
            ? <><button className="button secondary" onClick={onClose}>Close</button><button className="button primary" onClick={onUpgrade}><LockKeyhole size={13} /> Upgrade Plan</button></>
            : <button className="button primary" onClick={onClose}>Got it</button>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Analysis progress modal — a full, honest progress surface for a genuinely
// running operation, replacing the old fire-and-forget toast. The final stage
// holds until the API responds; the bar never lies about completion.
// ---------------------------------------------------------------------------

function AnalysisProgressModal({ step, elapsedMs, onHide }: { step: number; elapsedMs: number; onHide: () => void }) {
  const total = ANALYSIS_STEPS.length
  const bounded = Math.min(step, total - 1)
  const progress = ((bounded + 1) / (total + 1)) * 100
  return (
    <div className="modal-overlay recs-analysis-overlay">
      <div className="modal-card recs-analysis-modal" role="dialog" aria-label="Analysis in progress" aria-live="polite">
        <div className="modal-card-top">
          <div className="section-kicker"><Sparkles size={13} /> YOUR AI TEAM IS ON IT</div>
          <span className="recs-analysis-elapsed" title="Elapsed time"><Clock3 size={12} /> {(elapsedMs / 1000).toFixed(0)}s</span>
        </div>
        <h2>🔍 Your AI team is on it!</h2>
        <p className="recs-confirm-what">We are looking through your real products, customers, checkouts, and orders. No numbers are being invented — only measured. Almost done!</p>
        <div className="recs-analysis-progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Analysis progress">
          <i style={{ width: `${progress}%` }} />
        </div>
        <ol className="recs-analysis-steps">
          {ANALYSIS_STEPS.map((item, index) => (
            <li key={item.label} className={index < bounded ? 'done' : index === bounded ? 'active' : ''}>
              <span className="recs-analysis-step-icon">{index < bounded ? <Check size={12} /> : index === bounded ? <RefreshCw size={12} className="spin" /> : <i className="dot" />}</span>
              <div><strong>{item.label}{index <= bounded ? '…' : ''}</strong><small>{item.detail}</small></div>
            </li>
          ))}
        </ol>
        <div className="recs-analysis-foot">
          <span>Most runs finish in seconds. You can keep browsing — the results will land on this page.</span>
          <button className="button secondary compact" onClick={onHide}>Keep browsing</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Analysis report panel — the rich "Store Health Check Complete" result that
// replaces the old tiny toast when an analysis finds no new recommendations.
// Every number here comes from the API response; nothing is invented.
// ---------------------------------------------------------------------------

function AnalysisReportPanel({ report, onDismiss, onNavigateSection, onHow, onRerun, rerunBlocked }: { report: AnalysisReport; onDismiss: () => void; onNavigateSection: ((section: SectionId) => void) | undefined; onHow: () => void; onRerun: () => void; rerunBlocked: boolean }) {
  const stats = report.snapshotStats ?? null
  const score = report.health?.score ?? null
  const tone = healthTone(score)
  const rulesChecked = report.rulesChecked ?? RULE_ORDER.length
  return (
    <section className="recs-report" aria-label="Analysis report">
      <div className="recs-report-head">
        <span className="recs-report-icon"><CheckCircle2 size={22} /></span>
        <div className="recs-report-title">
          <h2>🎉 Great news! Your store looks healthy</h2>
          <p>No urgent issues detected — we checked what we watch and everything looks in good shape.</p>
        </div>
        <div className="recs-report-meta">
          <span title={new Date(report.receivedAt).toLocaleString()}><History size={12} /> Last analysis {formatRelativeTime(report.receivedAt)}</span>
          <span title="How long the run took"><Clock3 size={12} /> took {report.elapsedMs < 1000 ? 'under a second' : `${(report.elapsedMs / 1000).toFixed(1)}s`}</span>
          <button className="icon-button compact" onClick={onDismiss} aria-label="Dismiss report" title="Dismiss"><X size={14} /></button>
        </div>
      </div>

      <div className="recs-report-stats">
        {stats ? (
          <>
            <span className="recs-report-stat"><Package size={13} /><strong>{stats.products}</strong><small>products</small></span>
            <span className="recs-report-stat"><Users size={13} /><strong>{stats.customers}</strong><small>customers</small></span>
            <span className="recs-report-stat"><ShoppingCart size={13} /><strong>{stats.checkouts}</strong><small>checkouts</small></span>
            <span className="recs-report-stat"><ListChecks size={13} /><strong>{stats.orders}</strong><small>orders</small></span>
          </>
        ) : (
          <span className="recs-report-stat"><Database size={13} /><strong>synced</strong><small>store data analyzed</small></span>
        )}
        <span className="recs-report-stat"><Layers size={13} /><strong>{rulesChecked}/{RULE_ORDER.length}</strong><small>triggers checked</small></span>
        <span className={`recs-report-stat health ${score === null ? 'muted' : score >= 80 ? 'good' : score >= 40 ? 'mid' : 'bad'}`} title={tone.hint}>
          <Activity size={13} /><strong>{tone.label}{score === null ? '' : ` · ${score}/100`}</strong><small>store health</small>
        </span>
      </div>

      {report.deduplicated > 0 ? (
        <p className="recs-report-note"><Info size={13} /> {report.deduplicated} signal{report.deduplicated === 1 ? '' : 's'} matched recommendations already open, so nothing was duplicated.</p>
      ) : (
        <div className="recs-report-rules" role="list" aria-label="Per-rule results">
          {RULE_ORDER.map((ruleId) => (
            <span key={ruleId} role="listitem"><Check size={12} /> {RULE_DETAILS[ruleId].healthy}</span>
          ))}
        </div>
      )}

      {stats?.dataFreshAt && <p className="recs-report-note"><Database size={13} /> We used a snapshot from {formatRelativeTime(stats.dataFreshAt)}. Come back tomorrow for new insights — or tap Discover Opportunities anytime after fresh data syncs.</p>}
      {!stats?.dataFreshAt && <p className="recs-report-note"><Info size={13} /> Come back tomorrow for new insights — or tap Discover Opportunities anytime after fresh data syncs.</p>}

      <div className="recs-report-actions">
        {onNavigateSection && <button className="button secondary" onClick={() => onNavigateSection('analytics')}><BarChart3 size={14} /> View analytics</button>}
        {onNavigateSection && <button className="button secondary" onClick={() => onNavigateSection('automation')}><Workflow size={14} /> Set up automation</button>}
        <button className="button secondary" onClick={onHow}><Info size={14} /> How it works</button>
        <button className="button primary recs-discover" onClick={onRerun} disabled={rerunBlocked} title="Ask your AI team to look again"><Sparkles size={14} /> Discover Opportunities</button>
      </div>
    </section>
  )
}

function RecsEmptyCard({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action: ReactNode }) {
  return (
    <div className="recs-empty-card">
      <span className="recs-empty-icon"><Icon size={20} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

function KpiSkeleton() {
  return <div className="recs-kpis skeleton" aria-hidden>{[1, 2, 3, 4, 5].map((key) => <div className="recs-kpi recs-skeleton-block" key={key}><span className="recs-skeleton-line w40" /><span className="recs-skeleton-line w70 tall" /><span className="recs-skeleton-line w55" /></div>)}</div>
}

function CardSkeletons() {
  return (
    <div className="recs-list" aria-hidden aria-busy="true">
      {[1, 2, 3, 4].map((key) => (
        <div className="recs-card recs-skeleton-block" key={key}>
          <div className="recs-card-main">
            <span className="recs-skeleton-line w30" />
            <span className="recs-skeleton-line w80 tall" />
            <span className="recs-skeleton-line w60" />
            <span className="recs-skeleton-line w45" />
          </div>
          <div className="recs-card-side">
            <span className="recs-skeleton-line w55" />
            <span className="recs-skeleton-line w70 tall" />
            <span className="recs-skeleton-line w50" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SidebarSkeleton() {
  return <>{[1, 2].map((key) => <div className="card recs-side-card recs-skeleton-block" key={key} aria-hidden><span className="recs-skeleton-line w45" /><span className="recs-skeleton-line w90 tall" /><span className="recs-skeleton-line w70" /></div>)}</>
}

// ---------------------------------------------------------------------------
// How it works modal — the educational surface the old "How evidence works"
// button pretended to be.
// ---------------------------------------------------------------------------

function HowItWorksModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay">
      <div className="modal-card recs-how-modal" role="dialog" aria-label="How recommendations work">
        <div className="modal-card-top">
          <div>
            <div className="section-kicker"><ShieldCheck size={13} /> HOW RECOMMENDATIONS WORK</div>
            <h2>Real numbers. Friendly words. Your decision.</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="recs-how-scroll">
          <section>
            <h3><Database size={14} /> 1 · Eight smart triggers read your real data</h3>
            <p>Every look uses the same eight smart triggers against your products, customers, checkouts, and orders. Fixed formulas — no model ever invents a number. Eight deterministic rules stay honest.</p>
            <div className="recs-how-rules">
              {(Object.keys(RULE_LABELS) as (keyof typeof RULE_LABELS)[]).map((ruleId) => (
                <div key={ruleId}><strong>{RULE_LABELS[ruleId]}</strong><span>{RULE_DESCRIPTIONS[ruleId]}</span></div>
              ))}
            </div>
          </section>
          <section>
            <h3><ShieldCheck size={14} /> 2 · Every recommendation is backed by real data</h3>
            <p>The exact facts that triggered a finding — each with its source — are recorded, sorted, and hashed with SHA-256. The "Evidence verified" badge means we re-checked the hash and it matches. Personal customer data (names, emails, phones) never enters a pack.</p>
          </section>
          <section>
            <h3><Gauge size={14} /> 3 · Confidence is calibrated by your decisions</h3>
            <p>New teammates start humble (capped at 75%) until they have 10 decisions from you. From then on their ceiling tracks how often you say yes. High confidence (90%+) is earned, never granted.</p>
          </section>
          <section>
            <h3><Zap size={14} /> 4 · Every recommendation shows the value</h3>
            <p>Each impact figure says what it is — "revenue at risk", "modeled 30-day uplift", "expected recovery" — in your store's real currency. Different labels are never summed, and different currencies are never mixed.</p>
          </section>
          <section>
            <h3><LockKeyhole size={14} /> 5 · You stay in control</h3>
            <p>Safe actions just record your yes. Anything that could reach a customer (emails, discounts) only ever produces a draft you review — a recommendation can never email your customers by itself.</p>
          </section>
          <section className="recs-how-faq">
            <h3><Info size={14} /> FAQ</h3>
            <p><strong>Why do I see "AI explanation unavailable"?</strong> The optional language layer was offline or over budget. The numbers are deterministic and complete without it.</p>
            <p><strong>Why did a recommendation expire?</strong> Time-sensitive signals (an abandoned cart, a stockout window) stop being actionable; ProfitPilot retires them instead of letting stale advice linger.</p>
            <p><strong>What counts against my monthly limit?</strong> Only newly generated recommendations. Reviewing, approving, or rejecting existing ones is always free.</p>
          </section>
        </div>
        <div className="modal-actions"><button className="button primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function isUpgradeRequired(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403 && /upgrade/i.test(error.message)
}

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error) return error.message
  return 'The API could not be reached.'
}

export { RecommendationCard, EvidenceDrawer, FirstRunState, AllClearState, HowItWorksModal, KpiHero, InsightsSidebar, ApproveConfirmSheet, RejectReasonSheet, UndoSnackbar, Tip, RuleDetailModal, AnalysisProgressModal, AnalysisReportPanel, SampleRecommendationPreview }
