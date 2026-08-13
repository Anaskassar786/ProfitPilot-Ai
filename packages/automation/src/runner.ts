import { createHash } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { WorkflowNode, ActivatedWorkflow } from './workflows.js'
import type { AutomationAction, AutomationPolicy } from './policy.js'
import { assertPolicy } from './policy.js'

export type StepStatus = 'RUNNING' | 'COMPLETED' | 'WAITING' | 'FAILED'
export type WorkflowRun = Readonly<{ runId: string; workflowId: string; storeId: string; status: 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED'; currentNodeId: string | null; resumeAt: number | null; steps: number }>
export type StepRecord = Readonly<{ key: string; runId: string; nodeId: string; status: StepStatus; output: Readonly<Record<string, string | number | boolean | null>>; updatedAt: number }>
export type StepHandler = (node: WorkflowNode, context: Readonly<Record<string, string | number | boolean | null>>) => Promise<Readonly<Record<string, string | number | boolean | null>>>
export interface StepLedger { get(key: string): StepRecord | null; put(record: StepRecord): void; countForRun(runId: string): number }

export class InMemoryStepLedger implements StepLedger {
  private readonly records = new Map<string, StepRecord>()
  public get(key: string): StepRecord | null { return this.records.get(key) ?? null }
  public put(record: StepRecord): void { this.records.set(record.key, record) }
  public countForRun(runId: string): number { return [...this.records.values()].filter((record) => record.runId === runId).length }
}

export class WorkflowRunner {
  private readonly ledger: StepLedger
  private readonly now: () => number
  public constructor(ledger: StepLedger, now: () => number = () => Date.now()) { this.ledger = ledger; this.now = now }

  public async run(workflow: ActivatedWorkflow, runId: string, context: Readonly<Record<string, string | number | boolean | null>>, policy: AutomationPolicy, handler: StepHandler, approved = false): Promise<WorkflowRun> {
    let nodeId: string | null = workflow.nodes.find((node) => node.type === 'trigger')?.id ?? null
    let steps = 0
    while (nodeId) {
      const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) throw new AppError('VALIDATION_ERROR', `Workflow node ${nodeId} not found`, 400)
      const key = `${runId}:${node.id}:${createHash('sha256').update(workflow.definitionHash).digest('hex').slice(0, 12)}`
      const previous = this.ledger.get(key)
      if (previous?.status === 'COMPLETED') { nodeId = node.next[0] ?? null; continue }
      if (node.type === 'wait') {
        const delayMs = typeof node.config.delayMs === 'number' ? node.config.delayMs : 0
        if (delayMs < 0) throw new AppError('VALIDATION_ERROR', 'Wait delay cannot be negative', 400)
        const previousResumeAt = previous && typeof previous.output.resumeAt === 'number' ? previous.output.resumeAt : null
        if (previous?.status === 'WAITING' && previousResumeAt !== null && previousResumeAt <= this.now()) {
          this.ledger.put({ key, runId, nodeId: node.id, status: 'COMPLETED', output: { resumedAt: this.now() }, updatedAt: this.now() })
          nodeId = node.next[0] ?? null
          continue
        }
        const resumeAt = previousResumeAt ?? this.now() + delayMs
        this.ledger.put({ key, runId, nodeId: node.id, status: 'WAITING', output: { resumeAt }, updatedAt: this.now() })
        return { runId, workflowId: workflow.id, storeId: workflow.storeId, status: 'WAITING', currentNodeId: node.id, resumeAt, steps }
      }
      if (node.type === 'action') {
        const action = typeof node.config.action === 'string' ? node.config.action.toUpperCase() as AutomationAction : 'WAIT'
        assertPolicy(policy, action, approved, steps, steps)
      }
      const output = await handler(node, context)
      steps += 1
      this.ledger.put({ key, runId, nodeId: node.id, status: 'COMPLETED', output, updatedAt: this.now() })
      if (node.type === 'condition') nodeId = output.branch === 'NO' ? (node.next[1] ?? null) : (node.next[0] ?? null)
      else nodeId = node.next[0] ?? null
    }
    return { runId, workflowId: workflow.id, storeId: workflow.storeId, status: 'COMPLETED', currentNodeId: null, resumeAt: null, steps }
  }
}
