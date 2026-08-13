import { describe, expect, it } from 'vitest'
import { AppError } from '@profitpilot/types'
import { assertVersion, canUseEntitlement, isReadOnly, transition } from './index.js'
import type { Subscription } from './index.js'

const active: Subscription = { state: 'ACTIVE_MONTHLY', plan: 'growth', currentPeriodEnd: 1000, version: 1 }

describe('billing state machine', () => {
  it('moves an active subscription to pending confirmation', () => expect(transition(active, 'charge_pending').state).toBe('PENDING_CONFIRMATION'))
  it('moves pending monthly confirmation to active', () => expect(transition({ ...active, state: 'PENDING_CONFIRMATION' }, 'charge_confirmed_monthly').state).toBe('ACTIVE_MONTHLY'))
  it('moves pending annual confirmation to annual active', () => expect(transition({ ...active, state: 'PENDING_CONFIRMATION' }, 'charge_confirmed_annual').state).toBe('ACTIVE_ANNUAL'))
  it('moves a failed charge to past due', () => expect(transition(active, 'charge_failed').state).toBe('PAST_DUE'))
  it('moves a recovered past due account to active', () => expect(transition({ ...active, state: 'PAST_DUE' }, 'charge_recovered').state).toBe('ACTIVE_MONTHLY'))
  it('increments the CAS version', () => expect(transition(active, 'charge_pending').version).toBe(2))
  it('rejects invalid transitions with typed conflicts', () => expect(() => transition(active, 'charge_recovered')).toThrow(AppError))
  it('recognizes read-only states', () => {
    expect(isReadOnly('SUSPENDED')).toBe(true)
    expect(isReadOnly('ACTIVE_MONTHLY')).toBe(false)
  })
  it('enforces limited entitlements', () => {
    expect(canUseEntitlement(active, 10, 9)).toBe(true)
    expect(canUseEntitlement(active, 10, 10)).toBe(false)
  })
  it('allows unlimited entitlements', () => expect(canUseEntitlement(active, null, 9999)).toBe(true))
  it('blocks entitlements when read only', () => expect(canUseEntitlement({ ...active, state: 'SUSPENDED' }, null, 0)).toBe(false))
  it('detects optimistic concurrency conflicts', () => expect(() => assertVersion(active, 0)).toThrow('Subscription changed'))
})
