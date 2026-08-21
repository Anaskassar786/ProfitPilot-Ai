import { AppError } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { Subscription } from './billing.js'
import type { PlanTier } from '@profitpilot/types'
import type { BillingRecord } from './repository.js'

export type TrialRecord = Readonly<{ shopId: string; startedAt: number; expiresAt: number; consumed: boolean; state: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' }>
export type GiftCode = Readonly<{ code: string; maxUses: number; uses: number; active: boolean; durationDays: number; accessLevel: 'commander'; expiresAt: number | null }>
export type GiftRedemption = Readonly<{ shopId: string; code: string; redeemedAt: number; expiresAt: number }>

export const DEFAULT_TRIAL_DAYS = 14
export const DEFAULT_GIFT_CODES: readonly GiftCode[] = [
  { code: 'KASSAR786', maxUses: 100, uses: 0, active: true, durationDays: 3, accessLevel: 'commander', expiresAt: null },
  { code: 'AFRIDI786', maxUses: 10_000, uses: 0, active: true, durationDays: 3, accessLevel: 'commander', expiresAt: null },
]

/** QA (2026-08-20): distinct "expired" errors instead of lumping expired and
 *  unknown codes into one message. */
export function giftCodeError(gift: GiftCode | null, now: number): AppError | null {
  if (!gift || gift.uses >= gift.maxUses) return new AppError('VALIDATION_ERROR', 'Gift code is invalid or exhausted', 400)
  if (!gift.active) return new AppError('VALIDATION_ERROR', 'This gift code has expired', 400, { reason: 'GIFT_EXPIRED' })
  if (gift.expiresAt !== null && gift.expiresAt <= now) return new AppError('VALIDATION_ERROR', 'This gift code has expired', 400, { reason: 'GIFT_EXPIRED' })
  return null
}

/**
 * Gift expiry enforcement (GA 2026-08-21).
 *
 * A redeemed gift grants Commander for `durationDays`. Once
 * `currentPeriodEnd` passes, the store must NOT keep Commander entitlements:
 * it reverts to its previous plan state — Trial (TRIAL_LIMITED) when the
 * 14-day trial is still running, otherwise locked (PENDING_CONFIRMATION).
 * Returns the corrected record to persist, or `null` when nothing changed.
 */
export function expiredGiftRevert(record: BillingRecord | null, trial: TrialRecord | null, now = Date.now()): BillingRecord | null {
  if (!record || record.state !== 'GIFT_ACCESS_UNLIMITED') return null
  if (record.currentPeriodEnd === null || record.currentPeriodEnd > now) return null
  const trialActive = trial !== null && trial.state === 'ACTIVE' && trial.expiresAt > now
  return {
    ...record,
    plan: 'trial',
    state: trialActive ? 'TRIAL_LIMITED' : 'PENDING_CONFIRMATION',
    currentPeriodEnd: trialActive ? trial.expiresAt : record.currentPeriodEnd,
    version: record.version + 1,
    interval: null,
    chargeId: null,
  }
}

/**
 * In-memory ledger used by unit tests and as a process cache on top of
 * Postgres. Production paths go through {@link PostgresTrialGiftStore} so
 * trials and gift redemptions survive server restarts.
 */
export class TrialAndGiftLedger {
  private readonly trials = new Map<string, TrialRecord>()
  private readonly gifts: Map<string, GiftCode>
  public constructor(codes: readonly GiftCode[] = DEFAULT_GIFT_CODES) {
    this.gifts = new Map(codes.map((code) => [code.code.trim().toUpperCase(), { ...code, code: code.code.trim().toUpperCase() }]))
  }
  private readonly redemptions = new Map<string, GiftRedemption>()
  private giftKillSwitch = false

  public hydrate(trial: TrialRecord): void { if (!this.trials.has(trial.shopId)) this.trials.set(trial.shopId, trial) }
  public hydrateGift(code: GiftCode): void { this.gifts.set(code.code.trim().toUpperCase(), { ...code, code: code.code.trim().toUpperCase() }) }
  public hydrateRedemption(redemption: GiftRedemption): void { this.redemptions.set(redemption.shopId, redemption) }

  public startTrial(shopId: string, now = Date.now(), days = DEFAULT_TRIAL_DAYS): TrialRecord {
    const existing = this.trials.get(shopId)
    if (existing) return existing
    const trial: TrialRecord = { shopId, startedAt: now, expiresAt: now + days * 86_400_000, consumed: false, state: 'ACTIVE' }
    this.trials.set(shopId, trial)
    return trial
  }

  public trial(shopId: string, now = Date.now()): TrialRecord | null {
    const current = this.trials.get(shopId)
    if (!current) return null
    if (current.state === 'ACTIVE' && current.expiresAt <= now) {
      const expired = { ...current, state: 'EXPIRED' as const }
      this.trials.set(shopId, expired)
      return expired
    }
    return current
  }

  public redeemGift(shopId: string, rawCode: string, now = Date.now()): GiftRedemption {
    if (this.giftKillSwitch) throw new AppError('FORBIDDEN', 'Gift code redemption is disabled', 403)
    if (this.redemptions.has(shopId)) throw new AppError('CONFLICT', 'This store has already redeemed a gift code', 409, { shopId })
    const code = rawCode.trim().toUpperCase()
    const gift = this.gifts.get(code) ?? null
    const invalid = giftCodeError(gift, now)
    if (invalid) throw invalid
    const activeGift = gift as GiftCode
    const trial = this.trials.get(shopId) ?? null
    if (trial?.consumed) throw new AppError('CONFLICT', 'Trial or gift access was already consumed', 409)
    // The gift OVERRIDES the trial while its window is open, but the trial is
    // left intact so the store reverts to it when the gift expires (Trial if
    // still valid, else locked). Only an explicit upgrade cancels the trial.
    const nextGift = { ...activeGift, uses: activeGift.uses + 1, active: activeGift.uses + 1 < activeGift.maxUses }
    this.gifts.set(code, nextGift)
    const redemption: GiftRedemption = { shopId, code, redeemedAt: now, expiresAt: now + activeGift.durationDays * 86_400_000 }
    this.redemptions.set(shopId, redemption)
    return redemption
  }

  /** Ends an ACTIVE trial (used when a merchant upgrades during the trial). */
  public cancelTrial(shopId: string): TrialRecord | null {
    const current = this.trials.get(shopId) ?? null
    if (!current || current.state === 'CANCELLED' || current.consumed) return current
    const cancelled = { ...current, consumed: true, state: 'CANCELLED' as const }
    this.trials.set(shopId, cancelled)
    return cancelled
  }

  public expiringTrials(now = Date.now(), withinMs = 24 * 60 * 60 * 1000): readonly TrialRecord[] {
    return [...this.trials.values()].filter((trial) => trial.state === 'ACTIVE' && trial.expiresAt > now && trial.expiresAt - now <= withinMs)
  }
  public setGiftKillSwitch(active: boolean): void { this.giftKillSwitch = active }
  public isGiftKillSwitchActive(): boolean { return this.giftKillSwitch }
  public gift(code: string): GiftCode | null { return this.gifts.get(code.trim().toUpperCase()) ?? null }
  public redemption(shopId: string): GiftRedemption | null { return this.redemptions.get(shopId) ?? null }
}

type TrialRow = QueryResultRow & { shop_id: string; started_at: Date | string | number; expires_at: Date | string | number; consumed: boolean; state: TrialRecord['state'] }
type GiftCodeRow = QueryResultRow & { code: string; max_uses: number; uses: number; active: boolean; duration_days: number; access_level: string; expires_at: Date | string | number | null }
type GiftRedemptionRow = QueryResultRow & { shop_id: string; code: string; redeemed_at: Date | string | number; expires_at: Date | string | number }

function toMillis(value: Date | string | number): number {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.valueOf()
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function mapTrial(row: TrialRow): TrialRecord {
  return {
    shopId: row.shop_id,
    startedAt: toMillis(row.started_at),
    expiresAt: toMillis(row.expires_at),
    consumed: Boolean(row.consumed),
    state: row.state,
  }
}

function mapGift(row: GiftCodeRow): GiftCode {
  return {
    code: String(row.code).trim().toUpperCase(),
    maxUses: Number(row.max_uses),
    uses: Number(row.uses),
    active: Boolean(row.active),
    durationDays: Number(row.duration_days) || 3,
    accessLevel: 'commander',
    expiresAt: row.expires_at == null ? null : toMillis(row.expires_at),
  }
}

function mapRedemption(row: GiftRedemptionRow): GiftRedemption {
  return {
    shopId: row.shop_id,
    code: String(row.code).trim().toUpperCase(),
    redeemedAt: toMillis(row.redeemed_at),
    expiresAt: toMillis(row.expires_at),
  }
}

/**
 * Postgres-backed trial + gift store. Survives process restarts by reading and
 * writing the `trials`, `gift_codes`, and `gift_redemptions` tables.
 *
 * gift_codes is global (no tenant RLS policy); trials and redemptions are
 * tenant-scoped and must run inside a store context transaction.
 */
export class PostgresTrialGiftStore {
  private readonly executor: SqlExecutor
  private readonly cache: TrialAndGiftLedger
  private giftKillSwitch = false

  public constructor(executor: SqlExecutor, seedCodes: readonly GiftCode[] = DEFAULT_GIFT_CODES) {
    this.executor = executor
    this.cache = new TrialAndGiftLedger(seedCodes)
  }

  /** Expose the in-memory cache for admin kill-switch and test helpers. */
  public get ledger(): TrialAndGiftLedger { return this.cache }

  public setGiftKillSwitch(active: boolean): void {
    this.giftKillSwitch = active
    this.cache.setGiftKillSwitch(active)
  }

  public isGiftKillSwitchActive(): boolean { return this.giftKillSwitch }

  public async ensureTrial(shopId: string, now = Date.now(), days = DEFAULT_TRIAL_DAYS): Promise<TrialRecord> {
    const cached = this.cache.trial(shopId, now)
    if (cached) return cached

    const loaded = await this.loadTrial(shopId)
    if (loaded) {
      const live = loaded.state === 'ACTIVE' && loaded.expiresAt <= now
        ? { ...loaded, state: 'EXPIRED' as const }
        : loaded
      if (live.state === 'EXPIRED' && loaded.state === 'ACTIVE') {
        await this.persistTrial(live).catch(() => undefined)
      }
      this.cache.hydrate(live)
      return this.cache.trial(shopId, now) ?? live
    }

    const created: TrialRecord = {
      shopId,
      startedAt: now,
      expiresAt: now + days * 86_400_000,
      consumed: false,
      state: 'ACTIVE',
    }
    await this.persistTrial(created)
    this.cache.hydrate(created)
    return created
  }

  public async trial(shopId: string, now = Date.now()): Promise<TrialRecord | null> {
    const cached = this.cache.trial(shopId, now)
    if (cached) return cached
    const loaded = await this.loadTrial(shopId)
    if (!loaded) return null
    const live = loaded.state === 'ACTIVE' && loaded.expiresAt <= now
      ? { ...loaded, state: 'EXPIRED' as const }
      : loaded
    if (live.state === 'EXPIRED' && loaded.state === 'ACTIVE') {
      await this.persistTrial(live).catch(() => undefined)
    }
    this.cache.hydrate(live)
    return this.cache.trial(shopId, now) ?? live
  }

  public async redemption(shopId: string): Promise<GiftRedemption | null> {
    const cached = this.cache.redemption(shopId)
    if (cached) return cached
    const loaded = await this.loadRedemption(shopId)
    if (loaded) this.cache.hydrateRedemption(loaded)
    return loaded
  }

  public async redeemGift(shopId: string, rawCode: string, now = Date.now()): Promise<GiftRedemption> {
    if (this.giftKillSwitch) throw new AppError('FORBIDDEN', 'Gift code redemption is disabled', 403)
    const code = rawCode.trim().toUpperCase()
    if (!code) throw new AppError('VALIDATION_ERROR', 'Gift code is required', 400)

    // Atomic redemption (GA 2026-08-21): the gift-code validity re-check, the
    // `uses` increment, the redemption INSERT, and the trial cancel all run in
    // ONE transaction with `FOR UPDATE` on the global gift_codes row. Two
    // stores can no longer race for the last available use of a code, and a
    // crash mid-way can never persist a redemption without consuming the code.
    const redemption = await this.withTenant(shopId, async (client) => {
      // gift_codes is a global table (no tenant RLS); locking the row here
      // serialises concurrent redemptions of the same code.
      const lockResult = await client.query<GiftCodeRow>(
        'SELECT code, max_uses, uses, active, duration_days, access_level, expires_at FROM gift_codes WHERE upper(code) = $1 LIMIT 1 FOR UPDATE',
        [code],
      )
      let giftRow = lockResult.rows[0]
      if (!giftRow) {
        // Fall back to seed defaults if the migration seed is missing (dev DBs).
        const seeded = this.cache.gift(code)
        if (!seeded || !seeded.active || seeded.uses >= seeded.maxUses) {
          throw new AppError('VALIDATION_ERROR', 'Gift code is invalid or exhausted', 400)
        }
        await client.query(
          `INSERT INTO gift_codes (code, max_uses, uses, active, duration_days, access_level, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (code) DO NOTHING`,
          [seeded.code, seeded.maxUses, seeded.uses, seeded.active, seeded.durationDays, seeded.accessLevel, seeded.expiresAt],
        )
        giftRow = (await client.query<GiftCodeRow>(
          'SELECT code, max_uses, uses, active, duration_days, access_level, expires_at FROM gift_codes WHERE upper(code) = $1 LIMIT 1 FOR UPDATE',
          [code],
        )).rows[0]
      }
      const gift = giftRow ? mapGift(giftRow) : null
      const invalid = giftCodeError(gift, now)
      if (invalid) throw invalid
      const activeGift = gift as GiftCode

      const existing = await client.query<GiftRedemptionRow>(
        'SELECT shop_id, code, redeemed_at, expires_at FROM gift_redemptions WHERE shop_id = $1 LIMIT 1',
        [shopId],
      )
      if (existing.rows[0]) {
        throw new AppError('CONFLICT', 'This store has already redeemed a gift code', 409, { shopId })
      }

      const trialResult = await client.query<TrialRow>(
        'SELECT shop_id, started_at, expires_at, consumed, state FROM trials WHERE shop_id = $1 LIMIT 1',
        [shopId],
      )
      const trialRow = trialResult.rows[0]
      if (trialRow?.consumed) {
        throw new AppError('CONFLICT', 'Trial or gift access was already consumed', 409)
      }

      const expiresAt = now + activeGift.durationDays * 86_400_000
      const inserted = await client.query<GiftRedemptionRow>(
        `INSERT INTO gift_redemptions (shop_id, code, redeemed_at, expires_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))
         RETURNING shop_id, code, redeemed_at, expires_at`,
        [shopId, activeGift.code, now, expiresAt],
      )
      const row = inserted.rows[0]
      if (!row) throw new AppError('INTERNAL_ERROR', 'Failed to persist gift redemption', 500)

      // The gift overrides the trial while its window is open but does NOT
      // cancel it — after the gift expires the store reverts to the trial
      // (Trial if still valid, else locked). Only an explicit upgrade calls
      // cancelTrial().

      // Consume one use atomically (guarded by the FOR UPDATE lock above).
      await client.query(
        `UPDATE gift_codes
         SET uses = uses + 1,
             active = CASE WHEN uses + 1 >= max_uses THEN false ELSE active END
         WHERE upper(code) = $1`,
        [activeGift.code],
      )

      return mapRedemption(row)
    })

    this.cache.hydrateRedemption(redemption)
    const updatedGift = await this.executor.query<GiftCodeRow>(
      'SELECT code, max_uses, uses, active, duration_days, access_level, expires_at FROM gift_codes WHERE upper(code) = $1 LIMIT 1',
      [code],
    )
    if (updatedGift.rows[0]) this.cache.hydrateGift(mapGift(updatedGift.rows[0]))

    return redemption
  }

  /** Ends an ACTIVE trial (e.g. the merchant upgraded during the trial). */
  public async cancelTrial(shopId: string): Promise<TrialRecord | null> {
    const cached = this.cache.trial(shopId)
    if (!cached || cached.state === 'CANCELLED' || cached.consumed) return cached
    const cancelled = await this.withTenant(shopId, async (client) => {
      const result = await client.query<TrialRow>(
        `UPDATE trials SET consumed = true, state = 'CANCELLED' WHERE shop_id = $1 AND state = 'ACTIVE' AND consumed = false
         RETURNING shop_id, started_at, expires_at, consumed, state`,
        [shopId],
      )
      return result.rows[0] ? mapTrial(result.rows[0]) : cached
    })
    this.cache.hydrate({ ...cancelled, consumed: true, state: 'CANCELLED' })
    return cancelled
  }

  public async seedDefaultCodes(codes: readonly GiftCode[] = DEFAULT_GIFT_CODES): Promise<void> {
    for (const gift of codes) {
      await this.executor.query(
        `INSERT INTO gift_codes (code, max_uses, uses, active, duration_days, access_level)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO NOTHING`,
        [gift.code.trim().toUpperCase(), gift.maxUses, gift.uses, gift.active, gift.durationDays, gift.accessLevel],
      )
      this.cache.hydrateGift(gift)
    }
  }

  private async loadTrial(shopId: string): Promise<TrialRecord | null> {
    try {
      return await this.withTenant(shopId, async (client) => {
        const result = await client.query<TrialRow>(
          'SELECT shop_id, started_at, expires_at, consumed, state FROM trials WHERE shop_id = $1 LIMIT 1',
          [shopId],
        )
        return result.rows[0] ? mapTrial(result.rows[0]) : null
      })
    } catch {
      return null
    }
  }

  private async loadRedemption(shopId: string): Promise<GiftRedemption | null> {
    try {
      return await this.withTenant(shopId, async (client) => {
        const result = await client.query<GiftRedemptionRow>(
          'SELECT shop_id, code, redeemed_at, expires_at FROM gift_redemptions WHERE shop_id = $1 LIMIT 1',
          [shopId],
        )
        return result.rows[0] ? mapRedemption(result.rows[0]) : null
      })
    } catch {
      return null
    }
  }

  private async persistTrial(trial: TrialRecord): Promise<void> {
    await this.withTenant(trial.shopId, async (client) => {
      await client.query(
        `INSERT INTO trials (shop_id, started_at, expires_at, consumed, state)
         VALUES ($1, to_timestamp($2 / 1000.0), to_timestamp($3 / 1000.0), $4, $5)
         ON CONFLICT (shop_id) DO UPDATE SET
           started_at = EXCLUDED.started_at,
           expires_at = EXCLUDED.expires_at,
           consumed = EXCLUDED.consumed,
           state = EXCLUDED.state`,
        [trial.shopId, trial.startedAt, trial.expiresAt, trial.consumed, trial.state],
      )
    })
  }

  private async withTenant<T>(shopId: string, operation: (client: SqlExecutor) => Promise<T>): Promise<T> {
    const anyExecutor = this.executor as SqlExecutor & {
      withTransaction?: <Value>(op: (client: SqlExecutor) => Promise<Value>) => Promise<Value>
    }
    if (typeof anyExecutor.withTransaction === 'function') {
      return anyExecutor.withTransaction(async (client: SqlExecutor) => {
        await client.query('SELECT set_config($1, $2, true)', ['app.store_id', shopId])
        return operation(client)
      })
    }
    await this.executor.query('SELECT set_config($1, $2, true)', ['app.store_id', shopId]).catch(() => undefined)
    return operation(this.executor)
  }
}

export function subscriptionForTrial(shopId: string, trial: TrialRecord, now = Date.now()): Subscription {
  return {
    storeId: shopId,
    plan: 'trial' as PlanTier,
    state: trial.state === 'ACTIVE' && trial.expiresAt > now ? 'TRIAL_LIMITED' : 'PENDING_CONFIRMATION',
    currentPeriodEnd: trial.expiresAt,
    version: 0,
  }
}
