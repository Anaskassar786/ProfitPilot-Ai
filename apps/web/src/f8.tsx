import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Download, ExternalLink, FileBarChart, Headphones, LoaderCircle, Mic, Send, ShieldCheck, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import { askCopilot, confirmJarvisAction, downloadReport, exportCopilotThread, fetchBilling, fetchCopilotMessages, fetchCopilotThreads, fetchForecast, fetchJarvisBriefing, fetchJarvisMessages, fetchJarvisPreferences, fetchReports, generateReport, invokeJarvisStoreAction, saveJarvisPreferences, sendJarvisMessage, setJarvisState, startJarvisSession, streamJarvisMessage } from './api.js'
import { reduceJarvisSession } from './f8-model.js'
import type { CopilotAnswer, CopilotThread, ForecastBundle, JarvisAction, JarvisAddressing, JarvisEvidence, JarvisMessage, JarvisPreference, JarvisResponse, JarvisSession, JarvisSessionLifecycle, ReportRun } from './f8-model.js'
import { microphonePreflight, speechRecognitionAvailable, speechRecognitionFailure, standaloneAppUrl } from './voice.js'
import type { VoiceStatus } from './voice.js'
import { JarvisOrb } from './JarvisOrb.js'
import type { JarvisOrbState } from './JarvisOrb.js'
import { FloatingVoiceWidget } from './FloatingVoiceWidget.js'
import { jarvisVoiceController, resumeJarvisListening, useJarvisVoiceSnapshot } from './jarvis-voice.js'
import type { WorkspaceContext } from './model.js'

type JarvisExperienceProps = Readonly<{ open: boolean; context: WorkspaceContext; page: string; onOpen: () => void; onClose: () => void; onEvidence: (evidence?: JarvisEvidence | null) => void; onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void; onPreferenceChange?: (preference: JarvisPreference) => void }>
type TimelineEntry = Readonly<{ id: string; role: 'merchant' | 'jarvis'; text: string; language: 'en' | 'hi'; mode: JarvisMessage['mode']; evidence: JarvisEvidence | null; action: JarvisAction | null; status: JarvisResponse['status'] | null; createdAt: number; pending?: boolean }>

