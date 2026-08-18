import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
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
  History,
  Info,
  Layers,
  ListChecks,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Package,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingUp,
  UserPlus,
  Users,
  UserX,
  WandSparkles,
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
  RULE_LABELS,
  STATUS_TABS,
  STATUS_TAB_TOOLTIPS,
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
  CAMPAIGN_AGENT: Send,
  PRODUCT_AGENT: Package,
  EXECUTIVE_AGENT: Briefcase,
}

const AGENT_COLORS: Readonly<Record<AgentId, string>> = {
  REVENUE_AGENT: '#10B981',
  INVENTORY_AGENT: '#3B82F6',
  CUSTOMER_AGENT: '#9B7CF6',
  PRICING_AGENT: '#F59E0B',
  CAMPAIGN_AGENT: '#57C6E9',
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

const SORT_TOOLTIP = 'How your AI team ranks this list — by modeled money at stake, calibrated confidence, or freshness.'

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
  { label: 'Scanning products', detail: 'Stock cover, sales velocity, and margins' },
  { label: 'Analyzing customers', detail: 'Lifetime value and purchase cadence' },
  { label: 'Checking inventory', detail: 'Dead stock and reorder windows' },
  { label: 'Reviewing orders', detail: 'Co-purchase pairs and revenue momentum' },
  { label: 'Applying deterministic rules', detail: 'Fixed formulas — never invented numbers' },
  { label: 'Composing recommendations', detail: 'Pricing impact and sealing evidence packs' },
]

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
    if (!storeId) { onToast('Connect Shopify before generating recommendations.', 'info'); return }
    if (analyzeBlocked) { onToast(`Your monthly recommendation limit is reached. Upgrade to keep generating.`, 'warning'); return }
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
        onToast(`Analysis complete — ${result.recommendations.length} recommendation${result.recommendations.length === 1 ? '' : 's'} generated from your store data.`, 'success')
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
    void refreshSummary()
  }

  const refreshSummary = async () => {
    if (!storeId) return
    try { setSummary(await fetchRecommendationSummary(storeId)) } catch { /* summary refresh is best-effort */ }
  }

  const startUndoWindow = (recommendation: RecommendationView, decision: 'approved' | 'rejected') => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    setUndo({ recommendation, decision, expiresAt: Date.now() + 30_000 })
    undoTimer.current = window.setTimeout(() => setUndo(null), 30_000)
  }

  const decide = async (recommendation: RecommendationView, decision: 'approve' | 'reject', reason: RejectReason | null) => {
    if (!storeId) return
    try {
      const updated = await decideRecommendationWithReason(storeId, recommendation.id, recommendation.version, decision, reason)
      applyLocal(updated)
      startUndoWindow(updated, decision === 'approve' ? 'approved' : 'rejected')
      onToast(`Recommendation ${decision === 'approve' ? 'approved' : 'rejected'}.`, decision === 'approve' ? 'success' : 'info')
    } catch (error: unknown) {
      onToast(errorText(error), 'error')
      await load({ silent: true })
    }
  }

  const requestApprove = (recommendation: RecommendationView) => {
    if (recommendation.actionRisk === 'SAFE') { void decide(recommendation, 'approve', null); return }
    setConfirm({ kind: 'approve', recommendation })
  }
  const requestReject = (recommendation: RecommendationView) => setConfirm({ kind: 'reject', recommendation })

  const performUndo = async () => {
    if (!storeId || !undo) return
    try {
      const reverted = await undoRecommendationDecision(storeId, undo.recommendation.id)
      applyLocal(reverted)
      setUndo(null)
      onToast('Decision undone — the recommendation is pending again.', 'info')
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
    if (chosen.length === 0) { onToast('Select pending recommendations first.', 'info'); return }
    setBulkBusy(true)
    try {
      const result = await bulkDecideRecommendations(storeId, chosen.slice(0, 20).map((item) => ({ id: item.id, expectedVersion: item.version, decision })))
      const succeeded = result.results.filter((entry) => entry.ok)
      const failed = result.results.filter((entry) => !entry.ok)
      for (const entry of succeeded) { if (entry.recommendation) setItems((current) => applyDecisionLocally(current, entry.recommendation!)) }
      setSelected(new Set())
      void refreshSummary()
      onToast(failed.length > 0 ? `${succeeded.length} ${decision === 'approve' ? 'approved' : 'rejected'}, ${failed.length} failed (${failed[0]?.error?.message ?? 'conflict'}).` : `${succeeded.length} recommendation${succeeded.length === 1 ? '' : 's'} ${decision === 'approve' ? 'approved' : 'rejected'}.`, failed.length > 0 ? 'warning' : 'success')
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
    return <div className="recs-workspace"><RecsEmptyCard icon={WandSparkles} title="Connect your store to meet your AI team" description="Recommendations are generated only from your real synced Shopify data. Connect a store to run your first analysis — ProfitPilot never ships demo insights." action={null} /></div>
  }

  return (
    <div className="recs-workspace">
      <div className="recs-topline">
        <div className="recs-topline-copy">
          <span className="recs-kicker"><Sparkles size={13} /> AI EMPLOYEE · EVIDENCE-BACKED</span>
          <p>Eight deterministic rules read your synced products, customers, checkouts, and orders. Every finding is priced, sealed with verifiable evidence, and waits for your decision.</p>
        </div>
        <div className="recs-topline-actions">
          {lastAnalyzedAt && (
            <span className="recs-last-run" title={`Analysis finished ${new Date(lastAnalyzedAt).toLocaleString()}. Re-run anytime for a fresh check.`}>
              <History size={12} /> Last analysis {formatRelativeTime(lastAnalyzedAt)}
            </span>
          )}
          <button className="button secondary" onClick={() => setHowItWorksOpen(true)}><Info size={14} /> How it works</button>
          <button className={`button primary ${analyzeBlocked ? 'blocked' : ''}`} onClick={() => void runAnalysis()} disabled={analyzing} title={analyzeBlocked ? `Monthly limit reached (${usage.label}). Upgrade to continue.` : lastAnalyzedAt ? `Last run ${formatRelativeTime(lastAnalyzedAt)}` : 'Scan your synced store data with eight deterministic rules'}>
            {analyzing ? <RefreshCw size={14} className="spin" /> : analyzeBlocked ? <LockKeyhole size={14} /> : <Zap size={14} />}
            {analyzing ? 'Analyzing your store…' : analyzeBlocked ? 'Limit reached' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {usage.nearLimit && !usage.atLimit && (
        <div className="recs-banner warning"><AlertTriangle size={15} /><span><strong>{usage.remaining} recommendation{usage.remaining === 1 ? '' : 's'} left this month</strong> on your {plan ? PLAN_LABELS[plan] : ''} plan ({usage.label}).</span><button className="button secondary compact" onClick={onNavigateBilling}>View plans <ArrowUpRight size={13} /></button></div>
      )}
      {usage.atLimit && usage.limit !== null && (
        <div className="recs-banner blocked"><LockKeyhole size={15} /><span><strong>Monthly limit reached — {usage.label}.</strong> Your AI team found value {usage.limit} times this month. Upgrade plans to keep the recommendations coming.</span><button className="button primary compact" onClick={onNavigateBilling}>Upgrade plan <ArrowUpRight size={13} /></button></div>
      )}

      {phase === 'loading' ? <KpiSkeleton /> : summary && <KpiHero summary={summary} usage={usage} plan={plan} onUpgrade={onNavigateBilling} />}

      <div className="recs-body">
        <div className="recs-main">
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
              <div className="recs-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title, product, customer, or rule…" aria-label="Search recommendations by title, product, customer, or rule" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>}</div>
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
                <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} aria-label="From date" />
                <span>–</span>
                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} aria-label="To date" />
              </div>
              <button className="icon-button recs-refresh" onClick={() => void load()} title={refreshedAt ? `Refreshed ${formatRelativeTime(new Date(refreshedAt).toISOString())}` : 'Refresh'} aria-label="Refresh recommendations"><RefreshCw size={15} /></button>
            </div>
            <div className="recs-agent-chips" role="group" aria-label="Filter by agent">
              <button className={`recs-chip ${agentFilter === null ? 'active' : ''}`} onClick={() => setAgentFilter(null)}>All agents</button>
              {AGENT_UNLOCK_ORDER.map((agent) => {
                const Icon = AGENT_ICONS[agent]
                const locked = agentLockedForPlan(agent, plan)
                if (locked) {
                  return <button key={agent} className="recs-chip locked" onClick={onNavigateBilling} title={`${agentLabel(agent)} unlocks on the ${PLAN_LABELS[planRequiredForAgent(agent)]} plan. Upgrade to add this agent to your team.`}><LockKeyhole size={11} /> {agentLabel(agent)}<small>{PLAN_LABELS[planRequiredForAgent(agent)]}</small></button>
                }
                return <button key={agent} className={`recs-chip ${agentFilter === agent ? 'active' : ''}`} style={{ ['--chip-color' as never]: AGENT_COLORS[agent] }} onClick={() => setAgentFilter((current) => (current === agent ? null : agent))}><Icon size={12} /> {agentLabel(agent)}</button>
              })}
            </div>
          </div>

          {selected.size > 0 && (
            <div className="recs-bulk-bar" role="toolbar" aria-label="Bulk actions">
              <span><strong>{selected.size}</strong> selected</span>
              <button className="button approve compact" disabled={bulkBusy} onClick={() => void bulkDecide('approve')}><Check size={13} /> Approve {selected.size}</button>
              <button className="button reject compact" disabled={bulkBusy} onClick={() => void bulkDecide('reject')}><X size={13} /> Reject {selected.size}</button>
              <button className="text-button" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          {phase === 'loading' && <CardSkeletons />}
          {phase === 'error' && (
            <div className="recs-error-state" role="alert">
              <AlertCircle size={22} />
              <strong>Recommendations could not be loaded</strong>
              <p>{loadError ?? 'The API could not be reached.'}</p>
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
              : <RecsEmptyCard icon={Search} title={statusTab === 'ALL' ? 'Nothing matches these filters' : `No ${statusTabLabel(statusTab).toLowerCase()} recommendations`} description="Try a different status tab, another agent, or clear the search and date filters." action={<button className="button secondary" onClick={() => { setStatusTab('ALL'); setAgentFilter(null); setQuery(''); setDateFrom(''); setDateTo('') }}>Clear filters</button>} />
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
        </div>

        <aside className="recs-sidebar">
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
  const pendingCount = summary.counts.PENDING
  const approvedCount = summary.approvedThisMonth.count
  // Prefer a currency the store actually uses when formatting an honest zero.
  const knownCurrency = summary.pendingImpact[0]?.currency ?? summary.approvedThisMonth.impact[0]?.currency ?? summary.recentDecisions[0]?.currency ?? null
  const zeroImpact = knownCurrency ? formatImpact(0, knownCurrency) : '0'
  return (
    <div className="recs-kpis">
      <div className="recs-kpi">
        <Tip label={KPI_TOOLTIPS.pendingImpact}><span className="recs-kpi-label"><Gauge size={13} /> Revenue opportunity pending</span></Tip>
        <strong className="recs-kpi-value accent">{summary.pendingImpact.length > 0 ? formatCurrencyAmounts(summary.pendingImpact) : zeroImpact}</strong>
        {pendingCount === 0
          ? <small>No pending recommendations yet</small>
          : <small>{pendingCount} pending recommendation{pendingCount === 1 ? '' : 's'} awaiting your call</small>}
      </div>
      <div className="recs-kpi">
        <Tip label={KPI_TOOLTIPS.approvedThisMonth}><span className="recs-kpi-label"><CheckCircle2 size={13} /> Approved this month</span></Tip>
        <strong className="recs-kpi-value">{approvedCount}</strong>
        {approvedCount === 0
          ? <small>Approve recommendations to see the impact here</small>
          : <small>{approvedCount} approval{approvedCount === 1 ? '' : 's'} this month{summary.approvedThisMonth.impact.length > 0 ? ` · ${formatCurrencyAmounts(summary.approvedThisMonth.impact)} modeled` : ''}</small>}
      </div>
      <div className="recs-kpi">
        <Tip label={KPI_TOOLTIPS.approvalRate}><span className="recs-kpi-label"><TrendingUp size={13} /> Approval rate</span></Tip>
        <strong className="recs-kpi-value">{approvalRate === null ? '—' : `${approvalRate}%`}</strong>
        <small>{approvalRate === null ? 'Need decisions to calculate' : summary.approvalRate.last30d !== null ? <>of decisions approved · last 30 days {summary.approvalRate.allTime !== null && <span className={trendUp ? 'trend-up' : 'trend-down'}>{trendUp ? '▲' : '▼'} vs all-time</span>}</> : 'of all-time decisions approved'}</small>
      </div>
      <div className="recs-kpi">
        <Tip label={KPI_TOOLTIPS.averageDecision}><span className="recs-kpi-label"><Clock3 size={13} /> Avg time to decide</span></Tip>
        <strong className="recs-kpi-value">{summary.averageDecisionMs === null ? '—' : formatDurationMs(summary.averageDecisionMs)}</strong>
        <small>{summary.averageDecisionMs === null ? 'Decide recommendations to track this' : 'How fast you review new findings'}</small>
      </div>
      <div className="recs-kpi usage">
        <Tip label={KPI_TOOLTIPS.monthlyUsage}><span className="recs-kpi-label"><WandSparkles size={13} /> Monthly usage</span></Tip>
        <div className="recs-usage-row">
          <UsageRing ratio={usage.ratio} atLimit={usage.atLimit} nearLimit={usage.nearLimit} />
          <div className="recs-usage-copy">
            <strong>{usage.limit === null ? `${usage.used}` : `${usage.used}/${usage.limit}`}</strong>
            <small>{usage.limit === null ? `Unlimited on ${plan ? PLAN_LABELS[plan] : 'your'} plan` : `${plan ? PLAN_LABELS[plan] : ''} plan · ${usage.remaining} left`}</small>
          </div>
        </div>
        {usage.limit !== null && <button className="text-button recs-upgrade-link" onClick={onUpgrade}>Upgrade for more <ArrowUpRight size={12} /></button>}
      </div>
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

function RecommendationCard({ recommendation, maxImpact, selected, onSelect, onEvidence, onApprove, onReject, onSnooze, onCopyLink, undoAvailable, onUndo }: {
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
  onUndo: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const Icon = AGENT_ICONS[recommendation.agent] ?? Sparkles
  const expiry = recommendation.status === 'PENDING' ? expiryBadge(recommendation.expiresAt) : null
  const explanationBadge = EXPLANATION_STATUS_LABELS[recommendation.explanationStatus]
  const decisionDelay = formatDecisionDelay(recommendation.createdAt, recommendation.decidedAt)
  const pending = recommendation.status === 'PENDING'
  const highRisk = recommendation.actionRisk !== 'SAFE'
  return (
    <article className={`recs-card status-${recommendation.status.toLowerCase()} ${selected ? 'selected' : ''}`}>
      {pending && <label className="recs-card-check"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${recommendation.title}`} /><span /></label>}
      <div className="recs-card-main">
        <div className="recs-card-top">
          <span className="recs-agent-pill" style={{ ['--chip-color' as never]: AGENT_COLORS[recommendation.agent] }}><Icon size={12} /> {agentLabel(recommendation.agent)}</span>
          <ConfidenceMeter confidence={recommendation.confidence} level={recommendation.confidenceLevel} />
          {expiry && <span className={`recs-expiry ${expiry === 'Expired' ? 'expired' : ''}`}><Clock3 size={11} /> {expiry}</span>}
          {explanationBadge && <span className="recs-explanation-badge" title={recommendation.explanationStatus === 'AI_REJECTED' ? 'The AI-written explanation was filtered because it failed validation. The numbers below are deterministic and unaffected.' : 'The deterministic numbers are unaffected — only the optional plain-language explanation is missing.'}><Info size={11} /> {explanationBadge}</span>}
          <span className="recs-card-time" title={new Date(recommendation.createdAt).toLocaleString()}>{formatRelativeTime(recommendation.createdAt)}</span>
        </div>
        <h3 className="recs-card-title">{recommendation.title}</h3>
        <p className="recs-card-reason">{recommendation.reason}</p>
        {recommendation.explanation && <blockquote className="recs-card-explanation"><MessageSquare size={12} /> {recommendation.explanation}</blockquote>}
        <div className="recs-card-meta">
          {recommendation.entityKey && <span className="recs-entity-chip" title="The product, customer, or checkout this recommendation is about"><Database size={11} /> {entityChipLabel(recommendation)}</span>}
          <span className="recs-rule-chip" title={RULE_DESCRIPTIONS[recommendation.ruleId]}>Rule: {ruleLabel(recommendation.ruleId)}{typeof recommendation.evidencePack.ruleVersion === 'string' ? ` v${recommendation.evidencePack.ruleVersion}` : ''}</span>
          <span className="recs-action-chip"><Zap size={11} /> {actionTypeLabel(recommendation.actionType)}{highRisk && ' · ' + riskLabel(recommendation.actionRisk)}</span>
        </div>
      </div>
      <div className="recs-card-side">
        <span className="recs-impact-label">{impactLabelText(recommendation.impactLabel)}</span>
        <strong className="recs-impact-value">{formatImpact(recommendation.impactValue, recommendation.currency)}</strong>
        <span className="recs-impact-bar" aria-hidden><i style={{ width: `${impactRatio(recommendation.impactValue, maxImpact) * 100}%` }} /></span>
        <button className="text-button recs-evidence-link" onClick={onEvidence}><Eye size={13} /> View evidence</button>
        {pending ? (
          <div className="recs-card-actions">
            <button className="button reject compact" onClick={onReject}>Reject</button>
            <button className="button approve compact" onClick={onApprove}><Check size={13} /> {highRisk ? 'Review & Approve' : 'Approve'}</button>
            <div className="recs-card-menu-wrap">
              <button className="icon-button compact" aria-label="More actions" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={14} /></button>
              {menuOpen && (
                <div className="recs-card-menu" onMouseLeave={() => setMenuOpen(false)}>
                  <button onClick={() => { setMenuOpen(false); onSnooze(1) }}><Clock3 size={12} /> Snooze 1 hour</button>
                  <button onClick={() => { setMenuOpen(false); onSnooze(24) }}><Clock3 size={12} /> Snooze 1 day</button>
                  <button onClick={() => { setMenuOpen(false); onCopyLink() }}><Copy size={12} /> Copy link</button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={`recs-resolved ${recommendation.status.toLowerCase()}`}>
            {recommendation.status === 'APPROVED' && <><CheckCircle2 size={13} /> Approved</>}
            {recommendation.status === 'REJECTED' && <><XCircle size={13} /> Rejected{recommendation.rejectReason ? ` · ${REJECT_REASON_LABELS[recommendation.rejectReason]}` : ''}</>}
            {recommendation.status === 'EXECUTED' && <><Zap size={13} /> Executed</>}
            {recommendation.status === 'FAILED' && <><AlertCircle size={13} /> Execution failed</>}
            {recommendation.status === 'EXPIRED' && <><Clock3 size={13} /> Expired</>}
            {decisionDelay && <small>{decisionDelay}</small>}
            {undoAvailable && <button className="text-button" onClick={onUndo}><RotateCcw size={12} /> Undo</button>}
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
    <span className={`recs-confidence ${level.toLowerCase()}`} title={`Calibrated confidence ${percent}%. Agents earn higher confidence as you approve their recommendations.`}>
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
            <span className="drawer-kicker"><ShieldCheck size={13} /> EVIDENCE PACK</span>
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
            <div className="drawer-section-title"><Database size={15} /> Facts and sources</div>
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
              {recommendation.decidedAt && <span><i className={`dot ${recommendation.status === 'REJECTED' ? 'red' : 'green'}`} /> {statusLabel(recommendation.status)} {new Date(recommendation.decidedAt).toLocaleString()}{recommendation.decidedBy === 'jarvis' ? ' via Jarvis' : recommendation.decidedBy === 'system' ? ' automatically' : ''}</span>}
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
        <div className="section-kicker"><XCircle size={13} /> REJECT RECOMMENDATION</div>
        <h2>{recommendation.title}</h2>
        <p className="recs-confirm-what">Telling your AI team <em>why</em> makes future recommendations better — rejections lower an agent's confidence until it earns your trust back.</p>
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
  const donutData = pendingByAgent.map((entry) => ({ name: agentLabel(entry.agent), value: entry.pending, agent: entry.agent }))
  const totalPending = summary.counts.PENDING
  const maxPending = pendingByAgent.reduce((max, entry) => Math.max(max, entry.pending), 0)
  const trend = summary.generatedTrend
  const trendMax = trend.reduce((max, day) => Math.max(max, day.generated), 0)
  const trendGenerated = trend.reduce((sum, day) => sum + day.generated, 0)
  const trendApproved = trend.reduce((sum, day) => sum + day.approved, 0)
  const maxRuleTotal = summary.byRule.reduce((max, entry) => Math.max(max, entry.total), 0)
  return (
    <>
      <div className="card recs-side-card">
        <div className="recs-side-title"><WandSparkles size={13} /> Pending by agent</div>
        {donutData.length > 0 && (
          <div className="recs-donut-wrap">
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={62} paddingAngle={3} strokeWidth={0} onClick={(entry) => { const agent = (entry as unknown as { agent?: AgentId }).agent; if (agent) onFilterAgent(agent) }}>
                  {donutData.map((entry) => <Cell key={entry.agent} fill={AGENT_COLORS[entry.agent]} cursor="pointer" />)}
                </Pie>
                <Tooltip formatter={(value) => [`${String(value)} pending`, '']} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="recs-donut-center"><strong>{totalPending}</strong><small>pending</small></div>
          </div>
        )}
        {/* Every agent is listed — even idle ones — so the team is visible
            before the first run. Locked agents keep plan gating intact. */}
        <div className="recs-agent-roster">
          {AGENT_UNLOCK_ORDER.map((agent) => {
            const Icon = AGENT_ICONS[agent]
            const locked = agentLockedForPlan(agent, plan)
            const pending = byAgent.get(agent)?.pending ?? 0
            if (locked) {
              return (
                <button key={agent} className="recs-agent-row locked" onClick={onUpgrade} title={`${agentLabel(agent)} unlocks on the ${PLAN_LABELS[planRequiredForAgent(agent)]} plan. ${AGENT_DESCRIPTIONS[agent]}`}>
                  <span className="recs-agent-row-icon"><LockKeyhole size={12} /></span>
                  <span className="recs-agent-row-copy"><strong>{agentLabel(agent)}</strong><small>{AGENT_DESCRIPTIONS[agent]}</small></span>
                  <span className="recs-agent-row-plan">{PLAN_LABELS[planRequiredForAgent(agent)]}</span>
                </button>
              )
            }
            return (
              <button key={agent} className="recs-agent-row" onClick={() => onFilterAgent(agent)} title={`${AGENT_DESCRIPTIONS[agent]} — click to filter the list to ${agentLabel(agent)}.`}>
                <span className="recs-agent-row-icon" style={{ ['--chip-color' as never]: AGENT_COLORS[agent] }}><Icon size={12} /></span>
                <span className="recs-agent-row-copy"><strong>{agentLabel(agent)}</strong><small>{AGENT_DESCRIPTIONS[agent]}</small></span>
                <span className="recs-agent-row-count">{pending}<small>pending</small></span>
                <span className="recs-agent-row-bar" aria-hidden><i style={{ width: `${maxPending > 0 ? Math.max(0, (pending / maxPending) * 100) : 0}%`, background: AGENT_COLORS[agent] }} /></span>
              </button>
            )
          })}
        </div>
        {!hasData && <p className="recs-side-empty">No recommendations yet — your team reports here after the first analysis.</p>}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><TrendingUp size={13} /> 30-day activity</div>
        {trend.length > 0 ? (
          <>
            <div className="recs-trend" aria-label="Recommendations generated per day, last 30 days">
              {trend.map((day) => (
                <span key={day.day} className="recs-trend-bar" title={`${day.day}: ${day.generated} generated, ${day.approved} approved`}>
                  <i className="generated" style={{ height: `${trendMax > 0 ? Math.max(8, (day.generated / trendMax) * 100) : 8}%` }} />
                  <i className="approved" style={{ height: `${trendMax > 0 ? (day.approved / trendMax) * 100 : 0}%` }} />
                </span>
              ))}
            </div>
            <div className="recs-trend-metrics"><span><strong>{trendGenerated}</strong> generated</span><span><strong>{trendApproved}</strong> approved</span><span className="recs-trend-window">last 30 days</span></div>
          </>
        ) : (
          <SampleActivityChart />
        )}
        {trend.length > 0 && <div className="recs-trend-legend"><span><i className="generated" /> Generated</span><span><i className="approved" /> Approved</span></div>}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><Layers size={13} /> Top rules firing</div>
        {summary.byRule.length > 0 ? (
          <div className="recs-rule-list">
            {summary.byRule.slice(0, 5).map((entry) => (
              <button key={entry.ruleId} className="recs-rule-row interactive" onClick={() => onInspectRule(entry.ruleId)} title={`${RULE_DESCRIPTIONS[entry.ruleId]} — click for how this rule works.`}>
                <span>{ruleLabel(entry.ruleId)}</span>
                <span className="recs-rule-row-share" aria-hidden><i style={{ width: `${maxRuleTotal > 0 ? Math.max(6, (entry.total / maxRuleTotal) * 100) : 0}%` }} /></span>
                <strong>{entry.total}</strong>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="recs-rule-list">
              {RULE_ORDER.map((ruleId) => (
                <button key={ruleId} className="recs-rule-row interactive" onClick={() => onInspectRule(ruleId)} title={`${RULE_DESCRIPTIONS[ruleId]} — click for how this rule works.`}>
                  <span>{RULE_LABELS[ruleId]}</span>
                  <strong>0</strong>
                </button>
              ))}
            </div>
            <p className="recs-side-empty">Rules fire when a pattern in your data crosses its threshold — each trigger shows up here.</p>
          </>
        )}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><Clock3 size={13} /> Recent decisions</div>
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
            <p className="recs-side-empty">Approve or reject recommendations to build history — every decision tunes agent confidence.</p>
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
      <p className="recs-side-empty">Activity appears here as your AI team works — track generated vs approved per day.</p>
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
        <span className="recs-first-orb"><WandSparkles size={26} /></span>
        <h2>{hasRun ? 'Nothing crossed a threshold yet' : 'Ready to analyze your store'}</h2>
        <p>Your AI agents will find opportunities in your synced products, customers, checkouts, and orders — every one priced in real impact and sealed with verifiable evidence.</p>
        <div className="recs-first-actions">
          <button className="button primary recs-cta-primary" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <RefreshCw size={15} className="spin" /> : <Zap size={15} />} {analyzing ? 'Analyzing your store…' : hasRun ? 'Re-run Analysis' : 'Run First Analysis'}</button>
          <button className="button secondary" onClick={onHow}><Info size={14} /> How it works</button>
        </div>
      </div>

      <div className="recs-expect">
        <div className="recs-expect-title"><ListChecks size={13} /> What to expect after an analysis</div>
        <div className="recs-expect-grid">
          <span><strong>Specific actions</strong> Each finding names the exact product, customer, or checkout to act on.</span>
          <span><strong>Impact estimates</strong> Every card is priced in your store's currency before you commit.</span>
          <span><strong>Approve / reject</strong> You decide. Customer-facing actions stop at drafts you review.</span>
          <span><strong>Results tracked</strong> Decisions feed the KPIs and activity chart above — nothing is lost.</span>
        </div>
      </div>

      <div className="recs-rule-grid">
        {RULE_ORDER.map((ruleId) => {
          const Icon = RULE_ICONS[ruleId]
          return (
            <button className="recs-rule-card" key={ruleId} onClick={() => onInspectRule(ruleId)} title={`${RULE_DESCRIPTIONS[ruleId]} — click to see exactly when this rule fires.`}>
              <span className="recs-rule-card-head"><span className="recs-rule-card-icon"><Icon size={13} /></span><strong>{RULE_LABELS[ruleId]}</strong></span>
              <p>{RULE_DESCRIPTIONS[ruleId]}</p>
              <span className="recs-rule-card-uses"><Database size={10} /> Uses: {RULE_DATA_SOURCES[ruleId]}</span>
            </button>
          )
        })}
      </div>

      <HowRulesWork />
      <SampleRecommendationPreview />
      <p className="recs-sample-note"><ShieldCheck size={13} /> ProfitPilot never invents a recommendation. If your store data doesn't trigger a rule, you'll see an honest all-clear — not filler.</p>
    </div>
  )
}

/** Expandable "how rules work" strip with the data-flow diagram and trust indicators. */
function HowRulesWork() {
  return (
    <details className="recs-how-strip">
      <summary><Info size={13} /> How rules work <ChevronDown size={13} className="recs-how-strip-caret" /></summary>
      <div className="recs-how-strip-body">
        <p>ProfitPilot's intelligence is <strong>deterministic</strong>: the same eight fixed formulas run against your synced store data on every analysis. No model guesses a number — the AI layer only writes the plain-language explanation, and it is validated against the evidence before you ever see it.</p>
        <div className="recs-flow" aria-label="Data flow: synced store data, deterministic rules, priced recommendations, your decision">
          <span><Database size={13} /> Synced store data</span>
          <ArrowRight size={13} />
          <span><Layers size={13} /> 8 deterministic rules</span>
          <ArrowRight size={13} />
          <span><Gauge size={13} /> Priced recommendations</span>
          <ArrowRight size={13} />
          <span><ShieldCheck size={13} /> Your decision</span>
        </div>
        <div className="recs-trust-row">
          <span><CheckCircle2 size={12} /> Never invents numbers</span>
          <span><Database size={12} /> Grounded in your synced data</span>
          <span><LockKeyhole size={12} /> You approve every action</span>
          <span><ShieldCheck size={12} /> Evidence sealed with SHA-256</span>
        </div>
      </div>
    </details>
  )
}

/** A clearly-labeled sample card so a fresh merchant sees the anatomy of a real recommendation. */
function SampleRecommendationPreview() {
  return (
    <div className="recs-sample-wrap">
      <span className="recs-sample-caption"><FlaskConical size={11} /> Preview — this is what a recommendation looks like (sample, not your data)</span>
      <article className="recs-card recs-sample-card" aria-label="Sample recommendation preview. Not generated from your store.">
        <div className="recs-card-main">
          <div className="recs-card-top">
            <span className="recs-agent-pill" style={{ ['--chip-color' as never]: AGENT_COLORS.INVENTORY_AGENT }}><Box size={12} /> Inventory Agent</span>
            <span className="recs-confidence medium"><span className="recs-confidence-bar" aria-hidden><i style={{ width: '62%' }} /></span> 62% · Medium</span>
            <span className="recs-sample-chip"><FlaskConical size={9} /> Sample</span>
          </div>
          <h3 className="recs-card-title">Restock "Everyday Hoodie — Black / M" before it sells out</h3>
          <p className="recs-card-reason">At the current sales velocity this variant has 5 days of cover left — under your 7-day reorder window. Restocking now protects a steady seller.</p>
          <div className="recs-card-meta">
            <span className="recs-rule-chip">Rule: Stockout Risk</span>
            <span className="recs-action-chip"><Zap size={11} /> Create recommendation · Safe to execute</span>
            <span className="recs-entity-chip" title="Sample evidence"><Database size={11} /> 4 evidence fields sealed</span>
          </div>
        </div>
        <div className="recs-card-side">
          <span className="recs-impact-label">Revenue at risk</span>
          <strong className="recs-impact-value">$1,240</strong>
          <span className="recs-impact-bar" aria-hidden><i style={{ width: '62%' }} /></span>
          <span className="recs-sample-actions">
            <span className="recs-tip-anchor" data-tip="This is a preview — run an analysis to get real recommendations">
              <button className="button reject compact" disabled tabIndex={-1}>Reject</button>
            </span>
            <span className="recs-tip-anchor" data-tip="This is a preview — run an analysis to get real recommendations">
              <button className="button approve compact" disabled tabIndex={-1}><Check size={13} /> Approve</button>
            </span>
          </span>
        </div>
      </article>
    </div>
  )
}

function AllClearState({ summary, onAnalyze, analyzing }: { summary: RecommendationSummary; onAnalyze: () => void; analyzing: boolean }) {
  return (
    <div className="recs-all-clear">
      <span className="recs-all-clear-icon"><CheckCircle2 size={24} /></span>
      <h2>No urgent issues detected</h2>
      <p>Latest sessions checked all eight rules against your synced data and nothing crossed a threshold. That's a healthy store, not a missing feature — new openings appear here as your data changes.</p>
      <div className="recs-all-clear-rules">
        {RULE_ORDER.map((ruleId) => (
          <span key={ruleId}><Check size={12} /> {RULE_LABELS[ruleId]}</span>
        ))}
      </div>
      <div className="recs-all-clear-actions">
        <button className="button secondary compact" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />} Run a fresh analysis</button>
        {summary.usage.used !== null && summary.usage.used > 0 && <small>{summary.usage.used} recommendation{summary.usage.used === 1 ? '' : 's'} generated this month across earlier runs.</small>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rule detail modal — explains exactly when a rule fires, what it reads, and
// who is accountable for its output. Opened from rule cards and sidebar rows.
// ---------------------------------------------------------------------------

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
        <div className="section-kicker"><Layers size={13} /> DETERMINISTIC RULE</div>
        <h2>{RULE_LABELS[ruleId]}</h2>
        <p className="recs-confirm-what">{RULE_DESCRIPTIONS[ruleId]}</p>
        <div className="recs-rule-modal-facts">
          <span><Crosshair size={13} /><div><strong>Fires when</strong>{detail.trigger}</div></span>
          <span><Gauge size={13} /><div><strong>Impact priced as</strong>{detail.impact}</div></span>
          <span><Database size={13} /><div><strong>Reads</strong>Uses: {RULE_DATA_SOURCES[ruleId]}</div></span>
          <span><AgentIcon size={13} /><div><strong>Handled by</strong>{agentLabel(agent)}{locked ? ` — locked on your plan (needs ${PLAN_LABELS[planRequiredForAgent(agent)]})` : ''}</div></span>
          <span><CheckCircle2 size={13} /><div><strong>When it's quiet</strong>{detail.healthy}</div></span>
        </div>
        <div className="modal-actions">
          {locked
            ? <><button className="button secondary" onClick={onClose}>Close</button><button className="button primary" onClick={onUpgrade}><LockKeyhole size={13} /> Upgrade plan</button></>
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
          <div className="section-kicker"><Zap size={13} /> ANALYZING YOUR STORE</div>
          <span className="recs-analysis-elapsed" title="Elapsed time"><Clock3 size={11} /> {(elapsedMs / 1000).toFixed(0)}s</span>
        </div>
        <h2>Reading your synced data…</h2>
        <p className="recs-confirm-what">The rule engine is working through your real products, customers, checkouts, and orders. No numbers are being invented — only measured.</p>
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
          <h2>Store Health Check Complete</h2>
          <p>No urgent issues detected in your synced data.</p>
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
        <span className="recs-report-stat"><Layers size={13} /><strong>{rulesChecked}/{RULE_ORDER.length}</strong><small>rules checked</small></span>
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

      {stats?.dataFreshAt && <p className="recs-report-note"><Database size={13} /> Data snapshot from {formatRelativeTime(stats.dataFreshAt)}. Analysis runs on demand — re-run anytime after new data syncs and rules fire the moment a pattern crosses its threshold.</p>}
      {!stats?.dataFreshAt && <p className="recs-report-note"><Info size={13} /> Analysis runs on demand — re-run anytime after new data syncs and rules fire the moment a pattern crosses its threshold.</p>}

      <div className="recs-report-actions">
        {onNavigateSection && <button className="button secondary" onClick={() => onNavigateSection('analytics')}><BarChart3 size={14} /> View analytics</button>}
        {onNavigateSection && <button className="button secondary" onClick={() => onNavigateSection('automation')}><Workflow size={14} /> Set up automation</button>}
        <button className="button secondary" onClick={onHow}><Info size={14} /> How it works</button>
        <button className="button primary" onClick={onRerun} disabled={rerunBlocked} title="Run the eight rules again on the latest synced data"><RefreshCw size={14} /> Re-run analysis</button>
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
            <h2>Deterministic numbers. Optional AI words. Your decision.</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="recs-how-scroll">
          <section>
            <h3><Database size={14} /> 1 · Eight deterministic rules read your real data</h3>
            <p>Every analysis run executes the same eight rules against your synced Shopify products, customers, checkouts, and orders. Rules use fixed formulas — no model ever computes a number.</p>
            <div className="recs-how-rules">
              {(Object.keys(RULE_LABELS) as (keyof typeof RULE_LABELS)[]).map((ruleId) => (
                <div key={ruleId}><strong>{RULE_LABELS[ruleId]}</strong><span>{RULE_DESCRIPTIONS[ruleId]}</span></div>
              ))}
            </div>
          </section>
          <section>
            <h3><ShieldCheck size={14} /> 2 · Every recommendation ships a sealed evidence pack</h3>
            <p>The exact facts that triggered a rule — each with its source column — are recorded, sorted, and hashed with SHA-256 at generation time. The drawer's "Evidence verified" badge means the server re-computed the hash and it matches: nothing was altered after the fact. Personal customer data (names, emails, phones) is blocked from ever entering a pack.</p>
          </section>
          <section>
            <h3><Gauge size={14} /> 3 · Confidence is calibrated by your decisions</h3>
            <p>New agents are capped at 75% confidence until they have 10 decisions from you. From then on, an agent's ceiling tracks its real approval rate — an agent you reject often is forced to be humble, and High confidence (90%+) is earned, never granted.</p>
          </section>
          <section>
            <h3><Zap size={14} /> 4 · Impact is modeled money, honestly labeled</h3>
            <p>Each impact figure states what it is — "revenue at risk", "modeled 30-day uplift", "expected recovery" — and uses your store's real currency. Different labels are never summed together, and different currencies are never mixed.</p>
          </section>
          <section>
            <h3><LockKeyhole size={14} /> 5 · Approval is a gate, not a trigger</h3>
            <p>Safe actions record your decision. Actions that could touch a customer (emails, discounts) require an explicit confirmation and only ever produce drafts you review — a recommendation can never email your customers by itself.</p>
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
