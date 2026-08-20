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
  /**
   * Client-executed actions (navigation) never touch store data — the browser
   * performs them. They are still declared here so the model knows they exist
   * and so the audit log records every attempt.
   */
  clientExecuted?: boolean
}>

export type JarvisActionParameter = Readonly<{
  name: string
  description: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  /**
   * Spoken follow-up Jarvis asks when the merchant did not supply this detail
   * ("Which automation should I set up, Sir?"). Voice-first slot filling: one
   * short question at a time instead of a silent failure.
   */
  question?: string
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
  /** Set when a required detail is missing and Jarvis asked a follow-up question. */
  needsDetails?: boolean
  /** The parameter Jarvis is waiting for, when `needsDetails` is true. */
  missingParameter?: string
  /** True for navigation-style actions the browser performs. */
  clientExecuted?: boolean
  /** The plan the action requires, when it was refused. */
  requiredPlan?: JarvisPlan
}>

export type JarvisActionAuditEntry = Readonly<{
  id: string
  storeId: StoreId
  actionId: string
  plan: JarvisPlan
  parameters: Readonly<Record<string, string | number | boolean | null>>
  outcome: 'EXECUTED' | 'REFUSED_PLAN' | 'CONFIRMATION_REQUIRED' | 'DETAILS_REQUIRED' | 'FAILED'
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
    id: 'low_stock_report',
    label: 'Low-stock report',
    description: 'Name the products that are running low so the merchant can reorder in time.',
    kind: 'READ',
    minimumPlan: 'trial',
    requiresConfirmation: false,
    parameters: [
      { name: 'threshold', description: 'Units on hand below which a product counts as low stock (default 10).', type: 'number', required: false },
    ],
  },
  {
    id: 'list_automations',
    label: 'List automations',
    description: 'Read back the automations that already exist and whether they are active, paused, or draft.',
    kind: 'READ',
    minimumPlan: 'trial',
    requiresConfirmation: false,
    parameters: [],
  },
  {
    /**
     * Navigation is performed by the browser, never by the server, so it is a
     * zero-risk READ action available on every plan: opening a page the
     * merchant already pays for cannot change store data.
     */
    id: 'navigate_page',
    label: 'Open a page',
    description: 'Open a workspace page for the merchant (dashboard, products, inventory, orders, customers, automation, analytics, reports, recommendations, billing, settings, ai-command).',
    kind: 'READ',
    minimumPlan: 'trial',
    requiresConfirmation: false,
    clientExecuted: true,
    parameters: [
      { name: 'page', description: 'The workspace page to open.', type: 'string', required: true, question: 'Which page would you like me to open?' },
    ],
  },
  {
    id: 'approve_recommendation',
    label: 'Approve recommendation',
    description: 'Approve a pending AI recommendation so its workflow can run.',
    kind: 'WRITE',
    minimumPlan: 'commander',
    requiresConfirmation: true,
    parameters: [
      { name: 'recommendationId', description: 'The id of the pending recommendation to approve.', type: 'string', required: true, question: 'Which recommendation should I approve?' },
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
      { name: 'recommendationId', description: 'The id of the pending recommendation to reject.', type: 'string', required: true, question: 'Which recommendation should I reject?' },
    ],
  },
  {
    id: 'create_automation',
    label: 'Create an automation',
    description: 'Create a new automation from the built-in workflow templates as a draft the merchant can review and activate. Templates include: welcome-customer, vip-tagging, high-value-order, low-stock-alert, post-purchase-thanks, abandoned-checkout, review-request, first-purchase-follow-up, win-back, repeat-purchase, back-in-stock, ai-segmentation, smart-discount, slow-moving-promotion, predictive-churn.',
    kind: 'WRITE',
    minimumPlan: 'commander',
    requiresConfirmation: true,
    parameters: [
      { name: 'template', description: 'The workflow template id to build from.', type: 'string', required: true, question: 'Which automation should I set up? For example, abandoned checkout recovery, a low-stock alert, or a welcome email for new customers.' },
      { name: 'name', description: 'A name for the new automation. Defaults to the template name.', type: 'string', required: false },
    ],
  },
  {
    id: 'set_automation_status',
    label: 'Pause or activate an automation',
    description: 'Pause, activate, or archive an existing automation by its id.',
    kind: 'WRITE',
    minimumPlan: 'commander',
    requiresConfirmation: true,
    parameters: [
      { name: 'workflowId', description: 'The automation id to change.', type: 'string', required: true, question: 'Which automation should I change?' },
      { name: 'status', description: 'ACTIVE, PAUSED, or ARCHIVED.', type: 'string', required: true, question: 'Should I pause it or activate it?' },
    ],
  },
  {
    id: 'generate_report',
    label: 'Generate a report',
    description: 'Generate a closed-period business report (daily, weekly, monthly, or quarterly).',
    kind: 'WRITE',
    minimumPlan: 'commander',
    requiresConfirmation: true,
    parameters: [
      { name: 'frequency', description: 'DAILY, WEEKLY, MONTHLY, or QUARTERLY.', type: 'string', required: true, question: 'Which period should the report cover — daily, weekly, monthly, or quarterly?' },
      { name: 'month', description: 'Optional month for a monthly report, as YYYY-MM.', type: 'string', required: false },
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
  const lines = available
    .map((action) => {
      const params = action.parameters.length > 0
        ? ` Parameters: ${action.parameters.map((parameter) => `${parameter.name} (${parameter.type}${parameter.required ? ', required' : ''})`).join('; ')}.`
        : ''
      const confirm = action.kind === 'WRITE' ? ' Requires the merchant to confirm out loud before it runs.' : ''
      return `- ${action.id}: ${action.description}${params}${confirm}`
    })
    .join('\n')
  if (plan === 'commander') return lines
  const locked = JARVIS_STORE_ACTIONS.filter((action) => !planAtLeast(plan, action.minimumPlan)).map((action) => action.label.toLowerCase())
  return locked.length > 0
    ? `${lines}\nLocked on this plan (offer the advice, never claim you did it): ${locked.join(', ')}. These need the Commander plan.`
    : lines
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
    const audit = (outcome: JarvisActionAuditEntry['outcome'], message: string, extra: Readonly<Partial<Omit<JarvisActionResult, 'executed' | 'message'>>> = {}): JarvisActionResult => {
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
      return { executed: outcome === 'EXECUTED', message, requiresConfirmation: false, ...extra }
    }

    if (!definition) return audit('FAILED', `I don't have an action called "${invocation.actionId}".`)

    // 1. Plan entitlement check FIRST — never execute past the plan.
    if (!planAtLeast(context.plan, definition.minimumPlan)) {
      const required = planDisplayName(definition.minimumPlan)
      const current = planDisplayName(context.plan)
      return audit(
        'REFUSED_PLAN',
        `Taking that action needs the ${required} plan — you're on ${current} right now. I can still pull up the numbers and tell you exactly what to do.`,
        { requiredPlan: definition.minimumPlan },
      )
    }

    // 2. Parameter validation. A missing required detail is not a failure: it
    //    is a question. Jarvis asks for one detail at a time, like a person.
    for (const parameter of definition.parameters) {
      const value = invocation.parameters[parameter.name]
      if (parameter.required && (value === null || value === undefined || value === '')) {
        return audit(
          'DETAILS_REQUIRED',
          parameter.question ?? `I need one more detail first — what should I use for ${parameter.name}?`,
          { needsDetails: true, missingParameter: parameter.name },
        )
      }
      if (value !== null && value !== undefined && typeof value !== parameter.type) {
        return audit(
          'DETAILS_REQUIRED',
          parameter.question ?? `Could you repeat the ${parameter.name}? I need it as a ${parameter.type}.`,
          { needsDetails: true, missingParameter: parameter.name },
        )
      }
    }

    // 3. Write actions require explicit confirmation.
    if (definition.kind === 'WRITE' && !context.confirmed) {
      return audit(
        'CONFIRMATION_REQUIRED',
        `I can ${definition.label.toLowerCase()}. Say "confirm" and I'll do it.`,
        { requiresConfirmation: true },
      )
    }

    // 4. Execute through the wired tool. Client-executed actions (navigation)
    //    have no server tool: the browser performs them after this ack.
    const tool = context.tools[invocation.actionId] ?? this.tools[invocation.actionId]
    if (!tool) {
      if (definition.clientExecuted) return audit('EXECUTED', `Opening that for you now.`, { clientExecuted: true })
      return audit('FAILED', `The "${definition.label}" action is not connected right now, so I won't pretend it ran.`)
    }
    try {
      const output = await tool(context.storeId, invocation.parameters)
      return audit('EXECUTED', output.message, definition.clientExecuted ? { clientExecuted: true } : {})
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'The action failed.'
      return audit('FAILED', message)
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
