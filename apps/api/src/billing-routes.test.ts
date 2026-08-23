import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { FunnelLedger, InMemoryBillingRepository, ShopifyBillingError, TrialAndGiftLedger } from '@profitpilot/billing'
import type { GiftCode } from '@profitpilot/billing'
import type { BillingRouteDependencies } from './billing-routes.js'
import type { RoiMetrics } from '@profitpilot/billing'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

// Gift codes come from the environment in production (GIFT_CODE_SEQUENCE_1/2);
// tests seed their own fixture registry so no real code is committed.
const TEST_GIFT_CODES: readonly GiftCode[] = [
  { code: 'PRIMARY-TEST', maxUses: 100, uses: 0, active: true, durationDays: 3, accessLevel: 'commander', expiresAt: null, sequence: 1 },
  { code: 'SECONDARY-TEST', maxUses: 10_000, uses: 0, active: true, durationDays: 3, accessLevel: 'commander', expiresAt: null, sequence: 2 },
]
const giftLedger = () => new TrialAndGiftLedger(TEST_GIFT_CODES)

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  return withLedgerServer(new InMemoryBillingRepository(), giftLedger(), handler)
}

/** Builds the billing API over a caller-provided repository + trial/gift store. */
async function withLedgerServer<T>(repository: InMemoryBillingRepository, trials: TrialAndGiftLedger, handler: (base: string) => Promise<T>): Promise<T> {
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
  it('redeems a Commander gift code and records a subscription', async () => await withServer(async (base) => { const response = await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'PRIMARY-TEST' }) }); expect(response.status).toBe(201); expect((await (await fetch(`${base}/billing?shopId=s`)).json()).data.subscription.state).toBe('GIFT_ACCESS_UNLIMITED') }))
  it('rejects gift redemption without code', async () => await withServer(async (base) => expect((await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', body: '{}' })).status).toBe(400)))
  it('validates missing shop context', async () => await withServer(async (base) => expect((await fetch(`${base}/billing`)).status).toBe(400)))
  it('verifies a created charge and stores active state', async () => await withServer(async (base) => { const response = await fetch(`${base}/billing/charge/verify?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chargeId: 'charge-1', plan: 'GROWTH', interval: 'MONTHLY' }) }); expect(response.status).toBe(200); expect((await (await fetch(`${base}/billing?shopId=s`)).json()).data.subscription.state).toBe('ACTIVE_MONTHLY') }))
  it('verifies a charge_id-only return payload and activates the subscription', async () => await withServer(async (base) => {
    const response = await fetch(`${base}/billing/charge/verify?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chargeId: 'gid://shopify/AppSubscription/1' }) })
    expect(response.status).toBe(200)
    const account = (await (await fetch(`${base}/billing?shopId=s`)).json()).data.subscription
    expect(account.state).toBe('ACTIVE_MONTHLY')
    expect(account.chargeId).toBe('charge-1')
  }))
  it('rejects a malformed gift code payload', async () => await withServer(async (base) => expect((await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 12 }) })).status).toBe(400)))
  it('rejects an invalid gift code with a 400, not 500', async () => await withServer(async (base) => {
    const response = await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'NOT-A-REAL-CODE' }) })
    expect(response.status).toBe(400)
    expect((await response.json()).error.message.toLowerCase()).toContain('invalid')
  }))
  it('returns the new plan prices', async () => await withServer(async (base) => {
    const plans = (await (await fetch(`${base}/billing/plans`)).json()).data as readonly { monthlyPrice: number; annualPrice: number }[]
    expect(plans.map((plan) => plan.monthlyPrice).sort((a, b) => a - b)).toEqual([79, 199, 399])
    expect(plans.map((plan) => plan.annualPrice).sort((a, b) => a - b)).toEqual([790, 1990, 3990])
  }))
  it('applies a mock charge without 500', async () => await withServer(async (base) => {
    const response = await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'GROWTH', interval: 'MONTHLY', returnUrl: 'https://app.example/return', mock: true }) })
    expect(response.status).toBe(201)
    expect((await response.json()).data.mock).toBe(true)
  }))
})

