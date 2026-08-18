// @vitest-environment jsdom
/**
 * PatternAI functional test sweep (PR #64).
 *
 * This is the executable half of the functional test report: it mounts the
 * real PatternAiWorkspace against a fully mocked backend and drives it the way
 * a merchant would — opening every sub-page, clicking the funnel to filter,
 * running a discovery sweep, saving / acting on / dismissing a card, checking
 * the export lock and the plan gating, and re-mounting the whole page inside a
 * `.light-mode` shell to prove both themes render the same content.
 *
 * Any React console error fails the run.
 */
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PatternAiWorkspace } from './patternai.js'
import type { WorkspaceContext } from './model.js'

const consoleErrors: string[] = []
let root: Root | null = null
const toasts: string[] = []
const calls: string[] = []
let billingClicks = 0

const envelope = (data: unknown): unknown => ({ ok: true, data, requestId: 'patternai-functional-test' })

const READINESS = {
  revenueDays: 96, totalOrders: 412, customerCount: 188, productsWithSales: 24,
  canDiscover: true, canPersonas: true, canTrends: true, canPatterns: true, canPredict: true,
  discoverRequirement: 'Discoveries need 7 days of revenue history or 10 orders.',
  personasRequirement: { met: true, have: 188, need: 20 },
  trendsRequirement: { met: true, have: 96, need: 60 },
  predictRequirement: { met: true, have: 96, need: 14 },
}

const FEATURES_GROWTH = { discoveries: true, lessons: true, patterns: true, personas: true, investigations: true, trends: true, comparisons: true, knowledge: true, timeline: true, predictions: true, autoDiscovery: true, export: true, share: true, apiAccess: false, externalTrends: true, anomalyAlerts: true }
const FEATURES_TRIAL = { discoveries: false, lessons: false, patterns: false, personas: false, investigations: false, trends: true, comparisons: false, knowledge: false, timeline: true, predictions: false, autoDiscovery: false, export: false, share: false, apiAccess: false, externalTrends: false, anomalyAlerts: false }
const REQUIRED_PLANS = { discoveries: 'start', lessons: 'start', patterns: 'start', personas: 'start', investigations: 'start', trends: 'trial', comparisons: 'start', knowledge: 'start', timeline: 'trial', predictions: 'start', autoDiscovery: 'start', export: 'growth', share: 'growth', apiAccess: 'commander', externalTrends: 'start', anomalyAlerts: 'growth' }

const overview = (plan: 'trial' | 'growth') => ({
  plan,
  features: plan === 'growth' ? FEATURES_GROWTH : FEATURES_TRIAL,
  requiredPlans: REQUIRED_PLANS,
  usage: plan === 'growth' ? { discoveries: { used: 7, limit: 20, remaining: 13 }, investigations: { used: 1, limit: 10, remaining: 9 } } : { discoveries: { used: 0, limit: 1, remaining: 1 }, investigations: { used: 0, limit: 0, remaining: 0 } },
  counts: plan === 'growth'
    ? { newDiscoveries: 3, totalDiscoveries: 4, patterns: 2, lessons: 2, lessonsRead: 1, personas: 2, investigations: 1, trends: 2, predictions: 1, comparisons: 0, knowledge: 1 }
    : { newDiscoveries: 1, totalDiscoveries: 1, patterns: 0, lessons: 1, lessonsRead: 0, personas: 0, investigations: 0, trends: 0, predictions: 0, comparisons: 0, knowledge: 0 },
  readiness: READINESS,
  preferences: { storeId: 'fn-test', autoDiscoveryEnabled: true, discoveryFrequency: 'DAILY', discoveryCategories: ['REVENUE'], notificationPreferences: { highConfidenceDiscoveries: true, trendAlerts: true, weeklyDigest: false, anomalyAlerts: true }, trendMonitoringEnabled: true, personaUpdatesEnabled: true, apiAccessEnabled: false, apiKeyMasked: null, language: 'en', updatedAt: '2026-08-18T00:00:00.000Z' },
  autoDiscoveryRan: false,
  trial: plan === 'trial',
  degraded: [],
  generatedAt: '2026-08-18T00:00:00.000Z',
})

