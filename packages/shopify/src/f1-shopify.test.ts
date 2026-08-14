import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { InMemoryTokenRecordStore, InMemoryWebhookReceiptStore, OAuthStateStore, ShopifyInstallService, TokenVault, WebhookVerifier, inspectOAuthHmac, installStepFromError, shopifyHmacMessage, shopifyHmacSelfTest, verifyOAuthHmac } from './index.js'
import { AppError, storeId } from '@profitpilot/types'

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

/**
 * Signs fields the way Shopify's backend signs an OAuth callback: parameters
 * sorted by key, joined as key=value with each VALUE percent-encoded exactly as
 * it appears in the redirect URL (see shopifyHmacMessage in ./oauth.js).
 */
function signedCallback(fields: Record<string, string>, secret: string): Record<string, string> {
  const message = Object.entries(fields).sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1)).map(([keyName, value]) => `${keyName}=${encodeURIComponent(value)}`).join('&')
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

  it('builds the HMAC message with URL-encoded values, sorted byte-wise, without hmac/signature', () => {
    const query = { hmac: 'sig', signature: 'legacy', shop: 'demo.myshopify.com', code: 'abc', host: 'YWRtaW4uLi4=', state: 'x.y' }
    // Shopify signs the encoded form of each value (the raw URL query minus
    // hmac/signature): `host`'s base64 padding must stay `%3D`.
    expect(shopifyHmacMessage(query)).toBe('code=abc&host=YWRtaW4uLi4%3D&shop=demo.myshopify.com&state=x.y')
  })

  it('verifies callbacks whose values require URL encoding (base64 host padding, +, /)', async () => {
    const states = new OAuthStateStore(() => 100)
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, states, new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    for (const host of ['YWRtaW4uc2hvcGlmeS5jb20vc3RvcK8=', 'YWR+/taW4uc2hvcGlmeS5jb20=', 'abc+def/ghi=']) {
      const start = await service.start('demo.myshopify.com')
      const callback = signedCallback({ shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '100', host }, 'secret')
      await expect(service.complete(callback, async () => 'token')).resolves.toMatchObject({ shop: 'demo.myshopify.com', tokenStored: true })
    }
  })

  it('accepts a signature computed over decoded (unencoded) values — Shopify signs either convention', async () => {
    // Shopify's OAuth HMAC docs are ambiguous about whether values are signed
    // URL-encoded or raw-decoded (the worked example uses only chars that need
    // no encoding). A real callback can therefore arrive signed either way, so
    // verification must accept both the encoded AND decoded message forms rather
    // than rejecting one as a forgery — otherwise a correctly-signed callback
    // from Shopify fails and looks like a secret bug.
    const states = new OAuthStateStore(() => 100)
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, states, new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    const start = await service.start('demo.myshopify.com')
    const fields = { shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '100', host: 'YWRtaW4uLi4=' }
    const decodedJoin = Object.entries(fields).sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&')
    const callback = { ...fields, hmac: createHmac('sha256', 'secret').update(decodedJoin).digest('hex') }
    await expect(service.complete(callback, async () => 'token')).resolves.toMatchObject({ shop: 'demo.myshopify.com', tokenStored: true })
    // ...but a genuinely invalid (random) signature is still rejected.
    const tampered = { ...fields, hmac: 'deadbeef' }
    const failure = await service.complete(tampered, async () => 'token').catch((error: unknown) => error)
    expect((failure as AppError).details.step).toBe('hmac-verification')
  })

  it('verifies a callback signed from the raw query string (ground-truth method)', async () => {
    const states = new OAuthStateStore(() => 100)
    const service = new ShopifyInstallService({ apiKey: 'key', apiSecret: 'secret', scopes: [], redirectUri: 'https://app.example/callback' }, states, new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()))
    const start = await service.start('demo.myshopify.com')
    const fields = { shop: 'demo.myshopify.com', state: start.state, code: 'code', timestamp: '100', host: 'YWRtaW4uLi4=' }
    // Sign the literal wire bytes (host's '=' stays %3D), exactly as Shopify emits.
    const rawMessage = Object.entries(fields).sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    const callback = { ...fields, hmac: createHmac('sha256', 'secret').update(rawMessage).digest('hex') }
    await expect(service.complete(callback, async () => 'token', rawMessage)).resolves.toMatchObject({ shop: 'demo.myshopify.com', tokenStored: true })
    expect(inspectOAuthHmac(callback, 'secret', rawMessage).matchedMethod).toBe('raw')
  })

  it('reports the canonical Shopify docs HMAC via the startup self-test', () => {
    const result = shopifyHmacSelfTest()
    expect(result.passed).toBe(true)
    expect(result.expected).toBe('700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf')
  })

  it('reports secret-safe HMAC diagnostics: redacted code/state, prefixed hmacs, secret metadata only', () => {
    const fakeSecret = 'unit-test-secret-38-chars-long-aaaaaaa'
    const query = signedCallback({ shop: 'demo.myshopify.com', state: 'csrf-token-value', code: 'authorization-code-value', timestamp: '100', host: 'YWRtaW4uLi4=' }, fakeSecret)
    const diagnostics = inspectOAuthHmac(query, fakeSecret)
    expect(diagnostics.matched).toBe(true)
    expect(diagnostics.parameterKeys).toEqual(['code', 'host', 'shop', 'state', 'timestamp'])
    expect(diagnostics.signedMessagePreview).toContain('host=YWRtaW4uLi4%3D')
    expect(diagnostics.signedMessagePreview).not.toContain('authorization-code-value')
    expect(diagnostics.signedMessagePreview).not.toContain('csrf-token-value')
    expect(diagnostics.receivedHmacPrefix).toBe((query.hmac ?? '').slice(0, 20))
    expect(diagnostics.receivedHmacPrefix).not.toBe(query.hmac)
    // Scheme tag + two chars + length: catches a stale/quoted/wrong env secret
    // without leaking key material. The logger exempts these two keys from its
    // blanket `secret` redaction for exactly this reason.
    expect(diagnostics.secretPrefix).toBe(fakeSecret.slice(0, 8))
    expect(diagnostics.secretPrefix).not.toBe(fakeSecret)
    expect(diagnostics.secretLength).toBe(fakeSecret.length)
    // Every method we compute is reported, and the encoded method (how this
    // callback was signed) is the one that matched.
    expect(diagnostics.matchedMethod).toBe('encoded')
    expect(diagnostics.methods.map((method) => method.method)).toEqual(['raw', 'raw-sorted', 'decoded', 'encoded'])
    expect(diagnostics.methods.find((method) => method.method === 'encoded')?.matched).toBe(true)
    const mismatch = inspectOAuthHmac(query, 'wrong-secret')
    expect(mismatch.matched).toBe(false)
    expect(mismatch.computedHmacPrefix).not.toBe(diagnostics.computedHmacPrefix)
  })

  it('accepts a callback signed exactly like the Shopify docs example', () => {
    // shape of shopify.dev's authorization-code-grant example, re-signed here.
    const fields = { code: '0907a61c0c8d55e99db179b68161bc00', shop: 'some-shop.myshopify.com', state: '0.6784241404160823', timestamp: '1337178173' }
    expect(verifyOAuthHmac(signedCallback(fields, 'my_client_secret'), 'my_client_secret')).toBe(true)
    expect(verifyOAuthHmac(signedCallback(fields, 'my_client_secret'), 'another_secret')).toBe(false)
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
