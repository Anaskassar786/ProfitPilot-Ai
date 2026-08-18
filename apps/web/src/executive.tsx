/**
 * PR #49 — AI Executive: "Your Boardroom in a Box".
 *
 * The AI Growth Command page hosts three tabs — Store Coach (coming soon),
 * AI Executive (this module), and Insights Hub (coming soon, PR #50). The
 * AI Executive tab renders the CEO dashboard and deep-linkable sub-pages
 * through hash routes:
 *
 *   #/ai-growth-command/executive[/reports|/reports/:id|/benchmarks|
 *     /scenarios|/health|/opportunities|/decisions|/risks|/roadmaps|/settings]
 *
 * The dashboard is plan-aware: every locked section renders an aspirational
 * overlay whose CTA is always "Upgrade Plan" — never a plan name.
 */
import './executive.css'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpRight, CalendarDays, Compass, FileBarChart, Gauge, Landmark, Lightbulb, LineChart, ListChecks, Map, ShieldCheck } from 'lucide-react'
import type { WorkspaceContext } from './model.js'
import type { ExecutiveDashboard, ExecutiveGate, ExecutiveUsage } from './executive-model.js'
import { EXECUTIVE_FEATURE_NAMES, executiveDateLabel, executiveMonthLabel, formatExecutiveMoney } from './executive-model.js'
import { fetchExecutiveDashboard } from './executive-api.js'
import { ExecutiveAreaChart, ExecutiveHorizontalBars, ExecutiveRadialGauge, ExecutiveSparkline, ExecutiveTrendArrow } from './executive-charts.js'
import { ComingSoonPanel, ExecutiveEmptyState, ExecutiveErrorState, ExecutiveSkeleton, ExecutiveStatusPill, GrowthCommandTabs, ExecutiveUsageBar } from './executive-ui.js'
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

const EXECUTIVE_ROUTE_PREFIX = '#/ai-growth-command/executive'

export type ExecutiveWorkspaceProps = Readonly<{
  context: WorkspaceContext
  onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void
  onNavigateBilling: () => void
}>

