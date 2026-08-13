import { AppError } from '@profitpilot/types'
import type { BillingState, Subscription } from './billing.js'
import type { PlanTier } from '@profitpilot/types'

export type TrialRecord = Readonly<{ shopId: string; startedAt: number; expiresAt: number; consumed: boolean; state: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' }>
export type GiftCode = Readonly<{ code: string; maxUses: number; uses: number; active: boolean; durationDays: number; accessLevel: 'commander' }>
export type GiftRedemption = Readonly<{ shopId: string; code: string; redeemedAt: number; expiresAt: number }>

export const DEFAULT_GIFT_CODES: readonly GiftCode[] = [
  { code: 'KASSAR786', maxUses: 100, uses: 0, active: true, durationDays: 3, accessLevel: 'commander' },
  { code: 'AFRIDI786', maxUses: 10_000, uses: 0, active: true, durationDays: 3, accessLevel: 'commander' },
]

export class TrialAndGiftLedger {
  private readonly trials = new Map<string, TrialRecord>()
  private readonly gifts: Map<string, GiftCode>
  public constructor(codes: readonly GiftCode[] = DEFAULT_GIFT_CODES) {
    this.gifts = new Map(codes.map((code) => [code.code.trim().toUpperCase(), code]))
  }
  private readonly redemptions = new Map<string, GiftRedemption>()
  private giftKillSwitch = false

  public startTrial(shopId: string, now = Date.now(), days = 14): TrialRecord {
    const existing = this.trials.get(shopId)
    if (existing) return existing
    const trial: TrialRecord = { shopId, startedAt: now, expiresAt: now + days * 86_400_000, consumed: false, state: 'ACTIVE' }
    this.trials.set(shopId, trial)
    return trial
  }

  public trial(shopId: string, now = Date.now()): TrialRecord | null {
    const current = this.trials.get(shopId)
    if (!current) return null
    if (current.state === 'ACTIVE' && current.expiresAt <= now) { const expired = { ...current, state: 'EXPIRED' as const }; this.trials.set(shopId, expired); return expired }
    return current
  }

  public redeemGift(shopId: string, rawCode: string, now = Date.now()): GiftRedemption {
    if (this.giftKillSwitch) throw new AppError('FORBIDDEN', 'Gift code redemption is disabled', 403)
    if (this.redemptions.has(shopId)) throw new AppError('CONFLICT', 'This store has already redeemed a gift code', 409, { shopId })
    const code = rawCode.trim().toUpperCase()
    const gift = this.gifts.get(code)
    if (!gift || !gift.active || gift.uses >= gift.maxUses) throw new AppError('VALIDATION_ERROR', 'Gift code is invalid or exhausted', 400)
    const trial = this.trials.get(shopId)
    if (trial?.consumed) throw new AppError('CONFLICT', 'Trial or gift access was already consumed', 409)
    if (trial) this.trials.set(shopId, { ...trial, consumed: true, state: 'CANCELLED' })
    const nextGift = { ...gift, uses: gift.uses + 1, active: gift.uses + 1 < gift.maxUses }
    this.gifts.set(code, nextGift)
    const redemption: GiftRedemption = { shopId, code, redeemedAt: now, expiresAt: now + gift.durationDays * 86_400_000 }
    this.redemptions.set(shopId, redemption)
    return redemption
  }

  public expiringTrials(now = Date.now(), withinMs = 24 * 60 * 60 * 1000): readonly TrialRecord[] { return [...this.trials.values()].filter((trial) => trial.state === 'ACTIVE' && trial.expiresAt > now && trial.expiresAt - now <= withinMs) }
  public setGiftKillSwitch(active: boolean): void { this.giftKillSwitch = active }
  public gift(code: string): GiftCode | null { return this.gifts.get(code.trim().toUpperCase()) ?? null }
  public redemption(shopId: string): GiftRedemption | null { return this.redemptions.get(shopId) ?? null }
}

export function subscriptionForTrial(shopId: string, trial: TrialRecord, now = Date.now()): Subscription {
  return { storeId: shopId, plan: 'trial' as PlanTier, state: trial.state === 'ACTIVE' && trial.expiresAt > now ? 'TRIAL_LIMITED' : 'PENDING_CONFIRMATION', currentPeriodEnd: trial.expiresAt, version: 0 }
}
