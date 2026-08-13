import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AccessAssignment, AccessAuditEvent, AccessReviewRepository } from '@profitpilot/monitoring'
import type { Role } from '@profitpilot/types'

type AssignmentRow = QueryResultRow & {
  id: string
  store_id: string
  user_id: string
  role: string
  assigned_by: string
  created_at: Date
  updated_at: Date
  version: number
  revoked_at: Date | null
}

type AuditRow = QueryResultRow & {
  id: string
  store_id: string
  actor_id: string
  action: AccessAuditEvent['action']
  target_user_id: string | null
  before_role: string | null
  after_role: string | null
  at: Date
  details: unknown
}

export class PostgresAccessReviewRepository implements AccessReviewRepository {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) {
    this.executor = executor
  }

  public async listAssignments(storeId: string): Promise<readonly AccessAssignment[]> {
    const result = await this.executor.query<AssignmentRow>('SELECT id, store_id, user_id, role_id AS role, assigned_by, created_at, updated_at, version, revoked_at FROM access_review_assignments WHERE store_id = $1 ORDER BY user_id', [storeId])
    return result.rows.map(toAssignment)
  }

  public async saveAssignment(assignment: AccessAssignment, expectedVersion: number | null): Promise<boolean> {
    if (expectedVersion === null) {
      const inserted = await this.executor.query<Pick<AssignmentRow, 'id'>>(
        'INSERT INTO access_review_assignments (id, store_id, user_id, role_id, assigned_by, created_at, updated_at, version, revoked_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($6 / 1000.0), $7, NULL) ON CONFLICT (store_id, user_id) DO NOTHING RETURNING id',
        [assignment.id, assignment.storeId, assignment.userId, assignment.role, assignment.assignedBy, assignment.updatedAt, assignment.version],
      )
      return inserted.rowCount === 1
    }
    const updated = await this.executor.query<Pick<AssignmentRow, 'id'>>(
      'UPDATE access_review_assignments SET role_id = $3, assigned_by = $4, updated_at = to_timestamp($5 / 1000.0), version = $6, revoked_at = CASE WHEN $7 THEN to_timestamp($5 / 1000.0) ELSE NULL END WHERE store_id = $1 AND user_id = $2 AND version = $8 RETURNING id',
      [assignment.storeId, assignment.userId, assignment.role, assignment.assignedBy, assignment.updatedAt, assignment.version, assignment.revokedAt !== null, expectedVersion],
    )
    return updated.rowCount === 1
  }

  public async listAudit(storeId: string): Promise<readonly AccessAuditEvent[]> {
    const result = await this.executor.query<AuditRow>('SELECT id, store_id, actor_id, action, target_user_id, before_role, after_role, at, details FROM access_review_audit WHERE store_id = $1 ORDER BY at, id', [storeId])
    return result.rows.map(toAudit)
  }

  public async appendAudit(event: AccessAuditEvent): Promise<void> {
    await this.executor.query('INSERT INTO access_review_audit (id, store_id, actor_id, action, target_user_id, before_role, after_role, at, details) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), $9::jsonb)', [event.id, event.storeId, event.actorId, event.action, event.targetUserId, event.beforeRole, event.afterRole, event.at, JSON.stringify(event.details)])
  }
}

function toAssignment(row: AssignmentRow): AccessAssignment {
  return { id: row.id, storeId: row.store_id, userId: row.user_id, role: row.role as Role, assignedBy: row.assigned_by, createdAt: row.created_at.valueOf(), updatedAt: row.updated_at.valueOf(), version: row.version, revokedAt: row.revoked_at?.valueOf() ?? null }
}

function toAudit(row: AuditRow): AccessAuditEvent {
  return { id: row.id, storeId: row.store_id, actorId: row.actor_id, action: row.action, targetUserId: row.target_user_id, beforeRole: roleOrNull(row.before_role), afterRole: roleOrNull(row.after_role), at: row.at.valueOf(), details: detailsObject(row.details) }
}

function roleOrNull(value: string | null): Role | null {
  return value === 'owner' || value === 'admin' || value === 'operator' || value === 'analyst' || value === 'viewer' ? value : null
}

function detailsObject(value: unknown): Readonly<Record<string, string | number | boolean | null>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, string | number | boolean | null> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child === null || typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') result[key] = child
  }
  return result
}
