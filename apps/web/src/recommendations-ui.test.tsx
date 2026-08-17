import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AllClearState, ApproveConfirmSheet, FirstRunState, HowItWorksModal, InsightsSidebar, KpiHero, RecommendationCard, RejectReasonSheet } from './recommendations.js'
import { usageState } from './recommendations-model.js'
import type { RecommendationSummary, RecommendationView } from './recommendations-model.js'

const noop = vi.fn()

function view(overrides: Partial<RecommendationView> = {}): RecommendationView {
  return { id: 'r1', storeId: 's', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Reorder Hoodie before stockout', reason: 'Hoodie has 3.2 days of cover at current velocity.', impactValue: 420, impactLabel: 'revenue at risk', currency: 'USD', confidence: .72, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.0.0', sha256: 'abc' }, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), entityKey: 'p1', expiresAt: null, decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null, ...overrides }
}

function summary(overrides: Partial<RecommendationSummary> = {}): RecommendationSummary {
  return {
    counts: { PENDING: 2, APPROVED: 3, REJECTED: 1, EXECUTED: 0, FAILED: 0, EXPIRED: 0 },
    total: 6,
    pendingImpact: [{ currency: 'USD', value: 840 }],
    approvedThisMonth: { count: 3, impact: [{ currency: 'USD', value: 512 }] },
    byAgent: [{ agent: 'INVENTORY_AGENT', pending: 2, approved: 1, rejected: 0, total: 3 }],
    byRule: [{ ruleId: 'STOCKOUT_RISK', total: 3 }],
    approvalRate: { allTime: 75, last30d: 80 },
    averageDecisionMs: 5_400_000,
    recentDecisions: [view({ id: 'd1', status: 'APPROVED', decidedAt: new Date().toISOString() })],
    generatedTrend: [{ day: '2026-08-14', generated: 3, approved: 2 }],
    plan: 'trial',
    usage: { feature: 'ai_recommendations_month', used: 4, limit: 10, remaining: 6 },
    ...overrides,
  }
}

function card(recommendation: RecommendationView, extra: Partial<Parameters<typeof RecommendationCard>[0]> = {}): string {
  return renderToStaticMarkup(createElement(RecommendationCard, { recommendation, maxImpact: 1000, selected: false, onSelect: noop, onEvidence: noop, onApprove: noop, onReject: noop, onSnooze: noop, onCopyLink: noop, undoAvailable: false, onUndo: noop, ...extra }))
}

describe('RecommendationCard humanization (regression: no enum leakage)', () => {
  it('renders humanized agent, rule, and status', () => {
    const html = card(view())
    expect(html).toContain('Inventory Agent')
    expect(html).toContain('Stockout Risk')
    expect(html).not.toContain('INVENTORY_AGENT')
    expect(html).not.toContain('STOCKOUT_RISK v')
    expect(html).not.toContain('AI_UNAVAILABLE')
  })
  it('shows the humanized AI badge for unavailable explanations', () => {
    expect(card(view({ explanationStatus: 'AI_UNAVAILABLE' }))).toContain('AI explanation unavailable')
    expect(card(view({ explanationStatus: 'AI_REJECTED' }))).toContain('AI output filtered')
    expect(card(view({ explanationStatus: 'AI_GENERATED', explanation: 'Grounded words.' }))).not.toContain('AI explanation unavailable')
  })
  it('formats impact in the recommendation currency', () => {
    expect(card(view({ impactValue: 420, currency: 'EUR' }))).toContain('€420')
    expect(card(view({ impactValue: 420, currency: 'USD' }))).toContain('$420')
  })
  it('shows relative time and confidence percent', () => {
    const html = card(view())
    expect(html).toContain('2h ago')
    expect(html).toContain('72%')
    expect(html).toContain('Medium')
  })
  it('labels high-risk approvals as Review & Approve', () => {
    const html = card(view({ actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED' }))
    expect(html).toContain('Review &amp; Approve')
    expect(html).toContain('Requires approval')
    expect(html).not.toContain('APPROVAL_REQUIRED')
  })
  it('shows expiry urgency badges', () => {
    const html = card(view({ expiresAt: new Date(Date.now() + 6 * 3_600_000).toISOString() }))
    expect(html).toMatch(/Expires in \d+h/)
  })
  it('renders decided states with reasons and undo', () => {
    const rejected = card(view({ status: 'REJECTED', rejectReason: 'BAD_TIMING', decidedAt: new Date().toISOString() }))
    expect(rejected).toContain('Rejected')
    expect(rejected).toContain('Bad timing')
    const approved = card(view({ status: 'APPROVED', decidedAt: new Date().toISOString() }), { undoAvailable: true })
    expect(approved).toContain('Undo')
  })
  it('masks entity keys instead of printing raw identifiers', () => {
    const html = card(view({ entityKey: 'gid-shopify-customer-1234567890', agent: 'CUSTOMER_AGENT' }))
    expect(html).toContain('Customer …')
    expect(html).not.toContain('gid-shopify-customer-1234567890')
  })
})

describe('KPI hero', () => {
  it('renders real summary values with plan usage', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary(), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('$840')
    expect(html).toContain('4/10')
    expect(html).toContain('Trial plan')
    expect(html).toContain('80%')
    expect(html).toContain('1h 30m')
  })
  it('never mixes currencies in pending impact', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ pendingImpact: [{ currency: 'USD', value: 100 }, { currency: 'EUR', value: 50 }] }), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('$100 + €50')
  })
  it('shows unlimited for commander', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ plan: 'commander', usage: { feature: 'ai_recommendations_month', used: 42, limit: null, remaining: null } }), usage: usageState(42, null), plan: 'commander', onUpgrade: noop }))
    expect(html).toContain('Unlimited on Commander plan')
    expect(html).not.toContain('Upgrade for more')
  })
})

