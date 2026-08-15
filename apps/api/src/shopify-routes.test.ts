import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { createMemorySink, Logger } from '@profitpilot/logger'
import { InMemoryTokenRecordStore, InMemoryWebhookProcessingLedger, OAuthStateStore, ShopifyInstallService, TokenVault, WebhookProcessor, WebhookVerifier } from '@profitpilot/shopify'
import { InMemoryStoreDirectory } from '@profitpilot/db'
import type { StoreDirectory } from '@profitpilot/db'
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

function installer(directory: StoreDirectory = new InMemoryStoreDirectory()): ShopifyInstallService {
  return new ShopifyInstallService({ apiKey: 'api-key', apiSecret: secret, scopes: ['read_products'], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(), new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()), directory)
}

/** Signs exactly like Shopify's backend: sorted keys, URL-encoded values (the raw query minus hmac). */
function shopifyMessage(fields: Record<string, string>): string {
  return Object.entries(fields).sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1)).map(([keyName, value]) => `${keyName}=${encodeURIComponent(value)}`).join('&')
}

function shopifyHmac(fields: Record<string, string>): string {
  return createHmac('sha256', secret).update(shopifyMessage(fields)).digest('hex')
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
  it('completes the callback route with HMAC and state, then redirects into the embedded app with tenant context', async () => {
    const directory = new InMemoryStoreDirectory()
    const service = installer(directory)
    const start = await service.start('demo.myshopify.com')
    const fields = { shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '1', host: Buffer.from('admin.shopify.com/store/demo', 'utf8').toString('base64') }
    const message = shopifyMessage(fields)
    const callback = new URLSearchParams({ ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') })
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shopify/callback?${callback.toString()}`, { redirect: 'manual' })
      expect(response.status).toBe(302)
      const location = new URL(response.headers.get('location') ?? '')
      expect(location.origin + location.pathname).toBe('https://admin.shopify.com/store/demo/apps/api-key')
      expect(location.searchParams.get('shop')).toBe('demo.myshopify.com')
      expect(location.searchParams.get('host')).toBe(fields.host)
      const tenant = await directory.getByShopDomain('demo.myshopify.com')
      expect(tenant?.storeId).toBeTruthy()
      expect(location.searchParams.get('storeId')).toBe(tenant?.storeId)
    })
  })

  it('accepts a Shopify-signed callback whose encoded values differ from their decoded form (padded base64 host)', async () => {
    const service = installer()
    const start = await service.start('my-demo-shop1.myshopify.com')
    // 38 base64 chars => ends in '=='. Shopify emits `%3D%3D` in the URL and
    // signs the encoded form; the previous decoded-value join 401'd here.
    const host = Buffer.from('admin.shopify.com/store/my-demo-shop1', 'utf8').toString('base64')
    expect(host.endsWith('==')).toBe(true)
    const fields = { shop: 'my-demo-shop1.myshopify.com', state: start.state, code: '6e3714192b241213900f4e1bf8065104', timestamp: '1786224000', host }
    // Build the raw callback query exactly as Shopify emits it over the wire.
    const rawQuery = `${shopifyMessage(fields)}&hmac=${shopifyHmac(fields)}`
    expect(rawQuery).toContain('host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvbXktZGVtby1zaG9wMQ%3D%3D')
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shopify/callback?${rawQuery}`, { redirect: 'manual' })
      expect(response.status).toBe(302)
      const location = new URL(response.headers.get('location') ?? '')
      expect(location.origin + location.pathname).toBe('https://admin.shopify.com/store/my-demo-shop1/apps/api-key')
      expect(location.searchParams.get('shop')).toBe('my-demo-shop1.myshopify.com')
      expect(location.searchParams.get('storeId')).toBeTruthy()
    })
  })

  it('registers the store tenant during a successful callback', async () => {
    const directory = new InMemoryStoreDirectory()
    const service = installer(directory)
    const start = await service.start('commander-pilot.myshopify.com')
    const fields = { shop: 'commander-pilot.myshopify.com', state: start.state, code: 'code', timestamp: '1' }
    const message = shopifyMessage(fields)
    const callback = new URLSearchParams({ ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') })
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shopify/callback?${callback.toString()}`, { redirect: 'manual' })
      expect(response.status).toBe(302)
    })
    const tenant = await directory.getByShopDomain('commander-pilot.myshopify.com')
    expect(tenant).not.toBeNull()
    expect(tenant?.shopDomain).toBe('commander-pilot.myshopify.com')
    expect(tenant?.storeId).toBeTruthy()
  })

  it('sets a SameSite=None Secure HttpOnly session cookie with the storeId after a successful callback', async () => {
    const directory = new InMemoryStoreDirectory()
    const service = installer(directory)
    const start = await service.start('demo.myshopify.com')
    const fields = { shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '1' }
    const message = shopifyMessage(fields)
    const callback = new URLSearchParams({ ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') })
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shopify/callback?${callback.toString()}`, { redirect: 'manual' })
      expect(response.status).toBe(302)
      const setCookie = response.headers.get('set-cookie') ?? ''
      const tenant = await directory.getByShopDomain('demo.myshopify.com')
      expect(setCookie).toContain('profitpilot_session=')
      expect(setCookie).toContain(`profitpilot_session=${encodeURIComponent(tenant?.storeId ?? '')}`)
      expect(setCookie).toContain('SameSite=None')
      expect(setCookie).toContain('Secure')
      expect(setCookie).toContain('HttpOnly')
    })
  })

  it('emits multi-method HMAC diagnostics and a redacted raw URL on the callback attempt', async () => {
    const memory = createMemorySink()
    const service = installer()
    const start = await service.start('my-demo-shop1.myshopify.com')
    const host = Buffer.from('admin.shopify.com/store/my-demo-shop1', 'utf8').toString('base64')
    const fields = { shop: 'my-demo-shop1.myshopify.com', state: start.state, code: '6e3714192b241213900f4e1bf8065104', timestamp: '1786224000', host }
    const rawQuery = `${shopifyMessage(fields)}&hmac=${shopifyHmac(fields)}`
    await withServer(createApi({ logger: new Logger(memory.sink), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shopify/callback?${rawQuery}`, { redirect: 'manual' })
      expect(response.status).toBe(302)
    })
    const attempt = memory.records.find((record) => record.message === 'Shopify OAuth HMAC verification attempt')
    expect(attempt).toBeDefined()
    const context = attempt!.context as Record<string, unknown>
    // Version tag confirms the deployed code, and the raw ground-truth method
    // matched the wire bytes Shopify signed.
    expect(context.version).toBe('PR9-multi-method-2026-08-14')
    expect(context.matchedMethod).toBe('raw')
    expect(context.matched).toBe(true)
    // Every candidate method is reported so a no-match failure shows which
    // convention Shopify used.
    const methods = context.methods as Array<{ method: string; matched: boolean }>
    expect(methods.map((method) => method.method)).toEqual(['raw', 'raw-sorted', 'decoded', 'encoded'])
    expect(methods.find((method) => method.method === 'raw')?.matched).toBe(true)
    // Secret scheme tag + length are visible (the logger exempts these), while
    // full secrets stay redacted.
    expect(context.secretPrefix).toBe(secret.slice(0, 8))
    expect(context.secretLength).toBe(secret.length)
    // The host diagnostic proves Express did not double-decode: the wire form
    // (still %3D%3D) round-trips through the parser's decode + re-encode.
    const hostContext = context.host as Record<string, unknown>
    expect(hostContext.fromRawQuery).toBe('YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvbXktZGVtby1zaG9wMQ%3D%3D')
    expect(hostContext.parserMatchesRaw).toBe(true)
    expect(hostContext.hasPadding).toBe(true)
    // The raw URL preview masks code/state and truncates hmac.
    expect(context.rawUrl).toMatch(/code=<redacted:\d+chars>/)
    expect(context.rawUrl).toMatch(/state=<redacted:\d+chars>/)
    expect(context.rawUrl).not.toContain('6e3714192b241213900f4e1bf8065104')
  })

  it('fails the callback with the exact failing step instead of a bare 500', async () => {
    const service = installer()
    await withServer(createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer: service, exchange: async () => 'token' } }), async (baseUrl) => {
      const fields = { shop: 'demo.myshopify.com', state: 'unknown-state', code: 'code', timestamp: '1' }
      const message = shopifyMessage(fields)
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
    const message = shopifyMessage(fields)
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
