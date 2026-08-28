// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  unauthorizedGuidance,
  lastSessionTokenOutcome,
  resetApiClientStateForTests,
  resetSessionTokenDiagnosticsForTests,
  requestJson,
  setEmbeddedAuthFailureHandler,
} from './api.js'
import type { Fetcher } from './api.js'
import { getShopifySessionToken } from './shopify-app-bridge.js'
import type { EmbeddedSessionTokenResult } from './shopify-app-bridge.js'

/**
 * Three very different failures used to produce one identical red card —
 * "Your Shopify session expired — reload the app to reconnect." — which is why
 * the incident report could not tell "the app is open outside the admin" from
 * "App Bridge could not mint a token" from "the credentials drifted". The
 * fetcher now remembers how the last token mint went and the banner says the
 * thing that actually happened.
 */
vi.mock('./shopify-app-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shopify-app-bridge.js')>()
  return {
    ...actual,
    getShopifySessionToken: vi.fn(async (): Promise<EmbeddedSessionTokenResult> => ({ status: 'ok', token: 'session-token' })),
  }
})

const sessionTokenMock = vi.mocked(getShopifySessionToken)

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required' } }), { status: 401, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  resetApiClientStateForTests()
  resetSessionTokenDiagnosticsForTests()
  sessionTokenMock.mockReset()
  sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'session-token' })
  setEmbeddedAuthFailureHandler(null)
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

describe('unauthorizedGuidance', () => {
  it('names the admin when the app is open outside it (no host parameter)', () => {
    const message = unauthorizedGuidance({ status: 'not-embedded' })
    expect(message).toContain('Shopify admin')
    expect(message).not.toContain('expired')
  })

  it('names App Bridge by name when it could not mint a token', () => {
    const message = unauthorizedGuidance({ status: 'unavailable', message: 'VITE_SHOPIFY_API_KEY is not configured for this build' })
    expect(message).toContain('VITE_SHOPIFY_API_KEY is not configured for this build')
    expect(message).toContain('session token')
  })

  it('keeps the expiry wording only when a token was actually sent', () => {
    expect(unauthorizedGuidance({ status: 'ok', token: 'x' })).toContain('session expired')
    expect(unauthorizedGuidance(null)).toContain('session expired')
  })
})

describe('the banner reflects what actually failed', () => {
  /**
   * No `host` parameter, no known shop: the reinstall redirect has nothing to
   * dispatch, so the banner is the only surface — and it must not blame expiry
   * for a page that was simply never inside the admin.
   */
  it('tells the merchant to open the app from Shopify admin when no token was ever requested', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'not-embedded' })
    const messages: string[] = []
    setEmbeddedAuthFailureHandler((message) => messages.push(message))
    const fetcher: Fetcher = async () => unauthorizedResponse()
    await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).rejects.toMatchObject({ status: 401 })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Shopify admin')
    expect(lastSessionTokenOutcome()).toMatchObject({ status: 'not-embedded' })
  })

  it('surfaces the App Bridge reason when the bridge is asked and cannot mint', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'unavailable', message: 'Shopify App Bridge did not load (the CDN script may be blocked)' })
    const messages: string[] = []
    setEmbeddedAuthFailureHandler((message) => messages.push(message))
    const fetcher: Fetcher = async () => unauthorizedResponse()
    await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).rejects.toMatchObject({ status: 401 })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('CDN script may be blocked')
  })

  it('records the fresh-token retry outcome too, so the retry cannot mask the cause', async () => {
    // First call (before the 401) mints fine; the retry after the 401 is the
    // outcome that decides the wording.
    sessionTokenMock
      .mockResolvedValueOnce({ status: 'ok', token: 'session-token' })
      .mockResolvedValue({ status: 'unavailable', message: 'bridge gone' })
    const messages: string[] = []
    setEmbeddedAuthFailureHandler((message) => messages.push(message))
    const fetcher: Fetcher = async () => unauthorizedResponse()
    await expect(requestJson('/analytics?storeId=store-1', {}, fetcher)).rejects.toMatchObject({ status: 401 })
    expect(lastSessionTokenOutcome()).toMatchObject({ status: 'unavailable' })
    expect(messages[0]).toContain('bridge gone')
  })
})
