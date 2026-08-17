import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { CalibrationLedger, CostMeter, DecisionEngine, InMemoryAgentSettingsRepository, InMemoryCalibrationStore, InMemoryRecommendationRepository, OpenRouterClient } from '@profitpilot/ai'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { PlanTier } from '@profitpilot/types'
import { Logger } from '@profitpilot/logger'
import { storeId } from '@profitpilot/types'
import { createApi } from './app.js'
import type { AiRouteDependencies } from './ai-routes.js'

const snapshot: StoreSnapshot = {
  storeId: storeId('s'), currency: 'USD', timezone: 'UTC', asOf: '2026-08-17T00:00:00.000Z', dataFreshAt: '2026-08-17',
  products: [{ productId: 'p', title: 'Product', inventoryUnits: 2, averageDailyUnits: 1, unitPrice: 50, unitCost: 10, unitsSold120d: 10, daysSinceLastSale: 1 }],
  customers: [], checkouts: [], orders: [], productPairs: [],
  last30dRevenue: 1300, previous30dRevenue: 1000, last30dOrders: 12, previous30dOrders: 10,
}

type Harness = Readonly<{ base: string; deps: AiRouteDependencies & { calibration: CalibrationLedger }; setPlan: (plan: PlanTier) => void }>

async function withServer<T>(handler: (harness: Harness) => Promise<T>, initialPlan: PlanTier = 'trial'): Promise<T> {
  let plan: PlanTier = initialPlan
  const recommendations = new InMemoryRecommendationRepository()
  const calibration = new CalibrationLedger(new InMemoryCalibrationStore())
  const engine = new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), calibration, recommendations, {}, () => Date.parse('2026-08-17T12:00:00Z'))
  const deps = {
    engine,
    recommendations,
    costs: new CostMeter(),
    snapshot: async () => snapshot,
    plan: async () => plan,
    settings: new InMemoryAgentSettingsRepository(),
    calibration,
  }
  const app = createApi({ logger: new Logger(), readinessChecks: [], ai: deps })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try {
    return await handler({ base: `http://127.0.0.1:${address.port}`, deps, setPlan: (next) => { plan = next } })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function getOverview(base: string): Promise<{ plan: string; unlockedCount: number; totalCount: number; agents: readonly { id: string; locked: boolean; requiredPlan: string; execution: string; paused: boolean }[] }> {
  const response = await fetch(`${base}/ai/agents?storeId=s`)
  expect(response.status).toBe(200)
  return (await response.json()).data
}

describe('PR45 plan-aware agent overview', () => {
  it('trial sees exactly 2 unlocked and 5 locked agents', async () => await withServer(async ({ base }) => {
    const overview = await getOverview(base)
    expect(overview.plan).toBe('trial')
    expect(overview.agents.filter((agent) => !agent.locked).map((agent) => agent.id)).toEqual(['REVENUE_AGENT', 'INVENTORY_AGENT'])
    expect(overview.agents.filter((agent) => agent.locked)).toHaveLength(5)
    expect(overview.unlockedCount).toBe(2)
    expect(overview.totalCount).toBe(7)
  }))
  it('start sees exactly 3 unlocked and 4 locked agents', async () => await withServer(async ({ base }) => {
    const overview = await getOverview(base)
    expect(overview.agents.filter((agent) => !agent.locked)).toHaveLength(3)
    expect(overview.agents.filter((agent) => agent.locked)).toHaveLength(4)
  }, 'start'))
  it('growth sees exactly 5 unlocked and 2 locked agents', async () => await withServer(async ({ base }) => {
    const overview = await getOverview(base)
    expect(overview.agents.filter((agent) => !agent.locked)).toHaveLength(5)
    expect(overview.agents.filter((agent) => agent.locked).map((agent) => agent.id).sort()).toEqual(['EXECUTIVE_AGENT', 'PRODUCT_AGENT'])
  }, 'growth'))
  it('commander sees all 7 unlocked', async () => await withServer(async ({ base }) => {
    const overview = await getOverview(base)
    expect(overview.agents.every((agent) => !agent.locked)).toBe(true)
    expect(overview.unlockedCount).toBe(7)
  }, 'commander'))
  it('locked agents carry the exact plan required to unlock them', async () => await withServer(async ({ base }) => {
    const overview = await getOverview(base)
    const byId = new Map(overview.agents.map((agent) => [agent.id, agent]))
    expect(byId.get('CUSTOMER_AGENT')?.requiredPlan).toBe('start')
    expect(byId.get('PRICING_AGENT')?.requiredPlan).toBe('growth')
    expect(byId.get('EXECUTIVE_AGENT')?.requiredPlan).toBe('commander')
  }))
  it('upgrading the plan immediately unlocks agents; downgrading immediately locks them', async () => await withServer(async ({ base, setPlan }) => {
    expect((await getOverview(base)).agents.filter((agent) => !agent.locked)).toHaveLength(2)
    setPlan('commander')
    expect((await getOverview(base)).agents.filter((agent) => !agent.locked)).toHaveLength(7)
    setPlan('start')
    expect((await getOverview(base)).agents.filter((agent) => !agent.locked)).toHaveLength(3)
  }))
  it('keeps the legacy tenant-less status contract', async () => await withServer(async ({ base }) => {
    const response = await fetch(`${base}/ai/agents`)
    expect(response.status).toBe(200)
    const data = (await response.json()).data
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(7)
  }))
})

describe('PR45 agent run gating', () => {
  it('runs an unlocked agent and persists its recommendations', async () => await withServer(async ({ base }) => {
    const response = await fetch(`${base}/ai/agents/REVENUE_AGENT/run?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(200)
    const data = (await response.json()).data
    expect(data.recommendations.length).toBeGreaterThan(0)
    expect(data.recommendations.every((item: { agent: string }) => item.agent === 'REVENUE_AGENT')).toBe(true)
  }))
  it('rejects a locked agent with 403 UPGRADE_REQUIRED and the required plan', async () => await withServer(async ({ base }) => {
    const response = await fetch(`${base}/ai/agents/EXECUTIVE_AGENT/run?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(403)
    const payload = await response.json()
    expect(payload.error.details).toMatchObject({ reason: 'UPGRADE_REQUIRED', requiredPlan: 'commander' })
  }))
  it('rejects unknown agent ids with 400', async () => await withServer(async ({ base }) => {
    expect((await fetch(`${base}/ai/agents/NOT_AN_AGENT/run?storeId=s`, { method: 'POST', body: '{}' })).status).toBe(400)
  }))
  it('refuses to run a paused agent with 409', async () => await withServer(async ({ base }) => {
    await fetch(`${base}/ai/agents/REVENUE_AGENT?storeId=s`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) })
    const response = await fetch(`${base}/ai/agents/REVENUE_AGENT/run?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(409)
  }))
})

describe('PR45 pause and resume', () => {
  it('persists pause state and reflects it in the overview', async () => await withServer(async ({ base }) => {
    const patch = await fetch(`${base}/ai/agents/INVENTORY_AGENT?storeId=s`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) })
    expect(patch.status).toBe(200)
    const overview = await getOverview(base)
    const inventory = overview.agents.find((agent) => agent.id === 'INVENTORY_AGENT')
    expect(inventory?.paused).toBe(true)
    expect(inventory?.execution).toBe('PAUSED')
  }))
  it('cannot pause a locked agent', async () => await withServer(async ({ base }) => {
    expect((await fetch(`${base}/ai/agents/EXECUTIVE_AGENT?storeId=s`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) })).status).toBe(403)
  }))
  it('validates the paused body', async () => await withServer(async ({ base }) => {
    expect((await fetch(`${base}/ai/agents/REVENUE_AGENT?storeId=s`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(400)
  }))
})

describe('PR45 supporting endpoints', () => {
  it('serves the rule catalog with real thresholds', async () => await withServer(async ({ base }) => {
    const response = await fetch(`${base}/ai/rules`)
    const data = (await response.json()).data
    expect(data).toHaveLength(11)
    expect(data[0]).toHaveProperty('threshold')
  }))
  it('serves the deterministic store health score', async () => await withServer(async ({ base }) => {
    const response = await fetch(`${base}/ai/health?storeId=s`)
    const data = (await response.json()).data
    expect(typeof data.score).toBe('number')
    expect(Array.isArray(data.components)).toBe(true)
  }))
  it('serves the per-agent cost breakdown', async () => await withServer(async ({ base }) => {
    const response = await fetch(`${base}/ai/cost/breakdown?storeId=s`)
    expect(response.status).toBe(200)
    expect(Array.isArray((await response.json()).data)).toBe(true)
  }))
  it('serves agent-filtered activity', async () => await withServer(async ({ base }) => {
    await fetch(`${base}/ai/agents/REVENUE_AGENT/run?storeId=s`, { method: 'POST', body: '{}' })
    const response = await fetch(`${base}/ai/agents/REVENUE_AGENT/activity?storeId=s`)
    const data = (await response.json()).data
    expect(data.length).toBeGreaterThan(0)
    expect(data.every((item: { agent: string }) => item.agent === 'REVENUE_AGENT')).toBe(true)
  }))
  it('analyze runs only plan-unlocked agents', async () => await withServer(async ({ base }) => {
    const response = await fetch(`${base}/recommendations/analyze?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const data = (await response.json()).data
    expect(data.recommendations.length).toBeGreaterThan(0)
    expect(data.recommendations.every((item: { agent: string }) => item.agent === 'REVENUE_AGENT' || item.agent === 'INVENTORY_AGENT')).toBe(true)
  }))
})

describe('PR45 run-all SSE stream', () => {
  it('streams start, progress, and done events and skips locked agents', async () => await withServer(async ({ base }) => {
    const response = await fetch(`${base}/ai/run-all?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('event: start')
    expect(text).toContain('event: progress')
    expect(text).toContain('event: done')
    expect(text).toContain('"reason":"LOCKED"')
    const startFrame = text.split('\n\n').find((frame) => frame.includes('event: start')) ?? ''
    expect(startFrame).toContain('REVENUE_AGENT')
    expect(startFrame).not.toMatch(/"runnable":\[[^\]]*EXECUTIVE_AGENT/)
  }))
  it('marks paused agents as skipped', async () => await withServer(async ({ base }) => {
    await fetch(`${base}/ai/agents/INVENTORY_AGENT?storeId=s`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }) })
    const text = await (await fetch(`${base}/ai/run-all?storeId=s`, { method: 'POST', body: '{}' })).text()
    expect(text).toContain('"agent":"INVENTORY_AGENT","reason":"PAUSED"')
  }))
})

describe('PR45 calibration feedback on decisions', () => {
  it('records approve/reject outcomes into the calibration ledger', async () => await withServer(async ({ base, deps }) => {
    await fetch(`${base}/ai/agents/REVENUE_AGENT/run?storeId=s`, { method: 'POST', body: '{}' })
    const list = (await (await fetch(`${base}/recommendations?storeId=s`)).json()).data as readonly { id: string; version: number }[]
    const target = list[0]
    if (!target) throw new Error('expected a recommendation')
    const approve = await fetch(`${base}/recommendations/${target.id}/approve?storeId=s`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: target.version }) })
    expect(approve.status).toBe(200)
    expect(deps.calibration.get('REVENUE_AGENT').accepted).toBe(1)
  }))
})
