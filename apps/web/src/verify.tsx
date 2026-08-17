/**
 * PR #44 visual verification harness — dev only, not part of the production
 * build (vite builds index.html only; this mirrors preview.html). Run the dev
 * server and open /verify.html to inspect every affected surface in both
 * themes with realistic mock data. No backend required.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './dashboard.css'
import './orders.css'
import './inventory.css'
import './analytics.css'
import './upgrade-overrides.css'
import './final-polish.css'
import { analyticsKpis, periodTrend } from './analytics-model.js'
import { AnalyticsHero, RevenueTrendChart, OrdersAOVCorrelation, SalesByChannel, CategoryDistribution } from './analytics.js'
import { InventoryStatsGrid, InventoryHealthCard, StockDistributionChart, InventoryValueSummary } from './inventory.js'
import { CancellationRateCard, FulfillmentRateCard, OrderHealthInsight, TopProductInsight } from './orders.js'
import { DashboardLayout } from './dashboard.js'
import { EMPTY_INVENTORY_PAGE } from './inventory-model.js'
import type { AnalyticsSnapshot } from './model.js'
import type { AvailableOrderInsight } from './orders-model.js'
import type { InventoryPageResult } from './inventory-model.js'

const iso = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return d.toISOString().slice(0, 10)
}

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
  plan: 'growth',
  items: [
    { variantId: 'v1', productId: 'p1', inventoryItemId: 'i1', title: 'Burton Custom Snowboard', variantTitle: '158cm', sku: 'SNOW-158', category: 'Snowboards', vendor: 'Burton', productStatus: 'active', imageUrl: null, price: 649.99, currency: 'USD', quantity: 24, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'in_stock', value: 15599.76, locations: [{ locationId: 'L1', locationName: 'Main Warehouse', available: 24, updatedAt: null }], updatedAt: '2026-08-15T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available', days: 41, velocity: 0.6 } },
    { variantId: 'v2', productId: 'p2', inventoryItemId: 'i2', title: 'Burton Custom Snowboard', variantTitle: '162cm', sku: 'SNOW-162', category: 'Snowboards', vendor: 'Burton', productStatus: 'active', imageUrl: null, price: 649.99, currency: 'USD', quantity: 6, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'low', value: 3899.94, locations: [{ locationId: 'L1', locationName: 'Main Warehouse', available: 6, updatedAt: null }], updatedAt: '2026-08-15T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available', days: 9, velocity: 0.7 } },
    { variantId: 'v3', productId: 'p3', inventoryItemId: 'i3', title: 'Ride Boots Size 10', variantTitle: 'US 10', sku: 'BOOT-10', category: 'Footwear', vendor: 'Ride', productStatus: 'active', imageUrl: null, price: 289, currency: 'USD', quantity: 0, quantitySource: 'inventory_levels', tracked: true, inventoryPolicy: 'deny', status: 'out', value: 0, locations: [{ locationId: 'L1', locationName: 'Main Warehouse', available: 0, updatedAt: null }], updatedAt: '2026-08-14T09:00:00Z', syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'available', days: 0, velocity: 0.4 } },
    { variantId: 'v4', productId: 'p4', inventoryItemId: null, title: 'Oakley Goggles', variantTitle: null, sku: null, category: 'Accessories', vendor: null, productStatus: 'active', imageUrl: null, price: 129, currency: 'USD', quantity: null, quantitySource: 'variant_inventory_quantity', tracked: false, inventoryPolicy: null, status: 'untracked', value: null, locations: [], updatedAt: null, syncedAt: '2026-08-16T06:00:00Z', daysOfCover: { status: 'insufficient_data', reason: 'no_stock_signal', message: 'Not tracked' } },
  ],
  stats: { totalSkus: 40, trackedSkus: 33, untrackedSkus: 7, totalUnits: 486, inStockCount: 28, lowStockCount: 3, outOfStockCount: 2, totalValue: 552366.55, valuedSkus: 36, currency: 'USD', minStock: 0, averageStock: 14.7, maxStock: 120, lowStockThreshold: 10 },
  distribution: { healthy: 28, low: 3, out: 2, untracked: 7 },
  health: { score: 78, grade: 'B', label: 'Good', tone: 'healthy', components: [{ key: 'stock_coverage', label: 'Items in stock', score: 85, weight: 0.4, detail: '28 of 33 tracked items have stock on hand' }, { key: 'low_stock_risk', label: 'Low stock risk', score: 70, weight: 0.3, detail: '3 items below 10 units' }, { key: 'out_of_stock', label: 'Out of stock', score: 80, weight: 0.3, detail: '2 items at zero units' }], excluded: [] },
  topValueItems: [
    { variantId: 'v1', title: 'Burton Custom Snowboard', variantTitle: '158cm', quantity: 24, value: 15599.76 },
    { variantId: 'v5', title: 'Jones Flagship Snowboard', variantTitle: '161cm', quantity: 12, value: 10198.8 },
    { variantId: 'v6', title: 'Burton Step On Bindings', variantTitle: 'M', quantity: 30, value: 8997 },
    { variantId: 'v7', title: 'Oakley Flight Deck Goggles', variantTitle: 'One', quantity: 44, value: 5676 },
    { variantId: 'v8', title: 'Ride Boots Size 10', variantTitle: 'US 10', quantity: 18, value: 5202 },
  ],
  basicInsights: {
    topSellingItem: { status: 'available', productId: 'p1', title: 'Burton Custom Snowboard', unitsSold: 42, grossRevenue: 27300, currency: 'USD' },
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

const topProductInsight: AvailableOrderInsight = { feature: 'top_selling_product', name: 'Top Selling Product', data: { status: 'available', productId: 'p1', title: 'Burton Custom Snowboard', quantity: 6, revenue: 4199.7, currency: 'USD' } }
const cancellationInsight: AvailableOrderInsight = { feature: 'cancellation_rate', name: 'Cancellation Rate', data: { status: 'available', canceled: 1, total: 5, rate: 20 } }
const fulfillmentInsight: AvailableOrderInsight = { feature: 'fulfillment_rate', name: 'Fulfillment Rate', data: { status: 'available', fulfilled: 3, total: 5, rate: 60, basis: 'Shopify fulfillment status' } }
const orderHealthInsight: AvailableOrderInsight = { feature: 'order_health_score', name: 'Order Health', data: { status: 'available', score: 80, grade: 'A', tone: 'healthy', fulfilledRate: 0, cancelledRate: 0, paidRate: 100 } }
const orderRows = [
  { id: 'o1', orderNumber: '#1001', createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-12T10:00:00Z', customer: { name: 'Anas Kassar' }, lineItems: [{ productId: 'p1', title: 'Burton Custom Snowboard', quantity: 2, price: 649.99 }, { productId: 'p2', title: 'Ride Boots', quantity: 1, price: 289 }], status: 'completed', paymentStatus: 'paid', totalPrice: 1589, currency: 'USD' },
  { id: 'o2', orderNumber: '#1002', createdAt: '2026-08-08T09:00:00Z', updatedAt: '2026-08-10T09:00:00Z', customer: { name: 'Jane Doe' }, lineItems: [{ productId: 'p1', title: 'Burton Custom Snowboard', quantity: 4, price: 649.99 }], status: 'completed', paymentStatus: 'paid', totalPrice: 2600, currency: 'USD' },
  { id: 'o3', orderNumber: '#1003', createdAt: '2026-08-05T12:00:00Z', updatedAt: '2026-08-06T12:00:00Z', customer: { name: 'Sam Lee' }, lineItems: [], status: 'completed', paymentStatus: 'paid', totalPrice: 649.99, currency: 'USD' },
  { id: 'o4', orderNumber: '#1004', createdAt: '2026-07-15T11:00:00Z', updatedAt: '2026-07-15T12:00:00Z', customer: { name: 'Alex Kim' }, lineItems: [], status: 'canceled', paymentStatus: 'refunded', totalPrice: 289, currency: 'USD' },
  { id: 'o5', orderNumber: '#1005', createdAt: '2026-07-10T11:00:00Z', updatedAt: '2026-07-11T11:00:00Z', customer: { name: 'Riley Chen' }, lineItems: [], status: 'canceled', paymentStatus: 'refunded', totalPrice: 60, currency: 'USD' },
] as never

type Page = 'dashboard' | 'analytics' | 'inventory' | 'orders'

function Harness() {
  const [page, setPage] = useState<Page>('dashboard')
  const [light, setLight] = useState(false)

  return (
    <div className={`app-shell ${light ? 'light-mode' : ''}`} style={{ minHeight: '100vh' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-secondary)', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13, color: 'var(--text)', marginRight: 6 }}>PR #44 verification</strong>
        {(['dashboard', 'analytics', 'inventory', 'orders'] as Page[]).map((id) => (
          <button key={id} onClick={() => setPage(id)} className={`period-toggle-btn ${page === id ? 'active' : ''}`} style={{ textTransform: 'capitalize' }}>
            {id}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => setLight(false)} className={`period-toggle-btn ${light ? '' : 'active'}`}>Dark</button>
        <button onClick={() => setLight(true)} className={`period-toggle-btn ${light ? 'active' : ''}`}>Light</button>
      </div>
      <div className="page-content" style={{ padding: 22, maxWidth: 1240, margin: '0 auto' }}>
        {page === 'dashboard' && <DashboardLayout data={{ analytics: snapshot, catalog, loadState: 'ready' }} onSync={async () => {}} onSyncAll={async () => {}} syncAllRunning={false} onNavigate={() => {}} storeName="demo-store" storeId="s1" />}
        {page === 'analytics' && (
          <div className="analytics-page">
            <AnalyticsHero kpis={kpis} loading={false} />
            <section className="analytics-split analytics-trends-row">
              <RevenueTrendChart trend={trend} period={30} setPeriod={() => {}} />
              <OrdersAOVCorrelation trend={trend} />
            </section>
            <section className="analytics-split">
              <SalesByChannel channels={channels} />
              <CategoryDistribution categories={categories} />
            </section>
          </div>
        )}
        {page === 'inventory' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <InventoryStatsGrid data={invPage} loading={false} />
            <div className="inventory-overview-grid">
              <InventoryHealthCard data={invPage} loading={false} />
              <StockDistributionChart data={invPage} loading={false} onSelectTab={() => {}} />
              <InventoryValueSummary data={invPage} loading={false} />
            </div>
          </div>
        )}
        {page === 'orders' && (
          <div className="orders-workspace" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="card orders-insights">
              <header className="orders-insights-header">
                <div className="orders-insights-title"><span className="ai-insights-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg></span><div><div className="section-kicker">ORDER INTELLIGENCE</div><h2>AI Insights</h2><p>Smart analysis from your Shopify orders.</p></div></div>
              </header>
              <div className="orders-insights-body">
                <div className="orders-basic-insights">
                  <TopProductInsight insight={topProductInsight} orders={orderRows} ordersTotal={2} onNavigate={() => {}} />
                  <CancellationRateCard insight={cancellationInsight} orders={orderRows} />
                  <FulfillmentRateCard insight={fulfillmentInsight} orders={orderRows} />
                  <OrderHealthInsight insight={orderHealthInsight} totalOrders={5} />
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('verify root missing')
createRoot(root).render(<StrictMode><Harness /></StrictMode>)
