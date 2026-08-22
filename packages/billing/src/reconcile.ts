import type { ShopifyBillingClient, RecurringCharge } from './shopify-billing.js'
import type { BillingInterval, PlanCode } from './plans.js'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'

export type LocalCharge = Readonly<{ id: string; shopId: string; plan: PlanCode; interval: BillingInterval; status: 'PENDING' | 'ACTIVE' | 'DECLINED' | 'CANCELLED'; createdAt: number; lastVerifiedAt: number | null }>
export interface ChargeLedger { listPending(): Promise<readonly LocalCharge[]>; update(id: string, status: LocalCharge['status'], verifiedAt: number): Promise<void> }

export class InMemoryChargeLedger implements ChargeLedger {
  private readonly charges = new Map<string, LocalCharge>()
  public add(charge: LocalCharge): void { this.charges.set(charge.id, charge) }
  public async listPending(): Promise<readonly LocalCharge[]> { return [...this.charges.values()].filter((charge) => charge.status === 'PENDING') }
  public async update(id: string, status: LocalCharge['status'], verifiedAt: number): Promise<void> { const current = this.charges.get(id); if (current) this.charges.set(id, { ...current, status, lastVerifiedAt: verifiedAt }) }
  public get(id: string): LocalCharge | null { return this.charges.get(id) ?? null }
}

type ChargeRow = QueryResultRow & { charge_id: string; shop_id: string; plan: string; interval: string | null; created_at: Date | string | number }

/**
 * Postgres-backed {@link ChargeLedger} over `billing_subscriptions`.
 *
 * A charge awaiting Shopify confirmation is a `billing_subscriptions` row in
 * `PENDING_CONFIRMATION` with a non-null `charge_id` (written by
 * `POST /billing/charge`). The daily reconcile job walks those rows, verifies
 * each against Shopify Billing, and resolves the local state:
 *
 *  - ACTIVE → `ACTIVE_MONTHLY` / `ACTIVE_ANNUAL` (interval is preserved), and
 *  - DECLINED / CANCELLED (verification error) → `PAST_DUE`, so a merchant is
 *    never silently stuck in `PENDING_CONFIRMATION`.
 */
export class PostgresChargeLedger implements ChargeLedger {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) { this.executor = executor }

  public async listPending(): Promise<readonly LocalCharge[]> {
    const result = await this.executor.query<ChargeRow>(
      `SELECT charge_id, shop_id, plan, interval, created_at
       FROM billing_subscriptions
       WHERE state = 'PENDING_CONFIRMATION' AND charge_id IS NOT NULL AND charge_id <> ''`,
    )
    return result.rows.map((row) => ({
      id: row.charge_id,
      shopId: row.shop_id,
      plan: planCode(row.plan),
      interval: row.interval === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY',
      status: 'PENDING' as const,
      createdAt: toMillis(row.created_at),
      lastVerifiedAt: null,
    }))
  }

  public async update(id: string, status: LocalCharge['status'], verifiedAt: number): Promise<void> {
    if (status === 'ACTIVE') {
      await this.executor.query(
        `UPDATE billing_subscriptions
         SET state = CASE WHEN interval = 'ANNUAL' THEN 'ACTIVE_ANNUAL' ELSE 'ACTIVE_MONTHLY' END,
             updated_at = to_timestamp($2 / 1000.0)
         WHERE charge_id = $1 AND state = 'PENDING_CONFIRMATION'`,
        [id, verifiedAt],
      )
      return
    }
    // DECLINED or CANCELLED (verification failed): the charge can never
    // activate, so the subscription resolves to past-due instead of sticking.
    await this.executor.query(
      `UPDATE billing_subscriptions
       SET state = 'PAST_DUE', updated_at = to_timestamp($2 / 1000.0)
       WHERE charge_id = $1 AND state = 'PENDING_CONFIRMATION'`,
      [id, verifiedAt],
    )
  }
}

function planCode(plan: string): PlanCode {
  if (plan === 'growth') return 'GROWTH'
  if (plan === 'commander') return 'COMMANDER'
  return 'START'
}

function toMillis(value: Date | string | number): number {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.valueOf()
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

export type ReconcileResult = Readonly<{ checked: number; activated: number; declined: number; cancelled: number }>

export async function reconcileCharges(ledger: ChargeLedger, clientFor: (charge: LocalCharge) => ShopifyBillingClient | Promise<ShopifyBillingClient>, now = Date.now()): Promise<ReconcileResult> {
  const pending = await ledger.listPending()
  let activated = 0; let declined = 0; let cancelled = 0
  for (const charge of pending) {
    if (now - charge.createdAt >= 7 * 86_400_000) { await ledger.update(charge.id, 'DECLINED', now); declined += 1; continue }
    try {
      const remote: RecurringCharge = await (await clientFor(charge)).verifyCharge(charge.id, { plan: charge.plan, interval: charge.interval })
      if (remote.status === 'active' || remote.status === 'accepted') { await ledger.update(charge.id, 'ACTIVE', now); activated += 1 } else if (remote.status === 'declined' || remote.status === 'expired') { await ledger.update(charge.id, 'DECLINED', now); declined += 1 }
    } catch { await ledger.update(charge.id, 'CANCELLED', now); cancelled += 1 }
  }
  return { checked: pending.length, activated, declined, cancelled }
}
