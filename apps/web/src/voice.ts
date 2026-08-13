export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'sleeping'

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
