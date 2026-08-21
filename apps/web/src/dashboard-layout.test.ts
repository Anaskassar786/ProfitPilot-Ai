import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DashboardLayout } from './dashboard.js'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }

/** main.tsx wraps every page in Polaris AppProvider (i18n) — mirror it here so
 *  components using the Polaris Button shim render outside an app shell. */
function renderWithAppProvider(element: import('react').ReactElement) {
  return renderToStaticMarkup(createElement(AppProvider, { i18n: enTranslations as never }, element))
}


const noop = async () => {}

const snapshot = {
  revenue: [
    { storeId: 's1', day: '2026-08-04', grossRevenue: 1434, discounts: 40, orderCount: 1 },
  ],
  orders: [
    { storeId: 's1', day: '2026-08-04', orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 1434 },
  ],
  productSales: [
    { storeId: 's1', day: '2026-08-04', productId: 'p1', unitsSold: 1, grossRevenue: 1434 },
  ],
  customerCohorts: [],
}

const catalog = [{ productId: 'p1', payload: { title: 'Snowboard', product_type: 'snowboard' } }]

function render(overrides: Partial<Parameters<typeof DashboardLayout>[0]> = {}): string {
  return renderWithAppProvider(
    createElement(DashboardLayout, {
      data: { analytics: snapshot as never, catalog, loadState: 'ready' as const },
      onSync: noop,
      onSyncAll: noop,
      syncAllRunning: false,
      onNavigate: () => {},
      storeName: 'demo-store',
      storeId: 's1',
      ...overrides,
    }),
  )
}

describe('dashboard layout (PR #23)', () => {
  it('renders the calendar as a compact widget inside row 2', () => {
    const html = render()
    expect(html).toContain('chart-cal-health-row')
    expect(html).toContain('calendar-card-compact')
    expect(html).toContain('calendar-compact')
    // Row 2 holds exactly three widgets: chart, calendar, health
    const row = html.slice(html.indexOf('chart-cal-health-row'), html.indexOf('three-col-row'))
    expect(row).toContain('revenue-chart-card')
    expect(row).toContain('calendar-card-compact')
    expect(row).toContain('health-card-compact')
  })

  it('removes the old full-width row 4 calendar block', () => {
    const html = render()
    expect(html).not.toContain('calendar-row')
    expect(html).not.toContain('"dash-card calendar-card"')
    expect(html).not.toContain('calendar-heatmap')
  })

  it('shows month navigation and the month revenue total under the grid', () => {
    const html = render()
    expect(html).toContain('aria-label="Previous month"')
    expect(html).toContain('aria-label="Next month"')
    expect(html).toContain('cal-month-label')
    expect(html).toContain('cal-total-block')
    expect(html).toContain('Total revenue')
  })

  it('renders a single-category card instead of a one-slice donut', () => {
    const html = render()
    expect(html).toContain('single-category')
    expect(html).toContain('1 category active')
  })

  it('renders detailed order rows plus a sync CTA when orders are sparse', () => {
    const html = render()
    expect(html).toContain('orders-list sparse')
    expect(html).toContain('order-row detailed')
    expect(html).toContain('Sync more orders')
  })

  it('keeps the KPI row and the three-column row 3 intact', () => {
    const html = render()
    expect(html).toContain('kpi-row')
    expect(html).toContain('three-col-row')
    expect(html).toContain('ai-summary-card')
    expect(html).toContain('orders-card')
  })

  it('renders empty-state cards without throwing when there is no data', () => {
    const html = render({ data: { analytics: null, catalog: [], loadState: 'ready' } })
    expect(html).toContain('chart-cal-health-row')
    expect(html).toContain('calendar-card-compact')
    expect(html).toContain('No data yet')
  })
})
