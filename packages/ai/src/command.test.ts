import { describe, expect, it } from 'vitest'
import { AppError, storeId } from '@profitpilot/types'
import {
  AI_COMMAND_PLAN_LIMITS,
  AiCommandService,
  InMemoryAiCommandRepository,
  InMemoryCommandActions,
  InMemoryCommandTools,
  actionPreviewCopy,
  applyResponseStyle,
  applyUsageLimits,
  buildSystemPrompt,
  collectNumbers,
  contextualFollowUps,
  detectGrowthIntent,
  contextualQuickCommands,
  conversationGroups,
  conversationMemoryAvailable,
  defaultQuickCommands,
  detectBlockedAction,
  detectOffTopic,
  detectWriteTool,
  emptyUsage,
  formatGrowthAnswer,
  formatToolAnswer,
  groundCommandText,
  limitsForPlan,
  parseConfirmIntent,
  parseInfoTools,
  renderBlockedResponse,
  renderOffTopicResponse,
  renderUpgradeResponse,
  summarizeActionResult,
  thinkingStepsFor,
  titleFromQuery,
  toolToActionType,
  validateDiscountParams,
} from './command.js'
import type { AiCommandActionRecord, ToolOutcome } from './command.js'

const tenant = storeId('store-1')

const liveTools = new InMemoryCommandTools({
  get_analytics: { currency: 'USD', revenue: 8940, previousRevenue: 7240, orders: 42, aov: 213 },
  search_customers: { count: 2, items: [{ id: 'c1', displayName: 'Ada', email: 'ada@example.com', totalSpent: 400 }, { id: 'c2', displayName: 'Lin', email: 'lin@example.com', totalSpent: 220 }] },
  search_products: { count: 1, items: [{ id: 'p1', title: 'Mug', price: 18 }] },
  search_orders: { count: 1, items: [{ id: 'o1', orderNumber: '#1001', totalPrice: 42 }] },
  get_inventory_status: { lowStockCount: 3, outOfStockCount: 1, items: [{ title: 'Mug', quantity: 2, status: 'low' }] },
  get_recommendations: { count: 1, items: [{ id: 'r1', title: 'Restock mugs', status: 'PENDING', version: 0 }] },
  get_store_health: { score: 81, label: 'Healthy' },
})

function service(plan: 'trial' | 'start' | 'growth' | 'commander' = 'trial', extras: Partial<ConstructorParameters<typeof AiCommandService>[0]> = {}) {
  const repository = extras.repository ?? new InMemoryAiCommandRepository(plan)
  return new AiCommandService({
    repository,
    tools: extras.tools ?? liveTools,
    actions: extras.actions ?? new InMemoryCommandActions(async (action) => {
      if (action.actionType === 'SEND_EMAIL') {
        return { status: 'PARTIAL_SUCCESS', result: { sent: 1, failed: 1, reasons: ['lin@example.com bounced'] }, rollbackAvailable: false }
      }
      if (action.actionType === 'TAG_CUSTOMER') {
        return { status: 'SUCCESS', result: { updated: 2, failed: 0 }, rollbackAvailable: true }
      }
      if (action.actionType === 'CREATE_DISCOUNT') {
        return { status: 'SUCCESS', result: { code: 'PP-WEEKEND', title: action.actionParams.title }, rollbackAvailable: true }
      }
      return { status: 'SUCCESS', result: { message: 'Backend confirmed the action.' }, rollbackAvailable: false }
    }),
    planFor: extras.planFor ?? (async () => plan),
    now: extras.now ?? (() => Date.parse('2026-08-18T12:00:00.000Z')),
    ...(extras.enabled !== undefined ? { enabled: extras.enabled } : {}),
    ...(extras.actionsEnabled !== undefined ? { actionsEnabled: extras.actionsEnabled } : {}),
    ...(extras.generate ? { generate: extras.generate } : {}),
  })
}

