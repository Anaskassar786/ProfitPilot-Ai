import { describe, expect, it } from 'vitest'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { ShopifyClient } from '@profitpilot/shopify'
import { storeId } from '@profitpilot/types'
import { PostgresSyncSink, ShopifyRestSyncSource } from './index.js'

function source(data: Record<string, unknown>, link?: string): ShopifyRestSyncSource {
  const client = new ShopifyClient('demo.myshopify.com', 'token', async (url, init) => {
    expect(url).toContain('/admin/api/2025-10/')
    expect(init.headers).toMatchObject({ 'x-shopify-access-token': 'token' })
    const responseInit: ResponseInit = { status: 200 }
    if (link) responseInit.headers = { link }
    return new Response(JSON.stringify(data), responseInit)
  })
  return new ShopifyRestSyncSource(async () => client, 2)
}

describe('Shopify REST sync source', () => {
  it('fetches products and extracts a next cursor', async () => {
    const result = await source({ products: [{ id: 1, title: 'Product' }] }, '<https://demo.myshopify.com/admin/api/2025-10/products.json?page_info=next-token>; rel="next"').fetchPage(storeId('s'), 'products', null)
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
  it('maps the inventory endpoint key', async () => expect((await source({ inventory_levels: [{ id: 1 }] }).fetchPage(storeId('s'), 'inventory', null)).records[0]?.id).toBe('1'))
  it('maps all supported resource modules', async () => {
    for (const module of ['customers', 'checkouts', 'collections', 'discounts', 'transactions'] as const) {
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
