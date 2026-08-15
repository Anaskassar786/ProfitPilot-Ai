import { describe, expect, it } from 'vitest'
import { askCopilot, confirmJarvisAction, fetchForecast, fetchJarvisPreferences, fetchReports, generateReport, sendJarvisMessage, startJarvisSession, streamJarvisMessage } from './api.js'

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

  it('parses Jarvis SSE streams into progressive text and a final response', async () => {
    const sseFetcher = async (_input: string, init?: RequestInit): Promise<Response> => {
      expect(String(init?.body)).toContain('"stream":true')
      const frames = [
        'event: text\ndata: {"text":"Sir, "}\n\n',
        'event: text\ndata: {"text":"Sir, revenue $4,580 hai."}\n\n',
        'event: done\ndata: {"response":{"session":{"id":"session-1"},"status":"ANSWER","text":"Sir, revenue $4,580 hai.","addressing":"Sir","language":"hi","mode":"ANSWER","evidence":null,"action":null,"showEvidence":false,"requiresConfirmation":false}}\n\n',
      ]
      return new Response(new ReadableStream({ start(controller) { for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame)); controller.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const seen: string[] = []
    const response = await streamJarvisMessage('store-1', 'session-1', 'revenue kitna hai', 'dashboard', (fullText) => seen.push(fullText), sseFetcher)
    expect(seen).toEqual(['Sir, ', 'Sir, revenue $4,580 hai.'])
    expect(response.text).toBe('Sir, revenue $4,580 hai.')
    expect(response.status).toBe('ANSWER')
  })
})
