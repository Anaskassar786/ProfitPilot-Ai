import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Download, FileBarChart, Headphones, Keyboard, LoaderCircle, Mic, Pause, Play, Send, ShieldCheck, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import { askCopilot, confirmJarvisAction, downloadReport, exportCopilotThread, fetchBilling, fetchCopilotMessages, fetchCopilotThreads, fetchForecast, fetchJarvisBriefing, fetchJarvisPreferences, fetchReports, generateReport, saveJarvisPreferences, sendJarvisMessage, setJarvisState, startJarvisSession } from './api.js'
import { reduceJarvisSession } from './f8-model.js'
import type { CopilotAnswer, CopilotThread, ForecastBundle, JarvisAddressing, JarvisEvidence, JarvisPreference, JarvisResponse, JarvisSession, JarvisSessionLifecycle, ReportRun } from './f8-model.js'
import { createSpeechRecognition, speakNative, speechRecognitionAvailable, speechRecognitionFailure, stopNativeSpeech, transcriptFromEvent } from './voice.js'
import type { NativeSpeechRecognition, VoiceStatus } from './voice.js'
import type { WorkspaceContext } from './model.js'

type JarvisExperienceProps = Readonly<{ open: boolean; context: WorkspaceContext; page: string; onOpen: () => void; onClose: () => void; onEvidence: (evidence?: JarvisEvidence | null) => void; onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void }>

