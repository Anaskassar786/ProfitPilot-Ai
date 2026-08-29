import { describe, expect, it } from 'vitest'
import { PostgresTrialGiftStore, expiredGiftRevert, normalizeForfeitedTrial } from './trials.js'
import type { GiftCode } from './trials.js'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'

const DAY = 86_400_000
const T0 = Date.parse('2026-08-25T00:00:00.000Z')

/**
 * A stateful fake Postgres that models gift_codes / gift_redemptions / trials
 * so the `PostgresTrialGiftStore` SQL writes are reflected in subsequent reads.
 * The store's own in-process cache is deliberately ABOVE this fake — that is
 * precisely where the regression below lives: after `redeemGift` the cache must
 * be refreshed or it keeps serving a pre-redemption ACTIVE trial.
 */
class FakeExecutor implements SqlExecutor {
  public readonly gifts = new Map<string, { code: string; max_uses: number; uses: number; active: boolean; duration_days: number; access_level: string; expires_at: number | null; sequence: number }>()
  public readonly redemptions = new Map<string, { shop_id: string; code: string; redeemed_at: number; expires_at: number }>()
  public readonly trials = new Map<string, { shop_id: string; started_at: number; expires_at: number; consumed: boolean; state: string; trial_forfeited: boolean }>()

  public seedGift(gift: GiftCode): void {
    this.gifts.set(gift.code.toUpperCase(), {
      code: gift.code.toUpperCase(), max_uses: gift.maxUses, uses: gift.uses, active: gift.active,
      duration_days: gift.durationDays, access_level: gift.accessLevel, expires_at: gift.expiresAt, sequence: gift.sequence,
    })
  }

  public async withTransaction<Value>(operation: (client: SqlExecutor) => Promise<Value>): Promise<Value> {
    return operation(this)
  }

  public async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
    const rows: Row[] = [] as unknown as Row[]
    const q = text.trim()

    if (q.startsWith('SELECT set_config')) return { rows, rowCount: 0 }

    if (/FROM gift_codes/.test(q)) {
      const rowsList = [...this.gifts.values()]
      if (/upper\(code\) = \$1/i.test(q)) {
        const code = String(values[0]).toUpperCase()
        const found = rowsList.find((r) => r.code === code)
        return { rows: (found ? [found] : []) as unknown as Row[], rowCount: found ? 1 : 0 }
      }
      const seq = Number(values[0])
      const earlier = rowsList.filter((r) => r.sequence < seq).sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code))
      return { rows: earlier as unknown as Row[], rowCount: earlier.length }
    }

    if (/INSERT INTO gift_codes/i.test(q)) {
      const code = String(values[0]).toUpperCase()
      if (!this.gifts.has(code)) {
        this.gifts.set(code, { code, max_uses: Number(values[1]), uses: Number(values[2]), active: Boolean(values[3]), duration_days: Number(values[4]), access_level: String(values[5]), expires_at: values[6] == null ? null : toMillis(values[6]), sequence: Number(values[7]) })
      }
      return { rows, rowCount: 1 }
    }

    if (/UPDATE gift_codes/i.test(q)) {
      const code = String(values[0]).toUpperCase()
      const g = this.gifts.get(code)
      if (g) { g.uses += 1; if (g.uses >= g.max_uses) g.active = false }
      return { rows, rowCount: g ? 1 : 0 }
    }

    if (/FROM gift_redemptions/i.test(q)) {
      const shopId = String(values[0])
      const found = this.redemptions.get(shopId)
      return { rows: (found ? [found] : []) as unknown as Row[], rowCount: found ? 1 : 0 }
    }

    if (/INSERT INTO gift_redemptions/i.test(q)) {
      const row = { shop_id: String(values[0]), code: String(values[1]), redeemed_at: toMillis(values[2]), expires_at: toMillis(values[3]) }
      this.redemptions.set(row.shop_id, row)
      return { rows: [row] as unknown as Row[], rowCount: 1 }
    }

    if (/FROM trials/i.test(q)) {
      const shopId = String(values[0])
      const found = this.trials.get(shopId)
      return { rows: (found ? [found] : []) as unknown as Row[], rowCount: found ? 1 : 0 }
    }

    // trials INSERT ... ON CONFLICT (upsert) — preserve started_at.
    // The gift-forfeit upsert hardcodes `true, 'CANCELLED', true` as SQL
    // literals (only 3 params); initial/repair writes pass them as params.
    if (/INSERT INTO trials/i.test(q)) {
      const shopId = String(values[0])
      const existing = this.trials.get(shopId)
      const isForfeit = q.includes("'CANCELLED'")
      this.trials.set(shopId, {
        shop_id: shopId,
        started_at: existing?.started_at ?? toMillis(values[1]),
        expires_at: existing ? Math.min(existing.expires_at, toMillis(values[2])) : toMillis(values[2]),
        consumed: isForfeit ? true : Boolean(values[3]),
        state: isForfeit ? 'CANCELLED' : String(values[4]),
        trial_forfeited: isForfeit ? true : Boolean(values[5]),
      })
      return { rows, rowCount: 1 }
    }

    throw new Error(`Unexpected SQL in fake executor: ${q.slice(0, 120)}`)
  }
}

