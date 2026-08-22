import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { AiGeneration } from '@profitpilot/ai'
import { AiUnavailableError } from '@profitpilot/ai'
import { Logger } from '@profitpilot/logger'
import { storeId } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { createApi } from './app.js'
import { buildInventoryDataset, filterInventory, parseInventoryFilters } from './inventory.js'
import type { InventoryDataset, InventoryRepository } from './inventory.js'
import {
  InMemoryInventoryInsightAudit,
  InMemoryInventoryInsightUsage,
  InMemoryInventorySnapshotRepository,
  InventoryFeatureLockedError,
  InventoryInsightsService,
  groundedInventoryFacts,
  normalizeHistoryDays,
  redactInventoryQuestion,
  snapshotDaySpan,
} from './inventory-insights.js'
import type { InventoryHistoryPoint, InventoryInsightsResult } from './inventory-insights.js'
import {
  aggregateProductStock,
  buildSalesHistory,
  deadStock,
  overstockAlerts,
  predictiveRestocking,
  productVelocity,
  reorderPoint,
  reorderRecommendations,
  seasonalTrends,
  stockTurnover,
  variantDaysOfCover,
} from './inventory-velocity.js'
import type { ProductSalesDay } from './inventory-velocity.js'

const TENANT = storeId('store-inventory-ai')
const NOW = Date.parse('2026-08-16T12:00:00Z')
const SYNCED = new Date('2026-08-16T06:00:00Z')

function day(offset: number): string {
  return new Date(NOW - offset * 86_400_000).toISOString().slice(0, 10)
}

function catalogRow(productId: string, title: string, variants: readonly Readonly<Record<string, unknown>>[]) {
  return { product_id: productId, payload: { id: productId, title, product_type: 'Apparel', vendor: 'Real Vendor', status: 'active', variants }, synced_at: SYNCED }
}

/** A store with 120 days of real sales history across three products. */
function salesRows(): readonly ProductSalesDay[] {
  const rows: ProductSalesDay[] = []
  for (let offset = 0; offset < 120; offset += 1) {
    // Fast mover: 3 units every day. Slow mover: 1 unit every 20 days.
    rows.push({ productId: '7001', day: day(offset), unitsSold: 3, grossRevenue: 300 })
    if (offset % 20 === 0) rows.push({ productId: '7002', day: day(offset), unitsSold: 1, grossRevenue: 40 })
  }
  return rows
}

function dataset(input: Partial<Parameters<typeof buildInventoryDataset>[0]> = {}): InventoryDataset {
  return buildInventoryDataset({
    catalog: input.catalog ?? [
      catalogRow('7001', 'Fast Mover', [{ id: '9001', sku: 'FAST', price: '100.00', inventory_item_id: '5001', inventory_management: 'shopify', inventory_quantity: 20 }]),
      catalogRow('7002', 'Slow Mover', [{ id: '9002', sku: 'SLOW', price: '40.00', inventory_item_id: '5002', inventory_management: 'shopify', inventory_quantity: 500 }]),
      catalogRow('7003', 'Frozen Item', [{ id: '9003', sku: 'DEAD', price: '25.00', inventory_item_id: '5003', inventory_management: 'shopify', inventory_quantity: 40 }]),
    ],
    inventory: input.inventory ?? [],
    checkpoint: input.checkpoint ?? { cursor: null, updated_at: SYNCED },
    topSales: input.topSales ?? null,
    salesHistory: input.salesHistory ?? salesRows(),
    currency: input.currency ?? 'INR',
    now: NOW,
  } as Parameters<typeof buildInventoryDataset>[0])
}

function repository(data: InventoryDataset): InventoryRepository {
  return { async list() { return data }, async get(_store: StoreId, variantId: string) { return data.items.find((item) => item.variantId === variantId) ?? null } }
}

function provider(text = 'Three products are frozen with 1000 units on hand. Consider a promotion.') {
  return {
    generate: vi.fn(async (_system: string, _user: string): Promise<AiGeneration> => ({ text, model: 'free/model', keyIndex: 0, usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }, attempts: 1 })),
  }
}

