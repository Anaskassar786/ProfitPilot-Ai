import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActivityFeed, AgentCard, AgentMenu, CommandCenterEmpty, CommandCenterHero, CommandCenterSkeleton, GrowthModuleCard, GrowthModuleDrawer, LockedAgentCard, RunAllBanner, Sparkline, Tooltip } from './command-center.js'
import {
  GROWTH_MODULES,
  IDLE_RUN_STATE,
  PLAN_LABELS,
  agentCategory,
  agentImpactSummary,
  agentStatusLabel,
  dailySeries,
  formatBudget,
  groupLockedByPlan,
  growthModuleAccess,
  healthTrend,
  insightsToday,
  parseSseFrame,
  periodTotals,
  reduceRunAll,
  relativeTime,
  storeHealthDisplay,
  trendDirection,
  unlockedAgents,
  visibleAgents,
} from './command-center-model.js'
import type { AgentOverviewEntry, PlanTier } from './command-center-model.js'
import type { Recommendation } from './model.js'

const AGENT_PLAN: Readonly<Record<string, PlanTier>> = {
  REVENUE_AGENT: 'trial', INVENTORY_AGENT: 'trial', CUSTOMER_AGENT: 'start',
  PRICING_AGENT: 'growth', PRODUCT_AGENT: 'commander', EXECUTIVE_AGENT: 'commander',
}
const PLAN_ORDER: readonly PlanTier[] = ['trial', 'start', 'growth', 'commander']

function overviewFor(plan: PlanTier): readonly AgentOverviewEntry[] {
  return Object.entries(AGENT_PLAN).map(([id, requiredPlan]) => ({
    id,
    label: id.split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' '),
    promptVersion: '1.1.0',
    execution: 'READY' as const,
    languageOnly: true as const,
    locked: PLAN_ORDER.indexOf(requiredPlan) > PLAN_ORDER.indexOf(plan),
    requiredPlan,
    paused: false,
    tagline: 'Watches signals.',
    sampleInsight: 'Sample insight.',
  }))
}

describe('PR45 plan view regression matrix', () => {
  it('trial sees 2 unlocked and 4 locked cards', () => {
    const agents = overviewFor('trial')
    expect(unlockedAgents(agents)).toHaveLength(2)
    expect(groupLockedByPlan(agents).flatMap((group) => group.agents)).toHaveLength(4)
  })
  it('start sees 3 unlocked and 3 locked cards', () => {
    const agents = overviewFor('start')
    expect(unlockedAgents(agents)).toHaveLength(3)
    expect(groupLockedByPlan(agents).flatMap((group) => group.agents)).toHaveLength(3)
  })
  it('growth sees 4 unlocked and 2 locked cards', () => {
    const agents = overviewFor('growth')
    expect(unlockedAgents(agents)).toHaveLength(4)
    const groups = groupLockedByPlan(agents)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.plan).toBe('commander')
    expect(groups[0]?.agents).toHaveLength(2)
  })
  it('commander sees all 6 unlocked and no locked groups', () => {
    const agents = overviewFor('commander')
    expect(unlockedAgents(agents)).toHaveLength(6)
    expect(groupLockedByPlan(agents)).toHaveLength(0)
  })
  it('groups locked agents by the plan that unlocks them, in upgrade order', () => {
    const groups = groupLockedByPlan(overviewFor('trial'))
    expect(groups.map((group) => group.plan)).toEqual(['start', 'growth', 'commander'])
  })
})

