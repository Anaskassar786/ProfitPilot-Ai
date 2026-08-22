import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import { activateWorkflow, validateWorkflow } from './index.js'
import type { WorkflowDefinition, WorkflowNode } from './index.js'

const base = (nodes: readonly WorkflowNode[]): WorkflowDefinition => ({
  id: 'wf-condition',
  storeId: storeId('s1'),
  name: 'Condition branching',
  description: null,
  category: 'Customer',
  tags: [],
  timezone: 'UTC',
  overlapPolicy: 'SKIP',
  version: 1,
  nodes,
})

describe('condition YES/NO branching rule (Bug #7)', () => {
  it('rejects a condition node with only a YES branch', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['condition'] },
      { id: 'condition', type: 'condition', config: { field: 'order.total', operator: 'greater_than', value: 100 }, next: ['action'] },
      { id: 'action', type: 'action', config: { action: 'tag_customer', tag: 'VIP' }, next: [] },
    ]
    expect(() => validateWorkflow(base(nodes))).toThrow('Condition nodes require YES and NO branches')
  })

  it('accepts a condition node with both branches ending in a terminal exit node', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['condition'] },
      { id: 'condition', type: 'condition', config: { field: 'order.total', operator: 'greater_than', value: 100 }, next: ['action', 'exit-no'] },
      { id: 'action', type: 'action', config: { action: 'tag_customer', tag: 'VIP' }, next: [] },
      { id: 'exit-no', type: 'exit', config: {}, next: [] },
    ]
    expect(() => validateWorkflow(base(nodes))).not.toThrow()
    expect(() => activateWorkflow(base(nodes), 'now')).not.toThrow()
  })

  it('accepts the prebuilt VIP-tagging shape (YES->action, NO->notify terminal)', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger', type: 'trigger', config: { trigger: 'shopify_webhook', topic: 'orders/create' }, next: ['condition'] },
      { id: 'condition', type: 'condition', config: { field: 'order.total', operator: 'greater_than', value: 200 }, next: ['action', 'notify'] },
      { id: 'action', type: 'action', config: { action: 'tag_customer', tag: 'VIP' }, next: [] },
      { id: 'notify', type: 'action', config: { action: 'internal_notification', message: 'Workflow condition was not met.' }, next: [] },
    ]
    expect(() => validateWorkflow(base(nodes))).not.toThrow()
  })

  it('requires exit nodes to be terminal', () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['exit'] },
      { id: 'exit', type: 'exit', config: {}, next: ['trigger'] },
    ]
    expect(() => validateWorkflow(base(nodes))).toThrow('Exit nodes must be terminal')
  })
})

import { DEFAULT_POLICY, InMemoryStepLedger, WorkflowRunner } from './index.js'

describe('exit node execution (Bug #7)', () => {
  it('completes the run when the NO branch reaches the terminal exit node', async () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['condition'] },
      { id: 'condition', type: 'condition', config: { field: 'order.total', operator: 'greater_than', value: 100 }, next: ['tag', 'no-exit'] },
      { id: 'tag', type: 'action', config: { action: 'tag_customer', tag: 'VIP' }, next: [] },
      { id: 'no-exit', type: 'exit', config: {}, next: [] },
    ]
    const workflow = activateWorkflow(base(nodes), 'now')
    const ledger = new InMemoryStepLedger()
    const runner = new WorkflowRunner(ledger, () => 100)
    const executed: string[] = []
    const result = await runner.run(workflow, 'run-1', {}, { ...DEFAULT_POLICY, mode: 'SEMI_AUTOMATIC' }, async (node) => {
      executed.push(node.id)
      return node.id === 'condition' ? { branch: 'NO' } : {}
    }, true)
    expect(result.status).toBe('COMPLETED')
    expect(result.currentNodeId).toBeNull()
    expect(executed).toEqual(['trigger', 'condition']) // the exit node never invokes the action handler
    void ledger
  })

  it('still runs the YES branch to completion', async () => {
    const nodes: WorkflowNode[] = [
      { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['condition'] },
      { id: 'condition', type: 'condition', config: {}, next: ['tag', 'no-exit'] },
      { id: 'tag', type: 'action', config: { action: 'tag_customer', tag: 'VIP' }, next: [] },
      { id: 'no-exit', type: 'exit', config: {}, next: [] },
    ]
    const workflow = activateWorkflow(base(nodes), 'now')
    const runner = new WorkflowRunner(new InMemoryStepLedger(), () => 100)
    const executed: string[] = []
    const result = await runner.run(workflow, 'run-2', {}, { ...DEFAULT_POLICY, mode: 'SEMI_AUTOMATIC' }, async (node) => {
      executed.push(node.id)
      return node.id === 'condition' ? { branch: 'YES' } : {}
    }, true)
    expect(result.status).toBe('COMPLETED')
    expect(executed).toContain('tag')
    expect(executed).not.toContain('no-exit')
  })
})
