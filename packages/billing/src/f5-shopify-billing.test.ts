import { describe, expect, it, vi } from 'vitest'
import { ShopifyBillingClient, ShopifyBillingError } from './shopify-billing.js'

const charge = { recurring_application_charge: { id: 1, name: 'GROWTH MONTHLY', price: '149.0', status: 'active', confirmation_url: 'https://shopify/confirm', billing_on: '2024-06-12', trial_days: 14, test: true, created_at: '2024-01-01' } }

describe('Shopify Recurring Application Charges', () => {
  it('creates a recurring charge with test mode and trial', async () => {
    let request: RequestInit | undefined
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'shpat_my_secret_token_456', testMode: true, logger, transport: async (_url, init) => { request = init; return new Response(JSON.stringify(charge), { status: 201 }) } })
    const result = await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(result.id).toBe('1')
    expect(JSON.parse(String(request?.body))).toMatchObject({ recurring_application_charge: { price: '149.00', test: true, trial_days: 14 } })
    expect(logger.info).toHaveBeenCalledWith('Shopify Billing API charge request', expect.objectContaining({
      shop: 'demo.myshopify.com',
      endpoint: '/recurring_application_charges.json',
      plan: 'GROWTH',
      interval: 'MONTHLY',
      test: true,
      tokenMasked: 'shpat_..._456',
    }))
  })
  it('verifies live charge status, name, and price', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, transport: async () => new Response(JSON.stringify(charge), { status: 200 }) })
    expect((await client.verifyCharge('1', { plan: 'GROWTH', interval: 'MONTHLY' })).status).toBe('active')
  })
  it('rejects an unverified charge mismatch', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify({ recurring_application_charge: { ...charge.recurring_application_charge, price: '1' } }), { status: 200 }) })
    await expect(client.verifyCharge('1', { plan: 'GROWTH', interval: 'MONTHLY' })).rejects.toThrow('verification failed')
  })
  it('surfaces Shopify billing HTTP failures', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response('', { status: 500 }) })
    await expect(client.getCharge('1')).rejects.toBeInstanceOf(ShopifyBillingError)
  })
  it('rejects unsafe return URLs and credentials', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify(charge)) })
    await expect(client.createRecurringCharge('START', 'MONTHLY', '/relative', 14)).rejects.toThrow('absolute')
    expect(() => new ShopifyBillingClient({ shop: 'example.com', accessToken: 'token' })).toThrow('incomplete')
  })
  it('maps unknown remote statuses to pending', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify({ recurring_application_charge: { ...charge.recurring_application_charge, status: 'weird' } })) })
    expect((await client.getCharge('1')).status).toBe('pending')
  })
  it('rejects a malformed remote charge payload', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify({})) })
    await expect(client.getCharge('1')).rejects.toThrow('missing charge')
  })
})

describe('Shopify billing 422 diagnostics and payload shape', () => {
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
  it('sends a two-decimal price string and omits a zero trial', async () => {
    let body: unknown
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async (_url, init) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify(charge), { status: 201 }) } })
    await client.createRecurringCharge('START', 'MONTHLY', 'https://app.example/return', 0)
    expect(body).toEqual({ recurring_application_charge: { name: 'START MONTHLY', price: '49.00', return_url: 'https://app.example/return', test: true } })
  })
  it('uses the configured Admin API version', async () => {
    let requested = ''
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, apiVersion: '2025-10', transport: async (url) => { requested = url; return new Response(JSON.stringify(charge), { status: 201 }) } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(requested).toBe('https://demo.myshopify.com/admin/api/2025-10/recurring_application_charges.json')
  })
})

describe('automatic test-charge detection', () => {
  it('forces test:true on a development store', async () => {
    const urls: string[] = []
    let body: unknown
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (url, init) => {
      urls.push(url)
      if (url.includes('/shop.json')) return new Response(JSON.stringify({ shop: { plan_name: 'partner_test' } }), { status: 200 })
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify(charge), { status: 201 })
    } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(body).toMatchObject({ recurring_application_charge: { test: true } })
    expect(urls.some((url) => url.includes('/shop.json'))).toBe(true)
  })
  it('allows a live charge on a paid store and caches the lookup', async () => {
    let shopLookups = 0
    let body: unknown
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (url, init) => {
      if (url.includes('/shop.json')) { shopLookups += 1; return new Response(JSON.stringify({ shop: { plan_name: 'shopify_plus' } }), { status: 200 }) }
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify(charge), { status: 201 })
    } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    await client.createRecurringCharge('GROWTH', 'ANNUAL', 'https://app.example/return', 14)
    expect(body).toMatchObject({ recurring_application_charge: { test: false } })
    expect(shopLookups).toBe(1)
  })
  it('falls back to a test charge when the shop lookup fails', async () => {
    let body: unknown
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async (url, init) => {
      if (url.includes('/shop.json')) return new Response('', { status: 403 })
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify(charge), { status: 201 })
    } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(body).toMatchObject({ recurring_application_charge: { test: true } })
  })
  it('never performs a shop lookup when the mode is explicit', async () => {
    const urls: string[] = []
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: false, transport: async (url) => { urls.push(url); return new Response(JSON.stringify(charge), { status: 201 }) } })
    await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(urls.some((url) => url.includes('/shop.json'))).toBe(false)
  })
})
