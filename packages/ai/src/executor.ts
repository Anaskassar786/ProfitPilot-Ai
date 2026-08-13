import { AppError } from '@profitpilot/types'
import type { ActionRisk, ActionType, AutomationMode } from './domain.js'
import { actionRisk } from './domain.js'

export type ExecutionRequest = Readonly<{ id: string; storeId: string; actionType: ActionType; payload: Readonly<Record<string, string | number | boolean | null>>; approvalStatus?: 'pending' | 'approved'; mode: AutomationMode; dailyCap: number }>
export type ExecutionResult = Readonly<{ id: string; status: 'EXECUTED'; output: Readonly<Record<string, string | number | boolean | null>>; executedAt: number }>
export type ActionTool = (request: ExecutionRequest) => Promise<Readonly<Record<string, string | number | boolean | null>>>

export interface ExecutionLedger {
  get(id: string): ExecutionResult | null
  save(result: ExecutionResult): void
  countForStore(storeId: string, day: string): number
}

export class InMemoryExecutionLedger implements ExecutionLedger {
  private readonly results = new Map<string, ExecutionResult>()

  public get(id: string): ExecutionResult | null { return this.results.get(id) ?? null }
  public save(result: ExecutionResult): void { this.results.set(result.id, result) }
  public countForStore(storeId: string, day: string): number { return [...this.results.values()].filter((result) => result.output.storeId === storeId && dayKey(result.executedAt) === day).length }
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
    const existing = this.ledger.get(request.id)
    if (existing) return existing
    assertPolicy(request, this.ledger, this.now())
    const tool = this.tools[request.actionType]
    if (!tool) throw new AppError('DEPENDENCY_ERROR', `Action tool ${request.actionType} is not configured`, 503, { actionType: request.actionType })
    const output = await tool(request)
    const result: ExecutionResult = { id: request.id, status: 'EXECUTED', output: { ...output, storeId: request.storeId }, executedAt: this.now() }
    this.ledger.save(result)
    return result
  }
}

export function assertPolicy(request: ExecutionRequest, ledger: ExecutionLedger, now = Date.now()): void {
  const risk: ActionRisk = actionRisk(request.actionType)
  if (risk === 'MANUAL_ONLY') throw new AppError('FORBIDDEN', 'This action is manual-only', 403, { actionType: request.actionType })
  if (risk === 'APPROVAL_REQUIRED' && request.approvalStatus !== 'approved') throw new AppError('FORBIDDEN', 'Approval is required before this action executes', 403, { actionType: request.actionType })
  if (request.mode === 'FULLY_AUTOMATIC' && request.approvalStatus !== 'approved') throw new AppError('FORBIDDEN', 'Fully automatic mode still requires an explicit approval opt-in', 403, { actionType: request.actionType })
  if (!Number.isInteger(request.dailyCap) || request.dailyCap < 1) throw new AppError('VALIDATION_ERROR', 'Execution daily cap must be positive', 400)
  if (ledger.countForStore(request.storeId, dayKey(now)) >= request.dailyCap) throw new AppError('RATE_LIMITED', 'Store action safety cap reached', 429, { storeId: request.storeId, dailyCap: request.dailyCap })
}

function dayKey(at: number): string { return new Date(at).toISOString().slice(0, 10) }
