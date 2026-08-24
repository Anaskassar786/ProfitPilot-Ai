import { randomUUID } from 'node:crypto'
import { AppError, PLAN_ENTITLEMENT_LIMITS } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { extractNumbers } from './language.js'

export const AI_COMMAND_READ_TOOLS = [
  'search_customers',
  'search_products',
  'search_orders',
  'get_analytics',
  'get_recommendations',
  'get_inventory_status',
  'get_store_health',
  'list_workflows',
] as const

export const AI_COMMAND_WRITE_TOOLS = [
  'send_email',
  'tag_customers',
  'create_discount',
  'approve_recommendation',
  'create_workflow',
  'trigger_workflow',
  'pause_workflow',
  'resume_workflow',
  'send_notification',
  'generate_report',
] as const

export const AI_COMMAND_TOOLS = [...AI_COMMAND_READ_TOOLS, ...AI_COMMAND_WRITE_TOOLS] as const
export type AiCommandToolName = (typeof AI_COMMAND_TOOLS)[number]
export type AiCommandWriteTool = (typeof AI_COMMAND_WRITE_TOOLS)[number]

export const AI_COMMAND_ACTION_TYPES = [
  'SEND_EMAIL',
  'TAG_CUSTOMER',
  'CREATE_DISCOUNT',
  'GENERATE_REPORT',
  'APPROVE_RECOMMENDATION',
  'CREATE_WORKFLOW',
  'TRIGGER_WORKFLOW',
  'PAUSE_WORKFLOW',
  'RESUME_WORKFLOW',
  'SEND_NOTIFICATION',
  'SEARCH_DATA',
] as const
export type AiCommandActionType = (typeof AI_COMMAND_ACTION_TYPES)[number]

export const AI_COMMAND_ACTION_STATUSES = [
  'PENDING',
  'EXECUTING',
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
] as const
export type AiCommandActionStatus = (typeof AI_COMMAND_ACTION_STATUSES)[number]

export type AiCommandContentType = 'text' | 'structured_data' | 'action_preview' | 'action_result' | 'error' | 'upgrade' | 'blocked' | 'offtopic'
export type AiCommandMessageRole = 'user' | 'assistant' | 'system'
export type AiCommandConversationStatus = 'ACTIVE' | 'ARCHIVED'
export type AiCommandResponseStyle = 'CONCISE' | 'DETAILED' | 'TECHNICAL'

export type AiCommandStructuredData = Readonly<{
  type: string
  data: unknown
  actions?: readonly string[]
  source?: string
}>

export type AiCommandMessageAction = Readonly<{
  id?: string
  type: AiCommandActionType | string
  status: AiCommandActionStatus | string
  params: Readonly<Record<string, unknown>>
  preview?: unknown
  result?: unknown
  executedAt?: string | null
  rollbackAvailable?: boolean
  rollbackDeadline?: string | null
}>

export type AiCommandMessage = Readonly<{
  id: string
  role: AiCommandMessageRole
  content: string
  contentType: AiCommandContentType
  structuredData: AiCommandStructuredData | null
  action: AiCommandMessageAction | null
  thinkingSteps: readonly string[] | null
  timestamp: string
}>

export type AiCommandConversation = Readonly<{
  id: string
  storeId: StoreId
  title: string
  messages: readonly AiCommandMessage[]
  context: Readonly<Record<string, unknown>>
  status: AiCommandConversationStatus
  createdAt: string
  updatedAt: string
  lastMessageAt: string
}>

export type AiCommandActionRecord = Readonly<{
  id: string
  storeId: StoreId
  conversationId: string | null
  actionType: AiCommandActionType
  actionParams: Readonly<Record<string, unknown>>
  actionPreview: unknown
  merchantApproved: boolean
  approvedAt: string | null
  executionStatus: AiCommandActionStatus
  executionResult: unknown
  errorDetails: unknown
  rollbackAvailable: boolean
  rollbackDeadline: string | null
  rolledBackAt: string | null
  createdAt: string
  completedAt: string | null
}>

export type AiCommandSavedCommand = Readonly<{
  id: string
  storeId: StoreId
  name: string
  commandText: string
  category: string
  useCount: number
  lastUsedAt: string | null
  createdAt: string
}>

export type AiCommandUsage = Readonly<{
  storeId: StoreId
  usageDate: string
  commandsUsed: number
  actionsExecuted: number
  tokensUsed: number
  costMicroDollars: number
  limit: number | null
  remaining: number | null
  actionsEnabled: boolean
}>

export type AiCommandPreferences = Readonly<{
  storeId: StoreId
  defaultResponseStyle: AiCommandResponseStyle
  quickCommandsEnabled: boolean
  autoSuggestionsEnabled: boolean
  thinkingAnimationEnabled: boolean
  conversationMemoryEnabled: boolean
  notificationOnActionComplete: boolean
  createdAt: string
  updatedAt: string
}>

export type AiCommandQuickCommand = Readonly<{
  id: string
  label: string
  command: string
  kind: 'info' | 'action'
}>

/** Live snapshot values. Null means the backing store has no synced data; it is
 * deliberately not replaced with a demo value. */
export type AiCommandQuickInsights = Readonly<{
  currency: string | null
  revenueToday: number | null
  revenueYesterday: number | null
  ordersToday: number | null
  ordersYesterday: number | null
  lowStockCount: number | null
  healthScore: number | null
  healthStatus: string | null
  sources: readonly string[]
}>

export type AiCommandSuggestion = Readonly<{ label: string; command: string }>

export type AiCommandPlanLimits = Readonly<{
  commandsPerDay: number | null
  actionsEnabled: boolean
  memoryHours: number | null
  savedCommands: number | null
  historyDays: number | null
  exportConversations: boolean
  undoSeconds: number
}>

// Daily command caps are read from `PLAN_ENTITLEMENT_LIMITS.ai_command_daily`
// (the billing entitlement table) so plan gating and billing can never drift:
// Trial 10 · Start 100 · Growth 300 · Commander unlimited.
export const AI_COMMAND_PLAN_LIMITS: Readonly<Record<PlanTier, AiCommandPlanLimits>> = {
  trial: { commandsPerDay: PLAN_ENTITLEMENT_LIMITS.trial.ai_command_daily, actionsEnabled: false, memoryHours: 0, savedCommands: 3, historyDays: 7, exportConversations: false, undoSeconds: 0 },
  start: { commandsPerDay: PLAN_ENTITLEMENT_LIMITS.start.ai_command_daily, actionsEnabled: false, memoryHours: 0, savedCommands: 10, historyDays: 30, exportConversations: false, undoSeconds: 0 },
  growth: { commandsPerDay: PLAN_ENTITLEMENT_LIMITS.growth.ai_command_daily, actionsEnabled: false, memoryHours: 24, savedCommands: 25, historyDays: 90, exportConversations: true, undoSeconds: 0 },
  commander: { commandsPerDay: PLAN_ENTITLEMENT_LIMITS.commander.ai_command_daily, actionsEnabled: true, memoryHours: null, savedCommands: null, historyDays: null, exportConversations: true, undoSeconds: 30 },
}

export type ToolCall = Readonly<{ name: AiCommandToolName; params: Readonly<Record<string, unknown>> }>
export type ToolSuccess = Readonly<{ ok: true; name: AiCommandToolName; data: unknown; source: string; numbers: readonly number[] }>
export type ToolFailure = Readonly<{ ok: false; name: AiCommandToolName; error: string; source: string }>
export type ToolOutcome = ToolSuccess | ToolFailure

export interface AiCommandToolRuntime {
  run(storeId: StoreId, call: ToolCall): Promise<ToolOutcome>
}

export type ActionExecutionResult = Readonly<{
  status: Extract<AiCommandActionStatus, 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED'>
  result: unknown
  errorDetails?: unknown
  rollbackAvailable: boolean
}>

export type ActionPreflightResult = Readonly<{
  ok: boolean
  reason?: string | null
  missingScope?: string | null
  /** Deep link that restarts Shopify OAuth so the merchant can grant the scope. */
  reauthorizeUrl?: string | null
}>

export interface AiCommandActionRuntime {
  execute(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult>
  rollback?(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult>
  /**
   * Verifies the live Shopify session token can actually perform this action
   * BEFORE the preview is rendered. When the required scope (e.g.
   * `write_discounts`) is missing the merchant is shown a re-authorize /
   * re-install prompt instead of approving a preview that can only fail.
   */
  preflight?(storeId: StoreId, actionType: AiCommandActionType): Promise<ActionPreflightResult>
}

export interface AiCommandRepository {
  createConversation(conversation: AiCommandConversation): Promise<AiCommandConversation>
  getConversation(storeId: StoreId, id: string): Promise<AiCommandConversation | null>
  listConversations(storeId: StoreId, limit?: number): Promise<readonly AiCommandConversation[]>
  saveConversation(conversation: AiCommandConversation): Promise<AiCommandConversation>
  deleteConversation(storeId: StoreId, id: string): Promise<boolean>
  createAction(action: AiCommandActionRecord): Promise<AiCommandActionRecord>
  getAction(storeId: StoreId, id: string): Promise<AiCommandActionRecord | null>
  listActions(storeId: StoreId, limit?: number): Promise<readonly AiCommandActionRecord[]>
  saveAction(action: AiCommandActionRecord): Promise<AiCommandActionRecord>
  /** Atomically moves one pending action into EXECUTING. A null result means
   * another request already approved or cancelled it. */
  claimAction(storeId: StoreId, id: string, approvedAt: string): Promise<AiCommandActionRecord | null>
  /** Atomically cancels one pending action. */
  cancelPendingAction(storeId: StoreId, id: string, completedAt: string): Promise<AiCommandActionRecord | null>
  /** Atomically consumes the rollback window so undo runs at most once. */
  claimRollback(storeId: StoreId, id: string, now: string): Promise<AiCommandActionRecord | null>
  listSaved(storeId: StoreId): Promise<readonly AiCommandSavedCommand[]>
  saveCommand(command: AiCommandSavedCommand): Promise<AiCommandSavedCommand>
  deleteSaved(storeId: StoreId, id: string): Promise<boolean>
  getSaved(storeId: StoreId, id: string): Promise<AiCommandSavedCommand | null>
  incrementUsage(storeId: StoreId, usageDate: string, delta: Readonly<{ commands?: number; actions?: number; tokens?: number; costMicroDollars?: number }>): Promise<AiCommandUsage>
  /** Atomically reserves one command slot and returns null at the plan cap. */
  reserveCommand(storeId: StoreId, usageDate: string, limit: number | null): Promise<AiCommandUsage | null>
  getUsage(storeId: StoreId, usageDate: string): Promise<AiCommandUsage>
  listUsage(storeId: StoreId, days: number): Promise<readonly AiCommandUsage[]>
  getPreferences(storeId: StoreId): Promise<AiCommandPreferences>
  savePreferences(preferences: AiCommandPreferences): Promise<AiCommandPreferences>
}

export type AiCommandChatResult = Readonly<{
  conversation: AiCommandConversation
  message: AiCommandMessage
  usage: AiCommandUsage
  thinkingSteps: readonly string[]
}>

export type ChatListener = (event: 'thinking' | 'message' | 'usage' | 'done', payload: unknown) => void

export type AiCommandGenerateInput = Readonly<{
  system: string
  user: string
  tools: readonly AiCommandToolDefinition[]
}>

export type AiCommandGenerateResult = Readonly<{
  text: string
  toolCalls: readonly ToolCall[]
  tokensUsed: number
  model: string
}>

export type AiCommandToolDefinition = Readonly<{
  name: AiCommandToolName
  description: string
  parameters: Readonly<Record<string, unknown>>
  commanderOnly: boolean
}>

export const AI_COMMAND_TOOL_DEFINITIONS: readonly AiCommandToolDefinition[] = [
  { name: 'search_customers', description: 'Query real customer records with filters.', commanderOnly: false, parameters: { type: 'object', properties: { query: { type: 'string' }, segment: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'search_products', description: 'Query real product catalog records.', commanderOnly: false, parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'search_orders', description: 'Query real Shopify orders.', commanderOnly: false, parameters: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'get_analytics', description: 'Read real revenue, orders, and AOV metrics.', commanderOnly: false, parameters: { type: 'object', properties: { metric: { type: 'string' }, date_range: { type: 'string' } } } },
  { name: 'get_recommendations', description: 'Fetch real AI recommendations.', commanderOnly: false, parameters: { type: 'object', properties: { status: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'get_inventory_status', description: 'Query real inventory levels.', commanderOnly: false, parameters: { type: 'object', properties: { filter: { type: 'string' }, threshold: { type: 'number' } } } },
  { name: 'get_store_health', description: 'Calculate store health from real analytics and inventory.', commanderOnly: false, parameters: { type: 'object', properties: {} } },
  { name: 'list_workflows', description: 'List the real automation workflows and their run status.', commanderOnly: false, parameters: { type: 'object', properties: { status: { type: 'string' }, query: { type: 'string' } } } },
  { name: 'send_email', description: 'Preview then send email via the merchant-verified Brevo transport.', commanderOnly: true, parameters: { type: 'object', properties: { recipient_ids: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, body: { type: 'string' } } } },
  { name: 'tag_customers', description: 'Preview then add or remove Shopify customer tags.', commanderOnly: true, parameters: { type: 'object', properties: { customer_ids: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } }, action: { type: 'string' } } } },
  { name: 'create_discount', description: 'Preview then create a Shopify discount with safety caps.', commanderOnly: true, parameters: { type: 'object', properties: { title: { type: 'string' }, type: { type: 'string' }, value: { type: 'number' }, usage_limit: { type: 'number' }, expires_at: { type: 'string' } } } },
  { name: 'approve_recommendation', description: 'CAS-approve a pending recommendation.', commanderOnly: true, parameters: { type: 'object', properties: { recommendation_id: { type: 'string' }, expected_version: { type: 'number' } } } },
  { name: 'create_workflow', description: 'Preview then create a governed automation workflow from a supported template.', commanderOnly: true, parameters: { type: 'object', properties: { template_id: { type: 'string' }, name: { type: 'string' }, activate: { type: 'boolean' } } } },
  { name: 'trigger_workflow', description: 'Trigger an existing automation workflow.', commanderOnly: true, parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } } },
  { name: 'pause_workflow', description: 'Pause an active automation workflow.', commanderOnly: true, parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } } },
  { name: 'resume_workflow', description: 'Resume a paused automation workflow.', commanderOnly: true, parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } } },
  { name: 'send_notification', description: 'Create an in-app merchant notification.', commanderOnly: true, parameters: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' }, priority: { type: 'string' } } } },
  { name: 'generate_report', description: 'Generate a closed-period report from real data.', commanderOnly: true, parameters: { type: 'object', properties: { report_type: { type: 'string' }, date_range: { type: 'string' } } } },
]

const BLOCKED_PATTERNS: readonly Readonly<{ pattern: RegExp; action: string; reason: string; page: string; steps: string }>[] = [
  { pattern: /\b(delete|remove permanently|wipe)\b.*\b(customers?|products?|orders?|store)\b/i, action: 'delete store data', reason: 'Destructive deletes are irreversible and must be reviewed in Shopify.', page: 'the matching Shopify admin page', steps: 'Open the record in Shopify Admin and delete it there if you are sure.' },
  { pattern: /\b(refund|chargeback|void payment)\b/i, action: 'process a refund', reason: 'Refunds move money and cannot be undone from AI Command.', page: 'Orders', steps: 'Open the order → Refund and complete the refund in Shopify.' },
  { pattern: /\b(bulk|all)\b.*\b(price|prices)\b|\bchange (every|all) price/i, action: 'modify product prices in bulk', reason: 'Bulk price changes require manual review to prevent errors.', page: 'Products', steps: 'Filter the catalog and edit prices one product at a time, or use Shopify bulk editor.' },
  { pattern: /\b(bulk|all)\b.*\b(inventory|stock|quantity)\b/i, action: 'change inventory quantities in bulk', reason: 'Bulk inventory writes can create stockouts or oversells.', page: 'Inventory', steps: 'Adjust stock per variant in Inventory or Shopify locations.' },
  { pattern: /\b(billing|payment method|credit card|subscription charge)\b/i, action: 'access billing or payment information', reason: 'Billing is isolated from AI Command for security.', page: 'Billing', steps: 'Open Billing to review plans, usage, and charges.' },
  { pattern: /\b(app settings|store configuration|change theme|uninstall)\b/i, action: 'modify app or store configuration', reason: 'Configuration changes stay outside the command surface.', page: 'Settings', steps: 'Update the setting on the Settings page or in Shopify Admin.' },
]

const WRITE_INTENT: Readonly<Record<AiCommandWriteTool, RegExp>> = {
  send_email: /\b(send|email|mail|draft)\b.*\b(customers?|vips?|them|those|these|segment|list)\b/i,
  tag_customers: /\b(tag|untag|label)\b.*\bcustomer/i,
  create_discount: /\b(create|make|generate)\b.*\b(discount|coupon|promo code)\b/i,
  approve_recommendation: /\b(approve|accept)\b.*\brecommend/i,
  create_workflow: /\b(create|make|build|set up)\b.*\b(workflow|automation)\b/i,
  trigger_workflow: /\b(trigger|run|start)\b.*\b(workflow|automation)\b/i,
  // Automation shutdown language is deliberately matched before any read-tool
  // parsing. In particular, "cancel" belongs to workflow control when its
  // target is an automation; it must never be interpreted as an order search.
  pause_workflow: /\b(pause|stop|disable|deactivate|cancel|turn off|shut down)\b.*\b(workflows?|automations?)\b|\b(workflows?|automations?)\b.*\b(pause|stop|disable|deactivate|cancel|turn off|shut down)\b/i,
  resume_workflow: /\b(resume|enable|turn on|unpause)\b.*\b(workflow|automation)\b/i,
  send_notification: /\b(notify|notification|alert me|send a notification)\b/i,
  generate_report: /\b(generate|create|build)\b.*\breport\b/i,
}

const REVERSIBLE_ACTIONS = new Set<AiCommandActionType>(['TAG_CUSTOMER', 'CREATE_DISCOUNT', 'SEND_NOTIFICATION'])

/**
 * The single merchant-facing sentence used for EVERY Shopify authorization
 * failure (HTTP 401/403 or GraphQL ACCESS_DENIED), whether it is detected by
 * the preflight scope probe or thrown mid-execution. Raw transport strings such
 * as "9414254756053 — Shopify API request failed with 403" must never reach the
 * merchant.
 */
export const SHOPIFY_PERMISSION_MESSAGE = '⚠️ Action requires additional Shopify permissions. Please re-authorize or reinstall ProfitPilot from Shopify Admin to grant updated permissions.'

/**
 * Recognises a permission failure recorded by the action runtime. The runtime
 * (which owns the Shopify client) classifies the error and records a
 * `MISSING_*_SCOPE` / `SHOPIFY_PERMISSION_DENIED` reason plus the re-authorize
 * link; this reads that structured channel back out. The raw-status regexes are
 * a defensive net for any handler that has not been migrated yet.
 */
export function shopifyPermissionFailure(action: AiCommandActionRecord): Readonly<{ message: string; missingScope: string | null; reauthorizeUrl: string | null }> | null {
  const details = isRecord(action.errorDetails) ? action.errorDetails : null
  const result = isRecord(action.executionResult) ? action.executionResult : null
  const reason = details && typeof details.reason === 'string' ? details.reason : ''
  const missingScope = firstString(details?.missingScope, result?.missingScope)
  const texts = [
    details && typeof details.message === 'string' ? details.message : '',
    result && typeof result.message === 'string' ? result.message : '',
    ...(Array.isArray(details?.reasons) ? details.reasons.map(String) : []),
    ...(Array.isArray(result?.reasons) ? result.reasons.map(String) : []),
  ].filter(Boolean)
  const coded = /_SCOPE$|^SHOPIFY_PERMISSION_DENIED$|^ACCESS_DENIED$/i.test(reason)
  const rawPermission = texts.some((text) => /request failed with 40[13]\b|\baccess[_ ]denied\b|\bforbidden\b|missing .*permission|requires? .*(?:scope|permission)/i.test(text))
  if (!coded && !rawPermission && !missingScope) return null
  const scopeSuffix = missingScope ? ` Missing permission: ${missingScope}.` : ''
  return {
    message: `${SHOPIFY_PERMISSION_MESSAGE}${scopeSuffix}`,
    missingScope,
    reauthorizeUrl: firstString(details?.reauthorizeUrl, result?.reauthorizeUrl),
  }
}

