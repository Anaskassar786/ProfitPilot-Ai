/**
 * Runtime (jsdom) integration tests for the Recommendations workspace —
 * complements the SSR markup tests by exercising the real mounted component:
 * initial load, the staged analysis progress modal, and the health-check
 * report panel that lands after a 0-result run. Fetch is stubbed at the edge;
 * every number asserted here came from a fixture envelope, never invented.
 */
import { JSDOM } from 'jsdom'
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecommendationSummary, RecommendationView } from './recommendations-model.js'

type Json = Record<string, unknown>

const now = Date.now()

function view(overrides: Partial<RecommendationView> = {}): RecommendationView {
  return { id: 'r1', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock the Everyday Hoodie before stockout', reason: 'Hoodie has 3.2 days of cover at current velocity.', impactValue: 420, impactLabel: 'revenue at risk', currency: 'USD', confidence: .72, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'abc' }, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: new Date(now - 2 * 3_600_000).toISOString(), entityKey: 'p1', expiresAt: null, decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null, ...overrides }
}

function emptySummary(): RecommendationSummary {
  return { counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 }, total: 0, pendingImpact: [], approvedThisMonth: { count: 0, impact: [] }, byAgent: [], byRule: [], approvalRate: { allTime: null, last30d: null }, averageDecisionMs: null, recentDecisions: [], generatedTrend: [], plan: 'trial', usage: { feature: 'ai_recommendations_month', used: 0, limit: 10, remaining: 10 } }
}

function populatedSummary(): RecommendationSummary {
  return { ...emptySummary(), counts: { PENDING: 1, APPROVED: 1, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 }, total: 2, pendingImpact: [{ currency: 'USD', value: 420 }], approvedThisMonth: { count: 1, impact: [{ currency: 'USD', value: 200 }] }, byAgent: [{ agent: 'INVENTORY_AGENT', pending: 1, approved: 1, rejected: 0, total: 2 }], byRule: [{ ruleId: 'STOCKOUT_RISK', total: 2 }], approvalRate: { allTime: 100, last30d: 100 }, averageDecisionMs: 3_600_000, recentDecisions: [view({ id: 'd1', status: 'APPROVED', decidedAt: new Date().toISOString() })], generatedTrend: [{ day: '2026-08-18', generated: 2, approved: 1 }], plan: 'growth', usage: { feature: 'ai_recommendations_month', used: 2, limit: 100, remaining: 98 } }
}

type Mock = Readonly<{ summary: RecommendationSummary; items: readonly RecommendationView[]; analyze: Json; analyzeDelayMs?: number }>

function installFetchMock(mock: Mock): { calls: string[] } {
  const calls: string[] = []
  const realFetch = globalThis.fetch?.bind(globalThis)
  void realFetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('/recommendations/analyze')) {
      if (mock.analyzeDelayMs) await new Promise((resolve) => setTimeout(resolve, mock.analyzeDelayMs))
      return envelope(mock.analyze)
    }
    if (url.startsWith('/recommendations/summary')) return envelope(mock.summary)
    if (url.startsWith('/recommendations') && (init?.method ?? 'GET') === 'GET') return envelope({ items: mock.items, total: mock.items.length, cursor: 0, limit: 50, hasMore: false })
    return envelope({}, 404)
  }) as typeof fetch
  return { calls }
}

function envelope(data: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers(), json: async () => ({ ok: status < 400, data }) } as Response
}

let dom: JSDOM
let container: HTMLElement
let root: Root | null = null
let onToast: ReturnType<typeof vi.fn>

async function settle(ms = 40): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

async function click(element: Element): Promise<void> {
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
}

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dashboard?shop=demo.myshopify.com' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: dom.window.MouseEvent })
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: dom.window.KeyboardEvent })
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event })
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: dom.window.MutationObserver })
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
})

afterAll(() => { dom.window.close() })

beforeEach(() => {
  if (root) { act(() => root?.unmount()); root = null }
  container.innerHTML = ''
  onToast = vi.fn()
})

async function mountWorkspace(): Promise<void> {
  const { RecommendationsWorkspace } = await import('./recommendations.js')
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(StrictMode, null, createElement(RecommendationsWorkspace, { context: { shop: 'demo.myshopify.com', storeId: 's1' } as never, onToast, onNavigateBilling: vi.fn(), onNavigateSection: vi.fn() })))
  })
  await settle()
}

