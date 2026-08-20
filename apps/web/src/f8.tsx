import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Download, LoaderCircle, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { askCopilot, exportCopilotThread, fetchBilling, fetchCopilotMessages, fetchCopilotThreads, fetchJarvisBriefing, fetchJarvisPreferences, invokeJarvisStoreAction, setJarvisState, startJarvisSession, sendJarvisMessage } from './api.js'
import { reduceJarvisSession } from './f8-model.js'
import type { CopilotAnswer, CopilotThread, JarvisPreference, JarvisResponse, JarvisSession } from './f8-model.js'
import { microphonePreflight, speechRecognitionAvailable, standaloneAppUrl } from './voice.js'
import { JarvisOrb } from './JarvisOrb.js'
import type { JarvisOrbState } from './JarvisOrb.js'
import { JarvisVoiceBar, orbStateFor, statusLabel } from './JarvisVoiceBar.js'
import { jarvisVoiceController, useJarvisVoiceSnapshot } from './jarvis-voice.js'
import { speechSynthesisAvailable } from './jarvis-speech.js'
import type { WorkspaceContext } from './model.js'

/**
 * Jarvis — the voice layer of ProfitPilot.
 *
 * There is no chat window here on purpose: typing lives in AI Command. Tapping
 * the orb opens a small draggable bar with a microphone, a pause control, and a
 * close control; everything Jarvis says is spoken out loud and nothing is
 * transcribed on screen.
 *
 * Behaviour contract:
 *  - Page aware. Opening a page gives one short spoken briefing about THAT
 *    page, at most once per page per session and never more than once a
 *    minute, so it helps without nagging.
 *  - Plan aware. Trial/Start/Growth get insight and suggestions; Commander can
 *    also have Jarvis act (create an automation, generate a report, approve a
 *    recommendation) after the merchant confirms out loud.
 *  - Store only. Off-topic questions are refused server-side before the model
 *    is called.
 */

type JarvisExperienceProps = Readonly<{
  open: boolean
  context: WorkspaceContext
  page: string
  onOpen: () => void
  onClose: () => void
  onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void
  /** Lets Jarvis take the merchant to another workspace page on request. */
  onNavigate?: (page: string) => void
  onPreferenceChange?: (preference: JarvisPreference) => void
}>

type PendingAction = Readonly<{ actionId: string; parameters: Readonly<Record<string, string | number | boolean | null>> }>

/** Minimum gap between two unprompted spoken briefings. */
export const BRIEFING_COOLDOWN_MS = 60_000
/** Settle time after a navigation before Jarvis speaks about the new page. */
const BRIEFING_DELAY_MS = 1_400

