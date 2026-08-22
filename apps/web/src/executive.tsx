/**
 * GrowthIQ (formerly "AI Executive") — "Intelligent growth for ambitious
 * merchants".
 *
 * GrowthIQ is its own sidebar page (same pattern as Insights Hub).
 * Deep-linkable sub-pages use hash routes:
 *
 *   /ai-growth-command/growthiq#/ai-growth-command/growthiq[/reports|/reports/:id|/benchmarks|
 *     /scenarios|/health|/opportunities|/decisions|/risks|/roadmaps|/settings]
 *
 * The legacy `#/ai-growth-command/executive` prefix keeps working (shared
 * links, bookmarks, emailed report links) and is normalized to the new
 * route on navigation.
 *
 * The dashboard is plan-aware: every locked section renders an aspirational
 * overlay whose CTA is always "Upgrade Plan" — never a plan name.
 */
import { Button } from './polaris-ui.js'
import './executive.css'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpRight, CalendarDays, Compass, Download, Eye, FileBarChart, Gauge, Lightbulb, ListChecks, Map, Settings, ShieldCheck } from './icons.js'
import type { PlanTier } from '@profitpilot/types'
import type { WorkspaceContext } from './model.js'
import type { ExecutiveDashboard, ExecutiveGate } from './executive-model.js'
import { executiveDateLabel, executiveMonthLabel, formatExecutiveMoney, formatExecutiveNumber } from './executive-model.js'
import { fetchExecutiveDashboard } from './executive-api.js'
import { executivePdfDownloadUrl } from './executive-api.js'
import { ExecutiveHorizontalBars, ExecutiveRadialGauge } from './executive-charts.js'
import {
  ExecutiveEmptyState,
  ExecutiveErrorState,
  ExecutiveSkeleton,
  ExecutiveStatusPill,
  ExecutiveUsageBar,
  GrowthIqBaselineState,
  GrowthIqPlanPanel,
  GrowthIqWelcomeState,
} from './executive-ui.js'
import {
  GrowthIqActionsPanel,
  GrowthIqDigestSection,
  GrowthIqImpactSection,
  GrowthIqInsightsSidebar,
  GrowthIqMilestonesSection,
  GrowthIqPositionSection,
  GrowthIqTrajectorySection,
} from './growthiq-sections.js'
import { growthBetween, growthMilestones, impactPreviews, projectTrajectory, strategicPosition, trailingWindows, weeklyDigest } from './growthiq-strategic.js'
import { GrowthIqMark, GrowthIqWordmark } from './growthiq-logo.js'
import { ExecutiveReportsPage } from './executive-reports.js'
import { ExecutiveBenchmarksPage } from './executive-benchmarks.js'
import { ExecutiveScenariosPage } from './executive-scenarios.js'
import { ExecutiveHealthPage } from './executive-health.js'
import { ExecutiveOpportunitiesPage } from './executive-opportunities.js'
import { ExecutiveDecisionsPage } from './executive-decisions.js'
import { ExecutiveRisksPage } from './executive-risks.js'
import { ExecutiveRoadmapsPage } from './executive-roadmaps.js'
import { ExecutiveSettingsPage } from './executive-settings.js'
import { errorMessageFrom } from './executive-shared.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'

const GROWTHIQ_ROUTE_PREFIX = '#/ai-growth-command/growthiq'
/** Legacy prefix from the "AI Executive" era — still deep-linkable. */
const LEGACY_EXECUTIVE_ROUTE_PREFIX = '#/ai-growth-command/executive'

/** Strategic-analysis baseline minimums (honest thresholds, not quotas). */
const BASELINE_MIN_ORDERS = 30
const BASELINE_MIN_DAYS = 60

// ────────────────────────────────────────────────────────────────────────────
// Strategic derivations (assembled once per dashboard payload)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Assembles every strategic-layer derivation from the real dashboard payload.
 * Pure functions only — the same math is unit-tested in
 * growthiq-strategic.test.ts, and anything not measurable surfaces as null.
 */
