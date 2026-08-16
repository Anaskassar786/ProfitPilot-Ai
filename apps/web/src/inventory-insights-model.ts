/**
 * Client-side contract for the inventory intelligence endpoints.
 *
 * These mirror `apps/api/src/inventory-insights.ts`. The workspace never
 * derives a velocity, a cover, or a prediction of its own — it only renders
 * what the API returned, including the honest `insufficient_data` states.
 */

import type { InventoryCoverage } from './inventory-model.js'

export type PlanTier = 'trial' | 'start' | 'growth' | 'commander'
export type RequiredPlan = 'growth' | 'commander'

export type InventoryInsightFeature =
  | 'dead_stock'
  | 'reorder_recommendations'
  | 'stock_turnover'
  | 'overstock_alerts'
  | 'ai_suggestion'
  | 'days_of_cover'
  | 'stock_history'
  | 'predictive_restocking'
  | 'seasonal_trends'
  | 'auto_reorder'
  | 'custom_ai_queries'

export type LockedInventoryInsight = Readonly<{ locked: true; feature: string; name: string; required_plan: RequiredPlan }>
export type AvailableInventoryInsight = Readonly<{ feature: string; name: string; data: unknown }>

export type InventoryInsightsResult = Readonly<{
  plan: PlanTier
  planLabel: string
  skuCount: number
  available: readonly AvailableInventoryInsight[]
  locked: readonly LockedInventoryInsight[]
  usage: Readonly<{ feature: string; used: number; limit: number | null; remaining: number | null; limitReached: boolean }>
  salesHistory: Readonly<{ days: number; sufficient: boolean; missingDays: number; minimumDays: number; firstDay: string | null }>
  coverage: InventoryCoverage
  cached: boolean
}>

export type InventoryHistoryPoint = Readonly<{ date: string; units: number; value: number | null; skus: number }>
export type InventoryHistoryResult = Readonly<{
  plan: PlanTier
  days: number
  points: readonly InventoryHistoryPoint[]
  firstSnapshotDate: string | null
  snapshotDays: number
  message: string
}>

export type HistoryWindow = 7 | 30 | 90 | 365
export const HISTORY_WINDOWS: readonly Readonly<{ value: HistoryWindow; label: string }>[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
]

export const EMPTY_INVENTORY_INSIGHTS: InventoryInsightsResult = {
  plan: 'trial',
  planLabel: 'Trial',
  skuCount: 0,
  available: [],
  locked: [],
  usage: { feature: 'inventory_ai_insights_day', used: 0, limit: 0, remaining: 0, limitReached: false },
  salesHistory: { days: 0, sufficient: false, missingDays: 30, minimumDays: 30, firstDay: null },
  coverage: {
    inventorySyncCompleted: false,
    levelRowCount: 0,
    locationRowCount: 0,
    lastSyncedAt: null,
    catalogSynced: false,
    locationsTruncated: false,
    quantitySource: 'unavailable',
    explanation: 'No Shopify products are synced yet. Sync your products to see stock levels.',
  },
  cached: false,
}

export function insightByFeature(result: InventoryInsightsResult | null, feature: string): AvailableInventoryInsight | null {
  return result?.available.find((entry) => entry.feature === feature) ?? null
}

export function lockedInsightByFeature(result: InventoryInsightsResult | null, feature: string): LockedInventoryInsight | null {
  return result?.locked.find((entry) => entry.feature === feature) ?? null
}

/** Narrowing helpers used by the cards. Unknown shapes render as unavailable. */
export function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}
}
export function rows(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Readonly<Record<string, unknown>> => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) : []
}
export function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null }
export function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
export function statusOf(value: unknown): string { return text(record(value).status) ?? 'unavailable' }

/** Copy shown while a feature is unlocked but the store lacks the history for it. */
export function awaitingMessage(data: unknown, fallback: string): string {
  return text(record(data).message) ?? fallback
}

export function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const amount = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${amount}` : amount
}

export function formatCount(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toLocaleString()
}

export function formatDay(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.valueOf()) ? parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : value
}

/** Growth uses a daily AI allowance; Commander is unmetered. */
export function usageLabel(result: InventoryInsightsResult): string {
  const { used, limit } = result.usage
  if (limit === null) return 'Unlimited AI insights'
  return `${used} of ${limit} AI insights used today`
}
