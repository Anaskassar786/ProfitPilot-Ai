/**
 * Client-side contract and humanization layer for the Recommendations page
 * (PR #46). Mirrors `apps/api/src/ai-routes.ts` and `@profitpilot/ai`
 * domain/labels. The workspace never derives an impact, a confidence, or a
 * count of its own — it renders what the API returned.
 */

export type AgentId = 'REVENUE_AGENT' | 'INVENTORY_AGENT' | 'CUSTOMER_AGENT' | 'PRICING_AGENT' | 'CAMPAIGN_AGENT' | 'PRODUCT_AGENT' | 'EXECUTIVE_AGENT'
export type RuleId = 'STOCKOUT_RISK' | 'DEAD_STOCK' | 'CHURN_RISK' | 'PRICING_UPLIFT' | 'REPEAT_PURCHASE' | 'CART_ABANDONMENT' | 'CROSS_SELL' | 'NEW_CUSTOMER_WELCOME'
export type RecommendationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED'
export type ActionType = 'CREATE_RECOMMENDATION' | 'TAG_CUSTOMER' | 'SEND_EMAIL' | 'CREATE_DISCOUNT' | 'INTERNAL_ALERT'
export type ActionRisk = 'SAFE' | 'APPROVAL_REQUIRED' | 'MANUAL_ONLY'
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'
export type ExplanationStatus = 'AI_GENERATED' | 'AI_UNAVAILABLE' | 'AI_REJECTED'
export type RejectReason = 'WRONG_DATA' | 'NOT_RELEVANT' | 'BAD_TIMING' | 'ALREADY_HANDLED' | 'OTHER'
export type PlanTier = 'trial' | 'start' | 'growth' | 'commander'
export type RecommendationSort = 'impact' | 'confidence' | 'created' | 'decided'

export type EvidenceField = Readonly<{ key: string; label: string; value: string | number | boolean | null; source: string }>

export type RecommendationView = Readonly<{
  id: string
  storeId: string
  agent: AgentId
  ruleId: RuleId
  title: string
  reason: string
  impactValue: number
  impactLabel: string
  currency: string
  confidence: number
  confidenceLevel: ConfidenceLevel
  actionType: ActionType
  actionRisk: ActionRisk
  status: RecommendationStatus
  evidencePack: Readonly<{ id?: string; ruleId?: string; ruleVersion?: string; sha256?: string; generatedAt?: string; fields?: readonly EvidenceField[] } & Record<string, unknown>>
  explanation: string | null
  explanationStatus: ExplanationStatus
  model: string | null
  version: number
  createdAt: string
  entityKey: string | null
  expiresAt: string | null
  decidedAt: string | null
  decidedBy: string | null
  rejectReason: RejectReason | null
  snoozedUntil: string | null
}>

export type RecommendationPage = Readonly<{ items: readonly RecommendationView[]; total: number; cursor: number; limit: number; hasMore: boolean }>

export type CurrencyAmount = Readonly<{ currency: string; value: number }>

export type RecommendationSummary = Readonly<{
  counts: Readonly<Record<RecommendationStatus, number>>
  total: number
  pendingImpact: readonly CurrencyAmount[]
  approvedThisMonth: Readonly<{ count: number; impact: readonly CurrencyAmount[] }>
  byAgent: readonly Readonly<{ agent: AgentId; pending: number; approved: number; rejected: number; total: number }>[]
  byRule: readonly Readonly<{ ruleId: RuleId; total: number }>[]
  approvalRate: Readonly<{ allTime: number | null; last30d: number | null }>
  averageDecisionMs: number | null
  recentDecisions: readonly RecommendationView[]
  generatedTrend: readonly Readonly<{ day: string; generated: number; approved: number }>[]
  plan: PlanTier | null
  usage: Readonly<{ feature: string; used: number | null; limit: number | null; remaining: number | null }>
}>

export type EvidenceVerification = Readonly<{ verified: boolean; sha256: string | null; ruleVersion: string | null; generatedAt: string | null }>
export type BulkDecisionResult = Readonly<{ results: readonly Readonly<{ id: string; ok: boolean; recommendation?: RecommendationView; error?: Readonly<{ code: string; message: string; status: number }> }>[] }>
export type AnalyzeResult = Readonly<{ storeId: string; recommendations: readonly RecommendationView[]; generatedAt: string }>

