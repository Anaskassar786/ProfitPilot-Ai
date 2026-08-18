// ---------------------------------------------------------------------------
// Store Coach preview fixture server — DEV-ONLY, never shipped or used in CI.
//
// Serves deterministic, internally-consistent FIXTURE payloads so the
// redesigned Store Coach UI can be visually reviewed in both themes without a
// real Shopify connection. Every number below is a labeled layout fixture
// (the shop is "fixture-demo"), NOT real merchant data — the production app
// only ever renders numbers that come from the real backend's grounded
// pipeline. Set PREVIEW_PLAN=trial|start|growth|commander to review plan
// gating, PREVIEW_EMPTY=1 to review the honest empty states.
//
//   node scripts/store-coach-preview-fixture-server.mjs   # port 3000
// ---------------------------------------------------------------------------
import { createServer } from 'node:http'

const PORT = Number(process.env.PREVIEW_PORT ?? 3000)
const PLAN = (process.env.PREVIEW_PLAN ?? 'growth').toLowerCase()
const EMPTY = process.env.PREVIEW_EMPTY === '1'
const STORE = 'preview-store'

const envelope = (data) => JSON.stringify({ ok: true, data, requestId: 'preview-fixture' })
const now = Date.now()
const isoDay = (offsetDays) => {
  const date = new Date(now + offsetDays * 86_400_000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}
// Deterministic pseudo-random in [0,1) so fixtures are stable across reloads.
const rand = (seed) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x) }

const PLAN_LIMITS = {
  trial: { priorities: 2, goals: 1, chat: 5, badges: 5 },
  start: { priorities: 3, goals: 2, chat: 20, badges: 15 },
  growth: { priorities: 5, goals: 5, chat: 100, badges: 30 },
  commander: { priorities: 999, goals: 999, chat: 999, badges: 50 },
}
const limits = PLAN_LIMITS[PLAN] ?? PLAN_LIMITS.growth

// ── 30-day revenue series (deterministic, weekends stronger) ──────────────
const series = Array.from({ length: 30 }, (_, index) => {
  const day = isoDay(index - 29)
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  const weekendBoost = weekday === 0 || weekday === 6 ? 1.35 : 1
  const revenue = Math.round((180 + rand(index) * 260) * weekendBoost)
  return { day, revenue, orders: Math.max(1, Math.round(revenue / 65)) }
})
const comparisonSeries = Array.from({ length: 30 }, (_, index) => {
  const day = isoDay(index - 59)
  return { day, revenue: Math.round(150 + rand(index + 60) * 220) }
})
const revenue = series.reduce((sum, row) => sum + row.revenue, 0)
const orders = series.reduce((sum, row) => sum + row.orders, 0)
const previousRevenue = comparisonSeries.reduce((sum, row) => sum + row.revenue, 0)

// ── Heatmap: 12 weeks × 7 weekdays ────────────────────────────────────────
const heatCells = []
for (let week = 0; week < 12; week += 1) {
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const seed = week * 7 + weekday
    const weekendBoost = weekday === 0 || weekday === 6 ? 1.5 : 0.85
    const value = rand(seed)
    if (value < 0.18) continue
    const dailyOrders = Math.max(1, Math.round(value * 9 * weekendBoost))
    heatCells.push({ day: isoDay(-((11 - week) * 7 + ((6 - weekday + 4) % 7))), weekday, week, orders: dailyOrders, revenue: dailyOrders * 62, intensity: Math.min(dailyOrders / 12, 1) })
  }
}

