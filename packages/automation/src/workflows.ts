import { createHash } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export type WorkflowNodeType = 'trigger' | 'condition' | 'action' | 'wait'
export type WorkflowTrigger = 'manual' | 'cron' | 'shopify_webhook'
export type WorkflowAction = 'email' | 'sms' | 'tag' | 'discount' | 'wait'
export type WorkflowConfigValue = string | number | boolean | null
export type WorkflowNode = Readonly<{ id: string; type: WorkflowNodeType; config: Readonly<Record<string, WorkflowConfigValue>>; next: readonly string[] }>
export type WorkflowDefinition = Readonly<{ id: string; storeId: StoreId; version: number; nodes: readonly WorkflowNode[] }>
export type ActivatedWorkflow = Readonly<WorkflowDefinition & { activatedAt: string; definitionHash: string }>

export function validateWorkflow(definition: WorkflowDefinition): void {
  if (definition.nodes.length === 0) throw new AppError('VALIDATION_ERROR', 'Workflow must contain at least one node', 400)
  if (definition.nodes.filter((node) => node.type === 'trigger').length !== 1) throw new AppError('VALIDATION_ERROR', 'Workflow must contain exactly one trigger', 400)
  const trigger = definition.nodes.find((node) => node.type === 'trigger')
  if (!trigger || !isTrigger(trigger.config.trigger ?? null)) throw new AppError('VALIDATION_ERROR', 'Workflow trigger must be manual, cron, or shopify_webhook', 400)
  const ids = new Set<string>()
  for (const node of definition.nodes) {
    if (!node.id.trim()) throw new AppError('VALIDATION_ERROR', 'Workflow node id cannot be empty', 400)
    if (ids.has(node.id)) throw new AppError('VALIDATION_ERROR', `Duplicate workflow node ${node.id}`, 400, { nodeId: node.id })
    ids.add(node.id)
    if (node.type === 'action' && !isAction(node.config.action ?? null)) throw new AppError('VALIDATION_ERROR', 'Workflow action is invalid', 400, { nodeId: node.id })
    if (node.type === 'wait' && (typeof node.config.delayMs !== 'number' || node.config.delayMs < 0)) throw new AppError('VALIDATION_ERROR', 'Wait nodes require a non-negative delayMs', 400, { nodeId: node.id })
    if (node.type === 'condition' && node.next.length !== 2) throw new AppError('VALIDATION_ERROR', 'Condition nodes require YES and NO branches', 400, { nodeId: node.id })
  }
  for (const node of definition.nodes) for (const next of node.next) if (!ids.has(next)) throw new AppError('VALIDATION_ERROR', `Workflow edge points to missing node ${next}`, 400, { nodeId: node.id })
  if (hasCycle(trigger.id, new Map(definition.nodes.map((node) => [node.id, node])))) throw new AppError('VALIDATION_ERROR', 'Workflow graph must be acyclic', 400)
}

export function activateWorkflow(definition: WorkflowDefinition, activatedAt: string): ActivatedWorkflow {
  validateWorkflow(definition)
  const canonical = JSON.stringify({ id: definition.id, storeId: definition.storeId, version: definition.version, nodes: definition.nodes })
  return Object.freeze({ ...definition, activatedAt, definitionHash: createHash('sha256').update(canonical).digest('hex') })
}

function isTrigger(value: WorkflowConfigValue): value is WorkflowTrigger { return value === 'manual' || value === 'cron' || value === 'shopify_webhook' }
function isAction(value: WorkflowConfigValue): value is WorkflowAction { return value === 'email' || value === 'sms' || value === 'tag' || value === 'discount' || value === 'wait' }
function hasCycle(root: string, nodes: ReadonlyMap<string, WorkflowNode>): boolean {
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const node = nodes.get(id); if (node && node.next.some((next) => visit(next))) return true; visiting.delete(id); visited.add(id); return false }
  return visit(root)
}
