// @vitest-environment jsdom
/**
 * Store Coach PDF download (K2) — the report bytes are fetched with the App
 * Bridge bearer (`downloadCoachReviewPdf`) and must be saved without
 * navigating the app frame. The app is embedded in the Shopify admin
 * iframe, so `window.location.assign(pdfUrl)` would replace the whole app
 * with the PDF and a bare `pdfUrl` tokenless request would 401. The fix
 * hands the fetched bytes to a temporary object-URL anchor with the
 * `download` attribute and never touches `window.location`/`window.open`.
 */
import './jsdom-polaris-setup.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerPdfDownload } from './store-coach.js'

let lastBlob: Blob | null
let revoked: string[]

beforeEach(() => {
  lastBlob = null
  revoked = []
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob) => { lastBlob = blob; return 'blob:store-coach-mock' },
    revokeObjectURL: (url: string) => { revoked.push(url) },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('triggerPdfDownload', () => {
  it('clicks a temporary object-url anchor carrying the server filename', () => {
    const clicked: HTMLAnchorElement[] = []
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
    const blob = new Blob(['%PDF-1.4\n%%EOF'], { type: 'application/pdf' })

    triggerPdfDownload({ blob, filename: 'store-coach-review-42.pdf' })

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(clicked).toHaveLength(1)
    const anchor = clicked[0]
    expect(anchor).toBeDefined()
    if (!anchor) return
    expect(lastBlob).toBe(blob)
    expect(anchor.href).toBe('blob:store-coach-mock')
    expect(anchor.download).toBe('store-coach-review-42.pdf')
    expect(anchor.rel).toBe('noopener noreferrer')
    // Same-origin object URL — no new-tab target, no iframe navigation.
    expect(anchor.target).toBe('')
  })

  it('falls back to the default filename when the server omits one', () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })

    triggerPdfDownload({ blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }), filename: null })

    expect(clicked[0]?.download).toBe('store-coach-weekly-review.pdf')
  })

  it('leaves the app frame url untouched and cleans up the anchor + object url', () => {
    const originalHref = window.location.href
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* no-op */ })

    triggerPdfDownload({ blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }), filename: 'review.pdf' })

    expect(window.location.href).toBe(originalHref)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('a')).toHaveLength(0)
    expect(revoked).toEqual(['blob:store-coach-mock'])
  })

  it('is a no-op when object urls are unsupported', () => {
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: undefined,
      revokeObjectURL: undefined,
    }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* no-op */ })

    triggerPdfDownload({ blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }), filename: 'review.pdf' })

    expect(clickSpy).not.toHaveBeenCalled()
  })
})