export function AiGrowthCommandPage({ context, onToast, onNavigateBilling }: ExecutiveWorkspaceProps) {
  const [tab, setTab] = useState<'store-coach' | 'executive' | 'insights'>(() => (window.location.hash.startsWith(EXECUTIVE_ROUTE_PREFIX) ? 'executive' : 'executive'))
  const navigateTab = (next: 'store-coach' | 'executive' | 'insights') => {
    setTab(next)
    if (next === 'executive' && !window.location.hash.startsWith(EXECUTIVE_ROUTE_PREFIX)) {
      try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${EXECUTIVE_ROUTE_PREFIX}`) } catch { /* embedded browsers may restrict history */ }
    }
  }
  return (
    <div className="exec-page">
      <GrowthCommandTabs active={tab} onNavigate={navigateTab} />
      {tab === 'store-coach' && <ComingSoonPanel title="Store Coach" description="Daily tactical coaching for your store operations — personal, actionable guidance arriving in a future release." />}
      {tab === 'insights' && <ComingSoonPanel title="Insights Hub" description="The cross-module intelligence library is on the roadmap as PR #50. AI Executive and Store Coach will feed it automatically." />}
      {tab === 'executive' && <ExecutiveWorkspace context={context} onToast={onToast} onNavigateBilling={onNavigateBilling} />}
    </div>
  )
}

function ExecutiveWorkspace({ context, onToast, onNavigateBilling }: ExecutiveWorkspaceProps) {
  const [route, setRoute] = useState<string>(() => parseExecutiveRoute(window.location.hash))
  const [dashboard, setDashboard] = useState<ExecutiveDashboard | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    if (!context.storeId) { setLoadState('error'); setError('Connect a Shopify store to open the boardroom.'); return }
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

  // Deep-link support: the executive hash owns sub-route state, so shared
  // links and refreshes land on the right page; back/forward follows it.
  useEffect(() => {
    const onHash = () => setRoute(parseExecutiveRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
    }
  }, [])

  const navigate = useCallback((nextRoute: string) => {
    try { window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${nextRoute}`) } catch { /* restricted history */ }
    setRoute(nextRoute)
  }, [])

  const plan = dashboard?.plan ?? 'trial'
  const gates = dashboard?.gates ?? {}
  const onUpgrade = useCallback(() => onNavigateBilling(), [onNavigateBilling])

  const routeParts = route.split('/').filter(Boolean)
  const page = routeParts[1] ?? 'dashboard'
  const detailId = routeParts[2] ?? null

  const pageProps = { context, plan, gates, onToast, onUpgrade }

  let content: ReactNode
  if (loadState === 'loading') {
    content = <ExecutiveDashboardSkeleton />
  } else if (loadState === 'error') {
    content = (
      <div className="exec-page">
        <ExecutiveErrorState message={error ?? 'Could not load the executive dashboard.'} onRetry={() => void loadDashboard()} />
      </div>
    )
  } else if (!dashboard) {
    content = <ExecutiveEmptyState icon={Landmark} title="No dashboard data" description="Connect a Shopify store to open your boardroom." />
  } else if (page === 'reports') {
    content = <ExecutiveReportsPage {...pageProps} initialReportId={detailId} />
  } else if (page === 'benchmarks') {
    content = <ExecutiveBenchmarksPage {...pageProps} />
  } else if (page === 'scenarios') {
    content = <ExecutiveScenariosPage {...pageProps} />
  } else if (page === 'health') {
    content = <ExecutiveHealthPage {...pageProps} />
  } else if (page === 'opportunities') {
    content = <ExecutiveOpportunitiesPage {...pageProps} />
  } else if (page === 'decisions') {
    content = <ExecutiveDecisionsPage {...pageProps} />
  } else if (page === 'risks') {
    content = <ExecutiveRisksPage {...pageProps} />
  } else if (page === 'roadmaps') {
    content = <ExecutiveRoadmapsPage {...pageProps} />
  } else if (page === 'settings') {
    content = <ExecutiveSettingsPage {...pageProps} />
  } else {
    content = <ExecutiveDashboardView dashboard={dashboard} onNavigate={navigate} onUpgrade={onUpgrade} onToast={onToast} />
  }

  return content
}

function parseExecutiveRoute(hash: string): string {
  if (hash.startsWith(EXECUTIVE_ROUTE_PREFIX)) return hash.slice(1)
  return `${EXECUTIVE_ROUTE_PREFIX.slice(1)}`
}

// ────────────────────────────────────────────────────────────────────────────
// CEO Dashboard (9 sections)
// ────────────────────────────────────────────────────────────────────────────

