import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { CostMeter, InMemoryRecommendationRepository } from '@profitpilot/ai'
import type { AgentStatus, Recommendation } from '@profitpilot/ai'
import { Logger } from '@profitpilot/logger'
import { storeId } from '@profitpilot/types'
import { createApi } from './app.js'

const recommendation: Recommendation = { id: 'r1', storeId: storeId('s'), agent: 'REVENUE_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Opportunity', reason: 'Evidence', impactValue: 100, impactLabel: 'impact', currency: 'USD', confidence: .75, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { sha256: 'hash' }, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: '2024-01-01T00:00:00.000Z' }
const agents: readonly AgentStatus[] = [{ id: 'REVENUE_AGENT', label: 'Revenue Agent', promptVersion: '1.0.0', enabled: true, execution: 'UNCONFIGURED', languageOnly: true }]

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const recommendations = new InMemoryRecommendationRepository()
  await recommendations.put(recommendation)
  const app = createApi({ logger: new Logger(), readinessChecks: [], ai: { engine: { statuses: () => agents }, recommendations, costs: new CostMeter() } })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('F4 AI API routes', () => {
  it('returns seven-agent status contracts', async () => await withServer(async (base) => expect((await fetch(`${base}/ai/agents`)).status).toBe(200)))
  it('lists recommendations by tenant', async () => await withServer(async (base) => expect((await (await fetch(`${base}/recommendations?storeId=s`)).json()).data).toHaveLength(1)))
  it('approves using CAS expectedVersion', async () => await withServer(async (base) => {
    const response = await fetch(`${base}/recommendations/r1/approve?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0 }) })
    expect(response.status).toBe(200)
    expect((await response.json()).data.status).toBe('APPROVED')
  }))
  it('rejects stale CAS decisions', async () => await withServer(async (base) => {
    const first = await fetch(`${base}/recommendations/r1/approve?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0 }) })
    expect(first.status).toBe(200)
    const second = await fetch(`${base}/recommendations/r1/reject?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0 }) })
    expect(second.status).toBe(409)
  }))
  it('validates missing recommendation query tenant', async () => await withServer(async (base) => expect((await fetch(`${base}/recommendations`)).status).toBe(400)))
  it('validates missing approval version', async () => await withServer(async (base) => expect((await fetch(`${base}/recommendations/r1/approve?storeId=s`, { method: 'POST', body: '{}' })).status).toBe(400)))
  it('returns per-store AI cost summary', async () => await withServer(async (base) => expect((await (await fetch(`${base}/ai/cost?storeId=s`)).json()).data.storeId).toBe('s')))
})
