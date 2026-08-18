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

export const F9_MIGRATIONS: readonly Migration[] = [
  { id: '0011', filename: '0011_launch_controls.sql', sql: 'maintenance mode, merchant flags, and launch audit history' },
]

export const F10_MIGRATIONS: readonly Migration[] = [
  { id: '0012', filename: '0012_shopify_oauth_states.sql', sql: 'single-use Shopify OAuth state tokens shared across API processes' },
]

export const SECURITY_MIGRATIONS: readonly Migration[] = [
  { id: '0013', filename: '0013_stores_rls_with_check.sql', sql: 'explicit stores RLS WITH CHECK for tenant and signed shop registration contexts' },
]

export const OPERATOR_MIGRATIONS: readonly Migration[] = [
  { id: '0014', filename: '0014_operator_fixes.sql', sql: 'tenant-safe writes, report PDF bytes, ticket descriptions, and workflow draft hashes' },
]

export const CUSTOMER_CAMPAIGN_MIGRATIONS: readonly Migration[] = [
  { id: '0015', filename: '0015_targeted_campaign_safety.sql', sql: 'durable customer-targeted campaign idempotency and outcome metadata' },
]

export const PRIVACY_COMPLIANCE_MIGRATIONS: readonly Migration[] = [
  { id: '0016', filename: '0016_shopify_privacy_compliance.sql', sql: 'Shopify customer data request and redaction audit state' },
]

export const INVENTORY_INTELLIGENCE_MIGRATIONS: readonly Migration[] = [
  { id: '0017', filename: '0017_inventory_snapshots.sql', sql: 'daily inventory snapshots for stock history and seasonal analysis' },
]

export const AUTOMATION_PROFESSIONAL_MIGRATIONS: readonly Migration[] = [
  { id: '0018', filename: '0018_professional_automation.sql', sql: 'professional workflows, immutable versions, runs, approvals, and notifications' },
]

export const AI_COMMAND_CENTER_MIGRATIONS: readonly Migration[] = [
  { id: '0019', filename: '0019_ai_command_center.sql', sql: 'AI cost attribution, recommendation dedupe, and agent settings' },
]

export const RECOMMENDATION_LIFECYCLE_MIGRATIONS: readonly Migration[] = [
  { id: '0020', filename: '0020_recommendation_lifecycle.sql', sql: 'recommendation decision audit, entity linkage, expiry, and snooze state' },
]

export const AI_COMMAND_MIGRATIONS: readonly Migration[] = [
  { id: '0021', filename: '0021_ai_command.sql', sql: 'AI Command conversations, actions, saved shortcuts, usage, and preferences' },
]

export const ALL_MIGRATIONS: readonly Migration[] = [...F0_MIGRATIONS, ...F1_MIGRATIONS, ...F2_MIGRATIONS, ...F4_MIGRATIONS, ...F5_MIGRATIONS, ...F6_MIGRATIONS, ...F7_MIGRATIONS, ...F8_MIGRATIONS, ...F9_MIGRATIONS, ...F10_MIGRATIONS, ...SECURITY_MIGRATIONS, ...OPERATOR_MIGRATIONS, ...CUSTOMER_CAMPAIGN_MIGRATIONS, ...PRIVACY_COMPLIANCE_MIGRATIONS, ...INVENTORY_INTELLIGENCE_MIGRATIONS, ...AUTOMATION_PROFESSIONAL_MIGRATIONS, ...AI_COMMAND_CENTER_MIGRATIONS, ...RECOMMENDATION_LIFECYCLE_MIGRATIONS, ...AI_COMMAND_MIGRATIONS]

export function pendingMigrations(appliedIds: readonly string[]): readonly Migration[] {
  const applied = new Set(appliedIds)
  return ALL_MIGRATIONS.filter((migration) => !applied.has(migration.id))
}
