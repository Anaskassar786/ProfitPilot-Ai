import { useEffect, useState } from 'react'
import {
  Check,
  Clock3,
  Compass,
  Lightbulb,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import { completeCoachOnboardingStep, fetchCoachOnboarding, fetchCoachPreferences, skipCoachOnboarding } from './api.js'
import { COACH_LIMITS, PERSONALITY_META, PLAN_LABEL, coachPersonalitiesForPlan, huddleTimeLabel } from './store-coach-model.js'
import type { CoachPlan } from './store-coach-model.js'
import type { CoachToast } from './store-coach.js'

// ---------------------------------------------------------------------------
// Onboarding (5 steps) — retained, warm coach illustration, no voice/chat
// ---------------------------------------------------------------------------

export type CoachOnboardingState = Readonly<{ currentStep: number; completed: boolean; skipped: boolean; steps: readonly Readonly<{ step: number; title: string; done: boolean }>[] }>

const ONBOARDING_STEPS = [
  { step: 1, title: 'Meet Store Coach', description: 'Your personal AI business advisor. Every morning the Coach reads your real synced data and turns it into a short, honest briefing.' },
  { step: 2, title: 'Choose your personality', description: 'The Coach adapts its tone. Pick the voice that fits how you like to work.' },
  { step: 3, title: 'Set your huddle time', description: 'Your daily briefing arrives at a time that suits you — in your store’s own timezone.' },
  { step: 4, title: 'Set your first goal', description: 'Goals give the Coach a north star. AI suggestions are derived from your real trend.' },
  { step: 5, title: 'You’re ready', description: 'Daily briefings, priorities, and weekly goals — that’s your coach. For a longer conversation, AI Command is next door.' },
] as const

export function CoachOnboardingModal({ storeId, plan = 'trial', onClose, onToast }: { storeId: string; plan?: CoachPlan; onClose: () => void; onToast: CoachToast }) {
  const [state, setState] = useState<CoachOnboardingState | null>(null)
  const [personality, setPersonality] = useState<keyof typeof PERSONALITY_META>('PROFESSIONAL')
  const [huddleMinutes, setHuddleMinutes] = useState(420)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetchCoachOnboarding(storeId).then(setState).catch(() => setState({ currentStep: 0, completed: false, skipped: true, steps: [] }))
  }, [storeId])

  const step = state?.currentStep ?? 0
  const visibleStep = step < 0 ? 1 : Math.min(step + 1, 5)
  const current = ONBOARDING_STEPS[visibleStep - 1] ?? ONBOARDING_STEPS[0]!

  const advance = (extraStep = visibleStep) => {
    setBusy(true)
    const persist =
      visibleStep === 2 ? import('./api.js').then(({ updateCoachPreferences }) => updateCoachPreferences(storeId, { personality }))
        : visibleStep === 3 ? import('./api.js').then(({ updateCoachPreferences }) => updateCoachPreferences(storeId, { huddleTimeMinutes: huddleMinutes }))
          : Promise.resolve(null)
    void persist
      .then(() => completeCoachOnboardingStep(storeId, extraStep))
      .then((next) => setState((currentState) => currentState ? { ...currentState, currentStep: next.currentStep, completed: next.completed, skipped: next.skipped } : currentState))
      .catch((error: unknown) => onToast(errorMessage(error), 'error'))
      .finally(() => setBusy(false))
  }
  const finish = () => { advance(5); onClose() }
  const skip = () => {
    setBusy(true)
    void skipCoachOnboarding(storeId).then(() => onClose()).catch((error: unknown) => onToast(errorMessage(error), 'error')).finally(() => setBusy(false))
  }

  if (!state) {
    return <div className="modal-overlay"><div className="modal-card coach-onboarding-modal"><div className="coach-onboarding-loading"><Clock3 size={18} /><span>Preparing your tour…</span></div></div></div>
  }
  if (state.completed || state.skipped) return null

  return (
    <div className="modal-overlay">
      <div className="modal-card coach-onboarding-modal">
        <div className="coach-onboarding-head">
          <span className="coach-illustration" aria-hidden="true"><GrowthPathwayIcon size={26} /></span>
          <div>
            <div className="section-kicker"><span className="kicker-dot purple" />STORE COACH ONBOARDING</div>
            <h2>Meet Store Coach</h2>
            <p>Your AI business advisor — five steps, two minutes.</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="coach-onboarding-steps">
          {ONBOARDING_STEPS.map((entry) => (
            <span key={entry.step} className={`${entry.step === visibleStep ? 'active' : ''} ${entry.step < visibleStep ? 'done' : ''}`}>
              <i>{entry.step < visibleStep ? <Check size={11} /> : entry.step}</i>
              {entry.title}
            </span>
          ))}
        </div>
        <div className="coach-onboarding-body">
          <h3>{current.title}</h3>
          <p>{current.description}</p>
          {visibleStep === 1 && (
            <div className="coach-onboarding-preview">
              <span className="coach-message-avatar"><GrowthPathwayIcon size={14} /></span>
              <div className="coach-message-bubble"><p>Good morning. I’m your store growth coach. I’ll look at your recent sales and customers every day, and I only ever quote numbers that actually exist in your store.</p></div>
            </div>
          )}
          {visibleStep === 2 && (
            <div className="coach-personality-picker">
              {(Object.keys(PERSONALITY_META) as (keyof typeof PERSONALITY_META)[]).map((id) => {
                const allowed = coachPersonalitiesForPlan(plan).includes(id)
                return (
                  <button key={id} className={`${personality === id ? 'active' : ''}`} disabled={!allowed} onClick={() => setPersonality(id)}>
                    <strong>{PERSONALITY_META[id].label}{!allowed && <small className="coach-personality-locked"> · {PLAN_LABEL[id === 'MOTIVATIONAL' ? 'start' : 'growth']}+</small>}</strong>
                    <small>{PERSONALITY_META[id].tagline}</small>
                    <p>“{PERSONALITY_META[id].sample}”</p>
                  </button>
                )
              })}
            </div>
          )}
          {visibleStep === 3 && (
            <div className="coach-onboarding-time">
              <div className="coach-time-presets">
                {([[420, 'Morning', '7:00 AM — recommended'], [600, 'Late morning', '10:00 AM'], [840, 'Afternoon', '2:00 PM'], [1080, 'Evening', '6:00 PM']] as const).map(([minutes, label, detail]) => (
                  <button key={minutes} type="button" className={`coach-time-preset ${huddleMinutes === minutes ? 'active' : ''}`} onClick={() => setHuddleMinutes(minutes)}>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </button>
                ))}
              </div>
              <div className="coach-onboarding-time-row">
                <input type="time" value={minutesToTimeInput(huddleMinutes)} onChange={(event) => { const [hours, minutes] = event.target.value.split(':').map(Number); setHuddleMinutes((hours ?? 0) * 60 + (minutes ?? 0)) }} aria-label="Custom huddle time" />
                <p>Your briefing will be ready by {huddleTimeLabel(huddleMinutes)} every day, in your store’s timezone. (Custom times unlock on the Start plan; trial stores keep 7:00 AM.)</p>
              </div>
            </div>
          )}
          {visibleStep === 4 && (
            <div className="coach-onboarding-goal-preview">
              <span className="coach-feasibility high">high feasibility</span>
              <strong>Beat last week’s revenue</strong>
              <p>The Coach proposes this from your real trailing trend once your tour finishes. You can accept, adjust, or skip it.</p>
            </div>
          )}
          {visibleStep === 5 && (
            <div className="coach-onboarding-finish">
              <div className="coach-onboarding-checklist">
                <span><Check size={13} /> Daily briefings from your real data</span>
                <span><Check size={13} /> Top priorities, tracked automatically</span>
                <span><Check size={13} /> Goal tracking with honest pace projections</span>
              </div>
              <div className="coach-chat-try-label"><Lightbulb size={13} /> Try your first question in AI Command</div>
              <div className="coach-chat-suggestions">
                <button onClick={finish}>How did my store do yesterday?</button>
                <button onClick={finish}>What should I focus on today?</button>
                <button onClick={finish}>Suggest a goal for this week</button>
              </div>
            </div>
          )}
        </div>
        <div className="coach-onboarding-actions">
          <button className="text-button" onClick={skip} disabled={busy}>Skip the tour</button>
          <span className="coach-onboarding-progress">{Math.min(visibleStep, 5)} of 5</span>
          <div>
            {visibleStep > 1 && <button className="button secondary" onClick={() => advance(visibleStep - 1)} disabled={busy}>Back</button>}
            {visibleStep < 5 ? <button className="button primary" onClick={() => advance()} disabled={busy}>{visibleStep === 2 ? 'Save personality' : visibleStep === 3 ? 'Save time' : 'Continue'} <Sparkles size={13} /></button> : <button className="button primary" onClick={finish} disabled={busy}>Finish & explore <Send size={13} /></button>}
          </div>
        </div>
      </div>
    </div>
  )
}

function GrowthPathwayIcon({ size = 22 }: { size?: number }) {
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

function minutesToTimeInput(minutes: number): string {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0')
  const minute = String(minutes % 60).padStart(2, '0')
  return `${hour}:${minute}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'The API could not be reached.'
}
