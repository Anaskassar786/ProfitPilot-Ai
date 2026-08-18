import { describe, expect, it } from 'vitest'
import type { AnalyticsSnapshot } from './model.js'
import type { ForecastBundle, ReportRun } from './f8-model.js'
import {
  buildReportPreview,
  canGenerateReport,
  closedPeriodFor,
  countReportsInWindow,
  forecastReadiness,
  formatBytes,
  formatPeriodRange,
  higherPlanHighlights,
  looksLikeRawFilename,
  planDisplayName,
  reportAccessFor,
  reportDisplayName,
  reportStatusView,
  resolveReportPlan,
  usageCopy,
} from './reports-model.js'

const run = (patch: Partial<ReportRun> = {}): ReportRun => ({
  id: 'run-1',
  storeId: 'store-1',
  frequency: 'MONTHLY',
  period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-17T23:59:59.000Z' },
  idempotencyKey: 'MONTHLY:2026-08-01:2026-08-17',
  filename: 'c31f6b31-bbd0-4781-9f61-13a64338282b-weekly-2026-08-08-2026-08.pdf',
  objectKey: 'reports/store-1/file.pdf',
  contentSha256: 'abc',
  status: 'COMPLETED',
  emailStatus: 'NOT_REQUESTED',
  createdAt: Date.parse('2026-08-18T10:00:00.000Z'),
  completedAt: Date.parse('2026-08-18T10:00:01.000Z'),
  ...patch,
})

describe('Reports plan gating', () => {
  it('resolves unknown plans to trial and never invents a paid tier', () => {
    expect(resolveReportPlan(undefined)).toBe('trial')
    expect(resolveReportPlan('COMMANDER')).toBe('commander')
    expect(resolveReportPlan('not-a-plan')).toBe('trial')
    expect(planDisplayName('trial')).toBe('Trial')
  })

  it('enforces Trial 1/month, Start 3/month + 1/quarter, Growth custom + email', () => {
    expect(reportAccessFor('trial')).toMatchObject({ monthlyLimit: 1, quarterlyLimit: 0, custom: false, email: false, pdf: true })
    expect(reportAccessFor('start')).toMatchObject({ monthlyLimit: 3, quarterlyLimit: 1, custom: false, email: false })
    expect(reportAccessFor('growth')).toMatchObject({ monthlyLimit: null, custom: true, email: true, whiteLabel: false })
    expect(reportAccessFor('commander')).toMatchObject({ email: true, whiteLabel: true, apiAccess: true })
  })

  it('blocks a second Trial monthly report in the same month', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const existing = [run({ createdAt: Date.parse('2026-08-05T00:00:00.000Z') })]
    const blocked = canGenerateReport('trial', 'MONTHLY', existing, now)
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toContain('Upgrade Plan')
    expect(blocked.reason).not.toMatch(/Growth|Commander|Start/i)
    expect(canGenerateReport('trial', 'QUARTERLY', [], now).allowed).toBe(false)
    expect(canGenerateReport('start', 'CUSTOM', [], now).allowed).toBe(false)
    expect(canGenerateReport('growth', 'CUSTOM', [], now).allowed).toBe(true)
  })

  it('counts only successful monthly reports inside the current UTC month', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const runs = [
      run({ createdAt: Date.parse('2026-08-02T00:00:00.000Z') }),
      run({ createdAt: Date.parse('2026-07-30T00:00:00.000Z') }),
      run({ status: 'FAILED', createdAt: Date.parse('2026-08-03T00:00:00.000Z') }),
    ]
    expect(countReportsInWindow(runs, 'MONTHLY', now)).toBe(1)
    expect(usageCopy('trial', runs, now)).toBe('Reports this month: 1/1 used')
    expect(usageCopy('growth', [], now)).toContain('Unlimited')
  })
})

