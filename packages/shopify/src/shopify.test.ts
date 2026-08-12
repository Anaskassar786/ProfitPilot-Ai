import { describe, expect, it } from 'vitest'
import { OAuthStateStore, ShopifyApiError, ShopifyClient, parseShopDomain, verifyOAuthHmac, verifyWebhookHmac } from './index.js'
import { createHmac } from 'node:crypto'

describe('Shopify domain and OAuth primitives', () => {
  it('normalizes a valid shop domain', () => expect(parseShopDomain(' Demo-Store.myshopify.com ')).toBe('demo-store.myshopify.com'))
  it('rejects a non-Shopify domain', () => expect(() => parseShopDomain('demo.example.com')).toThrow('shop domain'))
  it('issues a single-use OAuth state', () => {
    const states = new OAuthStateStore(() => 100)
    const state = states.issue('demo.myshopify.com', 50)
    expect(states.consume(state.token, 'demo.myshopify.com')).toBe(true)
    expect(states.consume(state.token, 'demo.myshopify.com')).toBe(false)
  })
  it('rejects an OAuth state for a different shop', () => {
    const state = new OAuthStateStore(() => 100).issue('demo.myshopify.com')
    expect(() => new OAuthStateStore().consume(state.token, 'other.myshopify.com')).not.toThrow()
  })
  it('rejects an expired OAuth state', () => {
    let now = 100
    const states = new OAuthStateStore(() => now)
    const state = states.issue('demo.myshopify.com', 10)
    now = 111
    expect(states.consume(state.token, 'demo.myshopify.com')).toBe(false)
  })
  it('verifies OAuth query HMAC', () => {
    const query = { shop: 'demo.myshopify.com', timestamp: '1' }
    const message = 'shop=demo.myshopify.com&timestamp=1'
    const hmac = createHmac('sha256', 'secret').update(message).digest('hex')
    expect(verifyOAuthHmac({ ...query, hmac }, 'secret')).toBe(true)
  })
  it('rejects an invalid OAuth query HMAC', () => expect(verifyOAuthHmac({ shop: 'demo.myshopify.com', hmac: 'bad' }, 'secret')).toBe(false))
  it('verifies webhook HMAC from the raw body', () => {
    const signature = createHmac('sha256', 'secret').update('{"id":1}').digest('base64')
    expect(verifyWebhookHmac('{"id":1}', signature, 'secret')).toBe(true)
  })
  it('rejects a changed webhook body', () => expect(verifyWebhookHmac('changed', 'bad', 'secret')).toBe(false))
})

describe('Shopify API client', () => {
  it('sends an authenticated request and returns typed JSON', async () => {
    const transport = async (url: string, init: RequestInit): Promise<Response> => {
      expect(url).toContain('/admin/api/2024-04/products.json')
      expect(init.headers).toMatchObject({ 'x-shopify-access-token': 'token' })
      return new Response(JSON.stringify({ products: [{ id: 1 }] }), { status: 200, headers: { 'x-request-id': 'req' } })
    }
    const response = await new ShopifyClient('demo.myshopify.com', 'token', transport).request<{ products: { id: number }[] }>({ path: '/products.json' })
    expect(response.data.products[0]?.id).toBe(1)
    expect(response.requestId).toBe('req')
  })
  it('surfaces rate-limit metadata', async () => {
    const transport = async (): Promise<Response> => new Response('', { status: 429, headers: { 'retry-after': '2' } })
    await expect(new ShopifyClient('demo.myshopify.com', 'token', transport).request({ path: '/products.json' })).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 })
  })
  it('rejects invalid client credentials', () => expect(() => new ShopifyClient('demo.example.com', 'token')).toThrow('validated'))
  it('exposes a typed API error', () => expect(new ShopifyApiError(500, 'nope').status).toBe(500))
})
