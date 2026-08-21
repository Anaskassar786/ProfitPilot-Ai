/**
 * Visual verification harness for PatternAI — dev only, never part of the
 * production build (vite builds index.html; this mirrors verify.html /
 * cc-verify.html / recs-verify.html). It mocks `/insights/*` in page so the
 * real PatternAiWorkspace renders every state in both themes without a
 * backend:
 *
 *   corepack pnpm --filter @profitpilot/web dev
 *   /pa-verify.html                     → light theme, trial store
 *   /pa-verify.html?theme=dark          → dark theme
 *   /pa-verify.html?data=growth         → populated Growth-plan store
 *   /pa-verify.html?data=fresh          → brand-new store, nothing found yet
 *
 * The fixtures below exist ONLY inside this harness. No production component
 * or data path is changed by this file, and nothing here ships to merchants.
 */
import { Button } from './polaris-ui.js'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './f4.css'
import './f5.css'
import './f6.css'
import './f8.css'
import './f9.css'
import './dashboard.css'
import './patternai.css'
import './upgrade-overrides.css'
import './final-polish.css'
import { PatternAiWorkspace } from './patternai.js'
import type { WorkspaceContext } from './model.js'

type Scenario = 'trial' | 'growth' | 'fresh'

const now = Date.now()
const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
const day = (ago: number) => new Date(now - ago * 86_400_000).toISOString().slice(0, 10)

const readiness = (scenario: Scenario) => scenario === 'growth'
  ? { revenueDays: 96, totalOrders: 412, customerCount: 188, productsWithSales: 24, canDiscover: true, canPersonas: true, canTrends: true, canPatterns: true, canPredict: true, discoverRequirement: 'Discoveries need 7 days of revenue history or 10 orders.', personasRequirement: { met: true, have: 188, need: 20 }, trendsRequirement: { met: true, have: 96, need: 60 }, predictRequirement: { met: true, have: 96, need: 14 } }
  : scenario === 'trial'
    ? { revenueDays: 14, totalOrders: 6, customerCount: 4, productsWithSales: 2, canDiscover: false, canPersonas: false, canTrends: false, canPatterns: true, canPredict: true, discoverRequirement: 'Discoveries need 7 days of revenue history or 10 orders.', personasRequirement: { met: false, have: 4, need: 20 }, trendsRequirement: { met: false, have: 14, need: 60 }, predictRequirement: { met: true, have: 14, need: 14 } }
    : { revenueDays: 0, totalOrders: 0, customerCount: 0, productsWithSales: 0, canDiscover: false, canPersonas: false, canTrends: false, canPatterns: false, canPredict: false, discoverRequirement: 'Discoveries need 7 days of revenue history or 10 orders.', personasRequirement: { met: false, have: 0, need: 20 }, trendsRequirement: { met: false, have: 0, need: 60 }, predictRequirement: { met: false, have: 0, need: 14 } }

const FEATURES = ['discoveries', 'lessons', 'patterns', 'personas', 'investigations', 'trends', 'comparisons', 'knowledge', 'timeline', 'predictions', 'autoDiscovery', 'export', 'share', 'apiAccess', 'externalTrends', 'anomalyAlerts'] as const
const REQUIRED: Record<string, string> = { discoveries: 'start', lessons: 'start', patterns: 'start', personas: 'start', investigations: 'start', trends: 'trial', comparisons: 'start', knowledge: 'start', timeline: 'trial', predictions: 'start', autoDiscovery: 'start', export: 'growth', share: 'growth', apiAccess: 'commander', externalTrends: 'start', anomalyAlerts: 'growth' }
const RANK: Record<string, number> = { trial: 0, start: 1, growth: 2, commander: 3 }

