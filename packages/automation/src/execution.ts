import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { SqlExecutor, QueryResultRow } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import type { ActivatedWorkflow, WorkflowNode } from './workflows.js'
import { MAX_WAIT_MS } from './workflows.js'
import type { RiskLevel } from './policy.js'
import { riskForAction } from './policy.js'

export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'WAITING' | 'APPROVAL_REQUIRED'
export type PersistedStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'WAITING' | 'APPROVAL_REQUIRED'
export type WorkflowRunRecord = Readonly<{ id: string; workflowId: string; storeId: string; version: number; definitionHash: string; status: RunStatus; currentNodeId: string | null; resumeAt: string | null; triggerType: string; testMode: boolean; createdAt: string; startedAt: string | null; completedAt: string | null; errorMessage: string | null; attempt: number; maxAttempts: number }>
export type WorkflowStepRecord = Readonly<{ key: string; runId: string; nodeId: string; sequence: number; status: PersistedStepStatus; input: Readonly<Record<string, unknown>>; output: Readonly<Record<string, unknown>>; errorMessage: string | null; startedAt: string | null; completedAt: string | null; durationMs: number | null }>
export type ApprovalRecord = Readonly<{ id: string; storeId: string; workflowId: string; workflowName: string; runId: string; nodeId: string; actionType: string; preview: string; riskLevel: RiskLevel; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'; requestedAt: string; expiresAt: string; decidedAt: string | null; decidedBy: string | null; decisionReason: string | null }>
export interface RunRepository {
  create(input: Readonly<{ workflow: ActivatedWorkflow; triggerType: string; triggerEventId?: string; context: Readonly<Record<string, unknown>>; testMode: boolean; maxAttempts?: number }>): Promise<WorkflowRunRecord>
  get(storeId: string, runId: string): Promise<WorkflowRunRecord | null>
  list(storeId: string, workflowId: string | null, limit?: number, cursor?: string): Promise<Readonly<{ items: readonly WorkflowRunRecord[]; nextCursor: string | null }>>
  steps(storeId: string, runId: string): Promise<readonly WorkflowStepRecord[]>
  saveStep(storeId: string, step: WorkflowStepRecord): Promise<void>
  transition(storeId: string, runId: string, status: RunStatus, fields?: Readonly<{ nodeId?: string | null; resumeAt?: string | null; error?: string | null }>): Promise<WorkflowRunRecord>
  context(storeId: string, runId: string): Promise<Readonly<Record<string, unknown>>>
  dueWaiting(limit?: number): Promise<readonly WorkflowRunRecord[]>
  createApproval(input: Omit<ApprovalRecord, 'id' | 'status' | 'requestedAt' | 'decidedAt' | 'decidedBy' | 'decisionReason'> & Readonly<{ payload: Readonly<Record<string, unknown>>; definitionHash: string; version: number }>): Promise<ApprovalRecord>
  approvals(storeId: string, status?: ApprovalRecord['status']): Promise<readonly ApprovalRecord[]>
  decideApproval(storeId: string, id: string, decision: 'APPROVED' | 'REJECTED', actor: string, reason?: string): Promise<ApprovalRecord | null>
  summary(storeId: string): Promise<AutomationSummary>
  countsToday(storeId: string, workflowId: string): Promise<Readonly<{ workflow: number; store: number }>>
}
export type AutomationSummary = Readonly<{ workflows: Readonly<{ active: number; draft: number; paused: number; archived: number }>; runs: Readonly<{ today: number; thisMonth: number; previousMonth: number; completed: number; failed: number; waiting: number; successRate: number | null }>; impact: Readonly<{ emailsSent: number; customersTagged: number; discountsCreated: number; notificationsSent: number }>; approvalsPending: number; recentActivity: readonly Readonly<{ runId: string; workflowId: string; workflowName: string; status: RunStatus; at: string; description: string }>[] }>
export type ActionResult = Readonly<Record<string, string | number | boolean | null>>
export interface WorkflowActionAdapters {
  execute(storeId: string, node: WorkflowNode, context: Readonly<Record<string, unknown>>, idempotencyKey: string, testMode: boolean): Promise<ActionResult>
}

export class AutomationExecutionService {
  public constructor(private readonly runs: RunRepository, private readonly actions: WorkflowActionAdapters, private readonly now: () => number = () => Date.now()) {}
  public async start(workflow: ActivatedWorkflow, input: Readonly<{ triggerType: string; triggerEventId?: string; context?: Readonly<Record<string, unknown>>; testMode?: boolean }>): Promise<WorkflowRunRecord> { const counts=await this.runs.countsToday(workflow.storeId,workflow.id);if(!input.testMode&&(counts.workflow>=100||counts.store>=500))throw new AppError('RATE_LIMITED','Daily workflow execution safety cap reached',429,{workflowRuns:counts.workflow,storeRuns:counts.store});return this.runs.create({ workflow, triggerType: input.triggerType, ...(input.triggerEventId ? { triggerEventId: input.triggerEventId } : {}), context: redact(input.context ?? {}), testMode: input.testMode ?? false }) }
  public async execute(workflow: ActivatedWorkflow, runId: string, approvedNodeId?: string): Promise<WorkflowRunRecord> {
    let run = await this.requiredRun(workflow.storeId, runId)
    if (run.status === 'CANCELLED' || run.status === 'COMPLETED') return run
    run = await this.runs.transition(workflow.storeId, runId, 'RUNNING')
    const prior = await this.runs.steps(workflow.storeId, runId)
    const completed = new Map(prior.filter((step) => step.status === 'COMPLETED').map((step) => [step.nodeId, step]))
    let context = { ...(await this.runs.context(workflow.storeId, runId)) }
    for (const step of completed.values()) Object.assign(context, step.output)
    let nodeId: string | null = workflow.nodes.find((node) => !completed.has(node.id) && (node.id === run.currentNodeId || node.type === 'trigger'))?.id ?? run.currentNodeId
    if (run.status === 'WAITING' && run.currentNodeId) nodeId = run.currentNodeId
    let sequence = prior.length
    while (nodeId) {
      const currentRun = await this.requiredRun(workflow.storeId, runId)
      if (currentRun.status === 'CANCELLED') return currentRun
      const node = workflow.nodes.find((item) => item.id === nodeId)
      if (!node) throw new AppError('VALIDATION_ERROR', 'Workflow run references a missing node', 400, { nodeId })
      const existing = completed.get(node.id)
      if (existing) { nodeId = next(node, existing.output); continue }
      const key = `${runId}:${node.id}:${workflow.definitionHash.slice(0, 12)}`
      const startedAt = new Date(this.now()).toISOString()
      if (node.type === 'wait') {
        const delay = Math.min(MAX_WAIT_MS, Number(node.config.delayMs ?? 0)); const resumeAt = new Date(this.now() + delay).toISOString()
        await this.runs.saveStep(workflow.storeId, { key, runId, nodeId: node.id, sequence, status: 'WAITING', input: redact(context), output: { resumeAt }, errorMessage: null, startedAt, completedAt: null, durationMs: null })
        return this.runs.transition(workflow.storeId, runId, 'WAITING', { nodeId: node.id, resumeAt })
      }
      if (node.type === 'action') {
        const risk = riskForAction(String(node.config.action) as never, node.config)
        if (risk !== 'LOW' && approvedNodeId !== node.id && !run.testMode) {
          await this.runs.createApproval({ storeId: workflow.storeId, workflowId: workflow.id, workflowName: workflow.name, runId, nodeId: node.id, actionType: String(node.config.action), preview: actionPreview(node), riskLevel: risk, expiresAt: new Date(this.now() + 86_400_000).toISOString(), payload: node.config, definitionHash: workflow.definitionHash, version: workflow.version })
          await this.runs.saveStep(workflow.storeId, { key, runId, nodeId: node.id, sequence, status: 'APPROVAL_REQUIRED', input: redact(context), output: {}, errorMessage: null, startedAt, completedAt: null, durationMs: null })
          return this.runs.transition(workflow.storeId, runId, 'APPROVAL_REQUIRED', { nodeId: node.id })
        }
      }
      await this.runs.saveStep(workflow.storeId, { key, runId, nodeId: node.id, sequence, status: 'RUNNING', input: redact(context), output: {}, errorMessage: null, startedAt, completedAt: null, durationMs: null })
      try {
        const output = node.type === 'condition' || node.type === 'filter' ? evaluate(node, context) : node.type === 'trigger' ? {} : await timeout(this.actions.execute(workflow.storeId, node, context, key, run.testMode), 30_000)
        const completedAt = new Date(this.now()).toISOString()
        await this.runs.saveStep(workflow.storeId, { key, runId, nodeId: node.id, sequence, status: 'COMPLETED', input: redact(context), output: redact(output), errorMessage: null, startedAt, completedAt, durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) })
        context = { ...context, ...output }; sequence += 1; nodeId = next(node, output)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Workflow action failed'; const completedAt = new Date(this.now()).toISOString()
        await this.runs.saveStep(workflow.storeId, { key, runId, nodeId: node.id, sequence, status: 'FAILED', input: redact(context), output: {}, errorMessage: message, startedAt, completedAt, durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) })
        return this.runs.transition(workflow.storeId, runId, 'FAILED', { nodeId: node.id, error: message })
      }
    }
    return this.runs.transition(workflow.storeId, runId, 'COMPLETED', { nodeId: null, resumeAt: null })
  }
  public async resumeDue(loadWorkflow: (storeId: string, workflowId: string) => Promise<ActivatedWorkflow | null>): Promise<number> { const due = await this.runs.dueWaiting(100); let resumed = 0; for (const run of due) { const workflow = await loadWorkflow(run.storeId, run.workflowId); if (workflow) { await this.runs.transition(run.storeId, run.id, 'RUNNING', { resumeAt: null }); await this.runs.saveStep(run.storeId, { ...(await this.runs.steps(run.storeId, run.id)).find((step) => step.nodeId === run.currentNodeId)!, status: 'COMPLETED', output: { resumedAt: new Date(this.now()).toISOString() }, completedAt: new Date(this.now()).toISOString(), durationMs: null }); await this.execute(workflow, run.id); resumed += 1 } } return resumed }
  private async requiredRun(storeId: string, runId: string) { const run = await this.runs.get(storeId, runId); if (!run) throw new AppError('NOT_FOUND', 'Workflow run not found', 404); return run }
}

