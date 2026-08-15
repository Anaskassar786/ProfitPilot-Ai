import { createHmac } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryStoreDirectory } from '@profitpilot/db'
import type { StoreDirectory } from '@profitpilot/db'
import { Logger, createMemorySink } from '@profitpilot/logger'
import { createApi } from './app.js'
import type { Express } from 'express'

const API_KEY = 'test-client-id'
const API_SECRET = 'test-client-secret'
const SHOP = 'commander-pilot.myshopify.com'
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function sessionToken(shop = SHOP, secret = API_SECRET): string {
  const seconds = Math.floor(Date.now() / 1000)
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ dest: `https://${shop}`, aud: API_KEY, sub: '1', exp: seconds + 60, nbf: seconds - 5, iat: seconds, sid: 's' })}`
  return `${body}.${createHmac('sha256', secret).update(body, 'utf8').digest('base64url')}`
}

function webDist(): string {
  const path = mkdtempSync(join(tmpdir(), 'profitpilot-embed-'))
  temporaryDirectories.push(path)
  mkdirSync(join(path, 'assets'))
  writeFileSync(join(path, 'index.html'), '<!doctype html><html><body><div id="root">ProfitPilot</div></body></html>')
  writeFileSync(join(path, 'assets', 'app.js'), 'console.log("x")')
  return path
}

function appWith(directory: StoreDirectory, sink = createMemorySink()): Express {
  return createApi({
    logger: new Logger(sink.sink),
    readinessChecks: [],
    session: { directory },
    embeddedEntry: { directory, sessionToken: { apiKey: API_KEY, apiSecret: API_SECRET } },
    webDistPath: webDist(),
  })
}

async function withServer<T>(app: Express, handler: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind')
  try {
    return await handler(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

describe('Shopify managed-installation app load', () => {
  it('registers the tenant and sets the session cookie on the first embedded load', async () => {
    const directory = new InMemoryStoreDirectory()
    await withServer(appWith(directory), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/?shop=${SHOP}&host=YWRtaW4%3D&embedded=1&id_token=${sessionToken()}`, { redirect: 'manual' })
      expect(response.status).toBe(200)

      // The stores row must now exist: this is what /session/context reads.
      const tenant = await directory.getByShopDomain(SHOP)
      expect(tenant).not.toBeNull()

      // ...and the cookie must be usable from inside the Shopify admin iframe.
      const setCookie = response.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain(`profitpilot_session=${tenant?.storeId ?? ''}`)
      expect(setCookie).toContain('SameSite=None')
      expect(setCookie).toContain('Secure')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('Path=/')
    })
  })

  it('serves a resolvable context to the dashboard after the app load', async () => {
    const directory = new InMemoryStoreDirectory()
    await withServer(appWith(directory), async (baseUrl) => {
      const load = await fetch(`${baseUrl}/?shop=${SHOP}&id_token=${sessionToken()}`)
      const cookie = (load.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
      expect(cookie).toContain('profitpilot_session=')

      const context = await fetch(`${baseUrl}/session/context`, { headers: { cookie } })
      const body = await context.json() as { data: { storeId: string | null; shop: string | null } }
      expect(body.data.storeId).not.toBeNull()
      expect(body.data.shop).toBe(SHOP)
    })
  })

  it('does not create a tenant for an unsigned or forged shop parameter', async () => {
    const directory = new InMemoryStoreDirectory()
    await withServer(appWith(directory), async (baseUrl) => {
      await fetch(`${baseUrl}/?shop=attacker.myshopify.com`)
      await fetch(`${baseUrl}/?shop=attacker.myshopify.com&id_token=${sessionToken('attacker.myshopify.com', 'wrong-secret')}`)
      expect(await directory.getByShopDomain('attacker.myshopify.com')).toBeNull()
    })
  })

  it('logs and degrades gracefully when the tenant upsert fails', async () => {
    const sink = createMemorySink()
    const failing: StoreDirectory = {
      get: async () => null,
      getByShopDomain: async () => null,
      upsertByShopDomain: async () => { throw new Error('relation "stores" does not exist') },
    }
    await withServer(appWith(failing, sink), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/?shop=${SHOP}&id_token=${sessionToken()}`)
      // The merchant still gets the app, not a crash.
      expect(response.status).toBe(200)
      const logged = sink.records.some((record) => record.message === 'Embedded app load failed to register tenant' && String(record.context.error).includes('stores'))
      expect(logged).toBe(true)
    })
  })

  it('leaves static assets and API routes untouched', async () => {
    const directory = new InMemoryStoreDirectory()
    await withServer(appWith(directory), async (baseUrl) => {
      expect((await fetch(`${baseUrl}/assets/app.js?shop=${SHOP}&id_token=${sessionToken()}`)).status).toBe(200)
      expect(await directory.getByShopDomain(SHOP)).toBeNull()
    })
  })
})

describe('embedded frame headers', () => {
  it('allows Shopify admin to frame the app and the API responses it reads', async () => {
    await withServer(appWith(new InMemoryStoreDirectory()), async (baseUrl) => {
      const document = await fetch(`${baseUrl}/`)
      expect(document.headers.get('x-frame-options')).toBeNull()
      expect(document.headers.get('content-security-policy')).toContain('frame-ancestors https://admin.shopify.com https://*.myshopify.com')

      const api = await fetch(`${baseUrl}/session/context`)
      expect(api.headers.get('x-frame-options')).toBeNull()
      expect(api.headers.get('content-security-policy')).toContain('frame-ancestors https://admin.shopify.com https://*.myshopify.com')
    })
  })

  it('keeps a hard frame deny on infrastructure endpoints', async () => {
    await withServer(appWith(new InMemoryStoreDirectory()), async (baseUrl) => {
      const live = await fetch(`${baseUrl}/live`)
      expect(live.headers.get('x-frame-options')).toBe('DENY')
      expect(live.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    })
  })
})
