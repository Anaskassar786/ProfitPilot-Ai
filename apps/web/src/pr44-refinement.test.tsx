import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DashboardLayout } from './dashboard.js'
import { CancellationRateCard, FulfillmentRateCard, OrderHealthInsight } from './orders.js'
import type { AnalyticsSnapshot } from './model.js'
import type { AvailableOrderInsight } from './orders-model.js'

const shell = (light: boolean, child: ReactNode) => <div className={light ? 'app-shell light-mode' : 'app-shell'}>{child}</div>
const insight = (feature: AvailableOrderInsight['feature'], data: Record<string, unknown>): AvailableOrderInsight => ({ feature, name: feature, data })
const orders = [
  { id: 'o1', orderNumber: '#1', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-03T12:00:00Z', status: 'completed', paymentStatus: 'paid', totalPrice: 100, currency: 'USD', lineItems: [{ productId: 'p1', quantity: 2, price: 50 }] },
] as never

const snapshot: AnalyticsSnapshot = {
  revenue: [{ storeId: 's1', day: '2026-08-01', grossRevenue: 185, discounts: 0, orderCount: 2 }],
  orders: [{ storeId: 's1', day: '2026-08-01', orderCount: 2, fulfilledCount: 0, cancelledCount: 0, averageOrderValue: 92.5 }],
  productSales: [
    { storeId: 's1', day: '2026-08-01', productId: 'p1', unitsSold: 2, grossRevenue: 100 },
    { storeId: 's1', day: '2026-08-01', productId: 'p2', unitsSold: 1, grossRevenue: 85 },
  ],
  customerCohorts: [],
}
const catalog = [
  { productId: 'p1', payload: { title: 'Board', product_type: 'snowboard' } },
  { productId: 'p2', payload: { title: 'Goggles', product_type: 'accessories' } },
]

describe('PR #44 professional refinement', () => {
  it.each([false, true])('renders sibling full-width detail rows in %s theme', (light) => {
    const cancel = renderToStaticMarkup(shell(light, <CancellationRateCard insight={insight('cancellation_rate', { status: 'available', canceled: 0, total: 6, rate: 0 })} orders={orders} />))
    const fulfill = renderToStaticMarkup(shell(light, <FulfillmentRateCard insight={insight('fulfillment_rate', { status: 'available', fulfilled: 0, total: 6, rate: 0 })} orders={orders} />))
    for (const html of [cancel, fulfill]) {
      expect(html.match(/rate-detail-row/g)).toHaveLength(2)
      expect(html).toContain('rate-detail-label')
      expect(html).not.toContain('rate-mini-stat')
    }
    expect(cancel).toContain('Refunded')
    expect(cancel).toContain('vs Last Period')
    expect(fulfill).toContain('6 orders')
    expect(fulfill).toContain('Avg Fulfill Time')
  })

  it.each([false, true])('renders Order Health without a circular gauge in %s theme', (light) => {
    const html = renderToStaticMarkup(shell(light, <OrderHealthInsight totalOrders={6} insight={insight('order_health_score', { status: 'available', score: 80, grade: 'A', tone: 'healthy', fulfilledRate: 0, cancelledRate: 0, paidRate: 100 })} />))
    for (const contract of ['order-health-score', '80', '/100', 'Excellent', 'order-health-scale-track', 'Poor', 'Fair', 'Good', 'order-health-sliders', '6 orders paid, awaiting fulfillment']) expect(html).toContain(contract)
    expect(html).not.toContain('health-gauge')
    expect(html).not.toContain('conic-gradient')
  })

  it.each([false, true])('replaces duplicate category bars with real breakdown fields in %s theme', (light) => {
    const html = renderToStaticMarkup(shell(light, <DashboardLayout data={{ analytics: snapshot, catalog, loadState: 'ready' }} onSync={async () => {}} onSyncAll={async () => {}} syncAllRunning={false} onNavigate={() => {}} storeName="Shop" storeId={null} />))
    for (const contract of ['Category Breakdown', 'category-breakdown-row', 'snowboard', '1 product', '2 sold', 'accessories', '1 sold', 'View Category Report', 'Explore Products by Category']) expect(html).toContain(contract)
    expect(html).not.toContain('category-compare')
  })
})
