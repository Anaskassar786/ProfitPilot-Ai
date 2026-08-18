/**
 * PR #49 — Scenario Planning page.
 *
 * Pre-built templates, parameterized what-if builder, and results with
 * specific projected numbers, confidence, risk, explicit assumptions, and
 * comparison vs the store's real baseline. Save/delete scenarios; every
 * projection carries its model assumptions visibly.
 */
import { useEffect, useState } from 'react'
import { FlaskConical, RefreshCw, Trash2 } from 'lucide-react'
import type { ExecutiveScenario, ScenarioTemplate } from './executive-model.js'
import { executiveDateLabel, formatExecutiveMoney } from './executive-model.js'
import { deleteExecutiveScenario, fetchExecutiveScenarios, fetchScenarioTemplates, runExecutiveScenario } from './executive-api.js'
import { ExecutiveConfidenceBar, ExecutiveHorizontalBars, ExecutiveRadialGauge, ExecutiveWaterfall } from './executive-charts.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton, ExecutiveStatusPill } from './executive-ui.js'
import { errorMessageFrom, isUpgradeError } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

const UNIT_HINTS: Readonly<Record<string, string>> = {
  currency: 'in your store currency',
  percent: '%',
  count: '',
  multiplier: '×',
}

export function ExecutiveScenariosPage({ context, plan, gates, onToast, onUpgrade }: ExecutivePageProps) {
  const storeId = context.storeId
  const [scenarios, setScenarios] = useState<readonly ExecutiveScenario[]>([])
  const [templates, setTemplates] = useState<readonly ScenarioTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<ScenarioTemplate | null>(null)
  const [inputs, setInputs] = useState<Readonly<Record<string, number>>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ExecutiveScenario | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const [scenarioRows, templateRows] = await Promise.all([fetchExecutiveScenarios(storeId), fetchScenarioTemplates()])
      setScenarios(scenarioRows)
      setTemplates(templateRows)
      setSelectedTemplate((current) => current ?? templateRows[0] ?? null)
      if (templateRows[0]) setInputs(Object.fromEntries(templateRows[0].inputs.map((entry) => [entry.key, entry.default])))
    } catch (err: unknown) { setError(errorMessageFrom(err)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [storeId])

  const chooseTemplate = (template: ScenarioTemplate) => {
    setSelectedTemplate(template)
    setInputs(Object.fromEntries(template.inputs.map((entry) => [entry.key, entry.default])))
    setResult(null)
  }

  const run = async () => {
    if (!storeId || !selectedTemplate) return
    setRunning(true)
    try {
      const scenario = await runExecutiveScenario(storeId, {
        scenarioType: selectedTemplate.scenarioType,
        title: `${selectedTemplate.title} — ${new Date().toISOString().slice(0, 10)}`,
        description: selectedTemplate.description,
        inputs,
      })
      setResult(scenario)
      setScenarios((current) => [scenario, ...current])
      setExpanded(scenario.id)
      onToast('Scenario projected from your real baseline with explicit assumptions.', 'success')
    } catch (err: unknown) {
      if (isUpgradeError(err)) { onToast(`${errorMessageFrom(err)} — Upgrade Plan to run more scenarios.`, 'error'); onUpgrade() } else { onToast(errorMessageFrom(err), 'error') }
    } finally { setRunning(false) }
  }

  const remove = async (scenario: ExecutiveScenario) => {
    if (!storeId) return
    try {
      await deleteExecutiveScenario(storeId, scenario.id)
      setScenarios((current) => current.filter((entry) => entry.id !== scenario.id))
      if (result?.id === scenario.id) setResult(null)
      onToast('Scenario removed.', 'info')
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') }
  }

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="What-if analysis"
        title="Scenario Planning"
        description="Model pricing, product, marketing, inventory, and custom growth moves against your store's real historical baseline. Every projection lists its assumptions."
        actions={<button type="button" className="button secondary" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>}
      />
      <div className="exec-scenarios-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading && <ExecutiveSkeleton rows={5} label="Scenarios" />}
          {error && !loading && <ExecutiveErrorState message={error} onRetry={() => void load()} />}
          {!loading && !error && (
            <>
              <ExecutiveSection kicker="Scenario builder" title={selectedTemplate ? selectedTemplate.title : 'Choose a template'}>
                {selectedTemplate ? (
                  <>
                    <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--exec-body)', lineHeight: 1.55 }}>{selectedTemplate.description}</p>
                    <div className="exec-scenario-form">
                      {selectedTemplate.inputs.map((entry) => (
                        <label key={entry.key}>
                          {entry.label} {UNIT_HINTS[entry.unit] ? <small style={{ fontWeight: 400, color: 'var(--exec-muted)' }}>({UNIT_HINTS[entry.unit]})</small> : null}
                          <input
                            type="number"
                            min={entry.min}
                            max={entry.max}
                            step={entry.step}
                            value={inputs[entry.key] ?? entry.default}
                            onChange={(event) => setInputs((current) => ({ ...current, [entry.key]: Number(event.target.value) }))}
                          />
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                      <button type="button" className="button primary" onClick={() => void run()} disabled={running || !storeId}>
                        <FlaskConical size={14} /> {running ? 'Running scenario…' : 'Run Scenario'}
                      </button>
                      <button type="button" className="button secondary" onClick={() => setResult(null)} disabled={!result}>Clear result</button>
                    </div>
                  </>
                ) : <p className="exec-muted-note">Select a template from the library to configure a scenario.</p>}
              </ExecutiveSection>
              {result && <ScenarioResults scenario={result} onClose={() => setResult(null)} />}
              <ExecutiveSection kicker="Saved analyses" title="Recent scenarios">
                {scenarios.length === 0 ? (
                  <ExecutiveEmptyState icon={FlaskConical} title="Explore what-if scenarios" description="Test a price change, a product launch, or a marketing move. Each result is projected from your real baseline with assumptions you can audit." />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {scenarios.map((scenario) => (
                      <div key={scenario.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-md)', background: 'var(--exec-surface-2)' }}>
                        <button type="button" className="text-button" style={{ flex: 1, textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => { setResult(scenario); setExpanded(scenario.id) }}>
                          <strong style={{ fontSize: 12.5, color: 'var(--exec-heading)' }}>{scenario.title}</strong>
                          <small style={{ display: 'block', color: 'var(--exec-muted)', fontSize: 11 }}>{scenario.scenarioType} · {executiveDateLabel(scenario.createdAt)}</small>
                        </button>
                        <ExecutiveStatusPill status={scenario.riskLevel} />
                        <ExecutiveConfidenceBar value={scenario.confidence} />
                        <button type="button" className="icon-button" aria-label="Delete scenario" onClick={() => void remove(scenario)}><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </ExecutiveSection>
            </>
          )}
        </div>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="exec-kicker" style={{ marginBottom: 2 }}>Template library</div>
          {templates.map((template) => (
            <button key={template.id} type="button" className={`exec-scenario-template ${selectedTemplate?.id === template.id ? 'selected' : ''}`} onClick={() => chooseTemplate(template)}>
              <strong>{template.title}</strong>
              <span>{template.description}</span>
            </button>
          ))}
          <div style={{ marginTop: 8 }}>
            <div className="exec-kicker" style={{ marginBottom: 6 }}>Plan allowance</div>
            <span className="exec-pill neutral"><i />{gates.scenarios?.used ?? 0} / {gates.scenarios?.limit ?? 'unlimited'} scenarios this month</span>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ScenarioResults({ scenario, onClose }: { scenario: ExecutiveScenario; onClose: () => void }) {
  const { baseline, projected, delta, assumptions } = scenario.predictions
  const currency = scenario.predictions.currency ?? 'USD'
  const money = (value: number | null | undefined): string => (value === undefined || value === null ? '—' : formatExecutiveMoney(value, currency, 0))
  const deltaSteps = [
    { label: 'Baseline', value: baseline.monthlyRevenue ?? 0, kind: 'start' as const },
    ...Object.entries(delta).slice(0, 4).map(([key, value]): { label: string; value: number; kind: 'up' | 'down' } => ({
      label: key.replaceAll(/([A-Z])/g, ' $1').replace('monthly Revenue', 'monthly revenue').trim(),
      value: typeof value === 'number' ? value : 0,
      kind: typeof value === 'number' && value >= 0 ? 'up' : 'down',
    })),
  ]
  return (
    <ExecutiveSection kicker="Scenario results" title={scenario.title} action={<button type="button" className="text-button" onClick={onClose}>Close</button>}>
      <div className="exec-scenario-results">
        <div>
          <div className="exec-section-head" style={{ marginBottom: 8 }}>
            <div><div className="exec-kicker">Confidence</div><h3 style={{ fontSize: 14 }}>Model confidence</h3></div>
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            <ExecutiveRadialGauge score={Math.round(scenario.confidence * 100)} label="Confidence" size={140} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className={`exec-pill ${scenario.riskLevel === 'HIGH' ? 'danger' : scenario.riskLevel === 'MEDIUM' ? 'warning' : 'positive'}`}><i />{scenario.riskLevel} risk</span>
              {scenario.narrative && <p style={{ margin: 0, fontSize: 12, color: 'var(--exec-body)', lineHeight: 1.6, fontFamily: 'var(--exec-serif)', fontStyle: 'italic' }}>{scenario.narrative}</p>}
            </div>
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--exec-gold)', lineHeight: 1.6, fontFamily: 'var(--exec-serif)' }}>{scenario.recommendation}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="exec-kicker" style={{ marginBottom: 8 }}>Projected vs baseline</div>
            <ExecutiveHorizontalBars rows={[
              { label: 'Baseline monthly revenue', value: baseline.monthlyRevenue ?? 0, display: money(baseline.monthlyRevenue), tone: 'neutral' },
              { label: 'Projected monthly revenue', value: projected.monthlyRevenue ?? projected.monthlyRevenueAtHorizon ?? 0, display: money(projected.monthlyRevenue ?? projected.monthlyRevenueAtHorizon), tone: 'gold' },
            ]} />
          </div>
          <div>
            <div className="exec-kicker" style={{ marginBottom: 8 }}>Impact waterfall</div>
            <ExecutiveWaterfall steps={deltaSteps.length > 1 ? deltaSteps : [{ label: 'Baseline', value: baseline.monthlyRevenue ?? 0, kind: 'start' }, { label: 'Delta', value: delta.monthlyRevenue ?? 0, kind: delta.monthlyRevenue && delta.monthlyRevenue >= 0 ? 'up' : 'down' }]} formatValue={(value) => money(value)} />
          </div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="exec-kicker" style={{ marginBottom: 6 }}>Assumptions (auditable)</div>
        <ul className="exec-assumptions">{assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
      </div>
    </ExecutiveSection>
  )
}
