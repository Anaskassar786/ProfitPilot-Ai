import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flame,
  Gauge,
  Gem,
  Goal,
  Handshake,
  Heart,
  History,
  Lightbulb,
  LockKeyhole,
  Mail,
  MessageSquare,
  MoonStar,
  Mountain,
  RefreshCw,
  Rocket,
  Settings,
  Smile,
  Sparkles,
  Sun,
  SunMedium,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Waves,
  Zap,
} from 'lucide-react'
import { ApiClientError, completeCoachPriority, dismissCoachPriority, fetchCoachActivityHeatmap, fetchCoachAchievements, fetchCoachAvailableAchievements, fetchCoachGoals, fetchCoachHealthScore, fetchCoachHuddle, fetchCoachPreferences, fetchCoachPriorities, fetchCoachProgressSummary, fetchCoachProgressTrends, fetchCoachReview, fetchCoachStreak, fetchCoachUsage, markCoachHuddleViewed, regenerateCoachHuddle, regenerateCoachPriorities } from './api.js'
import type { WorkspaceContext } from './model.js'
import { formatMoney, formatNumber } from './model.js'
import {
  COACH_LIMITS,
  PERSONALITY_META,
  PLAN_LABEL,
  STREAK_BADGE_TARGETS,
  WEEKDAY_LABELS,
  WEEKDAY_LABELS_SHORT,
  badgeTitleFromId,
  coachPersonalitiesForPlan,
  dailyCoachTip,
  daypartForHour,
  engagementPill,
  formatCoachDate,
  friendlyFeasibility,
  greetingForDaypart,
  heatmapPatterns,
  huddleTimeLabel,
  learningMoment,
  merchantDisplayName,
  nextStreakMilestone,
  openAiCommand,
  paceLabel,
  planFeatureSummary,
  relativeTimeLabel,
  reviewSnapshot,
  streakStatusCopy,
  weekCelebration,
  whyPriorityMatters,
} from './store-coach-model.js'
import type {
  CoachAchievement,
  CoachBadgeCatalogEntry,
  CoachGoal,
  CoachHeatmapView,
  CoachHuddle,
  CoachPersonality,
  CoachPlan,
  CoachPreferencesView,
  CoachPriority,
  CoachPrioritiesView,
  CoachProgressSummary,
  CoachReviewSnapshot,
  CoachReviewView,
  CoachStreakView,
  CoachUsageView,
} from './store-coach-model.js'
import { CoachOnboardingModal } from './store-coach-panels.js'

export type CoachToast = (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void

// ---------------------------------------------------------------------------
// Routing (path-based, preserves the Shopify query string)
// ---------------------------------------------------------------------------

/**
 * Store Coach views. `/briefing` and `/insights` used to resolve to
 * placeholder "coming soon" panels; `/insights` is owned by PatternAI and
 * `/briefing` never shipped, so both now fall back to the coach home
 * instead of advertising unbuilt features.
 */
export type CoachView = 'coach' | 'goals' | 'progress' | 'chat' | 'achievements' | 'settings'

export function coachViewFromPath(pathname: string): CoachView {
  const path = pathname.replace(/\/+$/, '')
  if (path.endsWith('/coach/goals')) return 'goals'
  if (path.endsWith('/coach/progress')) return 'progress'
  if (path.endsWith('/coach/chat')) return 'chat'
  if (path.endsWith('/coach/achievements')) return 'achievements'
  if (path.endsWith('/coach/settings')) return 'settings'
  return 'coach'
}

export function coachPathForView(view: CoachView): string {
  switch (view) {
    case 'goals': return '/ai-growth-command/coach/goals'
    case 'progress': return '/ai-growth-command/coach/progress'
    case 'chat': return '/ai-growth-command/coach/chat'
    case 'achievements': return '/ai-growth-command/coach/achievements'
    case 'settings': return '/ai-growth-command/coach/settings'
    default: return '/ai-growth-command/coach'
  }
}

function useCoachView(): readonly [CoachView, (view: CoachView) => void] {
  const [view, setView] = useState<CoachView>(() => coachViewFromPath(window.location.pathname))
  useEffect(() => {
    const onPopState = (): void => setView(coachViewFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const navigate = useCallback((next: CoachView) => {
    const path = coachPathForView(next) + window.location.search
    if (window.location.pathname !== coachPathForView(next)) window.history.pushState({}, '', path)
    setView(next)
  }, [])
  return [view, navigate]
}

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------

type CoachLoadState = 'loading' | 'ready' | 'partial' | 'error'

export type CoachData = Readonly<{
  huddle: CoachHuddle | null
  priorities: CoachPrioritiesView | null
  goals: readonly CoachGoal[]
  summary: CoachProgressSummary | null
  heatmap: CoachHeatmapView | null
  achievements: readonly CoachAchievement[]
  badgeCatalog: readonly CoachBadgeCatalogEntry[]
  streak: CoachStreakView | null
  review: CoachReviewView | null
  preferences: CoachPreferencesView | null
  usage: CoachUsageView | null
  health: Readonly<{ score: number | null; label: string; tone: 'good' | 'ok' | 'low' }> | null
}>

/** Stable identity so `useMemo` deps do not change on every render. */
const EMPTY_HEATMAP_CELLS: CoachHeatmapView['cells'] = []

const EMPTY_COACH_DATA: CoachData = {
  huddle: null,
  priorities: null,
  goals: [],
  summary: null,
  heatmap: null,
  achievements: [],
  badgeCatalog: [],
  streak: null,
  review: null,
  preferences: null,
  usage: null,
  health: null,
}

export function useCoachData(storeId: string | null): readonly [CoachData, CoachLoadState, string | null, () => void] {
  const [data, setData] = useState<CoachData>(EMPTY_COACH_DATA)
  const [loadState, setLoadState] = useState<CoachLoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!storeId) { setData(EMPTY_COACH_DATA); setLoadState('ready'); setError(null); return }
    setLoadState('loading')
    const [huddle, priorities, goals, summary, heatmap, achievements, badges, streak, review, preferences, usage, health] = await Promise.allSettled([
      fetchCoachHuddle(storeId),
      fetchCoachPriorities(storeId),
      fetchCoachGoals(storeId, 'ACTIVE'),
      // Ask for the widest dashboard window; the API clamps it down to the
      // store's real plan entitlement and echoes the window it served.
      fetchCoachProgressSummary(storeId, 90),
      fetchCoachActivityHeatmap(storeId),
      fetchCoachAchievements(storeId),
      fetchCoachAvailableAchievements(storeId),
      fetchCoachStreak(storeId),
      // A 404 here is an expected absence (no weekly review generated yet),
      // not a failure — the home view already renders the card conditionally.
      // Counting it as a failure would flag every fresh store as 'partial'
      // and false-trigger the partial-load banner.
      fetchCoachReview(storeId).catch((error: unknown) => {
        if (error instanceof ApiClientError && error.status === 404) return null
        throw error
      }),
      fetchCoachPreferences(storeId),
      fetchCoachUsage(storeId),
      fetchCoachHealthScore(storeId),
    ])
    const catalog = badges.status === 'fulfilled' && Array.isArray(badges.value.catalog) ? badges.value.catalog : []
    const next: CoachData = {
      huddle: huddle.status === 'fulfilled' ? huddle.value : null,
      priorities: priorities.status === 'fulfilled' ? priorities.value : null,
      goals: goals.status === 'fulfilled' ? goals.value : [],
      summary: summary.status === 'fulfilled' ? summary.value : null,
      heatmap: heatmap.status === 'fulfilled' ? heatmap.value : null,
      achievements: achievements.status === 'fulfilled' ? achievements.value.earned : [],
      badgeCatalog: catalog,
      streak: streak.status === 'fulfilled' ? streak.value : null,
      review: review.status === 'fulfilled' ? review.value : null,
      preferences: preferences.status === 'fulfilled' ? preferences.value : null,
      usage: usage.status === 'fulfilled' ? usage.value : null,
      health: health.status === 'fulfilled' ? { score: health.value.score, label: health.value.label, tone: health.value.tone } : null,
    }
    setData(next)
    const failed = [huddle, priorities, goals, summary, heatmap, achievements, badges, streak, review, preferences, usage, health].filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed.length === 0) { setLoadState('ready'); setError(null) }
    else {
      const first = failed[0]!.reason
      const message = first instanceof ApiClientError && first.status === 402 ? 'Store Coach is locked on your current plan. Upgrade Plan to keep coaching.' : first instanceof Error ? first.message : 'Some Store Coach data could not be loaded.'
      setLoadState(failed.length >= 10 ? 'error' : 'partial')
      setError(message)
    }
  }, [storeId])
  useEffect(() => { void load() }, [load])
  return [data, loadState, error, load]
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export function StoreCoachWorkspace({ context, onToast, onNavigateBilling }: { context: WorkspaceContext; onToast: CoachToast; onNavigateBilling: () => void }) {
  const [view, navigate] = useCoachView()
  const [data, loadState, error, reload] = useCoachData(context.storeId)
  const plan: CoachPlan = data.usage?.plan ?? data.preferences?.plan ?? data.huddle?.plan ?? 'trial'
  const [onboardingOpen, setOnboardingOpen] = useState(false)

  return (
    <div className="coach-workspace">
      <CoachHero
        shop={context.shop}
        plan={plan}
        health={data.health}
        streak={data.streak}
        usage={data.usage}
        onSettings={() => navigate('settings')}
        onOnboarding={() => setOnboardingOpen(true)}
        onHuddle={() => {
          if (!context.storeId) return
          if (data.huddle && !data.huddle.viewed) { void markCoachHuddleViewed(context.storeId, data.huddle.id).then(() => reload()).catch(() => undefined); return }
          void onHuddleClick(context.storeId, onToast, reload)
        }}
      />

      {error && loadState === 'error' ? (
        <CoachErrorState error={error} onRetry={reload} onNavigateBilling={onNavigateBilling} />
      ) : (
        <CoachMain
          view={view}
          context={context}
          data={data}
          loadState={loadState}
          plan={plan}
          onToast={onToast}
          onNavigate={navigate}
          onNavigateBilling={onNavigateBilling}
          onReload={reload}
          onOpenOnboarding={() => setOnboardingOpen(true)}
        />
      )}
      {onboardingOpen && context.storeId && (
        <CoachOnboardingModal storeId={context.storeId} plan={plan} onClose={() => { setOnboardingOpen(false); void reload() }} onToast={onToast} />
      )}
    </div>
  )
}

/** @deprecated Use StoreCoachWorkspace — Store Coach is its own sidebar page. */
export const AiGrowthCommandWorkspace = StoreCoachWorkspace

function daypartIcon(part: ReturnType<typeof daypartForHour>, size = 16): ReactNode {
  if (part === 'morning') return <Sun size={size} />
  if (part === 'afternoon') return <SunMedium size={size} />
  if (part === 'evening') return <SunMedium size={size} />
  return <MoonStar size={size} />
}

function GrowthPathwayIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 18 L8 14 L12 16 L16 9 L20 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6 H20 V11" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="18" r="1.7" fill="currentColor" />
      <circle cx="8" cy="14" r="1.7" fill="currentColor" />
      <circle cx="12" cy="16" r="1.7" fill="currentColor" />
      <circle cx="16" cy="9" r="1.7" fill="currentColor" />
      <path d="M18.2 3.2 L19.6 2 L21 3.4 L19.6 4.8 Z" fill="currentColor" />
    </svg>
  )
}

/**
 * FIX 2 — personal, welcoming hero. Time-based greeting, real merchant name
 * derived from the shop domain, live streak, honest engagement status, and
 * the two actions merchants open every morning.
 */
function CoachHero({ shop, plan, health, streak, onSettings, onOnboarding, onHuddle }: {
  shop: string | null
  plan: CoachPlan
  health: CoachData['health']
  streak: CoachStreakView | null
  usage: CoachUsageView | null
  onSettings: () => void
  onOnboarding: () => void
  onHuddle: () => void
}) {
  const hour = new Date().getHours()
  const part = daypartForHour(hour)
  const greeting = greetingForDaypart(part)
  const merchantName = merchantDisplayName(shop)
  const streakDays = streak?.currentStreak ?? 0
  return (
    <header className="coach-hero">
      <div className="coach-hero-main">
        <span className="coach-avatar" aria-hidden="true">
          <GrowthPathwayIcon size={26} />
          <i className="coach-avatar-presence" title="Your coach is here" />
        </span>
        <div className="coach-hero-copy">
          <div className="coach-hero-eyebrow">
            <span className="coach-hero-brand">Your personal store growth coach</span>
          </div>
          <h1 className="coach-hero-title">
            {greeting}{merchantName ? `, ${merchantName}` : ''}! <span className="coach-hero-daypart">{daypartIcon(part, 20)}</span>
          </h1>
          <p className="coach-hero-sub">Let’s grow together today — I’ll keep things simple and focused on what actually helps your store.</p>
          <div className="coach-hero-meta">
            <span className="coach-meta-pill" title="Where you are on your coaching journey">
              <Handshake size={13} />
              {engagementPill(streakDays)}
            </span>
            <span className="coach-meta-pill streak" title="Consecutive days you checked in with your coach">
              <Flame size={13} />
              Streak: {streakDays} day{streakDays === 1 ? '' : 's'}
            </span>
            {health && (
              <span className={`coach-meta-pill ${health.tone}`} title="How consistently you are using Store Coach">
                <i className="pill-dot" />
                {health.label}
              </span>
            )}
            <span className={`coach-plan-badge ${plan}`}>{PLAN_LABEL[plan]}</span>
          </div>
        </div>
      </div>
      <div className="coach-hero-actions">
        <button className="button primary" onClick={onHuddle}><Sun size={15} /> Start Morning Huddle</button>
        <button className="icon-button coach-hero-icon" onClick={onOnboarding} aria-label="Take the two-minute tour" title="Take the two-minute tour"><Sparkles size={16} /></button>
        <button className="icon-button coach-hero-icon" onClick={onSettings} aria-label="Store Coach settings" title="Store Coach settings"><Settings size={16} /></button>
      </div>
    </header>
  )
}

