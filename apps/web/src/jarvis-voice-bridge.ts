import { isFramed } from './voice.js'

export const VOICE_BRIDGE_CHANNEL = 'profitpilot:jarvis-voice'
export const VOICE_BRIDGE_WINDOW_NAME = 'profitpilot-jarvis-mic'

export type VoiceBridgeKind = 'ready' | 'listening' | 'transcript' | 'error' | 'denied' | 'closed' | 'pause' | 'resume' | 'stop'
export type VoiceBridgeMessage = Readonly<{ channel: typeof VOICE_BRIDGE_CHANNEL; kind: VoiceBridgeKind; text?: string; message?: string }>

export type VoiceBridgeSession = Readonly<{
  popup: Window
  close: () => void
  pause: () => void
  resume: () => void
}>

type StartVoiceBridgeOptions = Readonly<{
  scope: Window
  popup: Window
  language: 'en' | 'hi'
  onTranscript: (text: string) => void
  onError: (message: string) => void
  onListening: () => void
  onClosed: () => void
}>

export function isVoiceBridgeMessage(data: unknown): data is VoiceBridgeMessage {
  if (!data || typeof data !== 'object') return false
  const record = data as Partial<VoiceBridgeMessage>
  return record.channel === VOICE_BRIDGE_CHANNEL && typeof record.kind === 'string'
}

export function voiceBridgeEnvelope(kind: VoiceBridgeKind, extra: Readonly<{ text?: string; message?: string }> = {}): VoiceBridgeMessage {
  return { channel: VOICE_BRIDGE_CHANNEL, kind, ...extra }
}

export function voiceBridgePopupUrl(language: 'en' | 'hi'): string {
  const lang = language === 'hi' ? 'hi-IN' : 'en-IN'
  return `/jarvis-mic.html?lang=${lang}`
}

/**
 * Cross-origin iframes (Arena preview, Shopify Admin) usually strip
 * microphone from the child document. A same-origin popup is a top-level
 * browsing context, so getUserMedia and SpeechRecognition work there.
 * Must be called synchronously inside a click handler.
 */
export function reserveVoiceBridge(scope: Window | undefined, language: 'en' | 'hi' = 'en'): Window | null {
  if (!scope || typeof scope.open !== 'function') return null
  try {
    const url = voiceBridgePopupUrl(language)
    const popup = scope.open(url, VOICE_BRIDGE_WINDOW_NAME, 'popup=yes,width=380,height=280,left=72,top=72')
    return popup && !popup.closed ? popup : null
  } catch {
    return null
  }
}

export function startVoiceBridge(options: StartVoiceBridgeOptions): VoiceBridgeSession | null {
  const { scope, popup, onTranscript, onError, onListening, onClosed } = options
  if (popup.closed) return null
  const origin = scope.location?.origin || '*'

  let closed = false
  const post = (kind: VoiceBridgeKind): void => {
    try { popup.postMessage(voiceBridgeEnvelope(kind), origin) } catch { /* ignore */ }
  }
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== origin && origin !== '*') return
    if (event.source !== popup) return
    if (!isVoiceBridgeMessage(event.data)) return
    if (event.data.kind === 'transcript' && event.data.text) onTranscript(event.data.text)
    else if (event.data.kind === 'listening' || event.data.kind === 'ready') onListening()
    else if (event.data.kind === 'denied' || event.data.kind === 'error') onError(event.data.message || 'Could not open the microphone. Allow access and try again.')
    else if (event.data.kind === 'closed') finish()
  }
  const poll = scope.setInterval(() => {
    if (popup.closed) finish()
  }, 400)
  const finish = (): void => {
    if (closed) return
    closed = true
    scope.clearInterval(poll)
    scope.removeEventListener('message', onMessage)
    try { if (!popup.closed) popup.close() } catch { /* ignore */ }
    onClosed()
  }

  scope.addEventListener('message', onMessage)
  try { popup.focus() } catch { /* ignore */ }
  return {
    popup,
    close: finish,
    pause: () => post('pause'),
    resume: () => post('resume'),
  }
}

export function framedMicrophoneNeedsBridge(scope: Window | undefined, documentScope: Document | undefined): boolean {
  if (!isFramed(scope)) return false
  const policy = (documentScope as (Document & { permissionsPolicy?: { allowsFeature(feature: string): boolean } }) | undefined)?.permissionsPolicy
  if (!policy) return true
  try { return !policy.allowsFeature('microphone') } catch { return true }
}
