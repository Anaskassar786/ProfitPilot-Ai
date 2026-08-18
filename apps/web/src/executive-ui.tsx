/**
 * PR #49 — AI Executive shared UI.
 *
 * Executive design language: deep navy + gold accents, serif headings,
 * financial-report data tables, plan-gate overlays that always say
 * "Upgrade Plan" (never a plan name), educational empty states, and
 * elegant skeleton loaders. Everything is theme-adaptive via the CSS
 * custom properties in executive.css.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight, CheckCircle2, CircleHelp, Landmark, LockKeyhole, RefreshCw, Sparkles, TrendingUp, X } from 'lucide-react'
import type { PlanTier } from '@profitpilot/types'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import type { ExecutiveGate } from './executive-model.js'
import { EXECUTIVE_FEATURE_NAMES } from './executive-model.js'

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

/** Executive skeleton block used across loading states. */
export function ExecutiveSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="exec-skeleton" role="status" aria-label={`${label} loading`}>
      {Array.from({ length: rows }, (_, index) => <span key={index} style={{ width: `${100 - (index % 3) * 18}%` }} />)}
    </div>
  )
}

/** Educational empty state in the executive tone. */
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
        <p>{plan === 'trial' ? 'Included in a paid plan — the trial preview shows what the boardroom sees.' : 'This feature is part of a higher plan.'}</p>
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

/** Header for an executive sub-page. */
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
        <Sparkles size={15} /> Store Coach <span className="growth-tab-note">Coming soon</span>
      </button>
      <button type="button" role="tab" aria-selected={active === 'executive'} className={active === 'executive' ? 'active' : ''} onClick={() => onNavigate('executive')}>
        <Landmark size={15} /> AI Executive <span className="growth-tab-note new">NEW</span>
      </button>
      <button type="button" role="tab" aria-selected={active === 'insights'} className={active === 'insights' ? 'active' : ''} onClick={() => onNavigate('insights')}>
        <TrendingUp size={15} /> Insights Hub <span className="growth-tab-note">Coming soon</span>
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
      <CheckCircle2 size={14} />
      <span>{children}</span>
    </div>
  )
}