function service(input: Readonly<{
  plan?: PlanTier
  data?: InventoryDataset
  points?: readonly InventoryHistoryPoint[]
  usage?: InMemoryInventoryInsightUsage
  audit?: InMemoryInventoryInsightAudit
  generate?: ReturnType<typeof provider>
  now?: () => number
}> = {}) {
  const audit = input.audit ?? new InMemoryInventoryInsightAudit()
  const usage = input.usage ?? new InMemoryInventoryInsightUsage()
  const generator = input.generate ?? provider()
  const instance = new InventoryInsightsService(
    repository(input.data ?? dataset()),
    new InMemoryInventorySnapshotRepository(input.points ?? []),
    { get: async () => ({ plan: input.plan ?? 'growth' }) as never },
    usage,
    audit,
    generator,
    null,
    input.now ?? (() => NOW),
  )
  return { instance, audit, usage, generator }
}

function insight(result: InventoryInsightsResult, feature: string): Readonly<Record<string, unknown>> {
  const entry = result.available.find((item) => item.feature === feature)
  return (typeof entry?.data === 'object' && entry.data !== null ? entry.data : {}) as Readonly<Record<string, unknown>>
}

describe('sales history sufficiency', () => {
  it('reports how much history is still missing below the 30-day floor', () => {
    const history = buildSalesHistory([{ productId: '7001', day: day(5), unitsSold: 2, grossRevenue: 20 }], NOW)
    expect(history.sufficient).toBe(false)
    expect(history.historyDays).toBe(6)
    expect(history.missingDays).toBe(24)
    expect(productVelocity(history, '7001', NOW)).toBeNull()
  })

  it('computes velocity only from the trailing 30 days once enough history exists', () => {
    const history = buildSalesHistory(salesRows(), NOW)
    expect(history.sufficient).toBe(true)
    expect(productVelocity(history, '7001', NOW)).toBe(3)
  })

  it('treats a store with no orders as insufficient rather than zero velocity', () => {
    const history = buildSalesHistory([], NOW)
    expect(history.sufficient).toBe(false)
    expect(history.historyDays).toBe(0)
  })
})

describe('dead stock detection', () => {
  it('flags stocked products with no sale in the window and totals the frozen value', () => {
    const data = dataset()
    const result = deadStock(aggregateProductStock(data.items), data.sales, NOW)
    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.items.map((item) => item.productId)).toEqual(['7003'])
    expect(result.windowDays).toBe(90)
    expect(result.totalStuckValue).toBe(25 * 40)
  })

  it('refuses to guess before 30 days of sales history exist', () => {
    const data = dataset({ salesHistory: [{ productId: '7001', day: day(2), unitsSold: 1, grossRevenue: 10 }] })
    const result = deadStock(aggregateProductStock(data.items), data.sales, NOW)
    expect(result.status).toBe('insufficient_data')
    if (result.status === 'insufficient_data') expect(result.message).toContain('more day')
  })

  it('frames a clean store positively instead of listing nothing', () => {
    const data = dataset({ catalog: [catalogRow('7001', 'Fast Mover', [{ id: '9001', price: '100.00', inventory_item_id: '5001', inventory_management: 'shopify', inventory_quantity: 20 }])] })
    const result = deadStock(aggregateProductStock(data.items), data.sales, NOW)
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.items).toEqual([])
    expect(result.message).toContain('All items moving well')
  })
})

