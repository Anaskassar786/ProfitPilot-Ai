import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'

export type BillingState = 'TRIAL_LIMITED' | 'GIFT_ACCESS_UNLIMITED' | 'ACTIVE_MONTHLY' | 'ACTIVE_ANNUAL' | 'PENDING_CONFIRMATION' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED'
export type BillingEvent = 'trial_expired' | 'charge_confirmed_monthly' | 'charge_confirmed_annual' | 'charge_pending' | 'charge_failed' | 'charge_recovered' | 'cancelled'

export type Subscription = Readonly<{ state: BillingState; plan: PlanTier; currentPeriodEnd: number | null; version: number }>

const transitions: Readonly<Record<BillingState, Partial<Record<BillingEvent, BillingState>>>> = {
  TRIAL_LIMITED: { trial_expired: 'PENDING_CONFIRMATION', charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL' },
  GIFT_ACCESS_UNLIMITED: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL' },
  ACTIVE_MONTHLY: { charge_pending: 'PENDING_CONFIRMATION', charge_failed: 'PAST_DUE', cancelled: 'CANCELLED' },
  ACTIVE_ANNUAL: { charge_pending: 'PENDING_CONFIRMATION', charge_failed: 'PAST_DUE', cancelled: 'CANCELLED' },
  PENDING_CONFIRMATION: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL', charge_failed: 'PAST_DUE' },
  PAST_DUE: { charge_recovered: 'ACTIVE_MONTHLY', cancelled: 'CANCELLED' },
  SUSPENDED: { charge_recovered: 'ACTIVE_MONTHLY', cancelled: 'CANCELLED' },
  CANCELLED: { charge_confirmed_monthly: 'ACTIVE_MONTHLY', charge_confirmed_annual: 'ACTIVE_ANNUAL' },
}

export function transition(subscription: Subscription, event: BillingEvent): Subscription {
  const nextState = transitions[subscription.state][event]
  if (!nextState) {
    throw new AppError('CONFLICT', `Cannot apply ${event} while billing is ${subscription.state}`, 409, { state: subscription.state, event })
  }
  return { ...subscription, state: nextState, version: subscription.version + 1 }
}

export function isReadOnly(state: BillingState): boolean {
  return state === 'SUSPENDED' || state === 'PAST_DUE' || state === 'CANCELLED'
}

export function canUseEntitlement(subscription: Subscription, limit: number | null, used: number): boolean {
  if (isReadOnly(subscription.state)) return false
  return limit === null || used < limit
}

export function assertVersion(subscription: Subscription, expectedVersion: number): void {
  if (subscription.version !== expectedVersion) {
    throw new AppError('CONFLICT', 'Subscription changed; reload before retrying', 409, { expectedVersion, actualVersion: subscription.version })
  }
}