function strategicDerivations(dashboard: ExecutiveDashboard) {
  const revenue30 = trailingWindows(dashboard.revenueSeries, 30)
  const orders30 = trailingWindows(dashboard.ordersSeries, 30)
  const revenueGrowthPct = growthBetween(revenue30.current, revenue30.prior)
  const ordersGrowthPct = growthBetween(orders30.current, orders30.prior)
  const aov = orders30.current > 0 ? revenue30.current / orders30.current : null
  const aovDeltaPct = revenueGrowthPct !== null && ordersGrowthPct !== null ? ((1 + revenueGrowthPct / 100) / (1 + ordersGrowthPct / 100) - 1) * 100 : null
  const projection = projectTrajectory(dashboard.revenueSeries)
  const revenueMetric = dashboard.benchmarkPosition?.positions.find((entry) => entry.metric === 'REVENUE') ?? null
  const repeatMetric = dashboard.benchmarkPosition?.positions.find((entry) => entry.metric === 'REPEAT_PURCHASE') ?? null
  const position = strategicPosition({ revenuePercentile: revenueMetric?.percentile ?? null, growthRatePct: revenueGrowthPct })
  const milestones = growthMilestones({
    syncedOrders: dashboard.totals.syncedOrders,
    customers: dashboard.totals.customers,
    daysSynced: dashboard.totals.daysSynced,
    syncedRevenue: dashboard.totals.syncedRevenue,
    decisionsLogged: dashboard.decisions.length,
    hasReport: dashboard.latestReport !== null,
    hasDiagnosis: dashboard.health !== null,
    currency: dashboard.currency,
  })
  const digest = weeklyDigest({
    revenueSeries: dashboard.revenueSeries,
    ordersSeries: dashboard.ordersSeries,
    topProducts: dashboard.topProducts,
    opportunities: dashboard.opportunities,
    risks: dashboard.risks,
    repeatRatePct: repeatMetric?.yourValue ?? null,
    repeatMedianPct: repeatMetric?.industryMedian ?? null,
  })
  const impacts = impactPreviews({
    position: dashboard.benchmarkPosition,
    opportunities: dashboard.opportunities,
    orders30: orders30.current,
    currency: dashboard.currency,
    topProductSharePct: dashboard.topProducts[0]?.sharePct ?? null,
  })
  return { projection, position, milestones, digest, impacts, revenueGrowthPct, aov, aovDeltaPct, repeatMetric, daysSynced: dashboard.totals.daysSynced }
}

function healthStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null
  if (status === 'AT_RISK') return 'At risk'
  return status.slice(0, 1) + status.slice(1).toLowerCase()
}

export type GrowthIqWorkspaceProps = Readonly<{
  context: WorkspaceContext
  onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void
  onNavigateBilling: () => void
  onSync?: (module: string) => void
}>

/** New canonical name. */
export function GrowthIqPage(props: GrowthIqWorkspaceProps) {
  return <GrowthIqWorkspace {...props} />
}

/** @deprecated Use GrowthIqPage — kept so the workspace import keeps working. */
export const AiExecutivePage = GrowthIqPage
/** @deprecated AI Executive is its own sidebar page, now GrowthIQ. */
export const AiGrowthCommandPage = GrowthIqPage

/**
 * Resolves the current hash to a GrowthIQ SUB-route ('/', '/reports',
 * '/reports/:id', …). The legacy "AI Executive" prefix is normalized to the
 * new route so shared links, bookmarks, and emailed report links keep
 * working. (The pre-rebrand parser indexed the wrong segment, which made
 * sub-pages unreachable from deep links — the sub-route is now derived
 * directly from the prefix.)
 */
function parseGrowthIqRoute(hash: string): string {
  if (hash.startsWith(LEGACY_EXECUTIVE_ROUTE_PREFIX)) return hash.slice(LEGACY_EXECUTIVE_ROUTE_PREFIX.length) || '/'
  if (hash.startsWith(GROWTHIQ_ROUTE_PREFIX)) return hash.slice(GROWTHIQ_ROUTE_PREFIX.length) || '/'
  return '/'
}

function isGrowthIqHash(hash: string): boolean {
  return hash.startsWith(GROWTHIQ_ROUTE_PREFIX) || hash.startsWith(LEGACY_EXECUTIVE_ROUTE_PREFIX)
}