export type RecommendationListFilters = Readonly<{
  status?: RecommendationStatus
  agent?: AgentId
  ruleId?: RuleId
  minImpact?: number
  maxImpact?: number
  dateFrom?: string
  dateTo?: string
  sort?: RecommendationSort
  direction?: 'asc' | 'desc'
  cursor?: number
  limit?: number
}>

// ---------------------------------------------------------------------------
// Humanization — mirrors packages/ai/src/labels.ts. Raw enum strings must
// never reach rendered UI.
// ---------------------------------------------------------------------------

export const AGENT_LABELS: Readonly<Record<AgentId, string>> = {
  REVENUE_AGENT: 'Revenue Agent',
  INVENTORY_AGENT: 'Inventory Agent',
  CUSTOMER_AGENT: 'Customer Agent',
  PRICING_AGENT: 'Pricing Agent',
  CAMPAIGN_AGENT: 'Campaign Agent',
  PRODUCT_AGENT: 'Product Agent',
  EXECUTIVE_AGENT: 'Executive Agent',
}

export const RULE_LABELS: Readonly<Record<RuleId, string>> = {
  STOCKOUT_RISK: 'Stockout Risk',
  DEAD_STOCK: 'Dead Stock',
  CHURN_RISK: 'Churn Risk',
  PRICING_UPLIFT: 'Pricing Uplift',
  REPEAT_PURCHASE: 'Repeat Purchase',
  CART_ABANDONMENT: 'Cart Abandonment',
  CROSS_SELL: 'Cross-sell',
  NEW_CUSTOMER_WELCOME: 'New Customer Welcome',
}

export const RULE_DESCRIPTIONS: Readonly<Record<RuleId, string>> = {
  STOCKOUT_RISK: 'Flags products whose inventory covers fewer days than your reorder window at current sales velocity.',
  DEAD_STOCK: 'Finds stocked products with zero sales across the trailing 120 days so you can free the cash.',
  CHURN_RISK: 'Spots high-lifetime-value customers who have gone quiet past the churn window.',
  PRICING_UPLIFT: 'Identifies high-margin products with active demand that can absorb a measured price test.',
  REPEAT_PURCHASE: 'Finds returning customers who are overdue for their next order.',
  CART_ABANDONMENT: 'Catches recent abandoned checkouts still inside the recovery window.',
  CROSS_SELL: 'Surfaces product pairs your customers already buy together.',
  NEW_CUSTOMER_WELCOME: 'Highlights brand-new customers inside the welcome window.',
}

export const ACTION_TYPE_LABELS: Readonly<Record<ActionType, string>> = {
  CREATE_RECOMMENDATION: 'Create recommendation',
  TAG_CUSTOMER: 'Tag customer',
  SEND_EMAIL: 'Send email',
  CREATE_DISCOUNT: 'Create discount',
  INTERNAL_ALERT: 'Internal alert',
}

export const ACTION_TYPE_PREVIEWS: Readonly<Record<ActionType, string>> = {
  CREATE_RECOMMENDATION: 'Records this as an approved insight. No store data is changed.',
  TAG_CUSTOMER: 'Applies a segmentation tag to the referenced customer in Shopify.',
  SEND_EMAIL: 'Prepares a draft email to the referenced customer. Nothing sends without your reviewed campaign and verified sender.',
  CREATE_DISCOUNT: 'Prepares a discount draft for your review. No code goes live without confirmation.',
  INTERNAL_ALERT: 'Raises an internal alert for your team. Customers are never contacted.',
}

export const RISK_LABELS: Readonly<Record<ActionRisk, string>> = {
  SAFE: 'Safe to execute',
  APPROVAL_REQUIRED: 'Requires approval',
  MANUAL_ONLY: 'Manual only',
}

export const STATUS_LABELS: Readonly<Record<RecommendationStatus, string>> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXECUTED: 'Executed',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
}

export const EXPLANATION_STATUS_LABELS: Readonly<Record<ExplanationStatus, string | null>> = {
  AI_GENERATED: null,
  AI_UNAVAILABLE: 'AI explanation unavailable',
  AI_REJECTED: 'AI output filtered',
}

export const REJECT_REASON_LABELS: Readonly<Record<RejectReason, string>> = {
  WRONG_DATA: 'Wrong data',
  NOT_RELEVANT: 'Not relevant',
  BAD_TIMING: 'Bad timing',
  ALREADY_HANDLED: 'Already handled',
  OTHER: 'Other',
}

export const REJECT_REASON_OPTIONS: readonly RejectReason[] = ['WRONG_DATA', 'NOT_RELEVANT', 'BAD_TIMING', 'ALREADY_HANDLED', 'OTHER']

