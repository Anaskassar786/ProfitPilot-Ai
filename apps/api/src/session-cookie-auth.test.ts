/**
 * Signed tenant-cookie authentication — the fix for the "dashboard renders,
 * every data call 401s" incident.
 *
 * Before this change the API accepted exactly one credential for
 * `storeId`-scoped requests: a verified Shopify session token in
 * `Authorization: Bearer`. Anything else — including the tenant session cookie
 * the OAuth callback itself sets — was rejected, so any context where App
 * Bridge could not mint a token was a dead end that reinstalling could never
 * repair. The bootstrap endpoint (`/session/context`) happily answered 200
 * from that same cookie, which is why the shell claimed "Shopify data plane
 * ready" on top of a wall of 401s.
 */
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { storeId as toStoreId } from '@profitpilot/types'
import type { StoreConnection, StoreDirectory } from '@profitpilot/db'
import { SESSION_COOKIE_NAME, signSessionValue, verifySessionValue } from './cookies.js'
import { DEVELOPMENT_CSRF_SECRET, authenticationMiddleware, normalizeRequestError, sessionCookieAuthEnabled, tenantContextMiddleware } from './security.js'
import { createSessionRouter } from './session-routes.js'

const SECRET = 'session-cookie-test-secret-value'
const SHOP = 'commander-pilot.myshopify.com'
const STORE_1 = toStoreId('store_1')

function directory(overrides: Readonly<Record<string, StoreConnection>> = {}): StoreDirectory {
  const rows = new Map<string, StoreConnection>([[STORE_1, { storeId: STORE_1, shopDomain: SHOP }]])
  for (const [key, value] of Object.entries(overrides)) rows.set(key, value)
  return {
    async get(id) { return rows.get(id) ?? null },
    async getByShopDomain(domain) { return [...rows.values()].find((row) => row.shopDomain === domain) ?? null },
    async upsertByShopDomain(domain) { return { storeId: toStoreId(`store_${domain}`), shopDomain: domain } },
  }
}

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(() => {
  while (servers.length > 0) servers.pop()?.close()
})

async function withApp<T>(app: express.Express, handler: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  return handler(`http://127.0.0.1:${address.port}`)
}

/** Mounts the real middleware chain with a dummy data route behind it. */
function buildApp(options: {
  sessionCookieSecret?: string
  directory?: StoreDirectory
  requireAuthentication?: boolean
} = {}): express.Express {
  const app = express()
  app.use(express.json())
  const sessionCookie = options.sessionCookieSecret ? { secret: options.sessionCookieSecret, directory: options.directory ?? directory() } : undefined
  app.use(authenticationMiddleware({
    requireAuthentication: options.requireAuthentication ?? true,
    ...(sessionCookie ? { sessionCookie } : {}),
  }))
  app.use(tenantContextMiddleware(true))
  app.get('/catalog', (_request, response) => response.json({ ok: true, data: [] }))
  app.post('/sync/all', (_request, response) => response.json({ ok: true, data: { modules: [] } }))
  app.use(normalizeRequestError)
  return app
}

function call(base: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  return fetch(`${base}${path}`, { headers }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }))
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }))
}

describe('signed session cookie primitives', () => {
  it('round-trips a tenant id and keeps a dotted id intact', () => {
    for (const value of [STORE_1, 'store.with.dots', 'a']) {
      expect(verifySessionValue(SECRET, signSessionValue(SECRET, value))).toBe(value)
    }
  })

  it('rejects a tampered tenant id', () => {
    const attacker = `${STORE_1}.${createHmac('sha256', SECRET).update('store_2', 'utf8').digest('base64url')}`
    expect(verifySessionValue(SECRET, attacker)).toBeNull()
  })

  it('rejects a signature sealed with a different secret and unsigned leftovers', () => {
    expect(verifySessionValue('another-secret', signSessionValue(SECRET, STORE_1))).toBeNull()
    // The pre-signing format (a bare storeId) must never be trusted once a
    // secret is configured — storeIds travel in URLs.
    expect(verifySessionValue(SECRET, STORE_1)).toBeNull()
    expect(verifySessionValue(SECRET, '')).toBeNull()
    expect(verifySessionValue('', signSessionValue(SECRET, STORE_1))).toBeNull()
  })
})

describe('sessionCookieAuthEnabled', () => {
  it('refuses the public development placeholder and empty secrets', () => {
    expect(sessionCookieAuthEnabled(DEVELOPMENT_CSRF_SECRET)).toBe(false)
    expect(sessionCookieAuthEnabled('')).toBe(false)
    expect(sessionCookieAuthEnabled(SECRET)).toBe(true)
  })
})

