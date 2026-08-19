import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AllClearState,
  AnalysisProgressModal,
  AnalysisReportPanel,
  ApproveConfirmSheet,
  FirstRunState,
  HowItWorksModal,
  InsightsSidebar,
  KpiHero,
  RecommendationCard,
  RejectReasonSheet,
  RuleDetailModal,
  SampleRecommendationPreview,
  Tip,
} from './recommendations.js'
import { usageState } from './recommendations-model.js'
import type { AnalysisReport, RecommendationSummary, RecommendationView } from './recommendations-model.js'

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

function report(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    storeId: 's',
    generatedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    elapsedMs: 4_200,
    recommendations: [],
    deduplicated: 0,
    rulesChecked: 8,
    health: { score: 84, method: 'deterministic-v1' },
    snapshotStats: { products: 42, customers: 128, checkouts: 7, orders: 913, dataFreshAt: new Date().toISOString(), currency: 'USD' },
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
    expect(html).toContain('Stockout Alerts')
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
  it('uses merchant-friendly KPI labels and hover tooltips on every card', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary(), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('Revenue opportunity pending')
    expect(html).not.toContain('Pending impact')
    // Every KPI card carries an explanatory tooltip
    expect((html.match(/role="tooltip"/g) ?? []).length).toBe(5)
    expect(html).toContain('The money sitting in recommendations you have not reviewed yet')
    expect(html).toContain('higher rate means your AI team is suggesting things worth doing')
  })
  it('shows honest empty states when there is nothing to measure', () => {
    const empty = summary({ counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 }, total: 0, pendingImpact: [], approvedThisMonth: { count: 0, impact: [] }, approvalRate: { allTime: null, last30d: null }, averageDecisionMs: null, recentDecisions: [] })
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: empty, usage: usageState(0, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('No pending recommendations yet')
    expect(html).toContain('Approve recommendations to see the impact here')
    expect(html).toContain('Need decisions to calculate')
    expect(html).toContain('Decide recommendations to track this')
  })
  it('formats the zero pending impact in a real currency when one is known', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ pendingImpact: [], counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 } }), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('$0')
  })
  it('never mixes currencies in pending impact', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ pendingImpact: [{ currency: 'USD', value: 100 }, { currency: 'EUR', value: 50 }] }), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('$100 + €50')
  })
  it('shows unlimited for commander', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ plan: 'commander', usage: { feature: 'ai_recommendations_month', used: 42, limit: null, remaining: null } }), usage: usageState(42, null), plan: 'commander', onUpgrade: noop }))
    expect(html).toContain('Unlimited on Commander plan')
    expect(html).not.toContain('Upgrade Plan')
  })
})

describe('empty states', () => {
  it('first-run state is compact, action-oriented, and educational', () => {
    const html = renderToStaticMarkup(createElement(FirstRunState, { onAnalyze: noop, analyzing: false, onHow: noop, onInspectRule: noop, hasRun: false }))
    expect(html).toContain('find your growth opportunities!')
    expect(html).toContain('Discover Opportunities')
    expect(html).toContain('How it works')
    expect(html).not.toContain('Your AI team is ready to work')
  })
  it('rule cards carry icons, descriptions, and data-source badges', () => {
    const html = renderToStaticMarkup(createElement(FirstRunState, { onAnalyze: noop, analyzing: false, onHow: noop, onInspectRule: noop, hasRun: false }))
    expect(html).toContain('Stockout Alerts')
    expect(html).toContain('Cart Recovery')
    expect(html).toContain('Analyzes: Products')
    expect(html).toContain('Analyzes: Checkouts')
    expect(html).toContain('Welcome New Customers')
  })
  it('explains what to expect and shows the honest no-invention promise', () => {
    const html = renderToStaticMarkup(createElement(FirstRunState, { onAnalyze: noop, analyzing: false, onHow: noop, onInspectRule: noop, hasRun: false }))
    expect(html).toContain('What happens after you click')
    expect(html).toContain('Real money attached')
    expect(html).toContain('You stay in control')
    expect(html).toContain('never invent a recommendation')
  })
  it('embeds the how-rules-work explainer with trust indicators', () => {
    const html = renderToStaticMarkup(createElement(FirstRunState, { onAnalyze: noop, analyzing: false, onHow: noop, onInspectRule: noop, hasRun: false }))
    expect(html).toContain('How it works')
    expect(html).toContain('Your store data')
    expect(html).toContain('8 smart triggers')
    expect(html).toContain('Ready for your approval')
    expect(html).toContain('Never invents numbers')
    expect(html).toContain('Backed by real data')
    expect(html).toContain('You approve every action')
  })
  it('all-clear state frames a healthy store positively and offers a fresh run', () => {
    const html = renderToStaticMarkup(createElement(AllClearState, { summary: summary({ total: 0, usage: { feature: 'ai_recommendations_month', used: 3, limit: 10, remaining: 7 } }), onAnalyze: noop, analyzing: false }))
    expect(html).toContain('Your store looks healthy')
    expect(html).toContain('healthy store')
    expect(html).toContain('3 recommendations generated this month')
    expect(html).toContain('Discover Opportunities')
  })
})

