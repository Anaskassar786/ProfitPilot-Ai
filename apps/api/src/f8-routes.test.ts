import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { InMemoryCopilotRepository, InMemoryJarvisRepository, CopilotService, JarvisService } from '@profitpilot/ai'
import { InMemoryReportObjectStore, InMemoryReportRepository, ReportService } from '@profitpilot/reporting'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

const evidence = { async get() { return { page: 'dashboard', generatedAt: new Date(1_000).toISOString(), facts: [{ key: 'revenue', label: 'Revenue', value: 189, source: 'analytics' }], confidence: .92, confidenceLevel: 'HIGH' as const, suggestedAction: null } } }
const copilotEvidence = { async get(_store: never, intent: never, page: string) { return { intent, page, generatedAt: new Date(1_000).toISOString(), facts: [{ key: 'revenue', label: 'Revenue', value: 189, source: 'analytics' }], confidence: .92, confidenceLevel: 'HIGH' as const } } }

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const jarvis = new JarvisService(new (await import('@profitpilot/ai')).OpenRouterClient({ keys: [] }), evidence, new InMemoryJarvisRepository(), null, () => 1_000)
  const copilot = new CopilotService(copilotEvidence, new InMemoryCopilotRepository(), () => 1_000)
  const reports = new ReportService(new InMemoryReportRepository(), new InMemoryReportObjectStore(), { async get(storeId) { return { storeId, currency: null, rows: [{ metric: 'revenue', value: 189, source: 'analytics' }], summary: 'closed' } } }, null, () => Date.parse('2024-06-01T00:00:00.000Z'))
  const app = createApi({ logger: new Logger(), readinessChecks: [], jarvis: { service: jarvis }, copilot: { service: copilot }, forecasting: { forecast: async () => ({ dataAvailable: true }) }, reports: { service: reports } })
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
    const saved = await fetch(`${base}/jarvis/preferences`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', addressing: 'Boss', engagementMode: 'quiet' }) })
    expect((await saved.json()).data.addressing).toBe('Boss')
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
})
