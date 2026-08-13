import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { AdminStepUpSessions, FunnelLedger, TrialAndGiftLedger } from '@profitpilot/billing'
import { AccessReviewService } from '@profitpilot/monitoring'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'
import { PostgresAccessReviewRepository } from './access-review-repository.js'

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const app = createApi({ logger: new Logger(), readinessChecks: [], admin: { adminKey: 'admin-secret', stepUp: new AdminStepUpSessions(), funnel: new FunnelLedger(), gifts: new TrialAndGiftLedger(), accessReview: new AccessReviewService() } })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function stepUp(base: string): Promise<string> {
  const response = await fetch(`${base}/admin/step-up`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'admin-secret' }) })
  return (await response.json() as { data: { stepUpToken: string } }).data.stepUpToken
}

describe('F7 access-review admin API', () => {
  it('shows live permissions, changes roles, revokes, and exports', async () => await withServer(async (base) => {
    const token = await stepUp(base)
    const headers = { 'content-type': 'application/json', 'x-admin-step-up': token }
    const assigned = await fetch(`${base}/admin/access-review/assign`, { method: 'POST', headers, body: JSON.stringify({ storeId: 'store-a', userId: 'user-a', actorId: 'admin', role: 'viewer' }) })
    expect(assigned.status).toBe(200)
    const report = await fetch(`${base}/admin/access-review?storeId=store-a`, { headers: { 'x-admin-step-up': token } })
    expect((await report.json()).data.members[0].permissions).toContain('orders:read')
    const changed = await fetch(`${base}/admin/access-review/assign`, { method: 'POST', headers, body: JSON.stringify({ storeId: 'store-a', userId: 'user-a', actorId: 'admin', role: 'analyst', expectedVersion: 1 }) })
    expect(changed.status).toBe(200)
    const exported = await fetch(`${base}/admin/access-review/export?storeId=store-a&format=CSV`, { headers: { 'x-admin-step-up': token } })
    expect((await exported.json()).data.body).toContain('user-a')
    const revoked = await fetch(`${base}/admin/access-review/revoke`, { method: 'POST', headers, body: JSON.stringify({ storeId: 'store-a', userId: 'user-a', actorId: 'admin', expectedVersion: 2 }) })
    expect(revoked.status).toBe(200)
  }))

  it('keeps access review behind step-up and validates bodies', async () => await withServer(async (base) => {
    expect((await fetch(`${base}/admin/access-review?storeId=store-a`)).status).toBe(401)
    const token = await stepUp(base)
    const response = await fetch(`${base}/admin/access-review/assign`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-step-up': token }, body: JSON.stringify({ storeId: 'store-a', userId: 'user-a', actorId: 'admin', role: 'not-a-role' }) })
    expect(response.status).toBe(400)
  }))
})

describe('F7 Postgres access-review adapter', () => {
  const assignmentRow = { id: 'a1', store_id: 'store-a', user_id: 'user-a', role: 'viewer', assigned_by: 'admin', created_at: new Date(100), updated_at: new Date(200), version: 1, revoked_at: null }
  const auditRow = { id: 'event-1', store_id: 'store-a', actor_id: 'admin', action: 'ROLE_ASSIGNED' as const, target_user_id: 'user-a', before_role: null, after_role: 'viewer', at: new Date(200), details: { version: 1 } }

  it('uses parameterized SQL for assignments and audit records', async () => {
    const calls: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> {
      calls.push(text)
      if (text.includes('access_review_assignments') && text.startsWith('SELECT')) return { rows: [assignmentRow as unknown as Row], rowCount: 1 }
      if (text.includes('access_review_audit')) return { rows: [auditRow as unknown as Row], rowCount: 1 }
      return { rows: [], rowCount: text.startsWith('INSERT') || text.startsWith('UPDATE') ? 1 : 0 }
    } }
    const repository = new PostgresAccessReviewRepository(executor)
    expect((await repository.listAssignments('store-a'))[0]?.role).toBe('viewer')
    expect((await repository.listAudit('store-a'))[0]?.action).toBe('ROLE_ASSIGNED')
    expect(await repository.saveAssignment({ id: 'a1', storeId: 'store-a', userId: 'user-a', role: 'viewer', assignedBy: 'admin', createdAt: 100, updatedAt: 200, version: 1, revokedAt: null }, null)).toBe(true)
    expect(await repository.saveAssignment({ id: 'a1', storeId: 'store-a', userId: 'user-a', role: 'admin', assignedBy: 'admin', createdAt: 100, updatedAt: 300, version: 2, revokedAt: null }, 1)).toBe(true)
    await repository.appendAudit({ id: 'event-2', storeId: 'store-a', actorId: 'admin', action: 'ROLE_CHANGED', targetUserId: 'user-a', beforeRole: 'viewer', afterRole: 'admin', at: 300, details: { version: 2 } })
    expect(calls.every((query) => !query.includes("'store-a'") && !query.includes("'user-a'"))).toBe(true)
  })

  it('returns false when CAS writes lose a race and tolerates malformed details', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> {
      if (text.startsWith('SELECT') && text.includes('access_review_audit')) return { rows: [{ ...auditRow, details: ['not-an-object'] } as unknown as Row], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    } }
    const repository = new PostgresAccessReviewRepository(executor)
    expect(await repository.saveAssignment({ id: 'a1', storeId: 'store-a', userId: 'user-a', role: 'viewer', assignedBy: 'admin', createdAt: 100, updatedAt: 200, version: 1, revokedAt: null }, null)).toBe(false)
    expect(await repository.saveAssignment({ id: 'a1', storeId: 'store-a', userId: 'user-a', role: 'viewer', assignedBy: 'admin', createdAt: 100, updatedAt: 200, version: 2, revokedAt: 200 }, 1)).toBe(false)
    expect((await repository.listAudit('store-a'))[0]?.details).toEqual({})
  })
})
