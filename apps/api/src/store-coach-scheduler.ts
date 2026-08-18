import type { Logger } from '@profitpilot/logger'
import type { SqlExecutor } from '@profitpilot/db'
import type { StoreId } from '@profitpilot/types'
import type { StoreCoachService } from './store-coach-service.js'

/**
 * PR #48 — Store Coach scheduler. Ticks hourly inside the API process (the
 * same pattern as the automation trigger scheduler) and:
 *  1. Generates each store's daily huddle at its preferred huddle time in the
 *     merchant's own timezone.
 *  2. On Sunday at 20:00 merchant-local time, generates the weekly review and
 *     emails the digest when the store has a verified merchant email and
 *     weekly_email_enabled.
 *  3. Refreshes engagement badges and health scores periodically.
 * Every step is idempotent: huddles and reports are keyed by merchant-local
 * date, and generation failures for one store never block the next store.
 */

export type StoreCoachSchedulerDependencies = Readonly<{
  database: SqlExecutor
  service: StoreCoachService
  logger: Logger
  now?: () => Date
}>

export class StoreCoachScheduler {
  private readonly database: SqlExecutor
  private readonly service: StoreCoachService
  private readonly logger: Logger
  private readonly now: () => Date
  private lastBadgeSweepHour = -1

  public constructor(deps: StoreCoachSchedulerDependencies) {
    this.database = deps.database
    this.service = deps.service
    this.logger = deps.logger
    this.now = deps.now ?? (() => new Date())
  }

  public async tick(): Promise<Readonly<{ huddlesGenerated: number; reviewsGenerated: number; emailsSent: number; errors: number }>> {
    const stores = await this.listStores()
    let huddlesGenerated = 0
    let reviewsGenerated = 0
    let emailsSent = 0
    let errors = 0
    const at = this.now()
    for (const storeId of stores) {
      try {
        const due = await this.huddleDue(storeId, at)
        if (due) {
          await this.service.generateHuddle(storeId)
          huddlesGenerated += 1
        }
        const reviewDue = await this.reviewDue(storeId, at)
        if (reviewDue) {
          const review = await this.service.generateReview(storeId)
          reviewsGenerated += 1
          const sent = await this.tryEmailReview(storeId, review.id as string)
          if (sent) emailsSent += 1
        }
      } catch (error: unknown) {
        errors += 1
        this.logger.warn('Store Coach scheduler step failed for store', { storeId: String(storeId), reason: error instanceof Error ? error.message : String(error) })
      }
    }
    // Hourly badge/health sweep across all stores.
    const hour = at.getUTCHours()
    if (hour !== this.lastBadgeSweepHour) {
      this.lastBadgeSweepHour = hour
      for (const storeId of stores) {
        try {
          await this.service.evaluateEngagementBadges(storeId)
          await this.service.refreshHealthScore(storeId)
        } catch {
          // Sweeps are best-effort; engagement badges also award on direct activity.
        }
      }
    }
    return { huddlesGenerated, reviewsGenerated, emailsSent, errors }
  }

  private async listStores(): Promise<readonly StoreId[]> {
    const result = await this.database.query<{ id: string }>('SELECT id FROM stores ORDER BY created_at')
    return result.rows.map((row) => row.id as StoreId)
  }

  /** A huddle is due when the merchant-local hour matches their huddle time. */
  private async huddleDue(storeId: StoreId, at: Date): Promise<boolean> {
    const [hour, day] = await Promise.all([
      this.service.merchantHour(storeId, at),
      this.service.merchantDay(storeId, at),
    ])
    const preferences = await this.service.preferences(storeId)
    if (!preferences.huddleEnabled) return false
    const huddleHour = Math.floor(preferences.huddleTimeMinutes / 60)
    if (hour !== huddleHour) return false
    const existing = await this.service.huddleForDate(storeId, day)
    return existing === null
  }

  /** The Sunday digest runs at 20:00 merchant-local time. */
  private async reviewDue(storeId: StoreId, at: Date): Promise<boolean> {
    const dayOfWeek = new Date(`${await this.service.merchantDay(storeId, at)}T00:00:00Z`).getUTCDay()
    if (dayOfWeek !== 0) return false
    const hour = await this.service.merchantHour(storeId, at)
    if (hour !== 20) return false
    const preferences = await this.service.preferences(storeId)
    return preferences.weeklyEmailEnabled
  }

  private async tryEmailReview(storeId: StoreId, reviewId: string): Promise<boolean> {
    try {
      const result = await this.service.emailReview(storeId, reviewId)
      return result.sent
    } catch {
      // No verified merchant email or mailer disabled — the review itself is
      // still persisted for the in-app Sunday card.
      return false
    }
  }
}
