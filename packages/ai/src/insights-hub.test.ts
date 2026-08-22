import { describe, expect, it } from 'vitest'
import { AppError } from '@profitpilot/types'
import {
  COMPARISON_TYPES,
  INSIGHTS_PLAN_LIMITS,
  PERSONA_MIN_CUSTOMERS,
  autoDiscoveryDue,
  buildPersonas,
  coPurchaseOpportunities,
  defaultInsightsPreferences,
  decliningProducts,
  detectPatterns,
  detectRevenueAnomalies,
  detectTrends,
  forecastOrders,
  forecastRevenue,
  generateDiscoveries,
  generateLesson,
  generateLessonLibrary,
  insightsDataReadiness,
  insightsFeatureAccess,
  insightsHubEnvConfig,
  insightsLimitError,
  insightsUpgradeError,
  investigate,
  monthlyTotals,
  periodOverPeriod,
  predictStockouts,
  repeatCustomerSegment,
  requiredPlanForInsightsFeature,
  revenueConcentration,
  risingProducts,
  runComparison,
  searchKnowledge,
  shiftDay,
  suggestKnowledgeTags,
  summarizeUsage,
  timelineFromEntities,
  trialSampleDiscoveries,
  weekdayProfile,
} from './insights-hub.js'
import type { InsightsDataset } from './insights-hub.js'

const NOW = '2026-08-18T02:00:00.000Z'

/** Builds a realistic 90-day dataset — all numbers deterministic. */
function makeDataset(overrides: Partial<InsightsDataset> = {}): InsightsDataset {
  const revenueDaily: InsightsDataset['revenueDaily'][number][] = []
  const ordersDaily: InsightsDataset['ordersDaily'][number][] = []
  const productSalesDaily: InsightsDataset['productSalesDaily'][number][] = []
  for (let offset = 89; offset >= 0; offset -= 1) {
    const day = shiftDay('2026-08-17', -offset)
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    // Saturdays are the strong day; Mondays the weak day. Gentle upward trend.
    const weekdayFactor = weekday === 6 ? 1.6 : weekday === 1 ? 0.5 : 1
    const trend = 1 + (89 - offset) * 0.003
    const orders = Math.max(1, Math.round(12 * weekdayFactor * trend))
    const revenue = Math.round(orders * 41 * 100) / 100
    revenueDaily.push({ day, grossRevenue: revenue, orderCount: orders })
    ordersDaily.push({ day, orderCount: orders, averageOrderValue: 41 })
    productSalesDaily.push({ day, productId: 'p1', unitsSold: Math.round(orders * 0.6), grossRevenue: Math.round(revenue * 0.62 * 100) / 100 })
    productSalesDaily.push({ day, productId: 'p2', unitsSold: Math.round(orders * 0.3), grossRevenue: Math.round(revenue * 0.28 * 100) / 100 })
    productSalesDaily.push({ day, productId: 'p3', unitsSold: Math.max(1, Math.round(orders * 0.1)), grossRevenue: Math.round(revenue * 0.1 * 100) / 100 })
  }
  const customers: InsightsDataset['customers'][number][] = []
  for (let index = 0; index < 80; index += 1) {
    const loyal = index % 3 === 0
    customers.push({
      customerKey: `c${index}`,
      lifetimeValue: loyal ? 320 + index : 60 + (index % 40),
      orderCount: loyal ? 5 : index % 4 === 0 ? 2 : 1,
      daysSinceLastOrder: loyal ? 12 + (index % 20) : index % 4 === 0 ? 80 : 40 + (index % 200),
      firstOrderDay: '2026-01-05',
    })
  }
  return {
    storeId: 'store-1',
    currency: 'USD',
    revenueDaily,
    ordersDaily,
    productSalesDaily,
    products: [
      { productId: 'p1', title: 'Meridian Hoodie', price: 68, category: 'Apparel' },
      { productId: 'p2', title: 'Trail Cap', price: 32, category: 'Accessories' },
      { productId: 'p3', title: 'Camp Socks', price: 14, category: 'Apparel' },
    ],
    customers,
    productPairs: [
      { productId: 'p1', relatedProductId: 'p3', coPurchaseRate: 0.46 },
      { productId: 'p1', relatedProductId: 'p2', coPurchaseRate: 0.3 },
    ],
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: hour === 19 ? 46 : hour >= 17 && hour <= 21 ? 20 : 4, revenue: hour === 19 ? 1886 : 164 })),
    ...overrides,
  }
}