describe('sample recommendation preview', () => {
  it('is clearly labeled SAMPLE and disables its actions with a tooltip', () => {
    const html = renderToStaticMarkup(createElement(SampleRecommendationPreview))
    expect(html).toContain('Sample')
    expect(html).toContain('not your data')
    expect((html.match(/disabled=""|disabled/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('This is a preview — discover opportunities to get real recommendations')
    expect(html).toContain('$1,240')
    expect(html).toContain('Revenue at risk')
  })
  it('shows a prominent SAMPLE PREVIEW badge with a clear explanation', () => {
    const html = renderToStaticMarkup(createElement(SampleRecommendationPreview))
    // Prominent amber badge — never ambiguous
    expect(html).toContain('recs-sample-badge')
    expect(html).toContain('Sample Preview')
    expect(html).toContain('recs-sample-banner')
    // The explanation names what to do next
    expect(html).toContain('Discover Opportunities')
    expect(html).toContain('recs-sample-explanation')
    // A reinforcement note explains the disabled state
    expect(html).toContain('recs-sample-note')
    expect(html).toContain('these buttons will be active')
  })
  it('disables actions and exposes a screen-reader-friendly aria-label', () => {
    const html = renderToStaticMarkup(createElement(SampleRecommendationPreview))
    expect(html).toContain('aria-label="Skip This — preview only, action unavailable"')
    expect(html).toContain('aria-label="Approve — preview only, action unavailable"')
  })
})

describe('KPI hero micro-visualizations', () => {
  it('renders a radial ring for revenue opportunity pending', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary(), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('recs-kpi-radial')
    expect(html).toContain('recs-kpi-radial-track')
    expect(html).toContain('recs-kpi-radial-fill')
  })
  it('renders a 7-day mini bar chart for approved this month', () => {
    const trend = Array.from({ length: 7 }, (_, index) => ({ day: `2026-08-${String(10 + index).padStart(2, '0')}`, generated: 5, approved: index }))
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ generatedTrend: trend }), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('recs-kpi-bars')
    // 7 bars rendered
    const barCount = (html.match(/class="bar filled|class="bar "/g) ?? []).length
    expect(barCount).toBe(7)
  })
  it('renders a zoned approval-rate bar with a marker at the current rate', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary(), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('recs-kpi-progress')
    expect(html).toContain('recs-kpi-progress-track')
    expect(html).toContain('recs-kpi-progress-zone low')
    expect(html).toContain('recs-kpi-progress-zone mid')
    expect(html).toContain('recs-kpi-progress-zone good')
    expect(html).toContain('recs-kpi-progress-marker')
    expect(html).toContain('Low')
    expect(html).toContain('Medium')
    expect(html).toContain('Good')
    // The marker sits at the current last-30d rate (80%), not a hardcoded target
    expect(html).toMatch(/left:\s*80%/)
  })
  it('renders a speedometer with three colored zones and a visible needle', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ averageDecisionMs: 5_400_000 }), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('recs-kpi-speedo')
    expect(html).toContain('recs-kpi-speedo-zone-fast')
    expect(html).toContain('recs-kpi-speedo-zone-mid')
    expect(html).toContain('recs-kpi-speedo-zone-slow')
    expect(html).toContain('recs-kpi-speedo-needle')
    expect(html).toContain('recs-kpi-speedo-hub')
    // 1h 30m (5,400,000ms) lands in the mid zone — "OK"
    expect(html).toContain('data-zone="mid"')
    expect(html).toContain('OK')
  })
  it('renders a neutral needle-free gauge when there is no decision history yet', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ averageDecisionMs: null }), usage: usageState(0, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('recs-kpi-speedo')
    expect(html).toContain('data-zone="idle"')
    expect(html).toContain('No data yet')
    // No needle or hub in the empty state — it must not look like a broken gauge
    expect(html).not.toContain('recs-kpi-speedo-needle')
    expect(html).not.toContain('recs-kpi-speedo-hub')
  })
  it('keeps the existing usage ring for monthly usage', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary(), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('recs-usage-ring')
    expect(html).toContain('4/10')
  })
  it('does not invent numbers in the visualizations when summary is empty', () => {
    const empty = summary({ counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 }, total: 0, pendingImpact: [], approvedThisMonth: { count: 0, impact: [] }, approvalRate: { allTime: null, last30d: null }, averageDecisionMs: null, recentDecisions: [], generatedTrend: [] })
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: empty, usage: usageState(0, 10), plan: 'trial', onUpgrade: noop }))
    // All visualizations still render — but they show honest empty/idle states
    expect(html).toContain('recs-kpi-radial')
    expect(html).toContain('recs-kpi-bars')
    expect(html).toContain('recs-kpi-progress')
    expect(html).toContain('recs-kpi-speedo')
    // Approval rate uses the explicit empty-state track — no zones, no marker
    expect(html).toContain('recs-kpi-progress-empty')
    expect(html).not.toContain('recs-kpi-progress-marker')
    expect(html).not.toContain('recs-kpi-progress-zone')
    // No "filled" bar in the chart
    expect(html).not.toMatch(/class="bar filled"/)
    // Speedometer is needle-free in the idle state — never a fabricated angle
    expect(html).not.toContain('recs-kpi-speedo-needle')
  })
})

  it('renders the redesigned hero foot: teammates strip + month progress', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary(), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('Across 1 teammate')
    expect(html).toContain('recs-kpi-share')
    expect(html).toContain('recs-kpi-bar-letter')
    expect(html).toContain('recs-kpi-month-track')
    expect(html).toContain('of month elapsed')
    // Every card uses the shared icon-chip header anatomy
    expect(html).toContain('recs-kpi-chip')
  })
  it('shows a real last-30-days vs all-time delta pill on approval rate', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary(), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('▲ 5% vs all-time') // 80 − 75
    expect(html).toContain('recs-kpi-delta up')
  })
  it('shows a downward delta and a fractional rate honestly', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary({ approvalRate: { allTime: 80, last30d: 71.4 } }), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('71.4%')
    expect(html).toContain('▼ 8.6% vs all-time')
    expect(html).toContain('recs-kpi-delta down')
  })
  it('keeps the 80% target notch on the approval-rate track', () => {
    const html = renderToStaticMarkup(createElement(KpiHero, { summary: summary(), usage: usageState(4, 10), plan: 'trial', onUpgrade: noop }))
    expect(html).toContain('recs-kpi-target')
    expect(html).toContain('Target approval rate')
  })