describe('AI Command plan limits', () => {
  it('gates trial/start/growth to info only and commander to full actions', () => {
    expect(limitsForPlan('trial').commandsPerDay).toBe(10)
    expect(limitsForPlan('start').commandsPerDay).toBe(100)
    expect(limitsForPlan('growth').commandsPerDay).toBe(300)
    expect(limitsForPlan('commander').commandsPerDay).toBeNull()
    expect(AI_COMMAND_PLAN_LIMITS.trial.actionsEnabled).toBe(false)
    expect(AI_COMMAND_PLAN_LIMITS.growth.actionsEnabled).toBe(false)
    expect(AI_COMMAND_PLAN_LIMITS.commander.actionsEnabled).toBe(true)
    expect(limitsForPlan('commander').undoSeconds).toBe(30)
  })
  it('computes remaining commands without inventing extra quota', () => {
    const usage = applyUsageLimits({ ...emptyUsage(tenant, '2026-08-18', 'start'), commandsUsed: 45 }, 'start')
    expect(usage.remaining).toBe(55)
    expect(applyUsageLimits({ ...usage, commandsUsed: 100 }, 'start').remaining).toBe(0)
    expect(applyUsageLimits({ ...usage, commandsUsed: 9 }, 'commander').remaining).toBeNull()
  })
})

describe('AI Command conversation enhancements', () => {
  it('returns live quick insights and contextual follow-ups without placeholder figures', async () => {
    const command = service('growth')
    await expect(command.quickInsights(tenant)).resolves.toMatchObject({ revenueToday: 8940, lowStockCount: 3, healthScore: 81 })
    expect(contextualFollowUps('Who are my best customers?').map((item) => item.command)).toContain('Show repeat customers')
    expect(contextualFollowUps('Which products are low stock?').map((item) => item.command)).toContain('Show products to reorder')
  })

  it('expires cross-command references after the Growth memory window', async () => {
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    const chat = await service('growth', { now: () => now }).chat({ storeId: tenant, text: 'Show my top customers' })
    expect(conversationMemoryAvailable(true, 'growth', chat.conversation, now + 23 * 3_600_000)).toBe(true)
    expect(conversationMemoryAvailable(true, 'growth', chat.conversation, now + 25 * 3_600_000)).toBe(false)
    expect(conversationMemoryAvailable(true, 'commander', chat.conversation, now + 365 * 86_400_000)).toBe(true)
    expect(conversationMemoryAvailable(false, 'commander', chat.conversation, now)).toBe(false)
  })

  it('does not persist or consume quota for an already-cancelled command', async () => {
    const command = service('trial')
    const controller = new AbortController()
    controller.abort()
    await expect(command.chat({ storeId: tenant, text: 'Show revenue', signal: controller.signal })).rejects.toMatchObject({ status: 409 })
    await expect(command.usage(tenant)).resolves.toMatchObject({ commandsUsed: 0 })
  })
})