function GrowthIqWorkspace({ context, onToast, onNavigateBilling, onSync }: GrowthIqWorkspaceProps) {
  const [route, setRoute] = useState<string>(() => parseGrowthIqRoute(window.location.hash))
  const [dashboard, setDashboard] = useState<ExecutiveDashboard | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    if (!context.storeId) { setLoadState('error'); setError('Connect a Shopify store to open your strategy room.'); return }
    setError(null)
    try {
      const next = await fetchExecutiveDashboard(context.storeId)
      setDashboard(next)
      setLoadState('ready')
    } catch (err: unknown) {
      setError(errorMessageFrom(err))
      setLoadState('error')
    }
  }, [context.storeId])

  useEffect(() => { void loadDashboard() }, [loadDashboard])

  // Deep-link support: the GrowthIQ hash owns sub-route state, so shared
  // links and refreshes land on the right page; back/forward follows it.
  useEffect(() => {
    const onHash = () => setRoute(parseGrowthIqRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
    }
  }, [])

  // `route` is the SUB-route (e.g. '/reports' or '/reports/:id'); the full
  // hash is always prefix + sub-route so deep links and refreshes stay stable.
  const navigate = useCallback((subRoute: string) => {
    try { window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${GROWTHIQ_ROUTE_PREFIX}${subRoute}`) } catch { /* restricted history */ }
    setRoute(subRoute)
  }, [])

  const plan = dashboard?.plan ?? 'trial'
  const gates = dashboard?.gates ?? {}
  const onUpgrade = useCallback(() => onNavigateBilling(), [onNavigateBilling])

  const routeParts = route.split('/').filter(Boolean)
  const page = routeParts[0] ?? 'dashboard'
  const detailId = routeParts[1] ?? null

  const pageProps = { context, plan, gates, onToast, onUpgrade }

  let content: ReactNode
  if (loadState === 'loading') {
    content = <GrowthIqDashboardSkeleton />
  } else if (loadState === 'error') {
    content = (
      <div className="exec-page">
        <GrowthIqHeader plan={plan} onNavigate={navigate} onUpgrade={onUpgrade} />
        <ExecutiveErrorState message={error ?? 'Could not load your growth dashboard.'} onRetry={() => void loadDashboard()} />
      </div>
    )
  } else if (!dashboard) {
    content = <GrowthIqWelcomeState />
  } else if (page === 'reports') {
    content = <ExecutiveReportsPage {...pageProps} initialReportId={detailId === 'generate' ? null : detailId} autoGenerate={detailId === 'generate'} />
  } else if (page === 'benchmarks') {
    content = <ExecutiveBenchmarksPage {...pageProps} />
  } else if (page === 'scenarios') {
    content = <ExecutiveScenariosPage {...pageProps} />
  } else if (page === 'health') {
    content = <ExecutiveHealthPage {...pageProps} />
  } else if (page === 'opportunities') {
    content = <ExecutiveOpportunitiesPage {...pageProps} />
  } else if (page === 'decisions') {
    content = <ExecutiveDecisionsPage {...pageProps} autoCompose={detailId === 'new'} />
  } else if (page === 'risks') {
    content = <ExecutiveRisksPage {...pageProps} />
  } else if (page === 'roadmaps') {
    content = <ExecutiveRoadmapsPage {...pageProps} autoCompose={detailId === 'new'} />
  } else if (page === 'settings') {
    content = <ExecutiveSettingsPage {...pageProps} />
  } else {
    const daysSynced = dashboard.totals.daysSynced
    const ordersSynced = dashboard.totals.syncedOrders
    const noHistoryAtAll = daysSynced === 0 && ordersSynced === 0
    const insufficient = ordersSynced < BASELINE_MIN_ORDERS || daysSynced < BASELINE_MIN_DAYS
    content = noHistoryAtAll ? (
      <div className="exec-page">
        <GrowthIqHeader plan={plan} onNavigate={navigate} onUpgrade={onUpgrade} />
        <GrowthIqWelcomeState
          onExploreReports={() => navigate('/reports')}
          onSync={onSync ? () => onSync('orders') : undefined}
        />
        <GrowthIqStrategyStage dashboard={dashboard} plan={plan} onNavigate={navigate} onUpgrade={onUpgrade} />
        <section className="exec-section card span-12 gq-plan-wrap">
          <GrowthIqPlanPanel plan={plan} onUpgrade={onUpgrade} />
        </section>
      </div>
    ) : insufficient ? (
      <div className="exec-page">
        <GrowthIqHeader plan={plan} onNavigate={navigate} onUpgrade={onUpgrade} />
        <GrowthIqBaselineState
          readiness={{ hasStoreInfo: true, ordersSynced, daysSynced, minOrders: BASELINE_MIN_ORDERS, minDays: BASELINE_MIN_DAYS }}
          onLogDecision={() => navigate('/decisions/new')}
          onViewSample={() => navigate('/reports')}
          onSync={onSync ? () => onSync('orders') : undefined}
        />
        <GrowthIqStrategyStage dashboard={dashboard} plan={plan} onNavigate={navigate} onUpgrade={onUpgrade} />
        <section className="exec-section card span-12 gq-plan-wrap">
          <GrowthIqPlanPanel plan={plan} onUpgrade={onUpgrade} />
        </section>
      </div>
    ) : (
      <GrowthIqDashboardView dashboard={dashboard} onNavigate={navigate} onUpgrade={onUpgrade} onToast={onToast} />
    )
  }

  return content
}

// ────────────────────────────────────────────────────────────────────────────
// Module header
// ────────────────────────────────────────────────────────────────────────────

function GrowthIqHeader({ plan, onNavigate, onUpgrade }: { plan: PlanTier; onNavigate: (route: string) => void; onUpgrade: () => void }) {
  // Sub-routes are relative to the GrowthIQ prefix (navigate() prepends it).
  const base = ''
  return (
    <div className="gq-header">
      <div className="gq-header-left">
        <span className="gq-logo-tile"><GrowthIqMark size={40} /></span>
        <div className="gq-header-copy">
          <div className="gq-header-title">
            <h2>GrowthIQ</h2>
            <span className="exec-pill gold gq-command-badge"><i />AI Growth Command</span>
          </div>
          <p className="gq-tagline">Intelligent growth for ambitious merchants — strategy, benchmarks, scenarios, and board reports computed from your real store data.</p>
        </div>
      </div>
      <div className="exec-page-actions">
        <Button type="button" className="button secondary" onClick={() => onNavigate(`${base}/settings`)}><Settings size={14} /> Settings</Button>
        <Button type="button" className="button primary" onClick={() => onNavigate(`${base}/reports/generate`)}><FileBarChart size={14} /> Generate Report</Button>
        <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Strategy stage — the UNIQUE executive layer shown while the baseline fills
//
// Renders beneath the welcome/baseline hero so the page carries real
// strategic value at any data depth: trajectory projection, strategic
// position, impact previews, growth milestones, the weekly digest, the
// insights sidebar, and executive actions. Sections degrade to honest
// education whenever an input is not measurable — nothing is fabricated.
// ────────────────────────────────────────────────────────────────────────────

function GrowthIqStrategyStage({ dashboard, plan, onNavigate, onUpgrade }: { dashboard: ExecutiveDashboard; plan: PlanTier; onNavigate: (route: string) => void; onUpgrade: () => void }) {
  const d = strategicDerivations(dashboard)
  const canReadReports = dashboard.gates.reports?.allowed ?? false
  const weekIndex = Math.floor(Date.parse(dashboard.generatedAt) / 604_800_000)
  return (
    <div className="gq-strategy-layout">
      <div className="gq-strategy-main">
        <GrowthIqTrajectorySection
          projection={d.projection}
          currency={dashboard.currency}
          daysSynced={d.daysSynced}
          onNavigateReports={() => onNavigate('/reports')}
        />
        <GrowthIqPositionSection
          position={d.position}
          nextMilestone={d.milestones.active?.title ?? null}
          onNavigateBenchmarks={() => onNavigate('/benchmarks')}
        />
        <GrowthIqImpactSection previews={d.impacts} onNavigate={onNavigate} />
        <GrowthIqMilestonesSection result={d.milestones} onNavigateRoadmaps={() => onNavigate('/roadmaps')} />
        <GrowthIqDigestSection
          digest={d.digest}
          daysSynced={d.daysSynced}
          currency={dashboard.currency}
          plan={plan}
          canReadReports={canReadReports}
          onNavigateReports={() => onNavigate('/reports')}
          onUpgrade={onUpgrade}
        />
      </div>
      <div className="gq-strategy-aside">
        <GrowthIqInsightsSidebar
          metrics={{
            daysSynced: d.daysSynced,
            stage: d.milestones.stage,
            healthLabel: healthStatusLabel(dashboard.health?.overallStatus),
            nextFocus: d.digest?.focus?.title ?? d.position.focus,
            revenueGrowthPct: d.revenueGrowthPct,
            repeat: d.repeatMetric && d.repeatMetric.yourValue !== null && d.repeatMetric.industryMedian !== null
              ? { yours: d.repeatMetric.yourValue, median: d.repeatMetric.industryMedian }
              : null,
            aov: d.aov !== null ? { value: d.aov, deltaPct: d.aovDeltaPct } : null,
          }}
          currency={dashboard.currency}
          tipIndex={Number.isFinite(weekIndex) ? weekIndex : 0}
          onNavigateReports={() => onNavigate('/reports')}
        />
        <GrowthIqActionsPanel onNavigate={onNavigate} />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// GrowthIQ dashboard (9 sections + plan panel)
// ────────────────────────────────────────────────────────────────────────────

function GrowthIqDashboardView({ dashboard, onNavigate, onUpgrade, onToast }: { dashboard: ExecutiveDashboard; onNavigate: (route: string) => void; onUpgrade: () => void; onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void }) {
  const { plan, gates, usage } = dashboard
  const d = strategicDerivations(dashboard)
  // Sub-routes are relative to the GrowthIQ prefix (navigate() prepends it).
  const base = ''
  const gateFor = (feature: string): ExecutiveGate | undefined => gates[feature]
  const summary = dashboard.latestReport?.executiveSummary
  const health = dashboard.health
  const position = dashboard.benchmarkPosition
  const risks = dashboard.risks
  const roadmap = dashboard.roadmap
        const revenueValues = dashboard.revenueSeries.map((point) => point?.value ?? 0).filter((v) => Number.isFinite(v))
  const ordersValues = dashboard.ordersSeries.map((point) => point?.value ?? 0).filter((v) => Number.isFinite(v))
  const revenue30 = revenueValues.slice(-30).reduce((sum, value) => sum + value, 0)
  const revenuePrior30 = revenueValues.slice(-60, -30).reduce((sum, value) => sum + value, 0)
  const revenueGrowth = revenuePrior30 > 0 ? (revenue30 / revenuePrior30 - 1) * 100 : null
  const orders30 = ordersValues.slice(-30).reduce((sum, value) => sum + value, 0)
  const ordersPrior30 = ordersValues.slice(-60, -30).reduce((sum, value) => sum + value, 0)
  const ordersGrowth = ordersPrior30 > 0 ? (orders30 / ordersPrior30 - 1) * 100 : null
  const aov = orders30 > 0 ? revenue30 / orders30 : null

  return (
    <div className="exec-page">
      <GrowthIqHeader plan={plan} onNavigate={onNavigate} onUpgrade={onUpgrade} />

      <div className="exec-dashboard">
        {/* 1 — Executive summary */}
        <section className="exec-summary-hero span-12">
          <div>
            <div className="exec-kicker" style={{ color: 'rgb(167, 139, 250)' }}>Executive summary{dashboard.latestReport ? ` · ${executiveMonthLabel(dashboard.latestReport.periodStart)}` : ''}</div>
            <h2>{summary ?? (plan === 'trial' ? 'Your summary appears with your first board report.' : 'No board report yet — generate one to open your strategy room.')}</h2>
            <p>{summary
              ? `${summary.slice(0, 340)}${summary.length > 340 ? '…' : ''}`
              : 'The monthly board report synthesizes revenue trajectory, market position, key insights, recommended decisions, and a financial forecast — every number computed from your synced data, never invented.'}</p>
            <div className="exec-summary-meta">
              <span><CalendarDays size={12} /> Next report {dashboard.nextReportDue ? executiveDateLabel(dashboard.nextReportDue) : '—'}</span>
              <span><ShieldCheck size={12} />{plan === 'commander' ? 'Commander' : plan === 'growth' ? 'Growth' : plan === 'start' ? 'Start' : 'Trial'} plan</span>
              {dashboard.latestReport && <span><Gauge size={12} /> {dashboard.latestReport.content.aiNarrativeAvailable ? 'AI narrative grounded in store facts' : 'Deterministic analysis'}</span>}
            </div>
            <div className="gq-hero-metrics">
              <div className="gq-hero-metric"><strong>{formatExecutiveMoney(revenue30, dashboard.currency, 0)}{revenueGrowth !== null && Number.isFinite(revenueGrowth) && <DeltaTag value={revenueGrowth} />}</strong><span>Revenue · last 30 days</span></div>
              <div className="gq-hero-metric"><strong>{formatExecutiveNumber(orders30, 0)}{ordersGrowth !== null && Number.isFinite(ordersGrowth) && <DeltaTag value={ordersGrowth} />}</strong><span>Orders · last 30 days</span></div>
              <div className="gq-hero-metric"><strong>{aov === null || !Number.isFinite(aov) ? '—' : formatExecutiveMoney(aov, dashboard.currency)}</strong><span>Average order value</span></div>
              <div className="gq-hero-metric"><strong>{health ? <>{health.overallScore}<small> /100</small></> : '—'}</strong><span>Health score</span></div>
            </div>
          </div>
          <div className="exec-summary-actions">
            <Button type="button" className="button primary" onClick={() => onNavigate(`${base}/reports`)}>Read Full Report <ArrowUpRight size={14} /></Button>
            {gateFor('reports')?.allowed && plan !== 'trial' && (
              <Button type="button" className="button secondary" onClick={() => onNavigate(`${base}/reports`)}><FileBarChart size={14} /> Generate Report</Button>
            )}
          </div>
        </section>

        {/* Executive actions — strategic moves that work at any data depth */}
        <div className="span-12 gq-actions-wrap">
          <GrowthIqActionsPanel onNavigate={(route) => onNavigate(`${base}${route}`)} />
        </div>

        {/* 2 — Strategic health */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Vital signs</div><h3>Strategic Health</h3></div>
            <Button type="button" className="text-button" onClick={() => onNavigate(`${base}/health`)}>Full diagnosis <ArrowUpRight size={13} /></Button>
          </div>
          {health ? (
            <div className="exec-health-row">
              <ExecutiveRadialGauge score={health.overallScore} label={health.overallStatus} sublabel={`as of ${executiveDateLabel(health.diagnosedAt)}`} size={190} />
              <div className="exec-vitals-grid">
                {health.vitalSigns.slice(0, 6).map((vital) => (
                  <div className="exec-vital" key={vital.key}>
                    <div className="exec-vital-top"><strong>{vital.label}</strong><ExecutiveTrendArrow trend={vital.trend} /></div>
                    <span className="exec-vital-value">{vital.formattedValue}</span>
                    <ExecutiveStatusPill status={vital.status} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <ExecutiveEmptyState icon={Gauge} title="No diagnosis yet" description="Run the health check to score eight vital signs from your real store rows." action="Open health" onAction={() => onNavigate(`${base}/health`)} />
          )}
        </section>

        {/* 3 — Industry position */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Benchmarks</div><h3>Industry Position</h3></div>
            <Button type="button" className="text-button" onClick={() => onNavigate(`${base}/benchmarks`)}>All benchmarks <ArrowUpRight size={13} /></Button>
          </div>
          {position ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <span className="exec-pill gold"><i />{position.category}</span>
                <span className="exec-muted-note">{position.categorySource === 'AUTO_DETECTED' ? 'auto-detected from your catalog' : position.categorySource === 'PREFERENCE' ? 'from your settings' : 'default category'}</span>
              </div>
              <ExecutiveHorizontalBars rows={position.positions.slice(0, 4).map((metric) => ({
                label: metric.label,
                value: metric.percentile ?? 0,
                display: metric.percentile === null ? 'not measurable' : `${metric.percentile}th`,
                tone: metric.percentile !== null && metric.percentile >= 75 ? 'positive' : metric.percentile !== null && metric.percentile >= 40 ? 'gold' : 'danger',
              }))} />
              <p className="exec-muted-note" style={{ marginTop: 12 }}>Percentile rank vs curated public Shopify benchmarks. Missing values mean the metric is not measurable yet — never estimated.</p>
            </>
          ) : (
            <ExecutiveEmptyState icon={Gauge} title="Position not measured yet" description="Sync orders and customers to measure your percentile against the industry." action="Open benchmarks" onAction={() => onNavigate(`${base}/benchmarks`)} />
          )}
        </section>

        {/* 4 — Strategic opportunities */}
        <section className="exec-section span-4">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Growth</div><h3>Strategic Opportunities</h3></div>
            <Button type="button" className="text-button" onClick={() => onNavigate(`${base}/opportunities`)}>View all <ArrowUpRight size={13} /></Button>
          </div>
          {dashboard.opportunities.length === 0 ? (
            <ExecutiveEmptyState icon={Lightbulb} title="No opportunities yet" description="Analyze your business to identify growth moves with computed annual impact." action="Analyze now" onAction={() => onNavigate(`${base}/opportunities`)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dashboard.opportunities.slice(0, 3).map((opportunity) => (
                <Button key={opportunity.id} type="button" className="exec-scenario-template" onClick={() => onNavigate(`${base}/opportunities`)}>
                  <strong>{opportunity.title}</strong>
                  <span style={{ color: 'var(--exec-purple)', fontWeight: 700 }}>{formatExecutiveMoney(opportunity.estimatedImpactAnnual, opportunity.impactCurrency, 0)} / yr</span>
                  <span>{opportunity.effortLevel.toLowerCase()} effort · {opportunity.timeline.replace('_', ' ').toLowerCase()}</span>
                </Button>
              ))}
            </div>
          )}
        </section>

        {/* 5 — Risk radar */}
        <section className="exec-section span-4">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Early warning</div><h3>Risk Radar</h3></div>
            <Button type="button" className="text-button" onClick={() => onNavigate(`${base}/risks`)}>Open radar <ArrowUpRight size={13} /></Button>
          </div>
          {risks.length === 0 ? (
            <ExecutiveEmptyState icon={ShieldCheck} title="No significant risks detected" description="Your diversification currently sits inside healthy bands. Scans re-check this automatically." action="Run scan" onAction={() => onNavigate(`${base}/risks`)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((severity) => {
                  const count = risks.filter((risk) => risk.severity === severity).length
                  return <div key={severity} className={`exec-risk-count ${severity.toLowerCase()}`} style={{ flex: 1, padding: '10px 12px' }}><strong>{count}</strong><span>{severity.toLowerCase()}</span></div>
                })}
              </div>
              {risks.slice(0, 3).map((risk) => (
                <div key={risk.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 8, border: '1px solid var(--exec-border)', background: 'var(--exec-surface-2)' }}>
                  <ExecutiveStatusPill status={risk.severity} />
                  <span style={{ fontSize: 12, color: 'var(--exec-body)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{risk.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--exec-muted)', whiteSpace: 'nowrap' }}>{formatExecutiveMoney(risk.impactIfRealized, risk.impactCurrency, 0)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 6 — Business trajectory (real history + measured trend projection) */}
        <GrowthIqTrajectorySection
          projection={d.projection}
          currency={dashboard.currency}
          daysSynced={d.daysSynced}
          onNavigateReports={() => onNavigate(`${base}/reports`)}
          className="span-4"
        />

        {/* 7 — Scenarios */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">What-if</div><h3>Scenario Planning</h3></div>
            <Button type="button" className="button secondary" onClick={() => onNavigate(`${base}/scenarios`)}><Compass size={14} /> New Scenario</Button>
          </div>
          {dashboard.scenarios.length === 0 ? (
            <ExecutiveEmptyState icon={Compass} title="No scenarios yet" description="Model a price change, product launch, or marketing move against your real baseline." action="Create scenario" onAction={() => onNavigate(`${base}/scenarios`)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dashboard.scenarios.slice(0, 3).map((scenario) => (
                <Button key={scenario.id} type="button" className="exec-scenario-template" onClick={() => onNavigate(`${base}/scenarios`)}>
                  <strong>{scenario.title}</strong>
                  <span>{scenario.scenarioType} · {scenario.predictions.currency} {formatExecutiveMoney(Math.round(scenario.predictions.delta.monthlyRevenue ?? 0), null, 0)}/mo projected delta · {executiveDateLabel(scenario.createdAt)}</span>
                </Button>
              ))}
            </div>
          )}
        </section>

        {/* 8 — Roadmap */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Direction</div><h3>Strategic Roadmap</h3></div>
            <Button type="button" className="text-button" onClick={() => onNavigate(`${base}/roadmaps`)}>Full roadmap <ArrowUpRight size={13} /></Button>
          </div>
          {roadmap ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <strong style={{ fontFamily: 'var(--exec-sans)', fontSize: 15, fontWeight: 700, color: 'var(--exec-heading)' }}>{roadmap.title}</strong>
                  <div style={{ fontSize: 12.5, color: 'var(--exec-muted)', marginTop: 3 }}>{roadmap.milestones.filter((milestone) => milestone.status === 'COMPLETE').length} of {roadmap.milestones.length} milestones complete · {roadmap.periodStart} → {roadmap.periodEnd}</div>
                </div>
                <span className="exec-pill gold"><i />{Math.round(roadmap.currentProgress * 100)}%</span>
              </div>
              <div className="exec-roadmap-progress-track" style={{ background: 'var(--exec-grid)' }}><span style={{ display: 'block', height: '100%', width: `${Math.round(roadmap.currentProgress * 100)}%`, borderRadius: 5, background: 'var(--exec-gradient)' }} /></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {roadmap.milestones.slice(0, 3).map((milestone) => (
                  <div key={milestone.key} className="exec-history-spark">
                    <ExecutiveStatusPill status={milestone.status === 'COMPLETE' ? 'COMPLETE' : milestone.status === 'CURRENT' ? 'CURRENT' : 'PENDING'} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontFamily: 'var(--exec-sans)', fontSize: 12.5, color: 'var(--exec-heading)' }}>{milestone.title}</strong>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--exec-muted)' }}>{executiveDateLabel(milestone.dueDate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ExecutiveEmptyState icon={Map} title="No active roadmap" description="Generate a personalized 30/60/90-day plan from your business state." action="Generate roadmap" onAction={() => onNavigate(`${base}/roadmaps`)} />
          )}
        </section>

        {/* 9 — Decisions */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Accountability</div><h3>Recent Decisions</h3></div>
            <Button type="button" className="text-button" onClick={() => onNavigate(`${base}/decisions`)}>Decision log <ArrowUpRight size={13} /></Button>
          </div>
          {dashboard.decisions.length === 0 ? (
            <ExecutiveEmptyState icon={ListChecks} title="No decisions logged" description="Log strategic decisions and record real outcomes — accuracy grades follow automatically." action="Log a decision" onAction={() => onNavigate(`${base}/decisions`)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dashboard.decisions.slice(0, 3).map((decision) => (
                <div key={decision.id} className="exec-history-spark" style={{ alignItems: 'flex-start' }}>
                  <ExecutiveStatusPill status={decision.qualityRating} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontFamily: 'var(--exec-sans)', fontSize: 12.5, color: 'var(--exec-heading)' }}>{decision.title}</strong>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--exec-muted)' }}>{decision.decisionType} · {executiveDateLabel(decision.decisionDate)}{decision.accuracyScore !== null ? ` · ${Math.round(decision.accuracyScore * 100)}% accuracy` : ' · awaiting outcome'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 10 — Board report (with investor PDF on Commander) */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Boardroom</div><h3>Monthly Board Report</h3></div>
            <Button type="button" className="text-button" onClick={() => onNavigate(`${base}/reports`)}>All reports <ArrowUpRight size={13} /></Button>
          </div>
          {dashboard.latestReport ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span className="exec-empty-icon" style={{ width: 40, height: 40, borderRadius: 10, marginBottom: 0 }}><FileBarChart size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14, color: 'var(--exec-heading)', fontFamily: 'var(--exec-sans)', fontWeight: 700 }}>{executiveMonthLabel(dashboard.latestReport.periodStart)} board report</strong>
                  <p style={{ margin: '4px 0 8px', fontSize: 12.5, color: 'var(--exec-body)', lineHeight: 1.55 }}>Executive summary · strategic position · key insights · financial forecast · recommendations.</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button type="button" className="button secondary" onClick={() => onNavigate(`${base}/reports/${dashboard.latestReport!.id}`)}><Eye size={14} /> View Report</Button>
                    {plan === 'commander' && (
                      <a className="button secondary" href={executivePdfDownloadUrl(dashboard.latestReport!.id)}><Download size={14} /> Download PDF</a>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <ExecutiveEmptyState
              icon={FileBarChart}
              title="No board report yet"
              description="Generate your first board-ready report from your real store data — executive summary, forecast, and recommended decisions."
              action="Generate report"
              onAction={() => onNavigate(`${base}/reports`)}
            />
          )}
        </section>

        {/* 11 — Plan & usage */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Your plan</div><h3>GrowthIQ Features</h3></div>
            <Button type="button" className="text-button" onClick={() => onNavigate(`${base}/settings`)}>Preferences</Button>
          </div>
          <GrowthIqPlanPanel plan={plan} onUpgrade={onUpgrade} />
        </section>

        {/* 12 — Usage meters */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Plan allowance</div><h3>Executive Usage</h3></div>
          </div>
          <div className="exec-usage-panel">
            {usage.features.filter((entry) => entry.limit !== null || entry.used > 0).slice(0, 8).map((entry) => (
              <ExecutiveUsageBar key={entry.feature} label={entry.label} used={entry.used} limit={entry.limit} onUpgrade={onUpgrade} plan={plan} />
            ))}
          </div>
          <p className="exec-muted-note" style={{ marginTop: 12 }}>
            Limits are enforced server-side. At 80% you see warnings; at 100% the feature blocks with an upgrade path. Upgrade CTAs always read "Upgrade Plan".
          </p>
        </section>
      </div>
    </div>
  )
}

function DeltaTag({ value }: { value: number }) {
  const tone = value > 0.5 ? 'up' : value < -0.5 ? 'down' : 'flat'
  const arrow = value > 0.5 ? '↑' : value < -0.5 ? '↓' : '→'
  return <span className={`gq-delta ${tone}`}>{arrow} {Math.abs(value).toFixed(1)}%</span>
}

function ExecutiveTrendArrow({ trend }: { trend: string }) {
  const tone = trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'flat'
  return <span className={`exec-trend ${tone}`}>{trend === 'up' ? '↗' : trend === 'down' ? '↘' : trend === 'flat' ? '→' : '·'}</span>
}

function GrowthIqDashboardSkeleton() {
  return (
    <div className="exec-page" role="status" aria-label="GrowthIQ dashboard loading">
      <GrowthIqHeader plan="trial" onNavigate={() => undefined} onUpgrade={() => undefined} />
      <ExecutiveSkeleton rows={2} label="Executive summary" />
      <div className="exec-dashboard">
        <div className="span-6"><ExecutiveSkeleton rows={4} label="Health" /></div>
        <div className="span-6"><ExecutiveSkeleton rows={4} label="Benchmarks" /></div>
        <div className="span-4"><ExecutiveSkeleton rows={3} label="Opportunities" /></div>
        <div className="span-4"><ExecutiveSkeleton rows={3} label="Risks" /></div>
        <div className="span-4"><ExecutiveSkeleton rows={3} label="Trends" /></div>
      </div>
    </div>
  )
}

// Kept for deep-link helpers in the workspace.
export { isGrowthIqHash }
