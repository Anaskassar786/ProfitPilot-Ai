export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'sleeping'
export type SpeechRecognitionFailure = Readonly<{ code: string; message: string }>

type NativeSpeechResult = Readonly<{ transcript: string }>
type NativeSpeechEvent = Readonly<{ results: readonly Readonly<{ 0?: NativeSpeechResult; length: number }>[] }>
export interface NativeSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: Readonly<{ error?: string }>) => void) | null
  onresult: ((event: NativeSpeechEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type NativeSpeechRecognitionConstructor = new () => NativeSpeechRecognition

declare global {
  interface Window {
    SpeechRecognition?: NativeSpeechRecognitionConstructor
    webkitSpeechRecognition?: NativeSpeechRecognitionConstructor
  }
}

export function speechRecognitionAvailable(scope: Window | undefined): boolean { return Boolean(scope?.SpeechRecognition || scope?.webkitSpeechRecognition) }

export function createSpeechRecognition(scope: Window | undefined): NativeSpeechRecognition | null {
  const Constructor = scope?.SpeechRecognition || scope?.webkitSpeechRecognition
  return Constructor ? new Constructor() : null
}

export function speakNative(scope: Window | undefined, text: string, language: 'en' | 'hi', onEnd?: () => void): boolean {
  if (!scope?.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN'
  utterance.onend = () => onEnd?.()
  scope.speechSynthesis.cancel()
  scope.speechSynthesis.speak(utterance)
  return true
}

export function stopNativeSpeech(scope: Window | undefined): void { scope?.speechSynthesis?.cancel() }

export function transcriptFromEvent(event: NativeSpeechEvent): string {
  return [...event.results].map((result) => result[0]?.transcript ?? '').join(' ').trim()
}

/** Preserve the browser code and turn it into recovery guidance. */
export function speechRecognitionFailure(codeValue: string | undefined): SpeechRecognitionFailure {
  const code = codeValue?.trim() || 'unknown'
  const messages: Readonly<Record<string, string>> = {
    'not-allowed': 'Microphone permission was denied. Allow microphone access; if Shopify Admin blocks the embedded frame, open ProfitPilot in a new tab.',
    'service-not-allowed': 'Your browser blocked its speech-recognition service. Check browser privacy settings or type your message instead.',
    'audio-capture': 'No working microphone was found. Check the selected input device and system permissions.',
    'no-speech': 'No speech was detected. Try again and speak after the listening indicator appears.',
    network: 'Speech recognition lost its network connection. Check connectivity and try again.',
    aborted: 'Voice recognition was stopped before it completed. Try again when you are ready.',
    'language-not-supported': 'The selected speech language is not supported by this browser. Switch language or type your message.',
  }
  return { code, message: messages[code] ?? `Speech recognition failed (${code}). You can retry or type your message.` }
}