function emptyDataset(): InsightsDataset {
  return { storeId: 'store-1', currency: 'USD', revenueDaily: [], ordersDaily: [], productSalesDaily: [], products: [], customers: [], productPairs: [] }
}

describe('insights hub environment configuration', () => {
  it('reads the dedicated key and nemotron models from env', () => {
    const config = insightsHubEnvConfig({
      INSIGHTS_HUB_API_KEY: 'sk-or-v1-test',
      INSIGHTS_HUB_MODEL_PRIMARY: 'nvidia/nemotron-3.5-lightning:free',
      INSIGHTS_HUB_MODEL_FALLBACK: 'nvidia/nemotron-3-super:free',
      INSIGHTS_HUB_RATE_LIMIT_PER_STORE: '25',
    })
    expect(config.apiKey).toBe('sk-or-v1-test')
    expect(config.models).toEqual(['nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-super:free'])
    expect(config.rateLimitPerStore).toBe(25)
    expect(config.enabled).toBe(true)
    expect(config.dailyBudgetUsd).toBe(0)
  })
  it('falls back to the documented nemotron defaults', () => {
    const config = insightsHubEnvConfig({})
    // QA 2026-08-22: the old `nemotron-3-super:free` slug was delisted; the
    // fallback chain now points at a live endpoint.
    expect(config.models).toEqual(['nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-super-120b-a12b:free'])
    expect(config.minConfidenceScore).toBe(0.7)
    expect(config.apiRateLimit).toBe(100)
  })
})

describe('plan-based feature matrix', () => {
  it('trial sees samples and timeline but no generative features', () => {
    expect(INSIGHTS_PLAN_LIMITS.trial.discoveriesPerMonth).toBe(1)
    expect(INSIGHTS_PLAN_LIMITS.trial.timelineDays).toBe(7)
    expect(insightsFeatureAccess('trial', 'personas').allowed).toBe(false)
    expect(insightsFeatureAccess('trial', 'investigations').allowed).toBe(false)
    expect(insightsFeatureAccess('trial', 'comparisons').allowed).toBe(false)
    expect(insightsFeatureAccess('trial', 'knowledge').allowed).toBe(false)
    expect(insightsFeatureAccess('trial', 'predictions').allowed).toBe(false)
    expect(insightsFeatureAccess('trial', 'trends').allowed).toBe(true)
    expect(insightsFeatureAccess('trial', 'timeline').allowed).toBe(true)
  })
  it('start unlocks capped discoveries, personas, investigations', () => {
    expect(INSIGHTS_PLAN_LIMITS.start.discoveriesPerMonth).toBe(5)
    expect(INSIGHTS_PLAN_LIMITS.start.personasLimit).toBe(2)
    expect(INSIGHTS_PLAN_LIMITS.start.investigationsPerMonth).toBe(3)
    expect(INSIGHTS_PLAN_LIMITS.start.comparisonTypes).toEqual(['PRODUCT', 'PERIOD'])
    expect(INSIGHTS_PLAN_LIMITS.start.predictionHorizons).toEqual(['7_DAYS'])
    expect(insightsFeatureAccess('start', 'apiAccess').allowed).toBe(false)
    expect(insightsFeatureAccess('start', 'export').allowed).toBe(false)
  })
  it('growth unlocks share/export/daily trends but not API access', () => {
    expect(INSIGHTS_PLAN_LIMITS.growth.discoveriesPerMonth).toBe(20)
    expect(insightsFeatureAccess('growth', 'export').allowed).toBe(true)
    expect(insightsFeatureAccess('growth', 'share').allowed).toBe(true)
    expect(insightsFeatureAccess('growth', 'anomalyAlerts').allowed).toBe(true)
    expect(insightsFeatureAccess('growth', 'apiAccess').allowed).toBe(false)
    expect(INSIGHTS_PLAN_LIMITS.growth.comparisonTypes).toEqual(COMPARISON_TYPES)
  })
  it('commander unlocks everything including API access', () => {
    expect(insightsFeatureAccess('commander', 'apiAccess').allowed).toBe(true)
    expect(INSIGHTS_PLAN_LIMITS.commander.predictionHorizons).toEqual(['7_DAYS', '30_DAYS', '90_DAYS'])
    expect(INSIGHTS_PLAN_LIMITS.commander.timelineDays).toBeNull()
    expect(INSIGHTS_PLAN_LIMITS.commander.patternsLimit).toBeNull()
    expect(INSIGHTS_PLAN_LIMITS.commander.apiRateLimitPerHour).toBe(100)
  })
  it('reports the required plan for each gated feature', () => {
    expect(requiredPlanForInsightsFeature('apiAccess')).toBe('commander')
    expect(requiredPlanForInsightsFeature('export')).toBe('growth')
    expect(requiredPlanForInsightsFeature('investigations')).toBe('start')
  })
  it('builds 402 upgrade errors with generic Upgrade Plan CTAs', () => {
    const upgrade = insightsUpgradeError('apiAccess', 'growth')
    expect(upgrade.status).toBe(402)
    expect(upgrade.code).toBe('PAYMENT_REQUIRED')
    expect(upgrade.details.reason).toBe('UPGRADE_REQUIRED')
    expect(upgrade.details.cta).toBe('Upgrade Plan')
    expect(JSON.stringify(upgrade.details)).not.toContain('Upgrade to')
    const limit = insightsLimitError('discoveries', 'start', 5, 5, 'discoveries')
    expect(limit.status).toBe(402)
    expect(limit.details.used).toBe(5)
    expect(limit.details.limit).toBe(5)
    expect(limit.details.cta).toBe('Upgrade Plan')
  })
  it('flags errors as AppError instances', () => {
    expect(insightsUpgradeError('personas', 'trial')).toBeInstanceOf(AppError)
  })
})

