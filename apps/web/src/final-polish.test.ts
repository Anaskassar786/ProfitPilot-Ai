import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function functionSource(file: string, start: string, end: string): string {
  const startIndex = file.indexOf(start)
  const endIndex = file.indexOf(end, startIndex)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return file.slice(startIndex, endIndex)
}

describe('PR #41 final polish contracts', () => {
  it('hard-enforces the shared Upgrade Plan CTA dimensions and no-wrap behavior', () => {
    const css = source('./upgrade-overrides.css')
    for (const contract of [
      'white-space: nowrap !important',
      'flex-shrink: 0 !important',
      'min-width: 140px !important',
      'height: 40px !important',
      'padding: 0 16px !important',
      'font-weight: 700 !important',
      'font-size: 14px !important',
      'display: inline-flex !important',
      'align-items: center !important',
      'justify-content: center !important',
      'gap: 8px !important',
      'border-radius: 10px !important',
    ]) expect(css).toContain(contract)

    expect(css).toContain('.orders-insights-head-actions')
    expect(css).toContain('.inventory-insights-head-actions')
    expect(css).toContain('flex-wrap: nowrap !important')
  })

  it('ships explicit light surfaces for search, palette, and every requested workspace', () => {
    const css = source('./final-polish.css')
    const lightContracts = [
      '.app-shell.light-mode .search-workspace',
      '.app-shell.light-mode .command-palette',
      '.app-shell.light-mode .product-stat-card',
      '.app-shell.light-mode .orders-table',
      '.app-shell.light-mode .customers-table',
      '.app-shell.light-mode .inventory-health-card.modern',
      '.app-shell.light-mode .analytics-kpi',
      '.app-shell.light-mode .command-health',
      '.app-shell.light-mode .f8-copilot-layout .copilot-main',
      '.app-shell.light-mode .report-banner',
      '.app-shell.light-mode .export-card',
      '.app-shell.light-mode .settings-panel',
      '.app-shell.light-mode .support-hero',
      '.app-shell.light-mode .billing-current',
      '.app-shell.light-mode .f9-admin-login',
      '.app-shell.light-mode .recommendation-card',
      '.app-shell.light-mode .automation-mode',
      '.app-shell.light-mode .campaign-hero',
    ]
    for (const selector of lightContracts) expect(css).toContain(selector)

    expect(css).toContain('background: #FFFFFF !important')
    expect(css).toContain('color: #111827 !important')
    expect(css).toContain('background: #059669 !important')
    expect(css).toContain('background: #2563EB !important')
    expect(css).toContain('background: #D97706 !important')
    expect(css).toContain('background: #DC2626 !important')
  })

  it('keeps the premium dark surfaces alongside light overrides', () => {
    const css = source('./final-polish.css')
    for (const selector of [
      '.health-card-compact .performance-gauge-premium',
      '.inventory-health-gauge-wrap.large .inventory-health-gauge',
      '.inventory-value-card.modern .inventory-value-total',
      '.analytics-kpi .sparkline',
      '.locked-widget',
      '.order-details-drawer',
    ]) expect(css).toContain(selector)
  })

  it('renders revenue before date in the Revenue Momentum tooltip', () => {
    const analytics = source('./analytics.tsx')
    const tooltip = functionSource(analytics, 'function RevenueTooltip', 'function OrdersAovTooltip')
    expect(tooltip.indexOf('tooltip-primary-value')).toBeLessThan(tooltip.indexOf('tooltip-date'))
    expect(tooltip).toContain('<span>Revenue</span>')
    expect(tooltip).toContain('vs Previous')
    expect(tooltip).toContain('AI Forecast')
  })

  it('preserves the working Volume and Value implementation byte-for-byte', () => {
    const analytics = source('./analytics.tsx')
    const correlation = functionSource(analytics, 'export function OrdersAOVCorrelation', 'export function SalesByChannel')
    expect(sha256(correlation)).toBe('2e1613dfa9fb3ef5552b21eb423f94bee7465619893b6289333acb7d880aba17')
  })

  it('preserves Jarvis orb and Products functionality source byte-for-byte', () => {
    expect(sha256(source('./JarvisOrb.tsx'))).toBe('bdc5177021879275e5032e2bef134b51869ccf155d275a80f7a177a1fb8449f2')
    expect(sha256(source('./jarvis-orb.css'))).toBe('529cf7cdc543bd0fee5607f00ebf35547dc957c6dd08f53e56f67b47c7faa1b9')
    expect(sha256(source('./products.tsx'))).toBe('e6fc73ca1ad4a6f7be7ec237c7100adaec919101803d1757c8aa4829b19a41d1')
    expect(sha256(source('./products-model.ts'))).toBe('5a74f7e0ab08bce2a0b3a88af516a022a61ac36d4d077bb6f80bb959feaeb44f')
  })
})
