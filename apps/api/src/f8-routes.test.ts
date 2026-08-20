import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { InMemoryCopilotRepository, InMemoryJarvisRepository, CopilotService, JarvisService } from '@profitpilot/ai'
import { InMemoryReportObjectStore, InMemoryReportRepository, ReportService } from '@profitpilot/reporting'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

const evidence = { async get() { return { page: 'dashboard', generatedAt: new Date(1_000).toISOString(), currency: 'USD', facts: [{ key: 'revenue', label: 'Revenue', value: 189, source: 'analytics' }], confidence: .92, confidenceLevel: 'HIGH' as const, suggestedAction: null } } }
const copilotEvidence = { async get(_store: never, intent: never, page: string) { return { intent, page, generatedAt: new Date(1_000).toISOString(), facts: [{ key: 'revenue', label: 'Revenue', value: 189, source: 'analytics' }], confidence: .92, confidenceLevel: 'HIGH' as const } } }

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const jarvis = new JarvisService(new (await import('@profitpilot/ai')).OpenRouterClient({ keys: [] }), evidence, new InMemoryJarvisRepository(), null, () => 1_000)
  const copilot = new CopilotService(copilotEvidence, new InMemoryCopilotRepository(), () => 1_000)
  const reports = new ReportService(new InMemoryReportRepository(), new InMemoryReportObjectStore(), { async get(storeId) { return { storeId, currency: null, rows: [{ metric: 'revenue', value: 189, source: 'analytics' }], summary: 'closed' } } }, null, () => Date.parse('2024-06-01T00:00:00.000Z'))
  const app = createApi({ logger: new Logger(), readinessChecks: [], jarvis: { service: jarvis }, copilot: { service: copilot }, forecasting: { forecast: async () => ({ dataAvailable: true }) }, reports: { service: reports } })
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function withStreamServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const { OpenRouterClient, JarvisService } = await import('@profitpilot/ai')
  const provider = new OpenRouterClient({
    keys: ['key'], models: ['jarvis-model'],
    fetcher: async (_input: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { stream?: boolean } : {}
      if (body.stream === true) {
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Revenue is 189."}}]}\n\n')); controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Revenue is 189.' } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }), { status: 200 })
    },
    sleep: async () => undefined,
  })
  const jarvis = new JarvisService(provider, evidence, new InMemoryJarvisRepository(), null, () => 1_000)
  const app = createApi({ logger: new Logger(), readinessChecks: [], jarvis: { service: jarvis } })
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('F8 API routes', () => {
  it('runs Jarvis sessions, preferences, state controls, and messages', async () => await withServer(async (base) => {
    const preferences = await fetch(`${base}/jarvis/preferences?storeId=store-1`)
    expect(preferences.status).toBe(200)
    const started = await fetch(`${base}/jarvis/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', page: 'dashboard', plan: 'growth' }) })
    const session = (await started.json() as { data: { id: string } }).data
    const message = await fetch(`${base}/jarvis/sessions/${session.id}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', text: 'show revenue', page: 'dashboard' }) })
    expect(message.status).toBe(200)
    const saved = await fetch(`${base}/jarvis/preferences`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', addressing: 'Commander', engagementMode: 'quiet' }) })
    expect((await saved.json()).data.addressing).toBe('Commander')
    expect((await fetch(`${base}/jarvis/sessions/${session.id}/pause`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1' }) })).status).toBe(200)
    expect((await fetch(`${base}/jarvis/sessions/${session.id}/messages?storeId=store-1`)).status).toBe(200)
    expect((await fetch(`${base}/jarvis/sessions/${session.id}/end`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1' }) })).status).toBe(200)
  }))

  it('runs closed Copilot queries and exports threads', async () => await withServer(async (base) => {
    const response = await fetch(`${base}/copilot/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', query: 'What is revenue?', page: 'analytics' }) })
    const answer = (await response.json() as { data: { threadId: string; slots: readonly unknown[] } }).data
    expect(answer.slots).toHaveLength(1)
    expect((await fetch(`${base}/copilot/threads?storeId=store-1`)).status).toBe(200)
    const exported = await fetch(`${base}/copilot/threads/${answer.threadId}/export?storeId=store-1`)
    expect((await exported.json()).data.contentType).toContain('csv')
  }))

  it('streams Jarvis answers over SSE when stream=true is requested', async () => await withStreamServer(async (base) => {
    const started = await fetch(`${base}/jarvis/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', page: 'dashboard', plan: 'trial' }) })
    const session = (await started.json() as { data: { id: string } }).data
    const streamed = await fetch(`${base}/jarvis/sessions/${session.id}/message`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ storeId: 'store-1', text: 'show revenue', page: 'dashboard', stream: true }) })
    expect(streamed.status).toBe(200)
    expect(streamed.headers.get('content-type')).toContain('text/event-stream')
    const body = await streamed.text()
    expect(body).toContain('event: text')
    expect(body).toContain('Revenue is 189.')
    expect(body).toContain('event: done')
    const doneLine = body.split('\n').find((line) => line.startsWith('data: ') && line.includes('"response"'))
    const done = JSON.parse((doneLine ?? '{}').slice(6)) as { response?: { text?: string } }
    expect(done.response?.text).toBe('Revenue is 189.')
  }))

  it('serves forecasting and report generation/download routes', async () => await withServer(async (base) => {
    expect((await fetch(`${base}/forecasting?storeId=store-1`)).status).toBe(200)
    const generated = await fetch(`${base}/reports/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', frequency: 'WEEKLY', start: '2024-05-01T00:00:00.000Z', end: '2024-05-07T23:59:59.000Z' }) })
    const run = (await generated.json() as { data: { run: { id: string } } }).data.run
    const downloaded = await fetch(`${base}/reports/${run.id}/download?storeId=store-1`)
    expect((await downloaded.json()).data.bytes).toBeGreaterThan(0)
  }))

  it('validates missing F8 request context', async () => await withServer(async (base) => {
    expect((await fetch(`${base}/copilot/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'revenue' }) })).status).toBe(400)
    expect((await fetch(`${base}/jarvis/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', plan: 'bad' }) })).status).toBe(400)
  }))

  it('gates Jarvis store actions by plan and requires confirmation for writes', async () => {
    const { JarvisService } = await import('@profitpilot/ai')
    // A tool that records when it actually runs.
    let executed = false
    const tools = { approve_recommendation: async () => { executed = true; return { message: 'Recommendation approved.' } } }
    const jarvis = new JarvisService(new (await import('@profitpilot/ai')).OpenRouterClient({ keys: [] }), evidence, new InMemoryJarvisRepository(), null, () => 1_000, null, tools)
    const app = createApi({ logger: new Logger(), readinessChecks: [], jarvis: { service: jarvis } })
    const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
    const base = `http://127.0.0.1:${address.port}`
    try {
      // Start plan session — write action must be refused with a plan message.
      const startStart = await fetch(`${base}/jarvis/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', page: 'dashboard', plan: 'start' }) })
      const startSession = (await startStart.json() as { data: { id: string } }).data
      const refused = await fetch(`${base}/jarvis/sessions/${startSession.id}/store-action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', actionId: 'approve_recommendation', parameters: { recommendationId: 'r1' }, confirmed: true }) })
      expect(refused.status).toBe(200)
      const refusedBody = await refused.json() as { data: { status: string; text: string; requiresConfirmation: boolean } }
      expect(refusedBody.data.status).toBe('ACTION_UNAVAILABLE')
      expect(refusedBody.data.text).toContain('Commander plan')
      expect(refusedBody.data.requiresConfirmation).toBe(false)
      expect(executed).toBe(false)
      // End the start-plan session so a fresh Commander session is created.
      await fetch(`${base}/jarvis/sessions/${startSession.id}/end`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1' }) })

      // Commander session — without confirmation it must ask first and not run.
      const startCmd = await fetch(`${base}/jarvis/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', page: 'dashboard', plan: 'commander' }) })
      const cmdSession = (await startCmd.json() as { data: { id: string } }).data
      const unconfirmed = await fetch(`${base}/jarvis/sessions/${cmdSession.id}/store-action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', actionId: 'approve_recommendation', parameters: { recommendationId: 'r1' }, confirmed: false }) })
      const unconfirmedBody = await unconfirmed.json() as { data: { status: string; requiresConfirmation: boolean } }
      expect(unconfirmedBody.data.status).toBe('ACTION_PENDING')
      expect(unconfirmedBody.data.requiresConfirmation).toBe(true)
      expect(executed).toBe(false)

      // With confirmation the tool actually runs.
      const confirmed = await fetch(`${base}/jarvis/sessions/${cmdSession.id}/store-action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', actionId: 'approve_recommendation', parameters: { recommendationId: 'r1' }, confirmed: true }) })
      const confirmedBody = await confirmed.json() as { data: { status: string; text: string } }
      expect(confirmedBody.data.status).toBe('ACTION_EXECUTED')
      expect(confirmedBody.data.text).toContain('approved')
      expect(executed).toBe(true)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it('degrades gracefully when evidence sources fail on a cold start (regression for production 500)', async () => {
    // The evidence provider rejects (simulating a missing table / RLS / outage).
    // Previously this 500'd every Jarvis message; now it must answer 200 with
    // grounded empty evidence, over both non-streaming and SSE transports.
    const brokenEvidence = { async get() { throw new Error('relation "ai_recommendations" does not exist') } }
    const jarvis = new JarvisService(new (await import('@profitpilot/ai')).OpenRouterClient({ keys: [] }), brokenEvidence, new InMemoryJarvisRepository(), null, () => 1_000)
    const app = createApi({ logger: new Logger(), readinessChecks: [], jarvis: { service: jarvis } })
    const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
    const base = `http://127.0.0.1:${address.port}`
    try {
      const started = await fetch(`${base}/jarvis/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', page: 'dashboard', plan: 'trial' }) })
      const session = (await started.json() as { data: { id: string } }).data
      const nonStream = await fetch(`${base}/jarvis/sessions/${session.id}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', text: 'hello Jarvis', page: 'dashboard' }) })
      expect(nonStream.status).toBe(200)
      const payload = await nonStream.json() as { ok: boolean; data: { text: string; status: string } }
      expect(payload.ok).toBe(true)
      expect(payload.data.text.length).toBeGreaterThan(0)
      const stream = await fetch(`${base}/jarvis/sessions/${session.id}/message`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ storeId: 'store-1', text: 'mujhe revenue dikhao', page: 'dashboard', stream: true }) })
      expect(stream.status).toBe(200)
      const body = await stream.text()
      expect(body).toContain('event: done')
      expect(body).not.toContain('event: error')
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