export function CoachHealthBadge({ score, label, tone }: { score: number | null; label: string; tone: 'good' | 'ok' | 'low' }) {
  return (
    <span className={`coach-health-badge ${tone}`} title="Store Coach engagement score">
      <Gauge size={14} />
      <strong>{score === null ? '—' : score}</strong>
      <small>{label}</small>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function CoachMain({ view, context, data, loadState, plan, onToast, onNavigate, onNavigateBilling, onReload, onOpenOnboarding }: {
  view: CoachView
  context: WorkspaceContext
  data: CoachData
  loadState: CoachLoadState
  plan: CoachPlan
  onToast: CoachToast
  onNavigate: (view: CoachView) => void
  onNavigateBilling: () => void
  onReload: () => void
  onOpenOnboarding: () => void
}) {
  if (view === 'goals') return <CoachGoalsView context={context} goals={data.goals} plan={plan} onToast={onToast} onNavigate={onNavigate} onNavigateBilling={onNavigateBilling} />
  if (view === 'progress') return <CoachProgressView context={context} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} />
  if (view === 'chat') return <CoachAskRedirect onBack={() => onNavigate('coach')} />
  if (view === 'achievements') return <CoachAchievementsView context={context} achievements={data.achievements} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} />
  if (view === 'settings') return <CoachSettingsView context={context} preferences={data.preferences} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} onReload={onReload} />

  if (!context.storeId) {
    return <CoachEmptyState icon={Mountain} title="Connect Shopify to meet your Store Coach" description="Your coach builds every briefing, priority, and goal from your real store. Nothing here is invented." action="Connect Shopify" onAction={onOpenOnboarding} />
  }
  if (loadState === 'loading') return <CoachSkeletonMain />
  if (loadState === 'error') return <CoachErrorState error="Store Coach could not load. Check your connection and retry." onRetry={onReload} onNavigateBilling={onNavigateBilling} />

  return (
    <div className="coach-main">
      {loadState === 'partial' && <CoachPartialBanner onRetry={onReload} />}
      <section className="coach-sections">
        <TodayBriefingCard storeId={context.storeId!} huddle={data.huddle} plan={plan} onToast={onToast} onReload={onReload} onOpenTour={onOpenOnboarding} />
        <CoachValueStrip data={data} onFocusGoals={() => onNavigate('goals')} onFocusDays={() => onNavigate('progress')} />
        <PrioritiesSection storeId={context.storeId!} priorities={data.priorities} plan={plan} onToast={onToast} onReload={onReload} onNavigate={() => onNavigate('goals')} onNavigateBilling={onNavigateBilling} />
        <GoalSection storeId={context.storeId!} goals={data.goals} plan={plan} onToast={onToast} onNavigate={() => onNavigate('goals')} onNavigateBilling={onNavigateBilling} />
        <ProgressDashboard summary={data.summary} plan={plan} onNavigate={() => onNavigate('progress')} onNavigateBilling={onNavigateBilling} onRetry={onReload} />
        <BestDaysSection heatmap={data.heatmap} onNavigate={() => onNavigate('progress')} onRetry={onReload} />
        <AchievementsSection achievements={data.achievements} badgeCatalog={data.badgeCatalog} streak={data.streak} plan={plan} onNavigate={() => onNavigate('achievements')} onViewHuddle={() => { void onHuddleClick(context.storeId!, onToast, onReload) }} />
        <CoachStyleSection storeId={context.storeId!} preferences={data.preferences} plan={plan} onToast={onToast} onReload={onReload} onNavigateBilling={onNavigateBilling} />
        {data.review && context.storeId && <WeeklyReviewCard storeId={context.storeId} review={data.review} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} onSetGoal={() => onNavigate('goals')} />}
        <CoachPlanCard plan={plan} onNavigateBilling={onNavigateBilling} />
        <section className="coach-card coach-ai-redirect">
          <span className="coach-redirect-icon"><MessageSquare size={18} /></span>
          <div>
            <strong>💬 Need to ask your coach a question?</strong>
            <p>Head over to AI Command where you can have detailed conversations about your store and get instant answers.</p>
            <button className="button primary" onClick={openAiCommand}>Open AI Command →</button>
          </div>
        </section>
      </section>
      <div className="coach-onboarding-nudge"><Smile size={15} /><span>New here? Take a quick 2-minute tour to see how your Store Coach can help you grow.</span><button className="text-button" onClick={onOpenOnboarding}>Start Interactive Tour <ChevronRight size={14} /></button></div>
    </div>
  )
}

async function onHuddleClick(storeId: string, onToast: CoachToast, onReload: () => void): Promise<void> {
  try {
    await regenerateCoachHuddle(storeId)
    onToast('Today’s huddle refreshed from your real store data.', 'success')
    onReload()
  } catch (error: unknown) {
    onToast(errorMessage(error), 'error')
  }
}

// ---------------------------------------------------------------------------
// 1. Today's briefing card (FIX 3 — rich daily briefing)
// ---------------------------------------------------------------------------

const HUDDLE_STEPS = [
  { label: 'Looking at your recent sales and customers', detail: 'From your actual store' },
  { label: 'Checking how this week compares', detail: 'Against your own recent days' },
  { label: 'Finding today’s best opportunities', detail: 'Only where growth is possible' },
  { label: 'Writing your personalized briefing', detail: 'In your coach’s style' },
] as const

function TodayBriefingCard({ storeId, huddle, onToast, onReload, onOpenTour }: { storeId: string; huddle: CoachHuddle | null; plan: CoachPlan; onToast: CoachToast; onReload: () => void; onOpenTour: () => void }) {
  const [generating, setGenerating] = useState(false)

  const generate = () => {
    setGenerating(true)
    void regenerateCoachHuddle(storeId)
      .then(() => { onToast('Today’s briefing is ready.', 'success'); onReload() })
      .catch((error: unknown) => onToast(errorMessage(error), 'error'))
      .finally(() => setGenerating(false))
  }

  if (!huddle && !generating) {
    return (
      <section className="coach-card coach-briefing-card">
        <CoachCardHeading kicker="TODAY’S BRIEFING" dot="purple" title="Welcome — I’m glad you’re here" />
        <div className="coach-briefing-welcome">
          <span className="coach-illustration"><GrowthPathwayIcon size={28} /></span>
          <div className="coach-briefing-welcome-copy">
            <strong>✨ We’re getting to know your store…</strong>
            <p>I’m here to help you grow every day. Here’s what I do for you: morning briefings with real insights, personal priorities for the day, weekly goal tracking, and celebrating your wins.</p>
            <ul className="coach-briefing-bullets"><li>🌅 Morning briefings with real insights</li><li>🎯 Personal priorities for the day</li><li>📊 Track your weekly goals</li><li>🏆 Celebrate your wins</li></ul>
            <div className="coach-briefing-welcome-actions">
              <button className="button primary" onClick={generate}><Sparkles size={15} /> Show Me Today’s Insights</button>
              <button className="button secondary" onClick={onOpenTour}><BookOpenCheck size={15} /> Learn how it works</button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  if (!huddle && generating) {
    return (
      <section className="coach-card coach-briefing-card">
        <CoachCardHeading kicker="TODAY’S BRIEFING" dot="purple" title="Your coach is preparing today’s briefing…" />
        <div className="coach-briefing-generating">
          <CoachGenerationSteps />
          <p className="coach-generating-note"><Clock3 size={13} /> This usually takes a few moments. I’ll only share numbers I can see in your store.</p>
        </div>
      </section>
    )
  }

  if (generating) {
    return (
      <section className="coach-card coach-briefing-card">
        <div className="coach-refreshing-strip"><RefreshCw size={14} className="spin" /> Refreshing today’s briefing from your latest store activity…</div>
        <BriefingReadyCard storeId={storeId} huddle={huddle!} onToast={onToast} onReload={onReload} />
      </section>
    )
  }

  return <section className="coach-card coach-briefing-card"><BriefingReadyCard storeId={storeId} huddle={huddle!} onToast={onToast} onReload={onReload} /></section>
}

/** Animated step checklist shown while the AI writes the briefing. Steps advance on a timer; completion is the real API promise. */
export function CoachGenerationSteps({ stepMs = 2600 }: { stepMs?: number }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setStep((current) => Math.min(current + 1, HUDDLE_STEPS.length - 1)), stepMs)
    return () => window.clearInterval(timer)
  }, [stepMs])
  return (
    <ol className="coach-generating-steps" aria-label="Briefing generation progress">
      {HUDDLE_STEPS.map((entry, index) => (
        <li key={entry.label} className={index < step ? 'done' : index === step ? 'active' : 'pending'}>
          <span className="coach-generating-step-icon">
            {index < step ? <Check size={13} /> : index === step ? <RefreshCw size={13} className="spin" /> : <Clock3 size={13} />}
          </span>
          <span className="coach-generating-step-copy">
            <strong>{entry.label}</strong>
            <small>{entry.detail}</small>
          </span>
        </li>
      ))}
    </ol>
  )
}

function BriefingReadyCard({ storeId, huddle, onToast, onReload }: { storeId: string; huddle: CoachHuddle; onToast: CoachToast; onReload: () => void }) {
  const content = huddle.content
  const greeting = typeof content.greeting === 'string' ? content.greeting : 'Good morning.'
  const yesterday = typeof content.yesterdaySnapshot === 'string' ? content.yesterdaySnapshot : ''
  const preview = typeof content.todayPreview === 'string' ? content.todayPreview : ''
  const insight = typeof content.keyInsight === 'string' ? content.keyInsight : ''
  const minutes = typeof content.reviewMinutes === 'number' ? content.reviewMinutes : 2
  return (
    <>
      <div className="coach-briefing-top">
        <div>
          <CoachCardHeading kicker={`TODAY’S BRIEFING · ${formatCoachDate(huddle.huddleDate).toUpperCase()}`} dot="purple" title="Here’s what’s important today" />
          <h2 className="coach-greeting">{greeting}</h2>
          <p className="coach-briefing-lede">A short look at your store — two or three things worth your time.</p>
        </div>
        <div className="coach-briefing-actions">
          <span className="coach-review-time"><Clock3 size={13} /> {minutes} min</span>
          <button className="button secondary coach-briefing-refresh" onClick={() => { void onHuddleClick(storeId, onToast, onReload) }}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="coach-briefing-grid">
        <CoachBriefingCell label="Yesterday" icon={History} text={yesterday} />
        <CoachBriefingCell label="Worth noticing" icon={Lightbulb} text={insight} />
        <CoachBriefingCell label="Focus today" icon={Target} text={preview} />
      </div>
      <div className="coach-briefing-footer">
        {huddle.viewed ? (
          <span className="coach-viewed-note"><CheckCircle2 size={13} /> Checked in — your streak is safe for today</span>
        ) : (
          <button className="button primary" onClick={() => { void markCoachHuddleViewed(storeId, huddle.id).then(() => onReload()).catch((error: unknown) => onToast(errorMessage(error), 'error')) }}><Check size={14} /> I’ve read this — keep my streak going</button>
        )}
        <div className="coach-briefing-footer-side">
          <span className="coach-data-note"><Sparkles size={12} /> Based on your actual store performance.</span>
        </div>
      </div>
    </>
  )
}

function CoachBriefingCell({ label, icon: Icon, text }: { label: string; icon: LucideIcon; text: string }) {
  return <div className="coach-briefing-cell"><span className="coach-briefing-cell-icon"><Icon size={15} /></span><div><strong>{label}</strong><p>{text || 'Still getting to know this part of your store. Sync a few more orders and I’ll fill this in.'}</p></div></div>
}

// ---------------------------------------------------------------------------
// 2. Priorities (FIX 4 — rich, actionable priority cards)
// ---------------------------------------------------------------------------

