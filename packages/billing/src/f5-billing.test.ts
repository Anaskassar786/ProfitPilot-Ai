import { describe, expect, it } from 'vitest'
import { PLAN_ENTITLEMENT_LIMITS, FAIR_USE_ORDERS_30D, FAIR_USE_PRODUCTS_ACTIVE, FAIR_USE_CUSTOMERS, HIDDEN_METER_KEYS } from '@profitpilot/types'
import { assertAccess, UpgradeRequiredError, accessGate, limitForPlan } from './entitlements.js'
import { AdminStepUpSessions, FunnelLedger, FUNNEL_MILESTONES, calculateRoi, lockPrice, priceForRenewal } from './growth.js'
import { agentsForPlanCount, PLAN_DEFINITIONS, entitlementsFor, planFor, priceFor } from './plans.js'
import { TrialAndGiftLedger, expiredGiftRevert, subscriptionForTrial } from './trials.js'
import type { Subscription } from './billing.js'

const active: Subscription = { storeId: 's', plan: 'growth', state: 'ACTIVE_MONTHLY', currentPeriodEnd: null, version: 0 }

describe('F5 plans and entitlements', () => {
  it('contains three paid plans', () => expect(Object.keys(PLAN_DEFINITIONS)).toEqual(['START', 'GROWTH', 'COMMANDER']))
  it('prices monthly and annual plans', () => {
    expect(priceFor('START', 'MONTHLY')).toBe(79)
    expect(priceFor('START', 'ANNUAL')).toBe(790)
    expect(priceFor('GROWTH', 'MONTHLY')).toBe(199)
    expect(priceFor('GROWTH', 'ANNUAL')).toBe(1_990)
    expect(priceFor('COMMANDER', 'MONTHLY')).toBe(399)
    expect(priceFor('COMMANDER', 'ANNUAL')).toBe(3_990)
    expect(planFor('COMMANDER').annualMonthsFree).toBe(2)
  })
  it('returns all plan entitlements', () => expect(entitlementsFor('GROWTH').length).toBeGreaterThan(10))
  it('enforces growth recommendation quota', () => expect(limitForPlan('growth', 'ai_recommendations_month')).toBe(300))
  it('keeps billing page accessible for suspended stores', () => expect(accessGate({ ...active, state: 'SUSPENDED' }, { feature: 'orders_sync_month', used: 0, billingPage: true }).allowed).toBe(true))
  it('returns upgrade required for exhausted quota', () => expect(() => assertAccess(active, { feature: 'ai_recommendations_month', used: 300 })).toThrow(UpgradeRequiredError))
  it('allows commander unlimited quota', () => expect(accessGate({ ...active, plan: 'commander' }, { feature: 'ai_recommendations_month', used: 999 }).allowed).toBe(true))
  it('returns remaining limited quota', () => expect(accessGate(active, { feature: 'ai_recommendations_month', used: 2 }).remaining).toBe(298))
  it('blocks disabled trial features', () => expect(accessGate({ ...active, plan: 'trial', state: 'TRIAL_LIMITED' }, { feature: 'exports', used: 0 }).reason).toBe('UPGRADE_REQUIRED'))
  it('keeps support and legal accessible in read-only mode', () => { expect(accessGate({ ...active, state: 'CANCELLED' }, { feature: 'reports', used: 0, support: true }).allowed).toBe(true); expect(accessGate({ ...active, state: 'CANCELLED' }, { feature: 'reports', used: 0, legal: true }).allowed).toBe(true) })
})

