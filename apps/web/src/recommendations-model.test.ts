import { describe, expect, it } from 'vitest'
import {
  AGENT_DESCRIPTIONS,
  AGENT_LABELS,
  KPI_TOOLTIPS,
  RULE_AGENT,
  RULE_DATA_SOURCES,
  RULE_DETAILS,
  RULE_EMOJIS,
  RULE_LABELS,
  RULE_TAGLINES,
  STATUS_TABS,
  STATUS_TAB_TOOLTIPS,
  TEAM_FIND_BULLETS,
  agentLabel,
  agentLockedForPlan,
  applyDecisionLocally,
  expiryBadge,
  snoozeBadge,
  formatCurrencyAmounts,
  formatDecisionDelay,
  formatDurationMs,
  formatImpact,
  formatRelativeTime,
  greetingForHour,
  groupRecommendations,
  healthTone,
  impactLabelText,
  impactRatio,
  parseRecommendationsHash,
  planRequiredForAgent,
  recommendationsHash,
  searchRecommendations,
  shopDisplayName,
  statusTabCount,
  titleCaseEnum,
  unlockedAgents,
  usageState,
} from './recommendations-model.js'
import type { AgentId, RecommendationView, RuleId } from './recommendations-model.js'

function view(overrides: Partial<RecommendationView> = {}): RecommendationView {
  return { id: 'r1', storeId: 's', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Reorder Hoodie', reason: 'Low cover', impactValue: 100, impactLabel: 'revenue at risk', currency: 'USD', confidence: .75, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: {}, explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: '2026-08-01T00:00:00.000Z', entityKey: 'p1', expiresAt: null, decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null, ...overrides }
}

describe('humanization', () => {
  it('labels every agent and rule without raw enum shapes', () => {
    for (const label of [...Object.values(AGENT_LABELS), ...Object.values(RULE_LABELS)]) expect(label).not.toMatch(/[A-Z]{2,}_[A-Z]/)
  })
  it('falls back gracefully for unknown enums', () => {
    expect(agentLabel('MYSTERY_AGENT')).toBe('Mystery agent')
    expect(titleCaseEnum('APPROVAL_REQUIRED')).toBe('Approval required')
  })
  it('sentence-cases impact labels', () => expect(impactLabelText('revenue at risk')).toBe('Revenue at risk'))
})

describe('currency handling', () => {
  it('formats per-recommendation currency', () => {
    expect(formatImpact(1240, 'USD')).toBe('$1,240')
    expect(formatImpact(99.5, 'EUR')).toBe('€99.50')
    expect(formatImpact(500, 'INR')).toContain('500')
  })
  it('never sums currencies together', () => {
    expect(formatCurrencyAmounts([{ currency: 'USD', value: 1240 }, { currency: 'EUR', value: 300 }])).toBe('$1,240 + €300')
  })
  it('shows an honest dash with no amounts', () => expect(formatCurrencyAmounts([])).toBe('—'))
  it('survives an unknown currency code', () => expect(formatImpact(10, 'ZZZ')).toContain('10'))
})

describe('plan gating', () => {
  it('unlocks 2/3/6/7 agents by tier', () => {
    expect(unlockedAgents('trial')).toHaveLength(2)
    expect(unlockedAgents('start')).toHaveLength(3)
    expect(unlockedAgents('growth')).toHaveLength(6)
    expect(unlockedAgents('commander')).toHaveLength(7)
  })
  it('locks the executive agent below commander', () => {
    expect(agentLockedForPlan('EXECUTIVE_AGENT', 'growth')).toBe(true)
    expect(agentLockedForPlan('EXECUTIVE_AGENT', 'commander')).toBe(false)
    expect(planRequiredForAgent('EXECUTIVE_AGENT')).toBe('commander')
    expect(planRequiredForAgent('CUSTOMER_AGENT')).toBe('start')
  })
  it('reports usage states across the limit curve', () => {
    expect(usageState(3, 10)).toMatchObject({ remaining: 7, nearLimit: false, atLimit: false })
    expect(usageState(8, 10)).toMatchObject({ nearLimit: true, atLimit: false })
    expect(usageState(10, 10)).toMatchObject({ remaining: 0, atLimit: true })
    expect(usageState(42, null)).toMatchObject({ limit: null, atLimit: false, ratio: null })
  })
})

describe('time helpers', () => {
  const now = Date.parse('2026-08-15T12:00:00.000Z')
  it('renders relative times', () => {
    expect(formatRelativeTime('2026-08-15T11:30:00.000Z', now)).toBe('30m ago')
    expect(formatRelativeTime('2026-08-15T09:00:00.000Z', now)).toBe('3h ago')
    expect(formatRelativeTime('2026-08-01T00:00:00.000Z', now)).toBe('14d ago')
  })
  it('badges upcoming expiry inside 48h only', () => {
    expect(expiryBadge('2026-08-15T18:00:00.000Z', now)).toBe('Expires in 6h')
    expect(expiryBadge('2026-08-20T00:00:00.000Z', now)).toBeNull()
    expect(expiryBadge('2026-08-15T11:00:00.000Z', now)).toBe('Expired')
    expect(expiryBadge(null, now)).toBeNull()
  })
  it('formats decision delay from creation', () => {
    expect(formatDecisionDelay('2026-08-15T10:00:00.000Z', '2026-08-15T12:00:00.000Z')).toBe('Decided 2h 0m after creation')
    expect(formatDecisionDelay('2026-08-15T10:00:00.000Z', null)).toBeNull()
    expect(formatDurationMs(90_000)).toBe('1m')
  })
  it('badges an active snooze and goes quiet once it passes', () => {
    expect(snoozeBadge('2026-08-15T14:00:00.000Z', now)).toBe('Snoozed · reminds in 2h')
    expect(snoozeBadge('2026-08-15T12:45:00.000Z', now)).toBe('Snoozed · reminds in 45m')
    expect(snoozeBadge('2026-08-16T12:00:00.000Z', now)).toBe('Snoozed · reminds in 1d')
    expect(snoozeBadge('2026-08-15T11:00:00.000Z', now)).toBeNull()
    expect(snoozeBadge(null, now)).toBeNull()
    expect(snoozeBadge('not-a-date', now)).toBeNull()
  })
})

describe('list presentation', () => {
  const items = [view({ id: 'a', agent: 'REVENUE_AGENT', title: 'Win back a high-value segment', reason: 'Segment inactive' }), view({ id: 'b', title: 'Reorder Hoodie' }), view({ id: 'c', agent: 'REVENUE_AGENT', ruleId: 'CHURN_RISK', title: 'Invite a repeat purchase', reason: 'Customer overdue' })]
  it('groups by agent and rule', () => {
    const byAgent = groupRecommendations(items, 'agent')
    expect(byAgent.map((group) => group.label)).toEqual(['Revenue Agent', 'Inventory Agent'])
    const byRule = groupRecommendations(items, 'rule')
    expect(byRule.map((group) => group.label).sort()).toEqual(['Save At-Risk Customers', 'Stockout Alerts'])
    expect(groupRecommendations(items, 'none')).toHaveLength(1)
  })
  it('searches title and reason', () => {
    expect(searchRecommendations(items, 'hoodie').map((item) => item.id)).toEqual(['b'])
    expect(searchRecommendations(items, '')).toHaveLength(3)
  })
  it('computes tab counts including merged buckets', () => {
    const counts = { PENDING: 2, APPROVED: 1, REJECTED: 1, EXECUTED: 1, FAILED: 1, EXPIRED: 2 }
    expect(statusTabCount('ALL', counts)).toBe(8)
    expect(statusTabCount('REJECTED', counts)).toBe(3)
    expect(statusTabCount('EXECUTED', counts)).toBe(2)
    expect(statusTabCount('PENDING', counts)).toBe(2)
  })
  it('scales impact bars against the max with a visibility floor', () => {
    expect(impactRatio(100, 100)).toBe(1)
    expect(impactRatio(1, 100)).toBe(.04)
    expect(impactRatio(0, 100)).toBe(0)
    expect(impactRatio(50, 0)).toBe(0)
  })
})

describe('optimistic reducer', () => {
  it('replaces exactly one card in place', () => {
    const items = [view({ id: 'a' }), view({ id: 'b' })]
    const updated = applyDecisionLocally(items, view({ id: 'b', status: 'APPROVED', version: 1 }))
    expect(updated[0]?.status).toBe('PENDING')
    expect(updated[1]?.status).toBe('APPROVED')
    expect(updated).toHaveLength(2)
  })
})

describe('deep-link routing', () => {
  it('round-trips recommendation hashes', () => {
    expect(recommendationsHash(null)).toBe('#/recommendations')
    expect(recommendationsHash('abc-123', true)).toBe('#/recommendations/abc-123?evidence=true')
    expect(parseRecommendationsHash('#/recommendations')).toEqual({ recommendationId: null, evidence: false })
    expect(parseRecommendationsHash('#/recommendations/abc-123?evidence=true')).toEqual({ recommendationId: 'abc-123', evidence: true })
    expect(parseRecommendationsHash('#/other')).toBeNull()
  })
})

describe('educational maps (UX refresh completeness)', () => {
  const allRules = Object.keys(RULE_LABELS) as RuleId[]
  const allAgents = Object.keys(AGENT_LABELS) as AgentId[]
  it('describes every agent and covers every rule', () => {
    for (const agent of allAgents) expect(AGENT_DESCRIPTIONS[agent].length).toBeGreaterThan(10)
    for (const rule of allRules) {
      expect(RULE_DATA_SOURCES[rule].length).toBeGreaterThan(0)
      expect(RULE_DETAILS[rule].trigger).toMatch(/^Fires (when|on)/)
      expect(RULE_DETAILS[rule].healthy.length).toBeGreaterThan(10)
      expect(allAgents).toContain(RULE_AGENT[rule])
    }
  })
  it('keeps the educational copy free of raw enum shapes and fake-data language', () => {
    for (const text of [...Object.values(AGENT_DESCRIPTIONS), ...Object.values(RULE_DATA_SOURCES)]) expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/)
    for (const detail of Object.values(RULE_DETAILS)) for (const text of [detail.trigger, detail.impact, detail.healthy]) expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/)
  })
  it('provides a tooltip for every status tab', () => {
    for (const tab of STATUS_TABS) expect(STATUS_TAB_TOOLTIPS[tab].length).toBeGreaterThan(10)
  })
  it('provides tooltips for every KPI', () => {
    const keys = Object.keys(KPI_TOOLTIPS).sort()
    expect(keys).toEqual(['approvalRate', 'approvedThisMonth', 'averageDecision', 'monthlyUsage', 'pendingImpact'])
  })
})

