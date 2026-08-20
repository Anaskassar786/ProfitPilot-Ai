import { PLAN_ENTITLEMENT_LIMITS } from '@profitpilot/types'
import type { Entitlement, EntitlementKey as CanonicalEntitlementKey, PlanTier } from '@profitpilot/types'

export type BillingInterval = 'MONTHLY' | 'ANNUAL'
export type PlanCode = 'START' | 'GROWTH' | 'COMMANDER'
/** Re-exported from `@profitpilot/types` — the single source of truth (PR #46). */
export type EntitlementKey = CanonicalEntitlementKey

export type PlanDefinition = Readonly<{ code: PlanCode; tier: Exclude<PlanTier, 'trial'>; monthlyPrice: number; annualPrice: number; annualMonthsFree: number; recommended?: boolean; headline: string; storeLimit: number | null; features: readonly string[]; limits: Readonly<Record<EntitlementKey, number | null>>; agents: readonly AgentName[] }>

/**
 * Named AI agents. Plans unlock a specific named list (not just a count) so
 * the Command Center can render exactly which agents each tier includes.
 * Kept as string literals: billing must not depend on the AI package.
 *
 * Campaign Agent has been removed. Cart abandonment / welcome rules now live
 * under Customer Agent. Final roster counts: Trial 2 · Start 3 · Growth 4 · Commander 6.
 */
export type AgentName = 'REVENUE_AGENT' | 'INVENTORY_AGENT' | 'CUSTOMER_AGENT' | 'PRICING_AGENT' | 'PRODUCT_AGENT' | 'EXECUTIVE_AGENT'
export const ALL_AGENTS: readonly AgentName[] = ['REVENUE_AGENT', 'INVENTORY_AGENT', 'CUSTOMER_AGENT', 'PRICING_AGENT', 'PRODUCT_AGENT', 'EXECUTIVE_AGENT']

export const TRIAL_AGENTS: readonly AgentName[] = ['REVENUE_AGENT', 'INVENTORY_AGENT']
const START_AGENTS: readonly AgentName[] = [...TRIAL_AGENTS, 'CUSTOMER_AGENT']
const GROWTH_AGENTS: readonly AgentName[] = [...START_AGENTS, 'PRICING_AGENT']
const COMMANDER_AGENTS: readonly AgentName[] = [...GROWTH_AGENTS, 'PRODUCT_AGENT', 'EXECUTIVE_AGENT']

/**
 * Per-plan entitlement limits come from `PLAN_ENTITLEMENT_LIMITS` in
 * `@profitpilot/types` so billing and plan-display logic can never drift.
 */
export const PLAN_DEFINITIONS: Readonly<Record<PlanCode, PlanDefinition>> = {
  START: {
    code: 'START',
    tier: 'start',
    monthlyPrice: 79,
    annualPrice: 790,
    annualMonthsFree: 2,
    headline: 'AI clarity for your Shopify store',
    storeLimit: 1,
    agents: START_AGENTS,
    features: [
      '1 Shopify store connected',
      '3 AI agents: Revenue, Inventory, Customer',
      '100 AI Commands / day',
      'Customer insights, churn and win-back signals',
      'Cart recovery and welcome flows via Customer Agent',
      '5 automation workflows',
      '30 AI recommendations / month',
      'Closed-period reports and basic exports',
      'Email support',
    ],
    limits: PLAN_ENTITLEMENT_LIMITS.start,
  },
  GROWTH: {
    code: 'GROWTH',
    tier: 'growth',
    monthlyPrice: 199,
    annualPrice: 1_990,
    annualMonthsFree: 2,
    recommended: true,
    headline: 'Scale decisions across products, pricing & automations',
    storeLimit: 3,
    agents: GROWTH_AGENTS,
    features: [
      'Up to 3 Shopify stores',
      '4 AI agents — includes Pricing Agent',
      '300 AI Commands / day',
      '20 automation workflows',
      'Advanced analytics plus forecasting and ROI attribution',
      '150 AI recommendations / month',
      'Margin-safe pricing opportunities (Pricing Agent)',
      'Priority support with a 12-hour target',
    ],
    limits: PLAN_ENTITLEMENT_LIMITS.growth,
  },
  COMMANDER: {
    code: 'COMMANDER',
    tier: 'commander',
    monthlyPrice: 399,
    annualPrice: 3_990,
    annualMonthsFree: 2,
    headline: 'Full AI employee — insights plus actions',
    storeLimit: null,
    agents: COMMANDER_AGENTS,
    features: [
      'Unlimited Shopify stores',
      'All 6 AI agents (Product + Executive unlocked)',
      'Unlimited AI Commands',
      'Auto-execution: AI can take store actions for you',
      'Unlimited automation workflows',
      'Product Agent cross-sell + Executive weekly digest',
      'Unlimited AI recommendations',
      'Advanced forecasting, attribution, and exports',
      'VIP priority support with a 4-hour target',
    ],
    limits: PLAN_ENTITLEMENT_LIMITS.commander,
  },
}

/** The exact agents a plan tier unlocks. Trial gets the two basics. */
export function agentsForPlan(tier: PlanTier): readonly AgentName[] {
  if (tier === 'trial') return TRIAL_AGENTS
  if (tier === 'start') return START_AGENTS
  if (tier === 'growth') return GROWTH_AGENTS
  return COMMANDER_AGENTS
}

/** The cheapest tier that unlocks a given agent — powers "Upgrade to X" CTAs. */
export function requiredPlanForAgent(agent: AgentName): PlanTier {
  if ((TRIAL_AGENTS as readonly string[]).includes(agent)) return 'trial'
  if ((START_AGENTS as readonly string[]).includes(agent)) return 'start'
  if ((GROWTH_AGENTS as readonly string[]).includes(agent)) return 'growth'
  return 'commander'
}

export function planFor(code: PlanCode): PlanDefinition { return PLAN_DEFINITIONS[code] }
export function priceFor(code: PlanCode, interval: BillingInterval): number { return PLAN_DEFINITIONS[code][interval === 'MONTHLY' ? 'monthlyPrice' : 'annualPrice'] }
export function entitlementsFor(code: PlanCode): readonly Entitlement[] { return Object.entries(PLAN_DEFINITIONS[code].limits).map(([key, limit]) => ({ key, limit, enabled: limit !== 0 })) }
