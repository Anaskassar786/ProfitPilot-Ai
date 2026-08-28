// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embeddedHost, ensureEmbeddedAppBridgeRedirect, ensureShopifyApiKeyMetaTag, getShopifySessionToken, getShopifySessionTokenWithRetry, isEmbeddedShopifyApp, navigateTopLevel, openAdminUrlInNewTab, redirectToShopifyCheckout, overrideShopifyAppBridgeForTests, resetShopifyAppBridgeStateForTests, setAppBridgeReadyTimingForTests } from './shopify-app-bridge.js'

/**
 * App Bridge integration (embedded session tokens). jsdom so the module's
 * `window`/`window.shopify` paths run for real; no network calls are made.
 */

beforeEach(() => resetShopifyAppBridgeStateForTests())
afterEach(() => resetShopifyAppBridgeStateForTests())

describe('embedded detection', () => {
  it('recognizes the Shopify host query parameter', () => {
    expect(embeddedHost('?host=abc123&shop=shop.myshopify.com')).toBe('abc123')
    expect(embeddedHost('?shop=shop.myshopify.com')).toBeNull()
    expect(embeddedHost('?host=%20%20')).toBeNull()
    expect(embeddedHost('')).toBeNull()
  })

  it('reports standalone mode without a host parameter (local dev)', () => {
    expect(isEmbeddedShopifyApp('?shop=shop.myshopify.com')).toBe(false)
    expect(isEmbeddedShopifyApp('?host=abc123')).toBe(true)
  })
})

describe('getShopifySessionToken', () => {
  it('is a no-op when the app is not embedded', async () => {
    const result = await getShopifySessionToken('?shop=shop.myshopify.com', 'test-api-key')
    expect(result).toEqual({ status: 'not-embedded' })
  })

  it('reports a missing build-time API key instead of crashing', async () => {
    const result = await getShopifySessionToken('?host=abc123', null)
    expect(result).toEqual({ status: 'unavailable', message: expect.stringContaining('VITE_SHOPIFY_API_KEY') })
  })

  it('returns a fresh token from the App Bridge createApp API', async () => {
    const idToken = vi.fn(async () => 'signed-shopify-session-token')
    const createApp = vi.fn(() => ({ idToken }))
    ;(window as unknown as { shopify: unknown }).shopify = { default: createApp }
    const result = await getShopifySessionToken('?host=abc123', 'test-api-key')
    expect(result).toEqual({ status: 'ok', token: 'signed-shopify-session-token' })
    expect(createApp).toHaveBeenCalledWith({ apiKey: 'test-api-key', host: 'abc123', forceRedirect: true })
    expect(idToken).toHaveBeenCalledTimes(1)
  })

  it('reuses one App Bridge app instance across token requests', async () => {
    const idToken = vi.fn(async () => 'signed-shopify-session-token')
    const createApp = vi.fn(() => ({ idToken }))
    ;(window as unknown as { shopify: unknown }).shopify = { default: createApp }
    await getShopifySessionToken('?host=abc123', 'test-api-key')
    await getShopifySessionToken('?host=abc123', 'test-api-key')
    expect(createApp).toHaveBeenCalledTimes(1)
    expect(idToken).toHaveBeenCalledTimes(2)
  })

  it('falls back to the legacy window.shopify.idToken() API', async () => {
    const idToken = vi.fn(async () => 'legacy-signed-token')
    ;(window as unknown as { shopify: unknown }).shopify = { idToken }
    const result = await getShopifySessionToken('?host=abc123', 'test-api-key')
    expect(result).toEqual({ status: 'ok', token: 'legacy-signed-token' })
  })

  it('returns unavailable when App Bridge is missing or broken', async () => {
    ;(window as unknown as { shopify: unknown }).shopify = undefined
    // The CDN script is absent; the readiness poll must give up rather than hang.
    setAppBridgeReadyTimingForTests(60, 10)
    const missing = await getShopifySessionToken('?host=abc123', 'test-api-key')
    expect(missing.status).toBe('unavailable')
    ;(window as unknown as { shopify: unknown }).shopify = { default: () => ({}) }
    const broken = await getShopifySessionToken('?host=abc123', 'test-api-key')
    expect(broken.status).toBe('unavailable')
  })

  it('never lets a throwing bridge escape as an exception', async () => {
    overrideShopifyAppBridgeForTests({ idToken: async () => { throw new Error('idToken rejected') } })
    const result = await getShopifySessionToken('?host=abc123', 'test-api-key')
    expect(result).toEqual({ status: 'unavailable', message: 'idToken rejected' })
  })

  it('supports a test-injected bridge for header-level tests', async () => {
    overrideShopifyAppBridgeForTests({ idToken: async () => 'injected-token' })
    const result = await getShopifySessionToken('?host=abc123', 'test-api-key')
    expect(result).toEqual({ status: 'ok', token: 'injected-token' })
  })

  it('uses window.shopify.idToken() without a build-time API key (App Bridge v4)', async () => {
    const idToken = vi.fn(async () => 'cdn-session-token')
    ;(window as unknown as { shopify: unknown }).shopify = { idToken }
    const result = await getShopifySessionToken('?host=abc123', null)
    expect(result).toEqual({ status: 'ok', token: 'cdn-session-token' })
    expect(idToken).toHaveBeenCalledTimes(1)
  })
})

