import { describe, expect, it } from 'vitest'
import { AppError, storeId } from '@profitpilot/types'
import {
  AI_COMMAND_PLAN_LIMITS,
  AiCommandService,
  InMemoryAiCommandRepository,
  InMemoryCommandActions,
  InMemoryCommandTools,
  actionPreviewCopy,
  aiCommandBillingMode,
  ambientToolsWhenUnmapped,
  applyResponseStyle,
  applyUsageLimits,
  buildSystemPrompt,
  classifyCommandScope,
  collectEntities,
  collectNumbers,
  contextualFollowUps,
  detectGrowthIntent,
  contextualQuickCommands,
  conversationGroups,
  conversationMemoryAvailable,
  defaultQuickCommands,
  detectBlockedAction,
  detectInstructionalIntent,
  detectOffTopic,
  detectWriteTool,
  emptyUsage,
  formatGrowthAnswer,
  formatCapabilityAnswer,
  formatInstructionalAnswer,
  formatToolAnswer,
  groundCommandText,
  humanizeSource,
  humanizeSources,
  limitsForPlan,
  normalizeAiCommandBillingState,
  parseConfirmIntent,
  parseInfoTools,
  renderBillingBlockedResponse,
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
    ...(extras.shopFor ? { shopFor: extras.shopFor } : {}),
    ...(extras.stateFor ? { stateFor: extras.stateFor } : {}),
    ...(extras.proseFormatter ? { proseFormatter: extras.proseFormatter } : {}),
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
    expect(detectWriteTool('Create an automation that alerts me when inventory is low')).toBe('create_workflow')
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
    expect(detectOffTopic('Create a discount code')).toBeNull()
  })

  it('allowlist-first: refuses every spec-blocked query even when it mentions Shopify or the store', () => {
    // The full BLOCKED list from the Commander product spec — none of these
    // may be answered just because they touch store vocabulary.
    expect(detectOffTopic("What's the weather in Delhi?")).toBe('the weather')
    expect(detectOffTopic('Who is the PM of America?')).toBe('politics')
    expect(detectOffTopic('Write me a JavaScript function')).toBe('general coding')
    expect(detectOffTopic('Tell me a joke')).toBe('creative writing')
    // Theme development and general Shopify development are out of scope even
    // though they mention Shopify itself.
    expect(detectOffTopic('How to build a Shopify theme?')).toBe('theme or general Shopify development')
    expect(detectOffTopic('Help me code a Shopify theme')).toBe('theme or general Shopify development')
    expect(detectOffTopic('How to build a Shopify store?')).toBe('theme or general Shopify development')
    expect(detectOffTopic('Give me stock market advice')).toBe('investing or the stock market')
    // Random questions with no allowed intent are refused without a label.
    expect(detectOffTopic('hmm what do you think about bananas')).toBe('that topic')
    expect(detectOffTopic('What is 2 + 2?')).toBe('homework or general problem-solving')
  })

  it('allowlist-first: keeps every spec-allowed query in scope with the right intent', () => {
    const intentOf = (query: string): string | null => {
      const scope = classifyCommandScope(query)
      return scope.inScope ? scope.intent : null
    }
    expect(classifyCommandScope("Show me today's sales")).toEqual({ inScope: true, intent: 'store_analytics' })
    expect(intentOf('Which products are selling best?')).toBe('store_data_query')
    expect(intentOf('How is my growth this month?')).toBe('store_analytics')
    expect(classifyCommandScope('Create an automation for abandoned carts')).toEqual({ inScope: true, intent: 'store_action' })
    expect(classifyCommandScope('What can you help me with?')).toEqual({ inScope: true, intent: 'capability_discovery' })
    expect(intentOf('What can you do?')).toBe('capability_discovery')
    expect(intentOf('Do I have low stock items?')).toBe('store_data_query')
    expect(intentOf('How healthy is my store?')).toBe('store_analytics')
    expect(intentOf('How do I set up an automated email?')).toBe('app_feature_help')
    expect(detectOffTopic('Please refund order 1001')).toBeNull() // store op → blocked-action flow, not off-topic
  })

  it('renders the spec refusal template with a redirect back to the store', () => {
    const response = renderOffTopicResponse('the weather')
    expect(response).toContain("I'm your store's Commander")
    expect(response).toContain('your store data and ProfitPilot features')
    expect(response).toContain('the weather')
    expect(response).toContain('latest sales, top products, or customer insights')
    expect(response).not.toContain('Upgrade to Commander')
  })

  it('refuses off-topic questions at the service boundary', async () => {
    const result = await service().chat({ storeId: tenant, text: 'Tell me a joke' })
    expect(result.message.contentType).toBe('offtopic')
    expect(result.message.content).toContain("I'm your store's Commander")
    expect(result.message.content).toContain('ProfitPilot features')
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
    for (const query of ['Help me increase sales', 'Help me increasing sale', 'Show growth opportunities', 'How can I grow revenue?', 'How can I increase profit?', 'mai profit kaise increase kro']) {
      expect(detectGrowthIntent(query)).toBe(true)
      expect(parseInfoTools(query).map((call) => call.name)).toEqual(['get_analytics', 'get_recommendations', 'get_store_health', 'get_inventory_status', 'search_customers', 'search_products'])
    }
    expect(detectGrowthIntent('What is my revenue?')).toBe(false)
    expect(detectGrowthIntent('How many orders today?')).toBe(false)
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
    expect(result.message.content).toContain('This action requires the Commander plan')
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
    expect(applyResponseStyle('Revenue is $10.', 'TECHNICAL', outcomes)).toContain('get_analytics → 📊 Live Analytics Sync')
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

describe('AI Command strategic advisor overhaul', () => {
  it('maps every raw data-feed identifier to a clean merchant-facing badge and never leaks table names', () => {
    expect(humanizeSource('analytics_revenue_daily')).toBe('📊 Live Analytics Sync')
    expect(humanizeSource('sync_records.customers')).toBe('👥 Verified Customer Data')
    expect(humanizeSource('sync_records.orders')).toBe('🧾 Verified Order Data')
    expect(humanizeSource('catalog_products + analytics_product_sales_daily')).toBe('📦 Inventory & Sales History')
    expect(humanizeSource('inventory_levels')).toBe('📦 Inventory & Sales History')
    expect(humanizeSource('variant_inventory_quantity')).toBe('📦 Inventory & Sales History')
    expect(humanizeSource('analytics + inventory')).toBe('✨ Verified Store Data')
    expect(humanizeSource('ai_recommendations')).toBe('💡 AI Growth Recommendations')
    expect(humanizeSource('automation_workflows')).toBe('⚙️ Automation Engine')
    // Unknown / empty never surfaces a raw identifier.
    expect(humanizeSource('')).toBe('✨ Verified Store Data')
    expect(humanizeSource('some_made_up_table')).toBe('✨ Verified Store Data')
    expect(humanizeSource('📊 Live Analytics Sync')).toBe('📊 Live Analytics Sync')
    expect(humanizeSources(['analytics_revenue_daily', 'sync_records.customers'])).toBe('📊 Live Analytics Sync · 👥 Verified Customer Data')
  })

  it('emits a clean Source badge and never a raw table name in a revenue answer', async () => {
    const result = await service().chat({ storeId: tenant, text: "What's my revenue this month?" })
    expect(result.message.content).not.toMatch(/analytics_revenue_daily|sync_records|\.[a-z]/)
    expect(result.message.content).toMatch(/Source: /)
    const source = result.message.structuredData?.source ?? ''
    expect(source).toMatch(/\p{Extended_Pictographic}/u)
    expect(source).not.toMatch(/[a-z0-9]_[a-z0-9]|\./)
  })

  it('builds a 3-recommendation growth plan with data-backed priorities and CTAs (INTENT A)', () => {
    const outcomes: readonly ToolOutcome[] = [
      { ok: true, name: 'get_analytics', data: { currency: 'USD', revenue: 8940, previousRevenue: 7240, orders: 42, aov: 213, days: 30 }, source: 'analytics_revenue_daily', numbers: [8940, 7240, 42, 213, 30] },
      { ok: true, name: 'get_store_health', data: { score: 81, label: 'Healthy' }, source: 'analytics + inventory', numbers: [81] },
      { ok: true, name: 'get_inventory_status', data: { lowStockCount: 3, outOfStockCount: 1, items: [] }, source: 'inventory_levels', numbers: [3, 1] },
      { ok: true, name: 'search_customers', data: { total: 4, items: [{ id: 'c1', totalSpent: 600, lifetimeOrders: 0, activity: 'inactive' }, { id: 'c2', totalSpent: 250, lifetimeOrders: 3 }] }, source: 'sync_records.customers', numbers: [4, 600, 0, 250, 3] },
      { ok: true, name: 'search_products', data: { items: [{ id: 'p1', unitsSold: 0 }, { id: 'p2', unitsSold: 12 }] }, source: 'catalog_products + analytics_product_sales_daily', numbers: [0, 12] },
      { ok: true, name: 'get_recommendations', data: { count: 1, items: [{ id: 'r1', title: 'Restock mugs' }] }, source: 'ai_recommendations', numbers: [1] },
    ]
    const answer = formatGrowthAnswer(outcomes, true)
    // No raw database labels leak.
    expect(answer.content).not.toMatch(/analytics_revenue_daily|sync_records|inventory_levels|catalog_products/)
    expect(answer.content).toContain('growth plan')
    expect(answer.content).toContain('Priorities:')
    // 3 numbered priorities.
    expect(answer.content.match(/^\d\. /gm)?.length).toBe(3)
    // Data-backed: real figures surface inside the priorities/read.
    expect(answer.content).toContain('$8,940')
    expect(answer.content).toContain('1 out-of-stock')
    expect(answer.content).toContain('3 low-stock')
    // Clean humanized source attribution.
    expect(answer.content).toMatch(/Source:.*Live Analytics Sync/)
    const data = answer.structuredData?.data as { recommendations: readonly unknown[]; nextCommands: readonly { kind: string; command: string }[]; signals: { inactiveCount: number; repeatRate: number; deadStockCount: number } }
    expect(data.recommendations).toHaveLength(3)
    expect(data.signals.inactiveCount).toBe(1)
    expect(data.signals.deadStockCount).toBe(1)
    expect(data.nextCommands.some((item) => item.kind === 'action' && /email/i.test(item.command))).toBe(true)
  })

  it('detects instructional how-to questions and keeps plain lookups as data (INTENT C)', () => {
    expect(detectInstructionalIntent('How do I set up an automated email?')).toBe('automation')
    expect(detectInstructionalIntent('How do I create an automation?')).toBe('automation')
    expect(detectInstructionalIntent('What can PatternAI do?')).toBe('patternai')
    expect(detectInstructionalIntent('What can you do?')).toBe('generic')
    expect(detectInstructionalIntent('tum meri help kaise karoge')).toBe('generic')
    expect(detectInstructionalIntent('kya kar sakte ho')).toBe('generic')
    expect(detectInstructionalIntent('what can you do for me')).toBe('generic')
    // "Show automation status" is a lookup, not guidance — must not be instructional.
    expect(detectInstructionalIntent('Show automation status')).toBeNull()
    // Growth questions are handled by the growth plan path in the service, not
    // the instructional path.
    expect(detectInstructionalIntent('How do I use the recommendations page?')).toBe('recommendations')
    // Data-lookup phrasing ("what is / how much / how many / what are" + a
    // store metric) is a lookup, not guidance — it must route to live
    // analytics, never to the generic help card.
    expect(detectInstructionalIntent('What is my revenue this month?')).toBeNull()
    expect(detectInstructionalIntent('What is my average order value?')).toBeNull()
    expect(detectInstructionalIntent('How many orders did I get today?')).toBeNull()
    expect(detectInstructionalIntent('What is my best selling product?')).toBeNull()
    expect(detectInstructionalIntent('What are my top products?')).toBeNull()
    expect(detectInstructionalIntent('What is my AOV?')).toBeNull()
    expect(detectInstructionalIntent('What are my recent orders?')).toBeNull()
  })

  it('routes Hinglish and natural-language capability prompts to the store-specific capability card without store metrics', async () => {
    for (const text of ['tum meri help kaise karoge', 'what can you do for me']) {
      const result = await service('growth').chat({ storeId: tenant, text })
      expect(result.message.contentType).toBe('structured_data')
      expect(result.message.structuredData?.type).toBe('capability_list')
      expect(result.message.content).toContain("I'm Commander")
      expect(result.message.content).toContain('Growth')
      expect(result.message.content).toContain('Commander plan only')
      expect(result.message.content).not.toMatch(/\$8,940|81\/100|revenue today/i)
      expect(result.message.thinkingSteps).not.toContain('Reading live store data...')
    }
  })

  it('feature discovery is store-specific and plan-aware', async () => {
    const shopFor = async () => 'demo.myshopify.com'
    const commander = await service('commander', { shopFor }).chat({ storeId: tenant, text: 'What can you help me with?' })
    expect(commander.message.structuredData?.type).toBe('capability_list')
    expect(commander.message.content).toContain('demo.myshopify.com')
    expect(commander.message.content).toContain('FULL STORE CONTROL')
    expect(commander.message.content).not.toContain('Commander plan only')
    const data = commander.message.structuredData?.data as { actionsEnabled: boolean; actionsLocked: boolean; prompts: readonly { command: string }[] }
    expect(data.actionsEnabled).toBe(true)
    expect(data.actionsLocked).toBe(false)
    expect(data.prompts.some((prompt) => /automation/i.test(prompt.command))).toBe(true)

    const start = await service('start', { shopFor }).chat({ storeId: tenant, text: 'What can you do?' })
    expect(start.message.content).toContain('Start')
    expect(start.message.content).toContain('Commander plan only')
    const startData = start.message.structuredData?.data as { actionsEnabled: boolean; actionsLocked: boolean; upgradePrompt: string | null }
    expect(startData.actionsEnabled).toBe(false)
    expect(startData.actionsLocked).toBe(true)
    expect(startData.upgradePrompt).toContain('Commander plan')
  })

  it('stages cancel-all automation as a bulk deactivation preview with no order-tool noise', async () => {
    const calls: string[] = []
    const seeded = new InMemoryCommandTools({
      list_workflows: {
        items: [
          { id: 'wf-active-1', name: 'Welcome', status: 'ACTIVE' },
          { id: 'wf-paused', name: 'Win Back', status: 'PAUSED' },
          { id: 'wf-active-2', name: 'Cart Recovery', enabled: true },
        ],
      },
    })
    const tools = {
      run: async (store: typeof tenant, call: Parameters<typeof seeded.run>[1]) => {
        calls.push(call.name)
        return seeded.run(store, call)
      },
    }
    const result = await service('commander', { tools }).chat({ storeId: tenant, text: 'cancel all automation' })
    expect(result.message.contentType).toBe('action_preview')
    expect(result.message.action?.type).toBe('PAUSE_WORKFLOW')
    expect(result.message.action?.params.workflow_ids).toEqual(['wf-active-1', 'wf-active-2'])
    expect(result.message.content).toContain('Action: Deactivate 2 active automations')
    expect(result.message.structuredData?.actions).toEqual(['approve', 'edit', 'cancel'])
    expect(calls).toEqual(['list_workflows'])
    expect(result.message.content).not.toMatch(/orders?|order table/i)
  })

  it('answers a "what is my revenue" question from live analytics, not the generic capability guide', async () => {
    const result = await service('growth').chat({ storeId: tenant, text: 'What is my revenue this month?' })
    expect(result.message.structuredData?.type).toBe('analytics')
    expect(result.message.content).toContain('$8,940')
    expect(result.message.content).not.toContain('What AI Command can do')
  })

  it('routes growth questions to the growth plan, not instructional guidance', async () => {
    const result = await service().chat({ storeId: tenant, text: 'How can I increase profit?' })
    expect(result.message.structuredData?.type).toBe('growth_plan')
    expect(result.message.structuredData?.type).not.toBe('instructional')
  })

  it('renders an instructional automation answer with steps and a navigation CTA', () => {
    const answer = formatInstructionalAnswer('automation', { plan: 'trial', actionsEnabled: false })
    expect(answer.structuredData.type).toBe('instructional')
    const data = answer.structuredData.data as { title: string; steps: readonly string[]; ctas: readonly { kind: string; target?: string; command?: string }[] }
    expect(data.title.toLowerCase()).toContain('automation')
    expect(data.steps.length).toBeGreaterThanOrEqual(3)
    expect(data.ctas.some((cta) => cta.kind === 'navigate' && cta.target === 'automation')).toBe(true)
    expect(answer.content).toContain('Upgrade Plan')
  })

  it('answers a "how do I set up an automated email" question with instructional guidance (INTENT C)', async () => {
    const result = await service().chat({ storeId: tenant, text: 'How do I set up an automated email?' })
    expect(result.message.contentType).toBe('structured_data')
    expect(result.message.structuredData?.type).toBe('instructional')
    expect(result.message.content.toLowerCase()).toContain('automation')
  })

  it('adds an executive key takeaway and next step to a summary/trend query (INTENT B)', async () => {
    const result = await service().chat({ storeId: tenant, text: 'Summarize this week\'s store performance' })
    expect(result.message.content).toContain('Key takeaway')
    expect(result.message.content).toContain('Next logical step')
    const data = result.message.structuredData?.data as { keyTakeaway: string | null; trend: string }
    expect(data.keyTakeaway).not.toBeNull()
    expect(['up', 'down', 'flat']).toContain(data.trend)
  })
})

/* ── QA 2026-08-22: failure detail forwarding, format constraints, Hindi ── */

function failedAction(overrides: Partial<AiCommandActionRecord> = {}): AiCommandActionRecord {
  return {
    id: 'a1',
    storeId: tenant,
    conversationId: null,
    actionType: 'CREATE_DISCOUNT',
    actionParams: {},
    actionPreview: null,
    merchantApproved: true,
    approvedAt: null,
    executionStatus: 'FAILED',
    executionResult: null,
    errorDetails: null,
    rollbackAvailable: false,
    rollbackDeadline: null,
    rolledBackAt: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('summarizeActionResult failure detail forwarding (SC-2)', () => {
  it('forwards the Shopify userError message from errorDetails instead of the generic fallback', () => {
    const summary = summarizeActionResult(failedAction({ errorDetails: { message: 'Discount code is already taken.', reason: 'GRAPHQL_USER_ERRORS' } }))
    expect(summary).toContain('Discount code is already taken.')
    expect(summary).not.toContain('The backend did not confirm success.')
  })

  it('falls back to executionResult.message when errorDetails is absent', () => {
    const summary = summarizeActionResult(failedAction({ executionResult: { message: 'Shopify rejected the discount: endsAt must be in the future.' } }))
    expect(summary).toContain('endsAt must be in the future')
    expect(summary).not.toContain('The backend did not confirm success.')
  })

  it('surfaces scope failures as the standard re-authorize permission message', () => {
    const summary = summarizeActionResult(failedAction({ errorDetails: { message: 'Shopify rejected the discount request.', reason: 'MISSING_WRITE_DISCOUNTS_SCOPE', missingScope: 'write_discounts' } }))
    expect(summary).toContain(SHOPIFY_PERMISSION_MESSAGE)
    expect(summary).toContain('write_discounts')
  })

  it('rewrites a raw Shopify 403 (with the customer id) into the permission message', () => {
    // The exact shape reported from the dev store before this fix.
    const summary = summarizeActionResult(failedAction({
      actionType: 'TAG_CUSTOMER',
      errorDetails: { reasons: ['9414254756053 — Shopify API request failed with 403'] },
      executionResult: { updated: 0, failed: 1, reasons: ['9414254756053 — Shopify API request failed with 403'] },
    }))
    expect(summary).toContain(SHOPIFY_PERMISSION_MESSAGE)
    expect(summary).not.toContain('9414254756053')
    expect(summary).not.toContain('Shopify API request failed with 403')
    expect(summary).not.toContain('The action failed.')
  })

  it('rewrites a GraphQL ACCESS_DENIED failure into the permission message', () => {
    const summary = summarizeActionResult(failedAction({ errorDetails: { message: 'Access denied for discountCodeBasicCreate field.', reason: 'ACCESS_DENIED' } }))
    expect(summary).toContain(SHOPIFY_PERMISSION_MESSAGE)
    expect(summary).not.toContain('discountCodeBasicCreate')
  })

  it('keeps partial tagging results honest while still leading with the permission message', () => {
    const summary = summarizeActionResult(failedAction({
      actionType: 'TAG_CUSTOMER',
      executionStatus: 'PARTIAL_SUCCESS',
      errorDetails: { message: 'blocked', reason: 'MISSING_WRITE_CUSTOMERS_SCOPE', missingScope: 'write_customers' },
      executionResult: { updated: 3, failed: 5 },
    }))
    expect(summary).toContain(SHOPIFY_PERMISSION_MESSAGE)
    expect(summary).toContain('write_customers')
    expect(summary).toContain('3 customer(s) were updated')
  })

  it('leaves non-permission failures untouched', () => {
    const summary = summarizeActionResult(failedAction({ errorDetails: { message: 'Discount code is already taken.', reason: 'GRAPHQL_USER_ERRORS' } }))
    expect(summary).toBe('The action failed. Discount code is already taken.')
  })

  it('shopifyPermissionFailure ignores successful and unrelated actions', () => {
    expect(shopifyPermissionFailure(failedAction({ errorDetails: { message: 'Discount code is already taken.', reason: 'GRAPHQL_USER_ERRORS' } }))).toBeNull()
    expect(shopifyPermissionFailure(failedAction({ errorDetails: { message: 'Shopify API request failed with 429', reason: 'SHOPIFY_REQUEST_FAILED' } }))).toBeNull()
    const blocked = shopifyPermissionFailure(failedAction({ errorDetails: { reason: 'MISSING_WRITE_CUSTOMERS_SCOPE', missingScope: 'write_customers', reauthorizeUrl: '/shopify/install?shop=demo.myshopify.com' } }))
    expect(blocked?.reauthorizeUrl).toBe('/shopify/install?shop=demo.myshopify.com')
  })

  it('uses the generic fallback only when nothing specific was recorded', () => {
    expect(summarizeActionResult(failedAction())).toContain('The backend did not confirm success.')
  })
})

import { SHOPIFY_PERMISSION_MESSAGE, actionFailureDetails, buildConstrainedFormatPrompt, hasStrictFormatConstraints, parseFormatConstraints, serializeToolOutcomes, shopifyPermissionFailure } from './command.js'

describe('parseFormatConstraints (Bug #6)', () => {
  it('detects strict yes/no constraints', () => {
    expect(parseFormatConstraints('Is my store healthy? Answer only yes or no').yesNo).toBe(true)
    expect(parseFormatConstraints('reply in yes/no please').yesNo).toBe(true)
    expect(parseFormatConstraints('kya meri sales badh rahi hai? haan ya na mein batao').yesNo).toBe(true)
    expect(parseFormatConstraints('How is my store doing?').yesNo).toBe(false)
  })

  it('detects short-summary and bullet-point constraints', () => {
    expect(parseFormatConstraints('Give me a short summary of this week').shortSummary).toBe(true)
    expect(parseFormatConstraints('Summarize revenue in one sentence').shortSummary).toBe(true)
    expect(parseFormatConstraints('Show my top products as bullet points').bulletPoints).toBe(true)
    expect(parseFormatConstraints('list my risks in points').bulletPoints).toBe(true)
    expect(parseFormatConstraints('What should I do next?')).toEqual({ yesNo: false, shortSummary: false, bulletPoints: false, language: null })
  })

  it('detects Hindi and Hinglish queries', () => {
    expect(parseFormatConstraints('मेरी सेल कैसे बढ़ाऊँ?').language).toBe('hindi')
    expect(parseFormatConstraints('mujhe apne VIP customers dikhao').language).toBe('hinglish')
    expect(parseFormatConstraints('Show my VIP customers').language).toBeNull()
  })

  it('marks strict constraints for the prose formatter', () => {
    expect(hasStrictFormatConstraints(parseFormatConstraints('answer only yes or no'))).toBe(true)
    expect(hasStrictFormatConstraints(parseFormatConstraints('tell me about my sales'))).toBe(false)
  })

  it('builds a constraint-aware formatting prompt', () => {
    const prompt = buildConstrainedFormatPrompt(parseFormatConstraints('kya stock kam hai? answer only yes or no'), { plan: 'commander' })
    expect(prompt).toContain('Yes')
    expect(prompt.toLowerCase()).toContain('hinglish')
  })

  it('serializes tool outcomes for grounded LLM formatting', () => {
    const outcomes: ToolOutcome[] = [
      { ok: true, name: 'get_analytics', data: { revenue: 100 }, source: 'analytics', numbers: [100] },
      { ok: false, name: 'search_orders', error: 'No orders synced', source: 'search_orders' },
    ]
    const serialized = serializeToolOutcomes(outcomes)
    expect(serialized).toContain('revenue')
    expect(serialized).toContain('No orders synced')
  })
})

describe('buildSystemPrompt language & constraint guidance', () => {
  it('includes Hindi/Hinglish comprehension and strict-format rules', () => {
    const prompt = buildSystemPrompt({ storeId: tenant, plan: 'commander', actionsEnabled: true })
    expect(prompt).toContain('Hinglish')
    expect(prompt).toContain('answer only yes or no')
  })
})

describe('actionFailureDetails', () => {
  it('prefers errorDetails.message, then reasons, then result.message', () => {
    expect(actionFailureDetails(failedAction({ errorDetails: { message: 'specific' } }))).toBe('specific')
    expect(actionFailureDetails(failedAction({ errorDetails: { reasons: ['one', 'two'] } }))).toBe('one; two')
    expect(actionFailureDetails(failedAction({ executionResult: { message: 'from result' } }))).toBe('from result')
    expect(actionFailureDetails(failedAction())).toBe('The backend did not confirm success.')
  })
})

/* ── Commander product spec: billing gating, allowlist, grounding ──── */

describe('Commander plan & billing-state gating', () => {
  it('maps billing states to the three access modes', () => {
    expect(aiCommandBillingMode('ACTIVE_MONTHLY')).toBe('active')
    expect(aiCommandBillingMode('ACTIVE_ANNUAL')).toBe('active')
    expect(aiCommandBillingMode('GIFT_ACCESS_UNLIMITED')).toBe('active')
    expect(aiCommandBillingMode('TRIAL_LIMITED')).toBe('limited')
    for (const state of ['TRIAL_EXPIRED', 'PENDING_CONFIRMATION', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const) {
      expect(aiCommandBillingMode(state)).toBe('blocked')
    }
    // Unknown / missing records never unlock full access.
    expect(normalizeAiCommandBillingState(undefined)).toBe('TRIAL_LIMITED')
    expect(normalizeAiCommandBillingState(null)).toBe('TRIAL_LIMITED')
    expect(normalizeAiCommandBillingState('SOMETHING_NEW')).toBe('TRIAL_LIMITED')
    expect(normalizeAiCommandBillingState('ACTIVE_MONTHLY')).toBe('ACTIVE_MONTHLY')
  })

  it('expired trial: any query gets the trial-expired message, no data leaks, no quota burned', async () => {
    const command = service('trial', { stateFor: async () => 'TRIAL_EXPIRED' })
    const result = await command.chat({ storeId: tenant, text: 'Show me today\'s revenue' })
    expect(result.message.contentType).toBe('upgrade')
    expect(result.message.content).toContain('trial has expired')
    expect(result.message.content).toContain('Upgrade Plan')
    expect(result.message.content).not.toMatch(/\$8,940|81\/100/)
    expect(result.message.structuredData?.type).toBe('billing_blocked')
    expect((await command.usage(tenant)).commandsUsed).toBe(0)
  })

  it('past-due, pending, suspended, and cancelled stores are also refused with state-specific copy', async () => {
    for (const [state, snippet] of [['PAST_DUE', 'payment issue'], ['PENDING_CONFIRMATION', 'payment confirmation'], ['SUSPENDED', 'suspended'], ['CANCELLED', 'cancelled']] as const) {
      const command = service('growth', { stateFor: async () => state })
      const result = await command.chat({ storeId: tenant, text: 'How is my growth this month?' })
      expect(result.message.contentType).toBe('upgrade')
      expect(result.message.content.toLowerCase()).toContain(snippet)
    }
  })

  it('trial-limited billing state: answers data questions but never executes actions', async () => {
    const command = service('commander', { stateFor: async () => 'TRIAL_LIMITED' })
    const info = await command.chat({ storeId: tenant, text: "What's my revenue this month?" })
    expect(info.message.contentType).toBe('structured_data')
    expect(info.message.content).toContain('$8,940')
    const upgrade = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    expect(upgrade.message.contentType).toBe('upgrade')
    expect(upgrade.message.content).toContain('Commander plan includes')
    expect(upgrade.message.action).toBeNull()
    expect((await command.usage(tenant)).actionsEnabled).toBe(false)
  })

  it('commander plan + ACTIVE billing state unlocks the full approval flow', async () => {
    let executed = 0
    const command = service('commander', {
      stateFor: async () => 'ACTIVE_ANNUAL',
      actions: new InMemoryCommandActions(async () => { executed += 1; return { status: 'SUCCESS', result: { updated: 1, failed: 0 }, rollbackAvailable: true } }),
    })
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    expect(preview.message.contentType).toBe('action_preview')
    expect(executed).toBe(0)
    const confirmed = await command.chat({ storeId: tenant, text: 'confirm', conversationId: preview.conversation.id })
    expect(confirmed.message.contentType).toBe('action_result')
    expect(executed).toBe(1)
  })

  it('approveAction refuses a billing-blocked store even when a pending action exists', async () => {
    let billing = 'ACTIVE_MONTHLY'
    const command = service('commander', { stateFor: async () => billing })
    const preview = await command.chat({ storeId: tenant, text: 'Tag new customers as vip' })
    billing = 'CANCELLED'
    await expect(command.approveAction(tenant, preview.message.action!.id!)).rejects.toMatchObject({ status: 402, code: 'PAYMENT_REQUIRED' })
  })
})

describe('Commander data-query flow integrity', () => {
  it('parseInfoTools returns nothing for unknown queries (no default health+analytics guess)', () => {
    expect(parseInfoTools('blah blah blah')).toEqual([])
    expect(parseInfoTools('Create a 15% weekend discount').map((call) => call.name)).toEqual([])
    // The service turns the empty parse into grounded ambient tools for
    // in-scope queries, while off-topic queries are refused before tools run.
    expect(ambientToolsWhenUnmapped('blah blah blah', []).map((call) => call.name)).toEqual(['get_store_health', 'get_analytics'])
    expect(ambientToolsWhenUnmapped('Show revenue', parseInfoTools('Show revenue')).map((call) => call.name)).toEqual(['get_analytics'])
  })

  it('unparseable-but-in-scope store questions get grounded ambient data, not a refusal', async () => {
    const result = await service('growth').chat({ storeId: tenant, text: 'How healthy is my store?' })
    expect(result.message.content).toContain('81/100')
    expect(result.message.contentType).not.toBe('offtopic')
  })

  it('no orders in DB → honest empty answer, never fake orders', async () => {
    const noOrders = new InMemoryCommandTools({ search_orders: { count: 0, total: 0, items: [] } })
    const result = await service('growth', { tools: noOrders }).chat({ storeId: tenant, text: 'Show my recent orders' })
    expect(result.message.content).toContain('No orders matched')
    expect(result.message.content).not.toMatch(/#10\d\d/)
  })

  it('no products synced → honest sync prompt, never fake product names', async () => {
    const empty = new InMemoryCommandTools({ search_products: { count: 0, items: [] } })
    const result = await service('growth', { tools: empty }).chat({ storeId: tenant, text: 'Which products are selling best?' })
    expect(result.message.content).toContain('No products matched')
    expect(result.message.content).not.toContain('Mug')
  })

  it('freshness labels ride along on analytics, health, and inventory answers', async () => {
    const withDays = new InMemoryCommandTools({
      get_analytics: { currency: 'USD', revenue: 500, previousRevenue: 400, orders: 10, aov: 50, days: 7 },
      get_inventory_status: { lowStockCount: 2, outOfStockCount: 0, items: [] },
      get_store_health: { score: 70, label: 'Needs attention' },
    })
    const revenue = await service('growth', { tools: withDays }).chat({ storeId: tenant, text: "Show this week's revenue" })
    expect(revenue.message.content).toContain('last 7 days')
    expect(revenue.message.content).toContain('as of today')
    const stock = await service('growth', { tools: withDays }).chat({ storeId: tenant, text: 'Do I have low stock items?' })
    expect(stock.message.content).toContain('as of today')
  })

  it('an approval-required preview card names the workflow template and changes nothing until approval', async () => {
    let created = 0
    const command = service('commander', {
      tools: new InMemoryCommandTools({
        list_workflows: { count: 0, items: [] },
      }),
      actions: new InMemoryCommandActions(async () => { created += 1; return { status: 'SUCCESS', result: { id: 'wf-1', name: 'Abandoned Checkout Recovery', status: 'DRAFT' }, rollbackAvailable: false } }),
    })
    const preview = await command.chat({ storeId: tenant, text: 'Create an automation for abandoned cart recovery' })
    expect(preview.message.contentType).toBe('action_preview')
    expect(preview.message.content).toContain('Nothing has been executed')
    expect(preview.message.action?.type).toBe('CREATE_WORKFLOW')
    expect(preview.message.action?.params.template_id).toBe('abandoned-checkout')
    expect((preview.message.action?.preview as { approval_required?: boolean }).approval_required).toBe(true)
    expect(preview.message.structuredData?.actions).toEqual(['approve', 'edit', 'cancel'])
    expect(created).toBe(0)
    const actionId = preview.message.action!.id!
    const executed = await command.approveAction(tenant, actionId)
    expect(executed.executionStatus).toBe('SUCCESS')
    expect(created).toBe(1)
    const conversation = await command.conversation(tenant, preview.conversation.id)
    expect(conversation.messages.some((item) => item.contentType === 'action_result' && item.action?.id === actionId)).toBe(true)
  })

  it('basic/start/growth action requests get the upgrade prompt wording from the spec', async () => {
    for (const plan of ['start', 'growth'] as const) {
      const result = await service(plan).chat({ storeId: tenant, text: 'Create an automation for abandoned cart recovery' })
      expect(result.message.contentType).toBe('upgrade')
      expect(result.message.content).toContain('Upgrade Plan')
      expect(result.message.content).toContain('Commander plan includes')
    }
  })
})

describe('Commander zero-hallucination guards', () => {
  it('collectEntities pulls every verifiable named entity from tool output', () => {
    const entities = collectEntities({
      items: [
        { id: 'p1', title: 'Coffee Mug', vendor: 'Acme' },
        { id: 'c1', displayName: 'Ada Lovelace', email: 'ada@example.com' },
        { orderNumber: '#1001', customer: 'Ada' },
      ],
    })
    expect(entities).toContain('coffee mug')
    expect(entities).toContain('ada lovelace')
    expect(entities).toContain('ada@example.com')
    expect(entities).toContain('#1001')
    expect(entities).toContain('acme')
  })

  it('groundCommandText rejects emails that never appeared in the tool results', () => {
    const safe = groundCommandText('Revenue is $10 and I emailed ada@example.com.', [10], ['coffee mug', 'ada@example.com'])
    expect(safe).toContain('ada@example.com')
    const blocked = groundCommandText('Revenue is $10 and I emailed ghost@example.com.', [10], ['coffee mug', 'ada@example.com'])
    expect(blocked).not.toContain('ghost@example.com')
    expect(blocked).toContain('not present in the live tool results')
  })

  it('numbers sourced from tools pass while invented figures are still rejected', () => {
    expect(groundCommandText('AOV is $213.', [213, 8940])).toContain('$213')
    expect(groundCommandText('AOV will hit $500 next week.', [213, 8940])).toContain('not supported')
  })

  it('the rewritten system prompt establishes Commander identity, allowlist scope, and zero-hallucination rules', () => {
    const prompt = buildSystemPrompt({ storeId: tenant, shop: 'demo.myshopify.com', plan: 'commander', actionsEnabled: true })
    expect(prompt).toContain('Commander')
    expect(prompt).toContain('ALLOWLIST-FIRST')
    expect(prompt).toContain('ZERO HALLUCINATION RULES')
    expect(prompt).toContain('ACTION APPROVAL FLOW')
    expect(prompt).toContain("I'm your store's Commander")
    expect(prompt).toContain('demo.myshopify.com')
    const locked = buildSystemPrompt({ storeId: tenant, plan: 'start', actionsEnabled: false })
    expect(locked).toContain('answers-only')
    expect(locked).toContain('This action requires the Commander plan. Upgrade to unlock full store control.')
  })
})