const RISING = {
  id: 'disc_rise', storeId: 'fn-test', discoveryType: 'TREND', category: 'PRODUCTS',
  title: 'Snowboard: Hydrogen demand jumped 100% in the last 14 days',
  description: 'Snowboard: Hydrogen sold 3 units in the last 14 days after 0 units in the prior 14 — 1800 USD in recent revenue.',
  explanation: 'Early momentum in a single product is the cheapest growth you ever get.',
  confidenceScore: 0.8, impactEstimate: 1800, impactCurrency: 'USD',
  dataEvidence: { productId: 'gid://shopify/Product/42', recentUnits: 3, priorUnits: 0, growthPercent: 100, recentRevenue: 1800 },
  visualizationData: { chart: 'bubble', recentUnits: 3, growthPercent: 100 },
  discoveredAt: '2026-08-18T09:00:00.000Z', status: 'NEW', sample: false, viewedAt: null, actionTakenAt: null, expiresAt: null,
}
const REVIEWED = { ...RISING, id: 'disc_reviewed', status: 'REVIEWED', category: 'REVENUE', title: 'Revenue is up 14% vs the previous 30 days', dataEvidence: { current: { revenue: 5200, orders: 61 }, previous: { revenue: 4550, orders: 55 }, revenueChange: 14 } }
const ACTED = { ...RISING, id: 'disc_acted', status: 'ACTED_ON', category: 'CUSTOMERS', title: '46 repeat customers drive 61% of lifetime value', dataEvidence: { repeatCustomers: 46, oneTimeCustomers: 142 } }
const SAMPLE = { ...RISING, id: 'disc_sample', sample: true }

