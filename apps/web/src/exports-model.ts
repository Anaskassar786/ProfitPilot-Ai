import { EXPORT_DATASET_DEFINITIONS, EXPORT_ROW_CEILING } from '@profitpilot/types'
import type { ExportDataset, ExportFormat, PlanTier } from '@profitpilot/types'

/**
 * Data Exports — client-side view model.
 *
 * Pure functions only: formatting, plan copy, and the small amount of derived
 * state the page needs. Every number that reaches these helpers came from
 * `/exports/overview`; nothing here invents a row count, a date, or a quota.
 */

export type ExportCard = Readonly<{
  id: ExportDataset
  name: string
  description: string
  format: ExportFormat
  includes: readonly string[]
  source: string
  minimumPlan: PlanTier
  locked: boolean
  requiredPlan: PlanTier | null
  estimatedRows: number | null
  lastExportedAt: number | null
  hasData: boolean
}>

export type ExportUsage = Readonly<{
  plan: PlanTier
  used: number
  limit: number | null
  remaining: number | null
  unlimited: boolean
  limitReached: boolean
  periodStart: string
}>

export type ExportHistoryEntry = Readonly<{
  id: string
  dataset: ExportDataset
  format: ExportFormat
  filename: string
  rowCount: number
  byteSize: number
  plan: PlanTier
  rangeStart: string | null
  rangeEnd: string | null
  createdAt: number
}>

export type ExportsOverview = Readonly<{
  plan: PlanTier
  usage: ExportUsage
  exports: readonly ExportCard[]
  history: readonly ExportHistoryEntry[]
  features: Readonly<{ customDateRange: boolean; scheduledExports: boolean }>
  featureRequiredPlans: Readonly<{ customDateRange: PlanTier; scheduledExports: PlanTier }>
  rowCeiling: number
  generatedAt: string
}>

export type GeneratedExportResult = Readonly<{
  filename: string
  contentType: string
  bodyBase64: string
  rows: number
  bytes: number
  dataset: ExportDataset
  format: ExportFormat
  ceiling: number
  usage: ExportUsage
  record: ExportHistoryEntry
}>

/** The generic upgrade CTA. Never "Upgrade to Growth" — always "Upgrade Plan". */
export const EXPORTS_UPGRADE_CTA = 'Upgrade Plan'

export const EXPORT_ROW_LIMIT_NOTE = `Each export includes up to ${formatCount(EXPORT_ROW_CEILING)} rows for performance. Larger stores may need multiple exports.`

export function planLabel(plan: PlanTier): string {
  return { trial: 'Trial', start: 'Start', growth: 'Growth', commander: 'Commander' }[plan]
}

/** "Available on Start plan" — the lock message on a gated card. */
export function lockedMessage(requiredPlan: PlanTier): string {
  return `Available on ${planLabel(requiredPlan)} plan`
}

/** Plan-banner usage line: "Exports this month: 1/3" or "Unlimited exports". */
export function usageLabel(usage: ExportUsage): string {
  if (usage.unlimited) return `Exports this month: ${formatCount(usage.used)} · Unlimited`
  return `Exports this month: ${formatCount(usage.used)}/${formatCount(usage.limit ?? 0)}`
}

/** Percent of the monthly allowance used, 0 when unlimited. */
export function usagePercent(usage: ExportUsage): number {
  if (usage.unlimited || !usage.limit) return 0
  return Math.max(0, Math.min(100, Math.round((usage.used / usage.limit) * 100)))
}

/** Short helper under the usage meter — reassuring, never scary. */
export function usageHint(usage: ExportUsage): string {
  if (usage.unlimited) return 'Your plan includes unlimited exports.'
  if (usage.limitReached) return 'You have used every export included this month. Upgrade Plan for more exports.'
  const remaining = usage.remaining ?? 0
  return `${formatCount(remaining)} export${remaining === 1 ? '' : 's'} left this month. Your allowance resets on the 1st.`
}

/** "~120 rows" for the card, or an honest placeholder. */
export function rowEstimateLabel(rows: number | null): string {
  if (rows === null) return 'Not counted yet'
  if (rows === 0) return 'No rows yet'
  return `~${formatCount(rows)} rows`
}

/**
 * Compact "Aug 18, 2:30 PM" for the export card, where the value shares a row
 * with its label — the full "Aug 18, 2026 at 2:30 PM" form is used in Export
 * History, which has the width for it. Returns "Never" before a first export.
 */
export function lastExportedLabel(timestamp: number | null): string {
  if (timestamp === null) return 'Never'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day}, ${time}`
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} at ${time}`
}

/** Human file size: "24 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)))
}

/** Human name for a dataset, used by history rows and toasts. */
export function datasetName(dataset: ExportDataset): string {
  return EXPORT_DATASET_DEFINITIONS[dataset].name
}

/** Accent token per export type so each card reads distinctly in both themes. */
export function datasetTone(dataset: ExportDataset): 'blue' | 'violet' | 'teal' | 'amber' {
  return { orders: 'blue', catalog: 'violet', audit: 'teal', revenue: 'amber' }[dataset] as 'blue' | 'violet' | 'teal' | 'amber'
}

/** Button label reflects lock, empty data, and in-flight states. */
export function downloadButtonLabel(card: ExportCard, busy: boolean): string {
  if (card.locked) return EXPORTS_UPGRADE_CTA
  if (busy) return 'Preparing…'
  if (!card.hasData) return 'Nothing to export yet'
  return 'Download Now'
}

/** Success confirmation copy after a file lands in the browser. */
export function successMessage(result: GeneratedExportResult): string {
  return `${datasetName(result.dataset)} downloaded — ${formatCount(result.rows)} row${result.rows === 1 ? '' : 's'}, ${formatBytes(result.bytes)}.`
}

/** Turns a base64 payload into a real browser download. Returns false if unsupported. */
export function triggerDownload(
  result: Readonly<{ filename: string; contentType: string; bodyBase64: string }>,
  scope: Readonly<{ atob?: typeof atob; URL?: typeof URL; document?: Document }> = {},
): boolean {
  const decode = scope.atob ?? (typeof atob === 'function' ? atob : null)
  const urls = scope.URL ?? (typeof URL !== 'undefined' ? URL : null)
  const doc = scope.document ?? (typeof document !== 'undefined' ? document : null)
  if (!decode || !urls || !doc || typeof urls.createObjectURL !== 'function') return false
  const binary = decode(result.bodyBase64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const url = urls.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: result.contentType }))
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = result.filename
  anchor.rel = 'noopener'
  doc.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  urls.revokeObjectURL(url)
  return true
}

/** True when the plan has at least one locked export left to unlock. */
export function hasLockedExports(cards: readonly ExportCard[]): boolean {
  return cards.some((card) => card.locked)
}

/** Preview bullets shown inside a locked card so the value is visible. */
export function lockedPreview(card: ExportCard): readonly string[] {
  return card.includes
}
