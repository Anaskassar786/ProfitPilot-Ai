import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActivityFeed, AgentCard, AgentMenu, CommandCenterEmpty, CommandCenterHero, CommandCenterSkeleton, LockedAgentCard, RunAllBanner } from './command-center.js'
import {
  IDLE_RUN_STATE,
  PLAN_LABELS,
  agentImpactSummary,
  agentStatusLabel,
  formatBudget,
  groupLockedByPlan,
  healthTrend,
  insightsToday,
  parseSseFrame,
  reduceRunAll,
  relativeTime,
  unlockedAgents,
} from './command-center-model.js'
import type { AgentOverviewEntry, PlanTier } from './command-center-model.js'
import type { Recommendation } from './model.js'

const AGENT_PLAN: Readonly<Record<string, PlanTier>> = {
  REVENUE_AGENT: 'trial', INVENTORY_AGENT: 'trial', CUSTOMER_AGENT: 'start',
  PRICING_AGENT: 'growth', CAMPAIGN_AGENT: 'growth', PRODUCT_AGENT: 'commander', EXECUTIVE_AGENT: 'commander',
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
  it('trial sees 2 unlocked and 5 locked cards', () => {
    const agents = overviewFor('trial')
    expect(unlockedAgents(agents)).toHaveLength(2)
    expect(groupLockedByPlan(agents).flatMap((group) => group.agents)).toHaveLength(5)
  })
  it('start sees 3 unlocked and 4 locked cards', () => {
    const agents = overviewFor('start')
    expect(unlockedAgents(agents)).toHaveLength(3)
    expect(groupLockedByPlan(agents).flatMap((group) => group.agents)).toHaveLength(4)
  })
  it('growth sees 5 unlocked and 2 locked cards', () => {
    const agents = overviewFor('growth')
    expect(unlockedAgents(agents)).toHaveLength(5)
    const groups = groupLockedByPlan(agents)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.plan).toBe('commander')
    expect(groups[0]?.agents).toHaveLength(2)
  })
  it('commander sees all 7 unlocked and no locked groups', () => {
    const agents = overviewFor('commander')
    expect(unlockedAgents(agents)).toHaveLength(7)
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
    const html = renderToStaticMarkup(createElement(AgentCard, { agent, activity: [recommendation], running: false, onOpen: () => undefined, onRun: () => undefined, onTogglePause: () => undefined }))
    expect(html).toContain('Revenue Agent')
    expect(html).toContain('Run now')
    expect(html).toContain('View details')
    expect(html).toContain('insights today')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('font-size: 8px')
  })
  it('renders a locked card with plan badge, sample insight, and upgrade CTA', () => {
    const locked = overviewFor('trial').find((agent) => agent.id === 'PRICING_AGENT')
    if (!locked) throw new Error('missing locked agent')
    const html = renderToStaticMarkup(createElement(LockedAgentCard, { agent: locked, onUpgrade: () => undefined, onLearnMore: () => undefined }))
    expect(html).toContain('Requires Growth')
    expect(html).toContain('Upgrade to Growth')
    expect(html).toContain('$149/mo')
    expect(html).toContain('Sample insight.')
  })
  it('renders real KPI data in the hero, not hard-coded strings', () => {
    const html = renderToStaticMarkup(createElement(CommandCenterHero, {
      health: { score: 74, method: 'deterministic-v1', components: [{ key: 'revenue_momentum', score: 80, weight: .35, reason: '' }] },
      cost: { storeId: 's', day: 'd', microDollars: 500_000, capMicroDollars: 5_000_000, remainingMicroDollars: 4_500_000, calls: 12 },
      recent: [recommendation],
      overview: { plan: 'growth', unlockedCount: 5, totalCount: 7, agents: [...overviewFor('growth')] },
    }))
    expect(html).toContain('74')
    expect(html).toContain('$0.50')
    expect(html).toContain('12 calls today')
    expect(html).toContain('Store health score')
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