function PrioritiesSection({ storeId, priorities, plan, onToast, onReload, onNavigate, onNavigateBilling }: { storeId: string; priorities: CoachPrioritiesView | null; plan: CoachPlan; onToast: CoachToast; onReload: () => void; onNavigate: () => void; onNavigateBilling: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<string>>(new Set())
  const visible = (priorities?.priorities ?? []).filter((priority) => !resolvedIds.has(priority.id)).slice(0, Math.max(priorities?.planLimit ?? COACH_LIMITS[plan].prioritiesPerDay as number, 1))
  const planLimit = priorities?.planLimit ?? COACH_LIMITS[plan].prioritiesPerDay as number
  const remaining = priorities ? priorities.priorities.filter((priority) => !resolvedIds.has(priority.id) && priority.status === 'PENDING').length : 0
  const regenerate = () => { void regenerateCoachPriorities(storeId).then(() => onReload()).catch((error: unknown) => onToast(errorMessage(error), 'error')) }
  const complete = (id: string) => {
    setBusyId(id)
    void completeCoachPriority(storeId, id).then(() => {
      setResolvedIds((current) => new Set([...current, id]))
      onToast('Priority completed. The Coach learns from what you finish.', 'success')
    }).catch((error: unknown) => onToast(errorMessage(error), 'error')).finally(() => setBusyId(null))
  }
  const dismiss = (id: string) => {
    setBusyId(id)
    void dismissCoachPriority(storeId, id).then(() => {
      setResolvedIds((current) => new Set([...current, id]))
      onToast('Priority skipped. The Coach will suggest something else next time.', 'info')
    }).catch((error: unknown) => onToast(errorMessage(error), 'error')).finally(() => setBusyId(null))
  }
  return (
    <section className="coach-card coach-priorities-section">
      <div className="coach-section-head">
        <CoachCardHeading kicker="TODAY'S TOP PRIORITIES" dot="red" title={priorities === null ? 'Building your priorities…' : visible.length === 0 ? 'Everything is handled' : `${remaining} action${remaining === 1 ? '' : 's'} worth your time today`} />
        <div className="coach-section-head-actions">
          <span className="coach-plan-chip">{planLimit >= 999 ? 'You get unlimited personalized priorities each day' : `You get ${planLimit} personalized ${planLimit === 1 ? 'priority' : 'priorities'} each day`}</span>
          {plan !== 'commander' && <button className="text-button" onClick={onNavigateBilling}>Upgrade Plan for more priorities →</button>}
          <button className="text-button" onClick={regenerate}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>
      {priorities === null ? (
        <div className="coach-building-priorities">
          <div>
            <strong>Your Coach is analyzing your store…</strong>
            <p>I’m reading your recent synced orders to find the actions actually worth your time. This only takes a moment.</p>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="coach-all-clear">
          <span className="coach-all-clear-icon"><CheckCircle2 size={26} /></span>
          <div className="coach-all-clear-copy">
            <strong>All caught up — great news!</strong>
            <p>No urgent actions for today. Your store looks steady, or there isn’t enough recent activity to suggest a move. Come back tomorrow, or set a weekly goal below while things are calm.</p>
            <div className="coach-all-clear-actions">
              <button className="button primary" onClick={onNavigate}><Target size={14} /> Set a weekly goal</button>
              <button className="button secondary" onClick={regenerate}><RefreshCw size={14} /> Refresh analysis</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="coach-priority-grid">
          {visible.map((priority) => <PriorityCard key={priority.id} priority={priority} busy={busyId === priority.id} onComplete={() => complete(priority.id)} onDismiss={() => dismiss(priority.id)} />)}
        </div>
      )}
    </section>
  )
}

export function PriorityCard({ priority, busy, onComplete, onDismiss }: { priority: CoachPriority; busy: boolean; onComplete: () => void; onDismiss: () => void }) {
  const meta = priority.category === 'HIGH_IMPACT' ? { icon: Flame, tone: 'red', label: 'High Impact' } : priority.category === 'QUICK_WIN' ? { icon: Zap, tone: 'green', label: 'Quick Win' } : { icon: Heart, tone: 'amber', label: 'Opportunity' }
  const Icon = meta.icon
  return (
    <article className={`coach-priority-card ${meta.tone}`}>
      <div className="coach-priority-top">
        <span className="coach-priority-icon"><Icon size={15} /></span>
        <span className="coach-priority-category">{meta.label}</span>
        <span className="coach-priority-time"><Clock3 size={12} /> Takes {priority.timeEstimateMinutes} min</span>
      </div>
      <h3>{priority.title}</h3>
      <p>{priority.description}</p>
      <p className="coach-priority-why">{whyPriorityMatters(priority)}</p>
      <div className="coach-priority-impact">
        <strong>{priority.impactValue > 0 ? formatMoney(priority.impactValue, priority.impactCurrency) : 'Growth'}</strong>
        <span>{priority.impactValue > 0 && priority.impactLabel ? `Impact: ${priority.impactLabel}` : 'Impact: long-term momentum'}</span>
      </div>
      <div className="coach-priority-actions">
        <button className="button primary" disabled={busy} onClick={onComplete}><Check size={14} /> {busy ? 'Saving…' : 'Mark as done'}</button>
        <button className="text-button" disabled={busy} onClick={onDismiss}>Skip</button>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// 3. Weekly goal card with radial gauge (FIX 5)
// ---------------------------------------------------------------------------

function GoalSection({ storeId, goals, plan, onToast, onNavigate, onNavigateBilling }: { storeId: string; goals: readonly CoachGoal[]; plan: CoachPlan; onToast: CoachToast; onNavigate: () => void; onNavigateBilling: () => void }) {
  const [progress, setProgress] = useState<Readonly<Record<string, import('./store-coach-model.js').CoachGoalProgress>>>({})
  const [suggestions, setSuggestions] = useState<readonly import('./store-coach-model.js').CoachGoalSuggestion[] | null>(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [accepting, setAccepting] = useState(-1)
  const active = goals[0]
  const goalPct = active ? Math.min((progress[active.id]?.current ?? active.currentProgress) / Math.max(active.targetValue, 1) * 100, 100) : 0

  useEffect(() => {
    if (!active) return
    void import('./api.js').then(({ fetchCoachGoalProgress }) => fetchCoachGoalProgress(storeId, active.id)).then((view) => setProgress((current) => ({ ...current, [active.id]: view }))).catch(() => undefined)
  }, [storeId, active?.id])

  // No goal yet → proactively load the Coach's AI-suggested goals (built from
  // the real trend) so the empty state is immediately valuable, not blank.
  useEffect(() => {
    if (active || suggestions !== null || suggestionsLoading) return
    setSuggestionsLoading(true)
    void import('./api.js').then(({ fetchCoachGoalSuggestions }) => fetchCoachGoalSuggestions(storeId))
      .then((list) => setSuggestions(list))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false))
  }, [active, suggestions, suggestionsLoading, storeId])

  const acceptSuggestion = (suggestion: import('./store-coach-model.js').CoachGoalSuggestion, index: number) => {
    setAccepting(index)
    void import('./api.js').then(({ acceptCoachGoalSuggestion }) => {
      const today = new Date()
      const iso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
      return acceptCoachGoalSuggestion(storeId, suggestion, iso)
    }).then(() => onToast('Goal accepted — the Coach tracks it automatically from your synced orders.', 'success')).catch((error: unknown) => onToast(errorMessage(error), 'error')).finally(() => setAccepting(-1))
  }

  return (
    <section className="coach-card coach-goal-card">
      <div className="coach-section-head">
        <CoachCardHeading kicker="THIS WEEK'S GOAL" dot="gold" title={active ? active.title : 'Let’s set your first weekly goal'} />
        {active && <button className="text-button" onClick={onNavigate}>View details <ChevronRight size={14} /></button>}
      </div>
      {!active ? (
        <div className="coach-goal-empty">
          <div className="coach-goal-empty-copy">
            <span className="coach-orb small"><Target size={20} /></span>
            <div>
              <strong>What do you want to achieve this week?</strong>
              <p>Coach suggests goals based on your real data. Pick one below or create your own.</p>
            </div>
          </div>
          <div className="coach-goal-suggestions">
            <div className="coach-goal-suggestions-label"><Sparkles size={13} /> Coach’s suggestions from your store</div>
            {suggestionsLoading && <div className="coach-suggestion-list"><div className="coach-suggestion-card loading" /><div className="coach-suggestion-card loading" /></div>}
            {!suggestionsLoading && suggestions !== null && suggestions.length === 0 && (
              <div className="coach-goal-suggestions-empty">
                <p>No suggestions yet — I’ll propose goals from what your store is already doing. Sync a few more days of sales and I’ll have something realistic to aim for. You can always create your own.</p>
                <button className="button secondary" onClick={onNavigate}><Goal size={14} /> Create Your Own Goal</button>
              </div>
            )}
            {!suggestionsLoading && suggestions !== null && suggestions.length > 0 && (
              <div className="coach-suggestion-list">
                {suggestions.map((suggestion, index) => (
                  <div className="coach-suggestion-card" key={index}>
                    <div className="coach-suggestion-head">
                      <strong>{suggestion.title}</strong>
                      <span className={`coach-feasibility ${suggestion.feasibility.toLowerCase()}`}>{friendlyFeasibility(suggestion.feasibility)}</span>
                    </div>
                    <p>{suggestion.description}</p>
                    <div className="coach-suggestion-facts">
                      <span><Target size={12} /> Aim for {formatMoney(suggestion.targetValue, suggestion.currency)}</span>
                    </div>
                    {suggestion.rationale && <small className="coach-suggestion-rationale">Why it’s achievable: {suggestion.rationale}</small>}
                    <button className="button secondary" disabled={accepting === index} onClick={() => acceptSuggestion(suggestion, index)}>{accepting === index ? 'Setting…' : 'Set This Goal'}</button>
                  </div>
                ))}
                <button className="text-button coach-goal-custom" onClick={onNavigate}>Or create a custom goal <ChevronRight size={13} /></button>
              </div>
            )}
            {plan === 'trial' && <LockedFeatureNote feature="Want to track multiple goals?" onUpgrade={onNavigateBilling} />}
          </div>
        </div>
      ) : (
        <div className="coach-goal-body">
          <MotivationalMilestoneBars percent={goalPct} />
          <div className="coach-goal-stats">
            <div className="coach-goal-numbers">
              <span><strong>{formatMoney(progress[active.id]?.current ?? active.currentProgress, active.targetCurrency)}</strong><small>current</small></span>
              <span><strong>{formatMoney(active.targetValue, active.targetCurrency)}</strong><small>target</small></span>
              <span><strong>{Math.max(0, daysUntil(active.endDate))}</strong><small>days left</small></span>
            </div>
            <CoachConfidenceMeter percent={Math.round(goalPct)} label="Goal momentum" />
            <div className="coach-goal-status-row">
              <span className={`coach-pace-badge ${goalPct >= 100 ? 'ahead' : (progress[active.id]?.pace ?? 'ON_TRACK') === 'BEHIND' && goalPct < 40 ? 'behind' : 'on-track'}`}>{goalPct >= 100 ? 'Achieved 🎉' : paceLabel(progress[active.id]?.pace ?? 'ON_TRACK')}</span>
              <span className="coach-feasibility-inline">{friendlyFeasibility(active.feasibility)}</span>
              <span className="coach-goal-metric">{active.metric.replaceAll('_', ' ').toLowerCase()}</span>
            </div>
            <GoalPaceNote goal={active} progress={progress[active.id] ?? null} />
            <p className="coach-goal-description">{active.description || 'Tracked automatically from your synced orders.'}</p>
            <div className="coach-goal-actions">
              <button className="button secondary" onClick={onNavigate}>View Details</button>
              <button className="text-button" onClick={() => onToast('Adjust the goal from the Goals view — targets and end dates are editable there.', 'info')}>Adjust Goal</button>
            </div>
            {plan === 'trial' && <LockedFeatureNote feature="Want to track multiple goals?" onUpgrade={onNavigateBilling} />}
          </div>
        </div>
      )}
    </section>
  )
}

/** Honest pace projection computed from the backend's real progress math. */
function GoalPaceNote({ goal, progress }: { goal: CoachGoal; progress: import('./store-coach-model.js').CoachGoalProgress | null }) {
  if (!progress) return null
  const currentPct = Math.min(progress.current / Math.max(goal.targetValue, 1) * 100, 100)
  if (currentPct >= 100) return <p className="coach-goal-pace achieved">Coach's note: goal achieved — this is a real win from your store. Take the momentum into next week!</p>
  // Never render a projection sentence out of unusable numbers: a missing or
  // non-finite pace would print "at today's real pace (—/day) ... about —".
  const paceUsable = Number.isFinite(progress.actualDailyPace) && Number.isFinite(progress.daysTotal)
  const requiredUsable = Number.isFinite(progress.requiredDailyPace) && progress.requiredDailyPace > 0
  if (!paceUsable) return null
  if (progress.actualDailyPace <= 0) {
    if (progress.daysRemaining <= 0 || !requiredUsable) return null
    return <p className="coach-goal-pace behind">Coach's note: the clock is running — {formatMoney(progress.requiredDailyPace, goal.targetCurrency)}/day from here closes the gap.</p>
  }
  const projected = progress.actualDailyPace * progress.daysTotal
  if (!Number.isFinite(projected)) return null
  return (
    <p className={`coach-goal-pace ${progress.pace === 'BEHIND' ? 'behind' : 'on-track'}`}>
      Coach's projection: at today's real pace ({formatMoney(progress.actualDailyPace, goal.targetCurrency)}/day) you're heading to about {formatMoney(projected, goal.targetCurrency)} by {goal.endDate}.
      {progress.pace === 'BEHIND' && requiredUsable ? ` It needs ${formatMoney(progress.requiredDailyPace, goal.targetCurrency)}/day to land on target.` : ' Keep up the great work!'}
    </p>
  )
}

function daysUntil(endDate: string): number {
  const end = new Date(`${endDate}T00:00:00Z`).getTime()
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(Math.round((end - today) / 86_400_000), 0)
}

// ── UNIQUE VISUALIZATIONS (not donut, not reused elsewhere) ─────────────────
export function CoachProgressionPath({ currentStep, totalSteps, labels }: { currentStep: number; totalSteps: number; labels: readonly string[] }) {
  return (
    <div className="coach-progression-path" role="img" aria-label={`Progress ${currentStep} of ${totalSteps}`}>
      {Array.from({ length: totalSteps }, (_, i) => {
        const done = i < currentStep
        const active = i === currentStep
        return (
          <div key={i} className={`coach-path-node ${done ? 'done' : active ? 'active' : 'pending'}`}>
            <span className="coach-path-dot">{done ? '✓' : active ? '●' : '○'}</span>
            <small>{labels[i] ?? `Step ${i+1}`}</small>
            {i < totalSteps - 1 && <span className={`coach-path-line ${done ? 'done' : ''}`} />}
          </div>
        )
      })}
    </div>
  )
}

export function MotivationalMilestoneBars({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(percent, 100))
  return (
    <div className="coach-milestone-bars" role="img" aria-label={`Goal progress ${Math.round(clamped)}%`}>
      <div className="coach-milestone-track"><span style={{ width: `${clamped}%` }} /></div>
      <div className="coach-milestone-labels"><strong>{Math.round(clamped)}%</strong><span>{clamped >= 70 ? 'great pace' : clamped >= 40 ? 'keep going' : 'needs a push'}</span></div>
    </div>
  )
}

export function CoachConfidenceMeter({ percent, label }: { percent: number; label?: string }) {
  const clamped = Math.max(0, Math.min(percent, 100))
  return (
    <div className="coach-confidence-meter" role="img" aria-label={`${label ?? 'Confidence'} ${clamped}%`}>
      <div className="coach-confidence-liquid"><span style={{ height: `${clamped}%` }} /></div>
      <div className="coach-confidence-center"><strong>{clamped}%</strong><small>{label ?? 'confidence'}</small></div>
    </div>
  )
}

export function MomentumWave({ values }: { values: readonly number[] }) {
  if (values.length < 2) return <div className="coach-momentum-empty">Not enough data for momentum wave</div>
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const w = 320, h = 80
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w
    const y = h - 10 - ((v - min) / span) * (h - 20)
    return `${x},${y}`
  })
  const path = `M ${points.join(' L ')}`
  const fillPath = `${path} L ${w},${h} L 0,${h} Z`
  return (
    <div className="coach-momentum-wave" role="img" aria-label="Weekly momentum wave">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="80" preserveAspectRatio="none">
        <path d={fillPath} fill="var(--c-purple-soft)" stroke="none" />
        <path d={path} fill="none" stroke="var(--c-purple)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="coach-wave-days"><span>oldest</span><span>{values.length} days of real revenue</span><span>latest</span></div>
    </div>
  )
}