describe('reorder recommendations', () => {
  it('uses velocity x lead time plus a 20 percent safety buffer', () => {
    expect(reorderPoint(3, 14)).toBe(50.4)
  })

  it('recommends only products at or below the reorder point', () => {
    const data = dataset()
    const result = reorderRecommendations(aggregateProductStock(data.items), data.sales, NOW)
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.items.map((item) => item.productId)).toEqual(['7001'])
    const first = result.items[0]
    expect(first?.reorderPoint).toBe(50.4)
    expect(first?.currentStock).toBe(20)
    // 30 days of demand plus safety, minus what is on hand.
    expect(first?.suggestedQuantity).toBe(Math.ceil(3 * 30 * 1.2 - 20))
    expect(first?.leadTimeDays).toBe(14)
  })

  it('says stock levels are healthy when nothing needs reordering', () => {
    const data = dataset({ catalog: [catalogRow('7001', 'Fast Mover', [{ id: '9001', price: '100.00', inventory_item_id: '5001', inventory_management: 'shopify', inventory_quantity: 4000 }])] })
    const result = reorderRecommendations(aggregateProductStock(data.items), data.sales, NOW)
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.items).toEqual([])
    expect(result.message).toContain('Stock levels healthy')
  })

  it('waits for history instead of inventing a velocity', () => {
    const data = dataset({ salesHistory: [] })
    expect(reorderRecommendations(aggregateProductStock(data.items), data.sales, NOW).status).toBe('insufficient_data')
  })
})

describe('overstock alerts', () => {
  it('flags stock beyond 90 days of cover and quantifies the excess', () => {
    const data = dataset()
    const result = overstockAlerts(aggregateProductStock(data.items), data.sales, NOW)
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.items.map((item) => item.productId)).toEqual(['7002'])
    const item = result.items[0]
    expect(result.coverThresholdDays).toBe(90)
    // 2 units sold in the last 30 days => 0.0667/day => ~6 units cover 90 days.
    expect(item?.velocity).toBeCloseTo(2 / 30, 3)
    expect(item?.excessUnits).toBe(493)
    expect(item?.suggestedAction).toContain('promotion')
  })

  it('never double counts zero-velocity stock, which is dead stock', () => {
    const data = dataset()
    const result = overstockAlerts(aggregateProductStock(data.items), data.sales, NOW)
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.items.map((item) => item.productId)).not.toContain('7003')
  })
})

describe('stock turnover', () => {
  it('bands products as fast, medium, or slow from annualized real sales', () => {
    const data = dataset()
    const result = stockTurnover(aggregateProductStock(data.items), data.sales, NOW)
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.items.find((item) => item.productId === '7001')?.band).toBe('fast')
    expect(result.items.find((item) => item.productId === '7002')?.band).toBe('slow')
    expect(result.topMovers[0]?.productId).toBe('7001')
    expect(result.windowDays).toBe(120)
  })
})

describe('days of cover', () => {
  it('divides real stock by the observed 30-day velocity', () => {
    const data = dataset()
    const item = data.items.find((entry) => entry.sku === 'FAST')
    if (!item) throw new Error('missing item')
    const cover = variantDaysOfCover(item, 1, data.sales, NOW)
    expect(cover).toEqual({ status: 'available', days: 6.7, velocity: 3 })
  })

  it('says insufficient data below 30 days of history', () => {
    const data = dataset({ salesHistory: [{ productId: '7001', day: day(1), unitsSold: 5, grossRevenue: 50 }] })
    const item = data.items[0]
    if (!item) throw new Error('missing item')
    const cover = variantDaysOfCover(item, 1, data.sales, NOW)
    expect(cover.status).toBe('insufficient_data')
    if (cover.status === 'insufficient_data') expect(cover.reason).toBe('sales_history')
  })

  it('does not split product-level sales across a multi-variant product', () => {
    const data = dataset()
    const item = data.items[0]
    if (!item) throw new Error('missing item')
    const cover = variantDaysOfCover(item, 3, data.sales, NOW)
    expect(cover.status).toBe('insufficient_data')
    if (cover.status === 'insufficient_data') expect(cover.reason).toBe('variant_sales_unavailable')
  })

  it('reports no measurable cover for an item with zero recent sales', () => {
    const data = dataset()
    const item = data.items.find((entry) => entry.sku === 'DEAD')
    if (!item) throw new Error('missing item')
    const cover = variantDaysOfCover(item, 1, data.sales, NOW)
    expect(cover.status).toBe('insufficient_data')
    if (cover.status === 'insufficient_data') expect(cover.reason).toBe('no_sales')
  })

  it('attaches the column to Growth rows and locks it for Trial rows', () => {
    const data = dataset()
    const filters = parseInventoryFilters({})
    const growth = filterInventory(data, filters, 'growth', NOW)
    const trial = filterInventory(data, filters, 'trial', NOW)
    expect(growth.items.some((item) => item.daysOfCover.status === 'available')).toBe(true)
    expect(trial.items.every((item) => item.daysOfCover.status === 'locked')).toBe(true)
  })

  it('sorts by cover with unmeasurable rows last in both directions', () => {
    const data = dataset()
    const ascending = filterInventory(data, { ...parseInventoryFilters({}), sort: 'days_of_cover', direction: 'asc' }, 'growth', NOW)
    const descending = filterInventory(data, { ...parseInventoryFilters({}), sort: 'days_of_cover', direction: 'desc' }, 'growth', NOW)
    expect(ascending.items[0]?.sku).toBe('FAST')
    expect(ascending.items[ascending.items.length - 1]?.daysOfCover.status).not.toBe('available')
    expect(descending.items[descending.items.length - 1]?.daysOfCover.status).not.toBe('available')
  })
})

