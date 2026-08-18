import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { ActionExecutor, CalibrationLedger, CostMeter, DecisionEngine, InMemoryExecutionLedger, InMemoryRecommendationRepository, OpenRouterClient, buildEvidencePack } from '@profitpilot/ai'
import type { AgentId, Recommendation, StoreSnapshot } from '@profitpilot/ai'
import { Logger } from '@profitpilot/logger'
import { storeId } from '@profitpilot/types'
import type { PlanTier, Role, StoreId } from '@profitpilot/types'
import { createApi } from './app.js'
import type { AiRouteDependencies } from './ai-routes.js'

const snapshot: StoreSnapshot = {
  storeId: storeId('s'), currency: 'EUR', timezone: 'UTC', asOf: '2026-08-01T00:00:00.000Z', dataFreshAt: '2026-08-01T00:00:00.000Z',
  products: [{ productId: 'p', title: 'Hoodie', inventoryUnits: 1, averageDailyUnits: 1, unitPrice: 50, unitCost: 10, unitsSold120d: 10, daysSinceLastSale: 1 }],
  customers: [{ customerKey: 'c1', lifetimeValue: 400, orderCount: 3, daysSinceLastOrder: 90, firstOrderDay: '2026-01-01' }],
  checkouts: [], orders: [], productPairs: [], last30dRevenue: 100, previous30dRevenue: 80, last30dOrders: 12, previous30dOrders: 10,
}

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return { id: 'r1', storeId: storeId('s'), agent: 'REVENUE_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Opportunity', reason: 'Evidence', impactValue: 100, impactLabel: 'impact', currency: 'USD', confidence: .75, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { sha256: 'hash' }, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: '2026-08-01T00:00:00.000Z', entityKey: 'p1', expiresAt: null, decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null, ...overrides }
}

type Harness = Readonly<{
  base: string
  repository: InMemoryRecommendationRepository
  usage: { used: number; added: number[] }
  calibration: Array<Readonly<{ agent: AgentId; outcome: string }>>
  audits: string[]
}>

async function withServer<T>(configure: (dependencies: { plan?: PlanTier; role?: Role; limit?: number | null; seed?: readonly Recommendation[]; used?: number }) => void | Readonly<{ plan?: PlanTier; role?: Role; limit?: number | null; seed?: readonly Recommendation[]; used?: number }>, handler: (harness: Harness) => Promise<T>): Promise<T> {
  const options = configure({}) ?? {}
  const repository = new InMemoryRecommendationRepository()
  for (const seed of options.seed ?? [recommendation()]) await repository.put(seed)
  const usage = { used: options.used ?? 0, added: [] as number[] }
  const calibration: Array<Readonly<{ agent: AgentId; outcome: string }>> = []
  const audits: string[] = []
  const engine = new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), new CalibrationLedger(), repository)
  const ai: AiRouteDependencies = {
    engine,
    recommendations: repository,
    costs: new CostMeter(),
    snapshot: async () => snapshot,
    plan: async () => options.plan ?? 'growth',
    limit: () => (options.limit === undefined ? null : options.limit),
    usage: { current: async () => usage.used, add: async (_store: StoreId, count: number) => { usage.used += count; usage.added.push(count) } },
    calibration: { record: async (_store, agent, _id, outcome) => { calibration.push({ agent, outcome }) } },
    audit: { record: async (entry) => { audits.push(entry.action) } },
    role: async () => options.role ?? 'owner',
    executor: new ActionExecutor({ CREATE_RECOMMENDATION: async () => ({ recorded: true }), SEND_EMAIL: async () => ({ draftCampaignTemplateId: 'tpl-1', requiresReview: true }) }, new InMemoryExecutionLedger()),
  }
  const app = createApi({ logger: new Logger(), readinessChecks: [], ai })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try { return await handler({ base: `http://127.0.0.1:${address.port}`, repository, usage, calibration, audits }) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

const json = { 'content-type': 'application/json' }

describe('PR46 analyze endpoint', () => {
  it('is configured and generates recommendations (no more 503)', async () => await withServer(() => ({ seed: [] }), async ({ base, usage }) => {
    const response = await fetch(`${base}/recommendations/analyze`, { method: 'POST', headers: json, body: JSON.stringify({ storeId: 's' }) })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.recommendations.length).toBeGreaterThan(0)
    expect(usage.added[0]).toBe(payload.data.recommendations.length)
  }))
  it('reports what the engine read — snapshot stats, rules checked, and health', async () => await withServer(() => ({ seed: [] }), async ({ base }) => {
    const response = await fetch(`${base}/recommendations/analyze`, { method: 'POST', headers: json, body: JSON.stringify({ storeId: 's' }) })
    expect(response.status).toBe(200)
    const payload = await response.json()
    // The health-check panel renders these facts verbatim — the workspace
    // never invents analysis context.
    expect(payload.data.snapshotStats).toEqual({ products: 1, customers: 1, checkouts: 0, orders: 0, dataFreshAt: '2026-08-01T00:00:00.000Z', currency: 'EUR' })
    expect(payload.data.rulesChecked).toBe(8)
    expect(payload.data.health.score).not.toBeNull()
  }))
  it('blocks generation with an upgrade error at the plan limit', async () => await withServer(() => ({ plan: 'trial', limit: 10, used: 10, seed: [] }), async ({ base }) => {
    const response = await fetch(`${base}/recommendations/analyze`, { method: 'POST', headers: json, body: JSON.stringify({ storeId: 's' }) })
    expect(response.status).toBe(403)
    const payload = await response.json()
    expect(payload.error.details.reason).toBe('UPGRADE_REQUIRED')
    expect(payload.error.details.limit).toBe(10)
  }))
  it('trims generation to the remaining quota', async () => await withServer(() => ({ plan: 'trial', limit: 10, used: 9, seed: [] }), async ({ base }) => {
    const response = await fetch(`${base}/recommendations/analyze`, { method: 'POST', headers: json, body: JSON.stringify({ storeId: 's' }) })
    expect(response.status).toBe(200)
    expect((await response.json()).data.recommendations).toHaveLength(1)
  }))
})

