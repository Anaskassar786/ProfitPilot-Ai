import type { StoreId } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AgentId, ConfidenceLevel } from './domain.js'

export type CalibrationStats = Readonly<{ accepted: number; rejected: number; confidenceCap: number }>
export type CalibratedConfidence = Readonly<{ score: number; level: ConfidenceLevel; cap: number; stats: CalibrationStats }>
export type CalibrationOutcome = 'accepted' | 'rejected'

/** Durable sink for calibration samples (backed by ai_calibration_samples). */
export interface CalibrationStore {
  append(sample: Readonly<{ storeId: StoreId; agent: AgentId; recommendationId: string | null; outcome: CalibrationOutcome }>): Promise<void>
  counts(): Promise<ReadonlyMap<AgentId, Readonly<{ accepted: number; rejected: number }>>>
}

export class CalibrationLedger {
  private readonly stats = new Map<AgentId, CalibrationStats>()
  private readonly store: CalibrationStore | null
  private hydrated = false

  public constructor(store: CalibrationStore | null = null) { this.store = store }

  /** Loads persisted accept/reject counts so calibration survives restarts. */
  public async hydrate(): Promise<void> {
    if (!this.store || this.hydrated) return
    const counts = await this.store.counts()
    for (const [agent, tally] of counts) {
      this.stats.set(agent, withCap(tally.accepted, tally.rejected))
    }
    this.hydrated = true
  }

  public record(agent: AgentId, outcome: CalibrationOutcome): CalibrationStats {
    const previous = this.stats.get(agent) ?? { accepted: 0, rejected: 0, confidenceCap: 1 }
    const next = withCap(previous.accepted + (outcome === 'accepted' ? 1 : 0), previous.rejected + (outcome === 'rejected' ? 1 : 0))
    this.stats.set(agent, next)
    return next
  }

  /** Records the outcome and persists it to the calibration store when wired. */
  public async recordDecision(storeId: StoreId, agent: AgentId, recommendationId: string | null, outcome: CalibrationOutcome): Promise<CalibrationStats> {
    await this.hydrate()
    const stats = this.record(agent, outcome)
    if (this.store) await this.store.append({ storeId, agent, recommendationId, outcome })
    return stats
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

function withCap(accepted: number, rejected: number): CalibrationStats {
  const total = accepted + rejected
  const rejectionRate = total === 0 ? 0 : rejected / total
  const confidenceCap = total < 10 ? .75 : Math.max(.4, 1 - rejectionRate)
  return { accepted, rejected, confidenceCap }
}

export class InMemoryCalibrationStore implements CalibrationStore {
  private readonly samples: Array<Readonly<{ storeId: StoreId; agent: AgentId; recommendationId: string | null; outcome: CalibrationOutcome }>> = []
  public async append(sample: Readonly<{ storeId: StoreId; agent: AgentId; recommendationId: string | null; outcome: CalibrationOutcome }>): Promise<void> { this.samples.push(sample) }
  public async counts(): Promise<ReadonlyMap<AgentId, Readonly<{ accepted: number; rejected: number }>>> {
    const map = new Map<AgentId, { accepted: number; rejected: number }>()
    for (const sample of this.samples) {
      const tally = map.get(sample.agent) ?? { accepted: 0, rejected: 0 }
      if (sample.outcome === 'accepted') tally.accepted += 1
      else tally.rejected += 1
      map.set(sample.agent, tally)
    }
    return map
  }
}

type SampleRow = QueryResultRow & { agent: AgentId; outcome: string; samples: string | number }

export class PostgresCalibrationStore implements CalibrationStore {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }

  public async append(sample: Readonly<{ storeId: StoreId; agent: AgentId; recommendationId: string | null; outcome: CalibrationOutcome }>): Promise<void> {
    await this.executor.query('INSERT INTO ai_calibration_samples (store_id, agent, recommendation_id, outcome) VALUES ($1, $2, $3, $4)', [sample.storeId, sample.agent, sample.recommendationId, sample.outcome])
  }

  public async counts(): Promise<ReadonlyMap<AgentId, Readonly<{ accepted: number; rejected: number }>>> {
    const result = await this.executor.query<SampleRow>("SELECT agent, outcome, COUNT(*) AS samples FROM ai_calibration_samples GROUP BY agent, outcome", [])
    const map = new Map<AgentId, { accepted: number; rejected: number }>()
    for (const row of result.rows) {
      const tally = map.get(row.agent) ?? { accepted: 0, rejected: 0 }
      if (row.outcome === 'accepted') tally.accepted += Number(row.samples)
      else tally.rejected += Number(row.samples)
      map.set(row.agent, tally)
    }
    return map
  }
}
