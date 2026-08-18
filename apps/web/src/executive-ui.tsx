/**
 * GrowthIQ (formerly "AI Executive") — shared UI primitives.
 *
 * Premium, data-forward executive design: purple intelligence signature,
 * Inter typography at 12px+, plan-gate overlays whose CTA always reads
 * "Upgrade Plan" (never a plan name), educational empty states, and
 * elegant skeleton loaders. Theme-adaptive via the tokens in executive.css.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight, Check, ChevronDown, ChevronUp, CircleHelp, FlaskConical, Gauge, LockKeyhole, RefreshCw, Sparkles, TrendingUp, X } from 'lucide-react'
import { PLAN_TIERS } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import type { ExecutiveGate } from './executive-model.js'
import { EXECUTIVE_FEATURE_NAMES } from './executive-model.js'
import { GrowthIqMark } from './growthiq-logo.js'

export type ExecutiveRouter = Readonly<{ route: string; navigate: (route: string) => void }>

export function ExecutiveSection({ kicker, title, action, children, className = '' }: { kicker?: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`exec-section card ${className}`}>
      <div className="exec-section-head">
        <div>
          {kicker ? <div className="exec-kicker">{kicker}</div> : null}
          <h3>{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ExecutiveStatusPill({ status, tone }: { status: string; tone?: string }) {
  const resolved = tone ?? toneForStatus(status)
  return <span className={`exec-pill ${resolved}`}><i />{status.replaceAll('_', ' ')}</span>
}

function toneForStatus(status: string): string {
  const good = new Set(['STRONG', 'HEALTHY', 'COMPLETED', 'RESOLVED', 'EXCELLENT', 'GOOD', 'PURSUING', 'LOW', 'ACTIVE'])
  const warn = new Set(['AT_RISK', 'MEDIUM', 'FAIR', 'REVIEWING', 'MITIGATED', 'NEEDS_ATTENTION', 'PENDING', 'NEW'])
  const bad = new Set(['CRITICAL', 'RISK', 'POOR', 'HIGH', 'REALIZED'])
  if (good.has(status)) return 'positive'
  if (warn.has(status)) return 'warning'
  if (bad.has(status)) return 'danger'
  return 'neutral'
}

/** GrowthIQ skeleton block used across loading states. */
export function ExecutiveSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="exec-skeleton" role="status" aria-label={`${label} loading`}>
      {Array.from({ length: rows }, (_, index) => <span key={index} style={{ width: `${100 - (index % 3) * 18}%` }} />)}
    </div>
  )
}

/** Educational empty state in the GrowthIQ tone. */
export function ExecutiveEmptyState({ icon: Icon, title, description, action, onAction, locked = false, onUpgrade }: { icon: LucideIcon; title: string; description: string; action?: string; onAction?: () => void; locked?: boolean; onUpgrade?: () => void }) {
  return (
    <div className={`exec-empty ${locked ? 'locked' : ''}`}>
      <span className="exec-empty-icon"><Icon size={22} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {locked ? (
        <button type="button" className="button primary" onClick={onUpgrade}><LockKeyhole size={14} /> Upgrade Plan</button>
      ) : action && onAction ? (
        <button type="button" className="button secondary" onClick={onAction}>{action} <ArrowUpRight size={14} /></button>
      ) : null}
    </div>
  )
}

/** Plan-gate overlay that blurs the content and shows the upgrade CTA. */
export function ExecutiveGateOverlay({ gate, feature, plan, onUpgrade, children }: { gate: ExecutiveGate | undefined; feature: string; plan: PlanTier; onUpgrade: () => void; children: ReactNode }) {
  const locked = gate !== undefined && !gate.allowed
  if (!locked) return <>{children}</>
  return (
    <div className="exec-gate">
      <div className="exec-gate-blur" aria-hidden="true">{children}</div>
      <div className="exec-gate-overlay">
        <span className="exec-gate-icon"><LockKeyhole size={18} /></span>
        <strong>{EXECUTIVE_FEATURE_NAMES[feature] ?? feature}</strong>
        <p>{plan === 'trial' ? 'Included in a paid plan — the trial preview shows what your strategy room sees.' : 'This capability is part of a higher plan.'}</p>
        <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
      </div>
    </div>
  )
}

/** Aspirational locked card for feature grids. */
export function ExecutiveLockedCard({ title, description, plan, onUpgrade }: { title: string; description: string; plan: PlanTier; onUpgrade: () => void }) {
  return (
    <div className="exec-locked-card">
      <span className="exec-locked-icon"><LockKeyhole size={16} /></span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
    </div>
  )
}

