import { describe, expect, it, vi } from 'vitest'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { SqlExecutor } from '@profitpilot/db'
import { EXPORT_ROW_CEILING, storeId } from '@profitpilot/types'
import { DataPlaneExportSource } from './exports-data.js'

/**
 * Data Exports — the real data plane behind every download.
 *
 * The route/service tests use stub sources; these tests pin the production
 * mapping: which synced rows become which merchant-facing columns, how custom
 * date ranges filter, and how the Activity Log falls back to sync records on
 * stores whose audit table is empty or not migrated yet.
 */

const tenant = storeId('store-exports-data')

function snapshot(repository: InMemoryAnalyticsRepository): void {
  void repository.upsert({
    revenue: [
      { storeId: tenant, day: '2026-08-16', grossRevenue: 500, discounts: 10, orderCount: 4 },
      { storeId: tenant, day: '2026-08-17', grossRevenue: 829.35, discounts: 12, orderCount: 9 },
      { storeId: tenant, day: '2026-08-18', grossRevenue: 1176, discounts: 0, orderCount: 15 },
    ],
    orders: [
      { storeId: tenant, day: '2026-08-16', orderCount: 4, fulfilledCount: 4, cancelledCount: 0, averageOrderValue: 125 },
      { storeId: tenant, day: '2026-08-17', orderCount: 9, fulfilledCount: 9, cancelledCount: 0, averageOrderValue: 92.15 },
      { storeId: tenant, day: '2026-08-18', orderCount: 15, fulfilledCount: 12, cancelledCount: 2, averageOrderValue: 78.4 },
    ],
    productSales: [],
    customerCohorts: [],
  })
}

function catalog(repository: InMemoryAnalyticsRepository): void {
  repository.upsertCatalog([
    { storeId: tenant, productId: 'gid://shopify/Product/1', payload: { title: 'Everyday Hoodie' }, syncedAt: Date.parse('2026-08-18T10:00:00Z') },
    { storeId: tenant, productId: 'gid://shopify/Product/2', payload: {}, syncedAt: Date.parse('2026-08-18T10:00:00Z') },
  ])
}

const missingTable = { code: '42P01', message: 'relation "audit_log" does not exist' }

function executor(behaviour: { auditRows?: readonly Record<string, unknown>[]; auditFails?: unknown; syncRows?: readonly Record<string, unknown>[] }): SqlExecutor {
  const query = vi.fn(async (text: string) => {
    if (text.includes('FROM audit_log')) {
      if (behaviour.auditFails) throw behaviour.auditFails
      const rows = behaviour.auditRows ?? []
      if (text.includes('COUNT')) return { rows: [{ total: rows.length }], rowCount: 1 }
      return { rows, rowCount: rows.length }
    }
    if (text.includes('FROM sync_records')) {
      const rows = behaviour.syncRows ?? []
      if (text.includes('COUNT')) return { rows: [{ total: rows.length }], rowCount: 1 }
      return { rows, rowCount: rows.length }
    }
    throw new Error(`unexpected query: ${text}`)
  })
  return { query } as unknown as SqlExecutor
}

describe('Data plane export source — orders and revenue', () => {
  it('maps synced order days into merchant-facing columns', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    snapshot(analytics)
    const source = new DataPlaneExportSource({ analytics, database: executor({}) })
    const rows = await source.rows(tenant, 'orders', { from: null, to: null })
    expect(rows).toEqual([
      { 'Order date': '2026-08-16', 'Orders placed': 4, 'Orders fulfilled': 4, 'Orders cancelled': 0, 'Average order value': 125 },
      { 'Order date': '2026-08-17', 'Orders placed': 9, 'Orders fulfilled': 9, 'Orders cancelled': 0, 'Average order value': 92.15 },
      { 'Order date': '2026-08-18', 'Orders placed': 15, 'Orders fulfilled': 12, 'Orders cancelled': 2, 'Average order value': 78.4 },
    ])
  })

  it('applies a custom date range to order and revenue rows', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    snapshot(analytics)
    const source = new DataPlaneExportSource({ analytics, database: executor({}) })
    const rangedOrders = await source.rows(tenant, 'orders', { from: '2026-08-17', to: '2026-08-17' })
    expect(rangedOrders.map((row) => row['Order date'])).toEqual(['2026-08-17'])
    const rangedRevenue = await source.rows(tenant, 'revenue', { from: '2026-08-18', to: null })
    expect(rangedRevenue.map((row) => row.Day)).toEqual(['2026-08-18'])
    const openEnded = await source.rows(tenant, 'revenue', { from: null, to: '2026-08-16' })
    expect(openEnded.map((row) => row.Day)).toEqual(['2026-08-16'])
  })

  it('returns zero rows for an unsynced store instead of inventing data', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    const source = new DataPlaneExportSource({ analytics, database: executor({}) })
    expect(await source.rows(tenant, 'orders', { from: null, to: null })).toEqual([])
    expect(await source.rows(tenant, 'revenue', { from: null, to: null })).toEqual([])
  })
})

