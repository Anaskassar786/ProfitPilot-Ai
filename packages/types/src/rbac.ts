import { AppError } from './errors.js'

export const ROLES = ['owner', 'admin', 'operator', 'analyst', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'store:read',
  'store:write',
  'orders:read',
  'orders:write',
  'customers:read',
  'customers:write',
  'catalog:read',
  'catalog:write',
  'recommendations:read',
  'recommendations:approve',
  'analytics:read',
  'automation:read',
  'automation:write',
  'billing:read',
  'billing:write',
  'team:read',
  'team:write',
  'audit:read',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((permission) => permission !== 'billing:write'),
  operator: ['store:read', 'orders:read', 'orders:write', 'customers:read', 'customers:write', 'catalog:read', 'recommendations:read', 'recommendations:approve', 'automation:read', 'automation:write', 'audit:read'],
  analyst: ['store:read', 'orders:read', 'customers:read', 'catalog:read', 'recommendations:read', 'analytics:read' as Permission, 'audit:read'],
  viewer: ['store:read', 'orders:read', 'customers:read', 'catalog:read', 'recommendations:read'],
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new AppError('FORBIDDEN', `Role ${role} cannot perform ${permission}`, 403, { role, permission })
  }
}
