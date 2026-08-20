export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'sleeping'
export type VoiceGender = 'feminine' | 'masculine'
export type SpeechRecognitionFailure = Readonly<{ code: string; message: string }>
export type MicrophonePreflight = Readonly<{ allowed: boolean; framed: boolean; code: 'ready' | 'insecure' | 'embedded-policy' | 'policy-denied' | 'media-devices-unavailable'; message: string | null }>

type PermissionsPolicyLike = Readonly<{ allowsFeature(feature: string): boolean }>

export function microphonePreflight(scope: Window | undefined, documentScope: Document | undefined, navigatorScope: Navigator | undefined): MicrophonePreflight {
  const framed = isFramed(scope)
  if (!scope?.isSecureContext) return { allowed: false, framed, code: 'insecure', message: 'Voice requires a secure HTTPS connection.' }
  const policy = (documentScope as (Document & { permissionsPolicy?: PermissionsPolicyLike }) | undefined)?.permissionsPolicy
  if (policy && !safeAllowsMicrophone(policy) && !framed) return { allowed: false, framed, code: 'policy-denied', message: 'Microphone access is blocked by this page policy.' }
  if (!navigatorScope?.mediaDevices) return { allowed: false, framed, code: 'media-devices-unavailable', message: 'This browser does not expose a microphone device. Use AI Command to type a question.' }
  return { allowed: true, framed, code: 'ready', message: null }
}

export function standaloneAppUrl(location: Pick<Location, 'href'>): string {
  const url = new URL(location.href)
  for (const parameter of ['id_token', 'hmac', 'signature', 'timestamp', 'embedded', 'host']) url.searchParams.delete(parameter)
  return url.toString()
}

function isFramed(scope: Window | undefined): boolean {
  if (!scope) return false
  try { return scope.self !== scope.top } catch { return true }
}
function safeAllowsMicrophone(policy: PermissionsPolicyLike): boolean {
  try { return policy.allowsFeature('microphone') } catch { return false }
}

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

export function spokenReplyText(text: string): string {
  return text.replace(/@jarvis:action\s*\{[\s\S]*$/g, '').replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim()
}

/** Must run inside a user-gesture handler so Chrome/Safari allow later speak() calls. */
export function unlockSpeechSynthesis(scope: Window | undefined): boolean {
  if (!scope?.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false
  try {
    const silent = new SpeechSynthesisUtterance(' ')
    silent.volume = 0
    silent.rate = 2
    silent.pitch = 1
    scope.speechSynthesis.speak(silent)
    scope.speechSynthesis.cancel()
    void scope.speechSynthesis.getVoices()
    return true
  } catch {
    return false
  }
}

export function pickSpeechVoice(scope: Window | undefined, language: 'en' | 'hi', preferredGender: VoiceGender = 'feminine'): SpeechSynthesisVoice | null {
  if (!scope?.speechSynthesis || typeof scope.speechSynthesis.getVoices !== 'function') return null
  const voices = scope.speechSynthesis.getVoices()
  if (voices.length === 0) return null
  const preferredTags = language === 'hi'
    ? ['hi-IN', 'hi', 'en-IN', 'en']
    : ['en-IN', 'en-GB', 'en-US', 'en', 'hi-IN', 'hi']
  return [...voices].sort((left, right) => scoreVoice(right, preferredTags, preferredGender) - scoreVoice(left, preferredTags, preferredGender))[0] ?? null
}

function scoreVoice(voice: SpeechSynthesisVoice, preferredTags: readonly string[], preferredGender: VoiceGender): number {
  const lang = voice.lang.toLowerCase()
  const name = voice.name.toLowerCase()
  let score = 0
  preferredTags.forEach((tag, index) => {
    const normalized = tag.toLowerCase()
    if (lang === normalized) score = Math.max(score, 220 - index * 20)
    else if (lang.startsWith(`${normalized}-`) || lang.startsWith(normalized)) score = Math.max(score, 180 - index * 18)
  })
  if (voice.default) score += 14
  if (/natural|neural|enhanced|premium|google|microsoft|siri|azure|wavenet/i.test(name)) score += 30
  if (/india|bharat|hindi|hinglish|indian/i.test(name)) score += 12
  if (/online|network/i.test(name)) score += 10
  if (preferredGender === 'feminine' && /female|woman|zira|aria|samantha|serena|heera|priya|sonia|susan|natasha|hazel|jenny|katja|sabrina|ava|alloy|neerja|swara/i.test(name)) score += 26
  if (preferredGender === 'masculine' && /male|man|david|mark|ravi|aarav|george|adam|daniel|james|ryan|alex|guy|raj|guy|neural/i.test(name)) score += 26
  if (preferredGender === 'feminine' && /male|man\b/.test(name)) score -= 10
  if (preferredGender === 'masculine' && /female|woman\b/.test(name)) score -= 10
  if (/novelty|whisper|child|kid|cartoon|monster|robot/i.test(name)) score -= 40
  return score
}

export function speakNative(scope: Window | undefined, text: string, language: 'en' | 'hi', onEnd?: () => void, preferredGender: VoiceGender = 'feminine'): boolean {
  if (!scope?.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false
  const clean = spokenReplyText(text)
  if (!clean) {
    onEnd?.()
    return false
  }
  const utterance = new SpeechSynthesisUtterance(clean)
  const voice = pickSpeechVoice(scope, language, preferredGender)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang || (language === 'hi' ? 'hi-IN' : 'en-IN')
  } else {
    utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN'
  }
  utterance.rate = language === 'hi' ? 1.0 : 1.02
  utterance.pitch = preferredGender === 'feminine' ? 1.12 : 1.02
  utterance.volume = 1
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onEnd?.()
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
    'service-not-allowed': 'Your browser blocked its speech-recognition service. Check browser privacy settings or ask in AI Command instead.',
    'audio-capture': 'No working microphone was found. Check the selected input device and system permissions.',
    'no-speech': 'No speech was detected. Try again and speak after the listening indicator appears.',
    network: 'Speech recognition lost its network connection. Check connectivity and try again.',
    aborted: 'Voice recognition was stopped before it completed. Try again when you are ready.',
    'language-not-supported': 'The selected speech language is not supported by this browser. Switch language or ask in AI Command.',
  }
  return { code, message: messages[code] ?? `Speech recognition failed (${code}). You can retry voice or ask in AI Command.` }
}
