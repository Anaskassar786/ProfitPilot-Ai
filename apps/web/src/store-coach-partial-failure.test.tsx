// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.js'

/**
 * Regression test for the reported bug: on the Store Coach home view, when the
 * progress-summary / activity-heatmap requests fail while the rest succeed
 * (`loadState === 'partial'`), the sections below the goal card used to render
 * `CoachSkeletonRow` — three identical blank shimmer boxes that never filled
 * in, with no explanation and no way to recover.
 *
 * Now: a partial-load banner explains what happened, each failed section shows
 * a distinct honest fallback with a working retry, and no dead skeleton boxes
 * remain on the page.
 */

const consoleErrors: string[] = []
let root: Root | null = null
let fetchMock: ReturnType<typeof vi.fn>

const EMPTY_ENVELOPE = (data: unknown): unknown => ({ ok: true, data, requestId: 'partial-test' })

function countCalls(match: string): number {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes(match)).length
}

function mockBackend(failMatches: readonly string[]): void {
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const fail = failMatches.some((match) => url.includes(match))
    if (url.includes('/store-coach/huddle/today')) return json(200, EMPTY_ENVELOPE(null))
    if (url.includes('/store-coach/priorities/today')) return json(200, EMPTY_ENVELOPE({ priorityDate: '2026-08-18', priorities: [], planLimit: 2, remainingToday: 2 }))
    if (url.includes('/store-coach/goals/suggestions')) return json(200, EMPTY_ENVELOPE([]))
    if (url.includes('/store-coach/goals')) return json(200, EMPTY_ENVELOPE([]))
    if (url.includes('/store-coach/progress/summary')) return fail ? json(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom', details: {} } }) : json(200, EMPTY_ENVELOPE({ window: 30, revenue: 0, orders: 0, aov: 0, customers: 0, revenueTrendPct: 0, series: [], comparisonSeries: [] }))
    if (url.includes('/store-coach/progress/heatmap')) return fail ? json(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom', details: {} } }) : json(200, EMPTY_ENVELOPE({ weeks: 12, bestDay: null, busiestWeek: null, cells: [], legend: [] }))
    if (url.includes('/store-coach/achievements/available')) return fail ? json(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom', details: {} } }) : json(200, EMPTY_ENVELOPE({ earnedIds: [], catalog: [], visible: 5 }))
    if (url.includes('/store-coach/achievements')) return json(200, EMPTY_ENVELOPE({ earned: [], visible: 5 }))
    if (url.includes('/store-coach/streak')) return json(200, EMPTY_ENVELOPE({ currentStreak: 0, longestStreak: 0, lastActiveDate: null, todayViewed: false }))
    if (url.includes('/store-coach/review/current')) return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'No review yet', details: {} } })
    if (url.includes('/store-coach/preferences')) return json(200, EMPTY_ENVELOPE({ storeId: 'partial-test', personality: 'PROFESSIONAL', huddleTimeMinutes: 420, huddleEnabled: true, weeklyEmailEnabled: true, voiceEnabled: false, widgetEnabled: false, language: 'en', notificationFrequency: 'NORMAL', updatedAt: 0, plan: 'trial' }))
    if (url.includes('/store-coach/usage')) return json(200, EMPTY_ENVELOPE({ plan: 'trial', chatMessagesToday: 0, chatLimit: 5, huddlesGeneratedToday: 0, activeGoals: 0, goalLimit: 1, chatAtWarning: false, chatExhausted: false }))
    if (url.includes('/store-coach/health-score')) return json(200, EMPTY_ENVELOPE({ score: null, label: 'No activity yet', tone: 'low', factors: {}, history: [] }))
    if (url.includes('/ai-executive/dashboard')) return json(200, EMPTY_ENVELOPE({ storeId: 'partial-test', plan: 'trial', currency: 'USD', health: null, latestReport: null, nextReportDue: '2026-09-01', benchmarkPosition: null, opportunities: [], risks: [], scenarios: [], roadmap: null, decisions: [], usage: { plan: 'trial', features: [] }, gates: {}, revenueSeries: [], ordersSeries: [], totals: { customers: 0, products: 0, syncedOrders: 0, syncedRevenue: 0, daysSynced: 0 }, topProducts: [], generatedAt: '2026-08-18T00:00:00.000Z' }))
    if (url.includes('/session/context')) return json(200, EMPTY_ENVELOPE({ storeId: 'partial-test', shop: 'partial-test.myshopify.com' }))
    if (url.includes('/security/csrf')) return json(200, EMPTY_ENVELOPE({ csrfToken: 'partial-token' }))
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  consoleErrors.length = 0
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
  })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: query.includes('light'), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null, writable: true, configurable: true })
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

async function mountApp(path: string, failMatches: readonly string[]): Promise<void> {
  window.history.replaceState({}, '', path)
  mockBackend(failMatches)
  const container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(StrictMode, null, createElement(App)))
  })
  // Let every coach request (and any retry kicked off inside the act) settle.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

