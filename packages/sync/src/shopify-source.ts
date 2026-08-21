import { ShopifyApiError, ShopifyClient } from '@profitpilot/shopify'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { SyncModule, SyncPage, SyncRecord, SyncSource } from './sync.js'

export type ShopifyClientFactory = (storeId: StoreId) => Promise<ShopifyClient>

/** Marks a location metadata row inside the `inventory` sync module. */
export const LOCATION_RECORD_PREFIX = 'location:'

/**
 * Every cursor this source returns is prefixed with `gql:`. A checkpoint left
 * behind by the retired REST engine holds a raw `page_info` token that the
 * GraphQL Admin API cannot accept as an `after:` argument, so an unprefixed
 * cursor is treated as "start over" instead of being replayed into a permanent
 * invalid-cursor failure loop.
 */
export const GRAPHQL_CURSOR_PREFIX = 'gql:'

/**
 * Transactions ride along inside every orders page (`transactions` is a nested
 * list on `Order`), which deletes the old REST pattern of one
 * `/orders/{id}/transactions.json` request per order (N+1).
 */
export const ORDER_TRANSACTIONS_LIMIT = 50

/** Line items requested per order inside the orders page. */
const ORDER_LINE_ITEMS_LIMIT = 100
/** Variants requested per product inside the products page. */
const PRODUCT_VARIANTS_LIMIT = 100
/** Images requested per product inside the products page. */
const PRODUCT_MEDIA_LIMIT = 10
/** Inventory levels requested per inventory item inside the inventory page. */
const ITEM_LEVELS_LIMIT = 100
/** Locations page used for the inventory module's location metadata. */
const LOCATIONS_LIMIT = 100
/** Hard cap on location pages so a pathological store cannot loop forever. */
const MAX_LOCATION_PAGES = 10

type GraphQLError = Readonly<{ message?: unknown; extensions?: Readonly<{ code?: unknown }> }>
type GraphQLBody<Value> = Readonly<{ data?: Value | null; errors?: readonly GraphQLError[] }>
type Node = Readonly<Record<string, unknown>>
type ConnectionResult<Value> = Readonly<{ nodes: readonly Value[]; nextCursor: string | null }>

/**
 * Sync source that reads Shopify exclusively through the GraphQL Admin API.
 *
 * The REST engine (`/products.json`, `/orders.json`, …) hit endpoints Shopify
 * has deprecated and fetched transactions with one request per order. Every
 * module here uses one cursor-paginated GraphQL query per page, and the
 * `orders` query embeds `transactions(first: 50)` so payment data arrives in
 * the same request.
 *
 * GraphQL nodes are mapped back to the approximate REST resource shape the
 * `sync_records` payloads (and every reader built on them) already expect:
 * snake_case keys, numeric string ids, and `admin_graphql_api_id` gids.
 */
export class ShopifyGraphQLSyncSource implements SyncSource {
  private readonly clients: ShopifyClientFactory
  private readonly pageSize: number

  public constructor(clients: ShopifyClientFactory, pageSize = 50) {
    if (pageSize < 1 || pageSize > 250) throw new RangeError('Shopify GraphQL page size must be between 1 and 250')
    this.clients = clients
    this.pageSize = pageSize
  }

  public async fetchPage(storeId: StoreId, module: SyncModule, cursor: string | null): Promise<SyncPage> {
    const client = await this.clients(storeId)
    // Legacy REST `page_info` checkpoints cannot be resumed with GraphQL, so
    // they intentionally restart the module from the first page.
    const after = resumeCursor(cursor)
    if (module === 'products') return this.fetchProducts(client, after)
    if (module === 'orders') return this.fetchOrders(client, after)
    if (module === 'transactions') return this.fetchTransactions(client, after)
    if (module === 'customers') return this.fetchCustomers(client, after)
    if (module === 'inventory') return this.fetchInventory(client, after)
    if (module === 'checkouts') return this.fetchCheckouts(client, after)
    if (module === 'collections') return this.fetchCollections(client, after)
    return this.fetchDiscounts(client, after)
  }

