import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import { aggregateOrderFacts } from './index.js'

const store = storeId('store-1')
const facts = [
  { orderId: 'o1', day: '2024-06-01', grossRevenue: 100, discounts: 5, fulfilled: true, cancelled: false, lines: [{ productId: 'p1', units: 2, grossRevenue: 100 }], customerId: 'c1', customerCohortDay: '2024-06-01' },
  { orderId: 'o2', day: '2024-06-01', grossRevenue: 50, discounts: 0, fulfilled: false, cancelled: true, lines: [{ productId: 'p1', units: 1, grossRevenue: 30 }, { productId: 'p2', units: 1, grossRevenue: 20 }], customerId: 'c2', customerCohortDay: '2024-05-01' },
  { orderId: 'o3', day: '2024-06-02', grossRevenue: 80, discounts: 4, fulfilled: true, cancelled: false, lines: [{ productId: 'p1', units: 1, grossRevenue: 80 }], customerId: 'c1', customerCohortDay: '2024-06-01' },
] as const

describe('deterministic analytics aggregation', () => {
  it('aggregates revenue by day', () => {
    const result = aggregateOrderFacts(store, facts)
    expect(result.revenue).toEqual(expect.arrayContaining([{ storeId: store, day: '2024-06-01', grossRevenue: 150, discounts: 5, orderCount: 2 }]))
  })
  it('aggregates orders and average order value', () => expect(aggregateOrderFacts(store, facts).orders[0]?.averageOrderValue).toBe(75))
  it('counts fulfilled and cancelled orders separately', () => expect(aggregateOrderFacts(store, facts).orders[0]).toMatchObject({ fulfilledCount: 1, cancelledCount: 1 }))
  it('aggregates product units and revenue', () => {
    const products = aggregateOrderFacts(store, facts).productSales
    expect(products.find((row) => row.productId === 'p1' && row.day === '2024-06-01')).toMatchObject({ unitsSold: 3, grossRevenue: 130 })
  })
  it('aggregates customer cohort activity with distinct customer counts', () => {
    const cohorts = aggregateOrderFacts(store, facts).customerCohorts
    expect(cohorts.find((row) => row.cohortDay === '2024-06-01' && row.activityDay === '2024-06-02')).toMatchObject({ customerCount: 1, grossRevenue: 80 })
  })
  it('does not double-count replayed order ids', () => {
    const result = aggregateOrderFacts(store, [...facts, facts[0]!])
    expect(result.revenue.find((row) => row.day === '2024-06-01')?.orderCount).toBe(2)
  })
  it('returns empty typed tables for empty input', () => expect(aggregateOrderFacts(store, facts.slice(0, 0))).toEqual({ revenue: [], orders: [], productSales: [], customerCohorts: [] }))
  it('rejects invalid order ids and dates', () => expect(() => aggregateOrderFacts(store, [{ ...facts[0]!, orderId: '', day: 'bad' }])).toThrow('ISO day'))
  it('rejects negative revenue', () => expect(() => aggregateOrderFacts(store, [{ ...facts[0]!, grossRevenue: -1 }])).toThrow('non-negative'))
  it('rejects invalid line units', () => expect(() => aggregateOrderFacts(store, [{ ...facts[0]!, lines: [{ productId: 'p1', units: -1, grossRevenue: 1 }] }])).toThrow('line'))
})
