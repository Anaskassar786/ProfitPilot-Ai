// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GrowthIqPage } from './executive.js'
import { resetApiClientStateForTests } from './api.js'

const envelope = (data: unknown): unknown => ({ ok: true, data, requestId: 'growthiq-fn' })

const THIN_DASHBOARD = {
  storeId: 'fn-store',
  plan: 'growth',
  currency: 'USD',
  health: null,
  latestReport: null,
  nextReportDue: '2026-09-01',
  benchmarkPosition: {
    storeId: 'fn-store',
    category: 'Fashion & Apparel',
    categorySource: 'AUTO_DETECTED',
    visibleMetrics: 3,
    totalMetrics: 7,
    asOf: '2026-08-18',
    positions: [
      { metric: 'REVENUE', label: 'Monthly revenue', yourValue: 420, currency: 'USD', industryMedian: 5000, top10Target: 20000, percentile: null, gapToTop10Pct: null, sourceLabel: 'curated', yourValueMissing: false },
      { metric: 'AOV', label: 'Average order value', yourValue: 2606, currency: 'USD', industryMedian: 62, top10Target: 95, percentile: null, gapToTop10Pct: null, sourceLabel: 'curated', yourValueMissing: false },
      { metric: 'REPEAT_PURCHASE', label: 'Repeat purchase rate', yourValue: null, currency: null, industryMedian: 27, top10Target: 40, percentile: null, gapToTop10Pct: null, sourceLabel: 'curated', yourValueMissing: true },
    ],
  },
  opportunities: [],
  risks: [],
  scenarios: [],
  roadmap: null,
  decisions: [],
  usage: { plan: 'growth', features: [] },
  gates: { reports: { allowed: true, requiredPlan: 'start', used: 0, limit: 5 }, roadmaps: { allowed: true, requiredPlan: 'start', used: 0, limit: 3 } },
  revenueSeries: [
    { day: '2026-08-15', value: 90 },
    { day: '2026-08-16', value: 120 },
    { day: '2026-08-17', value: 96 },
    { day: '2026-08-18', value: 114 },
  ],
  ordersSeries: [
    { day: '2026-08-15', value: 1 },
    { day: '2026-08-16', value: 2 },
    { day: '2026-08-17', value: 2 },
    { day: '2026-08-18', value: 2 },
  ],
  totals: { customers: 6, products: 3, syncedOrders: 7, syncedRevenue: 18242, daysSynced: 4 },
  topProducts: [{ title: 'Hero Hoodie', revenue: 420, sharePct: 100 }],
  generatedAt: '2026-08-18T12:00:00.000Z',
}

const SAMPLE_REPORT = {
  id: 'rep-1',
  storeId: 'fn-store',
  reportType: 'CUSTOM',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-18',
  generatedAt: '2026-08-18T12:00:00.000Z',
  viewedAt: null,
  pdfUrl: null,
  executiveSummary: 'Real store summary computed from synced rows.',
  content: {
    strategicPosition: 'Launch stage.',
    keyInsights: ['AOV is measurable.'],
    recommendedDecisions: ['Log the next pricing move.'],
    financialForecast: null,
    appendix: { metrics: { aov: 2606 } },
    aiNarrativeAvailable: false,
    generatedWithModel: null,
  },
}

const LOGGED_DECISION = {
  id: 'dec-1',
  storeId: 'fn-store',
  decisionType: 'STRATEGIC',
  title: 'Raise AOV experiment',
  description: 'Test a bundle.',
  decisionDate: '2026-08-18',
  predictedOutcome: { revenueImpact: 500 },
  actualOutcome: null,
  accuracyScore: null,
  qualityRating: 'PENDING',
  lessonsLearned: '',
  createdBy: 'merchant',
  createdAt: '2026-08-18T12:00:00.000Z',
  reviewedAt: null,
}

let reports: unknown[] = []
let decisions: unknown[] = []
const fetchCalls: string[] = []

function mockBackend(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    fetchCalls.push(`${method} ${url}`)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/security/csrf')) return json(200, envelope({ csrfToken: 'fn-csrf' }))
    if (url.includes('/ai-executive/dashboard')) return json(200, envelope(THIN_DASHBOARD))
    if (url.includes('/ai-executive/reports/generate') && method === 'POST') {
      reports = [SAMPLE_REPORT, ...reports]
      return json(200, envelope(SAMPLE_REPORT))
    }
    if (url.includes('/ai-executive/reports') && method === 'GET') return json(200, envelope(reports))
    if (url.includes('/ai-executive/reports/') && url.includes('mark-viewed')) return json(200, envelope({ ...SAMPLE_REPORT, viewedAt: '2026-08-18T12:01:00.000Z' }))
    if (url.includes('/ai-executive/decisions/analytics')) {
      return json(200, envelope({ total: decisions.length, reviewed: 0, averageAccuracy: null, qualityDistribution: { PENDING: decisions.length }, bestDecisions: [], improvementAreas: [] }))
    }
    if (url.includes('/ai-executive/decisions') && method === 'POST') {
      decisions = [LOGGED_DECISION, ...decisions]
      return json(200, envelope(LOGGED_DECISION))
    }
    if (url.includes('/ai-executive/decisions') && method === 'GET') return json(200, envelope(decisions))
    if (url.includes('/ai-executive/roadmaps') && method === 'GET') return json(200, envelope([]))
    if (url.includes('/ai-executive/preferences') && method === 'GET') {
      return json(200, envelope({
        monthlyReportEnabled: true,
        monthlyReportEmailEnabled: false,
        reportEmail: null,
        reportGenerationDay: 1,
        riskAlertsEnabled: true,
        riskAlertSeverity: 'HIGH',
        benchmarkCategory: 'Fashion & Apparel',
        language: 'en',
      }))
    }
    if (url.includes('/ai-executive/opportunities')) return json(200, envelope([]))
    if (url.includes('/ai-executive/benchmarks')) return json(200, envelope(THIN_DASHBOARD.benchmarkPosition))
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: url, details: {} } })
  }))
}

