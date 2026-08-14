import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { InMemoryTokenRecordStore, InMemoryWebhookReceiptStore, OAuthStateStore, ShopifyInstallService, TokenVault, WebhookVerifier, installStepFromError } from './index.js'
import { AppError, storeId } from '@profitpilot/types'

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function signedCallback(fields: Record<string, string>, secret: string): Record<string, string> {
  const message = Object.entries(fields).sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1)).map(([keyName, value]) => `${keyName}=${value}`).join('&')
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
  it('creates an authorization URL with a fresh state', async () => {
    const vault = new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore())
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: ['read_products', 'read_orders'], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(() => 100), vault)
    const start = await service.start('Demo.myshopify.com')
    expect(start.authorizationUrl).toContain('client_id=key')
    expect(start.authorizationUrl).toContain('state=')
    expect(start.shop).toBe('demo.myshopify.com')
  })
  it('exchanges code only after HMAC and state validation', async () => {
    const store = new InMemoryTokenRecordStore()
    const vault = new TokenVault(AesGcmCipher.fromHex(key), store)
    const states = new OAuthStateStore(() => 100)
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: ['read_products'], redirectUri: 'https://app.example/callback' }, states, vault)
    const start = await service.start('demo.myshopify.com')
    const callback = signedCallback({ shop: 'demo.myshopify.com', state: start.state, code: 'oauth-code', timestamp: '100' }, 'secret')
    const exchange = async (shop: string, code: string): Promise<string> => `${shop}:${code}:access`
    await expect(service.complete(callback, exchange)).resolves.toMatchObject({ shop: 'demo.myshopify.com', tokenStored: true })
    expect(await vault.get('demo.myshopify.com')).toBe('demo.myshopify.com:oauth-code:access')
  })
  it('rejects replayed OAuth callbacks with a state-verification step', async () => {
    const states = new OAuthStateStore(() => 100)
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, states, new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    const start = await service.start('demo.myshopify.com')
    const callback = signedCallback({ shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '100' }, 'secret')
    await service.complete(callback, async () => 'token')
    const replay = await service.complete(callback, async () => 'token').catch((error: unknown) => error)
    expect(replay).toBeInstanceOf(AppError)
    expect((replay as AppError).message).toContain('replayed')
    expect((replay as AppError).details.step).toBe('state-verification')
  })
  it('rejects bad callback signatures before exchanging with an hmac-verification step', async () => {
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(), new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    const failure = await service.complete({ shop: 'demo.myshopify.com', state: 'bad', code: 'code', hmac: 'bad' }, async () => 'token').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AppError)
    expect((failure as AppError).message).toContain('signature')
    expect((failure as AppError).details.step).toBe('hmac-verification')
  })
  it('labels a token-exchange failure and keeps the underlying cause', async () => {
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(() => 100), new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    const start = await service.start('demo.myshopify.com')
    const callback = signedCallback({ shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '100' }, 'secret')
    const failure = await service.complete(callback, async () => { throw new Error('Shopify OAuth token exchange failed with HTTP 404') }).catch((error: unknown) => error)
    expect((failure as AppError).code).toBe('DEPENDENCY_ERROR')
    expect((failure as AppError).status).toBe(502)
    expect((failure as AppError).details.step).toBe('token-exchange')
    expect(installStepFromError(failure)).toBe('token-exchange')
    expect(((failure as AppError).cause as Error).message).toContain('404')
  })
  it('builds the embedded post-install URL from the host parameter', async () => {
    const service = new ShopifyInstallService({ apiKey: 'client-id', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(() => 100), new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    const host = Buffer.from('admin.shopify.com/store/commander-pilot', 'utf8').toString('base64')
    expect(service.postInstallRedirect({ shop: 'commander-pilot.myshopify.com', host }, 'commander-pilot.myshopify.com')).toBe('https://admin.shopify.com/store/commander-pilot/apps/client-id')
    expect(service.postInstallRedirect({ shop: 'commander-pilot.myshopify.com' }, 'commander-pilot.myshopify.com')).toBe('https://admin.shopify.com/store/commander-pilot/apps/client-id')
    expect(service.postInstallRedirect({ shop: 'commander-pilot.myshopify.com', host: 'aGVsbG8' }, 'commander-pilot.myshopify.com')).toBe('https://admin.shopify.com/store/commander-pilot/apps/client-id')
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
