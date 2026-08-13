import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AdminStepUpSessions, FunnelLedger, TrialAndGiftLedger } from '@profitpilot/billing'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const app = createApi({ logger: new Logger(), readinessChecks: [], admin: { adminKey: 'admin-secret', stepUp: new AdminStepUpSessions(), funnel: new FunnelLedger(), gifts: new TrialAndGiftLedger() } })
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('F5 admin step-up routes', () => {
  it('issues a 15-minute step-up token with the admin key', async () => await withServer(async (base) => { const response = await fetch(`${base}/admin/step-up`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'admin-secret' }) }); expect(response.status).toBe(200); expect((await response.json()).data.expiresInMinutes).toBe(15) }))
  it('rejects an invalid admin key', async () => await withServer(async (base) => expect((await fetch(`${base}/admin/step-up`, { method: 'POST', body: JSON.stringify({ key: 'wrong' }) })).status).toBe(401)))
  it('requires step-up for writes', async () => await withServer(async (base) => expect((await fetch(`${base}/admin/gift-kill-switch`, { method: 'POST', body: JSON.stringify({ active: true }) })).status).toBe(401)))
  it('allows a step-up write', async () => await withServer(async (base) => { const login = await fetch(`${base}/admin/step-up`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'admin-secret' }) }); const token = (await login.json()).data.stepUpToken as string; const response = await fetch(`${base}/admin/gift-kill-switch`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-step-up': token }, body: JSON.stringify({ active: true }) }); expect(response.status).toBe(200) }))
  it('reads a funnel with step-up', async () => await withServer(async (base) => { const login = await fetch(`${base}/admin/step-up`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'admin-secret' }) }); const token = (await login.json()).data.stepUpToken as string; expect((await fetch(`${base}/admin/funnel?shopId=s`, { headers: { 'x-admin-step-up': token } })).status).toBe(200) }))
  it('rejects a malformed kill-switch write', async () => await withServer(async (base) => { const login = await fetch(`${base}/admin/step-up`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'admin-secret' }) }); const token = (await login.json()).data.stepUpToken as string; expect((await fetch(`${base}/admin/gift-kill-switch`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-step-up': token }, body: JSON.stringify({ active: 'yes' }) })).status).toBe(400) }))
})
