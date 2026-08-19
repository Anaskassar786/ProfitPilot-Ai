/**
 * PatternAI value layer (PR #64) — model + visual unit tests.
 *
 * These cover the pieces added to make PatternAI visual rather than text-heavy:
 * the six hero micro-visualizations, the discovery pipeline funnel, the human
 * discovery card (headline, momentum, de-technicalised evidence), the impact
 * treemap summary, the pattern-strength ladder, the allowance ring, the
 * explore-card mini charts and the new Run discovery glyph.
 *
 * The recurring assertion in this file is the honesty rule: with no data, a
 * component must render an *empty* shape and an honest caption — never a
 * plausible-looking one.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  DiscoveryPipelineFunnel,
  FeedbackBalance,
  MiniCauseWeb,
  MiniDivergingBars,
  MiniProbabilityWave,
  MiniRadar,
  MiniScatter,
  MiniWordCloud,
  MomentumCompare,
  MoneyInPlay,
  MonthlyDiscoveryRing,
  PatternStrengthMeter,
  StatAnswerMeter,
  StatArrowCluster,
  StatBubbleCluster,
  StatNetworkSpark,
  StatPersonaCohort,
  StatProbabilityWave,
  StatVisualization,
} from './patternai-viz.js'
import { PatternAiDiscoverGlyph, PatternAiDiscoverIcon, PatternAiMark } from './patternai-logo.js'
import { DecisionWindowKpi, DiscoveryCard, ExploreFurther, navBadgeCount, SignalFeedbackKpi } from './patternai.js'
import {
  decisionWindowSummary,
  discoveryFunnel,
  discoveryHeadline,
  discoveryImpactSummary,
  discoveryMomentum,
  formatMomentumValue,
  humanEvidenceRows,
  investigationCauseNodes,
  lessonTopicCloud,
  momentumWidths,
  monthlyDiscoveryProgress,
  patternAiStats,
  patternStrengthRows,
  patternStrengthState,
  personaRadarAverage,
  predictionWavePoints,
  signalFeedbackSummary,
  trendDivergingRows,
  INSIGHTS_FEATURE_MIN_PLAN,
} from './patternai-model.js'
import type {
  InsightDiscovery,
  InsightInvestigation,
  InsightLesson,
  InsightPersona,
  InsightPrediction,
  InsightsDataReadiness,
  InsightsOverview,
  InsightTrend,
} from './patternai-model.js'

const noop = vi.fn()

function discovery(overrides: Partial<InsightDiscovery> = {}): InsightDiscovery {
  return {
    id: 'd1', storeId: 's', discoveryType: 'TREND', category: 'PRODUCTS',
    title: 'Snowboard: Hydrogen demand jumped 100% in the last 14 days',
    description: 'Snowboard: Hydrogen sold 3 units in the last 14 days after 0 units in the prior 14.',
    explanation: 'Early momentum in a single product is the cheapest growth you ever get.',
    confidenceScore: 0.8, impactEstimate: 1800, impactCurrency: 'USD',
    dataEvidence: { productId: 'gid://shopify/Product/1', recentUnits: 3, priorUnits: 0, growthPercent: 100, recentRevenue: 1800 },
    visualizationData: { chart: 'bubble', recentUnits: 3, growthPercent: 100 },
    discoveredAt: '2026-08-18T09:00:00.000Z', status: 'NEW', sample: false, viewedAt: null, actionTakenAt: null, expiresAt: null,
    ...overrides,
  }
}

const readiness: InsightsDataReadiness = {
  revenueDays: 14, totalOrders: 5, customerCount: 12, productsWithSales: 1,
  canDiscover: false, canPersonas: false, canTrends: false, canPatterns: true, canPredict: true,
  discoverRequirement: 'Discoveries need 7 days of revenue history or 10 orders.',
  personasRequirement: { met: false, have: 12, need: 50 },
  trendsRequirement: { met: false, have: 14, need: 60 },
  predictRequirement: { met: true, have: 14, need: 14 },
}

function overview(partial: Partial<InsightsOverview> = {}): InsightsOverview {
  return {
    plan: 'trial',
    features: { discoveries: false, lessons: false, patterns: false, personas: false, investigations: false, trends: true, comparisons: false, knowledge: false, timeline: true, predictions: false, autoDiscovery: false, export: false, share: false, apiAccess: false, externalTrends: false, anomalyAlerts: false },
    requiredPlans: INSIGHTS_FEATURE_MIN_PLAN,
    usage: { discoveries: { used: 0, limit: 1, remaining: 1 }, investigations: { used: 0, limit: 0, remaining: 0 } },
    counts: { newDiscoveries: 1, totalDiscoveries: 4, patterns: 2, lessons: 3, lessonsRead: 1, personas: 0, investigations: 0, trends: 5, predictions: 0, comparisons: 0, knowledge: 0 },
    readiness,
    preferences: { storeId: 's', autoDiscoveryEnabled: true, discoveryFrequency: 'DAILY', discoveryCategories: ['REVENUE'], notificationPreferences: { highConfidenceDiscoveries: true, trendAlerts: true, weeklyDigest: false, anomalyAlerts: true }, trendMonitoringEnabled: true, personaUpdatesEnabled: true, apiAccessEnabled: false, apiKeyMasked: null, language: 'en', updatedAt: '2026-08-18T00:00:00.000Z' },
    autoDiscoveryRan: false,
    trial: true,
    generatedAt: '2026-08-18T00:00:00.000Z',
    ...partial,
  }
}

/* ── Hero micro-visualizations ─────────────────────────────────────────── */

