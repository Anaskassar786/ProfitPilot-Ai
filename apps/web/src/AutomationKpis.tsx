import { Button } from './polaris-ui.js'
import { Activity, Bell, CheckCircle2, Target, Workflow } from './icons.js'
import { useId } from 'react'
import type { JSX } from 'react'
import type { AutomationSummary, AutomationUsage } from './automation-model.js'
import { actionBarHeights, monthSparkPath, usageSegments } from './automation-helpers.js'

const ACTION_BARS = [
  { key: 'emailsSent', label: 'Email', color: 'rgb(124, 58, 237)' },
  { key: 'customersTagged', label: 'Tag', color: 'rgb(59, 130, 246)' },
  { key: 'notificationsSent', label: 'Notify', color: 'rgb(16, 185, 129)' },
  { key: 'discountsCreated', label: 'Discount', color: 'rgb(245, 158, 11)' },
] as const

export function AutomationKpis({
  summary,
  usage,
  onApprovals,
}: {
  summary: AutomationSummary | null
  usage: AutomationUsage | null
  onApprovals: () => void
}): JSX.Element {
  const runTrend = summary ? summary.runs.thisMonth - summary.runs.previousMonth : 0
  const impacts = summary ? Object.entries(summary.impact) : []
  const actionsTotal = impacts.reduce((total, [, value]) => total + value, 0)
  const pending = summary?.approvalsPending ?? 0
  const successRate = summary?.runs.successRate ?? null
  const segments = usageSegments(usage?.used ?? 0, usage?.limit ?? null)
  const spark = monthSparkPath(summary?.runs.previousMonth ?? 0, summary?.runs.thisMonth ?? 0)
  const heights = actionBarHeights(ACTION_BARS.map((bar) => summary?.impact[bar.key] ?? 0))
  const uid = useId().split(':').join('')

  return (
    <section className="automation-kpis bottom-kpis-grid" aria-label="Automation results">
      <article className="kpi-card active-automations">
        <div className="kpi-header">
          <span className="kpi-icon-wrap">
            <Workflow className="kpi-icon" size={14} />
          </span>
          <span className="kpi-label">Active automations</span>
        </div>
        <div className="kpi-visualization" aria-hidden="true">
          {segments.unlimited ? (
            <div className="segmented-bar unlimited">
              <div className="segment filled" style={{ flex: Math.max(1, segments.filled) }} />
            </div>
          ) : (
            <div className="segmented-bar" style={{ gridTemplateColumns: `repeat(${Math.min(segments.total, 12)}, 1fr)` }}>
              {Array.from({ length: Math.min(segments.total, 12) }, (_, index) => (
                <div key={index} className={`segment ${index < Math.min(segments.filled, 12) ? 'filled' : 'empty'}`} />
              ))}
            </div>
          )}
          <div className="segment-labels">
            <span className="segment-label active">{summary?.workflows.active ?? 0} active</span>
            <span className="segment-label available">{segments.unlimited ? 'Unlimited' : `${Math.max(0, segments.empty)} available`}</span>
          </div>
        </div>
        <div className="kpi-value-wrap">
          <span className="kpi-value">{summary?.workflows.active ?? 0}</span>
          {usage?.limit !== null && usage?.limit !== undefined && <span className="kpi-total">/ {usage.limit}</span>}
        </div>
        <p className="kpi-helper">
          {usage?.limit === null ? `${usage?.used ?? 0} automations · unlimited plan` : `${usage?.used ?? 0} of ${usage?.limit ?? 0} automations used`}
        </p>
      </article>

      <article className="kpi-card runs-month">
        <div className="kpi-header">
          <span className="kpi-icon-wrap">
            <Activity className="kpi-icon" size={14} />
          </span>
          <span className="kpi-label">Runs this month</span>
        </div>
        <div className="kpi-visualization" aria-hidden="true">
          <svg width="100%" height="40" viewBox="0 0 100 40" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`runsGradient-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(124, 58, 237)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="rgb(124, 58, 237)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={spark.area} fill={`url(#runsGradient-${uid})`} />
            <path d={spark.line} fill="none" stroke="rgb(124, 58, 237)" strokeWidth="1.5" />
          </svg>
        </div>
        <div className="kpi-value">{summary?.runs.thisMonth ?? 0}</div>
        <p className="kpi-helper">{runTrend === 0 ? 'No change from last month' : `${runTrend > 0 ? '+' : ''}${runTrend} vs last month`}</p>
      </article>

      <article className="kpi-card success-rate">
        <div className="kpi-header">
          <span className="kpi-icon-wrap">
            <Target className="kpi-icon" size={14} />
          </span>
          <span className="kpi-label">Success rate</span>
        </div>
        <div className="kpi-visualization" aria-hidden="true">
          <SuccessGauge rate={successRate} uid={uid} />
        </div>
        <div className="kpi-value">{successRate === null ? '—' : `${Math.round(successRate)}%`}</div>
        <p className="kpi-helper">
          {summary?.runs.completed || summary?.runs.failed
            ? `${summary.runs.completed} completed · ${summary.runs.failed} with issues`
            : 'Available after the first run'}
        </p>
      </article>

      <article className="kpi-card actions-completed">
        <div className="kpi-header">
          <span className="kpi-icon-wrap">
            <CheckCircle2 className="kpi-icon" size={14} />
          </span>
          <span className="kpi-label">Actions completed</span>
        </div>
        <div className="kpi-visualization" aria-hidden="true">
          <div className="stacked-mini-bars">
            {ACTION_BARS.map((bar, index) => (
              <div className="mini-bar-item" key={bar.key}>
                <div className="mini-bar" style={{ height: `${Math.max(heights[index] ?? 0, 4)}%`, background: bar.color, opacity: (heights[index] ?? 0) === 0 ? 0.28 : 1 }} />
                <span className="mini-bar-label">{bar.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="kpi-value">{actionsTotal}</div>
        <p className="kpi-helper">{actionsTotal > 0 ? impactLine(summary) : 'Measured after successful actions'}</p>
      </article>

      <Button type="button" className={`kpi-card pending-approvals ${pending ? 'attention' : ''}`} onClick={onApprovals}>
        <div className="kpi-header">
          <span className="kpi-icon-wrap">
            <Bell className="kpi-icon" size={14} />
          </span>
          <span className="kpi-label">Pending approvals</span>
        </div>
        <div className="kpi-visualization" aria-hidden="true">
          <div className="approval-dots">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className={`approval-dot ${index < Math.min(pending, 10) ? 'pending' : ''}`} />
            ))}
          </div>
          <div className={`approval-status ${pending ? 'waiting' : ''}`}>
            <span className="approval-status-icon">{pending ? '!' : '✓'}</span>
            {pending ? 'Needs review' : 'All clear!'}
          </div>
        </div>
        <div className="kpi-value">{pending}</div>
        <p className="kpi-helper">{pending ? 'Review required' : 'No actions waiting'}</p>
      </Button>
    </section>
  )
}

function SuccessGauge({ rate, uid }: { rate: number | null; uid: string }): JSX.Element {
  const pct = rate === null ? 0 : Math.max(0, Math.min(100, rate))
  const radius = 40
  const circumference = Math.PI * radius
  const dash = (pct / 100) * circumference
  return (
    <svg width="100%" height="60" viewBox="0 0 100 60">
      <defs>
        <linearGradient id={`successGradient-${uid}`}>
          <stop offset="0%" stopColor="rgb(16, 185, 129)" />
          <stop offset="100%" stopColor="rgb(34, 197, 94)" />
        </linearGradient>
      </defs>
      <path d="M 10,50 A 40,40 0 0,1 90,50" fill="none" stroke="currentColor" className="gauge-track" strokeWidth="8" strokeLinecap="round" />
      <path
        d="M 10,50 A 40,40 0 0,1 90,50"
        fill="none"
        stroke={`url(#successGradient-${uid})`}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        opacity={rate === null ? 0 : 1}
      />
    </svg>
  )
}

function impactLine(summary: AutomationSummary | null): string {
  if (!summary) return 'Measured after successful actions'
  const parts = [
    summary.impact.emailsSent ? `${summary.impact.emailsSent} emails` : null,
    summary.impact.customersTagged ? `${summary.impact.customersTagged} tags` : null,
    summary.impact.discountsCreated ? `${summary.impact.discountsCreated} discounts` : null,
    summary.impact.notificationsSent ? `${summary.impact.notificationsSent} notifications` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Measured after successful actions'
}
