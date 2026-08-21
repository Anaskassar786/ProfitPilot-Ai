import { describe, expect, it } from 'vitest'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { ShopifyApiError, ShopifyClient } from '@profitpilot/shopify'
import { AppError, storeId } from '@profitpilot/types'
import { GRAPHQL_CURSOR_PREFIX, ORDER_TRANSACTIONS_LIMIT, PostgresSyncSink, ShopifyGraphQLSyncSource } from './index.js'

type OperationCall = Readonly<{ operation: string; variables: Readonly<Record<string, unknown>> }>

/**
 * Routes POST /graphql.json calls to a handler keyed by GraphQL operation name,
 * so tests assert which query ran and with which variables.
 */
function graphqlSource(operations: Readonly<Record<string, (variables: Readonly<Record<string, unknown>>) => unknown>>): Readonly<{ source: ShopifyGraphQLSyncSource; calls: OperationCall[] }> {
  const calls: OperationCall[] = []
  const client = new ShopifyClient('demo.myshopify.com', 'token', async (url, init) => {
    expect(url).toBe('https://demo.myshopify.com/admin/api/2026-07/graphql.json')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'x-shopify-access-token': 'token' })
    const body = JSON.parse(String(init.body)) as Readonly<{ query: string; variables: Readonly<Record<string, unknown>> }>
    const operation = /query (\w+)/.exec(body.query)?.[1] ?? ''
    calls.push({ operation, variables: body.variables ?? {} })
    const handler = operations[operation]
    if (!handler) return new Response(JSON.stringify({ errors: [{ message: `Unhandled operation ${operation}` }] }), { status: 200 })
    return new Response(JSON.stringify({ data: handler(body.variables ?? {}) }), { status: 200 })
  })
  return { source: new ShopifyGraphQLSyncSource(async () => client, 2), calls }
}

function connection(nodes: readonly unknown[], endCursor: string | null = null): Readonly<Record<string, unknown>> {
  return {
    edges: nodes.map((node, index) => ({ cursor: `raw-${index}`, node })),
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  }
}

const productNode = {
  id: 'gid://shopify/Product/8429887141223',
  legacyResourceId: '8429887141223',
  title: 'Commander Pilot Mug',
  handle: 'commander-pilot-mug',
  vendor: 'ProfitPilot',
  productType: 'Drinkware',
  status: 'ACTIVE',
  tags: ['mug', 'pilot'],
  descriptionHtml: '<p>Mission ready.</p>',
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-02T11:00:00Z',
  publishedAt: '2026-08-01T12:00:00Z',
  totalInventory: 18,
  options: [{ id: 'gid://shopify/ProductOption/1', name: 'Title', values: ['Default Title'] }],
  media: { edges: [{ node: { image: { id: 'gid://shopify/ProductImage/2', url: 'https://cdn.shopify.com/mug.png', altText: 'Mug' } } }] },
  variants: { edges: [{ node: {
    id: 'gid://shopify/ProductVariant/45000000000001',
    legacyResourceId: '45000000000001',
    title: 'Default Title',
    sku: 'MUG-01',
    price: '19.00',
    position: 1,
    inventoryQuantity: 18,
    selectedOptions: [{ name: 'Title', value: 'Default Title' }],
    inventoryItem: { id: 'gid://shopify/InventoryItem/99', unitCost: { amount: '6.50' } },
  } }] },
}

