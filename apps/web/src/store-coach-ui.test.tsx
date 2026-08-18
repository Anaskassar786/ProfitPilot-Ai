import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TrendingUp, Trophy } from 'lucide-react'
import {
  BigNumberCard,
  CoachEmptyState,
  CoachErrorState,
  CoachHealthBadge,
  CoachSkeletonMain,
  PriorityCard,
  RadialGauge,
  Sparkline,
  coachPathForView,
  coachViewFromPath,
} from './store-coach.js'
import { Toggle } from './store-coach.js'
import { COACH_LIMITS, PERSONALITY_META, coachPersonalitiesForPlan, huddleTimeLabel, paceLabel } from './store-coach-model.js'
import type { CoachPriority } from './store-coach-model.js'

const PRIORITY: CoachPriority = {
  id: 'p1',
  priorityDate: '2026-08-18',
  category: 'HIGH_IMPACT',
  title: 'Check the revenue dip',
  description: 'Yesterday revenue was below the 7-day average.',
  impactValue: 1280.5,
  impactCurrency: 'USD',
  impactLabel: '7-day revenue',
  timeEstimateMinutes: 15,
  actionType: 'navigate',
  actionPayload: {},
  status: 'PENDING',
  expiresAt: null,
}

describe('Store Coach routing', () => {
  it('maps deep-link paths to views', () => {
    expect(coachViewFromPath('/ai-growth-command')).toBe('coach')
    expect(coachViewFromPath('/ai-growth-command/coach')).toBe('coach')
    expect(coachViewFromPath('/ai-growth-command/coach/goals')).toBe('goals')
    expect(coachViewFromPath('/ai-growth-command/coach/progress')).toBe('progress')
    expect(coachViewFromPath('/ai-growth-command/coach/chat')).toBe('chat')
    expect(coachViewFromPath('/ai-growth-command/coach/achievements')).toBe('achievements')
    expect(coachViewFromPath('/ai-growth-command/coach/settings')).toBe('settings')
    expect(coachViewFromPath('/ai-growth-command/briefing')).toBe('briefing')
    expect(coachViewFromPath('/ai-growth-command/insights')).toBe('insights')
  })
  it('builds paths for every view', () => {
    expect(coachPathForView('goals')).toBe('/ai-growth-command/coach/goals')
    expect(coachPathForView('briefing')).toBe('/ai-growth-command/briefing')
    expect(coachPathForView('insights')).toBe('/ai-growth-command/insights')
  })
})

describe('Store Coach plan matrix (frontend mirror)', () => {
  it('matches the backend feature matrix', () => {
    expect(COACH_LIMITS.trial.prioritiesPerDay).toBe(2)
    expect(COACH_LIMITS.trial.activeGoals).toBe(1)
    expect(COACH_LIMITS.trial.chatMessagesPerDay).toBe(5)
    expect(COACH_LIMITS.trial.progressHistoryDays).toBe(7)
    expect(COACH_LIMITS.start.prioritiesPerDay).toBe(3)
    expect(COACH_LIMITS.growth.prioritiesPerDay).toBe(5)
    expect(COACH_LIMITS.growth.chatMessagesPerDay).toBe(100)
    expect(COACH_LIMITS.trial.voice).toBe(false)
    expect(COACH_LIMITS.start.voice).toBe(false)
    expect(COACH_LIMITS.growth.voice).toBe(true)
    expect(COACH_LIMITS.commander.weeklyPdf).toBe(true)
    expect(COACH_LIMITS.growth.weeklyPdf).toBe(false)
    expect(COACH_LIMITS.trial.widget).toBe(false)
    expect(COACH_LIMITS.start.widget).toBe(true)
  })
  it('unlocks personalities progressively', () => {
    expect(coachPersonalitiesForPlan('trial')).toEqual(['PROFESSIONAL'])
    expect(coachPersonalitiesForPlan('start')).toEqual(['PROFESSIONAL', 'MOTIVATIONAL'])
    expect(coachPersonalitiesForPlan('growth')).toHaveLength(4)
    expect(coachPersonalitiesForPlan('commander')).toHaveLength(4)
  })
})

