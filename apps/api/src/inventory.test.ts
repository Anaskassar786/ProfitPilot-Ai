import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { Logger } from '@profitpilot/logger'
import { storeId } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { createApi } from './app.js'
import {
  buildInventoryDataset,
  classifyStock,
  filterInventory,
  inventoryHealth,
  inventoryStats,
  lockedInventoryFeatures,
  parseInventoryFilters,
  PostgresInventoryRepository,
  stockDistribution,
  topValueItems,
} from './inventory.js'
import type { InventoryDataset, InventoryItem, InventoryRepository } from './inventory.js'

const TENANT = storeId('store-inventory')
const SYNCED = new Date('2026-08-16T06:00:00Z')

type CatalogRowInput = Readonly<{ product_id: string; payload: unknown; synced_at: Date }>
type InventoryRowInput = Readonly<{ record_id: string; payload: unknown; synced_at: Date }>

function catalogRow(id: string, title: string, variants: readonly Readonly<Record<string, unknown>>[], extras: Readonly<Record<string, unknown>> = {}): CatalogRowInput {
  return { product_id: id, payload: { id, title, product_type: 'Apparel', vendor: 'Real Vendor', status: 'active', image: { src: `https://cdn.shopify.com/${id}.jpg` }, variants, ...extras }, synced_at: SYNCED }
}
function levelRow(inventoryItemId: string, locationId: string, available: number): InventoryRowInput {
  return { record_id: `${locationId}:${inventoryItemId}`, payload: { inventory_item_id: inventoryItemId, location_id: locationId, available, updated_at: '2026-08-15T09:00:00Z' }, synced_at: SYNCED }
}
function locationRow(id: string, name: string | null, levelsQueried = true): InventoryRowInput {
  return { record_id: `location:${id}`, payload: { id: `location:${id}`, location_id: id, record_kind: 'location', name, city: 'Morādābād', province: 'Uttar Pradesh', country: 'IN', active: true, levels_queried: levelsQueried }, synced_at: SYNCED }
}

function dataset(input: Partial<Parameters<typeof buildInventoryDataset>[0]> = {}): InventoryDataset {
  return buildInventoryDataset({
    catalog: input.catalog ?? [],
    inventory: input.inventory ?? [],
    checkpoint: input.checkpoint ?? { cursor: null, updated_at: SYNCED },
    topSales: input.topSales ?? null,
    currency: input.currency ?? 'INR',
    ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
  } as Parameters<typeof buildInventoryDataset>[0])
}

/** A realistic two-product, two-location store. */
function realStore(): InventoryDataset {
  return dataset({
    catalog: [
      catalogRow('7001', 'Blue Cotton Shirt', [
        { id: '9001', title: 'Small', sku: 'SHIRT-S', price: '499.00', inventory_item_id: '5001', inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 24 },
        { id: '9002', title: 'Medium', sku: 'SHIRT-M', price: '499.00', inventory_item_id: '5002', inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 3 },
      ]),
      catalogRow('7002', 'Green Canvas Hat', [
        { id: '9003', title: 'Default Title', sku: 'HAT', price: '299.00', inventory_item_id: '5003', inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 0 },
        { id: '9004', title: 'Bundle', sku: 'HAT-B', price: '899.00', inventory_item_id: '5004', inventory_management: null, inventory_policy: 'continue', inventory_quantity: 0 },
      ]),
    ],
    inventory: [
      locationRow('61', 'Morādābād Warehouse'),
      locationRow('62', 'Delhi Retail'),
      levelRow('5001', '61', 20),
      levelRow('5001', '62', 4),
      levelRow('5002', '61', 3),
      levelRow('5003', '61', 0),
    ],
  })
}

