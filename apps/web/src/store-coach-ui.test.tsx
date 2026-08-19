import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TrendingUp, Trophy } from 'lucide-react'
import {
  BadgeRadar,
  BigNumberCard,
  CoachEmptyState,
  CoachErrorState,
  CoachGenerationSteps,
  CoachHealthBadge,
  CoachSkeletonMain,
  PriorityCard,
  RadialGauge,
  Sparkline,
  Toggle,
  coachPathForView,
  coachViewFromPath,
} from './store-coach.js'
import {
  COACH_LIMITS,
  PERSONALITY_META,
  STREAK_BADGE_TARGETS,
  badgeTitleFromId,
  coachPersonalitiesForPlan,
  daypartForHour,
  formatCoachDate,
  formatCoachDateRange,
  greetingForDaypart,
  huddleActionLabelForDaypart,
  heatmapPatterns,
  huddleTimeLabel,
  merchantDisplayName,
  nextStreakMilestone,
  dailyCoachTip,
  engagementPill,
  friendlyFeasibility,
  learningMoment,
  paceLabel,
  planFeatureSummary,
  streakStatusCopy,
  weekCelebration,
  whyPriorityMatters,
} from './store-coach-model.js'
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
  })
  it('falls back to the coach home for retired placeholder paths', () => {
    // /briefing and /insights used to render "coming soon" panels.
    expect(coachViewFromPath('/ai-growth-command/briefing')).toBe('coach')
    expect(coachViewFromPath('/ai-growth-command/insights')).toBe('coach')
  })
  it('builds paths for every view', () => {
    expect(coachPathForView('goals')).toBe('/ai-growth-command/coach/goals')
    expect(coachPathForView('progress')).toBe('/ai-growth-command/coach/progress')
    expect(coachPathForView('achievements')).toBe('/ai-growth-command/coach/achievements')
    expect(coachPathForView('settings')).toBe('/ai-growth-command/coach/settings')
    expect(coachPathForView('coach')).toBe('/ai-growth-command/coach')
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
  it('formats briefing and review dates from ISO days', () => {
    expect(formatCoachDate('2026-08-18')).toMatch(/Aug 18,? 2026/)
    expect(formatCoachDateRange('2026-08-17', '2026-08-23')).toContain('2026')
    expect(formatCoachDate('not-a-date')).toBe('not-a-date')
  })
})

// ---------------------------------------------------------------------------
// Redesign helpers (FIX 2, 6, 7, 12)
// ---------------------------------------------------------------------------

describe('Personalized hero greeting (FIX 2)', () => {
  it('buckets hours into dayparts', () => {
    expect(daypartForHour(6)).toBe('morning')
    expect(daypartForHour(11)).toBe('morning')
    expect(daypartForHour(13)).toBe('afternoon')
    expect(daypartForHour(18)).toBe('evening')
    expect(daypartForHour(23)).toBe('night')
    expect(daypartForHour(2)).toBe('night')
  })
  it('greets for every daypart without naming a wrong tier or inventing data', () => {
    expect(greetingForDaypart('morning')).toBe('Good morning')
    expect(greetingForDaypart('afternoon')).toBe('Good afternoon')
    expect(greetingForDaypart('evening')).toBe('Good evening')
    expect(greetingForDaypart('night')).toBe('Burning the midnight oil')
    expect(huddleActionLabelForDaypart('afternoon')).toBe('Start Afternoon Huddle')
    expect(huddleActionLabelForDaypart('night')).toBe('Start Night Huddle')
  })
  it('derives the merchant name from the real shop domain only', () => {
    expect(merchantDisplayName('anas-apparel.myshopify.com')).toBe('Anas Apparel')
    expect(merchantDisplayName('best-store')).toBe('Best Store')
    expect(merchantDisplayName('shop.example.org')).toBe('Shop')
    expect(merchantDisplayName(null)).toBeNull()
    expect(merchantDisplayName('123456.myshopify.com')).toBeNull()
  })
})

describe('Heatmap pattern derivation (FIX 6) — real cells only', () => {
  it('returns an honest empty result when there are no cells', () => {
    const empty = heatmapPatterns([])
    expect(empty.totalOrders).toBe(0)
    expect(empty.bestWeekday).toBeNull()
    expect(empty.weekendDeltaPct).toBeNull()
  })
  it('computes weekday averages, best day, and weekend delta from real cells', () => {
    const cells = [
      // Sundays: 8 orders per week for 3 weeks
      ...[0, 1, 2].map((week) => ({ weekday: 0, orders: 8, day: `sun-${week}`, revenue: 800, intensity: 0.9, week })),
      // Mondays: 2 orders per week for 3 weeks
      ...[0, 1, 2].map((week) => ({ weekday: 1, orders: 2, day: `mon-${week}`, revenue: 200, intensity: 0.3, week })),
    ]
    const patterns = heatmapPatterns(cells)
    expect(patterns.totalOrders).toBe(30)
    expect(patterns.activeDays).toBe(6)
    expect(patterns.bestWeekday).toBe(0)
    expect(patterns.quietWeekday).toBe(1)
    // With fewer than 10 active days the weekend delta stays hidden
    expect(patterns.weekendDeltaPct).toBeNull()
  })
  it('reports the weekend delta once there is enough spread', () => {
    const cells: { weekday: number; orders: number }[] = []
    for (let week = 0; week < 8; week += 1) {
      cells.push({ weekday: 0, orders: 10 })
      cells.push({ weekday: 6, orders: 10 })
      for (let weekday = 1; weekday <= 5; weekday += 1) cells.push({ weekday, orders: 5 })
    }
    const patterns = heatmapPatterns(cells)
    expect(patterns.weekendDeltaPct).toBe(100)
    expect(patterns.bestWeekday).toBe(0)
  })
})