function overview(scenario: Scenario) {
  const plan = scenario === 'growth' ? 'growth' : 'trial'
  const features = Object.fromEntries(FEATURES.map((feature) => [feature, RANK[plan]! >= RANK[REQUIRED[feature]!]!]))
  const counts = scenario === 'growth'
    ? { newDiscoveries: 5, totalDiscoveries: 18, patterns: 6, lessons: 4, lessonsRead: 2, personas: 3, investigations: 2, trends: 4, predictions: 2, comparisons: 1, knowledge: 3 }
    : scenario === 'trial'
      ? { newDiscoveries: 1, totalDiscoveries: 1, patterns: 0, lessons: 1, lessonsRead: 0, personas: 0, investigations: 0, trends: 0, predictions: 0, comparisons: 0, knowledge: 0 }
      : { newDiscoveries: 0, totalDiscoveries: 0, patterns: 0, lessons: 0, lessonsRead: 0, personas: 0, investigations: 0, trends: 0, predictions: 0, comparisons: 0, knowledge: 0 }
  return {
    plan,
    features,
    requiredPlans: REQUIRED,
    usage: { discoveries: plan === 'growth' ? { used: 7, limit: 20, remaining: 13 } : { used: 0, limit: 1, remaining: 1 }, investigations: { used: 0, limit: 5, remaining: 5 } },
    counts,
    readiness: readiness(scenario),
    preferences: { storeId: 's1', autoDiscoveryEnabled: true, discoveryFrequency: 'DAILY', discoveryCategories: ['REVENUE', 'PRODUCTS'], notificationPreferences: { highConfidenceDiscoveries: true, trendAlerts: true, weeklyDigest: false, anomalyAlerts: false }, trendMonitoringEnabled: true, personaUpdatesEnabled: true, apiAccessEnabled: false, apiKeyMasked: null, language: 'en', updatedAt: iso(3_600_000) },
    autoDiscoveryRan: scenario !== 'fresh',
    trial: plan === 'trial',
    generatedAt: iso(0),
  }
}

const discovery = (over: Record<string, unknown>) => ({
  id: 'd1', storeId: 's1', discoveryType: 'TREND', category: 'PRODUCTS',
  title: 'Snowboard: Hydrogen demand jumped 100% in the last 14 days',
  description: 'Snowboard: Hydrogen sold 3 units in the last 14 days after 0 units in the prior 14 — 1800 USD in recent revenue.',
  explanation: 'Early momentum in a single product is the cheapest growth you ever get. Feature placement and inventory checks done this week compound; next month they are just maintenance.',
  confidenceScore: 0.8, impactEstimate: 1800, impactCurrency: 'USD',
  dataEvidence: { productId: 'gid://shopify/Product/1', recentUnits: 3, priorUnits: 0, growthPercent: 100, recentRevenue: 1800 },
  visualizationData: { chart: 'bubble', recentUnits: 3, growthPercent: 100 },
  discoveredAt: iso(60_000), status: 'NEW', sample: false, viewedAt: null, actionTakenAt: null, expiresAt: null,
  ...over,
})

const DISCOVERIES: Record<Scenario, unknown[]> = {
  trial: [discovery({ sample: true })],
  growth: [
    discovery({}),
    discovery({ id: 'd2', discoveryType: 'PATTERN', category: 'TIME', status: 'REVIEWED', title: 'Saturday consistently outperforms Tuesday', description: 'Saturday drives 24% of weekly revenue while Tuesday contributes 8%.', explanation: 'Across 96 days of order history, revenue concentrates on Saturday.', confidenceScore: 0.74, impactEstimate: 420, dataEvidence: { weekdayProfile: [{ name: 'Sun', revenue: 900, share: 12, orders: 8 }] }, visualizationData: { chart: 'heatmap', weekdayProfile: [{ name: 'Sun', revenue: 900, share: 0.12 }, { name: 'Mon', revenue: 700, share: 0.09 }, { name: 'Tue', revenue: 600, share: 0.08 }, { name: 'Wed', revenue: 800, share: 0.11 }, { name: 'Thu', revenue: 1000, share: 0.14 }, { name: 'Fri', revenue: 1500, share: 0.22 }, { name: 'Sat', revenue: 1700, share: 0.24 }] } }),
    discovery({ id: 'd3', discoveryType: 'SEGMENT', category: 'CUSTOMERS', status: 'SAVED', title: '46 repeat customers drive 61% of lifetime value', description: '46 of 188 customers ordered more than once.', explanation: 'Repeat buyers are your compounding asset.', confidenceScore: 0.68, impactEstimate: null, dataEvidence: { repeatCustomers: 46, oneTimeCustomers: 142, repeatShare: 0.24, repeatLtvShare: 0.61 }, visualizationData: { chart: 'treemap', repeat: 46, oneTime: 142 } }),
    discovery({ id: 'd4', discoveryType: 'ANOMALY', category: 'REVENUE', status: 'ACTED_ON', title: 'Revenue spiked 180% on ' + day(9), description: 'That day closed at 4200 USD vs an expected 1500 USD.', explanation: 'This day sits more than two standard deviations above your norm.', confidenceScore: 0.9, impactEstimate: 2700, dataEvidence: { day: day(9), value: 4200, expected: 1500, deviationPercent: 180, method: 'z-score ≥ 2 over daily revenue' }, visualizationData: { chart: 'area-gradient', day: day(9), value: 4200, expected: 1500 } }),
    discovery({ id: 'd5', discoveryType: 'OPPORTUNITY', category: 'PRODUCTS', status: 'DISMISSED', title: 'Hoodie and Cap are bought together 42% of the time', description: 'When a customer buys Hoodie, they also buy Cap in 42% of those orders.', explanation: 'Bundles work when affinity is real.', confidenceScore: 0.66, impactEstimate: 512, dataEvidence: { product: 'Hoodie', related: 'Cap', coPurchaseRate: 0.42 }, visualizationData: { chart: 'network', nodes: ['Hoodie', 'Cap'], linkStrength: 0.42 } }),
  ],
  fresh: [],
}