describe('PR45 model helpers', () => {
  it('formats the AI budget from micro-dollars', () => {
    expect(formatBudget({ storeId: 's', day: 'd', microDollars: 1_250_000, capMicroDollars: 5_000_000, remainingMicroDollars: 3_750_000, calls: 3 })).toEqual({ spent: '$1.25', cap: '$5.00', percent: 25 })
    expect(formatBudget(null).spent).toBe('—')
  })
  it('labels agent states honestly', () => {
    const agent = overviewFor('commander')[0]
    if (!agent) throw new Error('missing agent')
    expect(agentStatusLabel(agent)).toBe('Active')
    expect(agentStatusLabel({ ...agent, paused: true })).toBe('Paused')
    expect(agentStatusLabel({ ...agent, locked: true })).toBe('Locked')
    expect(agentStatusLabel({ ...agent, execution: 'UNCONFIGURED' })).toBe('Awaiting AI keys')
  })
  it('renders relative timestamps', () => {
    const now = Date.parse('2026-08-17T12:00:00Z')
    expect(relativeTime('2026-08-17T11:57:30Z', now)).toBe('2 mins ago')
    expect(relativeTime('2026-08-17T09:00:00Z', now)).toBe('3 hours ago')
    expect(relativeTime('not-a-date', now)).toBe('—')
  })
  it('counts only today’s insights', () => {
    const today = new Date().toISOString()
    const activity = [{ createdAt: today }, { createdAt: '2001-01-01T00:00:00Z' }] as never
    expect(insightsToday(activity)).toBe(1)
  })
  it('summarizes agent impact, approval rate, and confidence', () => {
    const summary = agentImpactSummary([
      { id: '1', agent: 'A', ruleId: 'R', title: 't', reason: 'r', impactValue: 100, impactLabel: 'x', currency: 'USD', status: 'APPROVED', explanationStatus: 'AI_GENERATED', confidence: .8, confidenceLevel: 'MEDIUM', version: 1, createdAt: '2026-08-17T00:00:00Z' },
      { id: '2', agent: 'A', ruleId: 'R', title: 't', reason: 'r', impactValue: 50, impactLabel: 'x', currency: 'USD', status: 'REJECTED', explanationStatus: 'AI_GENERATED', confidence: .6, confidenceLevel: 'MEDIUM', version: 1, createdAt: '2026-08-16T00:00:00Z' },
    ])
    expect(summary.totalImpact).toBe(150)
    expect(summary.approvalRate).toBe(50)
    expect(summary.averageConfidence).toBe(70)
  })
  it('derives the health trend from momentum components', () => {
    expect(healthTrend({ score: 80, method: 'deterministic-v1', components: [{ key: 'revenue_momentum', score: 90, weight: .35, reason: '' }] })).toBe('up')
    expect(healthTrend({ score: 30, method: 'deterministic-v1', components: [{ key: 'revenue_momentum', score: 20, weight: .35, reason: '' }] })).toBe('down')
    expect(healthTrend(null)).toBe('flat')
  })
})

describe('PR45 run-all stream reducer', () => {
  it('parses SSE frames into typed events', () => {
    expect(parseSseFrame('event: progress\ndata: {"agent":"REVENUE_AGENT","completed":2,"total":5}')).toEqual({ type: 'progress', agent: 'REVENUE_AGENT', completed: 2, total: 5 })
    expect(parseSseFrame('event: done\ndata: {"recommendations":4,"deduplicated":1,"cacheHits":2}')).toEqual({ type: 'done', recommendations: 4, deduplicated: 1, cacheHits: 2 })
    expect(parseSseFrame('data: no event name')).toBeNull()
    expect(parseSseFrame('event: progress\ndata: {malformed')).toBeNull()
  })
  it('reduces a full run lifecycle', () => {
    let state = reduceRunAll(IDLE_RUN_STATE, { type: 'start', runnable: ['REVENUE_AGENT'], skipped: [{ agent: 'EXECUTIVE_AGENT', reason: 'LOCKED' }] })
    expect(state.running).toBe(true)
    state = reduceRunAll(state, { type: 'progress', agent: 'REVENUE_AGENT', completed: 1, total: 2 })
    expect(state.completed).toBe(1)
    state = reduceRunAll(state, { type: 'done', recommendations: 2, deduplicated: 0, cacheHits: 1 })
    expect(state.running).toBe(false)
    expect(state.result?.recommendations).toBe(2)
  })
  it('captures stream errors', () => {
    const state = reduceRunAll({ ...IDLE_RUN_STATE, running: true }, { type: 'error', message: 'boom' })
    expect(state.error).toBe('boom')
    expect(state.running).toBe(false)
  })
})

