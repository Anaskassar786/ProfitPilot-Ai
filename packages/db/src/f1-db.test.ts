import { describe, expect, it } from 'vitest'
import { AppError, storeId, userId } from '@profitpilot/types'
import type { QueryResultRow } from 'pg'
import { InMemoryRoleAssignments, InMemorySessionRepository, PostgresSessionRepository } from './index.js'
import type { DatabaseResult, SessionRecord, SqlExecutor } from './index.js'

const baseSession = (id = 'session-1', familyId = 'family-1'): SessionRecord => ({ id, familyId, storeId: storeId('store-1'), userId: userId('user-1'), refreshTokenHash: `hash-${id}`, expiresAt: 2_000, createdAt: 1_000, lastUsedAt: 1_000, revokedAt: null, replacedBy: null, reuseDetectedAt: null })

describe('rotating session repository', () => {
  it('creates and retrieves a session', async () => {
    const repository = new InMemorySessionRepository()
    await repository.create(baseSession())
    expect(await repository.get('session-1')).toMatchObject({ userId: 'user-1', storeId: 'store-1' })
  })
  it('rejects duplicate session ids', async () => {
    const repository = new InMemorySessionRepository()
    await repository.create(baseSession())
    await expect(repository.create(baseSession())).rejects.toThrow('already exists')
  })
  it('rotates a matching refresh hash', async () => {
    const repository = new InMemorySessionRepository()
    await repository.create(baseSession())
    const result = await repository.rotate('session-1', 'hash-session-1', baseSession('session-2'), 1_500)
    expect(result.status).toBe('rotated')
    expect((await repository.get('session-1'))?.replacedBy).toBe('session-2')
  })
  it('detects a refresh hash mismatch and revokes the family', async () => {
    const repository = new InMemorySessionRepository()
    await repository.create(baseSession())
    await repository.create(baseSession('session-2'))
    const result = await repository.rotate('session-1', 'wrong', baseSession('session-3'), 1_500)
    expect(result.status).toBe('reuse')
    expect((await repository.get('session-1'))?.reuseDetectedAt).toBe(1_500)
    expect((await repository.get('session-2'))?.revokedAt).toBe(1_500)
  })
  it('detects expired sessions', async () => {
    const repository = new InMemorySessionRepository()
    await repository.create(baseSession())
    expect((await repository.rotate('session-1', 'hash-session-1', baseSession('session-2'), 2_000)).status).toBe('expired')
  })
  it('returns missing for unknown sessions', async () => {
    expect((await new InMemorySessionRepository().rotate('missing', 'hash', baseSession('s2'), 1_000)).status).toBe('missing')
  })
  it('revokes an entire family explicitly', async () => {
    const repository = new InMemorySessionRepository()
    await repository.create(baseSession())
    await repository.create(baseSession('session-2'))
    expect(await repository.revokeFamily('family-1', 1_500)).toBe(2)
  })
})

describe('RBAC membership assignments', () => {
  it('assigns and reads a role per tenant membership', () => {
    const assignments = new InMemoryRoleAssignments()
    assignments.assign(storeId('store-1'), userId('user-1'), 'operator', 100)
    expect(assignments.roleFor(storeId('store-1'), userId('user-1'))).toBe('operator')
  })
  it('checks a role permission', () => {
    const assignments = new InMemoryRoleAssignments()
    assignments.assign(storeId('store-1'), userId('user-1'), 'analyst')
    expect(assignments.can(storeId('store-1'), userId('user-1'), 'analytics:read')).toBe(true)
    expect(assignments.can(storeId('store-1'), userId('user-1'), 'orders:write')).toBe(false)
  })
  it('isolates role assignments by tenant', () => {
    const assignments = new InMemoryRoleAssignments()
    assignments.assign(storeId('store-1'), userId('user-1'), 'owner')
    expect(assignments.roleFor(storeId('store-2'), userId('user-1'))).toBeNull()
  })
  it('throws forbidden when no membership exists', () => expect(() => new InMemoryRoleAssignments().require(storeId('store-1'), userId('user-1'), 'store:read')).toThrow(AppError))
})

describe('Postgres session adapter', () => {
  const row = { id: 'session-1', family_id: 'family-1', store_id: 'store-1', user_id: 'user-1', refresh_token_hash: 'hash-session-1', expires_at: new Date(2_000), created_at: new Date(1_000), last_used_at: new Date(1_000), revoked_at: null, replaced_by: null, reuse_detected_at: null }
  function fakeExecutor(updateRows = 1): { executor: SqlExecutor; calls: string[] } {
    const calls: string[] = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string, _values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
        calls.push(text)
        if (text.startsWith('SELECT *')) return { rows: [row as unknown as Row], rowCount: 1 }
        if (text.startsWith('UPDATE auth_sessions')) return { rows: [], rowCount: updateRows }
        return { rows: [], rowCount: 0 }
      },
    }
    return { executor, calls }
  }
  it('reads and maps a session row', async () => {
    const { executor } = fakeExecutor()
    expect(await new PostgresSessionRepository(executor).get('session-1')).toMatchObject({ expiresAt: 2_000, familyId: 'family-1' })
  })
  it('inserts a session through SQL', async () => {
    const { executor, calls } = fakeExecutor()
    await new PostgresSessionRepository(executor).create(baseSession())
    expect(calls[0]).toContain('INSERT INTO auth_sessions')
  })
  it('rotates a session and inserts successor', async () => {
    const { executor, calls } = fakeExecutor()
    const result = await new PostgresSessionRepository(executor).rotate('session-1', 'hash-session-1', baseSession('session-2'), 1_500)
    expect(result.status).toBe('rotated')
    expect(calls.some((query) => query.startsWith('UPDATE auth_sessions'))).toBe(true)
  })
  it('marks a failed SQL rotation as reuse', async () => {
    const { executor } = fakeExecutor(0)
    const result = await new PostgresSessionRepository(executor).rotate('session-1', 'wrong', baseSession('session-2'), 1_500)
    expect(result.status).toBe('reuse')
  })
  it('updates family revocation through SQL', async () => {
    const { executor } = fakeExecutor(2)
    expect(await new PostgresSessionRepository(executor).revokeFamily('family-1', 1_500, true)).toBe(2)
  })
})

