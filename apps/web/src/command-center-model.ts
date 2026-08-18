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
export type StoreHealthResult = Readonly<{ score: number | null; method: string; components: readonly Readonly<{ key: string; score: number | null; weight: number; reason: string }>[]; orderCount?: number; historyDays?: number | null }>
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

/* ── KPI trend helpers (real data from /recommendations/summary) ───────── */

/** One day from the recommendations summary `generatedTrend` series. */
export type DailyTrendPoint = Readonly<{ day: string; generated: number; approved: number }>
export type SeriesPoint = Readonly<{ day: string; value: number }>

/** `YYYY-MM-DD` (UTC) for `daysAgo` days before `now`, oldest first. */
export function lastDayKeys(days: number, now = new Date()): readonly string[] {
  const keys: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now)
    day.setUTCDate(day.getUTCDate() - offset)
    keys.push(day.toISOString().slice(0, 10))
  }
  return keys
}

/** Zero-filled daily series for the last `days` days, oldest → newest. */
export function dailySeries(trend: readonly DailyTrendPoint[], metric: 'generated' | 'approved', days: number, now = new Date()): readonly SeriesPoint[] {
  const byDay = new Map(trend.map((point) => [point.day, point[metric]]))
  return lastDayKeys(days, now).map((day) => ({ day, value: byDay.get(day) ?? 0 }))
}

export type PeriodTotals = Readonly<{ current: number; previous: number; changePercent: number | null }>

/** Current vs previous week totals from a 14-day series (oldest → newest). */
export function periodTotals(series: readonly SeriesPoint[]): PeriodTotals {
  const midpoint = Math.max(0, series.length - 7)
  const previous = series.slice(0, midpoint).reduce((sum, point) => sum + point.value, 0)
  const current = series.slice(midpoint).reduce((sum, point) => sum + point.value, 0)
  const changePercent = previous === 0 ? null : Math.round(((current - previous) / previous) * 100)
  return { current, previous, changePercent }
}

/** Signed, humanized trend direction for a percentage change (null when no baseline). */
export function trendDirection(changePercent: number | null): 'up' | 'down' | 'flat' | 'new' {
  if (changePercent === null) return 'new'
  if (changePercent > 0) return 'up'
  if (changePercent < 0) return 'down'
  return 'flat'
}

/* ── Hidden agents (kept in the backend for future use, hidden from UI) ── */

export const HIDDEN_AGENT_IDS: ReadonlySet<string> = new Set(['PRICING_AGENT', 'CAMPAIGN_AGENT'])