describe('Store Coach formatting', () => {
  it('formats huddle times in 12-hour style', () => {
    expect(huddleTimeLabel(420)).toBe('7:00 AM')
    expect(huddleTimeLabel(540)).toBe('9:00 AM')
    expect(huddleTimeLabel(1200)).toBe('8:00 PM')
  })
  it('labels goal pace', () => {
    expect(paceLabel('ON_TRACK')).toBe('On Track')
    expect(paceLabel('BEHIND')).toBe('Behind')
    expect(paceLabel('AHEAD')).toBe('Ahead')
  })
  it('describes all four personalities', () => {
    expect(Object.keys(PERSONALITY_META)).toHaveLength(4)
    for (const meta of Object.values(PERSONALITY_META)) {
      expect(meta.sample.length).toBeGreaterThan(20)
    }
  })
})

describe('Store Coach components', () => {
  it('renders the radial gauge with accessible percent label', () => {
    const html = renderToStaticMarkup(createElement(RadialGauge, { percent: 64, tone: 'green' }))
    expect(html).toContain('Goal progress 64%')
    expect(html).toContain('coach-radial-value green')
    expect(html).toContain('64%')
  })
  it('clamps the radial gauge at 100', () => {
    const html = renderToStaticMarkup(createElement(RadialGauge, { percent: 140, tone: 'amber' }))
    expect(html).toContain('100%')
  })
  it('renders the three priority category accents', () => {
    const high = renderToStaticMarkup(createElement(PriorityCard, { priority: PRIORITY, busy: false, onComplete: () => undefined, onDismiss: () => undefined }))
    expect(high).toContain('coach-priority-card red')
    expect(high).toContain('High Impact')
    expect(high).toContain('$1,281')
    expect(high).toContain('15 min')
    const quick = renderToStaticMarkup(createElement(PriorityCard, { priority: { ...PRIORITY, category: 'QUICK_WIN', id: 'p2' }, busy: true, onComplete: () => undefined, onDismiss: () => undefined }))
    expect(quick).toContain('coach-priority-card green')
    expect(quick).toContain('Quick Win')
    const opportunity = renderToStaticMarkup(createElement(PriorityCard, { priority: { ...PRIORITY, category: 'OPPORTUNITY', id: 'p3' }, busy: false, onComplete: () => undefined, onDismiss: () => undefined }))
    expect(opportunity).toContain('coach-priority-card amber')
    expect(opportunity).toContain('Opportunity')
  })
  it('renders big number cards with trend arrows and sparkline', () => {
    const html = renderToStaticMarkup(createElement(BigNumberCard, { label: 'Revenue', value: '$3,631', trendPct: 12.4, series: [100, 120, 110, 140, 160], icon: TrendingUp }))
    expect(html).toContain('12.4%')
    expect(html).toContain('coach-sparkline')
    const down = renderToStaticMarkup(createElement(BigNumberCard, { label: 'Revenue', value: '$3,631', trendPct: -5.1, series: [], icon: TrendingUp }))
    expect(down).toContain('coach-trend down')
  })
  it('renders sparklines for inline metric cards', () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { values: [10, 20, 15, 30, 25] }))
    expect(html).toContain('<polyline')
    expect(html).toContain('aria-hidden="true"')
  })
  it('renders educational empty states with actions', () => {
    const html = renderToStaticMarkup(createElement(CoachEmptyState, { icon: Trophy, title: 'Set your first goal', description: 'Goals give the Coach a north star.', action: 'Get AI suggestions', onAction: () => undefined }))
    expect(html).toContain('Set your first goal')
    expect(html).toContain('Get AI suggestions')
  })
  it('renders error states with retry and upgrade actions', () => {
    const html = renderToStaticMarkup(createElement(CoachErrorState, { error: 'Store Coach is locked on your current plan. Upgrade to keep coaching.', onRetry: () => undefined, onNavigateBilling: () => undefined }))
    expect(html).toContain('Retry')
    expect(html).toContain('Upgrade Plan')
  })
  it('renders skeleton loaders instead of blank screens', () => {
    const html = renderToStaticMarkup(createElement(CoachSkeletonMain))
    expect(html).toContain('Loading Store Coach')
    expect(html).toContain('coach-skeleton-card')
  })
  it('renders the health badge tones', () => {
    const good = renderToStaticMarkup(createElement(CoachHealthBadge, { score: 84, label: 'Highly engaged', tone: 'good' }))
    expect(good).toContain('coach-health-badge good')
    expect(good).toContain('84')
    const empty = renderToStaticMarkup(createElement(CoachHealthBadge, { score: null, label: 'No activity yet', tone: 'low' }))
    expect(empty).toContain('—')
  })
  it('renders accessible toggles', () => {
    const html = renderToStaticMarkup(createElement(Toggle, { value: true, onChange: () => undefined }))
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
  })
})