describe('PR46 list endpoint filters', () => {
  const seed = [
    recommendation({ id: 'a', impactValue: 10, agent: 'REVENUE_AGENT', ruleId: 'CHURN_RISK', createdAt: '2026-08-01T00:00:00.000Z' }),
    recommendation({ id: 'b', impactValue: 300, agent: 'INVENTORY_AGENT', createdAt: '2026-08-02T00:00:00.000Z' }),
    recommendation({ id: 'c', impactValue: 200, status: 'APPROVED', createdAt: '2026-08-03T00:00:00.000Z' }),
  ]
  it('filters by status and sorts by impact', async () => await withServer(() => ({ seed }), async ({ base }) => {
    const payload = (await (await fetch(`${base}/recommendations?storeId=s&status=PENDING&sort=impact&direction=desc`)).json()).data
    expect(payload.items.map((item: Recommendation) => item.id)).toEqual(['b', 'a'])
  }))
  it('filters by agent, impact range, and date range', async () => await withServer(() => ({ seed }), async ({ base }) => {
    const byAgent = (await (await fetch(`${base}/recommendations?storeId=s&agent=INVENTORY_AGENT`)).json()).data
    expect(byAgent.items.map((item: Recommendation) => item.id)).toEqual(['b'])
    const byImpact = (await (await fetch(`${base}/recommendations?storeId=s&minImpact=150&maxImpact=250`)).json()).data
    expect(byImpact.items.map((item: Recommendation) => item.id)).toEqual(['c'])
    const byDate = (await (await fetch(`${base}/recommendations?storeId=s&dateFrom=2026-08-02T00:00:00.000Z&dateTo=2026-08-02T23:59:59.000Z`)).json()).data
    expect(byDate.items.map((item: Recommendation) => item.id)).toEqual(['b'])
  }))
  it('paginates with cursor and reports hasMore', async () => await withServer(() => ({ seed }), async ({ base }) => {
    const first = (await (await fetch(`${base}/recommendations?storeId=s&limit=2&sort=impact&direction=desc`)).json()).data
    expect(first.items).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    const second = (await (await fetch(`${base}/recommendations?storeId=s&limit=2&cursor=2&sort=impact&direction=desc`)).json()).data
    expect(second.items).toHaveLength(1)
    expect(second.hasMore).toBe(false)
  }))
  it('rejects invalid filters honestly', async () => await withServer(() => undefined, async ({ base }) => {
    expect((await fetch(`${base}/recommendations?storeId=s&status=BOGUS`)).status).toBe(400)
    expect((await fetch(`${base}/recommendations?storeId=s&agent=NOT_AN_AGENT`)).status).toBe(400)
    expect((await fetch(`${base}/recommendations?storeId=s&sort=upside-down`)).status).toBe(400)
    expect((await fetch(`${base}/recommendations?storeId=s&minImpact=abc`)).status).toBe(400)
  }))
})

