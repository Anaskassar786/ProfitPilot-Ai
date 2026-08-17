import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import type { QueryResultRow } from '@profitpilot/db'
import type { CatalogProduct, DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { aggregateProductSales, buildProductPairs, buildStoreSnapshot, storeCurrency } from './store-snapshot.js'

const now = Date.parse('2026-08-15T00:00:00.000Z')

describe('PR46 product velocity from analytics_product_sales_daily', () => {
  it('derives average daily units, 120d units, and last-sale recency', () => {
    const rows = [
      { day: '2026-08-10', productId: 'p1', unitsSold: 30 },
      { day: '2026-08-01', productId: 'p1', unitsSold: 30 },
      { day: '2026-05-01', productId: 'p1', unitsSold: 10 },
      { day: '2026-08-12', productId: 'p2', unitsSold: 0 },
    ]
    const facts = aggregateProductSales(rows, '2026-07-16', '2026-04-17', now)
    const p1 = facts.get('p1')
    expect(p1?.averageDailyUnits).toBe(2) // 60 units in last 30 days
    expect(p1?.unitsSold120d).toBe(70)
    expect(p1?.daysSinceLastSale).toBe(5)
    // Zero-unit rows never count as sales.
    expect(facts.get('p2')?.daysSinceLastSale).toBeNull()
  })
})

describe('PR46 store currency from real orders', () => {
  it('uses the most recent synced order currency', () => {
    expect(storeCurrency([
      { day: '2026-08-01', currency: 'EUR' },
      { day: '2026-08-10', currency: 'INR' },
    ])).toBe('INR')
  })
  it('falls back to USD only when no order carries a currency', () => {
    expect(storeCurrency([])).toBe('USD')
    expect(storeCurrency([{ day: '2026-08-10', currency: null }])).toBe('USD')
  })
})

describe('PR46 product pairs from order line items', () => {
  const catalog: CatalogProduct[] = [
    { storeId: storeId('s'), productId: 'p1', payload: { variants: [{ price: '20' }] }, syncedAt: 1 },
    { storeId: storeId('s'), productId: 'p2', payload: { variants: [{ price: '35' }] }, syncedAt: 1 },
  ]
  it('computes co-purchase rate against the anchor product order count', () => {
    const orders = [
      { orderKey: 'o1', total: 55, day: '2026-08-01', productIds: ['p1', 'p2'], customerKey: null, currency: 'USD' },
      { orderKey: 'o2', total: 20, day: '2026-08-02', productIds: ['p1'], customerKey: null, currency: 'USD' },
      { orderKey: 'o3', total: 55, day: '2026-08-03', productIds: ['p1', 'p2'], customerKey: null, currency: 'USD' },
    ]
    const pairs = buildProductPairs(orders, catalog)
    const pair = pairs.find((entry) => entry.productId === 'p1' && entry.relatedProductId === 'p2')
    expect(pair?.coPurchaseRate).toBeCloseTo(2 / 3)
    expect(pair?.relatedProductPrice).toBe(35)
  })
  it('requires at least two anchor orders so a single basket is never a trend', () => {
    const pairs = buildProductPairs([{ orderKey: 'o1', total: 55, day: '2026-08-01', productIds: ['p1', 'p2'], customerKey: null, currency: 'USD' }], catalog)
    expect(pairs).toHaveLength(0)
  })
})

describe('PR46 full snapshot build', () => {
  it('reads currency, velocity, cost, and pairs from real synced modules', async () => {
    const orderPayload = { id: 900, created_at: '2026-08-10T00:00:00.000Z', total_price: '120.00', currency: 'EUR', customer: { id: 7 }, line_items: [{ product_id: 'p1' }, { product_id: 'p2' }] }
    const orderPayload2 = { id: 901, created_at: '2026-08-11T00:00:00.000Z', total_price: '60.00', currency: 'EUR', customer: { id: 8 }, line_items: [{ product_id: 'p1' }] }
    const database: SqlExecutor = {
      async query<Row extends QueryResultRow>(_text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
        const module = values[1]
        if (module === 'orders') return { rows: [{ payload: orderPayload }, { payload: orderPayload2 }] as unknown as Row[], rowCount: 2 }
        if (module === 'customers') return { rows: [{ payload: { id: 7, total_spent: '300', orders_count: 3, last_order_at: '2026-05-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z' } }] as unknown as Row[], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    }
    const analytics = {
      read: async () => ({
        revenue: [{ storeId: storeId('s'), day: '2026-08-10', grossRevenue: 120, discounts: 0, orderCount: 1 }],
        orders: [{ storeId: storeId('s'), day: '2026-08-10', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 120 }],
        productSales: [{ storeId: storeId('s'), day: '2026-08-10', productId: 'p1', unitsSold: 60, grossRevenue: 120 }],
        customerCohorts: [],
      }),
      readCatalog: async (): Promise<readonly CatalogProduct[]> => [
        { storeId: storeId('s'), productId: 'p1', payload: { title: 'Hoodie', variants: [{ price: '20', inventory_quantity: 10, inventory_item: { cost: '8' } }] }, syncedAt: 1 },
        { storeId: storeId('s'), productId: 'p2', payload: { title: 'Cap', variants: [{ price: '35', inventory_quantity: 4 }] }, syncedAt: 1 },
      ],
    }
    const snapshot = await buildStoreSnapshot(storeId('s'), analytics, database, now)
    expect(snapshot.currency).toBe('EUR')
    const hoodie = snapshot.products.find((product) => product.productId === 'p1')
    expect(hoodie?.averageDailyUnits).toBe(2)
    expect(hoodie?.unitCost).toBe(8)
    expect(hoodie?.unitsSold120d).toBe(60)
    const cap = snapshot.products.find((product) => product.productId === 'p2')
    expect(cap?.unitCost).toBeNull()
    expect(snapshot.orders).toHaveLength(2)
    // p1 appears in 2 orders, together with p2 in 1 → 0.5 co-purchase rate.
    expect(snapshot.productPairs.find((pair) => pair.productId === 'p1')?.coPurchaseRate).toBe(.5)
    expect(snapshot.customers[0]?.customerKey).toBe('7')
  })
})
