import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AppError, storeId } from '@profitpilot/types'
import { AiCommandService, InMemoryAiCommandRepository, InMemoryCommandActions, InMemoryCommandTools } from '@profitpilot/ai'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'
import { AI_COMMAND_STREAM_UNAVAILABLE, merchantSafeAiCommandStreamError } from './ai-command-routes.js'
import type { AiCommandPageMetricsProvider } from './ai-command-page-metrics.js'

const tenant = storeId('store-1')

function commandService(plan: 'trial' | 'start' | 'growth' | 'commander') {
  return new AiCommandService({
    repository: new InMemoryAiCommandRepository(plan),
    tools: new InMemoryCommandTools({
      get_analytics: { currency: 'USD', revenue: 500, previousRevenue: 400, orders: 10, aov: 50 },
      search_customers: { count: 1, items: [{ id: 'c1', displayName: 'Ada', email: 'ada@example.com' }] },
      get_store_health: { score: 70, label: 'Needs attention' },
      get_inventory_status: { lowStockCount: 2, outOfStockCount: 0, items: [] },
      get_recommendations: { count: 0, items: [] },
    }),
    actions: new InMemoryCommandActions(async (action) => {
      if (action.actionType === 'SEND_EMAIL') return { status: 'PARTIAL_SUCCESS', result: { sent: 1, failed: 1, reasons: ['bad@invalid.com bounced'] }, rollbackAvailable: false }
      if (action.actionType === 'TAG_CUSTOMER') return { status: 'SUCCESS', result: { updated: 1, failed: 0 }, rollbackAvailable: true }
      return { status: 'FAILED', result: { message: 'Backend did not confirm success.' }, rollbackAvailable: false }
    }),
    planFor: async () => plan,
    now: () => Date.parse('2026-08-18T12:00:00.000Z'),
  })
}

