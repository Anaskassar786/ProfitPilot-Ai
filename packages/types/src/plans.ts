export const PLAN_TIERS = ['trial', 'start', 'growth', 'commander'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

export type Entitlement = Readonly<{
  key: string
  limit: number | null
  enabled: boolean
}>

/**
 * Canonical entitlement keys used by billing metering (`billing_usage.feature`)
 * and plan gating. PR #46 unified the previously duplicated plan-limit tables
 * (`packages/billing/src/plans.ts` and this file) into this single source of
 * truth; `@profitpilot/billing` derives its per-plan limit records from here.
 *
 * PR (entitlement-meters + fair-use): Jarvis / campaign-agent keys remain
 * listed so legacy callers compile, but the Billing UI hides them because
 * those features are not productized. SMS, active-campaigns, and exports
 * are kept as entries with the same rules so old snapshots don't drift.
 */
export const ENTITLEMENT_KEYS = [
  'orders_sync_month',
  'products_sync',
  'customers_sync',
  'ai_recommendations_month',
  'active_agents',
  'jarvis_messages_month',
  'automation_workflows',
  'active_campaigns',
  'email_sends_month',
  'sms_sends_month',
  'team_members',
  'reports',
  'exports',
  'forecasting',
  'attribution',
  // PR #101 — AI Command daily command quota. `null` means unlimited
  // (Commander); 0 is unused here because every tier can run commands.
  'ai_command_daily',
  // PR #49 — AI Executive. Usage-metered features (counts per month) and
  // capacity features (active rows), mirroring the PR #49 feature matrix.
  'ai_executive_reports_month',
  'ai_executive_scenarios_month',
  'ai_executive_health_month',
  'ai_executive_risk_scans_month',
  'ai_executive_pdf_month',
  'ai_executive_exports_month',
  'ai_executive_opportunities',
  'ai_executive_decisions',
  'ai_executive_roadmaps_active',
  'ai_executive_benchmark_metrics',
] as const
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number]

/**
 * Soft operational ceilings enforced behind Commander's "Unlimited" marketing
 * copy. We never hard-fail a normal big store — these only flag the meter with
 * "High volume — fair use applies" and (in the future) throttle abuse. The
 * constants live in the canonical types package so backend and UI stay in
 * lock-step. Documented in the Billing FAQ (see `App.tsx` BILLING_FAQ).
 *
 *   FAIR_USE_ORDERS_30D      — 100k orders / rolling 30 days per store
 *   FAIR_USE_PRODUCTS_ACTIVE —  50k active products per store
 *   FAIR_USE_CUSTOMERS       — 100k customers per store
 *
 * Per-store is the chosen granularity; multi-store is unlimited but each
 * store stands on its own fair-use budget.
 */
export const FAIR_USE_ORDERS_30D = 100_000
export const FAIR_USE_PRODUCTS_ACTIVE = 50_000
export const FAIR_USE_CUSTOMERS = 100_000

/** Meter keys we never display (dead / unproductized features). The UI hides
 *  them rather than rendering a fake `0 / 0`; backend still computes them so
 *  a future revival won't have to re-introduce the keys. */
export const HIDDEN_METER_KEYS: ReadonlySet<EntitlementKey | string> = new Set([
  'sms_sends_month',       // SMS not productized
  'active_campaigns',      // Campaign Agent removed (PR #46)
  'jarvis_messages_month',  // Jarvis removed from product surface
  'ai_executive_pdf_month',// never used
  'ai_executive_benchmark_metrics', // internal-only metric
])

/** `null` means unlimited; `0` means the feature is not included in the plan.
 *
 *  PR (entitlement-meters) — sync caps revised:
 *    trial : orders/products/customers 100 → 250  (real headroom for free testers)
 *    start : 500/1k/2k → 1k/1.5k/2.5k
 *    growth: 5k/10k/20k → 5k/5k/10k
 *    commander: unlimited (`null`) — fair-use policy in code + FAQ.
 */
