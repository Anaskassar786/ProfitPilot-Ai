import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { Logger } from '@profitpilot/logger'
import { InMemoryTokenRecordStore, OAuthStateStore, ShopifyInstallService, TokenVault } from '@profitpilot/shopify'
import { createApi } from './app.js'
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
  it('completes the callback route with HMAC and state', async () => {
    const service = installer()
    const start = service.start('demo.myshopify.com')
    const fields = { shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '1' }
    const message = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)).map(([keyName, value]) => `${keyName}=${value}`).join('&')
    const callback = new URLSearchParams({ ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') })
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shopify/callback?${callback.toString()}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, installed: true })
    })
  })
})
