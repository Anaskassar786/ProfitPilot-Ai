import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Box,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gauge,
  ListFilter,
  Loader2,
  LockKeyhole,
  Minus,
  MoreHorizontal,
  Package,
  Pause,
  Play,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import {
  ApiClientError,
  decideRecommendation,
  fetchAgentActivity,
  fetchAgentOverview,
  fetchAiCost,
  fetchRecommendations,
  fetchRuleCatalog,
  fetchStoreHealth,
  runAgent,
  runAllAgents,
  setAgentPaused,
} from './api.js'
import type { Recommendation, WorkspaceContext } from './model.js'
import { formatMoney } from './model.js'
import {
  IDLE_RUN_STATE,
  PLAN_LABELS,
  PLAN_PRICES,
  agentImpactSummary,
  agentStatusLabel,
  agentStatusTone,
  formatBudget,
  groupLockedByPlan,
  healthTrend,
  insightsToday,
  reduceRunAll,
  relativeTime,
  unlockedAgents,
} from './command-center-model.js'
import type { AgentActivityItem, AgentOverview, AgentOverviewEntry, CostSummaryView, PlanTier, RuleCatalogEntry, RunAllState, StoreHealthResult } from './command-center-model.js'

export const AGENT_ICONS: Readonly<Record<string, LucideIcon>> = {
  REVENUE_AGENT: TrendingUp,
  INVENTORY_AGENT: Box,
  CUSTOMER_AGENT: Users,
  PRICING_AGENT: Tag,
  CAMPAIGN_AGENT: Send,
  PRODUCT_AGENT: Package,
  EXECUTIVE_AGENT: Briefcase,
}

type ToastKind = 'success' | 'info' | 'warning' | 'error'
type DrawerTab = 'overview' | 'rules' | 'activity' | 'settings'

/* ── Workspace ────────────────────────────────────────────────────────── */

