import type { ShopifyBillingClient, RecurringCharge } from './shopify-billing.js'
import type { BillingInterval, PlanCode } from './plans.js'

export type LocalCharge = Readonly<{ id: string; shopId: string; plan: PlanCode; interval: BillingInterval; status: 'PENDING' | 'ACTIVE' | 'DECLINED' | 'CANCELLED'; createdAt: number; lastVerifiedAt: number | null }>
export interface ChargeLedger { listPending(): Promise<readonly LocalCharge[]>; update(id: string, status: LocalCharge['status'], verifiedAt: number): Promise<void> }

export class InMemoryChargeLedger implements ChargeLedger {
  private readonly charges = new Map<string, LocalCharge>()
  public add(charge: LocalCharge): void { this.charges.set(charge.id, charge) }
  public async listPending(): Promise<readonly LocalCharge[]> { return [...this.charges.values()].filter((charge) => charge.status === 'PENDING') }
  public async update(id: string, status: LocalCharge['status'], verifiedAt: number): Promise<void> { const current = this.charges.get(id); if (current) this.charges.set(id, { ...current, status, lastVerifiedAt: verifiedAt }) }
  public get(id: string): LocalCharge | null { return this.charges.get(id) ?? null }
}

export type ReconcileResult = Readonly<{ checked: number; activated: number; declined: number; cancelled: number }>

export async function reconcileCharges(ledger: ChargeLedger, clientFor: (charge: LocalCharge) => ShopifyBillingClient, now = Date.now()): Promise<ReconcileResult> {
  const pending = await ledger.listPending()
  let activated = 0; let declined = 0; let cancelled = 0
  for (const charge of pending) {
    if (now - charge.createdAt >= 7 * 86_400_000) { await ledger.update(charge.id, 'DECLINED', now); declined += 1; continue }
    try {
      const remote: RecurringCharge = await clientFor(charge).verifyCharge(charge.id, { plan: charge.plan, interval: charge.interval })
      if (remote.status === 'active' || remote.status === 'accepted') { await ledger.update(charge.id, 'ACTIVE', now); activated += 1 } else if (remote.status === 'declined' || remote.status === 'expired') { await ledger.update(charge.id, 'DECLINED', now); declined += 1 }
    } catch { await ledger.update(charge.id, 'CANCELLED', now); cancelled += 1 }
  }
  return { checked: pending.length, activated, declined, cancelled }
}
