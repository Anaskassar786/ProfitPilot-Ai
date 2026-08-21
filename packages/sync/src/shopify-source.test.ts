import { describe, expect, it } from 'vitest'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { ShopifyClient } from '@profitpilot/shopify'
import { storeId } from '@profitpilot/types'
import { PostgresSyncSink, ShopifyRestSyncSource } from './index.js'

function source(data: Record<string, unknown>, link?: string): ShopifyRestSyncSource {
  const client = new ShopifyClient('demo.myshopify.com', 'token', async (url, init) => {
    expect(url).toContain('/admin/api/2026-07/')
    expect(init.headers).toMatchObject({ 'x-shopify-access-token': 'token' })
    const responseInit: ResponseInit = { status: 200 }
    if (link) responseInit.headers = { link }
    return new Response(JSON.stringify(data), responseInit)
  })
  return new ShopifyRestSyncSource(async () => client, 2)
}

function routingSource(routes: Readonly<Record<string, Record<string, unknown>>>, links: Readonly<Record<string, string>> = {}): ShopifyRestSyncSource {
  const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => {
    const parsed = new URL(url)
    const key = Object.keys(routes).find((candidate) => parsed.pathname.endsWith(candidate) || parsed.pathname.includes(candidate))
    if (!key || !routes[key]) return new Response(JSON.stringify({ errors: 'Not Found' }), { status: 404 })
    const responseInit: ResponseInit = { status: 200 }
    if (links[key]) responseInit.headers = { link: links[key] }
    return new Response(JSON.stringify(routes[key]), responseInit)
  })
  return new ShopifyRestSyncSource(async () => client, 2)
}