describe('data readiness (honest empty states)', () => {
  it('reports zero states on an empty dataset', () => {
    const readiness = insightsDataReadiness(emptyDataset())
    expect(readiness.canDiscover).toBe(false)
    expect(readiness.canPersonas).toBe(false)
    expect(readiness.canTrends).toBe(false)
    expect(readiness.personasRequirement).toEqual({ met: false, have: 0, need: PERSONA_MIN_CUSTOMERS })
  })
  it('reports a fully-ready dataset', () => {
    const readiness = insightsDataReadiness(makeDataset())
    expect(readiness.canDiscover).toBe(true)
    expect(readiness.canPersonas).toBe(true)
    expect(readiness.canTrends).toBe(true)
    expect(readiness.revenueDays).toBe(90)
  })
})

describe('discovery generation', () => {
  it('produces no discoveries on an empty dataset (never fabricates)', () => {
    expect(generateDiscoveries(emptyDataset(), { now: NOW })).toEqual([])
  })
  it('finds the Saturday time pattern with a confidence and impact', () => {
    const discoveries = generateDiscoveries(makeDataset(), { now: NOW })
    const time = discoveries.find((discovery) => discovery.category === 'TIME' && discovery.discoveryType === 'PATTERN')
    expect(time).toBeDefined()
    expect(time?.title).toContain('Saturday')
    expect(time?.confidenceScore).toBeGreaterThanOrEqual(0.7)
    expect(time?.impactEstimate ?? 0).toBeGreaterThan(0)
    expect(time?.sample).toBe(false)
  })
  it('detects co-purchase opportunity from real pairs', () => {
    const opportunities = coPurchaseOpportunities(makeDataset())
    expect(opportunities[0]?.productTitle).toBe('Meridian Hoodie')
    expect(opportunities[0]?.relatedProductTitle).toBe('Camp Socks')
    const discovery = generateDiscoveries(makeDataset(), { now: NOW }).find((entry) => entry.discoveryType === 'OPPORTUNITY')
    expect(discovery?.title).toContain('bought together')
  })
  it('detects the repeat-customer segment', () => {
    const segments = repeatCustomerSegment(makeDataset())
    expect(segments.repeatCustomers).toBeGreaterThan(0)
    expect(segments.repeatLtvShare).toBeGreaterThan(50)
    expect(generateDiscoveries(makeDataset(), { now: NOW }).some((entry) => entry.discoveryType === 'SEGMENT')).toBe(true)
  })
  it('detects weekday profile shares', () => {
    const profile = weekdayProfile(makeDataset())
    const saturday = profile.find((row) => row.name === 'Saturday')
    const monday = profile.find((row) => row.name === 'Monday')
    expect(saturday?.revenueShare ?? 0).toBeGreaterThan(monday?.revenueShare ?? 0)
  })
  it('honors the category filter and the limit', () => {
    const onlyProducts = generateDiscoveries(makeDataset(), { now: NOW, categories: ['PRODUCTS'] })
    expect(onlyProducts.every((discovery) => discovery.category === 'PRODUCTS')).toBe(true)
    const limited = generateDiscoveries(makeDataset(), { now: NOW, limit: 2 })
    expect(limited.length).toBeLessThanOrEqual(2)
  })
  it('detects anomalies via z-score on spiked data', () => {
    const dataset = makeDataset()
    const spiked = dataset.revenueDaily.map((row) => (row.day === '2026-08-10' ? { ...row, grossRevenue: row.grossRevenue * 6 } : row))
    const anomalies = detectRevenueAnomalies({ ...dataset, revenueDaily: spiked })
    expect(anomalies.some((anomaly) => anomaly.day === '2026-08-10' && anomaly.direction === 'spike')).toBe(true)
  })
  it('labels trial samples explicitly and marks non-real evidence when no data exists', () => {
    const samples = trialSampleDiscoveries(emptyDataset(), NOW)
    expect(samples).toHaveLength(1)
    expect(samples[0]?.sample).toBe(true)
    expect(samples[0]?.dataEvidence.basedOnRealData).toBe(false)
    expect(samples[0]?.description.toLowerCase()).toContain('sample')
  })
  it('uses real data for trial samples when available', () => {
    const samples = trialSampleDiscoveries(makeDataset(), NOW)
    expect(samples[0]?.sample).toBe(true)
    expect(samples[0]?.confidenceScore).toBeGreaterThan(0)
  })
})