describe('inventory dataset assembly from real Shopify rows', () => {
  it('joins catalog variants to synced inventory levels and aggregates multi-location stock', () => {
    const result = realStore()
    expect(result.items).toHaveLength(4)
    const shirtSmall = result.items.find((item) => item.sku === 'SHIRT-S')
    expect(shirtSmall?.quantity).toBe(24)
    expect(shirtSmall?.quantitySource).toBe('inventory_levels')
    expect(shirtSmall?.locations.map((level) => level.available).sort((a, b) => a - b)).toEqual([4, 20])
    expect(shirtSmall?.value).toBe(499 * 24)
    expect(shirtSmall?.status).toBe('in_stock')
    expect(shirtSmall?.imageUrl).toBe('https://cdn.shopify.com/7001.jpg')
  })

  it('preserves real location names from the sync instead of raw Shopify ids', () => {
    const result = realStore()
    expect(result.locations.map((location) => location.name)).toEqual(['Delhi Retail', 'Morādābād Warehouse'])
    const shirtSmall = result.items.find((item) => item.sku === 'SHIRT-S')
    expect(shirtSmall?.locations.map((level) => level.locationName).sort()).toEqual(['Delhi Retail', 'Morādābād Warehouse'])
  })

  it('flags a truncated location list when Shopify capped the location_ids filter', () => {
    const result = dataset({ catalog: [catalogRow('7001', 'Shirt', [{ id: '9001', sku: 'S', price: '10', inventory_item_id: '5001', inventory_management: 'shopify', inventory_quantity: 1 }])], inventory: [locationRow('61', 'Queried', true), locationRow('99', 'Beyond the cap', false), levelRow('5001', '61', 1)] })
    expect(result.coverage.locationsTruncated).toBe(true)
    expect(result.coverage.explanation).toContain('first 50 Shopify locations')
  })

  it('handles a store with zero locations without inventing per-location stock', () => {
    const result = dataset({ catalog: [catalogRow('7001', 'Shirt', [{ id: '9001', sku: 'S', price: '10', inventory_item_id: '5001', inventory_management: 'shopify', inventory_quantity: 7 }])], inventory: [] })
    const item = result.items[0]
    expect(item?.quantity).toBe(7)
    expect(item?.quantitySource).toBe('variant_inventory_quantity')
    expect(item?.locations).toEqual([])
    expect(result.coverage.explanation).toContain('Shopify returned no inventory locations')
  })

  it('reports no fabricated quantity when Shopify returns neither levels nor a variant quantity', () => {
    const result = dataset({ catalog: [catalogRow('7001', 'Shirt', [{ id: '9001', sku: 'S', price: '10', inventory_item_id: '5001', inventory_management: 'shopify' }])] })
    expect(result.items[0]?.quantity).toBeNull()
    expect(result.items[0]?.status).toBe('untracked')
    expect(result.items[0]?.value).toBeNull()
  })

  it('returns an empty dataset with an honest explanation before any sync', () => {
    const result = dataset({ checkpoint: null })
    expect(result.items).toEqual([])
    expect(result.coverage.catalogSynced).toBe(false)
    expect(result.coverage.explanation).toContain('Sync your products')
  })
})

describe('stock level classification', () => {
  it.each([
    [24, true, 10, 'in_stock'],
    [10, true, 10, 'in_stock'],
    [9, true, 10, 'low'],
    [1, true, 10, 'low'],
    [0, true, 10, 'out'],
    [-2, true, 10, 'out'],
    [0, false, 10, 'untracked'],
    [50, false, 10, 'untracked'],
    [null, true, 10, 'untracked'],
    [4, true, 3, 'in_stock'],
  ] as const)('classifies quantity %s (tracked=%s, threshold=%s) as %s', (quantity, tracked, threshold, expected) => {
    expect(classifyStock(quantity, tracked, threshold)).toBe(expected)
  })

  it('never reports an untracked variant as out of stock', () => {
    const item = realStore().items.find((entry) => entry.sku === 'HAT-B')
    expect(item?.tracked).toBe(false)
    expect(item?.status).toBe('untracked')
  })
})

