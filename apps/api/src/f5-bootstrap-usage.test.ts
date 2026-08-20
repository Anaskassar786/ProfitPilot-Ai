import { describe, expect, it } from 'vitest'
import { readLiveCounts, usage } from './f5-bootstrap.js'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'

/**
 * Tiny SQL executor double. Returns whatever the test wrote for a given
 * substring; missing substrings fall through to an empty result. Captures
 * every query so assertions can verify the call was made with the right
 * store_id and through the tenant context.
 */
function fakeExecutor(handlers: Readonly<Record<string, readonly QueryResultRow[]>>): { executor: SqlExecutor; calls: ReadonlyArray<Readonly<{ text: string; values: readonly unknown[] }>> } {
  const calls: Array<Readonly<{ text: string; values: readonly unknown[] }>> = []
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values })
      for (const [needle, rows] of Object.entries(handlers)) {
        if (text.includes(needle)) return { rows: rows as readonly Row[], rowCount: rows.length }
      }
      return { rows: [] as readonly Row[], rowCount: 0 }
    },
  }
  return { executor, calls }
}

describe('F5 usage — live counts', () => {
  it('returns the product count from catalog_products (not 0)', async () => {
    const { executor } = fakeExecutor({
      'FROM catalog_products': [{ total: '16' }],
    })
    const counts = await readLiveCounts(executor, 'store-1')
    expect(counts.products_sync).toBe(16)
  })

  it('returns the customer count from sync_records (module=customers)', async () => {
    const { executor } = fakeExecutor({
      "module = 'customers'": [{ total: '42' }],
    })
    const counts = await readLiveCounts(executor, 'store-1')
    expect(counts.customers_sync).toBe(42)
  })

  it('returns the orders-this-month count from sync_records (module=orders)', async () => {
    const { executor } = fakeExecutor({
      "module = 'orders'": [{ total: '123' }],
    })
    const counts = await readLiveCounts(executor, 'store-1')
    expect(counts.orders_sync_month).toBe(123)
  })

  it('returns the workflow count from workflows table', async () => {
    const { executor } = fakeExecutor({
      'FROM workflows': [{ total: '5' }],
    })
    const counts = await readLiveCounts(executor, 'store-1')
    expect(counts.automation_workflows).toBe(5)
  })

  it('returns today\'s AI Command count from ai_command_usage', async () => {
    const { executor } = fakeExecutor({
      'FROM ai_command_usage': [{ total: '37' }],
    })
    const counts = await readLiveCounts(executor, 'store-1')
    expect(counts.ai_command_daily).toBe(37)
  })

  it('every count is passed the authenticated store id (tenant-safe)', async () => {
    const { executor, calls } = fakeExecutor({
      'FROM catalog_products': [{ total: '1' }],
      "module = 'customers'": [{ total: '2' }],
      "module = 'orders'": [{ total: '3' }],
      'FROM workflows': [{ total: '4' }],
      'FROM ai_command_usage': [{ total: '5' }],
    })
    await readLiveCounts(executor, 'tenant-xyz')
    for (const call of calls) {
      expect(call.values).toContain('tenant-xyz')
    }
  })

  it('falls back to 0 when a domain table is missing (fresh install)', async () => {
    const { executor } = fakeExecutor({ /* no handlers — every query returns empty */ })
    const counts = await readLiveCounts(executor, 'store-1')
    expect(counts.products_sync).toBe(0)
    expect(counts.customers_sync).toBe(0)
    expect(counts.orders_sync_month).toBe(0)
    expect(counts.automation_workflows).toBe(0)
    expect(counts.ai_command_daily).toBe(0)
  })

  it('survives a thrown query (broken table) without poisoning the rest', async () => {
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string) {
        if (text.includes('FROM catalog_products')) throw new Error('relation does not exist')
        if (text.includes("module = 'customers'")) return { rows: [{ total: '9' } as unknown as Row], rowCount: 1 }
        if (text.includes("module = 'orders'")) return { rows: [{ total: '4' } as unknown as Row], rowCount: 1 }
        if (text.includes('FROM workflows')) return { rows: [{ total: '0' } as unknown as Row], rowCount: 1 }
        if (text.includes('FROM ai_command_usage')) return { rows: [{ total: '1' } as unknown as Row], rowCount: 1 }
        return { rows: [] as readonly Row[], rowCount: 0 }
      },
    }
    const counts = await readLiveCounts(executor, 'store-1')
    // products_sync fell back via the .catch to 0
    expect(counts.products_sync).toBe(0)
    // the others were not affected
    expect(counts.customers_sync).toBe(9)
    expect(counts.orders_sync_month).toBe(4)
    expect(counts.ai_command_daily).toBe(1)
  })
})

