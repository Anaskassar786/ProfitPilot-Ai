import { PLAN_ENTITLEMENT_LIMITS } from '@profitpilot/types'
import type { Entitlement, EntitlementKey as CanonicalEntitlementKey, PlanTier } from '@profitpilot/types'

export type BillingInterval = 'MONTHLY' | 'ANNUAL'
export type PlanCode = 'START' | 'GROWTH' | 'COMMANDER'
/** Re-exported from `@profitpilot/types` — the single source of truth (PR #46). */
export type EntitlementKey = CanonicalEntitlementKey

export type PlanDefinition = Readonly<{ code: PlanCode; tier: Exclude<PlanTier, 'trial'>; monthlyPrice: number; annualPrice: number; annualMonthsFree: number; recommended?: boolean; headline: string; storeLimit: number | null; features: readonly string[]; limits: Readonly<Record<EntitlementKey, number | null>> }>

/**
 * Per-plan entitlement limits come from `PLAN_ENTITLEMENT_LIMITS` in
 * `@profitpilot/types` so billing and plan-display logic can never drift.
 */
export const PLAN_DEFINITIONS: Readonly<Record<PlanCode, PlanDefinition>> = {
  START: { code: 'START', tier: 'start', monthlyPrice: 49, annualPrice: 490, annualMonthsFree: 2, headline: 'Basic analytics for one store', storeLimit: 1, features: ['Basic analytics for 1 store', 'Email support', '200 Jarvis messages / month', '3 automation workflows', 'Closed-period reports'], limits: PLAN_ENTITLEMENT_LIMITS.start },
  GROWTH: { code: 'GROWTH', tier: 'growth', monthlyPrice: 149, annualPrice: 1_490, annualMonthsFree: 2, recommended: true, headline: 'AI agents and advanced analytics', storeLimit: 3, features: ['Advanced analytics for up to 3 stores', 'AI agents and recommendations', '700 Jarvis messages / month', '15 automations and campaigns', 'Forecasting and attribution'], limits: PLAN_ENTITLEMENT_LIMITS.growth },
  COMMANDER: { code: 'COMMANDER', tier: 'commander', monthlyPrice: 349, annualPrice: 3_490, annualMonthsFree: 2, headline: 'Full AI employee, unlimited stores', storeLimit: null, features: ['Full AI employee and unlimited stores', 'Unlimited Jarvis, automations, and campaigns', 'Priority support', 'Advanced forecasting and attribution', 'Highest daily AI budget'], limits: PLAN_ENTITLEMENT_LIMITS.commander },
}

export function planFor(code: PlanCode): PlanDefinition { return PLAN_DEFINITIONS[code] }
export function priceFor(code: PlanCode, interval: BillingInterval): number { return PLAN_DEFINITIONS[code][interval === 'MONTHLY' ? 'monthlyPrice' : 'annualPrice'] }
export function entitlementsFor(code: PlanCode): readonly Entitlement[] { return Object.entries(PLAN_DEFINITIONS[code].limits).map(([key, limit]) => ({ key, limit, enabled: limit !== 0 })) }
