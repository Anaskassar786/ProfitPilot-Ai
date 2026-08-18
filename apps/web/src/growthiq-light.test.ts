import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./executive.css', import.meta.url), 'utf8')

describe('GrowthIQ light theme — dark theme protection', () => {
  it('keeps the dark token block on the signature palette', () => {
    expect(css).toContain('--exec-bg: #0A0B14')
    expect(css).toContain('--exec-surface: #14161F')
    expect(css).toContain('--exec-heading: #F8FAFC')
    expect(css).toContain('--exec-purple: #8B5CF6')
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
    '--exec-bg: #F8FAFC',
    '--exec-surface: #FFFFFF',
    '--exec-heading: #0F172A',
    '--exec-body: #475569',
    '--exec-muted: #64748B',
    '--exec-purple: #7C3AED',
    '--exec-grid: #F1F5F9',
    '.app-shell.light-mode .gq-header-title h2 { color: #0F172A; }',
    '.app-shell.light-mode .gq-tagline { color: #475569; }',
    'background: #7C3AED',
    '.app-shell.light-mode .gq-header .button.primary',
    '.app-shell.light-mode .gq-header .button.secondary',
    '.app-shell.light-mode .gq-figure',
    '.app-shell.light-mode .gq-impact-card',
    '.app-shell.light-mode .gq-action-card',
    '.app-shell.light-mode .gq-insights',
    '.app-shell.light-mode .gq-tip',
    '.app-shell.light-mode .gq-direction.declining { color: #DC2626; }',
    '.app-shell.light-mode .exec-area-stroke { stroke: #7C3AED; }',
    '.app-shell.light-mode .gq-trajectory-projection { stroke: #A78BFA; }',
    '.app-shell.light-mode .gq-milestone.complete .gq-milestone-row strong { color: #166534; }',
    '.app-shell.light-mode .exec-page .text-button { color: #7C3AED; }',
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
