/**
 * Recommendations-only browser-flow coverage.
 *
 * These tests mount the real workspace and dispatch real DOM clicks. The fetch
 * double is stateful: every decision is sent through the same client endpoint
 * the page uses, and subsequent list/summary reads observe the persisted
 * decision. A non-2xx response would fail the test and record the exact request
 * for the testing report.
 */
import { JSDOM } from 'jsdom'
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetApiClientStateForTests } from './api.js'
import type { RecommendationSummary, RecommendationView } from './recommendations-model.js'

type RequestRecord = Readonly<{ url: string; method: string; status: number }>

type InteractiveHarness = Readonly<{
  requests: RequestRecord[]
  decisions: Readonly<{ id: string; status: string; expectedVersion: number | null }>[]
  items: Map<string, RecommendationView>
}>

const storeId = 's1'
const at = new Date('2026-08-19T00:00:00.000Z').toISOString()

function recommendation(overrides: Partial<RecommendationView> = {}): RecommendationView {
  return {
    id: 'r1',
    storeId,
    agent: 'INVENTORY_AGENT',
    ruleId: 'STOCKOUT_RISK',
    title: 'Snowboard stockout risk',
    reason: 'Snowboard has 3.2 days of cover at current velocity.',
    impactValue: 420,
    impactLabel: 'revenue at risk',
    currency: 'USD',
    confidence: .75,
    confidenceLevel: 'MEDIUM',
    actionType: 'CREATE_RECOMMENDATION',
    actionRisk: 'SAFE',
    status: 'PENDING',
    evidencePack: {
      id: 'pack-r1',
      ruleId: 'STOCKOUT_RISK',
      ruleVersion: '1.1.0',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      generatedAt: at,
      fields: [{ key: 'days_of_cover', label: 'Days of cover', value: 3.2, source: 'products.daily_velocity' }],
    },
    explanation: null,
    explanationStatus: 'AI_UNAVAILABLE',
    model: null,
    version: 0,
    createdAt: at,
    entityKey: 'snowboard-1',
    expiresAt: null,
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    snoozedUntil: null,
    ...overrides,
  }
}

function summaryFor(items: readonly RecommendationView[], usage = 7): RecommendationSummary {
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 }
  for (const item of items) counts[item.status] += 1
  const approved = items.filter((item) => item.status === 'APPROVED' || item.status === 'EXECUTED' || item.status === 'FAILED')
  const pending = items.filter((item) => item.status === 'PENDING')
  const rejected = items.filter((item) => item.status === 'REJECTED')
  const byAgent = [...new Set(items.map((item) => item.agent))].map((agent) => {
    const forAgent = items.filter((item) => item.agent === agent)
    return { agent, pending: forAgent.filter((item) => item.status === 'PENDING').length, approved: forAgent.filter((item) => item.status === 'APPROVED').length, rejected: forAgent.filter((item) => item.status === 'REJECTED').length, total: forAgent.length }
  })
  const byRule = [...new Set(items.map((item) => item.ruleId))].map((ruleId) => ({ ruleId, total: items.filter((item) => item.ruleId === ruleId).length }))
  const decisions = [...approved, ...rejected]
  return {
    counts,
    total: items.length,
    pendingImpact: pending.length > 0 ? [{ currency: 'USD', value: pending.reduce((sum, item) => sum + item.impactValue, 0) }] : [],
    approvedThisMonth: { count: approved.length, impact: approved.length > 0 ? [{ currency: 'USD', value: approved.reduce((sum, item) => sum + item.impactValue, 0) }] : [] },
    byAgent,
    byRule,
    approvalRate: decisions.length > 0 ? { allTime: Math.round((approved.length / decisions.length) * 100), last30d: Math.round((approved.length / decisions.length) * 100) } : { allTime: null, last30d: null },
    averageDecisionMs: decisions.length > 0 ? 60 * 60 * 1000 : null,
    recentDecisions: decisions,
    generatedTrend: [{ day: '2026-08-19', generated: items.length, approved: approved.length }],
    plan: 'growth',
    usage: { feature: 'ai_recommendations_month', used: usage, limit: 10, remaining: Math.max(0, 10 - usage) },
  }
}

function response(data: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers(),
    json: async () => status < 400 ? { ok: true, data } : { ok: false, error: { code: status === 409 ? 'CONFLICT' : 'INTERNAL_ERROR', message: status === 409 ? 'Recommendation changed; reload before deciding' : 'Internal server error', details: {} } },
  } as Response
}