export function agentLabel(agent: string): string { return (AGENT_LABELS as Readonly<Record<string, string>>)[agent] ?? titleCaseEnum(agent) }
export function ruleLabel(rule: string): string { return (RULE_LABELS as Readonly<Record<string, string>>)[rule] ?? titleCaseEnum(rule) }
export function actionTypeLabel(action: string): string { return (ACTION_TYPE_LABELS as Readonly<Record<string, string>>)[action] ?? titleCaseEnum(action) }
export function riskLabel(risk: string): string { return (RISK_LABELS as Readonly<Record<string, string>>)[risk] ?? titleCaseEnum(risk) }
export function statusLabel(status: string): string { return (STATUS_LABELS as Readonly<Record<string, string>>)[status] ?? titleCaseEnum(status) }

export function titleCaseEnum(value: string): string {
  const words = value.toLowerCase().split(/[_\s]+/).filter(Boolean)
  if (words.length === 0) return value
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ')
}

/** Sentence-cases a stored impact label: "revenue at risk" → "Revenue at risk". */
export function impactLabelText(label: string): string {
  const trimmed = label.trim()
  return trimmed.length === 0 ? trimmed : trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

// ---------------------------------------------------------------------------
// Formatting helpers — currency-aware, never mixing currencies.
// ---------------------------------------------------------------------------

export function formatImpact(value: number, currency: string): string {
  const wholeNumber = Number.isInteger(value)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: wholeNumber || value >= 1000 ? 0 : 2, maximumFractionDigits: wholeNumber || value >= 1000 ? 0 : 2 }).format(value)
  } catch {
    return `${currency} ${wholeNumber ? value.toFixed(0) : value.toFixed(2)}`
  }
}