export function JarvisExperience({ open, context, page, onOpen, onClose, onEvidence, onToast }: JarvisExperienceProps) {
  const [session, setSession] = useState<JarvisSession | null>(null)
  const [lifecycle, dispatchLifecycle] = useReducer(reduceJarvisSession, { status: 'starting', error: null })
  const [startAttempt, setStartAttempt] = useState(0)
  const [preference, setPreference] = useState<JarvisPreference | null>(null)
  const [messages, setMessages] = useState<readonly JarvisResponse[]>([])
  const [input, setInput] = useState('')
  const [immersive, setImmersive] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [paused, setPaused] = useState(false)
  const recognition = useRef<NativeSpeechRecognition | null>(null)

  useEffect(() => {
    if (!open || !context.storeId) return
    let cancelled = false
    const storeId = context.storeId
    setSession(null)
    dispatchLifecycle({ type: 'start' })
    void fetchBilling(storeId).catch(() => null).then((account) => {
      const rawPlan = account?.subscription?.plan?.toLowerCase()
      const plan: JarvisSession['plan'] = rawPlan === 'commander' ? 'commander' : rawPlan === 'growth' ? 'growth' : rawPlan === 'start' ? 'start' : 'trial'
      const briefing = new Date().getHours() < 12 && (plan === 'growth' || plan === 'commander') ? fetchJarvisBriefing(storeId, page, plan) : Promise.resolve(null)
      return Promise.all([startJarvisSession(storeId, page, plan), fetchJarvisPreferences(storeId), briefing])
    }).then(([started, preferences, morning]) => { if (!cancelled) { setSession(morning?.session ?? started); setPreference(preferences); if (morning) setMessages([morning]); dispatchLifecycle({ type: 'ready' }) } }).catch((error: unknown) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : 'Jarvis could not start.'
        dispatchLifecycle({ type: 'failed', message })
        onToast(message, 'error')
      }
    })
    return () => { cancelled = true; recognition.current?.abort(); recognition.current = null; stopNativeSpeech(window); setVoiceStatus('idle') }
  }, [open, context.storeId, page, startAttempt])

  useEffect(() => { if (open && session) setSession((current) => current ? { ...current, lastPage: page } : current) }, [open, page, session?.id])
  useEffect(() => { if (!open) return; const onVisibility = () => { if (document.visibilityState === 'hidden' && recognition.current) { recognition.current.abort(); recognition.current = null; stopNativeSpeech(window); setVoiceStatus('sleeping') } }; document.addEventListener('visibilitychange', onVisibility); return () => document.removeEventListener('visibilitychange', onVisibility) }, [open])

  const send = async (text = input, fromVoice = false) => {
    if (lifecycle.status !== 'ready') {
      onToast(lifecycle.status === 'starting' ? 'Jarvis is starting… Please wait until the session is ready.' : 'Jarvis is not ready. Use Retry to restore the session.', 'info')
      return
    }
    if (!context.storeId || !session || !text.trim()) return
    setInput('')
    setVoiceStatus(fromVoice ? 'processing' : voiceStatus)
    try {
      const response = await sendJarvisMessage(context.storeId, session.id, text, page, fromVoice)
      setSession(response.session)
      setMessages((current) => [...current, response])
      dispatchLifecycle({ type: 'recover' })
      if (response.showEvidence) onEvidence(response.evidence)
      if (!muted && (fromVoice || immersive)) { setVoiceStatus('speaking'); speakNative(window, response.text, response.language, () => setVoiceStatus('idle')) }
      else setVoiceStatus('idle')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Jarvis could not answer.'
      setVoiceStatus('error')
      dispatchLifecycle({ type: 'error', message })
      onToast(message, 'error')
    }
  }

  const beginVoice = () => {
    if (lifecycle.status !== 'ready') { onToast(lifecycle.status === 'starting' ? 'Jarvis is starting… Voice will unlock when ready.' : 'Jarvis voice is unavailable until you retry the session.', 'info'); return }
    if (!speechRecognitionAvailable(window)) { onToast('Native voice input is not available in this browser. Chat mode remains available.', 'info'); return }
    const next = createSpeechRecognition(window)
    if (!next) return
    setImmersive(true); setVoiceStatus('listening'); recognition.current = next; next.lang = preference?.language === 'hi' ? 'hi-IN' : 'en-IN'; next.continuous = false; next.interimResults = false
    next.onstart = () => setVoiceStatus('listening')
    next.onresult = (event) => { const transcript = transcriptFromEvent(event); if (transcript) void send(transcript, true) }
    next.onerror = (event) => {
      const failure = speechRecognitionFailure(event.error)
      setVoiceStatus('error')
      dispatchLifecycle({ type: 'error', message: `${failure.message} [${failure.code}]` })
      onToast(failure.message, 'warning')
    }
    next.onend = () => { setVoiceStatus((status) => status === 'listening' ? 'idle' : status); recognition.current = null }
    try { next.start() } catch {
      const failure = speechRecognitionFailure('start-failed')
      setVoiceStatus('error')
      dispatchLifecycle({ type: 'error', message: `${failure.message} [${failure.code}]` })
      onToast(failure.message, 'warning')
    }
  }

  const updatePreference = async (patch: Readonly<Partial<JarvisPreference>>) => { if (!context.storeId) return; try { const next = await saveJarvisPreferences({ ...patch, storeId: context.storeId }); setPreference(next) } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Jarvis preference could not be saved.', 'error') } }
  const confirmAction = async (actionId: string) => { if (!context.storeId || !session) return; try { const response = await confirmJarvisAction(context.storeId, session.id, actionId); setSession(response.session); setMessages((current) => [...current, response]); if (response.showEvidence) onEvidence() } catch (error: unknown) { onToast(error instanceof Error ? error.message : 'Jarvis action was not confirmed.', 'error') } }
  const pause = async () => { if (!context.storeId || !session) return; const next = await setJarvisState(context.storeId, session.id, paused ? 'resume' : 'pause'); setSession(next); setPaused(!paused); setVoiceStatus(!paused ? 'sleeping' : 'idle') }
  const end = async () => { if (context.storeId && session) { const next = await setJarvisState(context.storeId, session.id, 'end'); setSession(next) } recognition.current?.abort(); stopNativeSpeech(window); setVoiceStatus('idle'); setImmersive(false); onClose() }
  const retry = () => {
    setVoiceStatus('idle')
    if (session && lifecycle.status === 'error') dispatchLifecycle({ type: 'recover' })
    else setStartAttempt((attempt) => attempt + 1)
  }
  const isReady = lifecycle.status === 'ready'
  const address = preference?.addressing ?? 'Sir'
  const stateClass = lifecycle.status === 'starting' ? 'activating' : lifecycle.status === 'failed' || lifecycle.status === 'error' ? 'error' : voiceStatus === 'idle' ? 'idle' : voiceStatus

  if (!open) return <button className="jarvis-orb-wrap" onClick={onOpen} aria-label="Open Jarvis"><span className="jarvis-orb-ring ring-a" /><span className="jarvis-orb-ring ring-b" /><span className="jarvis-orb jarvis-state-idle"><span className="orb-core" /><span className="orb-shine" /></span><span className="jarvis-orb-label">Jarvis</span></button>
  if (!context.storeId) return <button className="jarvis-orb-wrap" onClick={onOpen} aria-label="Connect Shopify before opening Jarvis"><span className="jarvis-orb jarvis-state-error"><span className="orb-core" /></span><span className="jarvis-orb-label">Connect Shopify</span></button>

  return <>
    <div className={`jarvis-live-strip ${immersive ? 'immersive-live' : ''}`} role="status">
      <span className={`jarvis-live-orb jarvis-state-${stateClass}`}><span className="orb-core" /></span>
      <strong>Jarvis Live</strong>
      <span>{lifecycle.status === 'starting' ? 'Starting…' : lifecycle.status === 'failed' ? 'Start failed' : lifecycle.status === 'error' ? 'Needs attention' : voiceStatus === 'listening' ? 'Listening' : voiceStatus === 'speaking' ? 'Speaking' : voiceStatus === 'processing' ? 'Processing' : paused ? 'Paused' : `Page-aware · ${page}`}</span>
      <span className="live-strip-actions">
        <button onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute Jarvis' : 'Mute Jarvis'}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
        <button onClick={() => void pause()} disabled={!isReady} aria-label={paused ? 'Resume Jarvis' : 'Pause Jarvis'}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>
        <button onClick={() => void end()} aria-label="End Jarvis session"><X size={14} /></button>
      </span>
    </div>
    {immersive ? <div className="jarvis-immersive" role="dialog" aria-modal="true" aria-label="Jarvis voice mode">
      <div className="jarvis-immersive-backdrop" />
      <div className="jarvis-immersive-content">
        <button className="icon-button immersive-close" onClick={() => setImmersive(false)} aria-label="Close immersive voice mode"><X size={19} /></button>
        <div className={`jarvis-hero-orb jarvis-state-${stateClass}`}><span className="orb-core" /><span className="orb-shine" /></div>
        <div className="jarvis-immersive-title"><span className="section-kicker">JARVIS VOICE MODE · {page.toUpperCase()}</span><h2>{lifecycle.status === 'error' ? 'Voice needs your attention.' : voiceStatus === 'listening' ? `I’m listening, ${address}.` : voiceStatus === 'speaking' ? 'I’m speaking.' : voiceStatus === 'processing' ? 'I’m checking the evidence.' : `Ready when you are, ${address}.`}</h2><p>Browser-native voice. No voice API key, no added voice cost.</p></div>
        {lifecycle.status === 'error' && <JarvisReadiness lifecycle={lifecycle} onRetry={retry} />}
        <div className="voice-controls"><button className="button primary" onClick={beginVoice} disabled={!isReady || voiceStatus === 'listening' || voiceStatus === 'processing'}><Mic size={16} /> {voiceStatus === 'listening' ? 'Listening…' : 'Tap to speak'}</button><button className="button secondary" onClick={() => setImmersive(false)}><Keyboard size={16} /> Use chat</button></div>
      </div>
    </div> : <aside className="jarvis-panel f8-jarvis-panel" aria-busy={lifecycle.status === 'starting'}>
      <div className="jarvis-panel-header"><div className="jarvis-title"><span className={`jarvis-mini-orb jarvis-state-${stateClass}`}><span /></span><span><strong>Jarvis</strong><small>{lifecycle.status === 'starting' ? 'Starting session…' : lifecycle.status === 'ready' ? `${address} · ${page}-aware` : 'Session unavailable'}</small></span><span className={`phase-tag ${isReady ? '' : 'warning'}`}>{lifecycle.status.toUpperCase()}</span></div><button className="icon-button" onClick={() => void end()} aria-label="End Jarvis session"><X size={18} /></button></div>
      <div className="jarvis-context"><span><ShieldCheck size={13} /> Grounded evidence only</span><span>{preference?.engagementMode ?? 'balanced'}</span></div>
      <div className="jarvis-messages f8-message-scroll">
        {!isReady && <JarvisReadiness lifecycle={lifecycle} onRetry={retry} />}
        {isReady && messages.length === 0 && <div className="jarvis-message"><span className="message-orb"><Sparkles size={12} /></span><p>{greetingForPage(page, address)} Ask me in English or Hindi. Try “Mujhe dikhao” after I surface an opportunity.</p></div>}
        {messages.map((message) => <div className={`jarvis-message ${message.mode === 'ACTION' ? 'jarvis-action-message' : ''}`} key={`${message.session.id}-${message.text}`}><span className="message-orb"><Sparkles size={12} /></span><div><p>{message.text}</p>{message.evidence && <button className="evidence-link" onClick={() => onEvidence(message.evidence)}>Mujhe dikhao · {message.evidence.confidenceLevel} confidence</button>}{message.action && <div className="jarvis-action-card"><strong>{message.action.label}</strong><small>{message.action.risk} · undo {message.action.undoWindowSeconds}s</small><button className="button secondary" onClick={() => void confirmAction(message.action!.id)} disabled={message.status === 'ACTION_UNAVAILABLE'}>Bhej do</button></div>}</div></div>)}
      </div>
      <div className="jarvis-suggestions f8-suggestions"><button disabled={!isReady} onClick={() => void send('What needs my attention on this page?')}>Page briefing</button><button disabled={!isReady} onClick={() => void send('Mujhe dikhao')}>Mujhe dikhao</button><button disabled={!isReady} onClick={() => beginVoice()}><Headphones size={12} /> Voice</button></div>
      <form className="jarvis-composer" onSubmit={(event) => { event.preventDefault(); void send() }}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={isReady ? `Ask Jarvis, ${address}…` : 'Jarvis is starting…'} rows={2} aria-label="Message Jarvis" disabled={!isReady} /><div className="jarvis-composer-actions"><button type="button" className="icon-button" onClick={beginVoice} disabled={!isReady} aria-label="Start voice input"><Mic size={16} /></button><span>{!isReady ? 'Jarvis is starting…' : `English + Hindi · ${page}`}</span><button type="submit" className="send-button" disabled={!isReady || !input.trim()} aria-label="Send message"><Send size={15} /></button></div></form>
      <div className="jarvis-panel-footer"><span><ShieldCheck size={12} /> No PII to AI</span><label className="f8-pref-select">Address<select aria-label="Jarvis addressing" value={preference?.addressing ?? 'Sir'} onChange={(event) => void updatePreference({ addressing: event.target.value as JarvisAddressing })}><option>Sir</option><option>Ma'am</option><option>Boss</option><option>Miss</option></select></label><label className="f8-pref-select">Mode<select aria-label="Jarvis engagement mode" value={preference?.engagementMode ?? 'balanced'} onChange={(event) => void updatePreference({ engagementMode: event.target.value as JarvisPreference['engagementMode'] })}><option value="proactive">Proactive</option><option value="balanced">Balanced</option><option value="quiet">Quiet</option><option value="answer-only">Answer-only</option></select></label><button onClick={() => void pause()} disabled={!isReady}>{paused ? 'Resume' : '5 min quiet'}</button></div>
    </aside>}
  </>
}