const LESSONS = [
  { id: 'l1', storeId: 's1', lessonType: 'PATTERN_STUDY', category: 'PRODUCTS', title: 'What your best seller is telling you', summary: 'A short study of concentration in your catalog.', contentMarkdown: '## Concentration\n\nOne product carries most of your revenue.', readingTimeMinutes: 3, basedOnData: {}, personalized: true, sample: false, generatedAt: iso(86_400_000), readAt: null, rating: null, bookmarked: false, actionItems: ['Protect the hero product'] },
  { id: 'l2', storeId: 's1', lessonType: 'BEHAVIOR_ANALYSIS', category: 'CUSTOMERS', title: 'Why your repeat buyers matter more', summary: 'Repeat customers hold most of your lifetime value.', contentMarkdown: '## Repeat buyers\n\nThey compound.', readingTimeMinutes: 4, basedOnData: {}, personalized: true, sample: false, generatedAt: iso(2 * 86_400_000), readAt: iso(86_400_000), rating: 4, bookmarked: true, actionItems: [] },
  { id: 'l3', storeId: 's1', lessonType: 'BEST_PRACTICE', category: 'TIME', title: 'Selling into your weekly rhythm', summary: 'Your week has a measurable shape.', contentMarkdown: '## Rhythm', readingTimeMinutes: 2, basedOnData: {}, personalized: true, sample: false, generatedAt: iso(3 * 86_400_000), readAt: null, rating: null, bookmarked: false, actionItems: [] },
  { id: 'l4', storeId: 's1', lessonType: 'PATTERN_STUDY', category: 'REVENUE', title: 'Reading a revenue spike honestly', summary: 'What a two-sigma day does and does not mean.', contentMarkdown: '## Spikes', readingTimeMinutes: 3, basedOnData: {}, personalized: true, sample: false, generatedAt: iso(4 * 86_400_000), readAt: null, rating: null, bookmarked: false, actionItems: [] },
]

const PATTERNS = Array.from({ length: 6 }, (_, index) => ({
  id: `p${index}`, storeId: 's1', patternType: ['TIME', 'PRODUCT', 'CUSTOMER', 'BEHAVIORAL', 'SEASONAL', 'CORRELATION'][index]!,
  title: ['Weekend peak', 'Hero product pull', 'Repeat cadence', 'Evening orders', 'Month-end lift', 'AOV vs discount'][index]!,
  description: 'Measured from your synced orders.', patternData: {}, occurrenceCount: 3 + index * 2,
  confidenceScore: 0.45 + index * 0.08, firstDetected: iso(20 * 86_400_000), lastConfirmed: iso(86_400_000), status: 'ACTIVE', alertsEnabled: index === 0,
}))

