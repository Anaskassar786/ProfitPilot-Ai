/**
 * Regression suite for the PR #36 production outage.
 *
 * Symptom: Analytics rendered a black screen, console showed
 *   `Uncaught RangeError: Invalid time value at Date.toISOString`.
 *
 * Root cause: `analytics_revenue_daily.day` is a Postgres `date` column. The
 * `pg` driver parses OID 1082 into a JS `Date`, so the API serialises
 * `"2026-08-14T00:00:00.000Z"` rather than the bare `"2026-08-14"` day key the
 * web types declare. `AnalyticsHeader` appended `T00:00:00Z` to that value,
 * producing `Invalid Date`, then called `.toISOString()` on it. The throw
 * happened in a `useState` initializer in the one child that was NOT wrapped in
 * a section boundary, so the entire page unmounted.
 *
 * These tests mount the real page against hostile payloads and assert nothing
 * throws and the page still renders.
 */
import { createElement, Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { analyticsKpis, periodTrend } from './analytics-model.js'
import type { AnalyticsSnapshot } from './model.js'

class RO { observe() {} unobserve() {} disconnect() {} }

/** The literal shape the production API returns for a Postgres `date` column. */
const ISO_DAY = '2026-08-14T00:00:00.000Z'
const ISO_DAY_2 = '2026-08-16T00:00:00.000Z'

/** A 2-order store exactly as the API serialises it in production. */
const productionShapedSnapshot = {
  revenue: [
    { storeId: 's', day: ISO_DAY, grossRevenue: 100, discounts: 0, orderCount: 1 },
    { storeId: 's', day: ISO_DAY_2, grossRevenue: 50, discounts: 0, orderCount: 1 },
  ],
  orders: [
    { storeId: 's', day: ISO_DAY, orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 100 },
    { storeId: 's', day: ISO_DAY_2, orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 50 },
  ],
  productSales: [],
  customerCohorts: [],
} as unknown as AnalyticsSnapshot

/** Rows whose dates are null, undefined, empty or plain nonsense. */
const corruptSnapshot = {
  revenue: [
    { storeId: 's', day: null, grossRevenue: 10, discounts: 0, orderCount: 1 },
    { storeId: 's', day: undefined, grossRevenue: 20, discounts: 0, orderCount: 1 },
    { storeId: 's', day: '', grossRevenue: 30, discounts: 0, orderCount: 1 },
    { storeId: 's', day: 'not-a-date', grossRevenue: 40, discounts: 0, orderCount: 1 },
    { storeId: 's', day: '2026-08-14', grossRevenue: 50, discounts: 0, orderCount: 1 },
  ],
  orders: [
    { storeId: 's', day: null, orderCount: 1, fulfilledCount: 0, cancelledCount: 0, averageOrderValue: 10 },
    { storeId: 's', day: 'garbage', orderCount: 2, fulfilledCount: 0, cancelledCount: 0, averageOrderValue: 20 },
  ],
  productSales: [],
  customerCohorts: [],
} as unknown as AnalyticsSnapshot

const emptySnapshot: AnalyticsSnapshot = { revenue: [], orders: [], productSales: [], customerCohorts: [] }

function insightsFixture(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'commander' as const,
    generatedAt: ISO_DAY,
    salesHistoryDays: 2,
    forecast: { status: 'insufficient_data' as const, message: 'Awaiting more data.', points: [], standardDeviation: 0 },
    anomalies: null,
    categories: [],
    topProducts: [],
    weekdays: [],
    peakHours: null,
    totalCustomers: null,
    channels: [],
    geography: [],
    cohorts: [],
    comparisons: [],
    opportunities: [],
    available: [],
    locked: [],
    usage: { used: 0, limit: null, remaining: null },
    cached: false,
    ...overrides,
  }
}

