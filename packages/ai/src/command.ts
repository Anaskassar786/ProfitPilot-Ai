import { randomUUID } from 'node:crypto'
import { AppError } from '@profitpilot/types'
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

export const AI_COMMAND_PLAN_LIMITS: Readonly<Record<PlanTier, AiCommandPlanLimits>> = {
  trial: { commandsPerDay: 10, actionsEnabled: false, memoryHours: 0, savedCommands: 3, historyDays: 7, exportConversations: false, undoSeconds: 0 },
  start: { commandsPerDay: 50, actionsEnabled: false, memoryHours: 0, savedCommands: 10, historyDays: 30, exportConversations: false, undoSeconds: 0 },
  growth: { commandsPerDay: 200, actionsEnabled: false, memoryHours: 24, savedCommands: 25, historyDays: 90, exportConversations: true, undoSeconds: 0 },
  commander: { commandsPerDay: null, actionsEnabled: true, memoryHours: null, savedCommands: null, historyDays: null, exportConversations: true, undoSeconds: 30 },
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

export interface AiCommandActionRuntime {
  execute(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult>
  rollback?(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult>
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
  listSaved(storeId: StoreId): Promise<readonly AiCommandSavedCommand[]>
  saveCommand(command: AiCommandSavedCommand): Promise<AiCommandSavedCommand>
  deleteSaved(storeId: StoreId, id: string): Promise<boolean>
  getSaved(storeId: StoreId, id: string): Promise<AiCommandSavedCommand | null>
  incrementUsage(storeId: StoreId, usageDate: string, delta: Readonly<{ commands?: number; actions?: number; tokens?: number; costMicroDollars?: number }>): Promise<AiCommandUsage>
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
  trigger_workflow: /\b(trigger|run|start)\b.*\b(workflow|automation)\b/i,
  pause_workflow: /\b(pause|stop|disable|turn off)\b.*\b(workflow|automation)\b/i,
  resume_workflow: /\b(resume|enable|turn on|unpause)\b.*\b(workflow|automation)\b/i,
  send_notification: /\b(notify|notification|alert me|send a notification)\b/i,
  generate_report: /\b(generate|create|build)\b.*\breport\b/i,
}

const REVERSIBLE_ACTIONS = new Set<AiCommandActionType>(['TAG_CUSTOMER', 'CREATE_DISCOUNT', 'SEND_NOTIFICATION'])

export function limitsForPlan(plan: PlanTier): AiCommandPlanLimits {
  return AI_COMMAND_PLAN_LIMITS[plan]
}

export function toolToActionType(name: AiCommandToolName): AiCommandActionType {
  if (name === 'send_email') return 'SEND_EMAIL'
  if (name === 'tag_customers') return 'TAG_CUSTOMER'
  if (name === 'create_discount') return 'CREATE_DISCOUNT'
  if (name === 'generate_report') return 'GENERATE_REPORT'
  if (name === 'approve_recommendation') return 'APPROVE_RECOMMENDATION'
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

export function parseInfoTools(query: string): readonly ToolCall[] {
  const normalized = query.toLowerCase()
  const calls: ToolCall[] = []
  const push = (name: AiCommandToolName, params: Readonly<Record<string, unknown>> = {}) => {
    if (!calls.some((call) => call.name === name)) calls.push({ name, params })
  }
  if (/\b(customers?|vips?|churn|inactive)\b/.test(normalized)) push('search_customers', { query, limit: 20 })
  if (/\b(products?|catalog|skus?|best sellers?|top products?)\b/.test(normalized)) push('search_products', { query, limit: 20 })
  if (/\b(orders?|fulfil|fulfill|cancel)\b/.test(normalized)) push('search_orders', { query, limit: 20 })
  if (/\b(revenue|sales|aov|analytics|this month|today)\b/.test(normalized)) push('get_analytics', { metric: 'summary', date_range: inferRange(normalized) })
  if (/\brecommend/.test(normalized)) push('get_recommendations', { status: 'PENDING', limit: 10 })
  if (/\b(stock|inventory|stockout|low stock)\b/.test(normalized)) push('get_inventory_status', { filter: /low|out/.test(normalized) ? 'low' : 'all' })
  if (/\b(health|how is my store|store status)\b/.test(normalized)) push('get_store_health', {})
  if (/\b(automations?|workflows?)\b/.test(normalized)) push('list_workflows', {})
  if (calls.length === 0) {
    if (/\bhelp me grow|grow sales|increase sales\b/.test(normalized)) {
      push('get_analytics', { metric: 'summary', date_range: '30d' })
      push('get_recommendations', { status: 'PENDING', limit: 5 })
      push('get_store_health', {})
    } else {
      push('get_store_health', {})
      push('get_analytics', { metric: 'summary', date_range: inferRange(normalized) })
    }
  }
  return calls
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

// A query mentioning any of these is clearly about the merchant's store and is
// always in scope, even if it also contains an off-topic keyword (for example
// "help me code a Shopify theme" is about Shopify, not general coding).
const STORE_SCOPE_SIGNALS = /\b(shopify|shop|store|revenue|sales?|orders?|customers?|products?|inventory|stock|aov|analytics|discount|coupon|promo|emails?|mail|tags?|recommend|report|marketing|campaign|workflow|automation|sync|traffic|conversion|cart|checkout|bestsellers?|refund|fulfil|churn|vips?|segments?|subscriber|catalog|skus?)\b/i

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

/**
 * Detects off-topic questions so AI Command can politely refuse anything that
 * is not about the merchant's Shopify store. Returns the human-readable topic
 * that was asked about, or `null` when the query is in scope (store-related)
 * or ambiguous enough that we should attempt to answer from store data.
 */
export function detectOffTopic(query: string): string | null {
  const normalized = query.trim()
  if (!normalized) return null
  if (STORE_SCOPE_SIGNALS.test(normalized)) return null
  for (const entry of OFF_TOPIC_PATTERNS) {
    if (entry.pattern.test(normalized)) return entry.topic
  }
  return null
}

export function renderOffTopicResponse(topic: string): string {
  return [
    `I'm here specifically to help with your Shopify store. I can't help with ${topic}, but I'd love to help you with:`,
    '',
    '• Store performance analysis',
    '• Customer insights',
    '• Product recommendations',
    '• Sales trends',
    '• Inventory management',
    '• And much more about your store',
    '',
    'What would you like to know about your store?',
  ].join('\n')
}

export const STORE_SCOPE_GUIDANCE = [
  'You are a specialized assistant for Shopify merchants. You answer ONLY questions about the merchant\'s Shopify store.',
  'Allowed topics: store revenue, orders, customers, product management, inventory, customer insights, marketing, business analytics, store performance, recommendations, and actions inside their store.',
  'Forbidden topics — politely refuse and redirect back to store help: general knowledge (weather, news), general coding, personal advice, other businesses or platforms, politics, health/medical advice, legal advice, and questions about yourself or other AI systems.',
  'When the user asks an off-topic question, say you can only help with their Shopify store and list the store areas you can help with.',
] as const

export function renderUpgradeResponse(action: string, findings: string): string {
  return [
    findings,
    '',
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
    const reason = failures[0]?.error ?? 'The requested store data is not available.'
    return { content: `I'm not sure I can answer that from live store data yet. ${reason}`, structuredData: null, numbers: [] }
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
  lines.push(`Source: ${successes.map((outcome) => outcome.source).join(', ')}.`)
  if (!query.trim()) lines.unshift('Here is what I found from your store.')
  return { content: lines.join('\n\n'), structuredData, numbers }
}

function renderOutcome(outcome: ToolSuccess, query: string): Readonly<{ text: string; structured: AiCommandStructuredData | null }> {
  const data = isRecord(outcome.data) ? outcome.data : { value: outcome.data }
  if (outcome.name === 'get_analytics') {
    const revenue = numberish(data.revenue)
    const previous = numberish(data.previousRevenue)
    const orders = numberish(data.orders)
    const aov = numberish(data.aov)
    const change = revenue !== null && previous !== null && previous !== 0 ? Math.round(((revenue - previous) / previous) * 100) : null
    const parts = [
      revenue === null ? 'Revenue for the requested period is not available.' : `Your store's revenue for this period is ${formatMoney(revenue)}${change === null || previous === null ? '' : `, which is ${change}% ${change >= 0 ? 'higher' : 'lower'} than the previous period (${formatMoney(previous)})`}.`,
      orders === null ? null : `Orders: ${orders}.`,
      aov === null ? null : `Average order value: ${formatMoney(aov)}.`,
    ].filter(Boolean)
    return { text: parts.join(' '), structured: { type: 'analytics', data, source: outcome.source, actions: ['export'] } }
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
      structured: { type: 'customer_list', data: items, source: outcome.source, actions: ['email', 'tag', 'export'] },
    }
  }
  if (outcome.name === 'search_products') {
    const items = arrayOfRecords(data.items ?? data.products)
    const count = numberish(data.count) ?? items.length
    return {
      text: count === 0 ? 'No products matched that query in the synced catalog.' : `I found ${count} product${count === 1 ? '' : 's'} from your synced catalog.`,
      structured: { type: 'product_list', data: items, source: outcome.source, actions: ['export'] },
    }
  }
  if (outcome.name === 'search_orders') {
    const items = arrayOfRecords(data.items ?? data.orders)
    const count = numberish(data.count) ?? items.length
    return {
      text: count === 0 ? 'No orders matched that query in the synced order table.' : `I found ${count} order${count === 1 ? '' : 's'} from your synced Shopify orders.`,
      structured: { type: 'order_list', data: items, source: outcome.source, actions: ['export'] },
    }
  }
  if (outcome.name === 'get_inventory_status') {
    const low = numberish(data.lowStockCount)
    const out = numberish(data.outOfStockCount)
    const items = arrayOfRecords(data.items)
    return {
      text: low === null && out === null
        ? 'Inventory status is not available yet. Sync inventory to load real stock levels.'
        : `Inventory: ${low ?? 0} low-stock and ${out ?? 0} out-of-stock tracked variants.`,
      structured: { type: 'inventory_list', data: items, source: outcome.source, actions: ['export'] },
    }
  }
  if (outcome.name === 'get_recommendations') {
    const items = arrayOfRecords(data.items ?? data.recommendations)
    const count = numberish(data.count) ?? items.length
    return {
      text: count === 0 ? 'There are no recommendations matching that filter right now.' : `There are ${count} recommendation${count === 1 ? '' : 's'} from the recommendations ledger.`,
      structured: { type: 'recommendation_list', data: items, source: outcome.source, actions: ['approve'] },
    }
  }
  if (outcome.name === 'get_store_health') {
    const score = numberish(data.score)
    const label = typeof data.label === 'string' ? data.label : 'unknown'
    return {
      text: score === null ? 'Store health cannot be scored until analytics or inventory rows exist.' : `Store health score is ${score}/100 (${label}).`,
      structured: { type: 'store_health', data, source: outcome.source },
    }
  }
  if (outcome.name === 'list_workflows') {
    const items = arrayOfRecords(data.items ?? data.workflows)
    const count = numberish(data.count) ?? items.length
    return {
      text: count === 0 ? 'You have no automations yet. Head to the Automation page to create your first workflow.' : `You have ${count} automation${count === 1 ? '' : 's'} — here is their current status from the automation ledger.`,
      structured: { type: 'workflow_list', data: items, source: outcome.source, actions: ['trigger', 'pause', 'resume'] },
    }
  }
  return { text: 'I retrieved live store data for that request.', structured: { type: outcome.name, data, source: outcome.source } }
}

export function collectNumbers(value: unknown, into: number[] = []): readonly number[] {
  if (typeof value === 'number' && Number.isFinite(value)) into.push(value)
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, into)
  else if (isRecord(value)) for (const item of Object.values(value)) collectNumbers(item, into)
  return into
}

export function groundCommandText(text: string, allowedNumbers: readonly number[]): string {
  const allowed = new Set(allowedNumbers.map(normalizeNumber))
  allowed.add(normalizeNumber(0))
  allowed.add(normalizeNumber(100))
  const extras = extractNumbers(text).filter((value) => !allowed.has(normalizeNumber(value)))
  if (extras.length === 0) return text.trim()
  return `${text.trim()}\n\nI removed unsupported figures from this reply because they were not present in the tool results.`
}

export function buildSystemPrompt(input: Readonly<{ storeId: StoreId; shop?: string | null; plan: PlanTier; actionsEnabled: boolean }>): string {
  const limits = limitsForPlan(input.plan)
  const tools = AI_COMMAND_TOOL_DEFINITIONS.filter((tool) => input.actionsEnabled || !tool.commanderOnly)
  return [
    'You are AI Command, ProfitPilot\'s merchant command center.',
    ...STORE_SCOPE_GUIDANCE,
    'You never invent numbers, statistics, or action outcomes.',
    'Every claim must come from a tool result or from the merchant\'s own words.',
    'If a tool returns no data, say so. If you are uncertain, say "I\'m not sure".',
    'Never claim an email was sent, a tag applied, or a discount created unless the backend confirmed it.',
    `The merchant is on the ${input.plan} plan. Daily command limit: ${limits.commandsPerDay ?? 'unlimited'}. Action execution: ${input.actionsEnabled ? 'allowed after explicit merchant approval' : 'not available — suggest Upgrade Plan'}.`,
    input.shop ? `Store domain: ${input.shop}.` : 'Store domain is not provided.',
    `Available tools:\n${tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`,
    'Write actions always require a preview and merchant approval. Never auto-execute.',
    'Blocked: delete data, refunds, bulk price edits, bulk inventory edits, billing access, store configuration.',
    'When refusing a blocked action, name the page where the merchant can do it manually.',
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
  if (type === 'TRIGGER_WORKFLOW') return `Action: Trigger workflow ${workflowName(params)}.`
  if (type === 'PAUSE_WORKFLOW') return `Action: Pause workflow ${workflowName(params)}.`
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

export function validateDiscountParams(params: Readonly<Record<string, unknown>>): Readonly<{ ok: true; value: number; usageLimit: number; expiresAt: string; title: string }> | Readonly<{ ok: false; error: string }> {
  const value = Number(params.value)
  const usageLimit = Number(params.usage_limit ?? params.usageLimit)
  const title = typeof params.title === 'string' && params.title.trim() ? params.title.trim() : 'AI Command discount'
  const expiresAt = typeof params.expires_at === 'string' ? params.expires_at : typeof params.expiresAt === 'string' ? params.expiresAt : ''
  if (!Number.isFinite(value) || value <= 0 || value > 50) return { ok: false, error: 'Discount value must be between 1 and 50 percent.' }
  if (!Number.isInteger(usageLimit) || usageLimit < 1 || usageLimit > 1000) return { ok: false, error: 'Usage limit must be an integer between 1 and 1000.' }
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) return { ok: false, error: 'A valid expiry date at least 1 day from now is required.' }
  if (Date.parse(expiresAt) < Date.now() + 86_400_000 - 60_000) return { ok: false, error: 'Discount expiry must be at least 1 day from now.' }
  return { ok: true, value, usageLimit, expiresAt, title }
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
  private readonly now: () => number
  private readonly enabled: boolean
  private readonly shopFor: ((storeId: StoreId) => Promise<string | null>) | null

  public constructor(input: Readonly<{
    repository: AiCommandRepository
    tools: AiCommandToolRuntime
    actions?: AiCommandActionRuntime
    planFor: (storeId: StoreId) => Promise<PlanTier>
    generate?: (input: AiCommandGenerateInput) => Promise<AiCommandGenerateResult>
    shopFor?: (storeId: StoreId) => Promise<string | null>
    now?: () => number
    enabled?: boolean
  }>) {
    this.repository = input.repository
    this.tools = input.tools
    this.actions = input.actions ?? new InMemoryCommandActions()
    this.planFor = input.planFor
    this.generate = input.generate ?? null
    this.shopFor = input.shopFor ?? null
    this.now = input.now ?? (() => Date.now())
    this.enabled = input.enabled !== false
  }

  public async usage(storeId: StoreId): Promise<AiCommandUsage> {
    const plan = await this.planFor(storeId)
    return applyUsageLimits(await this.repository.getUsage(storeId, usageDateKey(this.now())), plan)
  }

  public async usageHistory(storeId: StoreId, days = 30): Promise<readonly AiCommandUsage[]> {
    return this.repository.listUsage(storeId, Math.min(90, Math.max(1, days)))
  }

  public async conversations(storeId: StoreId, limit = 20): Promise<readonly AiCommandConversation[]> {
    const plan = await this.planFor(storeId)
    const all = await this.repository.listConversations(storeId, limit)
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

  public async savedCommands(storeId: StoreId): Promise<readonly AiCommandSavedCommand[]> {
    return this.repository.listSaved(storeId)
  }

  public async saveCommand(storeId: StoreId, input: Readonly<{ name: string; commandText: string; category?: string }>): Promise<AiCommandSavedCommand> {
    const plan = await this.planFor(storeId)
    const limit = limitsForPlan(plan).savedCommands
    const existing = await this.repository.listSaved(storeId)
    if (limit !== null && existing.length >= limit) throw new AppError('PAYMENT_REQUIRED', 'Upgrade Plan to save more commands', 402, { reason: 'UPGRADE_REQUIRED', feature: 'ai_command_saved' })
    const now = new Date(this.now()).toISOString()
    return this.repository.saveCommand({
      id: randomUUID(),
      storeId,
      name: input.name.trim().slice(0, 80) || 'Saved command',
      commandText: input.commandText.trim().slice(0, 500),
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
    const plan = await this.planFor(storeId)
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
    return contextualQuickCommands(plan, snapshot)
  }

  public async chat(input: Readonly<{ storeId: StoreId; text: string; conversationId?: string; signal?: AbortSignal }>, listener?: ChatListener): Promise<AiCommandChatResult> {
    throwIfCommandAborted(input.signal)
    if (!this.enabled) throw new AppError('FORBIDDEN', 'AI Command is not enabled', 403)
    const text = input.text.trim()
    if (!text) throw new AppError('VALIDATION_ERROR', 'Command cannot be empty', 400)
    if (text.length > 2_000) throw new AppError('VALIDATION_ERROR', 'Command must be 2,000 characters or fewer', 400)
    const plan = await this.planFor(input.storeId)
    const limits = limitsForPlan(plan)
    const date = usageDateKey(this.now())
    const usage = applyUsageLimits(await this.repository.getUsage(input.storeId, date), plan)
    if (limits.commandsPerDay !== null && usage.commandsUsed >= limits.commandsPerDay) {
      throw new AppError('PAYMENT_REQUIRED', 'You have reached today\'s command limit. Upgrade Plan for more.', 402, { reason: 'UPGRADE_REQUIRED', feature: 'ai_command_daily', used: usage.commandsUsed, limit: limits.commandsPerDay })
    }

    const conversation = await this.loadOrCreateConversation(input.storeId, input.conversationId, text)
    const userMessage = message('user', text, 'text', this.now())
    const confirm = parseConfirmIntent(text)
    emit(listener, 'thinking', { step: 'Understanding your request...' })

    let resultMessage: AiCommandMessage
    if (confirm === 'confirm') resultMessage = await this.confirmLatest(input.storeId, conversation, plan, listener)
    else if (confirm === 'cancel') resultMessage = await this.cancelLatest(input.storeId, conversation)
    else if (confirm === 'undo') resultMessage = await this.undoLatest(input.storeId, conversation, plan)
    else resultMessage = await this.answer(input.storeId, conversation, text, plan, listener)

    // A disconnected streaming client means the merchant pressed Cancel. Do
    // not persist the conversation or consume quota after that point.
    throwIfCommandAborted(input.signal)
    const nextMessages = [...conversation.messages, userMessage, resultMessage]
    const nextConversation = await this.repository.saveConversation({
      ...conversation,
      messages: nextMessages,
      context: { lastActionId: resultMessage.action?.id ?? conversation.context.lastActionId ?? null, lastEntities: extractEntityHint(resultMessage) },
      updatedAt: resultMessage.timestamp,
      lastMessageAt: resultMessage.timestamp,
    })
    const nextUsage = await this.repository.incrementUsage(input.storeId, date, {
      commands: 1,
      actions: resultMessage.contentType === 'action_result' ? 1 : 0,
    })
    emit(listener, 'message', resultMessage)
    emit(listener, 'usage', nextUsage)
    emit(listener, 'done', { ok: true })
    return { conversation: nextConversation, message: resultMessage, usage: nextUsage, thinkingSteps: resultMessage.thinkingSteps ?? [] }
  }

  public async approveAction(storeId: StoreId, actionId: string, listener?: ChatListener): Promise<AiCommandActionRecord> {
    const plan = await this.planFor(storeId)
    if (!limitsForPlan(plan).actionsEnabled) throw new AppError('PAYMENT_REQUIRED', 'Action execution requires Commander plan. Upgrade Plan to continue.', 402, { reason: 'UPGRADE_REQUIRED', feature: 'ai_command_actions' })
    const action = await this.action(storeId, actionId)
    if (action.executionStatus !== 'PENDING') throw new AppError('CONFLICT', 'This action is no longer pending approval', 409, { status: action.executionStatus })
    return this.executeApproved(storeId, action, plan, listener)
  }

  public async cancelAction(storeId: StoreId, actionId: string): Promise<AiCommandActionRecord> {
    const action = await this.action(storeId, actionId)
    if (action.executionStatus !== 'PENDING') throw new AppError('CONFLICT', 'Only pending actions can be cancelled', 409)
    return this.repository.saveAction({ ...action, executionStatus: 'CANCELLED', completedAt: new Date(this.now()).toISOString() })
  }

  public async rollbackAction(storeId: StoreId, actionId: string): Promise<AiCommandActionRecord> {
    const plan = await this.planFor(storeId)
    const action = await this.action(storeId, actionId)
    if (!action.rollbackAvailable || !action.rollbackDeadline) throw new AppError('VALIDATION_ERROR', 'This action cannot be undone', 400)
    if (Date.parse(action.rollbackDeadline) < this.now()) throw new AppError('VALIDATION_ERROR', 'The 30-second undo window has expired', 400)
    if (!limitsForPlan(plan).actionsEnabled) throw new AppError('PAYMENT_REQUIRED', 'Upgrade Plan to use undo.', 402, { reason: 'UPGRADE_REQUIRED' })
    const rolled = this.actions.rollback ? await this.actions.rollback(storeId, action) : { status: 'FAILED' as const, result: { message: 'Rollback is not connected.' }, rollbackAvailable: false }
    return this.repository.saveAction({
      ...action,
      executionStatus: rolled.status === 'SUCCESS' ? 'ROLLED_BACK' : 'FAILED',
      executionResult: rolled.result,
      rollbackAvailable: false,
      rolledBackAt: rolled.status === 'SUCCESS' ? new Date(this.now()).toISOString() : null,
      completedAt: new Date(this.now()).toISOString(),
    })
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

  private async answer(storeId: StoreId, conversation: AiCommandConversation, text: string, plan: PlanTier, listener?: ChatListener): Promise<AiCommandMessage> {
    const blocked = detectBlockedAction(text)
    if (blocked) {
      return message('assistant', renderBlockedResponse(blocked), 'blocked', this.now(), { thinkingSteps: ['Understanding your request...'] })
    }
    const offTopic = detectOffTopic(text)
    if (offTopic) {
      return message('assistant', renderOffTopicResponse(offTopic), 'offtopic', this.now(), { thinkingSteps: ['Understanding your request...'] })
    }
    const write = detectWriteTool(text)
    if (write) {
      emit(listener, 'thinking', { step: 'Checking permissions...' })
      if (!limitsForPlan(plan).actionsEnabled) {
        const infoTools = parseInfoTools(text)
        const outcomes = await this.runTools(storeId, infoTools, listener)
        const formatted = formatToolAnswer(text, outcomes)
        return message('assistant', renderUpgradeResponse(humanAction(write), formatted.content), 'upgrade', this.now(), {
          structuredData: formatted.structuredData,
          thinkingSteps: thinkingStepsFor(text, infoTools, 'info'),
        })
      }
      return this.previewWrite(storeId, conversation, text, write, listener)
    }
    const infoTools = await this.resolveInfoTools(storeId, conversation, text, plan)
    const outcomes = await this.runTools(storeId, infoTools, listener)
    emit(listener, 'thinking', { step: 'Preparing response...' })
    const formatted = formatToolAnswer(text, outcomes)
    const grounded = groundCommandText(formatted.content, formatted.numbers)
    return message('assistant', grounded, formatted.structuredData ? 'structured_data' : 'text', this.now(), {
      structuredData: formatted.structuredData,
      thinkingSteps: thinkingStepsFor(text, infoTools, 'info'),
    })
  }

  private async resolveInfoTools(storeId: StoreId, conversation: AiCommandConversation, text: string, plan: PlanTier): Promise<readonly ToolCall[]> {
    const parsed = parseInfoTools(resolveReferences(text, conversation))
    if (!this.generate) return parsed
    try {
      const shop = this.shopFor ? await this.shopFor(storeId) : null
      const generated = await this.generate({
        system: buildSystemPrompt({ storeId, shop, plan, actionsEnabled: limitsForPlan(plan).actionsEnabled }),
        user: text,
        tools: AI_COMMAND_TOOL_DEFINITIONS.filter((tool) => !tool.commanderOnly),
      })
      const calls = generated.toolCalls.filter((call) => !isWriteTool(call.name))
      return calls.length > 0 ? calls : parsed
    } catch {
      return parsed
    }
  }

  private async previewWrite(storeId: StoreId, conversation: AiCommandConversation, text: string, tool: AiCommandWriteTool, listener?: ChatListener): Promise<AiCommandMessage> {
    emit(listener, 'thinking', { step: 'Preparing action preview...' })
    const params = await this.previewParams(storeId, conversation, text, tool)
    if (tool === 'create_discount') {
      const valid = validateDiscountParams(params)
      if (!valid.ok) return message('assistant', valid.error, 'error', this.now())
    }
    const type = toolToActionType(tool)
    const nowIso = new Date(this.now()).toISOString()
    const action = await this.repository.createAction({
      id: randomUUID(),
      storeId,
      conversationId: conversation.id,
      actionType: type,
      actionParams: params,
      actionPreview: { summary: actionPreviewCopy(type, params), params },
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

  private async previewParams(storeId: StoreId, conversation: AiCommandConversation, text: string, tool: AiCommandWriteTool): Promise<Record<string, unknown>> {
    if (tool === 'send_email') {
      const customers = await this.tools.run(storeId, { name: 'search_customers', params: { query: text, limit: 10 } })
      const items = customers.ok && isRecord(customers.data) ? arrayOfRecords(customers.data.items ?? customers.data.customers) : []
      return {
        recipient_ids: items.map((item) => String(item.id ?? '')).filter(Boolean),
        recipients: items.map((item) => ({ id: item.id, name: item.displayName ?? item.name ?? null, email: item.email ?? null })),
        subject: /subject[:\s]+([^.\n]+)/i.exec(text)?.[1]?.trim() ?? 'A note from your store',
        body: 'Hi {first_name}, we prepared this draft from your live customer list. Nothing has been sent.',
      }
    }
    if (tool === 'tag_customers') {
      const customers = await this.tools.run(storeId, { name: 'search_customers', params: { query: text, limit: 10 } })
      const items = customers.ok && isRecord(customers.data) ? arrayOfRecords(customers.data.items ?? customers.data.customers) : []
      const tag = /tag(?:ged)?(?: as)? ([a-z0-9_-]+)/i.exec(text)?.[1] ?? 'ai-command'
      return { customer_ids: items.map((item) => String(item.id ?? '')).filter(Boolean), tags: [tag], action: /remove|untag/i.test(text) ? 'remove' : 'add' }
    }
    if (tool === 'create_discount') {
      const value = Number(/(\d{1,2})\s*%/.exec(text)?.[1] ?? 10)
      const uses = Number(/(\d{1,4})\s*(uses|use)/i.exec(text)?.[1] ?? 100)
      const days = Number(/(\d+)\s*day/i.exec(text)?.[1] ?? 3)
      return { title: /discount(?: called)? ["']?([^"'\n]+)["']?/i.exec(text)?.[1] ?? 'Weekend discount', type: 'percentage', value, usage_limit: uses, expires_at: new Date(this.now() + Math.max(1, days) * 86_400_000).toISOString() }
    }
    if (tool === 'approve_recommendation') {
      const recs = await this.tools.run(storeId, { name: 'get_recommendations', params: { status: 'PENDING', limit: 1 } })
      const items = recs.ok && isRecord(recs.data) ? arrayOfRecords(recs.data.items ?? recs.data.recommendations) : []
      const first = items[0] ?? {}
      return { recommendation_id: String(first.id ?? ''), expected_version: Number(first.version ?? 0) }
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

  private async confirmLatest(storeId: StoreId, conversation: AiCommandConversation, plan: PlanTier, listener?: ChatListener): Promise<AiCommandMessage> {
    const pendingId = latestPendingId(conversation)
    if (!pendingId) return message('assistant', 'There is no pending action to approve.', 'text', this.now())
    if (!limitsForPlan(plan).actionsEnabled) {
      return message('assistant', 'Action execution requires Commander plan. Upgrade Plan to continue.', 'upgrade', this.now())
    }
    const executed = await this.executeApproved(storeId, await this.action(storeId, pendingId), plan, listener)
    return resultMessage(executed, this.now())
  }

  private async cancelLatest(storeId: StoreId, conversation: AiCommandConversation): Promise<AiCommandMessage> {
    const pendingId = latestPendingId(conversation)
    if (!pendingId) return message('assistant', 'There is no pending action to cancel.', 'text', this.now())
    const cancelled = await this.cancelAction(storeId, pendingId)
    return message('assistant', 'Cancelled. Nothing was executed.', 'action_result', this.now(), {
      action: { id: cancelled.id, type: cancelled.actionType, status: 'CANCELLED', params: cancelled.actionParams, result: { cancelled: true } },
    })
  }

  private async undoLatest(storeId: StoreId, conversation: AiCommandConversation, _plan: PlanTier): Promise<AiCommandMessage> {
    const last = [...conversation.messages].reverse().find((item) => item.action?.id && (item.contentType === 'action_result' || item.contentType === 'action_preview'))
    const actionId = last?.action?.id ?? (typeof conversation.context.lastActionId === 'string' ? conversation.context.lastActionId : null)
    if (!actionId) return message('assistant', 'There is no completed action to undo.', 'text', this.now())
    try {
      const rolled = await this.rollbackAction(storeId, actionId)
      return resultMessage(rolled, this.now(), 'The action was rolled back.')
    } catch (error: unknown) {
      return message('assistant', error instanceof Error ? error.message : 'Undo is not available for this action.', 'error', this.now())
    }
  }

  private async executeApproved(storeId: StoreId, action: AiCommandActionRecord, plan: PlanTier, listener?: ChatListener): Promise<AiCommandActionRecord> {
    emit(listener, 'thinking', { step: 'Executing action...' })
    const executing = await this.repository.saveAction({ ...action, merchantApproved: true, approvedAt: new Date(this.now()).toISOString(), executionStatus: 'EXECUTING' })
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
    structuredData: { type: 'action_result', data: action.executionResult, actions: action.rollbackAvailable ? ['undo'] : [] },
    thinkingSteps: ['Executing action...', 'Verifying results...'],
  })
}

export function summarizeActionResult(action: AiCommandActionRecord): string {
  if (action.executionStatus === 'CANCELLED') return 'Cancelled. Nothing was executed.'
  if (action.executionStatus === 'ROLLED_BACK') return 'The action was rolled back. The reverse change was applied.'
  if (action.executionStatus === 'FAILED') {
    const details = isRecord(action.errorDetails) ? String(action.errorDetails.message ?? action.errorDetails.reason ?? 'The backend did not confirm success.') : 'The backend did not confirm success.'
    return `The action failed. ${details}`
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
  if (action.actionType === 'PAUSE_WORKFLOW') return 'Workflow paused.'
  if (action.actionType === 'RESUME_WORKFLOW') return 'Workflow resumed.'
  if (isRecord(action.executionResult) && typeof action.executionResult.message === 'string') return action.executionResult.message
  if (action.executionStatus === 'PARTIAL_SUCCESS') return 'The action completed with partial success. See the details below.'
  if (action.executionStatus === 'SUCCESS') return 'The action completed and the backend confirmed the result.'
  return 'The action finished. Review the backend result below.'
}

function latestPendingId(conversation: AiCommandConversation): string | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const item = conversation.messages[index]
    if (item?.action?.id && item.action.status === 'PENDING') return item.action.id
  }
  return typeof conversation.context.lastActionId === 'string' ? conversation.context.lastActionId : null
}

function resolveReferences(text: string, conversation: AiCommandConversation): string {
  if (!/\b(them|those|these|that list)\b/i.test(text)) return text
  const hint = conversation.context.lastEntities
  return typeof hint === 'string' && hint ? `${text} (referring to ${hint})` : text
}

function extractEntityHint(message: AiCommandMessage): string | null {
  if (message.structuredData?.type) return message.structuredData.type
  return null
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
  listener?.(event, payload)
}

function humanAction(tool: AiCommandWriteTool): string {
  if (tool === 'send_email') return 'sending email'
  if (tool === 'tag_customers') return 'tagging customers'
  if (tool === 'create_discount') return 'creating a discount'
  if (tool === 'approve_recommendation') return 'approving a recommendation'
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

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function normalizeNumber(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function numberish(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
