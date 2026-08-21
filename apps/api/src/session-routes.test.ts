import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { InMemoryStoreDirectory } from '@profitpilot/db'
import type { StoreDirectory } from '@profitpilot/db'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'
import type { Express } from 'express'

async function withServer<T>(app: Express, handler: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP address')
  try {
    return await handler(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function appWith(directory: StoreDirectory): Express {
  return createApi({ logger: new Logger(), readinessChecks: [], session: { directory } })
}

describe('session context API route', () => {
  it('returns an empty context without a cookie or shop parameter', async () => {
    await withServer(appWith(new InMemoryStoreDirectory()), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/session/context`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, data: { storeId: null, shop: null, installed: false } })
    })
  })

  it('resolves the tenant from the session cookie', async () => {
    const directory = new InMemoryStoreDirectory()
    const tenant = await directory.upsertByShopDomain('demo.myshopify.com')
    await withServer(appWith(directory), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/session/context`, { headers: { cookie: `profitpilot_session=${tenant.storeId}` } })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, data: { storeId: tenant.storeId, shop: 'demo.myshopify.com', installed: true } })
    })
  })

  it('resolves the tenant from the shop query parameter', async () => {
    const directory = new InMemoryStoreDirectory()
    const tenant = await directory.upsertByShopDomain('commander-pilot.myshopify.com')
    await withServer(appWith(directory), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/session/context?shop=${encodeURIComponent('commander-pilot.myshopify.com')}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, data: { storeId: tenant.storeId, shop: 'commander-pilot.myshopify.com', installed: true } })
    })
  })

  it('ignores an unknown cookie value', async () => {
    await withServer(appWith(new InMemoryStoreDirectory()), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/session/context`, { headers: { cookie: 'profitpilot_session=does-not-exist' } })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, data: { storeId: null, shop: null, installed: false } })
    })
  })
})
