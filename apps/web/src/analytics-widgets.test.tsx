import './jsdom-polaris-setup.js'
/**
 * Contracts for the rebuilt Analytics widgets: revenue pacing (momentum),
 * discount leakage, and stock-out risk. Every assertion checks that the widget
 * reports measured Shopify data and stays silent where a source is missing.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppProvider } from '@shopify/polaris'
import type { ReactNode } from 'react'
import { periodTrend } from './analytics-model.js'
import { revenueLeakage, revenuePacing, stockRisk } from './analytics-widgets-model.js'
import { DiscountLeakage, RevenueTrendChart, StockoutRisk } from './analytics.js'
import { EMPTY_INVENTORY_PAGE } from './inventory-model.js'
import type { InventoryPageResult, InventoryRowItem } from './inventory-model.js'
import type { AnalyticsSnapshot } from './model.js'
import type { TrendPoint } from './analytics-model.js'

/** Polaris Button/Banner read the i18n context; provide a minimal AppProvider. */
const polaris = (node: ReactNode) => <AppProvider i18n={{}}>{node}</AppProvider>

const day = (offset: number) => { const date = new Date('2026-08-19T00:00:00Z'); date.setUTCDate(date.getUTCDate() - offset); return date.toISOString().slice(0, 10) }

function snapshotWith(rows: readonly Readonly<{ day: string; grossRevenue: number; discounts: number; orderCount: number; cancelled?: number }>[]): AnalyticsSnapshot {
  return {
    revenue: rows.map((row) => ({ storeId: 's1', day: row.day, grossRevenue: row.grossRevenue, discounts: row.discounts, orderCount: row.orderCount })),
    orders: rows.map((row) => ({ storeId: 's1', day: row.day, orderCount: row.orderCount, fulfilledCount: row.orderCount - (row.cancelled ?? 0), cancelledCount: row.cancelled ?? 0, averageOrderValue: row.orderCount ? row.grossRevenue / row.orderCount : 0 })),
    productSales: [],
    customerCohorts: [],
  }
}

const point = (values: Partial<TrendPoint> & { day: string }): TrendPoint => ({ day: values.day, revenue: values.revenue ?? 0, orders: values.orders ?? 0, aov: values.aov ?? 0, previous: values.previous ?? null, forecast: values.forecast ?? null, lower: values.lower ?? null, upper: values.upper ?? null })

describe('revenuePacing', () => {
  it('accumulates banked revenue, the previous-period pace and the forecast tail', () => {
    const trend: readonly TrendPoint[] = [
      point({ day: day(3), revenue: 100, previous: 80 }),
      point({ day: day(2), revenue: 150, previous: 90 }),
      point({ day: day(1), revenue: 50, previous: 30 }),
      point({ day: day(0), revenue: 0, forecast: 120 }),
    ]
    const pacing = revenuePacing(trend)
    expect(pacing.total).toBe(300)
    expect(pacing.daysElapsed).toBe(3)
    expect(pacing.previousToDate).toBe(200)
    expect(pacing.pace).toBeCloseTo(50, 5)
    expect(pacing.runRate).toBe(100)
    expect(pacing.projectedClose).toBe(420)
    expect(pacing.peak).toEqual({ day: day(2), revenue: 150 })
    // Daily rows carry per-day values (not running totals), so zero-sale days drop to $0.
    expect(pacing.rows.at(-2)?.revenue).toBe(50)
    expect(pacing.rows.at(-2)?.previous).toBe(30)
    expect(pacing.rows.at(-1)?.revenue).toBe(0)
    expect(pacing.rows.at(-1)?.forecast).toBe(120)
  })

  it('keeps daily rows at $0 on zero-sale days so the momentum line drops', () => {
    const pacing = revenuePacing([
      point({ day: day(4), revenue: 200 }),
      point({ day: day(3), revenue: 0 }),
      point({ day: day(2), revenue: 0 }),
      point({ day: day(1), revenue: 120 }),
    ])
    expect(pacing.hasData).toBe(true)
    expect(pacing.rows.map((row) => row.revenue)).toEqual([200, 0, 0, 120])
    expect(pacing.total).toBe(320)
  })

  it('reports no pace when the previous period has no comparable revenue', () => {
    const pacing = revenuePacing([point({ day: day(1), revenue: 40 }), point({ day: day(0), revenue: 60 })])
    expect(pacing.pace).toBeNull()
    expect(pacing.previousToDate).toBeNull()
    expect(pacing.projectedClose).toBeNull()
    expect(pacing.hasData).toBe(true)
  })

  it('stays empty when nothing is synced', () => {
    expect(revenuePacing([]).hasData).toBe(false)
    expect(revenuePacing([point({ day: day(0) })]).hasData).toBe(false)
  })
})

