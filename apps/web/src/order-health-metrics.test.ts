import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OrderHealthInsight } from './orders.js'
import { insightByFeature } from './orders-model.js'
import type { OrderInsightsResult } from './orders-model.js'

const result: OrderInsightsResult = {
  plan: 'growth',
  planLabel: 'Growth',
  planBadge: 'GROWTH',
  sufficientData: true,
  orderCount: 6,
  available: [{ feature: 'order_health_score', name: 'Order Health', data: { status: 'available', score: 80, grade: 'A', tone: 'healthy', fulfilledRate: 0, cancelledRate: 0, paidRate: 100 } }],
  locked: [],
  usage: { feature: 'orders_ai_insights_day', used: 0, limit: null, remaining: null, limitReached: false },
  cached: false,
}
const insight = () => insightByFeature(result, 'order_health_score')
const orders = [
  { id: 'o1', orderNumber: '#1001', createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-12T10:00:00Z', customer: { name: 'A' }, lineItems: [], status: 'completed', paymentStatus: 'paid', totalPrice: 100, currency: 'USD' },
  { id: 'o2', orderNumber: '#1002', createdAt: '2026-08-09T10:00:00Z', updatedAt: '2026-08-11T10:00:00Z', customer: { name: 'B' }, lineItems: [], status: 'completed', paymentStatus: 'paid', totalPrice: 200, currency: 'USD' },
  { id: 'o3', orderNumber: '#1003', createdAt: '2026-08-08T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z', customer: { name: 'A' }, lineItems: [], status: 'completed', paymentStatus: 'paid', totalPrice: 150, currency: 'USD' },
] as never

describe('Order Health metrics — vertical stacked layout', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), 'orders.css')
  const css = readFileSync(root, 'utf8')

  it('stacks the three metrics vertically instead of one row', () => {
    const rule = (css.split('.order-health-metrics')[1] ?? '').split('}')[0]
    expect(rule).toContain('flex-direction: column')
    expect(rule).not.toContain('repeat(3, 1fr)')
  })

  it('stretches metric rows to fill the full card height', () => {
    expect(css).toContain('.order-health-metrics { flex: 1;')
    expect(css).toContain('.order-health-metric { flex: 1;')
  })

  it('renders metrics in the order Avg Order Value → Revenue → Repeat Buyers', () => {
    const html = renderToStaticMarkup(createElement(OrderHealthInsight, { insight: insight(), totalOrders: 6, orders }))
    const aov = html.indexOf('Avg Order Value')
    const revenue = html.indexOf('Revenue at Risk')
    const repeat = html.indexOf('Repeat Buyers')
    expect(aov).toBeGreaterThan(-1)
    expect(revenue).toBeGreaterThan(aov)
    expect(repeat).toBeGreaterThan(revenue)
  })

  it('uses the enlarged metric sizing (38px icon, 17px value)', () => {
    expect(css).toContain('.order-health-metric-icon { width: 38px; height: 38px;')
    expect(css).toContain('.order-health-metric-body strong { color: var(--text); font-family: var(--font-mono); font-size: 17px;')
    // The later PR #38 typography overrides must stay in sync with the new sizes.
    expect(css).toContain('.order-health-metric-icon { width: 38px !important; height: 38px !important; }')
    expect(css).toContain('.order-health-metric-body strong { font-size: 17px !important; }')
  })
})
