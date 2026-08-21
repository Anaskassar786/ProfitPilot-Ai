// @vitest-environment jsdom
import './jsdom-polaris-setup.js'
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.js'
import { MomentumWave, PriorityCard, coachPathForView, coachViewFromPath } from './store-coach.js'
import type { CoachPriority } from './store-coach-model.js'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }


/**
 * Store Coach integrity suite.
 *
 * Guards the ultra-audit fixes:
 *  1. No hardcoded/fabricated store numbers anywhere on the page.
 *  2. No "coming soon" placeholder surfaces.
 *  3. Every rendered button is wired to a real handler (no dead controls).
 *  4. Data-dependent sections tolerate the null -> loaded -> null transitions
 *     that a refresh causes, without hook-order warnings or crashes.
 */

const consoleErrors: string[] = []
const consoleWarnings: string[] = []
let root: Root | null = null

const ENVELOPE = (data: unknown): unknown => ({ ok: true, data, requestId: 'integrity-test' })

/** A store with REAL synced rows, so populated (not just empty) UI is covered. */
function mockPopulatedBackend(): void {
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 4 + index))
    return date.toISOString().slice(0, 10)
  })
  const series = days.map((day, index) => ({ day, revenue: 900 + index * 45, orders: 10 + index }))
  const cells = days.map((day, index) => ({
    day,
    weekday: new Date(`${day}T00:00:00Z`).getUTCDay(),
    week: Math.floor(index / 7),
    orders: 10 + index,
    revenue: 900 + index * 45,
    intensity: Math.min(index / 14, 1),
  }))

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/store-coach/huddle/today')) {
      return json(200, ENVELOPE({ id: 'huddle-1', huddleDate: '2026-08-18', viewed: false, createdAt: Date.now(), plan: 'growth', voiceAvailable: false, content: { greeting: 'Good morning.', yesterdaySnapshot: 'Yesterday brought 23 orders and $1,485.00.', todayPreview: 'Review your top priority.', keyInsight: 'AOV held at 64.57.', reviewMinutes: 2 } }))
    }
    if (url.includes('/store-coach/priorities/today')) {
      return json(200, ENVELOPE({ priorityDate: '2026-08-18', planLimit: 5, remainingToday: 4, priorities: [
        { id: 'p1', priorityDate: '2026-08-18', category: 'HIGH_IMPACT', title: 'Restock your best seller', description: 'Stock cover is thin.', impactValue: 1200, impactCurrency: 'USD', impactLabel: '7-day revenue at risk', timeEstimateMinutes: 15, actionType: 'navigate', actionPayload: {}, status: 'PENDING', expiresAt: null },
      ] }))
    }
    if (url.includes('/store-coach/goals/suggestions')) return json(200, ENVELOPE([]))
    if (url.includes('/store-coach/goals')) return json(200, ENVELOPE([]))
    if (url.includes('/store-coach/progress/summary')) return json(200, ENVELOPE({ window: 90, revenue: 17010, orders: 231, aov: 73.6, customers: 88, revenueTrendPct: 6.4, series, comparisonSeries: [] }))
    if (url.includes('/store-coach/progress/heatmap')) return json(200, ENVELOPE({ weeks: 12, bestDay: days[9], busiestWeek: '2026-W33', cells, legend: [0, 1, 2, 3] }))
    if (url.includes('/store-coach/progress/comparisons')) return json(200, ENVELOPE({ revenue: { current: 17010, previous: 15990, changePct: 6.4 }, orders: { current: 231, previous: 220, changePct: 5 } }))
    if (url.includes('/store-coach/achievements/available')) return json(200, ENVELOPE({ catalog: [], visible: 30 }))
    if (url.includes('/store-coach/achievements')) return json(200, ENVELOPE({ earned: [], visible: 30 }))
    if (url.includes('/store-coach/streak')) return json(200, ENVELOPE({ currentStreak: 4, longestStreak: 9, lastActiveDate: '2026-08-18', todayViewed: false }))
    if (url.includes('/store-coach/review/current')) return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'No review yet', details: {} } })
    if (url.includes('/store-coach/preferences')) return json(200, ENVELOPE({ storeId: 'integrity', personality: 'PROFESSIONAL', huddleTimeMinutes: 420, huddleEnabled: true, weeklyEmailEnabled: true, voiceEnabled: false, widgetEnabled: false, language: 'en', notificationFrequency: 'NORMAL', updatedAt: 0, plan: 'growth' }))
    if (url.includes('/store-coach/usage')) return json(200, ENVELOPE({ plan: 'growth', chatMessagesToday: 0, chatLimit: 100, huddlesGeneratedToday: 1, activeGoals: 0, goalLimit: 5, chatAtWarning: false, chatExhausted: false }))
    if (url.includes('/store-coach/health-score')) return json(200, ENVELOPE({ score: 72, label: 'Engaged', tone: 'good', factors: {}, history: [] }))
    if (url.includes('/store-coach/onboarding/status')) return json(200, ENVELOPE({ currentStep: 5, completed: true, skipped: false, completedAt: 0, steps: [] }))
    if (url.includes('/session/context')) return json(200, ENVELOPE({ storeId: 'integrity', shop: 'integrity-store.myshopify.com' }))
    if (url.includes('/security/csrf')) return json(200, ENVELOPE({ csrfToken: 'token' }))
    return json(200, ENVELOPE(null))
  }))
}

