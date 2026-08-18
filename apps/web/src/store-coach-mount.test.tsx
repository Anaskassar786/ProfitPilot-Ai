// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.js'

/**
 * PR #48 — mount smoke test. Renders the full app shell pointed at the
 * AI Growth Command deep link against an honest empty backend and fails on
 * any console error or render crash. This is the "no console errors"
 * success criterion made executable without a browser.
 */

const consoleErrors: string[] = []
let root: Root | null = null

const EMPTY_ENVELOPE = (data: unknown): unknown => ({ ok: true, data, requestId: 'mount-test' })

function mockBackend(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/store-coach/huddle/today')) return json(200, EMPTY_ENVELOPE(null))
    if (url.includes('/store-coach/priorities/today')) return json(200, EMPTY_ENVELOPE({ priorityDate: '2026-08-18', priorities: [], planLimit: 2, remainingToday: 2 }))
    if (url.includes('/store-coach/goals')) return json(200, EMPTY_ENVELOPE([]))
    if (url.includes('/store-coach/progress/summary')) return json(200, EMPTY_ENVELOPE({ window: 30, revenue: 0, orders: 0, aov: 0, customers: 0, revenueTrendPct: 0, series: [], comparisonSeries: [] }))
    if (url.includes('/store-coach/progress/heatmap')) return json(200, EMPTY_ENVELOPE({ weeks: 12, bestDay: null, busiestWeek: null, cells: [], legend: [] }))
    if (url.includes('/store-coach/achievements')) return json(200, EMPTY_ENVELOPE({ earned: [], visible: 5 }))
    if (url.includes('/store-coach/streak')) return json(200, EMPTY_ENVELOPE({ currentStreak: 0, longestStreak: 0, lastActiveDate: null, todayViewed: false }))
    if (url.includes('/store-coach/review/current')) return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'No review yet', details: {} } })
    if (url.includes('/store-coach/preferences')) return json(200, EMPTY_ENVELOPE({ storeId: 'mount-test', personality: 'PROFESSIONAL', huddleTimeMinutes: 420, huddleEnabled: true, weeklyEmailEnabled: true, voiceEnabled: false, widgetEnabled: false, language: 'en', notificationFrequency: 'NORMAL', updatedAt: 0, plan: 'trial' }))
    if (url.includes('/store-coach/usage')) return json(200, EMPTY_ENVELOPE({ plan: 'trial', chatMessagesToday: 0, chatLimit: 5, huddlesGeneratedToday: 0, activeGoals: 0, goalLimit: 1, chatAtWarning: false, chatExhausted: false }))
    if (url.includes('/store-coach/health-score')) return json(200, EMPTY_ENVELOPE({ score: null, label: 'No activity yet', tone: 'low', factors: {}, history: [] }))
    if (url.includes('/ai-executive/dashboard')) return json(200, EMPTY_ENVELOPE({ storeId: 'mount-test', plan: 'trial', currency: 'USD', health: null, latestReport: null, nextReportDue: '2026-09-01', benchmarkPosition: null, opportunities: [], risks: [], scenarios: [], roadmap: null, decisions: [], usage: { plan: 'trial', features: [] }, gates: {}, revenueSeries: [], ordersSeries: [], generatedAt: '2026-08-18T00:00:00.000Z' }))
    if (url.includes('/session/context')) return json(200, EMPTY_ENVELOPE({ storeId: 'mount-test', shop: 'mount-test.myshopify.com' }))
    if (url.includes('/security/csrf')) return json(200, EMPTY_ENVELOPE({ csrfToken: 'mount-token' }))
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
  }))
}

beforeEach(() => {
  consoleErrors.length = 0
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', '/ai-growth-command/coach?storeId=mount-test&shop=mount-test.myshopify.com')
  window.localStorage.clear()
  const originalError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
    originalError(...args)
  })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: query.includes('light'), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
  // jsdom has no canvas implementation; recharts v3 measures on canvas.
  // A null context is enough for mount-time smoke coverage.
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
  await act(async () => {
    root!.render(createElement(StrictMode, null, createElement(App)))
  })
  // Let the coach data hooks settle against the mocked backend.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

