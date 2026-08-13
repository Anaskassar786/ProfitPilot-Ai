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

export const F4_MIGRATIONS: readonly Migration[] = [
  { id: '0006', filename: '0006_ai_loop.sql', sql: 'recommendations, evidence, executions, calibration, cost, and attribution' },
]

export const F5_MIGRATIONS: readonly Migration[] = [
  { id: '0007', filename: '0007_billing_growth.sql', sql: 'billing, trials, gift codes, usage, ROI, and funnel' },
]

export const F6_MIGRATIONS: readonly Migration[] = [
  { id: '0008', filename: '0008_automation_marketing.sql', sql: 'workflows, campaigns, sends, suppression, tracking, exports, and support threads' },
]

export const F7_MIGRATIONS: readonly Migration[] = [
  { id: '0009', filename: '0009_store_readiness.sql', sql: 'SOC-2-Lite access review assignments and immutable audit history' },
]

export const F8_MIGRATIONS: readonly Migration[] = [
  { id: '0010', filename: '0010_copilot_jarvis_reports.sql', sql: 'Jarvis sessions, Copilot threads, deterministic reports, and schedules' },
]

export const ALL_MIGRATIONS: readonly Migration[] = [...F0_MIGRATIONS, ...F1_MIGRATIONS, ...F2_MIGRATIONS, ...F4_MIGRATIONS, ...F5_MIGRATIONS, ...F6_MIGRATIONS, ...F7_MIGRATIONS, ...F8_MIGRATIONS]

export function pendingMigrations(appliedIds: readonly string[]): readonly Migration[] {
  const applied = new Set(appliedIds)
  return ALL_MIGRATIONS.filter((migration) => !applied.has(migration.id))
}
