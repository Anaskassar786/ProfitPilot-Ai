/**
 * PR #49 — Decision Log page.
 *
 * Timestamped decision timeline with predicted vs actual outcomes, accuracy
 * gauges, quality ratings, lessons learned, and analytics (average
 * accuracy, quality distribution, best decisions, improvement areas).
 */
import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, Trash2, TrendingUp } from 'lucide-react'
import type { DecisionQuality, DecisionType, ExecutiveDecision } from './executive-model.js'
import { executiveDateLabel } from './executive-model.js'
import { deleteExecutiveDecision, fetchExecutiveDecisionAnalytics, fetchExecutiveDecisions, logExecutiveDecision, reviewExecutiveDecision } from './executive-api.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton, ExecutiveStatusPill } from './executive-ui.js'
import { ExecutiveStackedBars } from './executive-charts.js'
import { errorMessageFrom, isUpgradeError } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

const DECISION_TYPES: readonly DecisionType[] = ['PRICING', 'PRODUCT', 'MARKETING', 'INVENTORY', 'STRATEGIC', 'CUSTOM']

type DecisionAnalytics = Readonly<{ total: number; reviewed: number; averageAccuracy: number | null; qualityDistribution: Readonly<Record<string, number>>; bestDecisions: readonly ExecutiveDecision[]; improvementAreas: readonly string[] }>

