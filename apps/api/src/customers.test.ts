import { describe, expect, it } from 'vitest'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { storeId } from '@profitpilot/types'
import {
  classifyCustomerSegments,
  deriveCustomerCoverage,
  normalizeCustomer,
  PostgresCustomerRepository,
  predictLtv12Months,
  predictNextOrder,
  purchasePattern,
} from './customers.js'
import type { CustomerCoverage, CustomerOrder, CustomerView } from './customers.js'

const TENANT = storeId('customer-tenant')
const NOW = Date.parse('2026-08-16T12:00:00Z')
const COMPLETE_COVERAGE: CustomerCoverage = { ordersSyncCompleted: true, knownComplete90Days: true, cutoffDate: '2026-04-01T00:00:00.000Z', lastCompletedSyncAt: '2026-08-16T00:00:00.000Z', explanation: 'complete' }

function order(id: string, createdAt: string, total = 100, currency: string | null = 'INR'): CustomerOrder {
  return { id, orderNumber: `#${id}`, createdAt, total, currency, lines: [] }
}

function customer(id: string, spent: number | null, lifetimeOrders: number, lastOrderAt: string | null): CustomerView {
  const normalized = normalizeCustomer(id, { id, first_name: `Customer${id}`, total_spent: spent, orders_count: lifetimeOrders, email: `${id}@example.com`, email_marketing_consent: { state: 'subscribed' } }, new Date('2026-08-16T00:00:00Z'), [], COMPLETE_COVERAGE, NOW)
  return { ...normalized, totalSpent: spent, lifetimeOrders, lastOrderAt, activity: lastOrderAt && NOW - Date.parse(lastOrderAt) <= 30 * 86_400_000 ? 'active' : 'inactive' }
}

describe('customer normalization and protected-data fallbacks', () => {
  it('normalizes real REST fields without inventing protected data or currency', () => {
    const result = normalizeCustomer('42', {
      id: 42,
      first_name: 'Asha',
      last_name: 'Khan',
      email: 'asha@example.com',
      email_marketing_consent: { state: 'subscribed' },
      orders_count: 2,
      total_spent: '1250.50',
      tags: 'loyal, wholesale',
      default_address: { city: 'Moradabad', country_code: 'IN' },
    }, new Date('2026-08-16T00:00:00Z'), [], COMPLETE_COVERAGE, NOW)
    expect(result).toMatchObject({ id: '42', displayName: 'Asha Khan', hasRealName: true, email: 'asha@example.com', emailVisibility: 'available', marketingState: 'subscribed', canEmail: true, lifetimeOrders: 2, totalSpent: 1250.5, currency: null })
    expect(result.tags).toEqual(['loyal', 'wholesale'])
    expect(result.defaultAddress).toMatchObject({ city: 'Moradabad', countryCode: 'IN' })
  })

  it('uses guest, neutral-avatar, and hidden-email states when Shopify redacts fields', () => {
    const result = normalizeCustomer('redacted', { id: 'redacted', orders_count: 0 }, new Date('2026-08-16T00:00:00Z'))
    expect(result).toMatchObject({ displayName: 'Guest customer', hasRealName: false, email: null, emailVisibility: 'hidden', marketingState: 'unknown', canEmail: false, emailDisabledReason: 'Email hidden by Shopify data access', activity: 'unknown' })
  })

  it('distinguishes an explicit empty email and lets the current consent object override legacy fields', () => {
    const empty = normalizeCustomer('empty', { id: 'empty', email: '', accepts_marketing: true, email_marketing_consent: { state: 'not_subscribed' } }, new Date())
    expect(empty).toMatchObject({ emailVisibility: 'empty', marketingState: 'not_subscribed', canEmail: false })
    const legacy = normalizeCustomer('legacy', { id: 'legacy', email: 'legacy@example.com', accepts_marketing: true }, new Date())
    expect(legacy).toMatchObject({ marketingState: 'subscribed', canEmail: true })
  })
})

