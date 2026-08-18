import { describe, expect, it } from 'vitest'
import {
  conversationIdFromHash,
  groupConversations,
  hoursUntilDailyReset,
  isAiCommandHash,
  isCampaignsHash,
  parseSseBlocks,
  parseSseFrame,
  remainingUndoSeconds,
  searchConversations,
  tableRows,
  usageLabel,
  usagePercent,
  usageTone,
} from './ai-command-model.js'
import type { AiCommandConversation } from './ai-command-model.js'

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
    const usage = { storeId: 's', usageDate: '2026-08-18', commandsUsed: 45, actionsExecuted: 0, tokensUsed: 0, costMicroDollars: 0, limit: 50, remaining: 5, actionsEnabled: false }
    expect(usageLabel(usage, 'start')).toBe('45/50 commands today')
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
})