  private async fetchProducts(client: ShopifyClient, after: string | null): Promise<SyncPage> {
    const data = await this.graphql<Node>(client, 'products', PRODUCTS_QUERY, { first: this.pageSize, after })
    const page = connectionOf<Node>(data, 'products', 'products')
    return { records: page.nodes.map(productRecord), nextCursor: page.nextCursor }
  }

  private async fetchOrders(client: ShopifyClient, after: string | null): Promise<SyncPage> {
    const data = await this.graphql<Node>(client, 'orders', ORDERS_QUERY, { first: this.pageSize, after })
    const page = connectionOf<Node>(data, 'orders', 'orders')
    return { records: page.nodes.map(orderRecord), nextCursor: page.nextCursor }
  }

  /**
   * The transactions module rides the exact same `orders` connection (with the
   * nested `transactions(first: 50)` list) and flattens the embedded payment
   * rows. One GraphQL request per page — the per-order REST loop is gone.
   */
  private async fetchTransactions(client: ShopifyClient, after: string | null): Promise<SyncPage> {
    const data = await this.graphql<Node>(client, 'transactions', ORDERS_QUERY, { first: this.pageSize, after })
    const page = connectionOf<Node>(data, 'orders', 'transactions')
    const records: SyncRecord[] = []
    for (const order of page.nodes) {
      const orderId = nodeId(order)
      for (const transaction of arrayValue(order.transactions)) records.push(transactionRecord(transaction, orderId))
    }
    return { records, nextCursor: page.nextCursor }
  }

  private async fetchCustomers(client: ShopifyClient, after: string | null): Promise<SyncPage> {
    const data = await this.graphql<Node>(client, 'customers', CUSTOMERS_QUERY, { first: this.pageSize, after })
    const page = connectionOf<Node>(data, 'customers', 'customers')
    return { records: page.nodes.map(customerRecord), nextCursor: page.nextCursor }
  }

  private async fetchCheckouts(client: ShopifyClient, after: string | null): Promise<SyncPage> {
    const data = await this.graphql<Node>(client, 'checkouts', CHECKOUTS_QUERY, { first: this.pageSize, after })
    const page = connectionOf<Node>(data, 'abandonedCheckouts', 'checkouts')
    return { records: page.nodes.map(checkoutRecord), nextCursor: page.nextCursor }
  }

  private async fetchCollections(client: ShopifyClient, after: string | null): Promise<SyncPage> {
    const data = await this.graphql<Node>(client, 'collections', COLLECTIONS_QUERY, { first: this.pageSize, after })
    const page = connectionOf<Node>(data, 'collections', 'collections')
    return { records: page.nodes.map(collectionRecord), nextCursor: page.nextCursor }
  }

  /**
   * The REST `/price_rules.json` endpoint (and the GraphQL `priceRule` queries
   * it mirrored) was removed from the Admin API; `discountNodes` is the
   * supported GraphQL source of discount listings and is authorized by the
   * `read_discounts` scope ProfitPilot already requests.
   */
  private async fetchDiscounts(client: ShopifyClient, after: string | null): Promise<SyncPage> {
    const data = await this.graphql<Node>(client, 'discounts', DISCOUNTS_QUERY, { first: this.pageSize, after })
    const page = connectionOf<Node>(data, 'discountNodes', 'discounts')
    return { records: page.nodes.map(discountRecord), nextCursor: page.nextCursor }
  }