/** Inline error state — never disguised as an empty state. */
export function ExecutiveErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="exec-error" role="alert">
      <span className="exec-error-icon"><X size={16} /></span>
      <div><strong>Something went wrong</strong><p>{message}</p></div>
      {onRetry ? <button type="button" className="button secondary" onClick={onRetry}><RefreshCw size={13} /> Retry</button> : null}
    </div>
  )
}

/** Header for a GrowthIQ sub-page. */
export function ExecutivePageHeader({ kicker, title, description, actions }: { kicker: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="exec-page-header">
      <div>
        <div className="exec-kicker">{kicker}</div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions ? <div className="exec-page-actions">{actions}</div> : null}
    </div>
  )
}

/** Usage meter with 80% warning and hard-block hint. */
export function ExecutiveUsageBar({ label, used, limit, onUpgrade, plan }: { label: string; used: number; limit: number | null; onUpgrade: () => void; plan: PlanTier }) {
  if (limit === null) {
    return <div className="exec-usage-row"><span>{label}</span><span className="exec-usage-value">{used} used · unlimited</span></div>
  }
  const percent = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100))
  const warning = percent >= 80
  const blocked = used >= limit
  return (
    <div className={`exec-usage-row ${warning ? 'warning' : ''} ${blocked ? 'blocked' : ''}`}>
      <span>{label}</span>
      <div className="exec-usage-track"><span style={{ width: `${percent}%` }} /></div>
      <span className="exec-usage-value">{used} / {limit}</span>
      {blocked ? <button type="button" className="text-button" onClick={onUpgrade}>Limit reached — <strong>Upgrade Plan</strong></button> : warning ? <button type="button" className="text-button" onClick={onUpgrade}>Near limit — <strong>Upgrade Plan</strong></button> : null}
    </div>
  )
}

/** Secondary nav tabs inside the AI Growth Command page. */
export function GrowthCommandTabs({ active, onNavigate }: { active: 'store-coach' | 'executive' | 'insights'; onNavigate: (tab: 'store-coach' | 'executive' | 'insights') => void }) {
  return (
    <div className="growth-tabs" role="tablist" aria-label="AI Growth Command sections">
      <button type="button" role="tab" aria-selected={active === 'store-coach'} className={active === 'store-coach' ? 'active' : ''} onClick={() => onNavigate('store-coach')}>
        <Gauge size={15} /> Store Coach
      </button>
      <button type="button" role="tab" aria-selected={active === 'executive'} className={active === 'executive' ? 'active' : ''} onClick={() => onNavigate('executive')}>
        <span className="gq-tab-mark"><GrowthIqMark size={17} /></span> GrowthIQ <span className="growth-tab-note new">New</span>
      </button>
      <button type="button" role="tab" aria-selected={active === 'insights'} className={active === 'insights' ? 'active' : ''} onClick={() => onNavigate('insights')}>
        <TrendingUp size={15} /> Insights Hub
      </button>
    </div>
  )
}

export function ComingSoonPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="exec-coming-soon">
      <span className="exec-empty-icon"><CircleHelp size={20} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      <span className="exec-pill neutral"><i />In development</span>
    </div>
  )
}

