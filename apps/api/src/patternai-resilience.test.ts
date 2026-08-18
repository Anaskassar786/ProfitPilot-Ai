/**
 * PatternAI (formerly Insights Hub) — crash-fix and resilience regression tests.
 *
 * The module used to answer `Internal server error` on first paint. Two causes
 * are covered here:
 *
 *  1. Storage rejected the deterministic engine ids (`disc_…`) because
 *     migration 0024 declared uuid primary keys. Migration 0025 widens them;
 *     `isSchemaNotReadyError` plus the repository fallback make sure a
 *     not-yet-migrated deployment degrades instead of 500ing.
 *  2. `overview` ran every panel through a single Promise.all, so one failing
 *     query removed the entire page. It now degrades panel by panel and
 *     reports what it dropped.
 */

import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { InMemoryAnalyticsRepository } from '@profitpilot/db'
import type { QueryResultRow, DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { Logger } from '@profitpilot/logger'
import { insightsHubEnvConfig } from '@profitpilot/ai'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { createApi } from './app.js'
import {
  InMemoryInsightsHubRepository,
  InsightsHubService,
  PostgresInsightsHubRepository,
  isSchemaNotReadyError,
} from './insights-hub.js'
import type { InsightsHubRepository } from './insights-hub.js'

const STORE = 'store-patternai' as StoreId

function snapshotFixture(): StoreSnapshot {
  return {
    storeId: STORE,
    currency: 'USD',
    timezone: 'UTC',
    asOf: '2026-08-17T00:00:00.000Z',
    dataFreshAt: '2026-08-17',
    products: [],
    customers: [],
    checkouts: [],
    orders: [],
    productPairs: [],
    last30dRevenue: 0,
    previous30dRevenue: 0,
    last30dOrders: 0,
    previous30dOrders: 0,
  }
}

function serviceWith(repository: InsightsHubRepository, plan: PlanTier = 'growth', snapshot: () => Promise<StoreSnapshot> = async () => snapshotFixture()): InsightsHubService {
  return new InsightsHubService({
    dataset: { snapshot, analytics: new InMemoryAnalyticsRepository(), orders: null },
    repository,
    plan: async () => plan,
    billingState: async () => null,
    narrator: null,
    env: insightsHubEnvConfig({ INSIGHTS_HUB_AUTO_DISCOVERY_ENABLED: 'false' }),
    logger: { warn: () => undefined },
  })
}

/** A repository whose listed sections explode the way a broken deploy does. */
function brokenRepository(sections: readonly string[]): InsightsHubRepository {
  const base = new InMemoryInsightsHubRepository()
  const fail = (section: string) => () => Promise.reject(new Error(`relation "insights_${section}" does not exist`))
  const overrides: Record<string, unknown> = {}
  if (sections.includes('personas')) overrides.listPersonas = fail('personas')
  if (sections.includes('trends')) overrides.listTrends = fail('trends')
  if (sections.includes('knowledge')) overrides.countKnowledge = fail('knowledge_base')
  return Object.assign(Object.create(Object.getPrototypeOf(base) as object) as InsightsHubRepository, base, overrides)
}

describe('PatternAI — the page always renders', () => {
  it('degrades broken sections instead of failing the whole overview', async () => {
    const overview = await serviceWith(brokenRepository(['personas', 'trends', 'knowledge'])).overview(STORE)
    expect(overview.plan).toBe('growth')
    expect(overview.counts.personas).toBe(0)
    expect(overview.counts.trends).toBe(0)
    expect(overview.counts.knowledge).toBe(0)
    expect([...overview.degraded].sort()).toEqual(['knowledge', 'personas', 'trends'])
  })

  it('reports no degradation when every section answers', async () => {
    const overview = await serviceWith(new InMemoryInsightsHubRepository()).overview(STORE)
    expect(overview.degraded).toEqual([])
  })

  it('keeps the discovery feed alive when the data plane is unreachable', async () => {
    const service = serviceWith(new InMemoryInsightsHubRepository(), 'growth', async () => { throw new Error('analytics timeout') })
    const feed = await service.discoveryFeed(STORE)
    expect(feed.discoveries).toEqual([])
    expect(feed.readiness.totalOrders).toBe(0)
    expect(feed.readiness.canDiscover).toBe(false)
  })

  it('answers a diagnostics probe naming any section that cannot load', async () => {
    const health = await serviceWith(brokenRepository(['personas'])).health(STORE)
    expect(health.ok).toBe(false)
    const personas = health.sections.find((section) => section.section === 'personas')
    expect(personas?.ok).toBe(false)
    expect(personas?.detail).toContain('insights_personas')
    expect(health.sections.find((section) => section.section === 'discoveries')?.ok).toBe(true)
    expect(health.narration).toBe(false)
  })
})

describe('PatternAI — storage that is not migrated yet', () => {
  it('classifies Postgres schema errors, not merchant errors', () => {
    expect(isSchemaNotReadyError(Object.assign(new Error('relation does not exist'), { code: '42P01' }))).toBe(true)
    expect(isSchemaNotReadyError(Object.assign(new Error('column missing'), { code: '42703' }))).toBe(true)
    expect(isSchemaNotReadyError(Object.assign(new Error('bad uuid'), { code: '22P02' }))).toBe(false)
    expect(isSchemaNotReadyError(new Error('boom'))).toBe(false)
  })

  it('returns an empty list rather than a 500 when the table is missing', async () => {
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> {
        if (text.includes('insights_discoveries')) throw Object.assign(new Error('relation "insights_discoveries" does not exist'), { code: '42P01' })
        return { rows: [], rowCount: 0 }
      },
    }
    const warnings: string[] = []
    const repository = new PostgresInsightsHubRepository(executor, { warn: (message) => warnings.push(message) })
    await expect(repository.listDiscoveries(STORE, { limit: 10, cursor: 0 })).resolves.toEqual([])
    expect(warnings[0]).toContain('PatternAI storage is not migrated yet')
  })

  it('still surfaces genuine database faults', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { throw Object.assign(new Error('connection terminated'), { code: '08006' }) } }
    const repository = new PostgresInsightsHubRepository(executor)
    await expect(repository.listPatterns(STORE, null)).rejects.toThrow('connection terminated')
  })

  it('accepts the deterministic engine id format that used to break uuid columns', async () => {
    const statements: string[] = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
        statements.push(text)
        if (text.startsWith('INSERT INTO insights_discoveries')) expect(String(values[0])).toMatch(/^disc_/)
        return { rows: [], rowCount: 0 }
      },
    }
    const repository = new PostgresInsightsHubRepository(executor)
    await repository.upsertDiscoveries(STORE, [{
      id: 'disc_1f4c9a2b7d', storeId: STORE, discoveryType: 'PATTERN', category: 'TIME', title: 'Saturday rhythm',
      description: 'Saturday carries the biggest revenue share.', explanation: '', confidenceScore: 0.8, impactEstimate: 120,
      impactCurrency: 'USD', dataEvidence: {}, visualizationData: {}, discoveredAt: '2026-08-17T00:00:00.000Z',
      status: 'NEW', sample: false, viewedAt: null, actionTakenAt: null, expiresAt: null,
    }])
    expect(statements.some((statement) => statement.startsWith('INSERT INTO insights_discoveries'))).toBe(true)
  })
})