describe('revenueLeakage', () => {
  const rows = [
    { day: day(2), grossRevenue: 900, discounts: 100, orderCount: 10, cancelled: 1 },
    { day: day(1), grossRevenue: 400, discounts: 0, orderCount: 5 },
  ]

  it('rebuilds the discount waterfall from synced revenue rows', () => {
    const data = revenueLeakage(snapshotWith(rows), [day(2), day(1)])
    expect(data.collected).toBe(1300)
    expect(data.discounts).toBe(100)
    expect(data.merchandiseValue).toBe(1400)
    expect(data.discountRate).toBeCloseTo(7.142857, 4)
    expect(data.discountDays).toBe(1)
    expect(data.heaviestDay?.day).toBe(day(2))
    expect(data.onePointValue).toBeCloseTo(14, 6)
    expect(data.orders).toBe(15)
    expect(data.cancelledOrders).toBe(1)
    expect(data.cancelRate).toBeCloseTo(6.6667, 3)
  })

  it('only counts the days currently in scope', () => {
    const data = revenueLeakage(snapshotWith(rows), [day(1)])
    expect(data.collected).toBe(400)
    expect(data.discounts).toBe(0)
    expect(data.discountRate).toBe(0)
    expect(data.rows).toHaveLength(1)
  })

  it('returns an honest empty result without a snapshot', () => {
    const data = revenueLeakage(null, [day(1)])
    expect(data.hasData).toBe(false)
    expect(data.discountRate).toBeNull()
  })
})

function item(values: Partial<InventoryRowItem> & { variantId: string }): InventoryRowItem {
  return {
    variantId: values.variantId,
    productId: values.productId ?? `p-${values.variantId}`,
    inventoryItemId: null,
    title: values.title ?? 'Product',
    variantTitle: values.variantTitle ?? null,
    sku: values.sku ?? null,
    category: null,
    vendor: null,
    productStatus: 'active',
    imageUrl: null,
    price: values.price ?? null,
    currency: 'USD',
    quantity: values.quantity ?? null,
    quantitySource: 'inventory_levels',
    tracked: values.tracked ?? true,
    inventoryPolicy: 'deny',
    status: values.status ?? 'in_stock',
    value: null,
    locations: [],
    updatedAt: null,
    syncedAt: '2026-08-19T00:00:00Z',
    daysOfCover: values.daysOfCover ?? { status: 'insufficient_data', reason: 'no_sales', message: 'No sales yet' },
  }
}

