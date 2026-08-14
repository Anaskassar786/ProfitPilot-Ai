import { AppError, hasPermission } from '@profitpilot/types'
import type { Permission, Role, StoreId, UserId } from '@profitpilot/types'

export type RoleAssignment = Readonly<{ storeId: StoreId; userId: UserId; role: Role; createdAt: number }>

export class InMemoryRoleAssignments {
  private readonly assignments = new Map<string, RoleAssignment>()

  public assign(storeId: StoreId, userId: UserId, role: Role, now = Date.now()): RoleAssignment {
    const assignment: RoleAssignment = { storeId, userId, role, createdAt: now }
    this.assignments.set(`${storeId}:${userId}`, assignment)
    return assignment
  }

  public roleFor(storeId: StoreId, userId: UserId): Role | null {
    return this.assignments.get(`${storeId}:${userId}`)?.role ?? null
  }

  public can(storeId: StoreId, userId: UserId, permission: Permission): boolean {
    const role = this.roleFor(storeId, userId)
    return role !== null && hasPermission(role, permission)
  }

  public require(storeId: StoreId, userId: UserId, permission: Permission): void {
    const role = this.roleFor(storeId, userId)
    if (role === null || !hasPermission(role, permission)) {
      throw new AppError('FORBIDDEN', 'User does not have the requested permission', 403, { storeId, userId, permission })
    }
  }
}