function firstString(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function limitsForPlan(plan: PlanTier): AiCommandPlanLimits {
  return AI_COMMAND_PLAN_LIMITS[plan]
}

/* ── Plan & billing-state gating ────────────────────────────────────── */

/**
 * Billing states that gate Commander, mirroring `BillingState` in
 * @profitpilot/billing. Duplicated here (and validated by normalize below)
 * so the AI package never imports the billing package.
 */
export type AiCommandBillingState =
  | 'ACTIVE_MONTHLY'
  | 'ACTIVE_ANNUAL'
  | 'GIFT_ACCESS_UNLIMITED'
  | 'TRIAL_LIMITED'
  | 'TRIAL_EXPIRED'
  | 'PENDING_CONFIRMATION'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED'

export const AI_COMMAND_BILLING_STATES: readonly AiCommandBillingState[] = [
  'ACTIVE_MONTHLY',
  'ACTIVE_ANNUAL',
  'GIFT_ACCESS_UNLIMITED',
  'TRIAL_LIMITED',
  'TRIAL_EXPIRED',
  'PENDING_CONFIRMATION',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
]

/** Commander is fully active — the plan tier alone decides answers vs actions. */
export const AI_COMMAND_ACTIVE_BILLING_STATES: readonly AiCommandBillingState[] = ['ACTIVE_MONTHLY', 'ACTIVE_ANNUAL', 'GIFT_ACCESS_UNLIMITED']
/** Answers only: data queries allowed, actions never execute. */
export const AI_COMMAND_LIMITED_BILLING_STATES: readonly AiCommandBillingState[] = ['TRIAL_LIMITED']
/** Commander is refused: expired / pending / past-due / cancelled / suspended. */
export const AI_COMMAND_BLOCKED_BILLING_STATES: readonly AiCommandBillingState[] = ['TRIAL_EXPIRED', 'PENDING_CONFIRMATION', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']

export type AiCommandBillingMode = 'active' | 'limited' | 'blocked'

export function aiCommandBillingMode(state: AiCommandBillingState): AiCommandBillingMode {
  if ((AI_COMMAND_BLOCKED_BILLING_STATES as readonly string[]).includes(state)) return 'blocked'
  if ((AI_COMMAND_LIMITED_BILLING_STATES as readonly string[]).includes(state)) return 'limited'
  return 'active'
}

/**
 * Unknown or missing billing records degrade to `TRIAL_LIMITED`, never to
 * full access — a store we cannot identify gets the safest minimal surface.
 */
export function normalizeAiCommandBillingState(value: unknown): AiCommandBillingState {
  return typeof value === 'string' && (AI_COMMAND_BILLING_STATES as readonly string[]).includes(value)
    ? (value as AiCommandBillingState)
    : 'TRIAL_LIMITED'
}

/** The resolved Commander access decision for one store. */
export type AiCommandAccess = Readonly<{
  plan: PlanTier
  billingState: AiCommandBillingState | null
  mode: AiCommandBillingMode
  actionsEnabled: boolean
}>

/**
 * Merchant-facing message when the billing state blocks Commander (trial
 * expired / pending / past-due / cancelled / suspended). One honest sentence
 * per state, each ending on the way back in, never a fake capability.
 */
export function renderBillingBlockedResponse(state: AiCommandBillingState): string {
  if (state === 'TRIAL_EXPIRED') return 'Your ProfitPilot trial has expired, so Commander is paused. Your store data, conversations, and settings are exactly as you left them — Upgrade Plan to bring your AI Commander back.'
  if (state === 'PENDING_CONFIRMATION') return 'Your plan change is waiting for payment confirmation. Commander unlocks automatically as soon as the charge is confirmed — please check back in a few minutes.'
  if (state === 'PAST_DUE') return 'A payment issue has paused Commander for this store. Update your payment method in Billing to restore full access.'
  if (state === 'SUSPENDED') return 'This store is currently suspended. Resolve the billing hold or contact support from the Billing page to bring Commander back.'
  if (state === 'CANCELLED') return 'Your subscription is cancelled. Reactivate a plan from Billing to bring Commander back — your data and settings are waiting for you.'
  return 'Commander is not active on this store right now. Upgrade Plan from the Billing page to unlock it.'
}

export function toolToActionType(name: AiCommandToolName): AiCommandActionType {
  if (name === 'send_email') return 'SEND_EMAIL'
  if (name === 'tag_customers') return 'TAG_CUSTOMER'
  if (name === 'create_discount') return 'CREATE_DISCOUNT'
  if (name === 'generate_report') return 'GENERATE_REPORT'
  if (name === 'approve_recommendation') return 'APPROVE_RECOMMENDATION'
  if (name === 'create_workflow') return 'CREATE_WORKFLOW'
  if (name === 'trigger_workflow') return 'TRIGGER_WORKFLOW'
  if (name === 'pause_workflow') return 'PAUSE_WORKFLOW'
  if (name === 'resume_workflow') return 'RESUME_WORKFLOW'
  if (name === 'send_notification') return 'SEND_NOTIFICATION'
  return 'SEARCH_DATA'
}

export function isWriteTool(name: string): name is AiCommandWriteTool {
  return (AI_COMMAND_WRITE_TOOLS as readonly string[]).includes(name)
}

export function detectBlockedAction(query: string): Readonly<{ action: string; reason: string; page: string; steps: string }> | null {
  for (const entry of BLOCKED_PATTERNS) {
    if (entry.pattern.test(query)) return { action: entry.action, reason: entry.reason, page: entry.page, steps: entry.steps }
  }
  return null
}

export function detectWriteTool(query: string): AiCommandWriteTool | null {
  for (const [name, pattern] of Object.entries(WRITE_INTENT) as readonly [AiCommandWriteTool, RegExp][]) {
    if (pattern.test(query)) return name
  }
  return null
}

// Advisory verbs the merchant can use to ask for *guidance* (not a lookup).
// "how" alone is intentionally excluded so trend/lookup questions such as
// "how is my revenue trending" stay analytical instead of collapsing to a
// growth plan.
const GROWTH_TRIGGER = /\b(?:help|ways?|ideas?|opportunit(?:y|ies)|strateg(?:y|ies)|plan|tips?|advice|suggest(?:ion|ions)?|recommend(?:ation|ations|s)?|how\s+(?:can|do|should|would|to|kaise)|increase|increasing|grow|growing|boost|boosting|improve|improving|maximi[sz]e|badhao|badhana|badhaye|karo|karen|kaise)\b/i
// Business outcomes the merchant wants to move (revenue, profit, retention…).
const GROWTH_GOAL = /\b(?:grow(?:th)?|sales?|revenue|profit(?:s|ability)?|margin?s?|conversion|retention|earnings?|income|money)\b/i
const GROWTH_INTENT = new RegExp(`(?:${GROWTH_TRIGGER.source}.{0,40}${GROWTH_GOAL.source})|(?:${GROWTH_GOAL.source}.{0,40}${GROWTH_TRIGGER.source})`, 'i')

/** Distinguishes a request for growth guidance from a plain revenue lookup. */
export function detectGrowthIntent(query: string): boolean {
  return GROWTH_INTENT.test(query)
}

// "How do I / how to / what is / explain" phrasing that signals the merchant
// wants guidance on using a feature rather than a data lookup.
const HOW_TO_TRIGGER = /\b(?:how\s+(?:do|to|can|does|should|would)|set\s?up|create an?|guide me|walk me|explain|help me|what is|what are|what can|tell me about|how does|kaise\s+help\s+karoge|help\s+kaise\s+karoge|kya\s+kar\s+sakte\s+ho|tum\s+kya\s+karoge)\b/i

// General assistant-capability questions need an explicit fast path. These are
// intentionally language patterns rather than a broad `help` keyword so
// "help increase revenue" remains a data-backed growth request.
const CAPABILITY_TRIGGER = /\b(?:what can you do(?: for me)?|how can you help(?: me)?|what are your capabilities|show (?:me )?(?:your )?capabilities|how to use profitpilot|help me|tum meri help kaise karoge|kya kar sakte ho|tum kya karoge|kaise help karoge)\b/i

const INSTRUCTIONAL_TOPICS: readonly Readonly<{ topic: string; pattern: RegExp }>[] = [
  { topic: 'automation', pattern: /\b(?:automation|automations|automate|workflow|workflows|abandoned cart|win[ -]?back|welcome (?:email|series|flow)|drip|automated email|email (?:automation|flow|sequence|campaign)|broadcast|sequence)\b/i },
  { topic: 'patternai', pattern: /\b(?:patternai|pattern ai|insight hub|product ai)\b/i },
  { topic: 'recommendations', pattern: /\b(?:recommend(?:ation|ations|s)?|what should i do|next steps?|prioriti)/i },
]

// Store metrics and entities a merchant can look up. A "what is/what are"
// question that mentions one of these ("What is my revenue this month?") is a
// data lookup that parseInfoTools can answer from live data — mirroring its
// patterns — not a generic "what can this app do" guide. It must be answered
// from real analytics (INTENT B), never with the generic instructional help
// card.
const DATA_LOOKUP_SIGNAL = /\b(?:revenue|sales?|aov|average order value|analytics|metrics?|profit(?:s|ability)?|margins?|earnings?|income|orders?|customers?|products?|catalog|skus?|inventory|stock(?:out)?|conversion|traffic|refunds?|performance|trends?|recap|summar(?:y|ies)|overview|this month|today|payouts?|best[ -]?sellers?|purchases?|spend|sold)\b/i

/**
 * Detects instructional / how-to questions (INTENT C). Returns a topic key or
 * null. Requires an explicit "how/what/explain/set up" phrasing so plain
 * lookups such as "Show automation status" still route to live data. The
 * generic "what can you do" guide is reserved for true capability questions:
 * when parseInfoTools data signals (revenue, orders, products, customers,
 * AOV…) are present, the analytics/info-tool path answers instead.
 */
export function detectInstructionalIntent(query: string): string | null {
  const text = query.trim()
  if (!text) return null
  if (!HOW_TO_TRIGGER.test(text) && !CAPABILITY_TRIGGER.test(text)) return null
  // An explicit measurable target always wins over general help wording:
  // "help me with revenue" is not a capabilities prompt.
  if (DATA_LOOKUP_SIGNAL.test(text)) return null
  for (const entry of INSTRUCTIONAL_TOPICS) {
    if (entry.pattern.test(text)) return entry.topic
  }
  return 'generic'
}

type QueryDomain = 'automation' | 'order' | 'customer' | 'inventory' | 'product' | 'analytics' | null

/** Entity words, not generic verbs such as "cancel", own domain routing. */
function queryDomain(query: string): QueryDomain {
  if (/\b(?:automations?|workflows?)\b/i.test(query)) return 'automation'
  if (/\b(?:orders?|fulfil(?:lment|ment|led|l)?|purchases?)\b/i.test(query)) return 'order'
  if (/\b(?:customers?|vips?|subscribers?|segments?|churn)\b/i.test(query)) return 'customer'
  if (/\b(?:inventory|stock(?:out)?|low stock)\b/i.test(query)) return 'inventory'
  if (/\b(?:products?|catalog|skus?|best[ -]?sellers?)\b/i.test(query)) return 'product'
  if (/\b(?:revenue|sales?|aov|analytics|metrics?|store health)\b/i.test(query)) return 'analytics'
  return null
}

function toolDomain(name: AiCommandToolName): QueryDomain {
  if (name === 'list_workflows') return 'automation'
  if (name === 'search_orders') return 'order'
  if (name === 'search_customers') return 'customer'
  if (name === 'get_inventory_status') return 'inventory'
  if (name === 'search_products') return 'product'
  if (name === 'get_analytics' || name === 'get_store_health') return 'analytics'
  return null
}

export function parseInfoTools(query: string): readonly ToolCall[] {
  const normalized = query.toLowerCase()
  const domain = queryDomain(query)
  const calls: ToolCall[] = []
  const push = (name: AiCommandToolName, params: Readonly<Record<string, unknown>> = {}) => {
    if (!calls.some((call) => call.name === name)) calls.push({ name, params })
  }

  // Growth is intentionally resolved first. Previously "Help me increase
  // sales" matched the word "sales", selected analytics only, and returned
  // the same revenue answer as the merchant's previous question.
  if (detectGrowthIntent(query)) {
    push('get_analytics', { metric: 'summary', date_range: inferRange(normalized) })
    push('get_recommendations', { status: 'PENDING', limit: 5 })
    push('get_store_health', {})
    push('get_inventory_status', { filter: 'low', limit: 10 })
    // Customer + product intelligence powers data-backed recommendations
    // (at-risk customers, repeat rate, dead stock). Empty queries return the
    // full synced sets so the plan can compute real counts and never invent.
    push('search_customers', { query: '', limit: 50 })
    push('search_products', { query: '', limit: 50 })
    return calls
  }

  // Domain-specific reads are isolated. This also makes the deterministic
  // fallback safe if an LLM tool planner is unavailable.
  if (domain === 'automation') return [{ name: 'list_workflows', params: {} }]
  if (domain === 'order') return [{ name: 'search_orders', params: { query, limit: 20 } }]
  if (domain === 'customer') return [{ name: 'search_customers', params: { query, limit: 20 } }]
  if (domain === 'inventory') return [{ name: 'get_inventory_status', params: { filter: /low|out/.test(normalized) ? 'low' : 'all' } }]
  if (domain === 'product') return [{ name: 'search_products', params: { query, limit: 20 } }]

  if (/\b(customers?|vips?|churn|inactive|repeat buyers?|subscribers?)\b/.test(normalized)) push('search_customers', { query, limit: 20 })
  if (/\b(products?|catalog|skus?|best[ -]?sellers?|top products?|underperform)/.test(normalized)) push('search_products', { query, limit: 20 })
  if (/\b(orders?|fulfil|fulfill)\b/.test(normalized)) push('search_orders', { query, limit: 20 })
  // Performance summaries / trends are analytics-led so the response can end
  // on a key takeaway rather than a bare health score.
  if (/\b(summari[sz]e|summary|overview|trend|trending|performance|recap|review)\b/.test(normalized)) push('get_analytics', { metric: 'summary', date_range: inferRange(normalized) })
  if (/\b(revenue|sales|aov|analytics|this month|today)\b/.test(normalized)) push('get_analytics', { metric: 'summary', date_range: inferRange(normalized) })
  if (/\brecommend/.test(normalized)) push('get_recommendations', { status: 'PENDING', limit: 10 })
  if (/\b(stock|inventory|stockout|low stock)\b/.test(normalized)) push('get_inventory_status', { filter: /low|out/.test(normalized) ? 'low' : 'all' })
  if (/\b(health|how is my store|store status)\b/.test(normalized)) push('get_store_health', {})
  if (/\b(automations?|workflows?)\b/.test(normalized)) push('list_workflows', {})
  // Allowlist-first (STEP 6 of the Commander scope): there is NO default
  // fallback to store_health + analytics anymore. When nothing matches, the
  // intent is unknown — callers must refuse with the out-of-scope template
  // rather than guessing a data mix and dressing it up as an answer.
  return calls
}

/**
 * In-scope queries that no deterministic info pattern claimed (regex gaps,
 * planner silences, unparseable Hindi) are answered from the two safest
 * grounded signals — store health and period analytics — instead of an
 * invented tool mix. Off-topic queries never reach it: the allowlist scope
 * gate (detectOffTopic) refuses them first, so this pair can only ever
 * service queries Commander already classified as store-related.
 */
export function ambientToolsWhenUnmapped(query: string, calls: readonly ToolCall[]): readonly ToolCall[] {
  if (calls.length > 0) return calls
  return [
    { name: 'get_store_health', params: {} },
    { name: 'get_analytics', params: { metric: 'summary', date_range: inferRange(query.toLowerCase()) } },
  ]
}

function inferRange(normalized: string): string {
  if (/\btoday\b/.test(normalized)) return '1d'
  if (/\bweek\b/.test(normalized)) return '7d'
  if (/\byear\b/.test(normalized)) return '365d'
  return '30d'
}

export function renderBlockedResponse(blocked: Readonly<{ action: string; reason: string; page: string; steps: string }>): string {
  return [
    `I understand you want to ${blocked.action}. However, this action is not available through AI Command for safety reasons:`,
    '',
    `Reason: ${blocked.reason}`,
    '',
    'What you can do instead:',
    `1. Go to ${blocked.page} in the app.`,
    `2. ${blocked.steps}`,
    '',
    'Or I can help with:',
    '• Looking up the related customers, products, or orders',
    '• Drafting a safe alternative such as a tagged segment or a discount preview',
  ].join('\n')
}

/* ── Commander scope: allowlist-first ─────────────────────────────── */

export const AI_COMMAND_SCOPE_INTENTS = [
  'store_data_query',
  'store_analytics',
  'store_action',
  'app_feature_help',
  'capability_discovery',
] as const
export type AiCommandScopeIntent = (typeof AI_COMMAND_SCOPE_INTENTS)[number]
export type AiCommandScope =
  | Readonly<{ inScope: true; intent: AiCommandScopeIntent }>
  | Readonly<{ inScope: false; topic: string }>

/**
 * Hard-forbidden domains. Every pattern is deliberately multi-word or
 * domain-specific so a legitimate store query can never trip it: bare words
 * such as "code" or "health" are NOT forbidden, so "create a discount code"
 * and "store health check" stay in scope. These run BEFORE the allowlist so
 * store-side words inside a forbidden-domain question ("how to build a
 * Shopify theme", "give me stock market advice") cannot smuggle it in.
 */
const FORBIDDEN_TOPICS: readonly Readonly<{ pattern: RegExp; topic: string }>[] = [
  { pattern: /\b(?:weather|temperature\s+(?:in|at|today)|is it raining|rain(?:ing|y)?|snow(?:ing)?|sunny|humid(?:ity)?|climate)\b/i, topic: 'the weather' },
  { pattern: /\b(?:politics?|elections?|president|prime minister|pm of|government|parliament|congress|senator|democrat|republican|breaking news|news headlines?|current events?)\b/i, topic: 'politics' },
  { pattern: /\b(?:tell|write|share|recite|make up|suno|suna)\b.{0,30}\b(?:joke|poem|poetry|song|story|riddle|haiku|shayari|limerick)\b|\b(?:jokes?|riddles?|haiku|limerick|shayari|knock knock)\b/i, topic: 'creative writing' },
  { pattern: /\b(?:javascript|typescript|python|java|c\+\+|c#|ruby|rust|golang|php|swift|kotlin|sql queri?|programming|coding|debug(?:ging)?|algorithms?|regex(?:es)?|unit tests?|data structures?)\b|\bwrite (?:me )?(?:a|an|some) (?:function|program|script|class|snippet|code)\b/i, topic: 'general coding' },
  { pattern: /\b(?:build|code|develop|create|design|make|customi[sz]e|edit|write)\b.{0,40}\b(?:theme|shopify (?:theme|app|store|site|storefront)|storefront|landing page|website|web app|mobile app|plugin|liquid)\b/i, topic: 'theme or general Shopify development' },
  { pattern: /\b(?:stock market|share market|wall street|bitcoin|crypto(?:currency| )?|nft|forex|mutual funds?|stock tips?|trading strategy|investment advice|investing|my portfolio)\b/i, topic: 'investing or the stock market' },
  { pattern: /\b(?:medical advice|health advice|symptoms?|diagnos(?:is|e|ed)|disease|medicine|doctor|illness|therapy|treatment|fever|headache|depress(?:ed|ion)|anxiety|mental health|diet plan|weight loss|workout routine)\b/i, topic: 'health or medical advice' },
  { pattern: /\b(?:legal advice|lawyer|attorney|lawsuit|sue\b|contract law|court case|divorce|trademark dispute)\b/i, topic: 'legal advice' },
  { pattern: /\b(?:football|basketball|cricket|soccer|nba|fifa|ipl|match score|world cup|super bowl|olympics?)\b/i, topic: 'sports' },
  { pattern: /\b(?:movies?|netflix|tv (?:series|show)|web series|celebrit(?:y|ies)|bollywood|hollywood|box office)\b/i, topic: 'entertainment' },
  { pattern: /\b(?:life advice|relationship advice|dating|breakup|marriage advice|horoscope|zodiac|astrology|tarot|meaning of life)\b/i, topic: 'personal advice' },
  { pattern: /\b(?:capital of|who invented|who wrote|who painted|history of|population of|distance from|how far is|tallest mountain|largest country|longest river)\b/i, topic: 'general knowledge' },
  { pattern: /\b(?:homework|school essay|school project|solve (?:this|the)? ?(?:equation|math(?:ematics)? problem)|what is \d+\s*[+*/-]\s*\d+)\b/i, topic: 'homework or general problem-solving' },
  { pattern: /\b(?:chatgpt|openai|anthropic|claude|gemini|grok|deepseek|llama|language model|which ai (?:model )?are you|what model are you|are you (?:an?\s+)?(?:ai|robot|chatbot|human))\b/i, topic: 'questions about AI assistants' },
]

const OFF_TOPIC_PATTERNS: readonly Readonly<{ pattern: RegExp; topic: string }>[] = [
  { pattern: /weather|forecast|temperature|rain|snow|sunny|climate|humidity/i, topic: 'the weather' },
  { pattern: /poem|song|joke|riddle|limerick|story|haiku|write me a (poem|story|joke)/i, topic: 'creative writing' },
  { pattern: /politics|election|president|government|congress|vote|democrat|republican|politician/i, topic: 'politics' },
  { pattern: /health|medical|symptom|diagnosis|disease|medicine|doctor|illness|treatment|therapy/i, topic: 'health or medical advice' },
  { pattern: /legal|lawyer|lawsuit|contract law|attorney|sue someone/i, topic: 'legal advice' },
  { pattern: /news|headline|current event|what is happening in the world/i, topic: 'the news or current events' },
  { pattern: /movie|film|tv show|netflix|celebrity|actor|singer|music artist|album review/i, topic: 'entertainment' },
  { pattern: /recipe|cook(ing)?|dinner idea|meal plan|baking/i, topic: 'recipes or cooking' },
  { pattern: /homework|essay|school project|solve (this )?(equation|math|problem)|translate|what is \d+ ?[+*/-] ?\d+/i, topic: 'homework or general problem-solving' },
  { pattern: /stock market|wall street|bitcoin|ethereum|crypto ?currency|trading stocks|invest(ing)?/i, topic: 'investing or the stock market' },
  { pattern: /sports|football|basketball|baseball|soccer|hockey|game result|score of the/i, topic: 'sports' },
  { pattern: /(yourself|you are|are you|what model|which ai|openai|anthropic|gpt-?|claude|chatgpt|llm)/i, topic: 'questions about AI assistants' },
  { pattern: /\b(coding|code|programming|javascript|typescript|python|react|node|debugging|algorithm|data structure|unit test)\b/i, topic: 'general coding' },
  { pattern: /(life advice|relationship|dating|breakup|my boss|my coworker|my friend|mental health)/i, topic: 'personal advice' },
  { pattern: /(recommend a (book|movie|restaurant|hotel)|places to visit|vacation|travel plan|gift for my)/i, topic: 'personal recommendations' },
  { pattern: /(horoscope|zodiac|astrology|tarot|fortune|meaning of life|religion|philosophy)/i, topic: 'that topic' },
]

// Store metrics and analytics vocabulary: a match here means the merchant is
// clearly asking for this store's numbers (trends, growth, health, revenue).
const STORE_METRIC_SIGNAL = /\b(?:revenue|sales?|aov|average order value|analytics|metrics?|growth|growing|trend(?:s|ing)?|performance|profit(?:s|ability)?|margins?|earnings?|income|conversions?|cvr|health(?:y)?|score|recap|summar(?:y|ies)|overview|payouts?|forecast(?:s|ing)?|roas|ltv|retention)\b/i

// Explicit "my/our/this store" phrasing keeps genuine store questions in
// scope even when they use words the metric list does not cover ("how is my
// store doing").
const STORE_CONTEXT_SIGNAL = /\b(?:my|our|this|the)\s+(?:store|shop|business|catalog)\b|\bstore(?:'s|s)?\s+(?:data|health|sales|revenue|orders|performance|analytics|growth|status)\b/i

// ProfitPilot feature names are always app-feature-help territory.
const APP_FEATURE_SIGNAL = /\b(?:profitpilot|pattern\s?ai|insight hub|approval inbox|quick commands?|saved commands?)\b/i

const DEVANAGARI = /[\u0900-\u097F]/

/**
 * Allowlist-first scope classification (Commander product spec): a request is
 * answered only when it clearly matches one allowed intent —
 * store_data_query, store_analytics, store_action, app_feature_help, or
 * capability_discovery. Hard-forbidden domains are checked first so store
 * words inside a forbidden question cannot smuggle it in; anything that
 * matches no allowed intent is out of scope and gets refused.
 *
 * Devanagari (Hindi) text is intentionally allowed through: the regex
 * allowlist cannot parse it and the product treats Hindi as a first-class
 * language, so the data path answers it honestly from tools (and refuses
 * nothing a Hindi merchant could legitimately ask).
 */
export function classifyCommandScope(query: string): AiCommandScope {
  const text = query.trim()
  if (!text) return { inScope: true, intent: 'store_data_query' }
  // Deliberately unsafe store operations stay in scope — the blocked-action
  // flow renders a page-specific alternative instead of an off-topic refusal.
  if (detectBlockedAction(text)) return { inScope: true, intent: 'store_action' }
  for (const entry of FORBIDDEN_TOPICS) {
    if (entry.pattern.test(text)) return { inScope: false, topic: entry.topic }
  }
  if (detectWriteTool(text)) return { inScope: true, intent: 'store_action' }
  if (CAPABILITY_TRIGGER.test(text)) return { inScope: true, intent: 'capability_discovery' }
  const instructional = detectInstructionalIntent(text)
  if (instructional) return { inScope: true, intent: instructional === 'generic' ? 'capability_discovery' : 'app_feature_help' }
  if (APP_FEATURE_SIGNAL.test(text)) return { inScope: true, intent: 'app_feature_help' }
  if (detectGrowthIntent(text) || STORE_METRIC_SIGNAL.test(text)) return { inScope: true, intent: 'store_analytics' }
  if (queryDomain(text) !== null || STORE_CONTEXT_SIGNAL.test(text) || DATA_LOOKUP_SIGNAL.test(text)) return { inScope: true, intent: 'store_data_query' }
  if (DEVANAGARI.test(text)) return { inScope: true, intent: 'store_data_query' }
  // No allowed intent matched: out of scope. Reuse the legacy denylist purely
  // to label the refusal; otherwise fall back to the generic label.
  for (const entry of OFF_TOPIC_PATTERNS) {
    if (entry.pattern.test(text)) return { inScope: false, topic: entry.topic }
  }
  return { inScope: false, topic: 'that topic' }
}

/**
 * Detects out-of-scope questions so Commander can politely refuse anything
 * that is not about the merchant's store data or ProfitPilot features.
 * Returns the human-readable topic that was asked about, or `null` when the
 * query matches an allowed intent (see classifyCommandScope).
 */
export function detectOffTopic(query: string): string | null {
  if (!query.trim()) return null
  const scope = classifyCommandScope(query)
  return scope.inScope ? null : scope.topic
}

/** The canonical out-of-scope refusal (Commander product spec, verbatim). */
export const COMMANDER_REFUSAL_TEMPLATE = "I'm your store's Commander — I can only help with your store data and ProfitPilot features."

export function renderOffTopicResponse(topic: string): string {
  return [
    `${COMMANDER_REFUSAL_TEMPLATE} I can't help with ${topic}.`,
    '',
    'Would you like to see your latest sales, top products, or customer insights instead?',
  ].join('\n')
}

export const STORE_SCOPE_GUIDANCE = [
  'You are Commander (store ka AI Commander): the merchant\'s store leader and controller inside ProfitPilot. You answer ONLY requests about this store\'s data or ProfitPilot features.',
  'Allowed intents (allowlist-first): this store\'s orders, products, customers, inventory, and sales; this store\'s revenue, analytics, growth trends, metrics, and health; this store\'s automations and actions (Commander plan only); ProfitPilot feature help; and capability discovery ("what can you do?").',
  'Everything else is out of scope — refuse and redirect back to the store: weather, news, politics, jokes, trivia, general knowledge, coding or programming, Shopify theme/app or general Shopify development, personal, medical, legal, financial, or investment advice, marketing theory not tied to this store\'s data, and questions about yourself or other AI systems.',
  `Out-of-scope refusal template: "${COMMANDER_REFUSAL_TEMPLATE} Would you like to see your latest sales, top products, or customer insights instead?"`,
] as const

export function renderUpgradeResponse(action: string, findings: string): string {
  return [
    findings,
    '',
    // Spec-verbatim upgrade prompt for action requests on answers-only plans.
    `This action requires the Commander plan. Upgrade to unlock full store control.`,
    `To execute actions like ${action}, Upgrade Plan. Commander plan includes:`,
    '• Unlimited AI commands',
    '• Full action execution',
    '• Email campaigns via AI',
    '• Customer management via AI',
    '• Report generation',
    '',
    'Meanwhile, you can do this manually in the matching workspace page.',
  ].join('\n')
}

export function defaultCommandPreferences(storeId: StoreId, now = new Date().toISOString()): AiCommandPreferences {
  return {
    storeId,
    defaultResponseStyle: 'CONCISE',
    quickCommandsEnabled: true,
    autoSuggestionsEnabled: true,
    thinkingAnimationEnabled: true,
    conversationMemoryEnabled: true,
    notificationOnActionComplete: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function emptyUsage(storeId: StoreId, usageDate: string, plan: PlanTier): AiCommandUsage {
  const limits = limitsForPlan(plan)
  return {
    storeId,
    usageDate,
    commandsUsed: 0,
    actionsExecuted: 0,
    tokensUsed: 0,
    costMicroDollars: 0,
    limit: limits.commandsPerDay,
    remaining: limits.commandsPerDay,
    actionsEnabled: limits.actionsEnabled,
  }
}

export function applyUsageLimits(usage: Omit<AiCommandUsage, 'limit' | 'remaining' | 'actionsEnabled'> | AiCommandUsage, plan: PlanTier): AiCommandUsage {
  const limits = limitsForPlan(plan)
  const remaining = limits.commandsPerDay === null ? null : Math.max(0, limits.commandsPerDay - usage.commandsUsed)
  return { ...usage, limit: limits.commandsPerDay, remaining, actionsEnabled: limits.actionsEnabled }
}

export function usageDateKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

export function titleFromQuery(query: string): string {
  const cleaned = query.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New conversation'
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}…` : cleaned
}

export function conversationGroups(conversations: readonly AiCommandConversation[], now = Date.now()): Readonly<Record<'today' | 'yesterday' | 'week' | 'older', readonly AiCommandConversation[]>> {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const todayStart = startOfToday.getTime()
  const yesterdayStart = todayStart - 86_400_000
  const weekStart = todayStart - 6 * 86_400_000
  const groups: { today: AiCommandConversation[]; yesterday: AiCommandConversation[]; week: AiCommandConversation[]; older: AiCommandConversation[] } = { today: [], yesterday: [], week: [], older: [] }
  for (const conversation of conversations) {
    const at = Date.parse(conversation.lastMessageAt)
    if (!Number.isFinite(at) || at >= todayStart) groups.today.push(conversation)
    else if (at >= yesterdayStart) groups.yesterday.push(conversation)
    else if (at >= weekStart) groups.week.push(conversation)
    else groups.older.push(conversation)
  }
  return groups
}

export function defaultQuickCommands(plan: PlanTier): readonly AiCommandQuickCommand[] {
  const info: AiCommandQuickCommand[] = [
    { id: 'revenue', label: 'Show today\'s revenue', command: 'Show today\'s revenue', kind: 'info' },
    { id: 'customers', label: 'Top customers', command: 'Show my top customers', kind: 'info' },
    { id: 'stock', label: 'Low stock products', command: 'Which products are low stock?', kind: 'info' },
    { id: 'recs', label: 'Pending recommendations', command: 'Show pending recommendations', kind: 'info' },
    { id: 'report', label: 'Weekly report', command: 'Summarize this week\'s store performance', kind: 'info' },
    { id: 'grow', label: 'Help me grow', command: 'Help me increase sales', kind: 'info' },
    { id: 'health', label: 'Store health check', command: 'How healthy is my store?', kind: 'info' },
    { id: 'orders', label: 'Recent orders', command: 'Show recent orders', kind: 'info' },
  ]
  if (!limitsForPlan(plan).actionsEnabled) return info
  return [
    ...info,
    { id: 'vip-email', label: 'Send VIP email', command: 'Draft an email to VIP customers', kind: 'action' },
    { id: 'tag-new', label: 'Tag new customers', command: 'Tag new customers as new-buyer', kind: 'action' },
    { id: 'weekend', label: 'Create weekend discount', command: 'Create a 15% weekend discount with a 100 use limit that expires in 3 days', kind: 'action' },
  ]
}

export function contextualFollowUps(command: string): readonly AiCommandSuggestion[] {
  const text = command.toLowerCase()
  const category = /(stock|inventory|product|sku)/.test(text) ? 'inventory'
    : /(customer|vip|churn|inactive|segment)/.test(text) ? 'customers'
      : /(health|seo|conversion|speed)/.test(text) ? 'health'
        : /(growth|increase sales|recommend|opportunit)/.test(text) ? 'growth'
          : /(order)/.test(text) ? 'orders'
            : 'revenue'
  const groups: Readonly<Record<string, readonly string[]>> = {
    revenue: ['Compare with last month’s revenue', 'Show revenue breakdown by product', 'Which products generated the most revenue?', 'Show revenue trend for the last 6 months', 'What is my average order value?', 'Show today’s orders'],
    customers: ['Show repeat customers', 'Show customer acquisition this month', 'Find at-risk customers with no orders in 30 days', 'Show top spending customers', 'Show new customers this week', 'Compare new and returning customers'],
    inventory: ['Show products to reorder', 'Find products with no sales in 60 days', 'Show inventory value report', 'Show best sellers running low', 'Calculate inventory turnover', 'Show out-of-stock products'],
    health: ['How can I improve store health?', 'Show conversion rate analysis', 'Show inventory health details', 'Find my biggest growth opportunity', 'Compare this week with last week', 'Show pending recommendations'],
    growth: ['Show my biggest growth opportunities', 'Find underperforming products', 'Show at-risk customers', 'Compare this week with last week', 'Show best-selling products', 'Run a store health check'],
    orders: ['Show today’s orders', 'Compare order count with last week', 'Show average order value', 'Show highest-value recent orders', 'Show recent customers', 'Show revenue from recent orders'],
  }
  return (groups[category] ?? groups.revenue ?? []).map((label) => ({ label, command: label }))
}

export function contextualQuickCommands(plan: PlanTier, snapshot: Readonly<{ lowStock?: number; pendingRecommendations?: number; inactiveCustomers?: number }>): readonly AiCommandQuickCommand[] {
  const base = [...defaultQuickCommands(plan)]
  if ((snapshot.lowStock ?? 0) > 0) {
    base[2] = { id: 'stock', label: `${snapshot.lowStock} low-stock items`, command: 'Which products are low stock?', kind: 'info' }
  }
  if ((snapshot.pendingRecommendations ?? 0) > 0) {
    base[3] = { id: 'recs', label: `${snapshot.pendingRecommendations} pending recs`, command: 'Show pending recommendations', kind: 'info' }
  }
  if ((snapshot.inactiveCustomers ?? 0) > 0) {
    base.splice(2, 0, { id: 'inactive', label: 'Inactive customers', command: 'Show inactive customers', kind: 'info' })
  }
  return base
}

export function formatToolAnswer(query: string, outcomes: readonly ToolOutcome[]): Readonly<{ content: string; structuredData: AiCommandStructuredData | null; numbers: readonly number[] }> {
  const failures = outcomes.filter((outcome): outcome is ToolFailure => !outcome.ok)
  const successes = outcomes.filter((outcome): outcome is ToolSuccess => outcome.ok)
  if (successes.length === 0) {
    // Zero-hallucination contract: no tool data means we say exactly that —
    // never a fabricated figure dressed up as an answer.
    const reason = failures[0]?.error ?? 'The requested store data is not available.'
    const content = `I'm not sure I can answer that from live store data yet — I don't have this data available right now. ${reason}`
    return { content, structuredData: null, numbers: extractNumbers(content) }
  }
  const lines: string[] = []
  let structuredData: AiCommandStructuredData | null = null
  const numbers: number[] = []
  for (const outcome of successes) {
    numbers.push(...outcome.numbers)
    const rendered = renderOutcome(outcome, query)
    lines.push(rendered.text)
    if (!structuredData && rendered.structured) structuredData = rendered.structured
  }
  if (failures.length > 0) {
    lines.push(`Some modules could not answer: ${failures.map((failure) => `${failure.name} (${failure.error})`).join('; ')}.`)
  }
  lines.push(`Source: ${humanizeSources(successes.map((outcome) => outcome.source))}.`)
  if (!query.trim()) lines.unshift('Here is what I found from your store.')
  const content = lines.join('\n\n')
  // renderOutcome is deterministic application code, so formula-derived
  // figures (for example period-over-period change) are grounded too.
  return { content, structuredData, numbers: [...numbers, ...extractNumbers(content)] }
}

/** Builds a decision-oriented growth plan instead of concatenating the normal
 * revenue answer. Every signal and recommendation is derived from the supplied
 * tool outcomes; the result reads like an e-commerce growth consultant — a
 * cross-workspace situational read, three data-backed priorities, and one-click
 * next steps. Action commands are proposals that still enter the approval flow. */
export function formatGrowthAnswer(outcomes: readonly ToolOutcome[], actionsEnabled: boolean): Readonly<{ content: string; structuredData: AiCommandStructuredData | null; numbers: readonly number[] }> {
  const successes = outcomes.filter((outcome): outcome is ToolSuccess => outcome.ok)
  const failures = outcomes.filter((outcome): outcome is ToolFailure => !outcome.ok)
  if (successes.length === 0) {
    const reason = failures[0]?.error ?? 'The requested store data is not available.'
    const content = `I can't build a grounded growth plan until store signals are available. ${reason}`
    return { content, structuredData: null, numbers: extractNumbers(content) }
  }

  const analytics = outcomeData(successes, 'get_analytics')
  const recommendations = outcomeData(successes, 'get_recommendations')
  const health = outcomeData(successes, 'get_store_health')
  const inventory = outcomeData(successes, 'get_inventory_status')
  const customersData = outcomeData(successes, 'search_customers')
  const productsData = outcomeData(successes, 'search_products')

  const revenue = numberish(analytics?.revenue)
  const previousRevenue = numberish(analytics?.previousRevenue)
  const orders = numberish(analytics?.orders)
  const aov = numberish(analytics?.aov)
  const currency = currencyCode(analytics?.currency)
  const days = numberish(analytics?.days) ?? 30
  const healthScore = numberish(health?.score)
  const healthLabel = typeof health?.label === 'string' ? health.label : null
  const lowStockCount = numberish(inventory?.lowStockCount)
  const outOfStockCount = numberish(inventory?.outOfStockCount)

  // Customer intelligence — repeat rate, churn-risk, top spenders.
  const customerRows = arrayOfRecords(customersData?.items ?? customersData?.customers)
  const totalCustomers = numberish(customersData?.total) ?? customerRows.length
  const inactiveRows = customerRows.filter((row) => row.activity === 'inactive' || row.primarySegment === 'churn_risk')
  const inactiveCount = inactiveRows.length
  const atRiskValue = inactiveRows.reduce((sum, row) => sum + (numberish(row.totalSpent) ?? 0), 0)
  const repeatCount = customerRows.filter((row) => (numberish(row.lifetimeOrders) ?? 0) >= 2).length
  const repeatRate = totalCustomers > 0 ? Math.round((repeatCount / totalCustomers) * 100) : null

  // Product intelligence — dead / underperforming stock.
  const productRows = arrayOfRecords(productsData?.items ?? productsData?.products)
  const deadStockCount = productRows.filter((row) => (numberish(row.unitsSold) ?? 0) === 0).length

  const recommendationRows = arrayOfRecords(recommendations?.items ?? recommendations?.recommendations)
  const pendingRecCount = numberish(recommendations?.count) ?? recommendationRows.length

  type Recommendation = Readonly<{ title: string; detail: string; cta: Readonly<{ label: string; command: string; kind: 'info' | 'action' }> }>
  const candidates: Recommendation[] = []

  if ((outOfStockCount ?? 0) > 0) {
    candidates.push({
      title: 'Restore availability on out-of-stock items',
      detail: `${outOfStockCount} tracked variant${outOfStockCount === 1 ? ' is' : 's are'} out of stock, which is actively blocking sales. Restock or cleanly mark them sold out so demand stops landing on dead pages.`,
      cta: { label: 'View out-of-stock products', command: 'Show out-of-stock products', kind: 'info' },
    })
  }
  if ((lowStockCount ?? 0) > 0) {
    candidates.push({
      title: 'Protect your low-stock best sellers',
      detail: `${lowStockCount} low-stock tracked variant${lowStockCount === 1 ? '' : 's'} could sell out soon. Confirm replenishment lead times before you push more paid traffic toward them.`,
      cta: { label: 'View low-stock products', command: 'Which products are low stock?', kind: 'info' },
    })
  }
  if (deadStockCount > 0) {
    candidates.push({
      title: 'Liquidate dead stock to free up cash',
      detail: `${deadStockCount} product${deadStockCount === 1 ? ' has' : 's have'} generated zero sales in the last ${days} days. Bundle or discount them to recover capital tied up in inventory.`,
      cta: { label: 'View products with no sales', command: 'Show products with no sales this month', kind: 'info' },
    })
  }
  if (inactiveCount > 0) {
    candidates.push({
      title: 'Win back at-risk customers',
      detail: `${inactiveCount} high-value customer${inactiveCount === 1 ? '' : 's'} worth ${formatMoney(atRiskValue, currency)} in lifetime spend ${inactiveCount === 1 ? "hasn't" : "haven't"} ordered recently. A targeted win-back offer is usually the fastest revenue you can recover.`,
      cta: { label: 'View at-risk customers', command: 'Find at-risk customers with no orders in 30 days', kind: 'info' },
    })
  }
  if (revenue !== null && previousRevenue !== null) {
    const change = previousRevenue !== 0 ? Math.round(((revenue - previousRevenue) / previousRevenue) * 100) : null
    if (change !== null && change < 0) {
      candidates.push({ title: 'Stem the revenue dip', detail: `Revenue is down ${Math.abs(change)}% versus the previous comparison period. Focus your next campaign on retention and proven best sellers before testing new acquisition spend.`, cta: { label: 'View best-selling products', command: 'Show my best-selling products', kind: 'info' } })
    } else if (change !== null && change > 0) {
      candidates.push({ title: 'Double down on what is working', detail: `Revenue is up ${change}% versus the previous period — momentum worth scaling. Reinforce the products and segments driving it with a targeted, measurable push rather than a store-wide change.`, cta: { label: 'View best-selling products', command: 'Show my best-selling products', kind: 'info' } })
    } else {
      candidates.push({ title: 'Break the revenue plateau', detail: `Revenue is flat against the previous period. Test one targeted offer (a bundle, a threshold discount, or a win-back email) and measure the result before expanding it store-wide.`, cta: { label: 'View best-selling products', command: 'Show my best-selling products', kind: 'info' } })
    }
  }
  if (repeatRate !== null && totalCustomers > 1 && repeatRate < 30) {
    candidates.push({ title: 'Lift your repeat purchase rate', detail: `Your repeat purchase rate is ${repeatRate}% across ${totalCustomers} customers. Add a post-purchase thank-you flow with a small upsell coupon to turn one-time buyers into returning ones.`, cta: { label: 'View repeat customers', command: 'Show repeat customers', kind: 'info' } })
  }
  if (pendingRecCount > 0) {
    const recTitle = typeof recommendationRows[0]?.title === 'string' ? recommendationRows[0].title : 'your top pending recommendation'
    candidates.push({ title: 'Act on the top AI recommendation', detail: `There ${pendingRecCount === 1 ? 'is 1 pending recommendation' : `are ${pendingRecCount} pending recommendations`} in your ledger — start with "${recTitle}". These are the highest-impact moves the AI team has already surfaced.`, cta: { label: 'View recommendations', command: 'Show pending recommendations', kind: 'info' } })
  }
  if (candidates.length === 0) {
    candidates.push({ title: 'Build your growth baseline first', detail: 'Sync more analytics, recommendation, and inventory history so the next plan can be grounded in real signals rather than generic advice.', cta: { label: 'Run store health check', command: 'How healthy is my store?', kind: 'info' } })
  }

  const selected = candidates.slice(0, 3)
  const priorities = selected.map((rec) => `${rec.title}: ${rec.detail}`)
  const infoCommands = selected.map((rec) => rec.cta)
  const commanderActions: ReadonlyArray<Readonly<{ label: string; command: string; kind: 'action' }>> = [
    { label: 'Prepare a VIP email', command: 'Draft an email to VIP customers', kind: 'action' },
    { label: 'Prepare a growth discount', command: 'Create a 10% growth discount with a 100 use limit that expires in 3 days', kind: 'action' },
    ...(recommendationRows.length > 0 ? [{ label: 'Prepare recommendation approval', command: 'Approve the top pending recommendation', kind: 'action' as const }] : []),
  ]
  const seenCommands = new Set<string>()
  const nextCommands = [...infoCommands, ...(actionsEnabled ? commanderActions : [])].filter((item) => {
    if (seenCommands.has(item.command)) return false
    seenCommands.add(item.command)
    return true
  })

  // Cross-workspace situational read — the "consultant" opening that ties
  // revenue, customers, and inventory together in plain language.
  const readParts: string[] = []
  if (revenue !== null) {
    const head = `Your store did ${formatMoney(revenue, currency)}`
    const tail = orders !== null ? ` across ${orders} order${orders === 1 ? '' : 's'}` : ''
    const aovPart = aov !== null ? ` at a ${formatMoney(aov, currency)} average order value` : ''
    readParts.push(`${head}${tail}${aovPart} over the last ${days} days`)
  }
  if (healthScore !== null) readParts.push(`store health sits at ${healthScore}/100${healthLabel ? ` (${healthLabel.toLowerCase()})` : ''}`)
  if ((lowStockCount ?? 0) > 0 || (outOfStockCount ?? 0) > 0) {
    readParts.push(`inventory shows ${lowStockCount ?? 0} low-stock and ${outOfStockCount ?? 0} out-of-stock tracked variants`)
  }
  if (totalCustomers > 0) {
    readParts.push(inactiveCount > 0 ? `${inactiveCount} of your ${totalCustomers} customers are at risk of churning` : `all ${totalCustomers} customers are currently active`)
  }
  const situationalRead = readParts.length > 0
    ? `Here is what your live store data is telling me: ${readParts.join(', ')}.`
    : 'Sync analytics, customers, and inventory to unlock a fully grounded plan.'

  const lines = [
    'Here is a growth plan built from your live store signals — not a repeat of your revenue lookup:',
    situationalRead,
    `Priorities:\n${selected.map((rec, index) => `${index + 1}. ${rec.title} — ${rec.detail}`).join('\n')}`,
    actionsEnabled
      ? 'Commander action mode is ready. Pick any action below and I will prepare a preview — nothing executes until you approve it.'
      : 'Your plan is insight-only in AI Command, so the next steps below are data checks rather than store changes.',
    ...(failures.length > 0 ? [`Unavailable signals: ${failures.map((failure) => `${failure.name} (${failure.error})`).join('; ')}.`] : []),
    `Source: ${humanizeSources(successes.map((outcome) => outcome.source))}.`,
  ]
  const content = lines.join('\n\n')
  return {
    content,
    structuredData: {
      type: 'growth_plan',
      data: {
        signals: { currency, revenue, previousRevenue, orders, aov, days, healthScore, healthLabel, lowStockCount, outOfStockCount, totalCustomers, inactiveCount, atRiskValue, repeatRate, deadStockCount, pendingRecCount },
        priorities,
        recommendations: selected.map((rec) => ({ title: rec.title, detail: rec.detail, cta: rec.cta })),
        nextCommands,
        actionsEnabled,
      },
      source: humanizeSources(successes.map((outcome) => outcome.source)),
      actions: nextCommands.map((item) => item.command),
    },
    numbers: [...successes.flatMap((outcome) => outcome.numbers), ...extractNumbers(content)],
  }
}

/**
 * Feature discovery ("What can you do?" / "What can you help me with?").
 * Store-specific: names the merchant's shop and plan. Commander plan lists
 * data capabilities AND the full action set; every other plan lists the data
 * capabilities and marks actions as "Commander plan only" with the upgrade
 * prompt — exactly the split the plan gating enforces.
 */
export function formatCapabilityAnswer(input: Readonly<{ plan: PlanTier; actionsEnabled: boolean; shop?: string | null }>): Readonly<{ content: string; structuredData: AiCommandStructuredData }> {
  const storeName = input.shop?.trim() ? input.shop.trim() : 'your store'
  const planLabel = input.plan === 'commander' ? 'Commander' : input.plan === 'growth' ? 'Growth' : input.plan === 'start' ? 'Start' : 'Trial'
  const answers = [
    'Sales, revenue, average order value, and growth trends — for today, this week, or this month',
    'Orders, products, customers, and segments such as VIP, repeat, or at-risk buyers',
    'Inventory checks — low-stock and out-of-stock items before they cost you sales',
    'Store health score, AI recommendations, and the status of your automations',
  ] as const
  const actions = [
    'Create and manage automations — abandoned cart recovery, low-stock alerts, welcome series, and win-backs',
    'Email a customer segment, tag customers, or notify yourself about store events',
    'Create a discount with safety caps, approve AI recommendations, or generate reports',
  ] as const
  const prompts = [
    { label: "Show me today's sales", command: "Show me today's sales" },
    { label: 'Which products are selling best?', command: 'Which products are selling best?' },
    { label: 'How is my growth this month?', command: 'How is my growth this month?' },
    { label: 'Do I have low stock items?', command: 'Do I have low stock items?' },
    ...(input.actionsEnabled ? [{ label: 'Create an automation for abandoned carts', command: 'Create an automation for abandoned carts' }] : []),
  ] as const
  const actionLead = input.actionsEnabled
    ? 'Every action works the same way: I propose it with a preview, you approve it with one tap, and only then does anything change in your store.'
    : 'These actions require the Commander plan. Upgrade to unlock full store control — ask me anything else in the meantime.'
  const lines = input.actionsEnabled
    ? [
        `I'm Commander — the AI controller of ${storeName}. You're on the Commander plan, so everything below is unlocked for you.`,
        '',
        'ANSWERS FROM YOUR REAL STORE DATA',
        ...answers.map((item) => `• ${item}`),
        '',
        'FULL STORE CONTROL (ACTIONS)',
        ...actions.map((item) => `• ${item}`),
        '',
        actionLead,
        '',
        'Try one: "Show me today\'s sales" · "How is my growth this month?" · "Create an automation for abandoned carts".',
      ]
    : [
        `I'm Commander — your store's AI Commander. ${storeName === 'your store' ? 'Your store' : storeName} is on the ${planLabel} plan.`,
        '',
        `ANSWERS FROM YOUR REAL STORE DATA (included in the ${planLabel} plan)`,
        ...answers.map((item) => `• ${item}`),
        '',
        'STORE ACTIONS — Commander plan only',
        ...actions.map((item) => `• ${item}`),
        '',
        actionLead,
        '',
        'Try one: "Show me today\'s sales" · "How is my growth this month?" · "Do I have low stock items?".',
      ]
  return {
    content: lines.join('\n'),
    structuredData: {
      type: 'capability_list',
      data: {
        store: storeName,
        plan: input.plan,
        planLabel,
        actionsEnabled: input.actionsEnabled,
        answers,
        actions,
        actionsLocked: !input.actionsEnabled,
        upgradePrompt: input.actionsEnabled ? null : 'This action set requires the Commander plan. Upgrade to unlock full store control.',
        prompts,
      },
      actions: [],
    },
  }
}

/** Builds an instructional, step-by-step answer for "how do I…" questions
 * (INTENT C). The guidance is grounded in how ProfitPilot actually works and
 * carries one-click navigation CTAs the chat can render as buttons. */
export function formatInstructionalAnswer(topic: string, input: Readonly<{ plan: PlanTier; actionsEnabled: boolean }>): Readonly<{ content: string; structuredData: AiCommandStructuredData }> {
  const guide: InstructionalGuide = INSTRUCTIONAL_GUIDES[topic] ?? GENERIC_GUIDE
  const planNote = input.actionsEnabled
    ? 'You are on Commander, so you can also ask me to execute the related action right here (email, tag, discount) — nothing runs until you approve it.'
    : 'You can design and preview this on your current plan. Live execution (sending emails, applying tags) unlocks when you Upgrade Plan to Commander.'
  const steps = guide.steps
  const ctas: ReadonlyArray<Readonly<{ label: string; kind: 'navigate' | 'command'; target?: string; command?: string }>> = [...guide.ctas, { label: 'Open in app', kind: 'navigate', target: guide.target }]
  const lines = [
    guide.title,
    '',
    guide.intro,
    '',
    'Here is how to do it in ProfitPilot:',
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    planNote,
  ]
  const content = lines.join('\n')
  return {
    content,
    structuredData: {
      type: 'instructional',
      data: { topic, title: guide.title, intro: guide.intro, steps, planNote, ctas },
      actions: ['navigate'],
    },
  }
}

type InstructionalGuide = Readonly<{
  title: string
  intro: string
  steps: readonly string[]
  target: string
  ctas: readonly Readonly<{ label: string; kind: 'navigate' | 'command'; target?: string; command?: string }>[]
}>

const GENERIC_GUIDE: InstructionalGuide = {
  title: 'How ProfitPilot Can Help Your Store',
  intro: 'I am your store\'s command center. Ask in plain English, Hindi, or Hinglish. I can explain features, answer from synced Shopify data, and prepare safe actions that never run before your approval.',
  steps: [
    '1. Create & Manage Discounts — prepare governed discount actions and review them before approval.',
    '2. Automations & Workflows — create, inspect, trigger, pause, or resume store workflows.',
    '3. Customer Tagging & VIP Segmentation — find customer segments and preview tagging or outreach actions.',
    '4. Store Analytics & Inventory Insights — inspect revenue, sales, store health, products, and stock from synced data.',
  ],
  target: 'dashboard',
  ctas: [
    { label: 'How can I increase profit?', kind: 'command', command: 'How can I increase profit?' },
    { label: "Summarize this week's performance", kind: 'command', command: "Summarize this week's store performance" },
  ],
}

const INSTRUCTIONAL_GUIDES: Readonly<Record<string, InstructionalGuide>> = {
  generic: GENERIC_GUIDE,
  automation: {
    title: 'Setting up an automation in ProfitPilot',
    intro: 'Automations are visual, no-code workflows that run on a trigger (like an abandoned cart or a new order) and carry out actions (send an email, tag a customer, create a discount). You can start from a template or build one from scratch.',
    steps: [
      'Open the Automation gallery and pick a template (Abandoned Cart, Welcome Series, Win-Back, Post-Purchase) or start from a blank workflow.',
      'Choose the trigger — the event that starts the workflow (e.g. "cart abandoned for 1 hour").',
      'Add the actions the workflow should perform, in order — send an email, wait, tag the customer, or branch on a condition.',
      'Review the flow, name it, and activate it. You can pause or edit it any time from the same page.',
    ],
    target: 'automation',
    ctas: [
      { label: 'Go to Automation gallery', kind: 'navigate', target: 'automation' },
      { label: 'Show my automations', kind: 'command', command: 'Show automation status' },
    ],
  },
  patternai: {
    title: 'Getting product insights from PatternAI',
    intro: 'PatternAI analyses your catalog and sales history to surface best sellers, underperformers, dead stock, and pricing opportunities — all grounded in your real synced data.',
    steps: [
      'Open PatternAI from the sidebar.',
      'Review the highlighted product opportunities (top performers, slow movers, stock risks).',
      'Ask follow-up questions directly, or approve a generated recommendation to act on one.',
    ],
    target: 'patternai',
    ctas: [
      { label: 'Open PatternAI', kind: 'navigate', target: 'patternai' },
      { label: 'Show my best-selling products', kind: 'command', command: 'Show my best-selling products' },
    ],
  },
  recommendations: {
    title: 'Working with AI recommendations',
    intro: 'Your AI team continuously watches the store and writes prioritised growth recommendations. Review, approve, or dismiss each one — approvals can flow straight into a safe action.',
    steps: [
      'Open Recommendations to see the prioritised list from each agent.',
      'Open any recommendation to read the evidence and expected impact.',
      'Approve the ones you want to act on, or dismiss the ones that do not fit right now.',
    ],
    target: 'recommendations',
    ctas: [
      { label: 'Open Recommendations', kind: 'navigate', target: 'recommendations' },
      { label: 'Show pending recommendations', kind: 'command', command: 'Show pending recommendations' },
    ],
  },
}

function outcomeData(outcomes: readonly ToolSuccess[], name: AiCommandToolName): Record<string, unknown> | null {
  const outcome = outcomes.find((item) => item.name === name)
  return outcome && isRecord(outcome.data) ? outcome.data : null
}

export function applyResponseStyle(content: string, style: AiCommandResponseStyle, outcomes: readonly ToolOutcome[]): string {
  if (style === 'CONCISE') return content
  const successes = outcomes.filter((outcome): outcome is ToolSuccess => outcome.ok)
  if (successes.length === 0) return content
  if (style === 'TECHNICAL') {
    return `${content}\n\nTool trace: ${successes.map((outcome) => `${outcome.name} → ${humanizeSource(outcome.source)}`).join('; ')}.`
  }
  return `${content}\n\nData coverage: ${successes.map((outcome) => moduleLabel(outcome.name)).join(', ')} returned live results.`
}

function renderOutcome(outcome: ToolSuccess, query: string): Readonly<{ text: string; structured: AiCommandStructuredData | null }> {
  const data = isRecord(outcome.data) ? outcome.data : { value: outcome.data }
  if (outcome.name === 'get_analytics') {
    const revenue = numberish(data.revenue)
    const previous = numberish(data.previousRevenue)
    const orders = numberish(data.orders)
    const aov = numberish(data.aov)
    const currency = currencyCode(data.currency)
    const days = numberish(data.days)
    const change = revenue !== null && previous !== null && previous !== 0 ? Math.round(((revenue - previous) / previous) * 100) : null
    const trend: 'up' | 'down' | 'flat' | null = change === null ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
    const takeaway = analyticsTakeaway(change, trend)
    const nextStep = takeaway === null ? null : 'Next logical step: ask "How can I increase profit?" for a grounded growth plan, or "Show my best-selling products" to see what is driving this.'
    const parts = [
      revenue === null ? 'Revenue for the requested period is not available.' : `Your store's revenue for this period is ${formatMoney(revenue, currency)}${change === null || previous === null ? '' : `, which is ${change}% ${change >= 0 ? 'higher' : 'lower'} than the previous period (${formatMoney(previous, currency)})`}.`,
      orders === null ? null : `Orders: ${orders}.`,
      aov === null ? null : `Average order value: ${formatMoney(aov, currency)}.`,
      // Freshness label: the merchant always sees exactly which window the
      // figures cover, never an undated "current" number.
      days === null ? null : `Data window: last ${days} ${days === 1 ? 'day' : 'days'}, as of today.`,
    ].filter(Boolean)
    // Executive summary framing (INTENT B): for summary / trend queries, end
    // on insight rather than bare numbers.
    if (/\b(summari[sz]e|summary|overview|trend|performance|recap|review|how (?:did|are|is))\b/i.test(query)) {
      if (takeaway !== null) parts.push(`Key takeaway: ${takeaway}`)
      if (nextStep !== null) parts.push(nextStep)
    }
    return {
      text: parts.join(' '),
      structured: { type: 'analytics', data: { ...data, keyTakeaway: takeaway, nextStep, trend, change }, source: humanizeSource(outcome.source), actions: ['export'] },
    }
  }
  if (outcome.name === 'search_customers') {
    const items = arrayOfRecords(data.items ?? data.customers)
    const count = numberish(data.count) ?? items.length
    const total = numberish(data.total)
    const normalizedQuery = query.toLowerCase()
    const asksInactive = /\binactive\b/.test(normalizedQuery)
    let text: string
    if (count === 0 && asksInactive && total !== null && total > 0) {
      text = 'Great news! All your customers are active. No inactive customers found based on our criteria (no orders in the last 30 days).'
    } else if (count === 0 && (total === null || total === 0)) {
      text = "I don't have customer data yet. Please sync your Shopify customers first — go to the Customers page to start syncing."
    } else if (count === 0) {
      text = 'No customers matched that query in the synced customer table.'
    } else {
      text = `I found ${count} customer${count === 1 ? '' : 's'} from your synced Shopify customers.`
    }
    return {
      text,
      structured: { type: 'customer_list', data: items, source: humanizeSource(outcome.source), actions: ['email', 'tag', 'export'] },
    }
  }
  if (outcome.name === 'search_products') {
    const items = arrayOfRecords(data.items ?? data.products)
    const count = numberish(data.count) ?? items.length
    return {
      text: count === 0 ? 'No products matched that query in the synced catalog.' : `I found ${count} product${count === 1 ? '' : 's'} from your synced catalog.`,
      structured: { type: 'product_list', data: items, source: humanizeSource(outcome.source), actions: ['export'] },
    }
  }
  if (outcome.name === 'search_orders') {
    const items = arrayOfRecords(data.items ?? data.orders)
    const count = numberish(data.count) ?? items.length
    return {
      text: count === 0 ? 'No orders matched that query in the synced order table.' : `I found ${count} order${count === 1 ? '' : 's'} from your synced Shopify orders.`,
      structured: { type: 'order_list', data: items, source: humanizeSource(outcome.source), actions: ['export'] },
    }
  }
  if (outcome.name === 'get_inventory_status') {
    const low = numberish(data.lowStockCount)
    const out = numberish(data.outOfStockCount)
    const items = arrayOfRecords(data.items)
    return {
      text: low === null && out === null
        ? 'Inventory status is not available yet. Sync inventory to load real stock levels.'
        : `Inventory: ${low ?? 0} low-stock and ${out ?? 0} out-of-stock tracked variants, as of today.`,
      structured: { type: 'inventory_list', data: items, source: humanizeSource(outcome.source), actions: ['export'] },
    }
  }
  if (outcome.name === 'get_recommendations') {
    const items = arrayOfRecords(data.items ?? data.recommendations)
    const count = numberish(data.count) ?? items.length
    return {
      text: count === 0 ? 'There are no recommendations matching that filter right now.' : `There are ${count} recommendation${count === 1 ? '' : 's'} from the recommendations ledger.`,
      structured: { type: 'recommendation_list', data: items, source: humanizeSource(outcome.source), actions: ['approve'] },
    }
  }
  if (outcome.name === 'get_store_health') {
    const score = numberish(data.score)
    const label = typeof data.label === 'string' ? data.label : 'unknown'
    return {
      text: score === null ? 'Store health cannot be scored until analytics or inventory rows exist.' : `Store health score is ${score}/100 (${label}), as of today.`,
      structured: { type: 'store_health', data, source: humanizeSource(outcome.source) },
    }
  }
  if (outcome.name === 'list_workflows') {
    const items = arrayOfRecords(data.items ?? data.workflows)
    const count = numberish(data.count) ?? items.length
    return {
      text: count === 0 ? 'You have no automations yet. Head to the Automation page to create your first workflow.' : `You have ${count} automation${count === 1 ? '' : 's'} — here is their current status from the automation ledger.`,
      structured: { type: 'workflow_list', data: items, source: humanizeSource(outcome.source), actions: ['trigger', 'pause', 'resume'] },
    }
  }
  return { text: 'I retrieved live store data for that request.', structured: { type: outcome.name, data, source: humanizeSource(outcome.source) } }
}

export function collectNumbers(value: unknown, into: number[] = []): readonly number[] {
  if (typeof value === 'number' && Number.isFinite(value)) into.push(value)
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, into)
  else if (isRecord(value)) for (const item of Object.values(value)) collectNumbers(item, into)
  return into
}

/**
 * Maps an internal data-feed identifier (for example `analytics_revenue_daily`
 * or `sync_records.customers`) to a clean, merchant-facing attribution badge.
 * Raw database/table names must never reach the chat surface — this is the
 * single source of truth that every response formatter funnels through.
 */
const SOURCE_BADGES: Readonly<Record<string, string>> = {
  // analytics feeds
  'analytics_revenue_daily': '📊 Live Analytics Sync',
  'analytics_product_sales_daily': '📊 Live Analytics Sync',
  // customer / order sync records
  'sync_records.customers': '👥 Verified Customer Data',
  'sync_records_customers': '👥 Verified Customer Data',
  'sync_records.orders': '🧾 Verified Order Data',
  'sync_records_orders': '🧾 Verified Order Data',
  // catalog + product performance
  'catalog_products': '📦 Inventory & Sales History',
  'catalog_products + analytics_product_sales_daily': '📦 Inventory & Sales History',
  // recommendation ledger
  'ai_recommendations': '💡 AI Growth Recommendations',
  // inventory quantity feeds
  'inventory_levels': '📦 Inventory & Sales History',
  'variant_inventory_quantity': '📦 Inventory & Sales History',
  'unavailable': '✨ Verified Store Data',
  // cross-module store health
  'analytics + inventory': '✨ Verified Store Data',
  // automation engine
  'automation_workflows': '⚙️ Automation Engine',
}

export function humanizeSource(source: string): string {
  const trimmed = typeof source === 'string' ? source.trim() : ''
  if (!trimmed) return '✨ Verified Store Data'
  const lower = trimmed.toLowerCase()
  const direct = SOURCE_BADGES[lower]
  if (direct) return direct
  // Already a polished badge (emoji + words)? Pass it through unchanged.
  if (/\p{Extended_Pictographic}/u.test(trimmed) && /\s/.test(trimmed)) return trimmed
  // Compound sources such as "catalog_products + analytics_product_sales_daily".
  const parts = lower.split(/\s*\+\s*|\s*,\s*/).filter(Boolean)
  if (parts.length > 1) {
    for (const part of parts) {
      const mapped = SOURCE_BADGES[part]
      if (mapped) return mapped
    }
  }
  return '✨ Verified Store Data'
}

/** Joins several feed identifiers into one clean, deduplicated badge line. */
export function humanizeSources(sources: readonly string[]): string {
  const badges: string[] = []
  for (const source of sources) {
    const badge = humanizeSource(source)
    if (!badges.includes(badge)) badges.push(badge)
  }
  return badges.join(' · ')
}

/** Compact JSON of tool outcomes for constrained LLM prose formatting. */
export function serializeToolOutcomes(outcomes: readonly ToolOutcome[], maxBytes = 6_000): string {
  const rows = outcomes.map((outcome) => outcome.ok
    ? { tool: outcome.name, source: outcome.source, data: outcome.data }
    : { tool: outcome.name, error: outcome.error })
  let serialized = JSON.stringify(rows, null, 1)
  while (serialized.length > maxBytes && rows.length > 1) {
    rows.pop()
    serialized = JSON.stringify(rows, null, 1)
  }
  return serialized.length > maxBytes ? `${serialized.slice(0, maxBytes)}\n…` : serialized
}

/** Fields that identify real store entities in tool output (products,
 * customers, orders, discounts, workflows). Values are normalized
 * lowercase for comparison. */
const ENTITY_FIELD_KEYS = new Set(['title', 'name', 'displayname', 'email', 'ordernumber', 'firstname', 'lastname', 'vendor', 'code'])

/**
 * Collects every named entity (product titles, customer names and emails,
 * order numbers, discount codes, workflow names) present in tool results.
 * groundCommandText uses this as the allowlist for named-entity validation:
 * any entity a narrative names must exist here, never an invented one.
 */
export function collectEntities(value: unknown, into: string[] = []): readonly string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectEntities(item, into)
    return into
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (ENTITY_FIELD_KEYS.has(key.toLowerCase()) && typeof item === 'string' && item.trim()) into.push(item.trim().toLowerCase())
      else collectEntities(item, into)
    }
  }
  return into
}

/**
 * Zero-hallucination guard for final prose. Every numeric claim must be
 * backed by a number that appeared in the tool results (or was derived from
 * them by deterministic renderer code). When `allowedEntities` is provided,
 * named-entity claims the guard can verify deterministically — customer
 * email addresses and `#order` references — must also exist in the tool
 * results. Anything unsupported replaces the whole narrative with a safe
 * message; we never silently ship an invented figure or name.
 */
export function groundCommandText(text: string, allowedNumbers: readonly number[], allowedEntities?: readonly string[]): string {
  const allowed = new Set(allowedNumbers.map(normalizeNumber))
  allowed.add(normalizeNumber(0))
  allowed.add(normalizeNumber(100))
  const extras = extractNumbers(text).filter((value) => !allowed.has(normalizeNumber(value)))
  if (extras.length > 0) {
    // Never claim a figure was removed while still returning it. Structured data
    // remains available to the UI, and the merchant can retry the narrative.
    return 'I could not safely present this narrative because it contained a figure that was not supported by the live tool results. Review the grounded data card below or try the command again.'
  }
  if (allowedEntities) {
    const entities = new Set(allowedEntities.map((entity) => entity.trim().toLowerCase()).filter(Boolean))
    // Strip surrounding sentence punctuation before comparing: "… to
    // ada@example.com." must still resolve to the real ada@example.com.
    const emails = (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).map((email) => email.replace(/^[.,;:('"(\[]+|[.,;:!'")\]]+$/g, ''))
    const namedOffender = emails.find((email) => !entities.has(email.toLowerCase()))
    if (namedOffender) {
      return 'I could not safely present this narrative because it named a customer or record that is not present in the live tool results. Review the grounded data card below or try the command again.'
    }
  }
  return text.trim()
}

/**
 * The Commander system prompt. Establishes the Commander identity, the
 * allowlist-first scope, plan-aware behavior, the zero-hallucination rules,
 * the action approval flow, the refusal template, and the feature-discovery
 * template. Used both when an LLM planner is wired and as the behavioral
 * contract the deterministic paths mirror.
 */
export function buildSystemPrompt(input: Readonly<{ storeId: StoreId; shop?: string | null; plan: PlanTier; actionsEnabled: boolean }>): string {
  const limits = limitsForPlan(input.plan)
  const tools = AI_COMMAND_TOOL_DEFINITIONS.filter((tool) => input.actionsEnabled || !tool.commanderOnly)
  return [
    `You are Commander — ProfitPilot's AI Command for one Shopify store: the store's AI Commander, leader, controller, and always-on operator${input.shop ? ` (${input.shop})` : ''}.`,
    '',
    'SCOPE — ALLOWLIST-FIRST (STRICT)',
    'You ONLY handle requests that clearly match one of these allowed intents:',
    '1. STORE DATA — this store\'s orders, products, customers, inventory, and sales.',
    '2. STORE ANALYTICS — this store\'s revenue, AOV, growth trends, metrics, performance, store health, and AI recommendations.',
    '3. STORE ACTIONS — this store\'s automations, workflows, emails, tags, discounts, notifications, and reports (actions are Commander-plan only and always require explicit merchant approval of a preview).',
    '4. PROFITPILOT FEATURE HELP — how to use app features (Automation, PatternAI, Recommendations, AI Command itself).',
    '5. CAPABILITY DISCOVERY — "what can you do?" / "what can you help me with?" → describe what you can do for THIS store on THIS plan.',
    ...STORE_SCOPE_GUIDANCE.slice(2),
    '',
    'ZERO HALLUCINATION RULES',
    'Every number you state MUST come from a tool/database result or the merchant\'s own words. Every product name, customer name, and order id you mention MUST come from a tool result.',
    'If data is missing, say "I don\'t have this data available right now". NEVER guess, never fabricate, never assume.',
    'NEVER claim an action was executed if it was not, and never make causal claims the data does not back.',
    'When you quote metrics, label their freshness and window ("as of today", "last 7 days").',
    '',
    'PLAN-AWARE BEHAVIOR',
    `The merchant is on the ${input.plan} plan. Daily command limit: ${limits.commandsPerDay ?? 'unlimited'}. Action execution: ${input.actionsEnabled ? 'allowed after explicit merchant approval' : 'not available on this plan'}.`,
    input.actionsEnabled
      ? 'This store is on the Commander plan with full store control: when the merchant requests an action, propose it, show a preview/approval card, wait for explicit approval, then execute and confirm with the real result.'
      : 'This plan is answers-only: answer store-data questions fully. When the merchant requests an action, do not prepare or run it — say "This action requires the Commander plan. Upgrade to unlock full store control." and offer the Upgrade Plan CTA.',
    'When asked what you can do, list your data capabilities first; list action capabilities too and mark them "Commander plan only" when they are locked on the current plan.',
    '',
    'ACTION APPROVAL FLOW (Commander plan only)',
    '1. Understand the requested action and propose it. 2. Show a preview/approval card describing exactly what will be created or changed. 3. Wait for explicit merchant approval. 4. Execute via the automation/workflow system. 5. Confirm with the real backend result (or the real error). Nothing ever executes without approval.',
    '',
    'PERSONA & TONE',
    'Think like a senior e-commerce growth consultant: articulate, professional, encouraging, and deeply fluent in AOV, LTV, retention, CAC, conversion, and stock cover.',
    'Synthesise the merchant\'s real data into advice, not just metric dumps. Cross-reference modules (orders, customers, inventory, recommendations, automations) so answers connect the dots.',
    'Be concise but substantive. Use Markdown: bold headings, bullets, and inline code for codes/IDs. Never repeat the same canned paragraph for different questions.',
    '',
    'LANGUAGE COMPREHENSION',
    'Understand Hindi and Hinglish (Roman-script Hindi) fully. When the merchant writes in Hindi, reply in warm, natural Hindi (Devanagari); when they write in Hinglish, reply in friendly Hinglish. Keep numbers, metric names, currency, codes and UI labels in English in every language.',
    '',
    'FORMAT CONSTRAINTS',
    'Honor explicit output constraints exactly: "answer only yes or no" gets a single Yes/No (हाँ/नहीं) first, "short summary" gets at most two sentences, "bullet points" gets concise bullets. When a strict constraint is present, drop tables and extra sections.',
    '',
    'CAPABILITY DISCOVERY TEMPLATE',
    'For "what can you do / what can you help me with?": greet as Commander, mention the store and plan, list the data capabilities (sales & revenue analytics, growth trends, orders, products, customers, inventory & low-stock checks, store health, recommendations), then list the action capabilities (create & manage automations, email segments, tag customers, create discounts, approve recommendations, generate reports) — marked "Commander plan only" when actions are locked.',
    '',
    'FOUR INTENTS — classify every in-scope question and shape the answer accordingly:',
    'A. STRATEGIC / ADVISORY ("How can I increase profit?", "How do I grow sales?"): do NOT just show a revenue card. Give 3 specific, data-backed recommendations tailored to the store, each with a concrete number from the data, then suggest a next action.',
    'B. PERFORMANCE SUMMARY / TREND ("Summarize this week", "Revenue trend 6 months"): give a 2-sentence executive summary, surface the relevant metric/card, then end with a "Key takeaway" and a single "Next logical step" — never end on bare numbers.',
    'C. INSTRUCTIONAL / HOW-TO ("How do I create an automation?", "What can PatternAI do?"): give friendly, numbered, step-by-step guidance tied to the real ProfitPilot feature, note any plan limits, and offer a direct navigation CTA.',
    'D. ACTION COMMAND ("Create a 10% discount", "Pause the cart workflow"): on Commander, prepare an action preview card the merchant approves before anything runs; on other plans, explain it needs the Commander plan and show what would happen, with an Upgrade Plan CTA.',
    '',
    'GROUNDING & SAFETY',
    'If a tool returns no data, say so. If you are uncertain, say "I\'m not sure".',
    'Never claim an email was sent, a tag applied, or a discount created unless the backend confirmed it.',
    input.shop ? `Store domain: ${input.shop}.` : 'Store domain is not provided.',
    `Available tools:\n${tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`,
    'Write actions always require a preview and merchant approval. Never auto-execute.',
    'Blocked: delete data, refunds, bulk price edits, bulk inventory edits, billing access, store configuration.',
    'When refusing a blocked action, name the page where the merchant can do it manually.',
    'Never expose internal database or table names (e.g. analytics_revenue_daily, sync_records). Attribution should read as clean merchant-facing badges.',
    'Upgrade CTAs must say Upgrade Plan. Never name a specific paid tier in the CTA.',
  ].join('\n')
}

export function thinkingStepsFor(query: string, tools: readonly ToolCall[], mode: 'info' | 'preview' | 'execute'): readonly string[] {
  const modules = tools.map((tool) => moduleLabel(tool.name))
  if (mode === 'execute') return ['Understanding your request...', 'Checking permissions...', 'Executing action...', 'Verifying results...']
  if (mode === 'preview') return ['Understanding your request...', 'Checking permissions...', 'Preparing action preview...', 'Waiting for your approval...']
  return [
    'Understanding your request...',
    modules[0] ? `Querying ${modules[0]}...` : 'Querying store data...',
    tools.length > 1 ? `Analyzing ${modules.join(', ')}...` : 'Analyzing data...',
    'Preparing response...',
  ]
}

function moduleLabel(name: AiCommandToolName): string {
  if (name === 'search_customers') return 'Customers'
  if (name === 'search_products') return 'Products'
  if (name === 'search_orders') return 'Orders'
  if (name === 'get_analytics') return 'Analytics'
  if (name === 'get_recommendations') return 'Recommendations'
  if (name === 'get_inventory_status') return 'Inventory'
  if (name === 'get_store_health') return 'Store health'
  if (name === 'list_workflows') return 'Automations'
  if (name === 'send_email') return 'Email'
  if (name === 'tag_customers') return 'Customers'
  if (name === 'create_discount') return 'Discounts'
  if (name === 'approve_recommendation') return 'Recommendations'
  if (name === 'trigger_workflow') return 'Automation'
  if (name === 'pause_workflow') return 'Automation'
  if (name === 'resume_workflow') return 'Automation'
  if (name === 'send_notification') return 'Notifications'
  return 'Reports'
}

export function actionPreviewCopy(type: AiCommandActionType, params: Readonly<Record<string, unknown>>): string {
  if (type === 'SEND_EMAIL') {
    const recipients = stringArray(params.recipient_ids ?? params.recipients)
    return `Action: Send email to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}. Subject: ${String(params.subject ?? '(draft subject)')}. No email will send until you approve.`
  }
  if (type === 'TAG_CUSTOMER') {
    const ids = stringArray(params.customer_ids)
    return `Action: ${params.action === 'remove' ? 'Remove' : 'Add'} tag(s) ${stringArray(params.tags).join(', ') || '(none)'} on ${ids.length} customer${ids.length === 1 ? '' : 's'}.`
  }
  if (type === 'CREATE_DISCOUNT') {
    return `Action: Create discount "${String(params.title ?? 'Untitled')}" at ${String(params.value ?? '?')}% off, max ${String(params.usage_limit ?? '?')} uses.`
  }
  if (type === 'APPROVE_RECOMMENDATION') return `Action: Approve recommendation ${String(params.recommendation_id ?? '')}.`
  if (type === 'CREATE_WORKFLOW') return `Action: Create ${String(params.name ?? 'automation')} from the governed ${String(params.template_id ?? '')} template. It will be saved as a draft until you activate it.`
  if (type === 'TRIGGER_WORKFLOW') return `Action: Trigger workflow ${workflowName(params)}.`
  if (type === 'PAUSE_WORKFLOW') {
    const ids = stringArray(params.workflow_ids)
    if (ids.length > 0) return `Action: Deactivate ${ids.length} active automation${ids.length === 1 ? '' : 's'}.`
    return `Action: Deactivate workflow ${workflowName(params)}.`
  }
  if (type === 'RESUME_WORKFLOW') return `Action: Resume workflow ${workflowName(params)}.`
  if (type === 'SEND_NOTIFICATION') return `Action: Send notification "${String(params.title ?? '')}".`
  if (type === 'GENERATE_REPORT') return `Action: Generate ${String(params.report_type ?? 'weekly')} report.`
  return 'Action preview is ready. Approve to execute against live services.'
}

export function parseConfirmIntent(query: string): 'confirm' | 'cancel' | 'undo' | null {
  const normalized = query.trim().toLowerCase()
  if (/^(confirm|approve|yes|do it|go ahead|send it)$/i.test(normalized)) return 'confirm'
  if (/^(cancel|no|stop|never mind|nevermind)$/i.test(normalized)) return 'cancel'
  if (/^(undo|rollback|revert)$/i.test(normalized)) return 'undo'
  return null
}

/* ── Merchant format constraints & language detection (QA 2026-08-22) ──── */

export type AiCommandFormatConstraints = Readonly<{
  /** "answer only yes or no", "reply in yes/no", "haan ya na mein batao" */
  yesNo: boolean
  /** "short summary", "keep it short", "one line answer" */
  shortSummary: boolean
  /** "bullet points", "as a list", "points mein" */
  bulletPoints: boolean
  /** Detected query language when Hindi/Hinglish is used. */
  language: 'hindi' | 'hinglish' | null
}>

const YES_NO_PATTERN = /\b(?:answer|reply|respond|tell|say|bolo|batao|bata(?:\s+do)?)\s+(?:only|just|strictly|in|with|mein|me)?\s*(?:a\s+)?(?:yes\s+or\s+no|yes\/no|y\/n|one\s+word|haan\s+ya\s+na|haan\/na|han\s+ya\s+na)\b|\b(?:yes\s+or\s+no|yes\/no|haan\s+ya\s+na)\s+(?:only|answer|reply|mein|me)\b/i
const SHORT_SUMMARY_PATTERN = /\b(?:short\s+(?:summary|answer|reply|response)|brief\s+(?:summary|answer)|keep\s+it\s+(?:short|brief)|summar(?:ise|ize)[^.]{0,40}\b(?:in|within)\s+(?:one|two|1|2)\s+(?:line|sentence)s?\b|one[- ](?:line|liner|sentence)\s+(?:answer|summary|reply)?|tl;?dr|chota\s+(?:sa\s+)?(?:summary|jawab))\b/i
const BULLET_POINTS_PATTERN = /\b(?:bullet\s+points?|bullets?|as\s+(?:a\s+)?(?:list|bullets)|in\s+(?:bullet\s+)?points?|list\s+format|points\s+mein|bullet\s+mein)\b/i
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/
const HINGLISH_MARKERS = /\b(kya|kaise|kitna|kitne|batao|bata\s+do|mujhe|mera|meri|mere|dikhao|dikha\s+do|chahiye|kab|kaun|konsa|karna|karo|nahi|nahin|hai|hain|tha|the|ho|hua|hui|kar\s+do|samjha|madad|zaroorat|wala|wali|bhi|aur|lekin|agar|toh|abhi|aaj|kal|week|mahine|paise|paisa|kamai|badhao|badhana|ghatao|bhejo|nikalo)\b/i

/**
 * Parses explicit output-format constraints from the merchant's command.
 * When a strict constraint is present the final prose is produced by the LLM
 * (when wired) instead of the deterministic template tables, so "answer only
 * yes or no" actually receives a yes/no answer.
 */
export function parseFormatConstraints(query: string): AiCommandFormatConstraints {
  const language: AiCommandFormatConstraints['language'] = DEVANAGARI_PATTERN.test(query)
    ? 'hindi'
    : HINGLISH_MARKERS.test(query)
      ? 'hinglish'
      : null
  return {
    yesNo: YES_NO_PATTERN.test(query),
    shortSummary: SHORT_SUMMARY_PATTERN.test(query),
    bulletPoints: BULLET_POINTS_PATTERN.test(query),
    language,
  }
}

export function hasStrictFormatConstraints(constraints: AiCommandFormatConstraints): boolean {
  return constraints.yesNo || constraints.shortSummary || constraints.bulletPoints
}

/** System prompt used when the LLM formats constrained final prose. */
export function buildConstrainedFormatPrompt(constraints: AiCommandFormatConstraints, input: Readonly<{ plan: PlanTier; shop?: string | null }>): string {
  const rules: string[] = [
    'You are AI Command, ProfitPilot\'s e-commerce assistant, rewriting a grounded store-data answer into the merchant\'s requested format.',
    'Use ONLY the numbers and facts present in the supplied tool results. Never invent figures, dates, causes, or completed actions.',
  ]
  if (constraints.yesNo) rules.push('The merchant asked for a strict yes/no answer. Start with exactly "Yes." or "No." (or "हाँ।"/"नहीं।" when replying in Hindi), then add at most one short supporting sentence. No tables, no headings, no extra sections.')
  if (constraints.shortSummary) rules.push('The merchant asked for a short summary. Reply in at most two short sentences. No tables and no headings.')
  if (constraints.bulletPoints) rules.push('The merchant asked for bullet points. Reply as 3-6 concise Markdown bullets. No tables and no long paragraphs.')
  if (constraints.language === 'hindi') rules.push('The merchant wrote in Hindi. Reply in natural, friendly Hindi (Devanagari script). Keep metric names, codes, and currency in English.')
  if (constraints.language === 'hinglish') rules.push('The merchant wrote in Hinglish (Roman-script Hindi). Reply in friendly, natural Hinglish. Keep metric names, codes, and currency in English.')
  rules.push(`The merchant is on the ${input.plan} plan.${input.shop ? ` Store: ${input.shop}.` : ''} Never expose table names or internal identifiers.`)
  return rules.join('\n')
}

export function validateDiscountParams(params: Readonly<Record<string, unknown>>, now = Date.now()): Readonly<{ ok: true; value: number; usageLimit: number; expiresAt: string; title: string }> | Readonly<{ ok: false; error: string }> {
  const value = Number(params.value)
  const usageLimit = Number(params.usage_limit ?? params.usageLimit)
  const title = typeof params.title === 'string' && params.title.trim() ? params.title.trim() : 'AI Command discount'
  const expiresAt = typeof params.expires_at === 'string' ? params.expires_at : typeof params.expiresAt === 'string' ? params.expiresAt : ''
  if (!Number.isFinite(value) || value <= 0 || value > 50) return { ok: false, error: 'Discount value must be between 1 and 50 percent.' }
  if (!Number.isInteger(usageLimit) || usageLimit < 1 || usageLimit > 1000) return { ok: false, error: 'Usage limit must be an integer between 1 and 1000.' }
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) return { ok: false, error: 'A valid expiry date at least 1 day from now is required.' }
  if (Date.parse(expiresAt) < now + 86_400_000 - 60_000) return { ok: false, error: 'Discount expiry must be at least 1 day from now.' }
  return { ok: true, value, usageLimit, expiresAt, title }
}

/** Rejects action previews that cannot possibly succeed. This keeps the UI
 * from offering an Approve button for an empty recipient list or unresolved
 * workflow/recommendation. */
export function validateActionPreview(tool: AiCommandWriteTool, params: Readonly<Record<string, unknown>>, now = Date.now()): string | null {
  if (tool === 'create_discount') {
    const validated = validateDiscountParams(params, now)
    return validated.ok ? null : validated.error
  }
  if (tool === 'send_email' && stringArray(params.recipient_ids).length === 0) return 'No eligible email recipients matched this command. Ask me to show a customer segment first, then send to those customers.'
  if (tool === 'tag_customers' && stringArray(params.customer_ids).length === 0) return 'No customers matched this command, so there is nothing to tag.'
  if (tool === 'tag_customers' && stringArray(params.tags).length === 0) return 'Add a tag name before I prepare this action.'
  if (tool === 'approve_recommendation' && !nonEmptyString(params.recommendation_id)) return 'There is no pending recommendation available to approve.'
  if (tool === 'create_workflow' && !nonEmptyString(params.template_id)) return 'I could not map that request to a safe automation template. Try “Create a low-stock alert automation”.'
  if ((tool === 'trigger_workflow' || tool === 'resume_workflow') && !nonEmptyString(params.workflow_id)) return 'I could not identify an automation. Name the workflow you want me to use.'
  if (tool === 'pause_workflow' && !nonEmptyString(params.workflow_id) && stringArray(params.workflow_ids).length === 0) return 'No active automations matched this request, so there is nothing to deactivate.'
  if (tool === 'send_notification' && !nonEmptyString(params.message)) return 'A notification message is required.'
  return null
}

export class InMemoryAiCommandRepository implements AiCommandRepository {
  private readonly conversations = new Map<string, AiCommandConversation>()
  private readonly actions = new Map<string, AiCommandActionRecord>()
  private readonly saved = new Map<string, AiCommandSavedCommand>()
  private readonly usage = new Map<string, AiCommandUsage>()
  private readonly preferences = new Map<string, AiCommandPreferences>()
  private readonly plan: PlanTier

  public constructor(plan: PlanTier = 'trial') { this.plan = plan }

  public async createConversation(conversation: AiCommandConversation): Promise<AiCommandConversation> {
    this.conversations.set(conversation.id, conversation)
    return conversation
  }
  public async getConversation(storeId: StoreId, id: string): Promise<AiCommandConversation | null> {
    const conversation = this.conversations.get(id)
    return conversation?.storeId === storeId ? conversation : null
  }
  public async listConversations(storeId: StoreId, limit = 20): Promise<readonly AiCommandConversation[]> {
    return [...this.conversations.values()].filter((item) => item.storeId === storeId).sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt)).slice(0, limit)
  }
  public async saveConversation(conversation: AiCommandConversation): Promise<AiCommandConversation> {
    this.conversations.set(conversation.id, conversation)
    return conversation
  }
  public async deleteConversation(storeId: StoreId, id: string): Promise<boolean> {
    const current = this.conversations.get(id)
    if (!current || current.storeId !== storeId) return false
    this.conversations.delete(id)
    return true
  }
  public async createAction(action: AiCommandActionRecord): Promise<AiCommandActionRecord> { this.actions.set(action.id, action); return action }
  public async getAction(storeId: StoreId, id: string): Promise<AiCommandActionRecord | null> {
    const action = this.actions.get(id)
    return action?.storeId === storeId ? action : null
  }
  public async listActions(storeId: StoreId, limit = 50): Promise<readonly AiCommandActionRecord[]> {
    return [...this.actions.values()].filter((item) => item.storeId === storeId).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit)
  }
  public async saveAction(action: AiCommandActionRecord): Promise<AiCommandActionRecord> { this.actions.set(action.id, action); return action }
  public async claimAction(storeId: StoreId, id: string, approvedAt: string): Promise<AiCommandActionRecord | null> {
    const action = this.actions.get(id)
    if (!action || action.storeId !== storeId || action.executionStatus !== 'PENDING') return null
    const claimed = { ...action, merchantApproved: true, approvedAt, executionStatus: 'EXECUTING' as const }
    this.actions.set(id, claimed)
    return claimed
  }
  public async cancelPendingAction(storeId: StoreId, id: string, completedAt: string): Promise<AiCommandActionRecord | null> {
    const action = this.actions.get(id)
    if (!action || action.storeId !== storeId || action.executionStatus !== 'PENDING') return null
    const cancelled = { ...action, executionStatus: 'CANCELLED' as const, completedAt }
    this.actions.set(id, cancelled)
    return cancelled
  }
  public async claimRollback(storeId: StoreId, id: string, now: string): Promise<AiCommandActionRecord | null> {
    const action = this.actions.get(id)
    if (!action || action.storeId !== storeId || !action.rollbackAvailable || !action.rollbackDeadline || action.rollbackDeadline < now) return null
    const claimed = { ...action, rollbackAvailable: false }
    this.actions.set(id, claimed)
    return claimed
  }
  public async listSaved(storeId: StoreId): Promise<readonly AiCommandSavedCommand[]> {
    return [...this.saved.values()].filter((item) => item.storeId === storeId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }
  public async saveCommand(command: AiCommandSavedCommand): Promise<AiCommandSavedCommand> { this.saved.set(command.id, command); return command }
  public async getSaved(storeId: StoreId, id: string): Promise<AiCommandSavedCommand | null> {
    const command = this.saved.get(id)
    return command?.storeId === storeId ? command : null
  }
  public async deleteSaved(storeId: StoreId, id: string): Promise<boolean> {
    const current = this.saved.get(id)
    if (!current || current.storeId !== storeId) return false
    this.saved.delete(id)
    return true
  }
  public async incrementUsage(storeId: StoreId, usageDate: string, delta: Readonly<{ commands?: number; actions?: number; tokens?: number; costMicroDollars?: number }>): Promise<AiCommandUsage> {
    const key = `${storeId}:${usageDate}`
    const current = this.usage.get(key) ?? emptyUsage(storeId, usageDate, this.plan)
    const next = applyUsageLimits({
      ...current,
      commandsUsed: current.commandsUsed + (delta.commands ?? 0),
      actionsExecuted: current.actionsExecuted + (delta.actions ?? 0),
      tokensUsed: current.tokensUsed + (delta.tokens ?? 0),
      costMicroDollars: current.costMicroDollars + (delta.costMicroDollars ?? 0),
    }, this.plan)
    this.usage.set(key, next)
    return next
  }
  public async reserveCommand(storeId: StoreId, usageDate: string, limit: number | null): Promise<AiCommandUsage | null> {
    const key = `${storeId}:${usageDate}`
    const current = this.usage.get(key) ?? emptyUsage(storeId, usageDate, this.plan)
    if (limit !== null && current.commandsUsed >= limit) return null
    const next = applyUsageLimits({ ...current, commandsUsed: current.commandsUsed + 1 }, this.plan)
    this.usage.set(key, next)
    return next
  }
  public async getUsage(storeId: StoreId, usageDate: string): Promise<AiCommandUsage> {
    return this.usage.get(`${storeId}:${usageDate}`) ?? emptyUsage(storeId, usageDate, this.plan)
  }
  public async listUsage(storeId: StoreId, days: number): Promise<readonly AiCommandUsage[]> {
    return [...this.usage.values()].filter((item) => item.storeId === storeId).sort((left, right) => right.usageDate.localeCompare(left.usageDate)).slice(0, days)
  }
  public async getPreferences(storeId: StoreId): Promise<AiCommandPreferences> {
    return this.preferences.get(storeId) ?? defaultCommandPreferences(storeId)
  }
  public async savePreferences(preferences: AiCommandPreferences): Promise<AiCommandPreferences> {
    this.preferences.set(preferences.storeId, preferences)
    return preferences
  }
}

export class InMemoryCommandTools implements AiCommandToolRuntime {
  public constructor(private readonly seed: Readonly<Record<string, unknown>> = {}) {}
  public async run(_storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    const seeded = this.seed[call.name]
    if (seeded === undefined) return { ok: false, name: call.name, error: 'No data is available for this tool yet.', source: 'unavailable' }
    if (isRecord(seeded) && seeded.ok === false) return { ok: false, name: call.name, error: String(seeded.error ?? 'Tool failed'), source: String(seeded.source ?? call.name) }
    return { ok: true, name: call.name, data: seeded, source: `${call.name}.live`, numbers: [...collectNumbers(seeded)] }
  }
}

export class InMemoryCommandActions implements AiCommandActionRuntime {
  public constructor(private readonly handler?: (action: AiCommandActionRecord) => Promise<ActionExecutionResult> | ActionExecutionResult) {}
  public async execute(_storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    if (this.handler) return this.handler(action)
    return { status: 'FAILED', result: { message: 'Action runtime is not connected. The action was not executed.' }, errorDetails: { reason: 'NOT_CONNECTED' }, rollbackAvailable: false }
  }
  public async rollback(_storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    return { status: 'SUCCESS', result: { rolledBack: true, actionId: action.id }, rollbackAvailable: false }
  }
}

export class AiCommandService {
  private readonly repository: AiCommandRepository
  private readonly tools: AiCommandToolRuntime
  private readonly actions: AiCommandActionRuntime
  private readonly planFor: (storeId: StoreId) => Promise<PlanTier>
  private readonly generate: ((input: AiCommandGenerateInput) => Promise<AiCommandGenerateResult>) | null
  private readonly proseFormatter: ((input: Readonly<{ system: string; user: string }>) => Promise<string>) | null
  private readonly now: () => number
  private readonly enabled: boolean
  private readonly actionsEnabled: boolean
  private readonly shopFor: ((storeId: StoreId) => Promise<string | null>) | null
  private readonly stateFor: ((storeId: StoreId) => Promise<string | null>) | null

  public constructor(input: Readonly<{
    repository: AiCommandRepository
    tools: AiCommandToolRuntime
    actions?: AiCommandActionRuntime
    planFor: (storeId: StoreId) => Promise<PlanTier>
    generate?: (input: AiCommandGenerateInput) => Promise<AiCommandGenerateResult>
    /**
     * Optional LLM prose formatter. When the merchant requests a strict output
     * format (yes/no only, short summary, bullet points) or writes in
     * Hindi/Hinglish, the final answer is produced here from the grounded tool
     * outcomes instead of the deterministic template tables.
     */
    proseFormatter?: (input: Readonly<{ system: string; user: string }>) => Promise<string>
    shopFor?: (storeId: StoreId) => Promise<string | null>
    /**
     * Billing-state resolver. When wired, Commander checks plan AND state:
     * expired/pending/past-due/cancelled/suspended stores are refused, trial
     * stores answer data questions but never execute actions. When it is not
     * wired (legacy/test wiring), the plan gate runs alone as before.
     */
    stateFor?: (storeId: StoreId) => Promise<string | null>
    now?: () => number
    enabled?: boolean
    actionsEnabled?: boolean
  }>) {
    this.repository = input.repository
    this.tools = input.tools
    this.actions = input.actions ?? new InMemoryCommandActions()
    this.planFor = input.planFor
    this.generate = input.generate ?? null
    this.proseFormatter = input.proseFormatter ?? null
    this.shopFor = input.shopFor ?? null
    this.stateFor = input.stateFor ?? null
    this.now = input.now ?? (() => Date.now())
    this.enabled = input.enabled !== false
    this.actionsEnabled = input.actionsEnabled !== false
  }

  private actionAccess(plan: PlanTier, mode: AiCommandBillingMode = 'active'): boolean {
    return this.actionsEnabled && mode === 'active' && limitsForPlan(plan).actionsEnabled
  }

  /**
   * Resolves the full Commander access decision for a store: plan tier plus
   * billing state. Without a wired `stateFor` the plan gate runs alone
   * (legacy behavior); with one, an unknown record degrades to TRIAL_LIMITED
   * and blocked states (expired/pending/past-due/cancelled/suspended) shut
   * Commander down entirely.
   */
  private async accessFor(storeId: StoreId): Promise<AiCommandAccess> {
    const plan = await this.planFor(storeId)
    if (!this.stateFor) return { plan, billingState: null, mode: 'active', actionsEnabled: this.actionAccess(plan) }
    const billingState = normalizeAiCommandBillingState(await this.stateFor(storeId))
    const mode = aiCommandBillingMode(billingState)
    return { plan, billingState, mode, actionsEnabled: this.actionAccess(plan, mode) }
  }

  public async usage(storeId: StoreId): Promise<AiCommandUsage> {
    const access = await this.accessFor(storeId)
    const usage = applyUsageLimits(await this.repository.getUsage(storeId, usageDateKey(this.now())), access.plan)
    return { ...usage, actionsEnabled: access.actionsEnabled }
  }

  public async usageHistory(storeId: StoreId, days = 30): Promise<readonly AiCommandUsage[]> {
    return this.repository.listUsage(storeId, Math.min(90, Math.max(1, days)))
  }

  public async conversations(storeId: StoreId, limit = 20): Promise<readonly AiCommandConversation[]> {
    const plan = await this.planFor(storeId)
    const all = (await this.repository.listConversations(storeId, limit)).filter((item) => item.status === 'ACTIVE')
    const days = limitsForPlan(plan).historyDays
    if (days === null) return all
    const cutoff = this.now() - days * 86_400_000
    return all.filter((item) => Date.parse(item.lastMessageAt) >= cutoff)
  }

  public async conversation(storeId: StoreId, id: string): Promise<AiCommandConversation> {
    const conversation = await this.repository.getConversation(storeId, id)
    if (!conversation) throw new AppError('NOT_FOUND', 'Conversation not found', 404)
    return conversation
  }

  public async deleteConversation(storeId: StoreId, id: string): Promise<void> {
    const deleted = await this.repository.deleteConversation(storeId, id)
    if (!deleted) throw new AppError('NOT_FOUND', 'Conversation not found', 404)
  }

  public async archiveConversation(storeId: StoreId, id: string): Promise<AiCommandConversation> {
    const conversation = await this.conversation(storeId, id)
    return this.repository.saveConversation({ ...conversation, status: 'ARCHIVED', updatedAt: new Date(this.now()).toISOString() })
  }

  public async preferences(storeId: StoreId): Promise<AiCommandPreferences> {
    return this.repository.getPreferences(storeId)
  }

  public async updatePreferences(storeId: StoreId, patch: Partial<AiCommandPreferences>): Promise<AiCommandPreferences> {
    const current = await this.repository.getPreferences(storeId)
    const next: AiCommandPreferences = {
      ...current,
      ...pickPreference(patch),
      storeId,
      updatedAt: new Date(this.now()).toISOString(),
    }
    return this.repository.savePreferences(next)
  }

  public async rateMessage(storeId: StoreId, conversationId: string, messageId: string, rating: 'HELPFUL' | 'NOT_HELPFUL'): Promise<Readonly<{ saved: true }>> {
    const conversation = await this.conversation(storeId, conversationId)
    const target = conversation.messages.find((item) => item.id === messageId && item.role === 'assistant')
    if (!target) throw new AppError('NOT_FOUND', 'Assistant message not found', 404)
    const existing = isRecord(conversation.context.messageFeedback) ? conversation.context.messageFeedback : {}
    await this.repository.saveConversation({
      ...conversation,
      context: {
        ...conversation.context,
        messageFeedback: {
          ...existing,
          [messageId]: { rating, createdAt: new Date(this.now()).toISOString() },
        },
      },
      updatedAt: new Date(this.now()).toISOString(),
    })
    return { saved: true }
  }

  public async savedCommands(storeId: StoreId): Promise<readonly AiCommandSavedCommand[]> {
    return this.repository.listSaved(storeId)
  }

  public async saveCommand(storeId: StoreId, input: Readonly<{ name: string; commandText: string; category?: string }>): Promise<AiCommandSavedCommand> {
    const name = input.name.trim()
    const commandText = input.commandText.trim()
    if (!name) throw new AppError('VALIDATION_ERROR', 'Saved command name is required', 400)
    if (!commandText) throw new AppError('VALIDATION_ERROR', 'Saved command text is required', 400)
    const plan = await this.planFor(storeId)
    const limit = limitsForPlan(plan).savedCommands
    const existing = await this.repository.listSaved(storeId)
    if (limit !== null && existing.length >= limit) throw new AppError('PAYMENT_REQUIRED', 'Upgrade Plan to save more commands', 402, { reason: 'UPGRADE_REQUIRED', feature: 'ai_command_saved' })
    const now = new Date(this.now()).toISOString()
    return this.repository.saveCommand({
      id: randomUUID(),
      storeId,
      name: name.slice(0, 80),
      commandText: commandText.slice(0, 500),
      category: (input.category ?? 'general').trim().slice(0, 40) || 'general',
      useCount: 0,
      lastUsedAt: null,
      createdAt: now,
    })
  }

  public async deleteSaved(storeId: StoreId, id: string): Promise<void> {
    const deleted = await this.repository.deleteSaved(storeId, id)
    if (!deleted) throw new AppError('NOT_FOUND', 'Saved command not found', 404)
  }

  public async executeSaved(storeId: StoreId, id: string, listener?: ChatListener): Promise<AiCommandChatResult> {
    const saved = await this.repository.getSaved(storeId, id)
    if (!saved) throw new AppError('NOT_FOUND', 'Saved command not found', 404)
    await this.repository.saveCommand({ ...saved, useCount: saved.useCount + 1, lastUsedAt: new Date(this.now()).toISOString() })
    return this.chat({ storeId, text: saved.commandText }, listener)
  }

  public async actionsHistory(storeId: StoreId, limit = 50): Promise<readonly AiCommandActionRecord[]> {
    return this.repository.listActions(storeId, limit)
  }

  public async action(storeId: StoreId, id: string): Promise<AiCommandActionRecord> {
    const action = await this.repository.getAction(storeId, id)
    if (!action) throw new AppError('NOT_FOUND', 'Action not found', 404)
    return action
  }

  public async quickInsights(storeId: StoreId): Promise<AiCommandQuickInsights> {
    const [analytics, inventory, health] = await Promise.all([
      this.tools.run(storeId, { name: 'get_analytics', params: { metric: 'revenue_orders', date_range: '1d' } }),
      this.tools.run(storeId, { name: 'get_inventory_status', params: { filter: 'low', limit: 1 } }),
      this.tools.run(storeId, { name: 'get_store_health', params: {} }),
    ])
    const analyticsData = analytics.ok && isRecord(analytics.data) ? analytics.data : null
    const inventoryData = inventory.ok && isRecord(inventory.data) ? inventory.data : null
    const healthData = health.ok && isRecord(health.data) ? health.data : null
    return {
      currency: analyticsData ? currencyCode(analyticsData.currency) : null,
      revenueToday: analyticsData ? numberish(analyticsData.revenue) : null,
      revenueYesterday: analyticsData ? numberish(analyticsData.previousRevenue) : null,
      ordersToday: analyticsData ? numberish(analyticsData.orders) : null,
      ordersYesterday: analyticsData ? numberish(analyticsData.previousOrders) : null,
      lowStockCount: inventoryData ? numberish(inventoryData.lowStockCount) : null,
      healthScore: healthData ? numberish(healthData.score) : null,
      healthStatus: healthData && typeof healthData.label === 'string' ? healthData.label : null,
      sources: [analytics, inventory, health].filter((outcome) => outcome.ok).map((outcome) => outcome.source),
    }
  }

  public async suggestions(_storeId: StoreId, command: string): Promise<readonly AiCommandSuggestion[]> {
    return contextualFollowUps(command)
  }

  public async quickCommands(storeId: StoreId): Promise<readonly AiCommandQuickCommand[]> {
    const access = await this.accessFor(storeId)
    const snapshot: { lowStock?: number; pendingRecommendations?: number; inactiveCustomers?: number } = {}
    const inventory = await this.tools.run(storeId, { name: 'get_inventory_status', params: { filter: 'low' } })
    if (inventory.ok && isRecord(inventory.data)) {
      const lowStock = numberish(inventory.data.lowStockCount)
      if (lowStock !== null) snapshot.lowStock = lowStock
    }
    const recs = await this.tools.run(storeId, { name: 'get_recommendations', params: { status: 'PENDING', limit: 5 } })
    if (recs.ok && isRecord(recs.data)) {
      const pending = numberish(recs.data.count)
      if (pending !== null) snapshot.pendingRecommendations = pending
    }
    const commands = contextualQuickCommands(access.plan, snapshot)
    return access.actionsEnabled ? commands : commands.filter((command) => command.kind !== 'action')
  }

  public async chat(input: Readonly<{ storeId: StoreId; text: string; conversationId?: string; signal?: AbortSignal }>, listener?: ChatListener): Promise<AiCommandChatResult> {
    throwIfCommandAborted(input.signal)
    if (!this.enabled) throw new AppError('FORBIDDEN', 'AI Command is not enabled', 403)
    const text = input.text.trim()
    if (!text) throw new AppError('VALIDATION_ERROR', 'Command cannot be empty', 400)
    if (text.length > 2_000) throw new AppError('VALIDATION_ERROR', 'Command must be 2,000 characters or fewer', 400)
    // Plan AND billing state gate: expired / pending / past-due / cancelled /
    // suspended stores get the upgrade-or-reactivate message instead of an
    // answer, without burning one of their daily commands.
    const access = await this.accessFor(input.storeId)
    if (access.mode === 'blocked') return this.billingBlockedReply(input, access, listener)
    const limits = limitsForPlan(access.plan)
    const date = usageDateKey(this.now())
    const reservation = await this.repository.reserveCommand(input.storeId, date, limits.commandsPerDay)
    if (!reservation) {
      const usage = applyUsageLimits(await this.repository.getUsage(input.storeId, date), access.plan)
      throw new AppError('PAYMENT_REQUIRED', 'You have reached today\'s command limit. Upgrade Plan for more.', 402, { reason: 'UPGRADE_REQUIRED', feature: 'ai_command_daily', used: usage.commandsUsed, limit: limits.commandsPerDay })
    }

    try {
      const conversation = await this.loadOrCreateConversation(input.storeId, input.conversationId, text)
      const userMessage = message('user', text, 'text', this.now())
      const confirm = parseConfirmIntent(text)
      emit(listener, 'thinking', { step: 'Understanding your request...' })

      let resultMessage: AiCommandMessage
      if (confirm === 'confirm') resultMessage = await this.confirmLatest(input.storeId, conversation, access, listener)
      else if (confirm === 'cancel') resultMessage = await this.cancelLatest(input.storeId, conversation)
      else if (confirm === 'undo') resultMessage = await this.undoLatest(input.storeId, conversation, access.plan)
      else resultMessage = await this.answer(input.storeId, conversation, text, access, listener)

      // Information requests can be discarded safely when the client cancels.
      // Action previews/results already have durable lifecycle state, so they
      // must still be linked into history even if the SSE connection closes.
      if (!mustPersistActionState(resultMessage)) throwIfCommandAborted(input.signal)
      const settledMessages = settleActionMessages(conversation.messages, resultMessage)
      const nextMessages = [...settledMessages, userMessage, resultMessage]
      const entityHint = extractEntityHint(resultMessage)
      const nextConversation = await this.repository.saveConversation({
        ...conversation,
        messages: nextMessages,
        context: {
          ...conversation.context,
          lastActionId: resultMessage.action?.id ?? conversation.context.lastActionId ?? null,
          lastEntities: entityHint ?? conversation.context.lastEntities ?? null,
        },
        updatedAt: resultMessage.timestamp,
        lastMessageAt: resultMessage.timestamp,
      })
      const persistedUsage = successfulActionResult(resultMessage)
        ? await this.repository.incrementUsage(input.storeId, date, { actions: 1 })
        : reservation
      const nextUsage = { ...persistedUsage, actionsEnabled: access.actionsEnabled }
      emit(listener, 'message', resultMessage)
      emit(listener, 'usage', nextUsage)
      emit(listener, 'done', { ok: true })
      return { conversation: nextConversation, message: resultMessage, usage: nextUsage, thinkingSteps: resultMessage.thinkingSteps ?? [] }
    } catch (error: unknown) {
      try { await this.repository.incrementUsage(input.storeId, date, { commands: -1 }) } catch { /* preserve the original failure */ }
      throw error
    }
  }

  /**
   * Renders the trial-expired / billing-inactive message as a normal chat
   * turn: the merchant sees one honest upgrade prompt with their question
   * preserved in history and no daily command consumed.
   */
  private async billingBlockedReply(input: Readonly<{ storeId: StoreId; text: string; conversationId?: string; signal?: AbortSignal }>, access: AiCommandAccess, listener?: ChatListener): Promise<AiCommandChatResult> {
    const now = this.now()
    const billingState = access.billingState ?? 'TRIAL_EXPIRED'
    const conversation = await this.loadOrCreateConversation(input.storeId, input.conversationId, input.text.trim())
    const userMessage = message('user', input.text.trim(), 'text', now)
    const reply = message('assistant', renderBillingBlockedResponse(billingState), 'upgrade', now, {
      structuredData: { type: 'billing_blocked', data: { state: billingState, plan: access.plan, reason: 'BILLING_INACTIVE' }, actions: ['upgrade'] },
      thinkingSteps: ['Checking your plan...'],
    })
    const nextConversation = await this.repository.saveConversation({
      ...conversation,
      messages: [...conversation.messages, userMessage, reply],
      updatedAt: reply.timestamp,
      lastMessageAt: reply.timestamp,
    })
    const usage = applyUsageLimits(await this.repository.getUsage(input.storeId, usageDateKey(now)), access.plan)
    const nextUsage = { ...usage, actionsEnabled: false }
    emit(listener, 'message', reply)
    emit(listener, 'usage', nextUsage)
    emit(listener, 'done', { ok: true })
    return { conversation: nextConversation, message: reply, usage: nextUsage, thinkingSteps: reply.thinkingSteps ?? [] }
  }

  public async approveAction(storeId: StoreId, actionId: string, listener?: ChatListener): Promise<AiCommandActionRecord> {
    const access = await this.accessFor(storeId)
    if (access.mode === 'blocked') {
      throw new AppError('PAYMENT_REQUIRED', renderBillingBlockedResponse(access.billingState ?? 'TRIAL_EXPIRED'), 402, { reason: 'BILLING_INACTIVE', state: access.billingState })
    }
    if (!access.actionsEnabled) {
      if (access.plan === 'commander' && access.mode === 'active') throw new AppError('DEPENDENCY_ERROR', 'Action execution is temporarily unavailable. No store change was attempted.', 503)
      throw new AppError('PAYMENT_REQUIRED', 'Action execution requires Commander plan. Upgrade Plan to continue.', 402, { reason: 'UPGRADE_REQUIRED', feature: 'ai_command_actions' })
    }
    const plan = access.plan
    const action = await this.action(storeId, actionId)
    if (action.executionStatus !== 'PENDING') throw new AppError('CONFLICT', 'This action is no longer pending approval', 409, { status: action.executionStatus })
    const executed = await this.executeApproved(storeId, action, plan, listener)
    await this.recordDirectActionResult(executed)
    if (executed.executionStatus === 'SUCCESS' || executed.executionStatus === 'PARTIAL_SUCCESS') {
      await this.repository.incrementUsage(storeId, usageDateKey(this.now()), { actions: 1 })
    }
    return executed
  }

  public async cancelAction(storeId: StoreId, actionId: string): Promise<AiCommandActionRecord> {
    const cancelled = await this.cancelPending(storeId, actionId)
    await this.recordDirectActionResult(cancelled)
    return cancelled
  }

  public async rollbackAction(storeId: StoreId, actionId: string): Promise<AiCommandActionRecord> {
    const rolled = await this.rollback(storeId, actionId)
    await this.recordDirectActionResult(rolled)
    return rolled
  }

  public async exportConversation(storeId: StoreId, id: string): Promise<Readonly<{ filename: string; rows: readonly Readonly<Record<string, string>>[] }>> {
    const plan = await this.planFor(storeId)
    if (!limitsForPlan(plan).exportConversations) throw new AppError('PAYMENT_REQUIRED', 'Exporting conversations requires Upgrade Plan.', 402, { reason: 'UPGRADE_REQUIRED' })
    const conversation = await this.conversation(storeId, id)
    return {
      filename: `ai-command-${conversation.id}.csv`,
      rows: conversation.messages.map((item) => ({ timestamp: item.timestamp, role: item.role, type: item.contentType, content: item.content })),
    }
  }

  private async answer(storeId: StoreId, conversation: AiCommandConversation, text: string, access: AiCommandAccess, listener?: ChatListener): Promise<AiCommandMessage> {
    const plan = access.plan
    const blocked = detectBlockedAction(text)
    if (blocked) {
      return message('assistant', renderBlockedResponse(blocked), 'blocked', this.now(), { thinkingSteps: ['Understanding your request...'] })
    }
    // Allowlist-first scope gate: anything that matches no allowed intent
    // (store data, analytics, action, app help, capability discovery) is
    // refused with the Commander template before any tool runs.
    const offTopic = detectOffTopic(text)
    if (offTopic) {
      return message('assistant', renderOffTopicResponse(offTopic), 'offtopic', this.now(), { thinkingSteps: ['Understanding your request...'] })
    }
    const write = detectWriteTool(text)
    if (write) {
      emit(listener, 'thinking', { step: 'Checking permissions...' })
      if (!access.actionsEnabled) {
        const infoTools = ambientToolsWhenUnmapped(text, parseInfoTools(text))
        const outcomes = await this.runTools(storeId, infoTools, listener)
        const formatted = formatToolAnswer(text, outcomes)
        if (plan === 'commander' && access.mode === 'active') {
          return message('assistant', `${formatted.content}\n\nAction execution is temporarily unavailable. No store change was attempted.`, 'error', this.now(), {
            structuredData: formatted.structuredData,
            thinkingSteps: thinkingStepsFor(text, infoTools, 'info'),
          })
        }
        return message('assistant', renderUpgradeResponse(humanAction(write), formatted.content), 'upgrade', this.now(), {
          structuredData: formatted.structuredData,
          thinkingSteps: thinkingStepsFor(text, infoTools, 'info'),
        })
      }
      return this.previewWrite(storeId, conversation, text, write, access, listener)
    }
    // INTENT C — instructional / how-to questions get grounded step-by-step
    // guidance with one-click navigation CTAs, unless the same question also
    // asks for growth strategy (handled by the growth plan path below).
    if (!detectGrowthIntent(text)) {
      const instructionalTopic = detectInstructionalIntent(text)
      // Capability discovery ("What can you do?") gets the store-specific,
      // plan-aware capability list instead of the generic guide.
      if (instructionalTopic === 'generic') {
        emit(listener, 'thinking', { step: 'Preparing capability overview...' })
        const shop = this.shopFor ? await this.shopFor(storeId) : null
        const answer = formatCapabilityAnswer({ plan, actionsEnabled: access.actionsEnabled, shop })
        return message('assistant', answer.content, 'structured_data', this.now(), {
          structuredData: answer.structuredData,
          thinkingSteps: ['Understanding your request...', 'Preparing capability overview...'],
        })
      }
      if (instructionalTopic) {
        emit(listener, 'thinking', { step: 'Preparing guidance...' })
        const answer = formatInstructionalAnswer(instructionalTopic, { plan, actionsEnabled: access.actionsEnabled })
        return message('assistant', answer.content, 'structured_data', this.now(), {
          structuredData: answer.structuredData,
          thinkingSteps: ['Understanding your request...', 'Preparing guidance...'],
        })
      }
    }
    const preferences = await this.repository.getPreferences(storeId)
    const memoryEnabled = conversationMemoryAvailable(preferences.conversationMemoryEnabled, plan, conversation, this.now())
    let infoTools = await this.resolveInfoTools(storeId, conversation, text, access, memoryEnabled)
    infoTools = ambientToolsWhenUnmapped(text, infoTools)
    const outcomes = await this.runTools(storeId, infoTools, listener)
    emit(listener, 'thinking', { step: 'Preparing response...' })
    const formatted = detectGrowthIntent(text)
      ? formatGrowthAnswer(outcomes, access.actionsEnabled)
      : formatToolAnswer(text, outcomes)
    // Named-entity ground truth: emails/customers/products/orders/codes named
    // in prose must exist in the tool results (zero-hallucination contract).
    const allowedEntities = outcomes.flatMap((outcome) => (outcome.ok ? collectEntities(outcome.data) : []))

    // Strict format constraints ("answer only yes or no", "short summary",
    // "bullet points") and Hindi/Hinglish queries get LLM-formatted prose from
    // the grounded outcomes instead of the deterministic template tables.
    const constraints = parseFormatConstraints(text)
    const needsProse = hasStrictFormatConstraints(constraints) || constraints.language !== null
    if (needsProse && this.proseFormatter) {
      const prose = await this.formatConstrainedProse(storeId, plan, text, outcomes, formatted.numbers, constraints, allowedEntities)
      if (prose !== null) {
        return message('assistant', prose, formatted.structuredData ? 'structured_data' : 'text', this.now(), {
          structuredData: formatted.structuredData,
          thinkingSteps: thinkingStepsFor(text, infoTools, 'info'),
        })
      }
    }

    const styled = applyResponseStyle(formatted.content, preferences.defaultResponseStyle, outcomes)
    const grounded = groundCommandText(styled, formatted.numbers, allowedEntities)
    return message('assistant', grounded, formatted.structuredData ? 'structured_data' : 'text', this.now(), {
      structuredData: formatted.structuredData,
      thinkingSteps: thinkingStepsFor(text, infoTools, 'info'),
    })
  }

  /**
   * Asks the wired LLM to format the final prose for constrained or
   * Hindi/Hinglish requests. Output is grounded against the tool-outcome
   * numbers; any hallucinated figure or failed call falls back to null so the
   * deterministic template answer is used instead.
   */
  private async formatConstrainedProse(storeId: StoreId, plan: PlanTier, text: string, outcomes: readonly ToolOutcome[], allowedNumbers: readonly number[], constraints: AiCommandFormatConstraints, allowedEntities: readonly string[] = []): Promise<string | null> {
    if (!this.proseFormatter) return null
    try {
      const shop = this.shopFor ? await this.shopFor(storeId) : null
      const system = buildConstrainedFormatPrompt(constraints, { plan, shop })
      const user = `Merchant command (verbatim): ${text}\n\nGrounded tool results (JSON, the only allowed source of facts):\n${serializeToolOutcomes(outcomes)}`
      const prose = await this.proseFormatter({ system, user })
      const trimmed = typeof prose === 'string' ? prose.trim() : ''
      if (!trimmed) return null
      const grounded = groundCommandText(trimmed, allowedNumbers, allowedEntities)
      if (grounded.startsWith('I could not safely present')) return null
      return grounded
    } catch {
      return null
    }
  }

  private async resolveInfoTools(storeId: StoreId, conversation: AiCommandConversation, text: string, access: AiCommandAccess, memoryEnabled: boolean): Promise<readonly ToolCall[]> {
    const plan = access.plan
    const resolvedText = memoryEnabled ? resolveReferences(text, conversation) : text
    const parsed = parseInfoTools(resolvedText)
    if (!this.generate) return parsed
    try {
      const shop = this.shopFor ? await this.shopFor(storeId) : null
      const generated = await this.generate({
        system: buildSystemPrompt({ storeId, shop, plan, actionsEnabled: access.actionsEnabled }),
        user: text,
        tools: AI_COMMAND_TOOL_DEFINITIONS.filter((tool) => !tool.commanderOnly),
      })
      const domain = queryDomain(resolvedText)
      const calls = generated.toolCalls.filter((call) => {
        if (isWriteTool(call.name)) return false
        // Once an entity domain is explicit, reject planner calls from every
        // other domain. This prevents order/customer noise from being appended
        // to automation answers (and vice versa).
        return domain === null || toolDomain(call.name) === domain
      })
      return calls.length > 0 ? calls : parsed
    } catch {
      return parsed
    }
  }

  private async previewWrite(storeId: StoreId, conversation: AiCommandConversation, text: string, tool: AiCommandWriteTool, access: AiCommandAccess, listener?: ChatListener): Promise<AiCommandMessage> {
    const plan = access.plan
    emit(listener, 'thinking', { step: 'Preparing action preview...' })
    const preferences = await this.repository.getPreferences(storeId)
    const memoryEnabled = conversationMemoryAvailable(preferences.conversationMemoryEnabled, plan, conversation, this.now())
    const params = await this.previewParams(storeId, conversation, text, tool, memoryEnabled)
    const validationError = validateActionPreview(tool, params, this.now())
    if (validationError) return message('assistant', validationError, 'error', this.now())
    const type = toolToActionType(tool)
    // Preflight scope check: verify the live session token permissions BEFORE
    // rendering the preview so a missing scope (e.g. `write_discounts`)
    // becomes a clear re-authorize/re-install prompt instead of an approval
    // that can only fail at execution time.
    if (this.actions.preflight) {
      emit(listener, 'thinking', { step: 'Checking permissions...' })
      try {
        const check = await this.actions.preflight(storeId, type)
        if (!check.ok) {
          const scope = check.missingScope ? ` Missing permission: ${check.missingScope}.` : ''
          const copy = check.reason?.trim() || `${SHOPIFY_PERMISSION_MESSAGE}${scope}`
          return message('assistant', copy, 'error', this.now(), {
            structuredData: {
              type: 'action_blocked',
              data: {
                actionType: type,
                missingScope: check.missingScope ?? null,
                reason: copy,
                message: copy,
                reauthorizeUrl: check.reauthorizeUrl ?? null,
              },
              actions: [],
            },
            thinkingSteps: thinkingStepsFor(text, [{ name: tool, params }], 'preview'),
          })
        }
      } catch { /* a failed preflight probe must never block a preview the runtime can still attempt */ }
    }
    const nowIso = new Date(this.now()).toISOString()
    const action = await this.repository.createAction({
      id: randomUUID(),
      storeId,
      conversationId: conversation.id,
      actionType: type,
      actionParams: params,
      actionPreview: { summary: actionPreviewCopy(type, params), params, approval_required: true },
      merchantApproved: false,
      approvedAt: null,
      executionStatus: 'PENDING',
      executionResult: null,
      errorDetails: null,
      rollbackAvailable: false,
      rollbackDeadline: null,
      rolledBackAt: null,
      createdAt: nowIso,
      completedAt: null,
    })
    emit(listener, 'thinking', { step: 'Waiting for your approval...' })
    return message('assistant', `${actionPreviewCopy(type, params)}\n\nReview the preview, then Approve, Edit, or Cancel. Nothing has been executed.`, 'action_preview', this.now(), {
      action: { id: action.id, type, status: 'PENDING', params, preview: action.actionPreview, rollbackAvailable: false },
      structuredData: { type: 'action_preview', data: action.actionPreview, actions: ['approve', 'edit', 'cancel'] },
      thinkingSteps: thinkingStepsFor(text, [{ name: tool, params }], 'preview'),
    })
  }

  private async previewParams(storeId: StoreId, conversation: AiCommandConversation, text: string, tool: AiCommandWriteTool, memoryEnabled: boolean): Promise<Record<string, unknown>> {
    if (tool === 'send_email') {
      const usesReference = /\b(them|those|these|that list)\b/i.test(text)
      const rememberedIds = memoryEnabled && usesReference ? rememberedEntityIds(conversation, 'customer_list') : []
      const customers = rememberedIds.length === 0 && !usesReference ? await this.tools.run(storeId, { name: 'search_customers', params: { query: text, limit: 10 } }) : null
      const items = customers?.ok && isRecord(customers.data) ? arrayOfRecords(customers.data.items ?? customers.data.customers) : []
      const ids = rememberedIds.length > 0 ? rememberedIds : items.map((item) => String(item.id ?? '')).filter(Boolean)
      return {
        recipient_ids: ids,
        recipients: items.map((item) => ({ id: item.id, name: item.displayName ?? item.name ?? null, email: item.email ?? null })),
        subject: /subject[:\s]+([^.\n]+)/i.exec(text)?.[1]?.trim() ?? 'A note from your store',
        body: 'Hi {first_name}, we prepared this draft from your live customer list. Nothing has been sent.',
      }
    }
    if (tool === 'tag_customers') {
      const usesReference = /\b(them|those|these|that list)\b/i.test(text)
      const rememberedIds = memoryEnabled && usesReference ? rememberedEntityIds(conversation, 'customer_list') : []
      const customers = rememberedIds.length === 0 && !usesReference ? await this.tools.run(storeId, { name: 'search_customers', params: { query: text, limit: 10 } }) : null
      const items = customers?.ok && isRecord(customers.data) ? arrayOfRecords(customers.data.items ?? customers.data.customers) : []
      const tag = /\bas\s+([a-z0-9_-]+)/i.exec(text)?.[1] ?? /\btag\s+([a-z0-9_-]+)\s+customers?/i.exec(text)?.[1] ?? 'ai-command'
      return { customer_ids: rememberedIds.length > 0 ? rememberedIds : items.map((item) => String(item.id ?? '')).filter(Boolean), tags: [tag], action: /remove|untag/i.test(text) ? 'remove' : 'add' }
    }
    if (tool === 'create_discount') {
      const value = Number(/(\d{1,2})\s*%/.exec(text)?.[1] ?? 10)
      const uses = Number(/(\d{1,4})\s*(uses|use)/i.exec(text)?.[1] ?? 100)
      const days = Number(/(\d+)\s*day/i.exec(text)?.[1] ?? 3)
      const named = /discount\s+(?:called|named)\s+["']?([^"'\n]+?)["']?(?:\s+with|\s+for|$)/i.exec(text)?.[1]?.trim()
      return { title: named || 'AI Command discount', type: 'percentage', value, usage_limit: uses, expires_at: new Date(this.now() + Math.max(1, days) * 86_400_000).toISOString() }
    }
    if (tool === 'approve_recommendation') {
      const recs = await this.tools.run(storeId, { name: 'get_recommendations', params: { status: 'PENDING', limit: 1 } })
      const items = recs.ok && isRecord(recs.data) ? arrayOfRecords(recs.data.items ?? recs.data.recommendations) : []
      const first = items[0] ?? {}
      return { recommendation_id: String(first.id ?? ''), expected_version: Number(first.version ?? 0) }
    }
    if (tool === 'create_workflow') {
      const lower = text.toLowerCase()
      const templateId = /low[ -]?stock|inventory (?:is )?low/.test(lower) ? 'low-stock-alert'
        : /welcome/.test(lower) ? 'welcome-customer'
          : /abandon(?:ed)? (?:cart|checkout)/.test(lower) ? 'abandoned-checkout'
            : /high[ -]?value order/.test(lower) ? 'high-value-order'
              : /back[ -]?in[ -]?stock/.test(lower) ? 'back-in-stock'
                : ''
      const requestedName = /(?:called|named)\s+["']?([^"'\n]+?)["']?(?:\s+that|\s+when|$)/i.exec(text)?.[1]?.trim()
      const defaultNames: Readonly<Record<string, string>> = { 'low-stock-alert': 'Low-Stock Alert', 'welcome-customer': 'Welcome New Customer', 'abandoned-checkout': 'Abandoned Checkout Recovery', 'high-value-order': 'High-Value Order Alert', 'back-in-stock': 'Back-in-Stock Notification' }
      return { template_id: templateId, name: requestedName || defaultNames[templateId] || 'AI-created automation', activate: false }
    }
    if (tool === 'trigger_workflow' || tool === 'pause_workflow' || tool === 'resume_workflow') {
      return this.resolveWorkflowParams(storeId, conversation, text)
    }
    if (tool === 'send_notification') return { title: 'AI Command', message: text.slice(0, 240), priority: 'NORMAL' }
    if (tool === 'generate_report') return { report_type: /daily|weekly|monthly|quarterly/i.exec(text)?.[0]?.toUpperCase() ?? 'WEEKLY', date_range: '7d' }
    return {}
  }

  /** Resolve a workflow id (and friendly name) for trigger/pause/resume actions. */
  private async resolveWorkflowParams(storeId: StoreId, conversation: AiCommandConversation, text: string): Promise<Record<string, unknown>> {
    const explicitId = /workflow[:\s]+([a-z0-9-]+)/i.exec(text)?.[1]
    const listed = await this.tools.run(storeId, { name: 'list_workflows', params: {} })
    const workflows = listed.ok && isRecord(listed.data) ? arrayOfRecords(listed.data.items ?? listed.data.workflows) : []
    const bulkPause = /\b(?:all|every|automations|workflows)\b/i.test(text) && /\b(?:pause|stop|disable|deactivate|cancel|turn off|shut down)\b/i.test(text)
    if (bulkPause) {
      const active = workflows.filter((workflow) => {
        const status = String(workflow.status ?? workflow.state ?? '').toUpperCase()
        return status === 'ACTIVE' || status === 'ENABLED' || workflow.active === true || workflow.enabled === true
      })
      return {
        workflow_ids: active.map((workflow) => String(workflow.id ?? '')).filter(Boolean),
        workflow_names: active.map((workflow) => String(workflow.name ?? '')).filter(Boolean),
        active_count: active.length,
      }
    }
    if (explicitId) {
      const match = workflows.find((workflow) => String(workflow.id ?? '') === explicitId)
      return { workflow_id: explicitId, workflow_name: match && typeof match.name === 'string' ? match.name : null }
    }
    // Match by name substring: strip action verbs and pick the first workflow whose name appears in the text.
    const haystack = text.toLowerCase()
    const byName = workflows.find((workflow) => typeof workflow.name === 'string' && workflow.name.trim().length > 0 && haystack.includes(workflow.name.toLowerCase()))
    if (byName && typeof byName.id === 'string') return { workflow_id: byName.id, workflow_name: typeof byName.name === 'string' ? byName.name : null }
    const lastId = conversation.context.lastWorkflowId
    if (typeof lastId === 'string' && lastId) {
      const match = workflows.find((workflow) => String(workflow.id ?? '') === lastId)
      return { workflow_id: lastId, workflow_name: match && typeof match.name === 'string' ? match.name : null }
    }
    return { workflow_id: '', workflow_name: null }
  }

  private async confirmLatest(storeId: StoreId, conversation: AiCommandConversation, access: AiCommandAccess, listener?: ChatListener): Promise<AiCommandMessage> {
    const pendingId = latestPendingId(conversation)
    if (!pendingId) return message('assistant', 'There is no pending action to approve.', 'text', this.now())
    if (access.mode === 'blocked') {
      return message('assistant', renderBillingBlockedResponse(access.billingState ?? 'TRIAL_EXPIRED'), 'upgrade', this.now())
    }
    if (!access.actionsEnabled) {
      return message('assistant', 'Action execution requires Commander plan. Upgrade Plan to continue.', 'upgrade', this.now())
    }
    const executed = await this.executeApproved(storeId, await this.action(storeId, pendingId), access.plan, listener)
    return resultMessage(executed, this.now())
  }

  private async cancelLatest(storeId: StoreId, conversation: AiCommandConversation): Promise<AiCommandMessage> {
    const pendingId = latestPendingId(conversation)
    if (!pendingId) return message('assistant', 'There is no pending action to cancel.', 'text', this.now())
    const cancelled = await this.cancelPending(storeId, pendingId)
    return resultMessage(cancelled, this.now())
  }

  private async undoLatest(storeId: StoreId, conversation: AiCommandConversation, _plan: PlanTier): Promise<AiCommandMessage> {
    const last = [...conversation.messages].reverse().find((item) => item.action?.id && (item.contentType === 'action_result' || item.contentType === 'action_preview'))
    const actionId = last?.action?.id ?? (typeof conversation.context.lastActionId === 'string' ? conversation.context.lastActionId : null)
    if (!actionId) return message('assistant', 'There is no completed action to undo.', 'text', this.now())
    try {
      const rolled = await this.rollback(storeId, actionId)
      return resultMessage(rolled, this.now(), rolled.executionStatus === 'ROLLED_BACK' ? 'The action was rolled back.' : undefined)
    } catch (error: unknown) {
      return message('assistant', error instanceof Error ? error.message : 'Undo is not available for this action.', 'error', this.now())
    }
  }

  private async cancelPending(storeId: StoreId, actionId: string): Promise<AiCommandActionRecord> {
    const current = await this.action(storeId, actionId)
    const cancelled = await this.repository.cancelPendingAction(storeId, actionId, new Date(this.now()).toISOString())
    if (!cancelled) throw new AppError('CONFLICT', 'Only pending actions can be cancelled', 409, { status: current.executionStatus })
    return cancelled
  }

  private async rollback(storeId: StoreId, actionId: string): Promise<AiCommandActionRecord> {
    const access = await this.accessFor(storeId)
    const action = await this.action(storeId, actionId)
    if (!action.rollbackAvailable || !action.rollbackDeadline) throw new AppError('VALIDATION_ERROR', 'This action cannot be undone', 400)
    if (Date.parse(action.rollbackDeadline) < this.now()) throw new AppError('VALIDATION_ERROR', 'The 30-second undo window has expired', 400)
    if (access.mode === 'blocked') throw new AppError('PAYMENT_REQUIRED', renderBillingBlockedResponse(access.billingState ?? 'TRIAL_EXPIRED'), 402, { reason: 'BILLING_INACTIVE', state: access.billingState })
    if (!access.actionsEnabled) throw new AppError('PAYMENT_REQUIRED', 'Upgrade Plan to use undo.', 402, { reason: 'UPGRADE_REQUIRED' })
    const claimed = await this.repository.claimRollback(storeId, actionId, new Date(this.now()).toISOString())
    if (!claimed) throw new AppError('CONFLICT', 'This action is already being undone or its undo window expired', 409)
    const rolled = this.actions.rollback ? await this.actions.rollback(storeId, claimed) : { status: 'FAILED' as const, result: { message: 'Rollback is not connected.' }, rollbackAvailable: false }
    return this.repository.saveAction({
      ...claimed,
      executionStatus: rolled.status === 'SUCCESS' ? 'ROLLED_BACK' : 'FAILED',
      executionResult: rolled.result,
      errorDetails: rolled.errorDetails ?? null,
      rollbackAvailable: false,
      rolledBackAt: rolled.status === 'SUCCESS' ? new Date(this.now()).toISOString() : null,
      completedAt: new Date(this.now()).toISOString(),
    })
  }

  private async recordDirectActionResult(action: AiCommandActionRecord, prefix?: string): Promise<void> {
    if (!action.conversationId) return
    const conversation = await this.repository.getConversation(action.storeId, action.conversationId)
    if (!conversation) return
    const alreadyRecorded = conversation.messages.some((item) => item.contentType === 'action_result' && item.action?.id === action.id && item.action.status === action.executionStatus)
    if (alreadyRecorded) return
    const result = resultMessage(action, this.now(), prefix)
    await this.repository.saveConversation({
      ...conversation,
      messages: [...settleActionMessages(conversation.messages, result), result],
      context: { ...conversation.context, lastActionId: action.id },
      updatedAt: result.timestamp,
      lastMessageAt: result.timestamp,
    })
  }

  private async executeApproved(storeId: StoreId, action: AiCommandActionRecord, plan: PlanTier, listener?: ChatListener): Promise<AiCommandActionRecord> {
    emit(listener, 'thinking', { step: 'Executing action...' })
    const approvedAt = new Date(this.now()).toISOString()
    const executing = await this.repository.claimAction(storeId, action.id, approvedAt)
    if (!executing) {
      const current = await this.repository.getAction(storeId, action.id)
      throw new AppError('CONFLICT', 'This action is no longer pending approval', 409, { status: current?.executionStatus ?? 'NOT_FOUND' })
    }
    let executed: ActionExecutionResult
    try {
      executed = await this.actions.execute(storeId, executing)
    } catch (error: unknown) {
      executed = { status: 'FAILED', result: { message: error instanceof Error ? error.message : 'The action failed.' }, errorDetails: { message: error instanceof Error ? error.message : 'The action failed.' }, rollbackAvailable: false }
    }
    emit(listener, 'thinking', { step: 'Verifying results...' })
    const undoSeconds = limitsForPlan(plan).undoSeconds
    const rollbackAvailable = executed.rollbackAvailable && REVERSIBLE_ACTIONS.has(action.actionType) && undoSeconds > 0 && executed.status !== 'FAILED'
    return this.repository.saveAction({
      ...executing,
      executionStatus: executed.status,
      executionResult: executed.result,
      errorDetails: executed.errorDetails ?? null,
      rollbackAvailable,
      rollbackDeadline: rollbackAvailable ? new Date(this.now() + undoSeconds * 1000).toISOString() : null,
      completedAt: new Date(this.now()).toISOString(),
    })
  }

  private async runTools(storeId: StoreId, calls: readonly ToolCall[], listener?: ChatListener): Promise<readonly ToolOutcome[]> {
    const outcomes: ToolOutcome[] = []
    for (const call of calls) {
      emit(listener, 'thinking', { step: `Querying ${moduleLabel(call.name)}...` })
      try {
        outcomes.push(await this.tools.run(storeId, call))
      } catch (error: unknown) {
        outcomes.push({ ok: false, name: call.name, error: error instanceof Error ? error.message : 'Tool failed', source: call.name })
      }
    }
    return outcomes
  }

  private async loadOrCreateConversation(storeId: StoreId, conversationId: string | undefined, text: string): Promise<AiCommandConversation> {
    if (conversationId) {
      const existing = await this.repository.getConversation(storeId, conversationId)
      if (!existing) throw new AppError('NOT_FOUND', 'Conversation not found', 404)
      if (existing.status === 'ARCHIVED') throw new AppError('CONFLICT', 'Archived conversations are read-only. Start a new chat to continue.', 409)
      return existing
    }
    const nowIso = new Date(this.now()).toISOString()
    return this.repository.createConversation({
      id: randomUUID(),
      storeId,
      title: titleFromQuery(text),
      messages: [],
      context: {},
      status: 'ACTIVE',
      createdAt: nowIso,
      updatedAt: nowIso,
      lastMessageAt: nowIso,
    })
  }
}

function resultMessage(action: AiCommandActionRecord, now: number, prefix?: string): AiCommandMessage {
  const summary = summarizeActionResult(action)
  // Permission failures render as an `action_blocked` block so the web client
  // can attach the "Re-authorize ProfitPilot" CTA.
  const permission = action.executionStatus === 'SUCCESS' ? null : shopifyPermissionFailure(action)
  const thinkingSteps = action.executionStatus === 'CANCELLED'
    ? ['Cancelling pending action...']
    : action.executionStatus === 'ROLLED_BACK'
      ? ['Reversing action...', 'Verifying rollback...']
      : ['Executing action...', 'Verifying results...']
  return message('assistant', prefix ? `${prefix}\n\n${summary}` : summary, 'action_result', now, {
    action: {
      id: action.id,
      type: action.actionType,
      status: action.executionStatus,
      params: action.actionParams,
      result: action.executionResult,
      executedAt: action.completedAt,
      rollbackAvailable: action.rollbackAvailable,
      rollbackDeadline: action.rollbackDeadline,
    },
    structuredData: permission
      ? {
          type: 'action_blocked',
          data: {
            actionType: action.actionType,
            missingScope: permission.missingScope,
            reason: permission.message,
            message: permission.message,
            reauthorizeUrl: permission.reauthorizeUrl,
            result: action.executionResult,
          },
          actions: [],
        }
      : { type: 'action_result', data: action.executionResult, actions: action.rollbackAvailable ? ['undo'] : [] },
    thinkingSteps,
  })
}

export function summarizeActionResult(action: AiCommandActionRecord): string {
  if (action.executionStatus === 'CANCELLED') return 'Cancelled. Nothing was executed.'
  if (action.executionStatus === 'ROLLED_BACK') return 'The action was rolled back. The reverse change was applied.'
  // A missing Shopify permission replaces the whole summary (including any
  // partial-success counts) with one actionable re-authorize sentence.
  const permission = shopifyPermissionFailure(action)
  if (permission && action.executionStatus !== 'SUCCESS') {
    const partial = action.executionStatus === 'PARTIAL_SUCCESS' && action.actionType === 'TAG_CUSTOMER' && isRecord(action.executionResult)
      ? ` ${numberish(action.executionResult.updated) ?? 0} customer(s) were updated before Shopify refused the rest.`
      : ''
    return `${permission.message}${partial}`
  }
  if (action.executionStatus === 'FAILED') {
    return `The action failed. ${actionFailureDetails(action)}`
  }
  if (action.actionType === 'SEND_EMAIL' && isRecord(action.executionResult)) {
    const sent = numberish(action.executionResult.sent) ?? 0
    const failed = numberish(action.executionResult.failed) ?? 0
    const total = sent + failed
    const reasons = Array.isArray(action.executionResult.reasons) ? action.executionResult.reasons.map(String) : []
    if (failed > 0) return `Sent ${sent} of ${total} emails. ${failed} failed${reasons.length ? `: ${reasons.join('; ')}` : ''}.`
    return `Sent ${sent} of ${total} emails.`
  }
  if (action.actionType === 'TAG_CUSTOMER' && isRecord(action.executionResult)) {
    const updated = numberish(action.executionResult.updated) ?? 0
    const failed = numberish(action.executionResult.failed) ?? 0
    if (failed > 0) return `Tagged ${updated} customer${updated === 1 ? '' : 's'}. ${failed} failed.`
    return `Tagged ${updated} customer${updated === 1 ? '' : 's'}.`
  }
  if (action.actionType === 'CREATE_DISCOUNT' && isRecord(action.executionResult)) {
    const code = typeof action.executionResult.code === 'string' ? action.executionResult.code : null
    if (!code) return 'Shopify did not return a discount code. The discount was not created.'
    return `Discount created. Code: ${code}.`
  }
  if (action.actionType === 'CREATE_WORKFLOW' && isRecord(action.executionResult)) {
    const name = typeof action.executionResult.name === 'string' ? action.executionResult.name : 'Automation'
    return `${name} was created as a draft and now appears in Automation. Review it there before activation.`
  }
  if (action.actionType === 'PAUSE_WORKFLOW') return 'Workflow paused.'
  if (action.actionType === 'RESUME_WORKFLOW') return 'Workflow resumed.'
  if (isRecord(action.executionResult) && typeof action.executionResult.message === 'string') return action.executionResult.message
  if (action.executionStatus === 'PARTIAL_SUCCESS') return 'The action completed with partial success. See the details below.'
  if (action.executionStatus === 'SUCCESS') return 'The action completed and the backend confirmed the result.'
  return 'The action finished. Review the backend result below.'
}

const GENERIC_FAILURE = 'The backend did not confirm success.'

/**
 * Extracts the most specific failure reason available for a FAILED action.
 * Shopify / GraphQL `userErrors`, HTTP scope errors, and per-recipient reasons
 * are surfaced verbatim so the merchant sees the real cause; the generic
 * fallback is used only when no specific detail was recorded anywhere.
 */
export function actionFailureDetails(action: AiCommandActionRecord): string {
  const errorDetails = isRecord(action.errorDetails) ? action.errorDetails : null
  const result = isRecord(action.executionResult) ? action.executionResult : null

  // Authorization failures are always rewritten: raw Shopify strings like
  // "9414254756053 — Shopify API request failed with 403" leak internal ids and
  // give the merchant nothing to act on.
  const permission = shopifyPermissionFailure(action)
  if (permission) return permission.message

  // errorDetails is the authoritative structured channel when present.
  if (errorDetails) {
    const message = typeof errorDetails.message === 'string' ? errorDetails.message.trim() : ''
    if (message) return message
    const reasons = Array.isArray(errorDetails.reasons) ? errorDetails.reasons.map(String).filter(Boolean) : []
    if (reasons.length) return reasons.join('; ')
    const reason = typeof errorDetails.reason === 'string' ? errorDetails.reason.trim() : ''
    if (reason) return reason
  }

  // Fall back to whatever the execution result recorded.
  if (result) {
    const message = typeof result.message === 'string' ? result.message.trim() : ''
    if (message) return message
    const reasons = Array.isArray(result.reasons) ? result.reasons.map(String).filter(Boolean) : []
    if (reasons.length) return reasons.join('; ')
  }

  return GENERIC_FAILURE
}

function latestPendingId(conversation: AiCommandConversation): string | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const item = conversation.messages[index]
    if (item?.action?.id && item.action.status === 'PENDING') return item.action.id
  }
  return null
}

