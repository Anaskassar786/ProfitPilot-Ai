import { describe, expect, it } from 'vitest'
import type { AnalyticsSnapshot, CatalogProduct } from './model.js'
import { buildProductsViewModel, filterAndSortProducts, productImageUrl, productPriceView, productStockView } from './products-model.js'

const product = (id: string, payload: CatalogProduct['payload']): CatalogProduct => ({ storeId: 's', productId: id, payload: { id, ...payload }, syncedAt: 100 })
const analytics: AnalyticsSnapshot = {
  revenue: [],
  orders: [],
  productSales: [
    { storeId: 's', day: '2026-08-01', productId: 'p1', unitsSold: 10, grossRevenue: 500 },
    { storeId: 's', day: '2026-08-02', productId: 'p1', unitsSold: 5, grossRevenue: 250 },
    { storeId: 's', day: '2026-08-01', productId: 'p2', unitsSold: 4, grossRevenue: 80 },
  ],
  customerCohorts: [],
}

describe('products redesign model', () => {
  it('builds real product stats from catalog and product sales analytics', () => {
    const view = buildProductsViewModel([
      product('p1', { title: 'Alpha Mug', status: 'active', variants: [{ price: '50.00', inventory_quantity: 8 }], images: [{ src: 'https://cdn.shopify.com/alpha.png' }] }),
      product('p2', { title: 'Beta Hat', status: 'draft', variants: [{ price: '20.00', inventory_quantity: 2 }] }),
      product('p3', { title: 'Gamma Tee', status: 'archived', variants: [{ price: '15.00', inventory_quantity: 0 }] }),
    ], analytics)

    expect(view.stats.activeProducts).toBe(1)
    expect(view.stats.totalUnitsSold).toBe(19)
    expect(view.stats.totalRevenue).toBe(830)
    expect(view.stats.winningProduct?.title).toBe('Alpha Mug')
    expect(view.stats.averagePerformanceScore).not.toBeNull()
    expect(view.products[0]?.performance.label).toBe('Excellent')
  })

  it('does not invent performance when sales data is missing', () => {
    const view = buildProductsViewModel([product('p1', { title: 'Alpha Mug', status: 'active' })], { ...analytics, productSales: [] })
    expect(view.stats.hasSalesData).toBe(false)
    expect(view.stats.totalUnitsSold).toBeNull()
    expect(view.stats.winningProduct).toBeNull()
    expect(view.products[0]?.performance.label).toBe('Awaiting sales data')
    expect(view.products[0]?.performance.score).toBeNull()
  })

  it('uses only real product image URLs and otherwise returns no image', () => {
    expect(productImageUrl(product('p1', { title: 'Alpha', image: { src: 'https://cdn.shopify.com/main.png' } }))).toBe('https://cdn.shopify.com/main.png')
    expect(productImageUrl(product('p2', { title: 'Beta', images: [{ src: 'https://cdn.shopify.com/list.png' }] }))).toBe('https://cdn.shopify.com/list.png')
    expect(productImageUrl(product('p3', { title: 'No image' }))).toBeNull()
  })

  it('derives price labels and variant-level stock from variants', () => {
    const ranged = product('p1', { title: 'Variant Product', variants: [{ price: '10.00', inventory_quantity: 4 }, { price: '15.50', inventory_quantity: 6 }] })
    expect(productPriceView(ranged).label).toBe('$10.00 – $15.50')
    expect(productStockView(ranged)).toMatchObject({ label: '10', value: 10, note: '2 variants · Variant-level' })
    expect(productPriceView(product('p2', { title: 'Complex', variants: [{ price: '' }] }))).toMatchObject({ label: 'Custom' })
  })

  it('filters by search/status and sorts by real product metrics', () => {
    const view = buildProductsViewModel([
      product('p1', { title: 'Alpha Mug', status: 'active', variants: [{ price: '30.00', inventory_quantity: 3 }] }),
      product('p2', { title: 'Beta Hat', status: 'draft', variants: [{ price: '5.00', inventory_quantity: 20 }] }),
    ], analytics)
    expect(filterAndSortProducts(view.products, 'alpha', 'all', 'name').map((item) => item.title)).toEqual(['Alpha Mug'])
    expect(filterAndSortProducts(view.products, '', 'draft', 'stock').map((item) => item.title)).toEqual(['Beta Hat'])
    expect(filterAndSortProducts(view.products, '', 'all', 'sold').map((item) => item.title)).toEqual(['Alpha Mug', 'Beta Hat'])
  })
})
