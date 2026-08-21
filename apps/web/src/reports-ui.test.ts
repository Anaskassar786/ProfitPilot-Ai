import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReportsWorkspace } from './reports.js'

describe('Reports page professional copy', () => {
  const source = readFileSync(new URL('./reports.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./reports.css', import.meta.url), 'utf8')
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

  it('uses merchant language instead of developer vault jargon', () => {
    expect(source).toContain('Business Reports')
    expect(source).toContain('Generate professional reports from your real store data')
    expect(source).toContain('Your reports')
    expect(source).toContain('Forecast methodology')
    expect(source).not.toContain('CLOSED-PERIOD')
    expect(source).not.toContain('PDF vault')
    expect(source).not.toContain('FORECAST METHOD STAMPS')
    expect(source).not.toContain('Deterministic forecast')
    expect(source).not.toContain('email not requested')
    expect(source).not.toContain('Still generating')
    expect(source).toContain('Upgrade Plan')
  })

  it('renders the professional header, type cards, and plan status', () => {
    const html = renderToStaticMarkup(createElement(ReportsWorkspace, {
      context: { storeId: null, shop: null },
      onNavigateBilling: vi.fn(),
      onToast: vi.fn(),
    }))
    expect(html).toContain('Business Reports')
    expect(html).toContain('Monthly Report')
    expect(html).toContain('Quarterly Report')
    expect(html).toContain('Custom Report')
    expect(html).toContain('Your plan')
    expect(html).toContain('Upgrade Plan')
    expect(html).toContain('Forecast methodology')
    expect(html).not.toContain('CLOSED-PERIOD PDF')
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })

  it('routes the workspace Reports page to the redesigned surface with billing', () => {
    const branch = app.slice(app.indexOf("active === 'reports'"), app.indexOf("active === 'admin-ops'"))
    expect(branch).toContain('<ReportsWorkspace')
    expect(branch).toContain("onNavigate('billing')")
    expect(branch).not.toContain('Closed-period PDFs')
    expect(branch).not.toContain('EmptyDataPage')
  })

  it('styles both themes with readable light surfaces', () => {
    expect(css).toContain('.reports-page')
    expect(css).toContain('rgb(248, 250, 252)')
    expect(css).toContain('rgb(15, 23, 42)')
    expect(css).toContain('rgb(255, 255, 255)')
    expect(css).toContain('.app-shell.light-mode .reports-page')
    expect(css).toContain('.reports-status.ready')
    expect(css).toContain('.reports-status.generating')
  })

  it('keeps preview, download, email, settings, and custom range in the page', () => {
    for (const token of ['Download PDF', 'Preview', 'Email', 'Settings', 'Custom report range', 'Generate Report']) {
      expect(source).toContain(token)
    }
    expect(source).toContain('fetchAnalytics')
    expect(source).toContain('fetchBilling')
    expect(source).toContain('generateReport')
    expect(source).toContain('downloadReport')
  })
})