export function conversationMemoryAvailable(enabled: boolean, plan: PlanTier, conversation: AiCommandConversation, now = Date.now()): boolean {
  if (!enabled) return false
  const hours = limitsForPlan(plan).memoryHours
  // Zero means the current open session; a supplied conversation id is the
  // session boundary for Trial/Start. Commander is unlimited.
  if (hours === 0 || hours === null) return true
  const last = Date.parse(conversation.lastMessageAt)
  return Number.isFinite(last) && last >= now - hours * 3_600_000
}

function resolveReferences(text: string, conversation: AiCommandConversation): string {
  if (!/\b(them|those|these|that list)\b/i.test(text)) return text
  const hint = conversation.context.lastEntities
  if (typeof hint === 'string' && hint) return `${text} (referring to ${hint})`
  if (!isRecord(hint) || typeof hint.type !== 'string') return text
  const ids = stringArray(hint.ids).slice(0, 20)
  return `${text} (referring to ${hint.type}${ids.length > 0 ? ` ids ${ids.join(', ')}` : ''})`
}

function extractEntityHint(message: AiCommandMessage): Readonly<{ type: string; ids: readonly string[] }> | null {
  if (!message.structuredData?.type) return null
  const rows = arrayOfRecords(message.structuredData.data)
  const ids = rows.map((item) => String(item.id ?? item.customerId ?? item.productId ?? item.variantId ?? '')).filter(Boolean).slice(0, 50)
  return { type: message.structuredData.type, ids }
}

