import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { JarvisPlan } from './jarvis.js'

/**
 * Plan-gated store actions Jarvis can offer/execute. The tiers map directly to
 * the EXISTING plan definitions in @profitpilot/billing — no plan features or
 * pricing are changed here. The capability ladder is:
 *
 *   trial/start  → read-only answers (Jarvis describes and suggests, never writes)
 *   growth       → can propose safe actions and recommend them (approval required)
 *   commander    → can execute write actions after explicit confirmation
 *
 * Every action is either READ (safe, all plans) or WRITE (Commander-only and
 * confirmation-required). The registry never bypasses the existing entitlement
 * checks; the executor validates the plan first and refuses with a polite
 * upgrade message for lower plans.
 */

export type JarvisStoreActionKind = 'READ' | 'WRITE'

export type JarvisStoreActionDefinition = Readonly<{
  id: string
  label: string
  description: string
  kind: JarvisStoreActionKind
  /** Minimum plan required to EXECUTE the action. Read actions run on all plans. */
  minimumPlan: JarvisPlan
  /** Write actions always require confirmation; some reads may too. */
  requiresConfirmation: boolean
  /**
   * Canonical parameter schema (flat, primitive values). The LLM is told to
   * supply these; the executor validates presence and type before running.
   */
  parameters: readonly JarvisActionParameter[]
}>

export type JarvisActionParameter = Readonly<{
  name: string
  description: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
}>

export type JarvisActionInvocation = Readonly<{
  actionId: string
  parameters: Readonly<Record<string, string | number | boolean | null>>
}>

export type JarvisActionResult = Readonly<{
  executed: boolean
  message: string
  /** Set when the action needs merchant confirmation before it can run. */
  requiresConfirmation: boolean
  /** The plan the action requires, when it was refused. */
  requiredPlan?: JarvisPlan
}>

export type JarvisActionAuditEntry = Readonly<{
  id: string
  storeId: StoreId
  actionId: string
  plan: JarvisPlan
  parameters: Readonly<Record<string, string | number | boolean | null>>
  outcome: 'EXECUTED' | 'REFUSED_PLAN' | 'CONFIRMATION_REQUIRED' | 'FAILED'
  message: string
  at: number
}>

export interface JarvisActionAuditLog {
  record(entry: JarvisActionAuditEntry): Promise<void> | void
}

export type JarvisActionTool = (
  storeId: StoreId,
  parameters: Readonly<Record<string, string | number | boolean | null>>,
) => Promise<Readonly<{ message: string }>>

export type JarvisActionContext = Readonly<{
  storeId: StoreId
  plan: JarvisPlan
  confirmed: boolean
  tools: Readonly<Partial<Record<string, JarvisActionTool>>>
  audit?: JarvisActionAuditLog
  now?: () => number
  randomId?: () => string
}>

const PLAN_RANK: Readonly<Record<JarvisPlan, number>> = {
  trial: 0,
  start: 1,
  growth: 2,
  commander: 3,
}

export function planAtLeast(plan: JarvisPlan, required: JarvisPlan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[required]
}

export function planDisplayName(plan: JarvisPlan): string {
  if (plan === 'commander') return 'Commander'
  if (plan === 'growth') return 'Growth'
  if (plan === 'start') return 'Start'
  return 'Trial'
}

/**
 * The registry of actions Jarvis can take. These map to capabilities that
 * already exist in the product (recommendation decisions, store syncs). New
 * Shopify write actions (price/inventory changes) can be added later without
 * touching plan definitions — they simply declare `minimumPlan: 'commander'`
 * and `requiresConfirmation: true`.
 */
