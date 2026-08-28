import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * iframe-safe navigation contracts (C1 / C2 / C5), pinned at source level.
 *
 * The web app is embedded inside the Shopify admin iframe. None of these
 * handlers may navigate the app's own frame:
 *   C1 — the Store Coach PDF bytes are fetched with the App Bridge bearer
 *        and saved via an object-url download anchor, never
 *        `window.location.assign(pdfUrl)` / a bare tokenless url.
 *   C2 — "Open in Shopify" admin deep links are `target="_blank"` +
 *        `rel="noopener noreferrer"` anchors (App Bridge navigation is
 *        attempted first when a bridge exposes it); the external OpenAPI
 *        docs link keeps a new tab + noopener noreferrer.
 *   C5 — the install (OAuth) handoff only uses `location.assign` when the
 *        app is a standalone top window; embedded, it opens the top window.
 *   K3 — the GrowthIQ executive PDF goes through the authenticated
 *        `downloadExecutiveReportPdf` fetch + `saveDownloadedFile` blob
 *        anchor; the tokenless `window.open(pdfUrl)` would 401.
 */
const source = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')
/** Source with comments stripped, so pins only match live code (several
 *  modules document the old tokenless pattern they replaced). */
const liveCode = (name: string): string =>
  source(name).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//')).join('\n')

describe('C1 — store coach PDF never navigates the frame', () => {
  const coach = source('./store-coach.tsx')

  it('has no window.location.assign left in the coach workspace', () => {
    expect(coach).not.toContain('window.location.assign')
  })

  it('fetches bytes with the bearer, then saves via an object-url download anchor', () => {
    expect(coach).toContain('downloadCoachReviewPdf')
    // Blob → object URL → temporary anchor; never a bare report url.
    expect(coach).toContain('URL.createObjectURL(file.blob)')
    expect(coach).toContain('anchor.download = file.filename || \'store-coach-weekly-review.pdf\'')
    expect(coach).toContain('anchor.rel = \'noopener noreferrer\'')
    expect(coach).toContain('triggerPdfDownload(file)')
    // No new-tab target and no direct use of the stored pdf url.
    expect(coach).not.toContain('anchor.target')
    expect(coach).not.toContain('triggerPdfDownload(pdfUrl)')
  })
})

describe('K3 — GrowthIQ executive PDF is an authenticated download', () => {
  it('goes through requestFile with the api bearer, never a tokenless window.open href', () => {
    const api = liveCode('./executive-api.ts')
    expect(api).toContain('downloadExecutiveReportPdf')
    expect(api).toContain('requestFile(`/ai-executive/reports/${id}/pdf/download${q(storeId)}`)')
    expect(api).not.toContain('window.open')
    // The callers save the fetched bytes through the shared blob anchor.
    for (const file of ['./executive.tsx', './executive-reports.tsx']) {
      const src = liveCode(file)
      expect(src).toContain('downloadExecutiveReportPdf')
      expect(src).toContain('saveDownloadedFile')
      expect(src).not.toContain('window.open')
      expect(src).not.toContain('executivePdfDownloadUrl')
    }
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
    // The embedded branch must hand the install URL to the top-level window
    // through `navigateTopLevel`, which never passes `noopener`: that feature
    // forces `window.open` to return null, and a null was being read as "the
    // navigation was blocked" — so every install handoff looked like a failure.
    expect(app).toContain('navigateTopLevel(installUrl)')
    // The standalone branch keeps the plain same-window navigation.
    expect(app).toContain('window.location.assign(installUrl)')
    // And the decision is explicitly the top===self check.
    expect(app).toMatch(/window\.top\s*!==\s*window\.self/)
    // No `_top` window.open anywhere in the app shell may carry `noopener`.
    expect(app).not.toMatch(/window\.open\([^)]*'_top'[^)]*noopener/)
  })
})