/** "$1,240" for one currency; "$1,240 + €300" when a store has mixed orders. */
export function formatCurrencyAmounts(amounts: readonly CurrencyAmount[]): string {
  if (amounts.length === 0) return '—'
  return amounts.map((amount) => formatImpact(amount.value, amount.currency)).join(' + ')
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return '—'
  const diff = now - at
  if (diff < 0) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`
}

/** "Expires in 6h" once inside 48h; null when not urgent or evergreen. */
export function expiryBadge(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null
  const at = Date.parse(expiresAt)
  if (!Number.isFinite(at)) return null
  const remaining = at - now
  if (remaining <= 0) return 'Expired'
  const hours = remaining / 3_600_000
  if (hours > 48) return null
  if (hours >= 1.5) return `Expires in ${Math.round(hours)}h`
  return `Expires in ${Math.max(1, Math.round(remaining / 60_000))}m`
}

export function formatDecisionDelay(createdAt: string, decidedAt: string | null): string | null {
  if (!decidedAt) return null
  const from = Date.parse(createdAt)
  const to = Date.parse(decidedAt)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  return `Decided ${formatDurationMs(to - from)} after creation`
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

// ---------------------------------------------------------------------------
// Plan awareness — which agents a plan unlocks and how usage is framed.
// The unlock order mirrors PLAN_ENTITLEMENT_LIMITS.active_agents (2/3/6/7).
// ---------------------------------------------------------------------------

export const AGENT_UNLOCK_ORDER: readonly AgentId[] = ['REVENUE_AGENT', 'INVENTORY_AGENT', 'CUSTOMER_AGENT', 'PRICING_AGENT', 'CAMPAIGN_AGENT', 'PRODUCT_AGENT', 'EXECUTIVE_AGENT']

const ACTIVE_AGENTS_BY_PLAN: Readonly<Record<PlanTier, number>> = { trial: 2, start: 3, growth: 6, commander: 7 }

export function unlockedAgents(plan: PlanTier | null): readonly AgentId[] {
  if (!plan) return AGENT_UNLOCK_ORDER
  return AGENT_UNLOCK_ORDER.slice(0, ACTIVE_AGENTS_BY_PLAN[plan])
}

export function agentLockedForPlan(agent: AgentId, plan: PlanTier | null): boolean {
  if (!plan) return false
  return !unlockedAgents(plan).includes(agent)
}

/** The cheapest plan that unlocks the given agent, for upgrade CTAs. */
export function planRequiredForAgent(agent: AgentId): PlanTier {
  const index = AGENT_UNLOCK_ORDER.indexOf(agent)
  if (index < ACTIVE_AGENTS_BY_PLAN.trial) return 'trial'
  if (index < ACTIVE_AGENTS_BY_PLAN.start) return 'start'
  if (index < ACTIVE_AGENTS_BY_PLAN.growth) return 'growth'
  return 'commander'
}

export const PLAN_LABELS: Readonly<Record<PlanTier, string>> = { trial: 'Trial', start: 'Start', growth: 'Growth', commander: 'Commander' }

export type UsageState = Readonly<{ used: number; limit: number | null; remaining: number | null; ratio: number | null; nearLimit: boolean; atLimit: boolean; label: string }>

export function usageState(used: number | null, limit: number | null): UsageState {
  const usedValue = used ?? 0
  if (limit === null) return { used: usedValue, limit: null, remaining: null, ratio: null, nearLimit: false, atLimit: false, label: `${usedValue} generated this month · Unlimited` }
  const remaining = Math.max(0, limit - usedValue)
  const ratio = limit === 0 ? 1 : Math.min(1, usedValue / limit)
  return {
    used: usedValue,
    limit,
    remaining,
    ratio,
    nearLimit: ratio >= .8 && remaining > 0,
    atLimit: remaining === 0,
    label: `${usedValue}/${limit} used this month`,
  }
}

// ---------------------------------------------------------------------------
// List presentation helpers.
// ---------------------------------------------------------------------------

export type StatusTab = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED'
export const STATUS_TABS: readonly StatusTab[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'EXECUTED']

export function statusTabLabel(tab: StatusTab): string { return tab === 'ALL' ? 'All' : STATUS_LABELS[tab] }

export function statusTabCount(tab: StatusTab, counts: Readonly<Record<RecommendationStatus, number>>): number {
  if (tab === 'ALL') return (Object.values(counts) as number[]).reduce((sum, value) => sum + value, 0)
  if (tab === 'REJECTED') return counts.REJECTED + counts.EXPIRED
  if (tab === 'EXECUTED') return counts.EXECUTED + counts.FAILED
  return counts[tab]
}

export type GroupMode = 'none' | 'agent' | 'rule'

export function groupRecommendations(items: readonly RecommendationView[], mode: GroupMode): readonly Readonly<{ key: string; label: string; items: readonly RecommendationView[] }>[] {
  if (mode === 'none') return [{ key: 'all', label: '', items }]
  const groups = new Map<string, RecommendationView[]>()
  for (const item of items) {
    const key = mode === 'agent' ? item.agent : item.ruleId
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([key, groupItems]) => ({ key, label: mode === 'agent' ? agentLabel(key) : ruleLabel(key), items: groupItems }))
}

export function searchRecommendations(items: readonly RecommendationView[], query: string): readonly RecommendationView[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => item.title.toLowerCase().includes(needle) || item.reason.toLowerCase().includes(needle) || (item.explanation?.toLowerCase().includes(needle) ?? false))
}

/** Impact bar width relative to the page's largest impact, min 4% for visibility. */
export function impactRatio(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0 || value <= 0) return 0
  return Math.max(.04, Math.min(1, value / maxValue))
}

// ---------------------------------------------------------------------------
// Optimistic decision reducer — a decision updates one card in place; no full
// page reload (PR #46).
// ---------------------------------------------------------------------------

export function applyDecisionLocally(items: readonly RecommendationView[], updated: RecommendationView): readonly RecommendationView[] {
  return items.map((item) => (item.id === updated.id ? updated : item))
}

export function removeLocally(items: readonly RecommendationView[], id: string): readonly RecommendationView[] {
  return items.filter((item) => item.id !== id)
}

// ---------------------------------------------------------------------------
// URL routing (hash-based) — deep links to /recommendations/:id survive
// refresh and can be shared. Query params (storeId, shop) stay in the search
// string, untouched by the hash.
// ---------------------------------------------------------------------------

export type RecommendationsRoute = Readonly<{ recommendationId: string | null; evidence: boolean }>

export function parseRecommendationsHash(hash: string): RecommendationsRoute | null {
  const match = /^#\/recommendations(?:\/([A-Za-z0-9-]+))?(\?evidence=true)?$/.exec(hash)
  if (!match) return null
  return { recommendationId: match[1] ?? null, evidence: Boolean(match[2]) }
}

export function recommendationsHash(recommendationId: string | null, evidence = false): string {
  if (!recommendationId) return '#/recommendations'
  return `#/recommendations/${recommendationId}${evidence ? '?evidence=true' : ''}`
}