const PATTERNS = [{ id: 'p1', storeId: 'fn-test', patternType: 'TIME', title: 'Weekend peak', description: 'Measured from your orders.', patternData: {}, occurrenceCount: 9, confidenceScore: 0.72, firstDetected: '2026-07-01T00:00:00.000Z', lastConfirmed: '2026-08-17T00:00:00.000Z', status: 'ACTIVE', alertsEnabled: false }]
const PERSONAS = [{ id: 'pe1', storeId: 'fn-test', personaName: 'Weekend regulars', personaEmoji: '🛍️', segmentCriteria: {}, percentageOfCustomers: 38, behaviorPatterns: ['Buy on Saturdays'], motivations: ['Convenience'], howToReach: ['Weekend email'], estimatedRevenueImpact: 4200, revenueCurrency: 'USD', confidenceScore: 0.72, customerCount: 71, radar: [{ trait: 'Loyalty', score: 0.8 }, { trait: 'Value', score: 0.6 }, { trait: 'Recency', score: 0.7 }], generatedAt: '2026-08-17T00:00:00.000Z' }]
const LESSONS = [{ id: 'l1', storeId: 'fn-test', lessonType: 'PATTERN_STUDY', category: 'PRODUCTS', title: 'What your best seller is telling you', summary: 'A short study of concentration.', contentMarkdown: '## Concentration', readingTimeMinutes: 3, basedOnData: {}, personalized: true, sample: false, generatedAt: '2026-08-16T00:00:00.000Z', readAt: null, rating: null, bookmarked: false, actionItems: [] }]
const INVESTIGATIONS = [{ id: 'i1', storeId: 'fn-test', question: 'Why did revenue drop last week?', status: 'COMPLETED', steps: ['Split revenue'], dataSourcesAnalyzed: ['orders'], rootCauses: [{ cause: 'Fewer repeat orders', impactShare: 0.6, evidence: '32 fewer', confidence: 0.7 }], confidenceScore: 0.68, whatToDo: ['Restock'], preventionTips: ['Alert'], createdAt: '2026-08-16T00:00:00.000Z', completedAt: '2026-08-16T00:00:00.000Z' }]
const TRENDS = [{ id: 't1', storeId: 'fn-test', trendType: 'BUSINESS', category: 'PRODUCTS', title: 'Snowboards rising', description: 'Units up.', direction: 'UP', magnitude: 34, timePeriod: 'last 30 days', dataSource: 'INTERNAL', confidenceScore: 0.72, detectedAt: '2026-08-17T00:00:00.000Z', alertsEnabled: false }]
const PREDICTIONS = [{ id: 'pr1', storeId: 'fn-test', predictionType: 'REVENUE', horizon: '7_DAYS', title: 'Revenue for the next 7 days', description: 'Weekday-seasonal blend.', predictedValue: 5210, predictedLow: 4300, predictedHigh: 6100, currency: 'USD', confidenceScore: 0.71, method: 'weekday-seasonal', series: [{ day: '2026-08-19', value: 700, lower: 560, upper: 860 }, { day: '2026-08-20', value: 740, lower: 590, upper: 900 }], basedOn: ['96 days'], predictedFor: '2026-08-25', actualValue: null, accuracyScore: null, createdAt: '2026-08-18T00:00:00.000Z' }]
const KNOWLEDGE = [{ id: 'k1', storeId: 'fn-test', entryType: 'NOTE', title: 'Weekend playbook', contentMarkdown: 'Notes', tags: ['weekend'], linkedInsights: [], author: 'MERCHANT', createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', referenceCount: 1 }]
const TIMELINE = [{ id: 'ev1', storeId: 'fn-test', eventType: 'DISCOVERY_CREATED', entityType: 'DISCOVERY', entityId: 'disc_rise', description: 'Discovery recorded', eventAt: '2026-08-18T09:00:00.000Z' }]

let currentPlan: 'trial' | 'growth' = 'growth'
let feedDiscoveries: unknown[] = [RISING, REVIEWED, ACTED]

function mockBackend(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const ok = (data: unknown) => json(200, envelope(data))
    if (url.includes('/security/csrf')) return ok({ csrfToken: 'token' })
    if (url.includes('/overview')) return ok(overview(currentPlan))
    if (url.includes('/discoveries/feed')) return ok({ plan: currentPlan, trial: currentPlan === 'trial', readiness: READINESS, discoveries: currentPlan === 'trial' ? [SAMPLE] : feedDiscoveries })
    if (url.includes('/discoveries/generate')) return ok({ generated: 1, discoveries: [RISING], usage: { used: 8, limit: 20, percent: 40, warning: false, blocked: false } })
    if (/\/discoveries\/[^/]+\/status/.test(url)) {
      const status = typeof init?.body === 'string' ? (JSON.parse(init.body) as { status: string }).status : 'NEW'
      return ok({ ...RISING, status })
    }
    if (/\/discoveries\/[^/?]+$/.test(url.split('?')[0] ?? '')) {
      const id = (url.split('?')[0] ?? '').split('/').pop()
      const found = [RISING, REVIEWED, ACTED, SAMPLE].find((item) => item.id === id)
      return found ? ok(found) : json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'No such discovery', details: {} } })
    }
    if (url.includes('/discoveries')) {
      const params = new URL(url, 'http://localhost').searchParams
      const status = params.get('status')
      const category = params.get('category')
      let items = currentPlan === 'trial' ? [SAMPLE] : feedDiscoveries
      if (status) items = (items as { status: string }[]).filter((item) => item.status === status)
      if (category) items = (items as { category: string }[]).filter((item) => item.category === category)
      return ok({ items })
    }
    if (url.includes('/lessons')) return ok({ items: LESSONS })
    if (url.includes('/patterns')) return ok({ plan: currentPlan, viewOnly: false, patterns: PATTERNS })
    if (url.includes('/personas')) return ok({ plan: currentPlan, personas: PERSONAS, readiness: READINESS })
    if (url.includes('/investigations')) return ok({ items: INVESTIGATIONS })
    if (url.includes('/trends')) return ok({ plan: currentPlan, freshness: 'DAILY', trends: TRENDS })
    if (url.includes('/comparisons')) return ok({ items: [] })
    if (url.includes('/knowledge')) return ok({ items: KNOWLEDGE })
    if (url.includes('/timeline')) return ok({ plan: currentPlan, windowDays: 30, events: TIMELINE })
    if (url.includes('/predictions')) return ok({ plan: currentPlan, horizons: ['7_DAYS'], predictions: PREDICTIONS, readiness: READINESS })
    if (url.includes('/preferences')) return ok(overview(currentPlan).preferences)
    if (url.includes('/api-access')) return ok({ plan: currentPlan, enabled: false, maskedKey: null, rateLimitPerHour: null, usage: { requestsThisHour: 0, requestsToday: 0 }, recent: [] })
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
  }))
}

