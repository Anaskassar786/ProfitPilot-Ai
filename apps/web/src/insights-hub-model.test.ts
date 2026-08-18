import { describe, expect, it } from 'vitest'
import {
  INSIGHTS_BASE_PATH,
  INSIGHTS_FEATURE_MIN_PLAN,
  INSIGHTS_UPGRADE_CTA,
  comparisonDelta,
  confidenceLabel,
  confidencePercent,
  evidenceRows,
  formatInsightMoney,
  formatPercent,
  formatRelativeTime,
  insightsFeatureLock,
  insightsRoutePath,
  insightsTabLabel,
  meterPercent,
  parseInsightsRoute,
  patternBubbles,
  planAtLeast,
  readinessProgress,
  subjectLabel,
  tabForTimelineEntity,
  tagCloud,
  trendScatter,
  insightsUpgradeMessage,
} from './insights-hub-model.js'
import { discoveryTreemapBlocks, funnelStages, hourHeatCells, knowledgeNetwork, weekdayHeatCells } from './insights-hub.js'
import type { InsightDiscovery, InsightKnowledgeEntry, InsightPattern, InsightsOverview, InsightTrend } from './insights-hub-model.js'

function discovery(overrides: Partial<InsightDiscovery> = {}): InsightDiscovery {
  return { id: 'd1', storeId: 's', discoveryType: 'PATTERN', category: 'TIME', title: 'Saturdays spike', description: 'Saturday revenue share is above the weekly mean.', explanation: 'Interesting — Saturday outperforms.', confidenceScore: 0.82, impactEstimate: 430, impactCurrency: 'USD', dataEvidence: {}, visualizationData: {}, discoveredAt: '2026-08-17T00:00:00.000Z', status: 'NEW', sample: false, viewedAt: null, actionTakenAt: null, expiresAt: null, ...overrides }
}

function overview(features: Partial<Record<string, boolean>> = {}): InsightsOverview {
  const allFalse = { discoveries: false, lessons: false, patterns: false, personas: false, investigations: false, trends: true, comparisons: false, knowledge: false, timeline: true, predictions: false, autoDiscovery: false, export: false, share: false, apiAccess: false, externalTrends: false, anomalyAlerts: false }
  return {
    plan: 'trial',
    features: { ...allFalse, ...features } as InsightsOverview['features'],
    requiredPlans: INSIGHTS_FEATURE_MIN_PLAN,
    usage: { discoveries: { used: 0, limit: 1, remaining: 1 }, investigations: { used: 0, limit: 0, remaining: 0 } },
    counts: { newDiscoveries: 1, totalDiscoveries: 1, patterns: 0, lessons: 1, lessonsRead: 0, personas: 0, investigations: 0, trends: 0, predictions: 0, comparisons: 0, knowledge: 0 },
    readiness: { revenueDays: 3, totalOrders: 5, customerCount: 12, productsWithSales: 1, canDiscover: false, canPersonas: false, canTrends: false, canPatterns: true, canPredict: false, discoverRequirement: 'Discoveries need 7 days of revenue history or 10 orders.', personasRequirement: { met: false, have: 12, need: 50 }, trendsRequirement: { met: false, have: 3, need: 60 }, predictRequirement: { met: false, have: 3, need: 14 } },
    preferences: { storeId: 's', autoDiscoveryEnabled: true, discoveryFrequency: 'DAILY', discoveryCategories: ['REVENUE'], notificationPreferences: { highConfidenceDiscoveries: true, trendAlerts: true, weeklyDigest: false, anomalyAlerts: true }, trendMonitoringEnabled: true, personaUpdatesEnabled: true, apiAccessEnabled: false, apiKeyMasked: null, language: 'en', updatedAt: '2026-08-18T00:00:00.000Z' },
    autoDiscoveryRan: false,
    trial: true,
    generatedAt: '2026-08-18T00:00:00.000Z',
  }
}