describe('Entitlement meter audit — sync caps (PR)', () => {
  it('Trial gets real headroom on sync caps (250 each, not 100)', () => {
    expect(limitForPlan('trial', 'orders_sync_month')).toBe(250)
    expect(limitForPlan('trial', 'products_sync')).toBe(250)
    expect(limitForPlan('trial', 'customers_sync')).toBe(250)
  })
  it('Start sync caps are 1k/1.5k/2.5k', () => {
    expect(limitForPlan('start', 'orders_sync_month')).toBe(1_000)
    expect(limitForPlan('start', 'products_sync')).toBe(1_500)
    expect(limitForPlan('start', 'customers_sync')).toBe(2_500)
  })
  it('Growth sync caps are 5k/5k/10k', () => {
    expect(limitForPlan('growth', 'orders_sync_month')).toBe(5_000)
    expect(limitForPlan('growth', 'products_sync')).toBe(5_000)
    expect(limitForPlan('growth', 'customers_sync')).toBe(10_000)
  })
  it('Commander sync caps are null (unlimited) — never 0', () => {
    expect(limitForPlan('commander', 'orders_sync_month')).toBeNull()
    expect(limitForPlan('commander', 'products_sync')).toBeNull()
    expect(limitForPlan('commander', 'customers_sync')).toBeNull()
  })
  it('Recommendation quotas stay locked (Trial 10 / Start 150 / Growth 300 / Commander unlimited)', () => {
    expect(limitForPlan('trial', 'ai_recommendations_month')).toBe(10)
    expect(limitForPlan('start', 'ai_recommendations_month')).toBe(150)
    expect(limitForPlan('growth', 'ai_recommendations_month')).toBe(300)
    expect(limitForPlan('commander', 'ai_recommendations_month')).toBeNull()
  })
  it('Agent counts stay locked (Trial 2 / Start 3 / Growth 4 / Commander 6)', () => {
    expect(agentsForPlanCount('trial')).toBe(2)
    expect(agentsForPlanCount('start')).toBe(3)
    expect(agentsForPlanCount('growth')).toBe(4)
    expect(agentsForPlanCount('commander')).toBe(6)
  })
  it('AI Command daily stays locked (Trial 10 / Start 100 / Growth 300 / Commander unlimited)', () => {
    expect(limitForPlan('trial', 'ai_command_daily')).toBe(10)
    expect(limitForPlan('start', 'ai_command_daily')).toBe(100)
    expect(limitForPlan('growth', 'ai_command_daily')).toBe(300)
    expect(limitForPlan('commander', 'ai_command_daily')).toBeNull()
  })
  it('Automation workflows stay locked (Trial 2 / Start 5 / Growth 20 / Commander unlimited)', () => {
    expect(limitForPlan('trial', 'automation_workflows')).toBe(2)
    expect(limitForPlan('start', 'automation_workflows')).toBe(5)
    expect(limitForPlan('growth', 'automation_workflows')).toBe(20)
    expect(limitForPlan('commander', 'automation_workflows')).toBeNull()
  })
  it('Hidden meter keys hide dead features (no fake 0/0)', () => {
    expect(HIDDEN_METER_KEYS.has('sms_sends_month')).toBe(true)
    expect(HIDDEN_METER_KEYS.has('active_campaigns')).toBe(true)
    expect(HIDDEN_METER_KEYS.has('jarvis_messages_month')).toBe(true)
    expect(HIDDEN_METER_KEYS.has('orders_sync_month')).toBe(false)
  })
  it('exposes Commander fair-use thresholds for admin/UI', () => {
    expect(FAIR_USE_ORDERS_30D).toBe(100_000)
    expect(FAIR_USE_PRODUCTS_ACTIVE).toBe(50_000)
    expect(FAIR_USE_CUSTOMERS).toBe(100_000)
  })
  it('PLAN_ENTITLEMENT_LIMITS and PLAN_DEFINITIONS agree on every key', () => {
    // The two tables must stay in lock-step. PR #46 unified them and this
    // guard prevents future drift back to the pre-unification era.
    for (const plan of ['START', 'GROWTH', 'COMMANDER'] as const) {
      const tier = plan === 'START' ? 'start' : plan === 'GROWTH' ? 'growth' : 'commander'
      for (const [key, value] of Object.entries(PLAN_DEFINITIONS[plan].limits)) {
        expect(PLAN_ENTITLEMENT_LIMITS[tier][key as keyof typeof PLAN_ENTITLEMENT_LIMITS[typeof tier]]).toBe(value)
      }
    }
  })
})

describe('trial and gift redemption', () => {
  it('returns null for a shop without a trial', () => expect(new TrialAndGiftLedger().trial('missing')).toBeNull())
  it('tracks one limited trial for a shop id', () => { const ledger = new TrialAndGiftLedger(); const first = ledger.startTrial('s', 100); expect(ledger.startTrial('s', 200)).toEqual(first); expect(subscriptionForTrial('s', first, 200).state).toBe('TRIAL_LIMITED') })
  it('expires trials after fourteen days', () => { const ledger = new TrialAndGiftLedger(); ledger.startTrial('s', 100); expect(ledger.trial('s', 100 + 14 * 86_400_000)?.state).toBe('EXPIRED') })
  it('finds trials for an hourly nudge window', () => { const ledger = new TrialAndGiftLedger(); ledger.startTrial('s', 100, 1); expect(ledger.expiringTrials(100, 86_400_000)).toHaveLength(1) })
  it('redeems a gift for Commander for the full duration', () => { const ledger = new TrialAndGiftLedger(); ledger.startTrial('s', 100); const redemption = ledger.redeemGift('s', 'KASSAR786', 200); expect(redemption.code).toBe('KASSAR786'); expect(redemption.expiresAt).toBe(200 + 3 * 86_400_000) })
  it('forfeits the trial permanently when a gift is redeemed (no trial days after the gift)', () => { const ledger = new TrialAndGiftLedger(); const original = ledger.startTrial('s', 100); ledger.redeemGift('s', 'KASSAR786', 200); const forfeited = ledger.trial('s', 1_000); expect(forfeited?.trialForfeited).toBe(true); expect(forfeited?.consumed).toBe(true); expect(forfeited?.startedAt).toBe(original.startedAt) })
  it('cancels the trial only on an explicit upgrade', () => { const ledger = new TrialAndGiftLedger(); ledger.startTrial('s', 100); const cancelled = ledger.cancelTrial('s'); expect(cancelled?.state).toBe('CANCELLED'); expect(cancelled?.consumed).toBe(true) })
  it('prevents a store from redeeming twice', () => { const ledger = new TrialAndGiftLedger(); ledger.redeemGift('s', 'KASSAR786'); expect(() => ledger.redeemGift('s', 'AFRIDI786')).toThrow('A gift code has already been redeemed for this store') })
  it('blocks a secondary code while the primary is still active', () => { const ledger = new TrialAndGiftLedger(); expect(() => ledger.redeemGift('s', 'AFRIDI786')).toThrow('primary promotion code') })
  it('allows the secondary code once the primary is exhausted', () => {
    const ledger = new TrialAndGiftLedger()
    for (let i = 0; i < 100; i += 1) ledger.redeemGift(`s-${i}`, 'KASSAR786')
    expect(ledger.gift('KASSAR786')?.active).toBe(false)
    const redemption = ledger.redeemGift('z', 'AFRIDI786')
    expect(redemption.code).toBe('AFRIDI786')
  })
  it('auto-deactivates an exhausted code', () => { const ledger = new TrialAndGiftLedger(); for (let i = 0; i < 100; i += 1) ledger.redeemGift(`s-${i}`, 'KASSAR786'); expect(ledger.gift('KASSAR786')?.active).toBe(false) })
  it('supports an admin kill switch', () => { const ledger = new TrialAndGiftLedger(); ledger.setGiftKillSwitch(true); expect(() => ledger.redeemGift('s', 'KASSAR786')).toThrow('disabled') })
  it('rejects invalid codes', () => expect(() => new TrialAndGiftLedger().redeemGift('s', 'NOPE')).toThrow('invalid'))
})