describe('customer segmentation and predictions', () => {
  it('selects a deterministic top 20 percent VIP pool and primary badge priority', () => {
    const rows = [
      customer('b', 500, 3, '2026-05-01T00:00:00Z'),
      customer('a', 500, 2, '2026-08-10T00:00:00Z'),
      customer('c', 300, 1, '2026-08-12T00:00:00Z'),
      customer('d', 200, 0, null),
      customer('e', 100, 0, null),
    ]
    const result = classifyCustomerSegments(rows, COMPLETE_COVERAGE, NOW)
    expect(result.find((row) => row.id === 'a')?.segments).toContain('vip')
    expect(result.find((row) => row.id === 'b')?.segments).toContain('churn_risk')
    expect(result.find((row) => row.id === 'b')?.segments).not.toContain('vip')
    expect(result.find((row) => row.id === 'c')?.segments).toContain('new_buyer')
    expect(result.find((row) => row.id === 'b')?.primarySegment).toBe('churn_risk')
  })

  it('never emits churn when 90-day coverage is unknown', () => {
    const unknown = { ...COMPLETE_COVERAGE, knownComplete90Days: false }
    expect(classifyCustomerSegments([customer('old', 50, 4, '2026-01-01T00:00:00Z')], unknown, NOW)[0]?.segments).not.toContain('churn_risk')
  })

  it('calculates cadence, next order, and a currency-safe 12-month LTV heuristic', () => {
    const rows = [order('1', '2026-05-01T00:00:00Z', 100), order('2', '2026-06-01T00:00:00Z', 200), order('3', '2026-07-01T00:00:00Z', 300)]
    expect(purchasePattern(rows)).toMatchObject({ status: 'available', intervals: 2, basisOrders: 3 })
    expect(predictNextOrder(rows)).toMatchObject({ status: 'available', basisOrders: 3 })
    expect(predictLtv12Months(rows)).toMatchObject({ status: 'available', currency: 'INR', horizonMonths: 12, averageOrderValue: 200, method: 'cadence_aov_heuristic' })
  })

  it('returns insufficient_data rather than guessing with sparse or mixed-currency history', () => {
    expect(purchasePattern([order('1', '2026-05-01T00:00:00Z')])).toEqual({ status: 'insufficient_data', minimumOrders: 2 })
    expect(predictNextOrder([order('1', '2026-05-01T00:00:00Z'), order('2', '2026-06-01T00:00:00Z')])).toEqual({ status: 'insufficient_data', minimumOrders: 3 })
    expect(predictLtv12Months([order('1', '2026-05-01T00:00:00Z', 10, 'INR'), order('2', '2026-06-01T00:00:00Z', 10, 'USD'), order('3', '2026-07-01T00:00:00Z', 10, 'INR')])).toMatchObject({ status: 'insufficient_data', reason: 'mixed_or_missing_currency' })
  })
})

describe('customer history coverage', () => {
  it('requires a completed sync and a real order reaching the 90-day boundary', () => {
    const checkpoint = { cursor: null, updated_at: new Date('2026-08-16T00:00:00Z') }
    expect(deriveCustomerCoverage([order('old', '2026-04-01T00:00:00Z')], checkpoint, NOW)).toMatchObject({ ordersSyncCompleted: true, knownComplete90Days: true, cutoffDate: '2026-04-01T00:00:00.000Z' })
    expect(deriveCustomerCoverage([order('recent', '2026-08-01T00:00:00Z')], checkpoint, NOW)).toMatchObject({ ordersSyncCompleted: true, knownComplete90Days: false })
    expect(deriveCustomerCoverage([order('old', '2026-04-01T00:00:00Z')], null, NOW)).toMatchObject({ ordersSyncCompleted: false, knownComplete90Days: false })
  })
})

describe('tenant-safe customer repository', () => {
  it('joins only tenant-scoped customer and order rows and preserves honest coverage', async () => {
    const calls: Array<Readonly<{ text: string; values: readonly unknown[] }>> = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
        calls.push({ text, values })
        if (text.includes("module = 'customers'")) return { rows: [{ record_id: 'customer-1', payload: { id: 'customer-1', first_name: 'Real', email: 'real@example.com', email_marketing_consent: { state: 'subscribed' }, orders_count: 1, total_spent: '99.00' }, synced_at: new Date('2026-08-16T00:00:00Z') } as unknown as Row], rowCount: 1 }
        if (text.includes("module = 'orders'")) return { rows: [{ record_id: 'order-1', payload: { id: 'order-1', name: '#1', created_at: '2026-08-10T00:00:00Z', financial_status: 'paid', total_price: '99.00', currency: 'INR', customer: { id: 'customer-1' }, line_items: [{ product_id: 'p1', title: 'Real product', quantity: 1, price: '99.00' }] }, synced_at: new Date('2026-08-16T00:00:00Z') } as unknown as Row], rowCount: 1 }
        return { rows: [{ cursor: null, updated_at: new Date('2026-08-16T00:00:00Z') } as unknown as Row], rowCount: 1 }
      },
    }
    const repository = new PostgresCustomerRepository(executor, () => NOW)
    const dataset = await repository.list(TENANT)
    expect(dataset.customers[0]).toMatchObject({ id: 'customer-1', lastOrderAt: '2026-08-10T00:00:00Z', activity: 'active', currency: 'INR', primarySegment: 'vip' })
    expect(dataset.customers[0]?.orders).toHaveLength(1)
    expect(dataset.customers[0]?.products).toEqual([{ productId: 'p1', title: 'Real product', quantity: 1 }])
    expect(dataset.coverage.knownComplete90Days).toBe(false)
    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.text.includes('store_id = $1') && call.values[0] === TENANT)).toBe(true)
  })
})