  /**
   * Inventory levels via the `inventoryItems` connection: each item carries its
   * per-location `inventoryLevels` (with the `available` quantity) in the same
   * request, so every location in the shop is covered without a `location_ids`
   * bound. Location metadata rows are emitted once, on the first page, exactly
   * like the REST engine did.
   */
  private async fetchInventory(client: ShopifyClient, after: string | null): Promise<SyncPage> {
    const locations = after === null ? await this.allLocations(client) : []
    const data = await this.graphql<Node>(client, 'inventory', INVENTORY_QUERY, { first: this.pageSize, after })
    const page = connectionOf<Node>(data, 'inventoryItems', 'inventory')
    const levels: SyncRecord[] = []
    for (const item of page.nodes) levels.push(...inventoryLevelRecords(item))
    const locationRecords = locations.map((location) => {
      const metadata = locationMetadata(location)
      return {
        ...metadata,
        id: `${LOCATION_RECORD_PREFIX}${metadata.id}`,
        location_id: metadata.id,
        record_kind: 'location',
        // GraphQL pages levels by item, not by a capped location list, so every
        // location's stock is genuinely queried.
        levels_queried: true,
      }
    })
    // Levels stay first so the module's primary payload is unchanged; the
    // location rows are appended metadata.
    return { records: [...levels, ...locationRecords], nextCursor: page.nextCursor }
  }

  /** Pages every location (active and inactive) for the inventory metadata rows. */
  private async allLocations(client: ShopifyClient): Promise<readonly Node[]> {
    const locations: Node[] = []
    let after: string | null = null
    for (let page = 0; page < MAX_LOCATION_PAGES; page += 1) {
      const data = await this.graphql<Node>(client, 'inventory', LOCATIONS_QUERY, { first: LOCATIONS_LIMIT, after })
      const result = connectionOf<Node>(data, 'locations', 'inventory')
      locations.push(...result.nodes)
      if (result.nextCursor === null) return locations
      after = stripCursorPrefix(result.nextCursor)
    }
    return locations
  }

  private async graphql<Value extends Node>(client: ShopifyClient, module: SyncModule, query: string, variables: Readonly<Record<string, unknown>>): Promise<Value> {
    let body: GraphQLBody<Value>
    try {
      const response = await client.request<GraphQLBody<Value>>({ method: 'POST', path: '/graphql.json', body: JSON.stringify({ query, variables }) })
      body = response.data
    } catch (error: unknown) {
      if (error instanceof ShopifyApiError && (error.status === 403 || error.status === 401)) {
        throw new AppError('DEPENDENCY_ERROR', `Shopify denied the ${module} sync (${error.status}). Reinstall the app so it can request the required access scopes.`, error.status === 401 ? 401 : 403, { module, upstreamStatus: error.status })
      }
      throw error
    }
    const errors = body.errors ?? []
    if (errors.length > 0) {
      const first = errors[0]
      const message = typeof first?.message === 'string' ? first.message : `Shopify ${module} query failed`
      const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : null
      // Surface throttling with HTTP-429 semantics so the adaptive rate
      // controller and store circuit react exactly like they did to REST 429s.
      if (code === 'THROTTLED') throw new ShopifyApiError(429, `Shopify throttled the ${module} sync query`, null)
      if (code === 'ACCESS_DENIED' || code === 'UNAUTHORIZED') {
        throw new AppError('DEPENDENCY_ERROR', `Shopify denied the ${module} sync. Reinstall the app so it can request the required access scopes.`, 403, { module, code })
      }
      throw new AppError('DEPENDENCY_ERROR', `Shopify ${module} GraphQL query failed: ${message}`, 502, { module, code })
    }
    if (!isRecord(body.data)) throw new AppError('DEPENDENCY_ERROR', `Shopify ${module} response did not contain data`, 502, { module })
    return body.data as Value
  }
}