const recommendation: Recommendation = { id: 'r1', storeId: 's', agent: 'REVENUE_AGENT', ruleId: 'REVENUE_SPIKE', title: 'Revenue is accelerating', reason: 'Up 30%', impactValue: 300, impactLabel: 'gain', currency: 'USD', confidence: .75, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: {}, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: new Date().toISOString() }

describe('PR45 component rendering', () => {
  it('renders an unlocked agent card with actions, stats, and menu', () => {
    const agent = overviewFor('commander')[0]
    if (!agent) throw new Error('missing agent')
    const html = renderToStaticMarkup(createElement(AgentCard, { agent, activity: [recommendation], onOpen: () => undefined, onTogglePause: () => undefined }))
    expect(html).toContain('Revenue Agent')
    expect(html).not.toContain('Run now')
    expect(html).toContain('View details')
    expect(html).toContain('insights today')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('font-size: 8px')
  })
  it('renders a locked card with plan badge, sample insight, and a generic upgrade CTA', () => {
    const locked = overviewFor('trial').find((agent) => agent.id === 'PRICING_AGENT')
    if (!locked) throw new Error('missing locked agent')
    const html = renderToStaticMarkup(createElement(LockedAgentCard, { agent: locked, onUpgrade: () => undefined, onLearnMore: () => undefined }))
    expect(html).toContain('Requires Growth')
    expect(html).toContain('Upgrade Plan')
    // The button must never mention a specific plan name or price.
    expect(html).not.toContain('Upgrade to Growth')
    expect(html).not.toContain('$199/mo')
    expect(html).toContain('Sample insight.')
  })
  it('renders real KPI data in the hero, not hard-coded strings', () => {
    const html = renderToStaticMarkup(createElement(CommandCenterHero, {
      health: { score: 74, method: 'deterministic-v1', components: [{ key: 'revenue_momentum', score: 80, weight: .35, reason: '' }] },
      summary: { counts: { PENDING: 0, APPROVED: 2, REJECTED: 0, EXECUTED: 1, FAILED: 0, EXPIRED: 0 }, total: 3, pendingImpact: [], approvedThisMonth: { count: 2, impact: [] }, byAgent: [], byRule: [], approvalRate: { allTime: 100, last30d: 100 }, averageDecisionMs: null, recentDecisions: [], generatedTrend: [{ day: '2026-08-18', generated: 2, approved: 1 }, { day: '2026-08-17', generated: 1, approved: 1 }], plan: 'growth', usage: { feature: 'ai_recommendations_month', used: 3, limit: 150, remaining: 147 } },
      overview: { plan: 'growth', unlockedCount: 4, totalCount: 6, agents: [...overviewFor('growth')] },
    }))
    expect(html).toContain('74')
    expect(html).toContain('Store Health Score')
    expect(html).toContain('AI Actions Completed')
    expect(html).toContain('Insights Today')
    expect(html).toContain('Active agents')
    expect(html).not.toContain('AI Spend Today')
    expect(html).not.toContain('calls today')
  })
  it('renders the activity feed rows and the empty state', () => {
    const agents = [...overviewFor('commander')]
    const withRows = renderToStaticMarkup(createElement(ActivityFeed, { recent: [recommendation], agents, onOpenAgent: () => undefined }))
    expect(withRows).toContain('Revenue is accelerating')
    expect(withRows).toContain('PENDING')
    const empty = renderToStaticMarkup(createElement(ActivityFeed, { recent: [], agents, onOpenAgent: () => undefined }))
    expect(empty).toContain('No agent activity yet')
  })
  it('renders run-all progress and completion states', () => {
    const running = renderToStaticMarkup(createElement(RunAllBanner, { state: { ...IDLE_RUN_STATE, running: true, completed: 3, total: 10, lastAgent: 'REVENUE_AGENT', runnable: ['REVENUE_AGENT'], skipped: [{ agent: 'EXECUTIVE_AGENT', reason: 'LOCKED' }] }, onDismiss: () => undefined }))
    expect(running).toContain('Analyzing 3/10 signals')
    expect(running).toContain('Skipped: Executive Agent (locked)')
    const done = renderToStaticMarkup(createElement(RunAllBanner, { state: { ...IDLE_RUN_STATE, result: { recommendations: 4, deduplicated: 1, cacheHits: 2 } }, onDismiss: () => undefined }))
    expect(done).toContain('Run complete: 4 insights')
    expect(done).toContain('2 cache hits')
  })
  it('renders skeleton and empty states instead of blank screens', () => {
    expect(renderToStaticMarkup(createElement(CommandCenterSkeleton))).toContain('cc-skeleton')
    expect(renderToStaticMarkup(createElement(CommandCenterEmpty, { title: 'Connect Shopify', body: 'Body' }))).toContain('Connect Shopify')
  })
  it('renders an accessible 3-dot menu trigger', () => {
    const html = renderToStaticMarkup(createElement(AgentMenu, { items: [{ label: 'Pause agent', icon: (() => null) as never, onSelect: () => undefined }], label: 'Agent actions' }))
    expect(html).toContain('aria-label="Agent actions"')
    expect(html).toContain('aria-expanded="false"')
  })
  it('uses plan labels consistently', () => {
    expect(PLAN_LABELS.growth).toBe('Growth')
  })
})