describe('Store Coach app mount (PR #48)', () => {
  it('renders the AI Growth Command deep link without crashing', async () => {
    await expect(mountApp()).resolves.toBeUndefined()
  })
  it('shows Store Coach, AI Executive, and Insights Hub as separate sidebar entries', async () => {
    await mountApp()
    const nav = document.querySelector('.side-nav')
    expect(nav?.textContent ?? '').toContain('Store Coach')
    expect(nav?.textContent ?? '').toContain('AI Executive')
    expect(nav?.textContent ?? '').toContain('Insights Hub')
    const labels = [...(nav?.querySelectorAll('.nav-item') ?? [])].map((item) => item.textContent ?? '')
    expect(labels.some((text) => text.includes('Store Coach'))).toBe(true)
    expect(labels.some((text) => text.includes('AI Executive'))).toBe(true)
    expect(labels.some((text) => text.includes('Insights Hub'))).toBe(true)
  })
  it('does not nest Store Coach and AI Executive as tabs inside one page', async () => {
    await mountApp()
    expect(document.querySelectorAll('.coach-tab')).toHaveLength(0)
    expect(document.querySelectorAll('.growth-tabs')).toHaveLength(0)
    const muted = [...document.querySelectorAll('.nav-item')].filter((item) => item.classList.contains('muted'))
    expect(muted).toHaveLength(0)
  })
  it('shows the educational empty states for a store with no huddle yet', async () => {
    await mountApp()
    const main = document.querySelector('.coach-main')
    expect(main?.textContent ?? '').toContain('Welcome to Store Coach!')
    expect(main?.textContent ?? '').toContain('Generate My First Briefing')
    expect(main?.textContent ?? '').toContain('All caught up')
    expect(main?.textContent ?? '').toContain("Let’s set your first weekly goal")
    expect(main?.textContent ?? '').toContain('Complete your first huddle to earn your first badge!')
  })
  it('greets the merchant personally with streak and huddle actions', async () => {
    await mountApp()
    const hero = document.querySelector('.coach-hero')
    expect(hero?.textContent ?? '').toMatch(/Good (morning|afternoon|evening)|Burning the midnight oil/)
    expect(hero?.textContent ?? '').toContain('Mount Test')
    expect(hero?.textContent ?? '').toContain('Streak: 0 days')
    const actions = [...(hero?.querySelectorAll('button') ?? [])].map((button) => button.textContent ?? '')
    expect(actions.some((label) => label.includes('Start Morning Huddle'))).toBe(true)
    expect(actions.some((label) => label.includes('Ask Coach'))).toBe(true)
  })
  it('shows the plan card with factual inclusions and Upgrade Plan wording', async () => {
    await mountApp()
    const planCard = document.querySelector('.coach-plan-card')
    expect(planCard?.textContent ?? '').toContain('YOUR PLAN')
    expect(planCard?.textContent ?? '').toContain('2 priorities per day')
    const upgradeButtons = [...(planCard?.querySelectorAll('button') ?? [])].filter((button) => /upgrade/i.test(button.textContent ?? ''))
    expect(upgradeButtons.length).toBeGreaterThan(0)
    for (const button of upgradeButtons) expect(button.textContent?.trim()).toBe('Upgrade Plan')
  })
  it('never uses “Upgrade to <tier>” wording anywhere on the page', async () => {
    await mountApp()
    expect(document.body.textContent ?? '').not.toMatch(/Upgrade to (Start|Growth|Commander)/i)
  })
  it('opens AI Executive from its own sidebar entry', async () => {
    await mountApp()
    const executiveNav = [...document.querySelectorAll('.nav-item')].find((item) => item.textContent?.includes('AI Executive'))
    expect(executiveNav).toBeTruthy()
    await act(async () => { executiveNav?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelector('.exec-page') ?? document.querySelector('.coach-workspace')).toBeTruthy()
  })
  it('produces no console errors during the Store Coach mount', async () => {
    await mountApp()
    expect(consoleErrors).toEqual([])
  })
})
