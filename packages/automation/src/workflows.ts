import { createHash } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export const WORKFLOW_CATEGORIES = ['Marketing', 'Operations', 'Inventory', 'Customer', 'Revenue'] as const
export const WORKFLOW_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const
export const WORKFLOW_TRIGGERS = ['manual', 'cron', 'shopify_webhook'] as const
export const WORKFLOW_ACTIONS = ['email', 'tag_customer', 'create_discount', 'internal_notification', 'update_inventory'] as const
export const MAX_WORKFLOW_NODES = 50
export const MAX_WAIT_MS = 30 * 24 * 60 * 60 * 1_000

export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number]
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]
export type WorkflowNodeType = 'trigger' | 'condition' | 'action' | 'wait' | 'filter' | 'ai'
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number]
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number]
export type WorkflowConfigValue = string | number | boolean | null
export type WorkflowNode = Readonly<{ id: string; type: WorkflowNodeType; config: Readonly<Record<string, WorkflowConfigValue>>; next: readonly string[]; position?: Readonly<{ x: number; y: number }> }>
export type WorkflowDefinition = Readonly<{
  id: string
  storeId: StoreId
  name: string
  description: string | null
  category: WorkflowCategory
  tags: readonly string[]
  version: number
  nodes: readonly WorkflowNode[]
  timezone: string
  overlapPolicy: 'SKIP' | 'QUEUE' | 'PARALLEL'
}>
export type ActivatedWorkflow = Readonly<WorkflowDefinition & { activatedAt: string; definitionHash: string }>

export function validateWorkflow(definition: WorkflowDefinition): void {
  if (!definition.id.trim() || !definition.storeId.trim()) throw validation('Workflow id and store are required')
  if (!definition.name.trim() || definition.name.trim().length > 120) throw validation('Workflow name must be between 1 and 120 characters')
  if (!WORKFLOW_CATEGORIES.includes(definition.category)) throw validation('Workflow category is invalid')
  if (!Number.isInteger(definition.version) || definition.version < 1) throw validation('Workflow version must be a positive integer')
  if (definition.tags.length > 10 || definition.tags.some((tag) => !tag.trim() || tag.length > 40)) throw validation('Workflows support up to 10 non-empty tags of 40 characters')
  if (definition.nodes.length === 0) throw validation('Workflow must contain at least one node')
  if (definition.nodes.length > MAX_WORKFLOW_NODES) throw validation(`Workflow cannot contain more than ${MAX_WORKFLOW_NODES} nodes`)
  if (definition.nodes.filter((node) => node.type === 'trigger').length !== 1) throw validation('Workflow must contain exactly one trigger')
  const trigger = definition.nodes.find((node) => node.type === 'trigger')
  if (!trigger || !isTrigger(trigger.config.trigger ?? null)) throw validation('Workflow trigger must be manual, cron, or shopify_webhook')
  if (trigger.config.trigger === 'cron') validateCronConfig(trigger)
  if (trigger.config.trigger === 'shopify_webhook' && (typeof trigger.config.topic !== 'string' || !ALLOWED_WEBHOOK_TOPICS.has(trigger.config.topic))) throw validation('Shopify webhook trigger topic is not supported', trigger.id)

  const ids = new Set<string>()
  for (const node of definition.nodes) {
    if (!node.id.trim()) throw validation('Workflow node id cannot be empty')
    if (ids.has(node.id)) throw validation(`Duplicate workflow node ${node.id}`, node.id)
    ids.add(node.id)
    if (node.type === 'action' && !isAction(node.config.action ?? null)) throw validation('Workflow action is not available', node.id)
    if (node.type === 'wait') {
      const delayMs = node.config.delayMs
      if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_WAIT_MS) throw validation('Wait duration must be between 0 and 30 days', node.id)
    }
    if (node.type === 'condition' && node.next.length !== 2) throw validation('Condition nodes require YES and NO branches', node.id)
    if (node.type !== 'condition' && node.next.length > 1) throw validation('Only condition nodes can have multiple outgoing connections', node.id)
    if (node.type === 'ai' && typeof node.config.operation !== 'string') throw validation('AI nodes require an operation', node.id)
    validateActionSafety(node)
  }
  for (const node of definition.nodes) for (const next of node.next) if (!ids.has(next)) throw validation(`Workflow edge points to missing node ${next}`, node.id)
  const map = new Map(definition.nodes.map((node) => [node.id, node]))
  if (hasAnyCycle(map)) throw validation('Workflow graph must be acyclic')
  const reachable = reachableFrom(trigger.id, map)
  if (reachable.size !== definition.nodes.length) throw validation('Every workflow node must be connected to the trigger')
}