describe('inventory health calculation', () => {
  it('scores from real stock distribution and tracking coverage only', () => {
    const health = inventoryHealth(realStore().items, 10)
    // 3 tracked, 2 with stock => coverage 67; 1 above threshold => 33; 3 of 4 tracked => 75.
    expect(health.score).toBe(Math.round(67 * 0.5 + 33 * 0.3 + 75 * 0.2))
    expect(health.tone).toBe('warning')
    expect(health.components.map((component) => component.key)).toEqual(['stock_coverage', 'low_stock_ratio', 'tracking_coverage'])
  })

  it('never returns a perfect score for an empty catalog', () => {
    const health = inventoryHealth([], 10)
    expect(health.score).toBeNull()
    expect(health.grade).toBe('—')
    expect(health.label).toBe('No inventory data')
  })

  it('renormalizes weights when no variant is tracked so absent signals cannot inflate the score', () => {
    const items = dataset({ catalog: [catalogRow('7001', 'Shirt', [{ id: '9001', sku: 'S', price: '10', inventory_management: null, inventory_quantity: 4 }])] }).items
    const health = inventoryHealth(items, 10)
    expect(health.excluded).toContain('stock_coverage')
    expect(health.components).toHaveLength(1)
    expect(health.score).toBe(0)
  })

  it('grades a fully healthy tracked catalog as A+', () => {
    const items = dataset({ catalog: [catalogRow('7001', 'Shirt', [{ id: '9001', sku: 'S', price: '10', inventory_item_id: '5001', inventory_management: 'shopify', inventory_quantity: 90 }])], inventory: [locationRow('61', 'Main'), levelRow('5001', '61', 90)] }).items
    const health = inventoryHealth(items, 10)
    expect(health.score).toBe(100)
    expect(health.grade).toBe('A+')
    expect(health.tone).toBe('healthy')
  })
})

describe('inventory statistics, distribution, and value', () => {
  it('summarises real units, alerts, and retail value without estimating', () => {
    const items = realStore().items
    const stats = inventoryStats(items, 'INR', 10)
    expect(stats.totalSkus).toBe(4)
    expect(stats.trackedSkus).toBe(3)
    expect(stats.untrackedSkus).toBe(1)
    expect(stats.totalUnits).toBe(27)
    expect(stats.lowStockCount).toBe(1)
    expect(stats.outOfStockCount).toBe(1)
    expect(stats.totalValue).toBe(499 * 24 + 499 * 3)
    expect(stats.currency).toBe('INR')
  })

  it('reports a null value rather than zero when Shopify returned no prices', () => {
    const items = dataset({ catalog: [catalogRow('7001', 'Shirt', [{ id: '9001', sku: 'S', inventory_management: 'shopify', inventory_quantity: 5 }])] }).items
    expect(inventoryStats(items, null, 10).totalValue).toBeNull()
  })

  it('buckets every SKU exactly once in the distribution', () => {
    const distribution = stockDistribution(realStore().items)
    expect(distribution).toEqual({ healthy: 1, low: 1, out: 1, untracked: 1 })
  })

  it('ranks top-value items by real stock value', () => {
    const top = topValueItems(realStore().items)
    expect(top[0]?.value).toBe(499 * 24)
    expect(top).toHaveLength(2)
  })
})

describe('premium inventory gating', () => {
  it.each([
    ['trial' as PlanTier, 11],
    ['start' as PlanTier, 11],
    ['growth' as PlanTier, 4],
    ['commander' as PlanTier, 0],
  ])('locks the right feature count for %s', (plan, expected) => {
    expect(lockedInventoryFeatures(plan)).toHaveLength(expected)
  })

  it('returns locked metadata only — never a premium value', () => {
    const locked = lockedInventoryFeatures('start')
    for (const entry of locked) {
      expect(Object.keys(entry).sort()).toEqual(['feature', 'locked', 'name', 'required_plan'])
      expect(entry.locked).toBe(true)
    }
    expect(locked.find((entry) => entry.feature === 'dead_stock')?.required_plan).toBe('growth')
    expect(locked.find((entry) => entry.feature === 'auto_reorder')?.required_plan).toBe('commander')
  })
})