/** The Command Center only displays a curated subset of the full agent roster. */
export function visibleAgents(agents: readonly AgentOverviewEntry[]): readonly AgentOverviewEntry[] {
  return agents.filter((agent) => !HIDDEN_AGENT_IDS.has(agent.id))
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

export type HealthTone = 'healthy' | 'warning' | 'critical'
export type StoreHealthDisplay =
  | Readonly<{ kind: 'score'; score: number; tone: HealthTone; label: string }>
  | Readonly<{ kind: 'empty'; message: string }>

/** Minimum closed-period orders before a health score is meaningful. */
export const MIN_ORDERS_FOR_HEALTH = 10
/** Minimum days of order history before momentum windows are meaningful. */
export const MIN_HISTORY_DAYS_FOR_HEALTH = 7

/**
 * Distinguishes a real score from a not-enough-data state so the hero never
 * shows a bare, panic-inducing "0/100 Critical" for a store with no evidence.
 * A low-but-real score is labeled calmly ("Needs attention") — the word
 * "Critical" never reaches merchants.
 */
export function storeHealthDisplay(health: StoreHealthResult | null): StoreHealthDisplay {
  if (!health) return { kind: 'empty', message: 'Not enough data yet' }
  if (health.score !== null) {
    const tone: HealthTone = health.score >= 75 ? 'healthy' : health.score >= 40 ? 'warning' : 'critical'
    const label = health.score >= 75 ? 'Healthy' : 'Needs attention'
    return { kind: 'score', score: health.score, tone, label }
  }
  const orderCount = health.orderCount
  if (orderCount === undefined) return { kind: 'empty', message: 'Not enough data yet' }
  if (orderCount < MIN_ORDERS_FOR_HEALTH) return { kind: 'empty', message: `Not enough data yet — need ${MIN_ORDERS_FOR_HEALTH}+ orders to calculate health score` }
  if (health.historyDays !== undefined && health.historyDays !== null && health.historyDays < MIN_HISTORY_DAYS_FOR_HEALTH) return { kind: 'empty', message: 'Store health calculating… check back in 24 hours' }
  return { kind: 'empty', message: 'Not enough data yet' }
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

/* ── Agent categories (PR49 section organization) ─────────────────────── */

export type AgentCategory = 'AI Employees' | 'Communication' | 'Strategic Overview'
export const AGENT_CATEGORY_ORDER: readonly AgentCategory[] = ['AI Employees', 'Communication', 'Strategic Overview']

export function agentCategory(agent: Readonly<{ id: string }>): AgentCategory {
  if (agent.id === 'CAMPAIGN_AGENT') return 'Communication'
  if (agent.id === 'EXECUTIVE_AGENT') return 'Strategic Overview'
  return 'AI Employees'
}

/* ── Agent guide content for the detail drawer (static copy, no fake data) ── */

export type AgentGuide = Readonly<{
  description: string
  whatItDoes: readonly string[]
  sampleInsights: readonly string[]
  useCases: readonly string[]
  dataSources: readonly string[]
}>

const FALLBACK_GUIDE: AgentGuide = {
  description: 'Explains deterministic store evidence in plain language — never inventing a number.',
  whatItDoes: ['Reads real store evidence', 'Explains signals in plain language', 'Never invents numbers'],
  sampleInsights: ['A signal this agent watches will appear here after a run.'],
  useCases: ['Review recommendations', 'Act on evidence-backed insights'],
  dataSources: ['Synced store data'],
}

export const AGENT_GUIDES: Readonly<Record<string, AgentGuide>> = {
  REVENUE_AGENT: {
    description: 'Explains closed-period revenue momentum so you can double down on wins and catch drops before they compound.',
    whatItDoes: ['Compares the last 30 days of revenue against the previous 30', 'Flags accelerating and slipping revenue momentum', 'Grounds every explanation in your real revenue rows'],
    sampleInsights: ['Revenue is up 18% versus the previous 30 days — here is what is driving the streak.', 'Revenue momentum is slipping: down 12% period over period.', 'No new revenue signals in the current evidence.'],
    useCases: ['Spot growth trends early', 'Catch declines before they compound', 'Prepare week-over-week revenue check-ins'],
    dataSources: ['analytics.revenue_daily', 'analytics.orders_daily'],
  },
  INVENTORY_AGENT: {
    description: 'Tracks stock cover and dead inventory so cash never sits idle on a shelf.',
    whatItDoes: ['Flags products on pace to sell out within your cover window', 'Finds inventory with zero sales locking up cash', 'Uses real velocity — never guesses'],
    sampleInsights: ['Two products will sell out within a week at current velocity — reorder now.', 'A product has had zero sales for 120 days — consider a clearance.', 'Inventory cover looks healthy across your catalog.'],
    useCases: ['Avoid stockouts on best sellers', 'Free cash locked in dead stock', 'Plan reorders from real velocity'],
    dataSources: ['products.inventory_units', 'products.average_daily_units', 'products.units_sold_120d'],
  },
  CUSTOMER_AGENT: {
    description: 'Finds churn risks and reorder windows in your customer base — never using personally identifiable information.',
    whatItDoes: ['Detects high-value customers going quiet', 'Times reorder nudges for returning customers', 'Works from opaque customer keys — never names or emails'],
    sampleInsights: ['A high-value customer has gone quiet for 80 days. A win-back nudge is due.', 'A returning customer is outside their reorder window.', 'No churn-risk customers match the current thresholds.'],
    useCases: ['Win back at-risk customers', 'Time repeat-purchase campaigns', 'Protect customer lifetime value'],
    dataSources: ['customers.lifetime_value', 'customers.last_order_at', 'customers.order_count'],
  },
  PRICING_AGENT: {
    description: 'Spots margin-safe price test opportunities from real cost and demand data.',
    whatItDoes: ['Finds products clearing your margin floor with active demand', 'Models a measured uplift window', 'Never invents a cost or a price'],
    sampleInsights: ['A best-seller clears your margin floor — a measured 5% test is available.', 'No pricing opportunities clear the margin threshold right now.', 'Your margin floor is protected across active products.'],
    useCases: ['Test price on proven sellers', 'Protect gross margins', 'Model uplift before changing prices'],
    dataSources: ['products.unit_price', 'products.unit_cost', 'products.average_daily_units'],
  },
  CAMPAIGN_AGENT: {
    description: 'Drafts compliant recovery and welcome campaigns from live checkout and customer signals.',
    whatItDoes: ['Recovers checkouts inside the 48-hour window', 'Welcomes first orders while they are fresh', 'Writes concise, compliant campaign language'],
    sampleInsights: ['Three abandoned checkouts are still inside the 48-hour recovery window.', 'A new customer placed their first order two days ago — welcome them.', 'No checkouts are in the recovery window right now.'],
    useCases: ['Recover abandoned checkouts', 'Welcome new customers', 'Draft campaign copy from real signals'],
    dataSources: ['checkouts.total', 'checkouts.created_at', 'customers.order_count'],
  },
  PRODUCT_AGENT: {
    description: 'Learns which products travel together and proposes cross-sell pairings.',
    whatItDoes: ['Builds co-purchase pairs from real order line items', 'Proposes pairings above your co-purchase threshold', 'Never fabricates a pairing'],
    sampleInsights: ['Customers who buy your top product add a companion item 12% of the time.', 'A pairing clears the co-purchase threshold — test a cross-sell.', 'No pairings clear the threshold in the current evidence.'],
    useCases: ['Increase basket value', 'Discover natural bundles', 'Merchandise cross-sells'],
    dataSources: ['orders.product_pairs', 'products.unit_price'],
  },
  EXECUTIVE_AGENT: {
    description: 'Delivers a weekly plain-language digest of your deterministic store health.',
    whatItDoes: ['Summarizes the store health score in plain language', 'Cites the weakest health component', 'Keeps every number grounded in evidence'],
    sampleInsights: ['Store health is 74/100 this week — inventory cover is the weak component.', 'Store health is holding steady at 82/100.', 'A health digest will appear once closed-period data is available.'],
    useCases: ['Weekly owner check-ins', 'Board-ready summaries', 'Spot the weakest part of the business'],
    dataSources: ['health.score', 'health.components'],
  },
}

export function agentGuide(id: string): AgentGuide {
  return AGENT_GUIDES[id] ?? FALLBACK_GUIDE
}

/* ── AI Growth Command modules (all shipped — links open the real pages) ── */

export type GrowthModuleId = 'STORE_COACH' | 'AI_EXECUTIVE' | 'PATTERN_AI' | 'AI_COMMAND'
/** Sidebar section id each module's "Open" action navigates to. */
export type GrowthModulePath = 'store-coach' | 'ai-executive' | 'patternai' | 'ai-command'
export type GrowthModule = Readonly<{
  id: GrowthModuleId
  label: string
  description: string
  sampleInsight: string
  /** Sidebar section id this module links to. */
  path: GrowthModulePath
  /** Feature level for each plan tier, from the plan-gating matrix. */
  planTiers: Readonly<Record<PlanTier, string>>
  /** What the module does for the merchant. */
  features: readonly string[]
}>

export const GROWTH_MODULES: readonly GrowthModule[] = [
  {
    id: 'STORE_COACH',
    label: 'Store Coach',
    description: 'Your daily business advisor providing tactical coaching.',
    sampleInsight: 'Your inventory cover slipped this week — here are three moves to recover it.',
    path: 'store-coach',
    planTiers: { trial: 'Basic', start: 'Full', growth: 'Advanced', commander: '+ Voice + PDF' },
    features: ['Daily tactical coaching from your real store numbers', 'Plain-language action plans', 'Voice and PDF briefings on Commander'],
  },
  {
    id: 'AI_EXECUTIVE',
    label: 'GrowthIQ',
    description: 'Strategic boardroom intelligence for big decisions.',
    sampleInsight: 'Quarterly revenue is tracking 9% above plan — a board-ready summary is ready.',
    path: 'ai-executive',
    planTiers: { trial: 'Sample', start: 'Basic', growth: 'Full', commander: '+ Investor PDFs' },
    features: ['Boardroom-level strategic summaries', 'Investor-ready PDFs on Commander', 'Big-decision context from closed-period data'],
  },
  {
    id: 'PATTERN_AI',
    label: 'PatternAI',
    description: 'Discovers hidden patterns and delivers deep insights.',
    sampleInsight: 'We found a hidden pattern: weekend bundles outperform weekday discounts.',
    path: 'patternai',
    planTiers: { trial: 'Limited', start: 'Basic', growth: 'Full', commander: '+ API + Real-time' },
    features: ['Deep pattern discovery across your data', 'API and real-time streams on Commander', 'Hidden correlations surfaced automatically'],
  },
  {
    id: 'AI_COMMAND',
    label: 'AI Command',
    description: 'Universal command center — control your store with text.',
    sampleInsight: 'Ask “Which products should I reorder this week?” — get an evidence-backed answer.',
    path: 'ai-command',
    planTiers: { trial: 'Info only', start: 'Info only', growth: 'Info only', commander: '+ Full Actions' },
    features: ['Universal text command for your store', 'Evidence-backed answers, never invented', 'Full store actions on Commander'],
  },
]

export type GrowthAccess = Readonly<{
  tierLabel: string
  badge: 'available' | 'requires'
  badgeLabel: string
  note: string | null
  requiresUpgrade: boolean
  upgradePlan: PlanTier | null
}>

/** Plan-gating decision for a shipped module on the merchant's current plan. */
export function growthModuleAccess(module: GrowthModule, plan: PlanTier): GrowthAccess {
  if (module.id === 'AI_EXECUTIVE') {
    const gated = plan === 'trial' || plan === 'start'
    return {
      tierLabel: module.planTiers[plan],
      badge: gated ? 'requires' : 'available',
      badgeLabel: gated ? 'Requires Growth' : 'Available',
      note: gated ? 'Limited features on your current plan' : null,
      requiresUpgrade: gated,
      upgradePlan: 'growth',
    }
  }
  if (module.id === 'AI_COMMAND') {
    const actions = plan === 'commander'
    return {
      tierLabel: module.planTiers[plan],
      badge: 'available',
      badgeLabel: 'Available',
      note: actions ? null : 'Full actions require Commander',
      requiresUpgrade: !actions,
      upgradePlan: 'commander',
    }
  }
  return {
    tierLabel: module.planTiers[plan],
    badge: 'available',
    badgeLabel: 'Available',
    note: null,
    requiresUpgrade: false,
    upgradePlan: null,
  }
}