describe('analytics model tolerates production date shapes', () => {
  it('normalises full ISO timestamps into day keys for the trend series', () => {
    const points = periodTrend(productionShapedSnapshot, 7, null)
    expect(points).toHaveLength(7)
    for (const point of points) expect(point.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Revenue must still be matched to the right day despite the ISO input.
    expect(points.find((point) => point.day === '2026-08-14')?.revenue).toBe(100)
    expect(points.find((point) => point.day === '2026-08-16')?.revenue).toBe(50)
  })

  it('computes KPIs from ISO-timestamp rows without NaN', () => {
    const kpis = analyticsKpis(productionShapedSnapshot, null)
    expect(kpis[0]?.value).toBe(150)
    expect(kpis[1]?.value).toBe(2)
    for (const kpi of kpis) expect(Number.isNaN(kpi.value ?? 0)).toBe(false)
  })

  it('drops unparseable rows instead of throwing', () => {
    expect(() => periodTrend(corruptSnapshot, 30, null)).not.toThrow()
    expect(() => analyticsKpis(corruptSnapshot, null)).not.toThrow()
    const points = periodTrend(corruptSnapshot, 7, null)
    for (const point of points) expect(point.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Only the one valid row contributes revenue.
    expect(analyticsKpis(corruptSnapshot, null)[0]?.value).toBe(50)
  })

  it('survives a forecast whose points carry invalid days', () => {
    const forecast = {
      status: 'available' as const,
      message: '',
      points: [
        { day: null, value: 1, lower: 0, upper: 2 },
        { day: 'nope', value: 2, lower: 1, upper: 3 },
        { day: '2026-08-17', value: 3, lower: 2, upper: 4 },
      ],
      standardDeviation: 0,
    } as unknown as Parameters<typeof periodTrend>[2]
    expect(() => periodTrend(productionShapedSnapshot, 7, forecast)).not.toThrow()
    const forecasted = periodTrend(productionShapedSnapshot, 7, forecast).filter((point) => point.forecast !== null)
    expect(forecasted).toHaveLength(1)
    expect(forecasted[0]?.day).toBe('2026-08-17')
  })

  it('returns an empty series for empty input rather than crashing', () => {
    expect(periodTrend(emptySnapshot, 30, null)).toEqual([])
    expect(periodTrend(null, 30, null)).toEqual([])
    expect(analyticsKpis(null, null)).toHaveLength(6)
  })
})

describe('normalizeAnalyticsSnapshot repairs the API date contract', () => {
  it('converts ISO timestamps back into the bare day keys the types promise', async () => {
    const { normalizeAnalyticsSnapshot } = await import('./api.js')
    const result = normalizeAnalyticsSnapshot(productionShapedSnapshot)
    expect(result.revenue.map((row) => row.day)).toEqual(['2026-08-14', '2026-08-16'])
    expect(result.orders.map((row) => row.day)).toEqual(['2026-08-14', '2026-08-16'])
    // Non-date fields are preserved untouched.
    expect(result.revenue[0]?.grossRevenue).toBe(100)
  })

  it('drops rows whose dates cannot be parsed', async () => {
    const { normalizeAnalyticsSnapshot } = await import('./api.js')
    const result = normalizeAnalyticsSnapshot(corruptSnapshot)
    expect(result.revenue).toHaveLength(1)
    expect(result.revenue[0]?.day).toBe('2026-08-14')
    expect(result.orders).toHaveLength(0)
  })

  it('normalises both cohort date fields and drops half-valid rows', async () => {
    const { normalizeAnalyticsSnapshot } = await import('./api.js')
    const result = normalizeAnalyticsSnapshot({
      revenue: [], orders: [], productSales: [],
      customerCohorts: [
        { storeId: 's', cohortDay: ISO_DAY, activityDay: ISO_DAY_2, customerCount: 1, grossRevenue: 10 },
        { storeId: 's', cohortDay: null, activityDay: ISO_DAY_2, customerCount: 1, grossRevenue: 10 },
        { storeId: 's', cohortDay: ISO_DAY, activityDay: 'nope', customerCount: 1, grossRevenue: 10 },
      ],
    } as unknown as AnalyticsSnapshot)
    expect(result.customerCohorts).toHaveLength(1)
    expect(result.customerCohorts[0]?.cohortDay).toBe('2026-08-14')
    expect(result.customerCohorts[0]?.activityDay).toBe('2026-08-16')
  })

  it('returns an empty snapshot for null, undefined and malformed payloads', async () => {
    const { normalizeAnalyticsSnapshot } = await import('./api.js')
    const empty = { revenue: [], orders: [], productSales: [], customerCohorts: [] }
    expect(normalizeAnalyticsSnapshot(null)).toEqual(empty)
    expect(normalizeAnalyticsSnapshot(undefined)).toEqual(empty)
    expect(normalizeAnalyticsSnapshot({} as AnalyticsSnapshot)).toEqual(empty)
    expect(normalizeAnalyticsSnapshot({ revenue: 'nope' } as unknown as AnalyticsSnapshot)).toEqual(empty)
  })

  it('protects the Dashboard weekly aggregation from the same crash', async () => {
    // aggregateRevenueByPeriod('weekly') does new Date(row.day + 'T00:00:00'),
    // which throws on an ISO-timestamp day. Normalising at the boundary means
    // the Dashboard never sees that shape.
    const { normalizeAnalyticsSnapshot } = await import('./api.js')
    const { aggregateRevenueByPeriod } = await import('./dashboard-utils.js')
    const normalized = normalizeAnalyticsSnapshot(productionShapedSnapshot)
    expect(() => aggregateRevenueByPeriod(normalized, 'weekly')).not.toThrow()
    for (const point of aggregateRevenueByPeriod(normalized, 'weekly')) {
      expect(point.label).not.toContain('Invalid')
      expect(point.label).not.toContain('NaN')
    }
  })
})

describe('analytics page survives every hostile date payload', () => {
  afterEach(() => { vi.resetModules(); vi.restoreAllMocks() })

  async function mount(snapshot: AnalyticsSnapshot | null, insights: Record<string, unknown> | null) {
    const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    })
    for (const [key, value] of [
      ['window', dom.window],
      ['document', dom.window.document],
      ['navigator', dom.window.navigator],
      ['HTMLElement', dom.window.HTMLElement],
      ['SVGElement', (dom.window as unknown as { SVGElement: unknown }).SVGElement],
      ['Node', dom.window.Node],
      ['Element', dom.window.Element],
      ['ResizeObserver', RO],
    ] as const) {
      Object.defineProperty(globalThis, key, { configurable: true, value })
    }
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(dom.window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }),
    })

    vi.doMock('./api.js', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./api.js')
      return { ...actual, fetchAnalyticsInsights: async () => { if (!insights) throw new Error('insights unavailable'); return insights } }
    })

    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const { AnalyticsPage } = await import('./analytics.js')

    class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null }
      static getDerivedStateFromError(error: Error) { return { error } }
      componentDidCatch(error: Error, info: ErrorInfo) { console.error('PAGE_CRASH', error.message, info.componentStack) }
      render() { return this.state.error ? createElement('div', { 'data-page-error': this.state.error.message }) : this.props.children }
    }

    const container = dom.window.document.getElementById('root')
    if (!container) throw new Error('missing root')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Boundary, null, createElement(AnalyticsPage as never, {
        context: { storeId: 's', shop: 'test.myshopify.com' },
        snapshot, onSync: async () => {}, onNavigateBilling: () => {},
      })))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
    return { dom, container }
  }

  it('renders the exact production payload that caused the black screen', async () => {
    const { dom, container } = await mount(productionShapedSnapshot, insightsFixture())
    // The whole point: no page-level crash, no black screen.
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.querySelector('.analytics-page')).not.toBeNull()
    expect(container.querySelectorAll('.analytics-kpi')).toHaveLength(6)
    expect(container.textContent).not.toContain('Invalid Date')
    expect(container.textContent).not.toContain('NaN')
    dom.window.close()
  })

  it('seeds the custom date-range inputs with valid keys from an ISO payload', async () => {
    // These two inputs are driven by the useState initializer that threw the
    // production RangeError, so they are the closest thing to a direct probe.
    const { dom, container } = await mount(productionShapedSnapshot, insightsFixture())
    const { act } = await import('react')
    const custom = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Custom')
    expect(custom).toBeDefined()
    await act(async () => { custom?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })

    const dateInputs = [...container.querySelectorAll('input[type="date"]')] as unknown as { value: string }[]
    expect(dateInputs).toHaveLength(2)
    for (const input of dateInputs) expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // "from" is 29 days before the latest synced day, "to" is that day.
    expect(dateInputs[0]?.value).toBe('2026-07-18')
    expect(dateInputs[1]?.value).toBe('2026-08-16')
    expect(container.querySelector('[data-page-error]')).toBeNull()
    dom.window.close()
  })

  it('renders when every date field is null, undefined, empty or invalid', async () => {
    const { dom, container } = await mount(corruptSnapshot, insightsFixture({ generatedAt: null }))
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.querySelector('.analytics-page')).not.toBeNull()
    expect(container.querySelectorAll('.analytics-kpi')).toHaveLength(6)
    expect(container.textContent).not.toContain('Invalid Date')
    dom.window.close()
  })

  it('renders a 0-order empty store', async () => {
    const { dom, container } = await mount(emptySnapshot, insightsFixture({ salesHistoryDays: 0 }))
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.querySelectorAll('.analytics-kpi')).toHaveLength(6)
    dom.window.close()
  })

  it('renders a cohort matrix built from sparse and malformed cohorts', async () => {
    const { dom, container } = await mount(productionShapedSnapshot, insightsFixture({
      cohorts: [
        { cohort: '2026-08', periods: [{ month: 0, customers: 2, retention: 100 }] },
        { cohort: '', periods: [] },
        { cohort: 'bad-cohort', periods: [{ month: 0, customers: 1, retention: null }] },
      ],
    }))
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.textContent).toContain('Customer cohort analysis')
    expect(container.textContent).not.toContain('Invalid Date')
    expect(container.textContent).not.toContain('NaN')
    dom.window.close()
  })

  it('renders peak hours when timestamps are missing or malformed', async () => {
    const { dom, container } = await mount(productionShapedSnapshot, insightsFixture({
      peakHours: [{ hour: 9, orders: 2 }, { hour: null, orders: 5 }, { hour: 14, orders: null }],
      weekdays: [{ day: 'Mon', revenue: null }, { day: 'Tue', revenue: 100 }],
    }))
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.textContent).toContain('Peak sales hours')
    expect(container.textContent).not.toContain('NaN')
    dom.window.close()
  })

  it('renders anomaly rows whose days are invalid', async () => {
    const { dom, container } = await mount(productionShapedSnapshot, insightsFixture({
      anomalies: [
        { day: null, direction: 'spike', value: 10, average: 5, percentFromAverage: 100 },
        { day: ISO_DAY, direction: 'dip', value: 1, average: 5, percentFromAverage: -80 },
      ],
    }))
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.textContent).not.toContain('Invalid Date')
    dom.window.close()
  })
})

