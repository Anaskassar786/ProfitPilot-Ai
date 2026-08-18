import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  Lightbulb,
  LockKeyhole,
  MessageSquare,
  Mic,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { ApiClientError, clearCoachChat, completeCoachOnboardingStep, fetchCoachChatHistory, fetchCoachChatSuggestions, fetchCoachOnboarding, fetchCoachPreferences, skipCoachOnboarding, streamCoachChat } from './api.js'
import { COACH_LIMITS, PERSONALITY_META, PLAN_LABEL, coachPersonalitiesForPlan, huddleTimeLabel } from './store-coach-model.js'
import type { CoachMessage, CoachPersonality, CoachPlan, CoachUsageView } from './store-coach-model.js'
import type { CoachToast } from './store-coach.js'

// ---------------------------------------------------------------------------
// Chat panel (SSE streaming)
// ---------------------------------------------------------------------------

export function CoachChatPanel({ storeId, plan, onToast, onNavigateBilling, compact = false }: { storeId: string; plan: CoachPlan; onToast: CoachToast; onNavigateBilling: () => void; compact?: boolean }) {
  const [messages, setMessages] = useState<readonly CoachMessage[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<readonly string[]>([])
  const [usage, setUsage] = useState<CoachUsageView | null>(null)
  const [personality, setPersonality] = useState<CoachPersonality>('PROFESSIONAL')
  const [listening, setListening] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const chatLimit = COACH_LIMITS[plan].chatMessagesPerDay as number

  useEffect(() => {
    setHistoryLoaded(false)
    void Promise.allSettled([
      fetchCoachChatHistory(storeId),
      fetchCoachChatSuggestions(storeId),
      import('./api.js').then(({ fetchCoachUsage }) => fetchCoachUsage(storeId)),
      fetchCoachPreferences(storeId),
    ]).then(([history, suggested, usageResult, preferencesResult]) => {
      if (history.status === 'fulfilled') setMessages(history.value.messages)
      if (suggested.status === 'fulfilled') setSuggestions(suggested.value)
      if (usageResult.status === 'fulfilled') setUsage(usageResult.value)
      if (preferencesResult.status === 'fulfilled') setPersonality(preferencesResult.value.personality)
      setHistoryLoaded(true)
    })
  }, [storeId])

  useEffect(() => {
    const element = scrollRef.current
    if (element && typeof element.scrollTo === 'function') element.scrollTo({ top: element.scrollHeight })
    else if (element) element.scrollTop = element.scrollHeight
  }, [messages, streaming, busy])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    const used = usage?.chatMessagesToday ?? 0
    if (used >= chatLimit) {
      onToast(`You have used all ${chatLimit} chat messages for today.`, 'warning')
      onNavigateBilling()
      return
    }
    setInput('')
    setMessages((current) => [...current, { role: 'user', content: trimmed, timestamp: Date.now() }])
    setBusy(true)
    setStreaming('')
    try {
      const reply = await streamCoachChat(storeId, trimmed, (fullText) => setStreaming(fullText))
      setStreaming(null)
      setMessages((current) => [...current, reply])
      setUsage((current) => current ? { ...current, chatMessagesToday: current.chatMessagesToday + 1 } : current)
    } catch (error: unknown) {
      setStreaming(null)
      if (error instanceof ApiClientError && error.status === 402) {
        onToast(error.message, 'error')
        onNavigateBilling()
      } else {
        onToast(errorMessage(error), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    void clearCoachChat(storeId).then(() => { setMessages([]); onToast('Chat history cleared.', 'info') }).catch((error: unknown) => onToast(errorMessage(error), 'error'))
  }

  const startListening = () => {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => { start: () => void; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null } }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => { start: () => void; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null } }).webkitSpeechRecognition
    if (!SpeechRecognition) { onToast('Voice input is not supported in this browser.', 'info'); return }
    const recognition = new SpeechRecognition()
    recognition.onresult = (event) => { const transcript = event.results[0]?.[0]?.transcript ?? ''; if (transcript) setInput((current) => `${current} ${transcript}`.trim()) }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => { setListening(false); onToast('Voice input stopped.', 'info') }
    setListening(true)
    recognition.start()
  }

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) { onToast('Voice output is not supported in this browser.', 'info'); return }
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  }

  const voiceAvailable = plan === 'growth' || plan === 'commander'
  const remaining = Math.max(chatLimit - (usage?.chatMessagesToday ?? 0), 0)
  const atWarning = remaining > 0 && remaining / chatLimit <= 0.2

  return (
    <div className={`coach-chat-panel ${compact ? 'compact' : ''}`}>
      <div className="coach-chat-scroll" ref={scrollRef}>
        {!historyLoaded ? (
          <div className="coach-chat-skeleton"><span /><span /><span /></div>
        ) : messages.length === 0 && !streaming ? (
          <div className="coach-chat-empty">
            <div className="coach-chat-persona">
              <span className="coach-orb small"><Bot size={18} /></span>
              <div>
                <strong>Coach <span className="coach-chat-personality">{PERSONALITY_META[personality].label} mode</span></strong>
                <p>Hi! I’m here to help with anything about your store. I have access to your real synced data and every answer is checked against it before it reaches you — if a number isn’t there yet, I’ll say so and tell you what to sync.</p>
              </div>
            </div>
            <div className="coach-chat-try">
              <span className="coach-chat-try-label"><Lightbulb size={13} /> Try asking me</span>
              <div className="coach-chat-suggestions">
                {(suggestions.length > 0 ? suggestions.slice(0, 4) : ['How did my store do yesterday?', 'What should I focus on today?', 'What is my best selling product?', 'Suggest a goal for this week']).map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>“{suggestion}”</button>)}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <div className={`coach-message ${message.role}`} key={`${message.timestamp}-${index}`}>
                <span className="coach-message-avatar">{message.role === 'coach' ? <Bot size={14} /> : 'You'}</span>
                <div className="coach-message-bubble">
                  <p>{message.content}</p>
                  <div className="coach-message-meta">
                    <span>{new Date(message.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                    {message.role === 'coach' && voiceAvailable && <button onClick={() => speak(message.content)} aria-label="Read aloud"><Volume2 size={12} /></button>}
                    {message.role === 'coach' && message.confidence !== undefined && message.confidence !== null && <span className="coach-confidence">grounded · {Math.round(message.confidence * 100)}%</span>}
                  </div>
                </div>
              </div>
            ))}
            {streaming !== null && (
              <div className="coach-message coach">
                <span className="coach-message-avatar"><Bot size={14} /></span>
                <div className="coach-message-bubble">
                  <p>{streaming || <span className="coach-typing"><i /><i /><i /></span>}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {atWarning && (
        <div className="coach-rate-warning"><AlertTriangle size={13} /><span>Only {remaining} message{remaining === 1 ? '' : 's'} left today on {PLAN_LABEL[plan]}.</span><button className="text-button" onClick={onNavigateBilling}>Upgrade Plan</button></div>
      )}
      <div className="coach-chat-composer">
        {voiceAvailable && <button className={`icon-button ${listening ? 'listening' : ''}`} onClick={startListening} aria-label="Voice input"><Mic size={16} /></button>}
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(input) } }}
          placeholder={voiceAvailable ? 'Ask your coach, or press the mic to talk…' : 'Type your question about your store…'}
          rows={compact ? 2 : 3}
          disabled={busy}
        />
        <button className="button primary coach-send" disabled={busy || !input.trim()} onClick={() => void send(input)}><Send size={15} /> Send</button>
      </div>
      <div className="coach-chat-footer">
        <span className="coach-chat-plan">Your plan: {PLAN_LABEL[plan]} · {remaining} message{remaining === 1 ? '' : 's'} left today</span>
        <span className="coach-chat-hint">Shift+Enter for a new line · {voiceAvailable ? 'voice enabled' : 'voice on higher plans'}</span>
        {messages.length > 0 && <button className="text-button" onClick={clear}><Trash2 size={12} /> Clear history</button>}
      </div>
      {plan !== 'commander' && <LockedInlineFeature feature="Unlimited coach chat" planName="higher plans" onUpgrade={onNavigateBilling} />}
    </div>
  )
}

