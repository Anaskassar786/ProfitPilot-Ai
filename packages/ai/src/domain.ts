import type { StoreId } from '@profitpilot/types'

export const AGENT_IDS = ['REVENUE_AGENT', 'INVENTORY_AGENT', 'CUSTOMER_AGENT', 'PRICING_AGENT', 'CAMPAIGN_AGENT', 'PRODUCT_AGENT', 'EXECUTIVE_AGENT'] as const
export type AgentId = (typeof AGENT_IDS)[number]

export const RULE_IDS = ['STOCKOUT_RISK', 'DEAD_STOCK', 'CHURN_RISK', 'PRICING_UPLIFT', 'REPEAT_PURCHASE', 'CART_ABANDONMENT', 'CROSS_SELL', 'NEW_CUSTOMER_WELCOME', 'REVENUE_SPIKE', 'REVENUE_DROP', 'WEEKLY_HEALTH_DIGEST'] as const
export type RuleId = (typeof RULE_IDS)[number]
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'
export type AutomationMode = 'MANUAL' | 'SEMI_AUTOMATIC' | 'FULLY_AUTOMATIC'
export type RecommendationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED'
export type ActionType = 'CREATE_RECOMMENDATION' | 'TAG_CUSTOMER' | 'SEND_EMAIL' | 'CREATE_DISCOUNT' | 'INTERNAL_ALERT'
export type ActionRisk = 'SAFE' | 'APPROVAL_REQUIRED' | 'MANUAL_ONLY'

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
  entityKey?: string | null
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
