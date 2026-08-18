import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

/**
 * Light-theme contracts for the Automation hub.
 *
 * Every assertion maps to an explicit colour in the PR spec. The dark theme is
 * asserted separately (and negatively) to prove it was left untouched — the
 * "reached" plan banner stays red in dark and only turns amber under
 * `.light-mode`.
 */
describe('Automation light theme contracts', () => {
  const css = source('./automation.css')

  it('renders the "You\u2019ve reached your limit" banner amber in light mode', () => {
    expect(css).toContain('.light-mode .automation-page .limit-warning')
    expect(css).toContain('background: linear-gradient(135deg, #fef3c7, #fde68a)')
    expect(css).toContain('border-color: #fcd34d')
    expect(css).toContain('.light-mode .automation-page .limit-warning-title')
    expect(css).toContain('color: #92400e')
    // The light "reached" banner must be amber, never the old pink wash.
    const reached = css.slice(css.indexOf('.light-mode .automation-page .automation-plan-banner.reached'), css.indexOf('.light-mode .automation-page .automation-plan-banner.drafts'))
    expect(reached).toContain('#fde68a')
    expect(reached).not.toContain('#fecaca')
  })

  it('keeps the dark "reached" banner red (dark theme untouched)', () => {
    const base = css.slice(0, css.indexOf('/* ==========================================================================\n   Light theme'))
    expect(base).toContain('.automation-plan-banner.reached')
    expect(base).toContain('rgba(239, 68, 68, 0.3)')
    expect(base).toContain('rgba(239, 68, 68, 0.07)')
  })

  it('gives template cards white surfaces, slate borders, and the exact shadow', () => {
    const block = css.slice(
      css.indexOf('.light-mode .automation-page .template-card-pro,'),
      css.indexOf('.light-mode .automation-page .template-name'),
    )
    expect(block).toContain('background: #ffffff')
    expect(block).toContain('border: 1px solid #e2e8f0')
    expect(block).toContain('box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06)')
    expect(block).toContain('border-color: #a78bfa')
  })

  it('renders ACTIVE and PAUSED workflow badges with the specified fills', () => {
    expect(css).toContain('color: #166534')
    expect(css).toContain('background: #dcfce7')
    expect(css).toContain('border-color: #86efac')
    expect(css).toContain('color: #92400e')
    expect(css).toContain('background: #fef3c7')
    expect(css).toContain('border-color: #fcd34d')
  })

  it('ships readable workflow-card typography in light mode', () => {
    expect(css).toContain('.light-mode .automation-page .workflow-name')
    expect(css).toContain('.light-mode .automation-page .workflow-trigger')
    expect(css).toContain('.light-mode .automation-page .workflow-stat-value')
    expect(css).toContain('color: #0f172a')
    expect(css).toContain('color: #475569')
    expect(css).toContain('.light-mode .automation-page .workflow-card-stats')
    expect(css).toContain('color: #64748b')
  })

  it('styles filter tabs, search, and the grid/list toggle per spec', () => {
    expect(css).toContain('.light-mode .automation-page .automation-filter-tabs')
    expect(css).toContain('background: #f1f5f9')
    expect(css).toContain('.light-mode .automation-page .filter-tab.active')
    expect(css).toContain('.light-mode .automation-page .automation-search:focus-within')
    expect(css).toContain('border-color: #7c3aed')
    expect(css).toContain('.light-mode .automation-page .view-toggle button.active')
  })

  it('gives the five KPI cards white surfaces with dark values', () => {
    expect(css).toContain('.light-mode .automation-page .kpi-card')
    expect(css).toContain('.light-mode .automation-page .kpi-value')
    expect(css).toContain('.light-mode .automation-page .kpi-label')
    expect(css).toContain('color: #0f172a')
    expect(css).toContain('color: #64748b')
    expect(css).toContain('background: #ffffff')
    expect(css).toContain('border: 1px solid #e2e8f0')
  })

  it('renders section headers with the purple eyebrow and dark title', () => {
    expect(css).toContain('.light-mode .automation-page .page-eyebrow')
    expect(css).toContain('.light-mode .automation-page .page-title')
    expect(css).toContain('.light-mode .automation-page .page-subtitle')
    expect(css).toContain('.light-mode .automation-page .section-title')
    expect(css).toContain('color: #7c3aed')
    expect(css).toContain('color: #0f172a')
    expect(css).toContain('color: #475569')
  })

  it('adds a purple focus ring and 200ms transitions to interactive states', () => {
    expect(css).toContain('outline: 2px solid #7c3aed')
    expect(css).toContain('outline-offset: 2px')
    expect(css).toContain('transform 200ms ease')
  })
})

describe('Automation "Upgrade Plan" copy contract', () => {
  it('never suggests a plan name in the CTA across the automation surface', () => {
    const files = ['./automation.tsx', './TemplateGallery.tsx', './WorkflowCard.tsx', './WorkflowEditor.tsx', './UpgradePlanButton.tsx']
    for (const file of files) {
      const text = source(file)
      expect(text).not.toContain('Upgrade to')
      expect(text).not.toContain('Upgrade to Start')
      expect(text).not.toContain('Upgrade to Growth')
      expect(text).not.toContain('Upgrade to Commander')
    }
    // Every surface that renders an upgrade CTA uses the exact "Upgrade Plan" copy.
    for (const file of ['./automation.tsx', './TemplateGallery.tsx', './WorkflowEditor.tsx', './UpgradePlanButton.tsx']) {
      expect(source(file)).toContain('Upgrade Plan')
    }
  })
})

describe('Automation featured templates map to real backend templates', () => {
  it('references only templates that exist in the backend catalog', () => {
    const automation = source('./automation.tsx')
    const templates = source('../../../packages/automation/src/templates.ts')
    const ids = [
      'abandoned-checkout',
      'welcome-customer',
      'low-stock-alert',
      'high-value-order',
      'back-in-stock',
      'review-request',
      'win-back',
      'vip-tagging',
    ]
    for (const id of ids) {
      expect(automation).toContain(`'${id}'`)
      expect(templates).toContain(`id: '${id}'`)
    }
  })

  it('matches the documented plan badges for each featured template', () => {
    const templates = source('../../../packages/automation/src/templates.ts')
    // Abandoned Checkout Recovery → start; Welcome/Low-Stock/High-Value/VIP → trial;
    // Back-in-Stock/Win-Back → growth; Review Request → start.
    const expectations: ReadonlyArray<[string, string]> = [
      ['abandoned-checkout', "minimumPlan: 'start'"],
      ['welcome-customer', "minimumPlan: 'trial'"],
      ['low-stock-alert', "minimumPlan: 'trial'"],
      ['high-value-order', "minimumPlan: 'trial'"],
      ['back-in-stock', "minimumPlan: 'growth'"],
      ['review-request', "minimumPlan: 'start'"],
      ['win-back', "minimumPlan: 'growth'"],
      ['vip-tagging', "minimumPlan: 'trial'"],
    ]
    for (const [id, minimumPlan] of expectations) {
      const line = templates.split('\n').find((entry) => entry.includes(`id: '${id}'`))
      expect(line, id).toBeDefined()
      expect(line).toContain(minimumPlan)
    }
  })
})
