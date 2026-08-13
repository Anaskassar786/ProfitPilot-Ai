import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { InMemoryTokenRecordStore, InMemoryWebhookReceiptStore, OAuthStateStore, ShopifyInstallService, TokenVault, WebhookVerifier } from './index.js'
import { storeId } from '@profitpilot/types'

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function signedCallback(fields: Record<string, string>, secret: string): Record<string, string> {
  const message = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)).map(([keyName, value]) => `${keyName}=${value}`).join('&')
  return { ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') }
}

describe('Shopify token vault', () => {
  it('stores only encrypted token ciphertext', async () => {
    const store = new InMemoryTokenRecordStore()
    const vault = new TokenVault(AesGcmCipher.fromHex(key), store, () => 100)
    const record = await vault.put('Demo.myshopify.com', 'shpat_secret_token')
    expect(record.ciphertext).not.toContain('shpat_secret_token')
    expect(await vault.get('demo.myshopify.com')).toBe('shpat_secret_token')
  })
  it('rotates an existing token without changing creation time', async () => {
    const store = new InMemoryTokenRecordStore()
    let now = 100
    const vault = new TokenVault(AesGcmCipher.fromHex(key), store, () => now)
    const first = await vault.put('demo.myshopify.com', 'one')
    now = 200
    const second = await vault.put('demo.myshopify.com', 'two')
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.rotatedAt).toBe(200)
    expect(await vault.get('demo.myshopify.com')).toBe('two')
  })
  it('removes a token on uninstall', async () => {
    const vault = new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore())
    await vault.put('demo.myshopify.com', 'token')
    await vault.remove('demo.myshopify.com')
    expect(await vault.get('demo.myshopify.com')).toBeNull()
  })
  it('rejects empty token values', async () => {
    const vault = new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore())
    await expect(vault.put('demo.myshopify.com', '  ')).rejects.toThrow('access token')
  })
})

describe('Shopify OAuth install flow', () => {
  it('creates an authorization URL with a fresh state', () => {
    const vault = new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore())
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: ['read_products', 'read_orders'], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(() => 100), vault)
    const start = service.start('Demo.myshopify.com')
    expect(start.authorizationUrl).toContain('client_id=key')
    expect(start.authorizationUrl).toContain('state=')
    expect(start.shop).toBe('demo.myshopify.com')
  })
  it('exchanges code only after HMAC and state validation', async () => {
    const store = new InMemoryTokenRecordStore()
    const vault = new TokenVault(AesGcmCipher.fromHex(key), store)
    const states = new OAuthStateStore(() => 100)
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: ['read_products'], redirectUri: 'https://app.example/callback' }, states, vault)
    const start = service.start('demo.myshopify.com')
    const callback = signedCallback({ shop: 'demo.myshopify.com', state: start.state, code: 'oauth-code', timestamp: '100' }, 'secret')
    const exchange = async (shop: string, code: string): Promise<string> => `${shop}:${code}:access`
    await expect(service.complete(callback, exchange)).resolves.toMatchObject({ shop: 'demo.myshopify.com', tokenStored: true })
    expect(await vault.get('demo.myshopify.com')).toBe('demo.myshopify.com:oauth-code:access')
  })
  it('rejects replayed OAuth callbacks', async () => {
    const states = new OAuthStateStore(() => 100)
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, states, new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    const start = service.start('demo.myshopify.com')
    const callback = signedCallback({ shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '100' }, 'secret')
    await service.complete(callback, async () => 'token')
    await expect(service.complete(callback, async () => 'token')).rejects.toThrow('replayed')
  })
  it('rejects bad callback signatures before exchanging', async () => {
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(), new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    await expect(service.complete({ shop: 'demo.myshopify.com', state: 'bad', code: 'code', hmac: 'bad' }, async () => 'token')).rejects.toThrow('signature')
  })
})

describe('replay-safe webhooks', () => {
  it('accepts a valid webhook only once', async () => {
    const receipts = new InMemoryWebhookReceiptStore()
    const verifier = new WebhookVerifier('secret', receipts)
    const body = '{"id":1}'
    const signature = createHmac('sha256', 'secret').update(body).digest('base64')
    const event = { storeId: storeId('store-1'), webhookId: 'wh-1', topic: 'orders/create', rawBody: body, signature }
    await expect(verifier.verifyAndClaim(event)).resolves.toMatchObject({ accepted: true, payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/) })
    await expect(verifier.verifyAndClaim(event)).resolves.toMatchObject({ accepted: false })
  })
  it('rejects invalid webhook HMAC before claiming', async () => {
    const verifier = new WebhookVerifier('secret', new InMemoryWebhookReceiptStore())
    await expect(verifier.verifyAndClaim({ storeId: storeId('store-1'), webhookId: 'wh-1', topic: 'orders/create', rawBody: '{}', signature: 'bad' })).rejects.toThrow('HMAC')
  })
  it('isolates receipt ids by store', async () => {
    const receipts = new InMemoryWebhookReceiptStore()
    expect(await receipts.claim(storeId('one'), 'same')).toBe(true)
    expect(await receipts.claim(storeId('two'), 'same')).toBe(true)
  })
})
