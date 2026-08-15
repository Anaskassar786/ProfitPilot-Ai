import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger } from '@profitpilot/logger'
import { InMemoryStoreDirectory } from '@profitpilot/db'
import { AppError } from '@profitpilot/types'
import { AdaptiveRateController, StoreCircuitRegistry, StoreRequestPolicy } from '@profitpilot/sync'
import { createApi } from './app.js'
import { TokenRefreshingSync } from './token-refresh-sync.js'

const SHOP = 'commander-pilot.myshopify.com'

/**
 * End-to-end regression for the PR #14 production failure on
 * commander-pilot.myshopify.com: repeated token-less syncs tripped the store
 * circuit, after which /sync answered 503 in ~9ms without ever calling Shopify,
 * and no hard refresh could recover it until the cooldown expired.
 */
describe('production scenario: sync blocked by an open circuit', () => {
  it('recovers on the next /sync once an id_token is supplied', async () => {
    const directory = new InMemoryStoreDirectory()
    const tenant = await directory.upsertByShopDomain(SHOP)
    const circuits = new StoreCircuitRegistry({ failureThreshold: 3, cooldownMs: 300_000 })
    const policy = new StoreRequestPolicy(new AdaptiveRateController({ sleep: async () => undefined }), circuits)
    let tokenPresent = false

    // The real engine path: the source throws when the vault has no token.
    const engine = { runModule: async (store: typeof tenant.storeId, module: 'products') => policy.execute(store, async () => {
      if (!tokenPresent) throw new AppError('DEPENDENCY_ERROR', 'token missing', 503, { reason: 'SHOPIFY_TOKEN_MISSING' })
      return { storeId: store, module, pages: 1, records: 5, cursor: null, resumedFrom: null }
    }) }
    const tokenExchange = { exchangeOfflineAccessToken: async () => { tokenPresent = true; return { shop: SHOP, scopes: ['read_orders'], source: 'exchanged' as const } } }
    const sync = new TokenRefreshingSync(engine, directory, tokenExchange, new Logger(), circuits)

    const app = createApi({ logger: new Logger(), readinessChecks: [], dataPlane: { sync, analytics: { read: async () => ({ revenue: [], orders: [], productSales: [], customerCohorts: [] }), readCatalog: async () => [] }, circuits, tokenVault: { get: async () => (tokenPresent ? 'shpat_x' : null) }, directory } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no address')
    const base = `http://127.0.0.1:${address.port}`
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/sync`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

    try {
      // Three token-less syncs: previously these tripped the breaker.
      for (let i = 0; i < 3; i += 1) {
        const response = await post({ storeId: tenant.storeId, module: 'products' })
        expect(response.status).toBe(503)
        expect((await response.json()).error.details.action).toBe('HARD_REFRESH')
      }
      // The circuit must still be closed: token failures are not upstream faults.
      expect(circuits.state(tenant.storeId).open).toBe(false)
      const status = await (await fetch(`${base}/sync/status?storeId=${tenant.storeId}`)).json()
      expect(status.data).toMatchObject({ hasAccessToken: false, canSync: false })

      // Hard refresh supplies an id_token: exchange runs, sync succeeds.
      const recovered = await post({ storeId: tenant.storeId, module: 'products' }, { 'x-shopify-session-token': 'fresh-id-token' })
      expect(recovered.status).toBe(202)
      expect((await recovered.json()).data.records).toBe(5)
      const after = await (await fetch(`${base}/sync/status?storeId=${tenant.storeId}`)).json()
      expect(after.data).toMatchObject({ hasAccessToken: true, canSync: true })
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