function installInteractiveFetch(initial: readonly RecommendationView[], usage = 7): InteractiveHarness {
  const items = new Map(initial.map((item) => [item.id, item]))
  const requests: RequestRecord[] = []
  const decisions: { id: string; status: string; expectedVersion: number | null }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input)
    const url = new URL(raw, 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const record = (status: number): Response => {
      requests.push({ url: `${url.pathname}${url.search}`, method, status })
      return response(undefined, status)
    }
    const itemId = url.pathname.startsWith('/recommendations/') ? url.pathname.split('/')[2] : null

    if (url.pathname === '/recommendations/summary' && method === 'GET') {
      const payload = summaryFor([...items.values()], usage)
      requests.push({ url: `${url.pathname}${url.search}`, method, status: 200 })
      return response(payload)
    }
    if (url.pathname === '/recommendations' && method === 'GET') {
      const status = url.searchParams.get('status')
      const agent = url.searchParams.get('agent')
      const dateFrom = url.searchParams.get('dateFrom')
      const dateTo = url.searchParams.get('dateTo')
      const sort = url.searchParams.get('sort') ?? 'created'
      const direction = url.searchParams.get('direction') ?? 'desc'
      let listed = [...items.values()].filter((item) => !status || item.status === status).filter((item) => !agent || item.agent === agent)
      if (dateFrom) listed = listed.filter((item) => item.createdAt >= dateFrom)
      if (dateTo) listed = listed.filter((item) => item.createdAt <= dateTo)
      listed.sort((left, right) => {
        const leftValue = sort === 'impact' ? left.impactValue : sort === 'confidence' ? left.confidence : sort === 'decided' ? (left.decidedAt ?? '') : left.createdAt
        const rightValue = sort === 'impact' ? right.impactValue : sort === 'confidence' ? right.confidence : sort === 'decided' ? (right.decidedAt ?? '') : right.createdAt
        const result = typeof leftValue === 'number' && typeof rightValue === 'number' ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue))
        return direction === 'asc' ? result : -result
      })
      const payload = { items: listed, total: listed.length, cursor: 0, limit: 50, hasMore: false }
      requests.push({ url: `${url.pathname}${url.search}`, method, status: 200 })
      return response(payload)
    }
    if (itemId && url.pathname.endsWith('/evidence/verify') && method === 'GET') {
      requests.push({ url: `${url.pathname}${url.search}`, method, status: 200 })
      return response({ verified: true, sha256: items.get(itemId)?.evidencePack.sha256 ?? null, ruleVersion: '1.1.0', generatedAt: at })
    }
    if (itemId && method === 'GET') {
      requests.push({ url: `${url.pathname}${url.search}`, method, status: items.has(itemId) ? 200 : 404 })
      return items.has(itemId) ? response(items.get(itemId)) : response(undefined, 404)
    }
    if (itemId && (url.pathname.endsWith('/approve') || url.pathname.endsWith('/reject')) && method === 'POST') {
      const current = items.get(itemId)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
      const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null
      if (!current || current.status !== 'PENDING' || expectedVersion !== current.version) {
        requests.push({ url: `${url.pathname}${url.search}`, method, status: 409 })
        return response(undefined, 409)
      }
      const next: RecommendationView = {
        ...current,
        status: url.pathname.endsWith('/approve') ? 'APPROVED' : 'REJECTED',
        version: current.version + 1,
        decidedAt: new Date().toISOString(),
        decidedBy: 'test-merchant',
        rejectReason: url.pathname.endsWith('/reject') && typeof body.reason === 'string' ? body.reason as RecommendationView['rejectReason'] : null,
      }
      items.set(itemId, next)
      decisions.push({ id: itemId, status: next.status, expectedVersion })
      requests.push({ url: `${url.pathname}${url.search}`, method, status: 200 })
      return response(next)
    }
    if (itemId && url.pathname.endsWith('/snooze') && method === 'POST') {
      const current = items.get(itemId)
      const next = current ? { ...current, snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() } : null
      if (next) items.set(itemId, next)
      requests.push({ url: `${url.pathname}${url.search}`, method, status: next ? 200 : 404 })
      return next ? response(next) : response(undefined, 404)
    }
    return record(500)
  }) as typeof fetch
  return { requests, decisions, items }
}

let dom: JSDOM
let container: HTMLElement
let root: Root | null = null
let onToast: ReturnType<typeof vi.fn>
let onBilling: ReturnType<typeof vi.fn>
let onNavigate: ReturnType<typeof vi.fn>

async function settle(ms = 60): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

async function click(element: Element): Promise<void> {
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await settle()
}

async function mount(items: readonly RecommendationView[], usage = 7): Promise<InteractiveHarness> {
  const harness = installInteractiveFetch(items, usage)
  const { RecommendationsWorkspace } = await import('./recommendations.js')
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(StrictMode, null, createElement(RecommendationsWorkspace, {
      context: { shop: 'snowboard.myshopify.com', storeId },
      onToast,
      onNavigateBilling: onBilling,
      onNavigateSection: onNavigate,
    } as never)))
  })
  await settle()
  return harness
}

