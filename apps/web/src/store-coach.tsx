import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpenCheck,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flame,
  Gauge,
  Gem,
  Goal,
  History,
  Lightbulb,
  LockKeyhole,
  Mail,
  MessageSquare,
  Mic,
  MoonStar,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
  SunMedium,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Volume2,
  X,
  Zap,
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ApiClientError, completeCoachPriority, dismissCoachPriority, fetchCoachActivityHeatmap, fetchCoachAchievements, fetchCoachAvailableAchievements, fetchCoachChatSuggestions, fetchCoachGoals, fetchCoachHealthScore, fetchCoachHuddle, fetchCoachPreferences, fetchCoachPriorities, fetchCoachProgressSummary, fetchCoachProgressTrends, fetchCoachReview, fetchCoachStreak, fetchCoachUsage, markCoachHuddleViewed, regenerateCoachHuddle, regenerateCoachPriorities } from './api.js'
import type { WorkspaceContext } from './model.js'
import { formatMoney, formatNumber } from './model.js'
import {
  COACH_LIMITS,
  PERSONALITY_META,
  PLAN_LABEL,
  STREAK_BADGE_TARGETS,
  WEEKDAY_LABELS_SHORT,
  badgeTitleFromId,
  coachPersonalitiesForPlan,
  daypartForHour,
  formatCoachDate,
  greetingForDaypart,
  heatmapPatterns,
  huddleTimeLabel,
  merchantDisplayName,
  nextStreakMilestone,
  paceLabel,
  planFeatureSummary,
  relativeTimeLabel,
} from './store-coach-model.js'
import type {
  CoachAchievement,
  CoachBadgeCatalogEntry,
  CoachGoal,
  CoachHeatmapView,
  CoachHuddle,
  CoachPlan,
  CoachPreferencesView,
  CoachPriority,
  CoachPrioritiesView,
  CoachProgressSummary,
  CoachReviewView,
  CoachStreakView,
  CoachUsageView,
} from './store-coach-model.js'
import { CoachChatPanel, CoachOnboardingModal } from './store-coach-panels.js'