describe('predictive restocking and seasonality', () => {
  it('projects a reorder date from real velocity with a stated confidence', () => {
    const data = dataset()
    const result = predictiveRestocking(aggregateProductStock(data.items), data.sales, NOW)
    if (result.status !== 'available') throw new Error('expected available')
    const fast = result.items.find((item) => item.productId === '7001')
    expect(fast?.daysUntilReorder).toBe(0)
    expect(fast?.confidence).toBe('high')
    expect(fast?.predictedReorderDate).toBe(day(0))
  })

  it('refuses seasonality until a year of snapshots exists', () => {
    const result = seasonalTrends(120, [{ month: '2026-01', averageUnits: 10 }])
    expect(result.status).toBe('insufficient_data')
    if (result.status === 'insufficient_data') expect(result.message).toContain('Available after 12 months of data')
  })

  it('reports a peak month once twelve months are recorded', () => {
    const months = Array.from({ length: 12 }, (_, index) => ({ month: `2026-${String(index + 1).padStart(2, '0')}`, averageUnits: index }))
    const result = seasonalTrends(400, months)
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.peakMonth).toBe('2026-12')
    expect(result.troughMonth).toBe('2026-01')
  })

  it('measures the recorded snapshot span from the first snapshot', () => {
    expect(snapshotDaySpan(null, NOW)).toBe(0)
    expect(snapshotDaySpan(day(9), NOW)).toBe(10)
  })
})

describe('plan gating', () => {
  it('locks every premium feature for Trial and audits the access', async () => {
    const { instance, audit } = service({ plan: 'trial' })
    const result = await instance.get(TENANT)
    expect(result.available).toEqual([])
    expect(result.locked.map((entry) => entry.feature)).toEqual(['dead_stock', 'reorder_recommendations', 'stock_turnover', 'overstock_alerts', 'ai_suggestion', 'days_of_cover', 'stock_history', 'predictive_restocking', 'seasonal_trends', 'auto_reorder'])
    expect(audit.entries.length).toBe(result.locked.length)
    expect(audit.entries.every((entry) => entry.storeId === TENANT)).toBe(true)
  })

  it('locks the same features for Start', async () => {
    const { instance } = service({ plan: 'start' })
    const result = await instance.get(TENANT)
    expect(result.available).toEqual([])
    expect(result.usage.limit).toBe(0)
  })

  it('unlocks the Growth set and keeps Commander features locked', async () => {
    const { instance } = service({ plan: 'growth' })
    const result = await instance.get(TENANT)
    expect(result.available.map((entry) => entry.feature)).toEqual(['dead_stock', 'reorder_recommendations', 'stock_turnover', 'overstock_alerts', 'ai_suggestion', 'days_of_cover', 'stock_history'])
    expect(result.locked.map((entry) => entry.feature)).toEqual(['predictive_restocking', 'seasonal_trends', 'auto_reorder'])
    expect(result.usage.limit).toBe(20)
  })

  it('unlocks everything for Commander with no AI insight cap', async () => {
    const { instance } = service({ plan: 'commander' })
    const result = await instance.get(TENANT)
    expect(result.locked).toEqual([])
    expect(result.available.map((entry) => entry.feature)).toContain('predictive_restocking')
    expect(result.available.map((entry) => entry.feature)).toContain('auto_reorder')
    expect(result.usage.limit).toBeNull()
  })

  it('throws a locked error when a lower plan requests one premium feature directly', async () => {
    const { instance } = service({ plan: 'growth' })
    await expect(instance.get(TENANT, 'predictive_restocking')).rejects.toBeInstanceOf(InventoryFeatureLockedError)
  })

  it('rejects an unknown feature name', async () => {
    const { instance } = service({ plan: 'commander' })
    await expect(instance.get(TENANT, 'bundle_recommendations')).rejects.toThrow('Unknown inventory insight feature')
  })

  it('never exposes autonomous reordering, only manual review', async () => {
    const { instance } = service({ plan: 'commander' })
    const result = await instance.get(TENANT)
    expect(insight(result, 'auto_reorder').autonomous).toBe(false)
    expect(insight(result, 'auto_reorder').execution).toBe('manual_review_only')
  })
})

