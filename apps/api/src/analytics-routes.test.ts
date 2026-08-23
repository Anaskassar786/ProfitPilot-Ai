import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger } from '@profitpilot/logger'
import type { PlanTier } from '@profitpilot/types'
import { createApi } from './app.js'
import type { AnalyticsRouteDependencies } from './analytics-routes.js'

/**
 * P1 (App Store audit): analytics routes must be plan-gated on the SERVER.
 * The client-side hasPlan() check in analytics.tsx is bypassable by calling
 * the API directly, so these tests hit the HTTP surface itself.
 */

const okInsights: AnalyticsRouteDependencies['insights'] = {
  get: async () => ({ plan: 'trial' }) as never,
  query: async () => ({ text: 'ok', model: 'm', usage: { used: 1, limit: null } }),
  channels: async () => [],
  geography: async () => [],
  cohorts: async () => [],
  comparisons: async () => [],
  funnel: async () => ({ scopeAvailable: false, stages: [], message: '' }) as never,
}

async function withServer<T>(plan: PlanTier, handler: (base: string) => Promise<T>): Promise<T> {
  const app = createApi({ logger: new Logger(), readinessChecks: [], analytics: { insights: okInsights, plan: async () => plan } })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('analytics routes server-side plan gating', () => {
  it('returns 402 UPGRADE_REQUIRED for growth-gated routes on the trial plan', async () => await withServer('trial', async (base) => {
    for (const path of ['/analytics/geography', '/analytics/cohorts', '/analytics/funnel']) {
      const response = await fetch(`${base}${path}?storeId=s`)
      expect(response.status).toBe(402)
      const payload = await response.json()
      expect(payload.error.details.reason).toBe('UPGRADE_REQUIRED')
      expect(payload.error.details.requiredPlan).toBe('growth')
    }
  }))

  it('returns 402 for commander-gated routes on the growth plan', async () => await withServer('growth', async (base) => {
    const comparisons = await fetch(`${base}/analytics/comparisons?storeId=s`)
    expect(comparisons.status).toBe(402)
    const query = await fetch(`${base}/analytics/insights/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 's', question: 'why?' }) })
    expect(query.status).toBe(402)
    expect((await query.json()).error.details.requiredPlan).toBe('commander')
  }))

  it('allows gated routes once the plan is sufficient', async () => await withServer('commander', async (base) => {
    for (const path of ['/analytics/insights', '/analytics/channels', '/analytics/geography', '/analytics/cohorts', '/analytics/comparisons', '/analytics/funnel']) {
      expect((await fetch(`${base}${path}?storeId=s`)).status).toBe(200)
    }
    const query = await fetch(`${base}/analytics/insights/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 's', question: 'why?' }) })
    expect(query.status).toBe(200)
  }))

  it('keeps ungated base routes available on trial', async () => await withServer('trial', async (base) => {
    expect((await fetch(`${base}/analytics/insights?storeId=s`)).status).toBe(200)
    expect((await fetch(`${base}/analytics/channels?storeId=s`)).status).toBe(200)
  }))
})
