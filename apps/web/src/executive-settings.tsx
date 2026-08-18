/**
 * PR #49 — AI Executive preferences page.
 *
 * Monthly report scheduling, email delivery, risk alert severity, benchmark
 * category, and language. Growth+ gates on email toggles are shown
 * honestly with the upgrade CTA.
 */
import { useEffect, useState } from 'react'
import { Bell, CalendarDays, Mail, Save, SlidersHorizontal } from 'lucide-react'
import type { ExecutivePreferences } from './executive-model.js'
import { fetchExecutivePreferences, saveExecutivePreferences } from './executive-api.js'
import { EXECUTIVE_CATEGORIES } from './executive-benchmarks.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton } from './executive-ui.js'
import { errorMessageFrom } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

export function ExecutiveSettingsPage({ context, plan, gates, onToast, onUpgrade }: ExecutivePageProps) {
  const storeId = context.storeId
  const [preferences, setPreferences] = useState<ExecutivePreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [emailInput, setEmailInput] = useState('')

  const load = async () => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const next = await fetchExecutivePreferences(storeId)
      setPreferences(next)
      setEmailInput(next.reportEmail ?? '')
    } catch (err: unknown) { setError(errorMessageFrom(err)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [storeId])

  const patch = (changes: Readonly<Record<string, unknown>>) => {
    setPreferences((current) => (current ? { ...current, ...changes } : current))
  }

  const save = async () => {
    if (!storeId || !preferences) return
    setSaving(true)
    try {
      const email = emailInput.trim()
      const updated = await saveExecutivePreferences(storeId, {
        monthlyReportEnabled: preferences.monthlyReportEnabled,
        monthlyReportEmailEnabled: preferences.monthlyReportEmailEnabled,
        reportEmail: email === '' ? null : email,
        reportGenerationDay: preferences.reportGenerationDay,
        riskAlertsEnabled: preferences.riskAlertsEnabled,
        riskAlertSeverity: preferences.riskAlertSeverity,
        benchmarkCategory: preferences.benchmarkCategory,
        language: preferences.language,
      })
      setPreferences(updated)
      onToast('Executive preferences saved.', 'success')
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') } finally { setSaving(false) }
  }

  const emailAllowed = plan === 'growth' || plan === 'commander'

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="Boardroom configuration"
        title="Executive Settings"
        description="Schedule your monthly board report, choose the delivery address, set risk alert thresholds, and pick your benchmark category and language."
        actions={<button type="button" className="button primary" onClick={() => void save()} disabled={saving || !storeId || !preferences}><Save size={14} /> {saving ? 'Saving…' : 'Save Preferences'}</button>}
      />
      {loading && <ExecutiveSkeleton rows={4} label="Preferences" />}
      {error && !loading && <ExecutiveErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && preferences && (
        <div className="exec-settings-grid">
          <ExecutiveSection kicker="Monthly board report" title="Reporting schedule">
            <div className="exec-settings-form">
              <div className="exec-setting-row">
                <span>Monthly board report<small>Auto-generates for your store every month</small></span>
                <button type="button" className={`exec-toggle ${preferences.monthlyReportEnabled ? 'on' : ''}`} aria-pressed={preferences.monthlyReportEnabled} onClick={() => patch({ monthlyReportEnabled: !preferences.monthlyReportEnabled })}><span /></button>
              </div>
              <div className="exec-setting-row">
                <span>Generation day<small>Day of the month the report is produced (1-28)</small></span>
                <input type="number" min={1} max={28} value={preferences.reportGenerationDay} style={{ width: 80 }} onChange={(event) => patch({ reportGenerationDay: Math.min(Math.max(Number(event.target.value), 1), 28) })} className="exec-settings-form" />
              </div>
              <div className="exec-setting-row">
                <span>Email the report<small>Delivered on generation day via Brevo</small></span>
                <button type="button" className={`exec-toggle ${preferences.monthlyReportEmailEnabled && emailAllowed ? 'on' : ''}`} aria-pressed={preferences.monthlyReportEmailEnabled} onClick={() => patch({ monthlyReportEmailEnabled: !preferences.monthlyReportEmailEnabled })}><span /></button>
              </div>
              {!emailAllowed && <p className="exec-muted-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Mail size={12} /> Monthly email reports are included from a higher plan. <button type="button" className="text-button" onClick={onUpgrade}><strong>Upgrade Plan</strong></button></p>}
              <div className="exec-setting-row">
                <span>Report email address<small>Where the monthly board report is sent</small></span>
                <input value={emailInput} onChange={(event) => setEmailInput(event.target.value)} placeholder="merchant@example.com" style={{ width: 230 }} className="exec-settings-form" />
              </div>
            </div>
          </ExecutiveSection>
          <ExecutiveSection kicker="Risk alerts" title="Radar notifications">
            <div className="exec-settings-form">
              <div className="exec-setting-row">
                <span>Risk alerts<small>Notify when the radar detects new exposures</small></span>
                <button type="button" className={`exec-toggle ${preferences.riskAlertsEnabled ? 'on' : ''}`} aria-pressed={preferences.riskAlertsEnabled} onClick={() => patch({ riskAlertsEnabled: !preferences.riskAlertsEnabled })}><span /></button>
              </div>
              <div className="exec-setting-row">
                <span>Minimum severity<small>Only alert at this level or above</small></span>
                <select value={preferences.riskAlertSeverity} onChange={(event) => patch({ riskAlertSeverity: event.target.value })} className="exec-settings-form" style={{ width: 140 }}>
                  <option value="all">All severities</option>
                  <option value="HIGH">HIGH and above</option>
                  <option value="CRITICAL">CRITICAL only</option>
                </select>
              </div>
            </div>
          </ExecutiveSection>
          <ExecutiveSection kicker="Benchmarking" title="Industry category">
            <div className="exec-settings-form">
              <div className="exec-setting-row">
                <span>Benchmark category<small>Auto-detected from your catalog by default</small></span>
                <select value={preferences.benchmarkCategory} onChange={(event) => patch({ benchmarkCategory: event.target.value })} className="exec-settings-form" style={{ width: 200 }}>
                  {EXECUTIVE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
            </div>
          </ExecutiveSection>
          <ExecutiveSection kicker="Language" title="Report language">
            <div className="exec-settings-form">
              <div className="exec-setting-row">
                <span>Board report language<small>AI narrative language for generated reports</small></span>
                <select value={preferences.language} onChange={(event) => patch({ language: event.target.value })} className="exec-settings-form" style={{ width: 140 }}>
                  <option value="en">English</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                </select>
              </div>
              <p className="exec-muted-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SlidersHorizontal size={12} /> Metrics and numbers are language-independent — only the narrative text is translated.</p>
            </div>
          </ExecutiveSection>
        </div>
      )}
    </div>
  )
}