describe('gift expiry revert (expiredGiftRevert)', () => {
  const now = Date.parse('2026-08-21T00:00:00.000Z')
  const giftRecord = { storeId: 's' as const, plan: 'commander' as const, state: 'GIFT_ACCESS_UNLIMITED' as const, currentPeriodEnd: now - 1_000, version: 3, interval: null, chargeId: null }
  it('returns null when there is no gift subscription', () => {
    expect(expiredGiftRevert(null, null, now)).toBeNull()
    expect(expiredGiftRevert({ ...giftRecord, state: 'ACTIVE_MONTHLY' as const, plan: 'start' as const }, null, now)).toBeNull()
  })
  it('returns null while the gift window is still open', () => {
    expect(expiredGiftRevert({ ...giftRecord, currentPeriodEnd: now + 86_400_000 }, null, now)).toBeNull()
  })
  it('reverts to Trial (TRIAL_LIMITED) when the trial is still valid and never forfeited', () => {
    const trial = { shopId: 's', startedAt: now - 10 * 86_400_000, expiresAt: now + 4 * 86_400_000, consumed: false, state: 'ACTIVE' as const, trialForfeited: false }
    const reverted = expiredGiftRevert(giftRecord, trial, now)
    expect(reverted?.state).toBe('TRIAL_LIMITED')
    expect(reverted?.plan).toBe('trial')
    expect(reverted?.currentPeriodEnd).toBe(trial.expiresAt)
    expect(reverted?.version).toBe(4)
  })
  it('reverts to locked (TRIAL_EXPIRED) when the trial is also expired', () => {
    const trial = { shopId: 's', startedAt: now - 30 * 86_400_000, expiresAt: now - 2 * 86_400_000, consumed: false, state: 'EXPIRED' as const, trialForfeited: false }
    const reverted = expiredGiftRevert(giftRecord, trial, now)
    expect(reverted?.state).toBe('TRIAL_EXPIRED')
    expect(reverted?.plan).toBe('trial')
  })
  it('reverts to locked (TRIAL_EXPIRED) with zero trial days when the trial was forfeited by the gift', () => {
    const trial = { shopId: 's', startedAt: now - 10 * 86_400_000, expiresAt: now + 4 * 86_400_000, consumed: true, state: 'CANCELLED' as const, trialForfeited: true }
    const reverted = expiredGiftRevert(giftRecord, trial, now)
    expect(reverted?.state).toBe('TRIAL_EXPIRED')
    expect(reverted?.plan).toBe('trial')
  })
})

describe('funnel, grandfathering, ROI, admin', () => {
  it('tracks all seven idempotent funnel milestones', () => { const ledger = new FunnelLedger(); FUNNEL_MILESTONES.forEach((milestone) => ledger.record('s', milestone)); expect(ledger.milestones('s')).toHaveLength(7); expect(ledger.record('s', 'install')).toBe(false) })
  it('locks grandfathered prices for renewal', () => { const locked = lockPrice('s', 'GROWTH', 'MONTHLY', 99, 100); expect(priceForRenewal(locked, 199)).toBe(99); expect(locked.grandfathered).toBe(true) })
  it('calculates net ROI and multiple', () => expect(calculateRoi(1000, 10_000)).toEqual({ attributedRevenue: 1000, aiCostDollars: .01, netReturn: 999.99, multiple: 100_000 }))
  it('expires admin step-up sessions after fifteen minutes', () => { const sessions = new AdminStepUpSessions(15); const token = sessions.issue('key', 'key', 100); expect(sessions.valid(token, 100)).toBe(true); expect(sessions.valid(token, 900_101)).toBe(false) })
  it('rejects an invalid admin key', () => expect(() => new AdminStepUpSessions().issue('bad', 'good')).toThrow('Invalid'))
})