describe('PR49 store health empty states', () => {
  it('shows an honest empty state when there are too few orders', () => {
    expect(storeHealthDisplay({ score: null, method: 'deterministic-v1', components: [], orderCount: 3, historyDays: 2 })).toEqual({ kind: 'empty', message: 'Not enough data yet — need 10+ orders to calculate health score' })
  })
  it('shows a calculating state for thin but present order history', () => {
    expect(storeHealthDisplay({ score: null, method: 'deterministic-v1', components: [], orderCount: 40, historyDays: 3 })).toEqual({ kind: 'empty', message: 'Store health calculating… check back in 24 hours' })
  })
  it('never labels a low score "Critical" — panic-free language', () => {
    expect(storeHealthDisplay({ score: 0, method: 'deterministic-v1', components: [], orderCount: 120, historyDays: 30 })).toEqual({ kind: 'score', score: 0, tone: 'critical', label: 'Needs attention' })
  })
  it('labels healthy and warning scores', () => {
    const healthy = storeHealthDisplay({ score: 82, method: 'deterministic-v1', components: [] })
    const warning = storeHealthDisplay({ score: 60, method: 'deterministic-v1', components: [] })
    expect(healthy.kind === 'score' && healthy.label).toBe('Healthy')
    expect(warning.kind === 'score' && warning.label).toBe('Needs attention')
  })
  it('falls back gracefully for null health payloads', () => {
    expect(storeHealthDisplay(null).kind).toBe('empty')
    expect(storeHealthDisplay(null)).toEqual({ kind: 'empty', message: 'Not enough data yet' })
  })
})

describe('PR49 section organization', () => {
  it('groups analytics agents under AI Employees', () => {
    expect(agentCategory({ id: 'REVENUE_AGENT' })).toBe('AI Employees')
    expect(agentCategory({ id: 'INVENTORY_AGENT' })).toBe('AI Employees')
    expect(agentCategory({ id: 'PRICING_AGENT' })).toBe('AI Employees')
    expect(agentCategory({ id: 'PRODUCT_AGENT' })).toBe('AI Employees')
  })
  it('separates the customer (communication) and executive agents', () => {
    expect(agentCategory({ id: 'CUSTOMER_AGENT' })).toBe('Communication')
    expect(agentCategory({ id: 'EXECUTIVE_AGENT' })).toBe('Strategic Overview')
  })
})