describe('AI Command safety parsers', () => {
  it('blocks destructive requests with a page-specific alternative', () => {
    const blocked = detectBlockedAction('Please refund order 1001')
    expect(blocked?.page).toBe('Orders')
    expect(renderBlockedResponse(blocked!)).toContain('not available through AI Command')
    expect(detectBlockedAction('delete all customers')).not.toBeNull()
    expect(detectBlockedAction('bulk change all prices')).not.toBeNull()
    expect(detectBlockedAction('show revenue')).toBeNull()
  })
  it('detects write intents and confirm phrases', () => {
    expect(detectWriteTool('Send email to VIP customers')).toBe('send_email')
    expect(detectWriteTool('Tag new customers as vip')).toBe('tag_customers')
    expect(detectWriteTool('Create a 15% weekend discount')).toBe('create_discount')
    expect(detectWriteTool('Run my cart recovery workflow')).toBe('trigger_workflow')
    expect(detectWriteTool('Pause the welcome email automation')).toBe('pause_workflow')
    expect(detectWriteTool('Resume the abandoned cart workflow')).toBe('resume_workflow')
    expect(detectWriteTool('Show my automations')).toBeNull()
    expect(parseConfirmIntent('confirm')).toBe('confirm')
    expect(parseConfirmIntent('undo')).toBe('undo')
    expect(parseConfirmIntent('cancel')).toBe('cancel')
    expect(parseConfirmIntent('what is revenue')).toBeNull()
  })
  it('detects off-topic questions but keeps store questions in scope', () => {
    expect(detectOffTopic("What's the weather today?")).toBe('the weather')
    expect(detectOffTopic('Write me a poem')).toBe('creative writing')
    expect(detectOffTopic('Help me with coding')).toBe('general coding')
    expect(detectOffTopic('Who is the president?')).toBe('politics')
    expect(detectOffTopic('Give me health advice')).toBe('health or medical advice')
    expect(detectOffTopic('Are you ChatGPT?')).toBe('questions about AI assistants')
    expect(detectOffTopic("What's my revenue this month?")).toBeNull()
    expect(detectOffTopic('Which products are low stock?')).toBeNull()
    expect(detectOffTopic('Show me inactive customers')).toBeNull()
    expect(detectOffTopic('Help me code a Shopify theme')).toBeNull()
    expect(detectOffTopic('Create a discount code')).toBeNull()
  })

  it('renders a polite off-topic refusal that redirects to store help', () => {
    const response = renderOffTopicResponse('the weather')
    expect(response).toContain('Shopify store')
    expect(response).toContain('the weather')
    expect(response).toContain('Store performance analysis')
    expect(response).not.toContain('Upgrade to Commander')
  })

  it('refuses off-topic questions at the service boundary', async () => {
    const result = await service().chat({ storeId: tenant, text: 'Tell me a joke' })
    expect(result.message.contentType).toBe('offtopic')
    expect(result.message.content).toContain('Shopify store')
    expect(result.message.structuredData).toBeNull()
  })

  it('validates discount safety caps honestly', () => {
    expect(validateDiscountParams({ value: 60, usage_limit: 10, expires_at: '2026-09-01T00:00:00.000Z' }).ok).toBe(false)
    expect(validateDiscountParams({ value: 15, usage_limit: 2000, expires_at: '2026-09-01T00:00:00.000Z' }).ok).toBe(false)
    expect(validateDiscountParams({ value: 15, usage_limit: 100, expires_at: '2020-01-01T00:00:00.000Z' }).ok).toBe(false)
    expect(validateDiscountParams({ value: 15, usage_limit: 100, expires_at: '2026-09-01T00:00:00.000Z' }).ok).toBe(true)
  })
})

