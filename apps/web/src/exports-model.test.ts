import { describe, expect, it } from 'vitest'
import {
  EXPORTS_UPGRADE_CTA,
  EXPORT_ROW_LIMIT_NOTE,
  datasetName,
  datasetTone,
  downloadButtonLabel,
  formatBytes,
  formatCount,
  formatTimestamp,
  hasLockedExports,
  lastExportedLabel,
  lockedMessage,
  lockedPreview,
  planLabel,
  rowEstimateLabel,
  successMessage,
  triggerDownload,
  usageHint,
  usageLabel,
  usagePercent,
} from './exports-model.js'
import type { ExportCard, ExportUsage, GeneratedExportResult } from './exports-model.js'
import {
  EXPORT_DATASET_DEFINITIONS,
  datasetsForPlan,
  exportDatasetAllowed,
  exportFeatureAllowed,
  exportMonthlyLimit,
  exportPeriodStart,
  exportsRemaining,
  isExportDataset,
  requiredPlanForDataset,
} from '@profitpilot/types'

/**
 * Data Exports — view-model contract.
 *
 * These lock in the merchant-facing wording, the plan matrix, and the number
 * formatting the page depends on. Anything that could quietly regress into
 * developer jargon or a fabricated number is asserted here.
 */

const usage = (overrides: Partial<ExportUsage> = {}): ExportUsage => ({
  plan: 'trial', used: 0, limit: 3, remaining: 3, unlimited: false, limitReached: false, periodStart: '2026-08-01', ...overrides,
})

const card = (overrides: Partial<ExportCard> = {}): ExportCard => ({
  id: 'orders',
  name: 'Orders Export',
  description: 'Daily order summaries from your Shopify sync.',
  format: 'CSV',
  includes: ['Order date', 'Orders placed'],
  source: 'Built from your synced Shopify orders.',
  minimumPlan: 'trial',
  locked: false,
  requiredPlan: null,
  estimatedRows: 120,
  lastExportedAt: null,
  hasData: true,
  ...overrides,
})

describe('plan matrix', () => {
  it('matches the published feature table for every dataset', () => {
    const matrix = {
      trial: ['orders', 'catalog'],
      start: ['orders', 'catalog', 'audit'],
      growth: ['orders', 'catalog', 'audit', 'revenue'],
      commander: ['orders', 'catalog', 'audit', 'revenue'],
    } as const
    for (const [plan, expected] of Object.entries(matrix)) {
      expect(datasetsForPlan(plan as keyof typeof matrix)).toEqual(expected)
    }
  })

  it('matches the published monthly allowances', () => {
    expect(exportMonthlyLimit('trial')).toBe(3)
    expect(exportMonthlyLimit('start')).toBe(10)
    expect(exportMonthlyLimit('growth')).toBeNull()
    expect(exportMonthlyLimit('commander')).toBeNull()
  })

  it('gates custom date range at Growth and scheduling at Commander', () => {
    expect(exportFeatureAllowed('start', 'customDateRange')).toBe(false)
    expect(exportFeatureAllowed('growth', 'customDateRange')).toBe(true)
    expect(exportFeatureAllowed('growth', 'scheduledExports')).toBe(false)
    expect(exportFeatureAllowed('commander', 'scheduledExports')).toBe(true)
  })

  it('names the cheapest unlocking plan for each locked dataset', () => {
    expect(requiredPlanForDataset('audit')).toBe('start')
    expect(requiredPlanForDataset('revenue')).toBe('growth')
    expect(exportDatasetAllowed('trial', 'revenue')).toBe(false)
  })

  it('counts remaining exports without going negative', () => {
    expect(exportsRemaining('trial', 1)).toBe(2)
    expect(exportsRemaining('trial', 9)).toBe(0)
    expect(exportsRemaining('growth', 99)).toBeNull()
  })

  it('buckets usage into a UTC calendar month', () => {
    expect(exportPeriodStart(Date.UTC(2026, 7, 18))).toBe('2026-08-01')
    expect(exportPeriodStart(Date.UTC(2026, 0, 1))).toBe('2026-01-01')
  })

  it('validates dataset ids from the wire', () => {
    expect(isExportDataset('orders')).toBe(true)
    expect(isExportDataset('customers')).toBe(false)
  })
})

