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
    expect(description).toContain('confirm out loud')
    const trial = describeActionsForPrompt('trial')
    expect(trial).toContain('show_revenue')
    // Navigation is browser-side and risk-free, so every plan can be taken to a page.
    expect(trial).toContain('navigate_page')
    expect(trial).not.toContain('- approve_recommendation')
    // Lower plans are told what is locked so Jarvis advises instead of pretending.
    expect(trial).toContain('Locked on this plan')
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

  it('asks a spoken follow-up question instead of failing when a detail is missing', async () => {
    const tool = vi.fn(approveTool)
    const log = audit()
    const registry = new JarvisActionRegistry({ approve_recommendation: tool }, log)
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: true, tools: {} }, { actionId: 'approve_recommendation', parameters: {} })
    expect(result.executed).toBe(false)
    expect(result.needsDetails).toBe(true)
    expect(result.missingParameter).toBe('recommendationId')
    expect(result.message).toBe('Which recommendation should I approve?')
    expect(tool).not.toHaveBeenCalled()
    expect(log.entries[0]?.outcome).toBe('DETAILS_REQUIRED')
  })

  it('asks which automation to build before creating anything', async () => {
    const registry = new JarvisActionRegistry({})
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: true, tools: {} }, { actionId: 'create_automation', parameters: {} })
    expect(result.needsDetails).toBe(true)
    expect(result.message).toContain('Which automation')
  })

  it('asks which period a report should cover before generating it', async () => {
    const registry = new JarvisActionRegistry({})
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'commander', confirmed: true, tools: {} }, { actionId: 'generate_report', parameters: {} })
    expect(result.needsDetails).toBe(true)
    expect(result.message).toContain('daily, weekly, monthly, or quarterly')
  })

  it('lets every plan be taken to a page because navigation runs in the browser', async () => {
    const registry = new JarvisActionRegistry({})
    const result = await registry.invoke({ storeId: 'store-1' as never, plan: 'trial', confirmed: false, tools: {} }, { actionId: 'navigate_page', parameters: { page: 'products' } })
    expect(result.executed).toBe(true)
    expect(result.clientExecuted).toBe(true)
  })

  it('reads low stock on any plan but refuses to create automations below Commander', async () => {
    const registry = new JarvisActionRegistry({ low_stock_report: async () => ({ message: '3 products are low.' }) })
    const read = await registry.invoke({ storeId: 'store-1' as never, plan: 'start', confirmed: false, tools: {} }, { actionId: 'low_stock_report', parameters: {} })
    expect(read.executed).toBe(true)
    expect(read.message).toContain('3 products are low.')
    const write = await registry.invoke({ storeId: 'store-1' as never, plan: 'growth', confirmed: true, tools: {} }, { actionId: 'create_automation', parameters: { template: 'abandoned-checkout' } })
    expect(write.executed).toBe(false)
    expect(write.requiredPlan).toBe('commander')
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