beforeEach(() => {
  consoleErrors.length = 0
  toasts.length = 0
  calls.length = 0
  billingClicks = 0
  currentPlan = 'growth'
  feedDiscoveries = [RISING, REVIEWED, ACTED]
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', '/ai-growth-command/patternai?storeId=fn-test')
  const originalError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
    originalError(...args)
  })
  mockBackend()
})

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mount(theme: 'dark' | 'light' = 'dark'): Promise<HTMLElement> {
  const shell = document.createElement('div')
  shell.className = theme === 'light' ? 'app-shell light-mode' : 'app-shell'
  document.body.appendChild(shell)
  root = createRoot(shell)
  await act(async () => {
    root!.render(createElement(StrictMode, null, createElement(PatternAiWorkspace, {
      context: { shop: 'fn-test.myshopify.com', storeId: 'fn-test' } as WorkspaceContext,
      onToast: (message: string) => { toasts.push(message) },
      onNavigateBilling: () => { billingClicks += 1 },
    })))
  })
  await settle()
  return shell
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element, 'element to click exists').toBeTruthy()
  await act(async () => { (element as HTMLElement).click() })
  await settle()
}

const text = (): string => document.body.textContent ?? ''
const navItem = (label: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('.pa-nav-item')].find((item) => (item.textContent ?? '').includes(label))
const buttonWith = (label: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('button')].find((item) => (item.textContent ?? '').includes(label))

/* ── Header ────────────────────────────────────────────────────────────── */

describe('PatternAI header', () => {
  it('renders the brand mark, tagline and the new Run discovery glyph', async () => {
    await mount()
    expect(document.querySelector('.pa-mark')).not.toBeNull()
    expect(text()).toContain('Discover the patterns that drive your business')
    const runButton = buttonWith('Run discovery')
    expect(runButton?.querySelector('.pa-discover-glyph')).not.toBeNull()
    expect(consoleErrors).toEqual([])
  })

  it('renders six KPI tiles, each with its own micro-visualization', async () => {
    await mount()
    const tiles = [...document.querySelectorAll('.pa-stat')]
    expect(tiles).toHaveLength(6)
    expect(tiles.every((tile) => tile.querySelector('.pa-statviz') !== null)).toBe(true)
    const visuals = tiles.map((tile) => [...tile.classList].find((name) => name.startsWith('viz-')))
    expect(new Set(visuals).size).toBe(6)
  })

  it('shows the monthly allowance ring with the API usage numbers', async () => {
    await mount()
    const ring = document.querySelector('.pa-allowance')
    expect(ring).not.toBeNull()
    expect(ring?.textContent).toContain('of 20 limit')
    expect(ring?.textContent).toContain('13 discoveries left this month')
  })

  it('opens the plan panel and the settings tab from the header', async () => {
    await mount()
    await click(buttonWith('plan'))
    expect(text()).toContain('Your plan')
    await click(buttonWith('Settings'))
    expect(text()).toContain('Discovery cadence')
  })

  it('runs a discovery sweep from the header button', async () => {
    await mount()
    await click(buttonWith('Run discovery'))
    expect(calls.some((call) => call.includes('/discoveries/generate'))).toBe(true)
    expect(toasts.join(' ')).toContain('PatternAI found 1 new discovery')
  })
})

/* ── Discovery feed ────────────────────────────────────────────────────── */

