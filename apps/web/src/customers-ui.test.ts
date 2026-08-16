import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CustomerActivityStatus, CustomerEmailAction, CustomersEmptyState, InitialsAvatar, TargetedEmailComposer } from './customers.js'
import { customerAvatarColor, customerEmailLabel, customerMoney, initialsForCustomer, primaryBehaviorLabel } from './customers-model.js'
import type { CustomerSummary } from './customers-model.js'

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
    expect(locked).toContain('Growth plan required')
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
