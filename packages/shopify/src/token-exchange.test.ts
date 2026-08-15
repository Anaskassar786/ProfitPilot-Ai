import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { InMemoryTokenRecordStore, OFFLINE_ACCESS_TOKEN_TYPE, ShopifyTokenExchangeError, ShopifyTokenExchangeService, TOKEN_EXCHANGE_GRANT_TYPE, TokenVault } from './index.js'

const API_KEY = 'token-exchange-client-id'
const API_SECRET = 'token-exchange-client-secret'
const SHOP = 'commander-pilot.myshopify.com'
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function idToken(shop = SHOP, overrides: Readonly<Record<string, unknown>> = {}): string {
  const seconds = Math.floor(Date.now() / 1000)
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ dest: `https://${shop}`, aud: API_KEY, sub: '1', exp: seconds + 60, nbf: seconds - 5, iat: seconds, sid: 'session', ...overrides })}`
  return `${body}.${createHmac('sha256', API_SECRET).update(body, 'utf8').digest('base64url')}`
}

function vault(): TokenVault {
  return new TokenVault(AesGcmCipher.fromHex(ENCRYPTION_KEY), new InMemoryTokenRecordStore())
}

describe('Shopify session-token exchange', () => {
  it('requests and vaults a non-expiring offline access token', async () => {
    const tokens = vault()
    const subjectToken = idToken()
    const transport = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ access_token: 'shpat_offline_secret', scope: 'read_products,read_orders' }), { status: 200 }))
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, tokens, transport)

    await expect(service.ensureOfflineAccessToken(SHOP, subjectToken)).resolves.toEqual({
      shop: SHOP,
      scopes: ['read_products', 'read_orders'],
      source: 'exchanged',
    })
    expect(await tokens.get(SHOP)).toBe('shpat_offline_secret')
    expect(transport).toHaveBeenCalledTimes(1)

    const [url, init] = transport.mock.calls[0] ?? []
    expect(url).toBe(`https://${SHOP}/admin/oauth/access_token`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' })
    const body = new URLSearchParams(String(init?.body ?? ''))
    expect(body.get('client_id')).toBe(API_KEY)
    expect(body.get('client_secret')).toBe(API_SECRET)
    expect(body.get('grant_type')).toBe(TOKEN_EXCHANGE_GRANT_TYPE)
    expect(body.get('subject_token')).toBe(subjectToken)
    expect(body.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:id_token')
    expect(body.get('requested_token_type')).toBe(OFFLINE_ACCESS_TOKEN_TYPE)
    expect(body.get('expiring')).toBe('0')
  })

  it('does not exchange again when the vault already contains a token', async () => {
    const tokens = vault()
    await tokens.put(SHOP, 'existing-token')
    const transport = vi.fn(async () => new Response('{}', { status: 500 }))
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, tokens, transport)
    await expect(service.ensureOfflineAccessToken(SHOP, idToken())).resolves.toMatchObject({ source: 'existing' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('force-rotates a rejected access token', async () => {
    const tokens = vault()
    await tokens.put(SHOP, 'rejected-token')
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, tokens, async () => new Response(JSON.stringify({ access_token: 'fresh-token', scope: 'read_products' }), { status: 200 }))
    await expect(service.exchangeOfflineAccessToken(SHOP, idToken())).resolves.toMatchObject({ source: 'exchanged' })
    expect(await tokens.get(SHOP)).toBe('fresh-token')
  })

  it('rejects an invalid, expired, or cross-shop subject token before making a request', async () => {
    const transport = vi.fn(async () => new Response('{}', { status: 200 }))
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, vault(), transport)
    await expect(service.exchangeOfflineAccessToken(SHOP, 'not-a-jwt')).rejects.toThrow('invalid or expired')
    await expect(service.exchangeOfflineAccessToken(SHOP, idToken(SHOP, { exp: 1 }))).rejects.toThrow('invalid or expired')
    await expect(service.exchangeOfflineAccessToken(SHOP, idToken('another.myshopify.com'))).rejects.toThrow('does not belong')
    expect(transport).not.toHaveBeenCalled()
  })

  it('reports upstream and malformed response failures without persisting a token', async () => {
    const tokens = vault()
    const rejected = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, tokens, async () => new Response('bad token', { status: 400 }))
    await expect(rejected.exchangeOfflineAccessToken(SHOP, idToken())).rejects.toMatchObject({ upstreamStatus: 400 })
    expect(await tokens.get(SHOP)).toBeNull()

    const malformed = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, tokens, async () => new Response(JSON.stringify({ scope: 'read_products' }), { status: 200 }))
    await expect(malformed.exchangeOfflineAccessToken(SHOP, idToken())).rejects.toThrow('did not contain an access token')
  })

  it('deduplicates concurrent exchanges for the same shop', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const transport = vi.fn(async () => { await gate; return new Response(JSON.stringify({ access_token: 'shared-token' }), { status: 200 }) })
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, vault(), transport)
    const first = service.exchangeOfflineAccessToken(SHOP, idToken())
    const second = service.exchangeOfflineAccessToken(SHOP, idToken())
    release?.()
    await Promise.all([first, second])
    expect(transport).toHaveBeenCalledTimes(1)
  })
})