describe('Store Coach partial-failure recovery (blank-boxes bug fix)', () => {
  const homePath = '/ai-growth-command/coach?storeId=partial-test&shop=partial-test.myshopify.com'

  it('never leaves permanent blank skeleton boxes below the goal card when progress APIs fail', async () => {
    await mountApp(homePath, ['/store-coach/progress/summary', '/store-coach/progress/heatmap'])
    const main = document.querySelector('.coach-main')
    expect(main).toBeTruthy()
    // The reported bug: three identical empty shimmer boxes. They must be gone.
    expect(document.querySelectorAll('.coach-skeleton-row')).toHaveLength(0)
    expect(document.querySelectorAll('.coach-skeleton-card')).toHaveLength(0)
  })

  it('explains the partial load and offers a real retry instead of silent blank boxes', async () => {
    await mountApp(homePath, ['/store-coach/progress/summary', '/store-coach/progress/heatmap'])
    const banner = document.querySelector('.coach-partial-banner')
    expect(banner?.textContent ?? '').toContain('A few cards couldn’t load this time')
    const retry = [...(banner?.querySelectorAll('button') ?? [])].find((button) => (button.textContent ?? '').includes('Retry'))
    expect(retry).toBeTruthy()
  })

  it('shows distinct, honest fallbacks per failed section — nothing fake, nothing repeated', async () => {
    await mountApp(homePath, ['/store-coach/progress/summary', '/store-coach/progress/heatmap'])
    const progressFallback = document.querySelector('.coach-progress-dashboard .coach-section-unavailable')
    const rhythmFallback = document.querySelector('.coach-bestdays-section .coach-tempo-unavailable')
    expect(progressFallback?.textContent ?? '').toContain('couldn’t pull your progress numbers')
    expect(rhythmFallback?.textContent ?? '').toContain('day-by-day rhythm')
    // The two replacements deliberately differ (layout, copy, CTA) — no repetition.
    expect(progressFallback?.textContent).not.toBe(rhythmFallback?.textContent)
    // No invented metrics anywhere in the fallbacks.
    expect(progressFallback?.textContent ?? '').not.toMatch(/\$\d/)
    expect(rhythmFallback?.textContent ?? '').not.toMatch(/\$\d/)
    // The rest of the page is still genuinely live.
    expect(document.querySelector('.coach-value-grid')).toBeTruthy()
    expect(document.querySelector('.coach-priorities-section')?.textContent ?? '').toContain('All caught up')
  })

  it('section retry re-fetches the failed endpoint for real', async () => {
    await mountApp(homePath, ['/store-coach/progress/summary', '/store-coach/progress/heatmap'])
    const before = countCalls('/store-coach/progress/summary')
    const retry = [...document.querySelectorAll('.coach-progress-dashboard .coach-section-unavailable button')].find((button) => (button.textContent ?? '').includes('Retry loading progress'))
    expect(retry).toBeTruthy()
    await act(async () => { retry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(countCalls('/store-coach/progress/summary')).toBeGreaterThan(before)
    // After the retried fetch failed again, the fallback is back — no skeleton stuck on screen.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(document.querySelectorAll('.coach-skeleton-row')).toHaveLength(0)
    expect(document.querySelector('.coach-progress-dashboard .coach-section-unavailable')).toBeTruthy()
  })

  it('recovers to real content when a retry succeeds', async () => {
    await mountApp(homePath, ['/store-coach/progress/summary', '/store-coach/progress/heatmap'])
    expect(document.querySelector('.coach-progress-dashboard .coach-section-unavailable')).toBeTruthy()
    // Heal the backend, then click the banner's retry.
    mockBackend([])
    const bannerRetry = [...document.querySelectorAll('.coach-partial-banner button')].find((button) => (button.textContent ?? '').includes('Retry'))
    await act(async () => { bannerRetry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
    // Real (empty-state) content now: no fallback, no banner, no skeletons.
    expect(document.querySelector('.coach-partial-banner')).toBeNull()
    expect(document.querySelector('.coach-progress-dashboard .coach-section-unavailable')).toBeNull()
    expect(document.querySelector('.coach-progress-dashboard')?.textContent ?? '').toContain('No trend to chart yet')
    expect(document.querySelector('.coach-bestdays-section')?.textContent ?? '').toContain('Your best days will appear here')
    expect(document.querySelectorAll('.coach-skeleton-row')).toHaveLength(0)
  })

  it('achievements view: failed badge catalog gets a retry instead of a forever-skeleton', async () => {
    await mountApp('/ai-growth-command/coach/achievements?storeId=partial-test&shop=partial-test.myshopify.com', ['/store-coach/achievements/available'])
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(document.querySelectorAll('.coach-skeleton-row')).toHaveLength(0)
    const fallback = document.querySelector('.coach-subview .coach-section-unavailable')
    expect(fallback?.textContent ?? '').toContain('The badge catalog didn’t load')
    const before = countCalls('/store-coach/achievements/available')
    const retry = [...(fallback?.querySelectorAll('button') ?? [])].find((button) => (button.textContent ?? '').includes('Retry loading badges'))
    expect(retry).toBeTruthy()
    await act(async () => { retry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(countCalls('/store-coach/achievements/available')).toBeGreaterThan(before)
  })

  it('produces no console errors while recovering from the failures', async () => {
    await mountApp(homePath, ['/store-coach/progress/summary', '/store-coach/progress/heatmap'])
    expect(consoleErrors).toEqual([])
  })
})