export function JarvisExperience({ open, context, page, onOpen, onClose, onToast, onNavigate, onPreferenceChange }: JarvisExperienceProps) {
  const [session, setSession] = useState<JarvisSession | null>(null)
  const [lifecycle, dispatchLifecycle] = useReducer(reduceJarvisSession, { status: 'starting', error: null })
  const [startAttempt, setStartAttempt] = useState(0)
  const [preference, setPreference] = useState<JarvisPreference | null>(null)
  const voice = useJarvisVoiceSnapshot()

  // Voice callbacks are registered once per session, so live values are read
  // through refs instead of stale closures.
  const sessionRef = useRef<JarvisSession | null>(null)
  const pageRef = useRef(page)
  const preferenceRef = useRef<JarvisPreference | null>(null)
  const pendingActionRef = useRef<PendingAction | null>(null)
  const briefedPages = useRef(new Set<string>())
  const lastBriefingAt = useRef(0)
  const busy = useRef(false)
  const standaloneUrl = useMemo(() => typeof window === 'undefined' ? '/' : standaloneAppUrl(window.location), [])

  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { pageRef.current = page }, [page])
  useEffect(() => { preferenceRef.current = preference }, [preference])

  const speak = useCallback((text: string, language: 'en' | 'hi' = 'en') => {
    const spoken = text.trim()
    if (!spoken) return
    jarvisVoiceController.speak({ text: spoken, language })
  }, [])

  /** Starts (or restores) the secure Jarvis session for this store. */
  useEffect(() => {
    if (!open || !context.storeId) return
    let cancelled = false
    const storeId = context.storeId
    setSession(null)
    dispatchLifecycle({ type: 'start' })
    void fetchBilling(storeId).catch(() => null).then((account) => {
      const rawPlan = account?.subscription?.plan?.toLowerCase()
      const plan: JarvisSession['plan'] = rawPlan === 'commander' ? 'commander' : rawPlan === 'growth' ? 'growth' : rawPlan === 'start' ? 'start' : 'trial'
      return Promise.all([startJarvisSession(storeId, pageRef.current, plan), fetchJarvisPreferences(storeId)])
    }).then(([started, preferences]) => {
      if (cancelled) return
      setSession(started)
      sessionRef.current = started
      setPreference(preferences)
      preferenceRef.current = preferences
      onPreferenceChange?.(preferences)
      jarvisVoiceController.setLanguage(preferences.language === 'hi' ? 'hi' : 'en')
      dispatchLifecycle({ type: 'ready' })
    }).catch((error: unknown) => {
      if (cancelled) return
      const message = error instanceof Error ? error.message : 'Jarvis could not start.'
      dispatchLifecycle({ type: 'failed', message })
      onToast(message, 'error')
    })
    return () => { cancelled = true }
    // onToast/onPreferenceChange are stable callbacks from the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context.storeId, startAttempt])

  /** One voice turn: merchant speaks, Jarvis answers (and may act). */
  const handleTranscript = useCallback(async (transcript: string) => {
    const active = sessionRef.current
    const storeId = context.storeId
    const spokenLanguage: 'en' | 'hi' = detectSpokenLanguage(transcript, preferenceRef.current?.language ?? 'auto')
    if (!active || !storeId) { speak('Give me a moment — I am still connecting to your store.', spokenLanguage); return }
    if (busy.current) return
    busy.current = true

    const pending = pendingActionRef.current
    try {
      if (pending && isCancellation(transcript)) {
        pendingActionRef.current = null
        speak(spokenLanguage === 'hi' ? 'Theek hai, maine wo nahi kiya.' : "Alright, I've left it.", spokenLanguage)
        return
      }
      if (pending && isConfirmation(transcript)) {
        const result = await invokeJarvisStoreAction(storeId, active.id, pending.actionId, pending.parameters, true)
        pendingActionRef.current = result.status === 'ACTION_PENDING' || result.status === 'CLARIFY' ? pending : null
        setSession(result.session)
        speak(result.text, result.language)
        return
      }

      jarvisVoiceController.setProcessing()
      const response = await sendJarvisMessage(storeId, active.id, transcript, pageRef.current, true)
      setSession(response.session)
      await deliver(response, storeId, spokenLanguage)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Something went wrong.'
      onToast(message, 'error')
      speak(spokenLanguage === 'hi' ? 'Maaf kijiye, abhi jawab nahi mil paya. Ek baar phir poochhiye.' : "Sorry, I couldn't get that answer just now. Please ask me again.", spokenLanguage)
    } finally {
      busy.current = false
    }

    /** Speaks a reply and runs whatever the model proposed alongside it. */
    async function deliver(response: JarvisResponse, storeIdValue: string, fallbackLanguage: 'en' | 'hi'): Promise<void> {
      const language = response.language ?? fallbackLanguage
      const proposed = extractProposedAction(response.text)
      if (!proposed) { speak(response.text, language); return }

      // Navigation never touches store data, so the browser just does it.
      if (proposed.actionId === 'navigate_page') {
        const target = resolveNavigationTarget(String(proposed.parameters.page ?? ''))
        if (!target) { speak(proposed.cleanText || (language === 'hi' ? 'Wo page mujhe nahi mila.' : "I couldn't find that page."), language); return }
        onNavigate?.(target)
        briefedPages.current.add(target)
        lastBriefingAt.current = Date.now()
        speak(proposed.cleanText || (language === 'hi' ? `${pageTitle(target)} page khol raha hoon.` : `Opening ${pageTitle(target)}.`), language)
        return
      }

      const acknowledgement = await invokeJarvisStoreAction(storeIdValue, sessionRef.current?.id ?? '', proposed.actionId, proposed.parameters, false)
      setSession(acknowledgement.session)
      // ACTION_PENDING = waiting for a spoken "confirm"; CLARIFY = Jarvis asked
      // for a missing detail and will retry once the merchant answers.
      pendingActionRef.current = acknowledgement.status === 'ACTION_PENDING' ? proposed : null
      speak(joinSpoken(proposed.cleanText, acknowledgement.text), acknowledgement.language ?? language)
    }
  }, [context.storeId, onNavigate, onToast, speak])

  const beginVoice = useCallback(() => {
    if (typeof window === 'undefined') return
    const preflight = microphonePreflight(window, document, navigator)
    jarvisVoiceController.setBlock(preflight.code === 'ready' ? null : preflight.code, preflight.framed)
    const canListen = preflight.allowed && speechRecognitionAvailable(window)
    if (!preflight.allowed) onToast(preflight.framed ? 'Microphone is blocked inside Shopify admin. Open ProfitPilot in a new tab to talk to Jarvis.' : preflight.message ?? 'Microphone is unavailable here.', 'warning')
    else if (!canListen) onToast('This browser cannot listen. Jarvis will still speak; use Chrome or Edge to talk back.', 'info')
    if (!speechSynthesisAvailable(window)) onToast('This browser has no speech output, so Jarvis cannot talk here.', 'warning')
    jarvisVoiceController.start({
      language: preferenceRef.current?.language === 'hi' ? 'hi' : 'en',
      listen: canListen,
      onTranscript: (transcript) => { void handleTranscript(transcript) },
      onError: (message) => onToast(message, 'warning'),
    })
  }, [handleTranscript, onToast])

  /** Opening the orb starts the voice session inside the click gesture. */
  const openJarvis = useCallback(() => {
    onOpen()
    if (!jarvisVoiceController.active) beginVoice()
  }, [beginVoice, onOpen])

  const closeJarvis = useCallback(() => {
    pendingActionRef.current = null
    briefedPages.current.clear()
    jarvisVoiceController.stop()
    const active = sessionRef.current
    if (context.storeId && active) void setJarvisState(context.storeId, active.id, 'end').catch(() => undefined)
    onClose()
  }, [context.storeId, onClose])

  const toggleMic = useCallback(() => {
    if (!jarvisVoiceController.active) { beginVoice(); return }
    jarvisVoiceController.setMicEnabled(!jarvisVoiceController.micEnabled)
  }, [beginVoice])

  const togglePause = useCallback(() => {
    const next = !jarvisVoiceController.paused
    jarvisVoiceController.setPaused(next)
    const active = sessionRef.current
    if (context.storeId && active) void setJarvisState(context.storeId, active.id, next ? 'pause' : 'resume').then(setSession).catch(() => undefined)
  }, [context.storeId])

  /**
   * Page-aware briefing. Deliberately conservative: once per page, once a
   * minute at most, never while paused, muted, mid-answer, or when the
   * merchant has asked Jarvis to only speak when spoken to.
   */
  useEffect(() => {
    if (!open || !context.storeId || lifecycle.status !== 'ready' || !session) return
    if (!voice.active || voice.paused || voice.muted) return
    if (voice.status === 'processing' || voice.status === 'speaking') return
    if (!briefingAllowed(preference, Date.now())) return
    if (briefedPages.current.has(page)) return
    if (Date.now() - lastBriefingAt.current < BRIEFING_COOLDOWN_MS) return
    const storeId = context.storeId
    const plan = session.plan
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled || busy.current || jarvisVoiceController.paused) return
      briefedPages.current.add(page)
      lastBriefingAt.current = Date.now()
      void fetchJarvisBriefing(storeId, page, plan)
        .then((briefing) => { if (!cancelled && briefing.text.trim() && briefing.status !== 'SUPPRESSED') speak(briefing.text, briefing.language) })
        .catch(() => undefined)
    }, BRIEFING_DELAY_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, context.storeId, lifecycle.status, session, page, preference, voice.active, voice.paused, voice.muted, voice.status, speak])

  /** Ending the session releases the microphone and the speech queue. */
  useEffect(() => () => { jarvisVoiceController.stop() }, [])

  const barStatus = voice.paused ? 'paused' : voice.status
  const orbState: JarvisOrbState = lifecycle.status === 'starting' && open ? 'activating' : lifecycle.status === 'failed' || lifecycle.status === 'error' ? 'warning' : orbStateFor(barStatus)
  const blocked = voice.block !== null
  const detail = voice.error ?? (blocked ? `${voiceBlockMessage(voice.block!)} — open ${standaloneUrl} in a new tab` : lifecycle.status === 'starting' ? 'Connecting to your store…' : 'Drag to move')

  if (!open) {
    return (
      <button className="jarvis-orb-wrap" onClick={openJarvis} aria-label="Open Jarvis voice assistant">
        <JarvisOrb state="idle" size={64} label="Open Jarvis" />
        <span className="jarvis-orb-label">Jarvis</span>
      </button>
    )
  }

  if (!context.storeId) {
    return (
      <button className="jarvis-orb-wrap" onClick={onOpen} aria-label="Connect Shopify before using Jarvis">
        <JarvisOrb state="warning" size={64} label="Connect Shopify for Jarvis" />
        <span className="jarvis-orb-label">Connect Shopify</span>
      </button>
    )
  }

  return (
    <JarvisVoiceBar
      visible
      status={barStatus}
      orbState={orbState}
      micEnabled={voice.micEnabled}
      paused={voice.paused}
      label={lifecycle.status === 'starting' ? 'Starting' : lifecycle.status === 'failed' || lifecycle.status === 'error' ? 'Reconnect' : statusLabel(barStatus, voice.micEnabled, voice.paused)}
      detail={detail}
      onToggleMic={lifecycle.status === 'failed' || lifecycle.status === 'error' ? () => setStartAttempt((attempt) => attempt + 1) : toggleMic}
      onTogglePause={togglePause}
      onClose={closeJarvis}
    />
  )
}

