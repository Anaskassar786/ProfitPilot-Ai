import { describe, expect, it } from 'vitest'
import { NoopProductAnalytics, PosthogAnalytics, posthogFromEnv, productAnalyticsErrorMonitor } from './index.js'

describe('F9 PostHog integration', () => {
  it('uses no-op analytics when the key is empty', () => expect(posthogFromEnv({})).toBeInstanceOf(NoopProductAnalytics))
  it('captures events and identifies stores without leaking the API key to logs', async () => {
    const calls: RequestInit[] = []
    const analytics = new PosthogAnalytics({ apiKey: 'ph-key', host: 'https://posthog.example', fetcher: async (_url, init) => { calls.push(init); return new Response('', { status: 200 }) } })
    analytics.capture('launch_test', { storeId: 'store-1', ok: true })
    analytics.identify('store-1', { plan: 'growth' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(calls).toHaveLength(2)
    expect(String(calls[0]?.body)).toContain('launch_test')
    expect(String(calls[1]?.body)).toContain('$identify')
  })
  it('bridges errors into product analytics', () => { const events: string[] = []; const monitor = productAnalyticsErrorMonitor({ capture: (event) => events.push(event), identify: () => undefined }); monitor.capture(new Error('boom'), { storeId: 'store-1' }); expect(events).toEqual(['api_error']) })
  it('validates PostHog configuration', () => expect(() => new PosthogAnalytics({ apiKey: '', host: 'https://posthog.example' })).toThrow('incomplete'))
})