const orderNode = {
  id: 'gid://shopify/Order/77',
  legacyResourceId: '77',
  name: '#1001',
  number: 1001,
  createdAt: '2026-08-10T09:00:00Z',
  updatedAt: '2026-08-10T09:05:00Z',
  processedAt: '2026-08-10T09:00:00Z',
  cancelledAt: null,
  cancelReason: null,
  email: 'pilot@example.com',
  phone: '+15551234567',
  note: 'Priority pack',
  tags: ['vip'],
  sourceName: 'web',
  test: false,
  currencyCode: 'USD',
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'FULFILLED',
  totalPriceSet: { shopMoney: { amount: '39.00', currencyCode: 'USD' } },
  currentTotalPriceSet: { shopMoney: { amount: '39.00', currencyCode: 'USD' } },
  subtotalPriceSet: { shopMoney: { amount: '38.00', currencyCode: 'USD' } },
  currentSubtotalPriceSet: { shopMoney: { amount: '38.00', currencyCode: 'USD' } },
  totalTaxSet: { shopMoney: { amount: '1.00', currencyCode: 'USD' } },
  currentTotalTaxSet: { shopMoney: { amount: '1.00', currencyCode: 'USD' } },
  totalDiscountsSet: { shopMoney: { amount: '2.00', currencyCode: 'USD' } },
  currentTotalDiscountsSet: { shopMoney: { amount: '2.00', currencyCode: 'USD' } },
  totalShippingPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
  currentShippingPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
  customer: {
    id: 'gid://shopify/Customer/5',
    legacyResourceId: '5',
    firstName: 'Amelia',
    lastName: 'Wren',
    displayName: 'Amelia Wren',
    createdAt: '2026-01-01T00:00:00Z',
    defaultEmailAddress: { emailAddress: 'amelia@example.com' },
    defaultPhoneNumber: { phoneNumber: '+15550000000' },
  },
  shippingAddress: { firstName: 'Amelia', lastName: 'Wren', address1: '1 Cloud Way', city: 'Austin', province: 'TX', zip: '73301', country: 'United States', countryCodeV2: 'US', phone: '+15551234567' },
  billingAddress: null,
  lineItems: { edges: [{ node: {
    id: 'gid://shopify/LineItem/900',
    name: 'Commander Pilot Mug',
    title: 'Commander Pilot Mug',
    variantTitle: null,
    sku: 'MUG-01',
    vendor: 'ProfitPilot',
    quantity: 2,
    originalUnitPriceSet: { shopMoney: { amount: '19.00', currencyCode: 'USD' } },
    originalTotalSet: { shopMoney: { amount: '38.00', currencyCode: 'USD' } },
    discountedTotalSet: { shopMoney: { amount: '36.00', currencyCode: 'USD' } },
    totalDiscountSet: { shopMoney: { amount: '2.00', currencyCode: 'USD' } },
    product: { id: 'gid://shopify/Product/8429887141223', legacyResourceId: '8429887141223' },
    variant: { id: 'gid://shopify/ProductVariant/45000000000001', legacyResourceId: '45000000000001', title: 'Default Title', sku: 'MUG-01' },
  } }] },
  transactions: [
    { id: 'gid://shopify/OrderTransaction/501', createdAt: '2026-08-10T09:00:00Z', processedAt: '2026-08-10T09:00:00Z', kind: 'SALE', status: 'SUCCESS', gateway: 'shopify_payments', formattedGateway: 'Shopify Payments', test: false, amountSet: { shopMoney: { amount: '39.00', currencyCode: 'USD' } } },
    { id: 'gid://shopify/OrderTransaction/502', createdAt: '2026-08-11T09:00:00Z', processedAt: '2026-08-11T09:00:00Z', kind: 'REFUND', status: 'SUCCESS', gateway: 'shopify_payments', formattedGateway: 'Shopify Payments', test: false, amountSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } } },
  ],
}

const customerNode = {
  id: 'gid://shopify/Customer/5',
  legacyResourceId: '5',
  firstName: 'Amelia',
  lastName: 'Wren',
  displayName: 'Amelia Wren',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  note: 'Repeat buyer',
  tags: ['vip'],
  state: 'ENABLED',
  verifiedEmail: true,
  numberOfOrders: 4,
  amountSpent: { amount: '156.00', currencyCode: 'USD' },
  defaultEmailAddress: { emailAddress: 'amelia@example.com', marketingState: 'SUBSCRIBED', marketingUpdatedAt: '2026-02-01T00:00:00Z' },
  defaultPhoneNumber: { phoneNumber: '+15550000000' },
  defaultAddress: { firstName: 'Amelia', lastName: 'Wren', address1: '1 Cloud Way', city: 'Austin', province: 'TX', zip: '73301', country: 'United States', countryCodeV2: 'US', phone: '+15550000000' },
  lastOrder: { id: 'gid://shopify/Order/77', legacyResourceId: '77', name: '#1001', processedAt: '2026-08-10T09:00:00Z' },
}

