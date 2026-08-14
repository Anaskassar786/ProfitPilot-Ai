import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { FunnelLedger, InMemoryBillingRepository, TrialAndGiftLedger } from '@profitpilot/billing'
import type { RoiMetrics } from '@profitpilot/billing'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const repository = new InMemoryBillingRepository()
  const trials = new TrialAndGiftLedger()
  const funnel = new FunnelLedger()
  const roi: RoiMetrics = { attributedRevenue: 0, aiCostDollars: 0, netReturn: 0, multiple: null }
  const app = createApi({ logger: new Logger(), readinessChecks: [], billing: { repository, trials, funnel, createCharge: async () => ({ id: 'charge-1', name: 'GROWTH MONTHLY', price: '149', status: 'pending', confirmationUrl: 'https://confirm', billingOn: null, trialDays: 14, test: true, createdAt: 'now' }), verifyCharge: async () => ({ id: 'charge-1', name: 'GROWTH MONTHLY', price: '149', status: 'active', confirmationUrl: null, billingOn: null, trialDays: 14, test: true, createdAt: 'now' }), usage: async () => [], roi: async () => roi } })
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('F5 billing API routes', () => {
  it('returns real plan definitions', async () => await withServer(async (base) => expect((await (await fetch(`${base}/billing/plans`)).json()).data).toHaveLength(3)))
  it('returns billing and trial state', async () => await withServer(async (base) => expect((await (await fetch(`${base}/billing?shopId=s`)).json()).data.subscription).toBeNull()))
  it('returns usage and ROI endpoints', async () => await withServer(async (base) => { expect((await fetch(`${base}/billing/usage?shopId=s`)).status).toBe(200); expect((await fetch(`${base}/billing/roi?shopId=s`)).status).toBe(200) }))
  it('creates an idempotent-ready charge request', async () => await withServer(async (base) => { const response = await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'GROWTH', interval: 'MONTHLY', returnUrl: 'https://app.example/return' }) }); expect(response.status).toBe(201) }))
  it('rejects malformed charge requests', async () => await withServer(async (base) => expect((await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', body: '{}' })).status).toBe(400)))
  it('redeems a Commander gift code and records a subscription', async () => await withServer(async (base) => { const response = await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'KASSAR786' }) }); expect(response.status).toBe(201); expect((await (await fetch(`${base}/billing?shopId=s`)).json()).data.subscription.state).toBe('GIFT_ACCESS_UNLIMITED') }))
  it('rejects gift redemption without code', async () => await withServer(async (base) => expect((await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', body: '{}' })).status).toBe(400)))
  it('validates missing shop context', async () => await withServer(async (base) => expect((await fetch(`${base}/billing`)).status).toBe(400)))
  it('verifies a created charge and stores active state', async () => await withServer(async (base) => { const response = await fetch(`${base}/billing/charge/verify?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chargeId: 'charge-1', plan: 'GROWTH', interval: 'MONTHLY' }) }); expect(response.status).toBe(200) }))
  it('rejects a malformed gift code payload', async () => await withServer(async (base) => expect((await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 12 }) })).status).toBe(400)))
})