export const JARVIS_STORE_ACTIONS: readonly JarvisStoreActionDefinition[] = [
  {
    id: 'show_revenue',
    label: 'Show revenue',
    description: 'Read and explain total revenue for the current or closed period.',
    kind: 'READ',
    minimumPlan: 'trial',
    requiresConfirmation: false,
    parameters: [],
  },
  {
    id: 'show_orders',
    label: 'Show orders',
    description: 'Read and explain order counts, fulfilment, and cancellations.',
    kind: 'READ',
    minimumPlan: 'trial',
    requiresConfirmation: false,
    parameters: [],
  },
  {
    id: 'show_inventory',
    label: 'Show inventory',
    description: 'Read low-stock and days-of-cover signals from the catalog.',
    kind: 'READ',
    minimumPlan: 'trial',
    requiresConfirmation: false,
    parameters: [],
  },
  {
    id: 'approve_recommendation',
    label: 'Approve recommendation',
    description: 'Approve a pending AI recommendation so its workflow can run.',
    kind: 'WRITE',
    minimumPlan: 'commander',
    requiresConfirmation: true,
    parameters: [
      { name: 'recommendationId', description: 'The id of the pending recommendation to approve.', type: 'string', required: true },
    ],
  },
  {
    id: 'reject_recommendation',
    label: 'Reject recommendation',
    description: 'Reject a pending AI recommendation.',
    kind: 'WRITE',
    minimumPlan: 'commander',
    requiresConfirmation: true,
    parameters: [
      { name: 'recommendationId', description: 'The id of the pending recommendation to reject.', type: 'string', required: true },
    ],
  },
  {
    id: 'trigger_sync',
    label: 'Sync store data',
    description: 'Trigger a fresh data sync from Shopify so reports and analytics are current.',
    kind: 'WRITE',
    minimumPlan: 'commander',
    requiresConfirmation: true,
    parameters: [
      { name: 'module', description: 'The sync module (products, orders, customers, inventory) or "all".', type: 'string', required: false },
    ],
  },
]

const ACTIONS_BY_ID = new Map(JARVIS_STORE_ACTIONS.map((action) => [action.id, action]))

export function getJarvisStoreAction(id: string): JarvisStoreActionDefinition | null {
  return ACTIONS_BY_ID.get(id) ?? null
}

/** Actions visible to a given plan — used to build the LLM system prompt. */
export function actionsAvailableToPlan(plan: JarvisPlan): readonly JarvisStoreActionDefinition[] {
  return JARVIS_STORE_ACTIONS.filter((action) => planAtLeast(plan, action.minimumPlan))
}

/** Human-readable list of action capabilities shown to the model. */
export function describeActionsForPrompt(plan: JarvisPlan): string {
  const available = actionsAvailableToPlan(plan)
  if (available.length === 0) return 'No store actions are available on this plan. Answer from data only.'
  return available
    .map((action) => {
      const params = action.parameters.length > 0
        ? ` Parameters: ${action.parameters.map((parameter) => `${parameter.name} (${parameter.type}${parameter.required ? ', required' : ''})`).join('; ')}.`
        : ''
      const confirm = action.kind === 'WRITE' ? ' This requires explicit merchant confirmation before executing.' : ''
      return `- ${action.id}: ${action.description}${params}${confirm}`
    })
    .join('\n')
}

export class JarvisActionRegistry {
  private readonly tools: Readonly<Partial<Record<string, JarvisActionTool>>>
  private readonly audit: JarvisActionAuditLog | null
  private readonly now: () => number
  private readonly randomId: () => string

  public constructor(tools: Readonly<Partial<Record<string, JarvisActionTool>>> = {}, audit: JarvisActionAuditLog | null = null, now: () => number = () => Date.now(), randomId: () => string = () => Math.random().toString(36).slice(2)) {
    this.tools = tools
    this.audit = audit
    this.now = now
    this.randomId = randomId
  }

  /** Actions the current plan is allowed to see/describe. */
  public available(plan: JarvisPlan): readonly JarvisStoreActionDefinition[] {
    return actionsAvailableToPlan(plan)
  }

