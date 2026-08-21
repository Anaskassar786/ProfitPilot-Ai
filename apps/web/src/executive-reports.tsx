/**
 * PR #49 — Board Reports page.
 *
 * Report list grouped by year + full report viewer with sticky section
 * navigation, PDF generation (Commander), email delivery, print view, and
 * the trial's clearly-labeled sample report preview.
 */
import { Button } from './polaris-ui.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, Landmark, Mail, Printer, RefreshCw } from './icons.js'
import type { ExecutiveReport } from './executive-model.js'
import { executiveDateLabel, executiveMonthLabel } from './executive-model.js'
import {
  emailExecutiveReport,
  fetchExecutivePdfJob,
  fetchExecutiveReports,
  generateExecutiveReport,
  generateExecutiveReportPdf,
  markExecutiveReportViewed,
} from './executive-api.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton, ExecutiveStatusPill } from './executive-ui.js'
import { errorMessageFrom } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export function ExecutiveReportsPage({ context, plan, gates, onToast, onUpgrade, initialReportId, autoGenerate = false }: ExecutivePageProps & { initialReportId?: string | null; autoGenerate?: boolean }) {
  const storeId = context.storeId
  const [reports, setReports] = useState<readonly ExecutiveReport[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [emailing, setEmailing] = useState<string | null>(null)
  const [pdfJobId, setPdfJobId] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const pollTimer = useRef<number | null>(null)
  const autoGenerateStarted = useRef(false)

  const load = async () => {
    if (!storeId) return
    setLoadState('loading')
    setError(null)
    try {
      const rows = await fetchExecutiveReports(storeId)
      setReports(rows)
      setSelectedId((current) => current ?? (rows.some((report) => report.id === initialReportId) ? initialReportId ?? null : null) ?? rows[0]?.id ?? null)
      setLoadState('ready')
    } catch (err: unknown) {
      setError(errorMessageFrom(err))
      setLoadState('error')
    }
  }
  useEffect(() => { void load() }, [storeId])

  const selected = useMemo(() => reports.find((report) => report.id === selectedId) ?? null, [reports, selectedId])

  useEffect(() => {
    if (selected && storeId && selected.viewedAt === null) {
      void markExecutiveReportViewed(storeId, selected.id).then((updated) => {
        setReports((current) => current.map((report) => (report.id === updated.id ? updated : report)))
      }).catch(() => undefined)
    }
  }, [selected?.id, storeId])

  useEffect(() => () => { if (pollTimer.current !== null) window.clearInterval(pollTimer.current) }, [])

  const generate = async () => {
    if (!storeId) return
    setGenerating(true)
    try {
      const report = await generateExecutiveReport(storeId, { reportType: 'CUSTOM' })
      onToast('Board report generated from your real store data.', 'success')
      setReports((current) => [report, ...current])
      setSelectedId(report.id)
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') } finally { setGenerating(false) }
  }

  useEffect(() => {
    if (!autoGenerate || autoGenerateStarted.current || loadState !== 'ready' || !storeId) return
    if (gates.reports && !gates.reports.allowed) return
    autoGenerateStarted.current = true
    void generate()
  }, [autoGenerate, loadState, storeId, gates.reports])

  const downloadPdf = async () => {
    if (!storeId || !selected) return
    setPdfBusy(true)
    try {
      const start = await generateExecutiveReportPdf(storeId, selected.id)
      setPdfJobId(start.jobId)
      pollTimer.current = window.setInterval(async () => {
        try {
          const job = await fetchExecutivePdfJob(storeId, selected.id, start.jobId)
          if (job.status === 'COMPLETED') {
            if (pollTimer.current !== null) window.clearInterval(pollTimer.current)
            setPdfJobId(null)
            setPdfBusy(false)
            window.open(`/ai-executive/reports/${selected.id}/pdf/download?storeId=${encodeURIComponent(storeId)}`, '_blank', 'noopener')
            onToast('Investor PDF ready — download started.', 'success')
          } else if (job.status === 'FAILED') {
            if (pollTimer.current !== null) window.clearInterval(pollTimer.current)
            setPdfJobId(null)
            setPdfBusy(false)
            onToast(job.error ?? 'PDF generation failed.', 'error')
          }
        } catch {
          if (pollTimer.current !== null) window.clearInterval(pollTimer.current)
          setPdfJobId(null)
          setPdfBusy(false)
        }
      }, 1200)
    } catch (err: unknown) { setPdfBusy(false); onToast(errorMessageFrom(err), 'error') }
  }

  const emailReport = async (report: ExecutiveReport) => {
    if (!storeId) return
    setEmailing(report.id)
    try {
      await emailExecutiveReport(storeId, report.id)
      onToast('Board report emailed to your configured address.', 'success')
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') } finally { setEmailing(null) }
  }

  const byYear = useMemo(() => {
    const groups = new Map<string, ExecutiveReport[]>()
    for (const report of reports) {
      const year = report.generatedAt.slice(0, 4)
      groups.set(year, [...(groups.get(year) ?? []), report])
    }
    return [...groups.entries()].sort((left, right) => right[0].localeCompare(left[0]))
  }, [reports])

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="Boardroom reporting"
        title="Board Reports"
        description="CEO-level monthly, quarterly, and custom reports generated exclusively from your synced store data and public industry benchmarks."
        actions={
          <>
            <Button type="button" className="button secondary" onClick={() => void load()}><RefreshCw size={14} /> Refresh</Button>
            <Button type="button" className="button primary" onClick={() => void generate()} disabled={generating || !storeId}>
              <FileText size={14} /> {generating ? 'Generating…' : 'Generate Report'}
            </Button>
          </>
        }
      />
      {loadState === 'loading' && <ExecutiveSkeleton rows={6} label="Board reports" />}
      {loadState === 'error' && <ExecutiveErrorState message={error ?? 'Could not load reports.'} onRetry={() => void load()} />}
      {loadState === 'ready' && reports.length === 0 && (
        <ExecutiveEmptyState
          icon={Landmark}
          title={plan === 'trial' ? 'Your first board report will generate when you choose a plan' : 'No board reports yet'}
          description={plan === 'trial'
            ? 'Board reports are included from the Growth plan. Generate on-demand or receive one automatically on your chosen day of the month — every number computed from your store, never estimated.'
            : 'Generate your first report on-demand. It will contain an executive summary, strategic position, key insights, recommended decisions, a financial forecast, and a detailed appendix.'}
          action={plan === 'trial' ? 'Generate Report Now' : 'Generate Report Now'}
          onAction={() => void generate()}
          locked={plan === 'trial' || plan === 'start'}
          onUpgrade={onUpgrade}
        />
      )}
      {plan === 'trial' && loadState === 'ready' && (
        <ExecutiveSection kicker="Sample — for illustration only" title="Sample report preview" className="span-12">
          <p className="exec-muted-note">This illustrative preview shows the report structure. Your report replaces every section with values computed from your synced Shopify data — no numbers here are real store figures.</p>
          <SampleReportPreview />
        </ExecutiveSection>
      )}
      {reports.length > 0 && (
        <div className="exec-reports-layout">
          <aside className="exec-report-list" aria-label="Report list">
            {byYear.map(([year, yearReports]) => (
              <div key={year}>
                <div className="exec-report-year-label">{year}</div>
                {yearReports.map((report) => (
                  <Button key={report.id} type="button" className={`exec-report-list-item ${selectedId === report.id ? 'selected' : ''}`} onClick={() => setSelectedId(report.id)}>
                    <span className="exec-report-date">{executiveMonthLabel(report.periodStart)}</span>
                    <span className="exec-report-meta">
                      <ExecutiveStatusPill status={report.reportType} tone="gold" />
                      {report.viewedAt === null ? <span className="exec-pill warning"><i />New</span> : <span>{executiveDateLabel(report.generatedAt)}</span>}
                    </span>
                  </Button>
                ))}
              </div>
            ))}
          </aside>
          <main className="exec-report-viewer">
            {selected ? <ReportViewer report={selected} pdfBusy={pdfBusy} pdfJobId={pdfJobId} emailing={emailing === selected.id} onDownload={() => void downloadPdf()} onEmail={() => void emailReport(selected)} onPrint={() => window.print()} plan={plan} onUpgrade={onUpgrade} /> : null}
          </main>
        </div>
      )}
    </div>
  )
}

function ReportViewer({ report, pdfBusy, pdfJobId, emailing, onDownload, onEmail, onPrint, plan, onUpgrade }: { report: ExecutiveReport; pdfBusy: boolean; pdfJobId: string | null; emailing: boolean; onDownload: () => void; onEmail: () => void; onPrint: () => void; plan: ExecutivePageProps['plan']; onUpgrade: () => void }) {
  const forecast = report.content.financialForecast
  const appendixRows = Object.entries(report.content.appendix.metrics ?? {})
  return (
    <>
      <nav className="exec-report-sections-nav" aria-label="Report sections">
        <a href="#exec-summary">Summary</a>
        <a href="#exec-position">Position</a>
        <a href="#exec-insights">Insights</a>
        <a href="#exec-decisions">Decisions</a>
        <a href="#exec-forecast">Forecast</a>
        <a href="#exec-appendix">Appendix</a>
      </nav>
      <section className="exec-section" id="exec-summary">
        <div className="exec-section-head">
          <div><div className="exec-kicker">Executive summary · {executiveDateLabel(report.generatedAt)}</div><h3>{executiveMonthLabel(report.periodStart)} board report</h3></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button type="button" className="button secondary" onClick={onPrint}><Printer size={14} /> Print</Button>
            <Button type="button" className="button secondary" onClick={onEmail} disabled={emailing}><Mail size={14} /> {emailing ? 'Sending…' : 'Email'}</Button>
            {plan === 'commander' ? (
              <Button type="button" className="button primary" onClick={onDownload} disabled={pdfBusy}><Download size={14} /> {pdfBusy ? (pdfJobId ? 'Preparing PDF…' : 'Preparing…') : 'Download PDF'}</Button>
            ) : (
              <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
            )}
          </div>
        </div>
        <p>{report.executiveSummary}</p>
        <div className="exec-summary-meta">
          <FileText size={13} /> {report.reportType} · {report.periodStart} → {report.periodEnd}
          {report.content.aiNarrativeAvailable ? <><Landmark size={13} /> AI narrative grounded in store facts</> : <><Landmark size={13} /> Deterministic analysis (AI narrative unavailable)</>}
        </div>
      </section>
      {report.content.strategicPosition && (
        <ExecutiveSection kicker="Market view" title="Strategic Position" className="span-12"><p id="exec-position">{report.content.strategicPosition}</p></ExecutiveSection>
      )}
      <ExecutiveSection kicker="Analysis" title="Key Strategic Insights" className="span-12">
        <ol className="exec-report-numbered" id="exec-insights">{report.content.keyInsights.map((insight, index) => <li key={index}>{insight}</li>)}</ol>
      </ExecutiveSection>
      <ExecutiveSection kicker="Action" title="Recommended Strategic Decisions" className="span-12">
        <ol className="exec-report-numbered" id="exec-decisions">{report.content.recommendedDecisions.map((decision, index) => <li key={index}>{decision}</li>)}</ol>
      </ExecutiveSection>
      {forecast && (
        <ExecutiveSection kicker={`${forecast.horizonDays}-day outlook`} title="Financial Forecast" className="span-12">
          <table className="exec-forecast-table" id="exec-forecast">
            <thead><tr><th>Horizon</th><th className="num">Conservative</th><th className="num">Expected</th><th className="num">Stretch</th></tr></thead>
            <tbody>
              {forecast.projections.map((projection) => (
                <tr key={projection.label}>
                  <td><strong>{projection.label}</strong></td>
                  <td className="num">{new Intl.NumberFormat('en-US', { style: 'currency', currency: forecast.currency, maximumFractionDigits: 0 }).format(projection.low)}</td>
                  <td className="num">{new Intl.NumberFormat('en-US', { style: 'currency', currency: forecast.currency, maximumFractionDigits: 0 }).format(projection.expected)}</td>
                  <td className="num">{new Intl.NumberFormat('en-US', { style: 'currency', currency: forecast.currency, maximumFractionDigits: 0 }).format(projection.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="exec-muted-note" style={{ marginTop: 10 }}>Projections extend the store's own 30-day revenue trend — they are derived from your data, not industry assumptions.</p>
        </ExecutiveSection>
      )}
      <ExecutiveSection kicker="Detailed metrics" title="Appendix" className="span-12">
        {appendixRows.length > 0 ? (
          <table className="exec-table" id="exec-appendix">
            <thead><tr><th>Metric</th><th>Value</th></tr></thead>
            <tbody>{appendixRows.map(([key, value]) => <tr key={key}><td>{key.replaceAll('_', ' ')}</td><td className="num">{value === null ? 'not measurable' : String(value)}</td></tr>)}</tbody>
          </table>
        ) : <p className="exec-muted-note">No appendix metrics recorded for this report.</p>}
      </ExecutiveSection>
    </>
  )
}

function SampleReportPreview() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {[
        { title: 'Executive Summary', body: 'A two-to-three paragraph boardroom summary of revenue trajectory, the dominant strategic fact in your data, and the most important decision ahead — written around your real numbers.' },
        { title: 'Strategic Position', body: 'Your revenue and AOV percentile against the industry benchmark category, with growth runway commentary.' },
        { title: 'Key Strategic Insights', body: 'Three to five insights, each pinned to a measured fact — growth rates, concentration, retention, inventory turns.' },
        { title: 'Recommended Decisions', body: 'Numbered, imperative action items derived from your risks and opportunities.' },
        { title: 'Financial Forecast', body: '30 / 90 / 365-day projections extending your own revenue trend with conservative and stretch bands.' },
        { title: 'Appendix', body: 'Every metric behind the narrative, with sources — synced orders, products, customers, and public benchmarks.' },
      ].map((section) => (
        <div key={section.title} className="exec-metric-card">
          <span className="exec-sample-flag">Sample</span>
          <h3 style={{ margin: 0, fontFamily: 'var(--exec-serif)', fontSize: 15, color: 'var(--exec-heading)' }}>{section.title}</h3>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--exec-body)', lineHeight: 1.6 }}>{section.body}</p>
        </div>
      ))}
    </div>
  )
}