function buttonByText(scope: ParentNode, text: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button as HTMLButtonElement
}

function cardContaining(text: string): HTMLElement {
  const card = [...container.querySelectorAll<HTMLElement>('.recs-card')].find((candidate) => candidate.textContent?.includes(text))
  if (!card) throw new Error(`Card not found: ${text}`)
  return card
}

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dashboard?shop=snowboard.myshopify.com' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement })
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: dom.window.MouseEvent })
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: dom.window.KeyboardEvent })
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event })
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: dom.window.MutationObserver })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
})

afterAll(() => { dom.window.close() })

beforeEach(() => {
  if (root) { act(() => root?.unmount()); root = null }
  container.innerHTML = ''
  onToast = vi.fn()
  onBilling = vi.fn()
  onNavigate = vi.fn()
  resetApiClientStateForTests()
})

describe('Recommendations — real-click decision and evidence flows', () => {
  it('clicks Skip This and Approve & Take Action, verifies 200s, state movement, toasts, and KPI counts', async () => {
    const first = recommendation({ id: 'r1', impactValue: 346179, title: 'Snowboard stockout opportunity' })
    const second = recommendation({ id: 'r2', impactValue: 72995, title: 'Snowboard replenishment opportunity', agent: 'REVENUE_AGENT', ruleId: 'PRICING_UPLIFT', entityKey: 'snowboard-2' })
    const third = recommendation({ id: 'r3', impactValue: 1000, title: 'Boot inventory opportunity', agent: 'INVENTORY_AGENT', entityKey: 'boots-1' })
    const harness = await mount([first, second, third])

    await click(buttonByText(cardContaining('Snowboard stockout opportunity'), 'Skip This'))
    const rejectRequest = harness.requests.find((request) => request.method === 'POST' && request.url.includes('/r1/reject'))
    expect(rejectRequest?.status).toBe(200)
    expect(harness.decisions).toContainEqual(expect.objectContaining({ id: 'r1', status: 'REJECTED', expectedVersion: 0 }))
    expect(onToast).toHaveBeenLastCalledWith('Recommendation skipped', 'success')
    expect(cardContaining('Snowboard stockout opportunity').textContent).toContain('Rejected')

    await click(buttonByText(cardContaining('Snowboard replenishment opportunity'), 'Approve & Take Action'))
    const approveRequest = harness.requests.find((request) => request.method === 'POST' && request.url.includes('/r2/approve'))
    expect(approveRequest?.status).toBe(200)
    expect(harness.decisions).toContainEqual(expect.objectContaining({ id: 'r2', status: 'APPROVED', expectedVersion: 0 }))
    expect(onToast).toHaveBeenLastCalledWith('Recommendation approved', 'success')
    expect(container.textContent).toContain('1 approval this month')

    const rejectedTab = buttonByText(container, 'Rejected')
    await click(rejectedTab)
    expect(container.textContent).toContain('Snowboard stockout opportunity')
    expect(container.textContent).toContain('Rejected')
    const approvedTab = buttonByText(container, 'Approved')
    await click(approvedTab)
    expect(container.textContent).toContain('Snowboard replenishment opportunity')
    expect(container.textContent).toContain('Approved')
    const pendingTab = buttonByText(container, 'Pending')
    await click(pendingTab)
    expect(container.textContent).toContain('Boot inventory opportunity')
    expect([...container.querySelectorAll<HTMLElement>('.recs-card:not(.recs-sample-card)')].some((card) => card.textContent?.includes('Snowboard replenishment opportunity'))).toBe(false)
    expect(harness.requests.some((request) => request.status >= 500)).toBe(false)
  })

  it('clicks details, evidence verification, close, more-menu snooze, filters, sort, views, dates, and refresh', async () => {
    const items = [
      recommendation({ id: 'r1', title: 'Snowboard stockout opportunity', impactValue: 300 }),
      recommendation({ id: 'r2', title: 'Boot inventory opportunity', reason: 'Boots have 18 days of cover at current velocity.', impactValue: 900, agent: 'REVENUE_AGENT', entityKey: 'boots-2' }),
      recommendation({ id: 'r3', title: 'Jacket pricing opportunity', reason: 'Jackets have room for a careful price lift.', impactValue: 600, agent: 'PRICING_AGENT', ruleId: 'PRICING_UPLIFT', entityKey: 'jacket-3' }),
    ]
    const harness = await mount(items)

    await click(buttonByText(cardContaining('Snowboard stockout opportunity'), 'View Full Details'))
    expect(container.querySelector('[role="dialog"][aria-label="Recommendation evidence"]')).not.toBeNull()
    expect(container.querySelector('.recs-hash')?.textContent).toContain('SHA-256')
    expect(harness.requests.some((request) => request.url.includes('/r1/evidence/verify') && request.status === 200)).toBe(true)
    await click(container.querySelector('.evidence-drawer button[aria-label="Close"]')!)
    expect(container.querySelector('[role="dialog"][aria-label="Recommendation evidence"]')).toBeNull()

    await click(cardContaining('Snowboard stockout opportunity').querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!)
    await click(buttonByText(container, 'Remind me in 1 hour'))
    expect(harness.requests.some((request) => request.method === 'POST' && request.url.includes('/r1/snooze') && request.status === 200)).toBe(true)

    const search = container.querySelector<HTMLInputElement>('.recs-search input')!
    const setInput = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setInput.call(search, 'Snowboard')
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      search.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await settle()
    expect(container.querySelectorAll('.recs-card:not(.recs-sample-card)')).toHaveLength(1)
    expect(container.textContent).toContain('Snowboard stockout opportunity')
    await click(container.querySelector('button[aria-label="Clear search"]')!)
    expect(container.querySelectorAll('.recs-card:not(.recs-sample-card)')).toHaveLength(3)

    const sort = container.querySelector<HTMLSelectElement>('.recs-select')!
    const setSelect = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => {
      setSelect.call(sort, '1')
      sort.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await settle()
    expect(sort.value).toBe('1')
    expect(harness.requests.some((request) => request.url.includes('sort=confidence'))).toBe(true)

    await click(buttonByText(container, 'By agent'))
    expect(container.querySelector('.recs-group-toggle button.active')?.textContent).toBe('By agent')
    await click(buttonByText(container, 'By rule'))
    expect(container.querySelector('.recs-group-toggle button.active')?.textContent).toBe('By rule')
    await click(buttonByText(container, 'List'))
    expect(container.querySelector('.recs-group-toggle button.active')?.textContent).toBe('List')

    const from = container.querySelector<HTMLInputElement>('input[aria-label="From date"]')!
    await act(async () => {
      setInput.call(from, '2026-08-18')
      from.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      from.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await settle()
    expect(harness.requests.some((request) => request.url.includes('dateFrom=2026-08-18'))).toBe(true)
    const to = container.querySelector<HTMLInputElement>('input[aria-label="To date"]')!
    await act(async () => {
      setInput.call(to, '2026-08-20')
      to.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      to.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await settle()
    expect(harness.requests.some((request) => request.url.includes('dateTo=2026-08-20'))).toBe(true)

    const inventoryChip = [...container.querySelectorAll<HTMLButtonElement>('.recs-agent-chips .recs-chip')].find((button) => button.textContent?.includes('Inventory Agent'))!
    await click(inventoryChip)
    expect(harness.requests.some((request) => request.url.includes('agent=INVENTORY_AGENT'))).toBe(true)
    await click([...container.querySelectorAll<HTMLButtonElement>('.recs-agent-chips .recs-chip')].find((button) => button.textContent?.includes('All agents'))!)
    expect(harness.requests.some((request) => request.url.includes('recommendations?') && !request.url.includes('agent='))).toBe(true)

    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Refresh recommendations"]')!)
    expect(harness.requests.filter((request) => request.method === 'GET' && request.url.startsWith('/recommendations?')).length).toBeGreaterThan(3)

    await click(buttonByText(container, 'How it works'))
    expect(container.querySelector('[role="dialog"][aria-label="How recommendations work"]')).not.toBeNull()
    await click(buttonByText(container, 'Got it'))
    expect(container.querySelector('[role="dialog"][aria-label="How recommendations work"]')).toBeNull()
    expect(harness.requests.some((request) => request.status >= 500)).toBe(false)
  })

  it('shows the high-risk confirmation and gives a clear limit-reached response without a 500', async () => {
    const highRisk = recommendation({ id: 'r-risk', title: 'Email at-risk snowboard customers', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED', agent: 'CUSTOMER_AGENT' })
    const harness = await mount([highRisk], 10)
    const discover = buttonByText(container, 'Limit reached')
    await click(discover)
    expect(onToast).toHaveBeenLastCalledWith(expect.stringContaining('Upgrade Plan'), 'warning')
    expect(harness.requests.some((request) => request.method === 'POST' && request.status >= 500)).toBe(false)

    // The page keeps reviewing existing recommendations free at the limit.
    const approve = buttonByText(cardContaining('Email at-risk snowboard customers'), 'Review & Approve')
    await click(approve)
    expect(container.querySelector('[role="dialog"][aria-label="Confirm approval"]')).not.toBeNull()
    await click(buttonByText(container, 'Confirm & Approve'))
    expect(harness.requests.some((request) => request.method === 'POST' && request.url.includes('/r-risk/approve') && request.status === 200)).toBe(true)
    expect(onToast).toHaveBeenLastCalledWith('Recommendation approved', 'success')
  })
})
