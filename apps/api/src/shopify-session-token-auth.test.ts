import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { InMemorySessionRepository, InMemoryStoreDirectory } from '@profitpilot/db'
import { Logger } from '@profitpilot/logger'
import { AuthService, JwtService } from './auth.js'
import { createApi } from './app.js'
import { securityOptionsFromEnv } from './security.js'
import { storeId, userId } from '@profitpilot/types'
import type { AnalyticsSnapshot } from '@profitpilot/db'

/**
 * Embedded App Bridge session-token auth (P0 App Store fix).
 *
 * These tests drive the full HTTP stack with cookies deliberately ABSENT —
 * the production situation under third-party cookie blocking — and prove the
 * `Authorization: Bearer <Shopify session token>` path alone authenticates
 * the request and establishes the store context.
 */

const API_KEY = 'embedded-test-client-id'
const API_SECRET = 'embedded-test-client-secret'
const SHOP = 'commander-pilot.myshopify.com'

function sign(payload: Readonly<Record<string, unknown>>, secret = API_SECRET, header: Readonly<Record<string, unknown>> = { alg: 'HS256', typ: 'JWT' }): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const body = `${encode(header)}.${encode(payload)}`
  return `${body}.${createHmac('sha256', secret).update(body, 'utf8').digest('base64url')}`
}

function sessionToken(overrides: Readonly<Record<string, unknown>> = {}): string {
  const seconds = Math.floor(Date.now() / 1000)
  return sign({
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: API_KEY,
    sub: '42',
    exp: seconds + 60,
    nbf: seconds - 5,
    iat: seconds,
    sid: 'sid-1',
    ...overrides,
  })
}

