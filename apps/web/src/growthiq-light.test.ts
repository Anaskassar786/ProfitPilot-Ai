import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./executive.css', import.meta.url), 'utf8')

describe('GrowthIQ light theme — dark theme protection', () => {
  it('keeps the dark token block on the signature palette', () => {
    expect(css).toContain('--exec-bg: rgb(10, 11, 20)')
    expect(css).toContain('--exec-surface: rgb(20, 22, 31)')
    expect(css).toContain('--exec-heading: rgb(248, 250, 252)')
    expect(css).toContain('--exec-purple: rgb(139, 92, 246)')
  })

  it('scopes the contrast pass exclusively to .app-shell.light-mode', () => {
    const marker = css.indexOf('.app-shell.light-mode .exec-page { background: transparent; }')
    expect(marker).toBeGreaterThan(0)
    const pass = css.slice(marker)
    const selectors = pass
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .flatMap((block) => {
        const head = block.split('{')[0]?.trim() ?? ''
        return head.split(',').map((selector) => selector.trim()).filter(Boolean)
      })
      .filter((selector) => !selector.startsWith('@'))
    expect(selectors.length).toBeGreaterThan(10)
    const unscoped = selectors.filter((selector) => !selector.startsWith('.app-shell.light-mode'))
    expect(unscoped).toEqual([])
  })
})

describe('GrowthIQ light theme — visual contracts', () => {
  const contracts = [
    '--exec-bg: rgb(248, 250, 252)',
    '--exec-surface: rgb(255, 255, 255)',
    '--exec-heading: rgb(15, 23, 42)',
    '--exec-body: rgb(71, 85, 105)',
    '--exec-muted: rgb(100, 116, 139)',
    '--exec-purple: rgb(124, 58, 237)',
    '--exec-grid: rgb(241, 245, 249)',
    '.app-shell.light-mode .gq-header-title h2 { color: rgb(15, 23, 42); }',
    '.app-shell.light-mode .gq-tagline { color: rgb(71, 85, 105); }',
    'background: rgb(124, 58, 237)',
    '.app-shell.light-mode .gq-header .button.primary',
    '.app-shell.light-mode .gq-header .button.secondary',
    '.app-shell.light-mode .gq-figure',
    '.app-shell.light-mode .gq-impact-card',
    '.app-shell.light-mode .gq-action-card',
    '.app-shell.light-mode .gq-insights',
    '.app-shell.light-mode .gq-tip',
    '.app-shell.light-mode .gq-direction.declining { color: rgb(220, 38, 38); }',
    '.app-shell.light-mode .exec-area-stroke { stroke: rgb(124, 58, 237); }',
    '.app-shell.light-mode .gq-trajectory-projection { stroke: rgb(167, 139, 250); }',
    '.app-shell.light-mode .gq-milestone.complete .gq-milestone-row strong { color: rgb(22, 101, 52); }',
    '.app-shell.light-mode .exec-page .text-button { color: rgb(124, 58, 237); }',
  ]

  it.each(contracts)('ships %s', (snippet) => {
    expect(css).toContain(snippet)
  })

  it('ships interactive tooltip styles that read CSS tokens (both themes)', () => {
    expect(css).toContain('.gq-trajectory-tooltip')
    expect(css).toContain('.gq-trajectory-hit')
    expect(css).toContain('.gq-trajectory-cursor')
    expect(css).toContain('.gq-trajectory-active-dot')
    expect(css).toContain('touch-action: none')
  })
})