export type CoachToast = (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void

// ---------------------------------------------------------------------------
// Routing (path-based, preserves the Shopify query string)
// ---------------------------------------------------------------------------

export type CoachView = 'coach' | 'briefing' | 'insights' | 'goals' | 'progress' | 'chat' | 'achievements' | 'settings'

export function coachViewFromPath(pathname: string): CoachView {
  const path = pathname.replace(/\/+$/, '')
  if (path.endsWith('/briefing')) return 'briefing'
  if (path.endsWith('/insights')) return 'insights'
  if (path.endsWith('/coach/goals')) return 'goals'
  if (path.endsWith('/coach/progress')) return 'progress'
  if (path.endsWith('/coach/chat')) return 'chat'
  if (path.endsWith('/coach/achievements')) return 'achievements'
  if (path.endsWith('/coach/settings')) return 'settings'
  return 'coach'
}

export function coachPathForView(view: CoachView): string {
  switch (view) {
    case 'briefing': return '/ai-growth-command/briefing'
    case 'insights': return '/ai-growth-command/insights'
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
      fetchCoachProgressSummary(storeId, 30),
      fetchCoachActivityHeatmap(storeId),
      fetchCoachAchievements(storeId),
      fetchCoachAvailableAchievements(storeId),
      fetchCoachStreak(storeId),
      fetchCoachReview(storeId),
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
      const message = first instanceof ApiClientError && first.status === 402 ? 'Store Coach is locked on your current plan. Upgrade to keep coaching.' : first instanceof Error ? first.message : 'Some Store Coach data could not be loaded.'
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
        onAskCoach={() => navigate('chat')}
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
      ) : view === 'briefing' || view === 'insights' ? (
        <ComingSoonSection title={view === 'briefing' ? 'Executive Briefing' : 'Insights Hub'} icon={view === 'briefing' ? BookOpenCheck : Lightbulb} description={view === 'briefing' ? 'A boardroom-grade weekly summary of your store, prepared by your AI employee. Shipping in PR #49.' : 'Deep pattern discovery across your synced store data. Shipping in PR #50.'} />
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

/**
 * FIX 2 — personal, welcoming hero. Time-based greeting, real merchant name
 * derived from the shop domain, live streak, honest engagement status, and
 * the two actions merchants open every morning.
 */
function CoachHero({ shop, plan, health, streak, usage, onAskCoach, onSettings, onOnboarding, onHuddle }: {
  shop: string | null
  plan: CoachPlan
  health: CoachData['health']
  streak: CoachStreakView | null
  usage: CoachUsageView | null
  onAskCoach: () => void
  onSettings: () => void
  onOnboarding: () => void
  onHuddle: () => void
}) {
  const hour = new Date().getHours()
  const part = daypartForHour(hour)
  const greeting = greetingForDaypart(part)
  const merchantName = merchantDisplayName(shop)
  const streakDays = streak?.currentStreak ?? 0
  const chatLimit = usage?.chatLimit ?? (COACH_LIMITS[plan].chatMessagesPerDay as number)
  const chatUsed = usage?.chatMessagesToday ?? 0
  return (
    <header className="coach-hero">
      <div className="coach-hero-main">
        <span className="coach-avatar" aria-hidden="true">
          <Bot size={26} />
          <i className="coach-avatar-presence" title="Your coach is online" />
        </span>
        <div className="coach-hero-copy">
          <div className="coach-hero-eyebrow">
            <span className="coach-hero-brand">Your Store Coach</span>
            <span className={`coach-plan-badge ${plan}`}>{PLAN_LABEL[plan]}</span>
          </div>
          <h1 className="coach-hero-title">
            {greeting}{merchantName ? `, ${merchantName}` : ''}! <span className="coach-hero-daypart">{daypartIcon(part, 20)}</span>
          </h1>
          <p className="coach-hero-sub">Ready to help you grow today — every number you see is grounded in your synced Shopify data.</p>
          <div className="coach-hero-meta">
            {health && (
              <span className={`coach-meta-pill ${health.tone}`} title="Coach engagement score — how much value you are getting from Store Coach">
                <i className="pill-dot" />
                {health.label}{typeof health.score === 'number' ? ` · ${health.score}/100` : ''}
              </span>
            )}
            <span className="coach-meta-pill streak" title="Consecutive days you viewed your huddle">
              <Flame size={13} />
              Streak: {streakDays} day{streakDays === 1 ? '' : 's'}
            </span>
            {usage && (
              <span className="coach-meta-pill" title="Coach chat messages used today">
                <MessageSquare size={13} />
                {chatUsed} / {chatLimit >= 999 ? '∞' : chatLimit} messages today
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="coach-hero-actions">
        <button className="button primary" onClick={onHuddle}><Mic size={15} /> Start Morning Huddle</button>
        <button className="button secondary" onClick={onAskCoach}><MessageSquare size={15} /> Ask Coach</button>
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
  if (view === 'chat') return <CoachChatView context={context} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} />
  if (view === 'achievements') return <CoachAchievementsView context={context} achievements={data.achievements} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} />
  if (view === 'settings') return <CoachSettingsView context={context} preferences={data.preferences} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} onReload={onReload} />

  if (!context.storeId) {
    return <CoachEmptyState icon={Bot} title="Connect Shopify to meet your Store Coach" description="Store Coach builds every briefing, priority, and goal from your real synced store data. ProfitPilot never ships demo numbers." action="Connect Shopify" onAction={onOpenOnboarding} />
  }
  if (loadState === 'loading') return <CoachSkeletonMain />
  if (loadState === 'error') return <CoachErrorState error="Store Coach could not load. Check your connection and retry." onRetry={onReload} onNavigateBilling={onNavigateBilling} />

  return (
    <div className="coach-main">
      <section className="coach-sections">
        <TodayBriefingCard storeId={context.storeId!} huddle={data.huddle} plan={plan} onToast={onToast} onReload={onReload} />
        <PrioritiesSection storeId={context.storeId!} priorities={data.priorities} plan={plan} onToast={onToast} onReload={onReload} onNavigate={() => onNavigate('goals')} />
        <GoalSection storeId={context.storeId!} goals={data.goals} plan={plan} onToast={onToast} onNavigate={() => onNavigate('goals')} onNavigateBilling={onNavigateBilling} />
        <ProgressDashboard summary={data.summary} plan={plan} onNavigate={() => onNavigate('progress')} onNavigateBilling={onNavigateBilling} />
        <HeatmapSection heatmap={data.heatmap} onNavigate={() => onNavigate('progress')} />
        <AchievementsSection achievements={data.achievements} badgeCatalog={data.badgeCatalog} streak={data.streak} plan={plan} onNavigate={() => onNavigate('achievements')} onViewHuddle={() => { void onHuddleClick(context.storeId!, onToast, onReload) }} />
        <AskCoachSection context={context} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} />
        {data.review && context.storeId && <WeeklyReviewCard storeId={context.storeId} review={data.review} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} onSetGoal={() => onNavigate('goals')} />}
        <CoachPlanCard plan={plan} onNavigateBilling={onNavigateBilling} />
      </section>
      <div className="coach-onboarding-nudge"><Sparkles size={15} /><span>New to Store Coach? Take the 2-minute tour.</span><button className="text-button" onClick={onOpenOnboarding}>Start tour <ChevronRight size={14} /></button></div>
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
  { label: 'Reading yesterday’s synced orders and revenue', detail: 'Real rows only' },
  { label: 'Reviewing your recent trends', detail: 'Compared against your own baseline' },
  { label: 'Finding today’s opportunities', detail: 'Where growth is actually possible' },
  { label: 'Writing your personalized briefing', detail: 'In your coach’s voice' },
] as const

function TodayBriefingCard({ storeId, huddle, plan, onToast, onReload }: { storeId: string; huddle: CoachHuddle | null; plan: CoachPlan; onToast: CoachToast; onReload: () => void }) {
  const [speaking, setSpeaking] = useState(false)
  const [generating, setGenerating] = useState(false)
  const voicePlan = plan === 'growth' || plan === 'commander'

  const generate = () => {
    setGenerating(true)
    void regenerateCoachHuddle(storeId)
      .then(() => { onToast('Today’s briefing is ready.', 'success'); onReload() })
      .catch((error: unknown) => onToast(errorMessage(error), 'error'))
      .finally(() => setGenerating(false))
  }

  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  const speak = () => {
    if (speaking) { stopSpeaking(); return }
    if (!('speechSynthesis' in window)) { onToast('Voice output is not supported in this browser.', 'info'); return }
    const content = huddle?.content
    if (!content) return
    const text = [content.greeting, content.yesterdaySnapshot, content.todayPreview, content.keyInsight].filter((part): part is string => typeof part === 'string').join('. ')
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }

  // ── State A: first visit / no briefing yet — a warm, educational welcome ──
  if (!huddle && !generating) {
    return (
      <section className="coach-card coach-briefing-card">
        <CoachCardHeading kicker="TODAY’S BRIEFING" dot="purple" title="Welcome to Store Coach!" />
        <div className="coach-briefing-welcome">
          <span className="coach-orb"><Bot size={24} /></span>
          <div className="coach-briefing-welcome-copy">
            <strong>I’m your personal AI business coach.</strong>
            <p>Every morning I analyze your synced orders, revenue, and customers, then hand you a short briefing with the top opportunities to grow — real numbers only, never invented ones. If your store data is still thin, I’ll say so honestly and tell you what to sync next.</p>
            <div className="coach-briefing-welcome-actions">
              <button className="button primary" onClick={generate}><Mic size={15} /> Generate My First Briefing</button>
              <button className="button secondary" onClick={() => onToast('The tour walks you through huddles, goals, priorities, and chat in about two minutes.', 'info')}><BookOpenCheck size={15} /> Learn how it works</button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // ── State B: generating — animated, honest progress while the coach works ──
  if (!huddle && generating) {
    return (
      <section className="coach-card coach-briefing-card">
        <CoachCardHeading kicker="TODAY’S BRIEFING" dot="purple" title="Your Coach is preparing today’s briefing…" />
        <div className="coach-briefing-generating">
          <CoachGenerationSteps />
          <p className="coach-generating-note"><Clock3 size={13} /> This usually takes 10–30 seconds. Every number is checked against your synced data before it reaches you.</p>
        </div>
      </section>
    )
  }

  if (generating) {
    // A huddle already exists and a refresh is in flight — keep showing the
    // current content with a lightweight progress strip instead of a blank.
    return (
      <section className="coach-card coach-briefing-card">
        <div className="coach-refreshing-strip"><RefreshCw size={14} className="spin" /> Refreshing today’s briefing from your latest synced data…</div>
        <BriefingReadyCard storeId={storeId} huddle={huddle!} voicePlan={voicePlan} speaking={speaking} onSpeak={speak} onToast={onToast} onReload={onReload} />
      </section>
    )
  }

  return <section className="coach-card coach-briefing-card"><BriefingReadyCard storeId={storeId} huddle={huddle!} voicePlan={voicePlan} speaking={speaking} onSpeak={speak} onToast={onToast} onReload={onReload} /></section>
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

function BriefingReadyCard({ storeId, huddle, voicePlan, speaking, onSpeak, onToast, onReload }: { storeId: string; huddle: CoachHuddle; voicePlan: boolean; speaking: boolean; onSpeak: () => void; onToast: CoachToast; onReload: () => void }) {
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
          <CoachCardHeading kicker={`TODAY’S BRIEFING · ${formatCoachDate(huddle.huddleDate).toUpperCase()}`} dot="purple" title={formatCoachDate(huddle.huddleDate)} />
          <h2 className="coach-greeting">{greeting}</h2>
          <p className="coach-briefing-lede">Here’s what matters today — pulled from your real store data.</p>
        </div>
        <div className="coach-briefing-actions">
          <span className="coach-review-time"><Clock3 size={13} /> {minutes} min read</span>
          <button className="button secondary coach-briefing-refresh" onClick={() => { void onHuddleClick(storeId, onToast, onReload) }}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>
      <div className="coach-briefing-grid">
        <CoachBriefingCell label="Yesterday’s snapshot" icon={History} text={yesterday} />
        <CoachBriefingCell label="Key insight" icon={Lightbulb} text={insight} />
        <CoachBriefingCell label="Today’s focus" icon={Target} text={preview} />
      </div>
      <div className="coach-briefing-footer">
        {huddle.viewed ? (
          <span className="coach-viewed-note"><CheckCircle2 size={13} /> Viewed — streak is safe for today</span>
        ) : (
          <button className="button primary" onClick={() => { void markCoachHuddleViewed(storeId, huddle.id).then(() => onReload()).catch((error: unknown) => onToast(errorMessage(error), 'error')) }}><Check size={14} /> Mark as read — keep the streak alive</button>
        )}
        <div className="coach-briefing-footer-side">
          {voicePlan ? (
            <button className="button secondary" onClick={onSpeak}>{speaking ? <><X size={14} /> Stop audio</> : <><Volume2 size={14} /> Play audio</>}</button>
          ) : (
            <span className="coach-voice-locked" title="Voice coaching unlocks on higher plans"><Volume2 size={13} /> Voice on higher plans</span>
          )}
          <span className="coach-data-note"><Sparkles size={12} /> Numbers come from synced store rows — never estimated.</span>
        </div>
      </div>
    </>
  )
}

function CoachBriefingCell({ label, icon: Icon, text }: { label: string; icon: LucideIcon; text: string }) {
  return <div className="coach-briefing-cell"><span className="coach-briefing-cell-icon"><Icon size={15} /></span><div><strong>{label}</strong><p>{text || 'Not enough synced data yet — sync orders to fill this in.'}</p></div></div>
}

// ---------------------------------------------------------------------------
// 2. Priorities (FIX 4 — rich, actionable priority cards)
// ---------------------------------------------------------------------------

function PrioritiesSection({ storeId, priorities, plan, onToast, onReload, onNavigate }: { storeId: string; priorities: CoachPrioritiesView | null; plan: CoachPlan; onToast: CoachToast; onReload: () => void; onNavigate: () => void }) {
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
        <CoachCardHeading kicker="TODAY'S TOP PRIORITIES" dot="red" title={priorities === null ? 'Loading your priorities…' : visible.length === 0 ? 'Everything is handled' : `${remaining} action${remaining === 1 ? '' : 's'} worth your time today`} />
        <div className="coach-section-head-actions">
          <span className="coach-plan-chip">{planLimit >= 999 ? 'Unlimited' : planLimit} / day on your plan</span>
          <button className="text-button" onClick={regenerate}><RefreshCw size={13} /> Regenerate</button>
        </div>
      </div>
      {priorities === null ? (
        <CoachSkeletonRow />
      ) : visible.length === 0 ? (
        <div className="coach-all-clear">
          <span className="coach-all-clear-icon"><CheckCircle2 size={26} /></span>
          <div className="coach-all-clear-copy">
            <strong>All caught up — great news!</strong>
            <p>No urgent actions for today. Your store is running smoothly, or your synced data does not show open issues. Priorities only appear when the Coach finds something real: revenue dips, order anomalies, or growth opportunities worth acting on. Come back tomorrow, or work ahead on a weekly goal below.</p>
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
  const meta = priority.category === 'HIGH_IMPACT' ? { icon: Flame, tone: 'red', label: 'High Impact' } : priority.category === 'QUICK_WIN' ? { icon: Zap, tone: 'green', label: 'Quick Win' } : { icon: Sparkles, tone: 'amber', label: 'Opportunity' }
  const Icon = meta.icon
  return (
    <article className={`coach-priority-card ${meta.tone}`}>
      <div className="coach-priority-top">
        <span className="coach-priority-icon"><Icon size={15} /></span>
        <span className="coach-priority-category">{meta.label}</span>
        <span className="coach-priority-time"><Clock3 size={12} /> {priority.timeEstimateMinutes} min</span>
      </div>
      <h3>{priority.title}</h3>
      <p>{priority.description}</p>
      <div className="coach-priority-impact">
        <strong>{priority.impactValue > 0 ? formatMoney(priority.impactValue, priority.impactCurrency) : 'Growth'}</strong>
        <span>{priority.impactValue > 0 && priority.impactLabel ? priority.impactLabel : 'no dollar estimate — do it for the momentum'}</span>
      </div>
      <div className="coach-priority-actions">
        <button className="button primary" disabled={busy} onClick={onComplete}><Check size={14} /> Take Action</button>
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
  const goalLimit = COACH_LIMITS[plan].activeGoals as number

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
              <strong>Weekly goals turn effort into direction.</strong>
              <p>Your Coach suggests goals from your real trend — e.g. beat last week's revenue by a realistic margin — and tracks progress automatically from synced orders. Pick one below, or create your own.</p>
            </div>
          </div>
          <div className="coach-goal-suggestions">
            <div className="coach-goal-suggestions-label"><Sparkles size={13} /> AI-suggested goals from your real data</div>
            {suggestionsLoading && <div className="coach-suggestion-list"><div className="coach-suggestion-card loading" /><div className="coach-suggestion-card loading" /></div>}
            {!suggestionsLoading && suggestions !== null && suggestions.length === 0 && (
              <div className="coach-goal-suggestions-empty">
                <p>No suggestions yet — goals are proposed from your trailing revenue and order trend. Sync more order history (or a few more days of sales) and the Coach will have something realistic to aim for. You can always set a custom goal manually.</p>
                <button className="button secondary" onClick={onNavigate}><Goal size={14} /> Create a custom goal</button>
              </div>
            )}
            {!suggestionsLoading && suggestions !== null && suggestions.length > 0 && (
              <div className="coach-suggestion-list">
                {suggestions.map((suggestion, index) => (
                  <div className="coach-suggestion-card" key={index}>
                    <div className="coach-suggestion-head">
                      <strong>{suggestion.title}</strong>
                      <span className={`coach-feasibility ${suggestion.feasibility.toLowerCase()}`}>feasibility: {suggestion.feasibility.toLowerCase()}</span>
                    </div>
                    <p>{suggestion.description}</p>
                    <div className="coach-suggestion-facts">
                      <span><Target size={12} /> Target: {formatMoney(suggestion.targetValue, suggestion.currency)}</span>
                      <span>metric: {suggestion.metric.toLowerCase()}</span>
                    </div>
                    {suggestion.rationale && <small className="coach-suggestion-rationale">“{suggestion.rationale}”</small>}
                    <button className="button secondary" disabled={accepting === index} onClick={() => acceptSuggestion(suggestion, index)}>{accepting === index ? 'Setting…' : 'Choose this goal'}</button>
                  </div>
                ))}
                <button className="text-button coach-goal-custom" onClick={onNavigate}>Or create a custom goal <ChevronRight size={13} /></button>
              </div>
            )}
            {goals.length > 0 && <p className="coach-goal-note">You have {goals.length} goal{goals.length === 1 ? '' : 's'} — none active this week.</p>}
            {plan === 'trial' && <LockedFeatureNote feature={`Track more than ${goalLimit} goal at a time`} planName="Start" onUpgrade={onNavigateBilling} />}
          </div>
        </div>
      ) : (
        <div className="coach-goal-body">
          <RadialGauge percent={goalPct} tone={goalPct >= 70 ? 'green' : goalPct >= 40 ? 'amber' : 'red'} />
          <div className="coach-goal-stats">
            <div className="coach-goal-numbers">
              <span><strong>{formatMoney(progress[active.id]?.current ?? active.currentProgress, active.targetCurrency)}</strong><small>current</small></span>
              <span><strong>{formatMoney(active.targetValue, active.targetCurrency)}</strong><small>target</small></span>
              <span><strong>{Math.max(0, daysUntil(active.endDate))}</strong><small>days left</small></span>
            </div>
            <div className="coach-goal-status-row">
              <span className={`coach-pace-badge ${goalPct >= 100 ? 'ahead' : (progress[active.id]?.pace ?? 'ON_TRACK') === 'BEHIND' && goalPct < 40 ? 'behind' : 'on-track'}`}>{goalPct >= 100 ? 'Achieved 🎉' : paceLabel(progress[active.id]?.pace ?? 'ON_TRACK')}</span>
              <span className="coach-feasibility-inline">feasibility: {active.feasibility.toLowerCase()}</span>
              <span className="coach-goal-metric">{active.metric.replaceAll('_', ' ').toLowerCase()}</span>
            </div>
            <GoalPaceNote goal={active} progress={progress[active.id] ?? null} />
            <p className="coach-goal-description">{active.description || 'Tracked automatically from your synced orders.'}</p>
            <div className="coach-goal-actions">
              <button className="button secondary" onClick={onNavigate}>View Details</button>
              <button className="text-button" onClick={() => onToast('Adjust the goal from the Goals view — targets and end dates are editable there.', 'info')}>Adjust Goal</button>
            </div>
            {plan === 'trial' && <LockedFeatureNote feature="Track more than 1 goal" planName="Start" onUpgrade={onNavigateBilling} />}
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
  if (progress.actualDailyPace <= 0) {
    if (progress.daysRemaining <= 0) return null
    return <p className="coach-goal-pace behind">Coach's note: the clock is running — {formatMoney(progress.requiredDailyPace, goal.targetCurrency)}/day from here closes the gap.</p>
  }
  const projected = progress.actualDailyPace * progress.daysTotal
  return (
    <p className={`coach-goal-pace ${progress.pace === 'BEHIND' ? 'behind' : 'on-track'}`}>
      Coach's projection: at today's real pace ({formatMoney(progress.actualDailyPace, goal.targetCurrency)}/day) you're heading to about {formatMoney(projected, goal.targetCurrency)} by {goal.endDate}.
      {progress.pace === 'BEHIND' ? ` It needs ${formatMoney(progress.requiredDailyPace, goal.targetCurrency)}/day to land on target.` : ' Keep up the great work!'}
    </p>
  )
}

function daysUntil(endDate: string): number {
  const end = new Date(`${endDate}T00:00:00Z`).getTime()
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(Math.round((end - today) / 86_400_000), 0)
}

/** Animated radial progress gauge (SVG, theme-adaptive). */
export function RadialGauge({ percent, tone, size = 132 }: { percent: number; tone: 'green' | 'amber' | 'red'; size?: number }) {
  const clamped = Math.max(0, Math.min(percent, 100))
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  return (
    <div className="coach-radial" style={{ width: size, height: size }} role="img" aria-label={`Goal progress ${Math.round(clamped)}%`}>
      <svg viewBox="0 0 120 120">
        <circle className="coach-radial-track" cx="60" cy="60" r={radius} fill="none" strokeWidth="10" />
        <circle className={`coach-radial-value ${tone}`} cx="60" cy="60" r={radius} fill="none" strokeWidth="10" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 60 60)" />
      </svg>
      <div className="coach-radial-center"><strong>{Math.round(clamped)}%</strong><span>{tone === 'green' ? 'great pace' : tone === 'amber' ? 'keep going' : 'needs a push'}</span></div>
    </div>
  )
}

export function LockedFeatureNote({ feature, planName, onUpgrade }: { feature: string; planName: string; onUpgrade: () => void }) {
  return (
    <div className="coach-locked-note">
      <LockKeyhole size={13} />
      <span><strong>{feature}</strong> is available on {planName}.</span>
      <button className="text-button" onClick={onUpgrade}>Upgrade Plan</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. 30-day progress dashboard
// ---------------------------------------------------------------------------

function ProgressDashboard({ summary, plan, onNavigate, onNavigateBilling }: { summary: CoachProgressSummary | null; plan: CoachPlan; onNavigate: () => void; onNavigateBilling: () => void }) {
  const historyDays = COACH_LIMITS[plan].progressHistoryDays as number
  if (!summary) return <CoachSkeletonRow />
  const { revenue, orders, aov, customers, revenueTrendPct, series, comparisonSeries } = summary
  if (series.length === 0) {
    return (
      <section className="coach-card coach-progress-dashboard">
        <div className="coach-section-head">
          <CoachCardHeading kicker={`30-DAY PROGRESS · ${historyDays} DAYS OF HISTORY ON ${PLAN_LABEL[plan].toUpperCase()}`} dot="blue" title="How your store is moving" />
          <button className="text-button" onClick={onNavigate}>Open progress view <ChevronRight size={14} /></button>
        </div>
        <CoachEmptyState icon={BarChart3} title="No trend to chart yet" description="The progress dashboard draws only from synced daily revenue and order rows. Sync orders to start seeing your real 30-day trend — the chart never shows placeholder data." action="Go to progress view" onAction={onNavigate} />
      </section>
    )
  }
  return (
    <section className="coach-card coach-progress-dashboard">
      <div className="coach-section-head">
        <CoachCardHeading kicker={`30-DAY PROGRESS · ${historyDays} DAYS OF HISTORY ON ${PLAN_LABEL[plan].toUpperCase()}`} dot="blue" title="How your store is moving" />
        <button className="text-button" onClick={onNavigate}>Open progress view <ChevronRight size={14} /></button>
      </div>
      <div className="coach-metric-grid">
        <BigNumberCard label="Revenue" value={formatMoney(revenue)} trendPct={revenueTrendPct} series={series.map((row) => row.revenue)} icon={TrendingUp} />
        <BigNumberCard label="Orders" value={formatNumber(orders)} trendPct={null} series={series.map((row) => row.orders)} icon={Zap} />
        <BigNumberCard label="AOV" value={formatMoney(aov)} trendPct={null} series={series.map((row) => (row.orders > 0 ? row.revenue / row.orders : 0))} icon={Target} />
        <BigNumberCard label="Customers" value={formatNumber(customers)} trendPct={null} series={[]} icon={Users} />
      </div>
      <div className="coach-area-chart">
        <div className="coach-chart-legend"><span className="legend-dot current" />Last 30 days<History size={12} />{comparisonSeries.length > 0 && <><span className="legend-dot previous" />Previous 30 days</>}</div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="coachRevenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--coach-chart-fill-top)" stopOpacity={0.55} />
                <stop offset="100%" stopColor="var(--coach-chart-fill-top)" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--coach-chart-grid)" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--coach-chart-text)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} tickFormatter={(value: string) => value.slice(5)} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--coach-chart-text)' }} tickLine={false} axisLine={false} width={46} tickFormatter={(value: number) => value >= 1000 ? `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `$${value}`} />
            <Tooltip content={<CoachChartTooltip />} />
            {comparisonSeries.length > 0 && <ReferenceLine y={averageOf(comparisonSeries)} stroke="var(--coach-chart-comparison)" strokeDasharray="4 4" />}
            <Area type="monotone" dataKey="revenue" stroke="var(--coach-chart-stroke)" strokeWidth={2} fill="url(#coachRevenueFill)" animationDuration={700} />
          </AreaChart>
        </ResponsiveContainer>
        {comparisonSeries.length > 0 && <p className="coach-chart-note">The dashed line is the previous period’s daily average — a real comparison, not a target.</p>}
        {historyDays < 90 && plan !== 'commander' && <LockedFeatureNote feature="90 days of progress history" planName={plan === 'trial' ? 'Start' : 'Growth'} onUpgrade={onNavigateBilling} />}
      </div>
    </section>
  )
}

function averageOf(series: readonly Readonly<{ revenue: number }>[]): number {
  if (series.length === 0) return 0
  return series.reduce((sum, row) => sum + row.revenue, 0) / series.length
}

export function BigNumberCard({ label, value, trendPct, series, icon: Icon }: { label: string; value: string; trendPct: number | null; series: readonly number[]; icon: LucideIcon }) {
  return (
    <div className="coach-big-number">
      <div className="coach-big-number-top"><span className="coach-big-number-icon"><Icon size={15} /></span><span>{label}</span></div>
      <strong>{value}</strong>
      <div className="coach-big-number-bottom">
        {trendPct !== null ? (
          <span className={`coach-trend ${trendPct >= 0 ? 'up' : 'down'}`}>{trendPct >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(trendPct).toFixed(1)}% vs previous half</span>
        ) : <span className="coach-trend neutral">real synced data</span>}
        {series.length > 1 && <Sparkline values={series} />}
      </div>
    </div>
  )
}

/** Inline mini-chart for metric cards. */
export function Sparkline({ values, width = 96, height = 28 }: { values: readonly number[]; width?: number; height?: number }) {
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * width},${height - 3 - ((value - min) / span) * (height - 6)}`).join(' ')
  return (
    <svg className="coach-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--coach-chart-stroke)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function CoachChartTooltip({ active, payload, label }: { active?: boolean; payload?: readonly Readonly<{ value?: number | string }>[]; label?: string | number }) {
  if (!active || !payload || payload.length === 0) return null
  return <div className="coach-chart-tooltip"><strong>{label}</strong>{payload.map((entry, index) => <span key={index}>${typeof entry.value === 'number' ? entry.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(entry.value ?? '')}</span>)}</div>
}

// ---------------------------------------------------------------------------
// 5. Activity heatmap (FIX 6 — real rhythm, derived patterns)
// ---------------------------------------------------------------------------

function HeatmapSection({ heatmap, onNavigate }: { heatmap: CoachHeatmapView | null; onNavigate: () => void }) {
  if (!heatmap) return <CoachSkeletonRow />
  const { cells, bestDay, busiestWeek } = heatmap
  const patterns = useMemo(() => heatmapPatterns(cells), [cells])
  const bestWeekdayName = patterns.bestWeekday !== null ? WEEKDAY_LABELS_SHORT[patterns.bestWeekday] : null
  return (
    <section className="coach-card coach-heatmap-section">
      <div className="coach-section-head">
        <CoachCardHeading kicker="ACTIVITY PATTERN · LAST 12 WEEKS" dot="green" title="Your store's weekly rhythm" />
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
        <CoachCardHeading kicker={`ACHIEVEMENTS · ${achievements.length} OF ${visibleCap} ON YOUR PLAN`} dot="gold" title="Your achievements" />
        <button className="text-button" onClick={onNavigate}>View all badges <ChevronRight size={14} /></button>
      </div>
      <div className="coach-streak-strip">
        <span className="coach-streak-flame"><Flame size={16} /></span>
        <div className="coach-streak-copy">
          <strong>{streakDays}-day streak</strong>
          {milestone ? (
            <>
              <div className="coach-progress-track slim"><span style={{ width: `${milestone.progressPct}%` }} /></div>
              <small>{streakDays} / {milestone.target} days to the next streak badge — {streak?.todayViewed ? 'today is logged, nice work.' : 'view today’s huddle to keep it alive.'}</small>
            </>
          ) : (
            <small>Every streak milestone is earned — longest: {streak?.longestStreak ?? 0} days.</small>
          )}
        </div>
        {!streak?.todayViewed && <button className="button secondary coach-streak-cta" onClick={onViewHuddle}>Keep it alive</button>}
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
      <div className="coach-badge-progress">
        <span>{achievements.length} of {visibleCap} badges visible on your plan earned</span>
        <div className="coach-progress-track"><span style={{ width: `${Math.min(achievements.length / Math.max(visibleCap, 1) * 100, 100)}%` }} /></div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 7. Ask your coach (chat panel)
// ---------------------------------------------------------------------------

function AskCoachSection({ context, plan, onToast, onNavigateBilling }: { context: WorkspaceContext; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void }) {
  if (!context.storeId) return null
  return (
    <section className="coach-card coach-ask-section">
      <div className="coach-section-head">
        <CoachCardHeading kicker="ASK YOUR COACH" dot="purple" title="A real conversation about your store" />
        <span className="coach-ground-note"><Sparkles size={12} /> Responses are checked against your store numbers before they reach you.</span>
      </div>
      <CoachChatPanel storeId={context.storeId} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} compact />
    </section>
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

function WeeklyReviewCard({ storeId, review, plan, onToast, onNavigateBilling, onSetGoal }: { storeId: string; review: CoachReviewView; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void; onSetGoal: () => void }) {
  const content = review.content
  const wins = asStringArray(content.weekWins).slice(0, 4)
  const metrics = asReviewMetrics(content.metrics).slice(0, 4)
  const learnings = asStringArray(content.learnings).slice(0, 3)
  const focus = asStringArray(content.nextWeekFocus).slice(0, 3)
  const suggestedGoal = typeof content.suggestedGoal === 'object' && content.suggestedGoal !== null ? content.suggestedGoal as Readonly<Record<string, unknown>> : null
  const emailReview = () => {
    void import('./api.js').then(({ emailCoachReview }) => emailCoachReview(storeId, review.id)).then(() => onToast('Weekly review emailed to your verified merchant address.', 'success')).catch((error: unknown) => onToast(errorMessage(error), 'error'))
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
            {metrics.map((metric, index) => (
              <div className="coach-review-metric" key={index}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                {metric.change && <small className={/^\+|↑|up|higher|growth/i.test(metric.change) ? 'positive' : /^-|↓|down|lower|drop/i.test(metric.change) ? 'negative' : ''}>{metric.change}</small>}
              </div>
            ))}
          </div>
        </div>
      )}
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
      {suggestedGoal && (
        <div className="coach-review-goal">
          <div className="coach-review-block-label"><Sparkles size={13} /> Suggested goal for next week</div>
          <strong>{String(suggestedGoal.title ?? 'New weekly goal')}</strong>
          <p>{String(suggestedGoal.description ?? '')}</p>
          <button className="button secondary" onClick={onSetGoal}>Set this goal <ChevronRight size={14} /></button>
        </div>
      )}
      <div className="coach-review-actions">
        <button className="button secondary" onClick={emailReview}><Mail size={14} /> Email me this review</button>
        {plan === 'commander' ? (
          <button className="button secondary" onClick={downloadPdf}><ArrowUpRight size={14} /> Download PDF report</button>
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
  return (
    <section className={`coach-card coach-plan-card ${plan}`}>
      <div className="coach-plan-head">
        <span className="coach-plan-gem"><Gem size={17} /></span>
        <div>
          <div className="section-kicker"><span className="kicker-dot purple" />YOUR PLAN</div>
          <h3>{PLAN_LABEL[plan]}{plan === 'commander' ? ' — every coaching feature' : ''}</h3>
          <p>Exactly what your Store Coach includes today. No mystery tiers, no hidden limits.</p>
        </div>
        {plan !== 'commander' && <button className="button primary coach-plan-upgrade" onClick={onNavigateBilling}><ArrowUpRight size={14} /> Upgrade Plan</button>}
      </div>
      <ul className="coach-plan-included">
        {summary.included.map((feature) => <li key={feature}><Check size={14} />{feature}</li>)}
      </ul>
      {summary.upgradeTeaser && summary.upgradeTeaser.length > 0 && (
        <div className="coach-plan-teaser">
          <strong>Higher plans add</strong>
          <div className="coach-plan-teaser-items">
            {summary.upgradeTeaser.map((feature) => <span key={feature}><Sparkles size={12} />{feature}</span>)}
          </div>
          <button className="button secondary" onClick={onNavigateBilling}><ArrowUpRight size={14} /> Upgrade Plan</button>
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
  useEffect(() => {
    if (!storeId) return
    setLoadState('loading')
    void Promise.allSettled([fetchCoachProgressSummary(storeId, 30), fetchCoachActivityHeatmap(storeId), import('./api.js').then(({ fetchCoachProgressComparisons }) => fetchCoachProgressComparisons(storeId))]).then(([summaryResult, heatmapResult, comparisonsResult]) => {
      setSummary(summaryResult.status === 'fulfilled' ? summaryResult.value : null)
      setHeatmap(heatmapResult.status === 'fulfilled' ? heatmapResult.value : null)
      setComparisons(comparisonsResult.status === 'fulfilled' ? comparisonsResult.value : null)
      setLoadState('ready')
    }).catch(() => setLoadState('error'))
  }, [storeId])
  if (loadState === 'loading') return <div className="coach-subview"><CoachSubHeader eyebrow="Store Coach" title="Progress" description="Real 30-day trends from synced store rows." onBack={() => undefined} /><CoachSkeletonMain /></div>
  return (
    <div className="coach-subview">
      <CoachSubHeader eyebrow="Store Coach" title="Progress" description="Real 30-day trends, comparisons, and your weekly activity pattern." onBack={onBackNavigate(plan)} />
      {summary ? <ProgressDashboard summary={summary} plan={plan} onNavigate={() => undefined} onNavigateBilling={onNavigateBilling} /> : <CoachErrorState error="Progress data could not be loaded." onRetry={() => undefined} onNavigateBilling={onNavigateBilling} />}
      {comparisons && <ComparisonsSection comparisons={comparisons} />}
      <HeatmapSection heatmap={heatmap} onNavigate={() => undefined} />
      <WeeklyPatternBars storeId={storeId} onToast={onToast} />
    </div>
  )
}

function onBackNavigate(_plan: CoachPlan): () => void {
  return () => { window.history.back() }
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

/** Stacked weekly bars: orders by weekday, split current vs previous period. */
function WeeklyPatternBars({ storeId, onToast }: { storeId: string | null; onToast: CoachToast }) {
  const [series, setSeries] = useState<readonly Readonly<{ day: string; value: number }>[]>([])
  const [previous, setPrevious] = useState<readonly Readonly<{ day: string; revenue: number }>[]>([])
  useEffect(() => {
    if (!storeId) return
    void fetchCoachProgressTrends(storeId, 'orders', 30).then((result) => setSeries(result.series as readonly Readonly<{ day: string; value: number }>[])).catch(() => undefined)
    void fetchCoachProgressSummary(storeId, 30).then((result) => setPrevious(result.comparisonSeries)).catch(() => undefined)
  }, [storeId])
  if (series.length === 0) return null
  const weekday = (day: string): string => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${day}T00:00:00Z`).getUTCDay()] ?? '?'
  const data = series.map((row) => ({ weekday: weekday(row.day), orders: row.value }))
  return (
    <section className="coach-card">
      <CoachCardHeading kicker="STACKED BARS · ORDERS BY WEEKDAY" dot="green" title="Weekly order rhythm" />
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--coach-chart-grid)" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="weekday" tick={{ fontSize: 11, fill: 'var(--coach-chart-text)' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--coach-chart-text)' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
          <Tooltip content={<CoachChartTooltip />} />
          <Bar dataKey="orders" stackId="orders" fill="var(--coach-chart-stroke)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="coach-chart-note">Bars are real synced orders by weekday over your history window.{previous.length > 0 ? ' The previous period overlays as the dashed line on the revenue chart above.' : ''}</p>
      <button className="text-button" onClick={() => onToast('Charts are drawn from synced analytics rows only.', 'info')}><Sparkles size={12} /> How this is computed</button>
    </section>
  )
}

export function CoachChatView({ context, plan, onToast, onNavigateBilling }: { context: WorkspaceContext; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void }) {
  if (!context.storeId) return null
  return (
    <div className="coach-subview">
      <CoachSubHeader eyebrow="Store Coach" title="Chat" description="Ask anything about your store. Answers are checked against your real numbers." onBack={() => window.history.back()} />
      <CoachChatPanel storeId={context.storeId} plan={plan} onToast={onToast} onNavigateBilling={onNavigateBilling} />
    </div>
  )
}

export function CoachAchievementsView({ context, achievements, plan, onToast, onNavigateBilling }: { context: WorkspaceContext; achievements: readonly CoachAchievement[]; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void }) {
  const [catalog, setCatalog] = useState<readonly import('./store-coach-model.js').CoachBadgeCatalogEntry[] | null>(null)
  const [streak, setStreak] = useState<CoachStreakView | null>(null)
  const storeId = context.storeId
  useEffect(() => {
    if (!storeId) return
    void Promise.allSettled([import('./api.js').then(({ fetchCoachAvailableAchievements }) => fetchCoachAvailableAchievements(storeId)), fetchCoachStreak(storeId)]).then(([catalogResult, streakResult]) => {
      setCatalog(catalogResult.status === 'fulfilled' ? catalogResult.value.catalog : null)
      setStreak(streakResult.status === 'fulfilled' ? streakResult.value : null)
    })
  }, [storeId])
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
        {catalog === null ? <CoachSkeletonRow /> : (
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
      <CoachSubHeader eyebrow="Store Coach" title="Preferences" description="Tune the Coach’s personality, huddle time, notifications, voice, widget, and language." onBack={() => window.history.back()} />
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
          <CoachCardHeading kicker="VOICE · WIDGET · LANGUAGE" dot="purple" title="Extras" />
          <CoachSettingRow label="Voice coaching" description="Listen to huddles and chat replies">
            {plan === 'growth' || plan === 'commander' ? <Toggle value={preferences?.voiceEnabled ?? false} onChange={(value) => save({ voiceEnabled: value })} disabled={saving} /> : <LockedFeatureNote feature="Voice coaching" planName="Growth" onUpgrade={onNavigateBilling} />}
          </CoachSettingRow>
          <CoachSettingRow label="Coach widget" description="Floating coach on every page">
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

function ComingSoonSection({ title, icon: Icon, description }: { title: string; icon: LucideIcon; description: string }) {
  return (
    <div className="coach-coming-soon">
      <span className="coach-coming-soon-icon"><Icon size={26} /></span>
      <div className="section-kicker"><span className="kicker-dot purple" />AI GROWTH COMMAND</div>
      <h2>{title} is coming soon</h2>
      <p>{description}</p>
      <div className="coach-coming-soon-features">
        {['Built on the same real store data', 'No demo numbers, ever', 'Plan-aware from day one'].map((feature) => <span key={feature}><Check size={14} />{feature}</span>)}
      </div>
      <span className="coming-soon-pill large">Coming Soon</span>
    </div>
  )
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
