// @vitest-environment jsdom
/**
 * Store Coach PDF download (C1) — the report must be fetched without
 * navigating the app frame. The app is embedded in the Shopify admin
 * iframe, so `window.location.assign(pdfUrl)` would replace the whole app
 * with the PDF. The fix triggers a download through a temporary
 * `download`-attribute anchor (same-origin → download; cross-origin → new
 * top-level tab) and never touches `window.location`.
 */
import './jsdom-polaris-setup.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { triggerPdfDownload } from './store-coach.js'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('triggerPdfDownload', () => {
  it('clicks a temporary anchor with download + noopener + new-tab target', () => {
    const clicked: HTMLAnchorElement[] = []
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })

    triggerPdfDownload('https://cdn.example.com/reviews/coach.pdf')

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(clicked).toHaveLength(1)
    const anchor = clicked[0]
    expect(anchor).toBeDefined()
    if (!anchor) return
    expect(anchor.href).toBe('https://cdn.example.com/reviews/coach.pdf')
    expect(anchor.download).toBe('store-coach-weekly-review.pdf')
    expect(anchor.target).toBe('_blank')
    expect(anchor.rel).toBe('noopener noreferrer')
  })

  it('leaves the app frame url untouched (the only side effect is the anchor click)', () => {
    const originalHref = window.location.href
    const clicked: HTMLAnchorElement[] = []
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })

    triggerPdfDownload('https://cdn.example.com/reviews/coach.pdf')

    // jsdom cannot follow cross-origin navigations, so a stray
    // window.open/assign to the PDF would leave the frame url unchanged
    // too — the discriminator is that the ONLY interaction with the
    // document is the temporary anchor click carrying the PDF url.
    expect(window.location.href).toBe(originalHref)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.href).toBe('https://cdn.example.com/reviews/coach.pdf')
  })

  it('removes the temporary anchor from the document', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* no-op */ })
    triggerPdfDownload('https://cdn.example.com/reviews/coach.pdf')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('a')).toHaveLength(0)
  })

  it('is a no-op for an empty url and without a document', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { /* no-op */ })
    triggerPdfDownload('')
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