describe('PR46 single recommendation and summary', () => {
  it('fetches one recommendation by id for deep links', async () => await withServer(() => undefined, async ({ base }) => {
    const payload = (await (await fetch(`${base}/recommendations/r1?storeId=s`)).json()).data
    expect(payload.id).toBe('r1')
    expect((await fetch(`${base}/recommendations/missing?storeId=s`)).status).toBe(404)
  }))
  it('returns summary with plan usage attached', async () => await withServer(() => ({ plan: 'trial', limit: 10, used: 4 }), async ({ base }) => {
    const payload = (await (await fetch(`${base}/recommendations/summary?storeId=s`)).json()).data
    expect(payload.counts.PENDING).toBe(1)
    expect(payload.plan).toBe('trial')
    expect(payload.usage).toMatchObject({ used: 4, limit: 10, remaining: 6 })
  }))
  it('expires stale pending recommendations on read', async () => await withServer(() => ({ seed: [recommendation({ id: 'stale', expiresAt: '2026-08-02T00:00:00.000Z' })] }), async ({ base }) => {
    const payload = (await (await fetch(`${base}/recommendations?storeId=s&status=EXPIRED`)).json()).data
    expect(payload.items.map((item: Recommendation) => item.id)).toEqual(['stale'])
  }))
})

describe('PR46 decisions with reasons, calibration, and audit', () => {
  it('records a reject reason and feeds calibration', async () => await withServer(() => undefined, async ({ base, calibration, audits }) => {
    const response = await fetch(`${base}/recommendations/r1/reject?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0, reason: 'BAD_TIMING' }) })
    expect(response.status).toBe(200)
    const payload = (await response.json()).data
    expect(payload.rejectReason).toBe('BAD_TIMING')
    expect(payload.decidedAt).not.toBeNull()
    expect(calibration).toEqual([{ agent: 'REVENUE_AGENT', outcome: 'rejected' }])
    expect(audits).toContain('recommendations.reject')
  }))
  it('rejects an invalid reason', async () => await withServer(() => undefined, async ({ base }) => {
    expect((await fetch(`${base}/recommendations/r1/reject?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0, reason: 'BECAUSE' }) })).status).toBe(400)
  }))
  it('approve feeds calibration with accepted', async () => await withServer(() => undefined, async ({ base, calibration }) => {
    await fetch(`${base}/recommendations/r1/approve?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0 }) })
    expect(calibration).toEqual([{ agent: 'REVENUE_AGENT', outcome: 'accepted' }])
  }))
})

describe('PR46 undo', () => {
  it('reverts a fresh decision to PENDING and compensates calibration', async () => await withServer(() => undefined, async ({ base, calibration }) => {
    await fetch(`${base}/recommendations/r1/approve?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0 }) })
    const response = await fetch(`${base}/recommendations/r1/undo?storeId=s`, { method: 'POST', headers: json, body: '{}' })
    expect(response.status).toBe(200)
    expect((await response.json()).data.status).toBe('PENDING')
    expect(calibration).toEqual([{ agent: 'REVENUE_AGENT', outcome: 'accepted' }, { agent: 'REVENUE_AGENT', outcome: 'rejected' }])
  }))
  it('409s when nothing is undoable', async () => await withServer(() => undefined, async ({ base }) => {
    expect((await fetch(`${base}/recommendations/r1/undo?storeId=s`, { method: 'POST', headers: json, body: '{}' })).status).toBe(409)
  }))
})