describe('Streak milestones (FIX 7)', () => {
  it('targets the next unread milestone with clamped progress', () => {
    expect(nextStreakMilestone(0)).toEqual({ target: 3, progressPct: 0 })
    expect(nextStreakMilestone(3)).toEqual({ target: 7, progressPct: Math.round((3 / 7) * 100) })
    expect(nextStreakMilestone(6)).toEqual({ target: 7, progressPct: Math.round((6 / 7) * 100) })
  })
  it('returns null once every milestone is earned', () => {
    expect(nextStreakMilestone(100)).toBeNull()
    expect(nextStreakMilestone(250)).toBeNull()
  })
  it('maps the backend streak badge ladder', () => {
    expect(STREAK_BADGE_TARGETS['3_DAY_STREAK']).toBe(3)
    expect(STREAK_BADGE_TARGETS['100_DAY_STREAK']).toBe(100)
    expect(badgeTitleFromId('7_DAY_STREAK')).toBe('7 Day Streak')
    expect(badgeTitleFromId('FIRST_HUDDLE')).toBe('First Huddle')
  })
})

describe('Plan feature summary (FIX 12)', () => {
  it('lists exactly what each tier includes', () => {
    const trial = planFeatureSummary('trial')
    expect(trial.included.join(' ')).toContain('2 personalized priorities per day')
    expect(trial.included.join(' ')).toContain('Daily morning briefings')
    expect(trial.upgradeTeaser).not.toBeNull()
    const commander = planFeatureSummary('commander')
    expect(commander.included.join(' ')).toContain('Unlimited personalized priorities per day')
    expect(commander.included.join(' ')).toContain('Weekly PDF reports')
    expect(commander.upgradeTeaser).toBeNull()
  })
  it('teases upgrades without promising fake store outcomes', () => {
    const start = planFeatureSummary('start')
    expect(start.upgradeTeaser).toContain('More personalized priorities each day')
    const growth = planFeatureSummary('growth')
    expect(growth.upgradeTeaser).toContain('Weekly PDF reports')
    for (const summary of [planFeatureSummary('trial'), planFeatureSummary('start'), planFeatureSummary('growth')]) {
      for (const line of [...summary.included, ...(summary.upgradeTeaser ?? [])]) {
        expect(line).not.toMatch(/your revenue|guaranteed|\$/i)
      }
    }
  })
})

