import { describe, expect, it, vi } from 'vitest'
import { JarvisActionRegistry, actionsAvailableToPlan, describeActionsForPrompt, parseActionInvocation, planAtLeast, planDisplayName } from './jarvis-actions.js'
import type { JarvisActionAuditEntry, JarvisActionTool } from './jarvis-actions.js'

function audit(): { entries: JarvisActionAuditEntry[]; record: (entry: JarvisActionAuditEntry) => void } {
  const entries: JarvisActionAuditEntry[] = []
  return { entries, record: (entry) => { entries.push(entry) } }
}

const approveTool: JarvisActionTool = async () => ({ message: 'Recommendation approved.' })

describe('Jarvis plan-gated store actions', () => {
  it('orders plans so Commander > Growth > Start > Trial', () => {
    expect(planAtLeast('commander', 'commander')).toBe(true)
    expect(planAtLeast('growth', 'commander')).toBe(false)
    expect(planAtLeast('commander', 'growth')).toBe(true)
    expect(planAtLeast('trial', 'start')).toBe(false)
    expect(planDisplayName('commander')).toBe('Commander')
    expect(planDisplayName('start')).toBe('Start')
  })

  it('exposes read actions on every plan but write actions only to Commander', () => {
    const trial = actionsAvailableToPlan('trial').map((action) => action.id)
    expect(trial).toContain('show_revenue')
    expect(trial).toContain('show_orders')
    expect(trial).not.toContain('approve_recommendation')
    expect(trial).not.toContain('trigger_sync')

    const commander = actionsAvailableToPlan('commander').map((action) => action.id)
    expect(commander).toContain('approve_recommendation')
    expect(commander).toContain('reject_recommendation')
    expect(commander).toContain('trigger_sync')
  })

  it('describes available actions and the action protocol for the prompt', () => {
    const description = describeActionsForPrompt('commander')
    expect(description).toContain('approve_recommendation')
    expect(description).toContain('confirmation')
    const trial = describeActionsForPrompt('trial')
    expect(trial).toContain('show_revenue')
    expect(trial).not.toContain('approve_recommendation')
  })

  it('refuses write actions on lower plans and names the required plan', async () => {
    const log = audit()
    const registry = new JarvisActionRegistry({ approve_recommendation: approveTool }, log)
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'start', confirmed: false, tools: {} }, { actionId: 'approve_recommendation', parameters: { recommendationId: 'r1' } })
    expect(result.executed).toBe(false)
    expect(result.requiredPlan).toBe('commander')
    expect(result.message).toContain('Commander plan')
    expect(result.message).toContain('Start')
    expect(log.entries[0]?.outcome).toBe('REFUSED_PLAN')
  })

  it('asks for confirmation before executing a Commander write action', async () => {
    const tool = vi.fn(approveTool)
    const log = audit()
    const registry = new JarvisActionRegistry({ approve_recommendation: tool }, log)
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: false, tools: {} }, { actionId: 'approve_recommendation', parameters: { recommendationId: 'r1' } })
    expect(result.executed).toBe(false)
    expect(result.requiresConfirmation).toBe(true)
    expect(tool).not.toHaveBeenCalled()
    expect(log.entries[0]?.outcome).toBe('CONFIRMATION_REQUIRED')
  })

  it('executes the write action after explicit confirmation and logs it', async () => {
    const tool = vi.fn(approveTool)
    const log = audit()
    const registry = new JarvisActionRegistry({ approve_recommendation: tool }, log)
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: true, tools: {} }, { actionId: 'approve_recommendation', parameters: { recommendationId: 'r1' } })
    expect(result.executed).toBe(true)
    expect(result.message).toContain('approved')
    expect(tool).toHaveBeenCalledWith('store-1', { recommendationId: 'r1' })
    expect(log.entries[0]?.outcome).toBe('EXECUTED')
  })

  it('validates required parameters before executing', async () => {
    const tool = vi.fn(approveTool)
    const registry = new JarvisActionRegistry({ approve_recommendation: tool })
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: true, tools: {} }, { actionId: 'approve_recommendation', parameters: {} })
    expect(result.executed).toBe(false)
    expect(result.message).toContain('recommendationId')
    expect(tool).not.toHaveBeenCalled()
  })

  it('never pretends an action ran when its tool is not connected', async () => {
    const registry = new JarvisActionRegistry({})
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: true, tools: {} }, { actionId: 'trigger_sync', parameters: {} })
    expect(result.executed).toBe(false)
    expect(result.message).toContain('not connected')
  })

  it('reports tool failures honestly without throwing', async () => {
    const failing: JarvisActionTool = async () => { throw new Error('Shopify rejected the change') }
    const registry = new JarvisActionRegistry({ approve_recommendation: failing })
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: true, tools: {} }, { actionId: 'approve_recommendation', parameters: { recommendationId: 'r1' } })
    expect(result.executed).toBe(false)
    expect(result.message).toContain('Shopify rejected')
  })

  it('returns a clear failure for unknown action ids', async () => {
    const registry = new JarvisActionRegistry({})
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: true, tools: {} }, { actionId: 'launch_nukes', parameters: {} })
    expect(result.executed).toBe(false)
  })
})

describe('Jarvis action invocation parsing', () => {
  it('returns no invocation for plain conversational text', () => {
    const parsed = parseActionInvocation('Sir, your revenue is $4,580 with 2 orders.')
    expect(parsed.invocation).toBeNull()
    expect(parsed.cleanText).toContain('$4,580')
  })

  it('parses an action line and strips it from the visible answer', () => {
    const text = 'Sir, I can approve that recommendation.\n@jarvis:action {"actionId":"approve_recommendation","parameters":{"recommendationId":"r1"}}'
    const parsed = parseActionInvocation(text)
    expect(parsed.invocation?.actionId).toBe('approve_recommendation')
    expect(parsed.invocation?.parameters).toEqual({ recommendationId: 'r1' })
    expect(parsed.cleanText).not.toContain('@jarvis:action')
  })

  it('rejects a malformed action payload', () => {
    expect(() => parseActionInvocation('@jarvis:action {not json}')).toThrow()
  })
})