describe('data-plane authentication via the signed tenant cookie', () => {
  it('authenticates a storeId request that carries no bearer at all', async () => {
    await withApp(buildApp({ sessionCookieSecret: SECRET }), async (base) => {
      const result = await call(base, `/catalog?storeId=${STORE_1}`, { cookie: `${SESSION_COOKIE_NAME}=${signSessionValue(SECRET, STORE_1)}` })
      expect(result.status).toBe(200)
    })
  })

  it('authenticates POST /sync/all, which is what the six-module panel drives', async () => {
    await withApp(buildApp({ sessionCookieSecret: SECRET }), async (base) => {
      const result = await post(base, '/sync/all', { storeId: STORE_1 }, { cookie: `${SESSION_COOKIE_NAME}=${signSessionValue(SECRET, STORE_1)}` })
      expect(result.status).toBe(200)
    })
  })

  it('still 401s when no credential of any kind is present', async () => {
    await withApp(buildApp({ sessionCookieSecret: SECRET }), async (base) => {
      const result = await call(base, `/catalog?storeId=${STORE_1}`)
      expect(result.status).toBe(401)
    })
  })

  it('rejects an unsigned (pre-signing) cookie — a storeId in a cookie proves nothing', async () => {
    await withApp(buildApp({ sessionCookieSecret: SECRET }), async (base) => {
      const result = await call(base, `/catalog?storeId=${STORE_1}`, { cookie: `${SESSION_COOKIE_NAME}=${STORE_1}` })
      expect(result.status).toBe(401)
    })
  })

  it('rejects a cookie whose signed tenant no longer exists', async () => {
    await withApp(buildApp({ sessionCookieSecret: SECRET }), async (base) => {
      const result = await call(base, `/catalog?storeId=${STORE_1}`, { cookie: `${SESSION_COOKIE_NAME}=${signSessionValue(SECRET, 'store_deleted')}` })
      expect(result.status).toBe(401)
    })
  })

  it('stays disabled when the signing secret is the development placeholder', async () => {
    await withApp(buildApp({ sessionCookieSecret: DEVELOPMENT_CSRF_SECRET }), async (base) => {
      const cookie = signSessionValue(DEVELOPMENT_CSRF_SECRET, STORE_1)
      const result = await call(base, `/catalog?storeId=${STORE_1}`, { cookie: `${SESSION_COOKIE_NAME}=${cookie}` })
      expect(result.status).toBe(401)
    })
  })

  it('is never consulted when a bearer was sent, so a rejected session token cannot hide behind a cookie', async () => {
    // The whole point of the AUD_MISMATCH / INVALID_SIGNATURE log lines is to
    // expose credential drift. Falling back to the cookie here would silently
    // paper over it and leave the deployment broken for embedded merchants.
    await withApp(buildApp({ sessionCookieSecret: SECRET }), async (base) => {
      const result = await call(base, `/catalog?storeId=${STORE_1}`, {
        authorization: 'Bearer not-a-valid.jwt.token',
        cookie: `${SESSION_COOKIE_NAME}=${signSessionValue(SECRET, STORE_1)}`,
      })
      expect(result.status).toBe(401)
    })
  })
})

describe('/session/context reports whether it actually authenticated', () => {
  function sessionApp(secret: string): express.Express {
    const app = express()
    // requireAuthentication: true, i.e. the production default — an unverified
    // context genuinely cannot read the data plane there.
    app.use(createSessionRouter({ directory: directory(), sessionCookieSecret: secret, requireAuthentication: true }))
    return app
  }

  it('marks the unsigned `?shop=` query parameter as NOT authenticated', async () => {
    // This is the exact state that produced "Shopify data plane ready" above a
    // wall of 401s: the shell learned which store it was for without ever
    // proving it may read that store's data.
    await withApp(sessionApp(SECRET), async (base) => {
      const result = await call(base, `/session/context?shop=${encodeURIComponent(SHOP)}`)
      expect(result.status).toBe(200)
      expect((result.body as { data: unknown }).data).toMatchObject({ storeId: STORE_1, shop: SHOP, installed: true, authenticated: false })
    })
  })

  it('marks a correctly signed session cookie as authenticated', async () => {
    await withApp(sessionApp(SECRET), async (base) => {
      const result = await call(base, '/session/context', { cookie: `${SESSION_COOKIE_NAME}=${signSessionValue(SECRET, STORE_1)}` })
      expect(result.status).toBe(200)
      expect((result.body as { data: unknown }).data).toMatchObject({ storeId: STORE_1, authenticated: true })
    })
  })

  it('marks a legacy unsigned cookie as NOT authenticated once a secret is configured', async () => {
    await withApp(sessionApp(SECRET), async (base) => {
      const result = await call(base, '/session/context', { cookie: `${SESSION_COOKIE_NAME}=${STORE_1}` })
      expect(result.status).toBe(200)
      expect((result.body as { data: unknown }).data).toMatchObject({ storeId: STORE_1, authenticated: false })
    })
  })

  it('reports storeId null (and authenticated false) when nothing resolves', async () => {
    await withApp(sessionApp(SECRET), async (base) => {
      const result = await call(base, '/session/context?shop=unknown-store.myshopify.com')
      expect(result.status).toBe(200)
      expect((result.body as { data: unknown }).data).toMatchObject({ storeId: null, shop: null, installed: false, authenticated: false })
    })
  })
})
