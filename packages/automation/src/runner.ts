import { createHash } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { WorkflowNode, ActivatedWorkflow, WorkflowAction } from './workflows.js'
import type { AutomationAction, AutomationPolicy } from './policy.js'
import { assertPolicy, riskForAction } from './policy.js'

export type StepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'WAITING' | 'FAILED' | 'SKIPPED' | 'APPROVAL_REQUIRED'
export type WorkflowRun = Readonly<{ runId: string; workflowId: string; storeId: string; status: 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'APPROVAL_REQUIRED'; currentNodeId: string | null; resumeAt: number | null; steps: number; error?: string }>
export type StepRecord = Readonly<{ key: string; runId: string; nodeId: string; status: StepStatus; input?: Readonly<Record<string, unknown>>; output: Readonly<Record<string, string | number | boolean | null>>; updatedAt: number; error?: string }>
export type StepHandler = (node: WorkflowNode, context: Readonly<Record<string, string | number | boolean | null>>, signal?: AbortSignal) => Promise<Readonly<Record<string, string | number | boolean | null>>>
export interface StepLedger { get(key: string): StepRecord | null; put(record: StepRecord): void; countForRun(runId: string): number }

export class InMemoryStepLedger implements StepLedger {
  private readonly records = new Map<string, StepRecord>()
  public get(key: string): StepRecord | null { return this.records.get(key) ?? null }
  public put(record: StepRecord): void { this.records.set(record.key, record) }
  public countForRun(runId: string): number { return [...this.records.values()].filter((record) => record.runId === runId).length }
}

export class WorkflowRunner {
  public constructor(private readonly ledger: StepLedger, private readonly now: () => number = () => Date.now()) {}

  public async run(workflow: ActivatedWorkflow, runId: string, initialContext: Readonly<Record<string, string | number | boolean | null>>, policy: AutomationPolicy, handler: StepHandler, approved = false, options: Readonly<{ signal?: AbortSignal; timeoutMs?: number; dayCount?: number }> = {}): Promise<WorkflowRun> {
    let nodeId: string | null = workflow.nodes.find((node) => node.type === 'trigger')?.id ?? null
    let steps = 0
    let context = { ...initialContext }
    while (nodeId) {
      if (options.signal?.aborted) return { runId, workflowId: workflow.id, storeId: workflow.storeId, status: 'CANCELLED', currentNodeId: nodeId, resumeAt: null, steps }
      const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) throw new AppError('VALIDATION_ERROR', `Workflow node ${nodeId} not found`, 400)
      const key = `${runId}:${node.id}:${createHash('sha256').update(workflow.definitionHash).digest('hex').slice(0, 12)}`
      const previous = this.ledger.get(key)
      if (previous?.status === 'COMPLETED') { context = { ...context, ...previous.output }; nodeId = nextNode(node, previous.output); continue }
      if (node.type === 'wait') {
        const delayMs = typeof node.config.delayMs === 'number' ? node.config.delayMs : 0
        const previousResumeAt = previous && typeof previous.output.resumeAt === 'number' ? previous.output.resumeAt : null
        if (previous?.status === 'WAITING' && previousResumeAt !== null && previousResumeAt <= this.now()) {
          const output = { resumedAt: this.now() }
          this.ledger.put({ key, runId, nodeId: node.id, status: 'COMPLETED', output, updatedAt: this.now() })
          context = { ...context, ...output }; nodeId = node.next[0] ?? null; continue
        }
        const resumeAt = previousResumeAt ?? this.now() + delayMs
        this.ledger.put({ key, runId, nodeId: node.id, status: 'WAITING', input: redact(context), output: { resumeAt }, updatedAt: this.now() })
        return { runId, workflowId: workflow.id, storeId: workflow.storeId, status: 'WAITING', currentNodeId: node.id, resumeAt, steps }
      }
      if (node.type === 'action') {
        const workflowAction = String(node.config.action) as WorkflowAction
        const action = policyAction(workflowAction)
        assertPolicy(policy, action, approved, steps, options.dayCount ?? steps, riskForAction(workflowAction, node.config))
      }
      this.ledger.put({ key, runId, nodeId: node.id, status: 'RUNNING', input: redact(context), output: {}, updatedAt: this.now() })
      try {
        const output = await withTimeout(handler(node, context, options.signal), options.timeoutMs ?? 30_000)
        steps += 1
        this.ledger.put({ key, runId, nodeId: node.id, status: 'COMPLETED', input: redact(context), output, updatedAt: this.now() })
        context = { ...context, ...output }
        nodeId = nextNode(node, output)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Workflow step failed'
        this.ledger.put({ key, runId, nodeId: node.id, status: 'FAILED', input: redact(context), output: {}, updatedAt: this.now(), error: message })
        return { runId, workflowId: workflow.id, storeId: workflow.storeId, status: 'FAILED', currentNodeId: node.id, resumeAt: null, steps, error: message }
      }
    }
    return { runId, workflowId: workflow.id, storeId: workflow.storeId, status: 'COMPLETED', currentNodeId: null, resumeAt: null, steps }
  }
}

function nextNode(node: WorkflowNode, output: Readonly<Record<string, string | number | boolean | null>>): string | null { return node.type === 'condition' ? (output.branch === 'NO' ? node.next[1] : node.next[0]) ?? null : node.next[0] ?? null }
function policyAction(action: WorkflowAction): AutomationAction { return action === 'email' ? 'EMAIL' : action === 'tag_customer' ? 'TAG_CUSTOMER' : action === 'create_discount' ? 'CREATE_DISCOUNT' : action === 'internal_notification' ? 'INTERNAL_NOTIFICATION' : 'UPDATE_INVENTORY' }
function redact(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> { return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, /email|phone|name|address|token|secret/i.test(key) ? '[REDACTED]' : value])) }
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new AppError('DEPENDENCY_ERROR', 'Workflow step exceeded its timeout', 408)), Math.max(1, timeoutMs)) })]) } finally { if (timer) clearTimeout(timer) } }
