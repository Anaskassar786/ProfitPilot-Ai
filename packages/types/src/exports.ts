import { PLAN_TIERS } from './plans.js'
import type { PlanTier } from './plans.js'

/**
 * Data Exports — the single source of truth for what a merchant can download,
 * which plan unlocks it, and how many exports each plan includes per month.
 *
 * Both the API (gating, metering) and the web app (cards, lock states, plan
 * banner) import this table so the screen can never promise something the
 * server refuses — or hide something the server would allow.
 */

export const EXPORT_DATASETS = ['orders', 'catalog', 'audit', 'revenue'] as const
export type ExportDataset = (typeof EXPORT_DATASETS)[number]

export const EXPORT_FORMATS = ['CSV', 'XLSX', 'PDF'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** One file never exceeds this many rows, so a very large store cannot stall the browser. */
export const EXPORT_ROW_CEILING = 50_000

export type ExportDatasetDefinition = Readonly<{
  id: ExportDataset
  /** Merchant-facing name. Never technical jargon. */
  name: string
  /** One plain sentence describing what the merchant receives. */
  description: string
  format: ExportFormat
  /** Cheapest plan tier that unlocks this download. */
  minimumPlan: PlanTier
  /** The columns/fields the file contains, in merchant language. */
  includes: readonly string[]
  /** Where the rows come from — shown as an honesty note, never invented. */
  source: string
}>

export const EXPORT_DATASET_DEFINITIONS: Readonly<Record<ExportDataset, ExportDatasetDefinition>> = {
  orders: {
    id: 'orders',
    name: 'Orders Export',
    description: 'Daily order summaries from your Shopify sync.',
    format: 'CSV',
    minimumPlan: 'trial',
    includes: ['Order date', 'Orders placed', 'Orders fulfilled', 'Orders cancelled', 'Average order value'],
    source: 'Built from your synced Shopify orders.',
  },
  catalog: {
    id: 'catalog',
    name: 'Product Catalog',
    description: 'All your synced products with titles and IDs.',
    format: 'XLSX',
    minimumPlan: 'trial',
    includes: ['Product ID', 'Product title', 'Last synced date'],
    source: 'Built from your synced Shopify product catalog.',
  },
  audit: {
    id: 'audit',
    name: 'Activity Log',
    description: 'Complete log of all actions and events in your store.',
    format: 'CSV',
    minimumPlan: 'start',
    includes: ['Action', 'When it happened', 'Reference key'],
    source: 'Built from your store activity records.',
  },
  revenue: {
    id: 'revenue',
    name: 'Revenue Report',
    description: 'Revenue data for closed periods.',
    format: 'PDF',
    minimumPlan: 'growth',
    includes: ['Day', 'Gross revenue', 'Discounts', 'Orders'],
    source: 'Built from your closed-period revenue rows.',
  },
}

export const EXPORT_DATASET_LIST: readonly ExportDatasetDefinition[] = EXPORT_DATASETS.map((id) => EXPORT_DATASET_DEFINITIONS[id])

/** Exports included per calendar month. `null` means unlimited. */
export const EXPORT_MONTHLY_LIMITS: Readonly<Record<PlanTier, number | null>> = {
  trial: 3,
  start: 10,
  growth: null,
  commander: null,
}

/** Plan-only extras shown on the plan banner (and enforced by the API). */
export const EXPORT_PLAN_FEATURES = ['customDateRange', 'scheduledExports'] as const
export type ExportPlanFeature = (typeof EXPORT_PLAN_FEATURES)[number]

export const EXPORT_FEATURE_MINIMUM_PLAN: Readonly<Record<ExportPlanFeature, PlanTier>> = {
  customDateRange: 'growth',
  scheduledExports: 'commander',
}

const PLAN_RANK: Readonly<Record<PlanTier, number>> = { trial: 0, start: 1, growth: 2, commander: 3 }

/** True when `plan` is at least as high as `minimum`. */
export function planMeets(plan: PlanTier, minimum: PlanTier): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[minimum]
}

/** Whether a plan unlocks a dataset download. */
export function exportDatasetAllowed(plan: PlanTier, dataset: ExportDataset): boolean {
  return planMeets(plan, EXPORT_DATASET_DEFINITIONS[dataset].minimumPlan)
}

/** Whether a plan unlocks an export extra (custom range, scheduling). */
export function exportFeatureAllowed(plan: PlanTier, feature: ExportPlanFeature): boolean {
  return planMeets(plan, EXPORT_FEATURE_MINIMUM_PLAN[feature])
}

/** Monthly allowance for a plan. `null` means unlimited. */
export function exportMonthlyLimit(plan: PlanTier): number | null {
  return EXPORT_MONTHLY_LIMITS[plan]
}

/** Remaining exports this month, or `null` when the plan is unlimited. */
export function exportsRemaining(plan: PlanTier, used: number): number | null {
  const limit = exportMonthlyLimit(plan)
  if (limit === null) return null
  return Math.max(0, limit - Math.max(0, used))
}

/** The cheapest plan tier that unlocks a dataset — powers "Available on X plan". */
export function requiredPlanForDataset(dataset: ExportDataset): PlanTier {
  return EXPORT_DATASET_DEFINITIONS[dataset].minimumPlan
}

/** Every dataset a plan tier unlocks, in display order. */
export function datasetsForPlan(plan: PlanTier): readonly ExportDataset[] {
  return EXPORT_DATASETS.filter((dataset) => exportDatasetAllowed(plan, dataset))
}

export function isExportDataset(value: unknown): value is ExportDataset {
  return typeof value === 'string' && (EXPORT_DATASETS as readonly string[]).includes(value)
}

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value)
}

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === 'string' && (PLAN_TIERS as readonly string[]).includes(value)
}

/** First day of the current metering month, as `YYYY-MM-01` in UTC. */
export function exportPeriodStart(now: number = Date.now()): string {
  const date = new Date(now)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-01`
}
