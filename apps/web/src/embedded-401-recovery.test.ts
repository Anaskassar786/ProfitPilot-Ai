// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attemptEmbeddedReinstallRedirect, embeddedShopDomainFromUrl, isEmbeddedReinstallInFlight, isUnauthorizedResponse, resetApiClientStateForTests, requestJson, setEmbeddedAuthFailureHandler, triggerEmbeddedReinstallRedirect } from './api.js'
import type { Fetcher } from './api.js'
import { getShopifySessionToken, getShopifySessionTokenWithRetry } from './shopify-app-bridge.js'
import type { EmbeddedSessionTokenResult } from './shopify-app-bridge.js'

/**
 * 401 AUTO-RECOVERY contract: an unauthorized response that survives the
 * fetcher's silent fresh-token retry must NOT leave the merchant stuck on
 * permanent red 401 cards. The app derives the store's myshopify domain from
 * the embedded URL (strictly normalized) and bounces the TOP-LEVEL window to
 * the OAuth reinstall endpoint with an ABSOLUTE URL (the top frame is
 * Shopify's origin, so a relative path would 404 there) — App Bridge
 * navigation when the loaded bridge exposes it, otherwise
 * `window.open(url, '_top')` (a popup-blocked call returns null and is
 * detected), or a plain `location.assign` when the app already runs at the
 * top level. When the redirect is dispatched, no static red
 * "Authentication is required" card is shown; the banner only latches as
 * the fallback when no navigation surface could take over.
 */
vi.mock('./shopify-app-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shopify-app-bridge.js')>()
  return {
    ...actual,
    getShopifySessionToken: vi.fn(async (): Promise<EmbeddedSessionTokenResult> => ({ status: 'ok', token: 'session-token' })),
    getShopifySessionTokenWithRetry: vi.fn(async (): Promise<EmbeddedSessionTokenResult> => ({ status: 'ok', token: 'session-token' })),
  }
})

const sessionTokenMock = vi.mocked(getShopifySessionToken)

const HOST = btoa('https://admin.shopify.com/store/commander-pilot')
const APP_ORIGIN = 'http://localhost:3000'

/**
 * Simulates the app running nested inside the Shopify admin iframe by making
 * `window.top !== window.self` (the embedded marker). Returns a restore fn.
 */
function simulateEmbeddedIframe(): () => void {
  const originalTop = window.top
  Object.defineProperty(window, 'top', { configurable: true, value: {} })
  return () => Object.defineProperty(window, 'top', { configurable: true, value: originalTop })
}

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

