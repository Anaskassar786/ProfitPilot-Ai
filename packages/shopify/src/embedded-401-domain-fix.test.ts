import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { AesGcmCipher } from '@profitpilot/crypto'
import { InMemoryStoreDirectory } from '@profitpilot/db'
import type { StoreConnection } from '@profitpilot/db'
import { AppError, storeId } from '@profitpilot/types'
import {
  InMemoryTokenRecordStore,
  OAuthStateStore,
  ShopifyInstallService,
  TokenVault,
  installStepFromError,
  normalizeShopDomain,
  parseShopDomain,
  safeParseShopDomain,
  setSessionTokenDiagnosticsSink,
  verifyShopifySessionToken,
} from './index.js'
import type { EncryptedTokenRecord, TokenRecordStore } from './index.js'

/**
 * PERMANENT FIX for the embedded 401 / domain-mismatch loop.
 *
 * Symptom: on commander-pilot.myshopify.com every /api call answered 401
 * ("Authentication is required" / "Session expired") after a completed
 * install. Two independent causes are covered here:
 *
 *   1. the same store was spelled differently by different entry points, so
 *      the `dest` claim never matched the persisted `stores` / token-vault
 *      row, and
 *   2. an OAuth callback whose DB write failed still redirected the merchant
 *      into the app, leaving an "installed" store with no token and no row.
 */