export function JarvisExperience({ open, context, page, onOpen, onClose, onEvidence, onToast, onPreferenceChange }: JarvisExperienceProps) {
  const [session, setSession] = useState<JarvisSession | null>(null)
  const [lifecycle, dispatchLifecycle] = useReducer(reduceJarvisSession, { status: 'starting', error: null })
  const [startAttempt, setStartAttempt] = useState(0)
  const [preference, setPreference] = useState<JarvisPreference | null>(null)
  const [timeline, setTimeline] = useState<readonly TimelineEntry[]>([])
  const [input, setInput] = useState('')
  const voice = useJarvisVoiceSnapshot()
  const voiceActive = voice.active
  const voiceStatus = voice.status === 'paused' ? 'sleeping' : voice.status
  const voiceError = voice.error
  const voiceFramed = voice.framed
  const voiceBlock = voice.block
  const muted = voice.muted
  const [paused, setPaused] = useState(false)
  const [pendingStoreAction, setPendingStoreAction] = useState<{ actionId: string; parameters: Readonly<Record<string, string | number | boolean | null>>; timelineId: string } | null>(null)
  const messageScroll = useRef<HTMLDivElement | null>(null)
  const standaloneUrl = useMemo(() => typeof window === 'undefined' ? '/' : standaloneAppUrl(window.location), [])

  useEffect(() => {
    if (!open || !context.storeId) return
    let cancelled = false
    const storeId = context.storeId
    setSession(null)
    setTimeline([])
    dispatchLifecycle({ type: 'start' })
    void fetchBilling(storeId).catch(() => null).then((account) => {
      const rawPlan = account?.subscription?.plan?.toLowerCase()
      const plan: JarvisSession['plan'] = rawPlan === 'commander' ? 'commander' : rawPlan === 'growth' ? 'growth' : rawPlan === 'start' ? 'start' : 'trial'
      const briefing = new Date().getHours() < 12 && (plan === 'growth' || plan === 'commander') ? fetchJarvisBriefing(storeId, page, plan) : Promise.resolve(null)
      return Promise.all([startJarvisSession(storeId, page, plan), fetchJarvisPreferences(storeId), briefing])
    }).then(async ([started, preferences, morning]) => {
      const active = morning?.session ?? started
      const persisted = await fetchJarvisMessages(storeId, active.id).catch(() => [] as readonly JarvisMessage[])
      if (!cancelled) {
        setSession(active)
        setPreference(preferences)
        onPreferenceChange?.(preferences)
        setTimeline(persisted.map(timelineFromPersisted))
        dispatchLifecycle({ type: 'ready' })
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : 'Jarvis could not start.'
        dispatchLifecycle({ type: 'failed', message })
        onToast(message, 'error')
      }
    })
    return () => { cancelled = true }
  }, [open, context.storeId, page, startAttempt])

  useEffect(() => { if (open && session) setSession((current) => current ? { ...current, lastPage: page } : current) }, [open, page, session?.id])
  useEffect(() => { messageScroll.current?.scrollTo({ top: messageScroll.current.scrollHeight, behavior: 'smooth' }) }, [timeline.length, voiceActive])

  const send = async (text = input, fromVoice = false) => {
    if (lifecycle.status !== 'ready') {
      onToast(lifecycle.status === 'starting' ? 'Jarvis is starting… Please wait until the session is ready.' : 'Jarvis is not ready. Use Retry to restore the session.', 'info')
      return
    }
    if (!context.storeId || !session || !text.trim()) return
    const cleanText = text.trim()
    const language = preference?.language === 'hi' || /[\u0900-\u097F]|\b(kya|mujhe|dikhao|bhej|aaj|kal)\b/i.test(cleanText) ? 'hi' : 'en'
    setInput('')
    setTimeline((current) => [...current, { id: `merchant-${Date.now()}-${current.length}`, role: 'merchant', text: cleanText, language, mode: 'ASK', evidence: null, action: null, status: null, createdAt: Date.now() }])
    if (fromVoice) jarvisVoiceController.setProcessing()
    const pendingId = `jarvis-${Date.now()}-pending`
    setTimeline((current) => [...current, { id: pendingId, role: 'jarvis', text: '', language, mode: 'ASK', evidence: null, action: null, status: null, createdAt: Date.now(), pending: true }])
    const applyResponse = (response: JarvisResponse) => {
      setSession(response.session)
      const entry = timelineFromResponse(response)
      // If the model proposed a Commander write action (emitted as a structured
      // @jarvis:action line), surface a confirmation card rather than showing
      // the raw protocol line. The backend re-checks the plan before running.
      const proposed = extractProposedAction(entry.text)
      setTimeline((current) => current.map((item) => item.id === pendingId ? { ...entry, id: pendingId, text: proposed ? proposed.cleanText : entry.text, action: proposed ? { id: proposed.actionId, recommendationId: typeof proposed.parameters.recommendationId === 'string' ? proposed.parameters.recommendationId : null, actionType: proposed.actionId, label: actionLabel(proposed.actionId), risk: 'APPROVAL_REQUIRED', undoWindowSeconds: 120, requiresVoiceConfirmation: false } : item.action } : item))
      if (proposed) setPendingStoreAction({ actionId: proposed.actionId, parameters: proposed.parameters, timelineId: pendingId })
      dispatchLifecycle({ type: 'recover' })
      if (response.showEvidence) onEvidence(response.evidence)
      return response
    }
    try {
      let response: JarvisResponse
      if (fromVoice) response = await sendJarvisMessage(context.storeId, session.id, cleanText, page, fromVoice)
      else response = await streamJarvisMessage(context.storeId, session.id, cleanText, page, (fullText) => setTimeline((current) => current.map((entry) => entry.id === pendingId ? { ...entry, text: fullText } : entry)))
      applyResponse(response)
      if (fromVoice) {
        jarvisVoiceController.speak({ text: response.text, language: response.language, muted }, () => {
          // After Jarvis finishes speaking, resume background listening so the
          // floating widget keeps the conversation going across navigations.
          resumeJarvisListening(response.language)
        })
      }
    } catch (error: unknown) {
      if (!fromVoice) {
        try {
          applyResponse(await sendJarvisMessage(context.storeId, session.id, cleanText, page, false))
          return
        } catch { /* fall through to the error path */ }
      }
      const message = error instanceof Error ? error.message : 'Jarvis could not answer.'
      setTimeline((current) => current.map((entry) => entry.id === pendingId ? { ...entry, text: message, status: 'DEGRADED' } : entry))
      if (fromVoice) onToast(message, 'error')
      onToast(message, 'error')
    }
  }

  const beginVoice = () => {
    if (lifecycle.status !== 'ready') { onToast(lifecycle.status === 'starting' ? 'Jarvis is starting… Voice will unlock when ready.' : 'Jarvis voice is unavailable until you retry the session.', 'info'); return }
    const preflight = microphonePreflight(window, document, navigator)
    jarvisVoiceController.setBlock(preflight.code === 'ready' ? null : preflight.code, preflight.framed)
    if (!preflight.allowed) {
      onToast(preflight.message ?? 'Microphone is unavailable here.', 'warning')
      return
    }
    if (!speechRecognitionAvailable(window)) { onToast('Native voice input is not available in this browser. Chat mode remains available.', 'warning'); return }
    const language: 'en' | 'hi' = preference?.language === 'hi' ? 'hi' : 'en'
    jarvisVoiceController.start({
      language,
      onTranscript: (transcript) => void send(transcript, true),
      onError: (message) => onToast(message, 'warning'),
    })
  }

  const toggleVoice = () => {
    if (voiceActive) jarvisVoiceController.stop()
    else beginVoice()
  }
  const updatePreference = async (patch: Readonly<Partial<JarvisPreference>>) => { if (!context.storeId) return; try { const next = await saveJarvisPreferences({ ...patch, storeId: context.storeId }); setPreference(next); onPreferenceChange?.(next) } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Jarvis preference could not be saved.', 'error') } }
  const confirmAction = async (actionId: string) => { if (!context.storeId || !session) return; try { const response = await confirmJarvisAction(context.storeId, session.id, actionId); setSession(response.session); setTimeline((current) => [...current, timelineFromResponse(response)]); if (response.showEvidence) onEvidence() } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Jarvis action was not confirmed.', 'error') } }
  const confirmProposedAction = async () => {
    if (!pendingStoreAction || !context.storeId || !session) return
    const { actionId, parameters, timelineId } = pendingStoreAction
    setPendingStoreAction(null)
    try {
      const response = await invokeJarvisStoreAction(context.storeId, session.id, actionId, parameters, true)
      setSession(response.session)
      setTimeline((current) => current.map((entry) => entry.id === timelineId ? { ...timelineFromResponse(response), id: timelineId, action: null } : entry))
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : 'The action could not be completed.', 'error')
    }
  }
  const pause = async () => { if (!context.storeId || !session) return; const next = await setJarvisState(context.storeId, session.id, paused ? 'resume' : 'pause'); setSession(next); setPaused(!paused); jarvisVoiceController.setPaused(!paused) }
  // Closing the chat panel must NOT stop an active voice session — the floating
  // widget takes over so voice keeps listening across page navigations.
  const closePanel = () => { onClose() }
  const stopVoice = () => { jarvisVoiceController.stop(); setPaused(false) }
  const toggleMute = () => jarvisVoiceController.setMuted(!muted)
  const reopenPanel = () => onOpen()
  const retry = () => { if (session && lifecycle.status === 'error') dispatchLifecycle({ type: 'recover' }); else setStartAttempt((attempt) => attempt + 1) }
  const isReady = lifecycle.status === 'ready'
  const address = preference?.addressing ?? 'Sir'
  const orbState = jarvisOrbState(lifecycle, voiceStatus, paused)

  const floatingWidget = <FloatingVoiceWidget visible={voiceActive && voiceBlock === null} address={address} paused={paused} onPause={() => void pause()} onResume={() => void pause()} onClose={stopVoice} onOpenPanel={reopenPanel} />
  if (!open) return <>
    <button className="jarvis-orb-wrap" onClick={onOpen} aria-label="Open Jarvis"><JarvisOrb state="idle" size={48} label="Open Jarvis" /><span className="jarvis-orb-label">Jarvis</span></button>
    {floatingWidget}
  </>
  if (!context.storeId) return <>
    <button className="jarvis-orb-wrap" onClick={onOpen} aria-label="Connect Shopify before opening Jarvis"><JarvisOrb state="warning" size={48} label="Connect Shopify for Jarvis" /><span className="jarvis-orb-label">Connect Shopify</span></button>
    {floatingWidget}
  </>

  return <>
    <aside className="jarvis-panel f8-jarvis-panel" aria-busy={lifecycle.status === 'starting'}>
      <div className="jarvis-panel-header"><div className="jarvis-title"><JarvisOrb state={orbState} size={31} label={`Jarvis ${orbState}`} /><span><strong>Jarvis</strong><small>{lifecycle.status === 'starting' ? 'Starting session…' : lifecycle.status === 'ready' ? `${address} · ${page}-aware` : 'Session unavailable'}</small></span><span className={`phase-tag ${isReady ? '' : 'warning'}`}>{lifecycle.status.toUpperCase()}</span></div><button className="icon-button" onClick={toggleMute} aria-label={muted ? 'Unmute Jarvis' : 'Mute Jarvis'} title={muted ? 'Unmute Jarvis' : 'Mute Jarvis'}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><button className="icon-button" onClick={closePanel} aria-label="Close Jarvis panel"><X size={18} /></button></div>
      <div className="jarvis-context"><span><ShieldCheck size={13} /> Grounded evidence only</span><span>{preference?.engagementMode ?? 'balanced'}</span></div>
      <div className="jarvis-messages f8-message-scroll" ref={messageScroll}>
        {!isReady && <JarvisReadiness lifecycle={lifecycle} onRetry={retry} />}
        {isReady && timeline.length === 0 && <div className="jarvis-message"><span className="message-orb"><Sparkles size={12} /></span><p>{greetingForPage(page, address)} Ask me in English or Hindi. Try “Mujhe dikhao” after I surface an opportunity.</p></div>}
{timeline.map((message) => <div className={`jarvis-message ${message.role === 'merchant' ? 'merchant-message' : ''} ${message.mode === 'ACTION' ? 'jarvis-action-message' : ''}`} key={message.id}>{message.role === 'jarvis' && <span className="message-orb"><Sparkles size={12} /></span>}<div>{message.pending && !message.text ? <span className="typing-dots" aria-label="Jarvis is typing"><i /><i /><i /></span> : <p>{message.text}</p>}{message.status === 'DEGRADED' && <span className="degraded-indicator" title="AI temporarily unavailable, showing safe fallback"><AlertTriangle size={11} /> Safe fallback</span>}{message.action && <div className="jarvis-action-card"><strong>{message.action.label}</strong><small>{message.action.risk} · undo {message.action.undoWindowSeconds}s</small>{pendingStoreAction && pendingStoreAction.timelineId === message.id ? <div className="jarvis-action-confirm"><button className="button primary" onClick={() => void confirmProposedAction()}>Confirm action</button><button className="button secondary" onClick={() => setPendingStoreAction(null)}>Cancel</button></div> : <button className="button secondary" onClick={() => void confirmAction(message.action!.id)} disabled={message.status === 'ACTION_UNAVAILABLE'}>Bhej do</button>}</div>}</div></div>)}
      </div>
      {voiceActive && <section className="jarvis-voice-inline" aria-label="Jarvis voice controls">
        <JarvisOrb state={orbState} size={48} label={`Voice ${voiceStatus}`} />
        <div className="voice-inline-copy"><strong>{voiceStatus === 'listening' ? `Listening, ${address}…` : voiceStatus === 'processing' ? 'Checking grounded evidence…' : voiceStatus === 'speaking' ? 'Speaking…' : voiceError ? 'Voice is unavailable here' : 'Voice is ready'}</strong><span>{voiceError ?? 'Spoken transcripts and replies stay in this chat.'}</span>{voiceFramed && voiceError && <a className="button primary open-standalone" href={standaloneUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open in new tab</a>}</div>
        <button className="icon-button voice-stop" onClick={stopVoice} aria-label="Turn voice off"><X size={15} /></button>
      </section>}
      <div className="jarvis-suggestions f8-suggestions"><button disabled={!isReady} onClick={() => void send('What needs my attention on this page?')}>Page briefing</button><button disabled={!isReady} onClick={() => void send('Mujhe dikhao')}>Mujhe dikhao</button><button disabled={!isReady || voiceBlock !== null} title={voiceBlock !== null ? voiceBlockMessage(voiceBlock) : undefined} onClick={toggleVoice}><Headphones size={12} /> {voiceActive ? 'Voice off' : 'Voice'}</button></div>
      <form className="jarvis-composer" onSubmit={(event) => { event.preventDefault(); void send() }}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={isReady ? `Ask Jarvis, ${address}…` : 'Jarvis is starting…'} rows={2} aria-label="Message Jarvis" disabled={!isReady} /><div className="jarvis-composer-actions"><button type="button" className={`icon-button ${voiceActive ? 'voice-active' : ''}`} onClick={toggleVoice} disabled={!isReady || voiceBlock !== null} title={voiceBlock !== null ? voiceBlockMessage(voiceBlock) : undefined} aria-label={voiceActive ? 'Stop voice input' : 'Start voice input'}><Mic size={16} /></button><span>{!isReady ? 'Jarvis is starting…' : `English + Hindi · ${page}`}</span><button type="submit" className="send-button" disabled={!isReady || !input.trim()} aria-label="Send message"><Send size={15} /></button></div></form>
      <div className="jarvis-panel-footer"><span><ShieldCheck size={12} /> No PII to AI</span><label className="f8-pref-select">Address<select aria-label="Jarvis addressing" value={preference?.addressing ?? 'Sir'} onChange={(event) => void updatePreference({ addressing: event.target.value as JarvisAddressing })}><option>Sir</option><option>Ma'am</option><option>Boss</option><option>Miss</option></select></label><label className="f8-pref-select">Mode<select aria-label="Jarvis engagement mode" value={preference?.engagementMode ?? 'balanced'} onChange={(event) => void updatePreference({ engagementMode: event.target.value as JarvisPreference['engagementMode'] })}><option value="proactive">Proactive</option><option value="balanced">Balanced</option><option value="quiet">Quiet</option><option value="answer-only">Answer-only</option></select></label><button onClick={() => void pause()} disabled={!isReady}>{paused ? 'Resume' : '5 min quiet'}</button></div>
    </aside>
    {floatingWidget}
  </>
}

function timelineFromPersisted(message: JarvisMessage): TimelineEntry { return { id: message.id, role: message.role, text: message.text, language: message.language, mode: message.mode, evidence: message.evidence, action: null, status: null, createdAt: message.createdAt } }
function timelineFromResponse(response: JarvisResponse): TimelineEntry { return { id: `jarvis-${Date.now()}-${Math.random().toString(36).slice(2)}`, role: 'jarvis', text: response.text, language: response.language, mode: response.mode, evidence: response.evidence, action: response.action, status: response.status, createdAt: Date.now() } }
function jarvisOrbState(lifecycle: JarvisSessionLifecycle, voiceStatus: VoiceStatus, paused: boolean): JarvisOrbState {
  if (lifecycle.status === 'starting') return 'activating'
  if (lifecycle.status === 'failed' || lifecycle.status === 'error' || voiceStatus === 'error') return 'warning'
  if (paused || voiceStatus === 'sleeping') return 'sleeping'
  if (voiceStatus === 'listening') return 'listening'
  if (voiceStatus === 'processing') return 'thinking'
  if (voiceStatus === 'speaking') return 'speaking'
  return 'idle'
}

type JarvisReadinessProps = Readonly<{ lifecycle: JarvisSessionLifecycle; onRetry: () => void }>
function JarvisReadiness({ lifecycle, onRetry }: JarvisReadinessProps) {
  if (lifecycle.status === 'starting') return <div className="jarvis-readiness starting" role="status"><LoaderCircle className="spin" size={18} /><div><strong>Jarvis is starting…</strong><span>Chat and voice will unlock when your secure session is ready.</span></div></div>
  return <div className="jarvis-readiness error" role="alert"><ShieldCheck size={18} /><div><strong>{lifecycle.status === 'failed' ? 'Jarvis could not start' : 'Jarvis needs your attention'}</strong><span>{lifecycle.error ?? 'The session is unavailable. Try again.'}</span><button className="button secondary" onClick={onRetry}>Retry Jarvis</button></div></div>
}

function greetingForPage(page: string, address: string): string { return `${address}, I’m ready to help with your ${page} workspace.` }

/**
 * Extracts a structured `@jarvis:action {...}` line the model may append to a
 * Commander reply. Returns the cleaned (human-visible) text plus the parsed
 * invocation, or null when no action is proposed.
 */
function extractProposedAction(text: string): { cleanText: string; actionId: string; parameters: Readonly<Record<string, string | number | boolean | null>> } | null {
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

function actionLabel(actionId: string): string {
  if (actionId === 'approve_recommendation') return 'Approve recommendation'
  if (actionId === 'reject_recommendation') return 'Reject recommendation'
  if (actionId === 'trigger_sync') return 'Sync store data'
  return actionId.replace(/_/g, ' ')
}
function voiceBlockMessage(code: 'insecure' | 'embedded-policy' | 'policy-denied' | 'media-devices-unavailable'): string {
  if (code === 'embedded-policy') return 'Voice needs a new tab — microphone is blocked in this embedded view'
  if (code === 'insecure') return 'Voice needs a secure HTTPS connection'
  if (code === 'policy-denied') return 'Microphone access is blocked by this page policy'
  return 'This browser does not expose a microphone — chat remains available'
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

export function ReportsWorkspace({ context }: Readonly<{ context: WorkspaceContext }>) {
  const [runs, setRuns] = useState<readonly ReportRun[]>([])
  const [forecast, setForecast] = useState<ForecastBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [frequency, setFrequency] = useState<ReportRun['frequency']>('WEEKLY')
  const [reportError, setReportError] = useState<string | null>(null)
  const refresh = async () => { if (!context.storeId) return; const [nextRuns, nextForecast] = await Promise.all([fetchReports(context.storeId), fetchForecast(context.storeId)]); setRuns(nextRuns); setForecast(nextForecast) }
  useEffect(() => { void refresh().catch(() => { setRuns([]); setForecast(null) }) }, [context.storeId])
  const generate = async () => {
    if (!context.storeId) return
    setLoading(true)
    setReportError(null)
    try {
      const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() - 1)
      const days = frequency === 'DAILY' ? 1 : frequency === 'WEEKLY' ? 7 : frequency === 'MONTHLY' ? 30 : 90
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1)
      const generated = await generateReport(context.storeId, frequency, start.toISOString(), end.toISOString(), false)
      if (generated.file) downloadBase64(generated.file.bodyBase64, generated.file.filename, generated.file.contentType)
      await refresh()
    } catch (failure: unknown) {
      setReportError(failure instanceof Error ? failure.message : 'The report could not be generated.')
    } finally { setLoading(false) }
  }
  const download = async (run: ReportRun) => {
    if (!context.storeId) return
    setReportError(null)
    try {
      const file = await downloadReport(context.storeId, run.id)
      downloadBase64(file.bodyBase64, file.filename, file.contentType)
    } catch (failure: unknown) {
      setReportError(failure instanceof Error ? failure.message : 'The report file is not ready to download.')
    }
  }
  return <div className="f8-reports"><div className="report-banner card"><span className="report-banner-icon"><FileBarChart size={22} /></span><div><div className="section-kicker">CLOSED-PERIOD PDF VAULT</div><h2>Reports from real store data.</h2><p>Regeneration is idempotent. Missing email delivery is reported honestly.</p></div><div className="report-generate-controls"><select aria-label="Report frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as ReportRun['frequency'])}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select><button className="button primary" onClick={() => void generate()} disabled={loading || !context.storeId}>{loading ? <LoaderCircle className="spin" size={15} /> : <FileBarChart size={15} />} Generate PDF</button></div></div><div className="f8-report-grid"><section className="card"><div className="card-heading"><div><span className="section-kicker">FORECAST METHOD STAMPS</span><h3>Deterministic forecast</h3></div></div>{forecast?.revenue ? <div className="forecast-card"><strong>{forecast.revenue.value.toLocaleString()}</strong><span>projected closed-week revenue band</span><small>{forecast.revenue.lower.toLocaleString()} – {forecast.revenue.upper.toLocaleString()} · {forecast.revenue.method.method} v{forecast.revenue.method.version}</small></div> : <div className="copilot-empty"><ShieldCheck size={20} /><span>At least two closed weekly periods are required.</span></div>}{forecast?.methods.map((method) => <div className="method-row" key={`${method.method}-${method.version}`}><span>{method.method}</span><small>v{method.version}</small></div>)}</section><section className="card"><div className="card-heading"><div><span className="section-kicker">REPORT RUNS</span><h3>PDF vault</h3></div></div>{reportError && <div className="form-error" role="alert">{reportError}</div>}{runs.length === 0 ? <span className="muted-cell">No reports generated.</span> : runs.map((run) => <div className="report-run" key={run.id}><span><strong>{run.filename}</strong><small>{run.status === 'COMPLETED' ? 'Ready' : run.status === 'GENERATING' ? 'Still generating' : 'Failed'} · {run.emailStatus === 'NOT_REQUESTED' ? 'email not requested' : `email ${run.emailStatus.toLowerCase()}`}</small></span><button className="button secondary" onClick={() => void download(run)} disabled={run.status !== 'COMPLETED'} title={run.status === 'COMPLETED' ? 'Download PDF' : 'Available after generation finishes'}><Download size={13} /> Download</button></div>)}</section></div></div>
}

function downloadBase64(base64: string, filename: string, contentType: string): void { const binary = atob(base64); const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: contentType })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }
