/**
 * GrowthIQ (formerly "AI Executive") — language orchestration.
 *
 * The AI layer writes narrative ONLY. Every number it is allowed to use
 * comes from `ExecutiveFacts` — real values computed from synced store rows
 * by the deterministic engine. The language firewall
 * (`validateLanguageResponse`) rejects any response that introduces a
 * number outside the allowed evidence set, spells out quantities in words,
 * leaks PII, or echoes prompt-injection markers.
 *
 * When the provider is unconfigured (no API key) or unavailable, every
 * method degrades to deterministic template output built from the same
 * facts — the reports remain real and useful, with `aiNarrativeAvailable`
 * set honestly.
 */
import { AppError } from '@profitpilot/types'
import type { EvidenceField } from '@profitpilot/ai'
import { OpenRouterClient, validateLanguageResponse } from '@profitpilot/ai'
import type { AiGeneration } from '@profitpilot/ai'
import type { ExecutiveHealthDiagnosis, ExecutiveOpportunity, ExecutiveRisk, ExecutiveScenario, ExecutiveVitalSign, RoadmapMilestone, RoadmapType } from './executive-model.js'

export type ExecutiveFacts = Readonly<{
  storeName: string
  currency: string
  asOf: string
  last30dRevenue: number
  previous30dRevenue: number
  revenueGrowthPct: number
  last30dOrders: number
  previous30dOrders: number
  ordersGrowthPct: number
  aov: number
  repeatRatePct: number
  customerCount: number
  inventoryValue: number
  inventoryTurnover: number | null
  cancellationPct: number
  topProducts: readonly Readonly<{ title: string; revenue120d: number; sharePct: number }>[]
  healthScore: number
  healthStatus: string
  vitals: readonly Readonly<{ label: string; status: string; value: number | null }>[]
  risks: readonly Readonly<{ title: string; severity: string; impactIfRealized: number }>[]
  opportunities: readonly Readonly<{ title: string; estimatedImpactAnnual: number }>[]
  benchmarkCategory: string
  revenuePercentile: number | null
  aovPercentile: number | null
}>

export type BoardReportSections = Readonly<{
  executiveSummary: string
  strategicPosition: string | null
  keyInsights: readonly string[]
  recommendedDecisions: readonly string[]
  financialForecast: Readonly<{ horizonDays: number; currency: string; projections: readonly Readonly<{ label: string; low: number; expected: number; high: number }>[] }> | null
  appendix: Readonly<Record<string, Readonly<Record<string, string | number | null>>>>
  aiNarrativeAvailable: boolean
  generatedWithModel: string | null
}>

export type ExecutiveAiService = Readonly<{
  available: boolean
  generateBoardReport(facts: ExecutiveFacts, language: 'en' | 'hi'): Promise<BoardReportSections>
  generateScenarioNarrative(scenario: Readonly<{ scenarioType: string; title: string; recommendation: string; predictions: Omit<ExecutiveScenario['predictions'], 'narrative'>; currency: string }>): Promise<string | null>
  generateRoadmapPlan(input: Readonly<{ roadmapType: RoadmapType; facts: ExecutiveFacts; opportunities: readonly ExecutiveOpportunity[]; risks: readonly ExecutiveRisk[]; goal: string | null }>): Promise<Readonly<{ title: string; milestones: readonly RoadmapMilestone[]; expectedOutcomes: readonly string[]; confidenceScore: number }>>
  generateDecisionLessons(predicted: Readonly<Record<string, number | string>>, actual: Readonly<Record<string, number | string>>, accuracy: number): Promise<string>
  generateHealthNarrative(diagnosis: Readonly<{ score: number; status: string; vitals: readonly ExecutiveVitalSign[] }>): Promise<string | null>
}>