describe('Human-readable report names', () => {
  it('never surfaces a UUID as the merchant-facing title', () => {
    expect(reportDisplayName(run())).toBe('Monthly Report — August 2026')
    expect(reportDisplayName(run({ frequency: 'QUARTERLY', period: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-17T23:59:59.000Z' } }))).toBe('Quarterly Report — Q3 2026')
    expect(reportDisplayName(run({ period: { start: '2026-08-04T00:00:00.000Z', end: '2026-08-12T23:59:59.000Z' } }))).toBe('Custom Report — Aug 4 – Aug 12, 2026')
    expect(looksLikeRawFilename(run().filename)).toBe(true)
    expect(looksLikeRawFilename('Monthly Report — August 2026')).toBe(false)
  })

  it('formats closed periods and file sizes without inventing values', () => {
    expect(formatPeriodRange('2026-08-01', '2026-08-18')).toContain('Aug')
    expect(formatBytes(null)).toBeNull()
    expect(formatBytes(2048)).toBe('2.0 KB')
  })

  it('maps statuses to merchant language instead of vault jargon', () => {
    expect(reportStatusView(run()).label).toBe('Ready')
    expect(reportStatusView(run({ status: 'GENERATING' })).label).toBe('Generating…')
    expect(reportStatusView(run({ status: 'FAILED' })).tone).toBe('failed')
    expect(reportStatusView(run({ emailStatus: 'SENT' })).tone).toBe('emailed')
  })
})

describe('Closed periods and preview', () => {
  it('builds monthly and custom ranges that end before today', () => {
    const now = new Date('2026-08-18T15:00:00.000Z')
    const monthly = closedPeriodFor('MONTHLY', now)
    expect(monthly.start.startsWith('2026-08-01')).toBe(true)
    expect(monthly.end.startsWith('2026-08-17')).toBe(true)
    const custom = closedPeriodFor('CUSTOM', now, { start: '2026-08-01', end: '2026-08-10' })
    expect(custom.label).toContain('Aug')
    expect(() => closedPeriodFor('CUSTOM', now, { start: '2026-08-18', end: '2026-08-19' })).toThrow(/closed/)
  })

  it('previews only real analytics rows and leaves missing metrics unmeasurable', () => {
    const analytics: AnalyticsSnapshot = {
      revenue: [{ storeId: 'store-1', day: '2026-08-02', grossRevenue: 189, discounts: 0, orderCount: 2 }],
      orders: [{ storeId: 'store-1', day: '2026-08-02', orderCount: 2, fulfilledCount: 2, cancelledCount: 0, averageOrderValue: 94.5 }],
      productSales: [{ storeId: 'store-1', day: '2026-08-02', productId: 'sku-1', unitsSold: 3, grossRevenue: 189 }],
      customerCohorts: [{ storeId: 'store-1', cohortDay: '2026-07-01', activityDay: '2026-08-02', customerCount: 4, grossRevenue: 189 }],
    }
    const forecast: ForecastBundle = {
      storeId: 'store-1',
      generatedAt: '2026-08-18T00:00:00.000Z',
      dataAvailable: true,
      revenue: { value: 200, lower: 150, upper: 260, seasonalityIndex: 1, method: { method: 'holt', version: '1' } },
      demand: [{ productId: 'sku-1', title: 'Canvas tote', forecast: { value: 3, lower: 1, upper: 5, dailyVelocity: 1, method: { method: 'holt', version: '1' } } }],
      stockout: [],
      churn: [{ customerKey: 'c1', segment: 'repeat', churnRisk: 0.7 }],
      methods: [{ method: 'holt', version: '1' }],
    }
    const preview = buildReportPreview(run(), analytics, forecast)
    expect(preview.dataAvailable).toBe(true)
    expect(preview.metrics[0]?.value).toContain('189')
    expect(preview.topProducts[0]?.title).toBe('Canvas tote')
    expect(preview.summary).not.toMatch(/\$9,999|lorem/i)
    const empty = buildReportPreview(run(), { revenue: [], orders: [], productSales: [], customerCohorts: [] }, null)
    expect(empty.dataAvailable).toBe(false)
    expect(empty.metrics[0]?.value).toBeNull()
    expect(forecastReadiness(null).ready).toBe(false)
    expect(forecastReadiness(forecast).ready).toBe(true)
  })

  it('lists upgrade highlights without naming a required plan in the CTA copy helper', () => {
    expect(higherPlanHighlights('trial').join(' ')).not.toMatch(/Growth|Commander/)
    expect(higherPlanHighlights('commander')).toEqual([])
  })
})
