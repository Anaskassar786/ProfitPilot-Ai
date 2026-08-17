/**
 * PR #43 professional-polish QA — renders the four enhanced cards
 * (Cancellation Rate, Fulfillment Rate, Revenue Momentum, Inventory Health)
 * with realistic real-data fixtures in dark and light shells and verifies the
 * premium structure: single-metric donut centers, below-card real metrics,
 * status bars, the Revenue Momentum summary row, and the Inventory Health
 * trend + critical items. No fake numbers are asserted anywhere — every
 * contract below is derived from the supplied fixtures.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { periodTrend } from './analytics-model.js'
import { RevenueTrendChart } from './analytics.js'
import { InventoryHealthCard } from './inventory.js'
import { CancellationRateCard, FulfillmentRateCard } from './orders.js'
import type { AvailableOrderInsight } from './orders-model.js'
import { EMPTY_INVENTORY_PAGE } from './inventory-model.js'
import type { InventoryPageResult } from './inventory-model.js'
import type { AnalyticsSnapshot } from './model.js'

const shell = (light: boolean, children: unknown) => <div className={appShellClass(light)}>{children as never}</div>
function appShellClass(light: boolean): string { return light ? 'app-shell light-mode' : 'app-shell' }

// Latest order: 2026-08-14. Refunds in the trailing 30 days (o3, o4) total
// $409.00; the 30 days before that (o5) total $60.00 → "↑ 581%" vs last period.
const realOrders = [
  { id: 'o1', orderNumber: '#1001', createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-12T10:00:00Z', status: 'completed', paymentStatus: 'paid', totalPrice: 1589, currency: 'USD', lineItems: [] },
  { id: 'o2', orderNumber: '#1002', createdAt: '2026-08-08T09:00:00Z', updatedAt: '2026-08-10T09:00:00Z', status: 'completed', paymentStatus: 'paid', totalPrice: 649.99, currency: 'USD', lineItems: [] },
  { id: 'o3', orderNumber: '#1003', createdAt: '2026-08-05T12:00:00Z', updatedAt: '2026-08-06T12:00:00Z', status: 'canceled', paymentStatus: 'refunded', totalPrice: 289, currency: 'USD', lineItems: [] },
  { id: 'o4', orderNumber: '#1004', createdAt: '2026-07-15T11:00:00Z', updatedAt: '2026-07-15T12:00:00Z', status: 'canceled', paymentStatus: 'refunded', totalPrice: 120, currency: 'USD', lineItems: [] },
  { id: 'o5', orderNumber: '#1005', createdAt: '2026-07-10T11:00:00Z', updatedAt: '2026-07-11T11:00:00Z', status: 'canceled', paymentStatus: 'refunded', totalPrice: 60, currency: 'USD', lineItems: [] },
  { id: 'o6', orderNumber: '#1006', createdAt: '2026-08-12T11:00:00Z', updatedAt: '2026-08-14T11:00:00Z', status: 'completed', paymentStatus: 'paid', totalPrice: 999, currency: 'USD', lineItems: [] },
]

const cancellation = (canceled: number, total: number): AvailableOrderInsight => ({ feature: 'cancellation_rate', name: 'Cancellation Rate', data: { status: 'available', canceled, total, rate: total > 0 ? (canceled / total) * 100 : null } })
const fulfillment = (fulfilled: number, total: number): AvailableOrderInsight => ({ feature: 'fulfillment_rate', name: 'Fulfillment Rate', data: { status: 'available', fulfilled, total, rate: total > 0 ? (fulfilled / total) * 100 : null, basis: 'Shopify fulfillment status' } })

describe('PR #43 professional polish (both themes)', () => {
  it('Cancellation card: clean single-metric donut, real refund metrics and status bar', () => {
    const dark = renderToStaticMarkup(shell(false, <CancellationRateCard insight={cancellation(0, 6)} orders={realOrders as never} />))
    for (const contract of ['Cancellation Rate', 'rate-donut', '0%', 'Cancelled', '0 of 6 orders cancelled', 'rate-divider', 'Refunded', '$469.00', 'vs Last Period', '↑ 582%', 'rate-status-bar good', 'Excellent — no cancellations this period']) {
      expect(dark).toContain(contract)
    }
    // No overlapping side numbers — the old three-box facts row is gone.
    expect(dark).not.toContain('total orders')
    expect(dark).not.toContain('rate-facts')
    const light = renderToStaticMarkup(shell(true, <CancellationRateCard insight={cancellation(0, 6)} orders={realOrders as never} />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('rate-status-bar good')
  })

  it('Cancellation card: healthy, monitor and high thresholds map to the right status bars', () => {
    const healthy = renderToStaticMarkup(createElement(CancellationRateCard, { insight: cancellation(1, 100) }))
    expect(healthy).toContain('Healthy cancellation rate')
    expect(healthy).toContain('rate-status-bar good')
    const monitor = renderToStaticMarkup(createElement(CancellationRateCard, { insight: cancellation(4, 100) }))
    expect(monitor).toContain('Monitor cancellation trends')
    expect(monitor).toContain('rate-status-bar watch')
    const high = renderToStaticMarkup(createElement(CancellationRateCard, { insight: cancellation(12, 100) }))
    expect(high).toContain('High cancellation rate — review orders')
    expect(high).toContain('rate-status-bar attention')
  })

  it('Fulfillment card: donut matches Cancellation design, real pending count and avg fulfillment time', () => {
    const dark = renderToStaticMarkup(shell(false, <FulfillmentRateCard insight={fulfillment(3, 6)} orders={realOrders as never} />))
    for (const contract of ['Fulfillment Rate', 'rate-donut', '50%', 'Fulfilled', '3 of 6 orders fulfilled', 'rate-divider', 'Pending', '3 orders', 'Avg Fulfill Time', '2.0 days', 'rate-status-bar watch', 'Fulfillment in progress']) {
      expect(dark).toContain(contract)
    }
    const light = renderToStaticMarkup(shell(true, <FulfillmentRateCard insight={fulfillment(3, 6)} orders={realOrders as never} />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('rate-status-bar watch')
  })

  it('Fulfillment card: 100% and 0% states use the correct status bars', () => {
    const allDone = renderToStaticMarkup(createElement(FulfillmentRateCard, { insight: fulfillment(6, 6) }))
    expect(allDone).toContain('All orders fulfilled')
    expect(allDone).toContain('rate-status-bar good')
    const noneDone = renderToStaticMarkup(createElement(FulfillmentRateCard, { insight: fulfillment(0, 6) }))
    expect(noneDone).toContain('Attention — orders need fulfillment')
    expect(noneDone).toContain('rate-status-bar attention')
  })

  it('Revenue Momentum: summary row shows real totals, average, peak and growth; legend preserved', () => {
    const iso = (offset: number) => { const d = new Date(); d.setDate(d.getDate() - offset); return d.toISOString().slice(0, 10) }
    // Exactly 30 days of real sales: totals are computable and the previous
    // period is empty, so Growth honestly reads "—" with Baseline building.
    const revenue = Array.from({ length: 30 }, (_, i) => ({ storeId: 's1', day: iso(i), grossRevenue: 1000 + (i % 7) * 100, discounts: 0, orderCount: 5 }))
    const orders = revenue.map((r) => ({ storeId: 's1', day: r.day, orderCount: r.orderCount, fulfilledCount: r.orderCount, cancelledCount: 0, averageOrderValue: 200 }))
    const snapshot: AnalyticsSnapshot = { revenue, orders, productSales: [], customerCohorts: [] }
    const trend = periodTrend(snapshot, 30, null)
    const dark = renderToStaticMarkup(shell(false, <RevenueTrendChart trend={trend} period={30} setPeriod={() => {}} />))
    for (const contract of ['revenue-trend', 'chart-summary', 'Total', 'Average', 'Peak Day', 'Growth', 'Current', 'Previous', 'AI forecast', 'Baseline building']) {
      expect(dark).toContain(contract)
    }
    expect(dark).not.toContain('NaN')
    const light = renderToStaticMarkup(shell(true, <RevenueTrendChart trend={trend} period={30} setPeriod={() => {}} />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('chart-summary')
  })

  it('Inventory Health: real critical items list, trend placeholder and recommendation action', () => {
    const page: InventoryPageResult = {
      ...EMPTY_INVENTORY_PAGE,
      items: [
        { variantId: 'v1', productId: 'p1', inventoryItemId: 'i1', title: 'Burton Custom Snowboard', variantTitle: '158cm', sku: 'SNOW-158', category: 'Snowboards', vendor: 'Burton', productStatus: 'active', imageUrl: null, price: 649.99, currency: 'USD', quantity: 0, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'out', value: 0, locations: [], updatedAt: '2026-08-15T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available' as const, days: 0, velocity: 0 } },
        { variantId: 'v2', productId: 'p2', inventoryItemId: 'i2', title: 'Ride Boots Size 10', variantTitle: 'US 10', sku: 'BOOT-10', category: 'Footwear', vendor: 'Ride', productStatus: 'active', imageUrl: null, price: 289, currency: 'USD', quantity: 4, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'low', value: 1156, locations: [], updatedAt: '2026-08-14T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available' as const, days: 2, velocity: 0.2 } },
        { variantId: 'v3', productId: 'p3', inventoryItemId: 'i3', title: 'Oakley Flight Deck Goggles', variantTitle: 'One', sku: null, category: 'Accessories', vendor: 'Oakley', productStatus: 'active', imageUrl: null, price: 129, currency: 'USD', quantity: null, quantitySource: 'unavailable', tracked: false, inventoryPolicy: null, status: 'untracked', value: null, locations: [], updatedAt: null, syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'insufficient_data' as const, reason: 'no_stock_signal', message: 'No tracked quantity' } },
        { variantId: 'v4', productId: 'p4', inventoryItemId: 'i4', title: 'Healthy Helmet', variantTitle: 'M', sku: 'HELM-M', category: 'Protection', vendor: 'Smith', productStatus: 'active', imageUrl: null, price: 99, currency: 'USD', quantity: 24, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'in_stock', value: 2376, locations: [], updatedAt: '2026-08-13T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available' as const, days: 30, velocity: 0.8 } },
      ],
      health: { score: 73, grade: 'B', label: 'Good', tone: 'healthy' as const, components: [{ key: 'stock_coverage', label: 'Items in stock', score: 77, weight: 0.4, detail: '1 of 3 tracked items have stock' }], excluded: [] },
    }
    const dark = renderToStaticMarkup(shell(false, <InventoryHealthCard data={page} loading={false} />))
    for (const contract of ['Inventory Health', 'B', 'Health Score Trend (30d)', 'Building history…', 'Needs Attention', 'Burton Custom Snowboard', 'Out of stock', 'Ride Boots Size 10', '4', 'Oakley Flight Deck Goggles', 'Untracked', 'View All Recommendations →']) {
      expect(dark).toContain(contract)
    }
    // Only the three critical items appear; the healthy item stays out of the list.
    expect(dark).not.toContain('Healthy Helmet')
    const light = renderToStaticMarkup(shell(true, <InventoryHealthCard data={page} loading={false} />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('health-critical-list')
  })

  it('Inventory Health: shows an all-healthy state when nothing needs attention', () => {
    const page: InventoryPageResult = {
      ...EMPTY_INVENTORY_PAGE,
      items: [
        { variantId: 'v1', productId: 'p1', inventoryItemId: 'i1', title: 'Burton Custom Snowboard', variantTitle: '158cm', sku: 'SNOW-158', category: 'Snowboards', vendor: 'Burton', productStatus: 'active', imageUrl: null, price: 649.99, currency: 'USD', quantity: 24, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'in_stock', value: 15599.76, locations: [], updatedAt: '2026-08-15T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available' as const, days: 41, velocity: 0.6 } },
      ],
      health: { score: 90, grade: 'A', label: 'Excellent', tone: 'healthy' as const, components: [], excluded: [] },
    }
    const html = renderToStaticMarkup(createElement(InventoryHealthCard, { data: page, loading: false }))
    expect(html).toContain('All items healthy')
    expect(html).not.toContain('Out of stock')
  })
})