describe('Shopify REST sync source', () => {
  it('fetches products and extracts a next cursor', async () => {
    const result = await source({ products: [{ id: 1, title: 'Product' }] }, '<https://demo.myshopify.com/admin/api/2026-07/products.json?page_info=next-token>; rel="next"').fetchPage(storeId('s'), 'products', null)
    expect(result.records).toEqual([{ id: '1', title: 'Product' }])
    expect(result.records[0]?.title).toBe('Product')
    expect(result.nextCursor).toBe('next-token')
  })
  it('persists a real Shopify product shape once and exposes catalog payload.title directly', async () => {
    const product = {
      id: 8_429_887_141_223,
      admin_graphql_api_id: 'gid://shopify/Product/8429887141223',
      title: 'Commander Pilot Mug',
      body_html: '<p>Mission ready.</p>',
      vendor: 'ProfitPilot',
      product_type: 'Drinkware',
      created_at: '2026-08-01T10:00:00+05:30',
      updated_at: '2026-08-02T11:00:00+05:30',
      status: 'active',
      variants: [{ id: 45_000_000_000_001, product_id: 8_429_887_141_223, title: 'Default Title', price: '19.00', inventory_quantity: 18 }],
      options: [{ id: 1, product_id: 8_429_887_141_223, name: 'Title', values: ['Default Title'] }],
      images: [{ id: 2, product_id: 8_429_887_141_223, src: 'https://cdn.shopify.com/mug.png' }],
    }
    const page = await source({ products: [product] }).fetchPage(storeId('store-1'), 'products', null)
    let insertedPayload: string | undefined
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(_text: string, values?: readonly unknown[]): Promise<DatabaseResult<Row>> {
        insertedPayload = values?.[3] as string | undefined
        return { rows: [], rowCount: 1 }
      },
    }
    const analytics = new InMemoryAnalyticsRepository()
    await new PostgresSyncSink(executor, analytics, () => 100).upsert(storeId('store-1'), 'products', page.records)
    const catalogProduct = (await analytics.readCatalog(storeId('store-1')))[0]
    expect(page.records[0]?.title).toBe('Commander Pilot Mug')
    expect(JSON.parse(insertedPayload ?? '{}')).toMatchObject({ id: '8429887141223', title: 'Commander Pilot Mug', status: 'active' })
    expect(catalogProduct?.payload.title).toBe('Commander Pilot Mug')
    expect(catalogProduct?.payload.payload).toBeUndefined()
  })
  it('uses a resume cursor in the request', async () => {
    let requested = ''
    const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => { requested = url; return new Response(JSON.stringify({ orders: [] }), { status: 200 }) })
    await new ShopifyRestSyncSource(async () => client, 50).fetchPage(storeId('s'), 'orders', 'resume')
    expect(requested).toContain('page_info=resume')
    expect(requested).toContain('limit=50')
  })
  it('loads inventory levels through locations first', async () => {
    const requested: string[] = []
    const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => {
      requested.push(url)
      if (url.includes('/locations.json')) return new Response(JSON.stringify({ locations: [{ id: 11, name: 'HQ' }] }), { status: 200 })
      if (url.includes('/inventory_levels.json')) return new Response(JSON.stringify({ inventory_levels: [{ inventory_item_id: 99, location_id: 11, available: 6, admin_graphql_api_id: 'gid://shopify/InventoryLevel/11?inventory_item_id=99' }] }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 404 })
    })
    const page = await new ShopifyRestSyncSource(async () => client).fetchPage(storeId('s'), 'inventory', null)
    expect(requested.some((url) => url.includes('/locations.json'))).toBe(true)
    expect(requested.some((url) => url.includes('location_ids=11'))).toBe(true)
    expect(page.records[0]?.id).toBe('11:99')
  })
  it('persists real location metadata alongside the levels so the workspace can name a location', async () => {
    const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => {
      if (url.includes('/locations.json')) return new Response(JSON.stringify({ locations: [{ id: 11, name: 'Morādābād Warehouse', city: 'Morādābād', province: 'Uttar Pradesh', country: 'IN', active: true }] }), { status: 200 })
      if (url.includes('/inventory_levels.json')) return new Response(JSON.stringify({ inventory_levels: [{ inventory_item_id: 99, location_id: 11, available: 6 }] }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 404 })
    })
    const page = await new ShopifyRestSyncSource(async () => client).fetchPage(storeId('s'), 'inventory', null)
    const location = page.records.find((record) => record.id === 'location:11')
    expect(location).toMatchObject({ record_kind: 'location', location_id: '11', name: 'Morādābād Warehouse', city: 'Morādābād', country: 'IN', active: true, levels_queried: true })
  })
  it('does not duplicate location metadata on resumed inventory pages', async () => {
    const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => {
      if (url.includes('/locations.json')) return new Response(JSON.stringify({ locations: [{ id: 11, name: 'HQ' }] }), { status: 200 })
      if (url.includes('/inventory_levels.json')) return new Response(JSON.stringify({ inventory_levels: [{ inventory_item_id: 100, location_id: 11, available: 2 }] }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 404 })
    })
    const page = await new ShopifyRestSyncSource(async () => client).fetchPage(storeId('s'), 'inventory', 'cursor-2')
    expect(page.records.some((record) => String(record.id).startsWith('location:'))).toBe(false)
    expect(page.records).toHaveLength(1)
  })
  it('marks locations beyond the Shopify location_ids cap as not queried instead of dropping them', async () => {
    const locations = Array.from({ length: 52 }, (_value, index) => ({ id: index + 1, name: `Store ${index + 1}` }))
    const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => {
      if (url.includes('/locations.json')) return new Response(JSON.stringify({ locations }), { status: 200 })
      if (url.includes('/inventory_levels.json')) return new Response(JSON.stringify({ inventory_levels: [] }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 404 })
    })
    const page = await new ShopifyRestSyncSource(async () => client).fetchPage(storeId('s'), 'inventory', null)
    const locationRecords = page.records.filter((record) => String(record.id).startsWith('location:'))
    expect(locationRecords).toHaveLength(52)
    expect(locationRecords.filter((record) => record.levels_queried === false)).toHaveLength(2)
  })
  it('returns an empty inventory page when the shop has no locations', async () => {
    const page = await routingSource({ '/locations.json': { locations: [] } }).fetchPage(storeId('s'), 'inventory', null)
    expect(page.records).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
  it('pages custom collections then smart collections', async () => {
    const sourceClient = routingSource({
      '/custom_collections.json': { custom_collections: [{ id: 1, title: 'Summer' }] },
      '/smart_collections.json': { smart_collections: [{ id: 2, title: 'Auto' }] },
    })
    const custom = await sourceClient.fetchPage(storeId('s'), 'collections', null)
    expect(custom.records[0]).toMatchObject({ id: '1', collection_kind: 'custom' })
    expect(custom.nextCursor).toBe('smart:')
    const smart = await sourceClient.fetchPage(storeId('s'), 'collections', 'smart:')
    expect(smart.records[0]).toMatchObject({ id: '2', collection_kind: 'smart' })
    expect(smart.nextCursor).toBeNull()
  })
  it('loads transactions from each order on the page', async () => {
    const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => {
      if (url.includes('/orders.json')) return new Response(JSON.stringify({ orders: [{ id: 77 }] }), { status: 200 })
      if (url.includes('/orders/77/transactions.json')) return new Response(JSON.stringify({ transactions: [{ id: 501, amount: '19.00', kind: 'sale' }] }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 404 })
    })
    const page = await new ShopifyRestSyncSource(async () => client).fetchPage(storeId('s'), 'transactions', null)
    expect(page.records[0]).toMatchObject({ id: '501', order_id: '77', kind: 'sale' })
  })
  it('maps remaining simple resource modules', async () => {
    for (const module of ['customers', 'checkouts', 'discounts'] as const) {
      const key = module === 'discounts' ? 'price_rules' : module
      const result = await source({ [key]: [{ id: 1 }] }).fetchPage(storeId('s'), module, null)
      expect(result.records).toHaveLength(1)
    }
  })
  it('rejects a missing resource array', async () => await expect(source({}).fetchPage(storeId('s'), 'products', null)).rejects.toThrow('products'))
  it('rejects a resource without a stable id', async () => await expect(source({ products: [{ title: 'No id' }] }).fetchPage(storeId('s'), 'products', null)).rejects.toThrow('stable id'))
  it('returns null for a previous-only Link header', async () => expect((await source({ products: [] }, '<https://demo.myshopify.com/products?page_info=old>; rel="previous"').fetchPage(storeId('s'), 'products', null)).nextCursor).toBeNull())
  it('rejects invalid page sizes', () => expect(() => new ShopifyRestSyncSource(async () => new ShopifyClient('demo.myshopify.com', 'token'), 251)).toThrow('between'))
})
