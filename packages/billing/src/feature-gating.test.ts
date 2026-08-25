import { describe, expect, it } from 'vitest'
import { PLAN_ENTITLEMENT_LIMITS } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'
import { accessGate, assertAgentAccess, assertAccess, UpgradeRequiredError, agentAccess, limitForPlan } from './entitlements.js'
import { agentsForPlan, ALL_AGENTS } from './plans.js'
import type { Subscription } from './billing.js'

/**
 * Task 1 — Feature gating & entitlement lock/unlock enforcement.
 *
 * Enforces the plan matrix exactly:
 *   START     → Revenue, Inventory, Customer        (Pricing/Product/Executive locked)
 *   GROWTH    → + Pricing Agent                     (Product/Executive locked)
 *   COMMANDER → all 6 agents unlocked
 *
 * Plus the numeric limits (AI Commands/day, Automation Workflows,
 * AI Recs/month) and the 402 UpgradeRequiredError payloads.
 */
const NOW = 0
const active = (plan: PlanTier): Subscription => ({ storeId: 's', plan, state: plan === 'trial' ? 'TRIAL_LIMITED' : 'ACTIVE_MONTHLY', currentPeriodEnd: null, version: 0 })

describe('feature gating — agent roster per plan', () => {
  it('START unlocks Revenue/Inventory/Customer and locks Pricing/Product/Executive', () => {
    expect(agentsForPlan('start')).toEqual(['REVENUE_AGENT', 'INVENTORY_AGENT', 'CUSTOMER_AGENT'])
    expect(agentAccess('start', 'REVENUE_AGENT').allowed).toBe(true)
    expect(agentAccess('start', 'INVENTORY_AGENT').allowed).toBe(true)
    expect(agentAccess('start', 'CUSTOMER_AGENT').allowed).toBe(true)
    expect(agentAccess('start', 'PRICING_AGENT').allowed).toBe(false)
    expect(agentAccess('start', 'PRODUCT_AGENT').allowed).toBe(false)
    expect(agentAccess('start', 'EXECUTIVE_AGENT').allowed).toBe(false)
  })

  it('GROWTH adds Pricing Agent and still locks Product/Executive', () => {
    expect(agentsForPlan('growth')).toEqual(['REVENUE_AGENT', 'INVENTORY_AGENT', 'CUSTOMER_AGENT', 'PRICING_AGENT'])
    expect(agentAccess('growth', 'PRICING_AGENT').allowed).toBe(true)
    expect(agentAccess('growth', 'PRODUCT_AGENT').allowed).toBe(false)
    expect(agentAccess('growth', 'EXECUTIVE_AGENT').allowed).toBe(false)
  })

  it('COMMANDER unlocks all 6 agents', () => {
    expect(agentsForPlan('commander')).toEqual(ALL_AGENTS)
    for (const agent of ALL_AGENTS) expect(agentAccess('commander', agent).allowed).toBe(true)
  })

  it('locked agents throw 402 UPGRADE_REQUIRED with the cheapest required plan', () => {
    // Start user trying the Commander Executive Agent.
    try {
      assertAgentAccess('start', 'EXECUTIVE_AGENT')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeRequiredError)
      const err = error as UpgradeRequiredError
      expect(err.status).toBe(402)
      expect(err.details).toMatchObject({ reason: 'UPGRADE_REQUIRED', requiredPlan: 'commander', plan: 'start' })
    }
    // Growth user trying Product Agent.
    try {
      assertAgentAccess('growth', 'PRODUCT_AGENT')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as UpgradeRequiredError).status).toBe(402)
      expect((error as UpgradeRequiredError).details).toMatchObject({ requiredPlan: 'commander' })
    }
    // Start user trying Pricing Agent → cheapest unlock is growth.
    try {
      assertAgentAccess('start', 'PRICING_AGENT')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as UpgradeRequiredError).status).toBe(402)
      expect((error as UpgradeRequiredError).details).toMatchObject({ requiredPlan: 'growth' })
    }
  })

  it('unlocked agents never throw', () => {
    expect(() => assertAgentAccess('start', 'CUSTOMER_AGENT')).not.toThrow()
    expect(() => assertAgentAccess('growth', 'PRICING_AGENT')).not.toThrow()
    expect(() => assertAgentAccess('commander', 'EXECUTIVE_AGENT')).not.toThrow()
  })
})

describe('feature gating — numeric limits per plan', () => {
  it('AI Command daily quota (Start 100 / Growth 300 / Commander unlimited)', () => {
    expect(limitForPlan('start', 'ai_command_daily')).toBe(100)
    expect(limitForPlan('growth', 'ai_command_daily')).toBe(300)
    expect(limitForPlan('commander', 'ai_command_daily')).toBeNull()
  })

  it('Automation Workflows (Start 5 / Growth 20 / Commander unlimited)', () => {
    expect(limitForPlan('start', 'automation_workflows')).toBe(5)
    expect(limitForPlan('growth', 'automation_workflows')).toBe(20)
    expect(limitForPlan('commander', 'automation_workflows')).toBeNull()
  })

  it('AI Recommendations/month (Start 150 / Growth 300 / Commander unlimited)', () => {
    expect(limitForPlan('start', 'ai_recommendations_month')).toBe(150)
    expect(limitForPlan('growth', 'ai_recommendations_month')).toBe(300)
    expect(limitForPlan('commander', 'ai_recommendations_month')).toBeNull()
  })

  it('agent capacity meter (Start 3 / Growth 4 / Commander 6)', () => {
    expect(PLAN_ENTITLEMENT_LIMITS.start.active_agents).toBe(3)
    expect(PLAN_ENTITLEMENT_LIMITS.growth.active_agents).toBe(4)
    expect(PLAN_ENTITLEMENT_LIMITS.commander.active_agents).toBe(6)
  })

  it('exhausting a Start quota returns 402 UPGRADE_REQUIRED, not read-only', () => {
    const decision = accessGate(active('start'), { feature: 'ai_recommendations_month', used: 150 }, NOW)
    expect(decision.allowed).toBe(false)
    expect(decision.readOnly).toBe(false)
    expect(decision.reason).toBe('UPGRADE_REQUIRED')
    expect(() => assertAccess(active('start'), { feature: 'ai_recommendations_month', used: 150 }, NOW)).toThrow(UpgradeRequiredError)
  })

  it('Commander unlimited quotas never gate', () => {
    expect(accessGate(active('commander'), { feature: 'ai_command_daily', used: 100_000 }, NOW).allowed).toBe(true)
    expect(accessGate(active('commander'), { feature: 'automation_workflows', used: 1_000 }, NOW).allowed).toBe(true)
    expect(() => assertAccess(active('commander'), { feature: 'ai_recommendations_month', used: 99_999 }, NOW)).not.toThrow()
  })

  it('Growth can still run out (e.g. 300 commands) and is told to upgrade', () => {
    const decision = accessGate(active('growth'), { feature: 'ai_command_daily', used: 300 }, NOW)
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('UPGRADE_REQUIRED')
  })
})
