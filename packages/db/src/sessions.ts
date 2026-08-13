import type { UserId, StoreId } from '@profitpilot/types'
import type { DatabaseResult, SqlExecutor } from './database.js'
import type { QueryResultRow } from 'pg'

export type SessionRecord = Readonly<{
  id: string
  familyId: string
  storeId: StoreId
  userId: UserId
  refreshTokenHash: string
  expiresAt: number
  createdAt: number
  lastUsedAt: number
  revokedAt: number | null
  replacedBy: string | null
  reuseDetectedAt: number | null
}>

export type RotationResult =
  | Readonly<{ status: 'rotated'; previous: SessionRecord }>
  | Readonly<{ status: 'missing' | 'reuse' | 'expired'; previous: SessionRecord | null }>

export interface SessionRepository {
  create(session: SessionRecord): Promise<void>
  get(id: string): Promise<SessionRecord | null>
  rotate(id: string, presentedHash: string, successor: SessionRecord, now: number): Promise<RotationResult>
  revokeFamily(familyId: string, now: number): Promise<number>
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>()

  public async create(session: SessionRecord): Promise<void> {
    if (this.sessions.has(session.id)) throw new Error(`Session ${session.id} already exists`)
    this.sessions.set(session.id, session)
  }

  public async get(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null
  }

  public async rotate(id: string, presentedHash: string, successor: SessionRecord, now: number): Promise<RotationResult> {
    const current = this.sessions.get(id)
    if (!current) return { status: 'missing', previous: null }
    if (current.expiresAt <= now) return { status: 'expired', previous: current }
    if (current.revokedAt !== null || current.refreshTokenHash !== presentedHash) {
      await this.revokeFamily(current.familyId, now, true)
      return { status: 'reuse', previous: current }
    }
    this.sessions.set(id, { ...current, revokedAt: now, replacedBy: successor.id, lastUsedAt: now })
    this.sessions.set(successor.id, successor)
    return { status: 'rotated', previous: current }
  }

  public async revokeFamily(familyId: string, now: number, reuseDetected = false): Promise<number> {
    let changed = 0
    for (const [id, session] of this.sessions.entries()) {
      if (session.familyId !== familyId) continue
      const next: SessionRecord = {
        ...session,
        revokedAt: session.revokedAt ?? now,
        reuseDetectedAt: reuseDetected ? now : session.reuseDetectedAt,
      }
      if (next.revokedAt !== session.revokedAt || next.reuseDetectedAt !== session.reuseDetectedAt) changed += 1
      this.sessions.set(id, next)
    }
    return changed
  }
}

type SessionRow = QueryResultRow & {
  id: string
  family_id: string
  store_id: string
  user_id: string
  refresh_token_hash: string
  expires_at: Date
  created_at: Date
  last_used_at: Date
  revoked_at: Date | null
  replaced_by: string | null
  reuse_detected_at: Date | null
}

export class PostgresSessionRepository implements SessionRepository {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) {
    this.executor = executor
  }

  public async create(session: SessionRecord): Promise<void> {
    await this.executor.query(
      `INSERT INTO auth_sessions (id, family_id, store_id, user_id, refresh_token_hash, expires_at, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))`,
      [session.id, session.familyId, session.storeId, session.userId, session.refreshTokenHash, session.expiresAt, session.createdAt, session.lastUsedAt],
    )
  }

  public async get(id: string): Promise<SessionRecord | null> {
    const result = await this.executor.query<SessionRow>('SELECT * FROM auth_sessions WHERE id = $1 LIMIT 1', [id])
    const row = result.rows[0]
    return row ? fromRow(row) : null
  }

  public async rotate(id: string, presentedHash: string, successor: SessionRecord, now: number): Promise<RotationResult> {
    const current = await this.get(id)
    if (!current) return { status: 'missing', previous: null }
    if (current.expiresAt <= now) return { status: 'expired', previous: current }
    const updated = await this.executor.query<Pick<SessionRow, 'id'>>(
      `UPDATE auth_sessions SET revoked_at = to_timestamp($3 / 1000.0), replaced_by = $4, last_used_at = to_timestamp($3 / 1000.0) WHERE id = $1 AND refresh_token_hash = $2 AND revoked_at IS NULL RETURNING id`,
      [id, presentedHash, now, successor.id],
    )
    if (updated.rowCount === 0) {
      await this.revokeFamily(current.familyId, now, true)
      return { status: 'reuse', previous: current }
    }
    await this.create(successor)
    return { status: 'rotated', previous: current }
  }

  public async revokeFamily(familyId: string, now: number, reuseDetected = false): Promise<number> {
    const result = await this.executor.query(
      `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, to_timestamp($2 / 1000.0)), reuse_detected_at = CASE WHEN $3 THEN to_timestamp($2 / 1000.0) ELSE reuse_detected_at END WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId, now, reuseDetected],
    )
    return result.rowCount
  }
}

function fromRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    familyId: row.family_id,
    storeId: row.store_id as StoreId,
    userId: row.user_id as UserId,
    refreshTokenHash: row.refresh_token_hash,
    expiresAt: row.expires_at.valueOf(),
    createdAt: row.created_at.valueOf(),
    lastUsedAt: row.last_used_at.valueOf(),
    revokedAt: row.revoked_at?.valueOf() ?? null,
    replacedBy: row.replaced_by,
    reuseDetectedAt: row.reuse_detected_at?.valueOf() ?? null,
  }
}
