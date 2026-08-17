import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Box,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  Eye,
  Gauge,
  Info,
  Layers,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  WandSparkles,
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
import type { WorkspaceContext } from './model.js'
import {
  ACTION_TYPE_PREVIEWS,
  AGENT_UNLOCK_ORDER,
  EXPLANATION_STATUS_LABELS,
  PLAN_LABELS,
  REJECT_REASON_LABELS,
  REJECT_REASON_OPTIONS,
  RULE_DESCRIPTIONS,
  RULE_LABELS,
  STATUS_TABS,
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
  unlockedAgents,
  usageState,
} from './recommendations-model.js'
import type {
  AgentId,
  EvidenceVerification,
  GroupMode,
  RecommendationSort,
  RecommendationStatus,
  RecommendationSummary,
  RecommendationView,
  RejectReason,
  StatusTab,
} from './recommendations-model.js'

type ToastKind = 'success' | 'info' | 'warning' | 'error'
type LoadPhase = 'loading' | 'ready' | 'error'

type WorkspaceProps = Readonly<{
  context: WorkspaceContext
  onToast: (message: string, kind?: ToastKind) => void
  onNavigateBilling: () => void
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

type PendingConfirm = Readonly<{ kind: 'approve'; recommendation: RecommendationView }> | Readonly<{ kind: 'reject'; recommendation: RecommendationView }>
type UndoState = Readonly<{ recommendation: RecommendationView; decision: 'approved' | 'rejected'; expiresAt: number }>

export function RecommendationsWorkspace({ context, onToast, onNavigateBilling }: WorkspaceProps) {
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

  const runAnalysis = async () => {
    if (!storeId) { onToast('Connect Shopify before generating recommendations.', 'info'); return }
    if (analyzeBlocked) { onToast(`Your monthly recommendation limit is reached. Upgrade to keep generating.`, 'warning'); return }
    setAnalyzing(true)
    try {
      const result = await analyzeRecommendations(storeId)
      setLastAnalyzedAt(new Date().toISOString())
      onToast(result.recommendations.length > 0 ? `Analysis complete — ${result.recommendations.length} recommendation${result.recommendations.length === 1 ? '' : 's'} generated from your store data.` : 'Analysis complete — no issues detected in your synced data.', result.recommendations.length > 0 ? 'success' : 'info')
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
          <p>Every recommendation is computed from your synced store data by deterministic rules, sealed with a verifiable evidence pack, and priced in real impact. You stay in control of every action.</p>
        </div>
        <div className="recs-topline-actions">
          <button className="button secondary" onClick={() => setHowItWorksOpen(true)}><Info size={14} /> How it works</button>
          <button className={`button primary ${analyzeBlocked ? 'blocked' : ''}`} onClick={() => void runAnalysis()} disabled={analyzing} title={analyzeBlocked ? `Monthly limit reached (${usage.label}). Upgrade to continue.` : lastAnalyzedAt ? `Last run ${formatRelativeTime(lastAnalyzedAt)}` : 'Run the deterministic rule engine on your synced data'}>
            {analyzing ? <RefreshCw size={14} className="spin" /> : analyzeBlocked ? <LockKeyhole size={14} /> : <Zap size={14} />}
            {analyzing ? 'Analyzing your store…' : analyzeBlocked ? 'Limit reached' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {usage.nearLimit && !usage.atLimit && (
        <div className="recs-banner warning"><AlertTriangle size={15} /><span><strong>{usage.remaining} recommendation{usage.remaining === 1 ? '' : 's'} left this month</strong> on your {plan ? PLAN_LABELS[plan] : ''} plan ({usage.label}).</span><button className="button secondary compact" onClick={onNavigateBilling}>View plans <ArrowUpRight size={13} /></button></div>
      )}
      {usage.atLimit && usage.limit !== null && (
        <div className="recs-banner blocked"><LockKeyhole size={15} /><span><strong>Monthly limit reached — {usage.label}.</strong> Your AI team found value {usage.limit} times this month. Upgrade to keep the recommendations coming.</span><button className="button primary compact" onClick={onNavigateBilling}>Upgrade plan <ArrowUpRight size={13} /></button></div>
      )}

      {phase === 'loading' ? <KpiSkeleton /> : summary && <KpiHero summary={summary} usage={usage} plan={plan} onUpgrade={onNavigateBilling} />}

      <div className="recs-body">
        <div className="recs-main">
          <div className="recs-toolbar">
            <div className="recs-tabs" role="tablist" aria-label="Recommendation status">
              {STATUS_TABS.map((tab) => (
                <button key={tab} role="tab" aria-selected={statusTab === tab} className={`recs-tab ${statusTab === tab ? 'active' : ''}`} onClick={() => { setStatusTab(tab); setSelected(new Set()) }}>
                  {statusTabLabel(tab)}
                  <span className="recs-tab-count">{statusTabCount(tab, counts)}</span>
                </button>
              ))}
            </div>
            <div className="recs-toolbar-row">
              <div className="recs-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recommendations…" aria-label="Search recommendations" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>}</div>
              <select className="recs-select" value={sortIndex} onChange={(event) => setSortIndex(Number(event.target.value))} aria-label="Sort recommendations">
                {SORT_OPTIONS.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
              </select>
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
              ? (usage.used > 0
                ? <AllClearState summary={summary} />
                : <FirstRunState onAnalyze={() => void runAnalysis()} analyzing={analyzing} onHow={() => setHowItWorksOpen(true)} />)
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
          {phase === 'loading' ? <SidebarSkeleton /> : summary && <InsightsSidebar summary={summary} onFilterAgent={(agent) => setAgentFilter(agent)} />}
        </aside>
      </div>

      {drawer && <EvidenceDrawer recommendation={drawer} storeId={storeId} onClose={closeDrawer} />}
      {confirm && confirm.kind === 'approve' && <ApproveConfirmSheet recommendation={confirm.recommendation} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void decide(confirm.recommendation, 'approve', null) }} />}
      {confirm && confirm.kind === 'reject' && <RejectReasonSheet recommendation={confirm.recommendation} onCancel={() => setConfirm(null)} onReject={(reason) => { setConfirm(null); void decide(confirm.recommendation, 'reject', reason) }} />}
      {undo && <UndoSnackbar undo={undo} onUndo={() => void performUndo()} onDismiss={() => setUndo(null)} />}
      {howItWorksOpen && <HowItWorksModal onClose={() => setHowItWorksOpen(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI hero
// ---------------------------------------------------------------------------

function KpiHero({ summary, usage, plan, onUpgrade }: { summary: RecommendationSummary; usage: ReturnType<typeof usageState>; plan: RecommendationSummary['plan']; onUpgrade: () => void }) {
  const approvalRate = summary.approvalRate.last30d ?? summary.approvalRate.allTime
  const trendUp = summary.approvalRate.last30d !== null && summary.approvalRate.allTime !== null && summary.approvalRate.last30d >= summary.approvalRate.allTime
  return (
    <div className="recs-kpis">
      <div className="recs-kpi">
        <span className="recs-kpi-label"><Gauge size={13} /> Pending impact</span>
        <strong className="recs-kpi-value accent">{formatCurrencyAmounts(summary.pendingImpact)}</strong>
        <small>{summary.counts.PENDING} pending decision{summary.counts.PENDING === 1 ? '' : 's'}</small>
      </div>
      <div className="recs-kpi">
        <span className="recs-kpi-label"><CheckCircle2 size={13} /> Approved this month</span>
        <strong className="recs-kpi-value">{summary.approvedThisMonth.count}</strong>
        <small>{summary.approvedThisMonth.impact.length > 0 ? `${formatCurrencyAmounts(summary.approvedThisMonth.impact)} modeled impact` : 'No approvals yet this month'}</small>
      </div>
      <div className="recs-kpi">
        <span className="recs-kpi-label"><TrendingUp size={13} /> Approval rate</span>
        <strong className="recs-kpi-value">{approvalRate === null ? '—' : `${approvalRate}%`}</strong>
        <small>{summary.approvalRate.last30d !== null ? <>last 30 days {summary.approvalRate.allTime !== null && <span className={trendUp ? 'trend-up' : 'trend-down'}>{trendUp ? '▲' : '▼'} vs all-time</span>}</> : approvalRate === null ? 'Decide recommendations to build this metric' : 'all-time'}</small>
      </div>
      <div className="recs-kpi">
        <span className="recs-kpi-label"><Clock3 size={13} /> Avg time to decide</span>
        <strong className="recs-kpi-value">{summary.averageDecisionMs === null ? '—' : formatDurationMs(summary.averageDecisionMs)}</strong>
        <small>{summary.averageDecisionMs === null ? 'Tracked from your first decision' : 'from creation to decision'}</small>
      </div>
      <div className="recs-kpi usage">
        <span className="recs-kpi-label"><WandSparkles size={13} /> Monthly usage</span>
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

function InsightsSidebar({ summary, onFilterAgent }: { summary: RecommendationSummary; onFilterAgent: (agent: AgentId) => void }) {
  const pendingByAgent = summary.byAgent.filter((entry) => entry.pending > 0)
  const donutData = pendingByAgent.map((entry) => ({ name: agentLabel(entry.agent), value: entry.pending, agent: entry.agent }))
  const totalPending = summary.counts.PENDING
  const trend = summary.generatedTrend
  const trendMax = trend.reduce((max, day) => Math.max(max, day.generated), 0)
  return (
    <>
      <div className="card recs-side-card">
        <div className="recs-side-title"><WandSparkles size={13} /> Pending by agent</div>
        {donutData.length > 0 ? (
          <>
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
            <div className="recs-donut-legend">
              {pendingByAgent.map((entry) => (
                <button key={entry.agent} onClick={() => onFilterAgent(entry.agent)}><i style={{ background: AGENT_COLORS[entry.agent] }} /> {agentLabel(entry.agent)} <strong>{entry.pending}</strong></button>
              ))}
            </div>
          </>
        ) : <p className="recs-side-empty">No pending recommendations right now.</p>}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><TrendingUp size={13} /> 30-day activity</div>
        {trend.length > 0 ? (
          <div className="recs-trend" aria-label="Recommendations generated per day, last 30 days">
            {trend.map((day) => (
              <span key={day.day} className="recs-trend-bar" title={`${day.day}: ${day.generated} generated, ${day.approved} approved`}>
                <i className="generated" style={{ height: `${trendMax > 0 ? Math.max(8, (day.generated / trendMax) * 100) : 8}%` }} />
                <i className="approved" style={{ height: `${trendMax > 0 ? (day.approved / trendMax) * 100 : 0}%` }} />
              </span>
            ))}
          </div>
        ) : <p className="recs-side-empty">Activity appears after your first analysis run.</p>}
        {trend.length > 0 && <div className="recs-trend-legend"><span><i className="generated" /> Generated</span><span><i className="approved" /> Approved</span></div>}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><Layers size={13} /> Top rules firing</div>
        {summary.byRule.length > 0 ? (
          <div className="recs-rule-list">
            {summary.byRule.slice(0, 5).map((entry) => (
              <div key={entry.ruleId} className="recs-rule-row" title={RULE_DESCRIPTIONS[entry.ruleId]}>
                <span>{ruleLabel(entry.ruleId)}</span>
                <strong>{entry.total}</strong>
              </div>
            ))}
          </div>
        ) : <p className="recs-side-empty">Rules report here once analysis runs.</p>}
      </div>

      <div className="card recs-side-card">
        <div className="recs-side-title"><Clock3 size={13} /> Recent decisions</div>
        {summary.recentDecisions.length > 0 ? (
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
        ) : <p className="recs-side-empty">Your decision history builds here.</p>}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Empty / loading / educational states
// ---------------------------------------------------------------------------

function FirstRunState({ onAnalyze, analyzing, onHow }: { onAnalyze: () => void; analyzing: boolean; onHow: () => void }) {
  return (
    <div className="recs-first-run">
      <div className="recs-first-hero">
        <span className="recs-first-orb"><WandSparkles size={26} /></span>
        <h2>Your AI team is ready to work</h2>
        <p>Run your first analysis and eight deterministic rules will comb your synced products, customers, checkouts, and orders for money-making decisions — each sealed with verifiable evidence.</p>
        <div className="recs-first-actions">
          <button className="button primary" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <RefreshCw size={14} className="spin" /> : <Zap size={14} />} {analyzing ? 'Analyzing…' : 'Run Analysis'}</button>
          <button className="button secondary" onClick={onHow}><Info size={14} /> How it works</button>
        </div>
      </div>
      <div className="recs-rule-grid">
        {(Object.keys(RULE_LABELS) as (keyof typeof RULE_LABELS)[]).map((ruleId) => (
          <div className="recs-rule-card" key={ruleId}>
            <strong>{RULE_LABELS[ruleId]}</strong>
            <p>{RULE_DESCRIPTIONS[ruleId]}</p>
          </div>
        ))}
      </div>
      <p className="recs-sample-note"><ShieldCheck size={13} /> ProfitPilot never invents a recommendation. If your store data doesn't trigger a rule, you'll see an honest all-clear — not filler.</p>
    </div>
  )
}

function AllClearState({ summary }: { summary: RecommendationSummary }) {
  return (
    <div className="recs-all-clear">
      <span className="recs-all-clear-icon"><CheckCircle2 size={24} /></span>
      <h2>All clear — no issues detected</h2>
      <p>Your last analysis ran all eight rules against your synced data and none crossed its threshold. That's a healthy store, not a missing feature.</p>
      <div className="recs-all-clear-rules">
        {(Object.keys(RULE_LABELS) as (keyof typeof RULE_LABELS)[]).map((ruleId) => (
          <span key={ruleId}><Check size={12} /> {RULE_LABELS[ruleId]}</span>
        ))}
      </div>
      {summary.usage.used !== null && summary.usage.used > 0 && <small>{summary.usage.used} recommendation{summary.usage.used === 1 ? '' : 's'} generated this month across earlier runs.</small>}
    </div>
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

export { RecommendationCard, EvidenceDrawer, FirstRunState, AllClearState, HowItWorksModal, KpiHero, InsightsSidebar, ApproveConfirmSheet, RejectReasonSheet, UndoSnackbar }