describe('AI suggestion grounding and usage limits', () => {
  it('sends only aggregate facts, never product identifiers', async () => {
    const generator = provider()
    const { instance } = service({ plan: 'growth', generate: generator })
    await instance.get(TENANT)
    const prompt = generator.generate.mock.calls[0]?.[1] ?? ''
    for (const identifier of ['Fast Mover', 'Slow Mover', 'Frozen Item', 'FAST', 'SLOW', 'DEAD', '9001', '7001']) {
      expect(prompt).not.toContain(identifier)
    }
    expect(prompt).toContain('Units in stock')
    expect(prompt).toContain('Products at or below their reorder point')
  })

  it('rejects an AI answer that introduces an unsupported number', async () => {
    const { instance } = service({ plan: 'growth', generate: provider('You have 999999 units stranded in a warehouse.') })
    const result = await instance.get(TENANT)
    // QA 2026-08-22: a language-firewall rejection is now surfaced as a
    // distinct "safety check failed" state, not the generic offline string.
    const data = insight(result, 'ai_suggestion')
    expect(data.status).toBe('safety_failed')
    expect(String((data as { message?: string }).message)).toContain('safety check')
  })

  it('distinguishes an offline provider from a safety rejection', async () => {
    const offline = { generate: vi.fn(async (): Promise<AiGeneration> => { throw new AiUnavailableError() }) }
    const { instance } = service({ plan: 'growth', generate: offline })
    const result = await instance.get(TENANT)
    const data = insight(result, 'ai_suggestion')
    expect(data.status).toBe('unavailable')
    expect(String((data as { message?: string }).message)).toContain('offline or rate-limited')
  })

  it('counts one generation per request and stops at the Growth daily limit', async () => {
    const usage = new InMemoryInventoryInsightUsage()
    let clock = NOW
    const { instance } = service({ plan: 'growth', usage, now: () => clock })
    for (let index = 0; index < 21; index += 1) {
      clock += 6 * 60_000 // bypass the five minute cache
      const result = await instance.get(TENANT)
      if (index < 20) expect(insight(result, 'ai_suggestion').status).toBe('generated')
      else expect(insight(result, 'ai_suggestion').status).toBe('limit_reached')
    }
  })

  it('serves a cached result for five minutes without a second model call', async () => {
    const generator = provider()
    const { instance } = service({ plan: 'growth', generate: generator })
    const first = await instance.get(TENANT)
    const second = await instance.get(TENANT)
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(generator.generate).toHaveBeenCalledTimes(1)
  })

  it('does not call the model at all for a store with nothing synced', async () => {
    const generator = provider()
    const { instance } = service({ plan: 'growth', data: dataset({ catalog: [], salesHistory: [] }), generate: generator })
    const result = await instance.get(TENANT)
    expect(insight(result, 'ai_suggestion').status).toBe('insufficient_data')
    expect(generator.generate).not.toHaveBeenCalled()
  })

  it('keeps grounded facts free of product identifiers', () => {
    const facts = groundedInventoryFacts(dataset(), NOW)
    const serialized = JSON.stringify(facts)
    for (const identifier of ['Fast Mover', 'FAST', '9001']) expect(serialized).not.toContain(identifier)
    expect(facts.map((fact) => fact.key)).toContain('units')
  })
})

