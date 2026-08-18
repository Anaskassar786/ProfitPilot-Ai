import { describe, expect, it } from 'vitest'
import { OpenRouterClient } from '@profitpilot/ai'
import type { ExecutiveFacts } from './executive-ai.js'
import { buildFinancialForecast, createExecutiveAiService, factsAsEvidence } from './executive-ai.js'

function facts(overrides: Partial<ExecutiveFacts> = {}): ExecutiveFacts {
  return {
    storeName: 'acme-store.myshopify.com',
    currency: 'USD',
    asOf: '2026-08-18',
    last30dRevenue: 8400,
    previous30dRevenue: 7000,
    revenueGrowthPct: 20,
    last30dOrders: 120,
    previous30dOrders: 100,
    ordersGrowthPct: 20,
    aov: 70,
    repeatRatePct: 40,
    customerCount: 5,
    inventoryValue: 5000,
    inventoryTurnover: 4.5,
    cancellationPct: 1.2,
    topProducts: [{ title: 'Hero Hoodie', revenue120d: 21600, sharePct: 55 }],
    healthScore: 82,
    healthStatus: 'STRONG',
    vitals: [{ label: 'Revenue growth', status: 'HEALTHY', value: 0.2 }],
    risks: [{ title: 'Revenue concentration in few products', severity: 'MEDIUM', impactIfRealized: 55440 }],
    opportunities: [{ title: 'Bundle frequently co-purchased pairs', estimatedImpactAnnual: 3600 }],
    benchmarkCategory: 'Fashion & Apparel',
    revenuePercentile: 48,
    aovPercentile: 52,
    ...overrides,
  }
}

describe('PR49 executive AI service', () => {
  it('degrades to deterministic grounded output when the provider is unconfigured', async () => {
    const service = createExecutiveAiService(new OpenRouterClient({ keys: [] }), null, null)
    expect(service.available).toBe(false)
    const sections = await service.generateBoardReport(facts(), 'en')
    expect(sections.aiNarrativeAvailable).toBe(false)
    expect(sections.generatedWithModel).toBeNull()
    expect(sections.executiveSummary).toContain('8,400')
    expect(sections.executiveSummary).toContain('82/100')
    expect(sections.keyInsights.length).toBeGreaterThan(0)
    expect(sections.recommendedDecisions.length).toBeGreaterThan(0)
    expect(sections.financialForecast?.currency).toBe('USD')
    expect(sections.financialForecast?.projections.map((projection) => projection.label)).toEqual(['30 days', '90 days', '365 days'])
  })

  it('builds a forecast that extends the store trend with honest bands', () => {
    const forecast = buildFinancialForecast(facts())
    expect(forecast.projections).toHaveLength(3)
    for (const projection of forecast.projections) {
      expect(projection.low).toBeLessThanOrEqual(projection.expected)
      expect(projection.expected).toBeLessThanOrEqual(projection.high)
    }
  })

  it('exposes every fact as firewall evidence', () => {
    const evidence = factsAsEvidence(facts())
    expect(evidence.some((field) => field.key === 'last30dRevenue' && field.value === 8400)).toBe(true)
    expect(evidence.some((field) => field.key === 'healthScore' && field.value === 82)).toBe(true)
  })

  it('grounds provider output through the language firewall (hallucinated numbers rejected)', async () => {
    const provider = new OpenRouterClient({ keys: ['sk-test'], models: ['test/model'], fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Revenue reached 999,999 which is not in your data.' }, finish_reason: 'stop' }],
      model: 'test/model',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }) })
    const service = createExecutiveAiService(provider, 'test/model', null)
    expect(service.available).toBe(true)
    // The firewall must reject the invented number, so the service falls
    // back to the deterministic summary built from real facts.
    const sections = await service.generateBoardReport(facts(), 'en')
    expect(sections.executiveSummary).not.toContain('999,999')
    expect(sections.executiveSummary).toContain('8,400')
  })

  it('generates a deterministic roadmap when the provider is unavailable', async () => {
    const service = createExecutiveAiService(new OpenRouterClient({ keys: [] }), null, null)
    const plan = await service.generateRoadmapPlan({ roadmapType: '90_DAY', facts: facts(), opportunities: [], risks: [], goal: 'Reach 25% repeat rate' })
    expect(plan.milestones.length).toBeGreaterThanOrEqual(3)
    expect(plan.milestones[0]!.dependencies).toHaveLength(0)
    expect(plan.title).toContain('Reach 25% repeat rate')
  })
})