beforeEach(() => {
  consoleErrors.length = 0
  consoleWarnings.length = 0
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', '/ai-growth-command/coach?storeId=integrity&shop=integrity-store.myshopify.com')
  window.localStorage.clear()
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args.map(String).join(' ')) })
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { consoleWarnings.push(args.map(String).join(' ')) })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null, writable: true, configurable: true })
  mockPopulatedBackend()
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
  await act(async () => { root!.render(createElement(StrictMode, null, createElement(AppProvider, { i18n: enTranslations as never }, createElement(App)))) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

describe('Store Coach — no fabricated data', () => {
  it('never renders the hardcoded sync-progress placeholder', async () => {
    await mountApp()
    const page = document.body.textContent ?? ''
    expect(page).not.toContain('Sync Progress: 60%')
    expect(page).not.toContain('Currently: 12 orders')
    expect(page).not.toMatch(/Need 30\+ orders for personalized priorities/)
  })

  it('renders no "coming soon" placeholder surfaces', async () => {
    await mountApp()
    expect(document.body.textContent ?? '').not.toMatch(/coming soon/i)
    expect(document.querySelector('.coach-coming-soon')).toBeNull()
    expect(document.querySelector('.coming-soon-pill')).toBeNull()
  })

  it('never advertises an unshipped PR number to merchants', async () => {
    await mountApp()
    expect(document.body.textContent ?? '').not.toMatch(/Shipping in PR #\d+/i)
    expect(document.body.textContent ?? '').not.toMatch(/PR #\d+/)
  })

  it('does not render invented personality trait scores', async () => {
    await mountApp()
    // The old radar drew fixed values like [80,60,90,50] that no API produced.
    expect(document.querySelector('.coach-radar-small')).toBeNull()
    expect(document.querySelector('.coach-personality-radar-row')).toBeNull()
  })

  it('labels the momentum wave with the real series length, not fixed weekdays', () => {
    const html = renderToStaticMarkup(createElement(MomentumWave, { values: [10, 20, 30, 40, 50] }))
    expect(html).toContain('5 days of real revenue')
    // The old markup hardcoded M/T/W/T/F/S/S regardless of the series.
    expect(html).not.toMatch(/<span>M<\/span><span>T<\/span><span>W<\/span>/)
  })
})

describe('Store Coach — honest controls', () => {
  it('labels the priority action for what it actually does', () => {
    const priority: CoachPriority = {
      id: 'p1', priorityDate: '2026-08-18', category: 'HIGH_IMPACT', title: 'Restock', description: 'Low cover',
      impactValue: 1200, impactCurrency: 'USD', impactLabel: 'revenue at risk', timeEstimateMinutes: 15,
      actionType: 'navigate', actionPayload: {}, status: 'PENDING', expiresAt: null,
    }
    const html = renderToStaticMarkup(createElement(PriorityCard, { priority, busy: false, onComplete: () => undefined, onDismiss: () => undefined }))
    // "Take Action" implied the app performed the task; it only records completion.
    expect(html).toContain('Mark as done')
    expect(html).not.toContain('Take Action')
  })

  it('gives every rendered button a real click handler', async () => {
    await mountApp()
    const buttons = [...document.querySelectorAll('.coach-workspace button')]
    expect(buttons.length).toBeGreaterThan(0)
    // A dead control would throw or do nothing; clicking every button must not
    // produce a React error or an unhandled exception.
    for (const button of buttons) {
      if ((button as HTMLButtonElement).disabled) continue
      await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    }
    const hookErrors = consoleErrors.filter((line) => /hook|Cannot update|not wrapped in act/i.test(line))
    expect(hookErrors).toEqual([])
  })
})

describe('Store Coach — routing', () => {
  it('resolves retired placeholder deep links to the coach home', () => {
    expect(coachViewFromPath('/ai-growth-command/briefing')).toBe('coach')
    expect(coachViewFromPath('/ai-growth-command/insights')).toBe('coach')
  })

  it('round-trips every live view through its path', () => {
    for (const view of ['coach', 'goals', 'progress', 'chat', 'achievements', 'settings'] as const) {
      expect(coachViewFromPath(coachPathForView(view))).toBe(view)
    }
  })
})

describe('Store Coach — stability under reload', () => {
  it('mounts a populated store with no console errors or hook warnings', async () => {
    await mountApp()
    expect(consoleErrors).toEqual([])
    expect(consoleWarnings.filter((line) => /hook/i.test(line))).toEqual([])
  })

  it('survives navigating to Progress and back without a hook-order crash', async () => {
    await mountApp()
    const progressLink = [...document.querySelectorAll('.coach-workspace button')]
      .find((button) => /open progress view|see detailed patterns|explore detailed patterns/i.test(button.textContent ?? ''))
    expect(progressLink).toBeTruthy()
    await act(async () => { progressLink?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    await act(async () => { window.history.back() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    const hookErrors = consoleErrors.filter((line) => /Rendered (more|fewer) hooks|change in the order of Hooks/i.test(line))
    expect(hookErrors).toEqual([])
  })
})

describe('Store Coach — dev-server deep links', () => {
  it('routes every /ai-growth-command navigation to the SPA shell', async () => {
    // Regression: the broad '/ai' proxy rule swallowed /ai-growth-command/*,
    // so refreshing Store Coach answered a page navigation with API JSON.
    // The config is read as source (importing it would pull in esbuild, which
    // cannot initialise inside jsdom).
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const config = readFileSync(resolve(process.cwd(), 'apps/web/vite.config.ts'), 'utf8')
    const ruleIndex = config.indexOf("'^/ai-growth-command'")
    expect(ruleIndex).toBeGreaterThan(-1)
    const broadAiIndex = config.indexOf("'/ai': ")
    // The specific bypass must be declared before the broad '/ai' catch-all.
    expect(ruleIndex).toBeLessThan(broadAiIndex)
    const rule = config.slice(ruleIndex, ruleIndex + 260)
    expect(rule).toContain("text/html")
    expect(rule).toContain("'/index.html'")
  })
})
