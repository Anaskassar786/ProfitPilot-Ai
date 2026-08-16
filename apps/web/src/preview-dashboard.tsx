/**
 * Local-only visual harness for the dashboard layout (PR #23).
 * Not part of the shipped bundle — `preview.html` is the entry point and is
 * excluded from the production build. Run: pnpm --filter @profitpilot/web dev
 * then open /preview.html
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DashboardLayout } from './dashboard.js'
import './styles.css'
import './dashboard.css'

type Scenario = 'sparse' | 'rich' | 'empty'

function makeSnapshot(scenario: Scenario) {
  if (scenario === 'empty') return null
  const today = new Date()
  const iso = (offset: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() - offset)
    return d.toISOString().slice(0, 10)
  }

  if (scenario === 'sparse') {
    return {
      revenue: [{ storeId: 's1', day: iso(1), grossRevenue: 1434, discounts: 40, orderCount: 1 }],
      orders: [{ storeId: 's1', day: iso(1), orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 1434 }],
      productSales: [{ storeId: 's1', day: iso(1), productId: 'p1', unitsSold: 1, grossRevenue: 1434 }],
      customerCohorts: [],
    }
  }

  const revenue = Array.from({ length: 120 }, (_, i) => ({
    storeId: 's1',
    day: iso(i),
    grossRevenue: Math.round(200 + Math.sin(i / 4) * 140 + (i % 7) * 30),
    discounts: 10,
    orderCount: 2 + (i % 5),
  }))
  return {
    revenue,
    orders: revenue.slice(0, 12).map((r) => ({
      storeId: 's1',
      day: r.day,
      orderCount: r.orderCount,
      fulfilledCount: Math.max(0, r.orderCount - 1),
      cancelledCount: r.orderCount % 3 === 0 ? 1 : 0,
      averageOrderValue: Math.round(r.grossRevenue / r.orderCount),
    })),
    productSales: [
      { storeId: 's1', day: iso(1), productId: 'p1', unitsSold: 40, grossRevenue: 9200 },
      { storeId: 's1', day: iso(2), productId: 'p2', unitsSold: 22, grossRevenue: 5100 },
      { storeId: 's1', day: iso(3), productId: 'p3', unitsSold: 11, grossRevenue: 2400 },
    ],
    customerCohorts: [{ storeId: 's1', cohortMonth: '2026-07', customers: 42, repeatCustomers: 9, revenue: 12000 }],
  }
}

const CATALOGS: Record<Scenario, Array<{ productId: string; payload: Record<string, unknown> }>> = {
  empty: [],
  sparse: [{ productId: 'p1', payload: { title: 'Snowboard', product_type: 'snowboard' } }],
  rich: [
    { productId: 'p1', payload: { title: 'Snowboard', product_type: 'Snowboards' } },
    { productId: 'p2', payload: { title: 'Boots', product_type: 'Footwear' } },
    { productId: 'p3', payload: { title: 'Goggles', product_type: 'Accessories' } },
  ],
}

function Harness() {
  const [scenario, setScenario] = useState<Scenario>('sparse')
  const analytics = makeSnapshot(scenario) as never

  return (
    <div className="app-shell" style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['sparse', 'rich', 'empty'] as Scenario[]).map((s) => (
          <button
            key={s}
            onClick={() => setScenario(s)}
            className={`period-toggle-btn ${scenario === s ? 'active' : ''}`}
            style={{ border: '1px solid var(--border)', padding: '6px 12px' }}
          >
            {s}
          </button>
        ))}
      </div>
      <DashboardLayout
        data={{ analytics, catalog: CATALOGS[scenario], loadState: 'ready' }}
        onSync={async () => {}}
        onSyncAll={async () => {}}
        syncAllRunning={false}
        onNavigate={() => {}}
        storeName="preview-store"
        storeId="s1"
      />
    </div>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<StrictMode><Harness /></StrictMode>)