describe('merchant language', () => {
  it('uses human names, never technical ones', () => {
    expect(Object.values(EXPORT_DATASET_DEFINITIONS).map((definition) => definition.name))
      .toEqual(['Orders Export', 'Product Catalog', 'Activity Log', 'Revenue Report'])
  })

  it('avoids developer jargon in every card description', () => {
    const jargon = /tenant|scoped|aggregate|writer|ceiling|deterministic|payload|schema/i
    for (const definition of Object.values(EXPORT_DATASET_DEFINITIONS)) {
      expect(definition.description).not.toMatch(jargon)
      expect(definition.name).not.toMatch(jargon)
    }
  })

  it('keeps the row limit note informational, not scary', () => {
    expect(EXPORT_ROW_LIMIT_NOTE).toContain('up to 50,000 rows')
    expect(EXPORT_ROW_LIMIT_NOTE).toContain('Larger stores may need multiple exports')
    expect(EXPORT_ROW_LIMIT_NOTE).not.toMatch(/ceiling|safety limit|stall/i)
  })

  it('always says "Upgrade Plan" — never "Upgrade to <tier>"', () => {
    expect(EXPORTS_UPGRADE_CTA).toBe('Upgrade Plan')
    expect(downloadButtonLabel(card({ locked: true }), false)).toBe('Upgrade Plan')
    expect(usageHint(usage({ limitReached: true }))).toContain('Upgrade Plan')
    expect(usageHint(usage({ limitReached: true }))).not.toMatch(/upgrade to/i)
  })

  it('says which plan unlocks a locked card', () => {
    expect(lockedMessage('start')).toBe('Available on Start plan')
    expect(lockedMessage('growth')).toBe('Available on Growth plan')
    expect(planLabel('commander')).toBe('Commander')
  })
})

describe('usage presentation', () => {
  it('shows a used/limit counter for metered plans', () => {
    expect(usageLabel(usage({ used: 1 }))).toBe('Exports this month: 1/3')
    expect(usagePercent(usage({ used: 1 }))).toBe(33)
  })

  it('shows unlimited without inventing a cap', () => {
    const unlimited = usage({ plan: 'growth', limit: null, remaining: null, unlimited: true, used: 7 })
    expect(usageLabel(unlimited)).toBe('Exports this month: 7 · Unlimited')
    expect(usagePercent(unlimited)).toBe(0)
    expect(usageHint(unlimited)).toBe('Your plan includes unlimited exports.')
  })

  it('explains the remaining allowance in plain words', () => {
    expect(usageHint(usage({ used: 2, remaining: 1 }))).toContain('1 export left this month')
    expect(usageHint(usage({ used: 0, remaining: 3 }))).toContain('3 exports left this month')
  })
})

