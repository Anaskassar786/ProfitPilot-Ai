import { describe, expect, it } from 'vitest'
import { InMemoryChargeLedger, reconcileCharges } from './reconcile.js'

describe('daily billing reconciliation', () => {
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
