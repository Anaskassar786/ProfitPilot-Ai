/**
 * PR #49 — Business Health Diagnosis page.
 *
 * Large health gauge, eight vital signs with status pills and trends,
 * diagnosed conditions, prescriptions, and the real score history trend.
 */
import { Button } from './polaris-ui.js'
import { useEffect, useState } from 'react'
import { Activity, HeartPulse, RefreshCw, Stethoscope } from './icons.js'
import type { ExecutiveHealthDiagnosis } from './executive-model.js'
import { executiveDateLabel } from './executive-model.js'
import { fetchExecutiveHealth, fetchExecutiveHealthTrends, runExecutiveDiagnosis } from './executive-api.js'
import { ExecutiveRadialGauge, ExecutiveSparkline, ExecutiveTrendArrow } from './executive-charts.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton, ExecutiveStatusPill } from './executive-ui.js'
import { errorMessageFrom, isUpgradeError } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

export function ExecutiveHealthPage({ context, plan, gates, onToast, onUpgrade }: ExecutivePageProps) {
  const storeId = context.storeId
  const [diagnosis, setDiagnosis] = useState<ExecutiveHealthDiagnosis | null>(null)
  const [trends, setTrends] = useState<readonly Readonly<{ diagnosedAt: string; score: number; status: string }>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const load = async () => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const [current, trendResult] = await Promise.all([fetchExecutiveHealth(storeId), fetchExecutiveHealthTrends(storeId)])
      setDiagnosis(current)
      setTrends(trendResult.points)
    } catch (err: unknown) { setError(errorMessageFrom(err)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [storeId])

  const diagnose = async () => {
    if (!storeId) return
    setRunning(true)
    try {
      const next = await runExecutiveDiagnosis(storeId)
      setDiagnosis(next)
      onToast(`Health diagnosis recorded — ${next.overallScore}/100 (${next.overallStatus}).`, 'success')
      const trendResult = await fetchExecutiveHealthTrends(storeId)
      setTrends(trendResult.points)
    } catch (err: unknown) {
      if (isUpgradeError(err)) { onToast(`${errorMessageFrom(err)} — Upgrade Plan for more diagnoses.`, 'error'); onUpgrade() } else { onToast(errorMessageFrom(err), 'error') }
    } finally { setRunning(false) }
  }

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="Business checkup"
        title="Business Health Diagnosis"
        description="Eight vital signs computed from real store rows — revenue growth, retention, inventory turnover, cash conversion, marketing ROI, product diversity, order velocity, and acquisition."
        actions={<Button type="button" className="button primary" onClick={() => void diagnose()} disabled={running || !storeId}><Stethoscope size={14} /> {running ? 'Diagnosing…' : 'Run Diagnosis'}</Button>}
      />
      {loading && <ExecutiveSkeleton rows={6} label="Health diagnosis" />}
      {error && !loading && <ExecutiveErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && (
        <>
          {!diagnosis && (
            <ExecutiveEmptyState
              icon={HeartPulse}
              title="No diagnosis recorded yet"
              description="Run your first business checkup. It rates eight vital signs from synced data, names conditions, and writes prescriptions."
              action="Run Diagnosis"
              onAction={() => void diagnose()}
            />
          )}
          {diagnosis && (
            <div className="exec-health-page">
              <aside className="exec-health-side">
                <ExecutiveSection kicker="Overall health" title="Score">
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <ExecutiveRadialGauge score={diagnosis.overallScore} label={diagnosis.overallStatus} sublabel={executiveDateLabel(diagnosis.diagnosedAt)} size={220} />
                  </div>
                  {diagnosis.nextDiagnosisDue && <p className="exec-muted-note" style={{ textAlign: 'center', margin: '10px 0 0' }}>Next diagnosis due {executiveDateLabel(diagnosis.nextDiagnosisDue)}</p>}
                </ExecutiveSection>
                <ExecutiveSection kicker="Score history" title="Trend">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ExecutiveSparkline points={trends.map((point) => point.score)} width={150} height={40} />
                    <div>
                      {trends.length > 0 && <strong style={{ fontFamily: 'var(--exec-serif)', fontSize: 18, color: 'var(--exec-heading)' }}>{trends.at(-1)!.score}</strong>}
                      <div style={{ fontSize: 12.5, color: 'var(--exec-muted)' }}>{trends.length} recorded diagnosis{trends.length === 1 ? '' : 'es'}</div>
                    </div>
                  </div>
                </ExecutiveSection>
                <ExecutiveSection kicker="Plan allowance" title="Usage">
                  <div className="exec-usage-row" style={{ gridTemplateColumns: '1fr auto' }}>
                    <span>Diagnoses this month</span>
                    <span className="exec-usage-value">{gates.health?.used ?? 0} / {gates.health?.limit ?? 'unlimited'}</span>
                  </div>
                </ExecutiveSection>
              </aside>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <ExecutiveSection kicker="Vital signs" title="Eight-metric examination">
                  <div className="exec-vitals-grid">
                    {diagnosis.vitalSigns.map((vital) => (
                      <div className="exec-vital" key={vital.key}>
                        <div className="exec-vital-top">
                          <strong>{vital.label}</strong>
                          <ExecutiveTrendArrow trend={vital.trend} />
                        </div>
                        <span className="exec-vital-value">{vital.formattedValue}</span>
                        <ExecutiveStatusPill status={vital.status} />
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--exec-muted)', lineHeight: 1.5 }}>{vital.explanation}</p>
                      </div>
                    ))}
                  </div>
                </ExecutiveSection>
                {diagnosis.conditions.length > 0 && (
                  <ExecutiveSection kicker="Findings" title="Diagnosed conditions">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {diagnosis.conditions.map((condition) => (
                        <div key={condition.key} className={`exec-condition ${condition.severity === 'NEEDS_ATTENTION' ? 'warning' : ''}`}>
                          <strong>{condition.title}</strong>
                          <p>{condition.causes}</p>
                          <em>Treatment — {condition.treatment}</em>
                        </div>
                      ))}
                    </div>
                  </ExecutiveSection>
                )}
                {diagnosis.prescriptions.length > 0 && (
                  <ExecutiveSection kicker="Action plan" title="Prescriptions">
                    <table className="exec-table">
                      <thead><tr><th>Priority</th><th>Prescription</th><th>Timeframe</th></tr></thead>
                      <tbody>
                        {diagnosis.prescriptions.map((prescription, index) => (
                          <tr key={prescription.title}>
                            <td><strong>{String(index + 1).padStart(2, '0')}</strong></td>
                            <td><strong>{prescription.title}</strong><br /><span style={{ fontSize: 12.5 }}>{prescription.action}</span></td>
                            <td><ExecutiveStatusPill status={prescription.timeframe} tone="gold" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ExecutiveSection>
                )}
                <p className="exec-muted-note" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={12} /> All vital signs derive from synced orders, products, and customers. Marketing ROI stays "no data" until ad-channel data is connected — ProfitPilot never assumes a spend figure.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
