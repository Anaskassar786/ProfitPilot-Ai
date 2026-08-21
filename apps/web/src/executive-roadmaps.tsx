/**
 * PR #49 — Strategic Roadmaps page.
 *
 * Active roadmap with milestone timeline, current-milestone highlight,
 * progress bar, milestone completion, and plan-gated horizons (30/60/90,
 * quarterly, yearly). AI generates the milestone plan from the store's
 * facts; the deterministic template covers provider downtime.
 */
import { Button } from './polaris-ui.js'
import { useEffect, useState } from 'react'
import { CheckCircle2, Map, Plus, RefreshCw, Trash2 } from './icons.js'
import type { ExecutiveRoadmap, RoadmapType } from './executive-model.js'
import { executiveDateLabel, executiveRoadmapTypeLabel } from './executive-model.js'
import { createExecutiveRoadmap, deleteExecutiveRoadmap, fetchExecutiveRoadmaps, markExecutiveMilestone } from './executive-api.js'
import { ExecutiveConfidenceBar } from './executive-charts.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton, ExecutiveStatusPill } from './executive-ui.js'
import { errorMessageFrom, isUpgradeError } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

const ROADMAP_TYPES: readonly Readonly<{ type: RoadmapType; label: string; feature: string }>[] = [
  { type: '30_DAY', label: '30-day', feature: 'roadmaps' },
  { type: '60_DAY', label: '60-day', feature: 'roadmap_60' },
  { type: '90_DAY', label: '90-day', feature: 'roadmap_90' },
  { type: 'QUARTERLY', label: 'Quarterly', feature: 'roadmap_quarterly' },
  { type: 'YEARLY', label: 'Yearly', feature: 'roadmap_yearly' },
]

