import { describe, expect, it } from 'vitest'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { ShopifyClient } from '@profitpilot/shopify'
import { storeId } from '@profitpilot/types'
import { PostgresSyncSink, ShopifyGraphqlSyncSource } from './index.js'

type GraphqlRequest = { query: string; variables: Readonly<Record<string, unknown>> }

/** Builds a GraphQL-backed source that answers every GraphQL POST with `payload` and records each request. */
function graphqlSource(payload: unknown): { source: ShopifyGraphqlSyncSource; requests: GraphqlRequest[] } {
  const requests: GraphqlRequest[] = []
  const client = new ShopifyClient('demo.myshopify.com', 'token', async (url, init) => {
    expect(url).toContain('/admin/api/2026-07/graphql.json')
    expect(init.headers).toMatchObject({ 'x-shopify-access-token': 'token' })
    const body = JSON.parse(String(init.body ?? '{}')) as GraphqlRequest
    requests.push(body)
    return new Response(JSON.stringify(payload), { status: 200 })
  })
  return { source: new ShopifyGraphqlSyncSource(async () => client, 2), requests }
}

/** Builds a source that routes REST calls by pathname (for inventory/collections/discounts). */
function restSource(routes: Readonly<Record<string, Record<string, unknown>>>, links: Readonly<Record<string, string>> = {}): ShopifyGraphqlSyncSource {
  const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => {
    const parsed = new URL(url)
    const key = Object.keys(routes).find((candidate) => parsed.pathname.endsWith(candidate) || parsed.pathname.includes(candidate))
    if (!key || !routes[key]) return new Response(JSON.stringify({ errors: 'Not Found' }), { status: 404 })
    const responseInit: ResponseInit = { status: 200 }
    if (links[key]) responseInit.headers = { link: links[key] }
    return new Response(JSON.stringify(routes[key]), responseInit)
  })
  return new ShopifyGraphqlSyncSource(async () => client, 2)
}

const productNode = {
  id: 'gid://shopify/Product/8429887141223',
  title: 'Commander Pilot Mug',
  handle: 'commander-pilot-mug',
  status: 'ACTIVE',
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-02T11:00:00Z',
  vendor: 'ProfitPilot',
  productType: 'Drinkware',
  descriptionHtml: '<p>Mission ready.</p>',
  tags: ['mug'],
  variants: { edges: [{ node: { id: 'gid://shopify/ProductVariant/45', title: 'Default Title', sku: 'MUG', price: '19.00', inventoryQuantity: 18, inventoryItem: { id: 'gid://shopify/InventoryItem/99', unitCost: { amount: '5.00' } } } }] },
  options: [{ id: 'gid://shopify/ProductOption/1', name: 'Title', values: ['Default Title'] }],
  images: { edges: [{ node: { id: 'gid://shopify/ProductImage/2', url: 'https://cdn.shopify.com/mug.png', altText: null } }] },
}

const orderNode = {
  id: 'gid://shopify/Order/1001',
  name: '#1001',
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-01T10:05:00Z',
  processedAt: '2026-08-01T10:05:00Z',
  cancelledAt: null,
  cancelReason: null,
  note: null,
  tags: [],
  email: 'customer@example.com',
  phone: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'FULFILLED',
  currencyCode: 'USD',
  presentmentCurrencyCode: 'USD',
  totalPriceSet: { shopMoney: { amount: '19.00', currencyCode: 'USD' } },
  currentTotalPriceSet: { shopMoney: { amount: '19.00', currencyCode: 'USD' } },
  subtotalPriceSet: { shopMoney: { amount: '18.00', currencyCode: 'USD' } },
  currentSubtotalPriceSet: { shopMoney: { amount: '18.00', currencyCode: 'USD' } },
  totalTaxSet: { shopMoney: { amount: '1.00', currencyCode: 'USD' } },
  currentTotalTaxSet: { shopMoney: { amount: '1.00', currencyCode: 'USD' } },
  totalDiscountsSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
  currentTotalDiscountsSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
  totalShippingPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
  currentTotalShippingPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
  customer: {
    id: 'gid://shopify/Customer/555',
    firstName: 'Ada',
    lastName: 'Lovelace',
    createdAt: '2026-01-01T00:00:00Z',
    defaultEmailAddress: { emailAddress: 'customer@example.com' },
    defaultPhoneNumber: { phoneNumber: null },
  },
  lineItems: { edges: [{ node: { id: 'gid://shopify/LineItem/7', title: 'Mug', variantTitle: 'Default Title', sku: 'MUG', quantity: 2, originalUnitPriceSet: { shopMoney: { amount: '9.50', currencyCode: 'USD' } }, totalDiscountSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } }, product: { id: 'gid://shopify/Product/8429887141223' }, variant: { id: 'gid://shopify/ProductVariant/45' } } }] },
  shippingAddress: { firstName: 'Ada', lastName: 'Lovelace', company: null, address1: '1 Main St', address2: null, city: 'London', province: null, zip: 'E1', country: 'United Kingdom', countryCodeV2: 'GB', phone: null },
  billingAddress: null,
  // 2026-07: transactions is a list, not a connection
  transactions: [{ id: 'gid://shopify/OrderTransaction/501', kind: 'SALE', status: 'SUCCESS', amountSet: { shopMoney: { amount: '19.00', currencyCode: 'USD' } }, createdAt: '2026-08-01T10:05:00Z', processedAt: '2026-08-01T10:05:00Z', gateway: 'shop_payments', parentTransaction: null }],
}

