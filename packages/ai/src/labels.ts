import type { ActionRisk, ActionType, AgentId, RecommendationStatus, RejectReason, RuleId } from './domain.js'

/**
 * Humanization layer (PR #46). Every enum a merchant can see maps through
 * these tables — raw identifiers such as `INVENTORY_AGENT` or
 * `APPROVAL_REQUIRED` must never reach rendered UI.
 */

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

export const ACTION_TYPE_LABELS: Readonly<Record<ActionType, string>> = {
  CREATE_RECOMMENDATION: 'Create recommendation',
  TAG_CUSTOMER: 'Tag customer',
  SEND_EMAIL: 'Send email',
  CREATE_DISCOUNT: 'Create discount',
  INTERNAL_ALERT: 'Internal alert',
}

/** Concrete "what happens if you approve" previews for the confirmation sheet. */
export const ACTION_TYPE_PREVIEWS: Readonly<Record<ActionType, string>> = {
  CREATE_RECOMMENDATION: 'Records this as an approved insight. No store data is changed.',
  TAG_CUSTOMER: 'Applies a segmentation tag to the referenced customer in Shopify.',
  SEND_EMAIL: 'Prepares an email to the referenced customer from your verified sender. Nothing sends without a reviewed campaign.',
  CREATE_DISCOUNT: 'Prepares a discount for your review. No code goes live without confirmation.',
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

/** AI_GENERATED intentionally maps to null — the default state needs no badge. */
export const EXPLANATION_STATUS_LABELS: Readonly<Record<'AI_GENERATED' | 'AI_UNAVAILABLE' | 'AI_REJECTED', string | null>> = {
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

export function agentLabel(agent: string): string { return (AGENT_LABELS as Readonly<Record<string, string>>)[agent] ?? titleCaseEnum(agent) }
export function ruleLabel(rule: string): string { return (RULE_LABELS as Readonly<Record<string, string>>)[rule] ?? titleCaseEnum(rule) }
export function actionTypeLabel(action: string): string { return (ACTION_TYPE_LABELS as Readonly<Record<string, string>>)[action] ?? titleCaseEnum(action) }
export function riskLabel(risk: string): string { return (RISK_LABELS as Readonly<Record<string, string>>)[risk] ?? titleCaseEnum(risk) }
export function statusLabel(status: string): string { return (STATUS_LABELS as Readonly<Record<string, string>>)[status] ?? titleCaseEnum(status) }

/** Safe fallback: WORD_WORD → "Word word" so an unknown enum still never leaks raw. */
export function titleCaseEnum(value: string): string {
  const words = value.toLowerCase().split(/[_\s]+/).filter(Boolean)
  if (words.length === 0) return value
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ')
}
