import { describe, expect, it } from 'vitest'
import { CalibrationLedger } from './calibration.js'
import { CostMeter } from './cost.js'
import { DecisionEngine } from './engine.js'
import { InMemoryRecommendationRepository } from './repository.js'
import { OpenRouterClient } from './provider.js'
import type { StoreSnapshot } from './domain.js'

const snapshot: StoreSnapshot = {
  storeId: 's' as StoreSnapshot['storeId'], currency: 'USD', timezone: 'UTC', asOf: '2024-06-12T00:00:00.000Z', dataFreshAt: '2024-06-12T00:00:00.000Z',
  products: [{ productId: 'p', title: 'Product', inventoryUnits: 1, averageDailyUnits: 1, unitPrice: 50, unitCost: 10, unitsSold120d: 10, daysSinceLastSale: 1 }],
  customers: [], checkouts: [], orders: [], productPairs: [], last30dRevenue: 100, previous30dRevenue: 80, last30dOrders: 5, previous30dOrders: 4,
}

describe('F4 decision engine', () => {
  it('runs deterministic rules even when AI is unavailable', async () => {
    const repository = new InMemoryRecommendationRepository()
    const engine = new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), new CalibrationLedger(), repository, {}, () => 100)
    const result = await engine.run(snapshot)
    expect(result.recommendations.length).toBeGreaterThan(0)
    expect(result.recommendations[0]?.explanationStatus).toBe('AI_UNAVAILABLE')
    expect(await repository.list(snapshot.storeId)).toHaveLength(result.recommendations.length)
  })
  it('creates immutable evidence packs for each recommendation', async () => {
    const engine = new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), new CalibrationLedger(), new InMemoryRecommendationRepository(), {}, () => 100)
    const result = await engine.run(snapshot)
    expect(result.recommendations[0]?.evidencePack).toHaveProperty('sha256')
  })
  it('generates language only after deterministic evidence exists', async () => {
    const fetcher = async (): Promise<Response> => new Response(JSON.stringify({ choices: [{ message: { content: 'The product is near its stockout threshold.' } },], usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 } }), { status: 200 })
    const engine = new DecisionEngine(new OpenRouterClient({ keys: ['key'], models: ['model'], fetcher, sleep: async () => undefined }), new CostMeter(), new CalibrationLedger(), new InMemoryRecommendationRepository(), {}, () => 100)
    const recommendation = (await engine.run(snapshot)).recommendations[0]
    expect(recommendation?.explanationStatus).toBe('AI_GENERATED')
    expect(recommendation?.model).toBe('model')
  })
  it('rejects language that invents a number', async () => {
    const fetcher = async (): Promise<Response> => new Response(JSON.stringify({ choices: [{ message: { content: 'This will recover 999999 dollars.' } }] }), { status: 200 })
    const engine = new DecisionEngine(new OpenRouterClient({ keys: ['key'], models: ['model'], fetcher, sleep: async () => undefined }), new CostMeter(), new CalibrationLedger(), new InMemoryRecommendationRepository(), {}, () => 100)
    expect((await engine.run(snapshot)).recommendations[0]?.explanationStatus).toBe('AI_REJECTED')
  })
  it('returns six explicit agent statuses', () => expect(new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), new CalibrationLedger(), new InMemoryRecommendationRepository()).statuses()).toHaveLength(6))
  it('marks agents unconfigured without OpenRouter keys', () => expect(new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), new CalibrationLedger(), new InMemoryRecommendationRepository()).statuses()[0]?.execution).toBe('UNCONFIGURED'))
  it('uses calibration caps in recommendation confidence', async () => {
    const calibration = new CalibrationLedger()
    const engine = new DecisionEngine(new OpenRouterClient({ keys: [] }), new CostMeter(), calibration, new InMemoryRecommendationRepository(), {}, () => 100)
    expect((await engine.run(snapshot)).recommendations[0]?.confidence).toBeLessThanOrEqual(.75)
  })
})
