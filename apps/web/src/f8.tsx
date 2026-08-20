import { useEffect, useReducer, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Download, LoaderCircle, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { askCopilot, exportCopilotThread, fetchBilling, fetchCopilotMessages, fetchCopilotThreads, fetchJarvisBriefing, fetchJarvisPreferences, invokeJarvisStoreAction, sendJarvisMessage, setJarvisState, startJarvisSession } from './api.js'
import { reduceJarvisSession } from './f8-model.js'
import type { CopilotAnswer, CopilotThread, JarvisEvidence, JarvisPreference, JarvisResponse, JarvisSession } from './f8-model.js'
import { microphonePreflight, speechRecognitionAvailable } from './voice.js'
import { framedMicrophoneNeedsBridge } from './jarvis-voice-bridge.js'
import { JarvisOrb } from './JarvisOrb.js'
import { FloatingVoiceWidget } from './FloatingVoiceWidget.js'
import { jarvisVoiceController, resumeJarvisListening, useJarvisVoiceSnapshot } from './jarvis-voice.js'
import { canExecuteJarvisActions, jarvisStartupGreeting, pageSpokenName, parseJarvisVoiceIntent, spokenReplyText, wantsPageWalkthrough } from './jarvis-intents.js'
import type { WorkspaceContext } from './model.js'
import type { WorkspaceSettings } from './settings-model.js'

type JarvisExperienceProps = Readonly<{
  open: boolean
  context: WorkspaceContext
  page: string
  workspaceSettings?: WorkspaceSettings
  onOpen: () => void
  onClose: () => void
  onEvidence: (evidence?: JarvisEvidence | null) => void
  onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void
  onPreferenceChange?: (preference: JarvisPreference) => void
  onNavigate?: (page: string) => void
}>

export function JarvisExperience({ open, context, page, workspaceSettings, onOpen, onClose, onEvidence, onToast, onPreferenceChange, onNavigate }: JarvisExperienceProps) {
  const [session, setSession] = useState<JarvisSession | null>(null)
  const [lifecycle, dispatchLifecycle] = useReducer(reduceJarvisSession, { status: 'starting', error: null })
  const [startAttempt, setStartAttempt] = useState(0)
  const [preference, setPreference] = useState<JarvisPreference | null>(null)
  const voice = useJarvisVoiceSnapshot()
  const [paused, setPaused] = useState(false)
  const [caption, setCaption] = useState('Store assistant')
  const [pendingStoreAction, setPendingStoreAction] = useState<{ actionId: string; parameters: Readonly<Record<string, string | number | boolean | null>> } | null>(null)
  const sessionRef = useRef<JarvisSession | null>(null)
  const pageRef = useRef(page)
  const pendingTranscript = useRef<string | null>(null)
  const lastBriefedPage = useRef<string | null>(null)
  const pendingPageOffer = useRef<string | null>(null)
  sessionRef.current = session
  pageRef.current = page

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
      setPreference(preferences)
      onPreferenceChange?.(preferences)
      dispatchLifecycle({ type: 'ready' })
    }).catch((error: unknown) => {
      if (cancelled) return
      const message = error instanceof Error ? error.message : 'Jarvis could not start.'
      dispatchLifecycle({ type: 'failed', message })
      onToast(message, 'error')
    })
    return () => { cancelled = true }
  }, [open, context.storeId, startAttempt])

  const ambientLanguage = (): 'en' | 'hi' => preference?.language === 'hi' ? 'hi' : 'en'

  const speakReply = (text: string, language: 'en' | 'hi') => {
    const spoken = spokenReplyText(text)
    if (spoken) setCaption(spoken)
    jarvisVoiceController.speak({ text: spoken, language, muted: voice.muted, voiceGender: workspaceSettings?.jarvisVoiceGender ?? 'feminine' }, () => {
      resumeJarvisListening(language)
    })
  }

  const deliverBriefing = async (pageToExplain: string) => {
    const current = sessionRef.current
    if (!context.storeId || !current) return
    jarvisVoiceController.setProcessing()
    try {
      const briefing = await fetchJarvisBriefing(context.storeId, pageToExplain, current.plan)
      setSession(briefing.session)
      pendingPageOffer.current = null
      speakReply(briefing.text, briefing.language)
    } catch {
      pendingPageOffer.current = null
      speakReply(fallbackBriefing(pageToExplain, preference?.addressing ?? 'Sir', ambientLanguage()), ambientLanguage())
    }
  }

  const handleTranscript = async (text: string) => {
    const cleanText = text.trim()
    if (!cleanText) return
    const current = sessionRef.current
    if (!context.storeId || !current) {
      pendingTranscript.current = cleanText
      return
    }
    const language = preference?.language === 'hi' || /[\u0900-\u097F]|\b(kya|mujhe|dikhao|bhej|aaj|kal)\b/i.test(cleanText) ? 'hi' : 'en'
    const intent = parseJarvisVoiceIntent(cleanText)
    const commander = canExecuteJarvisActions(current.plan)

    if (intent.type === 'cancel') {
      setPendingStoreAction(null)
      pendingPageOffer.current = null
      speakReply(`${preference?.addressing ?? 'Sir'}, cancelled.`, language)
      return
    }

    if (intent.type === 'confirm' && pendingStoreAction) {
      jarvisVoiceController.setProcessing()
      try {
        const response = await invokeJarvisStoreAction(context.storeId, current.id, pendingStoreAction.actionId, pendingStoreAction.parameters, true)
        setSession(response.session)
        setPendingStoreAction(null)
        if (pendingStoreAction.actionId === 'navigate_page' && typeof pendingStoreAction.parameters.page === 'string') onNavigate?.(pendingStoreAction.parameters.page)
        if (pendingStoreAction.actionId === 'create_automation') onNavigate?.('automation')
        speakReply(response.text, response.language)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'The action could not be completed.'
        onToast(message, 'error')
        speakReply(message, language)
      }
      return
    }

    if (intent.type === 'confirm' && pendingPageOffer.current) {
      const pageToExplain = pendingPageOffer.current
      pendingPageOffer.current = null
      await deliverBriefing(pageToExplain)
      return
    }

    if (wantsPageWalkthrough(cleanText)) {
      await deliverBriefing(pageRef.current)
      return
    }

    if (intent.type === 'navigate') {
      if (commander) {
        onNavigate?.(intent.page)
        speakReply(`${preference?.addressing ?? 'Sir'}, opening ${pageSpokenName(intent.page)}.`, language)
      } else {
        speakReply(`${preference?.addressing ?? 'Sir'}, I can suggest opening ${pageSpokenName(intent.page)} from the sidebar. Commander can take you there.`, language)
      }
      return
    }

    if (intent.type === 'create_automation') {
      if (!commander) {
        speakReply(`${preference?.addressing ?? 'Sir'}, I can only suggest automations on this plan. Open Automation to use a template, or upgrade to Commander if you want me to create one.`, language)
        return
      }
      setPendingStoreAction({ actionId: 'create_automation', parameters: { templateId: intent.templateId, name: intent.name } })
      speakReply(`${preference?.addressing ?? 'Sir'}, I can create a draft ${intent.name} automation. Say confirm and I will add it.`, language)
      return
    }

    jarvisVoiceController.setProcessing()
    try {
      const response = await sendJarvisMessage(context.storeId, current.id, cleanText, pageRef.current, true)
      applyVoiceResponse(response)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Jarvis could not answer.'
      onToast(message, 'error')
      speakReply(message, language)
    }
  }

  const applyVoiceResponse = (response: JarvisResponse) => {
    setSession(response.session)
    dispatchLifecycle({ type: 'recover' })
    const proposed = extractProposedAction(response.text)
    const spoken = proposed?.cleanText || response.text
    if (proposed) {
      setPendingStoreAction({ actionId: proposed.actionId, parameters: proposed.parameters })
      if (proposed.actionId === 'navigate_page' && canExecuteJarvisActions(response.session.plan) && typeof proposed.parameters.page === 'string') {
        onNavigate?.(proposed.parameters.page)
      }
    } else if (response.action?.actionType === 'navigate_page' && canExecuteJarvisActions(response.session.plan)) {
      const pageName = response.action.recommendationId
      if (pageName) onNavigate?.(pageName)
    }
    if (response.showEvidence) onEvidence(response.evidence)
    speakReply(spoken, response.language)
  }

  const beginVoice = () => {
    jarvisVoiceController.unlock()
    const preflight = microphonePreflight(window, document, navigator)
    jarvisVoiceController.setBlock(preflight.code === 'ready' ? null : preflight.code, preflight.framed)
    if (!preflight.allowed && !framedMicrophoneNeedsBridge(window, document)) {
      onToast(preflight.message ?? 'Microphone is unavailable here.', 'warning')
      return
    }
    if (!speechRecognitionAvailable(window) && !framedMicrophoneNeedsBridge(window, document)) {
      onToast('Voice input is not available in this browser. Use AI Command to type a question.', 'warning')
      return
    }
    const language: 'en' | 'hi' = preference?.language === 'hi' ? 'hi' : 'en'
    void jarvisVoiceController.start({
      language,
      onTranscript: (transcript) => void handleTranscript(transcript),
      onError: (message) => onToast(message, 'warning'),
    })
  }

  const openJarvis = () => {
    jarvisVoiceController.unlock()
    onOpen()
    beginVoice()
  }

  useEffect(() => {
    if (!open || lifecycle.status !== 'ready' || !session || !context.storeId) return
    if (pendingTranscript.current) {
      const queued = pendingTranscript.current
      pendingTranscript.current = null
      void handleTranscript(queued)
    }
    const previousPage = lastBriefedPage.current
    if (previousPage === page) return
    lastBriefedPage.current = page
    if (previousPage === null) {
      const addressing = preference?.addressing ?? 'Sir'
      const language = ambientLanguage()
      speakReply(jarvisStartupGreeting(addressing, language), language)
      return
    }
    // Page changes: Jarvis stays quiet. It only speaks when the user asks.
    // No automatic briefing, no page offer prompt.
  }, [open, lifecycle.status, session?.id, page, context.storeId, paused, preference?.navigationSuggestions, preference?.onlyAnswerWhenAsked, preference?.engagementMode])

  useEffect(() => {
    if (!open) {
      lastBriefedPage.current = null
      pendingPageOffer.current = null
    }
  }, [open])

  const toggleMic = () => {
    if (paused) {
      void resumeSession()
      return
    }
    if (voice.active) jarvisVoiceController.stop()
    else beginVoice()
  }

  const pauseSession = async () => {
    if (context.storeId && session) {
      try { setSession(await setJarvisState(context.storeId, session.id, 'pause')) } catch { /* local pause still applies */ }
    }
    setPaused(true)
    pendingPageOffer.current = null
    jarvisVoiceController.setPaused(true)
    setCaption('Paused')
  }

  const resumeSession = async () => {
    if (context.storeId && session) {
      try { setSession(await setJarvisState(context.storeId, session.id, 'resume')) } catch { /* local resume still applies */ }
    }
    setPaused(false)
    jarvisVoiceController.setPaused(false)
    beginVoice()
  }

  const closeJarvis = () => {
    if (context.storeId && session) void setJarvisState(context.storeId, session.id, 'end').catch(() => undefined)
    jarvisVoiceController.stop()
    setPaused(false)
    setPendingStoreAction(null)
    pendingPageOffer.current = null
    setCaption('Store assistant')
    lastBriefedPage.current = null
    onClose()
  }

  const retry = () => { if (session && lifecycle.status === 'error') dispatchLifecycle({ type: 'recover' }); else setStartAttempt((attempt) => attempt + 1) }
  const address = preference?.addressing ?? 'Sir'
  const stripCaption = lifecycle.status === 'starting' ? 'Starting…' : lifecycle.status === 'failed' || lifecycle.status === 'error' ? (lifecycle.error ?? 'Session unavailable') : caption

  if (!open) {
    if (page === 'jarvis') return null
    return (
      <button className="jarvis-orb-wrap" onClick={openJarvis} aria-label="Open Jarvis">
        <JarvisOrb state="idle" size={80} label="Open Jarvis" />
        <span className="jarvis-orb-label">Jarvis</span>
      </button>
    )
  }

  if (!context.storeId) return (
    page === 'jarvis' ? null : (
      <button className="jarvis-orb-wrap" onClick={onClose} aria-label="Connect Shopify before opening Jarvis">
        <JarvisOrb state="warning" size={80} label="Connect Shopify for Jarvis" />
        <span className="jarvis-orb-label">Connect Shopify</span>
      </button>
    )
  )

  return (
    <>
      {lifecycle.status === 'failed' && (
        <button className="jarvis-retry-chip" onClick={retry} type="button">Retry Jarvis</button>
      )}
      <FloatingVoiceWidget
        visible
        address={address}
        page={page}
        caption={stripCaption}
        paused={paused}
        micOn={voice.active && !paused}
        onMic={toggleMic}
        onPause={() => void pauseSession()}
        onResume={() => void resumeSession()}
        onClose={closeJarvis}
      />
    </>
  )
}

function pageOfferPrompt(_page: string, addressing: string, language: 'en' | 'hi'): string {
  if (language === 'hi') return `${addressing}, aap kuch poochna chahte hain is page ke baare mein? Bas boliye.`
  return `${addressing}, would you like me to explain this page? Just say yes.`
}

function fallbackBriefing(page: string, addressing: string, language: 'en' | 'hi'): string {
  const pageName = pageSpokenName(page)
  if (language === 'hi') return `${addressing}, yeh ${pageName} page hai. Aap mujhse kuch bhi pooch sakte hain — main sirf zaroori baatein bataunga.`
  return `${addressing}, this is ${pageName}. Ask me anything specific and I will keep it short and useful.`
}

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
