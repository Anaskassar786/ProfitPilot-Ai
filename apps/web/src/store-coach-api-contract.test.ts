import { describe, expect, it } from 'vitest'
import { acceptCoachGoalSuggestion } from './api.js'

/**
 * Store Coach accept-suggestion client contract (QA 2026-08-21).
 *
 * Locks the exact URL the web client posts to, so the server's static route
 * `/store-coach/goals/suggestion/accept-suggestion` can never drift again.
 * Previously the request only matched the server's
 * `/store-coach/goals/:id/accept-suggestion` pattern by coincidence (the
 * literal segment "suggestion" was captured as `:id`), which would break
 * silently the moment `:id` started being validated as a real goal id.
 */
describe('Store Coach API client contract — accept suggestion', () => {
  it('POSTs the full suggestion payload to the static accept-suggestion path', async () => {
    const calls: Array<readonly [string, RequestInit | undefined]> = []
    const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
      calls.push([input, init])
      return new Response(JSON.stringify({ ok: true, data: { id: 'goal-1', title: 'Ship 60 orders' } }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    const suggestion = { title: 'Ship 60 orders', metric: 'ORDERS', targetValue: 60, currency: 'USD', feasibility: 'MEDIUM', rationale: 'Momentum' }
    const goal = await acceptCoachGoalSuggestion('store-1', suggestion, '2026-08-18', fetcher)
    expect(goal.title).toBe('Ship 60 orders')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('/store-coach/goals/suggestion/accept-suggestion?storeId=store-1')
    expect(calls[0]?.[1]?.method ?? 'POST').toBe('POST')
    const body = JSON.parse(String(calls[0]?.[1]?.body ?? '{}')) as Readonly<Record<string, unknown>>
    expect((body.suggestion as Readonly<Record<string, unknown>>).title).toBe('Ship 60 orders')
    expect((body.suggestion as Readonly<Record<string, unknown>>).metric).toBe('ORDERS')
    expect(body.startDate).toBe('2026-08-18')
  })

  it('sends the suggestion exactly as provided so the goal is grounded in the validated payload', async () => {
    const calls: Array<readonly [string, RequestInit | undefined]> = []
    const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
      calls.push([input, init])
      return new Response(JSON.stringify({ ok: true, data: { id: 'goal-2', title: 'Grow margin' } }), { status: 201 })
    }
    await acceptCoachGoalSuggestion('store-9', { title: 'Grow margin', metric: 'MARGIN', targetValue: 5, currency: 'USD', feasibility: 'LOW', rationale: 'Headroom' }, '2026-09-01', fetcher)
    expect(calls[0]?.[0]).toBe('/store-coach/goals/suggestion/accept-suggestion?storeId=store-9')
    const body = JSON.parse(String(calls[0]?.[1]?.body ?? '{}')) as Readonly<Record<string, unknown>>
    expect((body.suggestion as Readonly<Record<string, unknown>>).feasibility).toBe('LOW')
    expect(body.startDate).toBe('2026-09-01')
  })
})
