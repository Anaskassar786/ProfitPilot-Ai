import { AppError } from '@profitpilot/types'
import { GIFT_ALREADY_REDEEMED, USE_PRIMARY_PROMO_FIRST } from '@profitpilot/billing'

/**
 * Gift-code policy for the API layer (GA 2026-08-22).
 *
 * Canonical merchant-facing copy and the eligibility pre-checks that back the
 * enforcement already guaranteed atomically inside `redeemGift`
 * (single-use limit + primary/secondary sequencing). Keeping the policy here
 * gives the route one place to (a) reject an already-redeemed store with a
 * fast 400 before it ever touches a code and (b) translate any redemption
 * failure into a merchant-readable reason.
 */
export { GIFT_ALREADY_REDEEMED, USE_PRIMARY_PROMO_FIRST }

export type GiftConflictReason = 'ALREADY_REDEEMED' | 'PRIMARY_ACTIVE' | 'PAID_PLAN_ACTIVE' | 'GIFT_EXPIRED' | 'GIFT_EXHAUSTED'

/** Minimal redemption surface used for the pre-flight single-use guard. */
export type GiftRedemptionReader = Readonly<{
  redemption: (shopId: string) => Promise<unknown> | unknown
}>

/**
 * Single-use limit: a store can redeem at most ONE gift code in its lifetime.
 * Rejects with HTTP 400 before the redemption is attempted. The authoritative
 * (atomic, Postgres-backed) check lives in `redeemGift`; this is a fast
 * pre-flight guard that keeps an already-redeemed store from consuming work.
 */
export async function assertGiftSingleUse(trials: GiftRedemptionReader, shopId: string): Promise<void> {
  const existing = await Promise.resolve(trials.redemption(shopId))
  if (existing) throw new AppError('CONFLICT', GIFT_ALREADY_REDEEMED, 400, { shopId })
}

/** Translates a thrown redemption error into a merchant-readable conflict. */
export function giftConflictReason(error: unknown): GiftConflictReason | null {
  if (!(error instanceof AppError)) return null
  const details = (error as AppError & { details?: Record<string, unknown> }).details
  const reason = typeof details?.reason === 'string' ? details.reason : ''
  if (error.status === 400 && error.message === GIFT_ALREADY_REDEEMED) return 'ALREADY_REDEEMED'
  if (error.status === 400 && error.message === USE_PRIMARY_PROMO_FIRST) return 'PRIMARY_ACTIVE'
  if (reason === 'PAID_PLAN_ACTIVE') return 'PAID_PLAN_ACTIVE'
  if (reason === 'GIFT_EXPIRED') return 'GIFT_EXPIRED'
  if (error.status === 400 && /exhausted|invalid/i.test(error.message)) return 'GIFT_EXHAUSTED'
  return null
}
