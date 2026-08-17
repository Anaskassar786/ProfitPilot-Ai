import type { StoreId } from '@profitpilot/types'

export const AGENT_IDS = ['REVENUE_AGENT', 'INVENTORY_AGENT', 'CUSTOMER_AGENT', 'PRICING_AGENT', 'CAMPAIGN_AGENT', 'PRODUCT_AGENT', 'EXECUTIVE_AGENT'] as const
export type AgentId = (typeof AGENT_IDS)[number]

export const RULE_IDS = ['STOCKOUT_RISK', 'DEAD_STOCK', 'CHURN_RISK', 'PRICING_UPLIFT', 'REPEAT_PURCHASE', 'CART_ABANDONMENT', 'CROSS_SELL', 'NEW_CUSTOMER_WELCOME'] as const
export type RuleId = (typeof RULE_IDS)[number]
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'
export type AutomationMode = 'MANUAL' | 'SEMI_AUTOMATIC' | 'FULLY_AUTOMATIC'
export type RecommendationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED'
export type ActionType = 'CREATE_RECOMMENDATION' | 'TAG_CUSTOMER' | 'SEND_EMAIL' | 'CREATE_DISCOUNT' | 'INTERNAL_ALERT'
export type ActionRisk = 'SAFE' | 'APPROVAL_REQUIRED' | 'MANUAL_ONLY'
export type RejectReason = 'WRONG_DATA' | 'NOT_RELEVANT' | 'BAD_TIMING' | 'ALREADY_HANDLED' | 'OTHER'
export const REJECT_REASONS = ['WRONG_DATA', 'NOT_RELEVANT', 'BAD_TIMING', 'ALREADY_HANDLED', 'OTHER'] as const

export type ProductContext = Readonly<{
  productId: string
  title: string
  inventoryUnits: number
  averageDailyUnits: number
  unitPrice: number
  unitCost: number | null
  unitsSold120d: number
  daysSinceLastSale: number | null
}>

export type CustomerContext = Readonly<{
  customerKey: string
  lifetimeValue: number
  orderCount: number
  daysSinceLastOrder: number
  firstOrderDay: string
}>

export type CheckoutContext = Readonly<{
  checkoutKey: string
  total: number
  ageHours: number
  recovered: boolean
}>

export type OrderContext = Readonly<{
  orderKey: string
  total: number
  day: string
  productIds: readonly string[]
  customerKey: string | null
}>

export type ProductPairContext = Readonly<{
  productId: string
  relatedProductId: string
  coPurchaseRate: number
  productPrice: number
  relatedProductPrice: number
}>

export type StoreSnapshot = Readonly<{
  storeId: StoreId
  currency: string
  timezone: string
  asOf: string
  dataFreshAt: string
  products: readonly ProductContext[]
  customers: readonly CustomerContext[]
  checkouts: readonly CheckoutContext[]
  orders: readonly OrderContext[]
  productPairs: readonly ProductPairContext[]
  last30dRevenue: number
  previous30dRevenue: number
  last30dOrders: number
  previous30dOrders: number
}>

export type RawCustomerContext = Readonly<CustomerContext & { email?: string; name?: string; phone?: string }>
export type RawStoreContext = Readonly<Omit<StoreSnapshot, 'customers'> & { customers: readonly RawCustomerContext[] }>

export type RuleSignal = Readonly<{
  ruleId: RuleId
  ruleVersion: string
  agent: AgentId
  title: string
  reason: string
  impactValue: number
  impactLabel: string
  currency: string
  confidence: number
  actionType: ActionType
  actionRisk: ActionRisk
  evidence: readonly Readonly<{ key: string; label: string; value: string | number | boolean | null; source: string }>[]
  entityKey: string | null
}>

export type AgentStatus = Readonly<{
  id: AgentId
  label: string
  promptVersion: string
  enabled: boolean
  execution: 'READY' | 'UNCONFIGURED' | 'RUNNING' | 'PAUSED'
  languageOnly: true
}>

export type Recommendation = Readonly<{
  id: string
  storeId: StoreId
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
  evidencePack: Readonly<Record<string, unknown>>
  explanation: string | null
  explanationStatus: 'AI_GENERATED' | 'AI_UNAVAILABLE' | 'AI_REJECTED'
  model: string | null
  version: number
  createdAt: string
  /** The product/customer/checkout the rule fired on. Null for store-wide signals. */
  entityKey: string | null
  /** ISO timestamp after which a PENDING recommendation is stale. Null = evergreen. */
  expiresAt: string | null
  /** Populated when the recommendation leaves PENDING (approve/reject/expire). */
  decidedAt: string | null
  /** Opaque user id of the approver/rejecter; 'system' for automatic expiry. */
  decidedBy: string | null
  rejectReason: RejectReason | null
  /** Server-side snooze; a snoozed rec is hidden from passive surfaces until then. */
  snoozedUntil: string | null
}>

export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= 0.9) return 'HIGH'
  if (value >= 0.6) return 'MEDIUM'
  return 'LOW'
}

export function actionRisk(actionType: ActionType): ActionRisk {
  if (actionType === 'CREATE_RECOMMENDATION' || actionType === 'INTERNAL_ALERT' || actionType === 'TAG_CUSTOMER') return 'SAFE'
  if (actionType === 'SEND_EMAIL' || actionType === 'CREATE_DISCOUNT') return 'APPROVAL_REQUIRED'
  return 'MANUAL_ONLY'
}

/**
 * Time sensitivity derived from rule semantics (PR #46). Returns the ISO
 * expiry for a signal generated at `generatedAt`, or null for evergreen rules.
 * - CART_ABANDONMENT: recovery window closes 48h after checkout creation, so
 *   the remaining window is 48h minus the checkout's current age.
 * - STOCKOUT_RISK: the recommendation is moot once the projected days of
 *   cover have elapsed.
 * - NEW_CUSTOMER_WELCOME: welcome emails stop being "welcome" after 7 days.
 * - REPEAT_PURCHASE / CHURN_RISK: re-evaluated on each analysis run; a 14-day
 *   expiry keeps stale copies from lingering between runs.
 */
export function deriveExpiry(ruleId: RuleId, evidence: readonly Readonly<{ key: string; value: string | number | boolean | null }>[], generatedAt: string): string | null {
  const generated = Date.parse(generatedAt)
  if (!Number.isFinite(generated)) return null
  const hours = (count: number): string => new Date(generated + count * 3_600_000).toISOString()
  if (ruleId === 'CART_ABANDONMENT') {
    const age = numericEvidence(evidence, 'age_hours')
    const remaining = Math.max(1, 48 - (age ?? 0))
    return hours(remaining)
  }
  if (ruleId === 'STOCKOUT_RISK') {
    const cover = numericEvidence(evidence, 'days_of_cover')
    return cover !== null ? hours(Math.max(6, cover * 24)) : hours(7 * 24)
  }
  if (ruleId === 'NEW_CUSTOMER_WELCOME') return hours(7 * 24)
  if (ruleId === 'REPEAT_PURCHASE' || ruleId === 'CHURN_RISK') return hours(14 * 24)
  return null
}

function numericEvidence(evidence: readonly Readonly<{ key: string; value: string | number | boolean | null }>[], key: string): number | null {
  const field = evidence.find((item) => item.key === key)
  return typeof field?.value === 'number' && Number.isFinite(field.value) ? field.value : null
}
