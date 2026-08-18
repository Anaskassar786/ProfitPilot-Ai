import { describe, expect, it, vi } from 'vitest'
import { jobId, storeId } from '@profitpilot/types'
import type { QueueJob } from '@profitpilot/queue'
import {
  INSIGHTS_DISCOVERY_JOB,
  INSIGHTS_DISCOVERY_SWEEP_JOB,
  createInsightsDiscoveryRunner,
  insightsDiscoveryApiBase,
  insightsDiscoveryEnabled,
  insightsDiscoveryStoreJob,
  insightsDiscoverySweepJob,
  insightsSweepDue,
} from './insights-discovery-job.js'
import type { FetchLike } from './insights-discovery-job.js'

type RecordedCall = Readonly<{ url: string; method: string; headers: Readonly<Record<string, string>> | undefined; body: string | undefined }>

function fakeApi(handler: (call: RecordedCall) => { status: number; body: unknown; setCookie?: string }): { fetcher: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fetcher: FetchLike = async (input, init = {}) => {
    const call: RecordedCall = { url: input, method: init.method ?? 'GET', headers: init.headers, body: init.body }
    calls.push(call)
    const result = handler(call)
    return {
      ok: result.status < 400,
      status: result.status,
      json: async () => result.body,
      headers: { get: (name: string) => (name.toLowerCase() === 'set-cookie' ? (result.setCookie ?? null) : null) },
    }
  }
  return { fetcher, calls }
}

const okApi = (): { fetcher: FetchLike; calls: RecordedCall[] } =>
  fakeApi((call) => call.url.endsWith('/security/csrf')
    ? { status: 200, body: { ok: true, data: { csrfToken: 'csrf-1' } }, setCookie: 'profitpilot_csrf=csrf-1; Path=/; HttpOnly' }
    : { status: 201, body: { ok: true, data: { generated: 3 } } })

function job(type: string, data: unknown): QueueJob<unknown> {
  return { id: jobId('job-1'), storeId: storeId('store-1'), type, data, status: 'processing', attempts: 1, maxAttempts: 3, availableAt: 0, createdAt: 0 }
}

