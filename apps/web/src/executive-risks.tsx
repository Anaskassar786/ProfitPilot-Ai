/**
 * PR #49 — Risk Radar page.
 *
 * Severity overview, probability × impact bubble map, and detailed risk
 * cards with mitigation plans and resolution controls. All risks are
 * detected deterministically from real rows — an all-clear is a real
 * all-clear, not an empty screen.
 */
import { useEffect, useMemo, useState } from 'react'
import { Radar, RefreshCw, ShieldCheck } from 'lucide-react'
import type { ExecutiveRisk } from './executive-model.js'
import { executiveDateLabel, formatExecutiveMoney, formatExecutiveNumber } from './executive-model.js'
import { fetchExecutiveRiskTrends, fetchExecutiveRisks, resolveExecutiveRisk, runExecutiveRiskScan } from './executive-api.js'
import type { BubblePoint } from './executive-charts.js'
import { ExecutiveBubbleMap, ExecutiveHeatmap, ExecutiveSparkline } from './executive-charts.js'
import type { HeatmapCell } from './executive-charts.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton, ExecutiveStatusPill } from './executive-ui.js'
import { errorMessageFrom, isUpgradeError } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

export function ExecutiveRisksPage({ context, plan, gates, onToast, onUpgrade }: ExecutivePageProps) {
  const storeId = context.storeId
  const [risks, setRisks] = useState<readonly ExecutiveRisk[]>([])
  const [trendPoints, setTrendPoints] = useState<readonly Readonly<{ periodStart: string; active: number; critical: number; high: number }>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const load = async () => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const [rows, trends] = await Promise.all([fetchExecutiveRisks(storeId), fetchExecutiveRiskTrends(storeId)])
      setRisks(rows)
      setTrendPoints(trends.points)
    } catch (err: unknown) { setError(errorMessageFrom(err)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [storeId])

  const scan = async () => {
    if (!storeId) return
    setScanning(true)
    try {
      const result = await runExecutiveRiskScan(storeId)
      setRisks(result.risks)
      onToast(result.active > 0 ? `Risk scan complete — ${result.active} active risk${result.active === 1 ? '' : 's'} detected.` : 'Risk scan complete — no significant risks detected. Your diversification is working.', result.active > 0 ? 'warning' : 'success')
      const trends = await fetchExecutiveRiskTrends(storeId)
      setTrendPoints(trends.points)
    } catch (err: unknown) {
      if (isUpgradeError(err)) { onToast(`${errorMessageFrom(err)} — Upgrade Plan for more frequent scans.`, 'error'); onUpgrade() } else { onToast(errorMessageFrom(err), 'error') }
    } finally { setScanning(false) }
  }

  const resolve = async (risk: ExecutiveRisk) => {
    if (!storeId) return
    try {
      await resolveExecutiveRisk(storeId, risk.id)
      onToast('Risk marked resolved. Re-run a scan to verify.', 'success')
      await load()
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') }
  }

  const active = useMemo(() => risks.filter((risk) => risk.status === 'ACTIVE'), [risks])
  const counts = useMemo(() => ({
    critical: active.filter((risk) => risk.severity === 'CRITICAL').length,
    high: active.filter((risk) => risk.severity === 'HIGH').length,
    medium: active.filter((risk) => risk.severity === 'MEDIUM').length,
    low: active.filter((risk) => risk.severity === 'LOW').length,
  }), [active])

  const bubblePoints: readonly BubblePoint[] = useMemo(() => active.map((risk) => ({
    id: risk.id,
    label: risk.title,
    x: Math.min(Math.max(risk.probability, 0.02), 0.98),
    y: Math.min(Math.max(Math.log10(Math.max(risk.impactIfRealized, 10)) / 7, 0.05), 0.95),
    size: risk.severity === 'CRITICAL' ? 16 : risk.severity === 'HIGH' ? 13 : risk.severity === 'MEDIUM' ? 10 : 8,
    tone: risk.severity === 'CRITICAL' ? 'danger' : risk.severity === 'HIGH' ? 'warning' : risk.severity === 'MEDIUM' ? 'accent' : 'positive',
    detail: `${Math.round(risk.probability * 100)}% · ${formatExecutiveMoney(risk.impactIfRealized, risk.impactCurrency, 0)}`,
  })), [active])

  const heatCells: readonly HeatmapCell[] = useMemo(() => {
    const severityAxis = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    const typeAxis = ['CONCENTRATION', 'SEASONAL', 'COMPETITION', 'CASHFLOW', 'OPERATIONAL', 'MARKET']
    return typeAxis.flatMap((type, x) => severityAxis.map((severity, y) => {
      const matching = active.filter((risk) => risk.riskType === type && risk.severity === severity).length
      return { x, y, value: matching, label: matching > 0 ? String(matching) : '' }
    }))
  }, [active])

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="Early warning"
        title="Risk Radar"
        description="Automated detection across concentration, seasonality, competition, cash flow, operations, and market signals — computed from your store's real rows."
        actions={<button type="button" className="button primary" onClick={() => void scan()} disabled={scanning || !storeId}><Radar size={14} /> {scanning ? 'Scanning…' : 'Run Risk Scan'}</button>}
      />
      {loading && <ExecutiveSkeleton rows={5} label="Risk radar" />}
      {error && !loading && <ExecutiveErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && (
        <>
          <div className="exec-risk-overview">
            <div className="exec-risk-count critical"><strong>{counts.critical}</strong><span>Critical</span></div>
            <div className="exec-risk-count high"><strong>{counts.high}</strong><span>High</span></div>
            <div className="exec-risk-count medium"><strong>{counts.medium}</strong><span>Medium</span></div>
            <div className="exec-risk-count low"><strong>{counts.low}</strong><span>Low</span></div>
          </div>
          {risks.length === 0 && (
            <ExecutiveEmptyState
              icon={ShieldCheck}
              title="Your business shows no significant risks currently"
              description="A well-diversified business was detected: revenue, customers, cash flow, and inventory show no concentration or volatility beyond healthy bands. Re-scan after major changes."
              action="Run First Scan"
              onAction={() => void scan()}
            />
          )}
          {risks.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                <ExecutiveSection kicker="Probability × impact" title="Risk map">
                  {bubblePoints.length > 0 ? <ExecutiveBubbleMap points={bubblePoints} xLabel="Probability →" yLabel="Impact →" /> : <p className="exec-muted-note">No active risks to map — the radar is clear.</p>}
                </ExecutiveSection>
                <ExecutiveSection kicker="Type × severity" title="Exposure matrix">
                  <ExecutiveHeatmap cells={heatCells} xLabels={['Concentration', 'Seasonal', 'Competition', 'Cash flow', 'Operational', 'Market']} yLabels={['Low', 'Medium', 'High', 'Critical']} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <ExecutiveSparkline points={trendPoints.map((point) => point.active)} width={120} height={30} tone="var(--exec-danger)" />
                    <span className="exec-muted-note">Active risk count over scan history ({trendPoints.length} scans)</span>
                  </div>
                </ExecutiveSection>
              </div>
              <div className="exec-risk-list">
                {risks.map((risk) => (
                  <article className={`exec-risk-card severity-${risk.severity} ${risk.status !== 'ACTIVE' ? 'resolved' : ''}`} key={risk.id}>
                    <div className="exec-risk-head">
                      <div>
                        <span className="exec-opportunity-category">{risk.riskType}</span>
                        <h3>{risk.title}</h3>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <ExecutiveStatusPill status={risk.severity} />
                        <ExecutiveStatusPill status={risk.status} />
                      </div>
                    </div>
                    <p>{risk.description}</p>
                    <div className="exec-risk-numbers">
                      <span>Probability <strong>{formatExecutiveNumber(Math.round(risk.probability * 100), 0)}%</strong></span>
                      <span>Potential impact <strong>{formatExecutiveMoney(risk.impactIfRealized, risk.impactCurrency, 0)}</strong></span>
                      <span>Detected <strong>{executiveDateLabel(risk.detectedAt)}</strong></span>
                    </div>
                    {risk.mitigationPlan.length > 0 && (
                      <div>
                        <div className="exec-kicker" style={{ marginBottom: 4 }}>Mitigation plan</div>
                        <ol className="exec-mitigation-list">
                          {risk.mitigationPlan.map((step, index) => <li key={index}>{step.step} <em style={{ color: 'var(--exec-muted)', fontStyle: 'normal' }}>({step.timeline})</em></li>)}
                        </ol>
                      </div>
                    )}
                    {risk.status === 'ACTIVE' && (
                      <div>
                        <button type="button" className="button secondary" onClick={() => void resolve(risk)}><ShieldCheck size={13} /> Mark resolved</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