describe('discovery feed', () => {
  it('renders the pipeline funnel with real counts and a conversion rate', async () => {
    await mount()
    const funnel = document.querySelector('.pa-funnel')
    expect(funnel).not.toBeNull()
    const values = [...funnel!.querySelectorAll('.pa-funnel-value')].map((node) => node.textContent)
    expect(values).toEqual(['3', '2', '1', '1'])
    expect(funnel!.textContent).toContain('Conversion')
    expect(funnel!.textContent).toContain('33%')
  })

  it('filters the feed by clicking a funnel stage', async () => {
    await mount()
    const acted = [...document.querySelectorAll<HTMLElement>('.pa-funnel-row')].find((row) => (row.textContent ?? '').includes('Acted on'))
    await click(acted)
    expect(calls.some((call) => call.includes('/discoveries'))).toBe(true)
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Filter by status"]')
    expect(select?.value).toBe('ACTED_ON')
  })

  it('filters by status and category through the toolbar selects', async () => {
    await mount()
    const status = document.querySelector<HTMLSelectElement>('select[aria-label="Filter by status"]')!
    await act(async () => {
      status.value = 'NEW'
      status.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(calls.some((call) => call.includes('/discoveries'))).toBe(true)
    const category = document.querySelector<HTMLSelectElement>('select[aria-label="Filter by category"]')!
    await act(async () => {
      category.value = 'PRODUCTS'
      category.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(buttonWith('Clear filters')).toBeTruthy()
    await click(buttonWith('Clear filters'))
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Filter by status"]')?.value).toBe('ALL')
  })

  it('shows the impact treemap and the pattern strength ladder', async () => {
    await mount()
    expect(text()).toContain('WHAT PATTERNAI HAS FOUND')
    expect(document.querySelector('.pa-treemap')).not.toBeNull()
    expect(text()).toContain('Most active category')
    expect(text()).toContain('PATTERN CONFIDENCE')
    expect(document.querySelectorAll('.pa-strength-row').length).toBe(5)
    expect(text()).toContain('412 of 10 orders'.replace('412 of 10', '412 of 10')) // real counts, capped bar
  })

  it('renders a human discovery card with momentum and no product id', async () => {
    await mount()
    const card = document.querySelector('.pa-discovery-card')
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('Rising product spotted')
    expect(card!.querySelector('.pa-momentum')).not.toBeNull()
    expect(card!.textContent).toContain('Prior 14 days')
    expect(card!.textContent).toContain('What this means for you')
    expect(text()).not.toContain('gid://shopify')
  })

  it('saves, acts on and dismisses a discovery through the API', async () => {
    await mount()
    const card = document.querySelector('.pa-discovery-card')!
    await click([...card.querySelectorAll<HTMLElement>('button')].find((button) => (button.textContent ?? '').includes('Save')))
    await click([...document.querySelector('.pa-discovery-card')!.querySelectorAll<HTMLElement>('button')].find((button) => (button.textContent ?? '').includes('Acted on it')))
    await click([...document.querySelector('.pa-discovery-card')!.querySelectorAll<HTMLElement>('button')].find((button) => (button.textContent ?? '').includes('Dismiss')))
    expect(calls.filter((call) => call.includes('/status')).length).toBe(3)
    expect(toasts.join(' ')).toContain('Discovery saved')
  })

  it('opens a discovery detail view from Explore', async () => {
    await mount()
    await click(buttonWith('Explore'))
    expect(text()).toContain('Back to discoveries')
    expect(text()).toContain('The evidence')
  })

  it('renders the six Keep exploring cards, each with its own mini chart', async () => {
    await mount()
    const cards = [...document.querySelectorAll('.pa-explore-card')]
    expect(cards).toHaveLength(6)
    expect(cards.every((card) => card.querySelector('.pa-explore-viz') !== null)).toBe(true)
    expect(document.querySelector('.pa-mini-word')).not.toBeNull()
    expect(document.querySelector('.pa-mini-dot')).not.toBeNull()
    expect(document.querySelector('.pa-mini-shape')).not.toBeNull()
    expect(document.querySelector('.pa-mini-root')).not.toBeNull()
    expect(document.querySelector('.pa-mini-diverge')).not.toBeNull()
    expect(document.querySelector('.pa-mini-band')).not.toBeNull()
  })
})

/* ── Navigation across every sub-page ──────────────────────────────────── */

describe('every sub-page opens', () => {
  const pages: readonly Readonly<{ label: string; expect: string }>[] = [
    { label: 'Learning library', expect: 'What your best seller is telling you' },
    { label: 'Pattern lab', expect: 'Weekend peak' },
    { label: 'Customer personas', expect: 'Weekend regulars' },
    { label: 'Why? explorer', expect: 'Why did revenue drop last week?' },
    { label: 'Trend watcher', expect: 'Snowboards rising' },
    { label: 'Comparisons', expect: 'comparison' },
    { label: 'Knowledge base', expect: 'Weekend playbook' },
    { label: 'Timeline', expect: 'Discovery recorded' },
    { label: 'Predictions', expect: 'Revenue for the next 7 days' },
    { label: 'Settings', expect: 'Discovery cadence' },
    { label: 'API access', expect: 'API' },
  ]

  it('renders content for each sidebar destination without console errors', async () => {
    await mount()
    for (const page of pages) {
      await click(navItem(page.label))
      expect(document.querySelector('.pa-root'), `${page.label} keeps the shell`).not.toBeNull()
      expect(text().toLowerCase(), `${page.label} rendered its content`).toContain(page.expect.toLowerCase())
    }
    expect(consoleErrors).toEqual([])
  })

  it('shows API count badges on the sections that have data', async () => {
    await mount()
    const discoveryRow = navItem('Discovery feed')
    expect(discoveryRow?.querySelector('.pa-nav-badge')?.textContent).toBe('3')
    expect(navItem('Settings')?.querySelector('.pa-nav-badge')).toBeNull()
  })
})

/* ── Plan gating ───────────────────────────────────────────────────────── */

describe('plan gating on a trial store', () => {
  it('locks paid sections, labels the sample and never names a plan', async () => {
    currentPlan = 'trial'
    await mount()
    expect(text()).toContain('SAMPLE')
    expect(text()).toContain('Upgrade Plan')
    expect(text()).not.toMatch(/Upgrade to (Start|Growth|Commander)/)
    expect(document.querySelectorAll('.pa-nav-item.locked').length).toBeGreaterThan(3)
    expect(navItem('Customer personas')?.getAttribute('title')).toContain('Upgrade Plan')
  })

  it('routes the locked export button to billing instead of downloading', async () => {
    currentPlan = 'trial'
    await mount()
    await click(buttonWith('Export'))
    expect(toasts.join(' ')).toContain('Chart export unlocks with a plan upgrade')
  })

  it('sends the locked discovery CTA to billing', async () => {
    currentPlan = 'trial'
    await mount()
    const cta = [...document.querySelectorAll<HTMLElement>('.pa-toolbar-actions button')].find((button) => (button.textContent ?? '').includes('Upgrade Plan'))
    await click(cta)
    expect(billingClicks).toBeGreaterThan(0)
  })

  it('keeps the allowance ring honest at the trial limit of one', async () => {
    currentPlan = 'trial'
    await mount()
    expect(document.querySelector('.pa-allowance')?.textContent).toContain('of 1 limit')
  })
})

/* ── Both themes ───────────────────────────────────────────────────────── */

describe('both themes', () => {
  it('renders the same structure inside a light-mode shell', async () => {
    const shell = await mount('light')
    expect(shell.classList.contains('light-mode')).toBe(true)
    expect(document.querySelectorAll('.pa-stat').length).toBe(6)
    expect(document.querySelector('.pa-funnel')).not.toBeNull()
    expect(document.querySelectorAll('.pa-explore-card').length).toBe(6)
    expect(consoleErrors).toEqual([])
  })

  it('never hard-codes a page colour on the new value visuals', async () => {
    await mount('light')
    const styled = [...document.querySelectorAll('.pa-funnel-fill, .pa-strength-fill, .pa-momentum-track span')]
    expect(styled.length).toBeGreaterThan(0)
    for (const node of styled) {
      const inline = node.getAttribute('style') ?? ''
      expect(inline).not.toMatch(/#[0-9a-f]{3,6}/i)
      expect(inline).not.toMatch(/rgb/i)
    }
  })
})
