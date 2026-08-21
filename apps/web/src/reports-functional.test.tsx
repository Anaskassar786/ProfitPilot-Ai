import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }
import { ReportsWorkspace } from './reports.js'
import { canGenerateReport, reportDisplayName, reportStatusView } from './reports-model.js'
import type { ReportRun } from './f8-model.js'

/** main.tsx wraps every page in Polaris AppProvider (i18n); render the same
 *  way so the Polaris Buttons on the page render natively. */
function renderWorkspace(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(AppProvider, { i18n: enTranslations as never }, createElement(ReportsWorkspace, props)))
}

const completed: ReportRun = {
  id: 'c31f6b31-bbd0-4781-9f61-13a64338282b',
  storeId: 'store-1',
  frequency: 'MONTHLY',
  period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-17T23:59:59.000Z' },
  idempotencyKey: 'k',
  filename: 'c31f6b31-bbd0-4781-9f61-13a64338282b-weekly-2026-08-08-2026-08.pdf',
  objectKey: 'reports/x',
  contentSha256: null,
  status: 'COMPLETED',
  emailStatus: 'NOT_REQUESTED',
  createdAt: Date.parse('2026-08-18T08:00:00.000Z'),
  completedAt: Date.parse('2026-08-18T08:00:02.000Z'),
}

describe('Reports functional checklist', () => {
  it('loads the page shell without developer jargon or console-facing errors in markup', () => {
    const html = renderWorkspace({
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      onNavigateBilling: vi.fn(),
      onToast: vi.fn(),
    })
    expect(html).toContain('aria-label="Report type"')
    expect(html).toContain('Generate Report')
    expect(html).toContain('Report settings')
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('[object Object]')
    expect(html).not.toContain('email not requested')
  })

  it('shows human names and honest statuses for vault cards', () => {
    expect(reportDisplayName(completed)).toBe('Monthly Report — August 2026')
    expect(reportDisplayName(completed)).not.toContain(completed.id)
    expect(reportStatusView(completed).label).toBe('Ready')
    expect(reportStatusView({ ...completed, status: 'GENERATING' }).label).toBe('Generating…')
    expect(reportStatusView({ ...completed, emailStatus: 'SENT' }).label).toBe('Emailed')
  })

  it('enforces Trial monthly quota and routes locked features to Upgrade Plan', () => {
    const trial = canGenerateReport('trial', 'MONTHLY', [completed], new Date('2026-08-18T12:00:00.000Z'))
    expect(trial.allowed).toBe(false)
    expect(trial.used).toBe(1)
    expect(trial.limit).toBe(1)
    const html = renderWorkspace({
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      onNavigateBilling: vi.fn(),
      onToast: vi.fn(),
    })
    expect(html).toContain('Upgrade Plan')
    expect(html).toContain('Included when you Upgrade Plan')
  })

  it('never fabricates preview revenue when the store has no rows', () => {
    const html = renderWorkspace({
      context: { storeId: null, shop: null },
      onNavigateBilling: vi.fn(),
    })
    expect(html).not.toMatch(/\$9,?999/)
    expect(html).not.toContain('john@example.com')
    expect(html).toContain('No reports generated yet')
  })
})
