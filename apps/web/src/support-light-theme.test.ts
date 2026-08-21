import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

/**
 * Theme contracts for the Help & Support redesign (FIX 7). The light theme is
 * the PR spec verbatim — rgb(248, 250, 252) canvas, white cards with borders/shadows,
 * visible FAQ cards, strong status colors, prominent buttons. The dark theme
 * is asserted separately (and negatively) to prove it stays untouched.
 */
describe('Help & Support theme contracts', () => {
  const css = source('./support.css')
  const lightBlock = css.slice(css.indexOf('LIGHT THEME'))

  it('gives the light workspace the rgb(248, 250, 252) canvas from the spec', () => {
    expect(lightBlock).toContain('.app-shell.light-mode .support-workspace')
    expect(lightBlock).toContain('background: rgb(248, 250, 252)')
  })

  it('renders light cards as rgb(255, 255, 255) with rgb(226, 232, 240) borders and soft shadows', () => {
    for (const selector of [
      '.app-shell.light-mode .support-workspace .support-plan-card',
      '.app-shell.light-mode .support-workspace .support-faq,',
      '.app-shell.light-mode .support-workspace .support-tickets,',
      '.app-shell.light-mode .support-workspace .support-empty',
    ]) {
      expect(lightBlock).toContain(selector)
    }
    expect(lightBlock).toContain('background: rgb(255, 255, 255)')
    expect(lightBlock).toContain('border-color: rgb(226, 232, 240)')
    expect(lightBlock).toContain('box-shadow: 0 1px 3px rgba(15, 23, 42, 0.07)')
  })

  it('keeps FAQ and option cards visible on white in light mode', () => {
    expect(lightBlock).toContain('.support-faq-category,')
    expect(lightBlock).toContain('.support-option-card,')
    expect(lightBlock).toContain('.support-ticket-card')
    expect(lightBlock).toContain('.support-faq-item,')
  })

  it('uses strong, readable status colors in light mode', () => {
    expect(lightBlock).toContain('--s-green-strong: rgb(4, 120, 87)')
    expect(lightBlock).toContain('--s-amber-strong: rgb(180, 83, 9)')
    expect(lightBlock).toContain('--s-blue-strong: rgb(29, 78, 216)')
    expect(lightBlock).toContain('--s-green: rgb(5, 150, 105)')
    expect(lightBlock).toContain('--s-amber: rgb(217, 119, 6)')
  })

  it('keeps buttons prominent in light mode with the brand gradient', () => {
    expect(css).toContain('.support-button.primary')
    expect(css).toContain('background: linear-gradient(135deg, rgb(42, 102, 217), rgb(78, 109, 227))')
    expect(css).toContain('box-shadow: 0 7px 18px rgba(47, 98, 214, 0.28)')
  })

  it('scopes every rule to the support page — no global tokens are touched', () => {
    const selectors = css.split('\n').filter((line) => line.trim().startsWith('.') || line.trim().startsWith('.app-shell'))
    expect(selectors.length).toBeGreaterThan(10)
    expect(selectors.every((line) => /support-workspace|support-|@keyframes support-spin|@media/.test(line.trim()) || line.trim().startsWith('}'))).toBe(true)
    // No bleed into other modules' class names.
    expect(css).not.toMatch(/\.(coach|automation|inventory|orders|products|customers|analytics|executive|patternai)-/)
  })

  it('keeps the dark theme as the untouched default', () => {
    const dark = css.slice(0, css.indexOf('LIGHT THEME'))
    expect(dark).toContain('--s-card: rgb(22, 25, 34)')
    expect(dark).toContain('--s-card-inset: rgb(18, 21, 29)')
    expect(dark).toContain('--s-border: rgb(38, 43, 56)')
    expect(dark).not.toContain('background: rgb(248, 250, 252)')
    expect(dark).not.toContain('background: rgb(255, 255, 255)')
  })

  it('never uses fonts below 12px in either theme', () => {
    const fontSizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number.parseFloat(match[1] ?? '12'))
    expect(fontSizes.length).toBeGreaterThan(20)
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(12)
  })

  it('enhances dark-theme card borders as demanded by the spec', () => {
    expect(css).toContain('.support-faq-item.open { border-color: rgba(96, 143, 255, 0.5); }')
    expect(css).toContain('.support-ticket-card.expanded { border-color: rgba(96, 143, 255, 0.5); }')
  })
})
