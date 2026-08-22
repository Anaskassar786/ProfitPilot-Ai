import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import type { AnalyticsSnapshot } from '@profitpilot/db'
import { ProductionCommandTools } from './ai-command-runtime.js'
import type { CustomerRepository } from './customers.js'

const tenant = storeId('store-1')

function customer(id: string, totalSpent: number, extras: Readonly<Record<string, unknown>> = {}) {
  return {
    id,
    displayName: id,
    email: `${id}@example.com`,
    totalSpent,
    currency: 'USD',
    lifetimeOrders: 2,
    lastOrderAt: '2026-08-18T12:00:00.000Z',
    activity: 'active',
    tags: [],
    primarySegment: null,
    canEmail: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...extras,
  }
}

function customerReader(rows: readonly ReturnType<typeof customer>[]): Pick<CustomerRepository, 'list'> {
  return {
    list: async () => ({
      customers: rows,
      coverage: { ordersSyncCompleted: true, knownComplete90Days: true, cutoffDate: null, lastCompletedSyncAt: null, explanation: 'complete' },
    }) as unknown as Awaited<ReturnType<CustomerRepository['list']>>,
  }
}

function analyticsReader(snapshot: AnalyticsSnapshot, catalog: readonly Readonly<{ productId: string; payload: Record<string, unknown> }>[]) {
  return { read: async () => snapshot, readCatalog: async () => catalog }
}

const emptyAnalytics: AnalyticsSnapshot = { revenue: [], orders: [], productSales: [], customerCohorts: [] }

