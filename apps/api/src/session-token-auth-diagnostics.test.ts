import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { diagnoseSessionToken, sanitizeCredential, verifyShopifySessionToken } from '@profitpilot/shopify'
import { AppError } from '@profitpilot/types'
import { authenticationMiddleware, getAuthContext, getAuthFailure, setAuthDiagnosticsLogger, tenantContextMiddleware } from './security.js'
import { injectShopifyAppBridgeApiKey, resolveAppBridgeApiKey } from './web-app.js'

const API_KEY = 'client-id-123'
const API_SECRET = 'shpss_secret'

function sign(payload: Record<string, unknown>, secret = API_SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${body}`, 'utf8').digest('base64url')
  return `${header}.${body}.${signature}`
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return { aud: API_KEY, dest: 'https://demo.myshopify.com', sub: 'user-1', exp: nowSeconds + 60, nbf: nowSeconds - 5, iat: nowSeconds, sid: 'sid-1', ...overrides }
}

describe('credential sanitization', () => {
  it('strips whitespace, quotes and line breaks copied into env values', () => {
    expect(sanitizeCredential(' "client-id-123"\n')).toBe('client-id-123')
    expect(sanitizeCredential("'shpss_secret'")).toBe('shpss_secret')
    expect(sanitizeCredential(undefined)).toBe('')
  })

  it('verifies a token even when the configured credentials carry stray quotes/newlines', () => {
    const token = sign(claims())
    expect(verifyShopifySessionToken(token, { apiKey: `"${API_KEY}"\n`, apiSecret: ` ${API_SECRET} ` })?.shop).toBe('demo.myshopify.com')
  })

  it('refuses to verify when credentials are empty after sanitization', () => {
    expect(verifyShopifySessionToken(sign(claims()), { apiKey: '  ', apiSecret: '' })).toBeNull()
  })
})

describe('session token diagnostics', () => {
  it('names an audience mismatch with both client ids', () => {
    const diagnostics = diagnoseSessionToken(sign(claims({ aud: 'other-app' })), { apiKey: API_KEY, apiSecret: API_SECRET })
    expect(diagnostics.code).toBe('AUD_MISMATCH')
    expect(diagnostics.message).toContain(`expected ${API_KEY} got other-app`)
  })

  it('names a signature mismatch without leaking the secret', () => {
    const diagnostics = diagnoseSessionToken(sign(claims(), 'wrong-secret'), { apiKey: API_KEY, apiSecret: API_SECRET })
    expect(diagnostics.code).toBe('INVALID_SIGNATURE')
    expect(diagnostics.message).not.toContain(API_SECRET)
  })

  it('names an expired token and how stale it is', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const diagnostics = diagnoseSessionToken(sign(claims({ exp: nowSeconds - 120, nbf: nowSeconds - 200, iat: nowSeconds - 200 })), { apiKey: API_KEY, apiSecret: API_SECRET })
    expect(diagnostics.code).toBe('EXPIRED')
    expect(diagnostics.message).toMatch(/\d+s past exp/)
  })

  it('reports malformed bearers and empty credentials distinctly', () => {
    expect(diagnoseSessionToken('not-a-jwt', { apiKey: API_KEY, apiSecret: API_SECRET }).code).toBe('MALFORMED_JWT')
    expect(diagnoseSessionToken(sign(claims()), { apiKey: '', apiSecret: '' }).code).toBe('MISSING_CREDENTIALS')
  })
})

describe('App Bridge meta tag injection', () => {
  it('replaces the %SHOPIFY_API_KEY% placeholder', () => {
    expect(injectShopifyAppBridgeApiKey('<meta name="shopify-api-key" content="%SHOPIFY_API_KEY%">', API_KEY)).toContain(`content="${API_KEY}"`)
  })

  it('overwrites a stale baked-in key', () => {
    const html = '<head><meta name="shopify-api-key" content="stale-key"></head>'
    const result = injectShopifyAppBridgeApiKey(html, API_KEY)
    expect(result).toContain(`content="${API_KEY}"`)
    expect(result).not.toContain('stale-key')
  })

  it('sanitizes a quoted/newline-padded env value before injecting', () => {
    expect(injectShopifyAppBridgeApiKey('<meta name="shopify-api-key" content="" />', ` "${API_KEY}"\n`)).toBe(`<meta name="shopify-api-key" content="${API_KEY}" />`)
  })

  it('reads the runtime key from SHOPIFY_API_KEY first', () => {
    expect(resolveAppBridgeApiKey({ SHOPIFY_API_KEY: ' runtime-key ', VITE_SHOPIFY_API_KEY: 'build-key' } as NodeJS.ProcessEnv)).toBe('runtime-key')
    expect(resolveAppBridgeApiKey({ VITE_SHOPIFY_API_KEY: 'build-key' } as NodeJS.ProcessEnv)).toBe('build-key')
  })
})

describe('store directory resilience in authentication', () => {
  const request = { path: '/api/orders', method: 'GET', query: { storeId: 'store-1' }, header: () => undefined } as unknown as Parameters<ReturnType<typeof authenticationMiddleware>>[0]

  it('logs DB_UNAVAILABLE and degrades instead of throwing when the pooler fails', async () => {
    const logs: string[] = []
    setAuthDiagnosticsLogger((message) => logs.push(message))
    const middleware = authenticationMiddleware({
      requireAuthentication: true,
      shopifySessionToken: {
        config: { apiKey: API_KEY, apiSecret: API_SECRET },
        directory: {
          get: async () => null,
          getByShopDomain: async () => { throw new Error('pooler connection terminated') },
          upsertByShopDomain: async () => { throw new Error('pooler connection terminated') },
        },
      },
    })
    const token = sign(claims())
    const authorized = { ...request, header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) } as typeof request
    const error = await new Promise<unknown>((resolve) => { middleware(authorized, {} as never, resolve as never) })
    // The pooler failure must NOT surface as a thrown 500: the request simply
    // continues unauthenticated (tenantContextMiddleware answers 401) while the
    // log states the real cause.
    expect(error).toBeUndefined()
    expect(getAuthContext(authorized)).toBeNull()
    expect(logs.join('\n')).toContain('DB_UNAVAILABLE')
    setAuthDiagnosticsLogger(null)
  })

  it('falls back to an upsert when the store row is missing', async () => {
    setAuthDiagnosticsLogger(() => {})
    const middleware = authenticationMiddleware({
      requireAuthentication: true,
      shopifySessionToken: {
        config: { apiKey: API_KEY, apiSecret: API_SECRET },
        directory: {
          get: async () => null,
          getByShopDomain: async () => null,
          upsertByShopDomain: async (shopDomain: string) => ({ storeId: 'store-1' as never, shopDomain }),
        },
      },
    })
    const token = sign(claims())
    const authorized = { ...request, header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) } as typeof request
    await new Promise<void>((resolve) => { middleware(authorized, {} as never, (() => resolve()) as never) })
    expect(getAuthContext(authorized)?.claims.storeId).toBe('store-1')
    setAuthDiagnosticsLogger(null)
  })
})

/**
 * PERMANENT 401 FIX — the API must tell the embedded client WHETHER a 401 can
 * be recovered by re-authorizing, and for WHICH shop. Without those two fields
 * the web app can only show a red card; with them it re-runs
 * /shopify/install?shop=… at top level and the merchant is back in seconds.
 */
describe('recoverable 401 envelope for the embedded client', () => {
  const baseRequest = { path: '/api/orders', method: 'GET', query: { storeId: 'store-1' }, header: () => undefined } as unknown as Parameters<ReturnType<typeof authenticationMiddleware>>[0]

  function withBearer(token: string, query: Record<string, string> = { storeId: 'store-1' }): typeof baseRequest {
    return { ...baseRequest, query, header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) } as typeof baseRequest
  }

  it('marks STORE_NOT_FOUND as re-authorizable and names the normalized shop', async () => {
    setAuthDiagnosticsLogger(() => {})
    const middleware = authenticationMiddleware({
      requireAuthentication: true,
      shopifySessionToken: {
        config: { apiKey: API_KEY, apiSecret: API_SECRET },
        directory: { get: async () => null, getByShopDomain: async () => null, upsertByShopDomain: async () => null as never },
      },
    })
    // dest carries a scheme: the failure must still name the canonical domain.
    const request = withBearer(sign(claims({ dest: 'https://commander-pilot.myshopify.com/' })))
    await new Promise<void>((resolve) => { middleware(request, {} as never, (() => resolve()) as never) })
    expect(getAuthFailure(request)).toEqual({ reason: 'STORE_NOT_FOUND', shop: 'commander-pilot.myshopify.com', code: 'STORE_NOT_FOUND' })

    const error = await new Promise<unknown>((resolve) => { tenantContextMiddleware(true)(request, {} as never, resolve as never) })
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).status).toBe(401)
    expect((error as AppError).message).toBe('Authentication is required')
    expect((error as AppError).details).toMatchObject({ reason: 'STORE_NOT_FOUND', shop: 'commander-pilot.myshopify.com', reauthorize: true })
    setAuthDiagnosticsLogger(null)
  })

  it('never asks the client to re-install when the database is the problem', async () => {
    setAuthDiagnosticsLogger(() => {})
    const middleware = authenticationMiddleware({
      requireAuthentication: true,
      shopifySessionToken: {
        config: { apiKey: API_KEY, apiSecret: API_SECRET },
        directory: {
          get: async () => null,
          getByShopDomain: async () => { throw new Error('pooler connection terminated') },
          upsertByShopDomain: async () => { throw new Error('pooler connection terminated') },
        },
      },
    })
    const request = withBearer(sign(claims()))
    await new Promise<void>((resolve) => { middleware(request, {} as never, (() => resolve()) as never) })
    expect(getAuthFailure(request)?.reason).toBe('DB_UNAVAILABLE')
    const error = await new Promise<unknown>((resolve) => { tenantContextMiddleware(true)(request, {} as never, resolve as never) })
    expect((error as AppError).details).toMatchObject({ reason: 'DB_UNAVAILABLE', reauthorize: false })
    setAuthDiagnosticsLogger(null)
  })

  it('resolves a store row written for the canonical domain from a scheme-prefixed dest claim', async () => {
    setAuthDiagnosticsLogger(() => {})
    const queried: string[] = []
    const middleware = authenticationMiddleware({
      requireAuthentication: true,
      shopifySessionToken: {
        config: { apiKey: API_KEY, apiSecret: API_SECRET },
        directory: {
          get: async () => null,
          getByShopDomain: async (shopDomain: string) => {
            queried.push(shopDomain)
            return shopDomain === 'commander-pilot.myshopify.com' ? { storeId: 'store-1' as never, shopDomain } : null
          },
          upsertByShopDomain: async (shopDomain: string) => ({ storeId: 'store-1' as never, shopDomain }),
        },
      },
    })
    const request = withBearer(sign(claims({ dest: 'https://COMMANDER-PILOT.myshopify.com/' })))
    await new Promise<void>((resolve) => { middleware(request, {} as never, (() => resolve()) as never) })
    expect(queried).toEqual(['commander-pilot.myshopify.com'])
    expect(getAuthContext(request)?.claims.storeId).toBe('store-1')
    expect(getAuthContext(request)?.shop).toBe('commander-pilot.myshopify.com')
    setAuthDiagnosticsLogger(null)
  })

  it('falls back to the request shop hint when no session token identified one', async () => {
    const middleware = authenticationMiddleware({ requireAuthentication: true })
    const request = { ...baseRequest, query: { storeId: 'store-1', shop: 'https://Commander-Pilot.myshopify.com/' }, header: () => undefined } as unknown as typeof baseRequest
    const error = await new Promise<unknown>((resolve) => { middleware(request, {} as never, resolve as never) })
    expect((error as AppError).details).toMatchObject({ reason: 'NO_AUTH_CONTEXT', shop: 'commander-pilot.myshopify.com', reauthorize: true })
  })
})
