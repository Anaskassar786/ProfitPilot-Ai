import { describe, expect, it } from 'vitest'
import { assertAiSafeSnapshot, buildStoreContext, serializeAiContext } from './context.js'
import { calculateStoreHealth } from './health.js'
import { runDeterministicRules } from './rules.js'
import type { RawStoreContext, StoreSnapshot } from './domain.js'

const raw: RawStoreContext = {
  storeId: 'store-1' as StoreSnapshot['storeId'], currency: 'USD', timezone: 'UTC', asOf: '2024-06-12T00:00:00.000Z', dataFreshAt: '2024-06-12T00:00:00.000Z',
  products: [
    { productId: 'stock', title: 'Low Stock', inventoryUnits: 4, averageDailyUnits: 2, unitPrice: 40, unitCost: 10, unitsSold120d: 80, daysSinceLastSale: 1 },
    { productId: 'dead', title: 'Dead Stock', inventoryUnits: 10, averageDailyUnits: 0, unitPrice: 20, unitCost: 5, unitsSold120d: 0, daysSinceLastSale: 120 },
    { productId: 'price', title: 'Margin Product', inventoryUnits: 100, averageDailyUnits: 2, unitPrice: 100, unitCost: 20, unitsSold120d: 50, daysSinceLastSale: 2 },
  ],
  customers: [
    { customerKey: 'c-high', lifetimeValue: 500, orderCount: 2, daysSinceLastOrder: 80, firstOrderDay: '2023-01-01', email: 'private@example.com', name: 'Private Person' },
    { customerKey: 'c-repeat', lifetimeValue: 200, orderCount: 3, daysSinceLastOrder: 50, firstOrderDay: '2023-01-01' },
    { customerKey: 'c-new', lifetimeValue: 80, orderCount: 1, daysSinceLastOrder: 2, firstOrderDay: '2024-06-10' },
  ],
  checkouts: [{ checkoutKey: 'checkout-1', total: 100, ageHours: 12, recovered: false }],
  orders: [],
  productPairs: [{ productId: 'price', relatedProductId: 'stock', coPurchaseRate: .2, productPrice: 100, relatedProductPrice: 40 }],
  last30dRevenue: 1000, previous30dRevenue: 800, last30dOrders: 20, previous30dOrders: 10,
}

describe('F4 PII-minimized context builder', () => {
  it('drops customer email and name before AI context creation', () => {
    const snapshot = buildStoreContext(raw)
    expect(JSON.stringify(snapshot)).not.toContain('private@example.com')
    expect(JSON.stringify(snapshot)).not.toContain('Private Person')
    expect(snapshot.customers[0]?.customerKey).toBe('c-high')
  })
  it('serializes an AI-safe snapshot', () => expect(serializeAiContext(buildStoreContext(raw))).not.toContain('email'))
  it('hashes a missing customer key into an opaque identifier', () => {
    const snapshot = buildStoreContext({ ...raw, customers: [{ ...raw.customers[0]!, customerKey: '' }] })
    expect(snapshot.customers[0]?.customerKey).toHaveLength(64)
  })
  it('rejects a top-level unsafe key before serialization', () => expect(() => assertAiSafeSnapshot({ ...buildStoreContext(raw), email: 'leak' } as unknown as StoreSnapshot)).toThrow('PII'))
  it('rejects an unsafe snapshot with a PII key', () => {
    const unsafe = { ...buildStoreContext(raw), customers: [{ ...buildStoreContext(raw).customers[0]!, email: 'leak@example.com' }] } as unknown as StoreSnapshot
    expect(() => serializeAiContext(unsafe)).toThrow('PII')
  })
})

describe('deterministic store health', () => {
  it('returns a deterministic method-stamped score', () => {
    const health = calculateStoreHealth(buildStoreContext(raw))
    expect(health.method).toBe('deterministic-v1')
    expect(health.score).not.toBeNull()
    expect(health.components).toHaveLength(4)
  })
  it('returns null when no health input exists', () => {
    const empty = { ...buildStoreContext(raw), products: [], customers: [], last30dRevenue: 0, previous30dRevenue: 0, last30dOrders: 0, previous30dOrders: 0 }
    expect(calculateStoreHealth(empty).score).toBeNull()
  })
  it('reports closed-period order count and order history span for empty states', () => {
    const health = calculateStoreHealth(buildStoreContext(raw))
    expect(health.orderCount).toBe(30)
    expect(health.historyDays).toBeNull() // no raw order rows → span unknown
    const withOrders = calculateStoreHealth({
      ...buildStoreContext(raw),
      orders: [{ orderKey: 'o1', total: 10, day: '2024-06-02', productIds: ['stock'], customerKey: null }, { orderKey: 'o2', total: 10, day: '2024-06-12', productIds: ['stock'], customerKey: null }],
    })
    expect(withOrders.historyDays).toBe(10)
  })
  it('handles a new positive revenue baseline', () => {
    const health = calculateStoreHealth({ ...buildStoreContext(raw), previous30dRevenue: 0, previous30dOrders: 0 })
    expect(health.components.find((component) => component.key === 'revenue_momentum')?.score).toBe(100)
  })
})

describe('eight deterministic opportunity rules', () => {
  it('emits stockout risk', () => expect(runDeterministicRules(buildStoreContext(raw)).some((signal) => signal.ruleId === 'STOCKOUT_RISK')).toBe(true))
  it('emits dead stock', () => expect(runDeterministicRules(buildStoreContext(raw)).some((signal) => signal.ruleId === 'DEAD_STOCK')).toBe(true))
  it('emits churn risk', () => expect(runDeterministicRules(buildStoreContext(raw)).some((signal) => signal.ruleId === 'CHURN_RISK')).toBe(true))
  it('emits pricing uplift', () => expect(runDeterministicRules(buildStoreContext(raw)).some((signal) => signal.ruleId === 'PRICING_UPLIFT')).toBe(true))
  it('emits repeat purchase', () => expect(runDeterministicRules(buildStoreContext(raw)).some((signal) => signal.ruleId === 'REPEAT_PURCHASE')).toBe(true))
  it('emits cart abandonment recovery', () => expect(runDeterministicRules(buildStoreContext(raw)).some((signal) => signal.ruleId === 'CART_ABANDONMENT')).toBe(true))
  it('emits cross-sell', () => expect(runDeterministicRules(buildStoreContext(raw)).some((signal) => signal.ruleId === 'CROSS_SELL')).toBe(true))
  it('emits new customer welcome', () => expect(runDeterministicRules(buildStoreContext(raw)).some((signal) => signal.ruleId === 'NEW_CUSTOMER_WELCOME')).toBe(true))
  it('sorts signals by deterministic impact descending', () => {
    const signals = runDeterministicRules(buildStoreContext(raw))
    expect(signals.map((signal) => signal.impactValue)).toEqual([...signals].map((signal) => signal.impactValue).sort((left, right) => right - left))
  })
  it('uses explicit action risks', () => {
    const signals = runDeterministicRules(buildStoreContext(raw))
    expect(signals.find((signal) => signal.ruleId === 'CART_ABANDONMENT')?.actionRisk).toBe('APPROVAL_REQUIRED')
  })
})