/** Proactive speech is a privilege, not a default: preferences decide. */
export function briefingAllowed(preference: JarvisPreference | null, now: number): boolean {
  if (!preference) return true
  if (preference.onlyAnswerWhenAsked) return false
  if (preference.engagementMode === 'quiet' || preference.engagementMode === 'answer-only') return false
  return preference.silenceUntil === null || preference.silenceUntil <= now
}

/** Merchants say "products page", "le chalo orders", "open my inventory". */
const NAVIGATION_TARGETS: Readonly<Record<string, string>> = {
  dashboard: 'dashboard', home: 'dashboard', overview: 'dashboard',
  products: 'products', product: 'products', catalog: 'products',
  inventory: 'inventory', stock: 'inventory',
  orders: 'orders', order: 'orders',
  customers: 'customers', customer: 'customers',
  analytics: 'analytics', reports: 'reports', report: 'reports',
  automation: 'automation', automations: 'automation', workflows: 'automation', workflow: 'automation',
  recommendations: 'recommendations', recommendation: 'recommendations',
  billing: 'billing', plans: 'billing', subscription: 'billing',
  settings: 'settings', support: 'support', help: 'support',
  'ai-command': 'ai-command', aicommand: 'ai-command', command: 'ai-command',
  exports: 'exports', export: 'exports',
}

