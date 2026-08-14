import { randomUUID } from 'node:crypto'
import { AppError, ROLE_PERMISSIONS, ROLES } from '@profitpilot/types'
import type { Permission, Role } from '@profitpilot/types'

export type AccessAssignment = Readonly<{
  id: string
  storeId: string
  userId: string
  role: Role
  assignedBy: string
  createdAt: number
  updatedAt: number
  version: number
  revokedAt: number | null
}>

export type AccessAuditAction = 'ROLE_ASSIGNED' | 'ROLE_CHANGED' | 'ROLE_REVOKED' | 'ACCESS_REVIEW_EXPORTED'
export type AccessAuditEvent = Readonly<{
  id: string
  storeId: string
  actorId: string
  action: AccessAuditAction
  targetUserId: string | null
  beforeRole: Role | null
  afterRole: Role | null
  at: number
  details: Readonly<Record<string, string | number | boolean | null>>
}>

export type AccessMember = Readonly<AccessAssignment & { permissions: readonly Permission[] }>
export type AccessReviewReport = Readonly<{
  storeId: string
  generatedAt: number
  members: readonly AccessMember[]
  auditTrail: readonly AccessAuditEvent[]
}>
export type AccessReviewExport = Readonly<{ filename: string; contentType: string; body: string; report: AccessReviewReport }>

export interface AccessReviewRepository {
  listAssignments(storeId: string): Promise<readonly AccessAssignment[]>
  saveAssignment(assignment: AccessAssignment, expectedVersion: number | null): Promise<boolean>
  listAudit(storeId: string): Promise<readonly AccessAuditEvent[]>
  appendAudit(event: AccessAuditEvent): Promise<void>
}

export class InMemoryAccessReviewRepository implements AccessReviewRepository {
  private readonly assignments = new Map<string, AccessAssignment>()
  private readonly audit: AccessAuditEvent[] = []

  public async listAssignments(storeId: string): Promise<readonly AccessAssignment[]> {
    return [...this.assignments.values()].filter((assignment) => assignment.storeId === storeId)
  }

  public async saveAssignment(assignment: AccessAssignment, expectedVersion: number | null): Promise<boolean> {
    const key = `${assignment.storeId}:${assignment.userId}`
    const current = this.assignments.get(key)
    if (current === undefined && expectedVersion !== null) return false
    if (current !== undefined && (expectedVersion === null || current.version !== expectedVersion)) return false
    this.assignments.set(key, assignment)
    return true
  }

  public async listAudit(storeId: string): Promise<readonly AccessAuditEvent[]> {
    return this.audit.filter((event) => event.storeId === storeId)
  }

  public async appendAudit(event: AccessAuditEvent): Promise<void> {
    this.audit.push(event)
  }
}

export class AccessReviewService {
  private readonly repository: AccessReviewRepository
  private readonly now: () => number

  public constructor(repository: AccessReviewRepository = new InMemoryAccessReviewRepository(), now: () => number = () => Date.now()) {
    this.repository = repository
    this.now = now
  }

  public async assign(input: Readonly<{ storeId: string; userId: string; role: Role; actorId: string; expectedVersion?: number }>): Promise<AccessAssignment> {
    assertRole(input.role)
    const existing = await this.findAssignment(input.storeId, input.userId)
    const expectedVersion = input.expectedVersion ?? existing?.version ?? null
    const now = this.now()
    const assignment: AccessAssignment = {
      id: existing?.id ?? randomUUID(),
      storeId: input.storeId,
      userId: input.userId,
      role: input.role,
      assignedBy: input.actorId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
      revokedAt: null,
    }
    if (!(await this.repository.saveAssignment(assignment, expectedVersion))) throw new AppError('CONFLICT', 'Access assignment changed; reload the access review', 409, { expectedVersion: expectedVersion ?? -1 })
    await this.repository.appendAudit({ id: randomUUID(), storeId: input.storeId, actorId: input.actorId, action: existing?.revokedAt === null ? 'ROLE_CHANGED' : 'ROLE_ASSIGNED', targetUserId: input.userId, beforeRole: existing?.revokedAt === null ? existing.role : null, afterRole: input.role, at: now, details: { version: assignment.version } })
    return assignment
  }

  public async revoke(input: Readonly<{ storeId: string; userId: string; actorId: string; expectedVersion: number }>): Promise<AccessAssignment> {
    const existing = await this.findAssignment(input.storeId, input.userId)
    if (!existing || existing.revokedAt !== null) throw new AppError('NOT_FOUND', 'Active access assignment not found', 404)
    const now = this.now()
    const revoked: AccessAssignment = { ...existing, updatedAt: now, version: existing.version + 1, revokedAt: now }
    if (!(await this.repository.saveAssignment(revoked, input.expectedVersion))) throw new AppError('CONFLICT', 'Access assignment changed; reload the access review', 409, { expectedVersion: input.expectedVersion })
    await this.repository.appendAudit({ id: randomUUID(), storeId: input.storeId, actorId: input.actorId, action: 'ROLE_REVOKED', targetUserId: input.userId, beforeRole: existing.role, afterRole: null, at: now, details: { version: revoked.version } })
    return revoked
  }

  public async report(storeId: string): Promise<AccessReviewReport> {
    const [assignments, auditTrail] = await Promise.all([this.repository.listAssignments(storeId), this.repository.listAudit(storeId)])
    const members = assignments.filter((assignment) => assignment.revokedAt === null).map((assignment) => ({ ...assignment, permissions: [...ROLE_PERMISSIONS[assignment.role]] }))
    return { storeId, generatedAt: this.now(), members, auditTrail }
  }

  public async export(storeId: string, actorId: string, format: 'CSV' | 'JSON' = 'CSV'): Promise<AccessReviewExport> {
    const report = await this.report(storeId)
    const now = this.now()
    await this.repository.appendAudit({ id: randomUUID(), storeId, actorId, action: 'ACCESS_REVIEW_EXPORTED', targetUserId: null, beforeRole: null, afterRole: null, at: now, details: { format } })
    if (format === 'JSON') return { filename: `access-review-${storeId}.json`, contentType: 'application/json; charset=utf-8', body: JSON.stringify(report), report }
    return { filename: `access-review-${storeId}.csv`, contentType: 'text/csv; charset=utf-8', body: csvReport(report), report }
  }

  private async findAssignment(storeId: string, userId: string): Promise<AccessAssignment | null> {
    const assignments = await this.repository.listAssignments(storeId)
    return assignments.find((assignment) => assignment.userId === userId) ?? null
  }
}

function assertRole(role: Role): void {
  if (!(ROLES as readonly string[]).includes(role)) throw new AppError('VALIDATION_ERROR', 'Unknown RBAC role', 400)
}

function csvReport(report: AccessReviewReport): string {
  const header = 'store_id,user_id,role,permissions,assignment_version,assigned_by,updated_at\n'
  const rows = report.members.map((member) => [report.storeId, member.userId, member.role, member.permissions.join('|'), member.version, member.assignedBy, new Date(member.updatedAt).toISOString()].map(csvValue).join(',')).join('\n')
  return `${header}${rows}${rows ? '\n' : ''}`
}

function csvValue(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