// ── Badge catalog (mirrors the 50-badge backend catalog for layout QA) ────
const BADGES = [
  ['FIRST_HUDDLE', 'First Huddle', 'Viewed your first daily huddle', 'STREAK', 'COMMON'],
  ['3_DAY_STREAK', 'Three in a Row', 'Viewed huddles 3 days in a row', 'STREAK', 'COMMON'],
  ['7_DAY_STREAK', 'One Week Strong', 'Viewed huddles 7 days in a row', 'STREAK', 'UNCOMMON'],
  ['14_DAY_STREAK', 'Fortnight Focus', 'Viewed huddles 14 days in a row', 'STREAK', 'UNCOMMON'],
  ['30_DAY_STREAK', 'Habit Formed', 'Viewed huddles 30 days in a row', 'STREAK', 'UNCOMMON'],
  ['60_DAY_STREAK', 'Sixty-Day Savant', 'Viewed huddles 60 days in a row', 'STREAK', 'RARE'],
  ['100_DAY_STREAK', 'Coach Master', 'Viewed huddles 100 days in a row', 'STREAK', 'EPIC'],
  ['STREAK_COMEBACK', 'Comeback', 'Returned after a streak of 3+ ended', 'STREAK', 'COMMON'],
  ['WEEKEND_WARRIOR', 'Weekend Warrior', 'Viewed huddles on a weekend', 'STREAK', 'COMMON'],
  ['EARLY_BIRD', 'Early Bird', 'Viewed a morning huddle 10 times', 'STREAK', 'COMMON'],
  ['FIRST_100_DAY', 'First $100 Day', 'First day with $100+ gross revenue', 'REVENUE', 'COMMON'],
  ['FIRST_500_DAY', 'First $500 Day', 'First day with $500+ gross revenue', 'REVENUE', 'COMMON'],
  ['FIRST_1000_DAY', 'First $1K Day', 'First day with $1,000+ gross revenue', 'REVENUE', 'COMMON'],
  ['FIRST_5000_DAY', 'First $5K Day', 'First day with $5,000+ gross revenue', 'REVENUE', 'RARE'],
  ['BEST_DAY_EVER', 'Best Day Ever', 'Set a new single-day revenue record', 'REVENUE', 'COMMON'],
  ['WEEK_10K', 'Ten-K Week', 'Week with $10,000+ gross revenue', 'REVENUE', 'RARE'],
  ['MONTH_50K', 'Fifty-K Month', 'Month with $50,000+ gross revenue', 'REVENUE', 'RARE'],
  ['QUARTER_100K', 'Six-Figure Quarter', 'Quarter with $100,000+ gross revenue', 'REVENUE', 'LEGENDARY'],
  ['10_PERCENT_GROWTH', 'Growing Steadily', '10%+ revenue growth vs last week', 'GROWTH', 'COMMON'],
  ['25_PERCENT_GROWTH', 'Quarter Leap', '25%+ revenue growth vs last week', 'GROWTH', 'UNCOMMON'],
  ['50_PERCENT_GROWTH', 'Half Again', '50%+ revenue growth vs last week', 'GROWTH', 'RARE'],
  ['FIRST_100_CUSTOMERS', '100 Customers', '100 lifetime customers', 'GROWTH', 'COMMON'],
  ['FIRST_1000_CUSTOMERS', '1,000 Customers', '1,000 lifetime customers', 'GROWTH', 'UNCOMMON'],
  ['HIGH_RETENTION', 'Retention Rockstar', '30%+ repeat purchase rate', 'GROWTH', 'COMMON'],
  ['LOW_CHURN', 'Churn Crusher', 'Reduced churn by 20%+', 'GROWTH', 'UNCOMMON'],
  ['AOV_UP', 'Bigger Baskets', 'AOV increased 10%+ vs last period', 'GROWTH', 'COMMON'],
  ['CROSS_SELL_MASTER', 'Cross-Sell Master', 'Approved a cross-sell recommendation', 'GROWTH', 'UNCOMMON'],
  ['VIP_BUILDER', 'VIP Builder', 'Tagged 10 VIP customers', 'GROWTH', 'UNCOMMON'],
  ['FIRST_GOAL', 'Goal Setter', 'Set your first goal', 'ENGAGEMENT', 'COMMON'],
  ['GOAL_ACHIEVER', 'Goal Achiever', 'Achieved a weekly goal', 'ENGAGEMENT', 'COMMON'],
  ['GOAL_MASTER', 'Goal Master', 'Achieved 5 goals', 'ENGAGEMENT', 'RARE'],
  ['CHAT_STARTER', 'Chat Starter', 'Sent your first chat message', 'ENGAGEMENT', 'COMMON'],
  ['CURIOUS_MIND', 'Curious Mind', 'Asked 20 chat questions', 'ENGAGEMENT', 'COMMON'],
  ['ACTION_TAKER', 'Action Taker', 'Completed 10 priorities', 'ENGAGEMENT', 'COMMON'],
  ['ORGANIZED', 'Fully Organized', 'Completed every priority in one day', 'ENGAGEMENT', 'COMMON'],
  ['REVIEWER', 'Reviewer', 'Read 4 weekly reviews', 'ENGAGEMENT', 'COMMON'],
  ['OPTIMIZER', 'Optimizer', 'Adjusted coach preferences', 'ENGAGEMENT', 'COMMON'],
  ['ONBOARDED', 'Onboarded', 'Completed Store Coach onboarding', 'ENGAGEMENT', 'COMMON'],
  ['PERSONALITY_EXPLORER', 'Personality Explorer', 'Tried more than one personality', 'ENGAGEMENT', 'UNCOMMON'],
  ['FEATURE_EXPLORER', 'Feature Explorer', 'Used every Store Coach feature', 'ENGAGEMENT', 'UNCOMMON'],
  ['BETA_TESTER', 'Beta Tester', 'Used the app during beta', 'SPECIAL', 'COMMON'],
  ['EARLY_ADOPTER', 'Early Adopter', 'Signed up in the first month', 'SPECIAL', 'UNCOMMON'],
  ['FEEDBACK_HERO', 'Feedback Hero', 'Provided product feedback', 'SPECIAL', 'COMMON'],
  ['REFERRER', 'Referrer', 'Referred another merchant', 'SPECIAL', 'UNCOMMON'],
  ['ALL_ROUNDER', 'All-Rounder', 'Uses all app modules', 'SPECIAL', 'RARE'],
  ['ZERO_STOCKOUT', 'Zero Stockout', 'A full month without stockouts', 'SPECIAL', 'UNCOMMON'],
  ['COMEBACK_KID', 'Comeback Kid', 'Returned after churning', 'SPECIAL', 'COMMON'],
  ['HIGH_ROLLER', 'High Roller', 'Approved 10 recommendations', 'SPECIAL', 'UNCOMMON'],
  ['AUTOMATION_PRO', 'Automation Pro', 'Created 5 workflows', 'SPECIAL', 'UNCOMMON'],
  ['COMMANDER_LEVEL', 'Commander Level', 'Upgraded to the Commander plan', 'SPECIAL', 'EPIC'],
]
const EARNED_IDS = EMPTY ? [] : ['FIRST_HUDDLE', 'ONBOARDED']