function next(node: WorkflowNode, output: Readonly<Record<string, unknown>>): string | null { return node.type === 'condition' || node.type === 'filter' ? (output.branch === 'NO' ? node.next[1] : node.next[0]) ?? null : node.next[0] ?? null }
function evaluate(node: WorkflowNode, context: Readonly<Record<string, unknown>>): ActionResult { const field = String(node.config.field ?? ''); const actual = field.split('.').reduce<unknown>((value, part) => typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[part] : undefined, context); const expected = node.config.value; const operator = node.config.operator; const yes = operator === 'exists' ? actual !== undefined && actual !== null : operator === 'equals' ? actual === expected : operator === 'not_equals' ? actual !== expected : operator === 'greater_than' ? Number(actual) > Number(expected) : operator === 'less_than' ? Number(actual) < Number(expected) : operator === 'contains' ? String(actual ?? '').includes(String(expected ?? '')) : operator === 'between' ? (() => { const [low, high] = String(expected).split(',').map(Number); return Number(actual) >= (low ?? 0) && Number(actual) <= (high ?? 0) })() : Boolean(actual); return { branch: yes ? 'YES' : 'NO' } }
function redact(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /email|phone|name|address|token|secret/i.test(key) ? '[REDACTED]' : typeof item === 'object' && item !== null && !Array.isArray(item) ? redact(item as Record<string, unknown>) : item])) }
function actionPreview(node: WorkflowNode): string { const action = String(node.config.action).replaceAll('_', ' '); return `${action.charAt(0).toUpperCase()}${action.slice(1)} using the reviewed workflow configuration.` }
async function timeout<T>(promise: Promise<T>, ms: number): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new AppError('DEPENDENCY_ERROR', 'Workflow node timed out after 30 seconds', 408)), ms) })]) } finally { if (timer) clearTimeout(timer) } }
export function approvalPayloadHash(payload: Readonly<Record<string, unknown>>): string { return createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
export function newRunId(): string { return randomUUID() }
