import { describe, expect, it } from 'vitest'
import { ShopifyBillingClient, ShopifyBillingError } from './shopify-billing.js'

const charge = { recurring_application_charge: { id: 1, name: 'GROWTH MONTHLY', price: '149.0', status: 'active', confirmation_url: 'https://shopify/confirm', billing_on: '2024-06-12', trial_days: 14, test: true, created_at: '2024-01-01' } }

describe('Shopify Recurring Application Charges', () => {
  it('creates a recurring charge with test mode and trial', async () => {
    let request: RequestInit | undefined
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', testMode: true, transport: async (_url, init) => { request = init; return new Response(JSON.stringify(charge), { status: 201 }) } })
    const result = await client.createRecurringCharge('GROWTH', 'MONTHLY', 'https://app.example/return', 14)
    expect(result.id).toBe('1')
    expect(JSON.parse(String(request?.body))).toMatchObject({ recurring_application_charge: { price: '149', test: true, trial_days: 14 } })
  })
  it('verifies live charge status, name, and price', async () => {
    const client = new ShopifyBillingClient({ shop: 'demo.myshopify.com', accessToken: 'token', transport: async () => new Response(JSON.stringify(charge), { status: 200 }) })
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
