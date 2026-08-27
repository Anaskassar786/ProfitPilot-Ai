import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError, fetchAnalytics, isRecoverableAuthFailure, requestJson, resetApiClientStateForTests, setEmbeddedAuthFailureHandler, setEmbeddedAuthRecoveryHandler, warmUpEmbeddedSessionToken } from './api.js'
import type { Fetcher } from './api.js'
import { getShopifySessionToken, getShopifySessionTokenWithRetry, redirectToShopifyReauthorization } from './shopify-app-bridge.js'
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
  // Standalone/dev default: nothing to redirect to, so the fetcher falls back
  // to the session banner exactly as before.
  redirectToShopifyReauthorization: vi.fn((): boolean => false),
}))

const sessionTokenMock = vi.mocked(getShopifySessionToken)
const sessionTokenWithRetryMock = vi.mocked(getShopifySessionTokenWithRetry)
const reauthorizeMock = vi.mocked(redirectToShopifyReauthorization)

function capturingFetcher(calls: Array<{ headers: Headers | null }>) {
  const fetcher: Fetcher = async (_input, init) => {
    calls.push({ headers: init?.headers ? new Headers(init.headers) : null })
    return new Response(JSON.stringify({ ok: true, data: { revenue: [], orders: [], productSales: [], customerCohorts: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return fetcher
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Session expired' } }), { status: 401, headers: { 'content-type': 'application/json' } })
}

function okEnvelope(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  resetApiClientStateForTests()
  sessionTokenMock.mockReset()
  sessionTokenMock.mockResolvedValue({ status: 'not-embedded' })
  sessionTokenWithRetryMock.mockReset()
  sessionTokenWithRetryMock.mockResolvedValue({ status: 'not-embedded' })
  reauthorizeMock.mockReset()
  reauthorizeMock.mockReturnValue(false)
  setEmbeddedAuthFailureHandler(null)
  setEmbeddedAuthRecoveryHandler(null)
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

  it('continues without a bearer when the token is unavailable and never raises the session banner for a successful cookie fallback', async () => {
    // HOTFIX 3: a token mint failure alone is NOT session expiry. The request
    // proceeds on the cookie fallback; a 2xx proves the session is valid and
    // must never surface the red banner.
    sessionTokenMock.mockResolvedValue({ status: 'unavailable', message: 'Shopify App Bridge did not load' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const calls: Array<{ headers: Headers | null }> = []
    const fetcher = capturingFetcher(calls)
    await fetchAnalytics('store-1', fetcher)
    await fetchAnalytics('store-1', fetcher)
    expect(calls[0]?.headers?.has('authorization')).toBe(false)
    expect(calls[1]?.headers?.has('authorization')).toBe(false)
    // Silent — the banner is reserved for a 401 that survives the retry.
    expect(failures).toEqual([])
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

  it('stays silent when the token is unavailable — the banner is reserved for the 401-after-retry path', async () => {
    // HOTFIX 3: the boot warm-up never latches the session banner by itself.
    // A token race during boot (fast tab switching) is expected; the fetcher's
    // silent 401 retry and the auto-clear on success decide what shows.
    sessionTokenWithRetryMock.mockResolvedValue({ status: 'unavailable', message: 'Shopify session token request failed' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    await warmUpEmbeddedSessionToken()
    await warmUpEmbeddedSessionToken()
    expect(failures).toEqual([])
  })

  it('is a no-op outside the embedded admin', async () => {
    sessionTokenWithRetryMock.mockResolvedValue({ status: 'not-embedded' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    await warmUpEmbeddedSessionToken()
    expect(failures).toEqual([])
  })
})

describe('HOTFIX 3 — silent 401 retry and banner auto-clear', () => {
  it('silently retries a 401 with a freshly minted idToken and never notifies', async () => {
    // Attempt 1 carries the stale bearer; the retry mints a FRESH token.
    sessionTokenMock
      .mockResolvedValueOnce({ status: 'ok', token: 'stale-session-token' })
      .mockResolvedValueOnce({ status: 'ok', token: 'fresh-session-token' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const calls: Array<{ headers: Headers | null }> = []
    const fetcher: Fetcher = async (_input, init) => {
      calls.push({ headers: init?.headers ? new Headers(init.headers) : null })
      if (calls.length === 1) return unauthorizedResponse()
      return okEnvelope({ revenue: [], orders: [], productSales: [], customerCohorts: [] })
    }
    await expect(fetchAnalytics('store-1', fetcher)).resolves.toBeTruthy()
    expect(calls).toHaveLength(2)
    expect(calls[0]?.headers?.get('authorization')).toBe('Bearer stale-session-token')
    expect(calls[1]?.headers?.get('authorization')).toBe('Bearer fresh-session-token')
    // A transient 401 must NEVER latch the session-expired banner.
    expect(failures).toEqual([])
  })

  it('locks the banner only when the fresh-token retry also returns 401', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'any-token' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    let calls = 0
    const fetcher: Fetcher = async () => {
      calls += 1
      return unauthorizedResponse()
    }
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    expect(calls).toBe(2) // original + one fresh-token retry
    expect(failures).toEqual(['Your Shopify session expired — reload the app to reconnect.'])
    // De-duped: a second double-401 does not re-fire while latched.
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    expect(failures).toHaveLength(1)
  })

  it('auto-clears a latched session-expired notification on the next successful request', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'any-token' })
    const failures: string[] = []
    const recoveries: number[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    setEmbeddedAuthRecoveryHandler(() => recoveries.push(1))
    let failing = true
    const fetcher: Fetcher = async () => (failing ? unauthorizedResponse() : okEnvelope({ revenue: [], orders: [], productSales: [], customerCohorts: [] }))
    // 1. Double-401 latches the banner once.
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    expect(failures).toHaveLength(1)
    // 2. The session recovers: a 2xx fires the recovery handler and unlatches.
    failing = false
    await fetchAnalytics('store-1', fetcher)
    expect(recoveries).toHaveLength(1)
    // 3. A later genuine expiry can notify again (the latch was reset).
    failing = true
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    expect(failures).toHaveLength(2)
  })

  it('does not retry 401s with caller-supplied custom Authorization headers', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'app-bridge-token' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    let calls = 0
    const fetcher: Fetcher = async () => {
      calls += 1
      return unauthorizedResponse()
    }
    await expect(requestJson('/admin/maintenance', { headers: { authorization: 'Bearer custom-credential', 'x-admin-step-up': 'step-token' } }, fetcher)).rejects.toMatchObject({ status: 401 })
    expect(calls).toBe(1)
    expect(failures).toHaveLength(1)
  })

  it('surfaces ApiClientError 401 without retry when no fresh token can be minted', async () => {
    sessionTokenMock
      .mockResolvedValueOnce({ status: 'ok', token: 'stale-session-token' })
      .mockResolvedValueOnce({ status: 'unavailable', message: 'Shopify App Bridge did not load' })
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    let calls = 0
    const fetcher: Fetcher = async () => {
      calls += 1
      return unauthorizedResponse()
    }
    const error = await fetchAnalytics('store-1', fetcher).then(() => null, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).status).toBe(401)
    expect(calls).toBe(1)
    expect(failures).toEqual(['Your Shopify session expired — reload the app to reconnect.'])
  })
})

/**
 * PERMANENT 401 FIX — a terminal 401 must try to RECOVER the session by
 * re-running the install flow at top level before anything red is shown. A
 * merchant whose store row or offline token vanished (STORE_NOT_FOUND) is
 * re-authorized automatically; a database outage is not, because re-installing
 * would bounce them through OAuth for nothing.
 */
describe('401 auto-recovery via top-level re-authorization', () => {
  function unauthorizedWithDetails(details: Record<string, unknown>, message = 'Authentication is required'): Response {
    return new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message, details } }), { status: 401, headers: { 'content-type': 'application/json' } })
  }

  it('classifies STORE_NOT_FOUND / "Authentication is required" as recoverable and DB_UNAVAILABLE as not', () => {
    expect(isRecoverableAuthFailure({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required', details: { reason: 'STORE_NOT_FOUND', reauthorize: true } } })).toBe(true)
    expect(isRecoverableAuthFailure({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required', details: {} } })).toBe(true)
    expect(isRecoverableAuthFailure({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Session expired', details: { reason: 'DB_UNAVAILABLE', reauthorize: false } } })).toBe(false)
    expect(isRecoverableAuthFailure({ ok: true, data: {} })).toBe(false)
  })

  it('redirects to the install flow instead of latching a permanent red banner', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'any-token' })
    reauthorizeMock.mockReturnValue(true)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const fetcher: Fetcher = async () => unauthorizedWithDetails({ reason: 'STORE_NOT_FOUND', shop: 'commander-pilot.myshopify.com', reauthorize: true })
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    expect(reauthorizeMock).toHaveBeenCalledWith('commander-pilot.myshopify.com')
    // Recovery is in flight — no permanent 401 card.
    expect(failures).toEqual([])
  })

  it('attempts the redirect at most once per page load', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'any-token' })
    reauthorizeMock.mockReturnValue(true)
    const fetcher: Fetcher = async () => unauthorizedWithDetails({ reason: 'STORE_NOT_FOUND', shop: 'commander-pilot.myshopify.com', reauthorize: true })
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    expect(reauthorizeMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the session banner when no redirect is possible', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'any-token' })
    reauthorizeMock.mockReturnValue(false)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const fetcher: Fetcher = async () => unauthorizedWithDetails({ reason: 'STORE_NOT_FOUND', reauthorize: true })
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    expect(failures).toEqual(['Your Shopify session expired — reload the app to reconnect.'])
  })

  it('never re-installs for a database outage', async () => {
    sessionTokenMock.mockResolvedValue({ status: 'ok', token: 'any-token' })
    reauthorizeMock.mockReturnValue(true)
    const failures: string[] = []
    setEmbeddedAuthFailureHandler((message) => failures.push(message))
    const fetcher: Fetcher = async () => unauthorizedWithDetails({ reason: 'DB_UNAVAILABLE', reauthorize: false }, 'Session expired')
    await expect(fetchAnalytics('store-1', fetcher)).rejects.toMatchObject({ status: 401 })
    expect(reauthorizeMock).not.toHaveBeenCalled()
    expect(failures).toHaveLength(1)
  })
})
