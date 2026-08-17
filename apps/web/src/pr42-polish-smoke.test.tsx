/**
 * PR #42 final-polish smoke test — renders every affected surface with
 * realistic mock data in dark and light shells and asserts the premium
 * structure (empty-space fills, light-theme surfaces) is present.
 * Chart internals (recharts) render nothing under SSR, so contracts target
 * the surrounding markup, labels, insights and action buttons.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { analyticsKpis, periodTrend } from './analytics-model.js'
import { AnalyticsHero, RevenueTrendChart, OrdersAOVCorrelation, SalesByChannel, CategoryDistribution } from './analytics.js'
import { InventoryStatsGrid, InventoryHealthCard, StockDistributionChart, InventoryValueSummary } from './inventory.js'
import { CancellationRateCard, FulfillmentRateCard, OrdersWorkspace, TopProductInsight } from './orders.js'
import type { AvailableOrderInsight } from './orders-model.js'
import { DashboardLayout } from './dashboard.js'
import { EMPTY_INVENTORY_PAGE } from './inventory-model.js'
import type { InventoryPageResult } from './inventory-model.js'
import type { AnalyticsSnapshot } from './model.js'

const iso = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return d.toISOString().slice(0, 10)
}

// 60 days of data so the KPI prior-28-day comparison is computable.
const revenue = Array.from({ length: 60 }, (_, i) => ({ storeId: 's1', day: iso(i), grossRevenue: Math.round(900 + Math.sin(i / 3) * 300 + (i % 5) * 80), discounts: 12, orderCount: 3 + (i % 4) }))
const orders = revenue.map((r) => ({ storeId: 's1', day: r.day, orderCount: r.orderCount, fulfilledCount: Math.max(0, r.orderCount - 1), cancelledCount: 0, averageOrderValue: Math.round(r.grossRevenue / r.orderCount) }))
const snapshot: AnalyticsSnapshot = {
  revenue,
  orders,
  productSales: [
    { storeId: 's1', day: iso(1), productId: 'p1', unitsSold: 40, grossRevenue: 9200 },
    { storeId: 's1', day: iso(2), productId: 'p2', unitsSold: 22, grossRevenue: 5100 },
    { storeId: 's1', day: iso(3), productId: 'p3', unitsSold: 11, grossRevenue: 2400 },
  ],
  customerCohorts: [{ storeId: 's1', cohortDay: iso(30), activityDay: iso(30), customerCount: 42, grossRevenue: 12000 }],
}

const kpis = analyticsKpis(snapshot, 128)
const trend = periodTrend(snapshot, 30, null)

const channels = [
  { channel: 'Online Store', revenue: 21400, orders: 61, share: 68, growth: 12.4 },
  { channel: 'Point of Sale', revenue: 6800, orders: 19, share: 22, growth: -3.1 },
  { channel: 'Mobile app', revenue: 3200, orders: 9, share: 10, growth: 41.7 },
]
const categories = [
  { name: 'Snowboards', revenue: 24800, units: 42 },
  { name: 'Boots', revenue: 4900, units: 18 },
  { name: 'Accessories', revenue: 1700, units: 26 },
]

const invPage: InventoryPageResult = {
  ...EMPTY_INVENTORY_PAGE,
  plan: 'growth' as const,
  items: [
    { variantId: 'v1', productId: 'p1', inventoryItemId: 'i1', title: 'Burton Custom Snowboard', variantTitle: '158cm', sku: 'SNOW-158', category: 'Snowboards', vendor: 'Burton', productStatus: 'active', imageUrl: null, price: 649.99, currency: 'USD', quantity: 24, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'in_stock', value: 15599.76, locations: [{ locationId: 'L1', locationName: 'Main Warehouse', available: 24, updatedAt: null }], updatedAt: '2026-08-15T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available' as const, days: 41, velocity: 0.6 } },
    { variantId: 'v3', productId: 'p3', inventoryItemId: 'i3', title: 'Ride Boots Size 10', variantTitle: 'US 10', sku: 'BOOT-10', category: 'Footwear', vendor: 'Ride', productStatus: 'active', imageUrl: null, price: 289, currency: 'USD', quantity: 0, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'out', value: 0, locations: [{ locationId: 'L1', locationName: 'Main Warehouse', available: 0, updatedAt: null }], updatedAt: '2026-08-14T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available' as const, days: 0, velocity: 0.4 } },
  ],
  stats: { totalSkus: 40, trackedSkus: 33, untrackedSkus: 7, totalUnits: 486, inStockCount: 28, lowStockCount: 3, outOfStockCount: 2, totalValue: 552366.55, valuedSkus: 36, currency: 'USD', minStock: 0, averageStock: 14.7, maxStock: 120, lowStockThreshold: 10 },
  distribution: { healthy: 28, low: 3, out: 2, untracked: 7 },
  health: { score: 78, grade: 'B', label: 'Good', tone: 'healthy' as const, components: [{ key: 'stock_coverage', label: 'Items in stock', score: 85, weight: 0.4, detail: '28 of 33 tracked items have stock on hand' }], excluded: [] },
  topValueItems: [
    { variantId: 'v1', title: 'Burton Custom Snowboard', variantTitle: '158cm', quantity: 24, value: 15599.76 },
    { variantId: 'v5', title: 'Jones Flagship Snowboard', variantTitle: '161cm', quantity: 12, value: 10198.8 },
    { variantId: 'v6', title: 'Burton Step On Bindings', variantTitle: 'M', quantity: 30, value: 8997 },
    { variantId: 'v7', title: 'Oakley Flight Deck Goggles', variantTitle: 'One', quantity: 44, value: 5676 },
    { variantId: 'v8', title: 'Ride Boots Size 10', variantTitle: 'US 10', quantity: 18, value: 5202 },
  ],
  basicInsights: {
    topSellingItem: { status: 'available' as const, productId: 'p1', title: 'Burton Custom Snowboard', unitsSold: 42, grossRevenue: 27300, currency: 'USD' },
    itemsNeedingAttention: { count: 5, lowStock: 3, outOfStock: 2 },
    healthGrade: { grade: 'B', score: 78, label: 'Good' },
  },
  lockedFeatures: [],
  tabCounts: { all: 40, in_stock: 28, low: 3, out: 2, untracked: 7 },
  locations: [{ id: 'L1', name: 'Main Warehouse', city: 'Denver', province: 'CO', country: 'US', active: true, levelsQueried: true }],
  multiLocation: false,
  categories: ['Snowboards', 'Footwear', 'Accessories'],
  vendors: ['Burton', 'Ride', 'Jones', 'Oakley'],
  coverage: { inventorySyncCompleted: true, levelRowCount: 40, locationRowCount: 40, lastSyncedAt: '2026-08-16T06:00:00Z', catalogSynced: true, locationsTruncated: false, quantitySource: 'inventory_levels', explanation: 'Stock levels are synced from Shopify inventory locations.' },
  pagination: { page: 1, limit: 20, total: 40, pages: 2 },
}

const catalog = [
  { productId: 'p1', payload: { title: 'Burton Custom Snowboard', product_type: 'Snowboards' } },
  { productId: 'p2', payload: { title: 'Ride Boots Size 10', product_type: 'Footwear' } },
  { productId: 'p3', payload: { title: 'Oakley Goggles', product_type: 'Accessories' } },
]

const shell = (light: boolean, children: unknown) => <div className={light ? 'app-shell light-mode' : 'app-shell'}>{children as never}</div>

describe('PR #42 final-polish smoke (both themes)', () => {
  it('renders the premium Analytics KPI cards with growth, comparison and pending states', () => {
    const dark = renderToStaticMarkup(shell(false, <AnalyticsHero kpis={kpis} loading={false} />))
    expect(dark).toContain('analytics-kpi premium tone-0')
    expect(dark).toContain('kpi-compare')
    expect(dark).toContain('vs. prior 28 days')
    expect(dark).toContain('Visualization pending')
    expect(dark).not.toContain('NaN')
    const light = renderToStaticMarkup(shell(true, <AnalyticsHero kpis={kpis} loading={false} />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('kpi-compare')
  })

  it('renders Revenue Momentum and Orders & AOV correlation with the enhanced chrome', () => {
    const dark = renderToStaticMarkup(shell(false, <div><RevenueTrendChart trend={trend} period={30} setPeriod={() => {}} /><OrdersAOVCorrelation trend={trend} /></div>))
    expect(dark).toContain('revenue-trend')
    expect(dark).toContain('orders-aov')
    expect(dark).toContain('legend orders')
    expect(dark).toContain('legend aov')
    expect(dark).toContain('Busiest day')
    expect(dark).toContain('Average order value')
    expect(dark).toContain('orders · ')
    const light = renderToStaticMarkup(shell(true, <OrdersAOVCorrelation trend={trend} />))
    expect(light).toContain('orders-aov')
    expect(light).toContain('app-shell light-mode')
  })

  it('renders Stock Distribution with reorder insights, stats and actions', () => {
    const dark = renderToStaticMarkup(shell(false, <StockDistributionChart data={invPage} loading={false} onSelectTab={() => {}} />))
    for (const contract of ['Stock Distribution', 'distribution-insights', 'need reorder attention', 'Stock health B · Good', 'Restock alerts', 'Stock coverage', 'Avg units / SKU', 'View Low Stock Items', 'Reorder Recommendations', 'Export Stock Report']) {
      expect(dark).toContain(contract)
    }
    const light = renderToStaticMarkup(shell(true, <StockDistributionChart data={invPage} loading={false} onSelectTab={() => {}} />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('distribution-callouts')
  })

  it('renders the verified Inventory Value card with metrics, insight and actions', () => {
    const dark = renderToStaticMarkup(shell(false, <InventoryValueSummary data={invPage} loading={false} />))
    for (const contract of ['Inventory Value', 'USD 552,366.55', 'value-metrics', 'Avg value / SKU', 'Top 5 products hold', 'value-insight-strip', 'Export Valuation', 'View Full Report', 'value-distribution-bar']) {
      expect(dark).toContain(contract)
    }
    const light = renderToStaticMarkup(shell(true, <InventoryValueSummary data={invPage} loading={false} />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('value-metrics')
  })

  it('renders the Inventory stats and health cards without regressions', () => {
    const dark = renderToStaticMarkup(shell(false, <div><InventoryStatsGrid data={invPage} loading={false} /><InventoryHealthCard data={invPage} loading={false} /></div>))
    expect(dark).toContain('Total Products')
    expect(dark).toContain('Inventory Health')
    expect(dark).toContain('B · Good')
  })

  it('renders the Store Summary and By Category fills on the dashboard', () => {
    const dark = renderToStaticMarkup(shell(false, <DashboardLayout data={{ analytics: snapshot, catalog, loadState: 'ready' }} onSync={async () => {}} onSyncAll={async () => {}} syncAllRunning={false} onNavigate={() => {}} storeName="demo-store" storeId="s1" />))
    for (const contract of ['ai-summary-card', 'ai-summary-extras', 'ai-growth-metric', 'Weekly comparison', 'ai-weekly-chart', 'Best seller', 'Top category', 'Revenue trend', 'Recommended actions', 'View Full Report', 'pie-extras', 'category-insights', 'Diversification', 'category-compare', 'View Category Report', 'Explore Products by Category', 'Recent Activity']) {
      expect(dark).toContain(contract)
    }
    const light = renderToStaticMarkup(shell(true, <DashboardLayout data={{ analytics: snapshot, catalog, loadState: 'ready' }} onSync={async () => {}} onSyncAll={async () => {}} syncAllRunning={false} onNavigate={() => {}} storeName="demo-store" storeId="s1" />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('ai-summary-extras')
    expect(light).toContain('pie-extras')
  })

  it('renders Sales by Channel and Category Distribution unchanged', () => {
    const dark = renderToStaticMarkup(shell(false, <div><SalesByChannel channels={channels} /><CategoryDistribution categories={categories} /></div>))
    expect(dark).toContain('Sales by channel')
    expect(dark).toContain('Sales by category')
    expect(dark).toContain('Total mix')
    expect(dark).toContain('Snowboards')
  })

  it('renders the Orders workspace shell without crashing', () => {
    const dark = renderToStaticMarkup(shell(false, <OrdersWorkspace context={{ storeId: 's1', shop: 'demo.myshopify.com' }} onSync={async () => {}} onNavigate={() => {}} onToast={() => {}} />))
    expect(dark).toContain('orders-workspace')
    expect(dark).toContain('AI Insights')
    const light = renderToStaticMarkup(shell(true, <OrdersWorkspace context={{ storeId: 's1', shop: 'demo.myshopify.com' }} onSync={async () => {}} onNavigate={() => {}} onToast={() => {}} />))
    expect(light).toContain('app-shell light-mode')
  })

  it('renders the premium Top Selling Product card with real computed stats', () => {
    const insight: AvailableOrderInsight = { feature: 'top_selling_product', name: 'Top Selling Product', data: { status: 'available', productId: 'p1', title: 'Burton Custom Snowboard', quantity: 6, revenue: 4199.7, currency: 'USD' } }
    const mockOrders = [
      { id: 'o1', orderNumber: '#1001', customer: { name: 'Anas Kassar' }, lineItems: [{ productId: 'p1', title: 'Burton Custom Snowboard', quantity: 2, price: 649.99 }, { productId: 'p2', title: 'Boots', quantity: 1, price: 289 }], status: 'completed', paymentStatus: 'paid', totalPrice: 1589 },
      { id: 'o2', orderNumber: '#1002', customer: { name: 'Jane Doe' }, lineItems: [{ productId: 'p1', title: 'Burton Custom Snowboard', quantity: 4, price: 649.99 }], status: 'completed', paymentStatus: 'paid', totalPrice: 2600 },
    ]
    const dark = renderToStaticMarkup(shell(false, <TopProductInsight insight={insight} orders={mockOrders as never} ordersTotal={2} onNavigate={() => {}} />))
    for (const contract of ['Top Selling Product', 'Burton Custom Snowboard', '6 sold · $4,199.70', 'Avg sale price', 'Orders featuring it', 'Of line revenue', 'Baseline building', 'units', 'x the average product', 'View Product Details', 'See All Orders']) {
      expect(dark).toContain(contract)
    }
    const light = renderToStaticMarkup(shell(true, <TopProductInsight insight={insight} orders={mockOrders as never} ordersTotal={2} onNavigate={() => {}} />))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('top-product-stats')
  })

  it('renders the premium Cancellation and Fulfillment rate cards', () => {
    const cancellation: AvailableOrderInsight = { feature: 'cancellation_rate', name: 'Cancellation Rate', data: { status: 'available', canceled: 0, total: 5, rate: 0 } }
    const fulfillment: AvailableOrderInsight = { feature: 'fulfillment_rate', name: 'Fulfillment Rate', data: { status: 'available', fulfilled: 5, total: 5, rate: 100, basis: 'Shopify fulfillment status' } }
    const dark = renderToStaticMarkup(shell(false, <div><CancellationRateCard insight={cancellation} /><FulfillmentRateCard insight={fulfillment} /></div>))
    for (const contract of ['Cancellation Rate', 'Excellent — no cancellations this period', 'rate-donut', 'Cancelled', '0 of 5 orders cancelled', 'rate-divider', 'rate-metrics', 'Refunded', 'vs Last Period', 'rate-status-bar good', 'Fulfillment Rate', 'All orders fulfilled', 'Fulfilled', '5 of 5 orders fulfilled', 'Pending', 'Avg Fulfill Time']) {
      expect(dark).toContain(contract)
    }
    expect(dark).not.toContain('rate-progress')
    expect(dark).not.toContain('Industry comparison connects when benchmark data is available')
    const light = renderToStaticMarkup(shell(true, <div><CancellationRateCard insight={cancellation} /><FulfillmentRateCard insight={fulfillment} /></div>))
    expect(light).toContain('app-shell light-mode')
    expect(light).toContain('rate-card')
  })
})