  /**
   * Offer an action: for lower plans this returns a polite refusal naming the
   * required plan; for Commander write actions it returns a confirmation
   * request until the merchant confirms; read actions run directly.
   */
  public async invoke(context: JarvisActionContext, invocation: JarvisActionInvocation): Promise<JarvisActionResult> {
    const definition = getJarvisStoreAction(invocation.actionId)
    const at = this.now()
    const audit = (outcome: JarvisActionAuditEntry['outcome'], message: string, requiresConfirmation = false, requiredPlan?: JarvisPlan): JarvisActionResult => {
      const entry: JarvisActionAuditEntry = {
        id: this.randomId(),
        storeId: context.storeId,
        actionId: invocation.actionId,
        plan: context.plan,
        parameters: invocation.parameters,
        outcome,
        message,
        at,
      }
      void this.audit?.record(entry)
      const result: JarvisActionResult = requiredPlan
        ? { executed: outcome === 'EXECUTED', message, requiresConfirmation, requiredPlan }
        : { executed: outcome === 'EXECUTED', message, requiresConfirmation }
      return result
    }

    if (!definition) return audit('FAILED', `Sir, I don't have an action called "${invocation.actionId}".`)

    // 1. Plan entitlement check FIRST — never execute past the plan.
    if (!planAtLeast(context.plan, definition.minimumPlan)) {
      const required = planDisplayName(definition.minimumPlan)
      const current = planDisplayName(context.plan)
      return audit(
        'REFUSED_PLAN',
        `Sir, executing store actions requires the ${required} plan. You're currently on ${current}. I can show you the relevant data and suggest what to do instead.`,
        false,
        definition.minimumPlan,
      )
    }

    // 2. Parameter validation.
    for (const parameter of definition.parameters) {
      const value = invocation.parameters[parameter.name]
      if (parameter.required && (value === null || value === undefined || value === '')) {
        return audit('FAILED', `Sir, the action "${definition.label}" needs a ${parameter.name}.`)
      }
      if (value !== null && value !== undefined && typeof value !== parameter.type) {
        return audit('FAILED', `Sir, ${parameter.name} should be a ${parameter.type}.`)
      }
    }

    // 3. Write actions require explicit confirmation.
    if (definition.kind === 'WRITE' && !context.confirmed) {
      return audit(
        'CONFIRMATION_REQUIRED',
        `Sir, I can ${definition.label.toLowerCase()}. Please confirm and I'll make the change.`,
        true,
      )
    }

    // 4. Execute through the wired tool.
    const tool = context.tools[invocation.actionId] ?? this.tools[invocation.actionId]
    if (!tool) {
      return audit('FAILED', `Sir, the "${definition.label}" action is not connected right now. I won't pretend it ran.`)
    }
    try {
      const output = await tool(context.storeId, invocation.parameters)
      return audit('EXECUTED', output.message)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'The action failed.'
      return audit('FAILED', `Sir, ${message}`)
    }
  }
}

/**
 * Thrown when an LLM-proposed action is malformed (used by prompt parsing).
 * Kept as an AppError so it surfaces as a 400 rather than a 500.
 */
export class JarvisActionParseError extends AppError {
  public constructor(message: string) {
    super('VALIDATION_ERROR', message, 400)
    this.name = 'JarvisActionParseError'
  }
}

/**
 * Parses a strict action invocation the model may emit on a dedicated line:
 *   @jarvis:action {"actionId":"approve_recommendation","parameters":{"recommendationId":"r1"}}
 * Returns null when no action is present (plain conversational answer).
 */
export function parseActionInvocation(text: string): { cleanText: string; invocation: JarvisActionInvocation | null } {
  const match = text.match(/@jarvis:action\s*(\{.*?\})\s*$/s)
  if (!match) return { cleanText: text.trim(), invocation: null }
  const payload: unknown = JSON.parse(match[1] ?? '{}')
  if (!payload || typeof payload !== 'object' || typeof (payload as { actionId?: unknown }).actionId !== 'string') {
    throw new JarvisActionParseError('Jarvis action invocation is missing a valid actionId')
  }
  const parameters = (payload as { parameters?: unknown }).parameters
  const cleanParameters: Readonly<Record<string, string | number | boolean | null>> = isParameterRecord(parameters) ? parameters : {}
  return {
    cleanText: text.slice(0, match.index).trim(),
    invocation: { actionId: (payload as { actionId: string }).actionId, parameters: cleanParameters },
  }
}

function isParameterRecord(value: unknown): value is Readonly<Record<string, string | number | boolean | null>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry))
}
