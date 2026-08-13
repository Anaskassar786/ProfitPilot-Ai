import { describe, expect, it } from 'vitest'
import { ApiClientError, fetchAnalytics, fetchCatalog, requestJson, requestSync } from './api.js'

type ResponsePayload = Readonly<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>

function fetcher(payload: ResponsePayload, status = 200, calls: string[] = []) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push(`${init?.method ?? 'GET'} ${input}`)
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
}

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
  it('posts sync requests through the F2 API', async () => {
    const calls: string[] = []
    await requestSync('store-1', 'products', fetcher({ ok: true, data: { records: 2 } }, 202, calls))
    expect(calls[0]).toBe('POST /sync')
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
