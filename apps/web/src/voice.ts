export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'sleeping'
export type VoiceGender = 'feminine' | 'masculine'
export type SpeechRecognitionFailure = Readonly<{ code: string; message: string }>
export type MicrophonePreflight = Readonly<{ allowed: boolean; framed: boolean; code: 'ready' | 'insecure' | 'embedded-policy' | 'policy-denied' | 'media-devices-unavailable'; message: string | null }>
export type MicrophoneAccess = Readonly<{
  ok: boolean
  framed: boolean
  code: 'granted' | 'denied' | 'unavailable' | 'insecure' | 'skipped'
  message: string | null
}>
export type SpeechProfile = Readonly<{ rate: number; pitch: number; lang: string }>

type PermissionsPolicyLike = Readonly<{ allowsFeature(feature: string): boolean }>

let heldMicrophoneStream: MediaStream | null = null

export function microphonePreflight(scope: Window | undefined, documentScope: Document | undefined, navigatorScope: Navigator | undefined): MicrophonePreflight {
  const framed = isFramed(scope)
  if (!scope?.isSecureContext) return { allowed: false, framed, code: 'insecure', message: 'Voice requires a secure HTTPS connection.' }
  const policy = (documentScope as (Document & { permissionsPolicy?: PermissionsPolicyLike }) | undefined)?.permissionsPolicy
  if (policy && !safeAllowsMicrophone(policy) && !framed) return { allowed: false, framed, code: 'policy-denied', message: 'Microphone access is blocked by this page policy.' }
  // Framed previews often hide mediaDevices even though a same-origin popup can still capture audio.
  if (!navigatorScope?.mediaDevices && !framed) return { allowed: false, framed, code: 'media-devices-unavailable', message: 'This browser does not expose a microphone device. Use AI Command to type a question.' }
  return { allowed: true, framed, code: 'ready', message: null }
}

/**
 * Ask the browser for the microphone during a user click. SpeechRecognition
 * often fails with `not-allowed` unless getUserMedia has already been granted.
 * The live stream is held so later recognition.start() calls still work after
 * the original click gesture expires.
 */
export async function requestMicrophoneAccess(scope: Window | undefined, navigatorScope: Navigator | undefined): Promise<MicrophoneAccess> {
  const framed = isFramed(scope)
  if (!scope?.isSecureContext) return { ok: false, framed, code: 'insecure', message: 'Voice requires a secure HTTPS connection.' }
  if (heldMicrophoneStream && microphoneStreamLive(heldMicrophoneStream)) return { ok: true, framed, code: 'granted', message: null }
  const getUserMedia = navigatorScope?.mediaDevices?.getUserMedia?.bind(navigatorScope.mediaDevices)
  if (!getUserMedia) {
    if (navigatorScope?.mediaDevices) return { ok: true, framed, code: 'skipped', message: null }
    return { ok: false, framed, code: 'unavailable', message: 'This browser does not expose a microphone device. Use AI Command to type a question.' }
  }
  try {
    heldMicrophoneStream = await openMicrophoneStream(getUserMedia)
    return { ok: true, framed, code: 'granted', message: null }
  } catch (error: unknown) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      const message = framed
        ? 'Tap the microphone again so Jarvis can ask for voice access.'
        : 'Microphone permission was blocked. Allow the mic in the browser prompt, then tap the microphone again.'
      return { ok: false, framed, code: 'denied', message }
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return { ok: false, framed, code: 'unavailable', message: 'No working microphone was found. Check the selected input device and try again.' }
    }
    return { ok: false, framed, code: 'unavailable', message: 'Could not open the microphone. Allow access and try again, or ask in AI Command.' }
  }
}

async function openMicrophoneStream(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>): Promise<MediaStream> {
  try {
    return await getUserMedia({ audio: true, video: false })
  } catch (error: unknown) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' || name === 'NotFoundError' || name === 'DevicesNotFoundError') throw error
    return await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
  }
}

export function releaseMicrophoneAccess(): void {
  if (!heldMicrophoneStream) return
  for (const track of heldMicrophoneStream.getTracks()) {
    try { track.stop() } catch { /* ignore */ }
  }
  heldMicrophoneStream = null
}

export function microphoneStreamHeld(): boolean {
  return microphoneStreamLive(heldMicrophoneStream)
}

function microphoneStreamLive(stream: MediaStream | null): boolean {
  return Boolean(stream && stream.getTracks().some((track) => track.readyState === 'live'))
}

export function standaloneAppUrl(location: Pick<Location, 'href'>): string {
  const url = new URL(location.href)
  for (const parameter of ['id_token', 'hmac', 'signature', 'timestamp', 'embedded', 'host']) url.searchParams.delete(parameter)
  return url.toString()
}

