import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { PlanCode } from './plans.js'

export const FUNNEL_MILESTONES = ['install', 'oauth_complete', 'first_sync_complete', 'first_recommendation_shown', 'first_recommendation_approved', 'first_action_executed', 'first_attributed_revenue'] as const
export type FunnelMilestone = (typeof FUNNEL_MILESTONES)[number]
export type FunnelEvent = Readonly<{ shopId: string; milestone: FunnelMilestone; at: number }>

export class FunnelLedger {
  private readonly events = new Map<string, FunnelEvent>()
  public record(shopId: string, milestone: FunnelMilestone, at = Date.now()): boolean { const key = `${shopId}:${milestone}`; if (this.events.has(key)) return false; this.events.set(key, { shopId, milestone, at }); return true }
  public milestones(shopId: string): readonly FunnelEvent[] { return FUNNEL_MILESTONES.flatMap((milestone) => { const event = this.events.get(`${shopId}:${milestone}`); return event ? [event] : [] }) }
  public has(shopId: string, milestone: FunnelMilestone): boolean { return this.events.has(`${shopId}:${milestone}`) }
}

export type GrandfatheredPrice = Readonly<{ shopId: string; plan: PlanCode; interval: 'MONTHLY' | 'ANNUAL'; price: number; priceLockedAt: number; grandfathered: boolean; noticeDueAt: number | null }>
export function lockPrice(shopId: string, plan: PlanCode, interval: 'MONTHLY' | 'ANNUAL', price: number, now = Date.now()): GrandfatheredPrice { return { shopId, plan, interval, price, priceLockedAt: now, grandfathered: true, noticeDueAt: now + 30 * 86_400_000 } }
export function priceForRenewal(record: GrandfatheredPrice, currentPrice: number): number { return record.grandfathered ? record.price : currentPrice }

export type RoiMetrics = Readonly<{ attributedRevenue: number; aiCostDollars: number; netReturn: number; multiple: number | null }>
export function calculateRoi(attributedRevenue: number, aiCostMicroDollars: number): RoiMetrics { const aiCostDollars = aiCostMicroDollars / 1_000_000; return { attributedRevenue, aiCostDollars, netReturn: attributedRevenue - aiCostDollars, multiple: aiCostDollars === 0 ? null : attributedRevenue / aiCostDollars } }

export class AdminStepUpSessions {
  private readonly sessions = new Map<string, number>()
  private readonly timeoutMs: number
  public constructor(timeoutMinutes = 15) { this.timeoutMs = timeoutMinutes * 60_000 }
  public issue(adminKey: string, configuredKey: string, now = Date.now()): string { if (!safeSecretEqual(adminKey, configuredKey)) throw new Error('Invalid admin key'); const token = createHash('sha256').update(`${adminKey}:${now}:${randomBytes(16).toString('hex')}`).digest('hex'); this.sessions.set(token, now + this.timeoutMs); return token }
  public valid(token: string, now = Date.now()): boolean { const expiry = this.sessions.get(token); if (!expiry) return false; if (expiry <= now) { this.sessions.delete(token); return false } return true }
}
function safeSecretEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.byteLength === b.byteLength && timingSafeEqual(a, b) }
