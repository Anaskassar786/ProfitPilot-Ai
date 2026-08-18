import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  DiscoveryCard,
  InsightsEmptyState,
  InsightsHubWorkspace,
  InsightsLockedPanel,
  InsightsUpgradeCta,
  MarkdownLite,
  PredictionCard,
  RatingStars,
  SampleBadge,
  UsageMeterBar,
} from './insights-hub.js'
import {
  InsightsAreaBand,
  InsightsBubbleChart,
  InsightsComparisonBars,
  InsightsFlowChart,
  InsightsHeatmap,
  InsightsNetworkGraph,
  InsightsRadarChart,
  InsightsScatter,
  InsightsTimelineStrip,
  InsightsTreeMap,
  InsightsWordCloud,
} from './insights-hub-charts.js'
import type { InsightDiscovery, InsightPrediction } from './insights-hub-model.js'
import { FlaskConical } from 'lucide-react'

const noop = vi.fn()

function discovery(overrides: Partial<InsightDiscovery> = {}): InsightDiscovery {
  return { id: 'd1', storeId: 's', discoveryType: 'OPPORTUNITY', category: 'REVENUE', title: 'Bundle affinity between Hoodie and Cap', description: 'Pairs of these items appear together in 42% of shared carts.', explanation: 'Did you know these two products travel together?', confidenceScore: 0.78, impactEstimate: 512, impactCurrency: 'USD', dataEvidence: { coPurchaseRate: 0.42, orders: 89 }, visualizationData: { chart: 'network', nodes: ['Hoodie', 'Cap'], linkStrength: 0.42 }, discoveredAt: '2026-08-17T09:00:00.000Z', status: 'NEW', sample: false, viewedAt: null, actionTakenAt: null, expiresAt: null, ...overrides }
}

function prediction(overrides: Partial<InsightPrediction> = {}): InsightPrediction {
  return { id: 'pr1', storeId: 's', predictionType: 'REVENUE', horizon: '7_DAYS', title: 'Revenue for the next 7 days', description: 'Weekday-seasonal blend of your last 12 weeks.', predictedValue: 3210, predictedLow: 2500, predictedHigh: 3900, currency: 'USD', confidenceScore: 0.71, method: 'weekday-seasonal + linear trend', series: [{ day: '2026-08-18', value: 450, lower: 350, upper: 560 }, { day: '2026-08-19', value: 470, lower: 360, upper: 590 }], basedOn: ['90 days of revenue', 'weekday profile'], predictedFor: '2026-08-25', actualValue: null, accuracyScore: null, createdAt: '2026-08-17T00:00:00.000Z', ...overrides }
}

describe('DiscoveryCard humanization (no enum leakage)', () => {
  const htmlFor = (value: InsightDiscovery) => renderToStaticMarkup(createElement(DiscoveryCard, { discovery: value, storeId: 's', onOpen: noop, onChanged: noop, onToast: noop, onNavigateBilling: noop }))
  it('renders humanized type and category labels, never raw enums', () => {
    const html = htmlFor(discovery())
    expect(html).toContain('Opportunity')
    expect(html).toContain('Revenue')
    expect(html).not.toContain('OPPORTUNITY')
    expect(html).not.toContain('>NEW<')
  })
  it('shows the narrator explanation and the evidence-backed impact', () => {
    const html = htmlFor(discovery())
    expect(html).toContain('Did you know these two products travel together?')
    expect(html).toContain('$512')
  })
  it('labels trial samples clearly', () => {
    expect(htmlFor(discovery({ sample: true }))).toContain('SAMPLE')
    expect(htmlFor(discovery()).includes('SAMPLE')).toBe(false)
  })
  it('offers review actions', () => {
    const html = htmlFor(discovery())
    expect(html).toContain('Save')
    expect(html).toContain('Acted on it')
    expect(html).toContain('Not useful')
  })
})

describe('plan messaging', () => {
  it('LockedPanel uses only the generic Upgrade Plan CTA — never a plan name', () => {
    const html = renderToStaticMarkup(createElement(InsightsLockedPanel, { feature: 'personas', plan: 'trial', overview: null, onNavigateBilling: noop }))
    expect(html).toContain('Upgrade Plan')
    expect(html).not.toMatch(/Upgrade to (Start|Growth|Commander)/)
    expect(html).not.toContain('$49')
    expect(html).not.toContain('$149')
    expect(html).not.toContain('$349')
  })
  it('LockedPanel renders nothing when the feature is unlocked', () => {
    const html = renderToStaticMarkup(createElement(InsightsLockedPanel, { feature: 'trends', plan: 'trial', overview: null, onNavigateBilling: noop }))
    expect(html).toBe('')
  })
  it('UpgradeCta button says exactly Upgrade Plan', () => {
    const html = renderToStaticMarkup(createElement(InsightsUpgradeCta, { onNavigateBilling: noop }))
    expect(html).toContain('Upgrade Plan')
  })
})

describe('educational empty states and samples', () => {
  it('renders the curious-scientist empty state', () => {
    const html = renderToStaticMarkup(createElement(InsightsEmptyState, { icon: FlaskConical, title: 'Personas require at least 50 customers', body: 'You have 12 synced so far.' }))
    expect(html).toContain('Personas require at least 50 customers')
  })
  it('SampleBadge carries the trial labeling', () => {
    expect(renderToStaticMarkup(createElement(SampleBadge))).toContain('SAMPLE')
  })
})

