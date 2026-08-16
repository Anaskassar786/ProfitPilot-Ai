import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BasicInsightsCard, InventoryEmptyState, InventoryHealthCard, InventoryStatsGrid, InventoryTable, PremiumPreviewGrid, StockDistributionChart, StockLevelBadge } from './inventory.js'
import { EMPTY_INVENTORY_PAGE, distributionSegments, formatMoney, formatUnits, locationBreakdown, lockedFeature, quantityLabel, stockStatusLabel } from './inventory-model.js'
import type { InventoryItem, InventoryPageResult } from './inventory-model.js'

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    variantId: '9001',
    productId: '7001',
    inventoryItemId: '5001',
    title: 'Blue Cotton Shirt',
    variantTitle: 'Small',
    sku: 'SHIRT-S',
    category: 'Apparel',
    vendor: 'Real Vendor',
    productStatus: 'active',
    imageUrl: 'https://cdn.shopify.com/7001.jpg',
    price: 499,
    currency: 'INR',
    quantity: 24,
    quantitySource: 'inventory_levels',
    tracked: true,
    inventoryPolicy: 'deny',
    status: 'in_stock',
    value: 11_976,
    locations: [{ locationId: '61', locationName: 'Morādābād Warehouse', available: 20, updatedAt: '2026-08-15T09:00:00Z' }, { locationId: '62', locationName: 'Delhi Retail', available: 4, updatedAt: null }],
    updatedAt: '2026-08-15T09:00:00Z',
    syncedAt: '2026-08-16T06:00:00Z',
    ...overrides,
  }
}

function page(overrides: Partial<InventoryPageResult> = {}): InventoryPageResult {
  return {
    ...EMPTY_INVENTORY_PAGE,
    plan: 'trial',
    items: [item()],
    stats: { ...EMPTY_INVENTORY_PAGE.stats, totalSkus: 4, trackedSkus: 3, untrackedSkus: 1, totalUnits: 27, inStockCount: 1, lowStockCount: 1, outOfStockCount: 1, totalValue: 13_473, valuedSkus: 2, currency: 'INR', averageStock: 9 },
    distribution: { healthy: 1, low: 1, out: 1, untracked: 1 },
    health: { score: 62, grade: 'C', label: 'Needs attention', tone: 'warning', components: [{ key: 'stock_coverage', label: 'Items in stock', score: 67, weight: 0.5, detail: '2 of 3 tracked items have stock on hand' }], excluded: [] },
    topValueItems: [{ variantId: '9001', title: 'Blue Cotton Shirt', variantTitle: 'Small', quantity: 24, value: 11_976 }],
    tabCounts: { all: 4, in_stock: 1, low: 1, out: 1, untracked: 1 },
    lockedFeatures: [
      { locked: true, feature: 'dead_stock', name: 'Dead Stock Detector', required_plan: 'growth' },
      { locked: true, feature: 'auto_reorder', name: 'Auto-Reorder Suggestions', required_plan: 'commander' },
    ],
    ...overrides,
  }
}

describe('Inventory KPI and health rendering', () => {
  it('renders real synced numbers rather than the old em-dash placeholders', () => {
    const html = renderToStaticMarkup(createElement(InventoryStatsGrid, { data: page(), loading: false }))
    expect(html).toContain('Total SKUs')
    expect(html).toContain('Units in Stock')
    expect(html).toContain('Low Stock Alerts')
    expect(html).toContain('Out of Stock')
    expect(html).toContain('27')
    expect(html).not.toContain('Awaiting inventory sync')
  })

  it('renders a real inventory health score instead of the store-wide 100/100 gauge', () => {
    const html = renderToStaticMarkup(createElement(InventoryHealthCard, { data: page(), loading: false }))
    expect(html).toContain('Inventory Health')
    expect(html).toContain('62')
    expect(html).toContain('C · Needs attention')
    expect(html).toContain('Items in stock')
    expect(html).not.toContain('100')
  })

  it('shows an honest no-data gauge when nothing is synced', () => {
    const html = renderToStaticMarkup(createElement(InventoryHealthCard, { data: EMPTY_INVENTORY_PAGE, loading: false }))
    expect(html).toContain('No inventory data')
    expect(html).toContain('health-gauge compact no-data')
    expect(html).not.toMatch(/>\s*100\s*</)
  })

  it('renders the stock distribution legend from real counts and nothing when empty', () => {
    expect(renderToStaticMarkup(createElement(StockDistributionChart, { data: page(), loading: false }))).toContain('Stock Distribution')
    expect(renderToStaticMarkup(createElement(StockDistributionChart, { data: EMPTY_INVENTORY_PAGE, loading: false }))).toContain('No stock levels to chart yet.')
  })
})

describe('Inventory table rendering', () => {
  it('shows product name, SKU, stock, value, location name, and a status badge', () => {
    const html = renderToStaticMarkup(createElement(InventoryTable, { items: [item()], multiLocation: true, onSelect: vi.fn() }))
    expect(html).toContain('Blue Cotton Shirt')
    expect(html).toContain('SKU SHIRT-S')
    expect(html).toContain('24')
    expect(html).toContain('INR 11,976.00')
    expect(html).toContain('Morādābād Warehouse')
    expect(html).toContain('+1 more location')
    expect(html).toContain('In Stock')
  })

  it('never renders a fabricated zero for an untracked variant', () => {
    const html = renderToStaticMarkup(createElement(InventoryTable, { items: [item({ tracked: false, quantity: null, status: 'untracked', value: null, locations: [] })], multiLocation: false, onSelect: vi.fn() }))
    expect(html).toContain('Not tracked')
    expect(html).toContain('Not Tracked')
    expect(html).not.toContain('Out of Stock')
  })

  it.each([
    ['in_stock', 'In Stock'],
    ['low', 'Low Stock'],
    ['out', 'Out of Stock'],
    ['untracked', 'Not Tracked'],
  ] as const)('renders the %s badge as %s', (status, label) => {
    expect(renderToStaticMarkup(createElement(StockLevelBadge, { status }))).toContain(label)
  })
})