describe('analysis progress modal', () => {
  it('shows staged progress with the real engine steps', () => {
    const html = renderToStaticMarkup(createElement(AnalysisProgressModal, { step: 2, elapsedMs: 2600, onHide: noop }))
    expect(html).toContain('YOUR AI TEAM IS ON IT')
    expect(html).toContain('Scanning your products')
    expect(html).toContain('Analyzing customer behavior')
    expect(html).toContain('Checking inventory levels')
    expect(html).toContain('Reviewing recent orders')
    expect(html).toContain('Finding patterns')
    expect(html).toContain('Preparing your wins')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('Keep browsing')
  })
  it('caps the progress bar before the final step so it never lies', () => {
    const html = renderToStaticMarkup(createElement(AnalysisProgressModal, { step: 5, elapsedMs: 9000, onHide: noop }))
    expect(html).toContain('aria-valuenow="86"')
  })
})

describe('analysis report panel', () => {
  it('reports exactly what was analyzed with a health grade', () => {
    const html = renderToStaticMarkup(createElement(AnalysisReportPanel, { report: report(), onDismiss: noop, onNavigateSection: noop, onHow: noop, onRerun: noop, rerunBlocked: false }))
    expect(html).toContain('Your store looks healthy')
    expect(html).toContain('No urgent issues detected')
    expect(html).toContain('>42<')
    expect(html).toContain('products')
    expect(html).toContain('>128<')
    expect(html).toContain('>913<')
    expect(html).toContain('8/8')
    expect(html).toContain('Excellent · 84/100')
    expect(html).toContain('took 4.2s')
  })
  it('lists the per-rule all-clear breakdown when nothing fired', () => {
    const html = renderToStaticMarkup(createElement(AnalysisReportPanel, { report: report(), onDismiss: noop, onNavigateSection: noop, onHow: noop, onRerun: noop, rerunBlocked: false }))
    expect(html).toContain('No stockout alerts')
    expect(html).toContain('No at-risk customers')
    expect(html).toContain('Cart recovery is within the normal range')
    expect(html).toContain('Discover Opportunities')
    expect(html).toContain('View analytics')
    expect(html).toContain('Set up automation')
  })
  it('swaps the breakdown for an honest dedup note when signals were skipped', () => {
    const html = renderToStaticMarkup(createElement(AnalysisReportPanel, { report: report({ deduplicated: 3 }), onDismiss: noop, onNavigateSection: noop, onHow: noop, onRerun: noop, rerunBlocked: false }))
    expect(html).toContain('3 signals matched recommendations already open')
    expect(html).not.toContain('No stockout risks')
  })
  it('degrades gracefully without snapshot stats or a health score', () => {
    const html = renderToStaticMarkup(createElement(AnalysisReportPanel, { report: report({ snapshotStats: null, health: { score: null } }), onDismiss: noop, onNavigateSection: undefined, onHow: noop, onRerun: noop, rerunBlocked: false }))
    expect(html).toContain('Learning')
    expect(html).toContain('store data analyzed')
    expect(html).not.toContain('View analytics')
  })
})