function LockedInlineFeature({ feature, planName, onUpgrade }: { feature: string; planName: string; onUpgrade: () => void }) {
  return (
    <div className="coach-locked-note">
      <LockKeyhole size={13} />
      <span><strong>{feature}</strong> is available on {planName}.</span>
      <button className="text-button" onClick={onUpgrade}>Upgrade Plan</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Onboarding (5 steps)
// ---------------------------------------------------------------------------

export type CoachOnboardingState = Readonly<{ currentStep: number; completed: boolean; skipped: boolean; steps: readonly Readonly<{ step: number; title: string; done: boolean }>[] }>

const ONBOARDING_STEPS = [
  { step: 1, title: 'Meet Store Coach', description: 'Your personal AI business advisor. Every morning the Coach reads your real synced data and turns it into a short, honest briefing.' },
  { step: 2, title: 'Choose your personality', description: 'The Coach adapts its tone. Pick the voice that fits how you like to work.' },
  { step: 3, title: 'Set your huddle time', description: 'Your daily briefing arrives at a time that suits you — in your store’s own timezone.' },
  { step: 4, title: 'Set your first goal', description: 'Goals give the Coach a north star. AI suggestions are derived from your real trend.' },
  { step: 5, title: 'Try chat', description: 'Ask anything about your store. Answers are checked against your actual numbers before they reach you.' },
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
    // Persist the choices made on the personality / huddle-time steps so the
    // tour changes real preferences instead of pretending to.
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
          <span className="coach-orb"><Bot size={22} /></span>
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
              <span className="coach-message-avatar"><Bot size={14} /></span>
              <div className="coach-message-bubble"><p>Good morning. I’m Store Coach. I read your synced orders and revenue every day, and I only ever quote numbers that actually exist in your data.</p></div>
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
              <div className="coach-chat-try-label"><Lightbulb size={13} /> Try your first question</div>
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
            {visibleStep < 5 ? <button className="button primary" onClick={() => advance()} disabled={busy}>{visibleStep === 2 ? 'Save personality' : visibleStep === 3 ? 'Save time' : 'Continue'} <Sparkles size={13} /></button> : <button className="button primary" onClick={finish} disabled={busy}>Finish & chat <Send size={13} /></button>}
          </div>
        </div>
      </div>
    </div>
  )
}

function minutesToTimeInput(minutes: number): string {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0')
  const minute = String(minutes % 60).padStart(2, '0')
  return `${hour}:${minute}`
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error) return error.message
  return 'The API could not be reached.'
}