describe('inventory filtering, sorting, and paging', () => {
  const filters = parseInventoryFilters({})

  it('applies real defaults from an empty query', () => {
    expect(filters).toEqual({ query: '', status: '', category: '', vendor: '', locationId: '', sort: 'name', direction: 'asc', page: 1, limit: 20, lowStockThreshold: 10 })
  })

  it('bounds hostile paging and threshold input', () => {
    const parsed = parseInventoryFilters({ page: '-4', limit: '9999', lowStockThreshold: '0', sort: 'drop table', status: 'nope' })
    expect(parsed.page).toBe(1)
    expect(parsed.limit).toBe(100)
    expect(parsed.lowStockThreshold).toBe(1)
    expect(parsed.sort).toBe('name')
    expect(parsed.status).toBe('')
  })

  it('filters by status, searches SKUs, and reports honest tab counts', () => {
    const data = realStore()
    expect(filterInventory(data, { ...filters, status: 'low' }, 'trial').items.map((item) => item.sku)).toEqual(['SHIRT-M'])
    expect(filterInventory(data, { ...filters, query: 'shirt-m' }, 'trial').items).toHaveLength(1)
    expect(filterInventory(data, filters, 'trial').tabCounts).toEqual({ all: 4, in_stock: 1, low: 1, out: 1, untracked: 1 })
  })

  it('filters by location so multi-location stores can isolate one warehouse', () => {
    const result = filterInventory(realStore(), { ...filters, locationId: '62' }, 'trial')
    expect(result.items.map((item) => item.sku)).toEqual(['SHIRT-S'])
    expect(result.multiLocation).toBe(true)
  })

  it('sorts by stock descending and keeps totals independent of the current page', () => {
    const result = filterInventory(realStore(), { ...filters, sort: 'stock', direction: 'desc', limit: 1 }, 'trial')
    expect(result.items[0]?.sku).toBe('SHIRT-S')
    expect(result.pagination).toEqual({ page: 1, limit: 1, total: 4, pages: 4 })
    expect(result.stats.totalSkus).toBe(4)
  })

  it('states insufficient sales data instead of inventing a top seller', () => {
    const result = filterInventory(realStore(), filters, 'trial')
    expect(result.basicInsights.topSellingItem.status).toBe('insufficient_data')
    if (result.basicInsights.topSellingItem.status === 'insufficient_data') expect(result.basicInsights.topSellingItem.message).toContain('Awaiting more sales history')
  })

  it('surfaces the real top seller once order analytics exist', () => {
    const data = dataset({ catalog: [catalogRow('7001', 'Blue Cotton Shirt', [{ id: '9001', sku: 'S', price: '10', inventory_item_id: '5001', inventory_management: 'shopify', inventory_quantity: 5 }])], topSales: { product_id: '7001', units_sold: '12', gross_revenue: '5988.00' } as never })
    const insight = filterInventory(data, filters, 'growth').basicInsights.topSellingItem
    expect(insight.status).toBe('available')
    if (insight.status === 'available') { expect(insight.title).toBe('Blue Cotton Shirt'); expect(insight.unitsSold).toBe(12) }
  })
})

describe('tenant-safe inventory persistence reads', () => {
  it('scopes every query to the requested tenant and the inventory module', async () => {
    const calls: Array<Readonly<{ text: string; parameters: readonly unknown[] }>> = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string, parameters: readonly unknown[] = []) {
        calls.push({ text, parameters })
        if (text.includes('catalog_products')) return { rows: [{ product_id: '7001', payload: { id: '7001', title: 'Shirt', variants: [{ id: '9001', sku: 'S', price: '10', inventory_item_id: '5001', inventory_management: 'shopify', inventory_quantity: 4 }] }, synced_at: SYNCED } as unknown as Row], rowCount: 1 }
        if (text.includes("module = 'inventory'") && text.includes('sync_records')) return { rows: [levelRow('5001', '61', 4) as unknown as Row], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    }
    const repository = new PostgresInventoryRepository(executor)
    const result = await repository.list(TENANT)
    expect(result.items[0]?.quantity).toBe(4)
    expect(calls.length).toBeGreaterThanOrEqual(4)
    expect(calls.every((call) => call.parameters[0] === TENANT)).toBe(true)
    expect(calls.every((call) => call.text.includes('store_id = $1'))).toBe(true)
    expect(calls.some((call) => call.text.includes("module = 'inventory'"))).toBe(true)
  })
})