describe('empty states', () => {
  it('first-run state teaches the eight rules and offers Run Analysis', () => {
    const html = renderToStaticMarkup(createElement(FirstRunState, { onAnalyze: noop, analyzing: false, onHow: noop }))
    expect(html).toContain('Your AI team is ready to work')
    expect(html).toContain('Run Analysis')
    expect(html).toContain('Stockout Risk')
    expect(html).toContain('Cart Abandonment')
    expect(html).toContain('never invents a recommendation')
  })
  it('all-clear state frames a healthy store positively', () => {
    const html = renderToStaticMarkup(createElement(AllClearState, { summary: summary({ total: 0, usage: { feature: 'ai_recommendations_month', used: 3, limit: 10, remaining: 7 } }) }))
    expect(html).toContain('All clear')
    expect(html).toContain('healthy store')
    expect(html).toContain('3 recommendations generated this month')
  })
})

describe('decision sheets', () => {
  it('approve sheet previews the concrete action', () => {
    const html = renderToStaticMarkup(createElement(ApproveConfirmSheet, { recommendation: view({ actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED' }), onCancel: noop, onConfirm: noop }))
    expect(html).toContain('Confirm &amp; Approve')
    expect(html).toContain('draft email')
    expect(html).toContain('Requires approval')
  })
  it('reject sheet offers the calibration reasons and a skip path', () => {
    const html = renderToStaticMarkup(createElement(RejectReasonSheet, { recommendation: view(), onCancel: noop, onReject: noop }))
    for (const label of ['Wrong data', 'Not relevant', 'Bad timing', 'Already handled', 'Other', 'Reject without reason']) expect(html).toContain(label)
  })
})

describe('insights sidebar', () => {
  it('renders donut legend, trend, top rules, and decisions from real summary data', () => {
    const html = renderToStaticMarkup(createElement(InsightsSidebar, { summary: summary(), onFilterAgent: noop }))
    expect(html).toContain('Pending by agent')
    expect(html).toContain('Inventory Agent')
    expect(html).toContain('30-day activity')
    expect(html).toContain('Top rules firing')
    expect(html).toContain('Recent decisions')
  })
  it('shows honest empties instead of fake chart data', () => {
    const html = renderToStaticMarkup(createElement(InsightsSidebar, { summary: summary({ byAgent: [], byRule: [], recentDecisions: [], generatedTrend: [], counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 } }), onFilterAgent: noop }))
    expect(html).toContain('No pending recommendations right now')
    expect(html).toContain('Activity appears after your first analysis run')
  })
})

describe('how-it-works modal', () => {
  it('explains rules, evidence, calibration, and the FAQ', () => {
    const html = renderToStaticMarkup(createElement(HowItWorksModal, { onClose: noop }))
    expect(html).toContain('Eight deterministic rules')
    expect(html).toContain('SHA-256')
    expect(html).toContain('calibrated by your decisions')
    expect(html).toContain('FAQ')
    expect(html).toContain('monthly limit')
  })
})