describe('Recommendations workspace — runtime flow', () => {
  it('renders the first-run state with renewed copy, tooltipped KPIs, and tab tips', async () => {
    installFetchMock({ summary: emptySummary(), items: [], analyze: {} })
    await mountWorkspace()
    const text = container.textContent ?? ''
    expect(text).toContain("Let's find your growth opportunities!")
    expect(text).toContain('Discover Opportunities')
    expect(text).toContain('Revenue opportunity pending')
    expect(text).toContain('No pending recommendations yet')
    expect(text).toContain('Need decisions to calculate')
    expect(container.querySelectorAll('.recs-tip [role="tooltip"]').length).toBe(5)
    expect(text).toContain('What happens after you click')
    expect(text).toContain('Analyzes: Products')
    expect(text).toContain('Sample')
    // Tabs carry explanatory tips; search/sort placeholders were clarified
    const tabs = [...container.querySelectorAll('.recs-tab')]
    expect(tabs).toHaveLength(5)
    for (const tab of tabs) expect(tab.getAttribute('data-tip')?.length ?? 0).toBeGreaterThan(10)
    expect((container.querySelector('.recs-search input') as HTMLInputElement).placeholder).toBe('Search by title, product, customer, or rule…')
    expect(container.querySelector('.recs-sort-wrap')?.getAttribute('data-tip')).toContain('ranks this list')
    // Sidebar education: all seven agents listed with zero pending
    const roster = [...container.querySelectorAll('.recs-agent-row')]
    expect(roster).toHaveLength(7)
    expect(text).toContain('No recommendations yet — your team reports here after the first look.')
    expect(text).toContain('See sample activity')
  })

  it('runs the full analysis flow: progress modal → rich health-check panel', async () => {
    const analyze = {
      storeId: 's1',
      generatedAt: new Date().toISOString(),
      recommendations: [],
      deduplicated: 0,
      cacheHits: 0,
      rulesChecked: 8,
      health: { score: 84, method: 'deterministic-v1', components: [] },
      snapshotStats: { products: 42, customers: 128, checkouts: 7, orders: 913, dataFreshAt: new Date().toISOString(), currency: 'USD' },
    }
    installFetchMock({ summary: emptySummary(), items: [], analyze, analyzeDelayMs: 120 })
    await mountWorkspace()
    const runButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Discover Opportunities'))
    expect(runButton).toBeDefined()
    await click(runButton!)
    // The staged progress modal (not a toast) is the in-flight surface.
    expect(container.querySelector('.recs-analysis-modal')).not.toBeNull()
    expect(container.querySelector('.recs-analysis-progress[role="progressbar"]')).not.toBeNull()
    expect(container.textContent).toContain('Scanning your products')
    expect(container.textContent).toContain('Finding patterns')
    await settle(260)
    const text = container.textContent ?? ''
    expect(container.querySelector('.recs-analysis-modal')).toBeNull()
    expect(container.querySelector('.recs-report')).not.toBeNull()
    expect(text).toContain('Your store looks healthy')
    expect(text).toContain('No urgent issues detected')
    expect(text).toContain('8/8')
    expect(text).toContain('Excellent · 84/100')
    expect(text).toContain('No stockout alerts')
    expect(text).toContain('Last analysis')
    expect(text).toContain('View analytics')
    // A 0-result run informs through the panel — no misleading success toast.
    expect(onToast).not.toHaveBeenCalled()
  })

  it('renders populated recommendations with real counts and sidebar distribution', async () => {
    installFetchMock({ summary: populatedSummary(), items: [view()], analyze: {} })
    await mountWorkspace()
    const text = container.textContent ?? ''
    expect(text).toContain('Restock the Everyday Hoodie before stockout')
    expect(text).toContain('$420')
    expect(text).toContain('1 pending recommendation awaiting your call')
    expect(text).toContain('100%')
    expect(container.querySelectorAll('.recs-card').length).toBeGreaterThan(0)
    // Sidebar: real distribution, activity metrics, decision quick stats
    expect(text).toContain('last 30 days')
    expect(text).toContain('avg to decide')
    const inventoryRow = [...container.querySelectorAll('.recs-agent-row')].find((row) => row.textContent?.includes('Inventory Agent'))
    expect(inventoryRow?.querySelector('.recs-agent-row-bar i')).not.toBeNull()
  })

  it('keeps plan-based gating: at the monthly limit the Run button is blocked', async () => {
    installFetchMock({ summary: { ...emptySummary(), usage: { feature: 'ai_recommendations_month', used: 10, limit: 10, remaining: 0 } }, items: [], analyze: {} })
    await mountWorkspace()
    const text = container.textContent ?? ''
    expect(text).toContain('Monthly limit reached')
    expect(text).toContain('Upgrade Plan')
    // CTA wording contract: never "Upgrade to <plan>"
    expect(text).not.toMatch(/Upgrade to (Trial|Start|Growth|Commander)/)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.some((button) => button.textContent?.includes('Limit reached'))).toBe(true)
  })
})
