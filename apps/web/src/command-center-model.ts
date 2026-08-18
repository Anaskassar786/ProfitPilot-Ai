/**
 * AI Command Center — frontend model.
 *
 * Pure helpers only (no React) so they are unit-testable the same way the
 * orders/inventory/analytics models are. Cards are joined to server data by
 * AgentStatus.id — never by display label.
 */

export type PlanTier = 'trial' | 'start' | 'growth' | 'commander'
export type AgentExecution = 'READY' | 'UNCONFIGURED' | 'RUNNING' | 'PAUSED'

export type AgentOverviewEntry = Readonly<{
  id: string
  label: string
  promptVersion: string
  execution: AgentExecution
  languageOnly: true
  locked: boolean
  requiredPlan: PlanTier
  paused: boolean
  tagline: string
  sampleInsight: string
}>

export type AgentOverview = Readonly<{ plan: PlanTier; unlockedCount: number; totalCount: number; agents: readonly AgentOverviewEntry[] }>

export type CostSummaryView = Readonly<{ storeId: string; day: string; microDollars: number; capMicroDollars: number; remainingMicroDollars: number; calls: number }>
export type CostBreakdownRow = Readonly<{ agent: string; model: string; microDollars: number; calls: number; promptTokens: number; completionTokens: number }>
export type StoreHealthResult = Readonly<{ score: number | null; method: string; components: readonly Readonly<{ key: string; score: number | null; weight: number; reason: string }>[] }>
export type RuleCatalogEntry = Readonly<{ id: string; name: string; agent: string; purpose: string; threshold: string; inputs: readonly string[]; impact: string }>
export type AgentActivityItem = Readonly<{ id: string; agent: string; ruleId: string; title: string; reason: string; impactValue: number; impactLabel: string; currency: string; status: string; explanationStatus: string; confidence: number; confidenceLevel: string; version: number; createdAt: string }>

export type RunAllEvent =
  | Readonly<{ type: 'start'; runnable: readonly string[]; skipped: readonly Readonly<{ agent: string; reason: string }>[] }>
  | Readonly<{ type: 'progress'; agent: string; completed: number; total: number }>
  | Readonly<{ type: 'done'; recommendations: number; deduplicated: number; cacheHits: number }>
  | Readonly<{ type: 'error'; message: string }>

export type RunAllState = Readonly<{
  running: boolean
  runnable: readonly string[]
  skipped: readonly Readonly<{ agent: string; reason: string }>[]
  completed: number
  total: number
  lastAgent: string | null
  result: Readonly<{ recommendations: number; deduplicated: number; cacheHits: number }> | null
  error: string | null
}>

export const IDLE_RUN_STATE: RunAllState = { running: false, runnable: [], skipped: [], completed: 0, total: 0, lastAgent: null, result: null, error: null }

export function reduceRunAll(state: RunAllState, event: RunAllEvent): RunAllState {
  if (event.type === 'start') return { ...IDLE_RUN_STATE, running: true, runnable: event.runnable, skipped: event.skipped }
  if (event.type === 'progress') return { ...state, completed: event.completed, total: event.total, lastAgent: event.agent }
  if (event.type === 'done') return { ...state, running: false, result: { recommendations: event.recommendations, deduplicated: event.deduplicated, cacheHits: event.cacheHits } }
  return { ...state, running: false, error: event.message }
}

export const PLAN_LABELS: Readonly<Record<PlanTier, string>> = { trial: 'Trial', start: 'Start', growth: 'Growth', commander: 'Commander' }
export const PLAN_PRICES: Readonly<Record<PlanTier, string | null>> = { trial: null, start: '$49/mo', growth: '$149/mo', commander: '$349/mo' }

/** Locked agents grouped by the plan that unlocks them, in upgrade order. */
export function groupLockedByPlan(agents: readonly AgentOverviewEntry[]): readonly Readonly<{ plan: PlanTier; agents: readonly AgentOverviewEntry[] }>[] {
  const order: readonly PlanTier[] = ['start', 'growth', 'commander']
  return order
    .map((plan) => ({ plan, agents: agents.filter((agent) => agent.locked && agent.requiredPlan === plan) }))
    .filter((group) => group.agents.length > 0)
}

export function unlockedAgents(agents: readonly AgentOverviewEntry[]): readonly AgentOverviewEntry[] {
  return agents.filter((agent) => !agent.locked)
}

