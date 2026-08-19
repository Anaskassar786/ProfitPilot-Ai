import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CustomerActivityStatus, CustomerEmailAction, CustomersEmptyState, CustomerPremiumIntelligence, InitialsAvatar, TargetedEmailComposer } from './customers.js'
import { customerAvatarColor, customerEmailLabel, customerMoney, initialsForCustomer, primaryBehaviorLabel } from './customers-model.js'
import type { CustomerCoverage, CustomerDetail, CustomerInsightsResult, CustomerSummary } from './customers-model.js'

const customer: CustomerSummary = { id: 'real-1', displayName: 'Asha Khan', hasRealName: true, email: 'asha@example.com', emailVisibility: 'available', marketingState: 'subscribed', canEmail: true, emailDisabledReason: null, phone: null, createdAt: '2026-08-01T00:00:00Z', lifetimeOrders: 2, totalSpent: 200, currency: 'INR', lastOrderAt: '2026-08-10T00:00:00Z', activity: 'active', segments: ['vip'], primarySegment: 'vip', purchasePattern: null }

describe('Customers protected-data display helpers', () => {
  it('derives initials only from a real name and uses a neutral icon otherwise', () => {
    expect(initialsForCustomer(customer)).toBe('AK')
    expect(initialsForCustomer({ ...customer, displayName: 'Guest customer', hasRealName: false })).toBeNull()
    const named = renderToStaticMarkup(createElement(InitialsAvatar, { customer }))
    const guest = renderToStaticMarkup(createElement(InitialsAvatar, { customer: { ...customer, displayName: 'Guest customer', hasRealName: false } }))
    expect(named).toContain('AK')
    expect(guest).toContain('Customer name unavailable')
    expect(guest).not.toContain('>G<')
    expect(customerAvatarColor('real-1')).toBe(customerAvatarColor('real-1'))
  })

  it('distinguishes hidden and empty email without inventing an address', () => {
    expect(customerEmailLabel({ email: null, emailVisibility: 'hidden' })).toBe('Email hidden')
    expect(customerEmailLabel({ email: null, emailVisibility: 'empty' })).toBe('—')
  })

  it('does not silently format unknown currency as USD', () => {
    expect(customerMoney(1234.5, null)).toBe('1,234.5')
    expect(customerMoney(1234.5, null)).not.toContain('$')
    expect(customerMoney(1234.5, 'INR')).toContain('₹')
  })

  it('keeps primary behavior priority labels explicit', () => {
    expect(primaryBehaviorLabel('churn_risk')).toBe('At Risk')
    expect(primaryBehaviorLabel('vip')).toBe('VIP')
    expect(primaryBehaviorLabel('new_buyer')).toBe('New Buyer')
    expect(primaryBehaviorLabel(null)).toBeNull()
  })
})

describe('Customers UI safety regressions', () => {
  it('shows Unknown activity with the exact coverage explanation', () => {
    const html = renderToStaticMarkup(createElement(CustomerActivityStatus, { activity: 'unknown' }))
    expect(html).toContain('Unknown')
    expect(html).toContain('complete 90-day Shopify order window cannot be proven')
    expect(html).not.toContain('Inactive')
  })

  it('disables opted-out email with the server-derived reason and locks lower plans', () => {
    const disabled = renderToStaticMarkup(createElement(CustomerEmailAction, { customer: { ...customer, canEmail: false, marketingState: 'not_subscribed', emailDisabledReason: 'Customer opted out' }, premium: true, onEmail: vi.fn(), onUpgrade: vi.fn() }))
    expect(disabled).toContain('Customer opted out')
    expect(disabled).toContain('disabled')
    const locked = renderToStaticMarkup(createElement(CustomerEmailAction, { customer, premium: false, onEmail: vi.fn(), onUpgrade: vi.fn() }))
    expect(locked).toContain('Upgrade to unlock')
  })

  it('renders empty state without demo customer identities or fake money', () => {
    const html = renderToStaticMarkup(createElement(CustomersEmptyState, { title: 'No customer records synced', description: 'No demo customers are created.', action: 'Sync Customers', onAction: vi.fn() }))
    expect(html).toContain('No customer records synced')
    expect(html).toContain('No demo customers are created.')
    expect(html).not.toContain('john@example.com')
    expect(html).not.toContain('$')
  })

  it('routes Customers through the real workspace and locked features to Billing', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const branch = source.slice(source.indexOf("active === 'customers'"), source.indexOf("active === 'analytics'"))
    expect(branch).toContain('<CustomersPage')
    expect(branch).toContain("onNavigate('billing')")
    expect(branch).not.toContain('EmptyDataPage')
  })

  it('contains the required responsive table, drawer, chart, bulk, and coverage components', () => {
    const source = readFileSync(new URL('./customers.tsx', import.meta.url), 'utf8')
    for (const component of ['CustomerStatsGrid', 'AICustomerInsightsCard', 'CustomersToolbar', 'CustomerSegmentFilterBar', 'CustomersTable', 'CustomerRow', 'CustomerBulkActionBar', 'CustomerDetailDrawer', 'CustomerOrderHistory', 'CustomerLtvTimeline', 'ProductsBoughtList', 'CustomerHistoryCoverage']) expect(source).toContain(`function ${component}`)
    expect(source).not.toMatch(/https?:\/\/.*(avatar|photo|unsplash)/i)
  })

  it('renders a professional Sort by control instead of a cramped Newest customer label', () => {
    const source = readFileSync(new URL('./customers.tsx', import.meta.url), 'utf8')
    expect(source).toContain('label="Sort by"')
    expect(source).toContain("label: 'Newest'")
    expect(source).not.toContain('Newest customer')
    expect(source).toContain('ariaLabel="Sort customers by"')
    const css = readFileSync(new URL('./customers.css', import.meta.url), 'utf8')
    expect(css).toContain('.customers-sort')
    expect(css).toContain('overflow: visible !important')
  })

  it('renders a safety-first email composer with explicit review and no arbitrary recipient input', () => {
    const html = renderToStaticMarkup(createElement(TargetedEmailComposer, { storeId: 'store-1', customer, onClose: vi.fn(), onToast: vi.fn() }))
    expect(html).toContain('NO ONE-CLICK SEND')
    expect(html).toContain('REAL SHOPIFY RECIPIENT')
    expect(html).toContain('Send reviewed email')
    expect(html).toContain('disabled')
    expect(html).not.toContain('type="email"')
    const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8')
    const send = api.slice(api.indexOf('function sendTargetedCampaign'), api.indexOf('export function exportRows'))
    expect(send).toContain('customerId')
    expect(send).not.toContain('recipientEmail')
    expect(send).not.toContain('acceptsMarketing')
  })
})

