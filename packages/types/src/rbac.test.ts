import { describe, expect, it } from 'vitest'
import { AppError, PERMISSIONS, ROLE_PERMISSIONS, ROLES, hasPermission, requirePermission } from './index.js'

describe('seeded RBAC contracts', () => {
  it('defines all five roles', () => expect(ROLES).toEqual(['owner', 'admin', 'operator', 'analyst', 'viewer']))
  it('defines the permission vocabulary', () => expect(PERMISSIONS).toContain('recommendations:approve'))
  it('gives owners every permission', () => expect(ROLE_PERMISSIONS.owner).toHaveLength(PERMISSIONS.length))
  it('allows admins to approve recommendations', () => expect(hasPermission('admin', 'recommendations:approve')).toBe(true))
  it('does not give admins billing write access', () => expect(hasPermission('admin', 'billing:write')).toBe(false))
  it('allows operators to write orders', () => expect(hasPermission('operator', 'orders:write')).toBe(true))
  it('keeps viewers read-only', () => expect(hasPermission('viewer', 'orders:write')).toBe(false))
  it('allows analysts to read analytics', () => expect(hasPermission('analyst', 'analytics:read')).toBe(true))
  it('asserts allowed permissions', () => expect(() => requirePermission('owner', 'team:write')).not.toThrow())
  it('throws a typed forbidden error for disallowed permissions', () => expect(() => requirePermission('viewer', 'team:write')).toThrow(AppError))
  it('includes role and permission in forbidden details', () => {
    try {
      requirePermission('viewer', 'billing:write')
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'FORBIDDEN', details: { role: 'viewer', permission: 'billing:write' } })
    }
  })
})
