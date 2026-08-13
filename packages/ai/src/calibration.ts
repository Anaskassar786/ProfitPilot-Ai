import type { AgentId, ConfidenceLevel } from './domain.js'

export type CalibrationStats = Readonly<{ accepted: number; rejected: number; confidenceCap: number }>
export type CalibratedConfidence = Readonly<{ score: number; level: ConfidenceLevel; cap: number; stats: CalibrationStats }>

export class CalibrationLedger {
  private readonly stats = new Map<AgentId, CalibrationStats>()

  public record(agent: AgentId, outcome: 'accepted' | 'rejected'): CalibrationStats {
    const previous = this.stats.get(agent) ?? { accepted: 0, rejected: 0, confidenceCap: 1 }
    const accepted = previous.accepted + (outcome === 'accepted' ? 1 : 0)
    const rejected = previous.rejected + (outcome === 'rejected' ? 1 : 0)
    const total = accepted + rejected
    const rejectionRate = total === 0 ? 0 : rejected / total
    const confidenceCap = total < 10 ? .75 : Math.max(.4, 1 - rejectionRate)
    const next = { accepted, rejected, confidenceCap }
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
