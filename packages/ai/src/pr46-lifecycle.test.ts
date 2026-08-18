import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import type { QueryResultRow } from '@profitpilot/db'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { RULE_IDS, deriveExpiry } from './domain.js'
import type { Recommendation } from './domain.js'
import { CalibrationLedger, PostgresCalibrationStore } from './calibration.js'
import { InMemoryRecommendationRepository, UNDO_WINDOW_MS, buildSummary } from './repository.js'
import { ACTION_TYPE_LABELS, AGENT_LABELS, EXPLANATION_STATUS_LABELS, REJECT_REASON_LABELS, RISK_LABELS, RULE_LABELS, STATUS_LABELS, agentLabel, titleCaseEnum } from './labels.js'
import { CalibrationLedger as Ledger } from './calibration.js'
import { CostMeter } from './cost.js'
import { DecisionEngine } from './engine.js'
import { OpenRouterClient } from './provider.js'
import type { StoreSnapshot } from './domain.js'

const base: Recommendation = { id: 'r1', storeId: storeId('s'), agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Reorder Hoodie', reason: 'Low cover', impactValue: 100, impactLabel: 'revenue at risk', currency: 'USD', confidence: .75, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { sha256: 'hash' }, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: '2026-08-01T00:00:00.000Z', entityKey: 'p1', expiresAt: null, decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null }

describe('PR46 time-sensitivity derivation', () => {
  const at = '2026-08-01T00:00:00.000Z'
  it('gives cart abandonment the remaining 48h window', () => {
    const expiry = deriveExpiry('CART_ABANDONMENT', [{ key: 'age_hours', value: 20 }], at)
    expect(expiry).toBe('2026-08-02T04:00:00.000Z') // 28h remaining
  })
  it('never returns a non-positive cart window', () => {
    const expiry = deriveExpiry('CART_ABANDONMENT', [{ key: 'age_hours', value: 60 }], at)
    expect(Date.parse(expiry ?? '')).toBeGreaterThan(Date.parse(at))
  })
  it('projects stockout expiry from days of cover', () => {
    expect(deriveExpiry('STOCKOUT_RISK', [{ key: 'days_of_cover', value: 2 }], at)).toBe('2026-08-03T00:00:00.000Z')
  })
  it('gives welcome a 7-day window and evergreen rules null', () => {
    expect(deriveExpiry('NEW_CUSTOMER_WELCOME', [], at)).toBe('2026-08-08T00:00:00.000Z')
    expect(deriveExpiry('DEAD_STOCK', [], at)).toBeNull()
    expect(deriveExpiry('PRICING_UPLIFT', [], at)).toBeNull()
  })
})

describe('PR46 calibration feedback loop', () => {
  it('keeps the cold-start cap at .75 below 10 samples', () => {
    const ledger = new CalibrationLedger()
    for (let index = 0; index < 9; index += 1) ledger.record('REVENUE_AGENT', 'accepted')
    expect(ledger.get('REVENUE_AGENT').confidenceCap).toBe(.75)
  })
  it('allows HIGH confidence after 10 accepted decisions', () => {
    const ledger = new CalibrationLedger()
    for (let index = 0; index < 10; index += 1) ledger.record('REVENUE_AGENT', 'accepted')
    expect(ledger.get('REVENUE_AGENT').confidenceCap).toBe(1)
    expect(ledger.calibrate('REVENUE_AGENT', .92).level).toBe('HIGH')
  })
  it('caps a frequently rejected agent at its acceptance rate', () => {
    const ledger = new CalibrationLedger()
    for (let index = 0; index < 6; index += 1) ledger.record('PRICING_AGENT', 'rejected')
    for (let index = 0; index < 4; index += 1) ledger.record('PRICING_AGENT', 'accepted')
    expect(ledger.get('PRICING_AGENT').confidenceCap).toBeCloseTo(.4)
  })
  it('hydrates from persisted samples so caps survive deploys', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [{ agent: 'REVENUE_AGENT', outcome: 'accepted', total: '10' } as unknown as Row], rowCount: 1 } } }
    const ledger = new CalibrationLedger()
    await new PostgresCalibrationStore(executor).hydrate(ledger)
    expect(ledger.get('REVENUE_AGENT').confidenceCap).toBe(1)
  })
  it('appends samples with the recommendation id', async () => {
    const captured: unknown[][] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(_text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> { captured.push([...values]); return { rows: [], rowCount: 1 } } }
    await new PostgresCalibrationStore(executor).append('s', 'REVENUE_AGENT', 'r1', 'accepted')
    expect(captured[0]).toEqual(['s', 'REVENUE_AGENT', 'r1', 'accepted'])
  })
})