const PRODUCTS_QUERY = `query ProductsSync($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      node {
        id
        legacyResourceId
        title
        handle
        vendor
        productType
        status
        tags
        descriptionHtml
        createdAt
        updatedAt
        publishedAt
        totalInventory
        options { id name values }
        media(first: ${PRODUCT_MEDIA_LIMIT}) {
          edges { node { ... on MediaImage { image { id url altText } } } }
        }
        variants(first: ${PRODUCT_VARIANTS_LIMIT}) {
          edges {
            node {
              id
              legacyResourceId
              title
              sku
              price
              position
              inventoryQuantity
              selectedOptions { name value }
              inventoryItem { id unitCost { amount } }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const ORDERS_QUERY = `query OrdersSync($first: Int!, $after: String) {
  orders(first: $first, after: $after) {
    edges {
      node {
        id
        legacyResourceId
        name
        number
        createdAt
        updatedAt
        processedAt
        cancelledAt
        cancelReason
        email
        phone
        note
        tags
        sourceName
        test
        currencyCode
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        currentTotalTaxSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        currentTotalDiscountsSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        currentShippingPriceSet { shopMoney { amount currencyCode } }
        customer {
          id
          legacyResourceId
          firstName
          lastName
          displayName
          createdAt
          defaultEmailAddress { emailAddress }
          defaultPhoneNumber { phoneNumber }
        }
        shippingAddress { firstName lastName company address1 address2 city province zip country countryCodeV2 phone }
        billingAddress { firstName lastName company address1 address2 city province zip country countryCodeV2 phone }
        lineItems(first: ${ORDER_LINE_ITEMS_LIMIT}) {
          edges {
            node {
              id
              name
              title
              variantTitle
              sku
              vendor
              quantity
              originalUnitPriceSet { shopMoney { amount currencyCode } }
              originalTotalSet { shopMoney { amount currencyCode } }
              discountedTotalSet { shopMoney { amount currencyCode } }
              totalDiscountSet { shopMoney { amount currencyCode } }
              product { id legacyResourceId }
              variant { id legacyResourceId title sku }
            }
          }
        }
        transactions(first: ${ORDER_TRANSACTIONS_LIMIT}) {
          id
          createdAt
          processedAt
          kind
          status
          gateway
          formattedGateway
          test
          amountSet { shopMoney { amount currencyCode } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const CUSTOMERS_QUERY = `query CustomersSync($first: Int!, $after: String) {
  customers(first: $first, after: $after) {
    edges {
      node {
        id
        legacyResourceId
        firstName
        lastName
        displayName
        createdAt
        updatedAt
        note
        tags
        state
        verifiedEmail
        numberOfOrders
        amountSpent { amount currencyCode }
        defaultEmailAddress { emailAddress marketingState marketingUpdatedAt }
        defaultPhoneNumber { phoneNumber }
        defaultAddress { firstName lastName company address1 address2 city province zip country countryCodeV2 phone }
        lastOrder { id legacyResourceId name processedAt }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const CHECKOUTS_QUERY = `query AbandonedCheckoutsSync($first: Int!, $after: String) {
  abandonedCheckouts(first: $first, after: $after) {
    edges {
      node {
        id
        name
        createdAt
        updatedAt
        completedAt
        abandonedCheckoutUrl
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const COLLECTIONS_QUERY = `query CollectionsSync($first: Int!, $after: String) {
  collections(first: $first, after: $after) {
    edges {
      node {
        id
        legacyResourceId
        title
        handle
        descriptionHtml
        sortOrder
        updatedAt
        productsCount { count }
        ruleSet { appliedDisjunctively }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const DISCOUNTS_QUERY = `query DiscountNodesSync($first: Int!, $after: String) {
  discountNodes(first: $first, after: $after) {
    edges {
      node {
        id
        discount {
          __typename
          ... on DiscountCodeBasic { title startsAt endsAt }
          ... on DiscountCodeBxgy { title startsAt endsAt }
          ... on DiscountCodeFreeShipping { title startsAt endsAt }
          ... on DiscountAutomaticBasic { title startsAt endsAt }
          ... on DiscountAutomaticBxgy { title startsAt endsAt }
          ... on DiscountAutomaticFreeShipping { title startsAt endsAt }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const LOCATIONS_QUERY = `query LocationsSync($first: Int!, $after: String) {
  locations(first: $first, after: $after, includeInactive: true) {
    edges {
      node {
        id
        legacyResourceId
        name
        isActive
        address { city province country }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const INVENTORY_QUERY = `query InventoryItemsSync($first: Int!, $after: String) {
  inventoryItems(first: $first, after: $after) {
    edges {
      node {
        id
        legacyResourceId
        sku
        tracked
        updatedAt
        variant { id legacyResourceId }
        inventoryLevels(first: ${ITEM_LEVELS_LIMIT}) {
          edges {
            node {
              updatedAt
              location { id legacyResourceId }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

function productRecord(node: Node): SyncRecord {
  const mappedImages = connectionEdges(node.media)
    .map((media) => recordValue(media.image))
    .filter((image): image is Node => image !== null)
    .map((image) => ({ id: nodeId(image), src: str(image.url), alt: str(image.altText) }))
  return {
    id: nodeId(node),
    admin_graphql_api_id: str(node.id),
    title: str(node.title),
    handle: str(node.handle),
    vendor: str(node.vendor),
    product_type: str(node.productType),
    status: lower(node.status),
    tags: tagsCsv(node.tags),
    body_html: str(node.descriptionHtml),
    created_at: str(node.createdAt),
    updated_at: str(node.updatedAt),
    published_at: str(node.publishedAt),
    total_inventory: node.totalInventory ?? null,
    options: arrayValue(node.options).map((option) => ({ id: nodeId(option), name: str(option.name), values: stringArray(option.values) })),
    image: mappedImages[0] ?? null,
    images: mappedImages,
    variants: connectionEdges(node.variants).map((variant) => {
      const inventoryItem = recordValue(variant.inventoryItem)
      // REST exposed `inventory_management: "shopify"` only for tracked
      // variants; an untracked variant reports a null inventoryQuantity.
      return {
        id: nodeId(variant),
        admin_graphql_api_id: str(variant.id),
        title: str(variant.title),
        sku: str(variant.sku),
        price: str(variant.price),
        position: variant.position ?? null,
        inventory_quantity: variant.inventoryQuantity ?? null,
        inventory_management: inventoryItem && typeof variant.inventoryQuantity === 'number' ? 'shopify' : null,
        inventory_item_id: inventoryItem ? nodeId(inventoryItem) : null,
        inventory_item: inventoryItem ? { id: nodeId(inventoryItem), cost: str(recordValue(inventoryItem.unitCost)?.amount) } : null,
        option1: selectedOption(variant, 1),
        option2: selectedOption(variant, 2),
        option3: selectedOption(variant, 3),
      }
    }),
  }
}

function orderRecord(node: Node): SyncRecord {
  const orderId = nodeId(node)
  const lineItems = connectionEdges(node.lineItems).map((line) => ({
    id: nodeId(line),
    admin_graphql_api_id: str(line.id),
    product_id: recordValue(line.product) ? nodeId(line.product) : null,
    variant_id: recordValue(line.variant) ? nodeId(line.variant) : null,
    title: str(line.title) ?? str(line.name),
    name: str(line.name),
    variant_title: str(line.variantTitle),
    sku: str(line.sku) ?? str(recordValue(line.variant)?.sku) ?? null,
    vendor: str(line.vendor),
    quantity: line.quantity ?? 0,
    price: shopMoneyAmount(line.originalUnitPriceSet),
    original_total: shopMoneyAmount(line.originalTotalSet),
    discounted_total: shopMoneyAmount(line.discountedTotalSet),
    total_discount: shopMoneyAmount(line.totalDiscountSet),
  }))
  return {
    id: orderId,
    admin_graphql_api_id: str(node.id),
    name: str(node.name),
    order_number: node.number ?? null,
    created_at: str(node.createdAt),
    updated_at: str(node.updatedAt),
    processed_at: str(node.processedAt),
    cancelled_at: str(node.cancelledAt),
    cancel_reason: lower(node.cancelReason),
    email: str(node.email),
    phone: str(node.phone),
    note: str(node.note),
    tags: tagsCsv(node.tags),
    source_name: str(node.sourceName),
    test: node.test === true,
    currency: str(node.currencyCode),
    financial_status: lower(node.displayFinancialStatus),
    fulfillment_status: fulfillmentStatus(node.displayFulfillmentStatus),
    total_price: shopMoneyAmount(node.totalPriceSet),
    current_total_price: shopMoneyAmount(node.currentTotalPriceSet),
    subtotal_price: shopMoneyAmount(node.subtotalPriceSet),
    current_subtotal_price: shopMoneyAmount(node.currentSubtotalPriceSet),
    total_tax: shopMoneyAmount(node.totalTaxSet),
    current_total_tax: shopMoneyAmount(node.currentTotalTaxSet),
    total_discounts: shopMoneyAmount(node.totalDiscountsSet),
    current_total_discounts: shopMoneyAmount(node.currentTotalDiscountsSet),
    total_shipping_price_set: moneySetRest(node.totalShippingPriceSet),
    current_total_shipping_price_set: moneySetRest(node.currentShippingPriceSet),
    customer: orderCustomerRecord(node.customer),
    shipping_address: addressRecord(node.shippingAddress),
    billing_address: addressRecord(node.billingAddress),
    line_items: lineItems,
    transactions: arrayValue(node.transactions).map((transaction) => transactionRecord(transaction, orderId)),
  }
}

function orderCustomerRecord(value: unknown): Node | null {
  const customer = recordValue(value)
  if (!customer) return null
  return {
    id: nodeId(customer),
    admin_graphql_api_id: str(customer.id),
    first_name: str(customer.firstName),
    last_name: str(customer.lastName),
    display_name: str(customer.displayName),
    email: str(recordValue(customer.defaultEmailAddress)?.emailAddress),
    phone: str(recordValue(customer.defaultPhoneNumber)?.phoneNumber),
    created_at: str(customer.createdAt),
  }
}

function transactionRecord(node: Node, orderId: string): SyncRecord {
  return {
    id: nodeId(node),
    admin_graphql_api_id: str(node.id),
    order_id: orderId,
    kind: lower(node.kind),
    status: lower(node.status),
    gateway: str(node.gateway) ?? str(node.formattedGateway),
    amount: shopMoneyAmount(node.amountSet),
    currency: shopMoneyCurrency(node.amountSet),
    created_at: str(node.createdAt),
    processed_at: str(node.processedAt),
    test: node.test === true,
  }
}

function customerRecord(node: Node): SyncRecord {
  const email = recordValue(node.defaultEmailAddress)
  const amountSpent = recordValue(node.amountSpent)
  const lastOrder = recordValue(node.lastOrder)
  return {
    id: nodeId(node),
    admin_graphql_api_id: str(node.id),
    first_name: str(node.firstName),
    last_name: str(node.lastName),
    display_name: str(node.displayName),
    email: str(email?.emailAddress),
    phone: str(recordValue(node.defaultPhoneNumber)?.phoneNumber),
    // REST-style consent object; the GraphQL node is kept alongside for readers
    // that prefer `defaultEmailAddress.marketingState`.
    email_marketing_consent: email ? { state: lower(email.marketingState), consent_updated_at: str(email.marketingUpdatedAt) } : null,
    accepts_marketing: lower(email?.marketingState) === 'subscribed',
    orders_count: node.numberOfOrders ?? null,
    total_spent: str(amountSpent?.amount),
    amountSpent: amountSpent ? { amount: str(amountSpent.amount), currencyCode: str(amountSpent.currencyCode) } : null,
    created_at: str(node.createdAt),
    updated_at: str(node.updatedAt),
    note: str(node.note),
    tags: tagsCsv(node.tags),
    state: lower(node.state),
    verified_email: node.verifiedEmail === true,
    default_address: addressRecord(node.defaultAddress),
    last_order_id: lastOrder ? nodeId(lastOrder) : null,
    last_order_name: str(lastOrder?.name),
    last_order_at: str(lastOrder?.processedAt),
    defaultEmailAddress: email ? { emailAddress: str(email.emailAddress), marketingState: str(email.marketingState), marketingUpdatedAt: str(email.marketingUpdatedAt) } : null,
    defaultPhoneNumber: recordValue(node.defaultPhoneNumber) ? { phoneNumber: str(recordValue(node.defaultPhoneNumber)?.phoneNumber) } : null,
  }
}

function checkoutRecord(node: Node): SyncRecord {
  return {
    id: nodeId(node),
    admin_graphql_api_id: str(node.id),
    name: str(node.name),
    created_at: str(node.createdAt),
    updated_at: str(node.updatedAt),
    completed_at: str(node.completedAt),
    total_price: shopMoneyAmount(node.totalPriceSet),
    subtotal_price: shopMoneyAmount(node.subtotalPriceSet),
    currency: shopMoneyCurrency(node.totalPriceSet),
    recovery_url: str(node.abandonedCheckoutUrl),
  }
}

function collectionRecord(node: Node): SyncRecord {
  const ruleSet = recordValue(node.ruleSet)
  return {
    id: nodeId(node),
    admin_graphql_api_id: str(node.id),
    title: str(node.title),
    handle: str(node.handle),
    body_html: str(node.descriptionHtml),
    sort_order: lower(node.sortOrder),
    products_count: recordValue(node.productsCount)?.count ?? null,
    // `collections` merges the two REST resources; a non-null ruleSet marks the
    // smart collections the old cursor protocol had to page separately.
    collection_kind: ruleSet ? 'smart' : 'custom',
    disjunctive: ruleSet ? ruleSet.appliedDisjunctively === true : null,
    updated_at: str(node.updatedAt),
  }
}

function discountRecord(node: Node): SyncRecord {
  const discount = recordValue(node.discount)
  return {
    id: nodeId(node),
    admin_graphql_api_id: str(node.id),
    discount_type: str(discount?.__typename),
    method: typeof discount?.__typename === 'string' && discount.__typename.startsWith('DiscountCode') ? 'code' : 'automatic',
    title: str(discount?.title),
    starts_at: str(discount?.startsAt),
    ends_at: str(discount?.endsAt),
  }
}

function inventoryLevelRecords(node: Node): readonly SyncRecord[] {
  const itemId = nodeId(node)
  const variantId = recordValue(node.variant) ? nodeId(node.variant) : null
  return connectionEdges(node.inventoryLevels).flatMap((level) => {
    const location = recordValue(level.location)
    if (!location) return []
    const locationId = nodeId(location)
    return [{
      id: `${locationId}:${itemId}`,
      location_id: locationId,
      inventory_item_id: itemId,
      variant_id: variantId,
      sku: str(node.sku),
      tracked: node.tracked === true,
      available: quantityNamed(level.quantities, 'available'),
      updated_at: str(level.updatedAt) ?? str(node.updatedAt),
    }]
  })
}

/** GraphQL nodes keep the REST-compatible location metadata shape. */
function locationMetadata(node: Node): Node {
  const address = recordValue(node.address)
  return {
    id: nodeId(node),
    name: str(node.name),
    city: str(address?.city),
    province: str(address?.province),
    country: str(address?.country),
    active: node.isActive === true,
  }
}

function addressRecord(value: unknown): Node | null {
  const address = recordValue(value)
  if (!address) return null
  return {
    first_name: str(address.firstName),
    last_name: str(address.lastName),
    company: str(address.company),
    address1: str(address.address1),
    address2: str(address.address2),
    city: str(address.city),
    province: str(address.province),
    zip: str(address.zip),
    country: str(address.country),
    country_code: str(address.countryCodeV2),
    phone: str(address.phone),
  }
}

/** Numeric REST-style id: prefer `legacyResourceId`, fall back to the gid tail. */
function nodeId(value: unknown): string {
  const node = recordValue(value)
  if (!node) throw new AppError('DEPENDENCY_ERROR', 'Shopify GraphQL resource is missing a stable id', 502, {})
  const legacy = node.legacyResourceId
  if (typeof legacy === 'string' && legacy.trim()) return legacy
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return String(legacy)
  const gid = str(node.id)
  if (gid) {
    const tail = gid.slice(gid.lastIndexOf('/') + 1)
    if (tail) return tail
  }
  throw new AppError('DEPENDENCY_ERROR', 'Shopify GraphQL resource is missing a stable id', 502, {})
}

function connectionOf<Value extends Node>(data: Node, field: string, module: SyncModule): ConnectionResult<Value> {
  const connection = recordValue(data[field])
  if (!connection) throw new AppError('DEPENDENCY_ERROR', `Shopify ${module} response did not contain ${field}`, 502, { module, field })
  const nodes = connectionEdges(connection).map((edge) => edge as Value)
  const pageInfo = recordValue(connection.pageInfo)
  const hasNextPage = pageInfo?.hasNextPage === true
  const endCursor = str(pageInfo?.endCursor)
  return { nodes, nextCursor: hasNextPage && endCursor ? GRAPHQL_CURSOR_PREFIX + endCursor : null }
}

function connectionEdges(value: unknown): readonly Node[] {
  const connection = recordValue(value)
  if (!connection) return []
  return arrayValue(connection.edges).flatMap((edge) => {
    const node = recordValue(edge.node)
    return node ? [node] : []
  })
}

function shopMoney(value: unknown): Node | null {
  const set = recordValue(value)
  return recordValue(set?.shopMoney)
}

function shopMoneyAmount(value: unknown): string | null {
  return str(shopMoney(value)?.amount)
}

function shopMoneyCurrency(value: unknown): string | null {
  return str(shopMoney(value)?.currencyCode)
}

/** MoneyBag → the REST `{ shop_money: { amount, currency_code } }` shape. */
function moneySetRest(value: unknown): Node | null {
  const money = shopMoney(value)
  if (!money) return null
  return { shop_money: { amount: str(money.amount), currency_code: str(money.currencyCode) } }
}

function quantityNamed(value: unknown, name: string): number | null {
  const quantity = arrayValue(value).find((entry) => entry.name === name)
  if (!quantity || typeof quantity.quantity !== 'number') return null
  return quantity.quantity
}

function selectedOption(variant: Node, position: number): string | null {
  const options = arrayValue(variant.selectedOptions)
  const option = options[position - 1]
  return option ? str(option.value) : null
}

/** GraphQL enums (`PAID`, `FULFILLED`) → REST lowercase values (`paid`). */
function lower(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.toLowerCase() : null
}

/**
 * REST used `fulfilled` / `partial` / `restocked` (or null for unfulfilled and
 * in-progress orders); analytics matches on exactly those literals.
 */
function fulfillmentStatus(value: unknown): string | null {
  const status = lower(value)
  if (status === 'fulfilled' || status === 'partial' || status === 'restocked') return status
  return null
}

function tagsCsv(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  // GraphQL tags are a `[String!]!` list; REST payloads carried one CSV string.
  const tags = stringArray(value)
  return tags.length > 0 ? tags.join(',') : null
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function recordValue(value: unknown): Node | null {
  return isRecord(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function arrayValue(value: unknown): readonly Node[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resumeCursor(cursor: string | null): string | null {
  if (!cursor) return null
  return cursor.startsWith(GRAPHQL_CURSOR_PREFIX) ? stripCursorPrefix(cursor) : null
}

function stripCursorPrefix(cursor: string): string | null {
  const stripped = cursor.startsWith(GRAPHQL_CURSOR_PREFIX) ? cursor.slice(GRAPHQL_CURSOR_PREFIX.length) : cursor
  return stripped || null
}