type JarvisReadinessProps = Readonly<{ lifecycle: JarvisSessionLifecycle; onRetry: () => void }>
function JarvisReadiness({ lifecycle, onRetry }: JarvisReadinessProps) {
  if (lifecycle.status === 'starting') return <div className="jarvis-readiness starting" role="status"><LoaderCircle className="spin" size={18} /><div><strong>Jarvis is starting…</strong><span>Chat and voice will unlock when your secure session is ready.</span></div></div>
  return <div className="jarvis-readiness error" role="alert"><ShieldCheck size={18} /><div><strong>{lifecycle.status === 'failed' ? 'Jarvis could not start' : 'Jarvis needs your attention'}</strong><span>{lifecycle.error ?? 'The session is unavailable. Try again.'}</span><button className="button secondary" onClick={onRetry}>Retry Jarvis</button></div></div>
}

function greetingForPage(page: string, address: string): string { return `${address}, I’m ready to help with your ${page} workspace.` }

type CopilotWorkspaceProps = Readonly<{ context: WorkspaceContext }>
export function CopilotWorkspace({ context }: CopilotWorkspaceProps) {
  const [threads, setThreads] = useState<readonly CopilotThread[]>([])
  const [threadId, setThreadId] = useState<string | undefined>()
  const [answers, setAnswers] = useState<readonly CopilotAnswer[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (context.storeId) void fetchCopilotThreads(context.storeId).then(setThreads).catch(() => setThreads([])) }, [context.storeId])
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!context.storeId || !query.trim()) return; setLoading(true); try { const answer = await askCopilot(context.storeId, query, 'copilot', threadId); setThreadId(answer.threadId); setAnswers((current) => [...current, answer]); setQuery(''); setThreads(await fetchCopilotThreads(context.storeId)) } finally { setLoading(false) } }
  const selectThread = async (id: string) => { if (!context.storeId) return; setThreadId(id); setAnswers(await fetchCopilotMessages(context.storeId, id)) }
  const exportThread = async () => { if (!context.storeId || !threadId) return; const file = await exportCopilotThread(context.storeId, threadId); downloadBase64(file.bodyBase64, file.filename, file.contentType) }
  return <div className="f8-copilot-layout"><section className="copilot-main card"><div className="copilot-welcome"><span className="copilot-orb"><Sparkles size={22} /></span><div><div className="section-kicker">CLOSED 10-INTENT GRAMMAR</div><h2>Ask a grounded question.</h2><p>Numbers are rendered from deterministic evidence slots. No open generation.</p></div></div><div className="f8-copilot-answers">{answers.length === 0 ? <div className="copilot-empty"><ShieldCheck size={24} /><strong>Ready for real store evidence</strong><span>Try “What is my revenue?” or “Which products have stockout risk?”</span></div> : answers.map((answer) => <article className="f8-answer" key={answer.id}><div className="f8-answer-head"><span className="status-badge blue">{answer.intent ?? 'ASK'}</span><span>{answer.evidence?.confidenceLevel ?? 'CLARIFY'} confidence</span></div><p>{answer.answer}</p>{answer.clarification && <small>{answer.clarification}</small>}{answer.evidence && <div className="f8-evidence-table">{answer.evidence.facts.map((fact) => <div key={fact.key}><span>{fact.label}</span><strong>{String(fact.value ?? '—')}</strong><small>{fact.source}</small></div>)}</div>}</article>)}</div><form className="copilot-composer f8-copilot-form" onSubmit={(event) => void submit(event)}><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Which products are at stockout risk?" rows={2} aria-label="Ask Copilot" /><button className="send-button" type="submit" disabled={loading || !query.trim()} aria-label="Ask Copilot">{loading ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}</button></form><div className="suggested-prompts"><button onClick={() => setQuery('What changed in revenue?')}>Revenue change</button><button onClick={() => setQuery('Which products have stockout risk?')}>Stockout risk</button><button onClick={() => setQuery('Show store health')}>Store health</button></div></section><aside className="copilot-sidebar card"><div className="card-heading"><div><span className="section-kicker">SAVED THREADS</span><h3>Thread history</h3></div><button className="icon-button" onClick={() => void exportThread()} disabled={!threadId} aria-label="Export Copilot thread"><Download size={15} /></button></div>{threads.length === 0 ? <span className="muted-cell">No saved questions yet.</span> : threads.map((thread) => <button className={`f8-thread ${thread.id === threadId ? 'active' : ''}`} key={thread.id} onClick={() => void selectThread(thread.id)}>{thread.title}<small>{new Date(thread.updatedAt).toLocaleDateString()}</small></button>)}</aside></div>
}

