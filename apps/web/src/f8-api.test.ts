import { describe, expect, it } from 'vitest'
import { askCopilot, confirmJarvisAction, fetchForecast, fetchJarvisPreferences, fetchReports, generateReport, sendJarvisMessage, startJarvisSession } from './api.js'

function fetcher(calls: string[]) { return async (input: string, init?: RequestInit): Promise<Response> => { calls.push(`${init?.method ?? 'GET'} ${input}`); return new Response(JSON.stringify({ ok: true, data: { id: 'session-1', threadId: 'thread-1', slots: [], revenue: null, run: { id: 'run-1' } } }), { status: 200 }) } }

describe('F8 relative API clients', () => {
  it('keeps Jarvis/Copilot/Forecast/Reports calls relative and tenant-scoped', async () => {
    const calls: string[] = []
    const fetch = fetcher(calls)
    await fetchJarvisPreferences('store/1', fetch)
    await startJarvisSession('store-1', 'dashboard', 'growth', fetch)
    await sendJarvisMessage('store-1', 'session-1', 'Mujhe dikhao', 'dashboard', true, fetch)
    await confirmJarvisAction('store-1', 'session-1', 'action-1', fetch)
    await askCopilot('store-1', 'revenue', 'copilot', undefined, fetch)
    await fetchForecast('store-1', fetch)
    await fetchReports('store-1', fetch)
    await generateReport('store-1', 'WEEKLY', '2024-05-01', '2024-05-07', false, fetch)
    expect(calls.every((call) => !call.includes('localhost'))).toBe(true)
    expect(calls.some((call) => call.includes('/jarvis'))).toBe(true)
    expect(calls.some((call) => call.includes('/copilot/query'))).toBe(true)
    expect(calls.some((call) => call.includes('/reports'))).toBe(true)
  })
})
