import { randomUUID } from 'node:crypto'
import { writeCsv, writePdf, writeXlsx } from '@profitpilot/reporting'
import type { ExportFile, ExportRow } from '@profitpilot/reporting'
import {
  AppError,
  EXPORT_DATASET_DEFINITIONS,
  EXPORT_DATASET_LIST,
  EXPORT_FEATURE_MINIMUM_PLAN,
  EXPORT_ROW_CEILING,
  exportDatasetAllowed,
  exportFeatureAllowed,
  exportMonthlyLimit,
  exportPeriodStart,
  exportsRemaining,
  requiredPlanForDataset,
} from '@profitpilot/types'
import type { ExportDataset, ExportFormat, PlanTier } from '@profitpilot/types'
import type { ExportHistoryRecord, ExportHistoryRepository } from './exports-repository.js'

/**
 * Data Exports service.
 *
 * Owns the merchant-facing contract for the Exports page:
 *
 *   * which downloads a plan unlocks (Orders/Catalog on every plan, Activity
 *     Log from Start, Revenue Report from Growth),
 *   * the monthly allowance (Trial 3, Start 10, Growth/Commander unlimited),
 *   * real row estimates and last-exported timestamps,
 *   * the generated file itself, written from real synced rows only.
 *
 * Nothing here invents data. When a dataset has no synced rows the export is
 * refused with a clear, non-technical message instead of handing the merchant
 * an empty file they cannot interpret.
 */

export type ExportDateRange = Readonly<{ from: string | null; to: string | null }>

export interface ExportDataSource {
  /** Real rows for a dataset, already tenant-scoped. */
  rows(storeId: string, dataset: ExportDataset, range: ExportDateRange): Promise<readonly ExportRow[]>
  /** Cheap row-count estimate per dataset for the export cards. */
  estimates(storeId: string): Promise<Readonly<Partial<Record<ExportDataset, number>>>>
}

export type ExportsServiceDependencies = Readonly<{
  history: ExportHistoryRepository
  data: ExportDataSource
  plan: (storeId: string) => Promise<PlanTier>
  now?: () => number
}>

export type ExportCardView = Readonly<{
  id: ExportDataset
  name: string
  description: string
  format: ExportFormat
  includes: readonly string[]
  source: string
  minimumPlan: PlanTier
  locked: boolean
  /** Present only when locked — the cheapest plan that unlocks this download. */
  requiredPlan: PlanTier | null
  /** Real row estimate, or null when the count could not be read. */
  estimatedRows: number | null
  /** Epoch ms of the merchant's last download of this dataset, or null. */
  lastExportedAt: number | null
  /** False when there is nothing synced yet — the button explains why. */
  hasData: boolean
}>

export type ExportUsageView = Readonly<{
  plan: PlanTier
  used: number
  limit: number | null
  remaining: number | null
  unlimited: boolean
  limitReached: boolean
  periodStart: string
}>

export type ExportOverview = Readonly<{
  plan: PlanTier
  usage: ExportUsageView
  exports: readonly ExportCardView[]
  history: readonly ExportHistoryRecord[]
  features: Readonly<{ customDateRange: boolean; scheduledExports: boolean }>
  featureRequiredPlans: Readonly<{ customDateRange: PlanTier; scheduledExports: PlanTier }>
  rowCeiling: number
  generatedAt: string
}>

export type GeneratedExport = Readonly<{
  filename: string
  contentType: string
  bodyBase64: string
  rows: number
  bytes: number
  dataset: ExportDataset
  format: ExportFormat
  ceiling: number
  usage: ExportUsageView
  record: ExportHistoryRecord
}>

const HISTORY_LIMIT = 10

export class ExportsService {
  private readonly dependencies: ExportsServiceDependencies

  public constructor(dependencies: ExportsServiceDependencies) {
    this.dependencies = dependencies
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now()
  }