export function resolveNavigationTarget(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s*page\s*$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!cleaned) return null
  return NAVIGATION_TARGETS[cleaned] ?? NAVIGATION_TARGETS[cleaned.replace(/-/g, '')] ?? null
}

function pageTitle(page: string): string { return page.replace(/-/g, ' ') }

/** Hindi/Hinglish is detected from what the merchant actually said. */
export function detectSpokenLanguage(text: string, preference: 'en' | 'hi' | 'auto'): 'en' | 'hi' {
  if (preference === 'hi') return 'hi'
  if (preference === 'en') return 'en'
  return /[\u0900-\u097F]/.test(text) || /\b(kya|mujhe|dikhao|bhej|bhejo|kaise|kitna|kitne|batao|karo|chahiye|nahi|haan)\b/i.test(text) ? 'hi' : 'en'
}

export function isConfirmation(text: string): boolean {
  return /\b(confirm|yes|yeah|yep|sure|ok|okay|go ahead|do it|please do|haan|han|ji|kar do|kardo|karo|theek hai|thik hai|bilkul)\b/i.test(text)
}

export function isCancellation(text: string): boolean {
  return /\b(no|nope|cancel|stop|don'?t|do not|forget it|nahi|nahin|mat karo|rehne do|chhodo)\b/i.test(text)
}

function joinSpoken(...parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' ')
}

/**
 * Extracts the structured `@jarvis:action {...}` line the model may append to a
 * reply. The line is never spoken — only the human sentence before it is.
 */
export function extractProposedAction(text: string): { cleanText: string; actionId: string; parameters: Readonly<Record<string, string | number | boolean | null>> } | null {
  const match = text.match(/@jarvis:action\s*(\{.*?\})\s*$/s)
  if (!match) return null
  let payload: unknown
  try { payload = JSON.parse(match[1] ?? '{}') } catch { return null }
  if (!payload || typeof payload !== 'object') return null
  const actionId = (payload as { actionId?: unknown }).actionId
  if (typeof actionId !== 'string') return null
  const rawParameters = (payload as { parameters?: unknown }).parameters
  const parameters = rawParameters && typeof rawParameters === 'object' && !Array.isArray(rawParameters)
    ? Object.fromEntries(Object.entries(rawParameters as Record<string, unknown>).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))) as Record<string, string | number | boolean | null>
    : {}
  return { cleanText: text.slice(0, match.index).trim(), actionId, parameters }
}