describe('custom AI queries', () => {
  it('is Commander only and audits a locked attempt', async () => {
    const { instance, audit } = service({ plan: 'growth' })
    await expect(instance.query(TENANT, 'Which products should I discount?')).rejects.toBeInstanceOf(InventoryFeatureLockedError)
    expect(audit.entries.some((entry) => entry.feature === 'custom_ai_queries')).toBe(true)
  })

  it('validates the question length', async () => {
    const { instance } = service({ plan: 'commander' })
    await expect(instance.query(TENANT, '   ')).rejects.toThrow('question must contain')
    await expect(instance.query(TENANT, 'a'.repeat(501))).rejects.toThrow('question must contain')
  })

  it('redacts product identifiers, emails, and ids before the model sees the question', () => {
    const data = dataset()
    const redacted = redactInventoryQuestion('Should I discount Fast Mover (SKU FAST, id 9001)? Email me at owner@shop.com', data)
    expect(redacted).not.toContain('Fast Mover')
    expect(redacted).not.toContain('FAST')
    expect(redacted).not.toContain('9001')
    expect(redacted).toContain('[redacted email]')
  })

  it('answers a Commander question from aggregate facts only', async () => {
    const generator = provider('Slow movers hold 3 products worth reviewing.')
    const { instance } = service({ plan: 'commander', generate: generator })
    const result = await instance.query(TENANT, 'What is my slowest moving category?')
    expect(result.available[0]?.feature).toBe('custom_ai_queries')
    const prompt = generator.generate.mock.calls[0]?.[1] ?? ''
    expect(prompt).toContain('identifiers removed')
    expect(prompt).not.toContain('Slow Mover')
  })

  it('caps Commander questions at twenty per day', async () => {
    const { instance } = service({ plan: 'commander' })
    for (let index = 0; index < 21; index += 1) {
      const result = await instance.query(TENANT, 'Which products should I discount?')
      const data = (result.available[0]?.data ?? {}) as Readonly<Record<string, unknown>>
      if (index < 20) expect(data.status).toBe('generated')
      else expect(data.status).toBe('limit_reached')
    }
  })

  it('routes a custom question away from the GET endpoint', async () => {
    const { instance } = service({ plan: 'commander' })
    await expect(instance.get(TENANT, 'custom_ai_queries')).rejects.toThrow('must use POST')
  })
})

describe('stock history', () => {
  const points: readonly InventoryHistoryPoint[] = [
    { date: day(2), units: 540, value: 54_000, skus: 3 },
    { date: day(1), units: 520, value: 52_000, skus: 3 },
    { date: day(0), units: 500, value: 50_000, skus: 3 },
  ]

  it('is locked below Growth and audited', async () => {
    const { instance, audit } = service({ plan: 'start', points })
    await expect(instance.history(TENANT, 30)).rejects.toBeInstanceOf(InventoryFeatureLockedError)
    expect(audit.entries.some((entry) => entry.feature === 'stock_history')).toBe(true)
  })

  it('returns recorded snapshots for Growth', async () => {
    const { instance } = service({ plan: 'growth', points })
    const result = await instance.history(TENANT, 30)
    expect(result.points).toHaveLength(3)
    expect(result.days).toBe(30)
    expect(result.firstSnapshotDate).toBe(day(2))
  })

  it('explains the empty chart before the first snapshot exists', async () => {
    const { instance } = service({ plan: 'growth', points: [] })
    const result = await instance.history(TENANT, 90)
    expect(result.points).toEqual([])
    expect(result.message).toContain('Building your inventory history')
  })

  it('snaps an arbitrary window to a supported range', () => {
    expect(normalizeHistoryDays('7')).toBe(7)
    expect(normalizeHistoryDays(45)).toBe(30)
    expect(normalizeHistoryDays('nonsense')).toBe(30)
    expect(normalizeHistoryDays(400)).toBe(365)
  })
})