describe('greeting helpers', () => {
  it('greets by time of day', () => {
    expect(greetingForHour(8)).toBe('Good morning')
    expect(greetingForHour(13)).toBe('Good afternoon')
    expect(greetingForHour(20)).toBe('Good evening')
  })
  it('turns a shop domain into a human name', () => {
    expect(shopDisplayName('demo-store.myshopify.com')).toBe('Demo Store')
    expect(shopDisplayName('acme.myshopify.com')).toBe('Acme')
    expect(shopDisplayName(null)).toBeNull()
  })
  it('drops the ProfitPilot "pilot" brand suffix from the greeting name', () => {
    expect(shopDisplayName('commander-pilot.myshopify.com')).toBe('Commander')
    expect(shopDisplayName('commander.myshopify.com')).toBe('Commander')
    expect(shopDisplayName('pilot.myshopify.com')).toBe('Pilot')
    expect(shopDisplayName('acme.myshopify.com')).toBe('Acme')
  })
  it('covers every rule with a tagline, emoji, and find-bullet list', () => {
    for (const rule of Object.keys(RULE_LABELS) as (keyof typeof RULE_LABELS)[]) {
      expect(RULE_TAGLINES[rule].length).toBeGreaterThan(8)
      expect(RULE_EMOJIS[rule].length).toBeGreaterThan(0)
    }
    expect(TEAM_FIND_BULLETS.length).toBeGreaterThanOrEqual(5)
  })
})

describe('health tone', () => {
  it('grades the deterministic score into merchant words', () => {
    expect(healthTone(null).label).toBe('Learning')
    expect(healthTone(Number.NaN).label).toBe('Learning')
    expect(healthTone(95).label).toBe('Excellent')
    expect(healthTone(80).label).toBe('Excellent')
    expect(healthTone(61).label).toBe('Good')
    expect(healthTone(45).label).toBe('Fair')
    expect(healthTone(12).label).toBe('Needs attention')
  })
  it('always pairs the label with a hint', () => {
    for (const score of [null, 0, 55, 82, 100]) expect(healthTone(score).hint.length).toBeGreaterThan(8)
  })
})