describe('PredictionCard honesty', () => {
  const htmlFor = (value: InsightPrediction) => renderToStaticMarkup(createElement(PredictionCard, { prediction: value, storeId: 's', onChanged: noop, onToast: noop }))
  it('shows the figure with its honest interval and method', () => {
    const html = htmlFor(prediction())
    expect(html).toContain('$3,210')
    expect(html).toContain('$2,500')
    expect(html).toContain('weekday-seasonal')
    expect(html).toContain('Next 7 days')
  })
  it('asks for the actual once the window closes, then shows the grade', () => {
    expect(htmlFor(prediction())).toContain('Grade it')
    const graded = htmlFor(prediction({ actualValue: 3300, accuracyScore: 0.94 }))
    expect(graded).toContain('accuracy 94%')
  })
})

describe('supporting atoms', () => {
  it('UsageMeterBar renders real fractions', () => {
    const html = renderToStaticMarkup(createElement(UsageMeterBar, { label: 'Discoveries this month', used: 3, limit: 5 }))
    expect(html).toContain('3 / 5')
  })
  it('RatingStars renders five stars and reflects values', () => {
    const html = renderToStaticMarkup(createElement(RatingStars, { value: 3, onRate: noop }))
    expect((html.match(/<button/g) ?? []).length).toBe(5)
    expect(html).toContain('lit')
  })
  it('MarkdownLite renders structure without scripts', () => {
    const html = renderToStaticMarkup(createElement(MarkdownLite, { markdown: '## Study\n\n- one\n- two\n\n**Bold** claim <script>alert(1)</script>' }))
    expect(html).toContain('<h3>')
    expect(html).toContain('<li>')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).not.toContain('<script>')
  })
})

describe('chart kit — SVG only, no line charts, no donuts', () => {
  it('BubbleChart plots circles on a subtle grid with axis labels', () => {
    const html = renderToStaticMarkup(createElement(InsightsBubbleChart, { points: [{ id: 'p1', label: 'Weekly rhythm', x: 0.8, y: 0.6, r: 14 }], xLabel: 'Confidence →', yLabel: 'Recurrence →' }))
    expect(html).toContain('<circle')
    expect(html).toContain('Confidence →')
    expect(html).toContain('ih-chart-grid')
    expect(html).not.toContain('<polyline')
  })
  it('RadarChart draws trait polygon + labels', () => {
    const html = renderToStaticMarkup(createElement(InsightsRadarChart, { traits: [{ trait: 'Loyalty', score: 0.8 }, { trait: 'Spend', score: 0.5 }, { trait: 'Recency', score: 0.3 }] }))
    expect(html).toContain('<polygon')
    expect(html).toContain('Loyalty')
  })
  it('Heatmap renders intensity cells with tooltips', () => {
    const html = renderToStaticMarkup(createElement(InsightsHeatmap, { cells: [{ x: 1, y: 0, value: 9, label: 'Mon: 9 orders' }], xLabels: ['Sun', 'Mon'], yLabels: ['Revenue'] }))
    expect(html).toContain('<rect')
    expect(html).toContain('Mon: 9 orders')
  })
  it('AreaBand renders a gradient confidence band instead of a line', () => {
    const html = renderToStaticMarkup(createElement(InsightsAreaBand, { series: prediction().series }))
    expect(html).toContain('linearGradient')
    expect(html).toContain('<polygon')
    expect(html).not.toContain('<polyline')
  })
  it('Scatter/WordCloud/Timeline/Network/TreeMap/Flow render their own primitives', () => {
    expect(renderToStaticMarkup(createElement(InsightsScatter, { points: [{ id: 'a', label: 'trend', x: 0.4, y: 0.7 }], xLabel: 'M', yLabel: 'C' }))).toContain('<circle')
    expect(renderToStaticMarkup(createElement(InsightsWordCloud, { words: [{ tag: 'weekend', weight: 3 }] }))).toContain('weekend')
    expect(renderToStaticMarkup(createElement(InsightsTimelineStrip, { events: [{ id: 'e1', at: '2026-08-17T00:00:00.000Z', label: 'Discovery', tone: 'discovery' }] }))).toContain('<circle')
    expect(renderToStaticMarkup(createElement(InsightsNetworkGraph, { nodes: [{ id: 'a', label: 'Alpha', kind: 'NOTE' }, { id: 'b', label: 'Beta', kind: 'DISCOVERY' }], edges: [{ from: 'a', to: 'b' }] }))).toContain('ih-network-edge')
    expect(renderToStaticMarkup(createElement(InsightsTreeMap, { blocks: [{ id: 'x', label: 'Repeat', value: 60 }, { id: 'y', label: 'One-time', value: 40 }] }))).toContain('<rect')
    expect(renderToStaticMarkup(createElement(InsightsFlowChart, { stages: [{ id: 'n', label: 'New', value: 4 }, { id: 'r', label: 'Reviewed', value: 2 }] }))).toContain('<rect')
    expect(renderToStaticMarkup(createElement(InsightsComparisonBars, { rows: [{ metric: 'revenue', a: 100, b: 50, winner: 'A' }] }))).toContain('ih-compare-bar')
  })
})

describe('workspace smoke test', () => {
  it('renders the shell with hero, tabs, and the no-store empty state', () => {
    const html = renderToStaticMarkup(createElement(InsightsHubWorkspace, { context: { storeId: null, shop: null }, onToast: noop, onNavigateBilling: noop }))
    expect(html).toContain('Where data becomes wisdom.')
    expect(html).toContain('AI GROWTH COMMAND')
    expect(html).toContain('Connect your store first')
    expect(html).toContain('Why?')
    expect(html).toContain('NEW' === 'NEW' ? 'API access' : '')
  })
  it('trial plan marks locked tabs without naming plans', () => {
    const html = renderToStaticMarkup(createElement(InsightsHubWorkspace, { context: { storeId: null, shop: null }, onToast: noop, onNavigateBilling: noop }))
    expect(html).not.toMatch(/Upgrade to (Start|Growth|Commander)/)
    expect(html).toMatch(/ih-tab\s+locked/)
  })
})