describe('every analytics section is individually error-boundaried', () => {
  it('wraps all sections, including the header that caused the outage', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./analytics.tsx', import.meta.url), 'utf8')
    for (const label of [
      'analytics header', 'performance overview', 'revenue intelligence', 'orders and AOV',
      'discount leakage', 'stock-out risk', 'AI business intelligence', 'customer cohorts',
      'geographic distribution', 'product performance', 'temporal patterns', 'conversion funnel',
      'advanced comparisons', 'custom AI analyst',
    ]) expect(source, `missing boundary for "${label}"`).toContain(`<Boundary label="${label}">`)
  })

  it('contains no unguarded toISOString or bare date-string concatenation', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./analytics.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('.toISOString()')
    expect(source).not.toContain('T00:00:00Z`')
  })

  it('routes model date arithmetic through the safe helpers', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./analytics-model.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('.toISOString()')
    expect(source).toContain('safeAddDays')
    expect(source).toContain('safeDayKey')
  })
})

describe('section error boundary isolates a crashing child', () => {
  it('renders a retryable fallback while siblings keep rendering', async () => {
    const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
    for (const [key, value] of [
      ['window', dom.window], ['document', dom.window.document], ['navigator', dom.window.navigator],
      ['HTMLElement', dom.window.HTMLElement], ['SVGElement', (dom.window as unknown as { SVGElement: unknown }).SVGElement],
      ['Node', dom.window.Node], ['Element', dom.window.Element], ['ResizeObserver', RO],
    ] as const) Object.defineProperty(globalThis, key, { configurable: true, value })
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const { AnalyticsSectionBoundary } = await import('./analytics.js')

    const Exploding = () => { throw new RangeError('Invalid time value') }
    const container = dom.window.document.getElementById('root')
    if (!container) throw new Error('missing root')
    const root = createRoot(container)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      root.render(createElement('div', null,
        createElement(AnalyticsSectionBoundary as never, { label: 'exploding section' }, createElement(Exploding)),
        createElement('p', { 'data-sibling': 'true' }, 'sibling still rendered'),
      ))
    })

    // The crashed section degrades to a fallback...
    expect(container.querySelector('.section-fallback')).not.toBeNull()
    expect(container.textContent).toContain('exploding section')
    expect(container.textContent).toContain('Retry section')
    // ...and the rest of the page is untouched.
    expect(container.querySelector('[data-sibling]')).not.toBeNull()
    expect(container.textContent).toContain('sibling still rendered')
    errors.mockRestore()
    dom.window.close()
  })
})
