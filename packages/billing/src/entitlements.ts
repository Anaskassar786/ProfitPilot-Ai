import { AppError, PLAN_ENTITLEMENT_LIMITS } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'
import type { BillingState, Subscription } from './billing.js'
import type { AgentName, EntitlementKey } from './plans.js'
import { agentsForPlan, PLAN_DEFINITIONS, requiredPlanForAgent } from './plans.js'

export class UpgradeRequiredError extends AppError {
  public constructor(feature: EntitlementKey | `agent:${string}` | `ai_executive:${string}`, plan: PlanTier, requiredPlan?: PlanTier) {
    const isAgentGate = feature.startsWith('agent:')
    super(isAgentGate ? 'FORBIDDEN' : 'PAYMENT_REQUIRED', `Upgrade required for ${feature}`, isAgentGate ? 403 : 402, { feature, plan, reason: 'UPGRADE_REQUIRED', ...(requiredPlan ? { requiredPlan } : {}) })
    this.name = 'UpgradeRequiredError'
  }
}

export type GateContext = Readonly<{ feature: EntitlementKey; used: number; billingPage?: boolean; support?: boolean; legal?: boolean }>
export type GateDecision = Readonly<{ allowed: boolean; readOnly: boolean; limit: number | null; remaining: number | null; reason: string | null }>

export function limitForPlan(plan: PlanTier, feature: EntitlementKey): number | null {
  return PLAN_ENTITLEMENT_LIMITS[plan][feature]
}

export function accessGate(subscription: Subscription, context: GateContext): GateDecision {
  const readOnly = isReadOnlyState(subscription.state)
  if (context.billingPage || context.support || context.legal) return { allowed: true, readOnly, limit: null, remaining: null, reason: null }
  if (readOnly) return { allowed: false, readOnly: true, limit: null, remaining: 0, reason: 'ACCOUNT_READ_ONLY' }
  const limit = limitForPlan(subscription.plan, context.feature)
  if (limit === 0 || (limit !== null && context.used >= limit)) return { allowed: false, readOnly: false, limit, remaining: 0, reason: 'UPGRADE_REQUIRED' }
  return { allowed: true, readOnly: false, limit, remaining: limit === null ? null : limit - context.used, reason: null }
}

export function assertAccess(subscription: Subscription, context: GateContext): void {
  const decision = accessGate(subscription, context)
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

function isReadOnlyState(state: BillingState): boolean { return state === 'SUSPENDED' || state === 'PAST_DUE' || state === 'CANCELLED' }
