export type Migration = Readonly<{ id: string; filename: string; sql: string }>

export const F0_MIGRATIONS: readonly Migration[] = [
  { id: '0001', filename: '0001_core_tenancy.sql', sql: 'core tenancy and row-level security' },
  { id: '0002', filename: '0002_audit_and_jobs.sql', sql: 'audit log and job ledger idempotency tables' },
]

export const F1_MIGRATIONS: readonly Migration[] = [
  { id: '0003', filename: '0003_rbac_and_sessions.sql', sql: 'seeded RBAC and rotating auth sessions' },
  { id: '0004', filename: '0004_shopify_webhooks.sql', sql: 'replay-safe webhook receipt ledger' },
]

export const F2_MIGRATIONS: readonly Migration[] = [
  { id: '0005', filename: '0005_data_plane.sql', sql: 'sync checkpoints, catalog facts, and four analytics aggregates' },
]

export const ALL_MIGRATIONS: readonly Migration[] = [...F0_MIGRATIONS, ...F1_MIGRATIONS, ...F2_MIGRATIONS]

export function pendingMigrations(appliedIds: readonly string[]): readonly Migration[] {
  const applied = new Set(appliedIds)
  return ALL_MIGRATIONS.filter((migration) => !applied.has(migration.id))
}
