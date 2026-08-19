import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import type { AnalyticsSnapshot } from '@profitpilot/db'
import { ProductionCommandTools } from './ai-command-runtime.js'
import type { CustomerRepository } from './customers.js'

const tenant = storeId('store-1')

function customer(id: string, totalSpent: number, extras: Readonly<Record<string, unknown>> = {}) {
  return {
    id,
    displayName: id,
    email: `${id}@example.com`,
    totalSpent,
    currency: 'USD',
    lifetimeOrders: 2,
    lastOrderAt: '2026-08-18T12:00:00.000Z',
    activity: 'active',
    tags: [],
    primarySegment: null,
    canEmail: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...extras,
  }
}

function customerReader(rows: readonly ReturnType<typeof customer>[]): Pick<CustomerRepository, 'list'> {
  return {
    list: async () => ({
      customers: rows,
      coverage: { ordersSyncCompleted: true, knownComplete90Days: true, cutoffDate: null, lastCompletedSyncAt: null, explanation: 'complete' },
    }) as unknown as Awaited<ReturnType<CustomerRepository['list']>>,
  }
}

function analyticsReader(snapshot: AnalyticsSnapshot, catalog: readonly Readonly<{ productId: string; payload: Record<string, unknown> }>[]) {
  return { read: async () => snapshot, readCatalog: async () => catalog }
}

const emptyAnalytics: AnalyticsSnapshot = { revenue: [], orders: [], productSales: [], customerCohorts: [] }

describe('Production AI Command tools', () => {
  it('resolves semantic customer intents instead of treating the whole sentence as a literal search', async () => {
    const tools = new ProductionCommandTools({ customers: customerReader([
      customer('regular', 20),
      customer('vip-low', 100, { primarySegment: 'vip' }),
      customer('vip-high', 500, { primarySegment: 'vip' }),
      customer('inactive', 40, { activity: 'inactive', primarySegment: 'churn_risk' }),
    ]) })
    const best = await tools.run(tenant, { name: 'search_customers', params: { query: 'Who are my best customers?', limit: 20 } })
    expect(best.ok).toBe(true)
    if (!best.ok) return
    const bestData = best.data as { items: readonly { id: string }[] }
    expect(bestData.items.map((item) => item.id)).toEqual(['vip-high', 'vip-low'])

    const inactive = await tools.run(tenant, { name: 'search_customers', params: { query: 'Find at-risk customers', limit: 20 } })
    expect(inactive.ok).toBe(true)
    if (!inactive.ok) return
    expect((inactive.data as { items: readonly { id: string }[] }).items.map((item) => item.id)).toEqual(['inactive'])
  })

  it('ranks best-selling and underperforming products from live product-sales rows', async () => {
    const snapshot: AnalyticsSnapshot = {
      ...emptyAnalytics,
      productSales: [
        { storeId: tenant, day: new Date().toISOString().slice(0, 10), productId: 'p1', unitsSold: 2, grossRevenue: 20 },
        { storeId: tenant, day: new Date().toISOString().slice(0, 10), productId: 'p2', unitsSold: 8, grossRevenue: 160 },
      ],
    }
    const tools = new ProductionCommandTools({ analytics: analyticsReader(snapshot, [
      { productId: 'p1', payload: { title: 'Mug' } },
      { productId: 'p2', payload: { title: 'Jacket' } },
      { productId: 'p3', payload: { title: 'Hat' } },
    ]) })
    const best = await tools.run(tenant, { name: 'search_products', params: { query: 'Show my best-selling products', limit: 20 } })
    expect(best.ok).toBe(true)
    if (!best.ok) return
    expect((best.data as { items: readonly { id: string }[] }).items.map((item) => item.id)).toEqual(['p2', 'p1', 'p3'])

    const slow = await tools.run(tenant, { name: 'search_products', params: { query: 'Find underperforming products', limit: 20 } })
    expect(slow.ok).toBe(true)
    if (!slow.ok) return
    expect((slow.data as { items: readonly { id: string }[] }).items[0]?.id).toBe('p3')
  })

  it('uses non-overlapping exact day windows for analytics comparisons', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterdayDate = new Date(); yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1)
    const yesterday = yesterdayDate.toISOString().slice(0, 10)
    const snapshot: AnalyticsSnapshot = {
      ...emptyAnalytics,
      revenue: [
        { storeId: tenant, day: today, grossRevenue: 50, discounts: 0, orderCount: 1 },
        { storeId: tenant, day: yesterday, grossRevenue: 30, discounts: 0, orderCount: 1 },
      ],
      orders: [
        { storeId: tenant, day: today, orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 50 },
        { storeId: tenant, day: yesterday, orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 30 },
      ],
    }
    const tools = new ProductionCommandTools({ analytics: analyticsReader(snapshot, []) })
    const result = await tools.run(tenant, { name: 'get_analytics', params: { date_range: '1d' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({ revenue: 50, previousRevenue: 30, orders: 1, previousOrders: 1 })
  })
})