/** Deterministic evidence fields the firewall checks AI numbers against. */
export function factsAsEvidence(facts: ExecutiveFacts): readonly EvidenceField[] {
  const fields: EvidenceField[] = [
    { key: 'last30dRevenue', label: 'Revenue (30d)', value: Math.round(facts.last30dRevenue * 100) / 100, source: 'analytics_product_sales' },
    { key: 'previous30dRevenue', label: 'Revenue (prior 30d)', value: Math.round(facts.previous30dRevenue * 100) / 100, source: 'analytics_product_sales' },
    { key: 'last30dOrders', label: 'Orders (30d)', value: facts.last30dOrders, source: 'analytics_orders' },
    { key: 'previous30dOrders', label: 'Orders (prior 30d)', value: facts.previous30dOrders, source: 'analytics_orders' },
    { key: 'aov', label: 'Average order value', value: Math.round(facts.aov * 100) / 100, source: 'analytics_orders' },
    { key: 'repeatRatePct', label: 'Repeat purchase rate %', value: Math.round(facts.repeatRatePct * 10) / 10, source: 'synced_customers' },
    { key: 'customerCount', label: 'Customer count', value: facts.customerCount, source: 'synced_customers' },
    { key: 'inventoryValue', label: 'Inventory value', value: Math.round(facts.inventoryValue * 100) / 100, source: 'synced_products' },
    { key: 'cancellationPct', label: 'Cancellation rate %', value: Math.round(facts.cancellationPct * 1000) / 1000, source: 'analytics_orders' },
    { key: 'healthScore', label: 'Health score', value: facts.healthScore, source: 'executive_health_engine' },
    { key: 'revenuePercentile', label: 'Revenue percentile', value: facts.revenuePercentile ?? 0, source: 'industry_benchmarks' },
    { key: 'aovPercentile', label: 'AOV percentile', value: facts.aovPercentile ?? 0, source: 'industry_benchmarks' },
  ]
  if (facts.inventoryTurnover !== null) fields.push({ key: 'inventoryTurnover', label: 'Inventory turnover', value: Math.round(facts.inventoryTurnover * 10) / 10, source: 'synced_products' })
  for (const product of facts.topProducts) {
    fields.push({ key: `product:${product.title}`, label: `Revenue (120d) ${product.title}`, value: Math.round(product.revenue120d * 100) / 100, source: 'analytics_product_sales_daily' })
    fields.push({ key: `share:${product.title}`, label: `Revenue share % ${product.title}`, value: Math.round(product.sharePct * 10) / 10, source: 'analytics_product_sales_daily' })
  }
  for (const risk of facts.risks) fields.push({ key: `risk:${risk.title}`, label: `Risk impact ${risk.title}`, value: Math.round(risk.impactIfRealized * 100) / 100, source: 'executive_risk_engine' })
  for (const opportunity of facts.opportunities) fields.push({ key: `opportunity:${opportunity.title}`, label: `Opportunity impact ${opportunity.title}`, value: Math.round(opportunity.estimatedImpactAnnual * 100) / 100, source: 'executive_opportunity_engine' })
  return fields
}

function factSheet(facts: ExecutiveFacts): string {
  return [
    `Store: ${facts.storeName} (${facts.currency}) — data as of ${facts.asOf}.`,
    `Revenue last 30 days: ${Math.round(facts.last30dRevenue * 100) / 100}; prior 30 days: ${Math.round(facts.previous30dRevenue * 100) / 100} (${facts.revenueGrowthPct >= 0 ? '+' : ''}${facts.revenueGrowthPct.toFixed(1)}%).`,
    `Orders last 30 days: ${facts.last30dOrders}; prior 30 days: ${facts.previous30dOrders} (${facts.ordersGrowthPct >= 0 ? '+' : ''}${facts.ordersGrowthPct.toFixed(1)}%).`,
    `Average order value: ${Math.round(facts.aov * 100) / 100}; repeat purchase rate: ${facts.repeatRatePct.toFixed(1)}% across ${facts.customerCount} customers.`,
    `Inventory value: ${Math.round(facts.inventoryValue * 100) / 100}${facts.inventoryTurnover !== null ? `; annualized turnover ${facts.inventoryTurnover.toFixed(1)}x` : ''}.`,
    `Cancellation rate: ${facts.cancellationPct.toFixed(2)}%.`,
    `Top products by 120-day revenue: ${facts.topProducts.map((product) => `${product.title} (${Math.round(product.revenue120d * 100) / 100}, ${product.sharePct.toFixed(1)}% share)`).join('; ') || 'none'}.`,
    `Business health score: ${facts.healthScore}/100 (${facts.healthStatus}).`,
    `Vital signs: ${facts.vitals.map((vital) => `${vital.label}=${vital.value === null ? 'no data' : vital.value}`).join('; ')}.`,
    `Active risks: ${facts.risks.map((risk) => `${risk.title} (${risk.severity}, impact ${Math.round(risk.impactIfRealized * 100) / 100})`).join('; ') || 'none detected'}.`,
    `Opportunities: ${facts.opportunities.map((opportunity) => `${opportunity.title} (impact ${Math.round(opportunity.estimatedImpactAnnual * 100) / 100}/yr)`).join('; ') || 'none identified'}.`,
    `Benchmark category: ${facts.benchmarkCategory}; revenue percentile ${facts.revenuePercentile === null ? 'not measurable' : facts.revenuePercentile}; AOV percentile ${facts.aovPercentile === null ? 'not measurable' : facts.aovPercentile}.`,
  ].join('\n')
}