export function ExecutiveDecisionsPage({ context, plan, gates, onToast, onUpgrade, autoCompose = false }: ExecutivePageProps & { autoCompose?: boolean }) {
  const storeId = context.storeId
  const [decisions, setDecisions] = useState<readonly ExecutiveDecision[]>([])
  const [analytics, setAnalytics] = useState<DecisionAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(autoCompose)
  useEffect(() => { if (autoCompose) setFormOpen(true) }, [autoCompose])
  const [decisionType, setDecisionType] = useState<DecisionType>('STRATEGIC')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [predictedKey, setPredictedKey] = useState('revenueImpact')
  const [predictedValue, setPredictedValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<ExecutiveDecision | null>(null)
  const [actualValue, setActualValue] = useState('')

  const load = async () => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const [rows, stats] = await Promise.all([fetchExecutiveDecisions(storeId), fetchExecutiveDecisionAnalytics(storeId)])
      setDecisions(rows)
      setAnalytics(stats)
    } catch (err: unknown) { setError(errorMessageFrom(err)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [storeId])

  const create = async () => {
    if (!storeId || !title.trim()) return
    setSaving(true)
    try {
      const predictedOutcome = predictedValue.trim() !== '' && Number.isFinite(Number(predictedValue)) ? { [predictedKey || 'outcome']: Number(predictedValue) } : null
      await logExecutiveDecision(storeId, { decisionType, title: title.trim(), description: description.trim(), decisionDate: new Date().toISOString().slice(0, 10), predictedOutcome, actualOutcome: null })
      onToast('Decision logged. Record the actual outcome later to compute its accuracy.', 'success')
      setFormOpen(false)
      setTitle(''); setDescription(''); setPredictedValue('')
      await load()
    } catch (err: unknown) {
      if (isUpgradeError(err)) { onToast(`${errorMessageFrom(err)} — Upgrade Plan to log more decisions.`, 'error'); onUpgrade() } else { onToast(errorMessageFrom(err), 'error') }
    } finally { setSaving(false) }
  }

  const review = async () => {
    if (!storeId || !reviewTarget || actualValue.trim() === '' || !Number.isFinite(Number(actualValue))) return
    try {
      const key = Object.keys(reviewTarget.predictedOutcome ?? {})[0] ?? 'outcome'
      await reviewExecutiveDecision(storeId, reviewTarget.id, { [key]: Number(actualValue) })
      onToast('Outcome recorded — accuracy and lessons updated.', 'success')
      setReviewTarget(null); setActualValue('')
      await load()
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') }
  }

  const remove = async (decision: ExecutiveDecision) => {
    if (!storeId) return
    try {
      await deleteExecutiveDecision(storeId, decision.id)
      onToast('Decision removed.', 'info')
      await load()
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') }
  }

  const qualityBars = useMemo(() => {
    if (!analytics) return []
    const labels: Readonly<Record<DecisionQuality, string>> = { EXCELLENT: 'Excellent', GOOD: 'Good', FAIR: 'Fair', POOR: 'Poor', PENDING: 'Pending' }
    return ([['EXCELLENT', 'positive'], ['GOOD', 'positive'], ['FAIR', 'warning'], ['POOR', 'danger'], ['PENDING', 'neutral']] as const).map(([quality, tone]) => ({
      label: labels[quality],
      segments: [{ key: quality, label: labels[quality], value: analytics.qualityDistribution[quality] ?? 0, tone }],
    }))
  }, [analytics])

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="Decision intelligence"
        title="Decision Log"
        description="Log strategic decisions with predicted outcomes, record what actually happened, and let the accuracy engine grade your forecasting — so the next decision starts wiser."
        actions={<button type="button" className="button primary" onClick={() => setFormOpen(true)}><Plus size={14} /> Log New Decision</button>}
      />
      {loading && <ExecutiveSkeleton rows={5} label="Decisions" />}
      {error && !loading && <ExecutiveErrorState message={error} onRetry={() => void load()} />}
      {formOpen && (
        <ExecutiveSection kicker="New entry" title="Log a decision">
          <div className="exec-scenario-form">
            <label>Decision type
              <select value={decisionType} onChange={(event) => setDecisionType(event.target.value as DecisionType)}>
                {DECISION_TYPES.map((type) => <option key={type} value={type}>{type.toLowerCase()}</option>)}
              </select>
            </label>
            <label>Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Raise prices 5% on top SKUs" maxLength={160} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>Description
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Context and reasoning (optional)" maxLength={800} />
            </label>
            <label>Predicted outcome metric
              <input value={predictedKey} onChange={(event) => setPredictedKey(event.target.value)} placeholder="revenueImpact" maxLength={60} />
            </label>
            <label>Predicted value
              <input type="number" value={predictedValue} onChange={(event) => setPredictedValue(event.target.value)} placeholder="e.g. 5000" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="button" className="button primary" onClick={() => void create()} disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Log decision'}</button>
            <button type="button" className="button secondary" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </ExecutiveSection>
      )}
      {analytics && (
        <ExecutiveSection kicker="Forecast quality" title="Decision analytics">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div className="exec-risk-count neutral"><strong>{analytics.total}</strong><span>Total decisions</span></div>
            <div className="exec-risk-count low"><strong>{analytics.reviewed}</strong><span>Reviewed</span></div>
            <div className="exec-risk-count medium"><strong>{analytics.averageAccuracy === null ? '—' : `${Math.round(analytics.averageAccuracy * 100)}%`}</strong><span>Average accuracy</span></div>
            <div className="exec-risk-count critical"><strong>{analytics.bestDecisions.length > 0 ? `${Math.round((analytics.bestDecisions[0]?.accuracyScore ?? 0) * 100)}%` : '—'}</strong><span>Best decision</span></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="exec-kicker" style={{ marginBottom: 8 }}>Quality distribution</div>
            <ExecutiveStackedBars groups={qualityBars} height={110} />
          </div>
          {analytics.improvementAreas.length > 0 && (
            <div>
              <div className="exec-kicker" style={{ marginBottom: 8 }}>Improvement areas</div>
              <ul className="exec-assumptions" style={{ margin: 0 }}>
                {analytics.improvementAreas.map((area, index) => <li key={index}>{area}</li>)}
              </ul>
            </div>
          )}
        </ExecutiveSection>
      )}
      {!loading && !error && decisions.length === 0 && (
        <ExecutiveEmptyState icon={ClipboardList} title="Track your business decisions" description="Every strategic move — price changes, launches, campaigns — becomes a training sample for your next forecast. Start with one decision and record its real outcome in 30 days." action="Log Your First Decision" onAction={() => setFormOpen(true)} />
      )}
      <div className="exec-decision-timeline">
        {decisions.map((decision) => (
          <article className="exec-decision-entry" key={decision.id}>
            <div className="exec-decision-date">{executiveDateLabel(decision.decisionDate)}<small>{decision.decisionType}</small></div>
            <div>
              <h3>{decision.title}</h3>
              {decision.description && <p>{decision.description}</p>}
              <div className="exec-decision-outcomes">
                <div className="exec-decision-outcome">
                  <strong>Predicted</strong>
                  <span>{decision.predictedOutcome ? Object.entries(decision.predictedOutcome).map(([key, value]) => `${key}: ${value}`).join(' · ') : 'not set'}</span>
                </div>
                <div className="exec-decision-outcome">
                  <strong>Actual</strong>
                  <span>{decision.actualOutcome ? Object.entries(decision.actualOutcome).map(([key, value]) => `${key}: ${value}`).join(' · ') : 'pending'}</span>
                </div>
              </div>
              {decision.lessonsLearned && <p className="exec-decision-lessons">{decision.lessonsLearned}</p>}
            </div>
            <div className="exec-decision-side">
              <div className="exec-accuracy-gauge">
                <AccuracyRing score={decision.accuracyScore} />
                <ExecutiveStatusPill status={decision.qualityRating} />
              </div>
              <div className="exec-decision-actions">
                {decision.actualOutcome === null && (
                  <button type="button" className="button secondary" onClick={() => { setReviewTarget(decision); setActualValue('') }}><TrendingUp size={13} /> Add outcome</button>
                )}
                <button type="button" className="icon-button" aria-label="Delete decision" onClick={() => void remove(decision)}><Trash2 size={14} /></button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {reviewTarget && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="section-kicker">RECORD OUTCOME</div>
            <h2>What actually happened?</h2>
            <p style={{ fontSize: 12.5, color: 'var(--exec-body)' }}>{reviewTarget.title}</p>
            <label>Actual value
              <input type="number" autoFocus value={actualValue} onChange={(event) => setActualValue(event.target.value)} placeholder="e.g. 4800" />
            </label>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setReviewTarget(null)}>Cancel</button>
              <button type="button" className="button primary" onClick={() => void review()} disabled={actualValue.trim() === ''}>Save outcome</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AccuracyRing({ score }: { score: number | null }) {
  const radius = 19
  const circumference = 2 * Math.PI * radius
  const percent = score === null ? 0 : Math.min(Math.max(score, 0), 1)
  return (
    <div className="exec-accuracy-ring" title={score === null ? 'Awaiting actual outcome' : `${Math.round(percent * 100)}% accuracy`}>
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="4" />
        <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="4" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent)} transform="rotate(-90 22 22)" strokeLinecap="round" />
      </svg>
      <strong>{score === null ? '—' : `${Math.round(percent * 100)}%`}</strong>
    </div>
  )
}