export function AchievementConstellation({ earned, total }: { earned: number; total: number }) {
  const stars = Array.from({ length: Math.max(total, 5) }, (_, i) => i < earned)
  return (
    <div className="coach-constellation" role="img" aria-label={`${earned} of ${total} achievements earned`}>
      <svg viewBox="0 0 200 80" width="100%" height="80">
        {stars.map((isEarned, i) => {
          const x = 20 + i * 32
          const y = 40 + Math.sin(i * 1.2) * 18
          return <g key={i}><circle cx={x} cy={y} r={isEarned ? 7 : 5} fill={isEarned ? 'var(--c-gold)' : 'var(--c-card-3)'} stroke={isEarned ? 'var(--c-gold)' : 'var(--c-border-strong)'} strokeWidth="1.5" />{i < stars.length - 1 && <line x1={x} y1={y} x2={20 + (i+1)*32} y2={40 + Math.sin((i+1)*1.2)*18} stroke="var(--c-border-strong)" strokeWidth="1" strokeDasharray={isEarned ? '0' : '3 3'} />}</g>
        })}
      </svg>
      <small>Earned: {earned} stars · Next: {Math.max(total-earned,0)} to unlock</small>
    </div>
  )
}

export function WeeklyRhythmBeat({ beats }: { beats: readonly { day: string; intensity: number; label: string }[] }) {
  return (
    <div className="coach-rhythm-beat" role="img" aria-label="Weekly rhythm beat">
      {beats.map((b) => (
        <div key={b.day} className="coach-beat-row">
          <span className="coach-beat-day">{b.day}</span>
          <div className="coach-beat-bar"><span style={{ width: `${Math.max(5, Math.min(100, b.intensity))}%` }} /></div>
          <small>{b.label}</small>
        </div>
      ))}
    </div>
  )
}

// Keep RadialGauge and Sparkline for backwards compat but delegate to new
export function RadialGauge({ percent }: { percent: number; tone?: string; size?: number }) {
  return <MotivationalMilestoneBars percent={percent} />
}