describe('stockRisk', () => {
  const page: InventoryPageResult = {
    ...EMPTY_INVENTORY_PAGE,
    items: [
      item({ variantId: 'v1', title: 'Snowboard', status: 'out', quantity: 0, price: 500, daysOfCover: { status: 'available', days: 0, velocity: 2 } }),
      item({ variantId: 'v2', title: 'Boots', status: 'low', quantity: 6, price: 100, daysOfCover: { status: 'available', days: 10, velocity: 0.6 } }),
      item({ variantId: 'v3', title: 'Helmet', status: 'in_stock', quantity: 90, price: 60, daysOfCover: { status: 'available', days: 90, velocity: 1 } }),
    ],
    distribution: { healthy: 1, low: 1, out: 1, untracked: 2 },
    stats: { ...EMPTY_INVENTORY_PAGE.stats, trackedSkus: 3, untrackedSkus: 2, currency: 'USD' },
  }

  it('ranks the SKUs closest to running out and prices the exposure', () => {
    const risk = stockRisk(page)
    expect(risk.items.map((row) => row.variantId)).toEqual(['v1', 'v2', 'v3'])
    expect(risk.coverAvailable).toBe(true)
    expect(risk.urgentCount).toBe(2)
    // 30 days of demand at 2 units/day × $500 for the out-of-stock snowboard.
    expect(risk.items[0]?.exposure).toBe(30000)
    // Boots have 10 days of cover left, so only 20 days × 0.6 × $100 is at risk.
    expect(risk.items[1]?.exposure).toBeCloseTo(1200, 6)
    expect(risk.exposure).toBeCloseTo(31200, 6)
    expect(risk.untrackedCount).toBe(2)
  })

  it('never invents a runway when days of cover is plan-locked', () => {
    const locked = stockRisk({ ...page, items: [item({ variantId: 'v9', status: 'low', quantity: 3, price: 20, daysOfCover: { status: 'locked', required_plan: 'growth' } })] })
    expect(locked.coverAvailable).toBe(false)
    expect(locked.coverLocked).toBe(true)
    expect(locked.items[0]?.days).toBeNull()
    expect(locked.items[0]?.exposure).toBeNull()
    expect(locked.explanation).toContain('Growth feature')
  })

  it('is never plan-locked for Commander even when cover is short on data', () => {
    const commander = stockRisk({
      ...page,
      plan: 'commander',
      items: [item({ variantId: 'v1', title: 'Snowboard', status: 'low', quantity: 3, price: 20, daysOfCover: { status: 'insufficient_data', reason: 'sales_history', message: 'Awaiting more sales history.' } })],
      stats: { ...page.stats, trackedSkus: 1, untrackedSkus: 0, totalSkus: 1 },
    })
    expect(commander.coverAvailable).toBe(false)
    expect(commander.coverLocked).toBe(false)
    expect(commander.coverNote).toContain('Awaiting sales history')
  })

  it('flags an all-untracked store so the UI can skip the zero grid', () => {
    const untracked = stockRisk({
      ...page,
      items: [item({ variantId: 'u1', title: 'Mug', tracked: false, status: 'untracked', quantity: null, daysOfCover: { status: 'insufficient_data', reason: 'no_stock_signal', message: 'Shopify returned no tracked quantity for this variant.' } })],
      distribution: { healthy: 0, low: 0, out: 0, untracked: 27 },
      stats: { ...page.stats, totalSkus: 27, trackedSkus: 0, untrackedSkus: 27 },
    })
    expect(untracked.hasInventory).toBe(true)
    expect(untracked.allUntracked).toBe(true)
    expect(untracked.untrackedCount).toBe(27)
    expect(untracked.trackedCount).toBe(0)
    // Mixed stores (some tracked, some not) must NOT show the all-untracked state.
    const mixed = stockRisk({ ...page, stats: { ...page.stats, totalSkus: 27, trackedSkus: 3, untrackedSkus: 24 } })
    expect(mixed.allUntracked).toBe(false)
  })

  it('is empty when inventory has never synced', () => {
    const empty = stockRisk(null)
    expect(empty.hasInventory).toBe(false)
    expect(empty.exposure).toBeNull()
  })
})

