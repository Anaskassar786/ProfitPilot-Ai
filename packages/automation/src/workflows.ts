import { createHash } from 'node:crypto'
import { AppError, PhaseNotImplementedError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export type WorkflowNodeType = 'trigger' | 'condition' | 'action' | 'wait'
export type WorkflowNode = Readonly<{ id: string; type: WorkflowNodeType; config: Readonly<Record<string, string | number | boolean>>; next: readonly string[] }>
export type WorkflowDefinition = Readonly<{ id: string; storeId: StoreId; version: number; nodes: readonly WorkflowNode[] }>
export type ActivatedWorkflow = Readonly<WorkflowDefinition & { activatedAt: string; definitionHash: string }>

export function validateWorkflow(definition: WorkflowDefinition): void {
  if (definition.nodes.length === 0) throw new AppError('VALIDATION_ERROR', 'Workflow must contain at least one node', 400)
  if (definition.nodes.filter((node) => node.type === 'trigger').length !== 1) throw new AppError('VALIDATION_ERROR', 'Workflow must contain exactly one trigger', 400)
  const ids = new Set<string>()
  for (const node of definition.nodes) {
    if (ids.has(node.id)) throw new AppError('VALIDATION_ERROR', `Duplicate workflow node ${node.id}`, 400, { nodeId: node.id })
    ids.add(node.id)
  }
  for (const node of definition.nodes) {
    for (const next of node.next) {
      if (!ids.has(next)) throw new AppError('VALIDATION_ERROR', `Workflow edge points to missing node ${next}`, 400, { nodeId: node.id })
    }
  }
  const root = definition.nodes.find((node) => node.type === 'trigger')
  if (!root || hasCycle(root.id, new Map(definition.nodes.map((node) => [node.id, node])))) throw new AppError('VALIDATION_ERROR', 'Workflow graph must be acyclic', 400)
}

export function activateWorkflow(definition: WorkflowDefinition, activatedAt: string): ActivatedWorkflow {
  validateWorkflow(definition)
  const canonical = JSON.stringify({ id: definition.id, storeId: definition.storeId, version: definition.version, nodes: definition.nodes })
  return Object.freeze({ ...definition, activatedAt, definitionHash: createHash('sha256').update(canonical).digest('hex') })
}

export function executeWorkflow(_workflow: ActivatedWorkflow): never {
  throw new PhaseNotImplementedError('F6', 'Workflow worker execution')
}

function hasCycle(root: string, nodes: ReadonlyMap<string, WorkflowNode>): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const node = nodes.get(id)
    if (node && node.next.some((next) => visit(next))) return true
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return visit(root)
}
