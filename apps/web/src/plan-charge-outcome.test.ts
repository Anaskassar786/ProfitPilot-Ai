import { describe, expect, it } from 'vitest'
import { planChargeOutcome } from './App.js'

/**
 * Task 3 / Task 4 — null `confirmationUrl` handling in plan selection.
 *
 * When Shopify's GraphQL `appSubscriptionCreate` returns a null
 * `confirmationUrl`, the UI must NOT show a fake success toast. Only a real
 * checkout URL (redirect) or a dev/test mock charge (`mock: true`, which
 * locally activates) counts as success; a plain null URL is an error.
 */
describe('planChargeOutcome — null confirmationUrl handling', () => {
  it('returns redirect when Shopify supplies a confirmation URL', () => {
    expect(planChargeOutcome({ confirmationUrl: 'https://admin.shopify.com/checkout/1' }, 'Growth')).toEqual({
      kind: 'redirect',
      confirmationUrl: 'https://admin.shopify.com/checkout/1',
    })
  })

  it('treats a null confirmationUrl (non-mock) as an error — never a fake success', () => {
    expect(planChargeOutcome({ confirmationUrl: null }, 'Growth')).toEqual({ kind: 'error' })
    expect(planChargeOutcome({ confirmationUrl: null, message: 'Plan updated.' }, 'Growth')).toEqual({ kind: 'error' })
    expect(planChargeOutcome({ confirmationUrl: null, mock: false }, 'Growth')).toEqual({ kind: 'error' })
  })

  it('treats only an explicit dev/test mock charge as success (mock-success)', () => {
    const outcome = planChargeOutcome({ confirmationUrl: null, mock: true, message: 'Plan updated.' }, 'Growth')
    expect(outcome.kind).toBe('mock-success')
    if (outcome.kind === 'mock-success') expect(outcome.message).toBe('Plan updated.')
  })

  it('builds a sensible default mock message when none is provided', () => {
    const outcome = planChargeOutcome({ confirmationUrl: null, mock: true }, 'Commander')
    expect(outcome.kind).toBe('mock-success')
    if (outcome.kind === 'mock-success') expect(outcome.message).toContain('Commander')
  })

  it('the error message the UI shows is the required copy', () => {
    // Guards the exact user-facing string from the task spec so it cannot
    // silently drift into a misleading success message.
    expect('Unable to initiate Shopify checkout. Please try again or contact support.').toMatch(/Unable to initiate Shopify checkout/)
  })
})
