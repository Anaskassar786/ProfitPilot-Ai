import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'

export type BillingState = 'TRIAL_LIMITED' | 'TRIAL_EXPIRED' | 'GIFT_ACCESS_UNLIMITED' | 'ACTIVE_MONTHLY' | 'ACTIVE_ANNUAL' | 'PENDING_CONFIRMATION' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED'
export type BillingEvent = 'trial_expired' | 'charge_confirmed_monthly' | 'charge_confirmed_annual' | 'charge_pending' | 'charge_failed' | 'charge_declined' | 'charge_recovered' | 'cancelled' | 'suspend' | 'gift_redeemed'

export type Subscription = Readonly<{ storeId?: string; plan: PlanTier; state: BillingState; currentPeriodEnd: number | null; version: number; priceLockedAt?: number | null; grandfathered?: boolean }>

const transitions: Readonly<Record<BillingState, Partial<Record<BillingEvent, BillingState>>>> = {
  TRIAL_LIMITED: { trial_expired: 'TRIAL_EXPIRED', charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', gift_redeemed: 'GIFT_ACCESS_UNLIMITED' },
  GIFT_ACCESS_UNLIMITED: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', trial_expired: 'TRIAL_EXPIRED' },
  ACTIVE_MONTHLY: { charge_pending: 'PENDING_CONFIRMATION', charge_failed: 'PAST_DUE', charge_declined: 'PAST_DUE', cancelled: 'CANCELLED', suspend: 'SUSPENDED' },
  ACTIVE_ANNUAL: { charge_pending: 'PENDING_CONFIRMATION', charge_failed: 'PAST_DUE', charge_declined: 'PAST_DUE', cancelled: 'CANCELLED', suspend: 'SUSPENDED' },
  PENDING_CONFIRMATION: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', charge_failed: 'PAST_DUE', charge_declined: 'PAST_DUE', suspend: 'SUSPENDED' },
  TRIAL_EXPIRED: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', charge_pending: 'PENDING_CONFIRMATION', charge_failed: 'PAST_DUE', charge_declined: 'PAST_DUE', suspend: 'SUSPENDED' },
  PAST_DUE: { charge_recovered: 'ACTIVE_MONTHLY', cancelled: 'CANCELLED', suspend: 'SUSPENDED' },
  SUSPENDED: { charge_recovered: 'ACTIVE_MONTHLY', charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', cancelled: 'CANCELLED' },
  CANCELLED: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', gift_redeemed: 'GIFT_ACCESS_UNLIMITED' },
}

export function transition(subscription: Subscription, event: BillingEvent): Subscription {
  const nextState = transitions[subscription.state][event]
  if (!nextState) throw new AppError('CONFLICT', `Cannot apply ${event} while billing is ${subscription.state}`, 409, { state: subscription.state, event })
  return { ...subscription, state: nextState, version: subscription.version + 1 }
}

/**
 * Effective billing status once the cancellation grace period is taken into
 * account. A store whose plan_status is CANCELLED keeps FULL entitlements
 * until `currentPeriodEnd` passes, then drops to read-only.
 *
 *   - `CANCELLED_ACTIVE`  → cancelled but still inside the paid billing period
 *                           (now < currentPeriodEnd). The merchant retains
 *                           every entitlement their plan paid for.
 *   - `CANCELLED_EXPIRED` → the paid period has ended (now >= currentPeriodEnd)
 *                           OR there is no period end recorded, so the store
 *                           drops to ACCOUNT_READ_ONLY.
 *
 * All other billing states are returned unchanged.
 */
export type EffectiveBillingState = BillingState | 'CANCELLED_ACTIVE' | 'CANCELLED_EXPIRED'

export function effectiveBillingState(subscription: Subscription, now: number = Date.now()): EffectiveBillingState {
  if (subscription.state !== 'CANCELLED') return subscription.state
  if (subscription.currentPeriodEnd !== null && now < subscription.currentPeriodEnd) return 'CANCELLED_ACTIVE'
  return 'CANCELLED_EXPIRED'
}

/** Alias used by billing status helpers to distinguish the grace window. */
export function billingStatusFor(subscription: Subscription, now: number = Date.now()): EffectiveBillingState {
  return effectiveBillingState(subscription, now)
}

/**
 * Whether a subscription is read-only. Honors the cancellation grace period:
 * a CANCELLED subscription is NOT read-only while `now < currentPeriodEnd`,
 * and only becomes read-only once the paid period has expired.
 */
export function isReadOnly(state: BillingState, subscription?: Pick<Subscription, 'currentPeriodEnd'>, now: number = Date.now()): boolean {
  if (state === 'CANCELLED') {
    if (subscription && subscription.currentPeriodEnd !== null && now < subscription.currentPeriodEnd) return false
    return true
  }
  return state === 'SUSPENDED' || state === 'PAST_DUE'
}
export function canUseEntitlement(subscription: Subscription, limit: number | null, used: number, now: number = Date.now()): boolean { return !isReadOnly(subscription.state, subscription, now) && (limit === null || used < limit) }
export function assertVersion(subscription: Subscription, expectedVersion: number): void { if (subscription.version !== expectedVersion) throw new AppError('CONFLICT', 'Subscription changed; reload before retrying', 409, { expectedVersion, actualVersion: subscription.version }) }
