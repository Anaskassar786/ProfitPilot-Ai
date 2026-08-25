import { describe, expect, it } from 'vitest'
import type { Subscription } from './billing.js'
import { billingStatusFor, canUseEntitlement, effectiveBillingState, isReadOnly } from './billing.js'
import { accessGate, assertAccess, UpgradeRequiredError } from './entitlements.js'

/**
 * Cancellation grace period (Task 2).
 *
 * When a merchant cancels, the backend sets `plan_status = CANCELLED` but must
 * keep FULL entitlements until the end of the paid billing period. Access only
 * drops to ACCOUNT_READ_ONLY once `now >= current_period_end`.
 */
const FUTURE = 1_000_000
const NOW = 500_000
const base: Subscription = { storeId: 's', plan: 'growth', state: 'CANCELLED', currentPeriodEnd: FUTURE, version: 3 }

describe('cancellation grace period', () => {
  it('distinguishes CANCELLED_ACTIVE (in grace) from CANCELLED_EXPIRED (read-only)', () => {
    expect(effectiveBillingState(base, NOW)).toBe('CANCELLED_ACTIVE')
    expect(effectiveBillingState({ ...base, currentPeriodEnd: FUTURE }, NOW)).toBe('CANCELLED_ACTIVE')
    expect(effectiveBillingState({ ...base, currentPeriodEnd: NOW }, NOW)).toBe('CANCELLED_EXPIRED')
    expect(effectiveBillingState({ ...base, currentPeriodEnd: NOW - 1 }, NOW)).toBe('CANCELLED_EXPIRED')
    // No recorded period end ⇒ cannot verify paid days ⇒ read-only.
    expect(effectiveBillingState({ ...base, currentPeriodEnd: null }, NOW)).toBe('CANCELLED_EXPIRED')
    expect(billingStatusFor({ ...base, currentPeriodEnd: FUTURE }, NOW)).toBe('CANCELLED_ACTIVE')
    expect(billingStatusFor({ ...base, currentPeriodEnd: NOW - 1 }, NOW)).toBe('CANCELLED_EXPIRED')
    // Non-cancelled states are returned unchanged.
    expect(effectiveBillingState({ ...base, state: 'ACTIVE_MONTHLY' }, NOW)).toBe('ACTIVE_MONTHLY')
    expect(effectiveBillingState({ ...base, state: 'SUSPENDED' }, NOW)).toBe('SUSPENDED')
  })

  it('isReadOnly honors the grace window and only flips after the paid period ends', () => {
    expect(isReadOnly('CANCELLED', base, NOW)).toBe(false)            // still paid
    expect(isReadOnly('CANCELLED', { currentPeriodEnd: NOW - 1 }, NOW)).toBe(true) // expired
    expect(isReadOnly('CANCELLED', { currentPeriodEnd: null }, NOW)).toBe(true)    // unknown
    expect(isReadOnly('CANCELLED')).toBe(true)                         // no subscription context
    expect(isReadOnly('SUSPENDED')).toBe(true)
    expect(isReadOnly('PAST_DUE')).toBe(true)
    expect(isReadOnly('ACTIVE_MONTHLY')).toBe(false)
  })

  it('canUseEntitlement stays true inside the grace window and false once expired', () => {
    expect(canUseEntitlement(base, null, 0, NOW)).toBe(true)
    expect(canUseEntitlement(base, 100, 99, NOW)).toBe(true)
    expect(canUseEntitlement(base, 100, 100, NOW)).toBe(false) // exhausted, not read-only
    expect(canUseEntitlement({ ...base, currentPeriodEnd: NOW - 1 }, null, 0, NOW)).toBe(false)
  })

  it('accessGate grants full entitlements for CANCELLED within the paid period', () => {
    const decision = accessGate(base, { feature: 'ai_recommendations_month', used: 2 }, NOW)
    expect(decision.allowed).toBe(true)
    expect(decision.readOnly).toBe(false)
    expect(decision.reason).toBeNull()
    expect(decision.remaining).toBe(298) // growth cap 300
  })

  it('accessGate drops to ACCOUNT_READ_ONLY once the paid period expires', () => {
    const decision = accessGate({ ...base, currentPeriodEnd: NOW - 1 }, { feature: 'ai_recommendations_month', used: 0 }, NOW)
    expect(decision.allowed).toBe(false)
    expect(decision.readOnly).toBe(true)
    expect(decision.reason).toBe('ACCOUNT_READ_ONLY')
  })

  it('a cancelled store with an unknown period end is read-only (fail-safe)', () => {
    const decision = accessGate({ ...base, currentPeriodEnd: null }, { feature: 'ai_recommendations_month', used: 0 }, NOW)
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('ACCOUNT_READ_ONLY')
  })

  it('assertAccess does not throw for an in-grace cancelled store under its limit', () => {
    expect(() => assertAccess(base, { feature: 'automation_workflows', used: 3 }, NOW)).not.toThrow()
  })

  it('assertAccess still throws UPGRADE_REQUIRED (402) when the in-grace quota is exhausted', () => {
    expect(() => assertAccess(base, { feature: 'ai_recommendations_month', used: 300 }, NOW)).toThrow(UpgradeRequiredError)
  })

  it('support/legal/billing pages stay reachable whether or not the grace window is open', () => {
    expect(accessGate(base, { feature: 'reports', used: 0, support: true }, NOW).allowed).toBe(true)
    expect(accessGate({ ...base, currentPeriodEnd: NOW - 1 }, { feature: 'reports', used: 0, legal: true }, NOW).allowed).toBe(true)
    expect(accessGate({ ...base, currentPeriodEnd: NOW - 1 }, { feature: 'reports', used: 0, billingPage: true }, NOW).allowed).toBe(true)
  })
})