describe('pattern recognition', () => {
  it('detects time, product, correlation, and customer patterns', () => {
    const patterns = detectPatterns(makeDataset(), 20, NOW)
    const types = new Set(patterns.map((pattern) => pattern.patternType))
    expect(types.has('TIME')).toBe(true)
    expect(types.has('PRODUCT')).toBe(true)
    expect(types.has('CORRELATION')).toBe(true)
    expect(types.has('CUSTOMER')).toBe(true)
    expect(patterns.every((pattern) => pattern.confidenceScore >= 0.5)).toBe(true)
  })
  it('produces no patterns on an empty dataset', () => {
    expect(detectPatterns(emptyDataset(), 20, NOW)).toEqual([])
  })
  it('computes monthly totals for the seasonal proxy', () => {
    const months = monthlyTotals(makeDataset())
    expect(months.length).toBeGreaterThanOrEqual(3)
    expect(months.every((month) => /^\d{4}-\d{2}$/.test(month.month))).toBe(true)
  })
})

describe('customer personas (RFM)', () => {
  it('requires at least 50 customers and stays silent otherwise', () => {
    expect(buildPersonas(makeDataset({ customers: makeDataset().customers.slice(0, 20) }), 5, NOW)).toEqual([])
  })
  it('builds personas covering the full customer base with real aggregates', () => {
    const personas = buildPersonas(makeDataset(), 5, NOW)
    expect(personas.length).toBeGreaterThanOrEqual(3)
    const coverage = personas.reduce((sum, persona) => sum + persona.customerCount, 0)
    expect(coverage).toBe(80)
    expect(personas[0]?.estimatedRevenueImpact ?? 0).toBeGreaterThan(0)
    expect(personas.every((persona) => persona.radar.length === 5)).toBe(true)
    expect(personas.every((persona) => persona.behaviorPatterns.length >= 3)).toBe(true)
  })
  it('names personas and assigns emojis deterministically', () => {
    const personas = buildPersonas(makeDataset(), 5, NOW)
    expect(personas.map((persona) => persona.personaName)).toContain('High-Value Champions')
    expect(personas.every((persona) => persona.personaEmoji.length > 0)).toBe(true)
  })
})