describe('card details', () => {
  it('reports a real row estimate, or says it is not counted', () => {
    expect(rowEstimateLabel(120)).toBe('~120 rows')
    expect(rowEstimateLabel(0)).toBe('No rows yet')
    expect(rowEstimateLabel(null)).toBe('Not counted yet')
    expect(rowEstimateLabel(1_248)).toBe('~1,248 rows')
  })

  it('says Never before the first download and a compact date afterwards', () => {
    expect(lastExportedLabel(null)).toBe('Never')
    // Compact on the card (shares a row with its label); the full form with the
    // year is reserved for Export History, which has room for it.
    expect(lastExportedLabel(Date.UTC(2026, 7, 18, 14, 30))).toMatch(/^Aug 18, \d{1,2}:\d{2} (AM|PM)$/)
    expect(lastExportedLabel(Date.UTC(2026, 7, 18, 14, 30))).not.toContain('2026')
    expect(formatTimestamp(Date.UTC(2026, 7, 18, 14, 30))).toContain('Aug 18, 2026 at')
    expect(lastExportedLabel(Number.NaN)).toBe('Unknown')
  })

  it('labels the button for every state', () => {
    expect(downloadButtonLabel(card(), false)).toBe('Download Now')
    expect(downloadButtonLabel(card(), true)).toBe('Preparing…')
    expect(downloadButtonLabel(card({ hasData: false }), false)).toBe('Nothing to export yet')
    expect(downloadButtonLabel(card({ locked: true }), true)).toBe('Upgrade Plan')
  })

  it('previews what a locked card would deliver', () => {
    expect(lockedPreview(card({ locked: true, includes: ['Action', 'When'] }))).toEqual(['Action', 'When'])
    expect(hasLockedExports([card(), card({ id: 'revenue', locked: true })])).toBe(true)
    expect(hasLockedExports([card()])).toBe(false)
  })

  it('gives each export its own accent so the grid is not four identical cards', () => {
    const tones = (['orders', 'catalog', 'audit', 'revenue'] as const).map(datasetTone)
    expect(new Set(tones).size).toBe(4)
  })

  it('names datasets for history rows and toasts', () => {
    expect(datasetName('audit')).toBe('Activity Log')
    expect(datasetName('revenue')).toBe('Revenue Report')
  })
})

describe('formatting', () => {
  it('formats file sizes the way an operating system does', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(24_576)).toBe('24 KB')
    expect(formatBytes(1_500)).toBe('1.5 KB')
    expect(formatBytes(3_145_728)).toBe('3.0 MB')
  })

  it('formats counts with thousands separators', () => {
    expect(formatCount(50_000)).toBe('50,000')
    expect(formatCount(-4)).toBe('0')
  })

  it('formats a download timestamp without crashing on bad input', () => {
    expect(formatTimestamp(Number.NaN)).toBe('Unknown')
    expect(formatTimestamp(Date.UTC(2026, 7, 18, 9, 5))).toContain('Aug 18, 2026')
  })

  it('confirms a completed download with real numbers', () => {
    const result = { dataset: 'orders', rows: 120, bytes: 24_576 } as GeneratedExportResult
    expect(successMessage(result)).toBe('Orders Export downloaded — 120 rows, 24 KB.')
  })
})

describe('download delivery', () => {
  it('writes a blob and clicks a real anchor', () => {
    const created: string[] = []
    const revoked: string[] = []
    const anchor = { href: '', download: '', rel: '', clicked: 0, click() { this.clicked += 1 }, remove() { /* detached */ } }
    const doc = {
      createElement: () => anchor as unknown as HTMLAnchorElement,
      body: { appendChild: () => undefined },
    } as unknown as Document
    const urls = {
      createObjectURL: () => { created.push('blob:x'); return 'blob:x' },
      revokeObjectURL: (url: string) => { revoked.push(url) },
    } as unknown as typeof URL

    const delivered = triggerDownload(
      { filename: 'orders-export.csv', contentType: 'text/csv', bodyBase64: Buffer.from('a,b\n1,2').toString('base64') },
      { atob: (value: string) => Buffer.from(value, 'base64').toString('binary'), URL: urls, document: doc },
    )

    expect(delivered).toBe(true)
    expect(anchor.download).toBe('orders-export.csv')
    expect(anchor.clicked).toBe(1)
    expect(created).toHaveLength(1)
    expect(revoked).toEqual(['blob:x'])
  })

  it('reports failure instead of throwing when the browser cannot download', () => {
    const noBrowser = {} as Readonly<{ atob?: typeof atob; URL?: typeof URL; document?: Document }>
    expect(triggerDownload({ filename: 'a.csv', contentType: 'text/csv', bodyBase64: '' }, noBrowser)).toBe(false)
  })
})
