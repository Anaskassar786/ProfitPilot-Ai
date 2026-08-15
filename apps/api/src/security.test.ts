import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InMemorySessionRepository } from '@profitpilot/db'
import { Logger, createMemorySink } from '@profitpilot/logger'
import { JwtService, AuthService } from './auth.js'
import { createApi } from './app.js'
import { createCsrfToken, csrfCookieOptions, parseCookies, serializeCookie, sessionCookieOptions, verifyCsrfToken } from './cookies.js'
import { EndpointRateLimiter, assertSafeTenantValue, securityOptionsFromEnv } from './security.js'
import { verifyWebhookHmac } from '@profitpilot/shopify'
import { storeId, userId } from '@profitpilot/types'
import type { AnalyticsSnapshot } from '@profitpilot/db'

const jwtSecret = 'f7-security-test-secret-that-is-at-least-32-characters'

function dataPlane(analytics: () => Promise<AnalyticsSnapshot> = async () => ({ revenue: [], orders: [], productSales: [], customerCohorts: [] })) {
  return {
    sync: { runModule: async (tenant: ReturnType<typeof storeId>, module: 'products' | 'orders' | 'customers' | 'inventory' | 'checkouts' | 'collections' | 'discounts' | 'transactions') => ({ storeId: tenant, module, pages: 1, records: 0, cursor: null, resumedFrom: null }) },
    analytics: { read: async () => analytics(), readCatalog: async () => [] },
  }
}