describe('why? investigations', () => {
  it('rejects malformed questions', () => {
    expect(() => investigate('ab', makeDataset(), NOW)).toThrow(AppError)
    expect(() => investigate('x'.repeat(401), makeDataset(), NOW)).toThrow(AppError)
  })
  it('decomposes a revenue question into orders vs AOV causes with impact shares', () => {
    const dataset = makeDataset()
    const grown = dataset.revenueDaily.map((row) => (row.day >= '2026-07-19' ? { ...row, grossRevenue: row.grossRevenue * 1.4, orderCount: Math.round(row.orderCount * 1.4) } : row))
    const grownOrders = dataset.ordersDaily.map((row) => (row.day >= '2026-07-19' ? { ...row, orderCount: Math.round(row.orderCount * 1.4) } : row))
    const result = investigate('Why did my revenue change this month?', { ...dataset, revenueDaily: grown, ordersDaily: grownOrders }, NOW)
    expect(result.status).toBe('COMPLETED')
    expect(result.rootCauses.length).toBeGreaterThanOrEqual(1)
    expect(result.rootCauses[0]?.impactShare ?? 0).toBeGreaterThan(0)
    expect(result.rootCauses.reduce((sum, cause) => sum + cause.confidence, 0)).toBeGreaterThan(0)
    expect(result.dataSourcesAnalyzed).toContain('analytics_revenue_daily')
    expect(result.whatToDo.length).toBeGreaterThan(0)
    expect(result.preventionTips.length).toBeGreaterThan(0)
    expect(result.steps.length).toBeGreaterThanOrEqual(3)
  })
  it('answers flat data honestly without inventing causes', () => {
    const flat = makeDataset()
    const result = investigate('Why are my orders flat?', flat, NOW)
    expect(result.status).toBe('COMPLETED')
    expect(result.confidenceScore).toBeLessThanOrEqual(0.95)
  })
})

describe('trend watcher', () => {
  it('classifies business trends with direction and magnitude', () => {
    const trends = detectTrends(makeDataset(), NOW)
    expect(trends.some((trend) => trend.category === 'REVENUE')).toBe(true)
    expect(trends.every((trend) => trend.dataSource === 'INTERNAL')).toBe(true)
    expect(trends.every((trend) => trend.magnitude >= 0)).toBe(true)
  })
  it('marks genuinely new products as EMERGING', () => {
    const dataset = makeDataset()
    const nowRows = dataset.productSalesDaily.filter((row) => row.day >= '2026-08-15').map((row) => ({ ...row, productId: 'p-new', unitsSold: 4, grossRevenue: 128 }))
    const trends = detectTrends({ ...dataset, products: [...dataset.products, { productId: 'p-new', title: 'Nova Beanie', price: 28 }], productSalesDaily: [...dataset.productSalesDaily, ...nowRows] }, NOW)
    expect(trends.some((trend) => trend.trendType === 'EMERGING')).toBe(true)
  })
  it('detects declining products', () => {
    const dataset = makeDataset()
    const declined = dataset.productSalesDaily.map((row) => (row.productId === 'p1' && row.day >= '2026-08-04' ? { ...row, unitsSold: 0, grossRevenue: 0 } : row))
    expect(decliningProducts({ ...dataset, productSalesDaily: declined }).some((row) => row.productId === 'p1')).toBe(true)
  })
  it('returns nothing on empty data', () => {
    expect(detectTrends(emptyDataset(), NOW)).toEqual([])
  })
})

describe('comparative studies', () => {
  it('compares two products with a winner and metric table', () => {
    const comparison = runComparison(makeDataset(), 'PRODUCT', 'p1', 'p2', NOW)
    expect(comparison.winner).toBe('A')
    expect(comparison.metrics.length).toBe(4)
    expect(comparison.insights.length).toBeGreaterThan(0)
  })
  it('compares two 30-day periods', () => {
    const comparison = runComparison(makeDataset(), 'PERIOD', '2026-07-19', '2026-06-19', NOW)
    expect(comparison.winner === 'A' || comparison.winner === 'TIE' || comparison.winner === 'B').toBe(true)
    expect(comparison.metrics.map((metric) => metric.metric)).toContain('revenue')
  })
  it('compares real customer segments', () => {
    const comparison = runComparison(makeDataset(), 'SEGMENT', 'REPEAT', 'ONE_TIME', NOW)
    expect(comparison.winner).not.toBe('INSUFFICIENT_DATA')
  })
  it('rejects unknown segment ids', () => {
    expect(() => runComparison(makeDataset(), 'SEGMENT', 'NOPE', 'OTHER', NOW)).toThrow(AppError)
  })
  it('compares categories from product types', () => {
    const comparison = runComparison(makeDataset(), 'CATEGORY', 'Apparel', 'Accessories', NOW)
    expect(comparison.winner).toBe('A')
  })
  it('returns INSUFFICIENT_DATA for channels without fabricating', () => {
    const comparison = runComparison(makeDataset(), 'CHANNEL', 'online_store', 'pos', NOW)
    expect(comparison.winner).toBe('INSUFFICIENT_DATA')
    expect(comparison.insights[0]).toContain('not available')
  })
})