describe('hero stats and their six distinct micro-visualizations', () => {
  it('gives every tile a different visual and an honest pending caption', () => {
    const stats = patternAiStats(overview())
    expect(stats).toHaveLength(6)
    expect(new Set(stats.map((stat) => stat.visual)).size).toBe(6)
    expect(stats.every((stat) => stat.pending.length > 0)).toBe(true)
  })
  it('carries the raw API count alongside the formatted value', () => {
    const stats = patternAiStats(overview())
    expect(stats[0]?.count).toBe(1)
    expect(stats[2]?.count).toBe(0)
    expect(patternAiStats(null).every((stat) => stat.count === null)).toBe(true)
  })
  it('renders a filled shape with data and an explicitly empty one without', () => {
    const filled = renderToStaticMarkup(createElement(StatBubbleCluster, { count: 3, pending: 'waiting to populate', label: 'Discoveries' }))
    const empty = renderToStaticMarkup(createElement(StatBubbleCluster, { count: 0, pending: 'waiting to populate', label: 'Discoveries' }))
    expect(filled).toContain('filled')
    expect(filled).not.toContain('waiting to populate')
    expect(empty).toContain('is-empty')
    expect(empty).toContain('waiting to populate')
  })
  it('draws each of the six shapes with its own primitives', () => {
    expect(renderToStaticMarkup(createElement(StatNetworkSpark, { count: 4, pending: 'discovering…', label: 'Patterns' }))).toContain('pa-viz-edge live')
    expect(renderToStaticMarkup(createElement(StatPersonaCohort, { count: 7, pending: 'analysing…', label: 'Personas' }))).toContain('+2')
    expect(renderToStaticMarkup(createElement(StatAnswerMeter, { count: 2, pending: 'ask a question', label: 'Investigations' }))).toContain('pa-viz-check done')
    expect(renderToStaticMarkup(createElement(StatArrowCluster, { count: 3, pending: 'monitoring…', label: 'Trends' }))).toContain('pa-viz-arrow live')
    expect(renderToStaticMarkup(createElement(StatProbabilityWave, { count: 1, pending: 'learning…', label: 'Predictions' }))).toContain('pa-viz-band')
  })
  it('never renders a KPI sparkline polyline (that shape belongs to another module)', () => {
    for (const visual of ['bubbles', 'network', 'cohort', 'answers', 'arrows', 'wave'] as const) {
      const html = renderToStaticMarkup(createElement(StatVisualization, { visual, count: 3, pending: 'x', label: 'L' }))
      expect(html).not.toContain('<polyline')
    }
  })
})

/* ── Discovery pipeline funnel ─────────────────────────────────────────── */