describe('unauthorized response detection (status OR error code)', () => {
  it('treats HTTP 401 as unauthorized regardless of payload', () => {
    expect(isUnauthorizedResponse(null, 401)).toBe(true)
    expect(isUnauthorizedResponse({}, 401)).toBe(true)
  })

  it('treats UNAUTHORIZED and STORE_NOT_FOUND error codes as unauthorized on any status', () => {
    expect(isUnauthorizedResponse({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required' } }, 200)).toBe(true)
    expect(isUnauthorizedResponse({ ok: false, error: { code: 'STORE_NOT_FOUND', message: 'Store not found' } }, 404)).toBe(true)
  })

  it('does not treat other codes or statuses as unauthorized', () => {
    expect(isUnauthorizedResponse({ ok: false, error: { code: 'FORBIDDEN', message: 'no' } }, 403)).toBe(false)
    expect(isUnauthorizedResponse(null, 500)).toBe(false)
    expect(isUnauthorizedResponse({ ok: true, data: {} }, 200)).toBe(false)
  })
})

describe('top-level reinstall redirect', () => {
  it('uses App Bridge navigation.navigate (v4 CDN surface) with an absolute URL', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const navigate = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    ;(window as { shopify?: unknown }).shopify = { navigation: { navigate } }
    try {
      expect(triggerEmbeddedReinstallRedirect()).toBe(true)
      expect(navigate).toHaveBeenCalledWith(`${APP_ORIGIN}/shopify/install?shop=commander-pilot.myshopify.com`)
      expect(open).not.toHaveBeenCalled()
    } finally {
      delete (window as { shopify?: unknown }).shopify
      restore()
    }
  })

  it('uses App Bridge navigate({ url, target: _top }) when the bridge exposes it directly', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const navigate = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    ;(window as { shopify?: unknown }).shopify = { navigate }
    try {
      expect(triggerEmbeddedReinstallRedirect()).toBe(true)
      expect(navigate).toHaveBeenCalledWith({ url: `${APP_ORIGIN}/shopify/install?shop=commander-pilot.myshopify.com`, target: '_top' })
      expect(open).not.toHaveBeenCalled()
    } finally {
      delete (window as { shopify?: unknown }).shopify
      restore()
    }
  })

  it('falls back to window.open _top (absolute URL) when no App Bridge navigate API exists', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    try {
      expect(triggerEmbeddedReinstallRedirect()).toBe(true)
      expect(open).toHaveBeenCalledWith(`${APP_ORIGIN}/shopify/install?shop=commander-pilot.myshopify.com`, '_top', 'noopener')
    } finally {
      restore()
    }
  })

  it('reports failure when window.open is popup-blocked (returns null) instead of claiming success', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      expect(triggerEmbeddedReinstallRedirect()).toBe(false)
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('redirects standalone (top-level) sessions via location.assign when the shop is known', () => {
    window.history.replaceState({}, '', '/?shop=commander-pilot.myshopify.com')
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, href: `${APP_ORIGIN}/?shop=commander-pilot.myshopify.com`, search: '?shop=commander-pilot.myshopify.com', assign },
    })
    try {
      expect(triggerEmbeddedReinstallRedirect()).toBe(true)
      expect(assign).toHaveBeenCalledWith(`${APP_ORIGIN}/shopify/install?shop=commander-pilot.myshopify.com`)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('does nothing when no store can be identified (no shop, no host)', () => {
    window.history.replaceState({}, '', '/')
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    expect(triggerEmbeddedReinstallRedirect()).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('fires at most once per page load no matter how many endpoints 401', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    try {
      expect(attemptEmbeddedReinstallRedirect()).toBe(true)
      expect(attemptEmbeddedReinstallRedirect()).toBe(true)
      expect(attemptEmbeddedReinstallRedirect()).toBe(true)
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('isEmbeddedReinstallInFlight reflects whether a redirect is in flight', () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    vi.spyOn(window, 'open').mockReturnValue({} as Window)
    try {
      expect(isEmbeddedReinstallInFlight()).toBe(false)
      attemptEmbeddedReinstallRedirect()
      expect(isEmbeddedReinstallInFlight()).toBe(true)
    } finally {
      restore()
    }
  })
})

describe('401 auto-recovery in the central fetcher', () => {
  it('bounces to the reinstall endpoint when a 401 survives the fresh-token retry — and shows NO static red card', async () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    try {
      const fetcher: Fetcher = async () => unauthorizedResponse()
      await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).rejects.toMatchObject({ status: 401 })
      // The top-level reinstall redirect was dispatched exactly once, so the
      // merchant is NEVER shown the static "Authentication is required" card.
      expect(failures).toHaveLength(0)
      expect(open).toHaveBeenCalledTimes(1)
      expect(open).toHaveBeenCalledWith(`${APP_ORIGIN}/shopify/install?shop=commander-pilot.myshopify.com`, '_top', 'noopener')
    } finally {
      restore()
    }
  })

  it('latches the banner as the fallback when the top-level navigation is popup-blocked', async () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    try {
      const fetcher: Fetcher = async () => unauthorizedResponse()
      await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).rejects.toMatchObject({ status: 401 })
      expect(failures).toHaveLength(1)
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('redirects on a STORE_NOT_FOUND error envelope (any status) after the fresh-token retry', async () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    try {
      const storeNotFound = () => new Response(JSON.stringify({ ok: false, error: { code: 'STORE_NOT_FOUND', message: 'Store not found' } }), { status: 404, headers: { 'content-type': 'application/json' } })
      const fetcher: Fetcher = async () => storeNotFound()
      await expect(requestJson('/session/context', {}, fetcher)).rejects.toMatchObject({ status: 404, code: 'STORE_NOT_FOUND' })
      expect(failures).toHaveLength(0)
      expect(open).toHaveBeenCalledTimes(1)
      expect(open).toHaveBeenCalledWith(`${APP_ORIGIN}/shopify/install?shop=commander-pilot.myshopify.com`, '_top', 'noopener')
    } finally {
      restore()
    }
  })

  it('does not redirect for a transient 401 that the fresh-token retry heals', async () => {
    window.history.replaceState({}, '', `/?shop=commander-pilot.myshopify.com&host=${HOST}`)
    const restore = simulateEmbeddedIframe()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    let calls = 0
    try {
      const fetcher: Fetcher = async () => {
        calls += 1
        if (calls === 1) return unauthorizedResponse()
        return new Response(JSON.stringify({ ok: true, data: { revenue: [], orders: [], productSales: [], customerCohorts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).resolves.toBeTruthy()
      expect(open).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('stays on the banner-only path in standalone (non-embedded) sessions without a known shop', async () => {
    window.history.replaceState({}, '', '/')
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const fetcher: Fetcher = async () => unauthorizedResponse()
    await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).rejects.toMatchObject({ status: 401 })
    expect(failures).toHaveLength(1)
    expect(open).not.toHaveBeenCalled()
  })
})