describe('getShopifySessionTokenWithRetry (HOTFIX 2 boot warm-up)', () => {
  it('retries once when the first token request is transiently unavailable', async () => {
    let calls = 0
    overrideShopifyAppBridgeForTests({
      idToken: async () => {
        calls += 1
        if (calls === 1) throw new Error('bridge still booting')
        return 'signed-shopify-session-token'
      },
    })
    const result = await getShopifySessionTokenWithRetry('?host=abc123', 'test-api-key')
    expect(result).toEqual({ status: 'ok', token: 'signed-shopify-session-token' })
    expect(calls).toBe(2)
  })

  it('gives up after the retry budget instead of hanging', async () => {
    let calls = 0
    overrideShopifyAppBridgeForTests({
      idToken: async () => {
        calls += 1
        throw new Error('token mint refused')
      },
    })
    const result = await getShopifySessionTokenWithRetry('?host=abc123', 'test-api-key')
    expect(result.status).toBe('unavailable')
    expect(calls).toBe(2) // initial attempt + 1 retry
  })

  it('does not retry when the app is not embedded', async () => {
    overrideShopifyAppBridgeForTests({ idToken: async () => { throw new Error('should not be called') } })
    const result = await getShopifySessionTokenWithRetry('?shop=shop.myshopify.com', 'test-api-key')
    expect(result).toEqual({ status: 'not-embedded' })
  })
})

describe('ensureShopifyApiKeyMetaTag (HOTFIX 2 App Bridge boot)', () => {
  it('writes the api key into a missing meta tag and never overwrites a real key', () => {
    document.querySelector('meta[name="shopify-api-key"]')?.remove()
    ensureShopifyApiKeyMetaTag('client-id-from-env')
    const meta = document.querySelector('meta[name="shopify-api-key"]')
    expect(meta?.getAttribute('content')).toBe('client-id-from-env')
    // Idempotent: a second call with a different key must not clobber the first.
    ensureShopifyApiKeyMetaTag('other-client')
    expect(document.querySelector('meta[name="shopify-api-key"]')?.getAttribute('content')).toBe('client-id-from-env')
    document.querySelector('meta[name="shopify-api-key"]')?.remove()
  })
})

describe('ensureEmbeddedAppBridgeRedirect', () => {
  it('is a no-op when the app is already nested in an iframe', () => {
    const replace = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'top', { configurable: true, value: {} })
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, pathname: '/', search: '?host=abc&shop=demo.myshopify.com', replace } })
    expect(ensureEmbeddedAppBridgeRedirect('?host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZGVtbw==', 'client-id')).toBe(false)
    expect(replace).not.toHaveBeenCalled()
    Object.defineProperty(window, 'top', { configurable: true, value: window.self })
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  })

  it('redirects a standalone host load into Shopify admin', () => {
    const replace = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'top', { configurable: true, value: window.self })
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/recommendations', search: '?host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZGVtbw==', replace } })
    const redirected = ensureEmbeddedAppBridgeRedirect('?host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZGVtbw==', 'client-id')
    expect(redirected).toBe(true)
    expect(replace).toHaveBeenCalledWith('https://admin.shopify.com/store/demo/apps/client-id/recommendations?host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZGVtbw==')
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  })
})

describe('redirectToShopifyCheckout', () => {
  it('uses App Bridge top-level navigation from an embedded iframe', () => {
    const navigate = vi.fn()
    Object.defineProperty(window, 'top', { configurable: true, value: {} })
    ;(window as unknown as { shopify: unknown }).shopify = { navigate }
    redirectToShopifyCheckout('https://admin.shopify.com/store/demo/charges/1')
    expect(navigate).toHaveBeenCalledWith({ url: 'https://admin.shopify.com/store/demo/charges/1', target: '_top' })
    Object.defineProperty(window, 'top', { configurable: true, value: window.self })
    delete (window as unknown as { shopify?: unknown }).shopify
  })

  it('rejects non-HTTPS checkout URLs', () => {
    expect(() => redirectToShopifyCheckout('http://example.com/charge')).toThrow('HTTPS')
  })
})