describe('insights routing', () => {
  it('parses the base path into the overview tab', () => {
    expect(parseInsightsRoute('/ai-growth-command/insights')).toEqual({ tab: 'overview', id: null })
    expect(parseInsightsRoute('/ai-growth-command/insights/')).toEqual({ tab: 'overview', id: null })
  })
  it('parses tab paths and detail ids', () => {
    expect(parseInsightsRoute('/ai-growth-command/insights/discoveries')).toEqual({ tab: 'discoveries', id: null })
    expect(parseInsightsRoute('/ai-growth-command/insights/discoveries/dsc_123')).toEqual({ tab: 'discoveries', id: 'dsc_123' })
    expect(parseInsightsRoute('/ai-growth-command/insights/why/inv-9')).toEqual({ tab: 'why', id: 'inv-9' })
    expect(parseInsightsRoute('/ai-growth-command/insights/comparisons/new')).toEqual({ tab: 'comparisons', id: 'new' })
    expect(parseInsightsRoute('/ai-growth-command/insights/api-access')).toEqual({ tab: 'api-access', id: null })
  })
  it('ignores unknown segments and non-insights paths', () => {
    expect(parseInsightsRoute('/ai-growth-command/insights/unknown')).toEqual({ tab: 'overview', id: null })
    expect(parseInsightsRoute('/dashboard')).toEqual({ tab: 'overview', id: null })
    expect(parseInsightsRoute('/ai-growth-command/insights/discoveries/not%20valid')).toEqual({ tab: 'discoveries', id: null })
  })
  it('builds paths that parse back (round trip)', () => {
    for (const tab of ['overview', 'discoveries', 'lessons', 'patterns', 'personas', 'why', 'trends', 'comparisons', 'knowledge', 'timeline', 'predictions', 'settings', 'api-access'] as const) {
      expect(parseInsightsRoute(insightsRoutePath(tab, null)).tab).toBe(tab)
    }
    const path = insightsRoutePath('personas', 'per_1')
    expect(path.startsWith(INSIGHTS_BASE_PATH)).toBe(true)
    expect(parseInsightsRoute(path)).toEqual({ tab: 'personas', id: 'per_1' })
  })
  it('maps timeline entities to their owning tab', () => {
    expect(tabForTimelineEntity('DISCOVERY')).toBe('discoveries')
    expect(tabForTimelineEntity('INVESTIGATION')).toBe('why')
    expect(tabForTimelineEntity('PREDICTION')).toBe('predictions')
  })
  it('labels every tab for the nav', () => {
    expect(insightsTabLabel('why')).toBe('Why?')
    expect(insightsTabLabel('api-access')).toBe('API access')
  })
})

describe('plan locks and upgrade copy', () => {
  it('orders plans trial < start < growth < commander', () => {
    expect(planAtLeast('growth', 'start')).toBe(true)
    expect(planAtLeast('trial', 'start')).toBe(false)
    expect(planAtLeast('commander', 'commander')).toBe(true)
  })
  it('locks commander-only API access for growth', () => {
    const lock = insightsFeatureLock('growth', 'apiAccess')
    expect(lock.locked).toBe(true)
    expect(lock.requiredPlan).toBe('commander')
  })
  it('trusts server overview features over the static matrix', () => {
    const opened = insightsFeatureLock('trial', 'personas', overview({ personas: true }))
    expect(opened.locked).toBe(false)
    const shut = insightsFeatureLock('commander', 'export', overview({ export: false }))
    expect(shut.locked).toBe(true)
  })
  it('keeps trends and timeline viewable on trial', () => {
    expect(insightsFeatureLock('trial', 'trends').locked).toBe(false)
    expect(insightsFeatureLock('trial', 'timeline').locked).toBe(false)
    expect(insightsFeatureLock('trial', 'investigations').locked).toBe(true)
  })
  it('uses the generic Upgrade Plan CTA and never names a plan in the CTA', () => {
    expect(INSIGHTS_UPGRADE_CTA).toBe('Upgrade Plan')
    for (const feature of Object.keys(INSIGHTS_FEATURE_MIN_PLAN) as (keyof typeof INSIGHTS_FEATURE_MIN_PLAN)[]) {
      const message = insightsUpgradeMessage(feature)
      expect(message).toContain('Upgrade Plan')
      expect(message).not.toMatch(/Upgrade to (Start|Growth|Commander)/)
    }
  })
})

describe('display helpers', () => {
  it('formats money, percents, and confidence without leaking enums', () => {
    expect(formatInsightMoney(1234, 'USD')).toContain('$')
    expect(formatInsightMoney(null)).toBe('—')
    expect(formatPercent(0.156, 1)).toBe('+15.6%')
    expect(confidencePercent(0.823)).toBe(82)
    expect(confidenceLabel(0.9)).toContain('confidence')
  })
  it('formats relative time compactly', () => {
    const now = Date.parse('2026-08-18T12:00:00.000Z')
    expect(formatRelativeTime('2026-08-18T11:59:40.000Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-08-18T10:00:00.000Z', now)).toBe('2h ago')
    expect(formatRelativeTime('garbage', now)).toBe('never')
  })
  it('flattens evidence objects into primitive rows', () => {
    const rows = evidenceRows({ revenueShare: 0.42, dayName: 'Saturday', nested: { deep: true }, items: [1, 2, 3] })
    expect(rows.find((row) => row.label === 'revenue Share' || row.label === 'revenue share')?.value).toBe('0.42')
    expect(rows.find((row) => row.label === 'items')?.value).toBe('3 items')
    expect(rows.every((row) => typeof row.value === 'string')).toBe(true)
  })
  it('computes meter percentages with caps', () => {
    expect(meterPercent(2, 5)).toBe(40)
    expect(meterPercent(9, 5)).toBe(100)
    expect(meterPercent(3, null)).toBeNull()
  })
  it('summarizes comparison deltas honestly', () => {
    expect(comparisonDelta({ metric: 'revenue', a: 10, b: 5, delta: 100, winner: 'A' })).toBe('+100.0%')
    expect(comparisonDelta({ metric: 'aov', a: null, b: 5, delta: null, winner: 'TIE' })).toBe('—')
  })
  it('reads comparison subject labels defensively', () => {
    expect(subjectLabel({ title: 'Hoodie' }, 'A')).toBe('Hoodie')
    expect(subjectLabel({}, 'A')).toBe('A')
  })
  it('exposes readiness progress with units', () => {
    const progress = readinessProgress(overview().readiness, 'personas')
    expect(progress).toEqual({ have: 12, need: 50, unit: 'customers' })
  })
})