export function activateWorkflow(definition: WorkflowDefinition, activatedAt: string): ActivatedWorkflow {
  validateWorkflow(definition)
  const canonical = JSON.stringify({ id: definition.id, storeId: definition.storeId, name: definition.name, description: definition.description, category: definition.category, tags: definition.tags, version: definition.version, nodes: definition.nodes, timezone: definition.timezone ?? 'UTC', overlapPolicy: definition.overlapPolicy ?? 'SKIP' })
  return Object.freeze({ ...definition, activatedAt, definitionHash: createHash('sha256').update(canonical).digest('hex') })
}

export function triggerSummary(definition: Pick<WorkflowDefinition, 'nodes' | 'timezone'>): string {
  const trigger = definition.nodes.find((node) => node.type === 'trigger')
  if (!trigger) return 'Trigger not configured'
  if (trigger.config.trigger === 'manual') return 'Run on demand'
  if (trigger.config.trigger === 'cron') return `Scheduled · ${String(trigger.config.cron ?? 'not configured')} · ${definition.timezone ?? 'UTC'}`
  const label = String(trigger.config.topic ?? '').replaceAll('_', ' ').replace('/', ' ')
  return label ? `When Shopify ${label}` : 'When a Shopify event occurs'
}

export function isWorkflowCategory(value: unknown): value is WorkflowCategory { return typeof value === 'string' && WORKFLOW_CATEGORIES.includes(value as WorkflowCategory) }
export function isWorkflowStatus(value: unknown): value is WorkflowStatus { return typeof value === 'string' && WORKFLOW_STATUSES.includes(value as WorkflowStatus) }
export function isTrigger(value: unknown): value is WorkflowTrigger { return typeof value === 'string' && WORKFLOW_TRIGGERS.includes(value as WorkflowTrigger) }
export function isAction(value: unknown): value is WorkflowAction { return typeof value === 'string' && WORKFLOW_ACTIONS.includes(value as WorkflowAction) }

const ALLOWED_WEBHOOK_TOPICS = new Set(['orders/create', 'orders/updated', 'customers/create', 'customers/update', 'products/update', 'inventory_levels/update', 'checkouts/create'])
function validation(message: string, nodeId?: string): AppError { return new AppError('VALIDATION_ERROR', message, 400, nodeId ? { nodeId } : {}) }
function validateCronConfig(node: WorkflowNode): void {
  if (typeof node.config.cron !== 'string') throw validation('Scheduled triggers require a cron expression', node.id)
  const fields = node.config.cron.trim().split(/\s+/)
  if (fields.length !== 5 || fields.some((field) => !/^[\d*/?,\-]+$/.test(field))) throw validation('Cron expression must contain five valid fields', node.id)
}
function validateActionSafety(node: WorkflowNode): void {
  if (node.type !== 'action') return
  if (node.config.action === 'email' && node.config.maxRecipients !== undefined && (typeof node.config.maxRecipients !== 'number' || !Number.isInteger(node.config.maxRecipients) || node.config.maxRecipients < 1 || node.config.maxRecipients > 100)) throw validation('Email recipient cap must be between 1 and 100', node.id)
  if (node.config.action === 'create_discount') {
    const amount = node.config.amount
    const usageLimit = node.config.usageLimit
    if (typeof amount !== 'number' || amount < 1 || amount > 50) throw validation('Discount amount must be between 1 and 50', node.id)
    if (typeof usageLimit !== 'number' || !Number.isInteger(usageLimit) || usageLimit < 1) throw validation('Discount usage limit is required', node.id)
  }
  if (node.config.action === 'tag_customer' && typeof node.config.tag !== 'string') throw validation('Customer tag is required', node.id)
  if (node.config.action === 'update_inventory') {
    const adjustment = node.config.adjustment
    if (typeof adjustment !== 'number' || !Number.isInteger(adjustment) || Math.abs(adjustment) > 1_000) throw validation('Inventory adjustment must be an integer between -1000 and 1000', node.id)
  }
}
function hasAnyCycle(nodes: ReadonlyMap<string, WorkflowNode>): boolean {
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const node = nodes.get(id); if (node?.next.some(visit)) return true; visiting.delete(id); visited.add(id); return false }
  return [...nodes.keys()].some(visit)
}
function reachableFrom(root: string, nodes: ReadonlyMap<string, WorkflowNode>): Set<string> { const found = new Set<string>(); const visit = (id: string) => { if (found.has(id)) return; found.add(id); nodes.get(id)?.next.forEach(visit) }; visit(root); return found }