const SYSTEM_PROMPT = [
  'You are GrowthIQ, the growth-intelligence engine of a Shopify store, writing for its owner in a formal boardroom tone.',
  'You write only from the FACT SHEET provided. You may ONLY use numbers that appear in the fact sheet.',
  'Never invent, estimate, or restate a number that is not in the fact sheet. Refer to metrics qualitatively if a number is not provided.',
  'Use formal business language. No emojis, no exclamation marks, no casual phrasing.',
  'Structure exactly as instructed. Keep every section concise and actionable.',
  'Never mention customers by name, emails, phone numbers, or any personal data.',
].join(' ')

function splitLines(text: string): readonly string[] {
  return text.split('\n').map((line) => line.replace(/^\s*(?:[-•*]\s*|\d+[.)]\s*)/, '').trim()).filter((line) => line.length > 2)
}

/** Deterministic summary used when the provider is unavailable — built from facts only. */
function fallbackSummary(facts: ExecutiveFacts): string {
  const parts: string[] = []
  parts.push(`${facts.storeName} recorded ${facts.currency} ${Math.round(facts.last30dRevenue).toLocaleString('en-US')} in revenue over the last 30 days, ${facts.revenueGrowthPct >= 0 ? 'up' : 'down'} ${Math.abs(facts.revenueGrowthPct).toFixed(1)}% versus the prior period.`)
  if (facts.topProducts[0]) parts.push(`${facts.topProducts[0].title} remains the largest revenue contributor at ${facts.topProducts[0].sharePct.toFixed(1)}% of 120-day sales.`)
  parts.push(`Business health scores ${facts.healthScore}/100 (${facts.healthStatus}). ${facts.risks.length === 0 ? 'No material risks are currently detected.' : `The risk radar holds ${facts.risks.length} active risk${facts.risks.length === 1 ? '' : 's'}, led by ${facts.risks[0]!.title.toLowerCase()}.`}`)
  if (facts.opportunities[0]) parts.push(`The largest modelled opportunity is ${facts.opportunities[0].title} with an estimated annual impact of ${facts.currency} ${Math.round(facts.opportunities[0].estimatedImpactAnnual).toLocaleString('en-US')}.`)
  return parts.join(' ')
}

function fallbackStrategicPosition(facts: ExecutiveFacts): string {
  if (facts.revenuePercentile === null && facts.aovPercentile === null) {
    return `In the ${facts.benchmarkCategory} category, ${facts.storeName} has not yet accumulated enough measurable activity for a percentile position. The store currently trades at a ${Math.round(facts.aov * 100) / 100} average order value with a ${facts.repeatRatePct.toFixed(1)}% repeat rate — the position will firm up as history accrues.`
  }
  const revenue = facts.revenuePercentile === null ? null : `${facts.revenuePercentile}th percentile`
  const aov = facts.aovPercentile === null ? null : `${facts.aovPercentile}th percentile`
  const clauses: string[] = []
  if (revenue) clauses.push(`monthly revenue in the ${revenue}`)
  if (aov) clauses.push(`average order value in the ${aov}`)
  return `Within the ${facts.benchmarkCategory} category, ${facts.storeName} places its ${clauses.join(' and ')} against public Shopify benchmarks. With ${facts.customerCount} customers and a ${facts.repeatRatePct.toFixed(1)}% repeat purchase rate, the growth runway is ${facts.repeatRatePct >= 25 ? 'solid — protect the buyer base while expanding reach' : 'concentrated in retention: the current base has room to buy again'}.`
}

