import { describe, expect, it, vi } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { InMemoryTokenRecordStore, InMemoryWebhookReceiptStore, OAuthStateStore, ShopifyApiError, ShopifyClient, ShopifyInstallService, TokenVault, WebhookVerifier, isShopifyApiError, isShopifyAuthError, parseShopDomain, verifyOAuthHmac, verifyWebhookHmac } from './index.js'
import { createHmac } from 'node:crypto'

describe('Shopify domain and OAuth primitives', () => {
  it('normalizes a valid shop domain', () => expect(parseShopDomain(' Demo-Store.myshopify.com ')).toBe('demo-store.myshopify.com'))
  it('rejects a non-Shopify domain', () => expect(() => parseShopDomain('demo.example.com')).toThrow('shop domain'))
  it('issues a single-use OAuth state', async () => {
    const states = new OAuthStateStore(() => 100)
    const state = await states.issue('demo.myshopify.com', 50)
    expect(await states.consume(state.token, 'demo.myshopify.com')).toBe(true)
    expect(await states.consume(state.token, 'demo.myshopify.com')).toBe(false)
  })
  it('rejects an OAuth state for a different shop', async () => {
    const states = new OAuthStateStore(() => 100)
    const state = await states.issue('demo.myshopify.com')
    await expect(states.consume(state.token, 'other.myshopify.com')).resolves.toBe(false)
  })
  it('rejects an expired OAuth state', async () => {
    let now = 100
    const states = new OAuthStateStore(() => now)
    const state = await states.issue('demo.myshopify.com', 10)
    now = 111
    expect(await states.consume(state.token, 'demo.myshopify.com')).toBe(false)
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
      expect(url).toContain('/admin/api/2026-07/products.json')
      expect(init.headers).toMatchObject({ 'x-shopify-access-token': 'shpat_test_secret_token_123' })
      return new Response(JSON.stringify({ products: [{ id: 1 }] }), { status: 200, headers: { 'x-request-id': 'req' } })
    }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const response = await new ShopifyClient('demo.myshopify.com', 'shpat_test_secret_token_123', transport, '2026-07', logger).request<{ products: { id: number }[] }>({ path: '/products.json' })
    expect(response.data.products[0]?.id).toBe(1)
    expect(response.requestId).toBe('req')
    expect(logger.info).toHaveBeenCalledWith('Shopify Admin API outbound request', expect.objectContaining({
      shopDomain: 'demo.myshopify.com',
      endpoint: '/products.json',
      tokenPresent: true,
      tokenMasked: 'shpat_..._123',
    }))
    expect(logger.info).toHaveBeenCalledWith('Shopify Admin API request succeeded', expect.objectContaining({
      status: 200,
      requestId: 'req',
    }))
  })
  it('surfaces rate-limit metadata', async () => {
    const transport = async (): Promise<Response> => new Response('', { status: 429, headers: { 'retry-after': '2' } })
    await expect(new ShopifyClient('demo.myshopify.com', 'token', transport).request({ path: '/products.json' })).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 })
  })
  it('rejects invalid client credentials', () => expect(() => new ShopifyClient('demo.example.com', 'token')).toThrow('validated'))
  it('exposes a typed API error', () => expect(new ShopifyApiError(500, 'nope').status).toBe(500))
  it('duck-types ShopifyApiError and 401 auth errors across package boundaries', () => {
    const realError = new ShopifyApiError(401, 'unauthorized')
    const duckError = Object.assign(new Error('unauthorized'), { name: 'ShopifyApiError', status: 401 })
    const duck500 = { name: 'ShopifyApiError', status: 500 }
    const statusOnly401 = { status: 401, message: 'Shopify API request failed with 401' }

    expect(isShopifyApiError(realError)).toBe(true)
    expect(isShopifyApiError(duckError)).toBe(true)
    expect(isShopifyApiError(duck500)).toBe(true)
    expect(isShopifyApiError(new Error('other'))).toBe(false)

    expect(isShopifyAuthError(realError)).toBe(true)
    expect(isShopifyAuthError(duckError)).toBe(true)
    expect(isShopifyAuthError(statusOnly401)).toBe(true)
    expect(isShopifyAuthError(duck500)).toBe(false)
  })
})
