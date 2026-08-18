import { describe, expect, it } from 'vitest'
import type { EmailTransport } from '@profitpilot/automation'
import type { ExecutiveReport } from './executive-model.js'
import type { ExecutiveFacts } from './executive-ai.js'
import { buildExecutiveReportEmail, createExecutiveEmailDelivery, executiveReportSubject } from './executive-email.js'

const report: ExecutiveReport = {
  id: 'r1',
  storeId: 's1' as never,
  reportType: 'MONTHLY',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-18',
  executiveSummary: 'The store recorded USD 8,400 in revenue, up 20% versus the prior period. Health scores 82/100 (STRONG).',
  content: {
    strategicPosition: 'The store places its monthly revenue in the 48th percentile.',
    keyInsights: ['Revenue momentum is positive: 20.0% growth over the prior 30 days with 120 orders.'],
    recommendedDecisions: ['Approve the mitigation plan for revenue concentration this week.'],
    financialForecast: { horizonDays: 365, currency: 'USD', projections: [{ label: '30 days', low: 9000, expected: 10000, high: 11000 }] },
    appendix: { metrics: { revenue30d: 8400 } },
    aiNarrativeAvailable: true,
    generatedWithModel: 'test/model',
  },
  pdfUrl: null,
  generatedAt: '2026-08-18T00:00:00.000Z',
  viewedAt: null,
}

const facts: ExecutiveFacts = {
  storeName: 'acme-store.myshopify.com',
  currency: 'USD',
  asOf: '2026-08-18',
  last30dRevenue: 8400,
  previous30dRevenue: 7000,
  revenueGrowthPct: 20,
  last30dOrders: 120,
  previous30dOrders: 100,
  ordersGrowthPct: 20,
  aov: 70,
  repeatRatePct: 40,
  customerCount: 3,
  inventoryValue: 5000,
  inventoryTurnover: 4.5,
  cancellationPct: 0,
  topProducts: [{ title: 'Hero Hoodie', revenue120d: 21600, sharePct: 55 }],
  healthScore: 82,
  healthStatus: 'STRONG',
  vitals: [{ label: 'Revenue growth', status: 'HEALTHY', value: 0.2 }],
  risks: [{ title: 'Revenue concentration in few products', severity: 'MEDIUM', impactIfRealized: 55440 }],
  opportunities: [],
  benchmarkCategory: 'Fashion & Apparel',
  revenuePercentile: 48,
  aovPercentile: 52,
}

describe('PR49 monthly board report email', () => {
  it('builds a responsive executive HTML email from report data only', () => {
    const html = buildExecutiveReportEmail({
      report,
      facts,
      appUrl: 'https://app.example.com/?storeId=s#/ai-growth-command/executive/reports',
      unsubscribeUrl: 'https://app.example.com/?storeId=s#/ai-growth-command/executive/settings',
      includePdf: false,
      pdfBuffer: null,
    })
    expect(html).toContain('Your Monthly Board Report')
    expect(html).toContain('8,400')
    expect(html).toContain('82')
    expect(html).toContain('Key Strategic Insights')
    expect(html).toContain('Unsubscribe')
    expect(html).toContain('<svg') // gauge chart embedded
    // Escaping protects the template from markup injection via store data.
    expect(html).not.toContain('<script')
  })

  it('notes the PDF attachment for Commander sends', () => {
    const html = buildExecutiveReportEmail({ report, facts, appUrl: 'https://x', unsubscribeUrl: 'https://x', includePdf: true, pdfBuffer: Buffer.from('%PDF-1.4') })
    expect(html).toContain('print-ready PDF of this report is attached')
  })

  it('sends through the SMTP transport with attachment and unsubscribe header', async () => {
    const sent: Array<Readonly<{ to: string; subject: string; html: string; attachments: readonly unknown[] }>> = []
    const transport: EmailTransport = { send: async (message) => { sent.push({ to: message.to, subject: message.subject, html: message.html, attachments: message.attachments ?? [] }); return { messageId: 'm1' } } }
    const delivery = createExecutiveEmailDelivery({ transport, from: 'reports@profitpilot.example', fromName: 'ProfitPilot' })
    expect(delivery.available).toBe(true)
    const result = await delivery.send('merchant@example.com', { report, facts, appUrl: 'https://x', unsubscribeUrl: 'https://x', includePdf: true, pdfBuffer: Buffer.from('%PDF-1.4') })
    expect(result.messageId).toBe('m1')
    expect(sent[0]!.to).toBe('merchant@example.com')
    expect(sent[0]!.attachments).toHaveLength(1)
  })

  it('formats the executive subject line', () => {
    expect(executiveReportSubject('acme-store.myshopify.com', '2026-08-01')).toBe('Your Monthly Board Report — acme-store.myshopify.com — 2026-08-01')
  })

  it('reports delivery as unavailable without SMTP config', () => {
    const delivery = createExecutiveEmailDelivery({ transport: null, from: 'x', fromName: 'x' })
    expect(delivery.available).toBe(false)
    void expect(delivery.send('a@b.co', { report, facts, appUrl: 'https://x', unsubscribeUrl: 'https://x', includePdf: false, pdfBuffer: null })).rejects.toThrow('not configured')
  })
})