function fallbackInsights(facts: ExecutiveFacts): readonly string[] {
  const insights: string[] = []
  if (facts.revenueGrowthPct >= 5) insights.push(`Revenue momentum is positive: ${facts.revenueGrowthPct.toFixed(1)}% growth over the prior 30 days with ${facts.last30dOrders} orders.`)
  if (facts.revenueGrowthPct <= -5) insights.push(`Revenue contracted ${Math.abs(facts.revenueGrowthPct).toFixed(1)}% versus the prior period — isolate the decline by product before committing new capital.`)
  if (facts.topProducts[0] && facts.topProducts[0].sharePct >= 40) insights.push(`Revenue concentration is elevated: the top product carries ${facts.topProducts[0].sharePct.toFixed(1)}% of 120-day sales.`)
  if (facts.repeatRatePct < 25 && facts.customerCount > 0) insights.push(`Repeat purchase rate sits at ${facts.repeatRatePct.toFixed(1)}% — retention improvement is the highest-leverage revenue initiative available.`)
  if (facts.inventoryTurnover !== null && facts.inventoryTurnover < 2.5) insights.push(`Inventory turns ${facts.inventoryTurnover.toFixed(1)}x per year; capital efficiency would improve with a slow-mover clearance.`)
  if (facts.cancellationPct >= 3) insights.push(`Cancellations absorb ${facts.cancellationPct.toFixed(2)}% of orders — tightening fulfilment accuracy protects cash conversion.`)
  if (facts.risks[0]) insights.push(`The risk radar's leading exposure is ${facts.risks[0].title.toLowerCase()} (${facts.risks[0].severity.toLowerCase()}), with an estimated impact of ${facts.currency} ${Math.round(facts.risks[0].impactIfRealized).toLocaleString('en-US')}.`)
  if (facts.opportunities[0]) insights.push(`${facts.opportunities[0].title} is the highest-value modelled opportunity at ${facts.currency} ${Math.round(facts.opportunities[0].estimatedImpactAnnual).toLocaleString('en-US')} per year.`)
  if (insights.length === 0) insights.push('The store has not accumulated enough history for strategic insight yet — continue syncing data and the analysis will deepen automatically.')
  return insights.slice(0, 5)
}

function fallbackDecisions(facts: ExecutiveFacts): readonly string[] {
  const decisions: string[] = []
  if (facts.opportunities[0]) decisions.push(`Initiate ${facts.opportunities[0].title.toLowerCase()} within 30 days and log the decision with a predicted outcome for review.`)
  if (facts.risks[0]) decisions.push(`Approve the mitigation plan for ${facts.risks[0].title.toLowerCase()} this week; re-run the risk scan in 14 days.`)
  if (facts.repeatRatePct < 25 && facts.customerCount > 0) decisions.push('Launch a second-purchase campaign for one-time buyers and target a repeat rate of 25% within 90 days.')
  if (decisions.length < 3 && facts.revenueGrowthPct < 5) decisions.push('Run a pricing scenario on the top revenue SKUs before any discounting decision.')
  if (decisions.length < 3) decisions.push('Set inventory reorder points from 30-day velocity to prevent stockouts on selling SKUs.')
  return decisions.slice(0, 3)
}