describe('F5 trial & gift lifecycle (GA 2026-08-21)', () => {
  it('cancels the active trial when the merchant upgrades during it (mock path)', async () => {
    const trials = giftLedger()
    trials.startTrial('s', Date.now())
    await withLedgerServer(new InMemoryBillingRepository(), trials, async (base) => {
      const response = await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'GROWTH', interval: 'MONTHLY', returnUrl: 'https://app.example/return', mock: true }) })
      expect(response.status).toBe(201)
    })
    expect(trials.trial('s')?.state).toBe('CANCELLED')
    expect(trials.trial('s')?.consumed).toBe(true)
  })

  it('forfeits the trial on gift redemption: when the 3-day gift expires the store enters TRIAL_EXPIRED with zero trial days', async () => {
    const repository = new InMemoryBillingRepository()
    const trials = giftLedger()
    const startedAt = Date.now() - 10 * 86_400_000
    // Day 10 of a 14-day trial (still active at redemption time).
    trials.startTrial('s', startedAt)
    // 3-day gift redeemed 4 days ago → the window ended yesterday.
    trials.redeemGift('s', 'PRIMARY-TEST', Date.now() - 4 * 86_400_000)
    await repository.put({ storeId: 's', plan: 'commander', state: 'GIFT_ACCESS_UNLIMITED', currentPeriodEnd: Date.now() - 86_400_000, version: 1, interval: null, chargeId: null })
    await withLedgerServer(repository, trials, async (base) => {
      const data = (await (await fetch(`${base}/billing?shopId=s`)).json()).data
      expect(data.gift).toBeTruthy()
      // Trial was forfeited forever — no remaining trial days, straight to locked.
      expect(data.subscription.state).toBe('TRIAL_EXPIRED')
      expect(data.subscription.plan).toBe('trial')
      expect(data.trial?.trialForfeited).toBe(true)
      // The original trial start date is preserved (never reset on reload).
      expect(data.trial?.startedAt).toBe(startedAt)
    })
    // The revert is persisted — a second read agrees and stays locked.
    expect((await repository.get('s'))?.state).toBe('TRIAL_EXPIRED')
  })

  it('reverts an expired gift to locked (TRIAL_EXPIRED) when the trial has also expired', async () => {
    const repository = new InMemoryBillingRepository()
    const trials = giftLedger()
    trials.startTrial('s', Date.now() - 20 * 86_400_000) // trial expired 6 days ago
    trials.redeemGift('s', 'PRIMARY-TEST', Date.now() - 4 * 86_400_000) // gift ended yesterday
    await repository.put({ storeId: 's', plan: 'commander', state: 'GIFT_ACCESS_UNLIMITED', currentPeriodEnd: Date.now() - 86_400_000, version: 1, interval: null, chargeId: null })
    await withLedgerServer(repository, trials, async (base) => {
      const data = (await (await fetch(`${base}/billing?shopId=s`)).json()).data
      expect(data.subscription.state).toBe('TRIAL_EXPIRED')
      expect(data.subscription.plan).toBe('trial')
    })
  })

  it('keeps Commander while the gift window is open', async () => {
    const repository = new InMemoryBillingRepository()
    const trials = giftLedger()
    trials.startTrial('s', Date.now() - 10 * 86_400_000)
    trials.redeemGift('s', 'PRIMARY-TEST', Date.now() - 86_400_000) // expires in 2 days
    await repository.put({ storeId: 's', plan: 'commander', state: 'GIFT_ACCESS_UNLIMITED', currentPeriodEnd: Date.now() + 2 * 86_400_000, version: 1, interval: null, chargeId: null })
    await withLedgerServer(repository, trials, async (base) => {
      const data = (await (await fetch(`${base}/billing?shopId=s`)).json()).data
      expect(data.subscription.state).toBe('GIFT_ACCESS_UNLIMITED')
      expect(data.subscription.plan).toBe('commander')
    })
  })

  it('rejects a gift code for a store already on a paid plan', async () => {
    const repository = new InMemoryBillingRepository()
    await repository.put({ storeId: 's', plan: 'start', state: 'ACTIVE_MONTHLY', currentPeriodEnd: Date.now() + 30 * 86_400_000, version: 1, interval: 'MONTHLY', chargeId: 'x' })
    await withLedgerServer(repository, giftLedger(), async (base) => {
      const response = await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'PRIMARY-TEST' }) })
      expect(response.status).toBe(409)
      expect((await response.json()).error.message.toLowerCase()).toContain('paid plan')
    })
  })

  it('cannot redeem twice, and invalid codes stay 400s not 500s', async () => {
    const repository = new InMemoryBillingRepository()
    const trials = giftLedger()
    await withLedgerServer(repository, trials, async (base) => {
      const first = await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'PRIMARY-TEST' }) })
      expect(first.status).toBe(201)
      const second = await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'SECONDARY-TEST' }) })
      expect(second.status).toBe(400)
      expect((await second.json()).error.message).toBe('A gift code has already been redeemed for this store')
      const expired = await fetch(`${base}/billing/gift?shopId=other`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'NOT-A-CODE' }) })
      expect(expired.status).toBe(400)
    })
  })

  it('rejects the secondary code with HTTP 400 while the primary is still active', async () => {
    const repository = new InMemoryBillingRepository()
    const trials = giftLedger()
    await withLedgerServer(repository, trials, async (base) => {
      const response = await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'SECONDARY-TEST' }) })
      expect(response.status).toBe(400)
      expect((await response.json()).error.message).toBe('Please use the active primary promotion code first')
    })
  })

  it('never resets the 14-day trial start date on reloads or context refreshes', async () => {
    const repository = new InMemoryBillingRepository()
    const trials = giftLedger()
    const startedAt = Date.now() - 3 * 86_400_000
    trials.startTrial('s', startedAt)
    await withLedgerServer(repository, trials, async (base) => {
      const first = (await (await fetch(`${base}/billing?shopId=s`)).json()).data
      expect(first.trial?.startedAt).toBe(startedAt)
      // A later reload / context refresh must not re-initialise the trial.
      const second = (await (await fetch(`${base}/billing?shopId=s`)).json()).data
      expect(second.trial?.startedAt).toBe(startedAt)
      expect(second.trial?.expiresAt).toBe(startedAt + 14 * 86_400_000)
    })
    // Re-starting must also be a no-op once the trial exists.
    trials.startTrial('s', Date.now())
    expect(trials.trial('s')?.startedAt).toBe(startedAt)
  })

  it('redeeming a gift grants exactly 72 hours of Commander', async () => {
    const repository = new InMemoryBillingRepository()
    const trials = giftLedger()
    await withLedgerServer(repository, trials, async (base) => {
      const response = await fetch(`${base}/billing/gift?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'PRIMARY-TEST' }) })
      expect(response.status).toBe(201)
      const payload = (await response.json()).data
      expect(payload.expiresAt - payload.redeemedAt).toBe(3 * 86_400_000)
    })
  })
})

async function withCharge<T>(createCharge: BillingRouteDependencies['createCharge'], handler: (base: string) => Promise<T>): Promise<T> {
  const roi: RoiMetrics = { attributedRevenue: 0, aiCostDollars: 0, netReturn: 0, multiple: null }
  const app = createApi({ logger: new Logger(), readinessChecks: [], billing: { repository: new InMemoryBillingRepository(), trials: giftLedger(), funnel: new FunnelLedger(), createCharge, verifyCharge: async () => { throw new Error('unused') }, usage: async () => [], roi: async () => roi } })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

const chargeBody = JSON.stringify({ plan: 'GROWTH', interval: 'MONTHLY', returnUrl: 'https://app.example/billing' })

describe('billing charge failure translation', () => {
  it('turns a Shopify 422 into an actionable 422 naming the rejected fields', async () => {
    const createCharge = async () => { throw new ShopifyBillingError(422, 'Shopify Billing API failed with 422', { price: ['must be greater than zero'] }, '{"errors":{}}') }
    await withCharge(createCharge, async (base) => {
      const response = await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chargeBody })
      expect(response.status).toBe(422)
      const payload = await response.json()
      expect(payload.error.code).toBe('VALIDATION_ERROR')
      expect(payload.error.message).toContain('price must be greater than zero')
      expect(payload.error.message).toContain('test charges')
      expect(payload.error.details).toMatchObject({ upstreamStatus: 422, fields: 'price' })
    })
  })

  it('translates a Custom App "owned by a Shop" rejection into an actionable Partner Dashboard message', async () => {
    const customAppError = new ShopifyBillingError(
      422,
      'Shopify Billing API failed with 422 on /recurring_application_charges.json',
      { base: ['It appears that this application is currently owned by a Shop. It must be migrated to the Shopify partners area before it can create charges with the API.'] },
      '{"errors":{"base":"It appears that this application is currently owned by a Shop. It must be migrated to the Shopify partners area before it can create charges with the API."}}',
    )
    const createCharge = async () => { throw customAppError }
    await withCharge(createCharge, async (base) => {
      const response = await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chargeBody })
      expect(response.status).toBe(422)
      const payload = await response.json()
      expect(payload.error.code).toBe('VALIDATION_ERROR')
      expect(payload.error.message).toContain('Custom App owned by a shop')
      expect(payload.error.message).toContain('Shopify Partner Dashboard (partners.shopify.com)')
      expect(payload.error.details).toMatchObject({ upstreamStatus: 422, reason: 'CUSTOM_APP_NOT_PARTNER_APP' })
    })
  })

  it('maps a Shopify 5xx to a retryable dependency error rather than a 500', async () => {
    const createCharge = async () => { throw new ShopifyBillingError(503, 'Shopify Billing API failed with 503') }
    await withCharge(createCharge, async (base) => {
      const response = await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chargeBody })
      expect(response.status).toBe(502)
      expect((await response.json()).error.code).toBe('DEPENDENCY_ERROR')
    })
  })

  it('rejects a non-https return URL before calling Shopify', async () => {
    let called = false
    const createCharge = async () => { called = true; throw new Error('should not run') }
    await withCharge(createCharge, async (base) => {
      const response = await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'GROWTH', interval: 'MONTHLY', returnUrl: 'http://insecure.example' }) })
      expect(response.status).toBe(400)
      expect(called).toBe(false)
    })
  })

  it('passes the default 14-day trial to the charge factory', async () => {
    let trial = -1
    const createCharge: BillingRouteDependencies['createCharge'] = async (_shop, _plan, _interval, _url, trialDays) => {
      trial = trialDays
      return { id: 'c', name: 'GROWTH MONTHLY', price: '149.00', status: 'pending', confirmationUrl: 'https://confirm', billingOn: null, trialDays, test: true, createdAt: 'now' }
    }
    await withCharge(createCharge, async (base) => {
      expect((await fetch(`${base}/billing/charge?shopId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chargeBody })).status).toBe(201)
      expect(trial).toBe(14)
    })
  })
})
