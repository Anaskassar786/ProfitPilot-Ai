import { describe, expect, it } from 'vitest'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { InMemoryChargeLedger, PostgresChargeLedger, reconcileCharges } from './reconcile.js'

function fakeExecutor(rows: readonly QueryResultRow[]): { executor: SqlExecutor; queries: { text: string; values: readonly unknown[] }[] } {
  const queries: { text: string; values: readonly unknown[] }[] = []
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
      queries.push({ text, values })
      return { rows: rows as readonly Row[], rowCount: rows.length }
    },
  }
  return { executor, queries }
}

describe('daily billing reconciliation', () => {
  it('returns zero work when no charges are pending', async () => expect(await reconcileCharges(new InMemoryChargeLedger(), () => { throw new Error('not called') }, 100)).toEqual({ checked: 0, activated: 0, declined: 0, cancelled: 0 }))
  it('activates a remotely active pending charge', async () => {
    const ledger = new InMemoryChargeLedger(); ledger.add({ id: '1', shopId: 's', plan: 'GROWTH', interval: 'MONTHLY', status: 'PENDING', createdAt: 100, lastVerifiedAt: null })
    const result = await reconcileCharges(ledger, () => ({ verifyCharge: async () => ({ status: 'active' }) } as unknown as import('./shopify-billing.js').ShopifyBillingClient), 200)
    expect(result.activated).toBe(1); expect(ledger.get('1')?.status).toBe('ACTIVE')
  })
  it('declines a pending charge older than seven days', async () => {
    const ledger = new InMemoryChargeLedger(); ledger.add({ id: '1', shopId: 's', plan: 'GROWTH', interval: 'MONTHLY', status: 'PENDING', createdAt: 0, lastVerifiedAt: null })
    await reconcileCharges(ledger, () => ({ verifyCharge: async () => ({ status: 'active' }) } as unknown as import('./shopify-billing.js').ShopifyBillingClient), 7 * 86_400_000)
    expect(ledger.get('1')?.status).toBe('DECLINED')
  })
  it('cancels when the remote charge is missing', async () => {
    const ledger = new InMemoryChargeLedger(); ledger.add({ id: '1', shopId: 's', plan: 'GROWTH', interval: 'MONTHLY', status: 'PENDING', createdAt: 100, lastVerifiedAt: null })
    await reconcileCharges(ledger, () => { throw new Error('missing') }, 200)
    expect(ledger.get('1')?.status).toBe('CANCELLED')
  })
  it('declines a remotely declined charge', async () => {
    const ledger = new InMemoryChargeLedger(); ledger.add({ id: '1', shopId: 's', plan: 'GROWTH', interval: 'MONTHLY', status: 'PENDING', createdAt: 100, lastVerifiedAt: null })
    await reconcileCharges(ledger, () => ({ verifyCharge: async () => ({ status: 'declined' }) } as unknown as import('./shopify-billing.js').ShopifyBillingClient), 200)
    expect(ledger.get('1')?.status).toBe('DECLINED')
  })
})

describe('Postgres charge ledger', () => {
  it('lists PENDING_CONFIRMATION subscriptions as pending charges', async () => {
    const { executor } = fakeExecutor([
      { charge_id: 'gid://shopify/AppSubscription/9', shop_id: 'shop-1', plan: 'growth', interval: 'MONTHLY', created_at: new Date(100) },
    ])
    const pending = await new PostgresChargeLedger(executor).listPending()
    expect(pending).toEqual([{ id: 'gid://shopify/AppSubscription/9', shopId: 'shop-1', plan: 'GROWTH', interval: 'MONTHLY', status: 'PENDING', createdAt: 100, lastVerifiedAt: null }])
  })
  it('activates a charge preserving the subscription interval', async () => {
    const { executor, queries } = fakeExecutor([])
    await new PostgresChargeLedger(executor).update('charge-9', 'ACTIVE', 200)
    expect(queries[0]?.text).toContain('ACTIVE_MONTHLY')
    expect(queries[0]?.text).toContain('ACTIVE_ANNUAL')
    expect(queries[0]?.values).toEqual(['charge-9', 200])
  })
  it('resolves declined or cancelled charges to past-due', async () => {
    const { executor, queries } = fakeExecutor([])
    await new PostgresChargeLedger(executor).update('charge-9', 'DECLINED', 200)
    expect(queries[0]?.text).toContain("state = 'PAST_DUE'")
  })
})