describe('PR49 shipped AI Growth Command modules', () => {
  it('defines all active modules with a real destination path', () => {
    /* 🛑 JARVIS module temporarily removed from GROWTH_MODULES array — restore when Jarvis returns */
    expect(GROWTH_MODULES.map((module) => module.id)).toEqual(['STORE_COACH', 'AI_EXECUTIVE', 'PATTERN_AI', 'AI_COMMAND'])
    expect(GROWTH_MODULES.map((module) => module.path)).toEqual(['store-coach', 'ai-executive', 'patternai', 'ai-command'])
    expect(GROWTH_MODULES.every((module) => module.description.length > 0 && module.features.length >= 3 && module.sampleInsight.length > 0)).toBe(true)
  })
  it('marks GrowthIQ (formerly AI Executive) as Requires Growth on lower plans only', () => {
    const module = GROWTH_MODULES.find((entry) => entry.id === 'AI_EXECUTIVE')
    if (!module) throw new Error('missing module')
    expect(module.label).toBe('GrowthIQ')
    expect(growthModuleAccess(module, 'trial')).toMatchObject({ badge: 'requires', badgeLabel: 'Requires Growth', requiresUpgrade: true, upgradePlan: 'growth' })
    expect(growthModuleAccess(module, 'start')).toMatchObject({ badge: 'requires', requiresUpgrade: true })
    expect(growthModuleAccess(module, 'growth')).toMatchObject({ badge: 'available', badgeLabel: 'Available', requiresUpgrade: false })
    expect(growthModuleAccess(module, 'commander').tierLabel).toBe('+ Investor PDFs')
  })
  it('keeps Store Coach and PatternAI available on every plan', () => {
    for (const id of ['STORE_COACH', 'PATTERN_AI'] as const) {
      const module = GROWTH_MODULES.find((entry) => entry.id === id)
      if (!module) throw new Error('missing module')
      expect(growthModuleAccess(module, 'trial').badge).toBe('available')
      expect(growthModuleAccess(module, 'commander').requiresUpgrade).toBe(false)
    }
  })
  it('gates AI Command actions to Commander', () => {
    const module = GROWTH_MODULES.find((entry) => entry.id === 'AI_COMMAND')
    if (!module) throw new Error('missing module')
    expect(growthModuleAccess(module, 'trial').tierLabel).toBe('Info only')
    expect(growthModuleAccess(module, 'trial').note).toContain('Commander')
    expect(growthModuleAccess(module, 'commander').tierLabel).toBe('+ Full Actions')
  })
  /* 🛑 Jarvis module temporarily removed from GROWTH_MODULES — test preserved for restoration */
  it.skip('lists Jarvis after AI Command and keeps voice available on every plan', () => {
    const module = GROWTH_MODULES.find((entry) => entry.id === 'JARVIS')
    if (!module) throw new Error('missing module')
    expect(module.path).toBe('jarvis')
    expect(growthModuleAccess(module, 'trial').badge).toBe('available')
    expect(growthModuleAccess(module, 'trial').note).toContain('Commander')
    expect(growthModuleAccess(module, 'commander').tierLabel).toBe('+ Actions')
  })
  it('renders a shipped module card as Available (never Coming soon)', () => {
    const module = GROWTH_MODULES.find((entry) => entry.id === 'STORE_COACH')
    if (!module) throw new Error('missing module')
    const html = renderToStaticMarkup(createElement(GrowthModuleCard, { module, plan: 'trial', onOpen: () => undefined, onDetails: () => undefined, onUpgrade: () => undefined }))
    expect(html).toContain('Store Coach')
    expect(html).toContain('Available')
    expect(html).toContain('Open Store Coach')
    expect(html).not.toContain('Coming soon')
    expect(html).not.toContain('Launching soon')
  })
  it('renders the GrowthIQ card with the rebranded label and gated CTA', () => {
    const module = GROWTH_MODULES.find((entry) => entry.id === 'AI_EXECUTIVE')
    if (!module) throw new Error('missing module')
    const html = renderToStaticMarkup(createElement(GrowthModuleCard, { module, plan: 'start', onOpen: () => undefined, onDetails: () => undefined, onUpgrade: () => undefined }))
    expect(html).toContain('GrowthIQ')
    expect(html).not.toContain('AI Executive')
    // Start plan: gated by the growth tier — badge names the required tier,
    // the CTA opens the module (which carries the "Upgrade Plan" gate).
    expect(html).toContain('Requires Growth')
    expect(html).toContain('Open GrowthIQ')
    expect(html).not.toContain('Upgrade to Growth')
  })
  it('renders the module info drawer with a plan matrix and an Open CTA', () => {
    const module = GROWTH_MODULES.find((entry) => entry.id === 'STORE_COACH')
    if (!module) throw new Error('missing module')
    const html = renderToStaticMarkup(createElement(GrowthModuleDrawer, { module, plan: 'trial', onClose: () => undefined, onOpen: () => undefined, onUpgrade: () => undefined }))
    expect(html).toContain('Store Coach')
    expect(html).toContain('Plan availability')
    expect(html).toContain('You are here')
    expect(html).toContain('Open Store Coach')
    expect(html).not.toContain('coming soon')
  })
})

