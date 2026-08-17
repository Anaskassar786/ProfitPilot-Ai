import { AppError } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { ActionRisk, ActionType, AutomationMode } from './domain.js'
import { actionRisk } from './domain.js'

export type ExecutionRequest = Readonly<{ id: string; storeId: string; actionType: ActionType; payload: Readonly<Record<string, string | number | boolean | null>>; approvalStatus?: 'pending' | 'approved'; mode: AutomationMode; dailyCap: number }>
export type ExecutionResult = Readonly<{ id: string; status: 'EXECUTED'; output: Readonly<Record<string, string | number | boolean | null>>; executedAt: number }>
export type ActionTool = (request: ExecutionRequest) => Promise<Readonly<Record<string, string | number | boolean | null>>>

/**
 * Ledger methods are async (PR #46) so the production implementation can be
 * backed by the `ai_executions` table instead of process memory.
 */
export interface ExecutionLedger {
  get(id: string): Promise<ExecutionResult | null>
  save(storeId: string, actionType: ActionType, result: ExecutionResult): Promise<void>
  countForStore(storeId: string, day: string): Promise<number>
}

export class InMemoryExecutionLedger implements ExecutionLedger {
  private readonly results = new Map<string, ExecutionResult>()

  public async get(id: string): Promise<ExecutionResult | null> { return this.results.get(id) ?? null }
  public async save(_storeId: string, _actionType: ActionType, result: ExecutionResult): Promise<void> { this.results.set(result.id, result) }
  public async countForStore(storeId: string, day: string): Promise<number> { return [...this.results.values()].filter((result) => result.output.storeId === storeId && dayKey(result.executedAt) === day).length }
}

export class ActionExecutor {
  private readonly tools: Readonly<Partial<Record<ActionType, ActionTool>>>
  private readonly ledger: ExecutionLedger
  private readonly now: () => number

  public constructor(tools: Readonly<Partial<Record<ActionType, ActionTool>>>, ledger: ExecutionLedger, now: () => number = () => Date.now()) {
    this.tools = tools
    this.ledger = ledger
    this.now = now
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const existing = await this.ledger.get(request.id)
    if (existing) return existing
    const usedToday = await this.ledger.countForStore(request.storeId, dayKey(this.now()))
    assertPolicy(request, usedToday)
    const tool = this.tools[request.actionType]
    if (!tool) throw new AppError('DEPENDENCY_ERROR', `Action tool ${request.actionType} is not configured`, 503, { actionType: request.actionType })
    const output = await tool(request)
    const result: ExecutionResult = { id: request.id, status: 'EXECUTED', output: { ...output, storeId: request.storeId }, executedAt: this.now() }
    await this.ledger.save(request.storeId, request.actionType, result)
    return result
  }
}

type ExecutionRow = QueryResultRow & { id: string; payload: unknown; created_at: Date | string }
type ExecutionCountRow = QueryResultRow & { total: string | number }

/** Durable execution ledger backed by `ai_executions` (PR #46). */
export class PostgresExecutionLedger implements ExecutionLedger {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) { this.executor = executor }

  public async get(id: string): Promise<ExecutionResult | null> {
    const result = await this.executor.query<ExecutionRow>('SELECT id, payload, created_at FROM ai_executions WHERE id = $1 LIMIT 1', [id])
    const row = result.rows[0]
    if (!row) return null
    const payload = typeof row.payload === 'object' && row.payload !== null ? row.payload as Readonly<{ output?: Readonly<Record<string, string | number | boolean | null>>; executedAt?: number }> : {}
    const executedAt = typeof payload.executedAt === 'number' ? payload.executedAt : new Date(row.created_at).valueOf()
    return { id: row.id, status: 'EXECUTED', output: payload.output ?? {}, executedAt }
  }

  public async save(storeId: string, actionType: ActionType, result: ExecutionResult): Promise<void> {
    await this.executor.query(
      `INSERT INTO ai_executions (id, store_id, action_type, status, idempotency_key, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (store_id, idempotency_key) DO NOTHING`,
      [result.id, storeId, actionType, result.status, result.id, JSON.stringify({ output: result.output, executedAt: result.executedAt })],
    )
  }

  public async countForStore(storeId: string, day: string): Promise<number> {
    const result = await this.executor.query<ExecutionCountRow>(
      `SELECT COUNT(*) AS total FROM ai_executions WHERE store_id = $1 AND created_at >= $2::date AND created_at < ($2::date + INTERVAL '1 day')`,
      [storeId, day],
    )
    return Number(result.rows[0]?.total ?? 0)
  }
}

export function assertPolicy(request: ExecutionRequest, usedToday: number): void {
  const risk: ActionRisk = actionRisk(request.actionType)
  if (risk === 'MANUAL_ONLY') throw new AppError('FORBIDDEN', 'This action is manual-only', 403, { actionType: request.actionType })
  if (risk === 'APPROVAL_REQUIRED' && request.approvalStatus !== 'approved') throw new AppError('FORBIDDEN', 'Approval is required before this action executes', 403, { actionType: request.actionType })
  if (request.mode === 'FULLY_AUTOMATIC' && request.approvalStatus !== 'approved') throw new AppError('FORBIDDEN', 'Fully automatic mode still requires an explicit approval opt-in', 403, { actionType: request.actionType })
  if (!Number.isInteger(request.dailyCap) || request.dailyCap < 1) throw new AppError('VALIDATION_ERROR', 'Execution daily cap must be positive', 400)
  if (usedToday >= request.dailyCap) throw new AppError('RATE_LIMITED', 'Store action safety cap reached', 429, { storeId: request.storeId, dailyCap: request.dailyCap })
}

export function dayKey(at: number): string { return new Date(at).toISOString().slice(0, 10) }