describe('inventory HTTP routes', () => {
  function repository(data: InventoryDataset): InventoryRepository {
    return { async list() { return data }, async get(_store: StoreId, variantId: string) { return data.items.find((item) => item.variantId === variantId) ?? null } }
  }

  async function withServer(plan: PlanTier, data: InventoryDataset, assertion: (base: string) => Promise<void>) {
    const app = createApi({ logger: new Logger(), readinessChecks: [], inventory: { repository: repository(data), plan: async () => plan } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No address')
    try { await assertion(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  }

  it('returns real inventory rows, locked metadata, and per-variant detail', async () => {
    await withServer('trial', realStore(), async (base) => {
      const list = await fetch(`${base}/inventory?storeId=${TENANT}`)
      expect(list.status).toBe(200)
      const body = await list.json()
      expect(body.data.pagination.total).toBe(4)
      expect(body.data.stats.totalUnits).toBe(27)
      expect(body.data.health.score).not.toBe(100)
      expect(body.data.lockedFeatures.map((entry: { feature: string }) => entry.feature)).toContain('dead_stock')

      const detail = await fetch(`${base}/inventory/9001?storeId=${TENANT}`)
      expect(detail.status).toBe(200)
      expect((await detail.json()).data.sku).toBe('SHIRT-S')

      const locations = await fetch(`${base}/inventory/locations?storeId=${TENANT}`)
      expect(locations.status).toBe(200)
      const locationBody = await locations.json()
      expect(locationBody.data.locations.map((entry: { name: string }) => entry.name)).toContain('Morādābād Warehouse')
      expect(locationBody.data.multiLocation).toBe(true)
    })
  })

  it('rejects a missing storeId and an unknown variant', async () => {
    await withServer('growth', realStore(), async (base) => {
      expect((await fetch(`${base}/inventory`)).status).toBe(400)
      expect((await fetch(`${base}/inventory/does-not-exist?storeId=${TENANT}`)).status).toBe(404)
    })
  })

  it('unlocks growth features for a growth plan without changing the real numbers', async () => {
    await withServer('growth', realStore(), async (base) => {
      const body = await (await fetch(`${base}/inventory?storeId=${TENANT}`)).json()
      const features = body.data.lockedFeatures.map((entry: { feature: string }) => entry.feature)
      expect(features).not.toContain('dead_stock')
      expect(features).toContain('auto_reorder')
      expect(body.data.stats.totalUnits).toBe(27)
    })
  })

  it('serves an honest empty payload for a store with nothing synced', async () => {
    await withServer('trial', dataset({ checkpoint: null }), async (base) => {
      const body = await (await fetch(`${base}/inventory?storeId=${TENANT}`)).json()
      expect(body.data.items).toEqual([])
      expect(body.data.stats.totalUnits).toBe(0)
      expect(body.data.stats.totalValue).toBeNull()
      expect(body.data.health.score).toBeNull()
      expect(body.data.coverage.explanation).toContain('Sync your products')
    })
  })
})

describe('inventory item shape', () => {
  it('exposes only fields sourced from Shopify', () => {
    const item = realStore().items[0] as InventoryItem
    expect(Object.keys(item).sort()).toEqual([
      'category', 'currency', 'imageUrl', 'inventoryItemId', 'inventoryPolicy', 'locations', 'price',
      'productId', 'productStatus', 'quantity', 'quantitySource', 'sku', 'status', 'syncedAt', 'title',
      'tracked', 'updatedAt', 'value', 'variantId', 'variantTitle', 'vendor',
    ])
  })

  it('drops the Shopify placeholder variant title', () => {
    expect(realStore().items.find((entry) => entry.sku === 'HAT')?.variantTitle).toBeNull()
  })
})