describe('navigateTopLevel (401 auto-recovery iframe escape)', () => {
  const INSTALL = 'http://localhost:3000/shopify/install?shop=commander-pilot.myshopify.com'
  const nested = (): (() => void) => {
    const originalTop = window.top
    Object.defineProperty(window, 'top', { configurable: true, value: {} })
    return () => Object.defineProperty(window, 'top', { configurable: true, value: originalTop })
  }

  it('uses App Bridge navigation.navigate (v4 CDN surface) from an embedded iframe', () => {
    const restore = nested()
    const navigate = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    ;(window as unknown as { shopify: unknown }).shopify = { navigation: { navigate } }
    try {
      expect(navigateTopLevel(INSTALL)).toBe(true)
      expect(navigate).toHaveBeenCalledWith(INSTALL)
      expect(open).not.toHaveBeenCalled()
    } finally {
      delete (window as unknown as { shopify?: unknown }).shopify
      restore()
    }
  })

  it('uses the direct navigate({ url, target: _top }) API when exposed', () => {
    const restore = nested()
    const navigate = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    ;(window as unknown as { shopify: unknown }).shopify = { navigate }
    try {
      expect(navigateTopLevel(INSTALL)).toBe(true)
      expect(navigate).toHaveBeenCalledWith({ url: INSTALL, target: '_top' })
      expect(open).not.toHaveBeenCalled()
    } finally {
      delete (window as unknown as { shopify?: unknown }).shopify
      restore()
    }
  })

  it('falls back to window.open(url, _top) when the v4 CDN bridge exposes only idToken()', () => {
    const restore = nested()
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    ;(window as unknown as { shopify: unknown }).shopify = { idToken: vi.fn(async () => 'token') }
    try {
      expect(navigateTopLevel(INSTALL)).toBe(true)
      expect(open).toHaveBeenCalledWith(INSTALL, '_top')
    } finally {
      delete (window as unknown as { shopify?: unknown }).shopify
      restore()
    }
  })

  it('never passes `noopener` — it makes window.open return null and silently broke every auto-recovery', () => {
    // Regression test. `noopener` disowns the opener, so per MDN window.open
    // "returns null" whenever the feature is set. The old code read that null
    // as "popup blocked" and returned false, so the merchant was dropped on
    // the static red "Session expired" card instead of being re-authorized.
    const restore = nested()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      expect(navigateTopLevel(INSTALL)).toBe(true)
      expect(open).toHaveBeenCalledTimes(1)
      const args = open.mock.calls[0] ?? []
      expect(args[1]).toBe('_top')
      expect(args).toHaveLength(2)
    } finally {
      restore()
    }
  })

  it('treats a null return from window.open(_top) as dispatched, not popup-blocked', () => {
    // `_top` navigates the existing top-level frame rather than opening a
    // popup, so browsers legitimately return null. Reporting false here was
    // the bug that made the 401 auto-recovery look broken.
    const restore = nested()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      expect(navigateTopLevel(INSTALL)).toBe(true)
      expect(open).toHaveBeenCalledWith(INSTALL, '_top')
    } finally {
      restore()
    }
  })

  it('reports failure only when no navigation surface can be reached at all', () => {
    const restore = nested()
    const open = vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('blocked by the embed') })
    try {
      expect(navigateTopLevel(INSTALL)).toBe(false)
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('navigates the app itself via location.assign when it already runs at the top level', () => {
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } })
    try {
      expect(navigateTopLevel(INSTALL)).toBe(true)
      expect(assign).toHaveBeenCalledWith(INSTALL)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('never throws for a malformed bridge surface', () => {
    const restore = nested()
    ;(window as unknown as { shopify: unknown }).shopify = { navigation: { navigate: 'not-a-function' }, navigate: 42 }
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    try {
      expect(navigateTopLevel(INSTALL)).toBe(true)
      expect(open).toHaveBeenCalledWith(INSTALL, '_top')
    } finally {
      delete (window as unknown as { shopify?: unknown }).shopify
      restore()
    }
  })
})

describe('openAdminUrlInNewTab', () => {
  afterEach(() => {
    delete (window as unknown as { shopify?: unknown }).shopify
  })

  it('returns false without a bridge so the anchor fallback (new top-level tab) takes over', () => {
    delete (window as unknown as { shopify?: unknown }).shopify
    expect(openAdminUrlInNewTab('https://shop.myshopify.com/admin/orders/123')).toBe(false)
  })

  it('returns false for an empty url even when a bridge is present', () => {
    ;(window as unknown as { shopify: unknown }).shopify = { idToken: vi.fn() }
    expect(openAdminUrlInNewTab('')).toBe(false)
  })

  it('uses the App Bridge Navigation.openExternal action when exposed', () => {
    const openExternal = vi.fn()
    ;(window as unknown as { shopify: unknown }).shopify = { Navigation: { openExternal } }
    const handled = openAdminUrlInNewTab('https://shop.myshopify.com/admin/products/456')
    expect(handled).toBe(true)
    expect(openExternal).toHaveBeenCalledWith({ url: 'https://shop.myshopify.com/admin/products/456' })
  })

  it('falls back to the anchor when the v4 CDN bridge exposes only idToken()', () => {
    ;(window as unknown as { shopify: unknown }).shopify = { idToken: vi.fn(async () => 'token') }
    expect(openAdminUrlInNewTab('https://shop.myshopify.com/admin/orders/123')).toBe(false)
  })

  it('never throws when the bridge surface is malformed', () => {
    ;(window as unknown as { shopify: unknown }).shopify = { Navigation: { openExternal: 'not-a-function' } }
    expect(openAdminUrlInNewTab('https://shop.myshopify.com/admin/orders/123')).toBe(false)
  })
})
