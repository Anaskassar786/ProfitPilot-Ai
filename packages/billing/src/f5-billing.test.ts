import { describe, expect, it } from 'vitest'
import { assertAccess, UpgradeRequiredError, accessGate, limitForPlan } from './entitlements.js'
import { AdminStepUpSessions, FunnelLedger, FUNNEL_MILESTONES, calculateRoi, lockPrice, priceForRenewal } from './growth.js'
import { PLAN_DEFINITIONS, entitlementsFor, planFor, priceFor } from './plans.js'
import { TrialAndGiftLedger, subscriptionForTrial } from './trials.js'
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
  it('enforces growth recommendation quota', () => expect(limitForPlan('growth', 'ai_recommendations_month')).toBe(150))
  it('keeps billing page accessible for suspended stores', () => expect(accessGate({ ...active, state: 'SUSPENDED' }, { feature: 'orders_sync_month', used: 0, billingPage: true }).allowed).toBe(true))
  it('returns upgrade required for exhausted quota', () => expect(() => assertAccess(active, { feature: 'ai_recommendations_month', used: 150 })).toThrow(UpgradeRequiredError))
  it('allows commander unlimited quota', () => expect(accessGate({ ...active, plan: 'commander' }, { feature: 'ai_recommendations_month', used: 999 }).allowed).toBe(true))
  it('returns remaining limited quota', () => expect(accessGate(active, { feature: 'ai_recommendations_month', used: 2 }).remaining).toBe(148))
  it('blocks disabled trial features', () => expect(accessGate({ ...active, plan: 'trial', state: 'TRIAL_LIMITED' }, { feature: 'exports', used: 0 }).reason).toBe('UPGRADE_REQUIRED'))
  it('keeps support and legal accessible in read-only mode', () => { expect(accessGate({ ...active, state: 'CANCELLED' }, { feature: 'reports', used: 0, support: true }).allowed).toBe(true); expect(accessGate({ ...active, state: 'CANCELLED' }, { feature: 'reports', used: 0, legal: true }).allowed).toBe(true) })
})

describe('trial and gift redemption', () => {
  it('returns null for a shop without a trial', () => expect(new TrialAndGiftLedger().trial('missing')).toBeNull())
  it('tracks one limited trial for a shop id', () => { const ledger = new TrialAndGiftLedger(); const first = ledger.startTrial('s', 100); expect(ledger.startTrial('s', 200)).toEqual(first); expect(subscriptionForTrial('s', first, 200).state).toBe('TRIAL_LIMITED') })
  it('expires trials after fourteen days', () => { const ledger = new TrialAndGiftLedger(); ledger.startTrial('s', 100); expect(ledger.trial('s', 100 + 14 * 86_400_000)?.state).toBe('EXPIRED') })
  it('finds trials for an hourly nudge window', () => { const ledger = new TrialAndGiftLedger(); ledger.startTrial('s', 100, 1); expect(ledger.expiringTrials(100, 86_400_000)).toHaveLength(1) })
  it('redeems a gift and cancels the trial', () => { const ledger = new TrialAndGiftLedger(); ledger.startTrial('s', 100); const redemption = ledger.redeemGift('s', 'KASSAR786', 200); expect(redemption.code).toBe('KASSAR786'); expect(ledger.trial('s')?.state).toBe('CANCELLED') })
  it('prevents a store from redeeming twice', () => { const ledger = new TrialAndGiftLedger(); ledger.redeemGift('s', 'KASSAR786'); expect(() => ledger.redeemGift('s', 'AFRIDI786')).toThrow('already redeemed') })
  it('auto-deactivates an exhausted code', () => { const ledger = new TrialAndGiftLedger(); for (let i = 0; i < 100; i += 1) ledger.redeemGift(`s-${i}`, 'KASSAR786'); expect(ledger.gift('KASSAR786')?.active).toBe(false) })
  it('supports an admin kill switch', () => { const ledger = new TrialAndGiftLedger(); ledger.setGiftKillSwitch(true); expect(() => ledger.redeemGift('s', 'KASSAR786')).toThrow('disabled') })
  it('rejects invalid codes', () => expect(() => new TrialAndGiftLedger().redeemGift('s', 'NOPE')).toThrow('invalid'))
})

describe('funnel, grandfathering, ROI, admin', () => {
  it('tracks all seven idempotent funnel milestones', () => { const ledger = new FunnelLedger(); FUNNEL_MILESTONES.forEach((milestone) => ledger.record('s', milestone)); expect(ledger.milestones('s')).toHaveLength(7); expect(ledger.record('s', 'install')).toBe(false) })
  it('locks grandfathered prices for renewal', () => { const locked = lockPrice('s', 'GROWTH', 'MONTHLY', 99, 100); expect(priceForRenewal(locked, 199)).toBe(99); expect(locked.grandfathered).toBe(true) })
  it('calculates net ROI and multiple', () => expect(calculateRoi(1000, 10_000)).toEqual({ attributedRevenue: 1000, aiCostDollars: .01, netReturn: 999.99, multiple: 100_000 }))
  it('expires admin step-up sessions after fifteen minutes', () => { const sessions = new AdminStepUpSessions(15); const token = sessions.issue('key', 'key', 100); expect(sessions.valid(token, 100)).toBe(true); expect(sessions.valid(token, 900_101)).toBe(false) })
  it('rejects an invalid admin key', () => expect(() => new AdminStepUpSessions().issue('bad', 'good')).toThrow('Invalid'))
})