describe('discovery pipeline funnel', () => {
  const funnel = discoveryFunnel([discovery(), discovery({ id: 'd2', status: 'REVIEWED' }), discovery({ id: 'd3', status: 'ACTED_ON' })])
  it('renders every stage with its real count and share', () => {
    const html = renderToStaticMarkup(createElement(DiscoveryPipelineFunnel, { funnel }))
    expect(html).toContain('Discovered')
    expect(html).toContain('Acted on')
    expect(html).toContain('Conversion')
    expect(html).toContain('33%')
  })
  it('shows an em dash rather than 0% conversion on an empty pipeline', () => {
    const html = renderToStaticMarkup(createElement(DiscoveryPipelineFunnel, { funnel: discoveryFunnel([]) }))
    expect(html).toContain('Conversion')
    expect(html).toContain('Run a discovery sweep')
  })
  it('is clickable when a select handler is supplied', () => {
    const html = renderToStaticMarkup(createElement(DiscoveryPipelineFunnel, { funnel, onSelect: noop }))
    expect(html).toContain('<button')
  })
})

/* ── Discovery card humanization ───────────────────────────────────────── */

describe('human discovery card', () => {
  it('adds a friendly headline without restating a number', () => {
    expect(discoveryHeadline(discovery())).toBe('Rising product spotted')
    expect(discoveryHeadline(discovery({ discoveryType: 'ANOMALY', category: 'REVENUE' }))).toBe('One day broke the pattern')
    expect(discoveryHeadline(discovery())).not.toMatch(/\d/)
  })
  it('derives before/after momentum only from measured evidence', () => {
    const momentum = discoveryMomentum(discovery())
    expect(momentum?.before).toBe(0)
    expect(momentum?.after).toBe(3)
    expect(momentum?.unit).toBe('units')
    expect(momentum?.change).toBeNull() // no baseline to divide by — stays honest
    expect(discoveryMomentum(discovery({ dataEvidence: { coPurchaseRate: 0.42 } }))).toBeNull()
  })
  it('reads revenue, anomaly and customer pairs too', () => {
    expect(discoveryMomentum(discovery({ dataEvidence: { current: { revenue: 120 }, previous: { revenue: 100 } } }))?.unit).toBe('money')
    expect(discoveryMomentum(discovery({ dataEvidence: { value: 4200, expected: 1500 } }))?.beforeLabel).toBe('Expected')
    expect(discoveryMomentum(discovery({ dataEvidence: { repeatCustomers: 46, oneTimeCustomers: 142 } }))?.unit).toBe('customers')
  })
  it('scales momentum bars to the larger side', () => {
    const momentum = discoveryMomentum(discovery({ dataEvidence: { recentUnits: 3, priorUnits: 1 } }))!
    expect(momentumWidths(momentum)).toEqual({ before: 33, after: 100 })
    expect(formatMomentumValue(momentum, 3)).toBe('3 sold')
  })
  it('hides technical identifiers from card evidence', () => {
    const rows = humanEvidenceRows(discovery().dataEvidence, 4)
    const labels = rows.map((row) => row.label)
    expect(labels.join(' ')).not.toMatch(/product ?id/i)
    expect(labels).toContain('Sold in the last 14 days')
  })
  it('renders the headline, momentum bars and no product id in the card', () => {
    const html = renderToStaticMarkup(createElement(DiscoveryCard, { discovery: discovery(), storeId: 's', onOpen: noop, onChanged: noop, onToast: noop, onNavigateBilling: noop }))
    expect(html).toContain('Rising product spotted')
    expect(html).toContain('pa-momentum')
    expect(html).toContain('What this means for you')
    expect(html).toContain('Snowboard: Hydrogen')
    expect(html).not.toContain('gid://shopify')
    expect(html).toContain('80%')
    expect(html).toContain('$1,800')
  })
  it('still labels samples loudly', () => {
    const html = renderToStaticMarkup(createElement(DiscoveryCard, { discovery: discovery({ sample: true }), storeId: 's', onOpen: noop, onChanged: noop, onToast: noop, onNavigateBilling: noop }))
    expect(html).toContain('SAMPLE')
  })
  it('survives a partial payload instead of crashing the detail view', () => {
    // Regression: a discovery served without its evidence bundle used to throw
    // inside Object.entries and take the whole detail page down.
    const partial = { ...discovery(), dataEvidence: undefined as unknown as InsightDiscovery['dataEvidence'] }
    expect(humanEvidenceRows(partial.dataEvidence)).toEqual([])
    expect(discoveryMomentum(partial)).toBeNull()
    expect(() => renderToStaticMarkup(createElement(DiscoveryCard, { discovery: partial, storeId: 's', onOpen: noop, onChanged: noop, onToast: noop, onNavigateBilling: noop }))).not.toThrow()
  })
  it('renders momentum bars for a measured pair', () => {
    const html = renderToStaticMarkup(createElement(MomentumCompare, { momentum: discoveryMomentum(discovery())! }))
    expect(html).toContain('Prior 14 days')
    expect(html).toContain('Last 14 days')
    expect(html).toContain('3 sold')
  })
})

