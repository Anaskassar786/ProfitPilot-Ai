import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { CustomerDataset } from './customers.js'
import type { InventoryDataset, InventoryItem } from './inventory.js'
import type { OrderView } from './orders.js'
import { AiCommandPageMetricsService, crossSellPairCount } from './ai-command-page-metrics.js'

const tenant = storeId('store-1')
const now = Date.parse('2026-08-19T16:00:00.000Z')

function order(id: string, createdAt: string, totalPrice: number, productIds: readonly string[], status: OrderView['status'] = 'completed'): OrderView {
  return {
    id,
    adminGraphqlApiId: null,
    orderNumber: `#${id}`,
    name: `#${id}`,
    createdAt,
    updatedAt: createdAt,
    processedAt: createdAt,
    syncedAt: createdAt,
    customer: { id: `c-${id}`, name: null, email: null, phone: null },
    lineItems: productIds.map((productId, index) => ({ id: `${id}-${index}`, productId, variantId: null, title: productId, variantTitle: null, sku: null, quantity: 1, price: totalPrice / productIds.length, totalDiscount: 0 })),
    totalPrice,
    subtotalPrice: totalPrice,
    totalTax: 0,
    shippingPrice: 0,
    totalDiscounts: 0,
    currency: 'USD',
    financialStatus: 'paid',
    paymentStatus: 'paid',
    fulfillmentStatus: status === 'completed' ? 'fulfilled' : null,
    status,
    cancelledAt: null,
    cancelReason: null,
    shippingAddress: null,
    billingAddress: null,
    tags: [],
    note: null,
  }
}

const orders: readonly OrderView[] = [
  order('1', '2026-08-19T09:00:00-04:00', 120, ['p1', 'p2'], 'pending'),
  order('2', '2026-08-19T10:00:00-04:00', 80, ['p1', 'p3']),
  order('3', '2026-08-18T10:00:00-04:00', 100, ['p1']),
]

const customers = {
  customers: [
    { id: 'c1', activity: 'inactive', lifetimeOrders: 3, totalSpent: 500 },
    { id: 'c2', activity: 'active', lifetimeOrders: 1, totalSpent: 100 },
    { id: 'c3', activity: 'inactive', lifetimeOrders: 2, totalSpent: 250 },
  ],
  coverage: { ordersSyncCompleted: true, knownComplete90Days: true, cutoffDate: '2026-05-01', lastCompletedSyncAt: '2026-08-19T12:00:00.000Z', explanation: 'Complete' },
} as unknown as CustomerDataset

function inventoryItem(productId: string, productStatus: string, status: InventoryItem['status'], quantity: number): InventoryItem {
  return {
    variantId: `v-${productId}`,
    productId,
    inventoryItemId: `i-${productId}`,
    title: productId,
    variantTitle: null,
    sku: null,
    category: null,
    vendor: null,
    productStatus,
    imageUrl: null,
    price: 10,
    currency: 'USD',
    quantity,
    quantitySource: 'variant_inventory_quantity',
    tracked: true,
    inventoryPolicy: null,
    status,
    value: quantity * 10,
    locations: [],
    updatedAt: null,
    syncedAt: '2026-08-19T12:00:00.000Z',
  }
}

const inventory = {
  items: [inventoryItem('p1', 'active', 'low', 5), inventoryItem('p2', 'active', 'in_stock', 20), inventoryItem('p3', 'draft', 'in_stock', 20)],
  locations: [],
  coverage: { inventorySyncCompleted: true, levelRowCount: 0, locationRowCount: 0, lastSyncedAt: '2026-08-19T12:00:00.000Z', catalogSynced: true, locationsTruncated: false, quantitySource: 'variant_inventory_quantity', explanation: 'Synced' },
  topProduct: null,
  currency: 'USD',
  sales: {
    rows: [{ productId: 'p2', day: '2026-08-19', unitsSold: 2, grossRevenue: 20 }],
    firstDay: '2026-06-01',
    lastDay: '2026-08-19',
    observedDays: 1,
    historyDays: 80,
    sufficient: true,
    missingDays: 0,
  },
} as InventoryDataset

const snapshot: StoreSnapshot = {
  storeId: tenant,
  currency: 'USD',
  timezone: 'America/New_York',
  asOf: '2026-08-19T16:00:00.000Z',
  dataFreshAt: '2026-08-19',
  products: [{ productId: 'p1', title: 'p1', inventoryUnits: 20, averageDailyUnits: 1, unitPrice: 10, unitCost: 5, unitsSold120d: 50, daysSinceLastSale: 1 }],
  customers: [{ customerKey: 'c1', lifetimeValue: 500, orderCount: 3, daysSinceLastOrder: 45, firstOrderDay: '2026-01-01' }],
  checkouts: [],
  orders: [{ orderKey: 'old', total: 50, day: '2026-06-01', productIds: ['p1'], customerKey: 'c1' }, { orderKey: 'new', total: 80, day: '2026-08-19', productIds: ['p1'], customerKey: 'c1' }],
  productPairs: [],
  last30dRevenue: 1_200,
  previous30dRevenue: 1_000,
  last30dOrders: 20,
  previous30dOrders: 10,
}

describe('AI Command page metrics', () => {
  it('assembles every value from normalized real-store repositories', async () => {
    const service = new AiCommandPageMetricsService({
      customers: { list: async () => customers },
      inventory: { list: async () => inventory },
      orders: { list: async () => orders },
      snapshot: async () => snapshot,
      planFor: async () => 'growth',
      storeContext: async () => ({ timezone: 'America/New_York', currency: 'USD' }),
      now: () => now,
    })
    const metrics = await service.get(tenant)
    expect(metrics.customers).toEqual({ total: 3, inactive30Days: 2, repeat: 2, potentialRecoverableRevenue: 750 })
    expect(metrics.products).toEqual({ active: 2, lowStock: 1, deadStock: 1, crossSellPairs: 2 })
    expect(metrics.orders).toEqual({ total: 3, pending: 1, todayCount: 2 })
    expect(metrics.revenue).toEqual({ today: 200, yesterday: 100, changePercent: 100, currency: 'USD' })
    expect(metrics.storeHealth.score).not.toBeNull()
    expect(metrics.subscription).toEqual({ currentPlan: 'growth', basicAgentCount: 5 })
    expect(metrics.availability).toEqual({ customers: true, products: true, orders: true, inventoryHistory: true, storeHealth: true })
  })

  it('returns nulls rather than fake zeroes when store sources are unavailable', async () => {
    const unavailable = async (): Promise<never> => { throw new Error('not synced') }
    const service = new AiCommandPageMetricsService({
      customers: { list: unavailable },
      inventory: { list: unavailable },
      orders: { list: unavailable },
      snapshot: unavailable,
      planFor: unavailable,
      storeContext: unavailable,
      now: () => now,
    })
    const metrics = await service.get(tenant)
    expect(metrics.customers.total).toBeNull()
    expect(metrics.products.active).toBeNull()
    expect(metrics.orders.total).toBeNull()
    expect(metrics.revenue.today).toBeNull()
    expect(metrics.storeHealth.score).toBeNull()
    expect(metrics.subscription.currentPlan).toBeNull()
    expect(Object.values(metrics.availability).every((available) => !available)).toBe(true)
  })

  it('deduplicates unordered cross-sell pairs and ignores canceled orders', () => {
    const duplicated = [orders[0]!, orders[0]!, order('canceled', '2026-08-19T11:00:00-04:00', 50, ['p2', 'p3'], 'canceled')]
    expect(crossSellPairCount(duplicated)).toBe(1)
  })
})
