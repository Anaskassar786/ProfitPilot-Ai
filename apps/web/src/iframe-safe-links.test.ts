import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * iframe-safe navigation contracts (C1 / C2 / C5), pinned at source level.
 *
 * The web app is embedded inside the Shopify admin iframe. None of these
 * handlers may navigate the app's own frame:
 *   C1 — the Store Coach PDF is fetched via a download anchor, never
 *        `window.location.assign(pdfUrl)`.
 *   C2 — "Open in Shopify" admin deep links are `target="_blank"` +
 *        `rel="noopener noreferrer"` anchors (App Bridge navigation is
 *        attempted first when a bridge exposes it); the external OpenAPI
 *        docs link keeps a new tab + noopener noreferrer.
 *   C5 — the install (OAuth) handoff only uses `location.assign` when the
 *        app is a standalone top window; embedded, it opens the top window.
 */
const source = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('C1 — store coach PDF never navigates the frame', () => {
  const coach = source('./store-coach.tsx')

  it('has no window.location.assign left in the coach workspace', () => {
    expect(coach).not.toContain('window.location.assign')
  })

  it('downloads through a temporary anchor (download + noopener + new tab)', () => {
    expect(coach).toContain('anchor.download = \'store-coach-weekly-review.pdf\'')
    expect(coach).toContain('anchor.rel = \'noopener noreferrer\'')
    expect(coach).toContain('anchor.target = \'_blank\'')
    expect(coach).toContain('triggerPdfDownload(pdfUrl)')
  })
})

describe('C2 — open-in-Shopify links are iframe-safe', () => {
  it('orders + inventory deep links are new-tab anchors with noopener noreferrer', () => {
    for (const file of ['./orders.tsx', './inventory.tsx']) {
      const src = source(file)
      // The shared link component is the single place that builds the anchor.
      expect(src).toContain('target="_blank" rel="noopener noreferrer"')
      expect(src).toContain('openAdminUrlInNewTab')
      // No bare/noreferrer-only external admin link may remain.
      expect(src).not.toContain('rel="noreferrer"')
    }
  })

  it('the patternai external OpenAPI docs link keeps new tab + noopener noreferrer', () => {
    const src = source('./patternai.tsx')
    const line = src.split('\n').find((candidate) => candidate.includes('OpenAPI 3.1 spec:'))
    expect(line).toBeDefined()
    expect(line).toContain('target="_blank"')
    expect(line).toContain('rel="noopener noreferrer"')
  })
})

describe('C5 — install (OAuth) handoff is branch-aware', () => {
  const app = source('./App.tsx')

  it('only assigns the top window when standalone, else opens the top window', () => {
    // The embedded branch must hand the install URL to the top-level window.
    expect(app).toContain('window.open(installUrl, \'_top\', \'noopener\')')
    // The standalone branch keeps the plain same-window navigation.
    expect(app).toContain('window.location.assign(installUrl)')
    // And the decision is explicitly the top===self check.
    expect(app).toMatch(/window\.top\s*!==\s*window\.self/)
  })
})
