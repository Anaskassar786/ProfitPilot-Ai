import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AdminStepUpSessions, FunnelLedger, TrialAndGiftLedger } from '@profitpilot/billing'
import { F9ControlService, InMemoryF9ControlRepository, InMemoryOpsQueue, AdminOpsService } from '@profitpilot/monitoring'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const controls = new F9ControlService(new InMemoryF9ControlRepository(), () => 100)
  const queue = new InMemoryOpsQueue(); queue.add({ id: 'failed-job', storeId: 'store-1', type: 'sync', status: 'failed', attempts: 1, lastError: 'timeout', availableAt: 1, createdAt: 1 })
  const stepUp = new AdminStepUpSessions()
  const app = createApi({ logger: new Logger(), readinessChecks: [], admin: { adminKey: 'admin-secret', stepUp, funnel: new FunnelLedger(), gifts: new TrialAndGiftLedger() }, f9: { controls, ops: new AdminOpsService(queue, controls, () => 100), stepUp } })
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function login(base: string): Promise<string> { const response = await fetch(`${base}/admin/step-up`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'admin-secret' }) }); return (await response.json() as { data: { stepUpToken: string } }).data.stepUpToken }

describe('F9 launch control and admin ops routes', () => {
  it('toggles maintenance while keeping live/admin endpoints exempt', async () => await withServer(async (base) => {
    const token = await login(base)
    const maintenance = await fetch(`${base}/admin/maintenance`, { headers: { 'x-admin-step-up': token } })
    expect((await maintenance.json()).data.enabled).toBe(false)
    const updated = await fetch(`${base}/admin/maintenance`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-step-up': token }, body: JSON.stringify({ enabled: true, message: 'Deploy now', expectedVersion: 0 }) })
    expect((await updated.json()).data.enabled).toBe(true)
    expect((await fetch(`${base}/live`)).status).toBe(200)
    expect((await fetch(`${base}/security/csrf`)).status).toBe(503)
    expect((await fetch(`${base}/admin/ops/queue`, { headers: { 'x-admin-step-up': token } })).status).toBe(200)
  }))

  it('manages per-merchant flags, blocks AI, and retries failed jobs', async () => await withServer(async (base) => {
    const token = await login(base)
    const flags = await fetch(`${base}/admin/merchant-flags?storeId=store-1`, { headers: { 'x-admin-step-up': token } })
    expect((await flags.json()).data.aiEnabled).toBe(true)
    const updated = await fetch(`${base}/admin/merchant-flags`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-step-up': token }, body: JSON.stringify({ storeId: 'store-1', aiEnabled: false, automationEnabled: true, suspended: false, expectedVersion: 0 }) })
    expect((await updated.json()).data.aiEnabled).toBe(false)
    expect((await fetch(`${base}/ai/agents?storeId=store-1`)).status).toBe(403)
    await fetch(`${base}/admin/merchant-flags`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-step-up': token }, body: JSON.stringify({ storeId: 'store-1', aiEnabled: false, automationEnabled: false, suspended: false, expectedVersion: 1 }) })
    expect((await fetch(`${base}/campaigns/templates?storeId=store-1`)).status).toBe(403)
    const retried = await fetch(`${base}/admin/ops/jobs/failed-job/retry`, { method: 'POST', headers: { 'x-admin-step-up': token } })
    expect((await retried.json()).data.status).toBe('queued')
    expect((await fetch(`${base}/admin/ops/metrics`, { headers: { 'x-admin-step-up': token } })).status).toBe(200)
  }))

  it('requires step-up and rejects CAS races', async () => await withServer(async (base) => {
    expect((await fetch(`${base}/admin/maintenance`)).status).toBe(401)
    const token = await login(base)
    const race = await fetch(`${base}/admin/maintenance`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-step-up': token }, body: JSON.stringify({ enabled: true, message: 'x', expectedVersion: 22 }) })
    expect(race.status).toBe(409)
  }))
})