/** Deterministic forecast from the store's own trend. Never invents a curve. */
export function buildFinancialForecast(facts: ExecutiveFacts): Readonly<{ horizonDays: number; currency: string; projections: readonly Readonly<{ label: string; low: number; expected: number; high: number }>[] }> {
  const monthly = Math.max(facts.last30dRevenue, 0)
  const growth = clampRate(facts.revenueGrowthPct / 100, -0.5, 1)
  const project = (months: number): Readonly<{ label: string; low: number; expected: number; high: number }> => {
    const expected = monthly * Math.pow(1 + growth, months)
    const band = 0.12 + Math.abs(growth) * 0.3
    return { label: months === 1 ? '30 days' : months === 3 ? '90 days' : '365 days', low: Math.round(expected * (1 - band)), expected: Math.round(expected), high: Math.round(expected * (1 + band)) }
  }
  return { horizonDays: 365, currency: facts.currency, projections: [project(1), project(3), project(12)] }
}

function clampRate(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }

export function createExecutiveAiService(provider: OpenRouterClient, primaryModel: string | null, fallbackModel: string | null): ExecutiveAiService {
  const models = [primaryModel, fallbackModel].filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
  const available = provider.configured && models.length > 0

  async function groundedGenerate(system: string, user: string, facts: ExecutiveFacts, maxTokens: number): Promise<AiGeneration> {
    const evidence = factsAsEvidence(facts)
    const generation = await provider.generate(system, `${user}\n\nFACT SHEET (the only numbers you may use):\n${factSheet(facts)}`, { maxTokens })
    const text = validateLanguageResponse(generation.text, evidence, Math.round(facts.last30dRevenue * 100) / 100)
    return { ...generation, text }
  }

  return {
    available,
    async generateBoardReport(facts: ExecutiveFacts, language: 'en' | 'hi'): Promise<BoardReportSections> {
      const languageInstruction = language === 'hi' ? ' Write all sections in Hindi.' : ''
      const appendix = buildAppendix(facts)
      if (!available) {
        return {
          executiveSummary: fallbackSummary(facts),
          strategicPosition: fallbackStrategicPosition(facts),
          keyInsights: fallbackInsights(facts),
          recommendedDecisions: fallbackDecisions(facts),
          financialForecast: buildFinancialForecast(facts),
          appendix,
          aiNarrativeAvailable: false,
          generatedWithModel: null,
        }
      }
      const summaryPrompt = [
        SYSTEM_PROMPT,
        languageInstruction,
        'Write a boardroom executive summary of 2-3 paragraphs for the store owner.',
        'Cover revenue trajectory, the dominant strategic fact in the data, and the single most important decision ahead.',
        'Use only numbers present in the fact sheet. End with the most important number and its context.',
      ].join(' ')
      const positionPrompt = [
        SYSTEM_PROMPT,
        languageInstruction,
        'Write a short Strategic Position section (2-4 sentences): market position against the benchmark category, trajectory, and growth runway.',
        'Use only numbers present in the fact sheet.',
      ].join(' ')
      const insightsPrompt = [
        SYSTEM_PROMPT,
        languageInstruction,
        'Write 3-5 Key Strategic Insights as a numbered list, one line each. Each insight must reference at least one fact-sheet number.',
      ].join(' ')
      const decisionsPrompt = [
        SYSTEM_PROMPT,
        languageInstruction,
        'Write 3 Recommended Strategic Decisions as a numbered list, one line each, in imperative form.',
      ].join(' ')
      const [summary, position, insights, decisions] = await Promise.all([
        groundedGenerate(SYSTEM_PROMPT, summaryPrompt, facts, 900).catch(() => null),
        groundedGenerate(SYSTEM_PROMPT, positionPrompt, facts, 400).catch(() => null),
        groundedGenerate(SYSTEM_PROMPT, insightsPrompt, facts, 600).catch(() => null),
        groundedGenerate(SYSTEM_PROMPT, decisionsPrompt, facts, 500).catch(() => null),
      ])
      const narrativeAvailable = summary !== null
      return {
        executiveSummary: summary?.text ?? fallbackSummary(facts),
        strategicPosition: position?.text ?? fallbackStrategicPosition(facts),
        keyInsights: insights ? splitLines(insights.text) : fallbackInsights(facts),
        recommendedDecisions: decisions ? splitLines(decisions.text) : fallbackDecisions(facts),
        financialForecast: buildFinancialForecast(facts),
        appendix,
        aiNarrativeAvailable: narrativeAvailable,
        generatedWithModel: summary?.model ?? null,
      }
    },

    async generateScenarioNarrative(scenario): Promise<string | null> {
      if (!available) return null
      const projected = scenario.predictions.projected
      const baseline = scenario.predictions.baseline
      const delta = scenario.predictions.delta
      const evidence: EvidenceField[] = [
        { key: 'projected', label: 'Projected monthly revenue', value: Math.round(projected.monthlyRevenue ?? projected.monthlyRevenueAtHorizon ?? 0), source: 'scenario_engine' },
        { key: 'baseline', label: 'Baseline monthly revenue', value: Math.round(baseline.monthlyRevenue ?? 0), source: 'analytics' },
        { key: 'delta', label: 'Monthly revenue delta', value: Math.round(delta.monthlyRevenue ?? 0), source: 'scenario_engine' },
      ]
      const user = `${SYSTEM_PROMPT}\nWrite a 2-3 sentence executive narrative for the scenario "${scenario.title}" (${scenario.scenarioType}). Explain what changes and what the merchant should watch. Use only these numbers: baseline ${evidence[1]!.value}, projected ${evidence[0]!.value}, delta ${evidence[2]!.value}.`
      try {
        const generation = await provider.generate(SYSTEM_PROMPT, user, { maxTokens: 400 })
        return validateLanguageResponse(generation.text, evidence, Number(evidence[2]!.value))
      } catch {
        return null
      }
    },

    async generateRoadmapPlan(input): Promise<Readonly<{ title: string; milestones: readonly RoadmapMilestone[]; expectedOutcomes: readonly string[]; confidenceScore: number }>> {
      const facts = input.facts
      if (!available) return deterministicRoadmap(input)
      const weeks = roadmapTypeToWeeks(input.roadmapType)
      const factsSheet = factSheet(facts)
      const evidence = factsAsEvidence(facts)
      const goalLine = input.goal ? `The merchant's stated goal: ${input.goal}.` : `The merchant's implicit goal: ${input.opportunities[0]?.title ?? 'sustainable growth'}.`
      const user = [
        SYSTEM_PROMPT,
        `Produce a ${input.roadmapType.replace('_', '-')} strategic roadmap (${weeks} weeks) for this store. ${goalLine}`,
        'Respond ONLY with strict JSON of this shape, using numbers only from the fact sheet:',
        '{"title": string, "milestones": [{"key": "m1", "title": string, "description": string, "dueDate": "YYYY-MM-DD", "successMetrics": [string], "dependencies": [key]}], "expectedOutcomes": [string]}',
        'Milestones must be weekly, ordered, and grounded in the facts (risks and opportunities given). 3-6 milestones.',
        `FACT SHEET:\n${factsSheet}`,
      ].join('\n')
      try {
        const generation = await provider.generate(SYSTEM_PROMPT, user, { maxTokens: 1200 })
        const text = generation.text.replace(/```json|```/g, '').trim()
        const parsed: unknown = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
        const record = isRecord(parsed) ? parsed : {}
        const milestones = Array.isArray(record.milestones)
          ? record.milestones.filter(isRecord).map((milestone, index): RoadmapMilestone => ({
              key: typeof milestone.key === 'string' ? milestone.key : `m${index + 1}`,
              title: typeof milestone.title === 'string' ? milestone.title.slice(0, 120) : `Milestone ${index + 1}`,
              description: typeof milestone.description === 'string' ? milestone.description.slice(0, 300) : '',
              dueDate: typeof milestone.dueDate === 'string' ? milestone.dueDate : '',
              status: 'PENDING' as const,
              successMetrics: Array.isArray(milestone.successMetrics) ? milestone.successMetrics.filter((item): item is string => typeof item === 'string').slice(0, 3) : [],
              dependencies: Array.isArray(milestone.dependencies) ? milestone.dependencies.filter((item): item is string => typeof item === 'string').slice(0, 3) : [],
            }))
          : []
        if (milestones.length === 0) return deterministicRoadmap(input)
        // Validate no invented numbers leaked into roadmap text.
        const combined = milestones.map((milestone) => `${milestone.title} ${milestone.description} ${milestone.successMetrics.join(' ')}`).join(' ')
        validateLanguageResponse(combined, evidence, Math.round(facts.last30dRevenue))
        return {
          title: typeof record.title === 'string' && record.title.trim() ? record.title.slice(0, 120) : deterministicRoadmap(input).title,
          milestones,
          expectedOutcomes: Array.isArray(record.expectedOutcomes) ? record.expectedOutcomes.filter((item): item is string => typeof item === 'string').slice(0, 5) : deterministicRoadmap(input).expectedOutcomes,
          confidenceScore: 0.55,
        }
      } catch {
        return deterministicRoadmap(input)
      }
    },

    async generateDecisionLessons(predicted, actual, accuracy): Promise<string> {
      if (!available) return ''
      const numbers = [...Object.values(predicted), ...Object.values(actual)].filter((value): value is number => typeof value === 'number')
      const evidence: EvidenceField[] = numbers.map((value, index) => ({ key: `n${index}`, label: 'Outcome value', value, source: 'decision_log' }))
      const user = `${SYSTEM_PROMPT}\nA merchant decision was reviewed. Accuracy: ${Math.round(accuracy * 100)}/100. Predicted: ${JSON.stringify(predicted)}. Actual: ${JSON.stringify(actual)}. Write 1-2 sentences of lessons learned in a formal tone using only those numbers.`
      try {
        const generation = await provider.generate(SYSTEM_PROMPT, user, { maxTokens: 300 })
        return validateLanguageResponse(generation.text, evidence, numbers[0] ?? 0)
      } catch {
        return ''
      }
    },

    async generateHealthNarrative(diagnosis): Promise<string | null> {
      if (!available) return null
      const evidence: EvidenceField[] = [
        { key: 'score', label: 'Health score', value: diagnosis.score, source: 'executive_health_engine' },
      ]
      const user = `${SYSTEM_PROMPT}\nThe store's health score is ${diagnosis.score}/100 (${diagnosis.status}). Vital signs: ${diagnosis.vitals.map((vital) => `${vital.label} ${vital.status}${vital.value === null ? '' : ` (${vital.value})`}`).join('; ')}. Write a 2-sentence diagnosis narrative using only these numbers.`
      try {
        const generation = await provider.generate(SYSTEM_PROMPT, user, { maxTokens: 300 })
        return validateLanguageResponse(generation.text, evidence, diagnosis.score)
      } catch {
        return null
      }
    },
  }
}