describe('token exchange failure diagnostics', () => {
  it('surfaces the Shopify OAuth error code and description from the body', async () => {
    const transport = async () => new Response(JSON.stringify({ error: 'invalid_subject_token', error_description: 'The subject token is expired' }), { status: 400 })
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, vault(), transport)
    const failure: unknown = await service.exchangeOfflineAccessToken(SHOP, idToken()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ShopifyTokenExchangeError)
    expect((failure as ShopifyTokenExchangeError).upstreamStatus).toBe(400)
    expect((failure as ShopifyTokenExchangeError).upstreamCode).toBe('invalid_subject_token')
    expect((failure as ShopifyTokenExchangeError).message).toContain('The subject token is expired')
  })

  it('reports invalid_client so a wrong SHOPIFY_API_KEY/SECRET is obvious', async () => {
    const transport = async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 })
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, vault(), transport)
    await expect(service.exchangeOfflineAccessToken(SHOP, idToken())).rejects.toThrow('invalid_client')
  })

  it('condenses a non-JSON body without leaking token-shaped values', async () => {
    const transport = async () => new Response('unexpected shpat_supersecrettokenvalue failure', { status: 500 })
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, vault(), transport)
    const failure: unknown = await service.exchangeOfflineAccessToken(SHOP, idToken()).catch((error: unknown) => error)
    expect((failure as Error).message).toContain('[redacted-token]')
    expect((failure as Error).message).not.toContain('supersecrettokenvalue')
  })

  it('names the reason a session token could not be verified', async () => {
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: 'a-different-secret' }, vault(), async () => new Response('{}', { status: 200 }))
    const failure: unknown = await service.exchangeOfflineAccessToken(SHOP, idToken()).catch((error: unknown) => error)
    expect((failure as ShopifyTokenExchangeError).upstreamCode).toBe('signature-mismatch')
    expect((failure as ShopifyTokenExchangeError).message).toContain('signature-mismatch')
  })

  it('flags an expired id_token distinctly from a bad secret', async () => {
    const seconds = Math.floor(Date.now() / 1000)
    const service = new ShopifyTokenExchangeService({ apiKey: API_KEY, apiSecret: API_SECRET }, vault(), async () => new Response('{}', { status: 200 }))
    const failure: unknown = await service.exchangeOfflineAccessToken(SHOP, idToken(SHOP, { exp: seconds - 120, nbf: seconds - 180, iat: seconds - 180 })).catch((error: unknown) => error)
    expect((failure as ShopifyTokenExchangeError).upstreamCode).toBe('expired')
  })
})