  /** Everything the Exports page renders, in one round trip. */
  public async overview(storeId: string): Promise<ExportOverview> {
    const plan = await this.dependencies.plan(storeId)
    const period = exportPeriodStart(this.now())
    const empty: Readonly<Partial<Record<ExportDataset, number>>> = {}
    const [used, estimates, lastExported, history] = await Promise.all([
      this.dependencies.history.countForPeriod(storeId, period),
      this.dependencies.data.estimates(storeId).catch(() => empty),
      this.dependencies.history.lastExportedByDataset(storeId).catch(() => empty),
      this.dependencies.history.list(storeId, HISTORY_LIMIT).catch((): readonly ExportHistoryRecord[] => []),
    ])
    const usage = usageView(plan, used, period)
    return {
      plan,
      usage,
      exports: EXPORT_DATASET_LIST.map((definition) => {
        const allowed = exportDatasetAllowed(plan, definition.id)
        const estimate = estimates[definition.id]
        return {
          id: definition.id,
          name: definition.name,
          description: definition.description,
          format: definition.format,
          includes: definition.includes,
          source: definition.source,
          minimumPlan: definition.minimumPlan,
          locked: !allowed,
          requiredPlan: allowed ? null : requiredPlanForDataset(definition.id),
          estimatedRows: typeof estimate === 'number' ? estimate : null,
          lastExportedAt: lastExported[definition.id] ?? null,
          hasData: typeof estimate === 'number' ? estimate > 0 : true,
        }
      }),
      history,
      features: {
        customDateRange: exportFeatureAllowed(plan, 'customDateRange'),
        scheduledExports: exportFeatureAllowed(plan, 'scheduledExports'),
      },
      featureRequiredPlans: {
        customDateRange: EXPORT_FEATURE_MINIMUM_PLAN.customDateRange,
        scheduledExports: EXPORT_FEATURE_MINIMUM_PLAN.scheduledExports,
      },
      rowCeiling: EXPORT_ROW_CEILING,
      generatedAt: new Date(this.now()).toISOString(),
    }
  }

  /**
   * Generates one real export file. Plan gating runs before any data is read
   * so a locked merchant never pays for a query they cannot download.
   */
  public async generate(storeId: string, dataset: ExportDataset, requestedRange: ExportDateRange = { from: null, to: null }): Promise<GeneratedExport> {
    const plan = await this.dependencies.plan(storeId)
    const definition = EXPORT_DATASET_DEFINITIONS[dataset]

    if (!exportDatasetAllowed(plan, dataset)) {
      const required = requiredPlanForDataset(dataset)
      throw new AppError('PAYMENT_REQUIRED', `${definition.name} is available on the ${planLabel(required)} plan. Upgrade Plan to download it.`, 402, {
        reason: 'UPGRADE_REQUIRED', feature: `export:${dataset}`, plan, requiredPlan: required,
      })
    }

    const period = exportPeriodStart(this.now())
    const used = await this.dependencies.history.countForPeriod(storeId, period)
    const limit = exportMonthlyLimit(plan)
    if (limit !== null && used >= limit) {
      throw new AppError('PAYMENT_REQUIRED', `You have used all ${limit} exports included this month. Upgrade Plan for more exports.`, 402, {
        reason: 'UPGRADE_REQUIRED', feature: 'export:monthly_limit', plan, used, limit,
      })
    }

    const range = this.resolveRange(plan, requestedRange)
    const rows = await this.dependencies.data.rows(storeId, dataset, range)
    if (rows.length === 0) {
      throw new AppError('NOT_FOUND', emptyMessage(dataset, range), 404, { reason: 'NO_DATA', dataset })
    }

    const file = write(definition.format, `${filenameStem(dataset, this.now())}-${randomUUID().slice(0, 8)}`, rows)
    const record = await this.dependencies.history.record({
      storeId,
      dataset,
      format: definition.format,
      filename: file.filename,
      rowCount: rows.length,
      byteSize: file.body.byteLength,
      plan,
      rangeStart: range.from,
      rangeEnd: range.to,
    })
    return {
      filename: file.filename,
      contentType: file.contentType,
      bodyBase64: file.body.toString('base64'),
      rows: rows.length,
      bytes: file.body.byteLength,
      dataset,
      format: definition.format,
      ceiling: EXPORT_ROW_CEILING,
      usage: usageView(plan, used + 1, period),
      record,
    }
  }