export function ExecutiveAssuranceNote({ children }: { children: ReactNode }) {
  return (
    <div className="exec-assurance">
      <Check size={14} />
      <span>{children}</span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Plan-based feature display (GrowthIQ)
   ──────────────────────────────────────────────────────────────────────────── */

const PLAN_TIER_RANK: Readonly<Record<PlanTier, number>> = Object.fromEntries(PLAN_TIERS.map((tier, index) => [tier, index])) as Readonly<Record<PlanTier, number>>

type PlanFeatureRow = Readonly<{ label: string; tier: PlanTier; hint?: string }>

const GROWTHIQ_PLAN_FEATURES: readonly PlanFeatureRow[] = [
  { label: 'Executive overview dashboard', tier: 'trial' },
  { label: 'Sample benchmarks (3 metrics)', tier: 'trial' },
  { label: 'One opportunity preview', tier: 'trial' },
  { label: 'On-demand board reports', tier: 'start', hint: 'Start+' },
  { label: 'Full industry benchmarks', tier: 'start', hint: 'Start+' },
  { label: 'Scenario planning', tier: 'start', hint: 'Start+' },
  { label: 'Health diagnosis', tier: 'start', hint: 'Start+' },
  { label: 'Decision tracking', tier: 'start', hint: 'Start+' },
  { label: 'Risk radar scans', tier: 'start', hint: 'Start+' },
  { label: '30-day strategic roadmaps', tier: 'start', hint: 'Start+' },
  { label: '60/90-day roadmaps', tier: 'growth', hint: 'Growth+' },
  { label: 'Automatic monthly board reports', tier: 'growth', hint: 'Growth+' },
  { label: 'Quarterly & yearly roadmaps', tier: 'commander', hint: 'Commander' },
  { label: 'Investor reports (PDF)', tier: 'commander', hint: 'Commander' },
  { label: 'White-label reports', tier: 'commander', hint: 'Commander' },
]

function planTierLabel(plan: PlanTier): string {
  if (plan === 'trial') return 'Trial'
  if (plan === 'start') return 'Start'
  if (plan === 'growth') return 'Growth'
  return 'Commander'
}

/**
 * Compact plan summary — collapsed by default so billing never dominates the
 * page. One row carries the badge, the counts, and the CTAs; "Show details"
 * expands the categorized feature matrix with a smooth grid-rows animation.
 * Descriptive groupings may name tiers; every CTA still says
 * "Upgrade Plan" — never "Upgrade to <plan>".
 */
export function GrowthIqPlanPanel({ plan, onUpgrade, defaultExpanded = false }: { plan: PlanTier; onUpgrade: () => void; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const rank = PLAN_TIER_RANK[plan]
  const unlocked = GROWTHIQ_PLAN_FEATURES.filter((feature) => PLAN_TIER_RANK[feature.tier] <= rank)
  const locked = GROWTHIQ_PLAN_FEATURES.filter((feature) => PLAN_TIER_RANK[feature.tier] > rank)
  const isCommander = plan === 'commander'
  // Group locked rows under their minimum tier so merchants can scan
  // "what a step up adds" without prices or plan-name CTAs.
  const lockedByTier = PLAN_TIERS
    .map((tier) => ({ tier, features: locked.filter((feature) => feature.tier === tier) }))
    .filter((group) => group.features.length > 0)
  return (
    <div className="gq-plan-panel">
      <div className="gq-plan-head">
        <span className="gq-plan-badge"><span className="gq-plan-dot" />Your plan: {planTierLabel(plan)}</span>
        {isCommander
          ? <span className="gq-plan-note">{unlocked.length} features active · all GrowthIQ features unlocked</span>
          : <span className="gq-plan-note">{unlocked.length} features active · {locked.length} more available</span>}
        <span className="gq-plan-head-actions">
          <button
            type="button"
            className="text-button gq-plan-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls="gq-plan-details"
          >
            {expanded ? <>Hide details <ChevronUp size={14} /></> : <>Show details <ChevronDown size={14} /></>}
          </button>
          {!isCommander && <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}
        </span>
      </div>
      <div id="gq-plan-details" className={`gq-plan-details ${expanded ? 'open' : ''}`}>
        <div className="gq-plan-details-inner">
          <div className="gq-plan-list">
            <h4>Currently available ({unlocked.length})</h4>
            {unlocked.map((feature) => (
              <div key={feature.label} className="gq-plan-item unlocked"><Check size={14} />{feature.label}{feature.hint && <small>{feature.hint}</small>}</div>
            ))}
          </div>
          {!isCommander && lockedByTier.length > 0 && (
            <div className="gq-plan-locked-groups">
              <h4>Available on higher plans ({locked.length})</h4>
              {lockedByTier.map((group) => (
                <div key={group.tier} className="gq-plan-tier-group">
                  <h5>{planTierLabel(group.tier)} plan</h5>
                  {group.features.map((feature) => (
                    <div key={feature.label} className="gq-plan-item locked"><LockKeyhole size={13} />{feature.label}{feature.hint && <small>{feature.hint}</small>}</div>
                  ))}
                </div>
              ))}
              <div className="gq-plan-details-cta">
                <span>Unlock the full matrix — billing is self-serve.</span>
                <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Educational first-run states (GrowthIQ)
   ──────────────────────────────────────────────────────────────────────────── */

const GROWTHIQ_CAPABILITIES: readonly Readonly<{ title: string; detail: string }>[] = [
  { title: 'Board-ready monthly reports', detail: 'Executive summaries, forecasts, and decisions — computed from your real store data.' },
  { title: 'Industry benchmarking', detail: 'Your real metrics positioned against curated public Shopify benchmarks.' },
  { title: 'What-if scenario planning', detail: 'Model pricing, launches, and spend changes against your measured baseline.' },
  { title: 'Business health diagnosis', detail: 'Eight vital signs, weighted score, conditions, and prescriptions.' },
  { title: 'Strategic growth opportunities', detail: 'Long-horizon moves with computed annual impact — not daily to-dos.' },
  { title: 'Long-term risk radar', detail: 'Concentration, seasonality, cash-flow, and market exposures with mitigations.' },
  { title: 'Decision tracking', detail: 'Log major decisions, record outcomes, and grade your forecast accuracy.' },
  { title: '30/60/90-day roadmaps', detail: 'A personalized growth plan with milestones and expected outcomes.' },
]

/** First-run welcome: explains what GrowthIQ will do. No fake data, ever. */
export function GrowthIqWelcomeState({ onExploreReports, onSync }: { onExploreReports?: (() => void) | undefined; onSync?: (() => void) | undefined }) {
  return (
    <div className="gq-welcome">
      <GrowthIqMark size={46} />
      <div>
        <h2>Welcome to GrowthIQ</h2>
        <p>Your intelligent business growth platform is ready to analyze your store and help you think strategically about the business — quarterly, not hourly.</p>
      </div>
      <div className="gq-welcome-grid">
        {GROWTHIQ_CAPABILITIES.map((capability) => (
          <div key={capability.title} className="gq-welcome-item">
            <Check size={15} />
            <div><strong>{capability.title}</strong><span>{capability.detail}</span></div>
          </div>
        ))}
      </div>
      {(onExploreReports || onSync) && (
        <div className="gq-actions">
          {onExploreReports && <button type="button" className="button primary" onClick={onExploreReports}><FlaskConical size={14} /> Explore a sample report</button>}
          {onSync && <button type="button" className="button secondary" onClick={onSync}><Sparkles size={14} /> Sync store data</button>}
        </div>
      )}
    </div>
  )
}

export type GrowthIqReadiness = Readonly<{
  hasStoreInfo: boolean
  ordersSynced: number
  daysSynced: number
  minOrders: number
  minDays: number
}>

/**
 * "Building your intelligence baseline": shown when the store is connected
 * but there is not yet enough synced history for strategic analysis. Every
 * figure is the merchant's real sync state — the thresholds are honest
 * minimums, and the suggestions are things that work with zero history.
 */
export function GrowthIqBaselineState({ readiness, onLogDecision, onViewSample, onSync }: { readiness: GrowthIqReadiness; onLogDecision?: (() => void) | undefined; onViewSample?: (() => void) | undefined; onSync?: (() => void) | undefined }) {
  const ordersReady = readiness.ordersSynced >= readiness.minOrders
  const daysReady = readiness.daysSynced >= readiness.minDays
  const progress = Math.min(100, Math.round(((ordersReady ? 1 : readiness.ordersSynced / readiness.minOrders) + (daysReady ? 1 : readiness.daysSynced / readiness.minDays)) / 2 * 100))
  return (
    <div className="gq-welcome">
      <GrowthIqMark size={40} />
      <div>
        <h2>Building your intelligence baseline</h2>
        <p>GrowthIQ needs a little more synced history before strategic analysis is trustworthy. Here is exactly where things stand:</p>
      </div>
      <div className="gq-baseline">
        <div className="gq-baseline-row">
          <span className={`gq-baseline-state ${readiness.hasStoreInfo ? 'ready' : 'pending'}`}>{readiness.hasStoreInfo ? '✓' : '…'}</span>
          <span>Basic store information {readiness.hasStoreInfo ? 'connected' : 'missing'}</span>
        </div>
        <div className="gq-baseline-row">
          <span className={`gq-baseline-state ${ordersReady ? 'ready' : 'pending'}`}>{ordersReady ? '✓' : '…'}</span>
          <span><strong>{readiness.ordersSynced}</strong> of {readiness.minOrders}+ synced orders</span>
        </div>
        <div className="gq-baseline-row">
          <span className={`gq-baseline-state ${daysReady ? 'ready' : 'pending'}`}>{daysReady ? '✓' : '…'}</span>
          <span><strong>{readiness.daysSynced}</strong> of {readiness.minDays}+ synced days of history</span>
        </div>
      </div>
      <div className="gq-progress">
        <div className="gq-progress-track"><span style={{ width: `${Math.max(4, progress)}%` }} /></div>
        <small>Baseline coverage {progress}% — grows automatically with every sync</small>
      </div>
      <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--exec-body)' }}>Meanwhile, these work with zero history:</p>
      <div className="gq-actions">
        {onLogDecision && <button type="button" className="button primary" onClick={onLogDecision}>Log a business decision</button>}
        {onViewSample && <button type="button" className="button secondary" onClick={onViewSample}>View a sample report</button>}
        {onSync && <button type="button" className="button secondary" onClick={onSync}>Sync more data</button>}
      </div>
    </div>
  )
}
