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

export type AiCommandQuickCategory = 'analytics' | 'customers' | 'products' | 'growth' | 'actions'

/** Category tone key used for icon tiles and hover accents. */
export type AiCommandTone = 'purple' | 'blue' | 'green' | 'orange' | 'amber'

export const CATEGORY_TONE: Readonly<Record<AiCommandQuickCategory, AiCommandTone>> = {
  analytics: 'purple',
  customers: 'blue',
  products: 'green',
  growth: 'orange',
  actions: 'amber',
}

/** Human label used in grouped quick commands and template cards. */
export const CATEGORY_LABEL: Readonly<Record<AiCommandQuickCategory, string>> = {
  analytics: 'Analytics',
  customers: 'Customers',
  products: 'Products',
  growth: 'Growth',
  actions: 'Actions',
}

export function quickCommandTone(command: AiCommandQuickCommand): AiCommandTone {
  return CATEGORY_TONE[quickCommandCategory(command)] ?? 'purple'
}

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

/** Whole hours until the daily command limit resets (UTC midnight). */
export function hoursUntilDailyReset(now = new Date()): number {
  const next = new Date(now)
  next.setUTCHours(24, 0, 0, 0)
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 3_600_000))
}

export type DailyResetCountdown = Readonly<{ hours: number; minutes: number; seconds: number }>

/** Precise h:mm:ss until the daily command limit resets (UTC midnight). */
export function dailyResetCountdown(now = new Date()): DailyResetCountdown {
  const next = new Date(now)
  next.setUTCHours(24, 0, 0, 0)
  const totalSeconds = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return { hours, minutes, seconds }
}

/** The last question the merchant asked in a conversation. */
export function lastUserQuestion(conversation: AiCommandConversation): string {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (message?.role === 'user') return message.content
  }
  return conversation.title
}

/** The first assistant answer snippet, or '' when the AI has not replied yet. */
export function firstAssistantAnswer(conversation: AiCommandConversation, maxLength = 110): string {
  const message = conversation.messages.find((item) => item.role === 'assistant')
  const content = message?.content ?? ''
  if (!content) return ''
  const singleLine = content.replace(/\s+/g, ' ').trim()
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}…` : singleLine
}

/** Short preview copy for a recent-command row (question + answer). */
export function conversationPreview(conversation: AiCommandConversation): Readonly<{ question: string; answer: string }> {
  return { question: lastUserQuestion(conversation), answer: firstAssistantAnswer(conversation) }
}

export type UsageHistoryBar = Readonly<{ label: string; value: number; isToday: boolean }>

/**
 * Builds the real "commands per day" series for the last `days` days from
 * usage history. Missing days are shown as 0 (no commands ran — not invented
 * data). Labels use the local weekday initial.
 */
export function usageHistoryBars(history: readonly AiCommandUsage[], days = 7, now = new Date()): readonly UsageHistoryBar[] {
  const byDay = new Map<string, AiCommandUsage>()
  for (const row of history) byDay.set(row.usageDate, row)
  const bars: UsageHistoryBar[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - offset)
    const key = day.toISOString().slice(0, 10)
    const row = byDay.get(key)
    bars.push({ label: new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(day), value: row?.commandsUsed ?? 0, isToday: offset === 0 })
  }
  return bars
}

/** Real command-surface stats for the value panel. Estimates are labelled. */
export function valueStats(usage: AiCommandUsage | null, usageHistory: readonly AiCommandUsage[], conversations: number, saved: number): Readonly<{
  commandsToday: number
  commandsWeek: number
  actions: number
  conversations: number
  saved: number
  timeSavedMinutes: number
  timeSavedLabel: string
}> {
  const commandsToday = usage?.commandsUsed ?? 0
  const commandsWeek = usageHistory.reduce((total, row) => total + (row.commandsUsed ?? 0), 0)
  const actions = usage?.actionsExecuted ?? 0
  const timeSavedMinutes = commandsWeek * 3
  return {
    commandsToday,
    commandsWeek,
    actions,
    conversations,
    saved,
    timeSavedMinutes,
    timeSavedLabel: timeSavedMinutes >= 60 ? `${(timeSavedMinutes / 60).toFixed(1)}h` : `${timeSavedMinutes}m`,
  }
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
