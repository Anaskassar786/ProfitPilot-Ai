export type Migration = Readonly<{ id: string; filename: string; sql: string }>

export const F0_MIGRATIONS: readonly Migration[] = [
  { id: '0001', filename: '0001_core_tenancy.sql', sql: 'core tenancy and row-level security' },
  { id: '0002', filename: '0002_audit_and_jobs.sql', sql: 'audit log and job ledger idempotency tables' },
]

export function pendingMigrations(appliedIds: readonly string[]): readonly Migration[] {
  const applied = new Set(appliedIds)
  return F0_MIGRATIONS.filter((migration) => !applied.has(migration.id))
}