export const PLAN_ENTITLEMENT_LIMITS: Readonly<Record<PlanTier, Readonly<Record<EntitlementKey, number | null>>>> = {
  trial: { orders_sync_month: 250, products_sync: 250, customers_sync: 250, ai_recommendations_month: 10, active_agents: 2, jarvis_messages_month: 0, automation_workflows: 2, active_campaigns: 0, email_sends_month: 100, sms_sends_month: 0, team_members: 1, reports: 1, exports: 0, forecasting: 0, attribution: 0, ai_command_daily: 10, ai_executive_reports_month: 0, ai_executive_scenarios_month: 0, ai_executive_health_month: 0, ai_executive_risk_scans_month: 0, ai_executive_pdf_month: 0, ai_executive_exports_month: 0, ai_executive_opportunities: 1, ai_executive_decisions: 0, ai_executive_roadmaps_active: 0, ai_executive_benchmark_metrics: 0 },
  start: { orders_sync_month: 1_000, products_sync: 1_500, customers_sync: 2_500, ai_recommendations_month: 150, active_agents: 3, jarvis_messages_month: 0, automation_workflows: 5, active_campaigns: 0, email_sends_month: 1_000, sms_sends_month: 0, team_members: 1, reports: 1, exports: 1, forecasting: 1, attribution: 1, ai_command_daily: 100, ai_executive_reports_month: 1, ai_executive_scenarios_month: 1, ai_executive_health_month: 1, ai_executive_risk_scans_month: 1, ai_executive_pdf_month: 0, ai_executive_exports_month: 0, ai_executive_opportunities: 3, ai_executive_decisions: 5, ai_executive_roadmaps_active: 1, ai_executive_benchmark_metrics: 0 },
  growth: { orders_sync_month: 5_000, products_sync: 5_000, customers_sync: 10_000, ai_recommendations_month: 300, active_agents: 4, jarvis_messages_month: 0, automation_workflows: 20, active_campaigns: 0, email_sends_month: 15_000, sms_sends_month: 0, team_members: 3, reports: 2, exports: 2, forecasting: 2, attribution: 2, ai_command_daily: 300, ai_executive_reports_month: 5, ai_executive_scenarios_month: 5, ai_executive_health_month: 4, ai_executive_risk_scans_month: 4, ai_executive_pdf_month: 0, ai_executive_exports_month: 5, ai_executive_opportunities: 10, ai_executive_decisions: null, ai_executive_roadmaps_active: 3, ai_executive_benchmark_metrics: 0 },
  commander: { orders_sync_month: null, products_sync: null, customers_sync: null, ai_recommendations_month: null, active_agents: 6, jarvis_messages_month: 0, automation_workflows: null, active_campaigns: 0, email_sends_month: null, sms_sends_month: 0, team_members: null, reports: null, exports: null, forecasting: null, attribution: null, ai_command_daily: null, ai_executive_reports_month: null, ai_executive_scenarios_month: null, ai_executive_health_month: null, ai_executive_risk_scans_month: null, ai_executive_pdf_month: null, ai_executive_exports_month: null, ai_executive_opportunities: null, ai_executive_decisions: null, ai_executive_roadmaps_active: null, ai_executive_benchmark_metrics: 0 },
}

export function entitlementLimit(plan: PlanTier, key: EntitlementKey): number | null {
  return PLAN_ENTITLEMENT_LIMITS[plan][key]
}

/**
 * Legacy camelCase aliases retained for existing call sites. These are derived
 * from `PLAN_ENTITLEMENT_LIMITS` so the two tables can never drift again.
 */
const LEGACY_ALIASES: Readonly<Record<string, EntitlementKey>> = {
  aiRecommendations: 'ai_recommendations_month',
  activeAgents: 'active_agents',
  jarvisMessages: 'jarvis_messages_month',
}

export const PLAN_LIMITS: Readonly<Record<PlanTier, Readonly<Record<string, number | null>>>> = Object.fromEntries(
  PLAN_TIERS.map((tier) => [tier, Object.fromEntries(Object.entries(LEGACY_ALIASES).map(([alias, key]) => [alias, PLAN_ENTITLEMENT_LIMITS[tier][key]]))]),
) as Readonly<Record<PlanTier, Readonly<Record<string, number | null>>>>

export function limitFor(plan: PlanTier, entitlement: string): number | null {
  const alias = LEGACY_ALIASES[entitlement]
  if (alias) return PLAN_ENTITLEMENT_LIMITS[plan][alias]
  if ((ENTITLEMENT_KEYS as readonly string[]).includes(entitlement)) return PLAN_ENTITLEMENT_LIMITS[plan][entitlement as EntitlementKey]
  return 0
}