describe('Data plane export source — catalog', () => {
  it('falls back to the product id when a title is missing or blank', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    catalog(analytics)
    const source = new DataPlaneExportSource({ analytics, database: executor({}) })
    const rows = await source.rows(tenant, 'catalog', { from: null, to: null })
    expect(rows).toEqual([
      { 'Product ID': 'gid://shopify/Product/1', 'Product title': 'Everyday Hoodie', 'Last synced': '2026-08-18' },
      { 'Product ID': 'gid://shopify/Product/2', 'Product title': 'gid://shopify/Product/2', 'Last synced': '2026-08-18' },
    ])
  })

  it('never exceeds the row ceiling', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    const big = Array.from({ length: EXPORT_ROW_CEILING + 25 }, (_, index) => ({ storeId: tenant, productId: `p-${index}`, payload: { title: `Product ${index}` }, syncedAt: Date.parse('2026-08-18T10:00:00Z') }))
    analytics.upsertCatalog(big)
    const source = new DataPlaneExportSource({ analytics, database: executor({}) })
    expect((await source.rows(tenant, 'catalog', { from: null, to: null })).length).toBe(EXPORT_ROW_CEILING)
    const estimates = await source.estimates(tenant)
    expect(estimates.catalog).toBe(EXPORT_ROW_CEILING)
  })
})

describe('Data plane export source — activity log', () => {
  it('reads real audit actions first', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    const database = executor({ auditRows: [{ action: 'orders synced', created_at: new Date('2026-08-18T09:15:00Z'), idempotency_key: 'sync-1' }] })
    const source = new DataPlaneExportSource({ analytics, database })
    expect(await source.rows(tenant, 'audit', { from: null, to: null })).toEqual([
      { Action: 'orders synced', When: '2026-08-18T09:15:00.000Z', Reference: 'sync-1' },
    ])
  })

  it('falls back to sync records when the audit table is not migrated yet', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    const database = executor({ auditFails: missingTable, syncRows: [{ module: 'orders', record_id: 'rec-1', synced_at: new Date('2026-08-18T08:00:00Z') }] })
    const source = new DataPlaneExportSource({ analytics, database })
    expect(await source.rows(tenant, 'audit', { from: null, to: null })).toEqual([
      { Action: 'orders synced', When: '2026-08-18T08:00:00.000Z', Reference: 'rec-1' },
    ])
    const estimates = await source.estimates(tenant)
    expect(estimates.audit).toBe(1)
  })

  it('falls back to sync records when the audit table is simply empty', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    const database = executor({ auditRows: [], syncRows: [{ module: 'products', record_id: 'rec-9', synced_at: new Date('2026-08-18T08:00:00Z') }] })
    const source = new DataPlaneExportSource({ analytics, database })
    expect(await source.rows(tenant, 'audit', { from: null, to: null })).toEqual([
      { Action: 'products synced', When: '2026-08-18T08:00:00.000Z', Reference: 'rec-9' },
    ])
  })
})

describe('Data plane export source — estimates survive partial failures', () => {
  it('keeps real counts for datasets that read fine when another fails', async () => {
    const analytics = new InMemoryAnalyticsRepository()
    snapshot(analytics)
    const database = executor({ auditFails: missingTable, syncRows: [] })
    const source = new DataPlaneExportSource({ analytics, database })
    const estimates = await source.estimates(tenant)
    expect(estimates.orders).toBe(3)
    expect(estimates.revenue).toBe(3)
    expect(estimates.audit).toBe(0)
    expect(estimates.catalog).toBe(0)
  })
})