describe('predictive insights', () => {
  it('forecasts next-7-day revenue within an interval', () => {
    const prediction = forecastRevenue(makeDataset(), '7_DAYS', NOW)
    expect(prediction).not.toBeNull()
    expect(prediction?.predictedValue ?? 0).toBeGreaterThan(0)
    expect(prediction?.predictedLow ?? 1).toBeLessThanOrEqual(prediction?.predictedValue ?? 0)
    expect(prediction?.predictedHigh ?? 0).toBeGreaterThanOrEqual(prediction?.predictedValue ?? 0)
    expect(prediction?.series).toHaveLength(7)
    expect(prediction?.method).toContain('weekday')
  })
  it('returns null when history is too thin', () => {
    expect(forecastRevenue(emptyDataset(), '7_DAYS', NOW)).toBeNull()
    expect(forecastRevenue(makeDataset({ revenueDaily: makeDataset().revenueDaily.slice(0, 5) }), '7_DAYS', NOW)).toBeNull()
  })
  it('forecasts orders separately from revenue', () => {
    const prediction = forecastOrders(makeDataset(), '30_DAYS', NOW)
    expect(prediction?.predictionType).toBe('ORDERS')
    expect(prediction?.basedOn).toContain('analytics_orders_daily')
  })
  it('predicts inventory velocity from real sell-through', () => {
    const predictions = predictStockouts(makeDataset(), NOW)
    expect(predictions.length).toBeGreaterThan(0)
    expect(predictions[0]?.predictionType).toBe('INVENTORY')
  })
})

describe('learning library', () => {
  it('generates personalized lessons grounded in real numbers', () => {
    const lesson = generateLesson(makeDataset(), 'TIME', { now: NOW })
    expect(lesson).not.toBeNull()
    expect(lesson?.title).toContain('Saturday')
    expect(lesson?.contentMarkdown).toContain('##')
    expect(lesson?.personalized).toBe(true)
    expect(lesson?.sample).toBe(false)
    expect(lesson?.readingTimeMinutes).toBeGreaterThanOrEqual(3)
    expect(lesson?.actionItems.length).toBeGreaterThan(0)
  })
  it('generates a labeled sample lesson for trials without data', () => {
    const lesson = generateLesson(emptyDataset(), 'REVENUE', { now: NOW, sample: true })
    expect(lesson).not.toBeNull()
    expect(lesson?.sample).toBe(true)
    expect(lesson?.title.toLowerCase()).toContain('sample')
  })
  it('returns no real lesson for categories unsupported by data', () => {
    expect(generateLesson(emptyDataset(), 'TIME', { now: NOW })).toBeNull()
  })
  it('builds a library up to the plan cap', () => {
    const library = generateLessonLibrary(makeDataset(), 3, NOW)
    expect(library.length).toBeLessThanOrEqual(3)
    expect(library.length).toBeGreaterThan(0)
  })
})

describe('knowledge base helpers', () => {
  it('suggests tags from vocabulary matches', () => {
    expect(suggestKnowledgeTags('Revenue pattern study', 'About customers and trends')).toContain('revenue')
    expect(suggestKnowledgeTags('Revenue pattern study', 'About customers and trends')).toContain('customers')
    expect(suggestKnowledgeTags('Untitled', 'nothing relevant')).toEqual([])
  })
  it('searches entries case-insensitively', () => {
    const entries = [
      { id: '1', storeId: 's', entryType: 'NOTE' as const, title: 'Saturday spike notes', contentMarkdown: 'Weekend revenue', tags: ['revenue'], linkedInsights: [], author: 'MERCHANT' as const, createdAt: NOW, updatedAt: NOW, referenceCount: 0 },
      { id: '2', storeId: 's', entryType: 'NOTE' as const, title: 'Customer memo', contentMarkdown: 'Personas', tags: ['customers'], linkedInsights: [], author: 'AI' as const, createdAt: NOW, updatedAt: NOW, referenceCount: 0 },
    ]
    expect(searchKnowledge(entries, 'saturday').map((entry) => entry.id)).toEqual(['1'])
    expect(searchKnowledge(entries, 'personas').map((entry) => entry.id)).toEqual(['2'])
    expect(searchKnowledge(entries, '')).toHaveLength(2)
  })
})