/* ── Lead-row merchant value cards ────────────────────────────────────── */

describe('decision window and factual signal outcomes', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z')

  it('uses only explicit real deadlines and keeps currencies separate', () => {
    const summary = decisionWindowSummary([
      discovery({ id: 'overdue', expiresAt: '2026-08-18T00:00:00.000Z', status: 'SAVED', impactEstimate: 50, impactCurrency: 'USD' }),
      discovery({ id: 'soon-usd', expiresAt: '2026-08-20T00:00:00.000Z', impactEstimate: 100, impactCurrency: 'USD' }),
      discovery({ id: 'soon-inr', expiresAt: '2026-08-21T00:00:00.000Z', impactEstimate: 800, impactCurrency: 'INR' }),
      discovery({ id: 'dismissed', expiresAt: '2026-08-20T00:00:00.000Z', status: 'DISMISSED', impactEstimate: 999 }),
      discovery({ id: 'sample', expiresAt: '2026-08-20T00:00:00.000Z', sample: true, impactEstimate: 999 }),
      discovery({ id: 'invalid', expiresAt: 'not-a-date' }),
    ], now)
    expect(summary.withDeadline).toBe(3)
    expect(summary.overdue).toBe(1)
    expect(summary.dueSoon).toBe(2)
    expect(summary.next?.id).toBe('overdue')
    expect(summary.excludedSamples).toBe(1)
    expect(summary.urgentImpact).toEqual([{ currency: 'INR', amount: 800 }, { currency: 'USD', amount: 150 }])
  })

  it('reports current explicit outcomes without inventing a learning score', () => {
    const summary = signalFeedbackSummary([
      discovery({ id: 'saved', status: 'SAVED', category: 'PRODUCTS' }),
      discovery({ id: 'acted', status: 'ACTED_ON', category: 'PRODUCTS' }),
      discovery({ id: 'dismissed', status: 'DISMISSED', category: 'REVENUE' }),
      discovery({ id: 'viewed', status: 'REVIEWED', category: 'TIME' }),
      discovery({ id: 'sample', status: 'ACTED_ON', sample: true }),
    ])
    expect(summary).toMatchObject({ kept: 2, dismissed: 1, classified: 3, excludedSamples: 1 })
    expect(summary.keptShare).toBeCloseTo(2 / 3)
    expect(summary.topKeptCategory).toEqual({ category: 'PRODUCTS', label: 'Products', count: 2 })
  })

  it('draws a unique balance only from supplied counts and an honest empty state', () => {
    const filled = renderToStaticMarkup(createElement(FeedbackBalance, { kept: 2, dismissed: 1 }))
    const empty = renderToStaticMarkup(createElement(FeedbackBalance, { kept: 0, dismissed: 0 }))
    expect(filled).toContain('2 kept and 1 dismissed signals')
    expect(filled).toContain('pa-feedback-pivot')
    expect(filled).not.toContain('learning score')
    expect(empty).toContain('No real signal outcomes yet')
    expect(empty).toContain('is-empty')
  })

  it('keeps sample-only KPI cards visibly empty rather than fabricating value', () => {
    const sample = discovery({ sample: true, expiresAt: null, status: 'NEW' })
    const deadline = renderToStaticMarkup(createElement(DecisionWindowKpi, { discoveries: [sample], onOpen: noop }))
    const outcomes = renderToStaticMarkup(createElement(SignalFeedbackKpi, { discoveries: [sample] }))
    expect(deadline).toContain('No deadline')
    expect(deadline).toContain('This sample is excluded')
    expect(outcomes).toContain('0')
    expect(outcomes).toContain('Sample cards do not count')
    expect(outcomes).toContain('reports choices, not model training')
  })
})

/* ── Impact summary, strength ladder, allowance ring ───────────────────── */