function buildAppendix(facts: ExecutiveFacts): Readonly<Record<string, Readonly<Record<string, string | number | null>>>> {
  const metrics: Record<string, string | number | null> = {
    revenue30d: Math.round(facts.last30dRevenue * 100) / 100,
    revenuePrior30d: Math.round(facts.previous30dRevenue * 100) / 100,
    revenueGrowthPct: Math.round(facts.revenueGrowthPct * 10) / 10,
    orders30d: facts.last30dOrders,
    ordersPrior30d: facts.previous30dOrders,
    ordersGrowthPct: Math.round(facts.ordersGrowthPct * 10) / 10,
    aov: Math.round(facts.aov * 100) / 100,
    repeatPurchaseRatePct: Math.round(facts.repeatRatePct * 10) / 10,
    customerCount: facts.customerCount,
    cancellationRatePct: Math.round(facts.cancellationPct * 1000) / 1000,
    inventoryValue: Math.round(facts.inventoryValue * 100) / 100,
    inventoryTurnover: facts.inventoryTurnover === null ? null : Math.round(facts.inventoryTurnover * 100) / 100,
    healthScore: facts.healthScore,
    healthStatus: facts.healthStatus,
    revenuePercentile: facts.revenuePercentile,
    aovPercentile: facts.aovPercentile,
  }
  const topProducts: Record<string, string | number | null> = {}
  facts.topProducts.forEach((product, index) => {
    topProducts[`product${index + 1}`] = `${product.title} — ${Math.round(product.revenue120d * 100) / 100} (${Math.round(product.sharePct * 10) / 10}%)`
  })
  return { metrics, topProducts: Object.keys(topProducts).length > 0 ? topProducts : { none: null } }
}