describe('F5 usage — full resolver', () => {
  it('surfaces real product count (16/250) on a fresh trial with no billing_usage rows', async () => {
    const { executor } = fakeExecutor({
      'FROM catalog_products': [{ total: '16' }],
      "module = 'customers'": [{ total: '0' }],
      "module = 'orders'": [{ total: '0' }],
      'FROM workflows': [{ total: '0' }],
      'FROM ai_command_usage': [{ total: '0' }],
    })
    const meters = await usage(executor, 'store-1')
    const find = (feature: string) => meters.find((meter) => meter.feature === feature)
    // PR-critical: never 0/250 for products when 16 are synced
    expect(find('products_sync')).toEqual({ feature: 'products_sync', used: 16, limit: 250 })
    expect(find('customers_sync')).toEqual({ feature: 'customers_sync', used: 0, limit: 250 })
    expect(find('orders_sync_month')).toEqual({ feature: 'orders_sync_month', used: 0, limit: 250 })
  })

  it('shows commander unlimited (null) — never 0/0', async () => {
    const { executor } = fakeExecutor({
      'FROM catalog_products': [{ total: '12500' }],
      "module = 'customers'": [{ total: '8000' }],
      "module = 'orders'": [{ total: '4200' }],
      'FROM workflows': [{ total: '30' }],
      'FROM ai_command_usage': [{ total: '212' }],
      'FROM billing_subscriptions': [{
        store_id: 'store-1',
        plan: 'commander',
        state: 'ACTIVE_MONTHLY',
        current_period_end: null,
        version: 1,
        interval: 'MONTHLY',
        charge_id: 'c-1',
      } as unknown as QueryResultRow],
    })
    const meters = await usage(executor, 'store-1')
    const find = (feature: string) => meters.find((meter) => meter.feature === feature)
    expect(find('orders_sync_month')).toEqual({ feature: 'orders_sync_month', used: 4200, limit: null })
    expect(find('products_sync')).toEqual({ feature: 'products_sync', used: 12500, limit: null })
    expect(find('customers_sync')).toEqual({ feature: 'customers_sync', used: 8000, limit: null })
    expect(find('ai_command_daily')).toEqual({ feature: 'ai_command_daily', used: 212, limit: null })
    expect(find('automation_workflows')).toEqual({ feature: 'automation_workflows', used: 30, limit: null })
  })

  it('surfaces active_agents as the plan count (capacity, not consumption)', async () => {
    const { executor } = fakeExecutor({
      'FROM catalog_products': [{ total: '0' }],
      "module = 'customers'": [{ total: '0' }],
      "module = 'orders'": [{ total: '0' }],
      'FROM workflows': [{ total: '0' }],
      'FROM ai_command_usage': [{ total: '0' }],
      'FROM billing_subscriptions': [{
        store_id: 'store-1', plan: 'start', state: 'ACTIVE_MONTHLY', current_period_end: null, version: 1, interval: 'MONTHLY', charge_id: 'c-1',
      } as unknown as QueryResultRow],
    })
    const meters = await usage(executor, 'store-1')
    const find = (feature: string) => meters.find((meter) => meter.feature === feature)
    // Start plan unlocks 3 named agents — used should equal 3, limit 3
    expect(find('active_agents')).toEqual({ feature: 'active_agents', used: 3, limit: 3 })
  })
})
