// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.js'

/**
 * PatternAI mount smoke test.
 *
 * The module previously answered its own page with "The laboratory hit a snag
 * — Internal server error". This test renders the real app shell on the
 * PatternAI deep link, first against a healthy backend and then against a
 * backend that 500s on every PatternAI endpoint, and asserts that the page
 * still renders its shell, its navigation and a retryable message rather than
 * collapsing. Any React console error fails the test.
 */

const consoleErrors: string[] = []
let root: Root | null = null

const envelope = (data: unknown): unknown => ({ ok: true, data, requestId: 'patternai-mount-test' })

const READINESS = {
  revenueDays: 96, totalOrders: 1320, customerCount: 240, productsWithSales: 3,
  canDiscover: true, canPersonas: true, canTrends: true, canPatterns: true, canPredict: true,
  discoverRequirement: 'Discoveries need 7 days of revenue history or 10 orders.',
  personasRequirement: { met: true, have: 240, need: 50 },
  trendsRequirement: { met: true, have: 96, need: 60 },
  predictRequirement: { met: true, have: 96, need: 14 },
}

const OVERVIEW = {
  plan: 'growth',
  features: { discoveries: true, lessons: true, patterns: true, personas: true, investigations: true, trends: true, comparisons: true, knowledge: true, timeline: true, predictions: true, autoDiscovery: true, export: true, share: true, apiAccess: false, externalTrends: true, anomalyAlerts: true },
  requiredPlans: { discoveries: 'start', lessons: 'start', patterns: 'start', personas: 'start', investigations: 'start', trends: 'trial', comparisons: 'start', knowledge: 'start', timeline: 'trial', predictions: 'start', autoDiscovery: 'start', export: 'growth', share: 'growth', apiAccess: 'commander', externalTrends: 'start', anomalyAlerts: 'growth' },
  usage: { discoveries: { used: 4, limit: 20, remaining: 16 }, investigations: { used: 1, limit: 10, remaining: 9 } },
  counts: { newDiscoveries: 7, totalDiscoveries: 9, patterns: 5, lessons: 3, lessonsRead: 1, personas: 3, investigations: 2, trends: 6, predictions: 4, comparisons: 1, knowledge: 2 },
  readiness: READINESS,
  preferences: { storeId: 'mount-test', autoDiscoveryEnabled: true, discoveryFrequency: 'DAILY', discoveryCategories: ['REVENUE'], notificationPreferences: { highConfidenceDiscoveries: true, trendAlerts: true, weeklyDigest: false, anomalyAlerts: true }, trendMonitoringEnabled: true, personaUpdatesEnabled: true, apiAccessEnabled: false, apiKeyMasked: null, language: 'en', updatedAt: '2026-08-18T00:00:00.000Z' },
  autoDiscoveryRan: false,
  trial: false,
  degraded: [],
  generatedAt: '2026-08-18T00:00:00.000Z',
}

const DISCOVERY = {
  id: 'disc_7ab31c04', storeId: 'mount-test', discoveryType: 'PATTERN', category: 'TIME',
  title: 'Sunday consistently outperforms Monday',
  description: 'Sunday carries 21% of weekly revenue while Monday carries 9%.',
  explanation: '', confidenceScore: 0.95, impactEstimate: 1379.88, impactCurrency: 'USD',
  dataEvidence: { sundayShare: 0.21, mondayShare: 0.09, weeksObserved: 13 },
  visualizationData: {}, discoveredAt: '2026-08-18T00:00:00.000Z', status: 'NEW',
  sample: false, viewedAt: null, actionTakenAt: null, expiresAt: null,
}

function mockBackend(mode: 'healthy' | 'broken'): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/session/context')) return json(200, envelope({ storeId: 'mount-test', shop: 'mount-test.myshopify.com' }))
    if (url.includes('/security/csrf')) return json(200, envelope({ csrfToken: 'mount-token' }))
    if (url.includes('/patternai/') || url.includes('/insights/')) {
      if (mode === 'broken') return json(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} } })
      if (url.includes('/overview')) return json(200, envelope(OVERVIEW))
      if (url.includes('/discoveries/feed')) return json(200, envelope({ plan: 'growth', trial: false, readiness: READINESS, discoveries: [DISCOVERY] }))
      if (url.includes('/discoveries')) return json(200, envelope({ items: [DISCOVERY] }))
      return json(200, envelope({ items: [] }))
    }
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
  }))
}

beforeEach(() => {
  consoleErrors.length = 0
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', '/ai-growth-command/patternai?storeId=mount-test')
  window.localStorage.clear()
  const originalError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
    originalError(...args)
  })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null, writable: true, configurable: true })
  mockBackend('healthy')
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

async function mountApp(): Promise<void> {
  const container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(createElement(StrictMode, null, createElement(App))) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

describe('PatternAI page mount', () => {
  it('renders the PatternAI deep link without crashing or logging errors', async () => {
    await mountApp()
    expect(document.querySelector('.pa-root')).not.toBeNull()
    expect(document.body.textContent ?? '').toContain('Discover the patterns that drive your business')
    expect(consoleErrors).toEqual([])
  })

  it('shows the discovery feed computed by the API, with evidence and confidence', async () => {
    await mountApp()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Sunday consistently outperforms Monday')
    expect(text).toContain('New pattern detected')
    expect(text).toContain('95%')
    expect(text).toContain('$1,380')
  })

  it('renders the grouped section navigation', async () => {
    await mountApp()
    const labels = [...document.querySelectorAll('.pa-nav-item')].map((item) => item.textContent ?? '')
    for (const label of ['Discovery feed', 'Learning library', 'Pattern lab', 'Customer personas', 'Why? explorer', 'Trend watcher', 'Knowledge base', 'Predictions', 'API access']) {
      expect(labels.some((text) => text.includes(label))).toBe(true)
    }
  })

  it('keeps the page usable when every PatternAI endpoint 500s', async () => {
    mockBackend('broken')
    await mountApp()
    const text = document.body.textContent ?? ''
    expect(document.querySelector('.pa-root')).not.toBeNull()
    expect(document.querySelectorAll('.pa-nav-item').length).toBeGreaterThan(6)
    expect(text).toContain('This section could not load')
    expect(text).toContain('Try again')
    expect(text.toLowerCase()).not.toContain('laboratory')
    expect(consoleErrors).toEqual([])
  })

  it('normalises the pre-rebrand /ai-growth-command/insights path', async () => {
    window.history.replaceState({}, '', '/ai-growth-command/insights/patterns?storeId=mount-test')
    await mountApp()
    expect(window.location.pathname).toBe('/ai-growth-command/patternai/patterns')
    expect(document.querySelector('.pa-root')).not.toBeNull()
  })

  it('carries no Insights Hub branding anywhere in the shell', async () => {
    await mountApp()
    expect(document.body.textContent ?? '').not.toContain('Insights Hub')
    expect((document.querySelector('.side-nav')?.textContent ?? '')).toContain('PatternAI')
  })
})
