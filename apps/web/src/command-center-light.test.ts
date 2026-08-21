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
      '--cc-l-canvas: rgb(248, 250, 252)',
      '--cc-l-surface: rgb(255, 255, 255)',
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
  const CANVAS = 'rgb(248, 250, 252)'
  const SURFACE = 'rgb(255, 255, 255)'

  const text: readonly (readonly [string, string, string])[] = [
    ['page title', 'rgb(15, 23, 42)', CANVAS],
    ['page eyebrow (purple)', 'rgb(109, 40, 217)', CANVAS],
    ['page description', 'rgb(71, 85, 105)', CANVAS],
    ['section heading', 'rgb(15, 23, 42)', CANVAS],
    ['section description', 'rgb(71, 85, 105)', CANVAS],
    ['KPI value', 'rgb(15, 23, 42)', SURFACE],
    ['KPI unit / secondary', 'rgb(100, 116, 139)', SURFACE],
    ['KPI label (tooltip trigger)', 'rgb(71, 85, 105)', SURFACE],
    ['KPI empty message', 'rgb(51, 65, 85)', SURFACE],
    ['period chip', 'rgb(109, 40, 217)', 'rgb(243, 232, 255)'],
    ['trend chip — up', 'rgb(22, 101, 52)', 'rgb(220, 252, 231)'],
    ['trend chip — down', 'rgb(153, 27, 27)', 'rgb(254, 226, 226)'],
    ['trend chip — flat', 'rgb(71, 85, 105)', 'rgb(241, 245, 249)'],
    ['health status — healthy', 'rgb(4, 120, 87)', SURFACE],
    ['health status — warning', 'rgb(180, 83, 9)', SURFACE],
    ['health status — critical', 'rgb(185, 28, 28)', SURFACE],
    ['agent name', 'rgb(15, 23, 42)', SURFACE],
    ['agent tagline', 'rgb(71, 85, 105)', SURFACE],
    ['agent stat value', 'rgb(15, 23, 42)', SURFACE],
    ['agent stat label', 'rgb(100, 116, 139)', SURFACE],
    ['agent version chip', 'rgb(71, 85, 105)', 'rgb(241, 245, 249)'],
    ['status pill — active', 'rgb(22, 101, 52)', 'rgb(220, 252, 231)'],
    ['status pill — paused', 'rgb(146, 64, 14)', 'rgb(254, 243, 199)'],
    ['status pill — idle', 'rgb(91, 33, 182)', 'rgb(243, 232, 255)'],
    ['plan badge — requires', 'rgb(146, 64, 14)', 'rgb(254, 243, 199)'],
    ['plan badge — available', 'rgb(22, 101, 52)', 'rgb(220, 252, 231)'],
    ['tier label on growth tint', 'rgb(71, 85, 105)', 'rgb(250, 247, 255)'],
    ['module note', 'rgb(71, 85, 105)', SURFACE],
    ['growth preview quote', 'rgb(51, 65, 85)', CANVAS],
    ['locked sample insight', 'rgb(146, 64, 14)', 'rgb(255, 251, 235)'],
    ['locked group price chip', 'rgb(146, 64, 14)', 'rgb(254, 243, 199)'],
    ['primary button label', 'rgb(255, 255, 255)', 'rgb(124, 58, 237)'],
    ['primary button label (hover)', 'rgb(255, 255, 255)', 'rgb(109, 40, 217)'],
    ['secondary button label', 'rgb(51, 65, 85)', SURFACE],
    ['secondary button label (hover)', 'rgb(109, 40, 217)', 'rgb(243, 232, 255)'],
    ['upgrade button label', 'rgb(31, 41, 55)', 'rgb(245, 158, 11)'],
    ['upgrade button label (light stop)', 'rgb(31, 41, 55)', 'rgb(252, 211, 77)'],
    ['upgrade button label (dark stop)', 'rgb(31, 41, 55)', 'rgb(234, 154, 8)'],
    ['approve button label', 'rgb(255, 255, 255)', 'rgb(21, 128, 61)'],
    ['feed agent', 'rgb(71, 85, 105)', SURFACE],
    ['feed title', 'rgb(15, 23, 42)', SURFACE],
    ['feed title — fresh', 'rgb(109, 40, 217)', SURFACE],
    ['feed time', 'rgb(100, 116, 139)', SURFACE],
    ['feed status — pending', 'rgb(146, 64, 14)', 'rgb(254, 243, 199)'],
    ['feed status — approved', 'rgb(22, 101, 52)', 'rgb(220, 252, 231)'],
    ['feed status — failed', 'rgb(153, 27, 27)', 'rgb(254, 226, 226)'],
    ['feed empty title', 'rgb(15, 23, 42)', SURFACE],
    ['feed empty body', 'rgb(71, 85, 105)', SURFACE],
    ['feed sample label', 'rgb(51, 65, 85)', CANVAS],
    ['feed sample detail', 'rgb(100, 116, 139)', CANVAS],
    ['error banner', 'rgb(153, 27, 27)', 'rgb(254, 226, 226)'],
    ['drawer tab (active)', 'rgb(109, 40, 217)', CANVAS],
    ['drawer tab (idle)', 'rgb(100, 116, 139)', CANVAS],
    ['drawer stat value', 'rgb(15, 23, 42)', SURFACE],
    ['drawer stat label', 'rgb(100, 116, 139)', SURFACE],
    ['drawer body copy', 'rgb(71, 85, 105)', SURFACE],
    ['drawer data chip', 'rgb(91, 33, 182)', 'rgb(243, 232, 255)'],
    ['drawer rule fact', 'rgb(51, 65, 85)', 'rgb(241, 245, 249)'],
    ['available banner', 'rgb(20, 83, 45)', 'rgb(220, 252, 231)'],
    ['menu item', 'rgb(51, 65, 85)', SURFACE],
    ['menu item (hover)', 'rgb(91, 33, 182)', 'rgb(243, 232, 255)'],
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
    ['focus ring on a card', 'rgb(124, 58, 237)', SURFACE],
    ['focus ring on the canvas', 'rgb(124, 58, 237)', CANVAS],
    ['primary button boundary', 'rgb(124, 58, 237)', CANVAS],
    ['upgrade button boundary', 'rgb(217, 119, 6)', SURFACE],
    ['active status dot', 'rgb(22, 163, 74)', 'rgb(220, 252, 231)'],
    ['active agent dot', 'rgb(22, 163, 74)', SURFACE],
    ['sparkline stroke', 'rgb(124, 58, 237)', SURFACE],
    ['confidence fill against its track', 'rgb(124, 58, 237)', 'rgb(226, 232, 240)'],
    ['health gauge fill against its track', 'rgb(22, 163, 74)', 'rgb(241, 245, 249)'],
    ['KPI icon — insights', 'rgb(124, 58, 237)', 'rgb(243, 232, 255)'],
    ['KPI icon — health', 'rgb(4, 120, 87)', 'rgb(220, 252, 231)'],
    ['KPI icon — actions', 'rgb(180, 83, 9)', 'rgb(254, 243, 199)'],
    ['KPI icon — agents', 'rgb(30, 64, 175)', 'rgb(219, 234, 254)'],
  ]

  it.each(components)('%s reaches 3:1 (UI component)', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })

  it('documents the same palette in the design note', () => {
    const doc = readFileSync(new URL('../../../docs/ai-command-center-light-theme.md', import.meta.url), 'utf8')
    for (const token of ['rgb(248, 250, 252)', 'rgb(226, 232, 240)', 'rgb(15, 23, 42)', 'rgb(71, 85, 105)', 'rgb(124, 58, 237)', 'rgb(22, 101, 52)', 'rgb(146, 64, 14)']) {
      expect(doc).toContain(token)
    }
  })
})