describe('manual reorder decisions', () => {
  it('records an approval in the audit trail without ordering anything', async () => {
    const { instance, audit } = service({ plan: 'commander' })
    const result = await instance.recordReorderDecision(TENANT, '7001', 'approved')
    expect(result.execution).toBe('manual_in_shopify')
    expect(audit.decisions).toEqual([{ storeId: TENANT, productId: '7001', decision: 'approved', plan: 'commander' }])
  })

  it('rejects an unknown decision and a non-Commander plan', async () => {
    const commander = service({ plan: 'commander' })
    await expect(commander.instance.recordReorderDecision(TENANT, '7001', 'ordered')).rejects.toThrow('decision must be')
    const growth = service({ plan: 'growth' })
    await expect(growth.instance.recordReorderDecision(TENANT, '7001', 'approved')).rejects.toBeInstanceOf(InventoryFeatureLockedError)
  })
})

describe('inventory intelligence HTTP routes', () => {
  async function withServer(plan: PlanTier, assertion: (base: string) => Promise<void>, points: readonly InventoryHistoryPoint[] = []) {
    const data = dataset()
    const { instance } = service({ plan, data, points })
    const app = createApi({ logger: new Logger(), readinessChecks: [], inventory: { repository: repository(data), plan: async () => plan, insights: instance } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No address')
    try { await assertion(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  }

  it('serves plan-gated insights, history, and custom queries', async () => {
    await withServer('commander', async (base) => {
      const insights = await fetch(`${base}/inventory/insights?storeId=${TENANT}`)
      expect(insights.status).toBe(200)
      const body = await insights.json()
      expect(body.data.locked).toEqual([])
      expect(body.data.available.map((entry: { feature: string }) => entry.feature)).toContain('dead_stock')

      const history = await fetch(`${base}/inventory/history?storeId=${TENANT}&days=90`)
      expect(history.status).toBe(200)
      expect((await history.json()).data.days).toBe(90)

      const query = await fetch(`${base}/inventory/insights/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: TENANT, question: 'How much is tied up in dead stock?' }) })
      expect(query.status).toBe(200)
      expect((await query.json()).data.available[0].feature).toBe('custom_ai_queries')

      const decision = await fetch(`${base}/inventory/reorder-decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: TENANT, productId: '7001', decision: 'dismissed' }) })
      expect(decision.status).toBe(200)
    })
  })

  it('returns 403 for a plan that has not unlocked custom queries', async () => {
    await withServer('growth', async (base) => {
      const response = await fetch(`${base}/inventory/insights/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: TENANT, question: 'Which products should I discount?' }) })
      expect(response.status).toBe(403)
      expect((await response.json()).error.details.required_plan).toBe('commander')
    })
  })

  it('validates request input', async () => {
    await withServer('growth', async (base) => {
      expect((await fetch(`${base}/inventory/insights`)).status).toBe(400)
      expect((await fetch(`${base}/inventory/insights?storeId=${TENANT}&feature=bundles`)).status).toBe(400)
      expect((await fetch(`${base}/inventory/insights?storeId=${TENANT}&question=hi`)).status).toBe(400)
      expect((await fetch(`${base}/inventory/insights/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: TENANT }) })).status).toBe(400)
    })
  })

  it('keeps the plain inventory table working without the intelligence layer wired', async () => {
    const data = dataset()
    const app = createApi({ logger: new Logger(), readinessChecks: [], inventory: { repository: repository(data), plan: async () => 'growth' } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No address')
    try {
      expect((await fetch(`http://127.0.0.1:${address.port}/inventory?storeId=${TENANT}`)).status).toBe(200)
      expect((await fetch(`http://127.0.0.1:${address.port}/inventory/insights?storeId=${TENANT}`)).status).toBe(404)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