describe('PR49 tooltips and empty states', () => {
  it('renders an accessible tooltip with the help text', () => {
    const html = renderToStaticMarkup(createElement(Tooltip, { text: 'Daily budget cap protects your AI costs' }, 'AI Spend Today'))
    expect(html).toContain('AI Spend Today')
    expect(html).toContain('data-tip="Daily budget cap protects your AI costs"')
    expect(html).toContain('title="Daily budget cap protects your AI costs"')
  })
  it('renders educational samples and the learn link in an empty activity feed', () => {
    const html = renderToStaticMarkup(createElement(ActivityFeed, { recent: [], agents: [], onOpenAgent: () => undefined }))
    expect(html).toContain('No agent activity yet')
    expect(html).toContain('Recommendation created')
    expect(html).toContain('Learn how agents work')
  })
  it('renders the getting-started guide in the empty state', () => {
    const html = renderToStaticMarkup(createElement(CommandCenterEmpty, { title: 'Connect Shopify', body: 'Body' }))
    expect(html).toContain('Connect Shopify')
    expect(html).toContain('Agents run automatically')
    expect(html).toContain('Review and act')
  })
})

describe('AI actions and insights KPI helpers', () => {
  const now = new Date('2026-08-18T12:00:00Z')
  it('zero-fills a daily series across the last 7 days', () => {
    const series = dailySeries([{ day: '2026-08-18', generated: 2, approved: 1 }], 'generated', 7, now)
    expect(series).toHaveLength(7)
    expect(series.map((point) => point.value)).toEqual([0, 0, 0, 0, 0, 0, 2])
    expect(series[series.length - 1]?.day).toBe('2026-08-18')
  })
  it('computes current vs previous week totals and a percentage change', () => {
    const trend = [
      { day: '2026-08-05', generated: 1, approved: 0 },
      { day: '2026-08-15', generated: 3, approved: 0 },
    ]
    const totals = periodTotals(dailySeries(trend, 'generated', 14, now))
    expect(totals.current).toBe(3)
    expect(totals.previous).toBe(1)
    expect(totals.changePercent).toBe(200)
  })
  it('returns a null change when there is no prior baseline', () => {
    const totals = periodTotals(dailySeries([], 'generated', 14, now))
    expect(totals.current).toBe(0)
    expect(totals.previous).toBe(0)
    expect(totals.changePercent).toBeNull()
    expect(trendDirection(totals.changePercent)).toBe('new')
  })
  it('shows Pricing Agent and hides purged Campaign Agent from the display roster', () => {
    const visible = visibleAgents(overviewFor('commander'))
    expect(visible.map((agent) => agent.id)).toContain('PRICING_AGENT')
    expect(visible.map((agent) => agent.id)).not.toContain('CAMPAIGN_AGENT')
    expect(visible).toHaveLength(6)
  })
  it('renders a theme-adaptive sparkline with per-day hover labels', () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { points: [{ day: '2026-08-17', value: 2 }, { day: '2026-08-18', value: 4 }], ariaLabel: 'Insights generated' }))
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Insights generated"')
    expect(html).toContain('2026-08-17: 2')
  })
})
