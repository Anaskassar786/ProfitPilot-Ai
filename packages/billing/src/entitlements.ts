import { AppError, PLAN_ENTITLEMENT_LIMITS } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'
import type { Subscription } from './billing.js'
import type { AgentName, EntitlementKey } from './plans.js'
import { agentsForPlan, PLAN_DEFINITIONS, requiredPlanForAgent } from './plans.js'

export class UpgradeRequiredError extends AppError {
  public constructor(feature: EntitlementKey | `agent:${string}` | `ai_executive:${string}`, plan: PlanTier, requiredPlan?: PlanTier) {
    // 402 PAYMENT_REQUIRED — the frontend maps this to the "Upgrade Plan" flow.
    // Every lock (agent or usage meter) surfaces as an upgrade prompt with the
    // cheapest plan tier that would unlock it (`requiredPlan`), so a Start or
    // Growth user attempting a Commander feature is told exactly what to buy.
    super('PAYMENT_REQUIRED', `Upgrade required for ${feature}`, 402, { feature, plan, reason: 'UPGRADE_REQUIRED', ...(requiredPlan ? { requiredPlan } : {}) })
    this.name = 'UpgradeRequiredError'
  }
}

export type GateContext = Readonly<{ feature: EntitlementKey; used: number; billingPage?: boolean; support?: boolean; legal?: boolean }>
export type GateDecision = Readonly<{ allowed: boolean; readOnly: boolean; limit: number | null; remaining: number | null; reason: string | null }>

export function limitForPlan(plan: PlanTier, feature: EntitlementKey): number | null {
  return PLAN_ENTITLEMENT_LIMITS[plan][feature]
}

export function accessGate(subscription: Subscription, context: GateContext, now: number = Date.now()): GateDecision {
  const readOnly = isReadOnlyState(subscription, now)
  if (context.billingPage || context.support || context.legal) return { allowed: true, readOnly, limit: null, remaining: null, reason: null }
  if (readOnly) return { allowed: false, readOnly: true, limit: null, remaining: 0, reason: 'ACCOUNT_READ_ONLY' }
  const limit = limitForPlan(subscription.plan, context.feature)
  if (limit === 0 || (limit !== null && context.used >= limit)) return { allowed: false, readOnly: false, limit, remaining: 0, reason: 'UPGRADE_REQUIRED' }
  return { allowed: true, readOnly: false, limit, remaining: limit === null ? null : limit - context.used, reason: null }
}

export function assertAccess(subscription: Subscription, context: GateContext, now: number = Date.now()): void {
  const decision = accessGate(subscription, context, now)
  if (!decision.allowed) throw new UpgradeRequiredError(context.feature, subscription.plan)
}

export type AgentGateDecision = Readonly<{ allowed: boolean; requiredPlan: PlanTier }>

/** Whether a plan tier unlocks a named agent, and the cheapest tier that would. */
export function agentAccess(plan: PlanTier, agent: AgentName): AgentGateDecision {
  return { allowed: agentsForPlan(plan).includes(agent), requiredPlan: requiredPlanForAgent(agent) }
}

/** Throws the standard upgrade error when a plan does not unlock the agent. */
export function assertAgentAccess(plan: PlanTier, agent: AgentName): void {
  const decision = agentAccess(plan, agent)
  if (!decision.allowed) throw new UpgradeRequiredError(`agent:${agent}`, plan, decision.requiredPlan)
}

/**
 * Read-only determination honors the cancellation grace period: a store whose
 * status is CANCELLED keeps FULL entitlements until `currentPeriodEnd` passes.
 * Once the paid period expires (or there is no period end), it drops to
 * ACCOUNT_READ_ONLY. See {@link effectiveBillingState} in billing.ts.
 */
function isReadOnlyState(subscription: Subscription, now: number): boolean {
  if (subscription.state !== 'CANCELLED') return subscription.state === 'SUSPENDED' || subscription.state === 'PAST_DUE'
  if (subscription.currentPeriodEnd !== null && now < subscription.currentPeriodEnd) return false
  return true
}
