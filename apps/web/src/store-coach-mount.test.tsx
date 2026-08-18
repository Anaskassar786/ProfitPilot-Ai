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
    if (url.includes('/session/context')) return json(200, EMPTY_ENVELOPE({ storeId: 'mount-test', shop: 'mount-test.myshopify.com' }))
    if (url.includes('/security/csrf')) return json(200, EMPTY_ENVELOPE({ csrfToken: 'mount-token' }))
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
  }))
}

beforeEach(() => {
  consoleErrors.length = 0
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', '/ai-growth-command?storeId=mount-test')
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
  it('shows the AI Growth Command sidebar entry with a NEW badge', async () => {
    await mountApp()
    const nav = document.querySelector('.side-nav')
    expect(nav?.textContent ?? '').toContain('AI Growth Command')
    const newTag = [...(nav?.querySelectorAll('.nav-tag') ?? [])].find((tag) => tag.textContent === 'NEW')
    expect(newTag).toBeTruthy()
  })
  it('shows the Campaigns sidebar entry muted with a Soon badge', async () => {
    await mountApp()
    const campaigns = [...document.querySelectorAll('.nav-item')].find((item) => item.textContent?.includes('Campaigns'))
    expect(campaigns).toBeTruthy()
    expect(campaigns?.classList.contains('muted')).toBe(true)
    expect(campaigns?.textContent ?? '').toContain('Soon')
  })
  it('renders the three AI Growth Command tabs with locked placeholders', async () => {
    await mountApp()
    const tabs = [...document.querySelectorAll('.coach-tab')].map((tab) => tab.textContent ?? '')
    expect(tabs.some((text) => text.includes('Store Coach'))).toBe(true)
    expect(tabs.some((text) => text.includes('Executive Briefing') && text.includes('Coming Soon'))).toBe(true)
    expect(tabs.some((text) => text.includes('Insights Hub') && text.includes('Coming Soon'))).toBe(true)
  })
  it('shows the educational empty states for a store with no huddle yet', async () => {
    await mountApp()
    const main = document.querySelector('.coach-main')
    expect(main?.textContent ?? '').toContain('Your Store Coach is preparing today')
    expect(main?.textContent ?? '').toContain('All clear! No urgent actions today')
    expect(main?.textContent ?? '').toContain('Set your first weekly goal')
    expect(main?.textContent ?? '').toContain('Complete your first huddle to earn your first badge!')
  })
  it('renders the briefings and insights Coming Soon sections on navigation', async () => {
    await mountApp()
    const briefingTab = [...document.querySelectorAll('.coach-tab')].find((tab) => tab.textContent?.includes('Executive Briefing'))
    await act(async () => { briefingTab?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelector('.coach-coming-soon')?.textContent ?? '').toContain('Executive Briefing is coming soon')
    const insightsTab = [...document.querySelectorAll('.coach-tab')].find((tab) => tab.textContent?.includes('Insights Hub'))
    await act(async () => { insightsTab?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelector('.coach-coming-soon')?.textContent ?? '').toContain('Insights Hub is coming soon')
  })
  it('produces no console errors during the Store Coach mount', async () => {
    await mountApp()
    expect(consoleErrors).toEqual([])
  })
})