describe('chart data derivations (presentation of API values only)', () => {
  it('scales pattern bubbles by real occurrence counts', () => {
    const patterns = [
      { id: 'p1', storeId: 's', patternType: 'TIME', title: 'Weekly rhythm', description: '', patternData: {}, occurrenceCount: 10, confidenceScore: 0.9, firstDetected: '', lastConfirmed: '', status: 'ACTIVE', alertsEnabled: false },
      { id: 'p2', storeId: 's', patternType: 'PRODUCT', title: 'Affinity', description: '', patternData: {}, occurrenceCount: 5, confidenceScore: 0.5, firstDetected: '', lastConfirmed: '', status: 'ACTIVE', alertsEnabled: false },
    ] as unknown as readonly InsightPattern[]
    const bubbles = patternBubbles(patterns)
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0]?.y).toBeCloseTo(0.98)
    expect((bubbles[0]?.r ?? 0) > (bubbles[1]?.r ?? 0)).toBe(true)
  })
  it('scatters trends by magnitude and direction', () => {
    const trends = [{ id: 't1', storeId: 's', trendType: 'BUSINESS', category: 'REVENUE', title: 'Revenue climbing', description: '', direction: 'UP', magnitude: 0.2, timePeriod: '14d', dataSource: 'INTERNAL', confidenceScore: 0.8, detectedAt: '', alertsEnabled: false }] as unknown as readonly InsightTrend[]
    const points = trendScatter(trends)
    expect(points[0]?.up).toBe(true)
    expect(points[0]?.y).toBeCloseTo(0.8)
  })
  it('buckets discovery funnel stages from visible statuses', () => {
    const stages = funnelStages([discovery(), discovery({ id: 'd2', status: 'REVIEWED' }), discovery({ id: 'd3', status: 'ACTED_ON' })])
    expect(stages.map((stage) => stage.value)).toEqual([1, 1, 0, 1])
  })
  it('extracts weekday heat cells from engine visualization payloads', () => {
    const cells = weekdayHeatCells([discovery({ visualizationData: { chart: 'heatmap', weekdayProfile: [{ name: 'Sun', revenue: 10, share: 0.1 }, { name: 'Sat', revenue: 60, share: 0.6 }] } })])
    expect(cells).toHaveLength(2)
    expect(cells[1]?.value).toBeCloseTo(0.6)
    expect(weekdayHeatCells([discovery()])).toEqual([])
  })
  it('extracts hourly heat cells into 6 buckets', () => {
    const cells = hourHeatCells([discovery({ visualizationData: { chart: 'heatmap', hours: [{ hour: 1, orders: 2 }, { hour: 13, orders: 9 }] } })])
    expect(cells).toHaveLength(2)
    expect(cells.find((cell) => cell.x === 0)?.value).toBe(2)
    expect(cells.find((cell) => cell.x === 3)?.value).toBe(9)
  })
  it('builds treemap blocks only from treemap visualizations', () => {
    expect(discoveryTreemapBlocks(discovery())).toEqual([])
    const blocks = discoveryTreemapBlocks(discovery({ visualizationData: { chart: 'treemap', repeat: 30, oneTime: 70 } }))
    expect(blocks.map((block) => block.label)).toEqual(['Repeat customers', 'One-time customers'])
    const concentration = discoveryTreemapBlocks(discovery({ visualizationData: { chart: 'treemap', topShare: 0.4, top3Share: 0.7 } }))
    expect(concentration.map((block) => Math.round(block.value * 100))).toEqual([40, 30, 30])
  })
  it('builds knowledge tag clouds with real counts', () => {
    const entries = [
      { id: 'k1', tags: ['weekend', 'pricing'] },
      { id: 'k2', tags: ['weekend'] },
    ] as unknown as readonly InsightKnowledgeEntry[]
    const cloud = tagCloud(entries)
    expect(cloud[0]).toEqual({ tag: 'weekend', weight: 2 })
  })
  it('links knowledge entries into a bounded network', () => {
    const entries = [
      { id: 'a', title: 'Alpha note', entryType: 'NOTE', linkedInsights: ['b'] },
      { id: 'b', title: 'Beta discovery', entryType: 'DISCOVERY', linkedInsights: [] },
      { id: 'c', title: 'Loose', entryType: 'NOTE', linkedInsights: ['x'] },
    ] as unknown as readonly InsightKnowledgeEntry[]
    const network = knowledgeNetwork(entries)
    expect(network.nodes.length).toBeGreaterThanOrEqual(2)
    expect(network.edges).toEqual([{ from: 'a', to: 'b' }])
  })
})
