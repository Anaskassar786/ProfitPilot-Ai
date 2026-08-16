import { beforeEach, describe, expect, it } from 'vitest'
import { ApiClientError, fetchAnalytics, fetchCatalog, fetchCsrfToken, fetchOrder, fetchOrderInsights, fetchOrders, fetchSyncStatus, initializeCsrf, requestJson, requestSync, requestSyncAll, resetApiClientStateForTests, resetSyncCircuit, startJarvisSession } from './api.js'
import type { Fetcher } from './api.js'

type ResponsePayload = Readonly<{ ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>

function fetcher(payload: ResponsePayload, status = 200, calls: string[] = []) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push(`${init?.method ?? 'GET'} ${input}`)
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
}

beforeEach(() => resetApiClientStateForTests())

describe('F3 relative API client', () => {
  it('unwraps a successful API envelope', async () => expect(await requestJson<{ value: number }>('/analytics', {}, fetcher({ ok: true, data: { value: 2 } }))).toEqual({ value: 2 }))
  it('uses relative URLs without localhost', async () => {
    const calls: string[] = []
    await fetchAnalytics('store-1', fetcher({ ok: true, data: { revenue: [] } }, 200, calls))
    expect(calls[0]).toBe('GET /analytics?storeId=store-1')
  })
  it('encodes tenant IDs in query paths', async () => {
    const calls: string[] = []
    await fetchCatalog('store/one', fetcher({ ok: true, data: [] }, 200, calls))
    expect(calls[0]).toContain('store%2Fone')
  })
  it('encodes server-side order filters, detail IDs, and insight questions', async () => {
    const calls: string[] = []
    const ordersData = { orders: [], tabCounts: { all: 0, new: 0, completed: 0, canceled: 0, pending: 0 }, pagination: { page: 1, limit: 20, total: 0, pages: 1 } }
    await fetchOrders('store/one', { q: 'A & B', status: 'pending', page: 2 }, fetcher({ ok: true, data: ordersData }, 200, calls))
    await fetchOrder('store/one', 'gid://shopify/Order/1', fetcher({ ok: true, data: { id: '1' } }, 200, calls))
    await fetchOrderInsights('store/one', { feature: 'custom_ai_queries', question: 'Compare 30 days' }, fetcher({ ok: true, data: { available: [] } }, 200, calls))
    expect(calls[0]).toContain('/orders?storeId=store%2Fone&q=A+%26+B&status=pending&page=2')
    expect(calls[1]).toContain('/orders/gid%3A%2F%2Fshopify%2FOrder%2F1?storeId=store%2Fone')
    expect(calls[2]).toContain('/orders/insights?storeId=store%2Fone&feature=custom_ai_queries&question=Compare+30+days')
    expect(calls.every((call) => !call.includes('localhost'))).toBe(true)
  })
  it('posts sync requests through the F2 API', async () => {
    const calls: string[] = []
    await requestSync('store-1', 'products', fetcher({ ok: true, data: { records: 2 } }, 202, calls))
    expect(calls[0]).toBe('POST /sync')
  })
  it('posts Sync all and preserves module-level partial failures', async () => {
    const calls: string[] = []
    const data = { storeId: 'store-1', modules: [{ module: 'products', status: 'succeeded', result: { records: 2 } }, { module: 'orders', status: 'failed', error: { code: 'DEPENDENCY_ERROR', message: 'Shopify unavailable' } }], succeeded: ['products'], failed: ['orders'] }
    const result = await requestSyncAll('store-1', fetcher({ ok: true, data }, 207, calls), null)
    expect(calls).toEqual(['POST /sync/all'])
    expect(result.failed).toEqual(['orders'])
    expect(result.modules[1]).toMatchObject({ module: 'orders', status: 'failed' })
  })
  it('sends the embedded id_token only in the sync retry header', async () => {
    let captured: Headers | undefined
    const capturing: Fetcher = async (_input, init) => {
      captured = new Headers(init?.headers)
      return new Response(JSON.stringify({ ok: true, data: { records: 1 } }), { status: 202 })
    }
    await requestSync('store-1', 'products', capturing, 'signed-shopify-id-token')
    expect(captured?.get('x-shopify-session-token')).toBe('signed-shopify-id-token')
  })
  it('echoes the CSRF token on unsafe requests after it is fetched', async () => {
    let captured: Headers | undefined
    const capturing: Fetcher = async (input: string, init?: RequestInit) => {
      captured = new Headers(init?.headers)
      if (input === '/security/csrf') return new Response(JSON.stringify({ ok: true, data: { csrfToken: 'tok-123' } }), { status: 200 })
      return new Response(JSON.stringify({ ok: true, data: { records: 1 } }), { status: 202 })
    }
    await fetchCsrfToken(capturing)
    await requestSync('store-1', 'products', capturing)
    expect(captured?.get('x-csrf-token')).toBe('tok-123')
  })
  it('deduplicates concurrent CSRF initialization and gates Jarvis startup on it', async () => {
    let releaseCsrf!: () => void
    const csrfReady = new Promise<void>((resolve) => { releaseCsrf = resolve })
    const calls: string[] = []
    const capturing: Fetcher = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`)
      if (input === '/security/csrf') {
        await csrfReady
        return new Response(JSON.stringify({ ok: true, data: { csrfToken: 'ready-token' } }), { status: 200 })
      }
      expect(new Headers(init?.headers).get('x-csrf-token')).toBe('ready-token')
      return new Response(JSON.stringify({ ok: true, data: { id: 'session-1' } }), { status: 201 })
    }
    const initialization = initializeCsrf(capturing)
    const session = startJarvisSession('store-1', 'dashboard', 'trial', capturing)
    await Promise.resolve()
    expect(calls).toEqual(['GET /security/csrf'])
    releaseCsrf()
    await Promise.all([initialization, session])
    expect(calls).toEqual(['GET /security/csrf', 'POST /jarvis/sessions'])
  })
  it('recovers once from a stale CSRF token and retries the unsafe request', async () => {
    let csrfCalls = 0
    let syncCalls = 0
    const tokens: Array<string | null> = []
    const capturing: Fetcher = async (input, init) => {
      if (input === '/security/csrf') {
        csrfCalls += 1
        return new Response(JSON.stringify({ ok: true, data: { csrfToken: csrfCalls === 1 ? 'stale-token' : 'fresh-token' } }), { status: 200 })
      }
      syncCalls += 1
      tokens.push(new Headers(init?.headers).get('x-csrf-token'))
      if (syncCalls === 1) return new Response(JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'CSRF validation failed' } }), { status: 403 })
      return new Response(JSON.stringify({ ok: true, data: { records: 1 } }), { status: 202 })
    }
    await initializeCsrf(capturing)
    await requestSync('store-1', 'products', capturing, null)
    expect({ csrfCalls, syncCalls, tokens }).toEqual({ csrfCalls: 2, syncCalls: 2, tokens: ['stale-token', 'fresh-token'] })
  })
  it('surfaces structured API failures', async () => {
    await expect(requestJson('/analytics', {}, fetcher({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'storeId required' } }, 400))).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 })
  })
  it('surfaces malformed envelopes', async () => await expect(requestJson('/analytics', {}, fetcher({ ok: true }, 200))).rejects.toMatchObject({ code: 'INVALID_ENVELOPE' }))
  it('surfaces network failures without leaking implementation details', async () => {
    const network = async (): Promise<Response> => { throw new Error('offline') }
    await expect(requestJson('/analytics', {}, network)).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: 'offline' })
  })
  it('handles a non-JSON error response', async () => {
    const network = async (): Promise<Response> => new Response('not-json', { status: 502 })
    await expect(requestJson('/analytics', {}, network)).rejects.toMatchObject({ status: 502, code: 'API_ERROR' })
  })
  it('falls back when an API error omits code and message', async () => {
    await expect(requestJson('/analytics', {}, fetcher({ ok: false, error: {} }, 500))).rejects.toMatchObject({ status: 500, code: 'API_ERROR', message: 'API request failed' })
  })
  it('is an Error instance for consumer boundaries', () => expect(new ApiClientError('no', 503)).toBeInstanceOf(Error))
})

describe('sync circuit diagnostics client', () => {
  it('reads connection status for a store', async () => {
    const calls: string[] = []
    const status = await fetchSyncStatus('store-1', fetcher({ ok: true, data: { storeId: 'store-1', registered: true, hasAccessToken: true, canSync: true, circuit: { open: false, failures: 0, retryAfterMs: null, cooldownMs: 60000 }, shopDomain: 'demo.myshopify.com' } }, 200, calls))
    expect(calls[0]).toBe('GET /sync/status?storeId=store-1')
    expect(status.canSync).toBe(true)
  })
  it('posts a circuit reset for a store', async () => {
    const calls: string[] = []
    await resetSyncCircuit('store-1', fetcher({ ok: true, data: { storeId: 'store-1' } }, 200, calls))
    expect(calls[0]).toBe('POST /sync/circuit/reset')
  })
  it('surfaces an open-circuit 503 as a typed API error', async () => {
    const failure: unknown = await fetchSyncStatus('store-1', fetcher({ ok: false, error: { code: 'DEPENDENCY_ERROR', message: 'Shopify circuit is open for this store' } }, 503)).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiClientError)
    expect((failure as ApiClientError).status).toBe(503)
    expect((failure as ApiClientError).message).toContain('circuit is open')
  })
})
