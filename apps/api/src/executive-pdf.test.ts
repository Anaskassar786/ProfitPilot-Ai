import { describe, expect, it } from 'vitest'
import { InMemoryExecutivePdfStore, EXECUTIVE_PDF_RETENTION_MS, renderExecutiveReportPdf } from './executive-pdf.js'
import type { ExecutivePdfInput } from './executive-pdf.js'
import type { ExecutiveReport } from './executive-model.js'

function input(whiteLabel: ExecutivePdfInput['whiteLabel'] = { brandName: null, logoText: null, primaryColor: null, footerText: null }): ExecutivePdfInput {
  const report: ExecutiveReport = {
    id: 'r1',
    storeId: 's1' as never,
    reportType: 'MONTHLY',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    executiveSummary: 'The store recorded USD 8,400 in revenue over the last 30 days, up 20% versus the prior period. Business health scores 82/100 (STRONG).',
    content: {
      strategicPosition: 'The store places its monthly revenue in the 48th percentile within Fashion & Apparel.',
      keyInsights: ['Revenue momentum is positive: 20.0% growth over the prior 30 days with 120 orders.', 'The risk radar\'s leading exposure is revenue concentration.'],
      recommendedDecisions: ['Approve the mitigation plan for revenue concentration this week.', 'Launch a second-purchase campaign for one-time buyers.'],
      financialForecast: { horizonDays: 365, currency: 'USD', projections: [{ label: '30 days', low: 9000, expected: 10000, high: 11000 }, { label: '90 days', low: 11000, expected: 13000, high: 15000 }, { label: '365 days', low: 20000, expected: 28000, high: 36000 }] },
      appendix: { metrics: { revenue30d: 8400, healthScore: 82 }, risks: { 'Revenue concentration in few products': 'MEDIUM · impact USD 55,440' } },
      aiNarrativeAvailable: true,
      generatedWithModel: 'test/model',
    },
    pdfUrl: null,
    generatedAt: '2026-08-18T00:00:00.000Z',
    viewedAt: null,
  }
  return {
    report,
    storeName: 'acme-store.myshopify.com',
    currency: 'USD',
    revenueSeries: [200, 240, 220, 280, 300, 310],
    healthScore: 82,
    healthStatus: 'STRONG',
    benchmarkCategory: 'Fashion & Apparel',
    revenuePercentile: 48,
    aovPercentile: 52,
    topProducts: [{ title: 'Hero Hoodie', revenue: 21600, sharePct: 55 }],
    whiteLabel,
  }
}

describe('PR49 investor PDF', () => {
  it('renders a valid multi-page PDF with cover, TOC, and sections', () => {
    const pdf = renderExecutiveReportPdf(input())
    const head = pdf.subarray(0, 8).toString()
    expect(head).toBe('%PDF-1.4')
    const text = pdf.toString('latin1')
    expect(text).toContain('/Type /Page')
    expect(text).toContain('/Type /Font')
    expect(text).toContain('Contents')
    expect(text).toContain('Business Health')
    expect(text).toContain('%%EOF')
    // At least cover + TOC + health + summary pages.
    expect(text.match(/\/Type \/Page[^s]/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('applies Commander white-label branding', () => {
    const pdf = renderExecutiveReportPdf(input({ brandName: 'Acme Holdings', logoText: 'AH', primaryColor: '#7C3AED', footerText: 'Confidential — Acme Holdings' }))
    const text = pdf.toString('latin1')
    expect(text).toContain('ACME HOLDINGS')
    expect(text).toContain('Confidential - Acme Holdings')
    expect(text).toContain('AH')
  })

  it('stores, retrieves, and sweeps files with 30-day retention', async () => {
    const store = new InMemoryExecutivePdfStore(() => 1_000)
    const body = renderExecutiveReportPdf(input())
    await store.put('s:r', body)
    expect((await store.get('s:r'))?.length).toBe(body.length)
    expect(await store.sweep(EXECUTIVE_PDF_RETENTION_MS, 1_000 + EXECUTIVE_PDF_RETENTION_MS + 1)).toBe(1)
    expect(await store.get('s:r')).toBeNull()
  })
})
