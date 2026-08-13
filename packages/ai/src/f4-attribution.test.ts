import { describe, expect, it } from 'vitest'
import { AttributionTracker } from './attribution.js'
import { storeId } from '@profitpilot/types'

describe('F4 attribution tracker', () => {
  it('rejects missing attribution configuration', () => {
    expect(() => new AttributionTracker('')).toThrow('secret')
    expect(() => new AttributionTracker('secret', 0)).toThrow('window')
  })
  it('creates and verifies signed checkout tokens', () => {
    const tracker = new AttributionTracker('tracking-secret')
    const token = tracker.createCheckoutToken(storeId('s'), 'action-1', 'checkout-1', 2_000)
    expect(tracker.verifyCheckoutToken(token, 1_000)).toMatchObject({ actionId: 'action-1', checkoutId: 'checkout-1' })
  })
  it('rejects tampered tokens', () => {
    const tracker = new AttributionTracker('tracking-secret')
    const token = tracker.createCheckoutToken(storeId('s'), 'action-1', 'checkout-1', 2_000)
    expect(() => tracker.verifyCheckoutToken(`${token}bad`, 1_000)).toThrow('Invalid')
  })
  it('rejects expired tokens', () => {
    const tracker = new AttributionTracker('tracking-secret')
    const token = tracker.createCheckoutToken(storeId('s'), 'action-1', 'checkout-1', 2_000)
    expect(() => tracker.verifyCheckoutToken(token, 2_001)).toThrow('expired')
  })
  it('prioritizes checkout token attribution', () => {
    const tracker = new AttributionTracker('tracking-secret')
    tracker.record({ storeId: storeId('s'), actionId: 'time', discountCode: 'SAVE', clickedAt: 100, attributedRevenue: 1, orderId: 'old' })
    const token = tracker.createCheckoutToken(storeId('s'), 'checkout-action', 'checkout-1', 2_000)
    expect(tracker.match(storeId('s'), { orderId: 'o1', checkoutToken: token, discountCode: 'SAVE', createdAt: 1_000, total: 99 })?.method).toBe('CHECKOUT_TOKEN')
  })
  it('falls back to discount-code attribution', () => {
    const tracker = new AttributionTracker('tracking-secret')
    tracker.record({ storeId: storeId('s'), actionId: 'discount-action', discountCode: 'SAVE', clickedAt: 100, attributedRevenue: 1, orderId: 'old' })
    expect(tracker.match(storeId('s'), { orderId: 'o1', discountCode: 'SAVE', createdAt: 200, total: 50 })?.method).toBe('DISCOUNT_CODE')
  })
  it('falls back to a time window', () => {
    const tracker = new AttributionTracker('tracking-secret', 100)
    tracker.record({ storeId: storeId('s'), actionId: 'time-action', clickedAt: 100, attributedRevenue: 1, orderId: 'old' })
    expect(tracker.match(storeId('s'), { orderId: 'o1', createdAt: 150, total: 50 })?.method).toBe('TIME_WINDOW')
  })
  it('returns no attribution outside the time window', () => {
    const tracker = new AttributionTracker('tracking-secret', 100)
    tracker.record({ storeId: storeId('s'), actionId: 'time-action', clickedAt: 100, attributedRevenue: 1, orderId: 'old' })
    expect(tracker.match(storeId('s'), { orderId: 'o1', createdAt: 201, total: 50 })).toBeNull()
  })
  it('deduplicates order touch records', () => {
    const tracker = new AttributionTracker('tracking-secret')
    const touch = { storeId: storeId('s'), actionId: 'a', clickedAt: 100, attributedRevenue: 1, orderId: 'o' }
    expect(tracker.record(touch)).toBe(true)
    expect(tracker.record(touch)).toBe(false)
  })
})
