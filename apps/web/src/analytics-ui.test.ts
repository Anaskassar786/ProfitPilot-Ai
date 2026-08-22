import { createElement, Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { analyticsKpis } from './analytics-model.js'
import type { AnalyticsSnapshot } from './model.js'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }

/** main.tsx wraps every page in Polaris AppProvider (i18n) — mirror it here so
 *  components using the Polaris Button shim render outside an app shell. */
function renderWithAppProvider(element: import('react').ReactElement) {
  return renderToStaticMarkup(createElement(AppProvider, { i18n: enTranslations as never }, element))
}


class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const emptySnapshot: AnalyticsSnapshot = {
  revenue: [],
  orders: [],
  productSales: [],
  customerCohorts: [],
}

const twoOrderSnapshot: AnalyticsSnapshot = {
  revenue: [
    { storeId: 's', day: '2026-08-14', grossRevenue: 100, discounts: 0, orderCount: 1 },
    { storeId: 's', day: '2026-08-16', grossRevenue: 50, discounts: 0, orderCount: 1 },
  ],
  orders: [
    { storeId: 's', day: '2026-08-14', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 100 },
    { storeId: 's', day: '2026-08-16', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 50 },
  ],
  productSales: [],
  customerCohorts: [],
}

function insightsFixture(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'trial' as const,
    generatedAt: new Date().toISOString(),
    salesHistoryDays: 2,
    forecast: { status: 'insufficient_data' as const, message: 'Awaiting more data — at least 7 sales days are needed.', points: [], standardDeviation: 0 },
    anomalies: null,
    categories: [] as readonly { name: string; revenue: number; units: number }[],
    topProducts: [] as readonly { productId: string; name: string; image: string | null; units: number; revenue: number; share: number; trend: 'up' | 'down' | 'flat' }[],
    weekdays: [
      { day: 'Mon', revenue: 0 }, { day: 'Tue', revenue: 0 }, { day: 'Wed', revenue: 0 },
      { day: 'Thu', revenue: 0 }, { day: 'Fri', revenue: 0 }, { day: 'Sat', revenue: 0 }, { day: 'Sun', revenue: 0 },
    ],
    peakHours: null as readonly { hour: number; orders: number }[] | null,
    totalCustomers: null as number | null,
    available: [] as readonly string[],
    locked: [
      { feature: 'anomaly_detection', requiredPlan: 'start' as const },
      { feature: 'product_trends', requiredPlan: 'growth' as const },
      { feature: 'customer_segments', requiredPlan: 'growth' as const },
      { feature: 'natural_language_insight', requiredPlan: 'growth' as const },
      { feature: 'period_comparisons', requiredPlan: 'growth' as const },
      { feature: 'geographic_distribution', requiredPlan: 'growth' as const },
      { feature: 'predictive_revenue', requiredPlan: 'commander' as const },
      { feature: 'cohort_analysis', requiredPlan: 'commander' as const },
      { feature: 'growth_opportunities', requiredPlan: 'commander' as const },
      { feature: 'custom_ai_queries', requiredPlan: 'commander' as const },
      { feature: 'executive_report', requiredPlan: 'commander' as const },
    ],
    usage: { used: 0, limit: 0, remaining: 0 },
    cached: false,
    ...overrides,
  }
}

describe('analytics defensive model helpers used by UI', () => {
  it('KPI sparklines stay safe with 0, 1, and 2 points', () => {
    // No rows → no sparkline at all (never a fabricated zero run).
    expect(analyticsKpis(emptySnapshot, null)[0]?.sparkline).toEqual([])
    // With sales, the sparkline is the continuous 28-day window ending today,
    // with explicit 0 on missing days — sparse rows must still surface their
    // real revenue and never introduce NaN.
    const one = analyticsKpis({
      ...emptySnapshot,
      revenue: [{ storeId: 's', day: '2026-08-16', grossRevenue: 10, discounts: 0, orderCount: 1 }],
      orders: [{ storeId: 's', day: '2026-08-16', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 10 }],
    }, null)[0]?.sparkline ?? []
    expect(one).toHaveLength(28)
    expect(one).toContain(10)
    expect(one.every(Number.isFinite)).toBe(true)
    const two = analyticsKpis(twoOrderSnapshot, null)[0]?.sparkline ?? []
    expect(two).toHaveLength(28)
    expect(two).toContain(100)
    expect(two).toContain(50)
    expect(two.every(Number.isFinite)).toBe(true)
  })
})

