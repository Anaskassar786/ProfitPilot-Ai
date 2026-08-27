// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attemptEmbeddedReinstallRedirect, embeddedShopDomainFromUrl, resetApiClientStateForTests, requestJson, setEmbeddedAuthFailureHandler, triggerEmbeddedReinstallRedirect } from './api.js'
import type { Fetcher } from './api.js'
import { getShopifySessionToken, getShopifySessionTokenWithRetry } from './shopify-app-bridge.js'
import type { EmbeddedSessionTokenResult } from './shopify-app-bridge.js'

/**
 * 401 AUTO-RECOVERY contract: a 401 that survives the fetcher's silent
 * fresh-token retry must NOT leave the merchant stuck on permanent red 401
 * cards. The app derives the store's myshopify domain from the embedded URL
 * (strictly normalized) and bounces the TOP-LEVEL window to the OAuth
 * reinstall endpoint — App Bridge `navigate` when available, otherwise
 * `window.open(url, '_top')`.
 */
vi.mock('./shopify-app-bridge.js', () => ({
  getShopifySessionToken: vi.fn(async (): Promise<EmbeddedSessionTokenResult> => ({ status: 'ok', token: 'session-token' })),
  getShopifySessionTokenWithRetry: vi.fn(async (): Promise<EmbeddedSessionTokenResult> => ({ status: 'ok', token: 'session-token' })),
}))

const sessionTokenMock = vi.mocked(getShopifySessionToken)

const HOST = btoa('https://admin.shopify.com/store/commander-pilot')

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required' } }), { status: 401, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  resetApiClientStateForTests()
  sessionTokenMock.mockReset()
  sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'session-token' })
  setEmbeddedAuthFailureHandler(null)
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

describe('embedded shop domain resolution for reinstall recovery', () => {
  it('normalizes the shop parameter exactly like the API (case, scheme, trailing slash)', () => {
    expect(embeddedShopDomainFromUrl(`?shop=Commander-Pilot.myshopify.com/&host=${HOST}`)).toBe('commander-pilot.myshopify.com')
    expect(embeddedShopDomainFromUrl(`?shop=https://COMMANDER-PILOT.myshopify.com&host=${HOST}`)).toBe('commander-pilot.myshopify.com')
    expect(embeddedShopDomainFromUrl(`?shop= commander-pilot.myshopify.com &host=${HOST}`)).toBe('commander-pilot.myshopify.com')
  })

  it('completes a bare store handle to *.myshopify.com', () => {
    expect(embeddedShopDomainFromUrl(`?shop=commander-pilot&host=${HOST}`)).toBe('commander-pilot.myshopify.com')
  })

  it('falls back to the decoded admin host when no shop parameter is present', () => {
    expect(embeddedShopDomainFromUrl(`?host=${HOST}`)).toBe('commander-pilot.myshopify.com')
  })

  it('refuses to identify a store outside the embedded admin', () => {
    expect(embeddedShopDomainFromUrl('?shop=commander-pilot.myshopify.com')).toBeNull()
    expect(embeddedShopDomainFromUrl('')).toBeNull()
  })

  it('never derives a non-Shopify domain from hostile input', () => {
    expect(embeddedShopDomainFromUrl(`?shop=https://evil.example.com/&host=${HOST}`)).toBe('commander-pilot.myshopify.com')
    expect(embeddedShopDomainFromUrl(`?shop=not%20a%20domain&host=${HOST}`)).toBe('commander-pilot.myshopify.com')
  })
})

describe('top-level reinstall redirect', () => {
  it('uses App Bridge navigate with target _top when the bridge exposes it', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const navigate = vi.fn()
    ;(window as { shopify?: unknown }).shopify = { navigate }
    try {
      expect(triggerEmbeddedReinstallRedirect()).toBe(true)
      expect(navigate).toHaveBeenCalledWith({ url: '/shopify/install?shop=commander-pilot.myshopify.com', target: '_top' })
    } finally {
      delete (window as { shopify?: unknown }).shopify
    }
  })

  it('falls back to window.open _top when no App Bridge navigate API exists', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    expect(triggerEmbeddedReinstallRedirect()).toBe(true)
    expect(open).toHaveBeenCalledWith('/shopify/install?shop=commander-pilot.myshopify.com', '_top', 'noopener')
  })

  it('does nothing outside the embedded admin (no host parameter)', () => {
    window.history.replaceState({}, '', '/?shop=commander-pilot.myshopify.com')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    expect(triggerEmbeddedReinstallRedirect()).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('fires at most once per page load no matter how many endpoints 401', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    expect(attemptEmbeddedReinstallRedirect()).toBe(true)
    expect(attemptEmbeddedReinstallRedirect()).toBe(false)
    expect(attemptEmbeddedReinstallRedirect()).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('401 auto-recovery in the central fetcher', () => {
  it('bounces to the reinstall endpoint when a 401 survives the fresh-token retry', async () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const fetcher: Fetcher = async () => unauthorizedResponse()
    await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).rejects.toMatchObject({ status: 401 })
    // The banner still latches (fallback UX), AND the top-level redirect
    // was dispatched exactly once.
    expect(failures).toHaveLength(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('/shopify/install?shop=commander-pilot.myshopify.com', '_top', 'noopener')
  })

  it('does not redirect for a transient 401 that the fresh-token retry heals', async () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    let calls = 0
    const fetcher: Fetcher = async () => {
      calls += 1
      if (calls === 1) return unauthorizedResponse()
      return new Response(JSON.stringify({ ok: true, data: { revenue: [], orders: [], productSales: [], customerCohorts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).resolves.toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })

  it('stays on the banner-only path in standalone (non-embedded) sessions', async () => {
    window.history.replaceState({}, '', '/')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const fetcher: Fetcher = async () => unauthorizedResponse()
    await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).rejects.toMatchObject({ status: 401 })
    expect(failures).toHaveLength(1)
    expect(open).not.toHaveBeenCalled()
  })
})
