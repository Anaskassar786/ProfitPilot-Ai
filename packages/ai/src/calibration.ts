import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AgentId, ConfidenceLevel } from './domain.js'
import { AGENT_IDS } from './domain.js'

export type CalibrationStats = Readonly<{ accepted: number; rejected: number; confidenceCap: number }>
export type CalibratedConfidence = Readonly<{ score: number; level: ConfidenceLevel; cap: number; stats: CalibrationStats }>
export type CalibrationOutcome = 'accepted' | 'rejected'

export class CalibrationLedger {
  private readonly stats = new Map<AgentId, CalibrationStats>()

  public record(agent: AgentId, outcome: CalibrationOutcome): CalibrationStats {
    const previous = this.stats.get(agent) ?? { accepted: 0, rejected: 0, confidenceCap: 1 }
    const accepted = previous.accepted + (outcome === 'accepted' ? 1 : 0)
    const rejected = previous.rejected + (outcome === 'rejected' ? 1 : 0)
    const next = { accepted, rejected, confidenceCap: capFor(accepted, rejected) }
    this.stats.set(agent, next)
    return next
  }

  /** Replaces in-memory counts with persisted totals (used at bootstrap). */
  public hydrate(agent: AgentId, accepted: number, rejected: number): CalibrationStats {
    const next = { accepted, rejected, confidenceCap: capFor(accepted, rejected) }
    this.stats.set(agent, next)
    return next
  }

  public get(agent: AgentId): CalibrationStats {
    return this.stats.get(agent) ?? { accepted: 0, rejected: 0, confidenceCap: .75 }
  }

  public calibrate(agent: AgentId, rawScore: number): CalibratedConfidence {
    const stats = this.get(agent)
    const score = Math.min(Math.max(rawScore, 0), stats.confidenceCap)
    return { score, level: score >= .9 ? 'HIGH' : score >= .6 ? 'MEDIUM' : 'LOW', cap: stats.confidenceCap, stats }
  }
}

/**
 * Cold start caps confidence at .75 until an agent has 10 decisions; after
 * that the cap tracks the agent's real acceptance rate (floor .4). HIGH
 * confidence (>= .9) therefore only emerges once merchants have approved
 * enough of an agent's recommendations — the PR #46 feedback loop.
 */
function capFor(accepted: number, rejected: number): number {
  const total = accepted + rejected
  if (total < 10) return .75
  return Math.max(.4, 1 - rejected / total)
}

type SampleCountRow = QueryResultRow & { agent: string; outcome: string; total: string | number }

/**
 * Durable calibration samples backed by `ai_calibration_samples` (PR #46).
 * `append` is fire-and-forget safe; `hydrate` restores an in-memory ledger
 * from persisted history so caps survive deploys.
 */
export class PostgresCalibrationStore {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) { this.executor = executor }

  public async append(storeId: string, agent: AgentId, recommendationId: string, outcome: CalibrationOutcome): Promise<void> {
    await this.executor.query(
      'INSERT INTO ai_calibration_samples (store_id, agent, recommendation_id, outcome) VALUES ($1, $2, $3, $4)',
      [storeId, agent, recommendationId, outcome],
    )
  }

  public async hydrate(ledger: CalibrationLedger): Promise<void> {
    const result = await this.executor.query<SampleCountRow>(
      "SELECT agent, outcome, COUNT(*) AS total FROM ai_calibration_samples WHERE outcome IN ('accepted', 'rejected') GROUP BY agent, outcome",
    )
    const totals = new Map<AgentId, { accepted: number; rejected: number }>()
    for (const row of result.rows) {
      const agent = row.agent as AgentId
      if (!AGENT_IDS.includes(agent)) continue
      const current = totals.get(agent) ?? { accepted: 0, rejected: 0 }
      if (row.outcome === 'accepted') current.accepted += Number(row.total)
      else current.rejected += Number(row.total)
      totals.set(agent, current)
    }
    for (const [agent, counts] of totals) ledger.hydrate(agent, counts.accepted, counts.rejected)
  }
}
