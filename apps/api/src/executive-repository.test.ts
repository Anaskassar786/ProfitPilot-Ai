import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import { InMemoryExecutiveRepository } from './executive-repository.js'
import type { ExecutiveReport } from './executive-model.js'

const NOW = Date.parse('2026-08-18T12:00:00.000Z')
const repository = () => new InMemoryExecutiveRepository(() => NOW)

function reportInput(): Omit<ExecutiveReport, 'id' | 'storeId' | 'generatedAt' | 'viewedAt' | 'pdfUrl'> {
  return {
    reportType: 'MONTHLY',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-18',
    executiveSummary: 'Grounded summary.',
    content: {
      strategicPosition: null,
      keyInsights: ['Insight'],
      recommendedDecisions: ['Decision'],
      financialForecast: { horizonDays: 365, currency: 'USD', projections: [{ label: '30 days', low: 100, expected: 120, high: 140 }] },
      appendix: { metrics: { revenue30d: 120 } },
      aiNarrativeAvailable: false,
      generatedWithModel: null,
    },
  }
}

describe('PR49 executive repository (in-memory)', () => {
  it('creates, lists, and views reports per store', async () => {
    const repo = repository()
    const created = await repo.createReport(storeId('s1'), reportInput())
    expect(created.id).toBeTruthy()
    expect(created.viewedAt).toBeNull()
    const viewed = await repo.markReportViewed(storeId('s1'), created.id)
    expect(viewed?.viewedAt).not.toBeNull()
    expect(await repo.listReports(storeId('s1'), 10)).toHaveLength(1)
    expect(await repo.listReports(storeId('s2'), 10)).toHaveLength(0)
  })

  it('computes decision accuracy and lessons on review', async () => {
    const repo = repository()
    const decision = await repo.createDecision(storeId('s1'), {
      decisionType: 'PRICING',
      title: 'Raise prices 5%',
      description: '',
      decisionDate: '2026-08-01',
      predictedOutcome: { revenue: 1000 },
      actualOutcome: null,
      createdBy: 'merchant',
    })
    expect(decision.qualityRating).toBe('PENDING')
    const reviewed = await repo.reviewDecision(storeId('s1'), decision.id, { revenue: 900 })
    expect(reviewed?.accuracyScore).toBeCloseTo(0.9, 2)
    expect(reviewed?.qualityRating).toBe('EXCELLENT')
    expect(reviewed?.lessonsLearned.length).toBeGreaterThan(0)
    expect(reviewed?.reviewedAt).not.toBeNull()
  })

  it('reconciles risk scans: re-detected risks update, stale ones resolve', async () => {
    const repo = repository()
    const first = await repo.applyRiskScan(storeId('s1'), [
      { riskType: 'CONCENTRATION', title: 'Revenue concentration in few products', description: 'd', severity: 'MEDIUM', probability: 0.5, impactIfRealized: 1000, impactCurrency: 'USD', mitigationPlan: [] },
      { riskType: 'CASHFLOW', title: 'Order cancellation leakage', description: 'd', severity: 'LOW', probability: 0.2, impactIfRealized: 100, impactCurrency: 'USD', mitigationPlan: [] },
    ])
    expect(first.filter((risk) => risk.status === 'ACTIVE')).toHaveLength(2)
    const second = await repo.applyRiskScan(storeId('s1'), [
      { riskType: 'CONCENTRATION', title: 'Revenue concentration in few products', description: 'updated', severity: 'HIGH', probability: 0.7, impactIfRealized: 2000, impactCurrency: 'USD', mitigationPlan: [] },
    ])
    const active = second.filter((risk) => risk.status === 'ACTIVE')
    expect(active).toHaveLength(1)
    expect(active[0]!.severity).toBe('HIGH')
    expect(second.some((risk) => risk.title === 'Order cancellation leakage' && risk.status === 'RESOLVED')).toBe(true)
  })

  it('applies the milestone clock and computes roadmap progress', async () => {
    const repo = repository()
    const roadmap = await repo.createRoadmap(storeId('s1'), {
      roadmapType: '30_DAY',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      title: 'Plan',
      milestones: [
        { key: 'm1', title: 'One', description: '', dueDate: '2026-08-05', status: 'PENDING', successMetrics: [], dependencies: [] },
        { key: 'm2', title: 'Two', description: '', dueDate: '2026-08-12', status: 'PENDING', successMetrics: [], dependencies: ['m1'] },
      ],
      expectedOutcomes: [],
      confidenceScore: 0.5,
    })
    expect(roadmap.status).toBe('ACTIVE')
    expect(roadmap.currentProgress).toBe(0)
    expect(roadmap.milestones[0]!.status).toBe('CURRENT')
    const updated = await repo.updateRoadmap(storeId('s1'), roadmap.id, {
      milestones: roadmap.milestones.map((milestone) => ({ ...milestone, status: 'COMPLETE' as const })),
    })
    expect(updated?.currentProgress).toBe(1)
    expect(updated?.status).toBe('ACTIVE')
  })

  it('persists and defaults preferences, and selects due stores', async () => {
    const repo = repository()
    repo.seedPreference(storeId('s1'), { reportGenerationDay: 18, reportEmail: 'merchant@example.com' })
    repo.seedPreference(storeId('s2'), { reportGenerationDay: 5, monthlyReportEnabled: false })
    expect((await repo.getPreferences(storeId('s1'))).reportEmail).toBe('merchant@example.com')
    expect((await repo.getPreferences(storeId('s9'))).monthlyReportEnabled).toBe(true)
    const due = await repo.storesDueForMonthlyReport(18, '2026-08-01')
    expect(due).toContain(storeId('s1'))
    expect(due).not.toContain(storeId('s2'))
    // Generating the monthly report removes the store from the due list.
    await repo.createReport(storeId('s1'), reportInput())
    expect(await repo.storesDueForMonthlyReport(18, '2026-08-01')).not.toContain(storeId('s1'))
  })

  it('counts monthly usage across features', async () => {
    const repo = repository()
    await repo.createReport(storeId('s1'), reportInput())
    expect(await repo.countReportsThisMonth(storeId('s1'), '2026-08-01')).toBe(1)
    expect(await repo.countScenariosThisMonth(storeId('s1'), '2026-08-01')).toBe(0)
  })
})
