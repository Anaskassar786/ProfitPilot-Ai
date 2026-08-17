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
] as const
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number]

/** `null` means unlimited; `0` means the feature is not included in the plan. */
export const PLAN_ENTITLEMENT_LIMITS: Readonly<Record<PlanTier, Readonly<Record<EntitlementKey, number | null>>>> = {
  trial: { orders_sync_month: 100, products_sync: 100, customers_sync: 100, ai_recommendations_month: 10, active_agents: 2, jarvis_messages_month: 60, automation_workflows: 1, active_campaigns: 1, email_sends_month: 100, sms_sends_month: 0, team_members: 1, reports: 1, exports: 0, forecasting: 0, attribution: 0 },
  start: { orders_sync_month: 500, products_sync: 1_000, customers_sync: 2_000, ai_recommendations_month: 30, active_agents: 3, jarvis_messages_month: 200, automation_workflows: 3, active_campaigns: 3, email_sends_month: 1_000, sms_sends_month: 0, team_members: 1, reports: 1, exports: 1, forecasting: 1, attribution: 1 },
  growth: { orders_sync_month: 5_000, products_sync: 10_000, customers_sync: 20_000, ai_recommendations_month: 150, active_agents: 6, jarvis_messages_month: 700, automation_workflows: 15, active_campaigns: 15, email_sends_month: 15_000, sms_sends_month: 2_000, team_members: 3, reports: 2, exports: 2, forecasting: 2, attribution: 2 },
  commander: { orders_sync_month: null, products_sync: null, customers_sync: null, ai_recommendations_month: null, active_agents: 7, jarvis_messages_month: null, automation_workflows: null, active_campaigns: null, email_sends_month: null, sms_sends_month: null, team_members: null, reports: null, exports: null, forecasting: null, attribution: null },
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
