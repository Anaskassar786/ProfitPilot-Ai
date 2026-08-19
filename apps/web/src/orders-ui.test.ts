import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OrdersEmptyState, PlanLockedFeature } from './orders.js'
import { initials, insightByFeature, lockedInsightByFeature, orderStatusLabel, paymentStatusLabel } from './orders-model.js'
import type { OrderInsightsResult } from './orders-model.js'
import { EXPORT_DATASET_DEFINITIONS } from '@profitpilot/types'

describe('Orders UI regressions', () => {
  it('renders a graceful empty state without invented order rows', () => {
    const html = renderToStaticMarkup(createElement(OrdersEmptyState, { title: 'No synced orders yet', description: 'No demo records will be inserted.', action: 'Sync orders', onAction: vi.fn(), compact: true }))
    expect(html).toContain('No synced orders yet')
    expect(html).toContain('No demo records will be inserted.')
    expect(html).not.toContain('Customer 1')
    expect(html).not.toContain('$')
  })

  it('renders reusable locked metadata with the exact upgrade CTA', () => {
    const html = renderToStaticMarkup(createElement(PlanLockedFeature, { featureName: 'Peak Order Times', requiredPlan: 'growth', onUpgrade: vi.fn(), children: createElement('span', null, 'masked') }))
    expect(html).toContain('Upgrade to unlock')
    expect(html).toContain('Peak Order Times')
    expect(html).toContain('plan-locked-blur')
  })

  it('keeps the Orders branch read-only and routes locked clicks to existing Billing', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const ordersBranch = source.slice(source.indexOf("active === 'orders'"), source.indexOf("active === 'analytics'"))
    expect(ordersBranch).toContain("onNavigate('billing')")
    expect(ordersBranch).not.toContain('Add New')
  })

  it('awaits post-sync reloads, reports synced wording, and partial load errors', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(source).toContain('await loadData()')
    expect(source).toContain('synced from Shopify')
    expect(source).not.toContain('sync queued through')
    expect(source).toContain("errors.length > 0 ? 'partial' : 'ready'")
    expect(source).toContain('Partial data load')
  })

  // The daily order export is still honest about what it contains, but its
  // merchant-facing label now lives with the other Data Exports definitions
  // instead of being hard-coded in App.tsx under developer wording.
  it('labels the daily order export honestly and without jargon', () => {
    expect(EXPORT_DATASET_DEFINITIONS.orders.name).toBe('Orders Export')
    expect(EXPORT_DATASET_DEFINITIONS.orders.description).toBe('Daily order summaries from your Shopify sync.')
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('Daily aggregate export')
  })
})

describe('Orders display helpers', () => {
  it('formats every canonical status/payment value and only derives initials from a real name', () => {
    expect((['new', 'completed', 'canceled', 'pending'] as const).map(orderStatusLabel)).toEqual(['New', 'Completed', 'Canceled', 'Pending'])
    expect((['paid', 'pending', 'not_paid', 'refunded', 'partially_refunded', 'unknown'] as const).map(paymentStatusLabel)).toEqual(['Paid', 'Pending', 'Not paid', 'Refunded', 'Partially refunded', 'Unknown'])
    expect(initials('Anas Kassar')).toBe('AK')
    expect(initials(null)).toBeNull()
  })

  it('separates available insight data from metadata-only locks', () => {
    const result: OrderInsightsResult = { plan: 'start', planLabel: 'Start', planBadge: 'Free insights', orderCount: 2, sufficientData: false, available: [{ feature: 'top_selling_product', name: 'Top', data: { quantity: 2 } }], locked: [{ locked: true, feature: 'peak_times', required_plan: 'growth' }], usage: { feature: 'orders_ai_insights_day', used: 0, limit: 0, remaining: 0, limitReached: true }, cached: false }
    expect(insightByFeature(result, 'top_selling_product')?.data).toEqual({ quantity: 2 })
    expect(lockedInsightByFeature(result, 'peak_times')).toEqual({ locked: true, feature: 'peak_times', required_plan: 'growth' })
    expect(insightByFeature(result, 'peak_times')).toBeNull()
  })
})
