import type { Entitlement, PlanTier } from '@profitpilot/types'

export type BillingInterval = 'MONTHLY' | 'ANNUAL'
export type PlanCode = 'START' | 'GROWTH' | 'COMMANDER'
export type EntitlementKey = 'orders_sync_month' | 'products_sync' | 'customers_sync' | 'ai_recommendations_month' | 'active_agents' | 'jarvis_messages_month' | 'automation_workflows' | 'active_campaigns' | 'email_sends_month' | 'sms_sends_month' | 'team_members' | 'reports' | 'exports' | 'forecasting' | 'attribution'

export type PlanDefinition = Readonly<{ code: PlanCode; tier: Exclude<PlanTier, 'trial'>; monthlyPrice: number; annualPrice: number; annualMonthsFree: number; recommended?: boolean; headline: string; storeLimit: number | null; features: readonly string[]; limits: Readonly<Record<EntitlementKey, number | null>> }>

const UNLIMITED: Readonly<Record<EntitlementKey, number | null>> = { orders_sync_month: null, products_sync: null, customers_sync: null, ai_recommendations_month: null, active_agents: 7, jarvis_messages_month: null, automation_workflows: null, active_campaigns: null, email_sends_month: null, sms_sends_month: null, team_members: null, reports: null, exports: null, forecasting: null, attribution: null }

export const PLAN_DEFINITIONS: Readonly<Record<PlanCode, PlanDefinition>> = {
  START: { code: 'START', tier: 'start', monthlyPrice: 49, annualPrice: 490, annualMonthsFree: 2, headline: 'Basic analytics for one store', storeLimit: 1, features: ['Basic analytics for 1 store', 'Email support', '200 Jarvis messages / month', '3 automation workflows', 'Closed-period reports'], limits: { orders_sync_month: 500, products_sync: 1_000, customers_sync: 2_000, ai_recommendations_month: 30, active_agents: 3, jarvis_messages_month: 200, automation_workflows: 3, active_campaigns: 3, email_sends_month: 1_000, sms_sends_month: 0, team_members: 1, reports: 1, exports: 1, forecasting: 1, attribution: 1 } },
  GROWTH: { code: 'GROWTH', tier: 'growth', monthlyPrice: 149, annualPrice: 1_490, annualMonthsFree: 2, recommended: true, headline: 'AI agents and advanced analytics', storeLimit: 3, features: ['Advanced analytics for up to 3 stores', 'AI agents and recommendations', '700 Jarvis messages / month', '15 automations and campaigns', 'Forecasting and attribution'], limits: { orders_sync_month: 5_000, products_sync: 10_000, customers_sync: 20_000, ai_recommendations_month: 150, active_agents: 6, jarvis_messages_month: 700, automation_workflows: 15, active_campaigns: 15, email_sends_month: 15_000, sms_sends_month: 2_000, team_members: 3, reports: 2, exports: 2, forecasting: 2, attribution: 2 } },
  COMMANDER: { code: 'COMMANDER', tier: 'commander', monthlyPrice: 349, annualPrice: 3_490, annualMonthsFree: 2, headline: 'Full AI employee, unlimited stores', storeLimit: null, features: ['Full AI employee and unlimited stores', 'Unlimited Jarvis, automations, and campaigns', 'Priority support', 'Advanced forecasting and attribution', 'Highest daily AI budget'], limits: UNLIMITED },
}

export function planFor(code: PlanCode): PlanDefinition { return PLAN_DEFINITIONS[code] }
export function priceFor(code: PlanCode, interval: BillingInterval): number { return PLAN_DEFINITIONS[code][interval === 'MONTHLY' ? 'monthlyPrice' : 'annualPrice'] }
export function entitlementsFor(code: PlanCode): readonly Entitlement[] { return Object.entries(PLAN_DEFINITIONS[code].limits).map(([key, limit]) => ({ key, limit, enabled: limit !== 0 })) }