function rememberedEntityIds(conversation: AiCommandConversation, type: string): readonly string[] {
  const hint = conversation.context.lastEntities
  if (!isRecord(hint) || hint.type !== type) return []
  return stringArray(hint.ids)
}

function settleActionMessages(messages: readonly AiCommandMessage[], result: AiCommandMessage): readonly AiCommandMessage[] {
  const resultAction = result.action
  if (result.contentType !== 'action_result' || !resultAction?.id) return messages
  return messages.map((item): AiCommandMessage => {
    const current = item.action
    if (!current || current.id !== resultAction.id) return item
    return {
      ...item,
      action: {
        ...current,
        status: resultAction.status,
        result: resultAction.result,
        executedAt: resultAction.executedAt ?? null,
        rollbackAvailable: resultAction.rollbackAvailable ?? false,
        rollbackDeadline: resultAction.rollbackDeadline ?? null,
      },
    }
  })
}

function successfulActionResult(result: AiCommandMessage): boolean {
  return result.contentType === 'action_result' && (result.action?.status === 'SUCCESS' || result.action?.status === 'PARTIAL_SUCCESS')
}

function mustPersistActionState(result: AiCommandMessage): boolean {
  return Boolean(result.action?.id && (result.contentType === 'action_preview' || result.contentType === 'action_result'))
}