const customerNode = {
  id: 'gid://shopify/Customer/555',
  firstName: 'Ada',
  lastName: 'Lovelace',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  note: null,
  tags: ['vip'],
  numberOfOrders: '3',
  amountSpent: { amount: '150.00', currencyCode: 'USD' },
  lastOrder: { id: 'gid://shopify/Order/1001', name: '#1001' },
  defaultEmailAddress: { emailAddress: 'customer@example.com', marketingState: 'SUBSCRIBED' },
  defaultPhoneNumber: { phoneNumber: '+15551234567' },
  defaultAddress: { firstName: 'Ada', lastName: 'Lovelace', company: null, address1: '1 Main St', address2: null, city: 'London', province: null, zip: 'E1', country: 'United Kingdom', countryCodeV2: 'GB', phone: '+15551234567' },
  addressesV2: { edges: [{ node: { firstName: 'Ada', lastName: 'Lovelace', company: null, address1: '1 Main St', address2: null, city: 'London', province: null, zip: 'E1', country: 'United Kingdom', countryCodeV2: 'GB', phone: '+15551234567' } }] },
}

describe('Shopify GraphQL sync source', () => {
  it('fetches products through GraphQL and maps to the legacy REST shape with a cursor', async () => {
    const { source } = graphqlSource({ data: { products: { edges: [{ node: productNode }], pageInfo: { hasNextPage: true, endCursor: 'next-cursor' } } } })
    const result = await source.fetchPage(storeId('s'), 'products', null)
    expect(result.records[0]).toMatchObject({ id: '8429887141223', title: 'Commander Pilot Mug', status: 'active', variants: [{ id: '45', price: '19.00', inventory_quantity: 18, inventory_item: { cost: '5.00' } }] })
    expect(result.records[0]?.admin_graphql_api_id).toBe('gid://shopify/Product/8429887141223')
    expect(result.nextCursor).toBe('next-cursor')
  })

  it('persists a mapped product shape once and exposes catalog payload.title directly', async () => {
    const { source } = graphqlSource({ data: { products: { edges: [{ node: productNode }], pageInfo: { hasNextPage: false, endCursor: null } } } })
    const page = await source.fetchPage(storeId('store-1'), 'products', null)
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

  it('passes a resume cursor as the GraphQL after variable', async () => {
    const { source, requests } = graphqlSource({ data: { products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } })
    await source.fetchPage(storeId('s'), 'products', 'resume-cursor')
    expect(requests[0]?.variables.after).toBe('resume-cursor')
    expect(requests[0]?.variables.first).toBe(2)
  })

  it('maps an order with nested transactions and no per-order N+1 request', async () => {
    const { source, requests } = graphqlSource({ data: { orders: { edges: [{ node: orderNode }], pageInfo: { hasNextPage: false, endCursor: null } } } })
    const result = await source.fetchPage(storeId('s'), 'orders', null)
    expect(requests).toHaveLength(1)
    const order = result.records[0]
    expect(order).toMatchObject({
      id: '1001',
      order_number: '1001',
      name: '#1001',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      currency: 'USD',
      total_price: '19.00',
      customer: { id: '555', created_at: '2026-01-01T00:00:00Z' },
      line_items: [{ product_id: '8429887141223', variant_id: '45', quantity: 2, price: '9.50' }],
      transactions: [{ id: '501', order_id: '1001', kind: 'sale', status: 'success', amount: '19.00' }],
    })
    expect(result.nextCursor).toBeNull()
  })

  it('maps a customer to the legacy REST shape', async () => {
    const { source } = graphqlSource({ data: { customers: { edges: [{ node: customerNode }], pageInfo: { hasNextPage: false, endCursor: null } } } })
    const result = await source.fetchPage(storeId('s'), 'customers', null)
    expect(result.records[0]).toMatchObject({
      id: '555',
      email: 'customer@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      orders_count: 3,
      total_spent: '150.00',
      last_order_id: '1001',
      last_order_name: '#1001',
      phone: '+15551234567',
      email_marketing_consent: { state: 'subscribed' },
      addresses: [{ country: 'United Kingdom' }],
    })
  })

  it('surfaces GraphQL errors as a dependency error naming the module', async () => {
    const { source } = graphqlSource({ data: { products: null }, errors: [{ message: 'Field products is not defined' }] })
    await expect(source.fetchPage(storeId('s'), 'products', null)).rejects.toThrow('products')
  })

  it('rejects a product node without a stable id', async () => {
    const { source } = graphqlSource({ data: { products: { edges: [{ node: { title: 'No id' } }], pageInfo: { hasNextPage: false, endCursor: null } } } })
    await expect(source.fetchPage(storeId('s'), 'products', null)).rejects.toThrow('stable id')
  })

  it('loads inventory levels through locations first', async () => {
    const requested: string[] = []
    const client = new ShopifyClient('demo.myshopify.com', 'token', async (url) => {
      requested.push(url)
      if (url.includes('/locations.json')) return new Response(JSON.stringify({ locations: [{ id: 11, name: 'HQ' }] }), { status: 200 })
      if (url.includes('/inventory_levels.json')) return new Response(JSON.stringify({ inventory_levels: [{ inventory_item_id: 99, location_id: 11, available: 6, admin_graphql_api_id: 'gid://shopify/InventoryLevel/11?inventory_item_id=99' }] }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 404 })
    })
    const page = await new ShopifyGraphqlSyncSource(async () => client).fetchPage(storeId('s'), 'inventory', null)
    expect(requested.some((url) => url.includes('/locations.json'))).toBe(true)
    expect(requested.some((url) => url.includes('location_ids=11'))).toBe(true)
    expect(page.records[0]?.id).toBe('11:99')
  })

  it('pages custom collections then smart collections', async () => {
    const sourceClient = restSource({
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

  it('maps the remaining REST discount module', async () => {
    const result = await restSource({ '/price_rules.json': { price_rules: [{ id: 1 }] } }).fetchPage(storeId('s'), 'discounts', null)
    expect(result.records).toHaveLength(1)
  })

  it('rejects invalid page sizes', () => expect(() => new ShopifyGraphqlSyncSource(async () => new ShopifyClient('demo.myshopify.com', 'token'), 251)).toThrow('between'))

  it('uses only valid Admin GraphQL fields for 2026-07 orders/customers', async () => {
    const { source, requests } = graphqlSource({ data: { orders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } })
    await source.fetchPage(storeId('s'), 'orders', null)
    const orderQuery = requests[0]?.query ?? ''
    // Must use displayFulfillmentStatus, not legacy fulfillmentStatus
    expect(orderQuery).toContain('displayFulfillmentStatus')
    expect(orderQuery).not.toMatch(/\bfulfillmentStatus\b/)
    // transactions is a list, not a connection — must not have first: or edges inside transactions
    expect(orderQuery).not.toMatch(/transactions\s*\(\s*first/)
    expect(orderQuery).toMatch(/transactions\s*\{/)
    // Customer must use addressesV2 and defaultEmailAddress, not deprecated addresses/email/emailMarketingConsent
    const { source: customerSource, requests: customerRequests } = graphqlSource({ data: { customers: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } })
    await customerSource.fetchPage(storeId('s'), 'customers', null)
    const customerQuery = customerRequests[0]?.query ?? ''
    expect(customerQuery).toContain('addressesV2')
    expect(customerQuery).toContain('defaultEmailAddress')
    // Deprecated fields should not appear as top-level Customer fields
    // (allow them inside nested address selections where they are valid)
    expect(customerQuery).not.toMatch(/customers\(.*\)\s*\{\s*edges\s*\{\s*node\s*\{[^}]*\bemail\b/)
    expect(customerQuery).not.toMatch(/emailMarketingConsent/)
    // MailingAddress should use countryCodeV2, not deprecated countryCode alone
    expect(customerQuery).toContain('countryCodeV2')
  })

  it('logs full GraphQL error body on failure', async () => {
    const { source } = graphqlSource({ data: null, errors: [{ message: 'Field fulfillmentStatus is not defined', locations: [{ line: 1, column: 1 }], path: ['orders'] }] })
    await expect(source.fetchPage(storeId('s'), 'orders', null)).rejects.toThrow('fulfillmentStatus')
  })
})
