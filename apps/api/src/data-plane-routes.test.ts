import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'
import type { DataPlaneDependencies } from './data-plane-routes.js'

const analytics = { revenue: [], orders: [], productSales: [], customerCohorts: [] }

async function request(path: string, init?: RequestInit): Promise<Response> {
  const dataPlane: DataPlaneDependencies = {
    sync: { runModule: async (store, module) => ({ storeId: store, module, pages: 1, records: 0, cursor: null, resumedFrom: null }) },
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
