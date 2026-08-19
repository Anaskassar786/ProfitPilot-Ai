// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.js'

/**
 * GrowthIQ page mount tests.
 *
 * Renders the real app shell on the GrowthIQ deep link against a stubbed API:
 *  - the thin-data "Building your intelligence baseline" state must carry the
 *    full strategic stage (trajectory projection, position matrix, impact
 *    previews, milestones, digest, insights sidebar, executive actions) with
 *    honest not-yet states where an input is not measurable;
 *  - the rich dashboard must show the projected trajectory and the compact,
 *    collapsed-by-default plan panel whose toggle expands the tier matrix;
 *  - both themes mount with the same structure (light theme via the persisted
 *    preference), and any React console error fails the test.
 */

const consoleErrors: string[] = []
let root: Root | null = null

const envelope = (data: unknown): unknown => ({ ok: true, data, requestId: 'growthiq-mount-test' })

/** Thin store: 4 synced days, 7 orders — below the analysis baseline. */
const THIN_DASHBOARD = {
  storeId: 'mount-test',
  plan: 'trial',
  currency: 'USD',
  health: null,
  latestReport: null,
  nextReportDue: '2026-09-01',
  benchmarkPosition: {
    storeId: 'mount-test',
    category: 'Fashion & Apparel',
    categorySource: 'AUTO_DETECTED',
    visibleMetrics: 3,
    totalMetrics: 7,
    asOf: '2026-08-18',
    positions: [
      { metric: 'REVENUE', label: 'Monthly revenue', yourValue: 420, currency: 'USD', industryMedian: 5000, top10Target: 20000, percentile: null, gapToTop10Pct: null, sourceLabel: 'curated', yourValueMissing: false },
      { metric: 'AOV', label: 'Average order value', yourValue: 60, currency: 'USD', industryMedian: 62, top10Target: 95, percentile: null, gapToTop10Pct: null, sourceLabel: 'curated', yourValueMissing: false },
      { metric: 'REPEAT_PURCHASE', label: 'Repeat purchase rate', yourValue: null, currency: null, industryMedian: 27, top10Target: 40, percentile: null, gapToTop10Pct: null, sourceLabel: 'curated', yourValueMissing: true },
    ],
  },
  opportunities: [
    { id: 'o1', storeId: 'mount-test', category: 'EXPANSION', title: 'Open a wholesale channel', description: '', estimatedImpactAnnual: 24_000, impactCurrency: 'USD', confidence: 0.6, effortLevel: 'MEDIUM', timeline: '60_DAYS', actionPlan: [], status: 'NEW', identifiedAt: '2026-08-18', updatedAt: '2026-08-18' },
  ],
  risks: [],
  scenarios: [],
  roadmap: null,
  decisions: [],
  usage: { plan: 'trial', features: [] },
  gates: { reports: { allowed: false, requiredPlan: 'start', used: 0, limit: 0 } },
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
  totals: { customers: 5, products: 3, syncedOrders: 7, syncedRevenue: 420, daysSynced: 4 },
  topProducts: [{ title: 'Hero Hoodie', revenue: 420, sharePct: 100 }],
  generatedAt: '2026-08-18T12:00:00.000Z',
}

/** Rich store: 60 days × 4 orders — the full executive dashboard. */
const RICH_DASHBOARD = {
  ...THIN_DASHBOARD,
  plan: 'growth',
  gates: { reports: { allowed: true, requiredPlan: 'start', used: 1, limit: 5 } },
  revenueSeries: Array.from({ length: 60 }, (_, index) => ({ day: new Date(Date.UTC(2026, 5, 20 + index)).toISOString().slice(0, 10), value: 260 + (index % 6) * 18 + index })),
  ordersSeries: Array.from({ length: 60 }, (_, index) => ({ day: new Date(Date.UTC(2026, 5, 20 + index)).toISOString().slice(0, 10), value: 4 })),
  totals: { customers: 61, products: 12, syncedOrders: 240, syncedRevenue: 17_400, daysSynced: 60 },
  topProducts: [{ title: 'Hero Hoodie', revenue: 6_200, sharePct: 36 }],
}

let currentDashboard: unknown = THIN_DASHBOARD

function mockBackend(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/session/context')) return json(200, envelope({ storeId: 'mount-test', shop: 'mount-test.myshopify.com' }))
    if (url.includes('/security/csrf')) return json(200, envelope({ csrfToken: 'mount-token' }))
    if (url.includes('/ai-executive/dashboard')) return json(200, envelope(currentDashboard))
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
  }))
}

beforeEach(() => {
  consoleErrors.length = 0
  currentDashboard = THIN_DASHBOARD
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', '/ai-growth-command/growthiq?storeId=mount-test')
  window.localStorage.clear()
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
  })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null, writable: true, configurable: true })
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

async function mountApp(): Promise<void> {
  const container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(createElement(StrictMode, null, createElement(App))) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
}

