import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import type { ProductSalesMetric } from '@profitpilot/db'
import { buildProductPairs, buildStoreSnapshot, velocityByProduct } from './store-snapshot.js'

const NOW = Date.parse('2026-08-17T00:00:00Z')
const tenant = storeId('s')

function salesRow(day: string, productId: string, unitsSold: number): ProductSalesMetric {
  return { storeId: tenant, day, productId, unitsSold, grossRevenue: unitsSold * 10 }
}
function daysAgo(days: number): string { return new Date(NOW - days * 86_400_000).toISOString().slice(0, 10) }

describe('PR45 velocity derivation (rule starvation fix)', () => {
  it('derives average daily units from the last 30 days of product sales', () => {
    const velocity = velocityByProduct([salesRow(daysAgo(2), 'p1', 30), salesRow(daysAgo(10), 'p1', 30)], NOW)
    expect(velocity.get('p1')?.averageDailyUnits).toBe(2)
  })
  it('excludes sales older than the velocity window from daily velocity but counts them in 120d', () => {
    const velocity = velocityByProduct([salesRow(daysAgo(50), 'p1', 60)], NOW)
    expect(velocity.get('p1')?.averageDailyUnits).toBe(0)
    expect(velocity.get('p1')?.unitsSold120d).toBe(60)
  })
  it('computes days since the last observed sale', () => {
    const velocity = velocityByProduct([salesRow(daysAgo(9), 'p1', 1)], NOW)
    expect(velocity.get('p1')?.daysSinceLastSale).toBe(9)
  })
  it('ignores zero-unit rows when finding the last sale', () => {
    const velocity = velocityByProduct([salesRow(daysAgo(3), 'p1', 0), salesRow(daysAgo(20), 'p1', 5)], NOW)
    expect(velocity.get('p1')?.daysSinceLastSale).toBe(20)
  })
})

describe('PR45 product pairs (CROSS_SELL fix)', () => {
  const products = [
    { productId: 'a', title: 'A', inventoryUnits: 1, averageDailyUnits: 1, unitPrice: 10, unitCost: null, unitsSold120d: 5, daysSinceLastSale: 1 },
    { productId: 'b', title: 'B', inventoryUnits: 1, averageDailyUnits: 1, unitPrice: 25, unitCost: null, unitsSold120d: 5, daysSinceLastSale: 1 },
  ]
  it('computes co-purchase rates from order line co-occurrence', () => {
    const orders = [
      { productIds: ['a', 'b'] },
      { productIds: ['a'] },
      { productIds: ['a', 'b'] },
      { productIds: ['a'] },
    ]
    const pairs = buildProductPairs(orders, products)
    const pair = pairs.find((item) => item.productId === 'a' && item.relatedProductId === 'b')
    expect(pair?.coPurchaseRate).toBe(.5)
    expect(pair?.relatedProductPrice).toBe(25)
  })
  it('returns no pairs for single-product orders', () => {
    expect(buildProductPairs([{ productIds: ['a'] }, { productIds: ['b'] }], products)).toHaveLength(0)
  })
})

describe('PR45 snapshot integration', () => {
  it('feeds derived velocity, unit cost, and pairs into the snapshot', async () => {
    const analytics = {
      read: async () => ({
        revenue: [{ storeId: tenant, day: daysAgo(3), grossRevenue: 500, discounts: 0, orderCount: 5 }],
        orders: [{ storeId: tenant, day: daysAgo(3), orderCount: 5, fulfilledCount: 5, cancelledCount: 0, averageOrderValue: 100 }],
        productSales: [salesRow(daysAgo(2), 'p1', 60)],
        customerCohorts: [],
      }),
      readCatalog: async () => [
        { storeId: tenant, productId: 'p1', syncedAt: NOW, payload: { title: 'Widget', variants: [{ inventory_quantity: 5, price: '20', cost: '8' }] } },
      ],
    }
    const database = {
      query: async (text: string, values?: readonly unknown[]) => {
        if (values?.[1] === 'orders') return { rows: [{ payload: { line_items: [{ product_id: 'p1' }, { product_id: 'p2' }] } }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    }
    const snapshot = await buildStoreSnapshot(tenant, analytics, database as never, NOW)
    const product = snapshot.products[0]
    expect(product?.averageDailyUnits).toBe(2)
    expect(product?.unitsSold120d).toBe(60)
    expect(product?.daysSinceLastSale).toBe(2)
    expect(product?.unitCost).toBe(8)
    expect(snapshot.productPairs.length).toBeGreaterThan(0)
  })
})