const server = createServer((request, response) => {
  const url = String(request.url ?? '/')
  const send = (data, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(envelope(data)) }
  const notFound = (message) => { response.writeHead(404, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message, details: {} } })) }

  if (request.method !== 'GET') { send({ ok: true }) ; return }
  if (url.includes('/session/context')) return send({ storeId: STORE, shop: 'fixture-demo.myshopify.com' })
  if (url.includes('/security/csrf')) return send({ csrfToken: 'preview-fixture-token' })

  if (url.includes('/store-coach/huddle/today')) {
    if (EMPTY) return send(null)
    return send({
      id: 'huddle-preview', huddleDate: isoDay(0), viewed: false, createdAt: now - 3_600_000, plan: PLAN, voiceAvailable: PLAN === 'growth' || PLAN === 'commander',
      content: {
        greeting: 'Good morning! Here’s what matters today.',
        yesterdaySnapshot: `Yesterday you booked ${series[29]?.orders ?? 8} orders for $${series[29]?.revenue ?? 340} — up 12% versus the same weekday last week.`,
        keyInsight: `Sundays are your strongest day: 35% of this week’s ${orders} orders landed on a Sunday. Consider scheduling Sunday-specific promotions.`,
        todayPreview: `Three opportunities are waiting below. Est. review time: 2 minutes — enough to move $2,340 of pipeline.`,
        reviewMinutes: 2,
      },
    })
  }
  if (url.includes('/store-coach/priorities/today')) {
    if (EMPTY) return send({ priorityDate: isoDay(0), priorities: [], planLimit: limits.priorities, remainingToday: limits.priorities })
    return send({
      priorityDate: isoDay(0), planLimit: limits.priorities, remainingToday: limits.priorities,
      priorities: [
        { id: 'pr1', priorityDate: isoDay(0), category: 'HIGH_IMPACT', title: 'Save 5 VIP customers at churn risk', description: 'Five customers with $2,340 combined lifetime value have not ordered in 60+ days. A win-back email typically recovers a meaningful share.', impactValue: 2340, impactCurrency: 'USD', impactLabel: 'combined LTV at risk', timeEstimateMinutes: 15, actionType: 'review', actionPayload: {}, status: 'PENDING', expiresAt: now + 86_400_000 },
        { id: 'pr2', priorityDate: isoDay(0), category: 'QUICK_WIN', title: 'Tag 8 new customers as “New Customer”', description: 'Eight first-time buyers are untagged. Tagging keeps segmentation clean for your next campaign.', impactValue: 0, impactCurrency: 'USD', impactLabel: '', timeEstimateMinutes: 3, actionType: 'review', actionPayload: {}, status: 'PENDING', expiresAt: now + 86_400_000 },
        { id: 'pr3', priorityDate: isoDay(0), category: 'OPPORTUNITY', title: 'Weekend sale is trending +15%', description: 'Weekend revenue is 15% above your trailing baseline. Extending the promotion two more days could capture the tail of the demand.', impactValue: 890, impactCurrency: 'USD', impactLabel: 'modeled weekend uplift', timeEstimateMinutes: 5, actionType: 'review', actionPayload: {}, status: 'PENDING', expiresAt: now + 86_400_000 },
      ].slice(0, Math.min(limits.priorities, 3)),
    })
  }
  if (url.includes('/store-coach/goals/suggestions')) {
    if (EMPTY) return send([])
    return send([
      { title: 'Increase revenue by 15%', description: 'Beat last week’s revenue by 15% — your current trend supports this.', metric: 'REVENUE', targetValue: 2691, currency: 'USD', feasibility: 'HIGH', rationale: `Last week closed at $2,340; a 15% lift matches your best recent week ($2,690).` },
      { title: 'Get 10 new customers', description: 'Ten first-time buyers this week, up from your 6/week average.', metric: 'CUSTOMERS', targetValue: 10, currency: 'USD', feasibility: 'MEDIUM', rationale: 'Your weekly average is 6 new customers; 10 is ambitious but reachable with a weekend push.' },
      { title: 'Hold AOV above $68', description: 'Keep average order value at or above $68 for the week.', metric: 'AOV', targetValue: 68, currency: 'USD', feasibility: 'HIGH', rationale: 'Your 30-day AOV is $68 — protecting it is realistic while volume grows.' },
    ])
  }
  if (/\/store-coach\/goals\/[^/]+\/progress/.test(url)) {
    return send({ current: EMPTY ? 0 : 2205, target: 2691, progressPct: EMPTY ? 0 : 82, daysElapsed: 4, daysTotal: 7, daysRemaining: 3, pace: 'ON_TRACK', requiredDailyPace: 162, actualDailyPace: EMPTY ? 0 : 315, feasibility: 'HIGH' })
  }
  if (url.includes('/store-coach/goals')) {
    if (EMPTY) return send([])
    return send([
      { id: 'goal-1', goalType: 'WEEKLY', title: 'Increase revenue by 15%', description: 'Beat last week’s $2,340 by 15% — tracked automatically from synced orders.', metric: 'REVENUE', targetValue: 2691, targetCurrency: 'USD', startDate: isoDay(-4), endDate: isoDay(3), status: 'ACTIVE', currentProgress: 2205, feasibility: 'HIGH' },
    ])
  }
  if (url.includes('/store-coach/progress/summary')) {
    return send({ window: 30, revenue: EMPTY ? 0 : revenue, orders: EMPTY ? 0 : orders, aov: EMPTY ? 0 : Math.round(revenue / Math.max(orders, 1)), customers: EMPTY ? 0 : 58, revenueTrendPct: EMPTY ? 0 : Math.round(((revenue - previousRevenue) / Math.max(previousRevenue, 1)) * 1000) / 10, series: EMPTY ? [] : series, comparisonSeries: EMPTY ? [] : comparisonSeries })
  }
  if (url.includes('/store-coach/progress/heatmap')) {
    const byDay = new Map()
    for (const cell of heatCells) byDay.set(cell.day, cell)
    let bestDay = null
    let bestOrders = -1
    for (const [day, cell] of byDay) if (cell.orders > bestOrders) { bestOrders = cell.orders; bestDay = day }
    return send({ weeks: 12, bestDay: EMPTY ? null : bestDay, busiestWeek: EMPTY ? null : 'Aug 11 – Aug 17', cells: EMPTY ? [] : heatCells, legend: [0, 3, 6, 9, 12] })
  }
  if (url.includes('/store-coach/progress/comparisons')) {
    return send({
      revenue: { current: EMPTY ? 0 : revenue, previous: EMPTY ? 0 : previousRevenue, changePct: EMPTY ? 0 : Math.round(((revenue - previousRevenue) / Math.max(previousRevenue, 1)) * 1000) / 10 },
      orders: { current: EMPTY ? 0 : orders, previous: EMPTY ? 0 : Math.round(orders * 0.88), changePct: EMPTY ? 0 : 12.4 },
    })
  }
  if (url.includes('/store-coach/progress/trends')) {
    return send({ metric: 'orders', window: 30, series: EMPTY ? [] : series.map((row) => ({ day: row.day, value: row.orders })) })
  }
  if (url.includes('/store-coach/achievements/available')) {
    return send({
      earnedIds: EARNED_IDS,
      visible: limits.badges,
      catalog: BADGES.map(([id, title, description, category, rarity]) => ({ id, title, description, category, rarity, earned: EARNED_IDS.includes(id), earnedAt: EARNED_IDS.includes(id) ? now - 3_600_000 : null })),
    })
  }
  if (url.includes('/store-coach/achievements')) {
    return send({ earned: EARNED_IDS.map((badgeId, index) => ({ id: `earned-${index}`, badgeId, earnedAt: now - (index + 1) * 3_600_000, context: {} })), visible: limits.badges })
  }
  if (url.includes('/store-coach/streak')) return send({ currentStreak: EMPTY ? 0 : 4, longestStreak: EMPTY ? 0 : 9, lastActiveDate: isoDay(-1), todayViewed: false })
  if (url.includes('/store-coach/review/current')) {
    if (EMPTY) return notFound('No review yet')
    return send({
      id: 'review-preview', reportDate: isoDay(-1), pdfUrl: null, sentViaEmail: false, commanderPdf: PLAN === 'commander',
      content: {
        subject: 'Great week — momentum is building',
        weekWins: [`Revenue hit $2,690 — up 15% versus the previous week`, `12 new customers, your best week this month`, `4 abandoned carts recovered ($340)`],
        metrics: [
          { label: 'Revenue', value: '$2,690', change: '+15% vs last week' },
          { label: 'Orders', value: '41', change: '+12%' },
          { label: 'New customers', value: '12', change: '+3' },
          { label: 'AOV', value: '$66', change: '+2.1%' },
        ],
        learnings: ['Sundays are consistently your strongest sales day', 'Bundles lifted AOV on weekend traffic', 'Win-back emails recovered 4 carts within 48 hours'],
        nextWeekFocus: ['Schedule the Sunday promotion by Friday', 'Tag new customers for segmentation', 'Review pricing on slow movers'],
        suggestedGoal: { title: 'Reach $3,000 weekly revenue', description: 'A 11.5% step up from this week — matches your current pace.' },
      },
    })
  }
  if (url.includes('/store-coach/preferences')) {
    return send({ storeId: STORE, personality: 'MOTIVATIONAL', huddleTimeMinutes: 420, huddleEnabled: true, weeklyEmailEnabled: true, voiceEnabled: PLAN === 'growth' || PLAN === 'commander', widgetEnabled: PLAN !== 'trial', language: 'en', notificationFrequency: 'NORMAL', updatedAt: now - 86_400_000, plan: PLAN })
  }
  if (url.includes('/store-coach/usage')) {
    return send({ plan: PLAN, chatMessagesToday: 7, chatLimit: limits.chat, huddlesGeneratedToday: 1, activeGoals: EMPTY ? 0 : 1, goalLimit: limits.goals, chatAtWarning: false, chatExhausted: false })
  }
  if (url.includes('/store-coach/health-score')) {
    return send({ score: EMPTY ? null : 72, label: EMPTY ? 'No activity yet' : 'Highly engaged', tone: EMPTY ? 'low' : 'good', factors: {}, history: [] })
  }
  if (url.includes('/store-coach/chat/history')) return send({ id: 'conv-preview', messages: [] })
  if (url.includes('/store-coach/chat/suggestions')) {
    return send(['How did my store do yesterday?', 'Which products should I promote?', 'How can I get more repeat customers?', 'What’s my biggest opportunity right now?'])
  }
  if (url.includes('/ai-executive/dashboard')) {
    return send({ storeId: STORE, plan: PLAN, currency: 'USD', health: null, latestReport: null, nextReportDue: isoDay(7), benchmarkPosition: null, opportunities: [], risks: [], scenarios: [], roadmap: null, decisions: [], usage: { plan: PLAN, features: [] }, gates: {}, revenueSeries: [], ordersSeries: [], generatedAt: new Date(now).toISOString() })
  }
  notFound('Not part of the preview fixture')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Store Coach preview fixture server on http://127.0.0.1:${PORT} — plan=${PLAN} empty=${EMPTY ? 'yes' : 'no'} (dev-only, layout fixtures — not real merchant data)`)
})