describe('GrowthIQ — thin-data strategic stage', () => {
  it('keeps the baseline hero and fills the page with REAL strategic value', async () => {
    await mountApp()
    const text = document.body.textContent ?? ''
    // 1. Baseline section kept.
    expect(text).toContain('Building your intelligence baseline')
    expect(text).toContain('7 of 30+ synced orders')
    expect(text).toContain('4 of 60+ synced days of history')
    // 2. Business trajectory — real 4-day series + dashed projection.
    expect(text).toContain('Your business trajectory')
    expect(document.querySelector('.gq-slope')).not.toBeNull()
    expect(text).toContain('current monthly run-rate')
    expect(text).toContain('projected next 30 days')
    expect(text).toContain('4 real days')
    // 3. Strategic position — honest about the missing percentile axis.
    expect(text).toContain('Your strategic position')
    expect(text).toContain('revenue percentile')
    // 4. Impact previews — computed from the REAL $2 AOV gap × 7 real orders.
    expect(text).toContain('If you focus on these strategic areas')
    expect(text).toContain('+$14/mo')
    expect(text).toContain('100% on one product') // real concentration
    expect(text).toContain('+$2,000/mo') // real opportunity ÷ 12
    // 5. Milestones — first sale complete, 10-order milestone in progress.
    expect(text).toContain('Your growth milestones')
    expect(text).toContain('First sale')
    expect(text).toContain('10 synced orders')
    expect(text).toContain('7 / 10')
    // 6. Digest — honestly locked until 7 real days.
    expect(text).toContain('executive digest')
    expect(text).toContain('4 of 7 synced')
    // 7. Insights sidebar + executive actions.
    expect(text).toContain('Executive insights')
    expect(text).toContain('Executive actions')
    expect(text).toContain('Launch') // real lifecycle stage from 7 orders
    expect(document.querySelectorAll('.gq-action-card').length).toBe(4)
    expect(consoleErrors).toEqual([])
  })

  it('renders the plan panel compact and collapsed, then expands on click', async () => {
    await mountApp()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Your plan: Trial')
    expect(text).toContain('3 features active · 12 more available')
    const toggle = document.querySelector<HTMLButtonElement>('.gq-plan-toggle')
    expect(toggle).not.toBeNull()
    expect(toggle!.getAttribute('aria-expanded')).toBe('false')
    expect(text).toContain('Show details')
    // Collapsed state: the details region is folded (grid-rows 0fr), not open.
    expect(document.querySelector('.gq-plan-details')!.classList.contains('open')).toBe(false)
    await act(async () => { toggle!.click() })
    const expanded = document.body.textContent ?? ''
    expect(document.querySelector('.gq-plan-toggle')!.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.gq-plan-details')!.classList.contains('open')).toBe(true)
    expect(expanded).toContain('Currently available (3)')
    expect(expanded).toContain('Available on higher plans (12)')
    expect(expanded).toContain('Start plan')
    expect(expanded).toContain('Growth plan')
    expect(expanded).toContain('Commander plan')
    expect(expanded).toContain('Investor reports (PDF)')
    expect(expanded).not.toContain('Upgrade to')
    // Collapse again.
    await act(async () => { document.querySelector<HTMLButtonElement>('.gq-plan-toggle')!.click() })
    expect(document.querySelector('.gq-plan-toggle')!.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.gq-plan-details')!.classList.contains('open')).toBe(false)
    expect(consoleErrors).toEqual([])
  })

  it('mounts the same structure in the light theme', async () => {
    window.localStorage.setItem('profitpilot:theme', 'light')
    await mountApp()
    expect(document.querySelector('.app-shell.light-mode')).not.toBeNull()
    expect(document.querySelector('.gq-strategy-layout')).not.toBeNull()
    expect(document.querySelector('.gq-insights')).not.toBeNull()
    expect(document.querySelectorAll('.gq-milestone').length).toBe(11)
    expect(consoleErrors).toEqual([])
  })
})

describe('GrowthIQ — rich dashboard', () => {
  it('shows the projected trajectory, actions strip, and compact plan panel', async () => {
    currentDashboard = RICH_DASHBOARD
    await mountApp()
    const text = document.body.textContent ?? ''
    // Full dashboard, not the baseline hero.
    expect(text).toContain('Executive summary')
    // The trajectory slot now carries history + projection.
    expect(text).toContain('Your business trajectory')
    expect(text).toContain('Revenue — last 30 days vs the next 30')
    expect(document.querySelector('.gq-slope')).not.toBeNull()
    // Executive actions strip on the dashboard.
    expect(text).toContain('Executive actions')
    // Plan panel collapsed by default even on a rich dashboard.
    expect(text).toContain('Your plan: Growth')
    expect(document.querySelector('.gq-plan-toggle')?.getAttribute('aria-expanded')).toBe('false')
    expect(consoleErrors).toEqual([])
  })

  it('true weekly digest on the rich state when navigated through thin state math', async () => {
    currentDashboard = RICH_DASHBOARD
    await mountApp()
    const text = document.body.textContent ?? ''
    // 60 days ≥ 30 orders and ≥ 60 days → the dashboard renders (no digest
    // card there by design); the digest lives on the strategic stage which
    // only appears in thin-data states. The weekly math itself is covered by
    // growthiq-sections.test.tsx.
    expect(text).not.toContain('Building your intelligence baseline')
    expect(consoleErrors).toEqual([])
  })
})