export function agentStatusTone(agent: AgentOverviewEntry): 'active' | 'idle' | 'paused' | 'unconfigured' {
  if (agent.paused || agent.execution === 'PAUSED') return 'paused'
  if (agent.execution === 'READY') return 'active'
  if (agent.execution === 'RUNNING') return 'active'
  return 'unconfigured'
}

export function agentStatusLabel(agent: AgentOverviewEntry): string {
  if (agent.locked) return 'Locked'
  if (agent.paused) return 'Paused'
  if (agent.execution === 'READY') return 'Active'
  if (agent.execution === 'RUNNING') return 'Running'
  if (agent.execution === 'UNCONFIGURED') return 'Awaiting AI keys'
  return 'Paused'
}

export function formatBudget(summary: CostSummaryView | null): Readonly<{ spent: string; cap: string; percent: number }> {
  if (!summary) return { spent: '—', cap: '—', percent: 0 }
  const spent = summary.microDollars / 1_000_000
  const cap = summary.capMicroDollars / 1_000_000
  return {
    spent: `$${spent.toFixed(spent > 0 && spent < 0.01 ? 4 : 2)}`,
    cap: `$${cap.toFixed(2)}`,
    percent: cap <= 0 ? 0 : Math.min(100, Math.round((spent / cap) * 100)),
  }
}

export function insightsToday(activity: readonly AgentActivityItem[], now = new Date()): number {
  const today = now.toISOString().slice(0, 10)
  return activity.filter((item) => item.createdAt.slice(0, 10) === today).length
}

export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return '—'
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return iso.slice(0, 10)
}

export function agentImpactSummary(activity: readonly AgentActivityItem[]): Readonly<{ count: number; totalImpact: number; currency: string; approvalRate: number | null; averageConfidence: number | null; lastRunAt: string | null }> {
  if (activity.length === 0) return { count: 0, totalImpact: 0, currency: 'USD', approvalRate: null, averageConfidence: null, lastRunAt: null }
  const decided = activity.filter((item) => item.status === 'APPROVED' || item.status === 'REJECTED')
  const approved = decided.filter((item) => item.status === 'APPROVED')
  return {
    count: activity.length,
    totalImpact: activity.reduce((sum, item) => sum + item.impactValue, 0),
    currency: activity[0]?.currency ?? 'USD',
    approvalRate: decided.length === 0 ? null : Math.round((approved.length / decided.length) * 100),
    averageConfidence: Math.round((activity.reduce((sum, item) => sum + item.confidence, 0) / activity.length) * 100),
    lastRunAt: activity[0]?.createdAt ?? null,
  }
}

/** Health trend arrow from momentum components: up if positive momentum dominates. */
export function healthTrend(health: StoreHealthResult | null): 'up' | 'down' | 'flat' {
  if (!health) return 'flat'
  const momentum = health.components.filter((component) => component.key.endsWith('_momentum') && component.score !== null)
  if (momentum.length === 0) return 'flat'
  const average = momentum.reduce((sum, component) => sum + (component.score ?? 0), 0) / momentum.length
  if (average > 55) return 'up'
  if (average < 45) return 'down'
  return 'flat'
}

/** Parses one SSE frame block into a RunAllEvent, tolerating unknown events. */
export function parseSseFrame(frame: string): RunAllEvent | null {
  let event = ''
  let data = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!event || !data) return null
  try {
    const payload = JSON.parse(data) as Record<string, unknown>
    if (event === 'start') return { type: 'start', runnable: asStringArray(payload.runnable), skipped: asSkipped(payload.skipped) }
    if (event === 'progress') return { type: 'progress', agent: String(payload.agent ?? ''), completed: asNumber(payload.completed), total: asNumber(payload.total) }
    if (event === 'done') return { type: 'done', recommendations: asNumber(payload.recommendations), deduplicated: asNumber(payload.deduplicated), cacheHits: asNumber(payload.cacheHits) }
    if (event === 'error') return { type: 'error', message: String(payload.message ?? 'Run failed') }
  } catch { /* tolerate malformed frames */ }
  return null
}

function asNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function asStringArray(value: unknown): readonly string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function asSkipped(value: unknown): readonly Readonly<{ agent: string; reason: string }>[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'object' && item !== null && 'agent' in item ? [{ agent: String((item as Record<string, unknown>).agent), reason: String((item as Record<string, unknown>).reason ?? '') }] : [])
}