function deterministicRoadmap(input: Readonly<{ roadmapType: RoadmapType; facts: ExecutiveFacts; opportunities: readonly ExecutiveOpportunity[]; risks: readonly ExecutiveRisk[]; goal: string | null }>): Readonly<{ title: string; milestones: readonly RoadmapMilestone[]; expectedOutcomes: readonly string[]; confidenceScore: number }> {
  const facts = input.facts
  const start = new Date(facts.asOf)
  const weeks = roadmapTypeToWeeks(input.roadmapType)
  const milestoneCount = Math.min(weeks, 6)
  const baseActions: Array<{ title: string; description: string; metrics: readonly string[] }> = [
    { title: 'Secure the revenue baseline', description: 'Resolve the top active risk and protect the current run rate.', metrics: ['Top risk mitigated', 'Revenue stable vs prior 30 days'] },
    { title: 'Execute the highest-value opportunity', description: 'Start the strongest modelled opportunity with an owner and a weekly checkpoint.', metrics: ['Initiative started', 'First measurable result'] },
    { title: 'Improve retention mechanics', description: 'Launch the second-purchase flow and track repeat rate weekly.', metrics: ['Repeat rate +2 points'] },
    { title: 'Tighten inventory discipline', description: 'Set reorder points from 30-day velocity and clear slow movers.', metrics: ['No stockouts on selling SKUs', 'Turnover improved'] },
    { title: 'Review and re-forecast', description: 'Re-run the health diagnosis and decision review before the next cycle.', metrics: ['Health score recorded', 'Forecast variance logged'] },
  ]
  if (input.opportunities[0]) baseActions[1] = { title: input.opportunities[0].title, description: input.opportunities[0].description.slice(0, 160), metrics: ['Milestone deliverable shipped', 'Impact tracked vs estimate'] }
  if (input.risks[0]) baseActions[0] = { title: `Mitigate: ${input.risks[0].title}`, description: input.risks[0].mitigationPlan[0]?.step ?? 'Execute the first mitigation step.', metrics: ['Mitigation step completed'] }
  const milestones: RoadmapMilestone[] = []
  for (let index = 0; index < milestoneCount; index += 1) {
    const action = baseActions[index % baseActions.length]!
    const due = new Date(start.getTime() + (index + 1) * 7 * 86_400_000)
    milestones.push({
      key: `m${index + 1}`,
      title: index === 0 ? action.title : `${action.title}${index >= baseActions.length ? ` — cycle ${Math.floor(index / baseActions.length) + 1}` : ''}`,
      description: action.description,
      dueDate: due.toISOString().slice(0, 10),
      status: 'PENDING' as const,
      successMetrics: [...action.metrics],
      dependencies: index === 0 ? [] : [`m${index}`],
    })
  }
  return {
    title: input.goal ? `${input.goal} — ${input.roadmapType.replace('_', ' ').toLowerCase()} plan` : `${input.roadmapType.replace('_', '-').toLowerCase()} growth plan`,
    milestones,
    expectedOutcomes: [
      `Repeat purchase rate above ${Math.min(facts.repeatRatePct + 2, 40).toFixed(0)}%`,
      'Top risk moved to MITIGATED',
      'Health score re-diagnosed at the end of the period',
    ],
    confidenceScore: 0.55,
  }
}

function roadmapTypeToWeeks(type: RoadmapType): number {
  if (type === '30_DAY') return 4
  if (type === '60_DAY') return 8
  if (type === '90_DAY' || type === 'QUARTERLY') return 12
  return 52
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function executiveAiUnavailableError(): AppError {
  return new AppError('DEPENDENCY_ERROR', 'GrowthIQ language provider is not configured', 503)
}
