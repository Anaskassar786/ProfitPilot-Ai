import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'

export type BillingState = 'TRIAL_LIMITED' | 'GIFT_ACCESS_UNLIMITED' | 'ACTIVE_MONTHLY' | 'ACTIVE_ANNUAL' | 'PENDING_CONFIRMATION' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED'
export type BillingEvent = 'trial_expired' | 'charge_confirmed_monthly' | 'charge_confirmed_annual' | 'charge_pending' | 'charge_failed' | 'charge_declined' | 'charge_recovered' | 'cancelled' | 'suspend' | 'gift_redeemed'

export type Subscription = Readonly<{ storeId?: string; plan: PlanTier; state: BillingState; currentPeriodEnd: number | null; version: number; priceLockedAt?: number | null; grandfathered?: boolean }>

const transitions: Readonly<Record<BillingState, Partial<Record<BillingEvent, BillingState>>>> = {
  TRIAL_LIMITED: { trial_expired: 'PENDING_CONFIRMATION', charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', gift_redeemed: 'GIFT_ACCESS_UNLIMITED' },
  GIFT_ACCESS_UNLIMITED: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', trial_expired: 'PENDING_CONFIRMATION' },
  ACTIVE_MONTHLY: { charge_pending: 'PENDING_CONFIRMATION', charge_failed: 'PAST_DUE', charge_declined: 'PAST_DUE', cancelled: 'CANCELLED', suspend: 'SUSPENDED' },
  ACTIVE_ANNUAL: { charge_pending: 'PENDING_CONFIRMATION', charge_failed: 'PAST_DUE', charge_declined: 'PAST_DUE', cancelled: 'CANCELLED', suspend: 'SUSPENDED' },
  PENDING_CONFIRMATION: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', charge_failed: 'PAST_DUE', charge_declined: 'PAST_DUE', suspend: 'SUSPENDED' },
  PAST_DUE: { charge_recovered: 'ACTIVE_MONTHLY', cancelled: 'CANCELLED', suspend: 'SUSPENDED' },
  SUSPENDED: { charge_recovered: 'ACTIVE_MONTHLY', charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', cancelled: 'CANCELLED' },
  CANCELLED: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', gift_redeemed: 'GIFT_ACCESS_UNLIMITED' },
}

export function transition(subscription: Subscription, event: BillingEvent): Subscription {
  const nextState = transitions[subscription.state][event]
  if (!nextState) throw new AppError('CONFLICT', `Cannot apply ${event} while billing is ${subscription.state}`, 409, { state: subscription.state, event })
  return { ...subscription, state: nextState, version: subscription.version + 1 }
}

export function isReadOnly(state: BillingState): boolean { return state === 'SUSPENDED' || state === 'PAST_DUE' || state === 'CANCELLED' }
export function canUseEntitlement(subscription: Subscription, limit: number | null, used: number): boolean { return !isReadOnly(subscription.state) && (limit === null || used < limit) }
export function assertVersion(subscription: Subscription, expectedVersion: number): void { if (subscription.version !== expectedVersion) throw new AppError('CONFLICT', 'Subscription changed; reload before retrying', 409, { expectedVersion, actualVersion: subscription.version }) }
