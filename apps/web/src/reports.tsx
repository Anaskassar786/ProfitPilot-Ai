import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Download,
  Eye,
  FileBarChart,
  LoaderCircle,
  LockKeyhole,
  Mail,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react'
import { downloadReport, fetchAnalytics, fetchBilling, fetchForecast, fetchReports, generateReport } from './api.js'
import type { AnalyticsSnapshot, WorkspaceContext } from './model.js'
import type { ForecastBundle, ReportRun } from './f8-model.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import {
  buildReportPreview,
  canGenerateReport,
  closedPeriodFor,
  forecastReadiness,
  formatBytes,
  formatPeriodRange,
  formatUtcDate,
  higherPlanHighlights,
  planDisplayName,
  reportAccessFor,
  reportDisplayName,
  reportKindLabel,
  reportStatusView,
  resolveReportPlan,
  usageCopy,
} from './reports-model.js'
import type { ReportKind, ReportPlan, ReportPreview } from './reports-model.js'
import './reports.css'

type ToastKind = 'success' | 'info' | 'warning' | 'error'
type ReportsWorkspaceProps = Readonly<{
  context: WorkspaceContext
  onNavigateBilling?: () => void
  onToast?: (message: string, kind?: ToastKind) => void
}>

export function ReportsWorkspace({ context, onNavigateBilling, onToast }: ReportsWorkspaceProps) {
  const [runs, setRuns] = useState<readonly ReportRun[]>([])
  const [forecast, setForecast] = useState<ForecastBundle | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null)
  const [plan, setPlan] = useState<ReportPlan>('trial')
  const [loading, setLoading] = useState(Boolean(context.storeId))
  const [generating, setGenerating] = useState<ReportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [emailAfterGenerate, setEmailAfterGenerate] = useState(false)
  const [preview, setPreview] = useState<Readonly<{ run: ReportRun; content: ReportPreview }> | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [fileBytes, setFileBytes] = useState<Readonly<Record<string, number>>>({})
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set())
  const [headerKind, setHeaderKind] = useState<ReportKind>('MONTHLY')

  const access = reportAccessFor(plan)
  const visibleRuns = useMemo(() => runs.filter((run) => !hiddenIds.has(run.id)), [runs, hiddenIds])
  const monthlyGate = canGenerateReport(plan, 'MONTHLY', runs)
  const quarterlyGate = canGenerateReport(plan, 'QUARTERLY', runs)
  const customGate = canGenerateReport(plan, 'CUSTOM', runs)
  const readiness = forecastReadiness(forecast)

  const refresh = async () => {
    if (!context.storeId) {
      setRuns([])
      setForecast(null)
      setAnalytics(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const storeId = context.storeId
    const [nextRuns, nextForecast, nextAnalytics, account] = await Promise.allSettled([
      fetchReports(storeId),
      fetchForecast(storeId),
      fetchAnalytics(storeId),
      fetchBilling(storeId),
    ])
    setRuns(nextRuns.status === 'fulfilled' ? nextRuns.value : [])
    setForecast(nextForecast.status === 'fulfilled' ? nextForecast.value : null)
    setAnalytics(nextAnalytics.status === 'fulfilled' ? nextAnalytics.value : null)
    if (account.status === 'fulfilled') setPlan(resolveReportPlan(account.value.subscription?.plan))
    if (nextRuns.status === 'rejected') setError(errorMessage(nextRuns.reason, 'Reports could not be loaded from your store.'))
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [context.storeId])

  useEffect(() => {
    if (!context.storeId || !runs.some((run) => run.status === 'GENERATING')) return
    const timer = window.setInterval(() => {
      void fetchReports(context.storeId!).then(setRuns).catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [context.storeId, runs])

  const notify = (message: string, kind: ToastKind = 'success') => onToast?.(message, kind)

  const generate = async (kind: ReportKind) => {
    if (!context.storeId) {
      notify('Connect Shopify before generating a report.', 'info')
      return
    }
    const gate = canGenerateReport(plan, kind, runs)
    if (!gate.allowed) {
      setError(gate.reason)
      notify(gate.reason ?? 'Upgrade Plan to generate this report.', 'warning')
      return
    }
    if (kind === 'CUSTOM') {
      setCustomOpen(true)
      return
    }
    await runGenerate(kind)
  }

  const runGenerate = async (kind: ReportKind, custom?: Readonly<{ start: string; end: string }>) => {
    if (!context.storeId) return
    setGenerating(kind)
    setError(null)
    try {
      const period = closedPeriodFor(kind, new Date(), custom)
      const email = access.email && emailAfterGenerate
      const generated = await generateReport(context.storeId, kind === 'CUSTOM' ? 'MONTHLY' : kind, period.start, period.end, email)
      if (generated.file) {
        setFileBytes((current) => ({ ...current, [generated.run.id]: Math.round((generated.file!.bodyBase64.length * 3) / 4) }))
        downloadBase64(generated.file.bodyBase64, friendlyDownloadName(generated.run), generated.file.contentType)
      }
      setRuns((current) => [generated.run, ...current.filter((run) => run.id !== generated.run.id)])
      notify(email ? 'Report generated from your real store data and queued for email.' : 'Report generated from your real store data.', 'success')
      setCustomOpen(false)
    } catch (failure: unknown) {
      const message = errorMessage(failure, 'The report could not be generated.')
      setError(message)
      notify(message, 'error')
    } finally {
      setGenerating(null)
    }
  }

  const download = async (run: ReportRun) => {
    if (!context.storeId || run.status !== 'COMPLETED') return
    setBusyId(run.id)
    setError(null)
    try {
      const file = await downloadReport(context.storeId, run.id)
      setFileBytes((current) => ({ ...current, [run.id]: file.bytes }))
      downloadBase64(file.bodyBase64, friendlyDownloadName(run), file.contentType)
      notify('PDF download started.', 'success')
    } catch (failure: unknown) {
      const message = errorMessage(failure, 'The report file is not ready to download.')
      setError(message)
      notify(message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const emailRun = async (run: ReportRun) => {
    if (!access.email) {
      onNavigateBilling?.()
      return
    }
    if (!context.storeId) return
    setBusyId(run.id)
    try {
      const generated = await generateReport(context.storeId, run.frequency, run.period.start, run.period.end, true)
      await refresh()
      if (generated.run.emailStatus === 'SENT') {
        notify('Report emailed to your verified merchant address.', 'success')
      } else if (generated.run.emailStatus === 'FAILED') {
        const message = 'Email delivery failed — check your email configuration and retry.'
        setError(message)
        notify(message, 'error')
      } else {
        notify('Email delivery is not available yet.', 'info')
      }
    } catch (failure: unknown) {
      const message = errorMessage(failure, 'Email delivery is not available yet.')
      setError(message)
      notify(message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const retryRun = async (run: ReportRun) => {
    if (!context.storeId) return
    setBusyId(run.id)
    try {
      await generateReport(context.storeId, run.frequency, run.period.start, run.period.end, access.email && emailAfterGenerate)
      await refresh()
      notify('Retry started from your real store data.', 'info')
    } catch (failure: unknown) {
      notify(errorMessage(failure, 'The report could not be retried.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const openPreview = (run: ReportRun) => {
    setPreview({ run, content: buildReportPreview(run, analytics, forecast) })
  }

  const submitCustom = () => {
    try {
      void runGenerate('CUSTOM', { start: customStart, end: customEnd })
    } catch (failure: unknown) {
      setError(errorMessage(failure, 'Choose a closed date range.'))
    }
  }

  return (
    <div className="reports-page">
      <header className="reports-header">
        <div className="reports-heading">
          <span className="reports-page-icon" aria-hidden="true"><FileBarChart size={22} /></span>
          <div>
            <p className="reports-eyebrow">Business Reports</p>
            <h1>Business Reports</h1>
            <p>Generate professional reports from your real store data. Your reports are computed from actual Shopify data — every number is real, every forecast is grounded.</p>
          </div>
        </div>
        <div className="reports-toolbar">
          <label className="reports-kind-select">
            <span className="sr-only">Report type</span>
            <select aria-label="Report type" value={headerKind} onChange={(event) => setHeaderKind(event.target.value as ReportKind)}>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </label>
          <button type="button" className="button primary" onClick={() => void generate(headerKind)} disabled={generating !== null || !context.storeId}>
            {generating ? <LoaderCircle className="spin" size={15} /> : <FileBarChart size={15} />}
            Generate Report
          </button>
          <button type="button" className="button secondary" onClick={() => setSettingsOpen(true)} aria-label="Report settings">
            <Settings size={15} /> Settings
          </button>
        </div>
      </header>

      <section className="reports-plan-card" aria-label="Plan status">
        <div>
          <span className="reports-kicker"><Sparkles size={12} /> Your plan</span>
          <strong>{planDisplayName(plan)}</strong>
          <p>{usageCopy(plan, runs)}</p>
        </div>
        <div className="reports-plan-actions">
          {plan !== 'commander' && <UpgradePlanButton plan={plan} onUpgrade={() => onNavigateBilling?.()} />}
        </div>
      </section>

      {error && <div className="reports-alert" role="alert"><AlertTriangle size={15} />{error}</div>}

      <section className="reports-section">
        <div className="reports-section-head">
          <div>
            <span className="reports-kicker">Generate reports</span>
            <h2>Create reports from your real store data</h2>
          </div>
        </div>
        <div className="reports-type-grid">
          <GenerateCard
            kind="MONTHLY"
            description="Last closed month-to-date overview from synced orders."
            gate={monthlyGate}
            generating={generating === 'MONTHLY'}
            plan={plan}
            onGenerate={() => void generate('MONTHLY')}
            onUpgrade={() => onNavigateBilling?.()}
          />
          <GenerateCard
            kind="QUARTERLY"
            description="Quarter overview with trends from real closed weeks."
            gate={quarterlyGate}
            generating={generating === 'QUARTERLY'}
            locked={!quarterlyGate.allowed && quarterlyGate.limit === 0}
            plan={plan}
            onGenerate={() => void generate('QUARTERLY')}
            onUpgrade={() => onNavigateBilling?.()}
          />
          <GenerateCard
            kind="CUSTOM"
            description="Choose your own closed date range."
            gate={customGate}
            generating={generating === 'CUSTOM'}
            locked={!customGate.allowed}
            plan={plan}
            onGenerate={() => void generate('CUSTOM')}
            onUpgrade={() => onNavigateBilling?.()}
          />
        </div>
      </section>

      <section className="reports-section">
        <div className="reports-section-head">
          <div>
            <span className="reports-kicker">Your reports</span>
            <h2>Recent reports generated</h2>
          </div>
          <button type="button" className="button secondary" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
        {loading && visibleRuns.length === 0 ? (
          <div className="reports-empty"><LoaderCircle className="spin" size={18} /><span>Loading reports from your store…</span></div>
        ) : visibleRuns.length === 0 ? (
          <div className="reports-empty">
            <FileBarChart size={22} />
            <strong>No reports generated yet</strong>
            <span>Generate a monthly report to see it here. Nothing is invented — the vault stays empty until you create one from real store data.</span>
          </div>
        ) : (
          <div className="reports-vault">
            {visibleRuns.map((run) => (
              <ReportCard
                key={run.id}
                run={run}
                bytes={fileBytes[run.id] ?? null}
                emailAllowed={access.email}
                busy={busyId === run.id}
                onDownload={() => void download(run)}
                onEmail={() => void emailRun(run)}
                onPreview={() => openPreview(run)}
                onRetry={() => void retryRun(run)}
                onDelete={() => setHiddenIds((current) => new Set([...current, run.id]))}
                onUpgrade={() => onNavigateBilling?.()}
              />
            ))}
          </div>
        )}
      </section>

      <section className="reports-section reports-methodology">
        <div className="reports-section-head">
          <div>
            <span className="reports-kicker">Forecast methodology</span>
            <h2>How your reports are calculated</h2>
          </div>
        </div>
        <div className="reports-method-body">
          <p>Your reports use deterministic forecasting grounded in synced store activity:</p>
          <ul>
            <li>Based on your actual synced orders</li>
            <li>Revenue trends from real data</li>
            <li>Customer patterns from real behavior</li>
            <li>Inventory status from real levels</li>
          </ul>
          <div className={`reports-data-need ${readiness.ready ? 'ready' : 'building'}`}>
            {readiness.ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <div>
              <strong>{readiness.ready ? 'Forecast baseline ready' : 'Minimum data needed'}</strong>
              <span>{readiness.detail}</span>
            </div>
          </div>
          {forecast?.revenue && (
            <div className="reports-forecast-band">
              <span>Projected closed-week revenue</span>
              <strong>{forecast.revenue.value.toLocaleString()}</strong>
              <small>{forecast.revenue.lower.toLocaleString()} – {forecast.revenue.upper.toLocaleString()} from your synced orders</small>
            </div>
          )}
          <button type="button" className="text-button" onClick={() => setMethodologyOpen((open) => !open)}>
            {methodologyOpen ? 'Hide methodology' : 'Learn more about our methodology'} →
          </button>
          {methodologyOpen && (
            <div className="reports-method-more">
              <p>We never invent a number. If a closed period has no synced rows, the report states that the metric is not yet measurable. Forecast bands only appear after two closed weekly periods exist in your store data.</p>
              <p>PDF regeneration for the same closed period is idempotent — you get the same file, not a second invented version.</p>
            </div>
          )}
        </div>
      </section>

      {plan !== 'commander' && (
        <section className="reports-unlock">
          <LockKeyhole size={16} />
          <div>
            <strong>Unlock more reporting</strong>
            <p>{higherPlanHighlights(plan).join(' · ')}</p>
          </div>
          <UpgradePlanButton plan={plan} onUpgrade={() => onNavigateBilling?.()} />
        </section>
      )}

      {settingsOpen && (
        <div className="reports-modal-overlay">
          <div className="reports-modal" role="dialog" aria-labelledby="reports-settings-title">
            <header>
              <h3 id="reports-settings-title">Report settings</h3>
              <button type="button" className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={16} /></button>
            </header>
            <label className="reports-toggle-row">
              <span>
                <strong>Email new reports</strong>
                <small>{access.email ? 'Send each generated PDF to your verified merchant address.' : 'Email delivery unlocks when you Upgrade Plan.'}</small>
              </span>
              {access.email ? (
                <input type="checkbox" checked={emailAfterGenerate} onChange={(event) => setEmailAfterGenerate(event.target.checked)} />
              ) : (
                <UpgradePlanButton plan={plan} onUpgrade={() => { setSettingsOpen(false); onNavigateBilling?.() }} />
              )}
            </label>
            <label className="reports-toggle-row">
              <span>
                <strong>White-label PDFs</strong>
                <small>{access.whiteLabel ? 'Included on your plan.' : 'Remove ProfitPilot branding from downloaded PDFs.'}</small>
              </span>
              {!access.whiteLabel && <UpgradePlanButton plan={plan} onUpgrade={() => { setSettingsOpen(false); onNavigateBilling?.() }} />}
            </label>
            <p className="reports-fine-print"><ShieldCheck size={13} /> Reports stay tenant-scoped to this Shopify store. No demo numbers are stored.</p>
          </div>
        </div>
      )}

      {customOpen && (
        <div className="reports-modal-overlay">
          <div className="reports-modal" role="dialog" aria-labelledby="reports-custom-title">
            <header>
              <h3 id="reports-custom-title">Custom report range</h3>
              <button type="button" className="icon-button" onClick={() => setCustomOpen(false)} aria-label="Close custom range"><X size={16} /></button>
            </header>
            {customGate.allowed ? (
              <>
                <p>Choose a closed date range. Today is excluded so every figure stays grounded in completed days.</p>
                <div className="reports-custom-fields">
                  <label>Start date<input type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} /></label>
                  <label>End date<input type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} /></label>
                </div>
                <div className="reports-modal-actions">
                  <button type="button" className="button secondary" onClick={() => setCustomOpen(false)}>Cancel</button>
                  <button type="button" className="button primary" onClick={submitCustom} disabled={!customStart || !customEnd || generating === 'CUSTOM'}>
                    {generating === 'CUSTOM' ? <LoaderCircle className="spin" size={14} /> : <CalendarRange size={14} />}
                    Generate
                  </button>
                </div>
              </>
            ) : (
              <div className="reports-locked-note">
                <LockKeyhole size={18} />
                <p>Custom date ranges unlock when you Upgrade Plan.</p>
                <UpgradePlanButton plan={plan} onUpgrade={() => { setCustomOpen(false); onNavigateBilling?.() }} />
              </div>
            )}
          </div>
        </div>
      )}

      {preview && (
        <div className="reports-modal-overlay">
          <div className="reports-modal reports-preview" role="dialog" aria-labelledby="reports-preview-title">
            <header>
              <div>
                <span className="reports-kicker">Report preview</span>
                <h3 id="reports-preview-title">{preview.content.title}</h3>
                <small>{preview.content.periodLabel}</small>
              </div>
              <button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label="Close preview"><X size={16} /></button>
            </header>
            <p>{preview.content.summary}</p>
            <div className="reports-preview-metrics">
              {preview.content.metrics.map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value ?? 'Not yet measurable'}</strong>
                  <small>{metric.source}</small>
                </div>
              ))}
            </div>
            <div className="reports-preview-chart" aria-label="Revenue chart preview">
              <span className="reports-kicker"><BarChart3 size={12} /> Revenue in this period</span>
              {preview.content.revenuePoints.length === 0 ? (
                <p className="reports-muted">No closed-period revenue rows are synced for this range.</p>
              ) : (
                <div className="reports-spark">
                  {preview.content.revenuePoints.map((point) => {
                    const max = Math.max(...preview.content.revenuePoints.map((item) => item.value), 1)
                    return <i key={point.day} style={{ height: `${Math.max(8, Math.round((point.value / max) * 100))}%` }} title={`${point.day}: ${point.value}`} />
                  })}
                </div>
              )}
            </div>
            <div className="reports-preview-split">
              <div>
                <span className="reports-kicker">Top products</span>
                {preview.content.topProducts.length === 0 ? <p className="reports-muted">No product sales rows in this closed period.</p> : preview.content.topProducts.map((product) => (
                  <div className="reports-preview-row" key={product.title}><span>{product.title}</span><strong>{product.value.toLocaleString()}</strong></div>
                ))}
              </div>
              <div>
                <span className="reports-kicker">Customer summary</span>
                {preview.content.customers.map((metric) => (
                  <div className="reports-preview-row" key={metric.label}><span>{metric.label}</span><strong>{metric.value ?? 'Not yet measurable'}</strong></div>
                ))}
              </div>
            </div>
            <div className="reports-modal-actions">
              <button type="button" className="button secondary" onClick={() => setPreview(null)}>Close</button>
              <button type="button" className="button primary" onClick={() => void download(preview.run)} disabled={preview.run.status !== 'COMPLETED'}>
                <Download size={14} /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GenerateCard({
  kind,
  description,
  gate,
  generating,
  locked = false,
  plan,
  onGenerate,
  onUpgrade,
}: {
  kind: ReportKind
  description: string
  gate: ReturnType<typeof canGenerateReport>
  generating: boolean
  locked?: boolean
  plan: ReportPlan
  onGenerate: () => void
  onUpgrade: () => void
}) {
  const Icon = kind === 'QUARTERLY' ? TrendingUp : kind === 'CUSTOM' ? CalendarRange : BarChart3
  return (
    <article className={`reports-type-card ${locked ? 'locked' : ''}`}>
      <span className="reports-type-icon"><Icon size={18} /></span>
      <h3>{reportKindLabel(kind)}</h3>
      <p>{description}</p>
      {gate.limit !== null && gate.limit > 0 && <small>{gate.used}/{gate.limit} used</small>}
      {locked ? (
        <div className="reports-locked-actions">
          <span><LockKeyhole size={13} /> Included when you Upgrade Plan</span>
          <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
        </div>
      ) : (
        <button type="button" className="button primary" onClick={onGenerate} disabled={generating || !gate.allowed} title={gate.reason ?? undefined}>
          {generating ? <LoaderCircle className="spin" size={14} /> : <FileBarChart size={14} />}
          Generate
        </button>
      )}
    </article>
  )
}

function ReportCard({
  run,
  bytes,
  emailAllowed,
  busy,
  onDownload,
  onEmail,
  onPreview,
  onRetry,
  onDelete,
  onUpgrade,
}: {
  run: ReportRun
  bytes: number | null
  emailAllowed: boolean
  busy: boolean
  onDownload: () => void
  onEmail: () => void
  onPreview: () => void
  onRetry: () => void
  onDelete: () => void
  onUpgrade: () => void
}) {
  const status = reportStatusView(run)
  const name = reportDisplayName(run)
  return (
    <article className="reports-run-card">
      <div className="reports-run-main">
        <span className="reports-type-icon compact">{run.frequency === 'QUARTERLY' ? <TrendingUp size={16} /> : <BarChart3 size={16} />}</span>
        <div>
          <h3>{name}</h3>
          <p>
            Generated: {formatUtcDate(run.createdAt)} · Period: {formatPeriodRange(run.period.start, run.period.end)}
            {bytes !== null ? ` · ${formatBytes(bytes)}` : ''}
          </p>
        </div>
      </div>
      <div className={`reports-status ${status.tone}`}>
        {status.tone === 'generating' ? <LoaderCircle className="spin" size={13} /> : status.tone === 'failed' ? <AlertTriangle size={13} /> : status.tone === 'emailed' ? <Mail size={13} /> : <CheckCircle2 size={13} />}
        {status.label}
      </div>
      <div className="reports-run-actions">
        {run.status === 'COMPLETED' && (
          <>
            <button type="button" className="button primary" onClick={onDownload} disabled={busy}><Download size={13} /> Download PDF</button>
            <button type="button" className="button secondary" onClick={onPreview}><Eye size={13} /> Preview</button>
            {emailAllowed ? (
              <button type="button" className="button secondary" onClick={onEmail} disabled={busy}><Mail size={13} /> Email</button>
            ) : (
              <button type="button" className="button secondary" onClick={onUpgrade}><Mail size={13} /> Upgrade Plan</button>
            )}
          </>
        )}
        {run.status === 'GENERATING' && <button type="button" className="button secondary" disabled><LoaderCircle className="spin" size={13} /> Processing…</button>}
        {run.status === 'FAILED' && <button type="button" className="button secondary" onClick={onRetry} disabled={busy}><RotateCcw size={13} /> Retry</button>}
        <button type="button" className="icon-button" onClick={onDelete} aria-label={`Remove ${name} from this view`}><Trash2 size={14} /></button>
      </div>
    </article>
  )
}

function friendlyDownloadName(run: ReportRun): string {
  return `${reportDisplayName(run).replace(/[^\w]+/g, '-')}.pdf`
}

function downloadBase64(base64: string, filename: string, contentType: string): void {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}
