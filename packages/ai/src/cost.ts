import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'

export type CostEntry = Readonly<{ storeId: StoreId; day: string; microDollars: number; model: string; agent: string; promptTokens: number; completionTokens: number; at: number }>
export type CostSummary = Readonly<{ storeId: StoreId; day: string; microDollars: number; capMicroDollars: number; remainingMicroDollars: number; calls: number }>
export type CostBreakdownRow = Readonly<{ agent: string; model: string; microDollars: number; calls: number; promptTokens: number; completionTokens: number }>
export type CostRecordInput = Readonly<{ storeId: StoreId; model: string; agent?: string; promptTokens: number; completionTokens: number; inputRateMicroDollars: number; outputRateMicroDollars: number; at?: number }>

export class CostCapExceededError extends AppError {
  public constructor(storeId: StoreId, capMicroDollars: number) {
    super('RATE_LIMITED', 'AI daily cost cap reached for this store', 429, { storeId, capMicroDollars })
    this.name = 'CostCapExceededError'
  }
}

/** Durable sink for AI cost entries (backed by the ai_cost_ledger table). */
export interface CostLedgerStore {
  append(entry: CostEntry): Promise<void>
  readDay(storeId: StoreId, day: string): Promise<readonly CostEntry[]>
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

  public get cap(): number { return this.capMicroDollars }

  public record(input: CostRecordInput): CostEntry {
    const at = input.at ?? this.now()
    const microDollars = Math.max(0, Math.round(input.promptTokens * input.inputRateMicroDollars + input.completionTokens * input.outputRateMicroDollars))
    const summary = this.summary(input.storeId, at)
    if (summary.microDollars + microDollars > this.capMicroDollars) throw new CostCapExceededError(input.storeId, this.capMicroDollars)
    const entry: CostEntry = { storeId: input.storeId, day: dayKey(at), microDollars, model: input.model, agent: input.agent ?? 'UNATTRIBUTED', promptTokens: input.promptTokens, completionTokens: input.completionTokens, at }
    this.entries.push(entry)
    return entry
  }

  public summary(storeId: StoreId, at = this.now()): CostSummary {
    const day = dayKey(at)
    const entries = this.entries.filter((entry) => entry.storeId === storeId && entry.day === day)
    const microDollars = entries.reduce((sum, entry) => sum + entry.microDollars, 0)
    return { storeId, day, microDollars, capMicroDollars: this.capMicroDollars, remainingMicroDollars: Math.max(0, this.capMicroDollars - microDollars), calls: entries.length }
  }

  public breakdown(storeId: StoreId, at = this.now()): readonly CostBreakdownRow[] {
    return aggregateBreakdown(this.entriesFor(storeId, at))
  }

  public entriesFor(storeId: StoreId, at = this.now()): readonly CostEntry[] {
    const day = dayKey(at)
    return this.entries.filter((entry) => entry.storeId === storeId && entry.day === day)
  }
}

/**
 * Durable cost meter: the daily cap is checked against the persisted ledger
 * (ai_cost_ledger) so restarts and multiple API instances share one budget.
 * The previous CostMeter kept everything in process memory, which made the
 * "$5 daily budget" reset on every deploy.
 */
export class PersistentCostMeter {
  private readonly store: CostLedgerStore
  private readonly capMicroDollars: number
  private readonly now: () => number

  public constructor(store: CostLedgerStore, capDollars = 5, now: () => number = () => Date.now()) {
    if (!Number.isFinite(capDollars) || capDollars < 0) throw new RangeError('AI cost cap must be non-negative')
    this.store = store
    this.capMicroDollars = Math.round(capDollars * 1_000_000)
    this.now = now
  }

  public get cap(): number { return this.capMicroDollars }

  public async record(input: CostRecordInput): Promise<CostEntry> {
    const at = input.at ?? this.now()
    const microDollars = Math.max(0, Math.round(input.promptTokens * input.inputRateMicroDollars + input.completionTokens * input.outputRateMicroDollars))
    const summary = await this.summary(input.storeId, at)
    if (summary.microDollars + microDollars > this.capMicroDollars) throw new CostCapExceededError(input.storeId, this.capMicroDollars)
    const entry: CostEntry = { storeId: input.storeId, day: dayKey(at), microDollars, model: input.model, agent: input.agent ?? 'UNATTRIBUTED', promptTokens: input.promptTokens, completionTokens: input.completionTokens, at }
    await this.store.append(entry)
    return entry
  }

  public async summary(storeId: StoreId, at = this.now()): Promise<CostSummary> {
    const entries = await this.store.readDay(storeId, dayKey(at))
    const microDollars = entries.reduce((sum, entry) => sum + entry.microDollars, 0)
    return { storeId, day: dayKey(at), microDollars, capMicroDollars: this.capMicroDollars, remainingMicroDollars: Math.max(0, this.capMicroDollars - microDollars), calls: entries.length }
  }

  public async breakdown(storeId: StoreId, at = this.now()): Promise<readonly CostBreakdownRow[]> {
    return aggregateBreakdown(await this.store.readDay(storeId, dayKey(at)))
  }
}

export type AnyCostMeter = Pick<CostMeter, 'record' | 'summary' | 'breakdown'> | Pick<PersistentCostMeter, 'record' | 'summary' | 'breakdown'>

export class InMemoryCostLedgerStore implements CostLedgerStore {
  private readonly entries: CostEntry[] = []
  public async append(entry: CostEntry): Promise<void> { this.entries.push(entry) }
  public async readDay(storeId: StoreId, day: string): Promise<readonly CostEntry[]> { return this.entries.filter((entry) => entry.storeId === storeId && entry.day === day) }
}

type LedgerRow = QueryResultRow & { day: string | Date; model: string; agent: string; prompt_tokens: number; completion_tokens: number; micro_dollars: string | number; created_at: Date | string }

export class PostgresCostLedgerStore implements CostLedgerStore {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }

  public async append(entry: CostEntry): Promise<void> {
    await this.executor.query('INSERT INTO ai_cost_ledger (store_id, day, model, agent, prompt_tokens, completion_tokens, micro_dollars) VALUES ($1, $2, $3, $4, $5, $6, $7)', [entry.storeId, entry.day, entry.model, entry.agent, entry.promptTokens, entry.completionTokens, entry.microDollars])
  }

  public async readDay(storeId: StoreId, day: string): Promise<readonly CostEntry[]> {
    const result = await this.executor.query<LedgerRow>('SELECT day, model, agent, prompt_tokens, completion_tokens, micro_dollars, created_at FROM ai_cost_ledger WHERE store_id = $1 AND day = $2', [storeId, day])
    return result.rows.map((row) => ({ storeId, day, microDollars: Number(row.micro_dollars), model: row.model, agent: row.agent, promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, at: new Date(row.created_at).valueOf() }))
  }
}

function aggregateBreakdown(entries: readonly CostEntry[]): readonly CostBreakdownRow[] {
  const groups = new Map<string, { agent: string; model: string; microDollars: number; calls: number; promptTokens: number; completionTokens: number }>()
  for (const entry of entries) {
    const key = `${entry.agent}::${entry.model}`
    const group = groups.get(key) ?? { agent: entry.agent, model: entry.model, microDollars: 0, calls: 0, promptTokens: 0, completionTokens: 0 }
    group.microDollars += entry.microDollars
    group.calls += 1
    group.promptTokens += entry.promptTokens
    group.completionTokens += entry.completionTokens
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => right.microDollars - left.microDollars || right.calls - left.calls)
}

function dayKey(at: number): string { return new Date(at).toISOString().slice(0, 10) }