const PERSONAS = [
  { id: 'pe1', storeId: 's1', personaName: 'Weekend regulars', personaEmoji: '🛍️', segmentCriteria: {}, percentageOfCustomers: 38, behaviorPatterns: ['Buy on Saturdays'], motivations: ['Convenience'], howToReach: ['Weekend email'], estimatedRevenueImpact: 4200, revenueCurrency: 'USD', confidenceScore: 0.72, customerCount: 71, radar: [{ trait: 'Frequency', score: 0.8 }, { trait: 'Value', score: 0.6 }, { trait: 'Recency', score: 0.7 }, { trait: 'Breadth', score: 0.4 }, { trait: 'Loyalty', score: 0.75 }], generatedAt: iso(86_400_000) },
  { id: 'pe2', storeId: 's1', personaName: 'One-and-done', personaEmoji: '🧭', segmentCriteria: {}, percentageOfCustomers: 44, behaviorPatterns: ['Single order'], motivations: ['Gift'], howToReach: ['Post-purchase flow'], estimatedRevenueImpact: 1800, revenueCurrency: 'USD', confidenceScore: 0.66, customerCount: 82, radar: [{ trait: 'Frequency', score: 0.2 }, { trait: 'Value', score: 0.45 }, { trait: 'Recency', score: 0.5 }, { trait: 'Breadth', score: 0.25 }, { trait: 'Loyalty', score: 0.2 }], generatedAt: iso(86_400_000) },
  { id: 'pe3', storeId: 's1', personaName: 'High spenders', personaEmoji: '💎', segmentCriteria: {}, percentageOfCustomers: 18, behaviorPatterns: ['Large baskets'], motivations: ['Quality'], howToReach: ['VIP list'], estimatedRevenueImpact: 6100, revenueCurrency: 'USD', confidenceScore: 0.8, customerCount: 35, radar: [{ trait: 'Frequency', score: 0.55 }, { trait: 'Value', score: 0.95 }, { trait: 'Recency', score: 0.6 }, { trait: 'Breadth', score: 0.7 }, { trait: 'Loyalty', score: 0.6 }], generatedAt: iso(86_400_000) },
]

const INVESTIGATIONS = [
  { id: 'i1', storeId: 's1', question: 'Why did revenue drop last week?', status: 'COMPLETED', steps: ['Split revenue into orders × AOV'], dataSourcesAnalyzed: ['orders', 'products'], rootCauses: [{ cause: 'Fewer orders from returning customers', impactShare: 0.52, evidence: '32 fewer repeat orders', confidence: 0.7 }, { cause: 'Hero product out of stock for 3 days', impactShare: 0.3, evidence: 'Inventory hit zero', confidence: 0.66 }, { cause: 'Lower average order value', impactShare: 0.18, evidence: 'AOV fell 6%', confidence: 0.6 }], confidenceScore: 0.68, whatToDo: ['Restock the hero product'], preventionTips: ['Set a cover alert'], createdAt: iso(2 * 86_400_000), completedAt: iso(2 * 86_400_000) },
]

const TRENDS = [
  { id: 't1', storeId: 's1', trendType: 'BUSINESS', category: 'PRODUCTS', title: 'Snowboards rising', description: 'Units up across the category.', direction: 'UP', magnitude: 34, timePeriod: 'last 30 days', dataSource: 'INTERNAL', confidenceScore: 0.72, detectedAt: iso(86_400_000), alertsEnabled: false },
  { id: 't2', storeId: 's1', trendType: 'BUSINESS', category: 'CUSTOMERS', title: 'New customer rate cooling', description: 'First-time buyers slowing.', direction: 'DOWN', magnitude: 18, timePeriod: 'last 30 days', dataSource: 'INTERNAL', confidenceScore: 0.64, detectedAt: iso(2 * 86_400_000), alertsEnabled: false },
  { id: 't3', storeId: 's1', trendType: 'BUSINESS', category: 'REVENUE', title: 'AOV holding steady', description: 'Average order value flat.', direction: 'STABLE', magnitude: 2, timePeriod: 'last 30 days', dataSource: 'INTERNAL', confidenceScore: 0.6, detectedAt: iso(3 * 86_400_000), alertsEnabled: false },
  { id: 't4', storeId: 's1', trendType: 'BUSINESS', category: 'MARKETING', title: 'Email-sourced orders climbing', description: 'Email share of orders up.', direction: 'UP', magnitude: 12, timePeriod: 'last 30 days', dataSource: 'INTERNAL', confidenceScore: 0.58, detectedAt: iso(4 * 86_400_000), alertsEnabled: false },
]

const PREDICTIONS = [
  { id: 'pr1', storeId: 's1', predictionType: 'REVENUE', horizon: '7_DAYS', title: 'Revenue for the next 7 days', description: 'Weekday-seasonal blend of your last 12 weeks.', predictedValue: 5210, predictedLow: 4300, predictedHigh: 6100, currency: 'USD', confidenceScore: 0.71, method: 'weekday-seasonal + linear trend', series: Array.from({ length: 7 }, (_, index) => ({ day: day(-index), value: 700 + index * 40, lower: 560 + index * 30, upper: 860 + index * 55 })), basedOn: ['96 days of revenue'], predictedFor: day(-7), actualValue: null, accuracyScore: null, createdAt: iso(3_600_000) },
]

