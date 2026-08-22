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

export const AI_EXECUTIVE_MIGRATIONS: readonly Migration[] = [
  { id: '0022', filename: '0022_ai_executive.sql', sql: 'AI Executive board reports, benchmarks, scenarios, health, opportunities, decisions, risks, roadmaps, and preferences' },
]

export const STORE_COACH_MIGRATIONS: readonly Migration[] = [
  { id: '0023', filename: '0023_store_coach.sql', sql: 'Store Coach huddles, priorities, goals, streaks, health scores, coach reports, conversations, onboarding, achievements, usage, and preferences' },
]

export const INSIGHTS_HUB_MIGRATIONS: readonly Migration[] = [
  { id: '0024', filename: '0024_insights_hub.sql', sql: 'Insights Hub discoveries, lessons, patterns, personas, investigations, trends, comparisons, knowledge, timeline, predictions, preferences, and API usage' },
]

// PatternAI (formerly Insights Hub): repairs the uuid/text id mismatch from
// 0024 that made every discovery write — and therefore the whole page — fail.
export const PATTERN_AI_MIGRATIONS: readonly Migration[] = [
  { id: '0025', filename: '0025_patternai_id_types.sql', sql: 'PatternAI id columns widened to text, pattern/trend upsert uniqueness, and discovery feed index' },
]

// Data Exports: durable export history + monthly plan metering.
export const DATA_EXPORT_MIGRATIONS: readonly Migration[] = [
  { id: '0026', filename: '0026_data_exports.sql', sql: 'Export history for plan metering, last-exported timestamps, and the merchant-facing export history list' },
]

// QA (2026-08-20): two migrations shipped as files but were never registered
// in ALL_MIGRATIONS because their ids collided with siblings (0018 and 0021
// were both taken). Fresh databases therefore never ran them, which caused:
//   * "column charge_id does not exist" — every billing read 500'd, and
//   * "column status does not exist" — the app/uninstalled webhook handler
//     could not mark the store UNINSTALLED.
// They are renumbered to unique ids (0028/0029) so the migration runner and
// the registry integrity test both pass. Content is idempotent, so existing
// production databases are unaffected.
// 0027 adds gift_codes.expires_at for a distinct "code expired" message.
export const QA_REGISTERED_MIGRATIONS: readonly Migration[] = [
  { id: '0027', filename: '0027_gift_code_expiry.sql', sql: 'optional gift_codes.expires_at for distinct expired-code messaging' },
  { id: '0028', filename: '0028_billing_charge_id.sql', sql: 'idempotent charge_id column for billing_subscriptions' },
  { id: '0029', filename: '0029_app_uninstalled_webhook.sql', sql: 'stores.status/uninstalled_at columns for app/uninstalled handling' },
]

// GDPR customers/data_request fulfillment: the compiled customer data export
// is stored on the compliance request so a data_request is actually fulfilled
// (not just acknowledged) and the export is purged on customers/redact.
export const GDPR_DATA_REQUEST_MIGRATIONS: readonly Migration[] = [
  { id: '0030', filename: '0030_gdpr_data_request_export.sql', sql: 'privacy_compliance_requests.export_data for compiled data_request exports' },
]

// Gift-code sequencing (primary/secondary) + permanent trial forfeiture on
// gift redemption (GA 2026-08-22). See 0031_gift_sequence_trial_forfeit.sql.
export const GIFT_POLICY_MIGRATIONS: readonly Migration[] = [
  { id: '0031', filename: '0031_gift_sequence_trial_forfeit.sql', sql: 'gift_codes.sequence for primary/secondary ordering and trials.trial_forfeited for permanent trial forfeiture on gift redemption' },
]

export const ALL_MIGRATIONS: readonly Migration[] = [...F0_MIGRATIONS, ...F1_MIGRATIONS, ...F2_MIGRATIONS, ...F4_MIGRATIONS, ...F5_MIGRATIONS, ...F6_MIGRATIONS, ...F7_MIGRATIONS, ...F8_MIGRATIONS, ...F9_MIGRATIONS, ...F10_MIGRATIONS, ...SECURITY_MIGRATIONS, ...OPERATOR_MIGRATIONS, ...CUSTOMER_CAMPAIGN_MIGRATIONS, ...PRIVACY_COMPLIANCE_MIGRATIONS, ...INVENTORY_INTELLIGENCE_MIGRATIONS, ...AUTOMATION_PROFESSIONAL_MIGRATIONS, ...AI_COMMAND_CENTER_MIGRATIONS, ...RECOMMENDATION_LIFECYCLE_MIGRATIONS, ...AI_COMMAND_MIGRATIONS, ...AI_EXECUTIVE_MIGRATIONS, ...STORE_COACH_MIGRATIONS, ...INSIGHTS_HUB_MIGRATIONS, ...PATTERN_AI_MIGRATIONS, ...DATA_EXPORT_MIGRATIONS, ...QA_REGISTERED_MIGRATIONS, ...GDPR_DATA_REQUEST_MIGRATIONS, ...GIFT_POLICY_MIGRATIONS]

export function pendingMigrations(appliedIds: readonly string[]): readonly Migration[] {
  const applied = new Set(appliedIds)
  return ALL_MIGRATIONS.filter((migration) => !applied.has(migration.id))
}
