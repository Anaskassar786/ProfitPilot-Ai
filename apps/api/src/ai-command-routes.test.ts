import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import { AiCommandService, InMemoryAiCommandRepository, InMemoryCommandActions, InMemoryCommandTools } from '@profitpilot/ai'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

const tenant = storeId('store-1')

function commandService(plan: 'trial' | 'start' | 'growth' | 'commander') {
  return new AiCommandService({
    repository: new InMemoryAiCommandRepository(plan),
    tools: new InMemoryCommandTools({
      get_analytics: { revenue: 500, previousRevenue: 400, orders: 10, aov: 50 },
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

async function withServer<T>(plan: 'trial' | 'start' | 'growth' | 'commander', handler: (base: string) => Promise<T>): Promise<T> {
  const app = createApi({ logger: new Logger(), readinessChecks: [], aiCommand: { service: commandService(plan) } })
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
    const preview = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'Send email to those customers' }) })
    const previewBody = await preview.json() as { data: { message: { action: { id: string }; contentType: string } } }
    expect(previewBody.data.message.contentType).toBe('action_preview')
    const approved = await fetch(`${base}/ai-command/actions/${previewBody.data.message.action.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant }) })
    const action = (await approved.json() as { data: { executionStatus: string; executionResult: { sent: number; failed: number } } }).data
    expect(action.executionStatus).toBe('PARTIAL_SUCCESS')
    expect(action.executionResult.sent).toBe(1)
    expect(action.executionResult.failed).toBe(1)
  }))

  it('blocks refunds and lists conversations, usage, and quick commands', async () => await withServer('growth', async (base) => {
    const blocked = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text: 'Please refund order 1001' }) })
    const blockedBody = await blocked.json() as { data: { message: { contentType: string; content: string } } }
    expect(blockedBody.data.message.contentType).toBe('blocked')
    expect(blockedBody.data.message.content).toContain('Orders')
    expect((await fetch(`${base}/ai-command/conversations?storeId=${tenant}`)).status).toBe(200)
    const usage = await fetch(`${base}/ai-command/usage?storeId=${tenant}`)
    expect((await usage.json() as { data: { commandsUsed: number; limit: number } }).data.limit).toBe(200)
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

  it('validates empty and overlong commands without a 500', async () => await withServer('growth', async (base) => {
    for (const text of ['', 'x'.repeat(2001)]) {
      const response = await fetch(`${base}/ai-command/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, text }) })
      expect(response.status).toBe(400)
      expect((await response.json() as { error: { message: string } }).error.message).toMatch(/empty|2,000/i)
    }
  }))

  it('saves commands and refuses extra trial shortcuts', async () => await withServer('trial', async (base) => {
    for (const name of ['A', 'B', 'C']) {
      const created = await fetch(`${base}/ai-command/saved`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, name, commandText: 'Show revenue' }) })
      expect(created.status).toBe(200)
    }
    const extra = await fetch(`${base}/ai-command/saved`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: tenant, name: 'D', commandText: 'Show revenue' }) })
    expect(extra.status).toBe(402)
  }))
})
