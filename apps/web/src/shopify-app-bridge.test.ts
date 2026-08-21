// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embeddedHost, ensureEmbeddedAppBridgeRedirect, ensureShopifyApiKeyMetaTag, getShopifySessionToken, getShopifySessionTokenWithRetry, isEmbeddedShopifyApp, overrideShopifyAppBridgeForTests, resetShopifyAppBridgeStateForTests, setAppBridgeReadyTimingForTests } from './shopify-app-bridge.js'

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