const API_KEY = 'client-id-123'
const API_SECRET = 'shpss_secret'
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function sign(payload: Record<string, unknown>, secret = API_SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.${createHmac('sha256', secret).update(`${header}.${body}`, 'utf8').digest('base64url')}`
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return { aud: API_KEY, dest: 'https://commander-pilot.myshopify.com', sub: 'user-1', exp: nowSeconds + 60, nbf: nowSeconds - 5, iat: nowSeconds, sid: 'sid-1', ...overrides }
}

function signedCallback(fields: Record<string, string>, secret: string): Record<string, string> {
  const message = Object.entries(fields)
    .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return { ...fields, hmac: createHmac('sha256', secret).update(message).digest('hex') }
}

afterEach(() => setSessionTokenDiagnosticsSink(null))

describe('shop domain normalization (every entry point)', () => {
  it('collapses scheme, case, whitespace, path and trailing slash to one canonical domain', () => {
    for (const raw of [
      'commander-pilot.myshopify.com',
      ' Commander-Pilot.myshopify.com ',
      'https://commander-pilot.myshopify.com',
      'http://COMMANDER-PILOT.MYSHOPIFY.COM/',
      'https://commander-pilot.myshopify.com/admin/apps/profitpilot?x=1',
      'commander-pilot.myshopify.com:443',
      'commander-pilot',
    ]) {
      expect(normalizeShopDomain(raw)).toBe('commander-pilot.myshopify.com')
    }
  })

  it('returns an empty string (never throws) for unusable values', () => {
    expect(normalizeShopDomain('')).toBe('')
    expect(normalizeShopDomain(null)).toBe('')
    expect(normalizeShopDomain(undefined)).toBe('')
    expect(safeParseShopDomain('demo.example.com')).toBeNull()
  })

  it('keeps parseShopDomain strict while accepting the normalized forms', () => {
    expect(parseShopDomain('https://Commander-Pilot.myshopify.com/')).toBe('commander-pilot.myshopify.com')
    expect(() => parseShopDomain('demo.example.com')).toThrow('shop domain')
    expect(() => parseShopDomain('')).toThrow('shop domain')
  })
})

describe('session token → canonical shop for DB lookups', () => {
  it('normalizes a dest claim carrying a scheme so stores/token_vault queries match exactly', () => {
    const verified = verifyShopifySessionToken(sign(claims()), { apiKey: API_KEY, apiSecret: API_SECRET })
    expect(verified?.shop).toBe('commander-pilot.myshopify.com')
    // The raw claim is preserved for diagnostics, the normalized shop for queries.
    expect(verified?.dest).toBe('https://commander-pilot.myshopify.com')
  })

  it('normalizes a dest claim with a path and mixed case', () => {
    const verified = verifyShopifySessionToken(sign(claims({ dest: 'https://Commander-Pilot.myshopify.com/admin' })), { apiKey: API_KEY, apiSecret: API_SECRET })
    expect(verified?.shop).toBe('commander-pilot.myshopify.com')
  })
})

describe('[AuthDiagnostics] JWT verification failure logging', () => {
  it('emits shop, aud_received and aud_expected on an audience mismatch', () => {
    const lines: string[] = []
    setSessionTokenDiagnosticsSink((message) => lines.push(message))
    expect(verifyShopifySessionToken(sign(claims({ aud: 'another-app-client-id' })), { apiKey: API_KEY, apiSecret: API_SECRET })).toBeNull()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('[AuthDiagnostics] JWT verification failed for shop=https://commander-pilot.myshopify.com, aud_received=another-app-client-id, aud_expected=client-id-123')
  })

  it('reports the rejection code alongside the message for every failure mode', () => {
    const records: Array<Readonly<Record<string, unknown>>> = []
    setSessionTokenDiagnosticsSink((_message, context) => records.push(context))
    verifyShopifySessionToken(sign(claims(), 'wrong-secret'), { apiKey: API_KEY, apiSecret: API_SECRET })
    verifyShopifySessionToken(sign(claims({ exp: Math.floor(Date.now() / 1000) - 300 })), { apiKey: API_KEY, apiSecret: API_SECRET })
    verifyShopifySessionToken('not-a-jwt', { apiKey: API_KEY, apiSecret: API_SECRET })
    expect(records.map((record) => record.code)).toEqual(['INVALID_SIGNATURE', 'EXPIRED', 'MALFORMED_JWT'])
    expect(records[0]?.audExpected).toBe(API_KEY)
  })

  it('never emits a diagnostic for a token that verifies', () => {
    const lines: string[] = []
    setSessionTokenDiagnosticsSink((message) => lines.push(message))
    expect(verifyShopifySessionToken(sign(claims()), { apiKey: API_KEY, apiSecret: API_SECRET })).not.toBeNull()
    expect(lines).toEqual([])
  })

  it('falls back to process.env.SHOPIFY_API_KEY when the caller passes an empty key', () => {
    const previousKey = process.env.SHOPIFY_API_KEY
    const previousSecret = process.env.SHOPIFY_API_SECRET
    process.env.SHOPIFY_API_KEY = ` ${API_KEY} `
    process.env.SHOPIFY_API_SECRET = API_SECRET
    try {
      expect(verifyShopifySessionToken(sign(claims()), { apiKey: '', apiSecret: '' })?.shop).toBe('commander-pilot.myshopify.com')
    } finally {
      if (previousKey === undefined) delete process.env.SHOPIFY_API_KEY
      else process.env.SHOPIFY_API_KEY = previousKey
      if (previousSecret === undefined) delete process.env.SHOPIFY_API_SECRET
      else process.env.SHOPIFY_API_SECRET = previousSecret
    }
  })
})

describe('OAuth callback persistence', () => {
  type Recorded = Readonly<{ level: string; message: string; fields: Record<string, unknown> }>

  function harness(store: TokenRecordStore = new InMemoryTokenRecordStore(), directory = new InMemoryStoreDirectory()) {
    const records: Recorded[] = []
    const logger = {
      info: (message: string, fields: Record<string, unknown> = {}) => records.push({ level: 'info', message, fields }),
      warn: (message: string, fields: Record<string, unknown> = {}) => records.push({ level: 'warn', message, fields }),
      error: (message: string, fields: Record<string, unknown> = {}) => records.push({ level: 'error', message, fields }),
    }
    const vault = new TokenVault(AesGcmCipher.fromHex(ENCRYPTION_KEY), store)
    const states = new OAuthStateStore(() => 100)
    const service = new ShopifyInstallService(
      { apiKey: API_KEY, apiSecret: API_SECRET, scopes: ['read_orders'], redirectUri: 'https://app.example/shopify/callback' },
      states,
      vault,
      directory,
      { logger },
    )
    return { service, states, vault, directory, records }
  }

  async function callbackFor(service: ShopifyInstallService, shop = 'commander-pilot.myshopify.com') {
    const start = await service.start(shop)
    return signedCallback({ shop, state: start.state, code: 'oauth-code', timestamp: '100' }, API_SECRET)
  }

  it('writes the offline token AND an ACTIVE store row, then reads the token back', async () => {
    const { service, vault, directory, records } = harness()
    const callback = await callbackFor(service)
    const result = await service.complete(callback, async () => 'shpat_offline_token')
    expect(result).toMatchObject({ shop: 'commander-pilot.myshopify.com', tokenStored: true })
    // The token is really in the vault, under the canonical domain.
    expect(await vault.get('commander-pilot.myshopify.com')).toBe('shpat_offline_token')
    expect(await vault.get('https://Commander-Pilot.myshopify.com/')).toBe('shpat_offline_token')
    // ...and the tenant row exists for the same canonical domain.
    const connection = await directory.getByShopDomain('commander-pilot.myshopify.com')
    expect(connection?.storeId).toBe(result.storeId)
    expect(records.some((record) => record.message.includes('registered the store row') && record.fields.status === 'ACTIVE')).toBe(true)
    expect(records.some((record) => record.message.includes('persisted the offline access token'))).toBe(true)
  })

  it('registers the tenant even when Shopify sends a non-canonical shop spelling', async () => {
    const { service, directory, vault } = harness()
    const start = await service.start('https://Commander-Pilot.myshopify.com/')
    const callback = signedCallback({ shop: 'Commander-Pilot.myshopify.com', state: start.state, code: 'code', timestamp: '100' }, API_SECRET)
    const result = await service.complete(callback, async () => 'token')
    expect(result.shop).toBe('commander-pilot.myshopify.com')
    expect((await directory.getByShopDomain('commander-pilot.myshopify.com'))?.storeId).toBe(result.storeId)
    expect(await vault.get('commander-pilot.myshopify.com')).toBe('token')
  })

  it('logs the EXACT database error (SQLSTATE, constraint, detail) when the token vault write fails', async () => {
    const failure = Object.assign(new Error('new row violates row-level security policy for table "shopify_tokens"'), {
      code: '42501',
      constraint: 'shopify_tokens_tenant_isolation',
      detail: 'app.shop_domain was not set for this transaction',
      table: 'shopify_tokens',
    })
    const store: TokenRecordStore = {
      get: async () => null,
      put: async () => { throw failure },
      delete: async () => undefined,
    }
    const { service, records } = harness(store)
    const callback = await callbackFor(service)
    const error = await service.complete(callback, async () => 'token').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(AppError)
    expect(installStepFromError(error)).toBe('token-storage')
    const logged = records.find((record) => record.level === 'error' && record.message.includes('token vault'))
    expect(logged?.fields.dbCode).toBe('42501')
    expect(logged?.fields.dbConstraint).toBe('shopify_tokens_tenant_isolation')
    expect(logged?.fields.dbDetail).toBe('app.shop_domain was not set for this transaction')
    expect(logged?.fields.error).toContain('row-level security')
  })

  it('logs the exact database error when the stores row cannot be written', async () => {
    const directory = {
      get: async () => null,
      getByShopDomain: async () => null,
      upsertByShopDomain: async (): Promise<StoreConnection> => { throw Object.assign(new Error('relation "stores" does not exist'), { code: '42P01' }) },
    }
    const { service, records } = harness(new InMemoryTokenRecordStore(), directory as unknown as InMemoryStoreDirectory)
    const callback = await callbackFor(service)
    const error = await service.complete(callback, async () => 'token').catch((reason: unknown) => reason)
    expect(installStepFromError(error)).toBe('tenant-registration')
    const logged = records.find((record) => record.level === 'error' && record.message.includes('stores row'))
    expect(logged?.fields.dbCode).toBe('42P01')
  })

  it('fails the install when a written token cannot be read back (silent write loss)', async () => {
    // A pooler that accepts the write and rolls it back leaves an "installed"
    // app with no token — the exact state that produced permanent 401s.
    const store: TokenRecordStore = {
      get: async (): Promise<EncryptedTokenRecord | null> => null,
      put: async () => undefined,
      delete: async () => undefined,
    }
    const { service, records } = harness(store)
    const callback = await callbackFor(service)
    const error = await service.complete(callback, async () => 'token').catch((reason: unknown) => reason)
    expect(installStepFromError(error)).toBe('token-verification')
    expect(records.some((record) => record.level === 'error' && String(record.fields.reason) === 'TOKEN_VAULT_READBACK_EMPTY')).toBe(true)
  })

  it('keeps the tenant row when the token write fails, so a retry can recover', async () => {
    const store: TokenRecordStore = {
      get: async () => null,
      put: async () => { throw new Error('connection terminated unexpectedly') },
      delete: async () => undefined,
    }
    const directory = new InMemoryStoreDirectory()
    const { service } = harness(store, directory)
    const callback = await callbackFor(service)
    await service.complete(callback, async () => 'token').catch(() => undefined)
    // The store row exists (registered BEFORE the vault write), so the app can
    // resolve the tenant and re-run the token exchange instead of 401ing.
    expect(await directory.getByShopDomain('commander-pilot.myshopify.com')).not.toBeNull()
  })

  it('still rejects an unsigned or replayed callback before touching the database', async () => {
    const { service, directory } = harness()
    const failure = await service.complete({ shop: 'commander-pilot.myshopify.com', state: 'x', code: 'c', hmac: 'bad' }, async () => 'token').catch((error: unknown) => error)
    expect(installStepFromError(failure)).toBe('hmac-verification')
    expect(await directory.getByShopDomain('commander-pilot.myshopify.com')).toBeNull()
  })

  it('keeps postInstallRedirect pointed at the embedded admin app', async () => {
    const { service } = harness()
    const location = service.postInstallRedirect({ host: Buffer.from('admin.shopify.com/store/commander-pilot').toString('base64') }, 'commander-pilot.myshopify.com', storeId('store-1'))
    expect(location).toContain(`https://admin.shopify.com/store/commander-pilot/apps/${API_KEY}`)
    expect(location).toContain('storeId=store-1')
  })
})