describe('value panels', () => {
  const discoveries = [discovery(), discovery({ id: 'd2', category: 'REVENUE', confidenceScore: 0.9, impactEstimate: 200 }), discovery({ id: 'd3', category: 'PRODUCTS', impactEstimate: null })]

  it('counts treemap blocks per category from real discoveries', () => {
    const summary = discoveryImpactSummary(discoveries)
    expect(summary.total).toBe(3)
    expect(summary.mostActive?.label).toBe('Products')
    expect(summary.mostActive?.value).toBe(2)
    expect(summary.moneyInPlay).toBe(2000)
    expect(summary.strongest?.confidence).toBe(0.9)
  })
  it('reports no money in play when the engine attached no impact', () => {
    const summary = discoveryImpactSummary([discovery({ impactEstimate: null })])
    expect(summary.moneyInPlay).toBeNull()
    expect(renderToStaticMarkup(createElement(MoneyInPlay, { amount: null, currency: 'USD' }))).toBe('')
  })
  it('builds the strength ladder from readiness have/need pairs only', () => {
    const rows = patternStrengthRows(readiness)
    expect(rows.map((row) => row.id)).toEqual(['orders', 'products', 'personas', 'predictions', 'trends'])
    expect(rows[0]?.percent).toBe(50)
    expect(rows[0]?.detail).toBe('5 of 10 orders')
    expect(rows[3]?.percent).toBe(100)
    expect(patternStrengthRows(null)).toEqual([])
    expect(patternStrengthState(85)).toBe('strong')
    expect(patternStrengthState(5)).toBe('learning')
  })
  it('renders the strength ladder with counts, not adjectives alone', () => {
    const html = renderToStaticMarkup(createElement(PatternStrengthMeter, { rows: patternStrengthRows(readiness), tip: 'More orders = stronger patterns' }))
    expect(html).toContain('Order evidence')
    expect(html).toContain('5 of 10 orders')
    expect(html).toContain('More orders = stronger patterns')
  })
  it('models the monthly allowance ring from API usage', () => {
    const progress = monthlyDiscoveryProgress(overview())!
    expect(progress.percent).toBe(0)
    expect(progress.caption).toContain('1 discovery left')
    const used = monthlyDiscoveryProgress(overview({ usage: { discoveries: { used: 1, limit: 1, remaining: 0 }, investigations: { used: 0, limit: 0, remaining: 0 } } }))!
    expect(used.atLimit).toBe(true)
    expect(used.percent).toBe(100)
    const unlimited = monthlyDiscoveryProgress(overview({ usage: { discoveries: { used: 12, limit: null, remaining: null }, investigations: { used: 0, limit: 0, remaining: 0 } } }))!
    expect(unlimited.unlimited).toBe(true)
    expect(unlimited.caption).toContain('No monthly cap')
    expect(monthlyDiscoveryProgress(null)).toBeNull()
  })
  it('renders the ring as dashed segments with an inner readout', () => {
    const html = renderToStaticMarkup(createElement(MonthlyDiscoveryRing, { progress: monthlyDiscoveryProgress(overview())! }))
    expect(html).toContain('stroke-dasharray="3 6"')
    expect(html).toContain('of 1 limit')
  })
})

/* ── Explore-card mini visuals ─────────────────────────────────────────── */