export function voiceBlockMessage(code: 'insecure' | 'embedded-policy' | 'policy-denied' | 'media-devices-unavailable'): string {
  if (code === 'embedded-policy') return 'Microphone is blocked in this embedded view'
  if (code === 'insecure') return 'Voice needs a secure HTTPS connection'
  if (code === 'policy-denied') return 'Microphone access is blocked by this page policy'
  return 'This browser does not expose a microphone'
}

type CopilotWorkspaceProps = Readonly<{ context: WorkspaceContext }>
export function CopilotWorkspace({ context }: CopilotWorkspaceProps) {
  const [threads, setThreads] = useState<readonly CopilotThread[]>([])
  const [threadId, setThreadId] = useState<string | undefined>()
  const [answers, setAnswers] = useState<readonly CopilotAnswer[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (context.storeId) void fetchCopilotThreads(context.storeId).then(setThreads).catch(() => setThreads([])) }, [context.storeId])
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!context.storeId || !query.trim()) return; setLoading(true); setError(null); try { const answer = await askCopilot(context.storeId, query, 'copilot', threadId); setThreadId(answer.threadId); setAnswers((current) => [...current, answer]); setQuery(''); setThreads(await fetchCopilotThreads(context.storeId)) } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : 'Copilot could not answer that question.') } finally { setLoading(false) } }
  const selectThread = async (id: string) => { if (!context.storeId) return; setThreadId(id); setAnswers(await fetchCopilotMessages(context.storeId, id)) }
  const exportThread = async () => { if (!context.storeId || !threadId) return; const file = await exportCopilotThread(context.storeId, threadId); downloadBase64(file.bodyBase64, file.filename, file.contentType) }
  return <div className="f8-copilot-layout"><section className="copilot-main card"><div className="copilot-welcome"><span className="copilot-orb"><Sparkles size={22} /></span><div><div className="section-kicker">CLOSED 10-INTENT GRAMMAR</div><h2>Ask a grounded question.</h2><p>Numbers are rendered from deterministic evidence slots. No open generation.</p></div></div><div className="f8-copilot-answers">{answers.length === 0 ? <div className="copilot-empty"><ShieldCheck size={24} /><strong>Ready for real store evidence</strong><span>Try “What is my revenue?” or “Which products have stockout risk?”</span></div> : answers.map((answer) => <article className="f8-answer" key={answer.id}><div className="f8-answer-head"><span className="status-badge blue">{answer.intent ?? 'ASK'}</span><span>{answer.evidence?.confidenceLevel ?? 'CLARIFY'} confidence</span></div><p>{answer.answer}</p>{answer.clarification && <small>{answer.clarification}</small>}{answer.evidence && <div className="f8-evidence-table">{answer.evidence.facts.map((fact) => <div key={fact.key}><span>{fact.label}</span><strong>{String(fact.value ?? '—')}</strong><small>{fact.source}</small></div>)}</div>}</article>)}</div>{error && <div className="form-error" role="alert">{error}</div>}<form className="copilot-composer f8-copilot-form" onSubmit={(event) => void submit(event)}><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Which products are at stockout risk?" rows={2} aria-label="Ask Copilot" spellCheck={false} autoCorrect="off" autoCapitalize="off" /><button className="send-button" type="submit" disabled={loading || !query.trim()} aria-label="Ask Copilot">{loading ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}</button></form><div className="suggested-prompts"><button onClick={() => setQuery('What changed in revenue?')}>Revenue change</button><button onClick={() => setQuery('Which products have stockout risk?')}>Stockout risk</button><button onClick={() => setQuery('Show store health')}>Store health</button></div></section><aside className="copilot-sidebar card"><div className="card-heading"><div><span className="section-kicker">SAVED THREADS</span><h3>Thread history</h3></div><button className="icon-button" onClick={() => void exportThread()} disabled={!threadId} aria-label="Export Copilot thread"><Download size={15} /></button></div>{threads.length === 0 ? <span className="muted-cell">No saved questions yet.</span> : threads.map((thread) => <button className={`f8-thread ${thread.id === threadId ? 'active' : ''}`} key={thread.id} onClick={() => void selectThread(thread.id)}>{thread.title}<small>{new Date(thread.updatedAt).toLocaleDateString()}</small></button>)}</aside></div>
}

export { ReportsWorkspace } from './reports.js'

function downloadBase64(base64: string, filename: string, contentType: string): void { const binary = atob(base64); const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: contentType })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }
