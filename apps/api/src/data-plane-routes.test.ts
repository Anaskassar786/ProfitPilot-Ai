import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger } from '@profitpilot/logger'
import { StoreCircuitRegistry } from '@profitpilot/sync'
import { storeId } from '@profitpilot/types'
import { createApi } from './app.js'
import type { DataPlaneDependencies } from './data-plane-routes.js'

const analytics = { revenue: [], orders: [], productSales: [], customerCohorts: [] }

async function request(path: string, init?: RequestInit, sync: DataPlaneDependencies['sync'] = { runModule: async (store, module) => ({ storeId: store, module, pages: 1, records: 0, cursor: null, resumedFrom: null }) }): Promise<Response> {
  const dataPlane: DataPlaneDependencies = {
    sync,
    analytics: { read: async () => analytics, readCatalog: async () => [] },
  }
  const server = createServer(createApi({ logger: new Logger(), readinessChecks: [], dataPlane }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try { return await fetch(`http://127.0.0.1:${address.port}${path}`, init) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('F2 data plane API', () => {
  it('starts a valid module sync', async () => {
    const response = await request('/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', module: 'products' }) })
    expect(response.status).toBe(202)
    expect((await response.json()).data.module).toBe('products')
  })
  it('passes the Shopify session token to the sync retry boundary', async () => {
    let receivedToken: string | undefined
    const sync: DataPlaneDependencies['sync'] = {
      runModule: async (store, module, idToken) => {
        receivedToken = idToken
        return { storeId: store, module, pages: 1, records: 0, cursor: null, resumedFrom: null }
      },
    }
    const response = await request('/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-session-token': 'signed-id-token' }, body: JSON.stringify({ storeId: 'store-1', module: 'products' }) }, sync)
    expect(response.status).toBe(202)
    expect(receivedToken).toBe('signed-id-token')
  })

  it('rejects an invalid sync module', async () => {
    const response = await request('/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', module: 'unknown' }) })
    expect(response.status).toBe(400)
  })
  it('returns pre-aggregated analytics', async () => {
    const response = await request('/analytics?storeId=store-1')
    expect(response.status).toBe(200)
    expect((await response.json()).data.revenue).toEqual([])
  })
  it('returns catalog data', async () => {
    const response = await request('/catalog?storeId=store-1')
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual([])
  })
  it('validates a missing analytics tenant', async () => expect((await request('/analytics')).status).toBe(400))
  it('validates malformed sync input', async () => {
    const response = await request('/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
    expect(response.status).toBe(400)
  })
})

async function withDataPlane<T>(dataPlane: DataPlaneDependencies, handler: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(createApi({ logger: new Logger(), readinessChecks: [], dataPlane }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

function dataPlaneWith(circuits: StoreCircuitRegistry, token: string | null): DataPlaneDependencies {
  return {
    sync: { runModule: async (store, module) => ({ storeId: store, module, pages: 1, records: 0, cursor: null, resumedFrom: null }) },
    analytics: { read: async () => analytics, readCatalog: async () => [] },
    circuits,
    tokenVault: { get: async () => token },
    directory: { get: async (store) => ({ storeId: store, shopDomain: 'commander-pilot.myshopify.com', installedAt: 0 }) },
  }
}

describe('sync connection diagnostics', () => {
  it('reports a healthy store as syncable', async () => {
    const dataPlane = dataPlaneWith(new StoreCircuitRegistry(), 'shpat_token')
    await withDataPlane(dataPlane, async (base) => {
      const body = await (await fetch(`${base}/sync/status?storeId=store-1`)).json()
      expect(body.data).toMatchObject({ registered: true, hasAccessToken: true, canSync: true, shopDomain: 'commander-pilot.myshopify.com' })
      expect(body.data.circuit).toMatchObject({ open: false, failures: 0 })
    })
  })

  it('shows a missing offline token as not syncable', async () => {
    await withDataPlane(dataPlaneWith(new StoreCircuitRegistry(), null), async (base) => {
      const body = await (await fetch(`${base}/sync/status?storeId=store-1`)).json()
      expect(body.data).toMatchObject({ hasAccessToken: false, canSync: false })
    })
  })

  it('exposes an open circuit with its remaining cooldown', async () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1, cooldownMs: 60_000 })
    circuits.recordFailure(storeId('store-1'))
    await withDataPlane(dataPlaneWith(circuits, 'shpat_token'), async (base) => {
      const body = await (await fetch(`${base}/sync/status?storeId=store-1`)).json()
      expect(body.data.circuit.open).toBe(true)
      expect(body.data.canSync).toBe(false)
      expect(body.data.circuit.retryAfterMs).toBeGreaterThan(0)
    })
  })

  it('never returns the access token itself', async () => {
    await withDataPlane(dataPlaneWith(new StoreCircuitRegistry(), 'shpat_supersecret'), async (base) => {
      expect(await (await fetch(`${base}/sync/status?storeId=store-1`)).text()).not.toContain('shpat_supersecret')
    })
  })

  it('requires a storeId', async () => await withDataPlane(dataPlaneWith(new StoreCircuitRegistry(), null), async (base) => expect((await fetch(`${base}/sync/status`)).status).toBe(400)))
})

describe('manual circuit reset', () => {
  it('closes an open circuit on request', async () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1, cooldownMs: 60_000 })
    circuits.recordFailure(storeId('store-1'))
    await withDataPlane(dataPlaneWith(circuits, 'shpat_token'), async (base) => {
      const response = await fetch(`${base}/sync/circuit/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1' }) })
      expect(response.status).toBe(200)
      expect((await response.json()).data.circuit.open).toBe(false)
      expect(circuits.state(storeId('store-1')).open).toBe(false)
    })
  })

  it('validates a missing storeId', async () => await withDataPlane(dataPlaneWith(new StoreCircuitRegistry(), null), async (base) => expect((await fetch(`${base}/sync/circuit/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(400)))
})
