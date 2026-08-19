import type { StoreId } from '@profitpilot/types'
import { withTenantContext } from '@profitpilot/db'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AgentId, ConfidenceLevel } from './domain.js'
import { AGENT_IDS } from './domain.js'

export type CalibrationStats = Readonly<{ accepted: number; rejected: number; confidenceCap: number }>
export type CalibratedConfidence = Readonly<{ score: number; level: ConfidenceLevel; cap: number; stats: CalibrationStats }>
export type CalibrationOutcome = 'accepted' | 'rejected'
export type CalibrationSample = Readonly<{ storeId: StoreId; agent: AgentId; recommendationId: string | null; outcome: CalibrationOutcome }>

/** Durable sink for calibration samples (backed by ai_calibration_samples). */
export interface CalibrationStore {
  append(sample: CalibrationSample): Promise<void>
  counts(): Promise<ReadonlyMap<AgentId, Readonly<{ accepted: number; rejected: number }>>>
}

export class CalibrationLedger {
  private readonly stats = new Map<AgentId, CalibrationStats>()
  private readonly store: CalibrationStore | null
  private hydrated = false

  public constructor(store: CalibrationStore | null = null) { this.store = store }

  /** Loads persisted totals, or directly hydrates one agent for compatibility. */
  public hydrate(): Promise<void>
  public hydrate(agent: AgentId, accepted: number, rejected: number): CalibrationStats
  public hydrate(agent?: AgentId, accepted?: number, rejected?: number): Promise<void> | CalibrationStats {
    if (agent !== undefined) {
      const next = withCap(accepted ?? 0, rejected ?? 0)
      this.stats.set(agent, next)
      return next
    }
    return this.hydrateFromStore()
  }

  private async hydrateFromStore(): Promise<void> {
    if (!this.store || this.hydrated) return
    const counts = await this.store.counts()
    for (const [agent, tally] of counts) this.stats.set(agent, withCap(tally.accepted, tally.rejected))
    this.hydrated = true
  }

  public get(agent: AgentId): CalibrationStats {
    return this.stats.get(agent) ?? withCap(0, 0)
  }

  public record(agent: AgentId, outcome: CalibrationOutcome): CalibrationStats {
    const previous = this.get(agent)
    const next = withCap(previous.accepted + (outcome === 'accepted' ? 1 : 0), previous.rejected + (outcome === 'rejected' ? 1 : 0))
    this.stats.set(agent, next)
    return next
  }

  public async recordDecision(storeId: StoreId, agent: AgentId, recommendationId: string | null, outcome: CalibrationOutcome): Promise<CalibrationStats> {
    const next = this.record(agent, outcome)
    if (this.store) await this.store.append({ storeId, agent, recommendationId, outcome })
    return next
  }

  public calibrate(agent: AgentId, rawScore: number): CalibratedConfidence {
    const stats = this.get(agent)
    const score = Math.max(0, Math.min(rawScore, stats.confidenceCap))
    return { score, level: score >= .9 ? 'HIGH' : score >= .7 ? 'MEDIUM' : 'LOW', cap: stats.confidenceCap, stats }
  }
}

/** Cold start caps confidence at .75 until an agent has 10 decisions. */
function withCap(accepted: number, rejected: number): CalibrationStats {
  const total = accepted + rejected
  const rejectionRate = total === 0 ? 0 : rejected / total
  const confidenceCap = total < 10 ? .75 : Math.max(.4, 1 - rejectionRate)
  return { accepted, rejected, confidenceCap }
}

export class InMemoryCalibrationStore implements CalibrationStore {
  private readonly samples: CalibrationSample[] = []
  public async append(sample: CalibrationSample): Promise<void> { this.samples.push(sample) }
  public async counts(): Promise<ReadonlyMap<AgentId, Readonly<{ accepted: number; rejected: number }>>> {
    return countSamples(this.samples)
  }
}

type SampleRow = QueryResultRow & { agent: string; outcome: string; samples?: string | number; total?: string | number }

export class PostgresCalibrationStore implements CalibrationStore {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }

  public append(sample: CalibrationSample): Promise<void>
  public append(storeId: string, agent: AgentId, recommendationId: string, outcome: CalibrationOutcome): Promise<void>
  public async append(sampleOrStoreId: CalibrationSample | string, agent?: AgentId, recommendationId?: string, outcome?: CalibrationOutcome): Promise<void> {
    const sample: CalibrationSample = typeof sampleOrStoreId === 'string'
      ? { storeId: sampleOrStoreId as StoreId, agent: agent as AgentId, recommendationId: recommendationId ?? null, outcome: outcome as CalibrationOutcome }
      : sampleOrStoreId
    await withTenantContext(this.executor, sample.storeId, (executor) => executor.query('INSERT INTO ai_calibration_samples (store_id, agent, recommendation_id, outcome) VALUES ($1, $2, $3, $4)', [sample.storeId, sample.agent, sample.recommendationId, sample.outcome]).then(() => undefined))
  }

  public async counts(): Promise<ReadonlyMap<AgentId, Readonly<{ accepted: number; rejected: number }>>> {
    const result = await this.executor.query<SampleRow>("SELECT agent, outcome, COUNT(*) AS samples FROM ai_calibration_samples WHERE outcome IN ('accepted', 'rejected') GROUP BY agent, outcome", [])
    const map = new Map<AgentId, { accepted: number; rejected: number }>()
    for (const row of result.rows) {
      const agent = row.agent as AgentId
      if (!AGENT_IDS.includes(agent)) continue
      const tally = map.get(agent) ?? { accepted: 0, rejected: 0 }
      const amount = Number(row.samples ?? row.total ?? 0)
      if (row.outcome === 'accepted') tally.accepted += amount
      else tally.rejected += amount
      map.set(agent, tally)
    }
    return map
  }

  /** Compatibility helper used by the recommendation lifecycle bootstrap/tests. */
  public async hydrate(ledger: CalibrationLedger): Promise<void> {
    const totals = await this.counts()
    for (const [agent, counts] of totals) ledger.hydrate(agent, counts.accepted, counts.rejected)
  }
}

function countSamples(samples: readonly CalibrationSample[]): ReadonlyMap<AgentId, Readonly<{ accepted: number; rejected: number }>> {
  const map = new Map<AgentId, { accepted: number; rejected: number }>()
  for (const sample of samples) {
    const tally = map.get(sample.agent) ?? { accepted: 0, rejected: 0 }
    if (sample.outcome === 'accepted') tally.accepted += 1
    else tally.rejected += 1
    map.set(sample.agent, tally)
  }
  return map
}