function toMillis(value: unknown): number {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.valueOf()
  return Date.parse(String(value))
}

describe('PostgresTrialGiftStore.redeemGift cache refresh (regression)', () => {
  it('reports the trial as forfeited AFTER a gift redemption in the same process', async () => {
    const executor = new FakeExecutor()
    executor.seedGift({ code: 'PRIMARY-TEST', maxUses: 100, uses: 0, active: true, durationDays: 3, accessLevel: 'commander', expiresAt: null, sequence: 1 })
    const store = new PostgresTrialGiftStore(executor, [])

    // Store views billing during install -> ACTIVE 14-day trial is created + cached.
    const created = await store.ensureTrial('s', T0)
    expect(created.state).toBe('ACTIVE')
    expect(created.trialForfeited).toBe(false)

    // Merchant redeems a gift.
    const redemption = await store.redeemGift('s', 'PRIMARY-TEST', T0 + DAY)
    expect(redemption.code).toBe('PRIMARY-TEST')

    // The DB row is now forfeited.
    expect(executor.trials.get('s')?.trial_forfeited).toBe(true)
    expect(executor.trials.get('s')?.consumed).toBe(true)

    // Later, still in the same process, the trial must NOT come back ACTIVE.
    const later = T0 + 5 * DAY // the 3-day gift window has closed
    const trial = await store.trial('s', later)
    expect(trial?.trialForfeited).toBe(true)
    expect(trial?.consumed).toBe(true)
    expect(trial?.state).toBe('CANCELLED')
  })

  it('expiredGiftRevert does not resurrect the trial after the gift window closes', async () => {
    const executor = new FakeExecutor()
    executor.seedGift({ code: 'PRIMARY-TEST', maxUses: 100, uses: 0, active: true, durationDays: 3, accessLevel: 'commander', expiresAt: null, sequence: 1 })
    const store = new PostgresTrialGiftStore(executor, [])
    await store.ensureTrial('s', T0)
    const redemption = await store.redeemGift('s', 'PRIMARY-TEST', T0 + DAY)
    const later = T0 + 5 * DAY
    const trial = await store.trial('s', later) ?? null
    const giftRecord = { storeId: 's' as const, plan: 'commander' as const, state: 'GIFT_ACCESS_UNLIMITED' as const, currentPeriodEnd: redemption.expiresAt, version: 3, interval: null, chargeId: null }
    const reverted = expiredGiftRevert(giftRecord, trial, later)
    expect(reverted?.state).toBe('TRIAL_EXPIRED')
    if (trial) expect(normalizeForfeitedTrial(trial, later)?.state).toBe('CANCELLED')
  })
})