describe('rebuilt analytics widgets render measured data', () => {
  const revenue = Array.from({ length: 20 }, (_, index) => ({ day: day(19 - index), grossRevenue: 500 + index * 10, discounts: index % 4 === 0 ? 40 : 0, orderCount: 4, cancelled: index === 5 ? 1 : 0 }))
  const snapshot = snapshotWith(revenue)
  const trend = periodTrend(snapshot, 30, null)

  it('renders revenue momentum as a pacing narrative with the legacy summary contract', () => {
    const html = renderToStaticMarkup(polaris(<RevenueTrendChart trend={trend} period={30} setPeriod={() => {}} />))
    for (const contract of ['revenue-trend', 'chart-summary', 'Total', 'Average / day', 'Peak Day', 'Growth', 'Current', 'Previous', 'AI forecast', 'banked', 'run rate of']) {
      expect(html).toContain(contract)
    }
    expect(html).not.toContain('NaN')
    const summary = html.slice(html.indexOf('chart-summary'), html.indexOf('insight-strip'))
    expect(summary).not.toContain('<i')
  })

  it('renders the discount waterfall with real totals', () => {
    const html = renderToStaticMarkup(<DiscountLeakage snapshot={snapshot} trend={trend} />)
    expect(html).toContain('Discount &amp; revenue leakage')
    expect(html).toContain('Merchandise value')
    expect(html).toContain('discount rate')
    expect(html).toContain('cancelled of')
    expect(html).not.toContain('NaN')
  })

  it('renders stock-out risk from inventory rows and stays empty without them', () => {
    const page: InventoryPageResult = {
      ...EMPTY_INVENTORY_PAGE,
      items: [item({ variantId: 'v1', title: 'Snowboard', status: 'out', quantity: 0, price: 500, daysOfCover: { status: 'available', days: 0, velocity: 2 } })],
      distribution: { healthy: 0, low: 0, out: 1, untracked: 0 },
    }
    const html = renderToStaticMarkup(<StockoutRisk inventory={page} loading={false} onUpgrade={() => {}} />)
    expect(html).toContain('Stock-out risk &amp; cover')
    expect(html).toContain('30-day exposure')
    expect(html).toContain('Snowboard')
    expect(html).not.toContain('NaN')

    const empty = renderToStaticMarkup(<StockoutRisk inventory={null} loading={false} onUpgrade={() => {}} />)
    expect(empty).toContain('Protect your bestsellers')
  })

  it('never shows the Upgrade CTA on Commander when cover is merely short on data', () => {
    const commander: InventoryPageResult = {
      ...EMPTY_INVENTORY_PAGE,
      plan: 'commander',
      items: [item({ variantId: 'v1', title: 'Snowboard', status: 'low', quantity: 3, price: 20, daysOfCover: { status: 'insufficient_data', reason: 'sales_history', message: 'Awaiting more sales history.' } })],
      distribution: { healthy: 0, low: 1, out: 0, untracked: 0 },
      stats: { ...EMPTY_INVENTORY_PAGE.stats, totalSkus: 1, trackedSkus: 1, untrackedSkus: 0, lowStockCount: 1 },
    }
    const html = renderToStaticMarkup(<StockoutRisk inventory={commander} loading={false} onUpgrade={() => {}} />)
    expect(html).not.toContain('Upgrade')
    expect(html).not.toContain('risk-note">') // no locked/upsell note (no lock icon + CTA)
    expect(html).toContain('risk-note info')
    expect(html).toContain('Awaiting sales history')
  })

  it('keeps the Upgrade CTA only for a plan that genuinely locks days of cover', () => {
    const trial: InventoryPageResult = {
      ...EMPTY_INVENTORY_PAGE,
      plan: 'trial',
      items: [item({ variantId: 'v1', title: 'Snowboard', status: 'low', quantity: 3, price: 20, daysOfCover: { status: 'locked', required_plan: 'growth' } })],
      distribution: { healthy: 0, low: 1, out: 0, untracked: 0 },
      stats: { ...EMPTY_INVENTORY_PAGE.stats, totalSkus: 1, trackedSkus: 1, untrackedSkus: 0, lowStockCount: 1 },
    }
    const html = renderToStaticMarkup(polaris(<StockoutRisk inventory={trial} loading={false} onUpgrade={() => {}} />))
    expect(html).toContain('Upgrade')
    expect(html).toContain('Growth feature')
  })

  it('shows an "Inventory tracking is disabled" banner instead of a grid of zeros', () => {
    const untracked: InventoryPageResult = {
      ...EMPTY_INVENTORY_PAGE,
      plan: 'commander',
      items: [item({ variantId: 'u1', title: 'Mug', tracked: false, status: 'untracked', quantity: null, daysOfCover: { status: 'insufficient_data', reason: 'no_stock_signal', message: 'Shopify returned no tracked quantity for this variant.' } })],
      distribution: { healthy: 0, low: 0, out: 0, untracked: 27 },
      stats: { ...EMPTY_INVENTORY_PAGE.stats, totalSkus: 27, trackedSkus: 0, untrackedSkus: 27 },
    }
    const html = renderToStaticMarkup(polaris(<StockoutRisk inventory={untracked} loading={false} onUpgrade={() => {}} />))
    expect(html).toContain('Inventory tracking is disabled')
    expect(html).toContain('Enable ‘Track quantity’ in your Shopify admin')
    expect(html).toContain('Tracking disabled')
    expect(html).not.toContain('All SKUs covered')
    // No fake zero grid, no summary, no upsell CTA.
    expect(html).not.toContain('chart-summary')
    expect(html).not.toContain('Out of stock')
    expect(html).not.toContain('Upgrade')
  })
})