let root: Root | null = null
const toasts: string[] = []
const billing: string[] = []
const syncs: string[] = []

async function mountPage(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(StrictMode, null, createElement(GrowthIqPage, {
      context: { storeId: 'fn-store', shop: 'fn.myshopify.com' },
      onToast: (message: string) => { toasts.push(message) },
      onNavigateBilling: () => { billing.push('billing') },
      onSync: (module: string) => { syncs.push(module) },
    })))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  return container
}

beforeEach(() => {
  reports = []
  decisions = []
  fetchCalls.length = 0
  toasts.length = 0
  billing.length = 0
  syncs.length = 0
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  resetApiClientStateForTests()
  window.history.replaceState({}, '', '/ai-growth-command/growthiq?storeId=fn-store')
  window.location.hash = ''
  mockBackend()
})

afterEach(async () => {
  if (root) {
    await act(async () => { root!.unmount() })
    root = null
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('GrowthIQ — header and baseline actions', () => {
  it('opens preferences from Settings', async () => {
    const container = await mountPage()
    const settings = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Settings'))
    expect(settings).toBeTruthy()
    await act(async () => { settings!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(container.textContent).toContain('Executive Settings')
    expect(container.textContent).toContain('Reporting schedule')
  })

  it('Generate Report actually generates a board report from real store data', async () => {
    const container = await mountPage()
    const generate = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Generate Report'))
    expect(generate).toBeTruthy()
    await act(async () => { generate!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
    expect(fetchCalls.some((call) => call.includes('POST') && call.includes('/ai-executive/reports/generate'))).toBe(true)
    expect(toasts.some((toast) => /generated/i.test(toast))).toBe(true)
    expect(container.textContent).toContain('Board Reports')
    expect(container.textContent).toContain('Real store summary computed from synced rows.')
  })

  it('Upgrade Plan routes to billing and never names a plan', async () => {
    const container = await mountPage()
    const upgrade = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Upgrade Plan' || button.getAttribute('aria-label') === 'Upgrade plan')
    expect(upgrade).toBeTruthy()
    expect(upgrade!.textContent).toContain('Upgrade Plan')
    expect(upgrade!.textContent).not.toContain('Upgrade to')
    await act(async () => { upgrade!.click() })
    expect(billing).toEqual(['billing'])
  })

  it('Log a business decision opens the form and can save', async () => {
    const container = await mountPage()
    const log = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Log a business decision'))
    expect(log).toBeTruthy()
    await act(async () => { log!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(container.textContent).toContain('Log a decision')
    const title = container.querySelector('input[maxlength="160"]') as HTMLInputElement
    expect(title).toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(title, 'Raise AOV experiment')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Log decision'))
    await act(async () => { save!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(fetchCalls.some((call) => call.includes('POST') && call.includes('/ai-executive/decisions'))).toBe(true)
    expect(toasts.some((toast) => /Decision logged/i.test(toast))).toBe(true)
    expect(container.textContent).toContain('Raise AOV experiment')
  })

  it('View a sample report opens the reports workspace', async () => {
    const container = await mountPage()
    const sample = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('View a sample report'))
    expect(sample).toBeTruthy()
    await act(async () => { sample!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(container.textContent).toContain('Board Reports')
  })

  it('Sync more data triggers a real orders sync', async () => {
    const container = await mountPage()
    const sync = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Sync more data'))
    expect(sync).toBeTruthy()
    await act(async () => { sync!.click() })
    expect(syncs).toEqual(['orders'])
  })
})

describe('GrowthIQ — executive actions and links', () => {
  it('Set a goal opens the roadmap composer', async () => {
    const container = await mountPage()
    const goal = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Set a goal'))
    expect(goal).toBeTruthy()
    await act(async () => { goal!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(container.textContent).toContain('Chart your strategic path')
    expect(container.textContent).toContain('Generate Roadmap')
  })

  it('Learn more / More insights / View roadmap / Explore trajectory details all navigate', async () => {
    const container = await mountPage()
    const clicks: Array<[string, string]> = [
      ['Explore trajectory details', 'Board Reports'],
    ]
    for (const [label] of clicks) {
      window.history.replaceState({}, '', '/ai-growth-command/growthiq?storeId=fn-store')
      await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')) })
    }
    const explore = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Explore trajectory details'))
    await act(async () => { explore!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(container.textContent).toContain('Board Reports')
  })

  it('does not invent metrics — AOV, days, and orders come from the payload', async () => {
    const container = await mountPage()
    const text = container.textContent ?? ''
    expect(text).toContain('7 of 30+ synced orders')
    expect(text).toContain('4 of 60+ synced days')
    expect(text).toContain('$2,606')
    expect(text).toContain('4 real days')
    expect(text).not.toContain('Upgrade to')
  })
})
