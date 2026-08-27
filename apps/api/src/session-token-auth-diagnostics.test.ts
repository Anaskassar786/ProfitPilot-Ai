import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { diagnoseSessionToken, sanitizeCredential, verifyShopifySessionToken } from '@profitpilot/shopify'
import type { StoreDirectory } from '@profitpilot/db'
import { authenticationMiddleware, getAuthContext, setAuthDiagnosticsLogger } from './security.js'
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

describe('[AuthDiagnostic] Session token 401 failure log', () => {
  type LogEntry = Readonly<{ message: string; context: Readonly<Record<string, unknown>> }>

  function bearerRequest(token: string): Parameters<ReturnType<typeof authenticationMiddleware>>[0] {
    return {
      path: '/api/analytics',
      method: 'GET',
      query: { storeId: 'store-1' },
      header: (name: string): string | undefined => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined),
    } as unknown as Parameters<ReturnType<typeof authenticationMiddleware>>[0]
  }

  function middlewareWith(directory: StoreDirectory): ReturnType<typeof authenticationMiddleware> {
    return authenticationMiddleware({
      requireAuthentication: true,
      shopifySessionToken: { config: { apiKey: API_KEY, apiSecret: API_SECRET }, directory },
    })
  }

  it('logs aud_received, key_expected and shop whenever session-token verification fails', async () => {
    const logs: LogEntry[] = []
    setAuthDiagnosticsLogger((message, context) => logs.push({ message, context }))
    try {
      const middleware = middlewareWith({
        get: async () => null,
        getByShopDomain: async () => { throw new Error('unreachable: verification fails first') },
        upsertByShopDomain: async () => { throw new Error('unreachable: verification fails first') },
      })
      const seconds = Math.floor(Date.now() / 1000)
      const expired = sign(claims({ exp: seconds - 120, nbf: seconds - 200, iat: seconds - 200 }))
      const request = bearerRequest(expired)
      const error = await new Promise<unknown>((resolve) => { middleware(request, {} as never, resolve as never) })
      // An unverifiable bearer is treated like a missing one (the tenant
      // middleware answers the actual 401 — see the full-stack tests), but no
      // auth context may be established …
      expect(error).toBeUndefined()
      expect(getAuthContext(request)).toBeNull()
      // … and the log names the mismatch precisely.
      const failure = logs.find((entry) => entry.message === '[AuthDiagnostic] Session token 401 failure')
      expect(failure).toBeDefined()
      expect(failure?.context).toMatchObject({
        aud_received: API_KEY,
        key_expected: API_KEY,
        shop: 'https://demo.myshopify.com',
        code: 'EXPIRED',
      })
    } finally {
      setAuthDiagnosticsLogger(null)
    }
  })

  it('diagnoses a secret mismatch without authenticating the received claims', async () => {
    const logs: LogEntry[] = []
    setAuthDiagnosticsLogger((message, context) => logs.push({ message, context }))
    try {
      const middleware = middlewareWith({
        get: async () => null,
        getByShopDomain: async () => { throw new Error('unreachable: verification fails first') },
        upsertByShopDomain: async () => { throw new Error('unreachable: verification fails first') },
      })
      const forged = sign(claims(), 'wrong-secret')
      await new Promise<unknown>((resolve) => { middleware(bearerRequest(forged), {} as never, resolve as never) })
      const failure = logs.find((entry) => entry.message === '[AuthDiagnostic] Session token 401 failure')
      expect(failure?.context).toMatchObject({ code: 'INVALID_SIGNATURE', key_expected: API_KEY })
      // The package-level identity line must not authenticate forged claims …
      expect(logs.some((entry) => entry.message.includes('INVALID_SIGNATURE') && entry.message.includes('payload not authenticated'))).toBe(true)
    } finally {
      setAuthDiagnosticsLogger(null)
    }
  })

  it('does not 401 a signature-valid token with a stale audience — the store is resolved from the dest claim', async () => {
    const logs: LogEntry[] = []
    setAuthDiagnosticsLogger((message, context) => logs.push({ message, context }))
    try {
      const middleware = middlewareWith({
        get: async () => null,
        getByShopDomain: async (shopDomain: string) => ({ storeId: 'store-1' as never, shopDomain }),
        upsertByShopDomain: async (shopDomain: string) => ({ storeId: 'store-1' as never, shopDomain }),
      })
      const staleAudience = sign(claims({ aud: 'rotated-client-id' }))
      const request = bearerRequest(staleAudience)
      const error = await new Promise<unknown>((resolve) => { middleware(request, {} as never, resolve as never) })
      expect(error).toBeUndefined()
      expect(getAuthContext(request)?.claims.storeId).toBe('store-1')
      expect(getAuthContext(request)?.shop).toBe('demo.myshopify.com')
      // No 401-failure line; instead the accepted fallback is logged.
      expect(logs.some((entry) => entry.message === '[AuthDiagnostic] Session token 401 failure')).toBe(false)
      const fallback = logs.find((entry) => entry.message.startsWith('[AuthDiagnostic] Session token audience fallback'))
      expect(fallback?.context).toMatchObject({ aud_received: 'rotated-client-id', key_expected: API_KEY, shop: 'demo.myshopify.com' })
    } finally {
      setAuthDiagnosticsLogger(null)
    }
  })
})
