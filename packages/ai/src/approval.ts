import { AppError } from '@profitpilot/types'

export type Approval = Readonly<{ id: string; status: 'pending' | 'approved' | 'rejected'; version: number; updatedAt: number }>

export class CompareAndSetApprovals {
  private readonly approvals = new Map<string, Approval>()

  public create(id: string, now = Date.now()): Approval {
    if (this.approvals.has(id)) throw new AppError('CONFLICT', 'Approval already exists', 409, { id })
    const approval: Approval = { id, status: 'pending', version: 0, updatedAt: now }
    this.approvals.set(id, approval)
    return approval
  }

  public get(id: string): Approval | null {
    return this.approvals.get(id) ?? null
  }

  public decide(id: string, expectedVersion: number, status: 'approved' | 'rejected', now = Date.now()): Approval {
    const current = this.approvals.get(id)
    if (!current) throw new AppError('NOT_FOUND', 'Approval not found', 404, { id })
    if (current.version !== expectedVersion || current.status !== 'pending') {
      throw new AppError('CONFLICT', 'Approval was already changed', 409, { id, expectedVersion, actualVersion: current.version })
    }
    const next: Approval = { ...current, status, version: current.version + 1, updatedAt: now }
    this.approvals.set(id, next)
    return next
  }
}
