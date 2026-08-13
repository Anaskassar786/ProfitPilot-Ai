import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export type CostEntry = Readonly<{ storeId: StoreId; day: string; microDollars: number; model: string; promptTokens: number; completionTokens: number; at: number }>
export type CostSummary = Readonly<{ storeId: StoreId; day: string; microDollars: number; capMicroDollars: number; remainingMicroDollars: number; calls: number }>

export class CostCapExceededError extends AppError {
  public constructor(storeId: StoreId, capMicroDollars: number) {
    super('RATE_LIMITED', 'AI daily cost cap reached for this store', 429, { storeId, capMicroDollars })
    this.name = 'CostCapExceededError'
  }
}

export class CostMeter {
  private readonly entries: CostEntry[] = []
  private readonly capMicroDollars: number
  private readonly now: () => number

  public constructor(capDollars = 5, now: () => number = () => Date.now()) {
    if (!Number.isFinite(capDollars) || capDollars < 0) throw new RangeError('AI cost cap must be non-negative')
    this.capMicroDollars = Math.round(capDollars * 1_000_000)
    this.now = now
  }

  public record(input: Readonly<{ storeId: StoreId; model: string; promptTokens: number; completionTokens: number; inputRateMicroDollars: number; outputRateMicroDollars: number; at?: number }>): CostEntry {
    const at = input.at ?? this.now()
    const microDollars = Math.max(0, Math.round(input.promptTokens * input.inputRateMicroDollars + input.completionTokens * input.outputRateMicroDollars))
    const summary = this.summary(input.storeId, at)
    if (summary.microDollars + microDollars > this.capMicroDollars) throw new CostCapExceededError(input.storeId, this.capMicroDollars)
    const entry: CostEntry = { storeId: input.storeId, day: dayKey(at), microDollars, model: input.model, promptTokens: input.promptTokens, completionTokens: input.completionTokens, at }
    this.entries.push(entry)
    return entry
  }

  public summary(storeId: StoreId, at = this.now()): CostSummary {
    const day = dayKey(at)
    const entries = this.entries.filter((entry) => entry.storeId === storeId && entry.day === day)
    const microDollars = entries.reduce((sum, entry) => sum + entry.microDollars, 0)
    return { storeId, day, microDollars, capMicroDollars: this.capMicroDollars, remainingMicroDollars: Math.max(0, this.capMicroDollars - microDollars), calls: entries.length }
  }

  public entriesFor(storeId: StoreId, at = this.now()): readonly CostEntry[] {
    const day = dayKey(at)
    return this.entries.filter((entry) => entry.storeId === storeId && entry.day === day)
  }
}

function dayKey(at: number): string { return new Date(at).toISOString().slice(0, 10) }