describe('Customer detail drawer premium sections', () => {
  const detailCoverage: CustomerCoverage = { ordersSyncCompleted: true, knownComplete90Days: true, cutoffDate: '2026-05-19', lastCompletedSyncAt: '2026-08-16T00:00:00Z', explanation: 'Synced order history reaches 2026-05-19.' }
  const detailCustomer: CustomerDetail = {
    id: 'cust-1', adminGraphqlApiId: null, firstName: 'Asha', lastName: 'Khan', displayName: 'Asha Khan', hasRealName: true, email: 'asha@example.com', emailVisibility: 'available', marketingState: 'subscribed', canEmail: true, emailDisabledReason: null, phone: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', syncedAt: '2026-08-16T00:00:00Z', lifetimeOrders: 4, totalSpent: 480, currency: 'INR', lastOrderId: 'order-4', lastOrderName: '#1004', lastOrderAt: '2026-08-01T00:00:00Z', activity: 'active', tags: [], note: null, addresses: [], defaultAddress: null,
    orders: [{ id: 'order-1', orderNumber: '#1001', createdAt: '2026-01-15T00:00:00Z', total: 120, currency: 'INR', lines: [] }, { id: 'order-4', orderNumber: '#1004', createdAt: '2026-08-01T00:00:00Z', total: 120, currency: 'INR', lines: [] }],
    products: [], cumulativeValue: [],
    purchasePattern: { status: 'available', averageIntervalDays: 27, intervals: 3, basisOrders: 4 },
    predictedNextOrder: { status: 'available', predictedNextOrderAt: '2026-08-28T00:00:00Z', averageIntervalDays: 27, basisOrders: 4 },
    predictiveLtv: { status: 'available', value: 1620, currency: 'INR', horizonMonths: 12, averageOrderValue: 120, averageIntervalDays: 27, basisOrders: 4, method: 'cadence_aov_heuristic' },
    segments: ['vip'], primarySegment: 'vip', coverage: detailCoverage,
  }
  const insights: CustomerInsightsResult = { plan: 'growth', planLabel: 'Growth', customerCount: 5, available: [{ feature: 'retention_suggestion', name: 'AI retention suggestion', data: { status: 'generated', text: 'Re-engage VIPs with a curated restock note.' } }], locked: [], usage: { feature: 'customers_ai_insights_day', used: 1, limit: 20, remaining: 19, limitReached: false }, coverage: detailCoverage, cached: false }

  it('locks every premium feature individually for a Trial plan instead of leaving blank sections', () => {
    const html = renderToStaticMarkup(createElement(CustomerPremiumIntelligence, { customer: detailCustomer, plan: 'trial', insights, insightsLoading: false, onUpgrade: vi.fn() }))
    expect(html).toContain('Purchase intelligence')
    expect(html).toContain('Upgrade to unlock')
    expect(html).toContain('Predicted next order')
    expect(html).toContain('Upgrade to unlock')
    expect(html).toContain('Predictive LTV')
    expect(html).toContain('Upgrade to unlock')
    expect(html).toContain('Retention recommendation')
    expect(html).toContain('Upgrade to unlock')
    // Each locked feature renders the reusable PR #30 locked card (a button → billing).
    expect(html.match(/plan-locked-feature/g)?.length).toBe(4)
    // Real intelligence is never leaked to a locked plan.
    expect(html).not.toContain('Average cadence')
    expect(html).not.toContain('27 days')
  })

  it('unlocks Growth features while keeping Commander predictions locked', () => {
    const html = renderToStaticMarkup(createElement(CustomerPremiumIntelligence, { customer: detailCustomer, plan: 'growth', insights, insightsLoading: false, onUpgrade: vi.fn() }))
    expect(html).toContain('Average cadence')
    expect(html).toContain('27 days')
    expect(html).toContain('Re-engage VIPs')
    expect(html).toContain('Upgrade to unlock')
    expect(html).toContain('Upgrade to unlock')
    expect(html.match(/plan-locked-feature/g)?.length).toBe(2)
  })

  it('unlocks every prediction for Commander with the heuristic LTV disclaimer', () => {
    const html = renderToStaticMarkup(createElement(CustomerPremiumIntelligence, { customer: detailCustomer, plan: 'commander', insights, insightsLoading: false, onUpgrade: vi.fn() }))
    expect(html).toContain('Average cadence')
    expect(html).toContain('Predicted date')
    expect(html).toContain('12-month forecast')
    expect(html).toContain('Heuristic forecast')
    expect(html).not.toContain('plan-locked-feature')
    expect(html).not.toContain('Upgrade to ')
  })
})