describe('timeline assembly', () => {
  it('orders every entity chronologically, newest first', () => {
    const dataset = makeDataset()
    const discoveries = generateDiscoveries(dataset, { now: NOW })
    const timeline = timelineFromEntities({ discoveries, lessons: generateLessonLibrary(dataset, 2, NOW) })
    expect(timeline.length).toBe(discoveries.length + Math.min(2, 6))
    for (let index = 1; index < timeline.length; index += 1) {
      expect((timeline[index - 1]?.eventAt ?? '') >= (timeline[index]?.eventAt ?? '')).toBe(true)
    }
  })
})

describe('auto-discovery scheduling', () => {
  it('respects plan gating and enabled flag', () => {
    const prefs = defaultInsightsPreferences('s')
    expect(autoDiscoveryDue(prefs, 'trial', null, Date.now())).toBe(false)
    expect(autoDiscoveryDue({ ...prefs, autoDiscoveryEnabled: false }, 'growth', null, Date.now())).toBe(false)
    expect(autoDiscoveryDue(prefs, 'growth', null, Date.now())).toBe(true)
  })
  it('runs daily plans once per day and realtime within the hour', () => {
    const now = Date.parse(NOW)
    const prefs = defaultInsightsPreferences('s')
    expect(autoDiscoveryDue(prefs, 'growth', new Date(now - 2 * 3_600_000).toISOString(), now)).toBe(false)
    expect(autoDiscoveryDue(prefs, 'growth', new Date(now - 25 * 3_600_000).toISOString(), now)).toBe(true)
    expect(autoDiscoveryDue(prefs, 'commander', new Date(now - 2 * 3_600_000).toISOString(), now)).toBe(true)
    expect(autoDiscoveryDue({ ...prefs, discoveryFrequency: 'WEEKLY' }, 'start', new Date(now - 2 * 86_400_000).toISOString(), now)).toBe(false)
  })
})

describe('usage summary thresholds', () => {
  it('warns at 80% and blocks at 100%', () => {
    expect(summarizeUsage(4, 5)).toMatchObject({ warning: true, blocked: false, percent: 80 })
    expect(summarizeUsage(5, 5)).toMatchObject({ warning: false, blocked: true })
    expect(summarizeUsage(2, 5)).toMatchObject({ warning: false, blocked: false, percent: 40 })
    expect(summarizeUsage(100, Number.POSITIVE_INFINITY).percent).toBe(0)
  })
})

describe('period analytics helpers', () => {
  it('computes period-over-period metrics', () => {
    const momentum = periodOverPeriod(makeDataset())
    expect(momentum.current.revenue).toBeGreaterThan(0)
    expect(momentum.previous.revenue).toBeGreaterThan(0)
    expect(momentum.revenueChange).not.toBeNull()
    expect(momentum.current.aov).not.toBeNull()
  })
  it('ranks rising products', () => {
    const rising = risingProducts(makeDataset())
    expect(rising.length).toBeGreaterThan(0)
    expect(rising[0]?.growthPercent ?? 0).toBeGreaterThan(0)
  })
  it('computes revenue concentration', () => {
    const concentration = revenueConcentration(makeDataset())
    expect(concentration.topProductTitle).toBe('Meridian Hoodie')
    expect(concentration.topShare).toBeGreaterThan(50)
  })
})

describe('deterministic ids and day arithmetic', () => {
  it('produces stable ids for identical findings', () => {
    const a = generateDiscoveries(makeDataset(), { now: NOW })
    const b = generateDiscoveries(makeDataset(), { now: NOW })
    expect(a.map((entry) => entry.id)).toEqual(b.map((entry) => entry.id))
  })
  it('shifts days across month boundaries correctly', () => {
    expect(shiftDay('2026-08-01', -1)).toBe('2026-07-31')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })
})
