import { describe, expect, it, vi } from 'vitest'
import { ShopifyBillingClient, ShopifyBillingError, APP_SUBSCRIPTION_CREATE_MUTATION } from './shopify-billing.js'

const graphqlCreate = {
  data: {
    appSubscriptionCreate: {
      userErrors: [],
      confirmationUrl: 'https://shopify/confirm',
      appSubscription: {
        id: 'gid://shopify/AppSubscription/1',
        status: 'PENDING',
        name: 'GROWTH MONTHLY',
        createdAt: '2024-01-01',
        currentPeriodEnd: '2024-06-12',
        trialDays: 14,
        test: true,
        lineItems: [{ plan: { pricingDetails: { price: { amount: 199 }, interval: 'EVERY_30_DAYS' } } }],
      },
    },
  },
}

const graphqlActive = {
  data: {
    node: {
      id: 'gid://shopify/AppSubscription/1',
      status: 'ACTIVE',
      name: 'GROWTH MONTHLY',
      createdAt: '2024-01-01',
      currentPeriodEnd: '2024-06-12',
      trialDays: 14,
      test: true,
      lineItems: [{ plan: { pricingDetails: { price: { amount: 199 }, interval: 'EVERY_30_DAYS' } } }],
    },
  },
}

describe('Shopify GraphQL app subscriptions', () => {
  it('creates a recurring charge with GraphQL appSubscriptionCreate, test mode and trial', async () => {
    let request: RequestInit | undefined
    let url = ''
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'shpat_my_secret_token_456', testMode: true, logger, transport: async (requested, init) => { url = requested; request = init; return new Response(JSON.stringify(graphqlCreate), { status: 200 }) } })
    const result = await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(result.id).toBe('gid://shopify/AppSubscription/1')
    const body = JSON.parse(String(request?.body)) as { query: string; variables: Record<string, unknown> }
    expect(body.query).toContain('appSubscriptionCreate')
    expect(body.query.replace(/\s+/g, ' ')).toContain(APP_SUBSCRIPTION_CREATE_MUTATION.replace(/\s+/g, ' ').slice(0, 40))
    expect(body.variables).toMatchObject({
      name: 'GROWTH MONTHLY',
      returnUrl: 'https://app.example/return',
      test: true,
      trialDays: 14,
      lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: 199, currencyCode: 'USD' }, interval: 'EVERY_30_DAYS' } } }],
    })
    expect(url).toBe('https://demo.myshopify.com/admin/api/2026-07/graphql.json')
    expect(logger.info).toHaveBeenCalledWith('Shopify Billing API charge request', expect.objectContaining({
      shop: 'demo.myshopify.com',
      endpoint: '/graphql.json',
      mutation: 'appSubscriptionCreate',
      plan: 'GROWTH',
      interval: 'MONTHLY',
      test: true,
      tokenMasked: 'shpat_..._456',
    }))
  })
  it('maps Start/Growth/Commander monthly prices onto GraphQL line items', async () => {
    const amounts: number[] = []
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async (_url, init) => {
      amounts.push(Number((JSON.parse(String(init.body)) as { variables: { lineItems: { plan: { appRecurringPricingDetails: { price: { amount: number } } } }[] } }).variables.lineItems[0]!.plan.appRecurringPricingDetails.price.amount))
      return new Response(JSON.stringify(graphqlCreate), { status: 200 })
    } })
    await client.createRecurringCharge('START', 'MONTHLY', 'https://app.example/return', 0)
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 0)
    await client.createRecurringCharge('COMMANDER', 'MONTHLY', 'https://app.example/return', 0)
    expect(amounts).toEqual([79, 199, 399])
  })
  it('uses ANNUAL interval for yearly plans and omits a zero trial', async () => {
    let body: { variables: Record<string, unknown> } | undefined
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async (_url, init) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify(graphqlCreate), { status: 200 }) } })
    await client.createRecurringCharge('START', 'ANNUAL', 'https://app.example/return', 0)
    expect(body?.variables.trialDays).toBeUndefined()
    expect(body?.variables.test).toBe(true)
    expect((body?.variables.lineItems as { plan: { appRecurringPricingDetails: { interval: string } } }[])[0]?.plan.appRecurringPricingDetails.interval).toBe('ANNUAL')
  })
  it('verifies live GraphQL subscription status', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, transport: async () => new Response(JSON.stringify(graphqlActive), { status: 200 }) })
    expect((await client.verifyCharge('1', { plan: 'GROWTH', interval: 'MONTHLY' })).status).toBe('active')
  })
  it('rejects an unverified charge mismatch', async () => {
    const mismatch = { data: { node: { ...graphqlActive.data.node, name: 'START MONTHLY', lineItems: [{ plan: { pricingDetails: { price: { amount: 1 } } } }] } } }
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify(mismatch), { status: 200 }) })
    await expect(client.verifyCharge('1', { plan: 'GROWTH', interval: 'MONTHLY' })).rejects.toThrow('verification failed')
  })
  it('cancels via appSubscriptionCancel', async () => {
    let body: { query: string } | undefined
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async (_url, init) => {
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ data: { appSubscriptionCancel: { userErrors: [], appSubscription: graphqlActive.data.node } } }), { status: 200 })
    } })
    await client.cancelCharge('gid://shopify/AppSubscription/1')
    expect(body?.query).toContain('appSubscriptionCancel')
  })
  it('surfaces Shopify billing HTTP failures', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response('', { status: 500 }) })
    await expect(client.getCharge('1')).rejects.toBeInstanceOf(ShopifyBillingError)
  })
  it('rejects unsafe return URLs and credentials', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify(graphqlCreate)) })
    await expect(client.createRecurringCharge('START', 'MONTHLY', '/relative', 14)).rejects.toThrow('absolute')
    expect(() => new ShopifyBillingClient({ shop: 'example.com', accessToken: 'token' })).toThrow('incomplete')
  })
  it('maps unknown remote statuses to pending', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify({ data: { node: { ...graphqlActive.data.node, status: 'WEIRD' } } })) })
    expect((await client.getCharge('1')).status).toBe('pending')
  })
  it('rejects a malformed remote charge payload', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify({ data: {} })) })
    await expect(client.getCharge('1')).rejects.toThrow('missing charge')
  })
})

describe('Shopify billing 422 diagnostics and payload shape', () => {
  it('reports GraphQL userErrors as a 422', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async () => new Response(JSON.stringify({ data: { appSubscriptionCreate: { userErrors: [{ field: ['price'], message: 'must be greater than zero' }], confirmationUrl: null, appSubscription: null } } }), { status: 200 }) })
    const failure = await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14).catch((error: unknown) => error as ShopifyBillingError)
    expect(failure).toBeInstanceOf(ShopifyBillingError)
    expect((failure as ShopifyBillingError).status).toBe(422)
    expect((failure as ShopifyBillingError).validationErrors).toEqual({ price: ['must be greater than zero'] })
    expect((failure as ShopifyBillingError).message).toContain('price: must be greater than zero')
  })
  it('reports the exact field errors Shopify returned with a 422', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async () => new Response(JSON.stringify({ errors: { name: ["can't be blank"], price: ['must be greater than zero'] } }), { status: 422 }) })
    const failure = await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14).catch((error: unknown) => error as ShopifyBillingError)
    expect(failure).toBeInstanceOf(ShopifyBillingError)
    expect((failure as ShopifyBillingError).status).toBe(422)
    expect((failure as ShopifyBillingError).validationErrors).toEqual({ name: ["can't be blank"], price: ['must be greater than zero'] })
    expect((failure as ShopifyBillingError).message).toContain('price: must be greater than zero')
    expect((failure as ShopifyBillingError).upstreamBody).toContain('must be greater than zero')
  })
  it('keeps a non-JSON upstream body available for logs', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async () => new Response('<html>gateway</html>', { status: 502 }) })
    const failure = await client.getCharge('1').catch((error: unknown) => error as ShopifyBillingError)
    expect((failure as ShopifyBillingError).upstreamBody).toContain('gateway')
  })
  it('uses the configured Admin API version', async () => {
    let requested = ''
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, apiVersion: '2026-07', transport: async (url) => { requested = url; return new Response(JSON.stringify(graphqlCreate), { status: 201 }) } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(requested).toBe('https://demo.myshopify.com/admin/api/2026-07/graphql.json')
  })
})

describe('automatic test-charge detection', () => {
  it('forces test:true on a development store', async () => {
    const urls: string[] = []
    let body: { variables: { test: boolean } } | undefined
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (url, init) => {
      urls.push(url)
      if (url.includes('/shop.json')) return new Response(JSON.stringify({ shop: { plan_name: 'partner_test' } }), { status: 200 })
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify(graphqlCreate), { status: 201 })
    } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(body?.variables.test).toBe(true)
    expect(urls.some((url) => url.includes('/shop.json'))).toBe(true)
  })
  it('allows a live charge on a paid store and caches the lookup', async () => {
    let shopLookups = 0
    let body: { variables: { test: boolean } } | undefined
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (url, init) => {
      if (url.includes('/shop.json')) { shopLookups += 1; return new Response(JSON.stringify({ shop: { plan_name: 'shopify_plus' } }), { status: 200 }) }
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify(graphqlCreate), { status: 201 })
    } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    await client.createRecurringCharge('GROWTH', 'ANNUAL', 'https://app.example/return', 14)
    expect(body?.variables.test).toBe(false)
    expect(shopLookups).toBe(1)
  })
  it('falls back to a test charge when the shop lookup fails', async () => {
    let body: { variables: { test: boolean } } | undefined
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (url, init) => {
      if (url.includes('/shop.json')) return new Response('', { status: 403 })
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify(graphqlCreate), { status: 201 })
    } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(body?.variables.test).toBe(true)
  })
  it('never performs a shop lookup when the mode is explicit', async () => {
    const urls: string[] = []
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, transport: async (url) => { urls.push(url); return new Response(JSON.stringify(graphqlCreate), { status: 201 }) } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(urls.some((url) => url.includes('/shop.json'))).toBe(false)
  })
})