export function ExecutiveRoadmapsPage({ context, plan, gates, onToast, onUpgrade, autoCompose = false }: ExecutivePageProps & { autoCompose?: boolean }) {
  const storeId = context.storeId
  const [roadmaps, setRoadmaps] = useState<readonly ExecutiveRoadmap[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(autoCompose)
  useEffect(() => { if (autoCompose) setFormOpen(true) }, [autoCompose])
  const [roadmapType, setRoadmapType] = useState<RoadmapType>('30_DAY')
  const [goal, setGoal] = useState('')
  const [generating, setGenerating] = useState(false)

  const load = async () => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try { setRoadmaps(await fetchExecutiveRoadmaps(storeId)) } catch (err: unknown) { setError(errorMessageFrom(err)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [storeId])

  const create = async () => {
    if (!storeId) return
    setGenerating(true)
    try {
      const roadmap = await createExecutiveRoadmap(storeId, { roadmapType, ...(goal.trim() ? { goal: goal.trim() } : {}) })
      onToast(`${executiveRoadmapTypeLabel(roadmap.roadmapType)} generated with ${roadmap.milestones.length} milestones.`, 'success')
      setFormOpen(false)
      setGoal('')
      await load()
    } catch (err: unknown) {
      if (isUpgradeError(err)) { onToast(`${errorMessageFrom(err)} — Upgrade Plan for this roadmap horizon.`, 'error'); onUpgrade() } else { onToast(errorMessageFrom(err), 'error') }
    } finally { setGenerating(false) }
  }

  const completeMilestone = async (roadmap: ExecutiveRoadmap, key: string) => {
    if (!storeId) return
    try {
      const updated = await markExecutiveMilestone(storeId, roadmap.id, key)
      setRoadmaps((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
      onToast('Milestone marked complete.', 'success')
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') }
  }

  const remove = async (roadmap: ExecutiveRoadmap) => {
    if (!storeId) return
    try {
      await deleteExecutiveRoadmap(storeId, roadmap.id)
      onToast('Roadmap removed.', 'info')
      await load()
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') }
  }

  const active = roadmaps.filter((roadmap) => roadmap.status === 'ACTIVE')
  const archived = roadmaps.filter((roadmap) => roadmap.status !== 'ACTIVE')

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="Strategic direction"
        title="Strategic Roadmaps"
        description="30/60/90-day, quarterly, and yearly plans with weekly milestones, dependencies, success metrics, and expected outcomes — generated from your current business state."
        actions={<Button type="button" className="button primary" onClick={() => setFormOpen(true)}><Plus size={14} /> Create Roadmap</Button>}
      />
      {loading && <ExecutiveSkeleton rows={4} label="Roadmaps" />}
      {error && !loading && <ExecutiveErrorState message={error} onRetry={() => void load()} />}
      {formOpen && (
        <ExecutiveSection kicker="New roadmap" title="Chart your strategic path">
          <div className="exec-scenario-form">
            <label>Horizon
              <select value={roadmapType} onChange={(event) => setRoadmapType(event.target.value as RoadmapType)}>
                {ROADMAP_TYPES.map((entry) => (
                  <option key={entry.type} value={entry.type} disabled={!gates[entry.feature]?.allowed}>{entry.label}{gates[entry.feature]?.allowed ? '' : ' — requires upgrade'}</option>
                ))}
              </select>
            </label>
            <label>Goal (optional)
              <input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="e.g. Reach 25% repeat purchase rate" maxLength={200} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Button type="button" className="button primary" onClick={() => void create()} disabled={generating || !storeId || !gates[ROADMAP_TYPES.find((entry) => entry.type === roadmapType)?.feature ?? 'roadmaps']?.allowed}>
              {generating ? 'Generating plan…' : 'Generate Roadmap'}
            </Button>
            <Button type="button" className="button secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
          </div>
        </ExecutiveSection>
      )}
      {!loading && !error && roadmaps.length === 0 && (
        <ExecutiveEmptyState
          icon={Map}
          title="Chart your strategic path"
          description="AI generates a personalized plan from your business state: weekly milestones, dependencies, success metrics, and expected outcomes. State a goal for a targeted plan."
          action="Generate Roadmap"
          onAction={() => setFormOpen(true)}
        />
      )}
      {active.map((roadmap) => (
        <RoadmapHero key={roadmap.id} roadmap={roadmap} onComplete={(key) => void completeMilestone(roadmap, key)} onRemove={() => void remove(roadmap)} />
      ))}
      {archived.length > 0 && (
        <ExecutiveSection kicker="Archive" title="Past roadmaps">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {archived.map((roadmap) => (
              <div key={roadmap.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 13px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-md)', background: 'var(--exec-surface-2)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--exec-body)' }}><strong style={{ color: 'var(--exec-heading)' }}>{roadmap.title}</strong> · {executiveRoadmapTypeLabel(roadmap.roadmapType)} · {executiveDateLabel(roadmap.periodStart)}</span>
                <ExecutiveStatusPill status={roadmap.status} />
              </div>
            ))}
          </div>
        </ExecutiveSection>
      )}
    </div>
  )
}

function RoadmapHero({ roadmap, onComplete, onRemove }: { roadmap: ExecutiveRoadmap; onComplete: (key: string) => void; onRemove: () => void }) {
  const progress = Math.round(roadmap.currentProgress * 100)
  return (
    <div className="exec-roadmap-hero">
      <div>
        <div className="exec-kicker">{executiveRoadmapTypeLabel(roadmap.roadmapType)} · {roadmap.periodStart} → {roadmap.periodEnd}</div>
        <h3>{roadmap.title}</h3>
        <p>{roadmap.milestones.length} weekly milestones · generated from your real business state. Mark milestones complete as they land.</p>
        <div style={{ marginTop: 12 }}>
          <ExecutiveConfidenceBar value={roadmap.confidenceScore} />
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {roadmap.expectedOutcomes.map((outcome, index) => <span key={index} className="exec-pill gold"><i />{outcome}</span>)}
        </div>
      </div>
      <div className="exec-roadmap-progress">
        <div className="exec-roadmap-progress-track"><span style={{ width: `${progress}%` }} /></div>
        <div className="exec-roadmap-progress-meta"><span>{progress}% complete</span><span>{roadmap.milestones.filter((milestone) => milestone.status === 'COMPLETE').length} / {roadmap.milestones.length} milestones</span></div>
        <Button type="button" className="button secondary" style={{ alignSelf: 'flex-end', marginTop: 8 }} onClick={onRemove}><Trash2 size={13} /> Remove</Button>
      </div>
      <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
        <div className="exec-milestone-timeline">
          {roadmap.milestones.map((milestone) => (
            <div className={`exec-milestone ${milestone.status.toLowerCase()}`} key={milestone.key}>
              <div>
                <strong>{milestone.title}</strong>
                <small>{executiveDateLabel(milestone.dueDate)}{milestone.dependencies.length > 0 ? ` · after ${milestone.dependencies.join(', ')}` : ''}</small>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <ExecutiveStatusPill status={milestone.status === 'COMPLETE' ? 'COMPLETE' : milestone.status === 'CURRENT' ? 'CURRENT' : 'PENDING'} />
                {milestone.status !== 'COMPLETE' && <Button type="button" className="text-button" onClick={() => onComplete(milestone.key)}><CheckCircle2 size={13} /> Complete</Button>}
              </div>
              {milestone.description && <p>{milestone.description}</p>}
              {milestone.successMetrics.length > 0 && (
                <div className="exec-milestone-metrics">
                  {milestone.successMetrics.map((metric, index) => <span key={index}>{metric}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