describe('analytics page low-data rendering', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  async function mount(snapshot: AnalyticsSnapshot | null, insights: ReturnType<typeof insightsFixture> | null) {
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
      value: () => ({
        matches: false,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false },
      }),
    })

    vi.doMock('./api.js', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./api.js')
      return {
        ...actual,
        fetchAnalyticsInsights: async () => {
          if (!insights) throw new Error('insights unavailable')
          return insights
        },
      }
    })

    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const { AnalyticsPage } = await import('./analytics.js')

    class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null }
      static getDerivedStateFromError(error: Error) { return { error } }
      componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('PAGE_CRASH', error.message, info.componentStack)
      }
      render() {
        return this.state.error
          ? createElement('div', { 'data-page-error': this.state.error.message })
          : this.props.children
      }
    }

    const container = dom.window.document.getElementById('root')
    if (!container) throw new Error('missing root')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Boundary, null, createElement(AppProvider, { i18n: enTranslations as never },
        createElement(AnalyticsPage as never, {
          context: { storeId: 's', shop: 'test.myshopify.com' },
          snapshot,
          onSync: async () => {},
          onNavigateBilling: () => {},
        }),
      )))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
    return { dom, container }
  }

  it('renders without black-screen crash for 0 orders', async () => {
    const { dom, container } = await mount(emptySnapshot, insightsFixture({ salesHistoryDays: 0 }))
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.querySelector('.analytics-page')).not.toBeNull()
    expect(container.querySelectorAll('.analytics-kpi')).toHaveLength(6)
    expect(container.textContent).toContain('Your revenue story starts here')
    expect(container.textContent).not.toContain('NaN')
    dom.window.close()
  })

  it('renders a 2-order test store with KPI cards and empty states', async () => {
    const { dom, container } = await mount(twoOrderSnapshot, insightsFixture({
      salesHistoryDays: 2,
      weekdays: [
        { day: 'Mon', revenue: 0 }, { day: 'Tue', revenue: 100 }, { day: 'Wed', revenue: 0 },
        { day: 'Thu', revenue: 0 }, { day: 'Fri', revenue: 50 }, { day: 'Sat', revenue: 0 }, { day: 'Sun', revenue: 0 },
      ],
      topProducts: [{ productId: 'p1', name: 'Tee', image: null, units: 1, revenue: 50, share: 100, trend: 'flat' }],
    }))
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.querySelector('.analytics-page')).not.toBeNull()
    expect(container.querySelectorAll('.analytics-kpi')).toHaveLength(6)
    expect(container.textContent).toContain('Total Revenue')
    expect(container.textContent).toContain('Top Products')
    expect(container.textContent).toContain('Tee')
    expect(container.textContent).toContain('Sync order times to see busiest hours')
    expect(container.textContent).toContain('ANOMALY DETECTION')
    expect(container.textContent).not.toContain('NaN%')
    expect(container.textContent).not.toContain('NaN')
    dom.window.close()
  })

  it('reports the discount waterfall and stock-out risk from synced data only', async () => {
    const { dom, container } = await mount(twoOrderSnapshot, insightsFixture({
      categories: [{ name: 'Apparel', revenue: 150, units: 2 }],
    }))
    expect(container.querySelector('[data-page-error]')).toBeNull()
    // Discount leakage is measured from the synced revenue rows: this fixture
    // records no discounts, so the card says so instead of drawing a curve.
    expect(container.textContent).toContain('Discount & revenue leakage')
    expect(container.textContent).toContain('Merchandise value')
    expect(container.textContent).toContain('No discount leakage in this period')
    expect(container.textContent).toContain('$150.00')
    // Inventory is not synced in this fixture, so the risk card stays honest.
    expect(container.textContent).toContain('Stock-out risk & cover')
    expect(container.textContent).toContain('Protect your bestsellers')
    dom.window.close()
  })

  it('keeps the page alive when insights fetch fails', async () => {
    const { dom, container } = await mount(twoOrderSnapshot, null)
    expect(container.querySelector('[data-page-error]')).toBeNull()
    expect(container.querySelector('.analytics-page')).not.toBeNull()
    expect(container.querySelectorAll('.analytics-kpi')).toHaveLength(6)
    dom.window.close()
  })

  it('ships section error boundaries in the analytics module', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./analytics.tsx', import.meta.url), 'utf8')
    expect(source).toContain('AnalyticsSectionBoundary')
    expect(source).toContain('getDerivedStateFromError')
    expect(source).toContain('componentDidCatch')
    expect(source).toContain('data.length >= 2')
    expect(source).toContain('100% OF CATEGORY REVENUE')
    expect(source).toContain('Hourly demand needs timestamps')
    expect(source).not.toContain('<Sparkles')
  })
})

describe('world-class analytics composition', () => {
  it('ships every analytics row as a composable component with rich empty states', async () => {
    const source = await (await import('node:fs/promises')).readFile(new URL('./analytics.tsx', import.meta.url), 'utf8')
    for (const component of [
      'AnalyticsHero', 'RevenueTrendChart', 'OrdersAOVCorrelation', 'SalesByChannel',
      'CategoryDistribution', 'AIIntelligence', 'CohortAnalysis', 'GeographicDistribution',
      'ProductPerformance', 'TemporalPatterns', 'ConversionFunnel', 'Benchmarks', 'CustomAIQuery',
    ]) expect(source).toContain(`function ${component}`)
    expect(source).toContain('RichEmpty')
    expect(source).toContain('Custom')
    expect(source).toContain('Brain')
    expect(source).not.toContain('No data')
  })
})

describe('analytics sort-dropdown regression contract', () => {
  it('restores selected sort labels on list pages (no compact triggerLabel)', async () => {
    const fs = await import('node:fs/promises')
    for (const file of ['inventory.tsx', 'products.tsx', 'orders.tsx', 'customers.tsx'] as const) {
      const source = await fs.readFile(new URL(`./${file}`, import.meta.url), 'utf8')
      // The sort control must not collapse to a compact "Sort" trigger; it
      // keeps the shared CustomSelect with a sort label prefix and always
      // renders the selected option label (inventory/customers use the
      // "Sort by" prefix, products/orders use "Sort").
      expect(source).not.toContain('triggerLabel="Sort"')
      expect(source).toContain('label="Sort')
    }
  })
})

describe('analytics static empty markup smoke', () => {
  it('renders empty KPI change copy without NaN via model formatting contract', () => {
    const kpis = analyticsKpis(emptySnapshot, null)
    const html = kpis.map((kpi) => {
      const change = kpi.change
      const changeText = change === null || !Number.isFinite(change)
        ? 'Comparison awaits prior-period data'
        : `${Math.abs(change).toFixed(1)}%`
      return `<div>${kpi.label}:${kpi.value === null ? '—' : kpi.value}:${changeText}</div>`
    }).join('')
    expect(html).not.toContain('NaN')
    expect(renderWithAppProvider(createElement('div', { dangerouslySetInnerHTML: { __html: html } }))).toContain('—')
  })
})
