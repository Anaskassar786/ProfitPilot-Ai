import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAnalytics, requestJson, resetApiClientStateForTests, setEmbeddedAuthFailureHandler, warmUpEmbeddedSessionToken } from './api.js'
import type { Fetcher } from './api.js'
import { getShopifySessionToken, getShopifySessionTokenWithRetry } from './shopify-app-bridge.js'
import type { EmbeddedSessionTokenResult } from './shopify-app-bridge.js'

/**
 * The central fetch wrapper must attach `Authorization: Bearer <session
 * token>` on every authenticated call when the app runs embedded in the
 * Shopify admin. The App Bridge module is mocked so the wrapper logic can be
 * exercised from the Node test environment.
 */
vi.mock('./shopify-app-bridge.js', () => ({
  getShopifySessionToken: vi.fn(async (): Promise<EmbeddedSessionTokenResult> => ({ status: 'not-embedded' })),
  getShopifySessionTokenWithRetry: vi.fn(async (): Promise<EmbeddedSessionTokenResult> => ({ status: 'not-embedded' })),
}))

const sessionTokenMock = vi.mocked(getShopifySessionToken)
const sessionTokenWithRetryMock = vi.mocked(getShopifySessionTokenWithRetry)

function capturingFetcher(calls: Array<{ headers: Headers | null }>) {
  const fetcher: Fetcher = async (_input, init) => {
    calls.push({ headers: init?.headers ? new Headers(init.headers) : null })
    return new Response(JSON.stringify({ ok: true, data: { revenue: [], orders: [], productSales: [], customerCohorts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return fetcher
}

beforeEach(() => {
  resetApiClientStateForTests()
  sessionTokenMock.mockReset()
  sessionTokenMock.mockResolvedValue({ status: 'not-embedded' })
  sessionTokenWithRetryMock.mockReset()
  sessionTokenWithRetryMock.mockResolvedValue({ status: 'not-embedded' })
  setEmbeddedAuthFailureHandler(null)
})

describe('embedded App Bridge session tokens in the fetch wrapper', () => {
  it('attaches Authorization: Bearer when a fresh session token is available', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'signed-shopify-session-token' })
    const calls: Array<{ headers: Headers | null }> = []
    await fetchAnalytics('store-1', capturingFetcher(calls))
    expect(calls[0]?.headers?.get('authorization')).toBe('Bearer signed-shopify-session-token')
    expect(sessionTokenMock).toHaveBeenCalledTimes(1)
  })

  it('keeps caller-set Content-Type and other headers intact', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'signed-shopify-session-token' })
    const calls: Array<{ headers: Headers | null }> = []
    await requestJson('/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', module: 'products' }) }, capturingFetcher(calls))
    expect(calls[0]?.headers?.get('content-type')).toBe('application/json')
    expect(calls[0]?.headers?.get('authorization')).toBe('Bearer signed-shopify-session-token')
  })

  it('sends no Authorization header when the app is not embedded (local dev)', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'not-embedded' })
    const calls: Array<{ headers: Headers | null }> = []
    await fetchAnalytics('store-1', capturingFetcher(calls))
    expect(calls[0]?.headers?.has('authorization')).toBe(false)
  })

  it('continues without a bearer when the token is unavailable and notifies once', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'unavailable', message: 'Shopify App Bridge did not load' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const calls: Array<{ headers: Headers | null }> = []
    const fetcher = capturingFetcher(calls)
    await fetchAnalytics('store-1', fetcher)
    await fetchAnalytics('store-1', fetcher)
    expect(calls[0]?.headers?.has('authorization')).toBe(false)
    expect(calls[1]?.headers?.has('authorization')).toBe(false)
    // User-visible once — never a toast per failing request.
    expect(failures).toEqual(['Shopify App Bridge did not load'])
  })

  it('does not overwrite an Authorization header the caller set explicitly', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'signed-shopify-session-token' })
    const calls: Array<{ headers: Headers | null }> = []
    await requestJson('/analytics', { headers: { authorization: 'Bearer custom-credential' } }, capturingFetcher(calls))
    expect(calls[0]?.headers?.get('authorization')).toBe('Bearer custom-credential')
  })
})

describe('warmUpEmbeddedSessionToken (HOTFIX 2 boot warm-up)', () => {
  it('waits for the (internally retried) token before the bootstrap fetch and stays silent on success', async () => {
    // The one-attempt retry loop lives inside getShopifySessionTokenWithRetry
    // (covered in shopify-app-bridge.test.ts); the warm-up must simply await
    // its final result and only surface a failure when it stays unavailable.
    sessionTokenWithRetryMock.mockResolvedValue({ status: 'ok', token: 'signed-shopify-session-token' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    await warmUpEmbeddedSessionToken()
    expect(sessionTokenWithRetryMock).toHaveBeenCalledTimes(1)
    expect(failures).toEqual([])
  })

  it('surfaces exactly one session-expired notification when the token stays unavailable', async () => {
    sessionTokenWithRetryMock.mockResolvedValue({ status: 'unavailable', message: 'Shopify session token request failed' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    await warmUpEmbeddedSessionToken()
    await warmUpEmbeddedSessionToken()
    // Once per page lifetime — never a toast per request.
    expect(failures).toEqual(['Shopify session token request failed'])
  })

  it('is a no-op outside the embedded admin', async () => {
    sessionTokenWithRetryMock.mockResolvedValue({ status: 'not-embedded' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    await warmUpEmbeddedSessionToken()
    expect(failures).toEqual([])
  })
})