  /** Recent downloads for the Export History section. */
  public async history(storeId: string, limit = HISTORY_LIMIT): Promise<readonly ExportHistoryRecord[]> {
    return this.dependencies.history.list(storeId, limit)
  }

  /**
   * Custom date ranges are a Growth feature. Lower plans are not blocked from
   * exporting — the range is simply ignored, and the request is rejected only
   * when the merchant explicitly asked for one.
   */
  private resolveRange(plan: PlanTier, range: ExportDateRange): ExportDateRange {
    const asked = range.from !== null || range.to !== null
    if (!asked) return { from: null, to: null }
    if (!exportFeatureAllowed(plan, 'customDateRange')) {
      throw new AppError('PAYMENT_REQUIRED', 'Custom date ranges are available on the Growth plan. Upgrade Plan to choose your own dates.', 402, {
        reason: 'UPGRADE_REQUIRED', feature: 'export:custom_date_range', plan, requiredPlan: EXPORT_FEATURE_MINIMUM_PLAN.customDateRange,
      })
    }
    const from = normalizeDay(range.from, 'from')
    const to = normalizeDay(range.to, 'to')
    if (from && to && from > to) throw new AppError('VALIDATION_ERROR', 'The start date must be on or before the end date.', 400, { from, to })
    return { from, to }
  }
}

export function usageView(plan: PlanTier, used: number, periodStart: string): ExportUsageView {
  const limit = exportMonthlyLimit(plan)
  const remaining = exportsRemaining(plan, used)
  return {
    plan,
    used: Math.max(0, used),
    limit,
    remaining,
    unlimited: limit === null,
    limitReached: limit !== null && used >= limit,
    periodStart,
  }
}

function write(format: ExportFormat, stem: string, rows: readonly ExportRow[]): ExportFile {
  if (format === 'CSV') return writeCsv(`${stem}.csv`, rows)
  if (format === 'XLSX') return writeXlsx(`${stem}.xlsx`, rows)
  return writePdf(`${stem}.pdf`, rows)
}

function filenameStem(dataset: ExportDataset, now: number): string {
  const day = new Date(now).toISOString().slice(0, 10)
  const slug = { orders: 'orders-export', catalog: 'product-catalog', audit: 'activity-log', revenue: 'revenue-report' }[dataset]
  return `${slug}-${day}`
}

function emptyMessage(dataset: ExportDataset, range: ExportDateRange): string {
  const name = EXPORT_DATASET_DEFINITIONS[dataset].name
  if (range.from || range.to) return `There is no ${name.toLowerCase()} data in the dates you picked. Try a wider date range.`
  const hint = {
    orders: 'Sync your Shopify orders first, then download this file.',
    catalog: 'Sync your Shopify products first, then download this file.',
    audit: 'Your store has no recorded activity yet. Activity appears once ProfitPilot starts working on your store.',
    revenue: 'Revenue rows appear once a day of sales has closed and synced.',
  }[dataset]
  return `There is nothing to export yet. ${hint}`
}

function normalizeDay(value: string | null, field: string): string | null {
  if (value === null || value.trim() === '') return null
  const text = value.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new AppError('VALIDATION_ERROR', `The ${field} date must look like YYYY-MM-DD.`, 400, { [field]: value })
  }
  return text
}

export function planLabel(plan: PlanTier): string {
  return { trial: 'Trial', start: 'Start', growth: 'Growth', commander: 'Commander' }[plan]
}