describe('Inventory insights and gating', () => {
  it('states an honest awaiting-sales-history message instead of a fake top seller', () => {
    const html = renderToStaticMarkup(createElement(BasicInsightsCard, { data: page(), onUpgrade: vi.fn() }))
    expect(html).toContain('Top Selling Item')
    expect(html).toContain('Awaiting more sales history')
    expect(html).toContain('Health Grade')
    expect(html).toContain('Needs Attention')
  })

  it('renders locked premium previews from backend metadata with upgrade CTAs', () => {
    const html = renderToStaticMarkup(createElement(PremiumPreviewGrid, { data: page(), onUpgrade: vi.fn() }))
    expect(html).toContain('Dead Stock Detector')
    expect(html).toContain('Upgrade to Growth to unlock')
    expect(html).toContain('Auto-Reorder Suggestions')
    expect(html).toContain('Upgrade to Commander to unlock')
    expect(html).toContain('plan-locked-blur')
  })

  it('renders nothing when a Commander plan has no locked features left', () => {
    expect(renderToStaticMarkup(createElement(PremiumPreviewGrid, { data: page({ plan: 'commander', lockedFeatures: [] }), onUpgrade: vi.fn() }))).toBe('')
  })

  it('does not surface Bundle Recommendations, which is out of scope', () => {
    expect(renderToStaticMarkup(createElement(PremiumPreviewGrid, { data: page(), onUpgrade: vi.fn() }))).not.toContain('Bundle')
  })
})

describe('Inventory empty states', () => {
  it('prompts a sync without inventing any stock rows', () => {
    const html = renderToStaticMarkup(createElement(InventoryEmptyState, { title: 'Sync your inventory to see stock levels', description: 'Nothing on this page is estimated.', action: 'Sync inventory', onAction: vi.fn() }))
    expect(html).toContain('Sync your inventory to see stock levels')
    expect(html).toContain('Sync inventory')
    expect(html).not.toContain('SHIRT')
    expect(html).not.toMatch(/\d+ units/)
  })
})

describe('Inventory view model helpers', () => {
  it('formats real values and refuses to render a missing one as zero', () => {
    expect(formatMoney(11_976, 'INR')).toBe('INR 11,976.00')
    expect(formatMoney(null, 'INR')).toBe('—')
    expect(formatUnits(null)).toBe('—')
    expect(quantityLabel(item({ quantity: null, tracked: true }))).toBe('Unavailable')
    expect(quantityLabel(item({ quantity: null, tracked: false }))).toBe('Not tracked')
  })

  it('aggregates multi-location stock into shares that reflect real availability', () => {
    const breakdown = locationBreakdown(item())
    expect(breakdown.map((entry) => entry.label)).toEqual(['Morādābād Warehouse', 'Delhi Retail'])
    expect(breakdown.map((entry) => entry.share)).toEqual([83, 17])
  })

  it('falls back to a readable label when Shopify returned no location name', () => {
    expect(locationBreakdown(item({ locations: [{ locationId: '77', locationName: null, available: 3, updatedAt: null }] }))[0]?.label).toBe('Location 77')
  })

  it('drops empty segments from the distribution chart', () => {
    expect(distributionSegments({ healthy: 2, low: 0, out: 1, untracked: 0 }).map((segment) => segment.key)).toEqual(['healthy', 'out'])
  })

  it('resolves locked features by name and labels every stock status', () => {
    expect(lockedFeature(page(), 'dead_stock')?.required_plan).toBe('growth')
    expect(lockedFeature(page(), 'stock_turnover')).toBeNull()
    expect(stockStatusLabel('low')).toBe('Low Stock')
  })
})

describe('Inventory wiring regressions', () => {
  const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

  it('routes the inventory page to the real workspace instead of the placeholder', () => {
    expect(appSource).toContain('<InventoryWorkspace')
    expect(appSource).not.toContain('function InventoryPage(')
    expect(appSource).not.toContain('Awaiting inventory sync')
  })

  it('refetches inventory in loadData so a sync immediately populates the page', () => {
    const loadData = appSource.slice(appSource.indexOf('const loadData = async ()'), appSource.indexOf('useEffect(() => { void loadData() }'))
    expect(loadData).toContain('fetchInventory(context.storeId)')
    expect(loadData).toContain('inventory,')
  })

  it('removes internal phase jargon from every merchant-facing inventory surface', () => {
    const sources = ['./App.tsx', './inventory.tsx', './inventory-model.ts'].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
    for (const jargon of ['Deterministic F2 input', 'F4 decision rule', 'the F2 API', 'F5 ']) expect(sources).not.toContain(jargon)
  })

  it('keeps the inventory route in the dev proxy so it never falls through to the SPA shell', () => {
    expect(readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')).toContain("'/inventory': 'http://127.0.0.1:3000'")
  })

  it('loads the inventory stylesheet after the other workspace styles', () => {
    const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
    expect(main.indexOf("import './inventory.css'")).toBeGreaterThan(main.indexOf("import './customers.css'"))
  })
})
