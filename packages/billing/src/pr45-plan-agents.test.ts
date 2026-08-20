import { describe, expect, it } from 'vitest'
import { ALL_AGENTS, PLAN_DEFINITIONS, TRIAL_AGENTS, agentsForPlan, requiredPlanForAgent } from './plans.js'
import { UpgradeRequiredError, agentAccess, assertAgentAccess } from './entitlements.js'

describe('PR45 plan → agent matrix', () => {
  it('trial unlocks exactly Revenue and Inventory', () => {
    expect(agentsForPlan('trial')).toEqual(['REVENUE_AGENT', 'INVENTORY_AGENT'])
  })
  it('start adds the Customer Agent (3 total)', () => {
    expect(agentsForPlan('start')).toHaveLength(3)
    expect(agentsForPlan('start')).toContain('CUSTOMER_AGENT')
  })
  it('growth adds Pricing only (4 total) — Campaign Agent removed', () => {
    expect(agentsForPlan('growth')).toHaveLength(4)
    expect(agentsForPlan('growth')).toEqual(expect.arrayContaining(['PRICING_AGENT']))
    expect(agentsForPlan('growth')).not.toContain('PRODUCT_AGENT')
    expect((agentsForPlan('growth') as readonly string[])).not.toContain('CAMPAIGN_AGENT')
  })
  it('commander unlocks all six', () => {
    expect(agentsForPlan('commander')).toHaveLength(6)
    expect([...agentsForPlan('commander')].sort()).toEqual([...ALL_AGENTS].sort())
  })
  it('each tier is a strict superset of the previous one', () => {
    const start = agentsForPlan('start')
    const growth = agentsForPlan('growth')
    expect(TRIAL_AGENTS.every((agent) => start.includes(agent))).toBe(true)
    expect(start.every((agent) => growth.includes(agent))).toBe(true)
    expect(growth.every((agent) => agentsForPlan('commander').includes(agent))).toBe(true)
  })
  it('plan definitions expose the named agent lists', () => {
    expect(PLAN_DEFINITIONS.START.agents).toHaveLength(3)
    expect(PLAN_DEFINITIONS.GROWTH.agents).toHaveLength(4)
    expect(PLAN_DEFINITIONS.COMMANDER.agents).toHaveLength(6)
    expect(PLAN_DEFINITIONS.GROWTH.limits.active_agents).toBe(4)
    expect(PLAN_DEFINITIONS.COMMANDER.limits.active_agents).toBe(6)
  })
})

describe('PR45 agent gating', () => {
  it('reports the cheapest plan that unlocks each agent', () => {
    expect(requiredPlanForAgent('REVENUE_AGENT')).toBe('trial')
    expect(requiredPlanForAgent('CUSTOMER_AGENT')).toBe('start')
    expect(requiredPlanForAgent('PRICING_AGENT')).toBe('growth')
    expect(requiredPlanForAgent('PRODUCT_AGENT')).toBe('commander')
    expect(requiredPlanForAgent('EXECUTIVE_AGENT')).toBe('commander')
  })
  it('allows unlocked agents and blocks locked ones', () => {
    expect(agentAccess('trial', 'INVENTORY_AGENT').allowed).toBe(true)
    expect(agentAccess('trial', 'EXECUTIVE_AGENT')).toEqual({ allowed: false, requiredPlan: 'commander' })
    expect(agentAccess('growth', 'PRICING_AGENT').allowed).toBe(true)
    expect(agentAccess('growth', 'PRODUCT_AGENT').allowed).toBe(false)
  })
  it('throws UpgradeRequiredError with upgrade context for locked agents', () => {
    try {
      assertAgentAccess('trial', 'PRICING_AGENT')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeRequiredError)
      const appError = error as UpgradeRequiredError
      expect(appError.status).toBe(403)
      expect(appError.details).toMatchObject({ reason: 'UPGRADE_REQUIRED', requiredPlan: 'growth' })
    }
  })
  it('does not throw for unlocked agents', () => {
    expect(() => assertAgentAccess('commander', 'EXECUTIVE_AGENT')).not.toThrow()
  })
})
