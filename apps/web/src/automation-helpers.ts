import { BellRing, Boxes, Repeat, ShoppingCart, Sparkles, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { WorkflowCategory, WorkflowRecord, WorkflowStatus } from './automation-model.js'

/** Minimal node shape used by friendly-label helpers. */
export type NodeLike = Readonly<{
  type: string
  config: Readonly<Record<string, string | number | boolean | null>>
}>

/**
 * Merchant-friendly copy helpers for the Automation surface.
 *
 * Every string here is either the real backend value or a plain-English
 * translation of a real backend value — no fabricated numbers, no
 * invented metrics. Keep it that way.
 */

/**
 * A workflow is "empty / never used" when it has never run and does no real
 * work yet — zero steps, or just a starting point with no actions. Such drafts
 * are grouped under "Drafts needing attention" instead of cluttering the main grid.
 */
export function isEmptyWorkflow(workflow: WorkflowRecord): boolean {
  const neverRan = workflow.lastRunAt === null && workflow.successCount === 0 && workflow.failureCount === 0
  if (!neverRan) return false
  if (workflow.nodes.length === 0) return true
  return !workflow.nodes.some((node) => node.type === 'action' || node.type === 'ai')
}

/** Friendly, human-readable status label. */
export function friendlyStatus(status: WorkflowStatus): string {
  if (status === 'ACTIVE') return 'Active'
  if (status === 'DRAFT') return 'Draft'
  if (status === 'PAUSED') return 'Paused'
  return 'Archived'
}

/** Plain-English labels for real Shopify webhook topics. */
const TOPIC_LABELS: Readonly<Record<string, string>> = {
  'orders/create': 'New order received',
  'orders/updated': 'Order updated',
  'customers/create': 'New customer signed up',
  'customers/update': 'Customer updated',
  'products/update': 'Product updated',
  'inventory_levels/update': 'Stock level changed',
  'checkouts/create': 'Cart abandoned',
}

/** Friendly label for a trigger node. */
export function friendlyTriggerLabel(node: NodeLike): string {
  if (node.type !== 'trigger') return 'A store event happens'
  if (node.config.trigger === 'manual') return 'Run on demand'
  if (node.config.trigger === 'cron') return 'On a schedule'
  const topic = String(node.config.topic ?? '')
  return TOPIC_LABELS[topic] ?? 'A store event happens'
}

/** Friendly translation of a backend trigger summary string. */
export function friendlyTriggerSummary(summary: string | null | undefined): string {
  const value = (summary ?? '').trim()
  if (!value) return 'A store event happens'
  const lower = value.toLowerCase()
  if (lower.startsWith('run on')) return 'Run on demand'
  if (lower.startsWith('scheduled')) return 'On a schedule'
  const match = /^when shopify (.+)$/i.exec(value)
  if (!match?.[1]) return value
  const phrase = match[1].trim().toLowerCase()
  const byPhrase: Readonly<Record<string, string>> = {
    'orders create': 'New order received',
    'orders updated': 'Order updated',
    'customers create': 'New customer signed up',
    'customers update': 'Customer updated',
    'products update': 'Product updated',
    'inventory levels update': 'Stock level changed',
    'checkouts create': 'Cart abandoned',
  }
  return byPhrase[phrase] ?? `When ${phrase}`
}

/** Natural continuation for “Starts when …” on workflow cards. */
export function friendlyStartsWhen(summary: string | null | undefined): string {
  const friendly = friendlyTriggerSummary(summary)
  if (friendly === 'Run on demand') return 'you run it'
  if (friendly === 'On a schedule') return 'the schedule runs'
  if (friendly === 'New order received') return 'a new order is received'
  if (friendly === 'New customer signed up') return 'a new customer signs up'
  if (friendly === 'Stock level changed') return 'stock levels change'
  if (friendly === 'Cart abandoned') return 'a cart is abandoned'
  if (friendly === 'Order updated') return 'an order is updated'
  if (friendly === 'Customer updated') return 'a customer is updated'
  if (friendly === 'Product updated') return 'a product is updated'
  return friendly.toLowerCase()
}

/** Friendly label for an action node. */
export function friendlyActionLabel(node: NodeLike): string {
  if (node.type !== 'action') return 'Do something'
  const action = String(node.config.action ?? '')
  if (action === 'email') return 'Send email'
  if (action === 'tag_customer') return 'Add customer tag'
  if (action === 'create_discount') return 'Create discount code'
  if (action === 'internal_notification') return 'Notify you'
  if (action === 'update_inventory') return 'Update stock levels'
  return 'Do something'
}

/** Friendly label for an AI operation. */
export function friendlyAiLabel(operation: string): string {
  if (operation === 'classify_customer') return 'Smart classification'
  if (operation === 'classify_slow_inventory') return 'Spot slow-moving stock'
  if (operation === 'generate_content') return 'Generate content'
  if (operation === 'predict_churn') return 'Predict outcomes'
  if (operation === 'recommend_discount') return 'Suggest a discount'
  return 'AI step'
}

/** Friendly label for any node, used by the simple editor and cards. */
export function friendlyNodeLabel(node: NodeLike): string {
  if (node.type === 'trigger') return friendlyTriggerLabel(node)
  if (node.type === 'condition') return 'Check something'
  if (node.type === 'filter') return 'Only continue if'
  if (node.type === 'wait') return 'Wait for time'
  if (node.type === 'ai') return friendlyAiLabel(String(node.config.operation ?? ''))
  return friendlyActionLabel(node)
}

/** Friendly one-line description of what a node does. */
export function friendlyNodeSummary(node: NodeLike): string {
  if (node.type === 'trigger') {
    if (node.config.trigger === 'manual') return 'Starts when you run it'
    if (node.config.trigger === 'cron') return `Runs ${friendlyCron(String(node.config.cron ?? ''))}`
    const label = friendlyTriggerLabel(node)
    return label === 'A store event happens' ? 'Starts when a store event happens' : `Starts when ${label.toLowerCase()}`
  }
  if (node.type === 'condition' || node.type === 'filter') {
    const field = String(node.config.field ?? '')
    const operator = String(node.config.operator ?? 'equals')
    const value = String(node.config.value ?? '')
    if (operator === 'exists' && field) return `Only continues when ${friendlyField(field)} exists`
    if (field && operator && value) return `Only continues when ${friendlyField(field)} ${friendlyOperator(operator)} ${value}`
    return 'Only continues when the condition matches'
  }
  if (node.type === 'wait') {
    const minutes = Math.round(Number(node.config.delayMs ?? 0) / 60_000)
    if (minutes <= 0) return 'Waits for a short pause'
    if (minutes < 60) return `Waits ${minutes} minute${minutes === 1 ? '' : 's'}`
    if (minutes < 1440) return `Waits ${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'}`
    return `Waits ${Math.round(minutes / 1440)} day${Math.round(minutes / 1440) === 1 ? '' : 's'}`
  }
  if (node.type === 'ai') {
    return 'Uses AI to help with this step (Commander plan)'
  }
  const action = String(node.config.action ?? '')
  if (action === 'email') return 'Sends an email to the customer'
  if (action === 'tag_customer') return `Adds or removes the tag “${String(node.config.tag ?? '')}”`
  if (action === 'create_discount') return `Creates a ${String(node.config.amount ?? 10)}% discount code`
  if (action === 'internal_notification') return 'Notifies you so you can review'
  if (action === 'update_inventory') return 'Updates your stock levels'
  return 'Takes an action in your store'
}

/** Friendly names for real data fields used in conditions. */
function friendlyField(field: string): string {
  if (field.includes('order.total')) return 'order value'
  if (field.includes('order.')) return 'order detail'
  if (field.includes('inventory.')) return 'stock level'
  if (field.includes('customer.')) return 'customer detail'
  return field.replaceAll('_', ' ')
}

/** Friendly operator wording. */
export function friendlyOperator(operator: string): string {
  if (operator === 'equals') return 'is'
  if (operator === 'not_equals') return 'is not'
  if (operator === 'greater_than') return 'is more than'
  if (operator === 'less_than') return 'is less than'
  if (operator === 'contains') return 'contains'
  if (operator === 'between') return 'is between'
  return operator.replaceAll('_', ' ')
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Turn a real 5-field cron expression into a friendly phrase (best effort). */
export function friendlyCron(cron: string): string {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return 'on a schedule'
  const [minuteField, hourField, , , dayField] = fields
  const minute = minuteField === '*' || minuteField === undefined ? 0 : Number(minuteField)
  const hour = Number(hourField ?? 0)
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const period = hour < 12 ? 'AM' : 'PM'
  const time = `${hour12}:${String(minute).padStart(2, '0')} ${period}`
  if (dayField && dayField !== '*' && dayField !== '?') {
    const day = WEEKDAYS[Number(dayField) % 7] ?? 'that day'
    return `every ${day} at ${time}`
  }
  if (hourField === '*') return 'every hour'
  return `every day at ${time}`
}

/** Friendly label for a workflow category. */
export function friendlyCategory(category: WorkflowCategory | string): string {
  if (category === 'Marketing') return 'Sales & Growth'
  if (category === 'Customer') return 'Customer Experience'
  if (category === 'Operations') return 'Operations'
  if (category === 'Inventory') return 'Inventory & Stock'
  if (category === 'Revenue') return 'Revenue & Retention'
  return category
}

/** Visual tone class for template cards — maps the real category, never invented. */
export function templateToneClass(category: WorkflowCategory | string): string {
  if (category === 'Marketing') return 'sales-growth'
  if (category === 'Customer') return 'customer-experience'
  if (category === 'Inventory') return 'inventory-stock'
  if (category === 'Operations') return 'operations'
  return 'revenue-retention'
}

/**
 * One distinctive, recognizable icon per workflow category. Shared by template
 * cards and workflow cards so a category always carries the same icon — no
 * duplicates across categories.
 *   Marketing  → ShoppingCart  (sales & growth)
 *   Customer   → Users         (customer experience)
 *   Inventory  → Boxes         (inventory & stock)
 *   Operations → BellRing      (team alerts)
 *   Revenue    → Repeat        (revenue & retention)
 */
export function categoryIcon(category: WorkflowCategory | string): LucideIcon {
  if (category === 'Marketing') return ShoppingCart
  if (category === 'Customer') return Users
  if (category === 'Inventory') return Boxes
  if (category === 'Operations') return BellRing
  if (category === 'Revenue') return Repeat
  return Sparkles
}

/** Plan-badge class for the real minimum plan on a template. */
export function planBadgeClass(minimumPlan: 'trial' | 'start' | 'growth' | 'commander'): string {
  if (minimumPlan === 'trial') return 'all-plans'
  if (minimumPlan === 'start') return 'start'
  if (minimumPlan === 'growth') return 'growth'
  return 'commander'
}

/**
 * Segmented usage bar from real used/limit counts.
 * Unlimited (Commander) is flagged so the UI does not invent a cap.
 */
export function usageSegments(used: number, limit: number | null): { filled: number; empty: number; unlimited: boolean; total: number } {
  const safeUsed = Math.max(0, used)
  if (limit === null) return { filled: safeUsed, empty: 0, unlimited: true, total: Math.max(1, safeUsed) }
  const safeLimit = Math.max(1, limit)
  const filled = Math.min(safeUsed, safeLimit)
  return { filled, empty: safeLimit - filled, unlimited: false, total: safeLimit }
}

/**
 * Heights (0–100) for action mini-bars. All-zero stays all-zero —
 * never pad with decorative fake heights.
 */
export function actionBarHeights(values: readonly number[]): readonly number[] {
  const safe = values.map((value) => Math.max(0, value))
  const max = Math.max(0, ...safe)
  if (max === 0) return safe.map(() => 0)
  return safe.map((value) => Math.max(value > 0 ? 8 : 0, Math.round((value / max) * 100)))
}

/** Honest 2-point sparkline from last month vs this month. No invented daily series. */
export function monthSparkPath(previous: number, current: number): { line: string; area: string } {
  const prev = Math.max(0, previous)
  const curr = Math.max(0, current)
  const max = Math.max(prev, curr, 1)
  const yPrev = 36 - (prev / max) * 28
  const yCurr = 36 - (curr / max) * 28
  return {
    line: `M0,${yPrev.toFixed(1)} L100,${yCurr.toFixed(1)}`,
    area: `M0,${yPrev.toFixed(1)} L100,${yCurr.toFixed(1)} L100,40 L0,40 Z`,
  }
}

/** Short label for the real plan tier. */
export function planName(plan: 'trial' | 'start' | 'growth' | 'commander'): string {
  if (plan === 'trial') return 'Trial'
  if (plan === 'start') return 'Start'
  if (plan === 'growth') return 'Growth'
  return 'Commander'
}

/** Badge text shown on template cards for the real plan requirement. */
export function planBadgeLabel(minimumPlan: 'trial' | 'start' | 'growth' | 'commander'): string {
  if (minimumPlan === 'trial') return 'All plans'
  if (minimumPlan === 'commander') return 'Commander only'
  return `${planName(minimumPlan)} plan`
}

/** Friendly setup-time wording derived from the real template complexity. */
export function setupLabel(complexity: 'Simple' | 'Medium' | 'Advanced'): string {
  if (complexity === 'Simple') return 'Quick setup'
  if (complexity === 'Medium') return 'Moderate setup'
  return 'Advanced setup'
}

/** Relative time, merchant-friendly. */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/** Short calendar-ish date for "created" lines. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
