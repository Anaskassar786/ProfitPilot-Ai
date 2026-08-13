import { describe, expect, it } from 'vitest'
import { ShopifyClient } from '@profitpilot/shopify'
import { storeId } from '@profitpilot/types'
import { ShopifyRestSyncSource } from './index.js'

function source(data: Record<string, unknown>, link?: string): ShopifyRestSyncSource {
  const client = new ShopifyClient('demo.myshopify.com', 'token', async (url, init) => {
    expect(url).toContain('/admin/api/2024-04/')
    expect(init.headers).toMatchObject({ 'x-shopify-access-token': 'token' })
    const responseInit: ResponseInit = { status: 200 }
    if (link) responseInit.headers = { link }
    return new Response(JSON.stringify(data), responseInit)
  })
  return new ShopifyRestSyncSource(async () => client, 2)
}

describe('Shopify REST sync source', () => {
  it('fetches products and extracts a next cursor', async () => {
    const result = await source({ products: [{ id: 1, title: 'Product' }] }, '<https://demo.myshopify.com/admin/api/2024-04/products.json?page_info=next-token>; rel="next"').fetchPage(storeId('s'), 'products', null)
    expect(result.records).toEqual([{ id: 1, payload: JSON.stringify({ id: 1, title: 'Product' }) }])
    expect(result.nextCursor).toBe('next-token')
  })
  it('uses a resume cursor in the request', async () => {
    let requested = ''
    const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => { requested = url; return new Response(JSON.stringify({ orders: [] }), { status: 200 }) })
    await new ShopifyRestSyncSource(async () => client, 50).fetchPage(storeId('s'), 'orders', 'resume')
    expect(requested).toContain('page_info=resume')
    expect(requested).toContain('limit=50')
  })
  it('maps the inventory endpoint key', async () => expect((await source({ inventory_levels: [{ id: 1 }] }).fetchPage(storeId('s'), 'inventory', null)).records[0]?.id).toBe(1))
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