export function isFramed(scope: Window | undefined): boolean {
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
  return text
    .replace(/@jarvis:action\s*\{[\s\S]*$/g, '')
    .replace(/[*_`#]+/g, '')
    .replace(/[—–]/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split a reply into short spoken sentences so TTS pauses like a human. */
export function speechSentences(text: string): readonly string[] {
  const clean = spokenReplyText(text)
  if (!clean) return []
  const parts = clean.split(/(?<=[.!?।])\s+/).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [clean]
}

export function speechProfile(language: 'en' | 'hi', preferredGender: VoiceGender, voiceLang?: string): SpeechProfile {
  return {
    rate: language === 'hi' ? 0.98 : 1.0,
    pitch: preferredGender === 'feminine' ? 1.06 : 1.0,
    lang: voiceLang || (language === 'hi' ? 'hi-IN' : 'en-US'),
  }
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

/**
 * Browser TTS voices load asynchronously — `getVoices()` returns `[]` until the
 * `voiceschanged` event fires. Speaking before that uses the OS default voice,
 * which is the robotic voice merchants hear. This resolves once voices are
 * available (or quickly gives up so speech is never blocked). It is safe in
 * environments without speechSynthesis or the event.
 */
export async function loadSpeechVoices(scope: Window | undefined, timeoutMs = 400): Promise<readonly SpeechSynthesisVoice[]> {
  if (!scope?.speechSynthesis || typeof scope.speechSynthesis.getVoices !== 'function') return []
  const immediate = scope.speechSynthesis.getVoices()
  if (immediate.length > 0) return immediate
  return new Promise<readonly SpeechSynthesisVoice[]>((resolve) => {
    let settled = false
    const finish = (voices: readonly SpeechSynthesisVoice[]): void => { if (!settled) { settled = true; resolve(voices) } }
    const timer = setTimeout(() => finish(scope.speechSynthesis?.getVoices() ?? []), timeoutMs)
    const handler = (): void => {
      const voices = scope.speechSynthesis?.getVoices() ?? []
      if (voices.length > 0) { clearTimeout(timer); finish(voices) }
    }
    try {
      scope.speechSynthesis.addEventListener?.('voiceschanged', handler, { once: true })
    } catch { /* some engines throw on addEventListener; the timeout still resolves */ }
    void timer
  })
}

export function pickSpeechVoice(scope: Window | undefined, language: 'en' | 'hi', preferredGender: VoiceGender = 'feminine'): SpeechSynthesisVoice | null {
  if (!scope?.speechSynthesis || typeof scope.speechSynthesis.getVoices !== 'function') return null
  const voices = scope.speechSynthesis.getVoices()
  if (voices.length === 0) return null
  const preferredTags = language === 'hi'
    ? ['hi-IN', 'hi', 'en-IN', 'en-US', 'en']
    : ['en-US', 'en-GB', 'en-IN', 'en', 'hi-IN', 'hi']
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
  if (voice.default) score += 8
  if (/natural|neural|wavenet|studio|online \(natural\)|premium/i.test(name)) score += 48
  if (/google|microsoft|siri|azure|apple/i.test(name)) score += 28
  if (/online|network/i.test(name)) score += 16
  if (/india|bharat|hindi|hinglish|indian|neerja|swara|heera|ravi/i.test(name)) score += 12
  if (preferredGender === 'feminine' && /female|woman|zira|aria|samantha|serena|heera|priya|sonia|susan|natasha|hazel|jenny|katja|sabrina|ava|alloy|neerja|swara|salli|joanna|ivy/i.test(name)) score += 34
  if (preferredGender === 'masculine' && /male|man|david|mark|ravi|aarav|george|adam|daniel|james|ryan|alex|guy|raj|matthew|brian|eric/i.test(name)) score += 34
  if (preferredGender === 'feminine' && /male|man\b/.test(name)) score -= 18
  if (preferredGender === 'masculine' && /female|woman\b/.test(name)) score -= 18
  if (/compact|espeak|festival|flite/i.test(name)) score -= 30
  if (/novelty|whisper|child|kid|cartoon|monster|robot/i.test(name)) score -= 50
  return score
}

export function applySpeechProfile(utterance: SpeechSynthesisUtterance, language: 'en' | 'hi', preferredGender: VoiceGender, voice: SpeechSynthesisVoice | null): void {
  const profile = speechProfile(language, preferredGender, voice?.lang)
  if (voice) utterance.voice = voice
  utterance.lang = profile.lang
  utterance.rate = profile.rate
  utterance.pitch = profile.pitch
  utterance.volume = 1
}

export function speakNative(scope: Window | undefined, text: string, language: 'en' | 'hi', onEnd?: () => void, preferredGender: VoiceGender = 'feminine'): boolean {
  if (!scope?.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false
  const clean = spokenReplyText(text)
  if (!clean) {
    onEnd?.()
    return false
  }
  const utterance = new SpeechSynthesisUtterance(clean)
  applySpeechProfile(utterance, language, preferredGender, pickSpeechVoice(scope, language, preferredGender))
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
    'not-allowed': 'Microphone permission was denied. Allow the mic in your browser, then tap the microphone again.',
    'service-not-allowed': 'Your browser blocked its speech-recognition service. Check browser privacy settings or ask in AI Command instead.',
    'audio-capture': 'No working microphone was found. Check the selected input device and system permissions.',
    'no-speech': 'No speech was detected. Try again and speak after the listening indicator appears.',
    network: 'Speech recognition lost its network connection. Check connectivity and try again.',
    aborted: 'Voice recognition was stopped before it completed. Try again when you are ready.',
    'language-not-supported': 'The selected speech language is not supported by this browser. Switch language or ask in AI Command.',
  }
  return { code, message: messages[code] ?? `Speech recognition failed (${code}). You can retry voice or ask in AI Command.` }
}