describe('AI Command info answers', () => {
  it('routes growth requests to a multi-signal plan before the sales keyword can collapse them to analytics', () => {
    for (const query of ['Help me increase sales', 'Help me increasing sale', 'Show growth opportunities', 'How can I grow revenue?']) {
      expect(detectGrowthIntent(query)).toBe(true)
      expect(parseInfoTools(query).map((call) => call.name)).toEqual(['get_analytics', 'get_recommendations', 'get_store_health', 'get_inventory_status'])
    }
    expect(detectGrowthIntent('What is my revenue?')).toBe(false)
    expect(parseInfoTools('What is my revenue?').map((call) => call.name)).toEqual(['get_analytics'])
  })

  it('does not repeat the revenue reply when the next question asks for growth', async () => {
    const command = service('growth')
    const revenue = await command.chat({ storeId: tenant, text: "What's my revenue this month?" })
    const growth = await command.chat({ storeId: tenant, text: 'Help me increase sales', conversationId: revenue.conversation.id })
    expect(revenue.message.structuredData?.type).toBe('analytics')
    expect(growth.message.structuredData?.type).toBe('growth_plan')
    expect(growth.message.content).toContain('growth plan')
    expect(growth.message.content).toContain('Priorities:')
    expect(growth.message.content).not.toBe(revenue.message.content)
    const data = growth.message.structuredData?.data as { actionsEnabled: boolean; nextCommands: readonly { kind: string }[] }
    expect(data.actionsEnabled).toBe(false)
    expect(data.nextCommands.every((item) => item.kind === 'info')).toBe(true)
  })

  it('makes the same grounded growth plan action-ready only on Commander', async () => {
    const growth = await service('start').chat({ storeId: tenant, text: 'Help me increasing sale' })
    const commander = await service('commander').chat({ storeId: tenant, text: 'Help me increasing sale' })
    expect(growth.message.content).toContain('insight-only')
    expect(commander.message.content).toContain('Commander action mode is ready')
    const data = commander.message.structuredData?.data as { actionsEnabled: boolean; nextCommands: readonly { command: string; kind: string }[] }
    expect(data.actionsEnabled).toBe(true)
    expect(data.nextCommands.some((item) => item.kind === 'action')).toBe(true)
    const emailCommand = data.nextCommands.find((item) => /email/i.test(item.command))
    expect(emailCommand).toBeDefined()
    const preview = await service('commander').chat({ storeId: tenant, text: emailCommand!.command })
    expect(preview.message.contentType).toBe('action_preview')
    expect(preview.message.content).toContain('Nothing has been executed')
  })

  it('formats growth priorities only from supplied outcomes', () => {
    const outcomes: readonly ToolOutcome[] = [
      { ok: true, name: 'get_analytics', data: { currency: 'USD', revenue: 100, previousRevenue: 120, orders: 4, aov: 25 }, source: 'analytics', numbers: [100, 120, 4, 25] },
      { ok: true, name: 'get_inventory_status', data: { lowStockCount: 2, outOfStockCount: 1, items: [] }, source: 'inventory', numbers: [2, 1] },
    ]
    const answer = formatGrowthAnswer(outcomes, false)
    expect(answer.content).toContain('$100')
    expect(answer.content).toContain('2 low-stock')
    expect(answer.content).toContain('1 out-of-stock')
    expect(answer.content).not.toContain('$999')
  })

  it('answers revenue from tool results and never invents extra figures', async () => {
    const result = await service().chat({ storeId: tenant, text: "What's my revenue this month?" })
    expect(result.message.content).toContain('$8,940')
    expect(result.message.content).toContain('$7,240')
    expect(result.message.content).toContain('23%')
    expect(result.message.content).toContain('Source:')
    expect(result.message.structuredData?.type).toBe('analytics')
    expect(groundCommandText(result.message.content, collectNumbers({ revenue: 8940, previousRevenue: 7240, orders: 42, aov: 213, change: 23 }))).toContain('$8,940')
  })
  it('uses the synced store currency and never silently assumes USD', async () => {
    const euroTools = new InMemoryCommandTools({ get_analytics: { currency: 'EUR', revenue: 120, previousRevenue: 100, orders: 2, aov: 60 } })
    const euro = await service('trial', { tools: euroTools }).chat({ storeId: tenant, text: 'Show revenue' })
    expect(euro.message.content).toContain('€120')
    expect(euro.message.content).not.toContain('$120')

    const unknownTools = new InMemoryCommandTools({ get_analytics: { revenue: 120, previousRevenue: 100, orders: 2, aov: 60 } })
    const unknown = await service('trial', { tools: unknownTools }).chat({ storeId: tenant, text: 'Show revenue' })
    expect(unknown.message.content).toContain('currency unavailable')
    expect(unknown.message.content).not.toContain('$120')
  })

  it('says no data instead of fabricating an empty catalog', async () => {
    const empty = new InMemoryCommandTools({ search_products: { count: 0, items: [] } })
    const result = await service('trial', { tools: empty }).chat({ storeId: tenant, text: 'Show me products' })
    expect(result.message.content).toContain('No products matched')
    expect(result.message.content).not.toMatch(/successfully found 12/)
  })
  it('reports tool failures honestly', async () => {
    const broken = new InMemoryCommandTools({ get_store_health: { ok: false, error: 'analytics table is empty' } })
    const result = await service('trial', { tools: broken }).chat({ storeId: tenant, text: 'How healthy is my store?' })
    expect(result.message.content).toContain("I'm not sure")
    expect(result.message.content).toContain('analytics table is empty')
  })
  it('enforces the daily cap atomically across concurrent requests', async () => {
    const command = service('trial')
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => command.chat({ storeId: tenant, text: 'Show store health' })))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2)
    expect((await command.usage(tenant)).commandsUsed).toBe(10)
  })

  it('enforces the daily command cap with Upgrade Plan copy', async () => {
    const command = service('trial')
    for (let index = 0; index < 10; index += 1) await command.chat({ storeId: tenant, text: 'Show store health' })
    await expect(command.chat({ storeId: tenant, text: 'Show store health' })).rejects.toMatchObject({ status: 402, code: 'PAYMENT_REQUIRED' })
    try {
      await command.chat({ storeId: tenant, text: 'Show store health' })
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).message).toContain('Upgrade Plan')
      expect((error as AppError).message).not.toContain('Upgrade to Commander')
    }
  })
})

