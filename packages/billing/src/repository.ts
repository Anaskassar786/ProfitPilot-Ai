import { AppError } from '@profitpilot/types'
import type { SqlExecutor, QueryResultRow } from '@profitpilot/db'
import type { BillingInterval, PlanCode } from './plans.js'
import type { BillingState, Subscription } from './billing.js'

export type BillingRecord = Readonly<Subscription & { interval: BillingInterval | null; chargeId: string | null }>
export interface BillingRepository { get(shopId: string): Promise<BillingRecord | null>; put(record: BillingRecord): Promise<void>; transition(shopId: string, expectedVersion: number, state: BillingState, now: number): Promise<BillingRecord> }

export class InMemoryBillingRepository implements BillingRepository {
  private readonly records = new Map<string, BillingRecord>()
  public async get(shopId: string): Promise<BillingRecord | null> { return this.records.get(shopId) ?? null }
  public async put(record: BillingRecord): Promise<void> {
    const key = record.storeId
    if (!key) throw new AppError('VALIDATION_ERROR', 'storeId is required on billing records', 400)
    this.records.set(key, record)
  }
  public async transition(shopId: string, expectedVersion: number, state: BillingState, now: number): Promise<BillingRecord> { const current = this.records.get(shopId); if (!current || current.version !== expectedVersion) throw new AppError('CONFLICT', 'Billing subscription changed; reload before retrying', 409, { shopId, expectedVersion }); const next = { ...current, state, version: current.version + 1, updatedAt: now } as BillingRecord; this.records.set(shopId, next); return next }
}

type BillingRow = QueryResultRow & { state: BillingState; plan: Subscription['plan']; current_period_end: Date | null; version: number; price_locked_at: Date | null; grandfathered: boolean; interval: BillingInterval | null; charge_id: string | null }
export class PostgresBillingRepository implements BillingRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async get(shopId: string): Promise<BillingRecord | null> { const result = await this.executor.query<BillingRow>('SELECT state, plan, interval, current_period_end, version, price_locked_at, grandfathered, charge_id FROM billing_subscriptions WHERE shop_id = $1 LIMIT 1', [shopId]); const row = result.rows[0]; return row ? mapRow(shopId, row) : null }
  public async put(record: BillingRecord): Promise<void> { await this.executor.query(`INSERT INTO billing_subscriptions (shop_id, state, plan, interval, current_period_end, version, price_locked_at, grandfathered, charge_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (shop_id) DO UPDATE SET state = EXCLUDED.state, plan = EXCLUDED.plan, interval = EXCLUDED.interval, current_period_end = EXCLUDED.current_period_end, version = EXCLUDED.version, price_locked_at = EXCLUDED.price_locked_at, grandfathered = EXCLUDED.grandfathered, charge_id = EXCLUDED.charge_id, updated_at = now()`, [record.storeId, record.state, record.plan, record.interval, record.currentPeriodEnd ? new Date(record.currentPeriodEnd) : null, record.version, record.priceLockedAt ?? null, record.grandfathered ?? false, record.chargeId]) }
  public async transition(shopId: string, expectedVersion: number, state: BillingState, now: number): Promise<BillingRecord> { const result = await this.executor.query<BillingRow>(`UPDATE billing_subscriptions SET state = $3, version = version + 1, updated_at = to_timestamp($4 / 1000.0) WHERE shop_id = $1 AND version = $2 RETURNING state, plan, interval, current_period_end, version, price_locked_at, grandfathered, charge_id`, [shopId, expectedVersion, state, now]); const row = result.rows[0]; if (!row) throw new AppError('CONFLICT', 'Billing subscription changed; reload before retrying', 409, { shopId, expectedVersion }); return mapRow(shopId, row) }
}
function mapRow(shopId: string, row: BillingRow): BillingRecord { return { storeId: shopId, state: row.state, plan: row.plan, interval: row.interval, currentPeriodEnd: row.current_period_end?.valueOf() ?? null, version: row.version, priceLockedAt: row.price_locked_at?.valueOf() ?? null, grandfathered: row.grandfathered, chargeId: row.charge_id } }