function message(role: AiCommandMessageRole, content: string, contentType: AiCommandContentType, now: number, extras: Partial<Pick<AiCommandMessage, 'structuredData' | 'action' | 'thinkingSteps'>> = {}): AiCommandMessage {
  return {
    id: randomUUID(),
    role,
    content,
    contentType,
    structuredData: extras.structuredData ?? null,
    action: extras.action ?? null,
    thinkingSteps: extras.thinkingSteps ?? null,
    timestamp: new Date(now).toISOString(),
  }
}

function pickPreference(patch: Partial<AiCommandPreferences>): Partial<{ defaultResponseStyle: AiCommandResponseStyle; quickCommandsEnabled: boolean; autoSuggestionsEnabled: boolean; thinkingAnimationEnabled: boolean; conversationMemoryEnabled: boolean; notificationOnActionComplete: boolean }> {
  const next: { defaultResponseStyle?: AiCommandResponseStyle; quickCommandsEnabled?: boolean; autoSuggestionsEnabled?: boolean; thinkingAnimationEnabled?: boolean; conversationMemoryEnabled?: boolean; notificationOnActionComplete?: boolean } = {}
  if (patch.defaultResponseStyle === 'CONCISE' || patch.defaultResponseStyle === 'DETAILED' || patch.defaultResponseStyle === 'TECHNICAL') next.defaultResponseStyle = patch.defaultResponseStyle
  if (typeof patch.quickCommandsEnabled === 'boolean') next.quickCommandsEnabled = patch.quickCommandsEnabled
  if (typeof patch.autoSuggestionsEnabled === 'boolean') next.autoSuggestionsEnabled = patch.autoSuggestionsEnabled
  if (typeof patch.thinkingAnimationEnabled === 'boolean') next.thinkingAnimationEnabled = patch.thinkingAnimationEnabled
  if (typeof patch.conversationMemoryEnabled === 'boolean') next.conversationMemoryEnabled = patch.conversationMemoryEnabled
  if (typeof patch.notificationOnActionComplete === 'boolean') next.notificationOnActionComplete = patch.notificationOnActionComplete
  return next
}