export function CommandCenterWorkspace({ context, onToast, onNavigate }: { context: WorkspaceContext; onToast: (message: string, kind?: ToastKind) => void; onNavigate: (page: string) => void }) {
  const [overview, setOverview] = useState<AgentOverview | null>(null)
  const [cost, setCost] = useState<CostSummaryView | null>(null)
  const [health, setHealth] = useState<StoreHealthResult | null>(null)
  const [rules, setRules] = useState<readonly RuleCatalogEntry[]>([])
  const [recent, setRecent] = useState<readonly Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drawerAgent, setDrawerAgent] = useState<AgentOverviewEntry | null>(null)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview')
  const [runState, setRunState] = useState<RunAllState>(IDLE_RUN_STATE)
  const [runningAgent, setRunningAgent] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!context.storeId) { setLoading(false); return }
    setLoadError(null)
    const storeId = context.storeId
    const [overviewResult, costResult, healthResult, rulesResult, recentResult] = await Promise.allSettled([
      fetchAgentOverview(storeId),
      fetchAiCost(storeId),
      fetchStoreHealth(storeId),
      fetchRuleCatalog(),
      fetchRecommendations(storeId),
    ])
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
    else setLoadError(overviewResult.reason instanceof Error ? overviewResult.reason.message : 'Agent statuses could not be loaded.')
    if (costResult.status === 'fulfilled') setCost(costResult.value)
    if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
    if (rulesResult.status === 'fulfilled') setRules(rulesResult.value)
    if (recentResult.status === 'fulfilled') setRecent(recentResult.value)
    setLoading(false)
  }, [context.storeId])

  useEffect(() => { setLoading(true); void load() }, [load])

  const upgrade = useCallback((plan: PlanTier) => {
    try { sessionStorage.setItem('pp-upgrade-target', plan) } catch { /* private mode */ }
    onNavigate('billing')
  }, [onNavigate])

  const runOne = useCallback(async (agent: AgentOverviewEntry) => {
    if (!context.storeId) { onToast('Connect Shopify before running agents.', 'info'); return }
    setRunningAgent(agent.id)
    try {
      const result = await runAgent(context.storeId, agent.id)
      onToast(result.recommendations.length > 0 ? `${agent.label} produced ${result.recommendations.length} insight${result.recommendations.length === 1 ? '' : 's'}${result.deduplicated > 0 ? ` (${result.deduplicated} refreshed)` : ''}.` : `${agent.label} ran — no new signals in the current evidence.`, 'success')
      void load()
    } catch (error: unknown) {
      onToast(runErrorMessage(error, agent), 'error')
    } finally { setRunningAgent(null) }
  }, [context.storeId, load, onToast])

  const runAll = useCallback(async () => {
    if (!context.storeId) { onToast('Connect Shopify before running agents.', 'info'); return }
    setRunState({ ...IDLE_RUN_STATE, running: true })
    try {
      await runAllAgents(context.storeId, (event) => setRunState((state) => reduceRunAll(state, event)))
      void load()
    } catch (error: unknown) {
      setRunState((state) => ({ ...state, running: false, error: error instanceof Error ? error.message : 'Run failed' }))
    }
  }, [context.storeId, load, onToast])

  const togglePause = useCallback(async (agent: AgentOverviewEntry) => {
    if (!context.storeId) return
    try {
      await setAgentPaused(context.storeId, agent.id, !agent.paused)
      onToast(`${agent.label} ${agent.paused ? 'resumed' : 'paused'}.`, 'success')
      void load()
    } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Could not update the agent.', 'error') }
  }, [context.storeId, load, onToast])

  const openDrawer = useCallback((agent: AgentOverviewEntry, tab: DrawerTab = 'overview') => { setDrawerAgent(agent); setDrawerTab(tab) }, [])

  if (!context.storeId) {
    return <CommandCenterEmpty title="Connect Shopify to activate your AI team" body="The Command Center reads live evidence from your synced store. Connect a store and the seven agents will report for duty — no demo data, ever." />
  }
  if (loading) return <CommandCenterSkeleton />

  const agents = overview?.agents ?? []
  const unlocked = unlockedAgents(agents)
  const lockedGroups = groupLockedByPlan(agents)

  return (
    <div className="cc-workspace">
      {loadError && (
        <div className="cc-error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{loadError}</span>
          <button className="cc-button ghost" onClick={() => { setLoading(true); void load() }}><RefreshCw size={14} /> Retry</button>
        </div>
      )}

      <CommandCenterHero health={health} cost={cost} recent={recent} overview={overview} />

      {(runState.running || runState.result || runState.error) && <RunAllBanner state={runState} onDismiss={() => setRunState(IDLE_RUN_STATE)} />}

      <section className="cc-section" aria-label="Your AI team">
        <div className="cc-section-header">
          <div>
            <h2>Your AI team</h2>
            <p>{overview ? `${unlocked.length} of ${overview.totalCount} agents unlocked on the ${PLAN_LABELS[overview.plan]} plan.` : 'Agents unlocked by your plan.'}</p>
          </div>
          <button className="cc-button primary" onClick={() => void runAll()} disabled={runState.running || unlocked.length === 0}>
            {runState.running ? <Loader2 size={15} className="cc-spin" /> : <Zap size={15} />}
            {runState.running ? 'Running…' : 'Run All Agents'}
          </button>
        </div>
        <div className="cc-agent-grid">
          {unlocked.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              activity={recent.filter((item) => item.agent === agent.id)}
              running={runningAgent === agent.id || (runState.running && runState.runnable.includes(agent.id))}
              onOpen={(tab) => openDrawer(agent, tab)}
              onRun={() => void runOne(agent)}
              onTogglePause={() => void togglePause(agent)}
            />
          ))}
        </div>
      </section>

      {lockedGroups.length > 0 && (
        <section className="cc-section" aria-label="Unlock more agents">
          <div className="cc-section-header">
            <div>
              <h2>Unlock more agents</h2>
              <p>Every plan upgrade adds specialists to your team — history and evidence carry over instantly.</p>
            </div>
          </div>
          {lockedGroups.map((group) => (
            <div key={group.plan} className="cc-locked-group">
              <div className="cc-locked-group-title">
                <LockKeyhole size={14} />
                <span>Available in {PLAN_LABELS[group.plan]}</span>
                {PLAN_PRICES[group.plan] && <em>{PLAN_PRICES[group.plan]}</em>}
              </div>
              <div className="cc-agent-grid">
                {group.agents.map((agent) => (
                  <LockedAgentCard key={agent.id} agent={agent} onUpgrade={() => upgrade(group.plan)} onLearnMore={() => openDrawer(agent, 'overview')} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <ActivityFeed recent={recent} agents={agents} onOpenAgent={(agentId) => { const agent = agents.find((item) => item.id === agentId); if (agent) openDrawer(agent, 'activity') }} />

      {drawerAgent && (
        <AgentDetailDrawer
          agent={drawerAgent}
          tab={drawerTab}
          onTab={setDrawerTab}
          storeId={context.storeId}
          rules={rules.filter((rule) => rule.agent === drawerAgent.id)}
          plan={overview?.plan ?? 'trial'}
          onClose={() => setDrawerAgent(null)}
          onRun={() => void runOne(drawerAgent)}
          onTogglePause={() => void togglePause(drawerAgent)}
          onUpgrade={() => upgrade(drawerAgent.requiredPlan)}
          onToast={onToast}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}

function runErrorMessage(error: unknown, agent: AgentOverviewEntry): string {
  if (error instanceof ApiClientError && error.status === 403) return `${agent.label} needs the ${PLAN_LABELS[agent.requiredPlan]} plan. Upgrade to unlock it.`
  if (error instanceof ApiClientError && error.status === 409) return `${agent.label} is paused. Resume it before running.`
  return error instanceof Error ? error.message : 'The agent run failed.'
}

/* ── Hero KPIs ────────────────────────────────────────────────────────── */

export function CommandCenterHero({ health, cost, recent, overview }: { health: StoreHealthResult | null; cost: CostSummaryView | null; recent: readonly Recommendation[]; overview: AgentOverview | null }) {
  const budget = formatBudget(cost)
  const trend = healthTrend(health)
  const today = insightsToday(recent)
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus
  return (
    <section className="cc-hero" aria-label="Live intelligence">
      <div className="cc-kpi">
        <div className="cc-kpi-top"><span className="cc-kpi-icon health"><Gauge size={18} /></span><span className={`cc-kpi-trend ${trend}`}><TrendIcon size={14} />{trend === 'flat' ? 'steady' : trend}</span></div>
        <strong>{health?.score ?? '—'}<small>{health?.score !== null && health !== null ? '/100' : ''}</small></strong>
        <span>Store health score</span>
      </div>
      <div className="cc-kpi">
        <div className="cc-kpi-top"><span className="cc-kpi-icon budget"><Activity size={18} /></span><span className="cc-kpi-note">{cost ? `${cost.calls} calls today` : 'no calls yet'}</span></div>
        <strong>{budget.spent}<small> of {budget.cap}</small></strong>
        <div className="cc-gauge" role="img" aria-label={`AI budget ${budget.percent}% used`}><i style={{ width: `${budget.percent}%` }} /></div>
        <span>AI budget today</span>
      </div>
      <div className="cc-kpi">
        <div className="cc-kpi-top"><span className="cc-kpi-icon insights"><WandSparkles size={18} /></span></div>
        <strong>{today}</strong>
        <span>Insights today</span>
      </div>
      <div className="cc-kpi">
        <div className="cc-kpi-top"><span className="cc-kpi-icon agents"><Bot size={18} /></span><span className="cc-kpi-note">{overview ? PLAN_LABELS[overview.plan] : ''} plan</span></div>
        <strong>{overview ? overview.unlockedCount : '—'}<small> of {overview?.totalCount ?? 7}</small></strong>
        <div className="cc-agent-dots" aria-hidden="true">{(overview?.agents ?? []).map((agent) => <i key={agent.id} className={agent.locked ? 'locked' : 'active'} />)}</div>
        <span>Active agents</span>
      </div>
    </section>
  )
}

/* ── Agent cards ──────────────────────────────────────────────────────── */

export function AgentCard({ agent, activity, running, onOpen, onRun, onTogglePause }: { agent: AgentOverviewEntry; activity: readonly Recommendation[]; running: boolean; onOpen: (tab: DrawerTab) => void; onRun: () => void; onTogglePause: () => void }) {
  const Icon = AGENT_ICONS[agent.id] ?? Bot
  const tone = agentStatusTone(agent)
  const summary = agentImpactSummary(activity)
  const todayCount = insightsToday(activity)
  const confidence = summary.averageConfidence
  return (
    <article className={`cc-agent-card ${tone} ${running ? 'is-running' : ''}`}>
      <div className="cc-agent-card-top">
        <button type="button" className={`cc-agent-icon ${tone}`} onClick={() => onOpen('overview')} aria-label={`Open ${agent.label} details`}><Icon size={20} /></button>
        <span className={`cc-status-pill ${tone}`}><i />{running ? 'Running' : agentStatusLabel(agent)}</span>
        <AgentMenu
          items={[
            { label: agent.paused ? 'Resume agent' : 'Pause agent', icon: agent.paused ? Play : Pause, onSelect: onTogglePause },
            { label: 'View rules', icon: ListFilter, onSelect: () => onOpen('rules') },
            { label: 'View activity log', icon: Clock3, onSelect: () => onOpen('activity') },
            { label: 'Agent settings', icon: Settings2, onSelect: () => onOpen('settings') },
          ]}
          label={`${agent.label} actions`}
        />
      </div>
      <button type="button" className="cc-agent-title" onClick={() => onOpen('overview')}>
        <h3>{agent.label}</h3>
        <span className="cc-agent-version">v{agent.promptVersion}</span>
      </button>
      <p className="cc-agent-tagline">{agent.tagline}</p>
      <div className="cc-agent-stats">
        <div><strong>{todayCount}</strong><span>insights today</span></div>
        <div><strong>{summary.count > 0 ? formatMoney(summary.totalImpact, summary.currency) : '—'}</strong><span>impact tracked</span></div>
        <div><strong>{summary.lastRunAt ? relativeTime(summary.lastRunAt) : 'never'}</strong><span>last insight</span></div>
      </div>
      {confidence !== null && (
        <div className="cc-confidence" aria-label={`Average confidence ${confidence}%`}>
          <span>Confidence</span>
          <div className="cc-confidence-bar"><i style={{ width: `${confidence}%` }} /></div>
          <em>{confidence}%</em>
        </div>
      )}
      <div className="cc-agent-actions">
        <button type="button" className="cc-button secondary" onClick={() => onOpen('overview')}>View details</button>
        <button type="button" className="cc-button primary" onClick={onRun} disabled={running || agent.paused}>
          {running ? <Loader2 size={14} className="cc-spin" /> : <Play size={14} />}
          {running ? 'Running…' : 'Run now'}
        </button>
      </div>
    </article>
  )
}

export function LockedAgentCard({ agent, onUpgrade, onLearnMore }: { agent: AgentOverviewEntry; onUpgrade: () => void; onLearnMore: () => void }) {
  const Icon = AGENT_ICONS[agent.id] ?? Bot
  const planLabel = PLAN_LABELS[agent.requiredPlan]
  const price = PLAN_PRICES[agent.requiredPlan]
  return (
    <article className="cc-agent-card locked">
      <div className="cc-agent-card-top">
        <span className="cc-agent-icon dimmed"><Icon size={20} /></span>
        <span className="cc-plan-badge"><LockKeyhole size={12} /> Requires {planLabel}</span>
        <AgentMenu
          items={[
            { label: 'Learn more', icon: Sparkles, onSelect: onLearnMore },
            { label: `Upgrade to ${planLabel}`, icon: ArrowUpRight, onSelect: onUpgrade },
          ]}
          label={`${agent.label} actions`}
        />
      </div>
      <div className="cc-agent-title as-text">
        <h3>{agent.label}</h3>
      </div>
      <p className="cc-agent-tagline">{agent.tagline}</p>
      <blockquote className="cc-sample-insight"><Sparkles size={13} /><span>“{agent.sampleInsight}”</span></blockquote>
      <div className="cc-agent-actions">
        <button type="button" className="cc-button upgrade" onClick={onUpgrade}>
          <Zap size={14} /> Upgrade to {planLabel}{price ? ` · ${price}` : ''}
        </button>
      </div>
    </article>
  )
}

/* ── 3-dot menu ───────────────────────────────────────────────────────── */

export function AgentMenu({ items, label }: { items: readonly Readonly<{ label: string; icon: LucideIcon; onSelect: () => void }>[]; label: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDocumentClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocumentClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocumentClick); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="cc-menu" ref={rootRef}>
      <button type="button" className="cc-menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className="cc-menu-list" role="menu">
          {items.map((item) => {
            const ItemIcon = item.icon
            return <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.onSelect() }}><ItemIcon size={14} /> {item.label}</button>
          })}
        </div>
      )}
    </div>
  )
}

/* ── Run-all progress ─────────────────────────────────────────────────── */

export function RunAllBanner({ state, onDismiss }: { state: RunAllState; onDismiss: () => void }) {
  const percent = state.total > 0 ? Math.round((state.completed / state.total) * 100) : state.running ? 8 : 100
  return (
    <section className={`cc-run-banner ${state.error ? 'has-error' : state.result ? 'is-done' : ''}`} aria-live="polite">
      <div className="cc-run-banner-main">
        {state.running ? <Loader2 size={16} className="cc-spin" /> : state.error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
        <div>
          <strong>
            {state.running && (state.total > 0 ? `Analyzing ${state.completed}/${state.total} signals…` : 'Preparing evidence and dispatching agents…')}
            {!state.running && state.result && `Run complete: ${state.result.recommendations} insight${state.result.recommendations === 1 ? '' : 's'}${state.result.deduplicated > 0 ? `, ${state.result.deduplicated} refreshed` : ''}${state.result.cacheHits > 0 ? `, ${state.result.cacheHits} cache hits` : ''}.`}
            {!state.running && state.error && `Run failed: ${state.error}`}
          </strong>
          {state.skipped.length > 0 && <small>Skipped: {state.skipped.map((item) => `${prettyAgent(item.agent)} (${item.reason.toLowerCase()})`).join(', ')}</small>}
          {state.running && state.lastAgent && <small>Currently working: {prettyAgent(state.lastAgent)}</small>}
        </div>
      </div>
      <div className="cc-run-progress"><i style={{ width: `${percent}%` }} /></div>
      {!state.running && <button type="button" className="cc-menu-trigger" aria-label="Dismiss run status" onClick={onDismiss}><X size={15} /></button>}
    </section>
  )
}

function prettyAgent(id: string): string {
  return id.split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' ')
}

/* ── Activity feed ────────────────────────────────────────────────────── */

export function ActivityFeed({ recent, agents, onOpenAgent }: { recent: readonly Recommendation[]; agents: readonly AgentOverviewEntry[]; onOpenAgent: (agentId: string) => void }) {
  const items = recent.slice(0, 15)
  return (
    <section className="cc-section" aria-label="Recent agent activity">
      <div className="cc-section-header">
        <div>
          <h2>Activity feed</h2>
          <p>The latest evidence-backed events from your AI team.</p>
        </div>
      </div>
      <div className="cc-feed">
        {items.length === 0 && (
          <div className="cc-feed-empty">
            <ShieldCheck size={20} />
            <strong>No agent activity yet</strong>
            <span>Run your agents to generate the first evidence-backed insights. Nothing here is ever invented.</span>
          </div>
        )}
        {items.map((item) => {
          const agent = agents.find((entry) => entry.id === item.agent)
          return (
            <button type="button" key={item.id} className="cc-feed-row" onClick={() => onOpenAgent(item.agent)}>
              <span className={`cc-feed-dot ${item.agent.toLowerCase()}`} aria-hidden="true" />
              <span className="cc-feed-agent">{agent?.label ?? prettyAgent(item.agent)}</span>
              <span className="cc-feed-title">{item.title}</span>
              <span className={`cc-feed-status ${item.status.toLowerCase()}`}>{item.status}</span>
              <span className="cc-feed-time">{relativeTime(item.createdAt)}</span>
              <ChevronRight size={14} className="cc-feed-chevron" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* ── Detail drawer ────────────────────────────────────────────────────── */

export function AgentDetailDrawer({ agent, tab, onTab, storeId, rules, plan, onClose, onRun, onTogglePause, onUpgrade, onToast, onChanged }: {
  agent: AgentOverviewEntry
  tab: DrawerTab
  onTab: (tab: DrawerTab) => void
  storeId: string
  rules: readonly RuleCatalogEntry[]
  plan: PlanTier
  onClose: () => void
  onRun: () => void
  onTogglePause: () => void
  onUpgrade: () => void
  onToast: (message: string, kind?: ToastKind) => void
  onChanged: () => void
}) {
  const [activity, setActivity] = useState<readonly AgentActivityItem[] | null>(null)
  const Icon = AGENT_ICONS[agent.id] ?? Bot
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setActivity(null)
    fetchAgentActivity(storeId, agent.id).then((items) => { if (!cancelled) setActivity(items) }).catch(() => { if (!cancelled) setActivity([]) })
    return () => { cancelled = true }
  }, [storeId, agent.id])

  const summary = useMemo(() => agentImpactSummary(activity ?? []), [activity])

  const decideInline = async (item: AgentActivityItem, decision: 'approve' | 'reject') => {
    try {
      await decideRecommendation(storeId, item.id, item.version, decision)
      onToast(`Recommendation ${decision === 'approve' ? 'approved' : 'rejected'}.`, 'success')
      setActivity((current) => current?.map((entry) => entry.id === item.id ? { ...entry, status: decision === 'approve' ? 'APPROVED' : 'REJECTED', version: entry.version + 1 } : entry) ?? null)
      onChanged()
    } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Decision failed — reload and retry.', 'error') }
  }

  return (
    <div className="cc-drawer-root" role="dialog" aria-modal="true" aria-label={`${agent.label} details`}>
      <div className="cc-drawer-backdrop" onClick={onClose} />
      <aside className="cc-drawer">
        <header className="cc-drawer-header">
          <span className={`cc-agent-icon ${agent.locked ? 'dimmed' : agentStatusTone(agent)}`}><Icon size={22} /></span>
          <div>
            <h2>{agent.label}</h2>
            <p>{agent.tagline}</p>
          </div>
          <button ref={closeRef} type="button" className="cc-menu-trigger" aria-label="Close details" onClick={onClose}><X size={17} /></button>
        </header>

        {agent.locked ? (
          <div className="cc-drawer-locked">
            <LockKeyhole size={22} />
            <strong>Unlocks with the {PLAN_LABELS[agent.requiredPlan]} plan{PLAN_PRICES[agent.requiredPlan] ? ` · ${PLAN_PRICES[agent.requiredPlan]}` : ''}</strong>
            <blockquote>“{agent.sampleInsight}”</blockquote>
            <div className="cc-drawer-locked-rules">
              <h3>Rules this agent will run for you</h3>
              {rules.map((rule) => <div key={rule.id} className="cc-rule-row"><strong>{rule.name}</strong><span>{rule.purpose}</span></div>)}
            </div>
            <button type="button" className="cc-button upgrade" onClick={onUpgrade}><Zap size={14} /> Upgrade to {PLAN_LABELS[agent.requiredPlan]}</button>
          </div>
        ) : (
          <>
            <nav className="cc-drawer-tabs" role="tablist" aria-label="Agent detail sections">
              {(['overview', 'rules', 'activity', 'settings'] as const).map((key) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => onTab(key)}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </button>
              ))}
            </nav>

            {tab === 'overview' && (
              <div className="cc-drawer-body">
                <div className="cc-drawer-stats">
                  <div><strong>{summary.count}</strong><span>recent insights</span></div>
                  <div><strong>{summary.approvalRate === null ? '—' : `${summary.approvalRate}%`}</strong><span>approval rate</span></div>
                  <div><strong>{summary.count > 0 ? formatMoney(summary.totalImpact, summary.currency) : '—'}</strong><span>impact tracked</span></div>
                  <div><strong>{summary.averageConfidence === null ? '—' : `${summary.averageConfidence}%`}</strong><span>avg confidence</span></div>
                </div>
                <div className="cc-drawer-meta">
                  <span><ShieldCheck size={13} /> Read-only · language never supplies numbers</span>
                  <span><Clock3 size={13} /> Last insight {summary.lastRunAt ? relativeTime(summary.lastRunAt) : 'never'}</span>
                  <span><Tag size={13} /> Prompt v{agent.promptVersion}</span>
                </div>
                <button type="button" className="cc-button primary full" onClick={onRun} disabled={agent.paused}><Play size={14} /> Run {agent.label} now</button>
                {agent.paused && <p className="cc-drawer-note">This agent is paused. Resume it from Settings to run analyses.</p>}
              </div>
            )}

            {tab === 'rules' && (
              <div className="cc-drawer-body">
                {rules.length === 0 && <p className="cc-drawer-note">No deterministic rules are routed to this agent yet.</p>}
                {rules.map((rule) => (
                  <div key={rule.id} className="cc-rule-row detailed">
                    <div className="cc-rule-row-top"><strong>{rule.name}</strong><code>{rule.id}</code></div>
                    <span>{rule.purpose}</span>
                    <div className="cc-rule-facts">
                      <em>Threshold: {rule.threshold}</em>
                      <em>Impact: {rule.impact}</em>
                    </div>
                    <small>Inputs: {rule.inputs.join(' · ')}</small>
                  </div>
                ))}
              </div>
            )}

            {tab === 'activity' && (
              <div className="cc-drawer-body">
                {activity === null && <div className="cc-drawer-loading"><Loader2 size={16} className="cc-spin" /> Loading activity…</div>}
                {activity !== null && activity.length === 0 && <p className="cc-drawer-note">No recommendations from this agent yet. Run it to generate the first ones.</p>}
                {(activity ?? []).slice(0, 10).map((item) => (
                  <div key={item.id} className="cc-activity-item">
                    <div className="cc-activity-item-top">
                      <strong>{item.title}</strong>
                      <span className={`cc-feed-status ${item.status.toLowerCase()}`}>{item.status}</span>
                    </div>
                    <span>{item.reason}</span>
                    <div className="cc-activity-item-bottom">
                      <em>{formatMoney(item.impactValue, item.currency)} {item.impactLabel}</em>
                      <em>{relativeTime(item.createdAt)}</em>
                      {item.status === 'PENDING' && (
                        <span className="cc-activity-actions">
                          <button type="button" className="cc-button reject" onClick={() => void decideInline(item, 'reject')}>Reject</button>
                          <button type="button" className="cc-button approve" onClick={() => void decideInline(item, 'approve')}><Check size={13} /> Approve</button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'settings' && (
              <div className="cc-drawer-body">
                <div className="cc-setting-row">
                  <div>
                    <strong>Agent status</strong>
                    <span>{agent.paused ? 'Paused — this agent is skipped by Run All and cannot run.' : 'Active — this agent runs on demand and with Run All.'}</span>
                  </div>
                  <button type="button" className="cc-button secondary" onClick={onTogglePause}>{agent.paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}</button>
                </div>
                <div className="cc-setting-row">
                  <div>
                    <strong>Prompt version</strong>
                    <span>v{agent.promptVersion} · language-only, read-only, evidence-grounded.</span>
                  </div>
                </div>
                <div className="cc-setting-row">
                  <div>
                    <strong>Plan</strong>
                    <span>Included in your {PLAN_LABELS[plan]} plan.</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

/* ── Loading / empty states ───────────────────────────────────────────── */

export function CommandCenterSkeleton() {
  return (
    <div className="cc-workspace" aria-busy="true" aria-label="Loading AI Command Center">
      <div className="cc-hero">{[0, 1, 2, 3].map((index) => <div key={index} className="cc-kpi cc-skeleton" />)}</div>
      <div className="cc-agent-grid">{[0, 1, 2, 3, 4, 5, 6].map((index) => <div key={index} className="cc-agent-card cc-skeleton" />)}</div>
    </div>
  )
}

export function CommandCenterEmpty({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="cc-empty">
      <span className="cc-empty-orb"><Bot size={26} /></span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}