export function ReportsWorkspace({ context }: Readonly<{ context: WorkspaceContext }>) {
  const [runs, setRuns] = useState<readonly ReportRun[]>([])
  const [forecast, setForecast] = useState<ForecastBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [frequency, setFrequency] = useState<ReportRun['frequency']>('WEEKLY')
  const refresh = async () => { if (!context.storeId) return; const [nextRuns, nextForecast] = await Promise.all([fetchReports(context.storeId), fetchForecast(context.storeId)]); setRuns(nextRuns); setForecast(nextForecast) }
  useEffect(() => { void refresh().catch(() => { setRuns([]); setForecast(null) }) }, [context.storeId])
  const generate = async () => { if (!context.storeId) return; setLoading(true); try { const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() - 1); const days = frequency === 'DAILY' ? 1 : frequency === 'WEEKLY' ? 7 : frequency === 'MONTHLY' ? 30 : 90; const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1); await generateReport(context.storeId, frequency, start.toISOString(), end.toISOString(), false); await refresh() } finally { setLoading(false) } }
  const download = async (run: ReportRun) => { if (!context.storeId) return; const file = await downloadReport(context.storeId, run.id); downloadBase64(file.bodyBase64, file.filename, file.contentType) }
  return <div className="f8-reports"><div className="report-banner card"><span className="report-banner-icon"><FileBarChart size={22} /></span><div><div className="section-kicker">CLOSED-PERIOD PDF VAULT</div><h2>Reports from real store data.</h2><p>Regeneration is idempotent. Missing R2 or SMTP is reported honestly.</p></div><div className="report-generate-controls"><select aria-label="Report frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as ReportRun['frequency'])}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select><button className="button primary" onClick={() => void generate()} disabled={loading || !context.storeId}>{loading ? <LoaderCircle className="spin" size={15} /> : <FileBarChart size={15} />} Generate PDF</button></div></div><div className="f8-report-grid"><section className="card"><div className="card-heading"><div><span className="section-kicker">FORECAST METHOD STAMPS</span><h3>Deterministic forecast</h3></div></div>{forecast?.revenue ? <div className="forecast-card"><strong>{forecast.revenue.value.toLocaleString()}</strong><span>projected closed-week revenue band</span><small>{forecast.revenue.lower.toLocaleString()} – {forecast.revenue.upper.toLocaleString()} · {forecast.revenue.method.method} v{forecast.revenue.method.version}</small></div> : <div className="copilot-empty"><ShieldCheck size={20} /><span>At least two closed weekly periods are required.</span></div>}{forecast?.methods.map((method) => <div className="method-row" key={`${method.method}-${method.version}`}><span>{method.method}</span><small>v{method.version}</small></div>)}</section><section className="card"><div className="card-heading"><div><span className="section-kicker">REPORT RUNS</span><h3>PDF vault</h3></div></div>{runs.length === 0 ? <span className="muted-cell">No reports generated.</span> : runs.map((run) => <div className="report-run" key={run.id}><span><strong>{run.filename}</strong><small>{run.status} · email {run.emailStatus}</small></span><button className="button secondary" onClick={() => void download(run)} disabled={run.status !== 'COMPLETED'}><Download size={13} /> Download</button></div>)}</section></div></div>
}

function downloadBase64(base64: string, filename: string, contentType: string): void { const binary = atob(base64); const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: contentType })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }
