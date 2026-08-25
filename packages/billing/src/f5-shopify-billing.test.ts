import { describe, expect, it, vi } from 'vitest'
import { ShopifyBillingClient, ShopifyBillingError, APP_SUBSCRIPTION_CREATE_MUTATION, isTestChargeOnlyRejection, shouldForceTestCharge } from './shopify-billing.js'

function isShopProbe(init: RequestInit | undefined): boolean {
  if (!init?.body) return false
  try {
    const body = JSON.parse(String(init.body)) as { query?: unknown }
    return typeof body.query === 'string' && body.query.includes('ShopProbe')
  } catch {
    return false
  }
}

function shopProbeResponse(displayName: string, partnerDevelopment = false): Response {
  return new Response(JSON.stringify({
    data: {
      shop: {
        name: 'Demo',
        myshopifyDomain: 'demo.myshopify.com',
        plan: { displayName, partnerDevelopment, shopifyPlus: displayName.toLowerCase().includes('plus') },
      },
    },
  }), { status: 200 })
}

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

describe('test flag is hardcoded from SHOPIFY_BILLING_FORCE_LIVE (2026-08-25 mandatory fix)', () => {
  // The `test` GraphQL variable is now decided by a single hardcoded
  // expression at the mutation-payload site: FORCE_LIVE unset → true,
  // FORCE_LIVE=true → false. No shop-plan probe runs from
  // createRecurringCharge, no NODE_ENV checks, no testMode config.
  it('sends a live charge (test:false) with NO shop probe when SHOPIFY_BILLING_FORCE_LIVE=true', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SHOPIFY_BILLING_FORCE_LIVE', 'true')
    vi.stubEnv('SHOPIFY_BILLING_TEST', 'false')
    const queries: string[] = []
    let body: { variables: { test: boolean } } | undefined
    try {
      const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (_url, init) => {
        if (isShopProbe(init)) {
          queries.push(String((JSON.parse(String(init.body)) as { query: string }).query))
          return shopProbeResponse('Developer Preview', true)
        }
        body = JSON.parse(String(init.body))
        return new Response(JSON.stringify(graphqlCreate), { status: 201 })
      } })
      await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
      expect(body?.variables.test).toBe(false)
      expect(queries).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('sends live charges deterministically when FORCE_LIVE is set (no probe, no cache)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SHOPIFY_BILLING_FORCE_LIVE', 'true')
    vi.stubEnv('SHOPIFY_BILLING_TEST', 'false')
    let shopLookups = 0
    let body: { variables: { test: boolean } } | undefined
    try {
      const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (_url, init) => {
        if (isShopProbe(init)) { shopLookups += 1; return shopProbeResponse('Shopify Plus') }
        body = JSON.parse(String(init.body))
        return new Response(JSON.stringify(graphqlCreate), { status: 201 })
      } })
      await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
      await client.createRecurringCharge('GROWTH', 'ANNUAL', 'https://app.example/return', 14)
      expect(body?.variables.test).toBe(false)
      expect(shopLookups).toBe(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('forces test:true without any shop probe outside production (NODE_ENV)', async () => {
    expect(process.env.NODE_ENV).not.toBe('production')
    const probes: string[] = []
    let body: { variables: { test: boolean } } | undefined
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (_url, init) => {
      if (isShopProbe(init)) { probes.push('probe'); return shopProbeResponse('Shopify Plus') }
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify(graphqlCreate), { status: 201 })
    } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(body?.variables.test).toBe(true)
    expect(probes).toEqual([])
  })
  it('sends test:true by default with no shop probe (Railway: NODE_ENV=production, FORCE_LIVE unset)', async () => {
    // The exact Railway deployment shape: NODE_ENV=production but no
    // SHOPIFY_BILLING_FORCE_LIVE. The mutation MUST go out as test:true
    // regardless of what a shop-plan probe would answer (even a failing one).
    vi.stubEnv('NODE_ENV', 'production')
    let probeAttempts = 0
    let body: { variables: { test: boolean } } | undefined
    try {
      const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (_url, init) => {
        if (isShopProbe(init)) { probeAttempts += 1; return new Response('', { status: 403 }) }
        body = JSON.parse(String(init.body))
        return new Response(JSON.stringify(graphqlCreate), { status: 201 })
      } })
      await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
      expect(body?.variables.test).toBe(true)
      expect(probeAttempts).toBe(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('never performs a shop lookup when the mode is explicit', async () => {
    const probes: string[] = []
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, transport: async (_url, init) => {
      if (isShopProbe(init)) probes.push('shop')
      return new Response(JSON.stringify(graphqlCreate), { status: 201 })
    } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(probes).toEqual([])
  })
})

describe('shouldForceTestCharge', () => {
  it('forces test charges for *.myshopify.com stores in production', () => {
    expect(shouldForceTestCharge('demo.myshopify.com', { NODE_ENV: 'production' })).toBe(true)
  })
  it('forces test charges outside production regardless of domain', () => {
    expect(shouldForceTestCharge('shop.example.com', { NODE_ENV: 'test' })).toBe(true)
  })
  it('forces test charges when SHOPIFY_BILLING_TEST=true', () => {
    expect(shouldForceTestCharge('shop.example.com', { NODE_ENV: 'production', SHOPIFY_BILLING_TEST: 'true' })).toBe(true)
  })
  it('defers to the shop probe when SHOPIFY_BILLING_TEST=false', () => {
    expect(shouldForceTestCharge('demo.myshopify.com', { NODE_ENV: 'production', SHOPIFY_BILLING_TEST: 'false' })).toBe(false)
  })
})

describe('automatic test-charge retry fallback (test-charge-only rejections)', () => {
  // The exact failure live dev stores still produce: a non-test charge is
  // rejected because the shop can only accept test charges.
  const testChargeOnlyUserErrors = {
    data: {
      appSubscriptionCreate: {
        userErrors: [{ field: ['test'], message: 'Custom apps cannot use the Billing API and can only accept test charges' }],
        confirmationUrl: null,
        appSubscription: null,
      },
    },
  }
  const testChargeOnlyHttp422 = {
    errors: { test: ['Custom apps cannot use the Billing API and can only accept test charges'] },
  }

  it('retries with test:true when a live charge is rejected as test-charge-only (GraphQL userErrors)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SHOPIFY_BILLING_FORCE_LIVE', 'true')
    const attempts: boolean[] = []
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    try {
      const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, logger, transport: async (_url, init) => {
        const test = Boolean((JSON.parse(String(init.body)) as { variables: { test: boolean } }).variables.test)
        attempts.push(test)
        if (test) return new Response(JSON.stringify(graphqlCreate), { status: 201 })
        return new Response(JSON.stringify(testChargeOnlyUserErrors), { status: 200 })
      } })
      const result = await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
      expect(result.id).toBe('gid://shopify/AppSubscription/1')
      expect(attempts).toEqual([false, true])
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('test: true'), expect.objectContaining({ shop: 'demo.myshopify.com' }))
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('retries with test:true on an HTTP-level test-charge-only 422', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SHOPIFY_BILLING_FORCE_LIVE', 'true')
    const attempts: boolean[] = []
    try {
      const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, transport: async (_url, init) => {
        const test = Boolean((JSON.parse(String(init.body)) as { variables: { test: boolean } }).variables.test)
        attempts.push(test)
        if (test) return new Response(JSON.stringify(graphqlCreate), { status: 201 })
        return new Response(JSON.stringify(testChargeOnlyHttp422), { status: 422 })
      } })
      const result = await client.createRecurringCharge('START', 'MONTHLY', 'https://app.example/return', 0)
      expect(result.id).toBe('gid://shopify/AppSubscription/1')
      expect(attempts).toEqual([false, true])
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('does not retry unrelated 422 validation failures (price)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SHOPIFY_BILLING_FORCE_LIVE', 'true')
    const attempts: boolean[] = []
    try {
      const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, transport: async (_url, init) => {
        const test = Boolean((JSON.parse(String(init.body)) as { variables: { test: boolean } }).variables.test)
        attempts.push(test)
        return new Response(JSON.stringify({ data: { appSubscriptionCreate: { userErrors: [{ field: ['price'], message: 'must be greater than zero' }], confirmationUrl: null, appSubscription: null } } }), { status: 200 })
      } })
      await expect(client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)).rejects.toThrow('must be greater than zero')
      expect(attempts).toEqual([false])
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('never retries a charge that was already sent as test', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const attempts: boolean[] = []
    try {
      const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async (_url, init) => {
        const test = Boolean((JSON.parse(String(init.body)) as { variables: { test: boolean } }).variables.test)
        attempts.push(test)
        return new Response(JSON.stringify(testChargeOnlyUserErrors), { status: 200 })
      } })
      await expect(client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)).rejects.toBeInstanceOf(ShopifyBillingError)
      expect(attempts).toEqual([true])
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('recognizes only the specific test-charge rejections', () => {
    expect(isTestChargeOnlyRejection(new ShopifyBillingError(422, 'Shopify Billing API failed with 422 on /graphql.json — test: Custom apps cannot use the Billing API and can only accept test charges', {}, 'x'))).toBe(true)
    expect(isTestChargeOnlyRejection(new ShopifyBillingError(422, 'can only accept test charges', {}, ''))).toBe(true)
    expect(isTestChargeOnlyRejection(new ShopifyBillingError(422, 'Development and partner-test stores can only accept test charges', {}, ''))).toBe(true)
    expect(isTestChargeOnlyRejection(new ShopifyBillingError(422, 'This type of store can only accept test charges', {}, ''))).toBe(true)
    expect(isTestChargeOnlyRejection(new ShopifyBillingError(422, 'Development stores cannot use the Billing API', {}, ''))).toBe(false)
    expect(isTestChargeOnlyRejection(new ShopifyBillingError(422, 'price: must be greater than zero', { price: ['must be greater than zero'] }, ''))).toBe(false)
    expect(isTestChargeOnlyRejection(new Error('boom'))).toBe(false)
    expect(isTestChargeOnlyRejection(null)).toBe(false)
  })
  it('auto-retries with test:true for ALL plans ($79 Start, $199 Growth, $399 Commander)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SHOPIFY_BILLING_FORCE_LIVE', 'true')
    try {
      for (const [plan, expectedPrice] of [['START', 79], ['GROWTH', 199], ['COMMANDER', 399]] as const) {
        const attempts: { test: boolean; price: number }[] = []
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, logger, transport: async (_url, init) => {
          const body = JSON.parse(String(init.body)) as { variables: { test: boolean; lineItems: { plan: { appRecurringPricingDetails: { price: { amount: number } } } }[] } }
          const test = body.variables.test
          const price = body.variables.lineItems[0]!.plan.appRecurringPricingDetails.price.amount
          attempts.push({ test, price })
          if (test) return new Response(JSON.stringify(graphqlCreate), { status: 201 })
          return new Response(JSON.stringify(testChargeOnlyUserErrors), { status: 200 })
        } })
        const result = await client.createRecurringCharge(plan, 'MONTHLY', 'https://app.example/return', 14)
        expect(result.id).toBe('gid://shopify/AppSubscription/1')
        expect(attempts).toEqual([{ test: false, price: expectedPrice }, { test: true, price: expectedPrice }])
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('test: true'), expect.objectContaining({ plan }))
      }
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('auto-retries in production with testMode:auto when shop probe says billable but Shopify rejects', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SHOPIFY_BILLING_FORCE_LIVE', 'true')
    vi.stubEnv('SHOPIFY_BILLING_TEST', 'false')
    const attempts: boolean[] = []
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    try {
      const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', logger, transport: async (_url, init) => {
        if (isShopProbe(init)) return shopProbeResponse('Shopify Plus', false)
        const test = Boolean((JSON.parse(String(init.body)) as { variables: { test: boolean } }).variables.test)
        attempts.push(test)
        if (test) return new Response(JSON.stringify(graphqlCreate), { status: 201 })
        return new Response(JSON.stringify(testChargeOnlyUserErrors), { status: 200 })
      } })
      const result = await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
      expect(result.id).toBe('gid://shopify/AppSubscription/1')
      expect(attempts).toEqual([false, true])
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('test: true'), expect.objectContaining({ shop: 'demo.myshopify.com' }))
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
