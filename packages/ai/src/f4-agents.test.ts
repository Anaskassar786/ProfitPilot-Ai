import { describe, expect, it } from 'vitest'
import { AGENT_PROMPTS, agentStatuses, promptFor } from './agents.js'
import type { RuleSignal, StoreSnapshot } from './domain.js'

describe('versioned AI agents', () => {
  it('contains all seven versioned prompts', () => expect(Object.keys(AGENT_PROMPTS)).toHaveLength(7))
  it('marks language-only behavior in statuses', () => expect(agentStatuses(false)[0]?.languageOnly).toBe(true))
  it('marks configured agents ready', () => expect(agentStatuses(true)[0]?.execution).toBe('READY'))
  it('marks disabled agents paused', () => expect(agentStatuses(true, ['REVENUE_AGENT'])[1]?.execution).toBe('PAUSED'))
  it('builds a prompt from rule evidence and omits PII context', () => {
    const signal: RuleSignal = { ruleId: 'STOCKOUT_RISK', ruleVersion: '1.0.0', agent: 'INVENTORY_AGENT', title: 'Reorder', reason: 'Low cover', impactValue: 100, impactLabel: 'risk', currency: 'USD', confidence: .9, actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', entityKey: 'p1', evidence: [{ key: 'days', label: 'Days of cover', value: 4, source: 'inventory' }] }
    const snapshot = { currency: 'USD' } as StoreSnapshot
    const prompt = promptFor(signal, snapshot)
    expect(prompt.system).toContain(`Prompt version: ${AGENT_PROMPTS.INVENTORY_AGENT.version}`)
    expect(prompt.user).toContain('Days of cover')
    expect(prompt.user).not.toContain('email')
  })
})