describe('PR46 humanization labels', () => {
  it('covers every agent, rule, action, risk, status, and reject reason', () => {
    expect(Object.keys(AGENT_LABELS)).toHaveLength(7)
    expect(Object.keys(RULE_LABELS)).toHaveLength(RULE_IDS.length)
    expect(Object.keys(ACTION_TYPE_LABELS)).toHaveLength(5)
    expect(Object.keys(RISK_LABELS)).toHaveLength(3)
    expect(Object.keys(STATUS_LABELS)).toHaveLength(6)
    expect(Object.keys(REJECT_REASON_LABELS)).toHaveLength(5)
  })
  it('never leaks raw enum shapes', () => {
    for (const label of [...Object.values(AGENT_LABELS), ...Object.values(RULE_LABELS), ...Object.values(ACTION_TYPE_LABELS), ...Object.values(RISK_LABELS), ...Object.values(STATUS_LABELS)]) {
      expect(label).not.toMatch(/[A-Z]{2,}_[A-Z]/)
    }
  })
  it('maps AI_GENERATED to no badge', () => expect(EXPLANATION_STATUS_LABELS.AI_GENERATED).toBeNull())
  it('falls back to readable title case for unknown enums', () => {
    expect(agentLabel('FUTURE_AGENT')).toBe('Future agent')
    expect(titleCaseEnum('SOME_NEW_STATUS')).toBe('Some new status')
  })
})

describe('PR46 repository lifecycle', () => {
  it('records decided_at, decided_by, and reject reason', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(base)
    const decided = await repository.decide(storeId('s'), 'r1', 0, 'REJECTED', { decidedBy: 'user-1', rejectReason: 'BAD_TIMING' })
    expect(decided.decidedAt).not.toBeNull()
    expect(decided.decidedBy).toBe('user-1')
    expect(decided.rejectReason).toBe('BAD_TIMING')
  })
  it('undoes a decision inside the 30s window and blocks it after', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(base)
    const decided = await repository.decide(storeId('s'), 'r1', 0, 'APPROVED')
    const decidedAtMs = Date.parse(decided.decidedAt ?? '')
    const reverted = await repository.undo(storeId('s'), 'r1', decidedAtMs + 5_000)
    expect(reverted.status).toBe('PENDING')
    expect(reverted.decidedAt).toBeNull()
    await repository.decide(storeId('s'), 'r1', reverted.version, 'APPROVED')
    const again = await repository.get(storeId('s'), 'r1')
    await expect(repository.undo(storeId('s'), 'r1', Date.parse(again?.decidedAt ?? '') + UNDO_WINDOW_MS + 1)).rejects.toThrow('undo window')
  })
  it('expires stale pending recommendations', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put({ ...base, id: 'stale', expiresAt: '2026-08-02T00:00:00.000Z' })
    await repository.put({ ...base, id: 'fresh', expiresAt: '2026-08-20T00:00:00.000Z' })
    const expired = await repository.expireStale(storeId('s'), Date.parse('2026-08-03T00:00:00.000Z'))
    expect(expired).toBe(1)
    expect((await repository.get(storeId('s'), 'stale'))?.status).toBe('EXPIRED')
    expect((await repository.get(storeId('s'), 'fresh'))?.status).toBe('PENDING')
  })
  it('filters, sorts, and paginates', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put({ ...base, id: 'a', impactValue: 10, agent: 'REVENUE_AGENT', ruleId: 'CHURN_RISK' })
    await repository.put({ ...base, id: 'b', impactValue: 300 })
    await repository.put({ ...base, id: 'c', impactValue: 200, status: 'APPROVED' })
    const pending = await repository.page(storeId('s'), { status: 'PENDING', sort: 'impact', direction: 'desc' })
    expect(pending.items.map((item) => item.id)).toEqual(['b', 'a'])
    const paged = await repository.page(storeId('s'), { sort: 'impact', direction: 'desc', limit: 2 })
    expect(paged.items).toHaveLength(2)
    expect(paged.hasMore).toBe(true)
    const next = await repository.page(storeId('s'), { sort: 'impact', direction: 'desc', limit: 2, cursor: 2 })
    expect(next.items).toHaveLength(1)
    expect(next.hasMore).toBe(false)
    const byAgent = await repository.page(storeId('s'), { agent: 'REVENUE_AGENT' })
    expect(byAgent.items.map((item) => item.id)).toEqual(['a'])
    const byImpact = await repository.page(storeId('s'), { minImpact: 150 })
    expect(byImpact.items.map((item) => item.id).sort()).toEqual(['b', 'c'])
  })
  it('caps the page size at 50', async () => {
    const repository = new InMemoryRecommendationRepository()
    const page = await repository.page(storeId('s'), { limit: 5000 })
    expect(page.limit).toBe(50)
  })
  it('snoozes only pending recommendations', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(base)
    const snoozed = await repository.snooze(storeId('s'), 'r1', '2026-08-01T01:00:00.000Z')
    expect(snoozed.snoozedUntil).toBe('2026-08-01T01:00:00.000Z')
    await repository.decide(storeId('s'), 'r1', 0, 'APPROVED')
    await expect(repository.snooze(storeId('s'), 'r1', '2026-08-01T02:00:00.000Z')).rejects.toThrow('pending')
  })
  it('decidePending decides atomically without a client version', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(base)
    const decided = await repository.decidePending(storeId('s'), 'r1', 'APPROVED', { decidedBy: 'jarvis' })
    expect(decided.status).toBe('APPROVED')
    expect(decided.decidedBy).toBe('jarvis')
    await expect(repository.decidePending(storeId('s'), 'r1', 'REJECTED')).rejects.toThrow('not pending')
  })
  it('marks execution outcomes from APPROVED only', async () => {
    const repository = new InMemoryRecommendationRepository()
    await repository.put(base)
    await expect(repository.markExecution(storeId('s'), 'r1', 'EXECUTED')).rejects.toThrow('approved')
    await repository.decide(storeId('s'), 'r1', 0, 'APPROVED')
    expect((await repository.markExecution(storeId('s'), 'r1', 'EXECUTED')).status).toBe('EXECUTED')
  })
})

