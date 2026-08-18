/**
 * GrowthIQ — strategic/executive sections.
 *
 * The executive layer of the GrowthIQ dashboard: business trajectory with a
 * trend projection, the strategic position matrix, decision-impact previews,
 * long-horizon growth milestones, the weekly executive digest, the insights
 * sidebar, and the executive actions panel.
 *
 * Every number rendered here comes from `growthiq-strategic.ts` derivations
 * over the real dashboard payload. When an input is not measurable these
 * components render honest education — never fabricated figures. Upgrade
 * CTAs always read "Upgrade Plan".
 */
import type { ReactNode } from 'react'
import { ArrowUpRight, Crosshair, DollarSign, FileBarChart, Flag, Gem, Globe, Lightbulb, ListChecks, LockKeyhole, Mountain, Newspaper, Package, Quote, TrendingUp, Users, Zap } from 'lucide-react'
import type { PlanTier } from '@profitpilot/types'
import { formatExecutiveMoney, formatExecutiveNumber } from './executive-model.js'
import type { GrowthMilestonesResult, ImpactPreview, StrategicPosition, TrajectoryProjection, WeeklyDigest } from './growthiq-strategic.js'
import { ExecutivePositionMatrix, ExecutiveTrajectoryChart } from './executive-charts.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'

function SectionHead({ kicker, title, note, action }: { kicker: string; title: string; note?: string | undefined; action?: ReactNode | undefined }) {
  return (
    <div className="exec-section-head">
      <div>
        <div className="exec-kicker">{kicker}</div>
        <h3>{title}</h3>
        {note ? <p className="gq-section-note">{note}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** Small honest fallback shown where a derivation returns null. */
function GrowthIqNotYet({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="gq-not-yet">
      <span className="gq-not-yet-icon">{icon}</span>
      <p>{text}</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Business trajectory — real history + measured trend projection
// ────────────────────────────────────────────────────────────────────────────

export function GrowthIqTrajectorySection({ projection, currency, daysSynced, onNavigateReports, className = '' }: { projection: TrajectoryProjection | null; currency: string; daysSynced: number; onNavigateReports: () => void; className?: string }) {
  return (
    <section className={`exec-section gq-card ${className}`} data-testid="gq-trajectory">
      <SectionHead
        kicker="Your business trajectory"
        title="Revenue — last 30 days vs the next 30"
        note="The solid line is your real synced revenue; the dashed line extends your measured trend. The band widens with distance because the future is genuinely less certain."
      />
      {projection === null ? (
        <GrowthIqNotYet
          icon={<TrendingUp size={18} />}
          text={`The trajectory chart draws itself from real revenue days — ${daysSynced} of 2 needed are synced. It appears automatically as your store syncs.`}
        />
      ) : (
        <>
          <ExecutiveTrajectoryChart data={projection} formatValue={(value) => formatExecutiveMoney(value, currency, 0)} label="Revenue trajectory with 30-day trend projection" />
          <div className="gq-trajectory-insight">
            <p>
              Based on your current trend, the business is on a <strong className={`gq-direction ${projection.direction}`}>{projection.direction}</strong> trajectory.
            </p>
            <div className="gq-trajectory-figures">
              <div className="gq-figure"><strong>{formatExecutiveMoney(projection.currentMonthlyRunRate, currency, 0)}</strong><span>current monthly run-rate</span></div>
              <div className="gq-figure"><strong>{formatExecutiveMoney(projection.projectedMonthlyRevenue, currency, 0)}{projection.growthRatePct !== null && <em className={`gq-direction ${projection.direction}`}> {projection.growthRatePct >= 0 ? '+' : ''}{projection.growthRatePct.toFixed(1)}%</em>}</strong><span>projected next 30 days</span></div>
              <div className="gq-figure"><strong>{projection.confidencePct}%</strong><span>projection confidence · {projection.dataDays} real days</span></div>
            </div>
            <div className="gq-card-footer">
              <button type="button" className="text-button" onClick={onNavigateReports}>Explore trajectory details <ArrowUpRight size={13} /></button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Strategic position — growth momentum × market presence quadrant
// ────────────────────────────────────────────────────────────────────────────

export function GrowthIqPositionSection({ position, nextMilestone, onNavigateBenchmarks, className = '' }: { position: StrategicPosition; nextMilestone: string | null; onNavigateBenchmarks: () => void; className?: string }) {
  const measurable = position.x !== null && position.y !== null
  return (
    <section className={`exec-section gq-card ${className}`} data-testid="gq-position">
      <SectionHead
        kicker="Your strategic position"
        title="Where the store stands right now"
        note="Growth momentum (your real MoM trend) against market presence (your real revenue percentile on the public benchmark ladder)."
      />
      {measurable ? (
        <div className="gq-position-layout">
          <ExecutivePositionMatrix x={position.x!} y={position.y!} xLabel="Market presence" yLabel="Growth momentum" />
          <div className="gq-position-facts">
            <div className="gq-fact"><span>Your stage</span><strong>{position.stage}</strong></div>
            <div className="gq-fact"><span>Strategic focus</span><strong>{position.focus}</strong></div>
            <div className="gq-fact"><span>Next milestone</span><strong>{nextMilestone ?? 'All listed milestones complete'}</strong></div>
            <button type="button" className="text-button" onClick={onNavigateBenchmarks}>View strategic benchmarks <ArrowUpRight size={13} /></button>
          </div>
        </div>
      ) : (
        <GrowthIqNotYet
          icon={<Crosshair size={18} />}
          text={position.y === null
            ? 'Your position plots once two comparison windows exist — the momentum axis needs a real prior period, and it is never estimated.'
            : 'Market presence needs a measurable revenue percentile — sync store history and the benchmark ladder places you automatically.'}
        />
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Impact preview — four strategic focus lanes with computed stakes
// ────────────────────────────────────────────────────────────────────────────

const IMPACT_META: Readonly<Record<ImpactPreview['key'], { title: string; icon: typeof DollarSign; route: string }>> = {
  revenue: { title: 'Revenue focus', icon: DollarSign, route: '/scenarios' },
  customers: { title: 'Customer focus', icon: Users, route: '/benchmarks' },
  product: { title: 'Product focus', icon: Package, route: '/opportunities' },
  market: { title: 'Market expansion', icon: Globe, route: '/opportunities' },
}

export function GrowthIqImpactSection({ previews, onNavigate, className = '' }: { previews: readonly ImpactPreview[]; onNavigate: (route: string) => void; className?: string }) {
  return (
    <section className={`exec-section gq-card ${className}`} data-testid="gq-impact">
      <SectionHead
        kicker="Impact preview"
        title="If you focus on these strategic areas"
        note="Each estimate is computed from your real benchmark gaps and analyzed opportunities — anything not measurable yet says so."
      />
      <div className="gq-impact-grid">
        {previews.map((preview) => {
          const meta = IMPACT_META[preview.key]
          const Icon = meta.icon
          return (
            <div key={preview.key} className="gq-impact-card">
              <div className="gq-impact-top">
                <span className="gq-impact-icon"><Icon size={16} /></span>
                <strong>{meta.title}</strong>
              </div>
              {preview.impactLabel !== null ? (
                <span className={`gq-impact-value ${preview.tone}`}>{preview.impactLabel}</span>
              ) : (
                <span className="gq-impact-value muted"><LockKeyhole size={12} /> Not measurable yet</span>
              )}
              {preview.detail ? <p>{preview.detail}</p> : null}
              <button type="button" className="text-button" onClick={() => onNavigate(meta.route)}>Learn more <ArrowUpRight size={13} /></button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Growth milestones — the long-horizon ladder, counted from real totals
// ────────────────────────────────────────────────────────────────────────────

export function GrowthIqMilestonesSection({ result, onNavigateRoadmaps, className = '' }: { result: GrowthMilestonesResult; onNavigateRoadmaps: () => void; className?: string }) {
  return (
    <section className={`exec-section gq-card ${className}`} data-testid="gq-milestones">
      <SectionHead
        kicker="Your growth milestones"
        title={`${result.completedCount} of ${result.milestones.length} reached`}
        note="A long-horizon ladder counted from your real synced totals — orders, customers, history, revenue."
        action={<button type="button" className="text-button" onClick={onNavigateRoadmaps}>View roadmap <ArrowUpRight size={13} /></button>}
      />
      <ol className="gq-milestones">
        {result.milestones.map((milestone) => (
          <li key={milestone.key} className={`gq-milestone ${milestone.status}`}>
            <span className="gq-milestone-marker" aria-hidden="true">
              {milestone.status === 'complete' ? '✓' : milestone.status === 'current' ? '◈' : milestone.status === 'action' ? '⚡' : '🔒'}
            </span>
            <div className="gq-milestone-body">
              <div className="gq-milestone-row">
                <strong>{milestone.title}</strong>
                {milestone.target > 1 && milestone.metric !== 'revenue' && (
                  <span className="gq-milestone-count">{formatExecutiveNumber(Math.min(milestone.current, milestone.target), 0)} / {formatExecutiveNumber(milestone.target, 0)}</span>
                )}
              </div>
              {milestone.status === 'current' && milestone.target > 1 && (
                <div className="gq-milestone-track"><span style={{ width: `${Math.max(3, milestone.progressPct)}%` }} /></div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {result.active ? (
        <p className="gq-milestone-eta">
          Next: <strong>{result.active.title}</strong>
          {result.eta ? ` · ${result.eta}` : ''}
        </p>
      ) : (
        <p className="gq-milestone-eta"><strong>Every listed milestone reached</strong> — set your next horizon in a roadmap.</p>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Weekly executive digest — board-style snapshot from the last 7 real days
// ────────────────────────────────────────────────────────────────────────────

export function GrowthIqDigestSection({ digest, daysSynced, currency, plan, canReadReports, onNavigateReports, onUpgrade, className = '' }: { digest: WeeklyDigest | null; daysSynced: number; currency: string; plan: PlanTier; canReadReports: boolean; onNavigateReports: () => void; onUpgrade: () => void; className?: string }) {
  return (
    <section className={`exec-section gq-card gq-digest ${className}`} data-testid="gq-digest">
      <SectionHead
        kicker="This week's executive digest"
        title="Board snapshot — last 7 days"
        note={digest ? 'Computed from your synced revenue and orders; compared against the prior 7 real days.' : undefined}
      />
      {digest === null ? (
        <GrowthIqNotYet
          icon={<Newspaper size={18} />}
          text={`Your first weekly digest unlocks after 7 synced days of history — ${daysSynced} of 7 synced. Nothing is back-filled or simulated.`}
        />
      ) : (
        <>
          <div className="gq-digest-block">
            <h4>Business snapshot</h4>
            <div className="gq-digest-grid">
              <div className="gq-fact"><span>Revenue · 7d</span><strong>{formatExecutiveMoney(digest.revenue7, currency, 0)}{digest.revenueWowPct !== null && <em className={`gq-direction ${digest.revenueWowPct > 0.5 ? 'growing' : digest.revenueWowPct < -0.5 ? 'declining' : 'stable'}`}> {digest.revenueWowPct >= 0 ? '+' : ''}{digest.revenueWowPct.toFixed(1)}%</em>}</strong></div>
              <div className="gq-fact"><span>Orders · 7d</span><strong>{formatExecutiveNumber(digest.orders7, 0)}{digest.ordersWowPct !== null && <em className={`gq-direction ${digest.ordersWowPct > 0.5 ? 'growing' : digest.ordersWowPct < -0.5 ? 'declining' : 'stable'}`}> {digest.ordersWowPct >= 0 ? '+' : ''}{digest.ordersWowPct.toFixed(1)}%</em>}</strong></div>
              <div className="gq-fact"><span>Best product</span><strong>{digest.bestProduct ?? 'No product sales synced yet'}</strong></div>
            </div>
          </div>
          <div className="gq-digest-block">
            <h4>Strategic focus area</h4>
            {digest.focus ? (
              <p className="gq-digest-focus"><strong>{digest.focus.title}.</strong> {digest.focus.reason}</p>
            ) : (
              <p className="gq-digest-focus muted">A focus emerges as trends form — no strong signal this week.</p>
            )}
          </div>
          {digest.opportunities.length > 0 && (
            <div className="gq-digest-block">
              <h4>Upcoming opportunities</h4>
              <ul>{digest.opportunities.map((title) => <li key={title}>{title}</li>)}</ul>
            </div>
          )}
          {digest.attention.length > 0 && (
            <div className="gq-digest-block">
              <h4>Needs attention</h4>
              <ul>{digest.attention.map((title) => <li key={title}>{title}</li>)}</ul>
            </div>
          )}
          <div className="gq-card-footer">
            {canReadReports ? (
              <button type="button" className="button secondary" onClick={onNavigateReports}>Read full report <ArrowUpRight size={14} /></button>
            ) : (
              <div className="gq-digest-gate">
                <span>Full board reports are included in paid plans.</span>
                <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Executive insights sidebar — quick stats, key metrics, strategic wisdom
// ────────────────────────────────────────────────────────────────────────────

/** Executive best practices — evergreen editorial content, not store data. */
export const GROWTHIQ_STRATEGIC_TIPS: readonly string[] = [
  'Businesses that build a repeat-purchase habit early compound growth far past acquisition-only strategies.',
  'A decision reviewed against its outcome is worth ten decisions left unmeasured — log, review, recalibrate.',
  'Concentration is quiet risk: when one product or channel passes half your revenue, plan the second engine.',
  'Growth plans survive contact with reality when they name one metric that would prove them wrong.',
]

export type SidebarMetrics = Readonly<{
  daysSynced: number
  stage: string
  healthLabel: string | null
  nextFocus: string | null
  revenueGrowthPct: number | null
  repeat: Readonly<{ yours: number; median: number }> | null
  aov: Readonly<{ value: number; deltaPct: number | null }> | null
}>

export function GrowthIqInsightsSidebar({ metrics, currency, tipIndex = 0, onNavigateReports }: { metrics: SidebarMetrics; currency: string; tipIndex?: number; onNavigateReports: () => void }) {
  const tip = GROWTHIQ_STRATEGIC_TIPS[Math.abs(tipIndex) % GROWTHIQ_STRATEGIC_TIPS.length]!
  return (
    <aside className="gq-insights" data-testid="gq-insights">
      <div className="gq-insights-head">
        <span className="gq-insights-icon"><Gem size={16} /></span>
        <div>
          <div className="exec-kicker">Executive insights</div>
          <h3>At a glance</h3>
        </div>
      </div>

      <div className="gq-insights-block">
        <h4>Quick stats</h4>
        <dl className="gq-stat-list">
          <div><dt>Synced history</dt><dd>{metrics.daysSynced} day{metrics.daysSynced === 1 ? '' : 's'}</dd></div>
          <div><dt>Growth stage</dt><dd>{metrics.stage}</dd></div>
          <div><dt>Health</dt><dd>{metrics.healthLabel ?? 'Not diagnosed yet'}</dd></div>
          <div><dt>Next focus</dt><dd>{metrics.nextFocus ?? 'Forms as trends emerge'}</dd></div>
        </dl>
      </div>

      <div className="gq-insights-block">
        <h4>Key metrics</h4>
        <dl className="gq-stat-list">
          <div>
            <dt>Revenue growth · MoM</dt>
            <dd>{metrics.revenueGrowthPct === null ? 'Needs a prior 30-day window' : <span className={`gq-direction ${metrics.revenueGrowthPct > 0.5 ? 'growing' : metrics.revenueGrowthPct < -0.5 ? 'declining' : 'stable'}`}>{metrics.revenueGrowthPct >= 0 ? '▲' : '▼'} {Math.abs(metrics.revenueGrowthPct).toFixed(1)}%</span>}</dd>
          </div>
          <div>
            <dt>Repeat purchase</dt>
            <dd>{metrics.repeat ? <>{metrics.repeat.yours.toFixed(1)}% <small>vs {metrics.repeat.median.toFixed(1)}% industry median</small></> : 'Not measurable yet'}</dd>
          </div>
          <div>
            <dt>Average order value</dt>
            <dd>{metrics.aov ? <>{formatExecutiveMoney(metrics.aov.value, currency)}{metrics.aov.deltaPct !== null && <small> {metrics.aov.deltaPct >= 0 ? '↗' : '↘'} {Math.abs(metrics.aov.deltaPct).toFixed(1)}% MoM</small>}</> : 'Needs 30 days of orders'}</dd>
          </div>
        </dl>
      </div>

      <div className="gq-insights-block gq-tip">
        <h4><Quote size={12} /> Strategic note</h4>
        <p>“{tip}”</p>
        <button type="button" className="text-button" onClick={onNavigateReports}>More insights <ArrowUpRight size={13} /></button>
      </div>
    </aside>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Executive actions — the strategic moves that work at any data depth
// ────────────────────────────────────────────────────────────────────────────

export function GrowthIqActionsPanel({ onNavigate }: { onNavigate: (route: string) => void }) {
  const actions: readonly Readonly<{ key: string; title: string; description: string; icon: typeof Flag; route: string }>[] = [
    { key: 'decision', title: 'Log a decision', description: 'Track a strategic move and grade its outcome later.', icon: ListChecks, route: '/decisions' },
    { key: 'report', title: 'View a report', description: 'Open your board-ready strategic reporting.', icon: FileBarChart, route: '/reports' },
    { key: 'goal', title: 'Set a goal', description: 'Turn a quarterly objective into a milestone plan.', icon: Flag, route: '/roadmaps' },
    { key: 'insight', title: 'Find an insight', description: 'Surface strategic opportunities in your data.', icon: Lightbulb, route: '/opportunities' },
  ]
  return (
    <section className="gq-actions-panel" data-testid="gq-actions" aria-label="Executive actions">
      <div className="gq-insights-block gq-actions-intro">
        <h4><Zap size={13} /> Executive actions</h4>
        <p>Strategic moves you can make right now — each works at any data depth.</p>
      </div>
      <div className="gq-action-grid">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button key={action.key} type="button" className="gq-action-card" onClick={() => onNavigate(action.route)}>
              <span className="gq-action-icon"><Icon size={16} /></span>
              <strong>{action.title}</strong>
              <span>{action.description}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
