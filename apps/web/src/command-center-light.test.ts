import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * AI Command Center — light theme contracts.
 *
 * The dark theme is the reference design and must not move, so the guard
 * below is mechanical: every selector shipped by command-center-light.css has
 * to be scoped to `.app-shell.light-mode`, and it may only target this
 * module's own surfaces. The contrast table mirrors the pairs documented in
 * docs/ai-command-center-light-theme.md.
 */

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const lightCss = source('./command-center-light.css')

/** Selectors of every style rule in a stylesheet, comments and at-rules stripped. */
function selectors(css: string): readonly string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutAtBlocks = withoutComments.replace(/@media[^{]*\{/g, '').replace(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g, '')
  const out: string[] = []
  for (const block of withoutAtBlocks.split('}')) {
    const head = block.split('{')[0]?.trim()
    if (!head || !block.includes('{')) continue
    for (const selector of head.split(',')) {
      const trimmed = selector.trim()
      if (trimmed) out.push(trimmed)
    }
  }
  return out
}

/* ── WCAG contrast helpers (sRGB relative luminance, WCAG 2.1 §1.4.3) ─── */

function channel(value: number): number {
  const srgb = value / 255
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

export function contrast(foreground: string, background: string): number {
  const first = luminance(foreground)
  const second = luminance(background)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

describe('AI Command Center light theme — dark theme protection', () => {
  it('scopes every rule to .app-shell.light-mode', () => {
    const unscoped = selectors(lightCss).filter((selector) => !selector.startsWith('.app-shell.light-mode'))
    expect(unscoped).toEqual([])
  })

  it('only targets AI Command Center surfaces', () => {
    const foreign = selectors(lightCss)
      .map((selector) => selector.replace('.app-shell.light-mode', '').trim())
      .filter((selector) => selector.length > 0)
      .filter((selector) => !selector.includes('.cc-') && !selector.includes('.page-content:has'))
    expect(foreign).toEqual([])
  })

  it('never uses !important, so the dark cascade is not overridden globally', () => {
    const declarations = lightCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(declarations).not.toContain('!important')
  })

  it('is loaded after every other stylesheet so light values win without !important', () => {
    const main = source('./main.tsx')
    expect(main).toContain("import './command-center-light.css'")
    expect(main.indexOf("import './command-center-light.css'")).toBeGreaterThan(main.indexOf("import './final-polish.css'"))
    expect(main.indexOf("import './command-center-light.css'")).toBeGreaterThan(main.indexOf("import './command-center.css'"))
  })

  it('leaves the dark stylesheet free of new light-mode rules for these surfaces', () => {
    // command-center.css keeps its historical light block; the redesign lives
    // in the dedicated file, so the dark file must not grow new overrides.
    const dark = source('./command-center.css')
    expect(dark).not.toContain('--cc-l-')
  })
})

describe('AI Command Center light theme — visual contracts', () => {
  const contracts = [
    /* page header */
    '.app-shell.light-mode .page-content:has(> .cc-workspace) .page-eyebrow',
    /* KPI hero */
    '.app-shell.light-mode .cc-kpi',
    '.app-shell.light-mode .cc-kpi:hover',
    '.app-shell.light-mode .cc-kpi-note',
    '.app-shell.light-mode .cc-kpi-icon.insights',
    '.app-shell.light-mode .cc-sparkline polyline',
    /* agents */
    '.app-shell.light-mode .cc-agent-card',
    '.app-shell.light-mode .cc-agent-card:hover',
    '.app-shell.light-mode .cc-status-pill.active',
    '.app-shell.light-mode .cc-status-pill.paused',
    '.app-shell.light-mode .cc-agent-version',
    '.app-shell.light-mode .cc-confidence-bar i',
    /* growth + locked */
    '.app-shell.light-mode .cc-agent-card.growth',
    '.app-shell.light-mode .cc-agent-card.locked',
    '.app-shell.light-mode .cc-plan-badge.available',
    '.app-shell.light-mode .cc-plan-badge.requires',
    '.app-shell.light-mode .cc-sample-insight',
    /* buttons */
    '.app-shell.light-mode .cc-button.primary',
    '.app-shell.light-mode .cc-button.secondary',
    '.app-shell.light-mode .cc-button.upgrade',
    '.app-shell.light-mode .cc-button.ghost',
    /* feed */
    '.app-shell.light-mode .cc-feed',
    '.app-shell.light-mode .cc-feed-row.is-fresh .cc-feed-title',
    '.app-shell.light-mode .cc-feed-status.pending',
    '.app-shell.light-mode .cc-feed-empty > svg',
    /* drawer + states */
    '.app-shell.light-mode .cc-drawer',
    '.app-shell.light-mode .cc-tip[data-tip]::after',
    '.app-shell.light-mode .cc-empty h2',
    '.app-shell.light-mode .cc-skeleton',
  ]

  it.each(contracts)('ships %s', (selector) => {
    expect(lightCss).toContain(selector)
  })

  it('keeps every card on an explicit border + shadow so it never blends into the canvas', () => {
    for (const contract of [
      'border: 1px solid var(--cc-l-border)',
      '--cc-l-shadow-sm: 0 1px 3px rgba(15, 23, 42, .07), 0 1px 2px rgba(15, 23, 42, .05)',
      '--cc-l-canvas: #F8FAFC',
      '--cc-l-surface: #FFFFFF',
    ]) expect(lightCss).toContain(contract)
  })

  it('restores the sparkline hairline (the old light rule filled the polyline)', () => {
    expect(lightCss).toContain('.app-shell.light-mode .cc-sparkline polyline { stroke: var(--cc-l-purple); fill: none;')
  })

  it('keeps a visible keyboard focus ring on both the workspace and the drawer', () => {
    expect(lightCss).toContain('.app-shell.light-mode .cc-workspace button:focus-visible')
    expect(lightCss).toContain('.app-shell.light-mode .cc-drawer-root button:focus-visible')
    expect(lightCss).toContain('outline: 2px solid var(--cc-l-purple)')
  })

  it('honours prefers-reduced-motion for the new hover lifts', () => {
    expect(lightCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

describe('AI Command Center light theme — WCAG AA contrast', () => {
  const CANVAS = '#F8FAFC'
  const SURFACE = '#FFFFFF'

  const text: readonly (readonly [string, string, string])[] = [
    ['page title', '#0F172A', CANVAS],
    ['page eyebrow (purple)', '#6D28D9', CANVAS],
    ['page description', '#475569', CANVAS],
    ['section heading', '#0F172A', CANVAS],
    ['section description', '#475569', CANVAS],
    ['KPI value', '#0F172A', SURFACE],
    ['KPI unit / secondary', '#64748B', SURFACE],
    ['KPI label (tooltip trigger)', '#475569', SURFACE],
    ['KPI empty message', '#334155', SURFACE],
    ['period chip', '#6D28D9', '#F3E8FF'],
    ['trend chip — up', '#166534', '#DCFCE7'],
    ['trend chip — down', '#991B1B', '#FEE2E2'],
    ['trend chip — flat', '#475569', '#F1F5F9'],
    ['health status — healthy', '#047857', SURFACE],
    ['health status — warning', '#B45309', SURFACE],
    ['health status — critical', '#B91C1C', SURFACE],
    ['agent name', '#0F172A', SURFACE],
    ['agent tagline', '#475569', SURFACE],
    ['agent stat value', '#0F172A', SURFACE],
    ['agent stat label', '#64748B', SURFACE],
    ['agent version chip', '#475569', '#F1F5F9'],
    ['status pill — active', '#166534', '#DCFCE7'],
    ['status pill — paused', '#92400E', '#FEF3C7'],
    ['status pill — idle', '#5B21B6', '#F3E8FF'],
    ['plan badge — requires', '#92400E', '#FEF3C7'],
    ['plan badge — available', '#166534', '#DCFCE7'],
    ['tier label on growth tint', '#475569', '#FAF7FF'],
    ['module note', '#475569', SURFACE],
    ['growth preview quote', '#334155', CANVAS],
    ['locked sample insight', '#92400E', '#FFFBEB'],
    ['locked group price chip', '#92400E', '#FEF3C7'],
    ['primary button label', '#FFFFFF', '#7C3AED'],
    ['primary button label (hover)', '#FFFFFF', '#6D28D9'],
    ['secondary button label', '#334155', SURFACE],
    ['secondary button label (hover)', '#6D28D9', '#F3E8FF'],
    ['upgrade button label', '#1F2937', '#F59E0B'],
    ['upgrade button label (light stop)', '#1F2937', '#FCD34D'],
    ['upgrade button label (dark stop)', '#1F2937', '#EA9A08'],
    ['approve button label', '#FFFFFF', '#15803D'],
    ['feed agent', '#475569', SURFACE],
    ['feed title', '#0F172A', SURFACE],
    ['feed title — fresh', '#6D28D9', SURFACE],
    ['feed time', '#64748B', SURFACE],
    ['feed status — pending', '#92400E', '#FEF3C7'],
    ['feed status — approved', '#166534', '#DCFCE7'],
    ['feed status — failed', '#991B1B', '#FEE2E2'],
    ['feed empty title', '#0F172A', SURFACE],
    ['feed empty body', '#475569', SURFACE],
    ['feed sample label', '#334155', CANVAS],
    ['feed sample detail', '#64748B', CANVAS],
    ['error banner', '#991B1B', '#FEE2E2'],
    ['drawer tab (active)', '#6D28D9', CANVAS],
    ['drawer tab (idle)', '#64748B', CANVAS],
    ['drawer stat value', '#0F172A', SURFACE],
    ['drawer stat label', '#64748B', SURFACE],
    ['drawer body copy', '#475569', SURFACE],
    ['drawer data chip', '#5B21B6', '#F3E8FF'],
    ['drawer rule fact', '#334155', '#F1F5F9'],
    ['available banner', '#14532D', '#DCFCE7'],
    ['menu item', '#334155', SURFACE],
    ['menu item (hover)', '#5B21B6', '#F3E8FF'],
  ]

  it.each(text)('%s reaches 4.5:1', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * WCAG 2.1 SC 1.4.11 — graphical objects and UI component boundaries that
   * carry meaning. Purely decorative boundaries (card outlines, the
   * aria-hidden agent dot rail whose state is also printed as "2 of 5") are
   * excluded by the success criterion itself and are documented in the design
   * note instead.
   */
  const components: readonly (readonly [string, string, string])[] = [
    ['focus ring on a card', '#7C3AED', SURFACE],
    ['focus ring on the canvas', '#7C3AED', CANVAS],
    ['primary button boundary', '#7C3AED', CANVAS],
    ['upgrade button boundary', '#D97706', SURFACE],
    ['active status dot', '#16A34A', '#DCFCE7'],
    ['active agent dot', '#16A34A', SURFACE],
    ['sparkline stroke', '#7C3AED', SURFACE],
    ['confidence fill against its track', '#7C3AED', '#E2E8F0'],
    ['health gauge fill against its track', '#16A34A', '#F1F5F9'],
    ['KPI icon — insights', '#7C3AED', '#F3E8FF'],
    ['KPI icon — health', '#047857', '#DCFCE7'],
    ['KPI icon — actions', '#B45309', '#FEF3C7'],
    ['KPI icon — agents', '#1E40AF', '#DBEAFE'],
  ]

  it.each(components)('%s reaches 3:1 (UI component)', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })

  it('documents the same palette in the design note', () => {
    const doc = readFileSync(new URL('../../../docs/ai-command-center-light-theme.md', import.meta.url), 'utf8')
    for (const token of ['#F8FAFC', '#E2E8F0', '#0F172A', '#475569', '#7C3AED', '#166534', '#92400E']) {
      expect(doc).toContain(token)
    }
  })
})