export function LockedFeatureNote({ feature, onUpgrade }: { feature: string; planName?: string; onUpgrade: () => void }) {
  return (
    <div className="coach-locked-note">
      <LockKeyhole size={13} />
      <span><strong>{feature}</strong></span>
      <button className="text-button" onClick={onUpgrade}>Upgrade Plan</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. Progress dashboard (window = what the API actually returned)
// ---------------------------------------------------------------------------

function ProgressDashboard({ summary, plan, onNavigate, onNavigateBilling, onRetry }: { summary: CoachProgressSummary | null; plan: CoachPlan; onNavigate: () => void; onNavigateBilling: () => void; onRetry: () => void }) {
  const planHistoryDays = COACH_LIMITS[plan].progressHistoryDays as number
  // FIX (permanent blank boxes): on the coach home this section renders only
  // after every fetch has settled, so a null summary means the request
  // FAILED — three forever-blank skeleton boxes must not stand in for it.
  if (!summary) {
    return (
      <section className="coach-card coach-progress-dashboard">
        <div className="coach-section-head">
          <CoachCardHeading kicker={`${planHistoryDays}-DAY LOOK BACK`} dot="blue" title="How your store is moving" />
          <button className="text-button" onClick={onNavigate}>Open progress view <ChevronRight size={14} /></button>
        </div>
        <div className="coach-section-unavailable">
          <span className="coach-section-unavailable-icon blue"><BarChart3 size={22} /></span>
          <div className="coach-section-unavailable-copy">
            <strong>I couldn’t pull your progress numbers this time</strong>
            <p>Every other card on this page is live — only your revenue trend failed to arrive. Retry re-reads your synced orders from scratch; nothing here is ever a placeholder line.</p>
            <div className="coach-section-unavailable-actions">
              <button className="button secondary" onClick={onRetry}><RefreshCw size={14} /> Retry loading progress</button>
              <button className="text-button" onClick={onNavigate}>Open progress view <ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      </section>
    )
  }
  // Label the window the server actually served, so the heading can never
  // promise 90 days while the payload only covers 30.
  const historyDays = Number.isFinite(summary.window) && summary.window > 0 ? summary.window : planHistoryDays
  const { revenue, orders, aov, customers, revenueTrendPct, series, comparisonSeries } = summary
  if (series.length === 0) {
    return (
      <section className="coach-card coach-progress-dashboard">
        <div className="coach-section-head">
          <CoachCardHeading kicker={`${historyDays}-DAY LOOK BACK`} dot="blue" title="How your store is moving" />
          <button className="text-button" onClick={onNavigate}>Open progress view <ChevronRight size={14} /></button>
        </div>
        <CoachEmptyState icon={BarChart3} title="No trend to chart yet" description="This chart fills in from your real daily sales. Sync orders and I’ll show how your store is moving — never a placeholder line." action="Go to progress view" onAction={onNavigate} />
      </section>
    )
  }
  return (
    <section className="coach-card coach-progress-dashboard">
      <div className="coach-section-head">
        <CoachCardHeading kicker={`${historyDays}-DAY LOOK BACK`} dot="blue" title="How your store is moving" />
        <button className="text-button" onClick={onNavigate}>Open progress view <ChevronRight size={14} /></button>
      </div>
      <div className="coach-metric-grid">
        <BigNumberCard label="Revenue" value={formatMoney(revenue)} trendPct={revenueTrendPct} icon={TrendingUp} />
        <BigNumberCard label="Orders" value={formatNumber(orders)} trendPct={null} icon={Zap} />
        <BigNumberCard label="AOV" value={formatMoney(aov)} trendPct={null} icon={Target} />
        <BigNumberCard label="Customers" value={formatNumber(customers)} trendPct={null} icon={Users} />
      </div>
      <div className="coach-area-chart">
        <div className="coach-chart-legend"><Waves size={12} /> Weekly momentum wave · Last {historyDays} days{comparisonSeries.length > 0 && <> · dashed is previous avg</>}</div>
        <MomentumWave values={series.map((row) => row.revenue)} />
        {comparisonSeries.length > 0 && <p className="coach-chart-note">Wave shows real daily revenue. Previous period context is honest, not a target.</p>}
        {planHistoryDays < 90 && plan !== 'commander' && <LockedFeatureNote feature="90 days of progress history" onUpgrade={onNavigateBilling} />}
      </div>
    </section>
  )
}

export function BigNumberCard({ label, value, trendPct, icon: Icon }: { label: string; value: string; trendPct: number | null; series?: readonly number[]; icon: LucideIcon }) {
  return (
    <div className="coach-big-number">
      <div className="coach-big-number-top"><span className="coach-big-number-icon"><Icon size={15} /></span><span>{label}</span></div>
      <strong>{value}</strong>
      <div className="coach-big-number-bottom">
        {trendPct !== null ? (
          <span className={`coach-trend ${trendPct >= 0 ? 'up' : 'down'}`}>{trendPct >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(trendPct).toFixed(1)}% vs previous half</span>
        ) : <span className="coach-trend neutral">real synced data</span>}
      </div>
    </div>
  )
}

export function Sparkline({ values }: { values: readonly number[] }) {
  return <MomentumWave values={values} />
}

// ---------------------------------------------------------------------------
// 5. Activity heatmap (FIX 6 — real rhythm, derived patterns)
// ---------------------------------------------------------------------------

function HeatmapSection({ heatmap, onNavigate, onRetry }: { heatmap: CoachHeatmapView | null; onNavigate: () => void; onRetry: () => void }) {
  // Hooks must run on every render: compute before any early return so the
  // hook order stays stable when `heatmap` flips between null and loaded.
  const cells = heatmap?.cells ?? EMPTY_HEATMAP_CELLS
  const patterns = useMemo(() => heatmapPatterns(cells), [cells])
  // FIX (permanent blank boxes): null here means the heatmap request FAILED
  // (the progress view's own loading screen covers the in-flight window), so
  // render an honest, retryable state instead of three dead skeleton boxes.
  if (!heatmap) {
    return (
      <section className="coach-card coach-heatmap-section">
        <div className="coach-section-head">
          <CoachCardHeading kicker="YOUR STORE’S BEST DAYS" dot="green" title="When your store is busiest" />
          <button className="text-button" onClick={onNavigate}>Explore detailed patterns <ChevronRight size={14} /></button>
        </div>
        <div className="coach-tempo-unavailable">
          <span className="coach-tempo-unavailable-icon"><CalendarDays size={16} /></span>
          <p><strong>Your weekly heatmap didn’t load this time.</strong> Reload patterns rebuilds the grid from your real synced order days — every cell stays a true day of orders.</p>
          <button className="text-button" onClick={onRetry}><RefreshCw size={13} /> Reload patterns</button>
        </div>
      </section>
    )
  }
  const { bestDay, busiestWeek } = heatmap
  const bestWeekdayName = patterns.bestWeekday !== null ? WEEKDAY_LABELS_SHORT[patterns.bestWeekday] : null
  return (
    <section className="coach-card coach-heatmap-section">
      <div className="coach-section-head">
        <CoachCardHeading kicker="YOUR STORE’S BEST DAYS" dot="green" title="When your store is busiest" />
        <button className="text-button" onClick={onNavigate}>Explore detailed patterns <ChevronRight size={14} /></button>
      </div>
      {cells.length === 0 ? (
        <div className="coach-heatmap-empty">
          <span className="coach-empty-icon"><BarChart3 size={22} /></span>
          <div className="coach-heatmap-empty-copy">
            <strong>Your store rhythm will appear here</strong>
            <p>As synced orders come in, the Coach learns your busiest hours, best days of the week, and the optimal times to run campaigns. Every cell is a real day of orders — nothing is simulated.</p>
            <div className="coach-heatmap-empty-facts">
              <span>Patterns strengthen with more synced order days</span>
              <span>Orders synced so far: {formatNumber(patterns.totalOrders)}</span>
            </div>
            <button className="button secondary" onClick={onNavigate}>Open progress view <ChevronRight size={14} /></button>
          </div>
        </div>
      ) : (
        <>
          <div className="coach-heatmap" role="img" aria-label="Store activity heatmap: rows are weekdays, columns are weeks">
            {WEEKDAY_LABELS_SHORT.map((day, weekday) => (
              <div className="coach-heatmap-row" key={day}>
                <span className="coach-heatmap-label">{day}</span>
                {Array.from({ length: 12 }, (_, week) => {
                  const cell = cells.find((candidate) => candidate.weekday === weekday && candidate.week === week)
                  return <span key={week} className={`coach-heatmap-cell ${cell ? 'filled' : 'empty'}`} style={cell ? { '--heat': cell.intensity } as CSSProperties : undefined} title={cell ? `${cell.day}: ${cell.orders} orders · ${formatMoney(cell.revenue)}` : 'No orders synced'} />
                })}
              </div>
            ))}
          </div>
          <div className="coach-heatmap-legend-row">
            <span className="coach-heatmap-legend">
              Less
              <i className="heat-step s0" /><i className="heat-step s1" /><i className="heat-step s2" /><i className="heat-step s3" />
              More
            </span>
            <span className="coach-heatmap-window">{formatNumber(patterns.totalOrders)} orders · {patterns.activeDays} active days in this window</span>
          </div>
          <div className="coach-heatmap-insights">
            {bestWeekdayName && <InsightChip icon={CalendarDays} tone="green" text={`${bestWeekdayName} is your strongest day`} />}
            {patterns.weekendDeltaPct !== null && patterns.weekendDeltaPct !== 0 && (
              <InsightChip icon={TrendingUp} tone={patterns.weekendDeltaPct > 0 ? 'green' : 'blue'} text={`Weekends ${patterns.weekendDeltaPct > 0 ? 'outperform' : 'trail'} weekdays by ${Math.abs(patterns.weekendDeltaPct)}%`} />
            )}
            {bestDay && <InsightChip icon={Flame} tone="amber" text={`Best single day: ${new Date(`${bestDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`} />}
            {busiestWeek && <InsightChip icon={History} tone="blue" text={`Busiest stretch: ${busiestWeek}`} />}
          </div>
          {bestWeekdayName && (
            <p className="coach-heatmap-coach-note">
              <Sparkles size={13} />
              Coach's insight: {bestWeekdayName}s are when your customers buy most. Schedule campaigns, emails, and product drops for {bestWeekdayName} to ride the demand you already have.
            </p>
          )}
          {patterns.weekdayAverages.length > 0 && (
            <WeeklyRhythmBeat beats={patterns.weekdayAverages.map((row)=> {
              const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
              const max = Math.max(...patterns.weekdayAverages.map(r=>r.averageOrders),1)
              const pct = Math.round(row.averageOrders/max*100)
              return { day: names[row.weekday] ?? '?', intensity: pct, label: pct>80?'Strong beat!': pct>60?'Good energy': pct>40?'Building': pct>20?'Steady':'Quiet' }
            })} />
          )}
        </>
      )}
    </section>
  )
}

function InsightChip({ icon: Icon, tone, text }: { icon: LucideIcon; tone: string; text: string }) {
  return <span className={`coach-insight-chip ${tone}`}><Icon size={13} />{text}</span>
}

// ---------------------------------------------------------------------------
// 6. Achievements (FIX 7 — gamified, but only real events earn badges)
// ---------------------------------------------------------------------------

function AchievementsSection({ achievements, badgeCatalog, streak, plan, onNavigate, onViewHuddle }: { achievements: readonly CoachAchievement[]; badgeCatalog: readonly CoachBadgeCatalogEntry[]; streak: CoachStreakView | null; plan: CoachPlan; onNavigate: () => void; onViewHuddle: () => void }) {
  const recent = achievements.slice(0, 3)
  const visibleCap = COACH_LIMITS[plan].badgesVisible as number
  const streakDays = streak?.currentStreak ?? 0
  const milestone = nextStreakMilestone(streakDays)
  const catalogById = useMemo(() => new Map(badgeCatalog.map((entry) => [entry.id, entry])), [badgeCatalog])
  const titleFor = (badgeId: string): string => catalogById.get(badgeId)?.title ?? badgeTitleFromId(badgeId)

  // Next streak badges on the real ladder, with honest progress bars driven
  // by the merchant's actual current streak.
  const nextStreakBadges = useMemo(() => {
    if (badgeCatalog.length > 0) {
      return badgeCatalog
        .filter((entry) => !entry.earned && entry.id in STREAK_BADGE_TARGETS)
        .sort((a, b) => (STREAK_BADGE_TARGETS[a.id] ?? 0) - (STREAK_BADGE_TARGETS[b.id] ?? 0))
        .slice(0, 2)
        .map((entry) => ({ id: entry.id, title: entry.title, description: entry.description, target: STREAK_BADGE_TARGETS[entry.id] ?? 0, progress: Math.min(streakDays / Math.max(STREAK_BADGE_TARGETS[entry.id] ?? 1, 1) * 100, 100) }))
    }
    const targets = Object.entries(STREAK_BADGE_TARGETS)
      .filter(([, target]) => target > streakDays)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2)
    return targets.map(([id, target]) => ({ id, title: badgeTitleFromId(id), description: `View huddles ${target} days in a row`, target, progress: Math.min(streakDays / target * 100, 100) }))
  }, [badgeCatalog, streakDays])

  return (
    <section className="coach-card coach-achievements-section">
      <div className="coach-section-head">
        <CoachCardHeading kicker="YOUR JOURNEY" dot="gold" title={achievements.length > 0 ? `You’ve earned ${achievements.length} badge${achievements.length === 1 ? '' : 's'} so far` : 'Your journey is just beginning'} />
        <button className="text-button" onClick={onNavigate}>View all badges <ChevronRight size={14} /></button>
      </div>
      <div className="coach-streak-strip">
        <span className="coach-streak-flame"><Flame size={16} /></span>
        <div className="coach-streak-copy">
          <strong>{streakStatusCopy(streakDays, streak?.todayViewed ?? false).headline}</strong>
          {milestone ? (
            <>
              <div className="coach-progress-track slim"><span style={{ width: `${milestone.progressPct}%` }} /></div>
              <small>{streakStatusCopy(streakDays, streak?.todayViewed ?? false).detail}</small>
            </>
          ) : (
            <small>{streakStatusCopy(streakDays, streak?.todayViewed ?? false).detail}</small>
          )}
        </div>
        {!streak?.todayViewed && <button className="button secondary coach-streak-cta" onClick={onViewHuddle}>{streakStatusCopy(streakDays, false).cta ?? 'Check in today'}</button>}
      </div>
      {recent.length === 0 ? (
        <div className="coach-empty-state slim">
          <span className="coach-empty-icon"><Trophy size={20} /></span>
          <strong>Complete your first huddle to earn your first badge!</strong>
          <p>Badges celebrate real milestones: first huddle, 7-day streaks, revenue records, goal wins. Nothing is awarded for fake activity — only for what actually happened in your store.</p>
          <button className="button secondary" onClick={onNavigate}>View badge catalog <ArrowUpRight size={14} /></button>
        </div>
      ) : (
        <div className="coach-achievements-timeline">
          <div className="coach-achievements-label"><CheckCircle2 size={13} /> Recent wins</div>
          {recent.map((achievement) => {
            const catalogEntry = catalogById.get(achievement.badgeId)
            return (
              <div className="coach-achievement-row" key={achievement.id}>
                <span className="coach-achievement-dot"><Trophy size={13} /></span>
                <span className="coach-achievement-copy">
                  <strong>{titleFor(achievement.badgeId)}</strong>
                  <small>{catalogEntry ? `${catalogEntry.category.toLowerCase()} · ` : ''}earned {relativeTimeLabel(achievement.earnedAt)}</small>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {nextStreakBadges.length > 0 && (
        <div className="coach-next-badges">
          <div className="coach-achievements-label"><Target size={13} /> Next achievements</div>
          {nextStreakBadges.map((badge) => (
            <div className="coach-next-badge-row" key={badge.id}>
              <div className="coach-next-badge-copy">
                <strong>{badge.title}</strong>
                <small>{badge.description}</small>
              </div>
              <div className="coach-next-badge-progress">
                <div className="coach-progress-track slim"><span style={{ width: `${badge.progress}%` }} /></div>
                <small>{Math.min(streakDays, badge.target)} / {badge.target} days</small>
              </div>
            </div>
          ))}
        </div>
      )}
      <AchievementConstellation earned={achievements.length} total={visibleCap} />
      <CoachProgressionPath currentStep={Math.min(streakDays,5)} totalSteps={6} labels={['Day 1','Day 3','Day 7','Day 30','Day 100','Champion']} />
      <div className="coach-badge-progress">
        <span>{achievements.length} of {visibleCap} badges visible on your plan earned</span>
        <MotivationalMilestoneBars percent={Math.min(achievements.length / Math.max(visibleCap, 1) * 100, 100)} />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 7. Human-friendly coaching value (tips, celebrations, style, best days)
// ---------------------------------------------------------------------------

function CoachValueStrip({ data, onFocusGoals, onFocusDays }: { data: CoachData; onFocusGoals: () => void; onFocusDays: () => void }) {
  const patterns = heatmapPatterns(data.heatmap?.cells ?? [])
  const pending = (data.priorities?.priorities ?? []).filter((priority) => priority.status === 'PENDING').length
  const completed = (data.priorities?.priorities ?? []).filter((priority) => priority.status === 'COMPLETED').length
  const insight = typeof data.huddle?.content.keyInsight === 'string' ? data.huddle.content.keyInsight : null
  const tip = dailyCoachTip({ huddleInsight: insight, heatmapBestWeekday: patterns.bestWeekday, pendingPriorities: pending, hasGoal: data.goals.length > 0, streakDays: data.streak?.currentStreak ?? 0 })
  const active = data.goals[0]
  const goalPct = active ? Math.min(active.currentProgress / Math.max(active.targetValue, 1) * 100, 100) : null
  const celebration = weekCelebration({ revenueTrendPct: data.summary && data.summary.series.length > 0 ? data.summary.revenueTrendPct : null, completedPriorities: completed, goalProgressPct: goalPct, earnedBadges: data.achievements.length })
  const lesson = learningMoment({ heatmapBestWeekday: patterns.bestWeekday, hasGoal: data.goals.length > 0 })
  const tipAction = tip.kind === 'goal' ? onFocusGoals : tip.kind === 'pattern' ? onFocusDays : undefined
  return (
    <div className="coach-value-grid">
      <section className="coach-card coach-tip-card">
        <CoachCardHeading kicker="TODAY’S COACHING TIP" dot="purple" title={tip.title} />
        <p>{tip.body}</p>
        {tipAction && <button className="text-button" onClick={tipAction}>{tip.action} <ChevronRight size={13} /></button>}
      </section>
      <section className="coach-card coach-wins-card">
        <CoachCardHeading kicker="THIS WEEK’S WINS" dot="gold" title={celebration ? 'Look at what you already did' : 'Wins will show up here'} />
        {celebration ? (
          <>
            <ul className="coach-win-list">{celebration.items.map((item) => <li key={item}><CheckCircle2 size={13} />{item}</li>)}</ul>
            <p className="coach-win-note">{celebration.note}</p>
          </>
        ) : (
          <p>Nothing to celebrate yet — and that’s honest. Check in, finish a priority, or set a goal and I’ll cheer the real ones.</p>
        )}
      </section>
      <section className="coach-card coach-lesson-card">
        <CoachCardHeading kicker="QUICK LESSON" dot="blue" title={lesson.title} />
        <p>{lesson.body}</p>
      </section>
    </div>
  )
}

function BestDaysSection({ heatmap, onNavigate, onRetry }: { heatmap: CoachHeatmapView | null; onNavigate: () => void; onRetry: () => void }) {
  // Same rule as HeatmapSection: hooks before the early return.
  const cells = heatmap?.cells ?? EMPTY_HEATMAP_CELLS
  const patterns = useMemo(() => heatmapPatterns(cells), [cells])
  // FIX (permanent blank boxes): on the coach home a null heatmap means the
  // request FAILED — show a distinct, honest recovery strip with a working
  // retry instead of three identical blank shimmer boxes.
  if (!heatmap) {
    return (
      <section className="coach-card coach-bestdays-section">
        <div className="coach-section-head">
          <CoachCardHeading kicker="YOUR STORE’S BEST DAYS" dot="green" title="When your store is busiest" />
          <button className="text-button" onClick={onNavigate}>See detailed patterns <ChevronRight size={14} /></button>
        </div>
        <div className="coach-tempo-unavailable">
          <span className="coach-tempo-unavailable-icon"><CalendarDays size={16} /></span>
          <p><strong>Your day-by-day rhythm didn’t arrive with the rest of the page.</strong> Once it loads, this card names your strongest weekday and your peak week — measured from real orders only, never guessed.</p>
          <button className="text-button" onClick={onRetry}><RefreshCw size={13} /> Check again</button>
        </div>
      </section>
    )
  }
  const bestName = patterns.bestWeekday !== null ? WEEKDAY_LABELS[patterns.bestWeekday] : null
  return (
    <section className="coach-card coach-bestdays-section">
      <div className="coach-section-head">
        <CoachCardHeading kicker="YOUR STORE’S BEST DAYS" dot="green" title="When your store is busiest" />
        <button className="text-button" onClick={onNavigate}>See detailed patterns <ChevronRight size={14} /></button>
      </div>
      {heatmap.cells.length === 0 ? (
        <div className="coach-heatmap-empty">
          <span className="coach-empty-icon"><CalendarDays size={22} /></span>
          <div className="coach-heatmap-empty-copy">
            <strong>Your best days will appear here</strong>
            <p>As real orders come in, I’ll show which days your customers already love. Nothing is guessed.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="coach-bestdays-grid">
            <article className="coach-bestday-card">
              <span>⭐ Your best day</span>
              <strong>{bestName ?? 'Still learning'}</strong>
              <p>{bestName ? `${bestName}s are when your customers buy most.` : 'Need a few more order days to name a favorite.'}</p>
            </article>
            <article className="coach-bestday-card">
              <span>🔥 Peak week</span>
              <strong>{heatmap.busiestWeek ?? 'Not enough history yet'}</strong>
              <p>{heatmap.busiestWeek ? 'Your busiest stretch from the last 12 weeks.' : 'I’ll name a peak week once more days sync in.'}</p>
            </article>
            <article className="coach-bestday-card">
              <span>💡 Coach’s tip</span>
              <strong>{bestName ? `Plan around ${bestName}` : 'Keep syncing'}</strong>
              <p>{bestName ? `Try scheduling promotions and emails for ${bestName}s, when your customers are already active.` : 'A little more store history makes this advice specific.'}</p>
            </article>
          </div>
        </>
      )}
    </section>
  )
}

function CoachStyleSection({ storeId, preferences, plan, onToast, onReload, onNavigateBilling }: { storeId: string; preferences: CoachPreferencesView | null; plan: CoachPlan; onToast: CoachToast; onReload: () => void; onNavigateBilling: () => void }) {
  const [saving, setSaving] = useState(false)
  const allowed = coachPersonalitiesForPlan(plan)
  const save = (personality: CoachPersonality) => {
    setSaving(true)
    void import('./api.js').then(({ updateCoachPreferences }) => updateCoachPreferences(storeId, { personality })).then(() => { onToast('Coach style updated.', 'success'); onReload() }).catch((error: unknown) => onToast(errorMessage(error), 'error')).finally(() => setSaving(false))
  }
  return (
    <section className="coach-card coach-style-section">
      <CoachCardHeading kicker="CHOOSE YOUR COACH STYLE" dot="purple" title="How should I talk with you?" />
      <p className="coach-style-lede">Your Store Coach can match the way you like to work.</p>
      <div className="coach-personality-grid">
        {(Object.keys(PERSONALITY_META) as CoachPersonality[]).map((id) => {
          const meta = PERSONALITY_META[id]
          const unlocked = allowed.includes(id)
          const active = preferences?.personality === id
          return (
            <button key={id} className={`coach-personality-card ${active ? 'active' : ''} ${unlocked ? '' : 'locked'}`} disabled={!unlocked || saving} onClick={() => save(id)}>
              <div className="coach-personality-head"><strong>{meta.emoji} {meta.label}</strong>{!unlocked && <LockKeyhole size={12} />}</div>
              <small>{meta.tagline}{active ? ' · Current' : ''}</small>
              <p>“{meta.sample}”</p>
            </button>
          )
        })}
      </div>
      {allowed.length < 4 && <LockedFeatureNote feature="Want every coach style?" onUpgrade={onNavigateBilling} />}
    </section>
  )
}

function CoachAskRedirect({ onBack }: { onBack: () => void }) {
  return (
    <div className="coach-subview">
      <CoachSubHeader eyebrow="Store Coach" title="Questions live in AI Command" description="Store Coach is for briefings, priorities, and goals. For a conversation about your store, head to AI Command." onBack={onBack} />
      <section className="coach-card coach-ask-cta">
        <span className="coach-orb"><MessageSquare size={22} /></span>
        <div>
          <strong>Have a specific question?</strong>
          <p>AI Command is the place for detailed answers about your store.</p>
          <button className="button primary" onClick={openAiCommand}>Open AI Command <ChevronRight size={14} /></button>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 8. Weekly review card (FIX 9 — the merchant's week, in full)
// ---------------------------------------------------------------------------

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

type ReviewMetric = Readonly<{ label: string; value: string; change: string }>

function asReviewMetrics(value: unknown): readonly ReviewMetric[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'object' && item !== null ? item as Readonly<Record<string, unknown>> : {}))
    .filter((item) => typeof item.label === 'string')
    .map((item) => ({ label: String(item.label), value: String(item.value ?? ''), change: String(item.change ?? '') }))
}

function ReviewMetricChip({ metric }: { metric: ReviewMetric }) {
  const positive = /^\+|↑|up|higher|growth|increased/i.test(metric.change)
  const negative = /^-|↓|down|lower|drop|decreased/i.test(metric.change)
  return (
    <div className="coach-review-metric">
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      {metric.change && <small className={positive ? 'positive' : negative ? 'negative' : ''}>{metric.change}</small>}
    </div>
  )
}

/** A single real figure from the review's deterministic snapshot. */
function ReviewSnapshotRow({ label, value, change, changeLabel }: { label: string; value: string; change?: number | null; changeLabel?: string | undefined }) {
  const hasChange = change !== null && change !== undefined && Number.isFinite(change) && change !== 0
  const positive = hasChange && (change as number) > 0
  const negative = hasChange && (change as number) < 0
  return (
    <div className="coach-review-snapshot-row">
      <span className="coach-review-snapshot-label">{label}</span>
      <strong>{value}</strong>
      {hasChange && <small className={positive ? 'positive' : negative ? 'negative' : ''}>{positive ? '↑' : negative ? '↓' : ''}{Math.abs(change as number).toFixed(1)}%{changeLabel ? ` ${changeLabel}` : ''}</small>}
      {!hasChange && changeLabel && <small className="neutral">vs {changeLabel}</small>}
    </div>
  )
}

/** Right-hand "week in numbers" panel built purely from the real snapshot. */
function ReviewSnapshotPanel({ snapshot }: { snapshot: CoachReviewSnapshot }) {
  const rows = [
    { label: '7-day revenue', value: formatMoney(snapshot.revenue7d, snapshot.currency), change: snapshot.revenue7dChangePct, changeLabel: 'vs prior 7' },
    { label: '7-day orders', value: formatNumber(snapshot.orders7d), change: snapshot.orders7dChangePct, changeLabel: 'vs prior 7' },
    { label: 'Avg order value', value: formatMoney(snapshot.aov30d, snapshot.currency), change: null },
    { label: 'Best single day', value: formatMoney(snapshot.bestDayRevenue, snapshot.currency), change: null },
    { label: 'New customers (yesterday)', value: formatNumber(snapshot.yesterdayNewCustomers), change: null },
    { label: 'Huddle streak', value: `${snapshot.streakDays} day${snapshot.streakDays === 1 ? '' : 's'}`, change: null },
  ]
  return (
    <div className="coach-review-snapshot">
      <div className="coach-review-block-label"><Gauge size={13} /> Your week in numbers</div>
      <div className="coach-review-snapshot-grid">
        {rows.map((row) => <ReviewSnapshotRow key={row.label} label={row.label} value={row.value} change={row.change} changeLabel={row.changeLabel} />)}
      </div>
      <p className="coach-review-snapshot-note"><Sparkles size={12} /> Real figures from your synced store — never estimated.</p>
    </div>
  )
}

function WeeklyReviewCard({ storeId, review, plan, onToast, onNavigateBilling, onSetGoal }: { storeId: string; review: CoachReviewView; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void; onSetGoal: () => void }) {
  const content = review.content
  const wins = asStringArray(content.weekWins).slice(0, 4)
  const metrics = asReviewMetrics(content.metrics).slice(0, 4)
  const learnings = asStringArray(content.learnings).slice(0, 3)
  const focus = asStringArray(content.nextWeekFocus).slice(0, 3)
  const suggestedGoal = typeof content.suggestedGoal === 'object' && content.suggestedGoal !== null ? content.suggestedGoal as Readonly<Record<string, unknown>> : null
  const snapshot = reviewSnapshot(content)
  const [emailing, setEmailing] = useState(false)
  const emailReview = () => {
    setEmailing(true)
    void import('./api.js').then(({ emailCoachReview }) => emailCoachReview(storeId, review.id))
      .then(() => onToast('Weekly review emailed to your verified merchant address.', 'success'))
      .catch((error: unknown) => onToast(errorMessage(error), 'error'))
      .finally(() => setEmailing(false))
  }
  const downloadPdf = () => {
    void import('./api.js').then(({ fetchCoachReviewPdf }) => fetchCoachReviewPdf(storeId, review.id)).then(({ pdfUrl }) => { window.location.assign(pdfUrl); onToast('PDF report ready.', 'success') }).catch((error: unknown) => onToast(errorMessage(error), 'error'))
  }
  return (
    <section className="coach-card coach-review-card">
      <div className="coach-review-head">
        <span className="coach-review-icon"><CalendarDays size={18} /></span>
        <div>
          <CoachCardHeading kicker={`YOUR WEEK IN REVIEW · ${formatCoachDate(review.reportDate).toUpperCase()}`} dot="purple" title={String(content.subject ?? 'Your Week in Review')} />
          <small>Generated from your real weekly numbers — wins, metrics, learnings, and next week's focus.</small>
        </div>
      </div>
      <div className="coach-review-body">
        <div className="coach-review-col coach-review-col-main">
          {wins.length > 0 && (
            <div className="coach-review-block">
              <div className="coach-review-block-label"><Trophy size={13} /> Week highlights</div>
              <ul className="coach-review-wins">{wins.map((win, index) => <li key={index}><CheckCircle2 size={13} />{win}</li>)}</ul>
            </div>
          )}
          {metrics.length > 0 && (
            <div className="coach-review-block">
              <div className="coach-review-block-label"><BarChart3 size={13} /> Metrics vs last week</div>
              <div className="coach-review-metrics">
                {metrics.map((metric, index) => <ReviewMetricChip metric={metric} key={index} />)}
              </div>
            </div>
          )}
        </div>
        <div className="coach-review-col coach-review-col-side">
          {snapshot && <ReviewSnapshotPanel snapshot={snapshot} />}
          {learnings.length > 0 && (
            <div className="coach-review-block">
              <div className="coach-review-block-label"><Lightbulb size={13} /> Key learnings</div>
              <ol className="coach-review-learnings">{learnings.map((learning, index) => <li key={index}>{learning}</li>)}</ol>
            </div>
          )}
          {focus.length > 0 && (
            <div className="coach-review-block">
              <div className="coach-review-block-label"><Target size={13} /> Next week's focus</div>
              <ul className="coach-review-focus">{focus.map((item, index) => <li key={index}><ChevronRight size={13} />{item}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
      {suggestedGoal && (
        <div className="coach-review-goal">
          <div className="coach-review-block-label"><Sparkles size={13} /> Suggested goal for next week</div>
          <strong>{String(suggestedGoal.title ?? 'New weekly goal')}</strong>
          <p>{String(suggestedGoal.description ?? '')}</p>
          <button className="button secondary" onClick={onSetGoal}>Set this goal <ChevronRight size={14} /></button>
        </div>
      )}
      <div className="coach-review-actions">
        {/* Only offer actions the server can actually perform. When SMTP or the
            PDF writer is not configured these endpoints return 503, so showing
            the button would guarantee an error toast. */}
        {review.emailAvailable !== false && (
          <button className="button secondary" disabled={emailing} onClick={emailReview}><Mail size={14} /> {emailing ? 'Sending…' : 'Email me this review'}</button>
        )}
        {plan === 'commander' ? (
          review.pdfAvailable !== false
            ? <button className="button secondary" onClick={downloadPdf}><ArrowUpRight size={14} /> Download PDF report</button>
            : <span className="coach-data-note"><AlertCircle size={12} /> PDF export is not enabled on this deployment yet.</span>
        ) : (
          <LockedFeatureNote feature="Downloadable PDF reports" planName="Commander" onUpgrade={onNavigateBilling} />
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 8b. Plan features card (FIX 12 — show what the plan includes, honestly)
// ---------------------------------------------------------------------------

function CoachPlanCard({ plan, onNavigateBilling }: { plan: CoachPlan; onNavigateBilling: () => void }) {
  const summary = planFeatureSummary(plan)
  const [expanded, setExpanded] = useState(false)
  return (
    <section className={`coach-card coach-plan-card ${plan}`}>
      <div className="coach-plan-head">
        <span className="coach-plan-gem"><Gem size={17} /></span>
        <div>
          <div className="section-kicker"><span className="kicker-dot purple" />YOUR STORE COACH INCLUDES</div>
          <h3>Right now on {PLAN_LABEL[plan]}</h3>
          <p>Clear coaching — no mystery tiers, no hidden limits.</p>
        </div>
        {plan !== 'commander' && <button className="button primary coach-plan-upgrade" onClick={onNavigateBilling}><Rocket size={14} /> Upgrade Plan</button>}
      </div>
      <ul className="coach-plan-included">
        {summary.included.slice(0, expanded ? undefined : 4).map((feature) => <li key={feature}><Check size={14} />{feature}</li>)}
      </ul>
      <button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded ? 'Hide details ▲' : 'Show more features ▼'}</button>
      {expanded && plan !== 'commander' && (
        <div className="coach-plan-teaser">
          <strong>Unlock more coaching</strong>
          <p>Get more priorities, more goals, longer history, and every coach style.</p>
          <button className="button secondary" onClick={onNavigateBilling}><Rocket size={14} /> Upgrade Plan</button>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Sub views (goals / progress / chat / achievements / settings)
// ---------------------------------------------------------------------------

export function CoachGoalsView({ context, goals, plan, onToast, onNavigate, onNavigateBilling }: { context: WorkspaceContext; goals: readonly CoachGoal[]; plan: CoachPlan; onToast: CoachToast; onNavigate: (view: CoachView) => void; onNavigateBilling: () => void }) {
  const [all, setAll] = useState<readonly CoachGoal[]>(goals)
  const [suggestions, setSuggestions] = useState<readonly import('./store-coach-model.js').CoachGoalSuggestion[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [draft, setDraft] = useState<{ title: string; target: string }>({ title: '', target: '' })
  const storeId = context.storeId
  const goalLimit = COACH_LIMITS[plan].activeGoals as number
  const refresh = () => { if (storeId) void fetchCoachGoals(storeId).then(setAll).catch(() => undefined) }
  useEffect(() => { setAll(goals); void refresh() }, [goals, storeId])
  const loadSuggestions = () => {
    if (!storeId) return
    setSuggesting(true)
    void import('./api.js').then(({ fetchCoachGoalSuggestions }) => fetchCoachGoalSuggestions(storeId)).then(setSuggestions).catch((error: unknown) => onToast(errorMessage(error), 'error')).finally(() => setSuggesting(false))
  }
  const createDraft = () => {
    if (!storeId || !draft.title.trim()) { onToast('Give the goal a title first.', 'info'); return }
    const target = Number(draft.target)
    if (!Number.isFinite(target) || target <= 0) { onToast('Enter a positive target value.', 'info'); return }
    void import('./api.js').then(({ createCoachGoal }) => createCoachGoal(storeId, { goalType: 'WEEKLY', title: draft.title.trim(), description: 'Created from the Goals view.', metric: 'REVENUE', targetValue: target, targetCurrency: 'USD', startDate: todayIso(), endDate: isoInDays(7) })).then(() => { setDraft({ title: '', target: '' }); refresh(); onToast('Weekly goal created.', 'success') }).catch((error: unknown) => onToast(errorMessage(error), 'error'))
  }
  const accept = (suggestion: import('./store-coach-model.js').CoachGoalSuggestion) => {
    if (!storeId) return
    void import('./api.js').then(({ acceptCoachGoalSuggestion }) => acceptCoachGoalSuggestion(storeId, suggestion, todayIso())).then(() => { refresh(); onToast('AI goal accepted — progress tracks automatically.', 'success') }).catch((error: unknown) => onToast(errorMessage(error), 'error'))
  }
  return (
    <div className="coach-subview">
      <CoachSubHeader eyebrow="Store Coach" title="Goals" description="Weekly, monthly, and quarterly goals tracked from real synced metrics." onBack={() => onNavigate('coach')} />
      <div className="coach-goals-layout">
        <section className="coach-card">
          <div className="coach-section-head">
            <CoachCardHeading kicker={`ACTIVE GOALS · ${all.filter((goal) => goal.status === 'ACTIVE').length} OF ${goalLimit} ON ${PLAN_LABEL[plan].toUpperCase()}`} dot="gold" title="Your goals" />
            <button className="button secondary" onClick={loadSuggestions} disabled={suggesting}><Sparkles size={14} /> {suggesting ? 'Thinking…' : 'Get AI suggestions'}</button>
          </div>
          {all.length === 0 ? (
            <CoachEmptyState icon={Target} title="Set your first weekly goal" description="Goals give the Coach a north star. AI suggestions are built from your real trend — never a random number." action="Get AI suggestions" onAction={loadSuggestions} />
          ) : (
            <div className="coach-goals-list">
              {all.map((goal) => <CoachGoalRow key={goal.id} goal={goal} storeId={storeId} onChanged={refresh} onToast={onToast} />)}
            </div>
          )}
          {all.filter((goal) => goal.status === 'ACTIVE').length >= goalLimit && plan !== 'commander' && <LockedFeatureNote feature="More active goals" planName={plan === 'trial' ? 'Start' : plan === 'start' ? 'Growth' : 'Commander'} onUpgrade={onNavigateBilling} />}
          <div className="coach-goal-draft">
            <h4>Or create your own</h4>
            <div className="coach-goal-draft-row">
              <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Goal title, e.g. Beat last week" />
              <input value={draft.target} onChange={(event) => setDraft((current) => ({ ...current, target: event.target.value }))} placeholder="Revenue target ($)" inputMode="decimal" />
              <button className="button primary" onClick={createDraft}><Goal size={14} /> Create goal</button>
            </div>
          </div>
        </section>
        <aside className="coach-card coach-suggestions-panel">
          <CoachCardHeading kicker="AI SUGGESTIONS" dot="purple" title="What the trend supports" />
          {suggestions === null ? (
            <CoachEmptyState icon={Sparkles} title="No suggestions loaded" description="Ask the Coach to analyze your real trend and propose three achievable goals with feasibility ratings." action="Generate suggestions" onAction={loadSuggestions} />
          ) : (
            <div className="coach-suggestion-list">
              {suggestions.map((suggestion, index) => (
                <div className="coach-suggestion-card" key={index}>
                  <span className={`coach-feasibility ${suggestion.feasibility.toLowerCase()}`}>{suggestion.feasibility.toLowerCase()}</span>
                  <strong>{suggestion.title}</strong>
                  <p>{suggestion.description}</p>
                  <span className="coach-suggestion-target">{formatMoney(suggestion.targetValue, suggestion.currency)} · {suggestion.metric.toLowerCase()}</span>
                  <button className="button secondary" onClick={() => accept(suggestion)}>Accept goal</button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function CoachGoalRow({ goal, storeId, onChanged, onToast }: { goal: CoachGoal; storeId: string | null; onChanged: () => void; onToast: CoachToast }) {
  const [progress, setProgress] = useState<number | null>(null)
  useEffect(() => {
    if (!storeId) return
    void import('./api.js').then(({ fetchCoachGoalProgress }) => fetchCoachGoalProgress(storeId, goal.id)).then((view) => setProgress(view.current)).catch(() => undefined)
  }, [storeId, goal.id])
  const current = progress ?? goal.currentProgress
  const pct = Math.min(current / Math.max(goal.targetValue, 1) * 100, 100)
  const complete = () => {
    if (!storeId) return
    void import('./api.js').then(({ updateCoachGoal }) => updateCoachGoal(storeId, goal.id, { status: 'ACHIEVED' })).then(() => { onChanged(); onToast('Goal marked achieved. The Coach logged the win.', 'success') }).catch((error: unknown) => onToast(errorMessage(error), 'error'))
  }
  const remove = () => {
    if (!storeId) return
    void import('./api.js').then(({ deleteCoachGoal }) => deleteCoachGoal(storeId, goal.id)).then(() => { onChanged(); onToast('Goal deleted.', 'info') }).catch((error: unknown) => onToast(errorMessage(error), 'error'))
  }
  return (
    <div className="coach-goal-row">
      <div className="coach-goal-row-main">
        <div className="coach-goal-row-top"><strong>{goal.title}</strong><span className={`coach-goal-status ${goal.status.toLowerCase()}`}>{goal.status.toLowerCase()}</span></div>
        <p>{goal.description}</p>
        <div className="coach-goal-row-meta"><span>{goal.metric.toLowerCase()} · {goal.startDate} → {goal.endDate}</span><span>{paceLabelFromPct(pct)} · {Math.round(pct)}%</span></div>
        <div className="coach-progress-track"><span style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="coach-goal-row-side">
        <strong>{formatMoney(current, goal.targetCurrency)} <small>/ {formatMoney(goal.targetValue, goal.targetCurrency)}</small></strong>
        {goal.status === 'ACTIVE' && <button className="button secondary" onClick={complete}>Mark achieved</button>}
        <button className="text-button" onClick={remove}>Delete</button>
      </div>
    </div>
  )
}

function paceLabelFromPct(pct: number): string {
  if (pct >= 100) return 'Achieved'
  return paceLabel(pct >= 40 ? 'ON_TRACK' : 'BEHIND')
}

export function CoachProgressView({ context, plan, onToast, onNavigateBilling }: { context: WorkspaceContext; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void }) {
  const [summary, setSummary] = useState<CoachProgressSummary | null>(null)
  const [heatmap, setHeatmap] = useState<CoachHeatmapView | null>(null)
  const [comparisons, setComparisons] = useState<Readonly<Record<string, unknown>> | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const storeId = context.storeId
  // The window is the merchant's real plan entitlement, not a hardcoded 30.
  const historyDays = Math.min(COACH_LIMITS[plan].progressHistoryDays as number, 365)
  const load = useCallback(() => {
    if (!storeId) return
    setLoadState('loading')
    void Promise.allSettled([
      fetchCoachProgressSummary(storeId, historyDays),
      fetchCoachActivityHeatmap(storeId),
      import('./api.js').then(({ fetchCoachProgressComparisons }) => fetchCoachProgressComparisons(storeId)),
    ]).then(([summaryResult, heatmapResult, comparisonsResult]) => {
      setSummary(summaryResult.status === 'fulfilled' ? summaryResult.value : null)
      setHeatmap(heatmapResult.status === 'fulfilled' ? heatmapResult.value : null)
      setComparisons(comparisonsResult.status === 'fulfilled' ? comparisonsResult.value : null)
      setLoadState(summaryResult.status === 'rejected' && heatmapResult.status === 'rejected' ? 'error' : 'ready')
    }).catch(() => setLoadState('error'))
  }, [storeId, historyDays])
  useEffect(() => { load() }, [load])
  const goBack = useCallback(() => { window.history.back() }, [])
  const description = `Real ${historyDays >= 365 ? 'full-history' : `${historyDays}-day`} trends, comparisons, and your weekly activity pattern.`
  if (loadState === 'loading') return <div className="coach-subview"><CoachSubHeader eyebrow="Store Coach" title="Progress" description={description} onBack={goBack} /><CoachSkeletonMain /></div>
  return (
    <div className="coach-subview">
      <CoachSubHeader eyebrow="Store Coach" title="Progress" description={description} onBack={goBack} />
      {summary ? <ProgressDashboard summary={summary} plan={plan} onNavigate={goBack} onNavigateBilling={onNavigateBilling} onRetry={load} /> : <CoachErrorState error="Progress data could not be loaded." onRetry={load} onNavigateBilling={onNavigateBilling} />}
      {comparisons && <ComparisonsSection comparisons={comparisons} />}
      <HeatmapSection heatmap={heatmap} onNavigate={goBack} onRetry={load} />
      <WeeklyPatternBars storeId={storeId} onToast={onToast} />
    </div>
  )
}

function ComparisonsSection({ comparisons }: { comparisons: Readonly<Record<string, unknown>> }) {
  const revenue = asRecord(comparisons.revenue)
  const orders = asRecord(comparisons.orders)
  return (
    <section className="coach-card">
      <CoachCardHeading kicker="VS PREVIOUS PERIOD" dot="blue" title="This window vs the one before" />
      <div className="coach-comparison-grid">
        <div className="coach-comparison-cell"><span>Revenue</span><strong>{formatMoney(Number(revenue.current ?? 0))}</strong><small className={Number(revenue.changePct ?? 0) >= 0 ? 'positive' : 'negative'}>{Number(revenue.changePct ?? 0) >= 0 ? '↑' : '↓'} {Math.abs(Number(revenue.changePct ?? 0)).toFixed(1)}% vs {formatMoney(Number(revenue.previous ?? 0))}</small></div>
        <div className="coach-comparison-cell"><span>Orders</span><strong>{formatNumber(Number(orders.current ?? 0))}</strong><small className={Number(orders.changePct ?? 0) >= 0 ? 'positive' : 'negative'}>{Number(orders.changePct ?? 0) >= 0 ? '↑' : '↓'} {Math.abs(Number(orders.changePct ?? 0)).toFixed(1)}% vs {formatNumber(Number(orders.previous ?? 0))}</small></div>
      </div>
    </section>
  )
}

function WeeklyPatternBars({ storeId, onToast }: { storeId: string | null; onToast: CoachToast }) {
  const [beats, setBeats] = useState<readonly { day: string; intensity: number; label: string }[]>([])
  useEffect(() => {
    if (!storeId) return
    void fetchCoachProgressTrends(storeId, 'orders', 30).then((result) => {
      const byWeekday = new Map<string, number>()
      for (const row of result.series as readonly { day: string; value: number }[]) {
        const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(`${row.day}T00:00:00Z`).getUTCDay()] ?? '?'
        byWeekday.set(wd, (byWeekday.get(wd) ?? 0) + row.value)
      }
      const max = Math.max(...byWeekday.values(), 1)
      const labels = ['Quiet','Steady','Building','Rising','Strong beat!']
      const ordered = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d)=> {
        const v = byWeekday.get(d) ?? 0
        const pct = Math.round(v/max*100)
        return { day: d, intensity: pct, label: (pct>80?labels[4]: pct>60?labels[3]: pct>40?labels[2]: pct>20?labels[1]: labels[0]) ?? 'Quiet' }
      })
      setBeats(ordered)
    }).catch(()=>undefined)
  }, [storeId])
  if (beats.length === 0) return null
  return (
    <section className="coach-card">
      <CoachCardHeading kicker="YOUR STORE'S WEEKLY BEAT" dot="green" title="Weekly order rhythm" />
      <WeeklyRhythmBeat beats={beats} />
      <p className="coach-chart-note">Beat bars are real synced orders by weekday · music-themed rhythm, not a bar chart.</p>
      <button className="text-button" onClick={() => onToast('Charts are drawn from synced analytics rows only.', 'info')}><Sparkles size={12} /> How this is computed</button>
    </section>
  )
}

export function CoachChatView({ context }: { context: WorkspaceContext; plan?: CoachPlan; onToast?: CoachToast; onNavigateBilling?: () => void }) {
  if (!context.storeId) return null
  return <CoachAskRedirect onBack={() => window.history.back()} />
}

export function CoachAchievementsView({ context, achievements, plan, onToast, onNavigateBilling }: { context: WorkspaceContext; achievements: readonly CoachAchievement[]; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void }) {
  const [catalog, setCatalog] = useState<readonly import('./store-coach-model.js').CoachBadgeCatalogEntry[] | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [catalogRetryTick, setCatalogRetryTick] = useState(0)
  const [streak, setStreak] = useState<CoachStreakView | null>(null)
  const storeId = context.storeId
  useEffect(() => {
    if (!storeId) return
    setCatalogFailed(false)
    void Promise.allSettled([import('./api.js').then(({ fetchCoachAvailableAchievements }) => fetchCoachAvailableAchievements(storeId)), fetchCoachStreak(storeId)]).then(([catalogResult, streakResult]) => {
      // FIX (permanent blank boxes): distinguish "still loading" (skeleton)
      // from "fetch failed" (honest retryable state) instead of skeletons forever.
      setCatalog(catalogResult.status === 'fulfilled' ? catalogResult.value.catalog : null)
      setCatalogFailed(catalogResult.status === 'rejected')
      setStreak(streakResult.status === 'fulfilled' ? streakResult.value : null)
    })
  }, [storeId, catalogRetryTick])
  const visibleCap = COACH_LIMITS[plan].badgesVisible as number
  return (
    <div className="coach-subview">
      <CoachSubHeader eyebrow="Store Coach" title="Achievements" description={`Badges celebrate real milestones. Your plan shows ${visibleCap} of the 50-badge catalog.`} onBack={() => window.history.back()} />
      <section className="coach-card coach-streak-hero">
        <span className="coach-streak-flame large"><Flame size={26} /></span>
        <div>
          <div className="section-kicker">DAILY STREAK</div>
          <h2>{streak?.currentStreak ?? 0} day{streak?.currentStreak === 1 ? '' : 's'} and counting</h2>
          <p>{streak?.todayViewed ? 'Today’s huddle is viewed — the streak is alive.' : 'View today’s huddle to keep the streak alive.'} Longest: {streak?.longestStreak ?? 0} days.</p>
        </div>
        <div className="coach-streak-targets">
          <span className={streak && streak.currentStreak >= 7 ? 'hit' : ''} title="7-day streak badge"><Trophy size={14} /> 7</span>
          <span className={streak && streak.currentStreak >= 30 ? 'hit' : ''} title="30-day streak badge"><Trophy size={14} /> 30</span>
          <span className={streak && streak.currentStreak >= 100 ? 'hit' : ''} title="100-day streak badge"><Trophy size={14} /> 100</span>
        </div>
      </section>
      <section className="coach-card">
        <CoachCardHeading kicker={`BADGE CATALOG · ${achievements.length} EARNED`} dot="gold" title="All badges" />
        {catalog === null && catalogFailed ? (
          <div className="coach-section-unavailable slim">
            <span className="coach-section-unavailable-icon gold"><Trophy size={20} /></span>
            <div className="coach-section-unavailable-copy">
              <strong>The badge catalog didn’t load</strong>
              <p>Your earned badges are safe — only the list of what’s still unlockable failed to arrive. Retry pulls the live catalog again.</p>
              <div className="coach-section-unavailable-actions">
                <button className="button secondary" onClick={() => setCatalogRetryTick((tick) => tick + 1)}><RefreshCw size={14} /> Retry loading badges</button>
              </div>
            </div>
          </div>
        ) : catalog === null ? <CoachSkeletonRow /> : (
          <div className="coach-badge-grid">
            {catalog.map((badge) => (
              <div className={`coach-badge-card ${badge.earned ? 'earned' : 'locked'} rarity-${badge.rarity.toLowerCase()}`} key={badge.id} title={badge.earned ? `Earned ${badge.earnedAt ? relativeTimeLabel(badge.earnedAt) : ''}` : 'Not earned yet'}>
                <span className="coach-badge-icon">{badge.earned ? <Trophy size={16} /> : <LockKeyhole size={14} />}</span>
                <strong>{badge.title}</strong>
                <p>{badge.description}</p>
                <span className="coach-badge-rarity">{badge.rarity.toLowerCase()} · {badge.category.toLowerCase()}</span>
              </div>
            ))}
          </div>
        )}
        {catalog && catalog.length < 50 && plan !== 'commander' && <LockedFeatureNote feature={`The full 50-badge catalog`} planName={plan === 'trial' ? 'Start' : plan === 'start' ? 'Growth' : 'Commander'} onUpgrade={onNavigateBilling} />}
      </section>
      {achievements.length === 0 && <CoachEmptyState icon={Trophy} title="No badges yet — and that’s honest" description="Complete your first huddle to earn the First Huddle badge. Every badge here maps to a real event in your store or your coaching habit." action="Back to Store Coach" onAction={() => window.history.back()} />}
    </div>
  )
}

export function CoachSettingsView({ context, preferences, plan, onToast, onNavigateBilling, onReload }: { context: WorkspaceContext; preferences: CoachPreferencesView | null; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void; onReload: () => void }) {
  const storeId = context.storeId
  const [saving, setSaving] = useState(false)
  const save = (patch: Readonly<Record<string, unknown>>) => {
    if (!storeId) { onToast('Connect Shopify first.', 'info'); return }
    setSaving(true)
    void import('./api.js').then(({ updateCoachPreferences }) => updateCoachPreferences(storeId, patch)).then(() => { onToast('Store Coach preferences saved.', 'success'); onReload() }).catch((error: unknown) => onToast(errorMessage(error), 'error')).finally(() => setSaving(false))
  }
  const allowedPersonalities = coachPersonalitiesForPlan(plan)
  return (
    <div className="coach-subview">
      <CoachSubHeader eyebrow="Store Coach" title="Preferences" description="Tune your coach’s style, briefing time, notifications, widget, and language." onBack={() => window.history.back()} />
      <div className="coach-settings-grid">
        <section className="coach-card">
          <CoachCardHeading kicker="PERSONALITY" dot="purple" title="How your Coach talks" />
          <div className="coach-personality-grid">
            {(Object.keys(PERSONALITY_META) as (keyof typeof PERSONALITY_META)[]).map((id) => {
              const allowed = allowedPersonalities.includes(id)
              const meta = PERSONALITY_META[id]
              const active = preferences?.personality === id
              return (
                <button key={id} className={`coach-personality-card ${active ? 'active' : ''} ${allowed ? '' : 'locked'}`} disabled={!allowed || saving} onClick={() => save({ personality: id })}>
                  <div className="coach-personality-head"><strong>{meta.label}</strong>{!allowed && <LockKeyhole size={12} />}</div>
                  <small>{meta.tagline}</small>
                  <p>“{meta.sample}”</p>
                  {active && <span className="coach-personality-active"><Check size={12} /> Selected</span>}
                </button>
              )
            })}
          </div>
          {allowedPersonalities.length < 4 && <LockedFeatureNote feature="All four coach personalities" planName="Growth" onUpgrade={onNavigateBilling} />}
        </section>
        <section className="coach-card">
          <CoachCardHeading kicker="DAILY HUDDLE" dot="blue" title="Morning routine" />
          <CoachSettingRow label="Huddle enabled" description="Generate a briefing every day"><Toggle value={preferences?.huddleEnabled ?? true} onChange={(value) => save({ huddleEnabled: value })} disabled={saving} /></CoachSettingRow>
          <CoachSettingRow label="Huddle time" description={`Currently ${huddleTimeLabel(preferences?.huddleTimeMinutes ?? 420)} in your store timezone`}>
            {plan === 'trial' ? <LockedFeatureNote feature="Custom huddle time" planName="Start" onUpgrade={onNavigateBilling} /> : <input type="time" className="setting-input" defaultValue={minutesToTimeInput(preferences?.huddleTimeMinutes ?? 420)} onChange={(event) => { const [hours, minutes] = event.target.value.split(':').map(Number); if (Number.isFinite(hours) && Number.isFinite(minutes)) save({ huddleTimeMinutes: (hours ?? 0) * 60 + (minutes ?? 0) }) }} />}
          </CoachSettingRow>
        </section>
        <section className="coach-card">
          <CoachCardHeading kicker="NOTIFICATIONS" dot="green" title="How often the Coach reaches out" />
          <CoachSettingRow label="Frequency" description="Low / Normal / High">
            <select className="setting-input" value={preferences?.notificationFrequency ?? 'NORMAL'} onChange={(event) => save({ notificationFrequency: event.target.value })}>
              <option value="LOW">Low — essentials only</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High — every update</option>
            </select>
          </CoachSettingRow>
          <CoachSettingRow label="Sunday weekly email" description="A digest of wins, metrics, and next-week focus"><Toggle value={preferences?.weeklyEmailEnabled ?? true} onChange={(value) => save({ weeklyEmailEnabled: value })} disabled={saving} /></CoachSettingRow>
        </section>
        <section className="coach-card">
          <CoachCardHeading kicker="WIDGET · LANGUAGE" dot="purple" title="Extras" />
          <CoachSettingRow label="Coach widget" description="A friendly reminder on every page">
            {plan === 'trial' ? <LockedFeatureNote feature="The floating Coach widget" planName="Start" onUpgrade={onNavigateBilling} /> : <Toggle value={preferences?.widgetEnabled ?? false} onChange={(value) => save({ widgetEnabled: value })} disabled={saving} />}
          </CoachSettingRow>
          <CoachSettingRow label="Language" description="English or Hindi coaching">
            {plan === 'growth' || plan === 'commander' ? (
              <select className="setting-input" value={preferences?.language ?? 'en'} onChange={(event) => save({ language: event.target.value })}>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            ) : <LockedFeatureNote feature="Hindi coaching" planName="Growth" onUpgrade={onNavigateBilling} />}
          </CoachSettingRow>
        </section>
      </div>
    </div>
  )
}

function CoachSettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return <div className="coach-setting-row"><div><strong>{label}</strong><small>{description}</small></div>{children}</div>
}

export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button className={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} disabled={disabled} onClick={() => onChange(!value)}><span /></button>
}

function minutesToTimeInput(minutes: number): string {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0')
  const minute = String(minutes % 60).padStart(2, '0')
  return `${hour}:${minute}`
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function CoachSubHeader({ eyebrow, title, description, onBack }: { eyebrow: string; title: string; description: string; onBack: () => void }) {
  return (
    <div className="coach-subheader">
      <button className="text-button" onClick={onBack}><ChevronRight size={14} className="flip" /> Store Coach</button>
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  )
}

function CoachCardHeading({ kicker, dot, title, action }: { kicker: string; dot: string; title: string; action?: ReactNode }) {
  return <div className="coach-card-heading"><div><div className="section-kicker"><span className={`kicker-dot ${dot}`} />{kicker}</div><h3>{title}</h3></div>{action ?? null}</div>
}

export function CoachEmptyState({ icon: Icon, title, description, action, onAction }: { icon: LucideIcon; title: string; description: string; action: string; onAction: () => void }) {
  return (
    <div className="coach-empty-state">
      <span className="coach-empty-icon"><Icon size={22} /></span>
      <h4>{title}</h4>
      <p>{description}</p>
      <button className="button secondary" onClick={onAction}>{action} <ArrowUpRight size={14} /></button>
    </div>
  )
}

export function CoachErrorState({ error, onRetry, onNavigateBilling }: { error: string; onRetry: () => void; onNavigateBilling: () => void }) {
  return (
    <div className="coach-error-state">
      <span className="coach-error-icon"><AlertCircle size={22} /></span>
      <h3>Store Coach hit a snag</h3>
      <p>{error}</p>
      <div className="coach-error-actions">
        <button className="button primary" onClick={onRetry}><RefreshCw size={14} /> Retry</button>
        {/upgrade|locked|plan/i.test(error) && <button className="button secondary" onClick={onNavigateBilling}><ArrowUpRight size={14} /> Upgrade Plan</button>}
      </div>
    </div>
  )
}

/**
 * FIX (permanent blank boxes): shown when SOME Store Coach requests failed
 * while others succeeded (`loadState === 'partial'`). Previously each failed
 * section quietly rendered three blank shimmer boxes forever. This banner
 * names what happened and offers a real retry that re-runs every coach fetch.
 */
export function CoachPartialBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="coach-partial-banner" role="status">
      <AlertCircle size={15} />
      <span className="coach-partial-banner-copy">
        <strong>A few cards couldn’t load this time</strong> — everything else on this page is live from your real store.
      </span>
      <button className="text-button" onClick={onRetry}><RefreshCw size={13} /> Retry</button>
    </div>
  )
}

export function CoachSkeletonMain() {
  return (
    <div className="coach-skeleton-main" aria-label="Loading Store Coach">
      <div className="coach-skeleton-row">
        {[0, 1, 2].map((index) => <div className="coach-skeleton-quick" key={index} />)}
      </div>
      <div className="coach-skeleton-card tall" />
      <div className="coach-skeleton-row">
        {[0, 1, 2].map((index) => <div className="coach-skeleton-card" key={index} />)}
      </div>
      <div className="coach-skeleton-card tall" />
    </div>
  )
}

function CoachSkeletonRow() {
  return <div className="coach-skeleton-row">{[0, 1, 2].map((index) => <div className="coach-skeleton-card" key={index} />)}</div>
}

function todayIso(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
}

function isoInDays(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error) return error.message
  return 'The API could not be reached.'
}
