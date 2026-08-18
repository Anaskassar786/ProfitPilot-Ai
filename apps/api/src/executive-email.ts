/**
 * PR #49 — monthly board report email (Brevo SMTP).
 *
 * Executive-styled, mobile-responsive HTML email built ONLY from report
 * data that already exists in the database. Charts travel as inline SVG
 * (vector images render in modern mail clients without a raster pipeline).
 * The PDF body is attached for Commander stores. Delivery is idempotent
 * and optional: no SMTP config or no recipient means a skipped send, never
 * an invented one.
 */
import type { EmailTransport } from '@profitpilot/automation'
import type { ExecutiveFacts } from './executive-ai.js'
import type { ExecutiveReport } from './executive-model.js'

export type ExecutiveEmailInput = Readonly<{
  report: ExecutiveReport
  facts: ExecutiveFacts
  appUrl: string
  unsubscribeUrl: string
  includePdf: boolean
  pdfBuffer: Buffer | null
}>

export function buildExecutiveReportEmail(input: ExecutiveEmailInput): string {
  const report = input.report
  const currency = input.facts.currency
  const summary = escapeHtml(report.executiveSummary)
  const insights = report.content.keyInsights.map((insight) => `<tr><td style="padding:8px 0;color:#1E2A4A;font-family:Georgia,serif;font-size:14px;line-height:20px;">&bull;&nbsp; ${escapeHtml(insight)}</td></tr>`).join('')
  const decisions = report.content.recommendedDecisions.map((decision, index) => `<tr><td style="padding:6px 0;color:#1E2A4A;font-family:Georgia,serif;font-size:14px;line-height:20px;"><span style="color:#B08A2E;font-weight:700;">${index + 1}.</span>&nbsp; ${escapeHtml(decision)}</td></tr>`).join('')
  const forecastRows = (report.content.financialForecast?.projections ?? []).map((projection) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #E6EAF2;color:#1E2A4A;">${escapeHtml(projection.label)}</td><td style="padding:8px 12px;border-bottom:1px solid #E6EAF2;color:#1E2A4A;">${currency} ${Math.round(projection.expected).toLocaleString('en-US')}</td></tr>`).join('')
  const health = input.facts.healthScore
  const gaugeSvg = `<svg width="160" height="96" viewBox="0 0 160 96" xmlns="http://www.w3.org/2000/svg"><path d="M 12 88 A 68 68 0 0 1 148 88" fill="none" stroke="#E6EAF2" stroke-width="12" stroke-linecap="round"/><path d="M 12 88 A 68 68 0 0 1 148 88" fill="none" stroke="#B08A2E" stroke-width="12" stroke-linecap="round" stroke-dasharray="${Math.max(((health / 100) * 210), 4).toFixed(1)} 210"/><text x="80" y="82" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#0B1D42">${health}</text><text x="80" y="94" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#6B7280">${escapeHtml(input.facts.healthStatus)}</text></svg>`
  const pdfNote = input.includePdf ? '<tr><td style="padding:14px 0 0;color:#4A5568;font-family:Arial,sans-serif;font-size:12px;">A print-ready PDF of this report is attached to this email.</td></tr>' : ''
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2F4F8;">
  <div style="max-width:640px;margin:0 auto;padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:10px;border:1px solid #E6EAF2;">
      <tr><td style="background:#0B1D42;border-radius:10px 10px 0 0;padding:26px 28px;">
        <div style="color:#B08A2E;font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;">PROFITPILOT · AI EXECUTIVE</div>
        <div style="color:#FFFFFF;font-family:Georgia,serif;font-size:24px;margin-top:6px;">Your Monthly Board Report</div>
        <div style="color:#9FB0D0;font-family:Arial,sans-serif;font-size:12px;margin-top:4px;">${escapeHtml(input.facts.storeName)} · ${escapeHtml(report.periodStart)} to ${escapeHtml(report.periodEnd)}</div>
      </td></tr>
      <tr><td style="padding:28px;">
        <div style="color:#0B1D42;font-family:Georgia,serif;font-size:16px;font-weight:700;">Executive Summary</div>
        <div style="color:#1E2A4A;font-family:Georgia,serif;font-size:14px;line-height:22px;margin-top:10px;">${summary}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#F7F8FC;border:1px solid #E6EAF2;border-radius:8px;">
          <tr><td style="padding:16px 18px;width:180px;">${gaugeSvg}</td>
          <td style="padding:16px 18px;color:#1E2A4A;font-family:Georgia,serif;font-size:14px;line-height:20px;vertical-align:middle;">Business health at <strong>${health}/100</strong>. ${input.facts.risks.length === 0 ? 'No material risks are currently active.' : `${input.facts.risks.length} active risk${input.facts.risks.length === 1 ? '' : 's'} on the radar.`}</td></tr>
        </table>
        <div style="color:#0B1D42;font-family:Georgia,serif;font-size:16px;font-weight:700;margin-top:24px;">Key Strategic Insights</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${insights}</table>
        <div style="color:#0B1D42;font-family:Georgia,serif;font-size:16px;font-weight:700;margin-top:18px;">Recommended Decisions</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${decisions}</table>
        <div style="color:#0B1D42;font-family:Georgia,serif;font-size:16px;font-weight:700;margin-top:18px;">Financial Forecast</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border:1px solid #E6EAF2;border-radius:8px;overflow:hidden;">${forecastRows}</table>
        ${pdfNote}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;">
          <tr><td><a href="${escapeHtml(input.appUrl)}" style="display:inline-block;background:#0B1D42;color:#FFFFFF;font-family:Arial,sans-serif;font-size:13px;text-decoration:none;padding:11px 22px;border-radius:6px;">Open Full Report</a></td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #E6EAF2;color:#6B7280;font-family:Arial,sans-serif;font-size:11px;line-height:16px;">
        This report was generated from your synced Shopify data and public industry benchmarks. Every number shown is computed, never estimated.
        <br><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6B7280;">Unsubscribe from monthly reports</a> · Manage frequency in AI Executive settings.
      </td></tr>
    </table>
  </div>
</body>
</html>`
}

export function executiveReportSubject(storeName: string, periodLabel: string): string {
  return `Your Monthly Board Report — ${storeName} — ${periodLabel}`
}

export type ExecutiveEmailDelivery = Readonly<{
  send(recipient: string, input: ExecutiveEmailInput): Promise<Readonly<{ messageId: string }>>
  available: boolean
}>

/** Delivery wrapper around the automation package's SMTP transport. */
export function createExecutiveEmailDelivery(input: Readonly<{ transport: EmailTransport | null; from: string; fromName: string }>): ExecutiveEmailDelivery {
  const transport = input.transport
  return {
    available: transport !== null,
    async send(recipient: string, payload: ExecutiveEmailInput): Promise<Readonly<{ messageId: string }>> {
      if (!transport) throw new Error('Email delivery is not configured')
      return transport.send({
        to: recipient,
        from: input.from,
        fromName: input.fromName,
        subject: executiveReportSubject(payload.facts.storeName, payload.report.periodStart),
        html: buildExecutiveReportEmail(payload),
        attachments: payload.includePdf && payload.pdfBuffer ? [{ filename: `board-report-${payload.report.periodStart}.pdf`, content: payload.pdfBuffer, contentType: 'application/pdf' }] : [],
        headers: { 'List-Unsubscribe': `<${payload.unsubscribeUrl}>` },
      })
    },
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