describe('PR46 bulk decide', () => {
  const seed = [recommendation({ id: 'a' }), recommendation({ id: 'b' }), recommendation({ id: 'c', status: 'APPROVED' })]
  it('returns per-item results with mixed outcomes', async () => await withServer(() => ({ seed }), async ({ base }) => {
    const response = await fetch(`${base}/recommendations/bulk-decide?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ storeId: 's', decisions: [
      { id: 'a', expectedVersion: 0, decision: 'approve' },
      { id: 'b', expectedVersion: 5, decision: 'reject' },
      { id: 'c', expectedVersion: 0, decision: 'approve' },
    ] }) })
    expect(response.status).toBe(200)
    const results = (await response.json()).data.results
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    expect(results[1].error.status).toBe(409)
    expect(results[2].ok).toBe(false)
  }))
  it('validates the decisions array', async () => await withServer(() => undefined, async ({ base }) => {
    expect((await fetch(`${base}/recommendations/bulk-decide?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ storeId: 's', decisions: [] }) })).status).toBe(400)
    expect((await fetch(`${base}/recommendations/bulk-decide?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ storeId: 's' }) })).status).toBe(400)
  }))
})

describe('PR46 evidence verification', () => {
  it('verifies a genuine evidence pack end to end', async () => {
    const pack = buildEvidencePack({ id: 'pack-1', storeId: storeId('s'), ruleId: 'STOCKOUT_RISK', ruleVersion: '1.0.0', fields: [{ key: 'days_of_cover', label: 'Days of cover', value: 3.2, source: 'products.inventory_units' }], generatedAt: '2026-08-01T00:00:00.000Z' })
    await withServer(() => ({ seed: [recommendation({ evidencePack: pack as unknown as Recommendation['evidencePack'] })] }), async ({ base }) => {
      const payload = (await (await fetch(`${base}/recommendations/r1/evidence/verify?storeId=s`)).json()).data
      expect(payload.verified).toBe(true)
      expect(payload.sha256).toBe(pack.sha256)
    })
  })
  it('reports unverifiable legacy packs without failing', async () => await withServer(() => undefined, async ({ base }) => {
    const payload = (await (await fetch(`${base}/recommendations/r1/evidence/verify?storeId=s`)).json()).data
    expect(payload.verified).toBe(false)
    expect(payload.sha256).toBe('hash')
  }))
})

describe('PR46 snooze', () => {
  it('snoozes server-side with a bounded window', async () => await withServer(() => undefined, async ({ base }) => {
    const response = await fetch(`${base}/recommendations/r1/snooze?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ hours: 24 }) })
    expect(response.status).toBe(200)
    expect((await response.json()).data.snoozedUntil).not.toBeNull()
  }))
})

describe('PR46 execution bridge', () => {
  it('executes an approved recommendation and marks it EXECUTED', async () => await withServer(() => undefined, async ({ base, audits }) => {
    await fetch(`${base}/recommendations/r1/approve?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0 }) })
    const response = await fetch(`${base}/recommendations/r1/execute?storeId=s`, { method: 'POST', headers: json, body: '{}' })
    expect(response.status).toBe(200)
    const payload = (await response.json()).data
    expect(payload.recommendation.status).toBe('EXECUTED')
    expect(payload.execution.status).toBe('EXECUTED')
    expect(audits).toContain('recommendations.execute')
  }))
  it('creates a reviewable draft for SEND_EMAIL executions', async () => {
    const emailRec = recommendation({ id: 'mail', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED' })
    await withServer(() => ({ seed: [emailRec] }), async ({ base }) => {
      await fetch(`${base}/recommendations/mail/approve?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0 }) })
      const response = await fetch(`${base}/recommendations/mail/execute?storeId=s`, { method: 'POST', headers: json, body: '{}' })
      expect(response.status).toBe(200)
      const payload = (await response.json()).data
      expect(payload.execution.output.requiresReview).toBe(true)
      expect(payload.execution.output.draftCampaignTemplateId).toBe('tpl-1')
    })
  })
  it('refuses to execute a pending recommendation', async () => await withServer(() => undefined, async ({ base }) => {
    expect((await fetch(`${base}/recommendations/r1/execute?storeId=s`, { method: 'POST', headers: json, body: '{}' })).status).toBe(409)
  }))
  it('blocks non-admins from executing high-risk actions', async () => {
    const emailRec = recommendation({ id: 'mail', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED', status: 'APPROVED' })
    await withServer(() => ({ role: 'operator', seed: [emailRec] }), async ({ base }) => {
      expect((await fetch(`${base}/recommendations/mail/execute?storeId=s`, { method: 'POST', headers: json, body: '{}' })).status).toBe(403)
    })
  })
})

describe('PR46 RBAC', () => {
  it('blocks viewers from deciding', async () => await withServer(() => ({ role: 'viewer' }), async ({ base }) => {
    const response = await fetch(`${base}/recommendations/r1/approve?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0 }) })
    expect(response.status).toBe(403)
  }))
  it('blocks operators from approving high-risk actions but allows safe ones', async () => {
    const highRisk = recommendation({ id: 'risky', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED' })
    await withServer(() => ({ role: 'operator', seed: [recommendation(), highRisk] }), async ({ base }) => {
      const safe = await fetch(`${base}/recommendations/r1/approve?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0 }) })
      expect(safe.status).toBe(200)
      const risky = await fetch(`${base}/recommendations/risky/approve?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0 }) })
      expect(risky.status).toBe(403)
    })
  })
  it('allows admins to approve high-risk actions', async () => {
    const highRisk = recommendation({ id: 'risky', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED' })
    await withServer(() => ({ role: 'admin', seed: [highRisk] }), async ({ base }) => {
      expect((await fetch(`${base}/recommendations/risky/approve?storeId=s`, { method: 'POST', headers: json, body: JSON.stringify({ expectedVersion: 0 }) })).status).toBe(200)
    })
  })
})