function dataPlane(analytics: () => Promise<AnalyticsSnapshot> = async () => ({ revenue: [], orders: [], productSales: [], customerCohorts: [] })) {
  return {
    sync: { runModule: async (tenant: ReturnType<typeof storeId>, module: 'products' | 'orders' | 'customers' | 'inventory' | 'collections' | 'discounts') => ({ storeId: tenant, module, pages: 1, records: 0, cursor: null, resumedFrom: null }) },
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

/** Production-shaped security: auth required, session-token verifier only (no app JWT). */
function embeddedApp(directory: InMemoryStoreDirectory) {
  const security = securityOptionsFromEnv(
    { NODE_ENV: 'production', SECURITY_REQUIRE_AUTH: 'true', APP_URL: 'https://app.example' },
    undefined,
    { config: { apiKey: API_KEY, apiSecret: API_SECRET }, directory },
  )
  return createApi({ logger: new Logger(), readinessChecks: [], security, dataPlane: dataPlane() })
}

describe('Shopify session-token bearer auth (embedded, cookies blocked)', () => {
  it('allows production security to be configured with the session-token verifier alone', () => {
    const directory = new InMemoryStoreDirectory()
    const options = securityOptionsFromEnv(
      { NODE_ENV: 'production', SECURITY_REQUIRE_AUTH: 'true', APP_URL: 'https://app.example' },
      undefined,
      { config: { apiKey: API_KEY, apiSecret: API_SECRET }, directory },
    )
    expect(options.requireAuthentication).toBe(true)
    expect(options.shopifySessionToken?.config.apiKey).toBe(API_KEY)
    expect(options.shopifySessionToken?.directory).toBe(directory)
    expect(options.auth).toBeUndefined()
  })

  it('serves data with only a fresh App Bridge session token and no cookies', async () => {
    const directory = new InMemoryStoreDirectory()
    const connection = await directory.upsertByShopDomain(SHOP)
    await withServer(embeddedApp(directory), async (base) => {
      const response = await fetch(`${base}/analytics?storeId=${connection.storeId}`, { headers: { authorization: `Bearer ${sessionToken()}` } })
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toBeNull()
    })
  })

  it('rejects a token signed with the wrong secret with a clean 401 JSON', async () => {
    const directory = new InMemoryStoreDirectory()
    const connection = await directory.upsertByShopDomain(SHOP)
    await withServer(embeddedApp(directory), async (base) => {
      const forged = sign({
        iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: API_KEY, sub: '42',
        exp: Math.floor(Date.now() / 1000) + 60, nbf: Math.floor(Date.now() / 1000) - 5, iat: Math.floor(Date.now() / 1000), sid: 'sid-1',
      }, 'attacker-secret')
      const response = await fetch(`${base}/analytics?storeId=${connection.storeId}`, { headers: { authorization: `Bearer ${forged}` } })
      expect(response.status).toBe(401)
      const payload = await response.json() as { ok: boolean; error: { code: string; message: string } }
      expect(payload.ok).toBe(false)
      expect(payload.error.code).toBe('UNAUTHORIZED')
    })
  })

  it('rejects an expired session token with 401, not 500', async () => {
    const directory = new InMemoryStoreDirectory()
    const connection = await directory.upsertByShopDomain(SHOP)
    await withServer(embeddedApp(directory), async (base) => {
      const seconds = Math.floor(Date.now() / 1000)
      const expired = sessionToken({ exp: seconds - 30 })
      const response = await fetch(`${base}/analytics?storeId=${connection.storeId}`, { headers: { authorization: `Bearer ${expired}` } })
      expect(response.status).toBe(401)
      const payload = await response.json() as { error: { code: string } }
      expect(payload.error.code).toBe('UNAUTHORIZED')
    })
  })

  it('rejects a session token minted for a different app (audience check)', async () => {
    const directory = new InMemoryStoreDirectory()
    const connection = await directory.upsertByShopDomain(SHOP)
    await withServer(embeddedApp(directory), async (base) => {
      const otherApp = sessionToken({ aud: 'another-app-client-id' })
      const response = await fetch(`${base}/analytics?storeId=${connection.storeId}`, { headers: { authorization: `Bearer ${otherApp}` } })
      expect(response.status).toBe(401)
    })
  })

  it('rejects garbage bearer values with 401, not 500', async () => {
    const directory = new InMemoryStoreDirectory()
    const connection = await directory.upsertByShopDomain(SHOP)
    await withServer(embeddedApp(directory), async (base) => {
      for (const garbage of ['not-a-jwt', '', 'a.b.c']) {
        const response = await fetch(`${base}/analytics?storeId=${connection.storeId}`, { headers: { authorization: `Bearer ${garbage}` } })
        expect(response.status).toBe(401)
      }
    })
  })

  it('forbids a token to read another tenant\'s data (cross-tenant 403)', async () => {
    const directory = new InMemoryStoreDirectory()
    await directory.upsertByShopDomain(SHOP)
    await withServer(embeddedApp(directory), async (base) => {
      const response = await fetch(`${base}/analytics?storeId=store-2`, { headers: { authorization: `Bearer ${sessionToken()}` } })
      expect(response.status).toBe(403)
      const payload = await response.json() as { error: { code: string } }
      expect(payload.error.code).toBe('FORBIDDEN')
    })
  })

  it('registers an unknown shop from a valid token instead of failing', async () => {
    const directory = new InMemoryStoreDirectory()
    await withServer(embeddedApp(directory), async (base) => {
      // Unknown tenant id in the query: auth succeeds via the token (store
      // auto-registered) but the tenant check correctly rejects the mismatch.
      const response = await fetch(`${base}/analytics?storeId=unknown-store`, { headers: { authorization: `Bearer ${sessionToken()}` } })
      expect(response.status).toBe(403)
      const registered = await directory.getByShopDomain(SHOP)
      expect(registered).not.toBeNull()
      expect(registered?.storeId).not.toBe('unknown-store')
    })
  })

  it('keeps the first-party JWT fallback working when both verifiers are configured', async () => {
    const directory = new InMemoryStoreDirectory()
    await directory.upsertByShopDomain(SHOP)
    const jwt = new JwtService({ secret: 'jwt-fallback-test-secret-at-least-32-characters', issuer: 'profitpilot', accessTtlSeconds: 60, refreshTtlSeconds: 120 })
    const sessions = new InMemorySessionRepository()
    const auth = new AuthService(jwt, sessions)
    const pair = await auth.signIn(userId('user-1'), storeId('store-1'))
    const security = securityOptionsFromEnv(
      { NODE_ENV: 'production', SECURITY_REQUIRE_AUTH: 'true', APP_URL: 'https://app.example', JWT_SECRET: 'jwt-fallback-test-secret-at-least-32-characters', JWT_ISSUER: 'profitpilot' },
      { jwt, sessions },
      { config: { apiKey: API_KEY, apiSecret: API_SECRET }, directory },
    )
    const app = createApi({ logger: new Logger(), readinessChecks: [], security, dataPlane: dataPlane() })
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/analytics?storeId=store-1`, { headers: { authorization: `Bearer ${pair.accessToken}` } })
      expect(response.status).toBe(200)
    })
  })

  it('/session/context resolves the tenant from the bearer token with no cookie', async () => {
    const directory = new InMemoryStoreDirectory()
    const connection = await directory.upsertByShopDomain(SHOP)
    const app = createApi({
      logger: new Logger(),
      readinessChecks: [],
      dataPlane: dataPlane(),
      security: securityOptionsFromEnv({ NODE_ENV: 'development' }, undefined, { config: { apiKey: API_KEY, apiSecret: API_SECRET }, directory }),
      session: { directory, sessionToken: { apiKey: API_KEY, apiSecret: API_SECRET } },
    })
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/session/context`, { headers: { authorization: `Bearer ${sessionToken()}` } })
      expect(response.status).toBe(200)
      const payload = await response.json() as { data: { storeId: string | null; shop: string | null } }
      expect(payload.data.storeId).toBe(connection.storeId)
      expect(payload.data.shop).toBe(SHOP)
    })
  })

  it('/session/context ignores an invalid bearer and falls back to the cookie', async () => {
    const directory = new InMemoryStoreDirectory()
    const connection = await directory.upsertByShopDomain(SHOP)
    const app = createApi({
      logger: new Logger(),
      readinessChecks: [],
      dataPlane: dataPlane(),
      security: securityOptionsFromEnv({ NODE_ENV: 'development' }, undefined, { config: { apiKey: API_KEY, apiSecret: API_SECRET }, directory }),
      session: { directory, sessionToken: { apiKey: API_KEY, apiSecret: API_SECRET } },
    })
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/session/context`, { headers: { authorization: 'Bearer forged-token', cookie: `profitpilot_session=${connection.storeId}` } })
      expect(response.status).toBe(200)
      const payload = await response.json() as { data: { storeId: string | null; shop: string | null } }
      expect(payload.data.storeId).toBe(connection.storeId)
    })
  })
})