describe('PR46 summary aggregation', () => {
  const now = Date.parse('2026-08-15T00:00:00.000Z')
  it('groups pending impact by currency instead of summing across currencies', () => {
    const summary = buildSummary([
      { ...base, id: 'usd', impactValue: 100, currency: 'USD' },
      { ...base, id: 'eur', impactValue: 50, currency: 'EUR' },
    ], now)
    expect(summary.pendingImpact).toEqual([{ currency: 'USD', value: 100 }, { currency: 'EUR', value: 50 }])
  })
  it('computes approval rate from decided records only', () => {
    const summary = buildSummary([
      { ...base, id: 'a', status: 'APPROVED', decidedAt: '2026-08-10T00:00:00.000Z' },
      { ...base, id: 'b', status: 'REJECTED', decidedAt: '2026-08-10T00:00:00.000Z' },
      { ...base, id: 'c', status: 'PENDING' },
    ], now)
    expect(summary.approvalRate.allTime).toBe(50)
  })
  it('averages human decision time and ignores system expiry', () => {
    const summary = buildSummary([
      { ...base, id: 'a', status: 'APPROVED', createdAt: '2026-08-10T00:00:00.000Z', decidedAt: '2026-08-10T01:00:00.000Z', decidedBy: 'user' },
      { ...base, id: 'b', status: 'EXPIRED', createdAt: '2026-08-10T00:00:00.000Z', decidedAt: '2026-08-12T00:00:00.000Z', decidedBy: 'system' },
    ], now)
    expect(summary.averageDecisionMs).toBe(3_600_000)
  })
  it('breaks counts down by agent and rule', () => {
    const summary = buildSummary([
      { ...base, id: 'a', agent: 'REVENUE_AGENT', ruleId: 'CHURN_RISK' },
      { ...base, id: 'b', agent: 'REVENUE_AGENT', status: 'APPROVED' },
      { ...base, id: 'c' },
    ], now)
    const revenue = summary.byAgent.find((entry) => entry.agent === 'REVENUE_AGENT')
    expect(revenue).toMatchObject({ pending: 1, approved: 1, total: 2 })
    expect(summary.byRule.find((entry) => entry.ruleId === 'CHURN_RISK')?.total).toBe(1)
  })
})

describe('PR46 engine lifecycle fields', () => {
  const snapshot: StoreSnapshot = {
    storeId: 's' as StoreSnapshot['storeId'], currency: 'EUR', timezone: 'UTC', asOf: '2026-08-01T00:00:00.000Z', dataFreshAt: '2026-08-01T00:00:00.000Z',
    products: [{ productId: 'p', title: 'Product', inventoryUnits: 1, averageDailyUnits: 1, unitPrice: 50, unitCost: 10, unitsSold120d: 10, daysSinceLastSale: 1 }],
    customers: [{ customerKey: 'c9', lifetimeValue: 400, orderCount: 3, daysSinceLastOrder: 90, firstOrderDay: '2026-01-01' }],
    checkouts: [], orders: [], productPairs: [], last30dRevenue: 100, previous30dRevenue: 80, last30dOrders: 5, previous30dOrders: 4,
  }
  it('carries entityKey and expiry onto recommendations', async () => {
    const engine = new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), new Ledger(), new InMemoryRecommendationRepository(), {}, () => Date.parse('2026-08-01T00:00:00.000Z'))
    const result = await engine.run(snapshot)
    const stockout = result.recommendations.find((item) => item.ruleId === 'STOCKOUT_RISK')
    expect(stockout?.entityKey).toBe('p')
    expect(stockout?.expiresAt).not.toBeNull()
    const churn = result.recommendations.find((item) => item.ruleId === 'CHURN_RISK')
    expect(churn?.entityKey).toBe('c9')
    expect(churn?.currency).toBe('EUR')
  })
  it('trims generation to the remaining plan quota, keeping highest impact', async () => {
    const engine = new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), new Ledger(), new InMemoryRecommendationRepository(), {}, () => Date.parse('2026-08-01T00:00:00.000Z'))
    const unlimited = await engine.run(snapshot)
    expect(unlimited.recommendations.length).toBeGreaterThan(1)
    const limited = await engine.run(snapshot, { maxRecommendations: 1 })
    expect(limited.recommendations).toHaveLength(1)
    expect(limited.recommendations[0]?.impactValue).toBe(Math.max(...unlimited.recommendations.map((item) => item.impactValue)))
  })
})