function emit(listener: ChatListener | undefined, event: 'thinking' | 'message' | 'usage' | 'done', payload: unknown): void {
  try { listener?.(event, payload) } catch { /* a disconnected stream must not roll back completed business work */ }
}

function humanAction(tool: AiCommandWriteTool): string {
  if (tool === 'send_email') return 'sending email'
  if (tool === 'tag_customers') return 'tagging customers'
  if (tool === 'create_discount') return 'creating a discount'
  if (tool === 'approve_recommendation') return 'approving a recommendation'
  if (tool === 'create_workflow') return 'creating an automation'
  if (tool === 'trigger_workflow') return 'triggering a workflow'
  if (tool === 'pause_workflow') return 'pausing a workflow'
  if (tool === 'resume_workflow') return 'resuming a workflow'
  if (tool === 'send_notification') return 'sending a notification'
  return 'generating a report'
}

function workflowName(params: Readonly<Record<string, unknown>>): string {
  const name = typeof params.workflow_name === 'string' && params.workflow_name.trim() ? params.workflow_name.trim() : ''
  const id = typeof params.workflow_id === 'string' && params.workflow_id.trim() ? params.workflow_id.trim() : ''
  if (name) return `“${name}”`
  if (id) return id
  return '(no workflow selected)'
}

function formatMoney(value: number, currency: string | null = null): string {
  if (!currency) return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} (currency unavailable)`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

/** One-line, data-grounded insight for analytics summaries/trends (INTENT B).
 * Returns null when there is no period-over-period change to comment on. */
function analyticsTakeaway(change: number | null, trend: 'up' | 'down' | 'flat' | null): string | null {
  if (change === null || trend === null) return null
  if (trend === 'up') return `revenue is trending up ${change}% versus the previous period — momentum you can compound by pushing your best sellers and repeating what is already working.`
  if (trend === 'down') return `revenue is down ${Math.abs(change)}% versus the previous period — prioritise retention and your proven best sellers before scaling acquisition spend.`
  return 'revenue is flat versus the previous period — a single targeted offer is the lowest-risk way to test for lift before committing to bigger changes.'
}

function normalizeNumber(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function numberish(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

function throwIfCommandAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AppError('CONFLICT', 'Command cancelled', 409)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayOfRecords(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === 'string' ? item : typeof item === 'number' ? String(item) : '').filter(Boolean)
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