describe('rule detail modal', () => {
  it('explains trigger, impact, data source, and accountable agent', () => {
    const html = renderToStaticMarkup(createElement(RuleDetailModal, { ruleId: 'STOCKOUT_RISK', plan: 'growth', onClose: noop, onUpgrade: noop }))
    expect(html).toContain('Stockout Alerts')
    expect(html).toContain('Fires when')
    expect(html).toContain('7 or fewer days of cover')
    expect(html).toContain('Revenue you could lose if it sells out')
    expect(html).toContain('Products')
    expect(html).toContain('Inventory Agent')
    expect(html).toContain('Got it')
  })
  it('keeps plan gating intact for locked agents', () => {
    const html = renderToStaticMarkup(createElement(RuleDetailModal, { ruleId: 'CROSS_SELL', plan: 'start', onClose: noop, onUpgrade: noop }))
    expect(html).toContain('Upgrade Plan')
    expect(html).not.toContain('Upgrade to')
    expect(html).toContain('needs Growth')
  })
})

describe('tooltip primitive', () => {
  it('exposes an accessible label and a tooltip role', () => {
    const html = renderToStaticMarkup(createElement(Tip, { label: 'What this means', children: createElement('span', null, 'Metric') }))
    expect(html).toContain('aria-label="What this means"')
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('Metric')
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
  it('lists every agent with real pending counts and distribution bars', () => {
    const html = renderToStaticMarkup(createElement(InsightsSidebar, { summary: summary(), plan: 'trial', onFilterAgent: noop, onInspectRule: noop, onUpgrade: noop }))
    expect(html).toContain('Your AI Team')
    expect(html).toContain('Inventory Agent')
    expect(html).toContain('Executive Agent')
    expect(html).toContain('Looks after your best customers')
  })
  it('marks plan-locked agents without implying a different upgrade destination', () => {
    const html = renderToStaticMarkup(createElement(InsightsSidebar, { summary: summary(), plan: 'trial', onFilterAgent: noop, onInspectRule: noop, onUpgrade: noop }))
    // Trial unlocks 2 agents; the other five show their required plan chip
    expect(html).toContain('recs-agent-row-plan')
    expect(html).toContain('Commander')
    expect(html).not.toContain('Upgrade to')
  })
  it('renders trend metrics and decision quick stats from real summary data', () => {
    const html = renderToStaticMarkup(createElement(InsightsSidebar, { summary: summary(), plan: 'growth', onFilterAgent: noop, onInspectRule: noop, onUpgrade: noop }))
    expect(html).toContain('Your Activity Timeline')
    expect(html).toContain('>3</strong> found')
    expect(html).toContain('>2</strong> approved')
    expect(html).toContain('Top Categories')
    expect(html).toContain('Recent Decisions')
    expect(html).toContain('75%') // approval-rate quick stat
  })
  it('shows educational empties instead of blank space', () => {
    const empty = summary({ byAgent: [], byRule: [], recentDecisions: [], generatedTrend: [], total: 0, counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 } })
    const html = renderToStaticMarkup(createElement(InsightsSidebar, { summary: empty, plan: 'growth', onFilterAgent: noop, onInspectRule: noop, onUpgrade: noop }))
    expect(html).toContain('No recommendations yet — your team reports here after the first look.')
    expect(html).toContain('See sample activity')
    expect(html).toContain('30 days ago')
    expect(html).toContain('We alert you when something important happens')
    expect(html).toContain('Approve or skip recommendations to build history')
    expect(html).toContain('Sample')
    expect(html).toContain('>0<') // zero triggers shown per rule
  })
})

  it('renders the analytics-style area chart with a conversion stat', () => {
    const trend = Array.from({ length: 30 }, (_, index) => ({ day: `2026-08-${String(index + 1).padStart(2, '0')}`, generated: 10, approved: 4 }))
    const html = renderToStaticMarkup(createElement(InsightsSidebar, { summary: summary({ generatedTrend: trend }), plan: 'growth', onFilterAgent: noop, onInspectRule: noop, onUpgrade: noop }))
    expect(html).toContain('recs-trend-chart')
    expect(html).toContain('recs-trend-area')
    expect(html).toContain('recs-trend-line')
    expect(html).toContain('recs-trend-xlabels')
    expect(html).toContain('>300</strong> found')
    expect(html).toContain('>120</strong> approved')
    expect(html).toContain('40%') // 120 approved / 300 found
    expect(html).toContain('conversion')
  })
describe('how-it-works modal', () => {
  it('explains rules, evidence, calibration, and the FAQ', () => {
    const html = renderToStaticMarkup(createElement(HowItWorksModal, { onClose: noop }))
    expect(html).toContain('Eight smart triggers')
    expect(html).toContain('SHA-256')
    expect(html).toContain('calibrated by your decisions')
    expect(html).toContain('FAQ')
    expect(html).toContain('monthly limit')
  })
})