async function withServer<T>(app: import('express').Express, handler: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('F7 security primitives', () => {
  it('detects JWT forgery and enforces safe tenant identifiers', () => {
    const jwt = new JwtService({ secret: jwtSecret, issuer: 'profitpilot', accessTtlSeconds: 60, refreshTtlSeconds: 120 })
    const token = jwt.issuePair(userId('user-1'), storeId('store-1'), 'session-1', Math.floor(Date.now() / 1000)).accessToken
    const parts = token.split('.')
    parts[1] = Buffer.from('{"sub":"attacker","storeId":"store-2"}').toString('base64url')
    expect(() => jwt.verify(parts.join('.'), 'access', Math.floor(Date.now() / 1000))).toThrow('signature')
    expect(() => assertSafeTenantValue("store-1' OR '1'='1")).toThrow('tenant')
    expect(() => assertSafeTenantValue('1 OR 1=1')).toThrow('tenant')
    expect(() => assertSafeTenantValue('store-1')).not.toThrow()
  })

  it('saturates and resets endpoint-specific rate limits', () => {
    const limiter = new EndpointRateLimiter({ limit: 2, windowMs: 1_000 }, { 'POST /sync': { limit: 2, windowMs: 1_000 } })
    expect(limiter.check('POST', '/sync', 'tenant', 1_000).allowed).toBe(true)
    expect(limiter.check('POST', '/sync', 'tenant', 1_001).allowed).toBe(true)
    const blocked = limiter.check('POST', '/sync', 'tenant', 1_002)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
    expect(limiter.check('POST', '/sync', 'other-tenant', 1_002).allowed).toBe(true)
    expect(limiter.check('POST', '/sync', 'tenant', 2_100).allowed).toBe(true)
    limiter.reset()
    expect(limiter.size()).toBe(0)
    expect(() => new EndpointRateLimiter({ limit: 0, windowMs: 1_000 })).toThrow(RangeError)
  })

  it('validates HMACs with constant-time comparison inputs', () => {
    const body = '{"id":1}'
    const signature = createHmac('sha256', 'shopify-secret').update(body).digest('base64')
    expect(verifyWebhookHmac(body, signature, 'shopify-secret')).toBe(true)
    expect(verifyWebhookHmac(body, `${signature}x`, 'shopify-secret')).toBe(false)
    expect(verifyWebhookHmac(body, signature, 'wrong')).toBe(false)
  })

  it('creates and verifies signed CSRF tokens and secure cookie attributes', () => {
    const token = createCsrfToken('csrf-secret')
    expect(verifyCsrfToken('csrf-secret', token)).toBe(true)
    expect(verifyCsrfToken('wrong', token)).toBe(false)
    expect(verifyCsrfToken('csrf-secret', 'bad')).toBe(false)
    expect(parseCookies('a=1; profitpilot_csrf=hello%20world')).toEqual({ a: '1', profitpilot_csrf: 'hello world' })
    expect(serializeCookie('session', 'value', sessionCookieOptions())).toContain('HttpOnly')
    expect(serializeCookie('session', 'value', sessionCookieOptions())).toContain('Secure')
    expect(serializeCookie('session', 'value', sessionCookieOptions())).toContain('SameSite=None')
    expect(serializeCookie('csrf', 'value', csrfCookieOptions())).not.toContain('HttpOnly')
    expect(serializeCookie('csrf', 'value', csrfCookieOptions())).toContain('SameSite=None')
  })

  it('derives strict CORS and production authentication requirements from env', () => {
    const options = securityOptionsFromEnv({ NODE_ENV: 'production', APP_URL: 'https://app.example', JWT_SECRET: jwtSecret }, { jwt: new JwtService({ secret: jwtSecret, issuer: 'p', accessTtlSeconds: 60, refreshTtlSeconds: 60 }), sessions: new InMemorySessionRepository() })
    expect(options.requireAuthentication).toBe(true)
    expect(options.allowedOrigins).toContain('https://app.example')
    expect(() => securityOptionsFromEnv({ NODE_ENV: 'production' })).toThrow('JWT')
  })

  it('allows an explicit SECURITY_REQUIRE_AUTH=false opt-out in production while defaulting to auth otherwise', () => {
    const auth = { jwt: new JwtService({ secret: jwtSecret, issuer: 'p', accessTtlSeconds: 60, refreshTtlSeconds: 60 }), sessions: new InMemorySessionRepository() }
    expect(securityOptionsFromEnv({ NODE_ENV: 'production', APP_URL: 'https://app.example', JWT_SECRET: jwtSecret, SECURITY_REQUIRE_AUTH: 'false' }, auth).requireAuthentication).toBe(false)
    expect(securityOptionsFromEnv({ NODE_ENV: 'production', APP_URL: 'https://app.example', JWT_SECRET: jwtSecret }, auth).requireAuthentication).toBe(true)
    expect(securityOptionsFromEnv({ NODE_ENV: 'production', APP_URL: 'https://app.example', JWT_SECRET: jwtSecret, SECURITY_REQUIRE_AUTH: 'true' }, auth).requireAuthentication).toBe(true)
    expect(securityOptionsFromEnv({ NODE_ENV: 'development', APP_URL: 'http://localhost:3000', JWT_SECRET: jwtSecret, SECURITY_REQUIRE_AUTH: 'false' }, auth).requireAuthentication).toBe(false)
  })
})

describe('F7 API security suite', () => {
  it('sets CSP, redacted error responses, and strict CORS', async () => {
    const memory = createMemorySink()
    const app = createApi({ logger: new Logger(memory.sink), readinessChecks: [], dataPlane: dataPlane(async () => { throw new Error('database password stack trace') }) })
    await withServer(app, async (base) => {
      const live = await fetch(`${base}/live`)
      expect(live.headers.get('content-security-policy')).toContain("default-src 'none'")
      expect(live.headers.get('x-content-type-options')).toBe('nosniff')
      expect(live.headers.get('permissions-policy')).toContain('microphone=()')
      const cors = await fetch(`${base}/live`, { headers: { origin: 'https://evil.example' } })
      expect(cors.status).toBe(403)
      const sqlInjection = await fetch(`${base}/analytics?storeId=${encodeURIComponent("1 OR 1=1")}`)
      expect(sqlInjection.status).toBe(400)
      const failure = await fetch(`${base}/analytics?storeId=store-1`)
      expect(failure.headers.get('permissions-policy')).toContain('microphone=(self "https://admin.shopify.com")')
      const payload = await failure.json() as { error: { message: string; details: Readonly<Record<string, unknown>> } }
      expect(failure.status).toBe(500)
      expect(payload.error.message).toBe('Internal server error')
      expect(JSON.stringify(payload)).not.toContain('database password')
      expect(JSON.stringify(payload)).not.toContain('stack trace')
      expect(memory.records.some((record) => record.message === 'Internal server error')).toBe(true)
    })
  })

  it('blocks oversized and malformed JSON payloads without a stack trace', async () => {
    const app = createApi({ logger: new Logger(), readinessChecks: [], dataPlane: dataPlane() })
    await withServer(app, async (base) => {
      const oversized = await fetch(`${base}/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', module: 'products', data: 'x'.repeat(110_000) }) })
      expect(oversized.status).toBe(413)
      expect((await oversized.json()).error.message).toBe('Request payload is too large')
      const malformed = await fetch(`${base}/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
      expect(malformed.status).toBe(400)
      expect((await malformed.json()).error.message).toBe('Malformed JSON payload')
    })
  })

  it('protects cookie-authenticated writes with CSRF', async () => {
    const app = createApi({ logger: new Logger(), readinessChecks: [], dataPlane: dataPlane() })
    await withServer(app, async (base) => {
      const csrfResponse = await fetch(`${base}/security/csrf`)
      const token = (await csrfResponse.json() as { data: { csrfToken: string } }).data.csrfToken
      const setCookie = csrfResponse.headers.get('set-cookie')
      expect(setCookie).toContain('profitpilot_csrf=')
      const missingHeader = await fetch(`${base}/sync`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: setCookie ?? '' }, body: JSON.stringify({ storeId: 'store-1', module: 'products' }) })
      expect(missingHeader.status).toBe(403)
      const valid = await fetch(`${base}/sync`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: setCookie ?? '', 'x-csrf-token': token }, body: JSON.stringify({ storeId: 'store-1', module: 'products' }) })
      expect(valid.status).toBe(202)
    })
  })

  it('prevents forged, hijacked, and cross-tenant sessions', async () => {
    const jwt = new JwtService({ secret: jwtSecret, issuer: 'profitpilot', accessTtlSeconds: 60, refreshTtlSeconds: 120 })
    const sessions = new InMemorySessionRepository()
    const auth = new AuthService(jwt, sessions)
    const pair = await auth.signIn(userId('user-1'), storeId('store-1'))
    const security = securityOptionsFromEnv({ NODE_ENV: 'production', SECURITY_REQUIRE_AUTH: 'true', JWT_SECRET: jwtSecret, JWT_ISSUER: 'profitpilot' }, { jwt, sessions })
    const app = createApi({ logger: new Logger(), readinessChecks: [], security, dataPlane: dataPlane() })
    await withServer(app, async (base) => {
      const productionHeaders = await fetch(`${base}/live`)
      expect(productionHeaders.headers.get('strict-transport-security')).toContain('max-age=31536000')
      const noAuth = await fetch(`${base}/analytics?storeId=store-1`)
      expect(noAuth.status).toBe(401)
      const wrongTenant = await fetch(`${base}/analytics?storeId=store-2`, { headers: { authorization: `Bearer ${pair.accessToken}` } })
      expect(wrongTenant.status).toBe(403)
      const ok = await fetch(`${base}/analytics?storeId=store-1`, { headers: { authorization: `Bearer ${pair.accessToken}` } })
      expect(ok.status).toBe(200)
      await sessions.revokeFamily((await sessions.get(pair.sessionId))?.familyId ?? '', Date.now())
      const hijacked = await fetch(`${base}/analytics?storeId=store-1`, { headers: { authorization: `Bearer ${pair.accessToken}` } })
      expect(hijacked.status).toBe(401)
    })
  })
})