let scenarioStore: Scenario = 'trial'

function installMock(scenario: Scenario) {
  scenarioStore = scenario
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const respond = (data: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true, data }) }) as Response
    const s = scenarioStore
    const paid = s === 'growth'
    if (url.includes('/insights/overview')) return respond(overview(s))
    if (url.includes('/insights/discoveries/feed')) return respond({ plan: overview(s).plan, trial: s !== 'growth', readiness: readiness(s), discoveries: DISCOVERIES[s] })
    if (url.includes('/insights/discoveries/generate')) return respond({ generated: DISCOVERIES[s].length, discoveries: DISCOVERIES[s], usage: { used: 1, limit: 1, percent: 100, warning: true, blocked: true } })
    if (url.includes('/insights/discoveries')) return respond({ items: DISCOVERIES[s] })
    if (url.includes('/insights/lessons')) return respond({ items: paid ? LESSONS : LESSONS.slice(0, 1) })
    if (url.includes('/insights/patterns')) return respond({ plan: overview(s).plan, viewOnly: !paid, patterns: paid ? PATTERNS : [] })
    if (url.includes('/insights/personas')) return respond({ plan: overview(s).plan, personas: paid ? PERSONAS : [], readiness: readiness(s) })
    if (url.includes('/insights/investigations')) return respond({ items: paid ? INVESTIGATIONS : [] })
    if (url.includes('/insights/trends')) return respond({ plan: overview(s).plan, freshness: 'DAILY', trends: paid ? TRENDS : [] })
    if (url.includes('/insights/predictions')) return respond({ plan: overview(s).plan, horizons: ['7_DAYS', '30_DAYS'], predictions: paid ? PREDICTIONS : [], readiness: readiness(s) })
    if (url.includes('/insights/comparisons')) return respond({ items: [] })
    if (url.includes('/insights/knowledge')) return respond({ items: [] })
    if (url.includes('/insights/timeline')) return respond({ plan: overview(s).plan, windowDays: 30, events: [] })
    if (url.includes('/insights/preferences')) return respond(overview(s).preferences)
    if (url.includes('/insights/api-access')) return respond({ plan: overview(s).plan, enabled: false, maskedKey: null, rateLimitPerHour: null, usage: { requestsThisHour: 0, requestsToday: 0 }, recent: [] })
    return respond({ note: 'unmocked', url })
  }) as typeof fetch
}

const params = new URLSearchParams(window.location.search)

function Harness() {
  const [light, setLight] = useState(params.get('theme') !== 'dark')
  const [scenario, setScenario] = useState<Scenario>((params.get('data') as Scenario) ?? 'trial')
  const [mountKey, setMountKey] = useState(0)
  const [note, setNote] = useState('—')
  const switchScenario = (next: Scenario) => { setScenario(next); installMock(next); setMountKey((key) => key + 1) }
  return (
    <div className={`app-shell ${light ? 'light-mode' : ''}`} style={{ minHeight: '100vh' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderBottom: '1px solid var(--border-soft)', background: 'var(--card)', flexWrap: 'wrap', color: 'var(--text)', fontSize: 12 }}>
        <strong style={{ marginRight: 6 }}>PatternAI — verification harness</strong>
        {(['fresh', 'trial', 'growth'] as Scenario[]).map((id) => (
          <Button key={id} onClick={() => switchScenario(id)} className={`button ${scenario === id ? 'primary' : 'secondary'}`}>{id}</Button>
        ))}
        <span style={{ color: 'var(--text-tertiary)' }}>event → {note}</span>
        <span style={{ flex: 1 }} />
        <Button onClick={() => setLight((value) => !value)} className="button secondary">{light ? 'Dark' : 'Light'} mode</Button>
      </div>
      <div className="page-scroll">
        <div className="page-content">
          <PatternAiWorkspace
            key={`${mountKey}-${scenario}`}
            context={{ shop: 'demo-store.myshopify.com', storeId: 's1' } as WorkspaceContext}
            onToast={(message) => setNote(message)}
            onNavigateBilling={() => setNote('navigate:billing')}
          />
        </div>
      </div>
    </div>
  )
}

installMock((params.get('data') as Scenario) ?? 'trial')
const root = document.getElementById('root')
if (!root) throw new Error('pa-verify root missing')
createRoot(root).render(<StrictMode><Harness /></StrictMode>)
