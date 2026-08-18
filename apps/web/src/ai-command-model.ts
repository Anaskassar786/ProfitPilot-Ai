export type AiCommandPlan = 'trial' | 'start' | 'growth' | 'commander'
export type AiCommandContentType = 'text' | 'structured_data' | 'action_preview' | 'action_result' | 'error' | 'upgrade' | 'blocked' | 'offtopic'
export type AiCommandRole = 'user' | 'assistant' | 'system'

export type AiCommandStructuredData = Readonly<{
  type: string
  data: unknown
  actions?: readonly string[]
  source?: string
}>

export type AiCommandMessageAction = Readonly<{
  id?: string
  type: string
  status: string
  params: Readonly<Record<string, unknown>>
  preview?: unknown
  result?: unknown
  executedAt?: string | null
  rollbackAvailable?: boolean
  rollbackDeadline?: string | null
}>

export type AiCommandMessage = Readonly<{
  id: string
  role: AiCommandRole
  content: string
  contentType: AiCommandContentType
  structuredData: AiCommandStructuredData | null
  action: AiCommandMessageAction | null
  thinkingSteps: readonly string[] | null
  timestamp: string
}>

export type AiCommandConversation = Readonly<{
  id: string
  storeId: string
  title: string
  messages: readonly AiCommandMessage[]
  context: Readonly<Record<string, unknown>>
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
  lastMessageAt: string
}>

export type AiCommandUsage = Readonly<{
  storeId: string
  usageDate: string
  commandsUsed: number
  actionsExecuted: number
  tokensUsed: number
  costMicroDollars: number
  limit: number | null
  remaining: number | null
  actionsEnabled: boolean
}>

export type AiCommandSavedCommand = Readonly<{
  id: string
  storeId: string
  name: string
  commandText: string
  category: string
  useCount: number
  lastUsedAt: string | null
  createdAt: string
}>

export type AiCommandPreferences = Readonly<{
  storeId: string
  defaultResponseStyle: 'CONCISE' | 'DETAILED' | 'TECHNICAL'
  quickCommandsEnabled: boolean
  autoSuggestionsEnabled: boolean
  thinkingAnimationEnabled: boolean
  conversationMemoryEnabled: boolean
  notificationOnActionComplete: boolean
}>

export type AiCommandQuickCommand = Readonly<{
  id: string
  label: string
  command: string
  kind: 'info' | 'action'
}>

export type AiCommandQuickCategory = 'analytics' | 'customers' | 'products' | 'growth' | 'actions'

export function quickCommandCategory(command: AiCommandQuickCommand): AiCommandQuickCategory {
  if (command.kind === 'action') return 'actions'
  const text = `${command.label} ${command.command}`.toLowerCase()
  if (/(customer|vip|inactive|segment|churn|subscriber)/.test(text)) return 'customers'
  if (/(product|stock|inventory|catalog|sku)/.test(text)) return 'products'
  if (/(grow|increase|recommend|discount|idea)/.test(text)) return 'growth'
  return 'analytics'
}

export type AiCommandActionRecord = Readonly<{
  id: string
  actionType: string
  executionStatus: string
  executionResult: unknown
  rollbackAvailable: boolean
  rollbackDeadline: string | null
}>

export type ChatResult = Readonly<{
  conversation: AiCommandConversation
  message: AiCommandMessage
  usage: AiCommandUsage
  thinkingSteps: readonly string[]
}>

export type ConversationGroupId = 'today' | 'yesterday' | 'week' | 'older'

export function groupConversations(conversations: readonly AiCommandConversation[], now = Date.now()): Readonly<Record<ConversationGroupId, readonly AiCommandConversation[]>> {
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  const yesterday = today - 86_400_000
  const week = today - 6 * 86_400_000
  const groups: Record<ConversationGroupId, AiCommandConversation[]> = { today: [], yesterday: [], week: [], older: [] }
  for (const conversation of conversations) {
    const at = Date.parse(conversation.lastMessageAt)
    if (!Number.isFinite(at) || at >= today) groups.today.push(conversation)
    else if (at >= yesterday) groups.yesterday.push(conversation)
    else if (at >= week) groups.week.push(conversation)
    else groups.older.push(conversation)
  }
  return groups
}

export function usageTone(usage: AiCommandUsage | null): 'green' | 'amber' | 'red' | 'unlimited' {
  if (!usage || usage.limit === null) return 'unlimited'
  const ratio = usage.commandsUsed / Math.max(1, usage.limit)
  if (ratio >= 1) return 'red'
  if (ratio >= 0.8) return 'amber'
  return 'green'
}

export function usageLabel(usage: AiCommandUsage | null, plan: AiCommandPlan): string {
  if (plan === 'commander' || usage?.limit === null) return 'Unlimited ∞'
  if (!usage) return '0 commands today'
  return `${usage.commandsUsed}/${usage.limit} commands today`
}

export function usagePercent(usage: AiCommandUsage | null): number {
  if (!usage || usage.limit === null || usage.limit === 0) return 0
  return Math.min(100, Math.round((usage.commandsUsed / usage.limit) * 100))
}

export function planLabel(plan: AiCommandPlan): string {
  if (plan === 'commander') return 'Commander'
  if (plan === 'growth') return 'Growth'
  if (plan === 'start') return 'Start'
  return 'Trial'
}

export function formatTimestamp(value: string): string {
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return ''
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(at))
}

export function remainingUndoSeconds(deadline: string | null | undefined, now = Date.now()): number {
  if (!deadline) return 0
  const at = Date.parse(deadline)
  if (!Number.isFinite(at)) return 0
  return Math.max(0, Math.ceil((at - now) / 1000))
}

export function tableRows(data: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(data)) return []
  return data.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number' && Number.isFinite(value)) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(cellText).join(', ')
  return String(value)
}

export function parseSseBlocks(buffer: string): Readonly<{ frames: readonly string[]; rest: string }> {
  const frames: string[] = []
  let rest = buffer
  let boundary = rest.indexOf('\n\n')
  while (boundary >= 0) {
    frames.push(rest.slice(0, boundary))
    rest = rest.slice(boundary + 2)
    boundary = rest.indexOf('\n\n')
  }
  return { frames, rest }
}

export function parseSseFrame(frame: string): Readonly<{ event: string; data: unknown }> | null {
  let event = 'message'
  let dataLine = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) dataLine = line.slice(5).trim()
  }
  if (!dataLine) return null
  try { return { event, data: JSON.parse(dataLine) } } catch { return { event, data: dataLine } }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function searchConversations(conversations: readonly AiCommandConversation[], query: string): readonly AiCommandConversation[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return conversations
  return conversations.filter((item) => item.title.toLowerCase().includes(needle) || item.messages.some((message) => message.content.toLowerCase().includes(needle)))
}

export function conversationIdFromHash(hash: string): string | null {
  const match = /^#\/ai-command(?:\/([0-9a-fA-F-]{8,}))?/.exec(hash)
  return match?.[1] ?? null
}

export function isAiCommandHash(hash: string): boolean {
  return hash.startsWith('#/ai-command')
}

export function isCampaignsHash(hash: string): boolean {
  return hash.startsWith('#/campaigns') || hash === '#campaigns'
}

export const GROUP_LABELS: Readonly<Record<ConversationGroupId, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  older: 'Older',
}