function ExecutiveDashboardView({ dashboard, onNavigate, onUpgrade, onToast }: { dashboard: ExecutiveDashboard; onNavigate: (route: string) => void; onUpgrade: () => void; onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void }) {
  const { plan, gates, usage } = dashboard
  const gateFor = (feature: string): ExecutiveGate | undefined => gates[feature]
  const summary = dashboard.latestReport?.executiveSummary
  const health = dashboard.health
  const position = dashboard.benchmarkPosition
  const risks = dashboard.risks
  const roadmap = dashboard.roadmap
  const revenueValues = dashboard.revenueSeries.map((point) => point.value)
  const ordersValues = dashboard.ordersSeries.map((point) => point.value)
  const revenueTotal = dashboard.revenueSeries.reduce((sum, point) => sum + point.value, 0)
  const ordersTotal = dashboard.ordersSeries.reduce((sum, point) => sum + point.value, 0)

  return (
    <div className="exec-page">
      <div className="exec-page-header">
        <div>
          <div className="exec-kicker">AI Growth Command · Strategic intelligence</div>
          <h2>AI Executive</h2>
          <p>Your boardroom in a box — strategic decisions, benchmarks, scenarios, risks, and roadmaps computed from your real store data.</p>
        </div>
        <div className="exec-page-actions">
          <button type="button" className="button secondary" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/settings`)}>Settings</button>
          {gateFor('reports')?.allowed && <button type="button" className="button primary" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/reports`)}><FileBarChart size={14} /> Generate Report</button>}
          <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
        </div>
      </div>

      <div className="exec-dashboard">
        {/* 1 — Executive summary card */}
        <section className="exec-summary-hero span-12">
          <div>
            <div className="exec-kicker" style={{ color: '#C9A227' }}>Executive summary {dashboard.latestReport ? `· ${executiveMonthLabel(dashboard.latestReport.periodStart)}` : ''}</div>
            <h2>{summary ?? (plan === 'trial' ? 'Sample preview — your summary appears after you choose a plan.' : 'No board report yet — generate one to open the boardroom view.')}</h2>
            <p>{summary
              ? `${summary.slice(0, 320)}${summary.length > 320 ? '…' : ''}`
              : 'The monthly board report synthesizes revenue trajectory, market position, key insights, recommended decisions, and a financial forecast — every number computed from your synced data.'}</p>
            <div className="exec-summary-meta">
              <span><CalendarDays size={12} /> Next report {dashboard.nextReportDue ? executiveDateLabel(dashboard.nextReportDue) : '—'}</span>
              <span><Landmark size={12} /> {plan === 'commander' ? 'Commander' : plan === 'growth' ? 'Growth' : plan === 'start' ? 'Start' : 'Trial'} plan</span>
              {dashboard.latestReport && <span><ShieldCheck size={12} /> {dashboard.latestReport.content.aiNarrativeAvailable ? 'AI narrative grounded in store facts' : 'Deterministic analysis'}</span>}
            </div>
          </div>
          <div className="exec-summary-actions">
            <div className="exec-hero-stats">
              <div className="exec-hero-stat"><strong>{formatExecutiveMoney(revenueTotal, dashboard.currency, 0)}</strong><span>60-day revenue</span></div>
              <div className="exec-hero-stat"><strong>{ordersTotal}</strong><span>60-day orders</span></div>
            </div>
            <button type="button" className="button primary" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/reports`)}>Read Full Report <ArrowUpRight size={14} /></button>
          </div>
        </section>

        {/* 2 — Business health score */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Vital signs</div><h3>Business Health</h3></div>
            <button type="button" className="text-button" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/health`)}>Full diagnosis <ArrowUpRight size={13} /></button>
          </div>
          {health ? (
            <div className="exec-health-row">
              <ExecutiveRadialGauge score={health.overallScore} label={health.overallStatus} sublabel={`as of ${executiveDateLabel(health.diagnosedAt)}`} size={200} />
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
            <ExecutiveEmptyState icon={Gauge} title="No diagnosis yet" description="Run the health check to score eight vital signs from your real store rows." action="Open health" onAction={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/health`)} />
          )}
        </section>

        {/* 3 — Industry position */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Benchmarks</div><h3>Industry Position</h3></div>
            <button type="button" className="text-button" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/benchmarks`)}>All benchmarks <ArrowUpRight size={13} /></button>
          </div>
          {position ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <span className="exec-pill gold"><i />{position.category}</span>
                <span className="exec-muted-note">{position.categorySource === 'AUTO_DETECTED' ? 'auto-detected from your catalog' : position.categorySource === 'PREFERENCE' ? 'from your settings' : 'default category'}</span>
              </div>
              <ExecutiveHorizontalBars rows={position.positions.slice(0, 4).map((metric) => ({
                label: metric.label,
                value: metric.percentile ?? 0,
                display: metric.percentile === null ? 'not measurable' : `${metric.percentile}th`,
                tone: metric.percentile !== null && metric.percentile >= 75 ? 'positive' : metric.percentile !== null && metric.percentile >= 40 ? 'gold' : 'danger',
              }))} />
              <p className="exec-muted-note" style={{ marginTop: 12 }}>Percentile rank vs public Shopify benchmarks. Missing values mean the metric is not measurable yet.</p>
            </>
          ) : (
            <ExecutiveEmptyState icon={LineChart} title="Position not measured yet" description="Sync orders and customers to measure your percentile against the industry." action="Open benchmarks" onAction={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/benchmarks`)} />
          )}
        </section>

        {/* 4 — Strategic opportunities */}
        <section className="exec-section span-4">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Growth</div><h3>Strategic Opportunities</h3></div>
            <button type="button" className="text-button" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/opportunities`)}>View all <ArrowUpRight size={13} /></button>
          </div>
          {dashboard.opportunities.length === 0 ? (
            <ExecutiveEmptyState icon={Lightbulb} title="No opportunities yet" description="Analyze your business to identify growth moves with computed annual impact." action="Analyze now" onAction={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/opportunities`)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dashboard.opportunities.slice(0, 3).map((opportunity) => (
                <button key={opportunity.id} type="button" className="exec-scenario-template" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/opportunities`)}>
                  <strong>{opportunity.title}</strong>
                  <span style={{ color: 'var(--exec-gold)', fontWeight: 600, fontFamily: 'var(--exec-serif)' }}>{formatExecutiveMoney(opportunity.estimatedImpactAnnual, opportunity.impactCurrency, 0)} / yr</span>
                  <span>{opportunity.effortLevel.toLowerCase()} effort · {opportunity.timeline.replace('_', ' ').toLowerCase()}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 5 — Risk radar */}
        <section className="exec-section span-4">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Early warning</div><h3>Risk Radar</h3></div>
            <button type="button" className="text-button" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/risks`)}>Open radar <ArrowUpRight size={13} /></button>
          </div>
          {risks.length === 0 ? (
            <ExecutiveEmptyState icon={ShieldCheck} title="No significant risks detected" description="Your diversification currently sits inside healthy bands. Scans re-check this automatically." action="Run scan" onAction={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/risks`)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((severity) => {
                  const count = risks.filter((risk) => risk.severity === severity).length
                  return <div key={severity} className={`exec-risk-count ${severity.toLowerCase()}`} style={{ flex: 1 }}><strong>{count}</strong><span>{severity.toLowerCase()}</span></div>
                })}
              </div>
              {risks.slice(0, 3).map((risk) => (
                <div key={risk.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-soft)', background: 'var(--exec-surface-2)' }}>
                  <ExecutiveStatusPill status={risk.severity} />
                  <span style={{ fontSize: 11.5, color: 'var(--exec-body)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{risk.title}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--exec-muted)' }}>{formatExecutiveMoney(risk.impactIfRealized, risk.impactCurrency, 0)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 6 — Revenue & orders trend */}
        <section className="exec-section span-4">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Trajectory</div><h3>Revenue & Orders</h3></div>
            <span className="exec-muted-note">last 60 synced days</span>
          </div>
          {revenueValues.length > 1 ? (
            <>
              <ExecutiveAreaChart points={dashboard.revenueSeries} height={120} label="Revenue trend" formatValue={(value) => formatExecutiveMoney(value, dashboard.currency, 0)} />
              <div style={{ display: 'flex', gap: 18, marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ExecutiveSparkline points={ordersValues} width={90} height={26} tone="var(--exec-gold)" /><span style={{ fontSize: 11, color: 'var(--exec-muted)' }}>{ordersTotal} orders</span></div>
                <span style={{ fontSize: 11, color: 'var(--exec-muted)' }}>{formatExecutiveMoney(revenueTotal, dashboard.currency, 0)} revenue</span>
              </div>
            </>
          ) : (
            <ExecutiveEmptyState icon={LineChart} title="Not enough synced history" description="The trajectory chart appears once two or more days of revenue are synced." />
          )}
        </section>

        {/* 7 — Active scenarios */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">What-if</div><h3>Active Scenarios</h3></div>
            <button type="button" className="button secondary" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/scenarios`)}>Create New Scenario</button>
          </div>
          {dashboard.scenarios.length === 0 ? (
            <ExecutiveEmptyState icon={Compass} title="No scenarios yet" description="Model a price change, product launch, or marketing move against your real baseline." action="Create scenario" onAction={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/scenarios`)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dashboard.scenarios.slice(0, 3).map((scenario) => (
                <button key={scenario.id} type="button" className="exec-scenario-template" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/scenarios`)}>
                  <strong>{scenario.title}</strong>
                  <span>{scenario.scenarioType} · {scenario.predictions.currency} {formatExecutiveMoney(Math.round(scenario.predictions.delta.monthlyRevenue ?? 0), null, 0)}/mo projected delta · {executiveDateLabel(scenario.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 8 — Roadmap snapshot */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Direction</div><h3>Strategic Roadmap</h3></div>
            <button type="button" className="text-button" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/roadmaps`)}>Full roadmap <ArrowUpRight size={13} /></button>
          </div>
          {roadmap ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <strong style={{ fontFamily: 'var(--exec-serif)', fontSize: 16, color: 'var(--exec-heading)' }}>{roadmap.title}</strong>
                  <div style={{ fontSize: 11, color: 'var(--exec-muted)', marginTop: 3 }}>{roadmap.milestones.filter((milestone) => milestone.status === 'COMPLETE').length} of {roadmap.milestones.length} milestones complete · {roadmap.periodStart} → {roadmap.periodEnd}</div>
                </div>
                <span className="exec-pill gold"><i />{Math.round(roadmap.currentProgress * 100)}%</span>
              </div>
              <div className="exec-roadmap-progress-track" style={{ background: 'var(--exec-grid)' }}><span style={{ display: 'block', height: '100%', width: `${Math.round(roadmap.currentProgress * 100)}%`, borderRadius: 5, background: 'var(--exec-gold)' }} /></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {roadmap.milestones.slice(0, 3).map((milestone) => (
                  <div key={milestone.key} className="exec-history-spark">
                    <ExecutiveStatusPill status={milestone.status === 'COMPLETE' ? 'COMPLETE' : milestone.status === 'CURRENT' ? 'CURRENT' : 'PENDING'} />
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontFamily: 'var(--exec-sans)', fontSize: 12.5, color: 'var(--exec-heading)' }}>{milestone.title}</strong>
                      <span style={{ display: 'block', fontSize: 10.5, color: 'var(--exec-muted)' }}>{executiveDateLabel(milestone.dueDate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ExecutiveEmptyState icon={Map} title="No active roadmap" description="Generate a personalized 30/60/90-day plan from your business state." action="Generate roadmap" onAction={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/roadmaps`)} />
          )}
        </section>

        {/* 9 — Recent decisions */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Accountability</div><h3>Recent Decisions</h3></div>
            <button type="button" className="text-button" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/decisions`)}>Decision log <ArrowUpRight size={13} /></button>
          </div>
          {dashboard.decisions.length === 0 ? (
            <ExecutiveEmptyState icon={ListChecks} title="No decisions logged" description="Log strategic decisions and record real outcomes — accuracy grades follow automatically." action="Log a decision" onAction={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/decisions`)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dashboard.decisions.slice(0, 3).map((decision) => (
                <div key={decision.id} className="exec-history-spark" style={{ alignItems: 'flex-start' }}>
                  <ExecutiveStatusPill status={decision.qualityRating} />
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontFamily: 'var(--exec-sans)', fontSize: 12.5, color: 'var(--exec-heading)' }}>{decision.title}</strong>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--exec-muted)' }}>{decision.decisionType} · {executiveDateLabel(decision.decisionDate)}{decision.accuracyScore !== null ? ` · ${Math.round(decision.accuracyScore * 100)}% accuracy` : ' · awaiting outcome'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 10 — Usage panel */}
        <section className="exec-section span-6">
          <div className="exec-section-head">
            <div><div className="exec-kicker">Plan allowance</div><h3>Executive Usage</h3></div>
            <button type="button" className="text-button" onClick={() => onNavigate(`${EXECUTIVE_ROUTE_PREFIX}/settings`)}>Preferences</button>
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

function ExecutiveDashboardSkeleton() {
  return (
    <div className="exec-page" role="status" aria-label="Executive dashboard loading">
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