describe('Production AI Command tools', () => {
  it('resolves semantic customer intents instead of treating the whole sentence as a literal search', async () => {
    const tools = new ProductionCommandTools({ customers: customerReader([
      customer('regular', 20),
      customer('vip-low', 100, { primarySegment: 'vip' }),
      customer('vip-high', 500, { primarySegment: 'vip' }),
      customer('inactive', 40, { activity: 'inactive', primarySegment: 'churn_risk' }),
    ]) })
    const best = await tools.run(tenant, { name: 'search_customers', params: { query: 'Who are my best customers?', limit: 20 } })
    expect(best.ok).toBe(true)
    if (!best.ok) return
    const bestData = best.data as { items: readonly { id: string }[] }
    expect(bestData.items.map((item) => item.id)).toEqual(['vip-high', 'vip-low'])

    const inactive = await tools.run(tenant, { name: 'search_customers', params: { query: 'Find at-risk customers', limit: 20 } })
    expect(inactive.ok).toBe(true)
    if (!inactive.ok) return
    expect((inactive.data as { items: readonly { id: string }[] }).items.map((item) => item.id)).toEqual(['inactive'])
  })

  it('ranks best-selling and underperforming products from live product-sales rows', async () => {
    const snapshot: AnalyticsSnapshot = {
      ...emptyAnalytics,
      productSales: [
        { storeId: tenant, day: new Date().toISOString().slice(0, 10), productId: 'p1', unitsSold: 2, grossRevenue: 20 },
        { storeId: tenant, day: new Date().toISOString().slice(0, 10), productId: 'p2', unitsSold: 8, grossRevenue: 160 },
      ],
    }
    const tools = new ProductionCommandTools({ analytics: analyticsReader(snapshot, [
      { productId: 'p1', payload: { title: 'Mug' } },
      { productId: 'p2', payload: { title: 'Jacket' } },
      { productId: 'p3', payload: { title: 'Hat' } },
    ]) })
    const best = await tools.run(tenant, { name: 'search_products', params: { query: 'Show my best-selling products', limit: 20 } })
    expect(best.ok).toBe(true)
    if (!best.ok) return
    expect((best.data as { items: readonly { id: string }[] }).items.map((item) => item.id)).toEqual(['p2', 'p1', 'p3'])

    const slow = await tools.run(tenant, { name: 'search_products', params: { query: 'Find underperforming products', limit: 20 } })
    expect(slow.ok).toBe(true)
    if (!slow.ok) return
    expect((slow.data as { items: readonly { id: string }[] }).items[0]?.id).toBe('p3')
  })

  it('uses non-overlapping exact day windows for analytics comparisons', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterdayDate = new Date(); yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1)
    const yesterday = yesterdayDate.toISOString().slice(0, 10)
    const snapshot: AnalyticsSnapshot = {
      ...emptyAnalytics,
      revenue: [
        { storeId: tenant, day: today, grossRevenue: 50, discounts: 0, orderCount: 1 },
        { storeId: tenant, day: yesterday, grossRevenue: 30, discounts: 0, orderCount: 1 },
      ],
      orders: [
        { storeId: tenant, day: today, orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 50 },
        { storeId: tenant, day: yesterday, orderCount: 1, fulfilledCount: 1, cancelledCount: 0, averageOrderValue: 30 },
      ],
    }
    const tools = new ProductionCommandTools({ analytics: analyticsReader(snapshot, []) })
    const result = await tools.run(tenant, { name: 'get_analytics', params: { date_range: '1d' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({ revenue: 50, previousRevenue: 30, orders: 1, previousOrders: 1 })
  })
})

/* ── QA 2026-08-22: discount error details + preflight scope check (SC-2) ── */

import { ProductionCommandActions } from './ai-command-runtime.js'
import type { AiCommandActionRecord } from '@profitpilot/ai'
import type { TokenVault } from '@profitpilot/shopify'
import type { StoreDirectory } from '@profitpilot/db'

function shopifyDeps(scopes: readonly string[] | null, graphql: { status: number; body: unknown }) {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/admin/oauth/access_scopes.json')) {
      if (scopes === null) return new Response('{"access_scopes": []}', { status: 404 })
      return new Response(JSON.stringify({ access_scopes: scopes.map((handle) => ({ handle })) }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    void init
    return new Response(JSON.stringify(graphql.body), { status: graphql.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return () => { globalThis.fetch = realFetch }
}

function discountAction(): AiCommandActionRecord {
  return {
    id: 'act-1',
    storeId: tenant,
    conversationId: null,
    actionType: 'CREATE_DISCOUNT',
    actionParams: { title: 'Test', value: 10, usage_limit: 5, expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() },
    actionPreview: null,
    merchantApproved: true,
    approvedAt: null,
    executionStatus: 'PENDING',
    executionResult: null,
    errorDetails: null,
    rollbackAvailable: false,
    rollbackDeadline: null,
    rolledBackAt: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  } as AiCommandActionRecord
}

describe('ProductionCommandActions discount execution (SC-2)', () => {
  it('forwards GraphQL userErrors into errorDetails.message', async () => {
    const restore = shopifyDeps(['read_products', 'write_discounts'], {
      status: 200,
      body: { data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ field: ['code'], message: 'Discount code is already taken.' }] } } },
    })
    try {
      const actions = new ProductionCommandActions({ shopify: { directory: shopifyDepsDirectory(), tokens: shopifyDepsTokens() } })
      const result = await actions.execute(tenant, discountAction())
      expect(result.status).toBe('FAILED')
      expect((result.result as { message: string }).message).toContain('Discount code is already taken.')
      expect((result.errorDetails as { message: string }).message).toContain('Discount code is already taken.')
      expect((result.errorDetails as { reason: string }).reason).toBe('GRAPHQL_USER_ERRORS')
    } finally { restore() }
  })

  it('reports HTTP 403 as a missing write_discounts scope with re-authorize guidance', async () => {
    const restore = shopifyDeps(['read_products'], { status: 403, body: { errors: 'Access denied' } })
    try {
      const actions = new ProductionCommandActions({ shopify: { directory: shopifyDepsDirectory(), tokens: shopifyDepsTokens() } })
      const result = await actions.execute(tenant, discountAction())
      expect(result.status).toBe('FAILED')
      expect((result.errorDetails as { reason: string }).reason).toBe('MISSING_WRITE_DISCOUNTS_SCOPE')
      expect((result.errorDetails as { message: string }).message).toContain('write_discounts')
      expect((result.errorDetails as { message: string }).message).toContain('Re-authorize or re-install')
    } finally { restore() }
  })

  it('preflight blocks the preview when the live token lacks write_discounts', async () => {
    const restore = shopifyDeps(['read_products', 'read_orders'], { status: 200, body: {} })
    try {
      const actions = new ProductionCommandActions({ shopify: { directory: shopifyDepsDirectory(), tokens: shopifyDepsTokens() } })
      const check = await actions.preflight!(tenant, 'CREATE_DISCOUNT')
      expect(check.ok).toBe(false)
      expect(check.missingScope).toBe('write_discounts')
      expect(check.reason).toContain('Re-authorize or re-install')
    } finally { restore() }
  })

  it('preflight passes when the token grants write_discounts', async () => {
    const restore = shopifyDeps(['read_products', 'write_discounts'], { status: 200, body: {} })
    try {
      const actions = new ProductionCommandActions({ shopify: { directory: shopifyDepsDirectory(), tokens: shopifyDepsTokens() } })
      const check = await actions.preflight!(tenant, 'CREATE_DISCOUNT')
      expect(check.ok).toBe(true)
    } finally { restore() }
  })

  it('preflight proceeds when the scope endpoint is unreachable (execution reports the exact error)', async () => {
    const restore = shopifyDeps(null, { status: 200, body: {} })
    try {
      const actions = new ProductionCommandActions({ shopify: { directory: shopifyDepsDirectory(), tokens: shopifyDepsTokens() } })
      const check = await actions.preflight!(tenant, 'CREATE_DISCOUNT')
      expect(check.ok).toBe(true)
    } finally { restore() }
  })
})

function shopifyDepsDirectory(): StoreDirectory {
  return {
    get: async () => ({ storeId: tenant, shopDomain: 'test-shop.myshopify.com', installedAt: new Date().toISOString() }) as never,
    getByShopDomain: async () => null,
    upsertByShopDomain: async () => { throw new Error('unused') },
  } as unknown as StoreDirectory
}
function shopifyDepsTokens(): TokenVault {
  return { get: async () => 'shpat_test-token' } as unknown as TokenVault
}