async function withServer<T>(plan: 'trial' | 'start' | 'growth' | 'commander', handler: (base: string) => Promise<T>, pageMetrics?: AiCommandPageMetricsProvider): Promise<T> {
  const app = createApi({ logger: new Logger(), readinessChecks: [], aiCommand: { service: commandService(plan), ...(pageMetrics ? { pageMetrics } : {}) } })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('AI Command API', () => {
  it('streams a grounded analytics answer', async () => await withServer('growth', async (base) => {
    const response = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'What is my revenue this month?', stream: true }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    expect(body).toContain('event: thinking')
    expect(body).toContain('event: message')
    expect(body).toContain('$500')
    expect(body).not.toContain('Successfully sent')
  }))

  it('returns a distinct multi-signal growth plan after a revenue question', async () => await withServer('growth', async (base) => {
    const first = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'What is my revenue?' }) })
    const revenue = await first.json() as { data: { conversation: { id: string }; message: { content: string; structuredData: { type: string } } } }
    const second = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, conversationId: revenue.data.conversation.id, text: 'Help me increasing sale' }) })
    const growth = await second.json() as { data: { message: { content: string; structuredData: { type: string; data: { actionsEnabled: boolean } } } } }
    expect(growth.data.message.structuredData.type).toBe('growth_plan')
    expect(growth.data.message.structuredData.data.actionsEnabled).toBe(false)
    expect(growth.data.message.content).toContain('growth plan')
    expect(growth.data.message.content).not.toBe(revenue.data.message.content)
  }))

  it('enforces trial command limits with Upgrade Plan', async () => await withServer('trial', async (base) => {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'Store health check' }) })
      expect(response.status).toBe(200)
    }
    const blocked = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'Store health check' }) })
    expect(blocked.status).toBe(402)
    const payload = await blocked.json() as { error: { message: string } }
    expect(payload.error.message).toContain('Upgrade Plan')
    expect(payload.error.message).not.toContain('Upgrade to Commander')
  }))

  it('returns an upgrade payload for non-commander write requests', async () => await withServer('start', async (base) => {
    const response = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'Send email to VIP customers' }) })
    const payload = await response.json() as { data: { message: { contentType: string; content: string } } }
    expect(payload.data.message.contentType).toBe('upgrade')
    expect(payload.data.message.content).toContain('Upgrade Plan')
  }))

  it('requires approval then reports partial email failure honestly', async () => await withServer('commander', async (base) => {
    const preview = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'Send email to VIP customers' }) })
    const previewBody = await preview.json() as { data: { conversation: { id: string }; message: { action: { id: string }; contentType: string } } }
    expect(previewBody.data.message.contentType).toBe('action_preview')
    const approved = await fetch(`${base}/ai-command/actions/${previewBody.data.message.action.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant }) })
    const action = (await approved.json() as { data: { executionStatus: string; executionResult: { sent: number; failed: number } } }).data
    expect(action.executionStatus).toBe('PARTIAL_SUCCESS')
    expect(action.executionResult.sent).toBe(1)
    expect(action.executionResult.failed).toBe(1)
    const conversation = await fetch(`${base}/ai-command/conversations/${previewBody.data.conversation.id}?storeId=${tenant}`)
    const conversationBody = await conversation.json() as { data: { messages: readonly { id: string; role: string; contentType: string; action?: { status: string } }[] } }
    const resultMessage = conversationBody.data.messages.find((item) => item.contentType === 'action_result')
    expect(resultMessage?.action?.status).toBe('PARTIAL_SUCCESS')
    const feedback = await fetch(`${base}/ai-command/conversations/${previewBody.data.conversation.id}/messages/${resultMessage!.id}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, rating: 'HELPFUL' }) })
    expect(feedback.status).toBe(200)
  }))

  it('blocks refunds and lists conversations, usage, and quick commands', async () => await withServer('growth', async (base) => {
    const blocked = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'Please refund order 1001' }) })
    const blockedBody = await blocked.json() as { data: { message: { contentType: string; content: string } } }
    expect(blockedBody.data.message.contentType).toBe('blocked')
    expect(blockedBody.data.message.content).toContain('Orders')
    expect((await fetch(`${base}/ai-command/conversations?storeId=${tenant}`)).status).toBe(200)
    const usage = await fetch(`${base}/ai-command/usage?storeId=${tenant}`)
    expect((await usage.json() as { data: { commandsUsed: number; limit: number } }).data.limit).toBe(300)
    expect((await fetch(`${base}/ai-command/quick-commands?storeId=${tenant}`)).status).toBe(200)
    const insights = await fetch(`${base}/store/quick-insights?storeId=${tenant}`)
    expect(insights.status).toBe(200)
    expect((await insights.json() as { data: { revenueToday: number; lowStockCount: number; healthScore: number } }).data).toMatchObject({ revenueToday: 500, lowStockCount: 2, healthScore: 70 })
    const suggestions = await fetch(`${base}/ai-command/suggestions?storeId=${tenant}&command=${encodeURIComponent('Who are my best customers?')}`)
    expect(suggestions.status).toBe(200)
    expect((await suggestions.json() as { data: readonly { command: string }[] }).data.some((item) => /repeat customers/i.test(item.command))).toBe(true)
    expect((await fetch(`${base}/ai-command/preferences?storeId=${tenant}`)).status).toBe(200)
    const history = await fetch(`${base}/ai-command/usage/history?storeId=${tenant}&days=7`)
    expect(history.status).toBe(200)
    const historyBody = await history.json() as { data: readonly { usageDate: string; commandsUsed: number }[] }
    expect(historyBody.data.every((row) => Number.isInteger(row.commandsUsed) && row.commandsUsed >= 0)).toBe(true)
  }))

  it('returns all real-store page metrics from one no-cache endpoint', async () => {
    const pageMetrics: AiCommandPageMetricsProvider = { get: async (store) => ({
      customers: { total: 245, inactive30Days: 42, repeat: 89, potentialRecoverableRevenue: 12_450 },
      products: { active: 156, lowStock: 8, deadStock: 23, crossSellPairs: 34 },
      orders: { total: 892, pending: 5, todayCount: 12 },
      revenue: { today: 1_245, yesterday: 980, changePercent: 27.04, currency: 'USD' },
      storeHealth: { score: 82, status: 'Healthy' },
      subscription: { currentPlan: 'trial', basicAgentCount: 2 },
      availability: { customers: true, products: true, orders: true, inventoryHistory: true, storeHealth: true },
      generatedAt: '2026-08-19T12:00:00.000Z',
    }) }
    await withServer('trial', async (base) => {
      const response = await fetch(`${base}/api/ai-command/page-metrics?storeId=${tenant}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      const payload = await response.json() as { data: { customers: { total: number }; products: { crossSellPairs: number }; storeHealth: { score: number } } }
      expect(payload.data.customers.total).toBe(245)
      expect(payload.data.products.crossSellPairs).toBe(34)
      expect(payload.data.storeHealth.score).toBe(82)
    }, pageMetrics)
  })

  it('validates empty and overlong commands without a 500', async () => await withServer('growth', async (base) => {
    for (const text of ['', 'x'.repeat(2001)]) {
      const response = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text }) })
      expect(response.status).toBe(400)
      expect((await response.json() as { error: { message: string } }).error.message).toMatch(/empty|2,000/i)
    }
  }))

  it('sweeps every conversation, action, saved-command, usage, and preference endpoint without a 500', async () => await withServer('commander', async (base) => {
    const post = (path: string, body: Record<string, unknown>) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    const chat = await post('/ai-command/chat', { storeId: tenant, text: 'Tag new customers as vip' })
    const chatBody = await chat.json() as { data: { conversation: { id: string }; message: { action: { id: string } } } }
    const conversationId = chatBody.data.conversation.id
    const actionId = chatBody.data.message.action.id
    expect((await fetch(`${base}/ai-command/actions/${actionId}?storeId=${tenant}`)).status).toBe(200)
    expect((await fetch(`${base}/ai-command/actions?storeId=${tenant}`)).status).toBe(200)
    expect((await post(`/ai-command/actions/${actionId}/cancel`, { storeId: tenant })).status).toBe(200)

    const reversiblePreview = await post('/ai-command/chat', { storeId: tenant, text: 'Tag new customers as loyal' })
    const reversibleId = ((await reversiblePreview.json()) as { data: { message: { action: { id: string } } } }).data.message.action.id
    const approved = await post(`/ai-command/actions/${reversibleId}/approve`, { storeId: tenant })
    expect(approved.status).toBe(200)
    expect((await post(`/ai-command/actions/${reversibleId}/rollback`, { storeId: tenant })).status).toBe(200)

    const saved = await post('/ai-command/saved', { storeId: tenant, name: 'Revenue', commandText: 'Show revenue' })
    const savedId = ((await saved.json()) as { data: { id: string } }).data.id
    expect((await fetch(`${base}/ai-command/saved?storeId=${tenant}`)).status).toBe(200)
    expect((await post(`/ai-command/saved/${savedId}/execute`, { storeId: tenant })).status).toBe(200)
    expect((await fetch(`${base}/ai-command/saved/${savedId}?storeId=${tenant}`, { method: 'DELETE' })).status).toBe(200)

    const patched = await fetch(`${base}/ai-command/preferences`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, quickCommandsEnabled: false, conversationMemoryEnabled: false }) })
    expect(patched.status).toBe(200)
    expect((await fetch(`${base}/ai-command/conversations/${conversationId}/export?storeId=${tenant}`)).status).toBe(200)
    expect((await post(`/ai-command/conversations/${conversationId}/archive`, { storeId: tenant })).status).toBe(200)
    expect((await fetch(`${base}/ai-command/conversations/${conversationId}?storeId=${tenant}`, { method: 'DELETE' })).status).toBe(200)

    const invalid = await fetch(`${base}/ai-command/actions`)
    expect(invalid.status).toBe(400)
    expect(invalid.status).not.toBe(500)
  }))

  it('saves commands and refuses extra trial shortcuts', async () => await withServer('trial', async (base) => {
    for (const name of ['A', 'B', 'C']) {
      const created = await fetch(`${base}/ai-command/saved`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, name, commandText: 'Show revenue' }) })
      expect(created.status).toBe(200)
    }
    const extra = await fetch(`${base}/ai-command/saved`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, name: 'D', commandText: 'Show revenue' }) })
    expect(extra.status).toBe(402)
  }))

  it('sanitizes unexpected stream failures to a merchant-safe message', async () => {
    const service = { chat: async () => { throw new Error('relation "analytics_revenue_daily" does not exist') } } as unknown as AiCommandService
    const app = createApi({ logger: new Logger(), readinessChecks: [], aiCommand: { service } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No address')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/ai-command/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId: tenant, text: 'What is my revenue?', stream: true }),
      })
      const body = await response.text()
      expect(body).toContain(AI_COMMAND_STREAM_UNAVAILABLE)
      expect(body).not.toContain('analytics_revenue_daily')
      expect(body).not.toContain('does not exist')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('merchantSafeAiCommandStreamError', () => {
  it('keeps client-facing AppError copy and hides provider/DB exceptions', () => {
    expect(merchantSafeAiCommandStreamError(new AppError('PAYMENT_REQUIRED', 'Upgrade Plan to keep asking.', 402)).message).toContain('Upgrade Plan')
    expect(merchantSafeAiCommandStreamError(new Error('ECONNREFUSED 10.0.0.8:5432')).message).toBe(AI_COMMAND_STREAM_UNAVAILABLE)
    expect(merchantSafeAiCommandStreamError(new Error('OpenRouter 429 rate limit'))).toEqual({
      message: AI_COMMAND_STREAM_UNAVAILABLE,
      status: 503,
      code: 'AI_UNAVAILABLE',
    })
  })
})