describe('PatternAI — HTTP surface', () => {
  const withServer = async (handler: (base: string) => Promise<void>): Promise<void> => {
    const app = createApi({
      logger: new Logger(),
      readinessChecks: [],
      insightsHub: { service: serviceWith(new InMemoryInsightsHubRepository()), env: insightsHubEnvConfig({}) },
    })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No address')
    try { await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  }

  it('serves every route under the new /patternai prefix', async () => withServer(async (base) => {
    const response = await fetch(`${base}/patternai/overview?storeId=${STORE}`)
    expect(response.status).toBe(200)
    const body = await response.json() as { ok: boolean; data: { plan: string } }
    expect(body.ok).toBe(true)
    expect(body.data.plan).toBe('growth')
  }))

  it('keeps the pre-rebrand /insights prefix working', async () => withServer(async (base) => {
    const response = await fetch(`${base}/insights/overview?storeId=${STORE}`)
    expect(response.status).toBe(200)
  }))

  it('exposes the diagnostics endpoint on both prefixes', async () => withServer(async (base) => {
    for (const prefix of ['/patternai', '/insights']) {
      const response = await fetch(`${base}${prefix}/health?storeId=${STORE}`)
      expect(response.status).toBe(200)
      const body = await response.json() as { data: { ok: boolean; sections: readonly { section: string }[] } }
      expect(body.data.ok).toBe(true)
      expect(body.data.sections.length).toBe(12)
    }
  }))
})

describe('PatternAI — trend watcher views', () => {
  it('returns the store\'s own internal trends for the business view', async () => {
    // Regression: `business` and `market` are views, not TrendType values. The
    // old code filtered storage by the literal string 'business', so the Trend
    // Watcher rendered "0 signals" while the overview counted several.
    const repository = new InMemoryInsightsHubRepository()
    const detected = [
      { id: 'trnd_a', storeId: STORE, trendType: 'BUSINESS' as const, category: 'REVENUE' as const, title: 'Revenue climbing', description: '', direction: 'UP' as const, magnitude: 0.18, timePeriod: 'LAST_14_DAYS', dataSource: 'INTERNAL' as const, confidenceScore: 0.9, detectedAt: '2026-08-18T00:00:00.000Z', alertsEnabled: false },
      { id: 'trnd_b', storeId: STORE, trendType: 'DECLINING' as const, category: 'PRODUCTS' as const, title: 'Summer collection fading', description: '', direction: 'DOWN' as const, magnitude: -0.22, timePeriod: 'LAST_14_DAYS', dataSource: 'INTERNAL' as const, confidenceScore: 0.82, detectedAt: '2026-08-18T00:00:00.000Z', alertsEnabled: false },
    ]
    await repository.upsertTrends(STORE, detected)
    const service = serviceWith(repository)
    const business = await service.listTrends(STORE, 'business')
    expect(business.trends.map((trend) => trend.id)).toEqual(['trnd_a', 'trnd_b'])
    const market = await service.listTrends(STORE, 'market')
    expect(market.trends).toEqual([])
    const declining = await service.listTrends(STORE, 'DECLINING')
    expect(declining.trends.map((trend) => trend.id)).toEqual(['trnd_b'])
  })
})