describe('Store Coach components', () => {
  it('renders the milestone bars with accessible percent label', () => {
    const html = renderToStaticMarkup(createElement(RadialGauge, { percent: 64, tone: 'green' }))
    expect(html).toContain('Goal progress 64%')
    expect(html).toContain('coach-milestone-bars')
    expect(html).toContain('64%')
  })
  it('clamps the milestone bars at 100', () => {
    const html = renderToStaticMarkup(createElement(RadialGauge, { percent: 140, tone: 'amber' }))
    expect(html).toContain('100%')
  })
  it('renders the three priority category accents with Mark as done / Skip', () => {
    const high = renderToStaticMarkup(createElement(PriorityCard, { priority: PRIORITY, busy: false, onComplete: () => undefined, onDismiss: () => undefined }))
    expect(high).toContain('coach-priority-card red')
    expect(high).toContain('High Impact')
    expect(high).toContain('$1,281')
    expect(high).toContain('15 min')
    // The control only records completion; it does not perform the task.
    expect(high).toContain('Mark as done')
    expect(high).not.toContain('Take Action')
    expect(high).toContain('Skip')
    const quick = renderToStaticMarkup(createElement(PriorityCard, { priority: { ...PRIORITY, category: 'QUICK_WIN', id: 'p2' }, busy: true, onComplete: () => undefined, onDismiss: () => undefined }))
    expect(quick).toContain('coach-priority-card green')
    expect(quick).toContain('Quick Win')
    const opportunity = renderToStaticMarkup(createElement(PriorityCard, { priority: { ...PRIORITY, category: 'OPPORTUNITY', id: 'p3' }, busy: false, onComplete: () => undefined, onDismiss: () => undefined }))
    expect(opportunity).toContain('coach-priority-card amber')
    expect(opportunity).toContain('Opportunity')
  })
  it('falls back to a growth label when a priority has no dollar estimate', () => {
    const html = renderToStaticMarkup(createElement(PriorityCard, { priority: { ...PRIORITY, impactValue: 0, impactLabel: '' }, busy: false, onComplete: () => undefined, onDismiss: () => undefined }))
    expect(html).toContain('Growth')
    expect(html).not.toContain('$1,281')
  })
  it('renders the animated generation steps for the briefing', () => {
    const html = renderToStaticMarkup(createElement(CoachGenerationSteps))
    expect(html).toContain('coach-generating-steps')
    expect(html).toContain('Looking at your recent sales and customers')
    expect(html).toContain('Writing your personalized briefing')
  })
  it('renders big number cards with trend arrows', () => {
    const html = renderToStaticMarkup(createElement(BigNumberCard, { label: 'Revenue', value: '$3,631', trendPct: 12.4, series: [100, 120, 110, 140, 160], icon: TrendingUp }))
    expect(html).toContain('12.4%')
    expect(html).toContain('coach-big-number')
    const down = renderToStaticMarkup(createElement(BigNumberCard, { label: 'Revenue', value: '$3,631', trendPct: -5.1, series: [], icon: TrendingUp }))
    expect(down).toContain('coach-trend down')
  })
  it('renders momentum wave for inline metric cards', () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { values: [10, 20, 15, 30, 25] }))
    expect(html).toContain('coach-momentum-wave')
    expect(html).toContain('Weekly momentum wave')
  })
  it('renders the badge radar from real per-category counts, not the old empty-dot constellation', () => {
    const html = renderToStaticMarkup(createElement(BadgeRadar, {
      categories: [
        { category: 'STREAK', earned: 2, total: 10 },
        { category: 'REVENUE', earned: 1, total: 8 },
        { category: 'GROWTH', earned: 0, total: 10 },
        { category: 'ENGAGEMENT', earned: 0, total: 12 },
        { category: 'SPECIAL', earned: 1, total: 10 },
      ],
      earnedTotal: 4,
    }))
    expect(html).toContain('coach-badge-radar')
    expect(html).not.toContain('coach-constellation')
    expect(html).toContain('Streaks')
    expect(html).toContain('Revenue')
    expect(html).toContain('Special')
    expect(html).toContain('2/10')
    expect(html).toContain('1/8')
    expect(html).toContain('of 50 earned')
  })
  it('renders an honest fallback when the badge catalog has not loaded', () => {
    const html = renderToStaticMarkup(createElement(BadgeRadar, { categories: [], earnedTotal: 3 }))
    expect(html).toContain('coach-badge-radar-empty')
    expect(html).toContain('The badge radar didn’t load this time')
    expect(html).toContain('3 earned badges are safe')
  })
  it('renders educational empty states with actions', () => {
    const html = renderToStaticMarkup(createElement(CoachEmptyState, { icon: Trophy, title: 'Set your first weekly goal', description: 'Goals give the Coach a north star.', action: 'Get AI suggestions', onAction: () => undefined }))
    expect(html).toContain('Set your first weekly goal')
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

describe('Human-friendly coaching copy (zero fake data)', () => {
  it('encourages a 0-day streak instead of sounding sad', () => {
    expect(engagementPill(0)).toBe('Just getting started')
    const copy = streakStatusCopy(0, false)
    expect(copy.headline).toBe('Build your streak')
    expect(copy.detail.toLowerCase()).not.toContain('0-day')
    expect(copy.cta).toBe('Check in today')
  })
  it('derives tips only from real store state', () => {
    const fromPriorities = dailyCoachTip({ huddleInsight: null, heatmapBestWeekday: null, pendingPriorities: 2, hasGoal: false, streakDays: 0 })
    expect(fromPriorities.body).toContain('2 actions waiting')
    const fromPattern = dailyCoachTip({ huddleInsight: null, heatmapBestWeekday: 0, pendingPriorities: 0, hasGoal: true, streakDays: 4 })
    expect(fromPattern.body).toContain('Sunday')
    const empty = dailyCoachTip({ huddleInsight: null, heatmapBestWeekday: null, pendingPriorities: 0, hasGoal: true, streakDays: 3 })
    expect(empty.body).not.toMatch(/\d+%|3x|studies show/i)
  })
  it('returns null celebration when there is nothing real to cheer', () => {
    expect(weekCelebration({ revenueTrendPct: null, completedPriorities: 0, goalProgressPct: null, earnedBadges: 0 })).toBeNull()
    const win = weekCelebration({ revenueTrendPct: 12.4, completedPriorities: 2, goalProgressPct: 40, earnedBadges: 1 })
    expect(win?.items.join(' ')).toContain('12.4%')
    expect(win?.items.join(' ')).toContain('2 priorities finished')
  })
  it('uses friendly feasibility labels', () => {
    expect(friendlyFeasibility('HIGH')).toBe('Well within reach')
    expect(friendlyFeasibility('LOW')).toMatch(/Ambitious/)
  })
  it('keeps learning moments free of invented statistics', () => {
    const lesson = learningMoment({ heatmapBestWeekday: 6, hasGoal: false })
    expect(lesson.body).toContain('Saturday')
    expect(lesson.body).not.toMatch(/\d+%/ )
  })
})