describe('AI Command action approval', () => {
  it('shows an upgrade preview for non-commander write requests and never executes', async () => {
    let executed = false
    const command = service('growth', { actions: new InMemoryCommandActions(async () => { executed = true; return { status: 'SUCCESS', result: { sent: 99 }, rollbackAvailable: false } }) })
    const result = await command.chat({ storeId: tenant, text: 'Send email to VIP customers' })
    expect(result.message.contentType).toBe('upgrade')
    expect(result.message.content).toContain('Upgrade Plan')
    expect(result.message.content).toContain('Commander plan includes')
    expect(executed).toBe(false)
  })
  it('requires approval before a commander action runs', async () => {
    let executed = 0
    const command = service('commander', { actions: new InMemoryCommandActions(async () => { executed += 1; return { status: 'SUCCESS', result: { updated: 2, failed: 0 }, rollbackAvailable: true } }) })
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    expect(preview.message.contentType).toBe('action_preview')
    expect(preview.message.content).toContain('Nothing has been executed')
    expect(executed).toBe(0)
    const confirmed = await command.chat({ storeId: tenant, text: 'confirm', conversationId: preview.conversation.id })
    expect(executed).toBe(1)
    expect(confirmed.message.contentType).toBe('action_result')
    expect(confirmed.message.content).toContain('Tagged 2 customers')
  })
  it('persists direct Approve results into the conversation and counts a successful action once', async () => {
    const command = service('commander')
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    const executed = await command.approveAction(tenant, preview.message.action!.id!)
    expect(executed.executionStatus).toBe('SUCCESS')
    const refreshed = await command.conversation(tenant, preview.conversation.id)
    expect(refreshed.messages.some((item) => item.contentType === 'action_result' && item.action?.status === 'SUCCESS')).toBe(true)
    const storedPreview = refreshed.messages.find((item) => item.contentType === 'action_preview')
    expect(storedPreview?.action?.status).toBe('SUCCESS')
    expect((await command.usage(tenant)).actionsExecuted).toBe(1)
  })

  it('atomically claims approval so concurrent clicks execute only once', async () => {
    let executions = 0
    const command = service('commander', { actions: new InMemoryCommandActions(async () => {
      executions += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { status: 'SUCCESS', result: { updated: 1, failed: 0 }, rollbackAvailable: true }
    }) })
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    const results = await Promise.allSettled([
      command.approveAction(tenant, preview.message.action!.id!),
      command.approveAction(tenant, preview.message.action!.id!),
    ])
    expect(executions).toBe(1)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('uses explicit conversation references only when memory is enabled', async () => {
    const command = service('commander')
    const customers = await command.chat({ storeId: tenant, text: 'Show my top customers' })
    const preview = await command.chat({ storeId: tenant, text: 'Send email to those customers', conversationId: customers.conversation.id })
    expect(preview.message.contentType).toBe('action_preview')
    expect(preview.message.action?.params.recipient_ids).toEqual(['c1', 'c2'])

    const withoutMemory = service('commander')
    const first = await withoutMemory.chat({ storeId: tenant, text: 'Show my top customers' })
    await withoutMemory.updatePreferences(tenant, { conversationMemoryEnabled: false })
    const blocked = await withoutMemory.chat({ storeId: tenant, text: 'Send email to those customers', conversationId: first.conversation.id })
    expect(blocked.message.contentType).toBe('error')
    expect(blocked.message.action).toBeNull()
  })

  it('does not offer approval for an action with no real target', async () => {
    const noCustomers = new InMemoryCommandTools({ search_customers: { count: 0, items: [] } })
    const result = await service('commander', { tools: noCustomers }).chat({ storeId: tenant, text: 'Send email to VIP customers' })
    expect(result.message.contentType).toBe('error')
    expect(result.message.content).toContain('No eligible email recipients')
    expect(result.message.action).toBeNull()
  })

  it('honors the global action kill switch even for Commander', async () => {
    const command = service('commander', { actionsEnabled: false })
    expect((await command.usage(tenant)).actionsEnabled).toBe(false)
    const result = await command.chat({ storeId: tenant, text: 'Send email to VIP customers' })
    expect(result.message.contentType).toBe('error')
    expect(result.message.content).toContain('temporarily unavailable')
    expect(result.message.action).toBeNull()
  })

  it('persists a confirmed side effect even if the streaming client disconnects during execution', async () => {
    const controller = new AbortController()
    const command = service('commander', { actions: new InMemoryCommandActions(async () => {
      controller.abort()
      return { status: 'SUCCESS', result: { updated: 1, failed: 0 }, rollbackAvailable: true }
    }) })
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    const confirmed = await command.chat({ storeId: tenant, text: 'confirm', conversationId: preview.conversation.id, signal: controller.signal })
    expect(confirmed.message.action?.status).toBe('SUCCESS')
    expect((await command.conversation(tenant, preview.conversation.id)).messages.some((item) => item.action?.status === 'SUCCESS')).toBe(true)
  })

  it('reports partial email failure instead of fake success', async () => {
    const command = service('commander')
    const preview = await command.chat({ storeId: tenant, text: 'Send email to VIP customers' })
    const result = await command.approveAction(tenant, preview.message.action!.id!)
    expect(result.executionStatus).toBe('PARTIAL_SUCCESS')
    expect(summarizeActionResult(result)).toContain('Sent 1 of 2 emails')
    expect(summarizeActionResult(result)).toContain('bounced')
    expect(summarizeActionResult(result)).not.toContain('Successfully sent to all')
  })
  it('does not invent a discount code when Shopify returns nothing', () => {
    const failed: AiCommandActionRecord = {
      id: 'a1', storeId: tenant, conversationId: null, actionType: 'CREATE_DISCOUNT', actionParams: {}, actionPreview: {},
      merchantApproved: true, approvedAt: 'now', executionStatus: 'FAILED', executionResult: { code: null },
      errorDetails: { message: 'Shopify rejected the discount' }, rollbackAvailable: false, rollbackDeadline: null,
      rolledBackAt: null, createdAt: 'now', completedAt: 'now',
    }
    expect(summarizeActionResult(failed)).toContain('failed')
    expect(summarizeActionResult({ ...failed, executionStatus: 'SUCCESS', executionResult: {} })).toContain('was not created')
  })
  it('allows undo inside 30 seconds and refuses after the deadline', async () => {
    let now = Date.parse('2026-08-18T12:00:00.000Z')
    const command = service('commander', { now: () => now })
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    const executed = await command.approveAction(tenant, preview.message.action!.id!)
    expect(executed.rollbackAvailable).toBe(true)
    now += 31_000
    await expect(command.rollbackAction(tenant, executed.id)).rejects.toMatchObject({ status: 400 })
  })
  it('consumes the undo window atomically so rollback runs only once', async () => {
    const command = service('commander')
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    const executed = await command.approveAction(tenant, preview.message.action!.id!)
    const attempts = await Promise.allSettled([
      command.rollbackAction(tenant, executed.id),
      command.rollbackAction(tenant, executed.id),
    ])
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('rolls back a reversible action inside the window', async () => {
    const command = service('commander')
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    await command.approveAction(tenant, preview.message.action!.id!)
    const undone = await command.chat({ storeId: tenant, text: 'undo', conversationId: preview.conversation.id })
    expect(undone.message.content).toContain('rolled back')
  })
})

describe('AI Command saved commands, prefs, and history', () => {
  it('caps saved commands on trial and increments use count', async () => {
    const command = service('trial')
    await command.saveCommand(tenant, { name: 'Health', commandText: 'Store health check' })
    await command.saveCommand(tenant, { name: 'Revenue', commandText: 'Show revenue' })
    await command.saveCommand(tenant, { name: 'Orders', commandText: 'Recent orders' })
    await expect(command.saveCommand(tenant, { name: 'Extra', commandText: 'More' })).rejects.toMatchObject({ status: 402 })
    const ran = await command.executeSaved(tenant, (await command.savedCommands(tenant))[0]!.id)
    expect(ran.message.content.length).toBeGreaterThan(0)
    expect((await command.savedCommands(tenant)).some((item) => item.useCount === 1)).toBe(true)
  })
  it('updates preferences, persists feedback, and hides archived conversations', async () => {
    const command = service('growth')
    const chat = await command.chat({ storeId: tenant, text: 'Show recent orders' })
    await expect(command.rateMessage(tenant, chat.conversation.id, chat.message.id, 'HELPFUL')).resolves.toEqual({ saved: true })
    const rated = await command.conversation(tenant, chat.conversation.id)
    expect((rated.context.messageFeedback as Record<string, { rating: string }>)[chat.message.id]?.rating).toBe('HELPFUL')
    const archived = await command.archiveConversation(tenant, chat.conversation.id)
    expect(archived.status).toBe('ARCHIVED')
    expect(await command.conversations(tenant)).toHaveLength(0)
    await expect(command.chat({ storeId: tenant, text: 'Continue', conversationId: chat.conversation.id })).rejects.toMatchObject({ status: 409 })
    const prefs = await command.updatePreferences(tenant, { defaultResponseStyle: 'DETAILED', thinkingAnimationEnabled: false })
    expect(prefs.defaultResponseStyle).toBe('DETAILED')
    expect(prefs.thinkingAnimationEnabled).toBe(false)
    const exported = await command.exportConversation(tenant, chat.conversation.id)
    expect(exported.rows.length).toBeGreaterThan(0)
    await expect(service('start').exportConversation(tenant, 'missing')).rejects.toMatchObject({ status: 402 })
  })

  it('rejects blank saved commands at the service boundary', async () => {
    const command = service('growth')
    await expect(command.saveCommand(tenant, { name: ' ', commandText: 'Show revenue' })).rejects.toMatchObject({ status: 400 })
    await expect(command.saveCommand(tenant, { name: 'Revenue', commandText: ' ' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('AI Command helpers', () => {
  it('never returns an unsupported figure while claiming it was removed', () => {
    const safe = groundCommandText('Revenue is $10.', [10])
    const blocked = groundCommandText('Revenue will become $999.', [10])
    expect(safe).toContain('$10')
    expect(blocked).not.toContain('$999')
    expect(blocked).toContain('not supported')
    expect(blocked).not.toContain('I removed unsupported figures')
  })

  it('builds grounded system prompt and thinking steps', () => {
    const prompt = buildSystemPrompt({ storeId: tenant, shop: 'demo.myshopify.com', plan: 'growth', actionsEnabled: false })
    expect(prompt).toContain('AI Command')
    expect(prompt).toContain('Upgrade Plan')
    expect(prompt).not.toContain('Upgrade to Commander')
    expect(thinkingStepsFor('revenue', parseInfoTools('revenue today'), 'info')[1]).toContain('Analytics')
    expect(titleFromQuery('   What is my revenue this month?   ')).toBe('What is my revenue this month?')
    expect(toolToActionType('send_email')).toBe('SEND_EMAIL')
    expect(actionPreviewCopy('SEND_EMAIL', { recipient_ids: ['a', 'b'], subject: 'Hi' })).toContain('2 recipient')
    expect(toolToActionType('pause_workflow')).toBe('PAUSE_WORKFLOW')
    expect(toolToActionType('resume_workflow')).toBe('RESUME_WORKFLOW')
    expect(parseInfoTools('Show my automations').map((call) => call.name)).toContain('list_workflows')
  })
  it('groups conversations and contextualizes quick commands', () => {
    const now = Date.parse('2026-08-18T18:00:00.000Z')
    const groups = conversationGroups([
      { id: '1', storeId: tenant, title: 'A', messages: [], context: {}, status: 'ACTIVE', createdAt: '', updatedAt: '', lastMessageAt: '2026-08-18T10:00:00.000Z' },
      { id: '2', storeId: tenant, title: 'B', messages: [], context: {}, status: 'ACTIVE', createdAt: '', updatedAt: '', lastMessageAt: '2026-08-17T10:00:00.000Z' },
    ], now)
    expect(groups.today).toHaveLength(1)
    expect(groups.yesterday).toHaveLength(1)
    expect(defaultQuickCommands('trial').every((item) => item.kind === 'info')).toBe(true)
    expect(defaultQuickCommands('commander').some((item) => item.kind === 'action')).toBe(true)
    expect(contextualQuickCommands('growth', { lowStock: 4 })[2]?.label).toContain('4 low-stock')
  })
  it('applies the saved response style without inventing data', () => {
    const outcomes: readonly ToolOutcome[] = [{ ok: true, name: 'get_analytics', data: { revenue: 10 }, source: 'analytics_revenue_daily', numbers: [10] }]
    expect(applyResponseStyle('Revenue is $10.', 'CONCISE', outcomes)).toBe('Revenue is $10.')
    expect(applyResponseStyle('Revenue is $10.', 'DETAILED', outcomes)).toContain('Data coverage: Analytics')
    expect(applyResponseStyle('Revenue is $10.', 'TECHNICAL', outcomes)).toContain('get_analytics → analytics_revenue_daily')
  })

  it('formats mixed tool outcomes without claiming full success', () => {
    const outcomes: readonly ToolOutcome[] = [
      { ok: true, name: 'get_analytics', data: { currency: 'USD', revenue: 10, previousRevenue: 5, orders: 2, aov: 5 }, source: 'analytics', numbers: [10, 5, 2] },
      { ok: false, name: 'search_orders', error: 'orders sync missing', source: 'orders' },
    ]
    const rendered = formatToolAnswer('how are sales', outcomes)
    expect(rendered.content).toContain('$10')
    expect(rendered.content).toContain('orders sync missing')
  })
  it('answers inactive-customer questions honestly instead of raw errors', () => {
    const allActive: readonly ToolOutcome[] = [{ ok: true, name: 'search_customers', data: { count: 0, total: 6, items: [], coverage: 'synced' }, source: 'sync_records.customers', numbers: [] }]
    expect(formatToolAnswer('Show me inactive customers', allActive).content).toContain('All your customers are active')

    const noData: readonly ToolOutcome[] = [{ ok: true, name: 'search_customers', data: { count: 0, total: 0, items: [], coverage: 'not synced' }, source: 'sync_records.customers', numbers: [] }]
    expect(formatToolAnswer('Show me inactive customers', noData).content).toContain('sync your Shopify customers')

    const notInactive: readonly ToolOutcome[] = [{ ok: true, name: 'search_customers', data: { count: 0, total: 6, items: [], coverage: 'synced' }, source: 'sync_records.customers', numbers: [] }]
    expect(formatToolAnswer('Show my top customers', notInactive).content).toContain('No customers matched')
  })
})
