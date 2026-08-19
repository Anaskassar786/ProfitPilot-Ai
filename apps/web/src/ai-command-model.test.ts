import { describe, expect, it } from 'vitest'
import {
  conversationIdFromHash,
  conversationPreview,
  dailyResetCountdown,
  firstAssistantAnswer,
  groupConversations,
  hoursUntilDailyReset,
  isAiCommandHash,
  isCampaignsHash,
  lastUserQuestion,
  parseSseBlocks,
  parseSseFrame,
  quickCommandCategory,
  remainingUndoSeconds,
  searchConversations,
  tableRows,
  usageHistoryBars,
  usageLabel,
  usagePercent,
  usageTone,
  valueStats,
} from './ai-command-model.js'
import type { AiCommandConversation, AiCommandUsage } from './ai-command-model.js'

const conversation = (id: string, at: string, title = 'Chat'): AiCommandConversation => ({
  id, storeId: 's1', title, messages: [], context: {}, status: 'ACTIVE', createdAt: at, updatedAt: at, lastMessageAt: at,
})

describe('AI Command frontend model', () => {
  it('groups conversations by recency', () => {
    const now = Date.parse('2026-08-18T18:00:00.000Z')
    const groups = groupConversations([
      conversation('1', '2026-08-18T10:00:00.000Z'),
      conversation('2', '2026-08-17T10:00:00.000Z'),
      conversation('3', '2026-08-10T10:00:00.000Z'),
    ], now)
    expect(groups.today.map((item) => item.id)).toEqual(['1'])
    expect(groups.yesterday.map((item) => item.id)).toEqual(['2'])
    expect(groups.older.map((item) => item.id)).toEqual(['3'])
  })

  it('renders usage without inventing extra quota', () => {
    const usage = { storeId: 's', usageDate: '2026-08-18', commandsUsed: 90, actionsExecuted: 0, tokensUsed: 0, costMicroDollars: 0, limit: 100, remaining: 10, actionsEnabled: false }
    expect(usageLabel(usage, 'start')).toBe('90/100 commands today')
    expect(usagePercent(usage)).toBe(90)
    expect(usageTone(usage)).toBe('amber')
    expect(usageLabel(null, 'commander')).toBe('Unlimited ∞')
  })

  it('parses SSE frames and hashes', () => {
    const { frames, rest } = parseSseBlocks('event: thinking\ndata: {"step":"Querying Analytics..."}\n\npartial')
    expect(parseSseFrame(frames[0] ?? '')).toEqual({ event: 'thinking', data: { step: 'Querying Analytics...' } })
    expect(rest).toBe('partial')
    expect(isAiCommandHash('#/ai-command/abc')).toBe(true)
    expect(conversationIdFromHash('#/ai-command/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(isCampaignsHash('#/campaigns')).toBe(true)
  })

  it('searches conversations and extracts table rows', () => {
    const list = [conversation('1', '2026-08-18T00:00:00.000Z', 'Revenue this month')]
    expect(searchConversations(list, 'revenue')).toHaveLength(1)
    expect(searchConversations(list, 'inventory')).toHaveLength(0)
    expect(tableRows([{ id: '1', name: 'Ada' }, 'skip'])).toHaveLength(1)
    expect(remainingUndoSeconds(new Date(Date.now() + 12_000).toISOString())).toBeGreaterThan(0)
  })

  it('counts down whole hours until the daily reset (UTC midnight)', () => {
    expect(hoursUntilDailyReset(new Date('2026-08-18T12:00:00.000Z'))).toBe(12)
    expect(hoursUntilDailyReset(new Date('2026-08-18T23:59:00.000Z'))).toBe(1)
  })

  it('breaks the daily reset into h:mm:ss for the elegant countdown', () => {
    expect(dailyResetCountdown(new Date('2026-08-18T18:00:00.000Z'))).toEqual({ hours: 6, minutes: 0, seconds: 0 })
    expect(dailyResetCountdown(new Date('2026-08-18T23:59:20.000Z'))).toEqual({ hours: 0, minutes: 0, seconds: 40 })
    expect(dailyResetCountdown(new Date('2026-08-18T12:34:56.000Z'))).toEqual({ hours: 11, minutes: 25, seconds: 4 })
  })

  it('builds conversation previews from real messages only', () => {
    const withAnswer: AiCommandConversation = {
      id: 'c1', storeId: 's1', title: 'Revenue question', context: {}, status: 'ACTIVE',
      createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z', lastMessageAt: '2026-08-18T10:00:00.000Z',
      messages: [
        { id: 'm1', role: 'user', content: 'What is my revenue this month?', contentType: 'text', structuredData: null, action: null, thinkingSteps: null, timestamp: '2026-08-18T10:00:00.000Z' },
        { id: 'm2', role: 'assistant', content: 'Your revenue for this period is $500, 25% higher than the previous period.', contentType: 'text', structuredData: null, action: null, thinkingSteps: null, timestamp: '2026-08-18T10:00:01.000Z' },
      ],
    }
    expect(lastUserQuestion(withAnswer)).toBe('What is my revenue this month?')
    expect(firstAssistantAnswer(withAnswer)).toContain('$500')
    expect(conversationPreview(withAnswer).question).toBe('What is my revenue this month?')
    expect(firstAssistantAnswer(conversation('c2', '2026-08-18T10:00:00.000Z'))).toBe('')
  })

  it('derives the real commands-per-day series without inventing rows', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const today: AiCommandUsage = { storeId: 's', usageDate: '2026-08-18', commandsUsed: 4, actionsExecuted: 0, tokensUsed: 0, costMicroDollars: 0, limit: 10, remaining: 6, actionsEnabled: false }
    const bars = usageHistoryBars([today], 7, now)
    expect(bars).toHaveLength(7)
    expect(bars[6]).toEqual({ label: expect.any(String), value: 4, isToday: true })
    expect(bars.slice(0, 6).every((bar) => bar.value === 0 && !bar.isToday)).toBe(true)
  })

  it('reports value stats from real usage and labels the estimate', () => {
    const usage = { storeId: 's', usageDate: '2026-08-18', commandsUsed: 12, actionsExecuted: 3, tokensUsed: 0, costMicroDollars: 0, limit: 50, remaining: 38, actionsEnabled: false }
    const history = [
      { ...usage, usageDate: '2026-08-18', commandsUsed: 12 },
      { ...usage, usageDate: '2026-08-17', commandsUsed: 8 },
      { ...usage, usageDate: '2026-08-16', commandsUsed: 4 },
    ]
    expect(valueStats(usage, history, 4, 2)).toMatchObject({ commandsToday: 12, commandsWeek: 24, actions: 3, conversations: 4, saved: 2, timeSavedMinutes: 72 })
    expect(valueStats(usage, history, 4, 2).timeSavedLabel).toBe('1.2h')
  })

  it('categorizes quick commands into analytics, customers, products, growth, actions', () => {
    expect(quickCommandCategory({ id: 'a', label: 'Revenue', command: 'Show revenue', kind: 'info' })).toBe('analytics')
    expect(quickCommandCategory({ id: 'b', label: 'VIP list', command: 'Show VIP customers', kind: 'info' })).toBe('customers')
    expect(quickCommandCategory({ id: 'c', label: 'Stock', command: 'Low stock inventory', kind: 'info' })).toBe('products')
    expect(quickCommandCategory({ id: 'd', label: 'Grow', command: 'Help me increase sales', kind: 'info' })).toBe('growth')
    expect(quickCommandCategory({ id: 'e', label: 'Email', command: 'Send email', kind: 'action' })).toBe('actions')
  })
})