describe('Shopify GraphQL sync source', () => {
  it('fetches products through the GraphQL products connection and maps them to the persisted REST-compatible shape', async () => {
    const { source, calls } = graphqlSource({ ProductsSync: () => ({ products: connection([productNode], 'prod-2') }) })
    const page = await source.fetchPage(storeId('s'), 'products', null)
    expect(calls).toEqual([{ operation: 'ProductsSync', variables: { first: 2, after: null } }])
    expect(page.records[0]).toMatchObject({
      id: '8429887141223',
      admin_graphql_api_id: 'gid://shopify/Product/8429887141223',
      title: 'Commander Pilot Mug',
      product_type: 'Drinkware',
      status: 'active',
      tags: 'mug,pilot',
      body_html: '<p>Mission ready.</p>',
      image: { src: 'https://cdn.shopify.com/mug.png' },
      images: [{ id: '2', src: 'https://cdn.shopify.com/mug.png' }],
      options: [{ name: 'Title', values: ['Default Title'] }],
      variants: [expect.objectContaining({ id: '45000000000001', price: '19.00', inventory_quantity: 18, inventory_management: 'shopify', inventory_item_id: '99', inventory_item: { id: '99', cost: '6.50' }, option1: 'Default Title' })],
    })
    expect(page.nextCursor).toBe(`${GRAPHQL_CURSOR_PREFIX}prod-2`)
  })

  it('persists the GraphQL-mapped product shape once and keeps the catalog payload readable', async () => {
    const { source } = graphqlSource({ ProductsSync: () => ({ products: connection([productNode]) }) })
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

  it('marks untracked variants honestly instead of inventing stock tracking', async () => {
    const trackedVariant = productNode.variants.edges[0]?.node ?? {}
    const untracked = { ...productNode, variants: { edges: [{ node: { ...trackedVariant, inventoryQuantity: null } }] } }
    const { source } = graphqlSource({ ProductsSync: () => ({ products: connection([untracked]) }) })
    const page = await source.fetchPage(storeId('s'), 'products', null)
    expect(page.records[0]).toMatchObject({ variants: [expect.objectContaining({ inventory_quantity: null, inventory_management: null, inventory_item_id: '99' })] })
  })

  it('resumes products from a graphql cursor and ignores legacy REST page_info cursors', async () => {
    const resumed = graphqlSource({ ProductsSync: () => ({ products: connection([]) }) })
    await resumed.source.fetchPage(storeId('s'), 'products', `${GRAPHQL_CURSOR_PREFIX}resume-token`)
    expect(resumed.calls[0]?.variables).toEqual({ first: 2, after: 'resume-token' })

    const legacy = graphqlSource({ ProductsSync: () => ({ products: connection([productNode]) }) })
    const page = await legacy.source.fetchPage(storeId('s'), 'products', 'legacy-page-info-token')
    expect(legacy.calls[0]?.variables).toEqual({ first: 2, after: null })
    expect(page.records).toHaveLength(1)
  })

  it('embeds transactions inside the orders query — one GraphQL request per page, never one per order', async () => {
    const secondOrder = { ...orderNode, id: 'gid://shopify/Order/78', legacyResourceId: '78', name: '#1002', transactions: [{ ...orderNode.transactions[0], id: 'gid://shopify/OrderTransaction/503' }] }
    const { source, calls } = graphqlSource({ OrdersSync: () => ({ orders: connection([orderNode, secondOrder]) }) })
    const page = await source.fetchPage(storeId('s'), 'orders', null)
    // The N+1 killer: two orders with transactions resolved from ONE request.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ operation: 'OrdersSync' })
    expect(String(calls[0]?.variables.first)).toBe('2')
    expect(page.records).toHaveLength(2)
    expect(page.records[0]).toMatchObject({
      id: '77',
      admin_graphql_api_id: 'gid://shopify/Order/77',
      name: '#1001',
      order_number: 1001,
      currency: 'USD',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      total_price: '39.00',
      current_subtotal_price: '38.00',
      total_discounts: '2.00',
      customer: { id: '5', email: 'amelia@example.com', first_name: 'Amelia' },
      shipping_address: { city: 'Austin', country_code: 'US', phone: '+15551234567' },
      line_items: [{ id: '900', product_id: '8429887141223', variant_id: '45000000000001', quantity: 2, price: '19.00', total_discount: '2.00' }],
      transactions: [
        { id: '501', order_id: '77', kind: 'sale', status: 'success', amount: '39.00' },
        { id: '502', order_id: '77', kind: 'refund', amount: '10.00' },
      ],
    })
  })

  it('requests at most the documented transaction window per order', () => {
    expect(ORDER_TRANSACTIONS_LIMIT).toBe(50)
  })

  it('flattens the transactions module from the same orders query', async () => {
    const { source, calls } = graphqlSource({ OrdersSync: () => ({ orders: connection([orderNode], 'orders-2') }) })
    const page = await source.fetchPage(storeId('s'), 'transactions', null)
    expect(calls).toEqual([{ operation: 'OrdersSync', variables: { first: 2, after: null } }])
    expect(page.records).toEqual([
      expect.objectContaining({ id: '501', order_id: '77', kind: 'sale', gateway: 'shopify_payments', amount: '39.00', currency: 'USD' }),
      expect.objectContaining({ id: '502', order_id: '77', kind: 'refund' }),
    ])
    expect(page.nextCursor).toBe(`${GRAPHQL_CURSOR_PREFIX}orders-2`)
  })

  it('maps customers with marketing consent and last-order metadata', async () => {
    const { source } = graphqlSource({ CustomersSync: () => ({ customers: connection([customerNode], 'cust-2') }) })
    const page = await source.fetchPage(storeId('s'), 'customers', null)
    expect(page.records[0]).toMatchObject({
      id: '5',
      admin_graphql_api_id: 'gid://shopify/Customer/5',
      first_name: 'Amelia',
      last_name: 'Wren',
      email: 'amelia@example.com',
      phone: '+15550000000',
      orders_count: 4,
      total_spent: '156.00',
      accepts_marketing: true,
      email_marketing_consent: { state: 'subscribed', consent_updated_at: '2026-02-01T00:00:00Z' },
      default_address: { city: 'Austin', country_code: 'US' },
      last_order_id: '77',
      last_order_name: '#1001',
      last_order_at: '2026-08-10T09:00:00Z',
    })
    expect(page.nextCursor).toBe(`${GRAPHQL_CURSOR_PREFIX}cust-2`)
  })

  it('loads inventory levels per inventory item with location metadata on the first page only', async () => {
    const item = {
      id: 'gid://shopify/InventoryItem/99',
      legacyResourceId: '99',
      sku: 'MUG-01',
      tracked: true,
      updatedAt: '2026-08-20T08:00:00Z',
      variant: { id: 'gid://shopify/ProductVariant/45000000000001', legacyResourceId: '45000000000001' },
      inventoryLevels: { edges: [{ node: { updatedAt: '2026-08-21T08:00:00Z', location: { id: 'gid://shopify/Location/11', legacyResourceId: '11' }, quantities: [{ name: 'available', quantity: 6 }] } }] },
    }
    const { source, calls } = graphqlSource({
      LocationsSync: () => ({ locations: connection([{ id: 'gid://shopify/Location/11', legacyResourceId: '11', name: 'Morādābād Warehouse', isActive: true, address: { city: 'Morādābād', province: 'Uttar Pradesh', country: 'IN' } }]) }),
      InventoryItemsSync: () => ({ inventoryItems: connection([item]) }),
    })
    const page = await source.fetchPage(storeId('s'), 'inventory', null)
    expect(calls.map((call) => call.operation)).toEqual(['LocationsSync', 'InventoryItemsSync'])
    expect(page.records[0]).toMatchObject({ id: '11:99', location_id: '11', inventory_item_id: '99', variant_id: '45000000000001', available: 6, updated_at: '2026-08-21T08:00:00Z' })
    const location = page.records.find((record) => record.id === 'location:11')
    expect(location).toMatchObject({ record_kind: 'location', location_id: '11', name: 'Morādābād Warehouse', city: 'Morādābād', country: 'IN', active: true, levels_queried: true })

    const resumed = graphqlSource({ InventoryItemsSync: () => ({ inventoryItems: connection([]) }) })
    const second = await resumed.source.fetchPage(storeId('s'), 'inventory', `${GRAPHQL_CURSOR_PREFIX}resume`)
    expect(resumed.calls.map((call) => call.operation)).toEqual(['InventoryItemsSync'])
    expect(second.records.some((record) => String(record.id).startsWith('location:'))).toBe(false)
  })

  it('migrates checkouts to the GraphQL abandonedCheckouts connection', async () => {
    const checkout = {
      id: 'gid://shopify/AbandonedCheckout/bedk9mpgr5y3wcwq',
      name: '#4242',
      createdAt: '2026-08-19T12:00:00Z',
      updatedAt: '2026-08-19T12:30:00Z',
      completedAt: null,
      abandonedCheckoutUrl: 'https://demo.myshopify.com/checkouts/bedk9mpgr5y3wcwq/recover',
      totalPriceSet: { shopMoney: { amount: '55.00', currencyCode: 'USD' } },
      subtotalPriceSet: { shopMoney: { amount: '52.00', currencyCode: 'USD' } },
    }
    const { source, calls } = graphqlSource({ AbandonedCheckoutsSync: () => ({ abandonedCheckouts: connection([checkout], 'chk-2') }) })
    const page = await source.fetchPage(storeId('s'), 'checkouts', null)
    expect(calls[0]?.operation).toBe('AbandonedCheckoutsSync')
    expect(page.records[0]).toMatchObject({ id: 'bedk9mpgr5y3wcwq', name: '#4242', created_at: '2026-08-19T12:00:00Z', completed_at: null, total_price: '55.00', subtotal_price: '52.00', currency: 'USD' })
    expect(page.nextCursor).toBe(`${GRAPHQL_CURSOR_PREFIX}chk-2`)
  })

  it('pages the merged GraphQL collections connection instead of custom-then-smart REST resources', async () => {
    const custom = { id: 'gid://shopify/Collection/1', legacyResourceId: '1', title: 'Summer', handle: 'summer', descriptionHtml: '', sortOrder: 'MANUAL', updatedAt: '2026-08-01T00:00:00Z', productsCount: { count: 4 }, ruleSet: null }
    const smart = { ...custom, id: 'gid://shopify/Collection/2', legacyResourceId: '2', title: 'Auto', handle: 'auto', ruleSet: { appliedDisjunctively: true } }
    const { source, calls } = graphqlSource({ CollectionsSync: () => ({ collections: connection([custom, smart]) }) })
    const page = await source.fetchPage(storeId('s'), 'collections', null)
    expect(calls[0]?.operation).toBe('CollectionsSync')
    expect(page.records[0]).toMatchObject({ id: '1', title: 'Summer', collection_kind: 'custom', sort_order: 'manual', products_count: 4 })
    expect(page.records[1]).toMatchObject({ id: '2', collection_kind: 'smart', disjunctive: true })
    expect(page.nextCursor).toBeNull()
  })

  it('reads discounts through the GraphQL discountNodes connection', async () => {
    const node = { id: 'gid://shopify/DiscountNode/9', discount: { __typename: 'DiscountCodeBasic', title: 'Launch 10', startsAt: '2026-08-01T00:00:00Z', endsAt: null } }
    const { source, calls } = graphqlSource({ DiscountNodesSync: () => ({ discountNodes: connection([node]) }) })
    const page = await source.fetchPage(storeId('s'), 'discounts', null)
    expect(calls[0]?.operation).toBe('DiscountNodesSync')
    expect(page.records[0]).toMatchObject({ id: '9', discount_type: 'DiscountCodeBasic', method: 'code', title: 'Launch 10', starts_at: '2026-08-01T00:00:00Z', ends_at: null })
  })

  it('surfaces GraphQL body errors as dependency failures', async () => {
    const client = new ShopifyClient('demo.myshopify.com', 'token', async () => new Response(JSON.stringify({ errors: [{ message: 'Field `widgets` does not exist' }] }), { status: 200 }))
    const source = new ShopifyGraphQLSyncSource(async () => client)
    const error = await source.fetchPage(storeId('s'), 'products', null).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).message).toContain('Field `widgets` does not exist')
  })

  it('maps THROTTLED responses to a 429 so the rate controller backs off', async () => {
    const client = new ShopifyClient('demo.myshopify.com', 'token', async () => new Response(JSON.stringify({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }), { status: 200 }))
    const source = new ShopifyGraphQLSyncSource(async () => client)
    const error = await source.fetchPage(storeId('s'), 'orders', null).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(ShopifyApiError)
    expect((error as ShopifyApiError).status).toBe(429)
  })

  it('explains scope denials with the reinstall guidance', async () => {
    const client = new ShopifyClient('demo.myshopify.com', 'token', async () => new Response(JSON.stringify({ errors: 'Access Denied' }), { status: 403 }))
    const source = new ShopifyGraphQLSyncSource(async () => client)
    await expect(source.fetchPage(storeId('s'), 'customers', null)).rejects.toThrow('Reinstall the app')
  })

  it('rejects a response without the expected connection', async () => {
    const { source } = graphqlSource({ ProductsSync: () => ({ widgets: connection([]) }) })
    await expect(source.fetchPage(storeId('s'), 'products', null)).rejects.toThrow('products')
  })

  it('rejects invalid page sizes', () => expect(() => new ShopifyGraphQLSyncSource(async () => new ShopifyClient('demo.myshopify.com', 'token'), 251)).toThrow('between'))
})