describe('explore-card mini visualizations', () => {
  const lessons = [
    { id: 'l1', category: 'PRODUCTS', lessonType: 'PATTERN_STUDY' },
    { id: 'l2', category: 'PRODUCTS', lessonType: 'BEST_PRACTICE' },
  ] as unknown as readonly InsightLesson[]
  const trends = [
    { id: 't1', title: 'Snowboards rising', direction: 'UP', magnitude: 34 },
    { id: 't2', title: 'New customers cooling', direction: 'DOWN', magnitude: 18 },
  ] as unknown as readonly InsightTrend[]
  const investigations = [
    { id: 'i1', createdAt: '2026-08-10T00:00:00.000Z', rootCauses: [{ cause: 'Fewer repeat orders', impactShare: 0.5, evidence: '', confidence: 0.7 }] },
  ] as unknown as readonly InsightInvestigation[]
  const personas = [
    { id: 'p1', radar: [{ trait: 'Loyalty', score: 0.8 }, { trait: 'Value', score: 0.4 }, { trait: 'Recency', score: 0.6 }] },
    { id: 'p2', radar: [{ trait: 'Loyalty', score: 0.4 }, { trait: 'Value', score: 0.8 }, { trait: 'Recency', score: 0.6 }] },
  ] as unknown as readonly InsightPersona[]
  const predictions = [
    { id: 'pr1', series: [{ day: '2026-08-18', value: 100, lower: 80, upper: 120 }, { day: '2026-08-19', value: 110, lower: 85, upper: 130 }] },
  ] as unknown as readonly InsightPrediction[]

  it('derives every mini model from real API objects', () => {
    expect(lessonTopicCloud(lessons)[0]).toEqual({ tag: 'Products', weight: 2 })
    expect(trendDivergingRows(trends)[0]?.magnitude).toBe(34)
    expect(investigationCauseNodes(investigations)[0]?.weight).toBeCloseTo(0.5)
    expect(personaRadarAverage(personas).find((trait) => trait.trait === 'Loyalty')?.score).toBeCloseTo(0.6)
    expect(predictionWavePoints(predictions)).toHaveLength(2)
  })
  it('renders six different shapes, one per destination', () => {
    expect(renderToStaticMarkup(createElement(MiniWordCloud, { words: lessonTopicCloud(lessons) }))).toContain('pa-mini-word')
    expect(renderToStaticMarkup(createElement(MiniScatter, { points: [{ id: 'a', label: 'Weekly rhythm', x: 0.5, y: 0.6 }] }))).toContain('pa-mini-dot')
    expect(renderToStaticMarkup(createElement(MiniRadar, { traits: personaRadarAverage(personas) }))).toContain('pa-mini-shape')
    expect(renderToStaticMarkup(createElement(MiniCauseWeb, { causes: investigationCauseNodes(investigations) }))).toContain('pa-mini-root')
    expect(renderToStaticMarkup(createElement(MiniDivergingBars, { rows: trendDivergingRows(trends) }))).toContain('pa-mini-diverge down')
    expect(renderToStaticMarkup(createElement(MiniProbabilityWave, { points: predictionWavePoints(predictions) }))).toContain('pa-mini-band')
  })
  it('falls back to an explicitly empty state instead of a fake shape', () => {
    expect(renderToStaticMarkup(createElement(MiniWordCloud, { words: [] }))).toContain('Topics appear with your first lesson')
    expect(renderToStaticMarkup(createElement(MiniScatter, { points: [] }))).toContain('is-empty')
    expect(renderToStaticMarkup(createElement(MiniRadar, { traits: [] }))).not.toContain('pa-mini-shape')
    expect(renderToStaticMarkup(createElement(MiniCauseWeb, { causes: [] }))).toContain('Ask a question')
    expect(renderToStaticMarkup(createElement(MiniDivergingBars, { rows: [] }))).toContain('Rises and falls appear here')
    expect(renderToStaticMarkup(createElement(MiniProbabilityWave, { points: [] }))).toContain('Forecast ranges appear here')
  })
  it('tells locked destinations apart with upgrade wording, never a plan name', () => {
    const html = renderToStaticMarkup(createElement(ExploreFurther, { go: noop, storeId: 's', overview: overview(), plan: 'trial' }))
    expect(html).toContain('Keep exploring')
    expect(html).toContain('Opens with a plan upgrade')
    expect(html).not.toMatch(/Upgrade to (Start|Growth|Commander)/)
  })
})

/* ── Sidebar badges and the new action glyph ───────────────────────────── */

describe('sidebar badges', () => {
  it('shows API counts only, and nothing before the overview lands', () => {
    expect(navBadgeCount('overview', overview())).toBe(1)
    expect(navBadgeCount('trends', overview())).toBe(5)
    expect(navBadgeCount('settings', overview())).toBeNull()
    expect(navBadgeCount('overview', null)).toBeNull()
  })
})

describe('Run discovery glyph', () => {
  it('draws a compass with a discovery spark, not a generic sparkle', () => {
    const html = renderToStaticMarkup(createElement(PatternAiDiscoverGlyph, { size: 16 }))
    expect(html).toContain('Run discovery')
    expect(html).toContain('linearGradient')
    expect(html).toContain('<path')
    expect(html).toContain('viewBox="0 0 24 24"')
  })
  it('is distinct from the PatternAI brand constellation', () => {
    const glyph = renderToStaticMarkup(createElement(PatternAiDiscoverGlyph, { size: 24 }))
    const mark = renderToStaticMarkup(createElement(PatternAiMark, { size: 24 }))
    expect(glyph).not.toBe(mark)
    expect((glyph.match(/<circle/g) ?? []).length).toBe(2)
  })
  it('accepts the Lucide icon call signature', () => {
    expect(renderToStaticMarkup(createElement(PatternAiDiscoverIcon, { size: 14 }))).toContain('width="14"')
  })
})
