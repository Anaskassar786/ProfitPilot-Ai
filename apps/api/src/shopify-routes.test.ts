import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { Logger } from '@profitpilot/logger'
import { InMemoryTokenRecordStore, InMemoryWebhookProcessingLedger, OAuthStateStore, ShopifyInstallService, TokenVault, WebhookProcessor, WebhookVerifier } from '@profitpilot/shopify'
import { createApi } from './app.js'
import { storeId } from '@profitpilot/types'
import type { Express } from 'express'

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const secret = 'shopify-secret'

async function withServer<T>(app: Express, handler: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP address')
  try {
    return await handler(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function installer(): ShopifyInstallService {
  return new ShopifyInstallService({ apiKey: 'api-key', apiSecret: secret, scopes: ['read_products'], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(), new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
}

describe('Shopify install API routes', () => {
  it('rejects an install request without a shop', async () => {
    const app = createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: installer(), exchange: async () => 'token' } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test address')
    const response = await fetch(`http://127.0.0.1:${address.port}/shopify/install`)
    expect(response.status).toBe(400)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  it('redirects a valid install request to Shopify', async () => {
    const app = createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: installer(), exchange: async () => 'token' } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test address')
    const response = await fetch(`http://127.0.0.1:${address.port}/shopify/install?shop=demo.myshopify.com`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('demo.myshopify.com/admin/oauth/authorize')
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  it('completes the callback route with HMAC and state, then redirects into the embedded app', async () => {
    const service = installer()
    const start = await service.start('demo.myshopify.com')
    const fields = { shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '1', host: Buffer.from('admin.shopify.com/store/demo', 'utf8').toString('base64') }
    const message = Object.entries(fields).sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1)).map(([keyName, value]) => `${keyName}=${value}`).join('&')
    const callback = new URLSearchParams({ ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') })
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shopify/callback?${callback.toString()}`, { redirect: 'manual' })
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('https://admin.shopify.com/store/demo/apps/api-key')
    })
  })

  it('fails the callback with the exact failing step instead of a bare 500', async () => {
    const service = installer()
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const fields = { shop: 'demo.myshopify.com', state: 'unknown-state', code: 'code', timestamp: '1' }
      const message = Object.entries(fields).sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1)).map(([keyName, value]) => `${keyName}=${value}`).join('&')
      const validHmacUnknownState = new URLSearchParams({ ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') })
      const stateFailure = await fetch(`${baseUrl}/shopify/callback?${validHmacUnknownState.toString()}`, { redirect: 'manual' })
      expect(stateFailure.status).toBe(401)
      expect(await stateFailure.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED', details: { step: 'state-verification' } } })

      const tampered = new URLSearchParams({ ...fields, hmac: 'deadbeef' })
      const hmacFailure = await fetch(`${baseUrl}/shopify/callback?${tampered.toString()}`, { redirect: 'manual' })
      expect(hmacFailure.status).toBe(401)
      expect(await hmacFailure.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED', details: { step: 'hmac-verification' } } })
    })
  })

  it('maps a token-exchange outage to 502 with a token-exchange step', async () => {
    const service = installer()
    const start = await service.start('demo.myshopify.com')
    const fields = { shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '1' }
    const message = Object.entries(fields).sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1)).map(([keyName, value]) => `${keyName}=${value}`).join('&')
    const callback = new URLSearchParams({ ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') })
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => { throw new Error('Shopify OAuth token exchange failed with HTTP 404') } } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shopify/callback?${callback.toString()}`, { redirect: 'manual' })
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_ERROR', details: { step: 'token-exchange' } } })
    })
  })

  it('validates HMAC before accepting an HTTP webhook and dedupes replay', async () => {
    const service = installer()
    const ledger = new InMemoryWebhookProcessingLedger()
    const processor = new WebhookProcessor(new WebhookVerifier(secret, ledger), ledger)
    const app = createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token', webhook: { processor, storeIdForShop: async () => storeId('store-1'), handle: async () => Promise.resolve() } } })
    await withServer(app, async (baseUrl) => {
      const body = JSON.stringify({ id: 1 })
      const signature = createHmac('sha256', secret).update(body).digest('base64')
      const headers = { 'content-type': 'application/json', 'x-shopify-shop-domain': 'demo.myshopify.com', 'x-shopify-webhook-id': 'webhook-1', 'x-shopify-topic': 'orders/create', 'x-shopify-hmac-sha256': signature }
      const first = await fetch(`${baseUrl}/shopify/webhooks`, { method: 'POST', headers, body })
      expect(first.status).toBe(200)
      const replay = await fetch(`${baseUrl}/shopify/webhooks`, { method: 'POST', headers, body })
      expect((await replay.json()).status).toBe('deduped')
      const invalid = await fetch(`${baseUrl}/shopify/webhooks`, { method: 'POST', headers: { ...headers, 'x-shopify-webhook-id': 'webhook-2', 'x-shopify-hmac-sha256': 'bad' }, body })
      expect(invalid.status).toBe(401)
    })
  })
})