describe('insights discovery runner', () => {
  it('hands a store job to the API with the CSRF double-submit', async () => {
    const { fetcher, calls } = okApi()
    const runner = createInsightsDiscoveryRunner({ env: {}, fetcher })
    const result = await runner.handle(job(INSIGHTS_DISCOVERY_JOB, { storeId: 'store-9', reason: 'daily' }))
    expect(result).toBe('handled')
    const post = calls.find((call) => call.url.endsWith('/insights/auto-discovery/run'))
    expect(post?.method).toBe('POST')
    expect(post?.headers?.['x-csrf-token']).toBe('csrf-1')
    expect(post?.headers?.cookie).toBe('profitpilot_csrf=csrf-1')
    expect(post?.body).toContain('store-9')
  })

  it('runs a sweep store-by-store and survives partial failure', async () => {
    const { fetcher } = fakeApi((call) => {
      if (call.url.endsWith('/security/csrf')) return { status: 200, body: { ok: true, data: { csrfToken: 't' } }, setCookie: 'profitpilot_csrf=t' }
      if (call.body?.includes('bad-store')) return { status: 500, body: { ok: false, error: { message: 'boom' } } }
      return { status: 201, body: { ok: true, data: { generated: 2 } } }
    })
    const runner = createInsightsDiscoveryRunner({ env: {}, fetcher, log: vi.fn() })
    const summary = await runner.runSweep({ storeIds: ['store-a', 'bad-store', 'store-b'] })
    expect(summary.attempted).toBe(3)
    expect(summary.succeeded).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.results.find((r) => r.storeId === 'bad-store')?.error).toContain('boom')
  })

  it('treats 402 plan walls and 429 quotas as steady-state, not failures', async () => {
    const { fetcher } = fakeApi((call) => {
      if (call.url.endsWith('/security/csrf')) return { status: 200, body: { ok: true, data: { csrfToken: 't' } }, setCookie: 'profitpilot_csrf=t' }
      if (call.body?.includes('capped')) return { status: 402, body: { ok: false, error: { message: 'Upgrade Plan', code: 'PAYMENT_REQUIRED' } } }
      return { status: 429, body: { ok: false, error: { message: 'slow down' } } }
    })
    const runner = createInsightsDiscoveryRunner({ env: {}, fetcher })
    const limited = await runner.runStore('capped')
    expect(limited.ok).toBe(true)
    expect(limited.generated).toBe(0)
    const throttled = await runner.runStore('throttled')
    expect(throttled.ok).toBe(true)
  })

  it('fails a single-store job hard when the API is down', async () => {
    const { fetcher } = fakeApi(() => ({ status: 500, body: { ok: false, error: { message: 'db exploded' } } }))
    const runner = createInsightsDiscoveryRunner({ env: {}, fetcher })
    await expect(runner.handle(job(INSIGHTS_DISCOVERY_JOB, { storeId: 'store-1' }))).rejects.toThrow('db exploded')
  })

  it('no-ops cleanly when the module is disabled', async () => {
    const fetcher = vi.fn()
    const runner = createInsightsDiscoveryRunner({ env: { INSIGHTS_HUB_ENABLED: 'false' }, fetcher: fetcher as unknown as FetchLike })
    expect(runner.enabled).toBe(false)
    await expect(runner.handle(job(INSIGHTS_DISCOVERY_SWEEP_JOB, { storeIds: ['store-1'] }))).resolves.toBe('handled')
    await expect(runner.handle(job(INSIGHTS_DISCOVERY_JOB, { storeId: 'store-1' }))).resolves.toBe('handled')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('ignores jobs it does not own', async () => {
    const runner = createInsightsDiscoveryRunner({ env: {}, fetcher: okApi().fetcher })
    await expect(runner.handle(job('sync', {}))).resolves.toBe('ignored')
  })

  it('rejects malformed discovery jobs so the queue can retry visibly', async () => {
    const runner = createInsightsDiscoveryRunner({ env: {}, fetcher: okApi().fetcher })
    await expect(runner.handle(job(INSIGHTS_DISCOVERY_JOB, {}))).rejects.toThrow('data.storeId')
  })

  it('fails the sweep when every store failed', async () => {
    const { fetcher } = fakeApi(() => ({ status: 503, body: { ok: false, error: { message: 'down' } } }))
    const runner = createInsightsDiscoveryRunner({ env: {}, fetcher })
    await expect(runner.handle(job(INSIGHTS_DISCOVERY_SWEEP_JOB, { storeIds: ['a', 'b'] }))).rejects.toThrow('every store')
  })
})

describe('scheduling + env helpers', () => {
  it('fires the sweep only at 02:00 UTC', () => {
    expect(insightsSweepDue(Date.parse('2026-08-18T02:00:00.000Z'))).toBe(true)
    expect(insightsSweepDue(Date.parse('2026-08-18T03:00:00.000Z'))).toBe(false)
  })
  it('weekly-only mode waits for Sunday', () => {
    expect(insightsSweepDue(Date.parse('2026-08-16T02:00:00.000Z'), false)).toBe(true) // Sunday
    expect(insightsSweepDue(Date.parse('2026-08-18T02:00:00.000Z'), false)).toBe(false) // Tuesday
  })
  it('builds deduplicated enqueue payloads', () => {
    const sweep = insightsDiscoverySweepJob('owner-store', ['a', 'a', 'b'])
    expect(sweep.type).toBe(INSIGHTS_DISCOVERY_SWEEP_JOB)
    expect(sweep.data).toEqual({ kind: 'sweep', storeIds: ['a', 'b'], reason: 'daily' })
    const single = insightsDiscoveryStoreJob('store-1', 'realtime')
    expect(single.storeId).toBe('store-1')
    expect(single.type).toBe(INSIGHTS_DISCOVERY_JOB)
  })
  it('resolves the API base from env with a local default', () => {
    expect(insightsDiscoveryApiBase({})).toBe('http://127.0.0.1:3000')
    expect(insightsDiscoveryApiBase({ INSIGHTS_HUB_API_BASE_URL: 'https://api.example.com/' })).toBe('https://api.example.com')
    expect(insightsDiscoveryApiBase({ API_BASE_URL: 'https://alt.example.com' })).toBe('https://alt.example.com')
  })
  it('reads the enabled flags honestly', () => {
    expect(insightsDiscoveryEnabled({})).toBe(true)
    expect(insightsDiscoveryEnabled({ INSIGHTS_HUB_AUTO_DISCOVERY_ENABLED: 'false' })).toBe(false)
  })
})
