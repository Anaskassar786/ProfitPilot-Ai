/**
 * Jarvis speech output.
 *
 * The browser's `speechSynthesis` API is deceptively hard to use well, and the
 * previous implementation hit every one of its traps — which is why Jarvis
 * looked alive but never actually spoke:
 *
 *  1. Voices load asynchronously. `getVoices()` returns an empty list on the
 *     first call in Chrome/Edge, so an utterance created immediately after page
 *     load was spoken with a null voice — often silently dropped.
 *  2. Autoplay policy. Speech started outside a user gesture is blocked until
 *     the user interacts with the document; the utterance is queued and then
 *     discarded with no error. We "unlock" the engine on the click that opens
 *     Jarvis.
 *  3. Chrome stops speaking after ~15 seconds unless `resume()` is pumped.
 *  4. A pending queue from an earlier utterance blocks new speech, so every
 *     call cancels first, and `speaking && !pending` deadlocks are cleared.
 *  5. Long text is unreliable in one utterance: we split on sentence
 *     boundaries and speak the chunks in order.
 *
 * Everything here is pure DOM — no network, no API keys — and every helper is
 * exported so it can be unit-tested without a browser.
 */

export type SpeechLanguage = 'en' | 'hi'

export type SpeechHandle = Readonly<{ cancel: () => void }>

export type SpeakRequest = Readonly<{
  text: string
  language: SpeechLanguage
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}>

type VoiceLike = Readonly<{ name: string; lang: string; localService?: boolean; default?: boolean }>

const MAX_CHUNK_LENGTH = 190

/** BCP-47 tags we ask for, most specific first. */
export function preferredLocales(language: SpeechLanguage): readonly string[] {
  return language === 'hi' ? ['hi-IN', 'hi', 'en-IN'] : ['en-IN', 'en-GB', 'en-US', 'en']
}

/**
 * Human-sounding voice picker. Cloud/neural voices ("Google", "Natural",
 * "Neural", "Online") sound far closer to a person than the built-in
 * compact voices, so they win; after that we prefer the closest locale.
 */
export function pickPreferredVoice<T extends VoiceLike>(voices: readonly T[], language: SpeechLanguage): T | null {
  if (voices.length === 0) return null
  const locales = preferredLocales(language)
  const score = (voice: T): number => {
    const name = voice.name.toLowerCase()
    const tag = voice.lang.replace('_', '-').toLowerCase()
    const localeIndex = locales.findIndex((locale) => tag === locale.toLowerCase())
    const prefixIndex = locales.findIndex((locale) => tag.startsWith(locale.slice(0, 2).toLowerCase()))
    if (localeIndex === -1 && prefixIndex === -1) return -1
    let total = localeIndex >= 0 ? (locales.length - localeIndex) * 10 : 4
    if (/natural|neural|online|wavenet|studio/.test(name)) total += 9
    if (name.startsWith('google')) total += 7
    if (/microsoft/.test(name)) total += 3
    // Named Indian-English and Hindi voices shipped by Windows/Android.
    if (/(heera|ravi|swara|madhur|prabhat|aarav|kavya|neerja|rishi|veena)/.test(name)) total += 5
    if (/compact|espeak|robot/.test(name)) total -= 6
    if (voice.localService === false) total += 2
    return total
  }
  const ranked = voices.map((voice) => ({ voice, rank: score(voice) })).filter((entry) => entry.rank >= 0).sort((left, right) => right.rank - left.rank)
  return ranked[0]?.voice ?? null
}

/**
 * Splits a spoken reply into utterance-sized chunks on sentence boundaries so
 * long answers do not get truncated by the synthesiser.
 */
export function chunkSpeech(text: string, maxLength = MAX_CHUNK_LENGTH): readonly string[] {
  const clean = normalizeForSpeech(text)
  if (!clean) return []
  if (clean.length <= maxLength) return [clean]
  const sentences = clean.match(/[^.!?।]+[.!?।]*\s*/g) ?? [clean]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const piece = sentence.trim()
    if (!piece) continue
    if (current && `${current} ${piece}`.length > maxLength) { chunks.push(current); current = piece }
    else current = current ? `${current} ${piece}` : piece
    while (current.length > maxLength) { chunks.push(current.slice(0, maxLength)); current = current.slice(maxLength).trim() }
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * Strips anything that sounds wrong when read aloud. Jarvis answers are spoken
 * only, so markdown, ids, and URLs must never reach the synthesiser.
 */
export function normalizeForSpeech(text: string): string {
  return text
    .replace(/@jarvis:action\s*\{[\s\S]*$/i, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#`>|]/g, ' ')
    .replace(/\s*[-•]\s+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function speechSynthesisAvailable(scope: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  return Boolean(scope?.speechSynthesis) && typeof SpeechSynthesisUtterance !== 'undefined'
}

let voicesPromise: Promise<readonly SpeechSynthesisVoice[]> | null = null

/** Resolves once the browser has published its voice list (or we give up). */
export function loadVoices(scope: Window | undefined = typeof window === 'undefined' ? undefined : window, timeoutMs = 2_000): Promise<readonly SpeechSynthesisVoice[]> {
  if (!scope?.speechSynthesis) return Promise.resolve([])
  const synthesis = scope.speechSynthesis
  const immediate = safeVoices(synthesis)
  if (immediate.length > 0) return Promise.resolve(immediate)
  if (voicesPromise) return voicesPromise
  voicesPromise = new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      synthesis.removeEventListener?.('voiceschanged', finish)
      voicesPromise = null
      resolve(safeVoices(synthesis))
    }
    synthesis.addEventListener?.('voiceschanged', finish)
    // Embedded/stubbed windows may not expose timers; resolve straight away.
    if (typeof scope.setTimeout === 'function') scope.setTimeout(finish, timeoutMs)
    else finish()
  })
  return voicesPromise
}

function safeVoices(synthesis: SpeechSynthesis): readonly SpeechSynthesisVoice[] {
  try { return synthesis.getVoices() ?? [] } catch { return [] }
}

/**
 * Must run inside a real user gesture (the click that opens Jarvis). It warms
 * the voice list and satisfies the browser's autoplay policy so the first real
 * reply is actually audible instead of being silently swallowed.
 */
export function unlockSpeech(scope: Window | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (!speechSynthesisAvailable(scope) || !scope) return
  try {
    void loadVoices(scope)
    const primer = new SpeechSynthesisUtterance(' ')
    primer.volume = 0
    primer.rate = 2
    scope.speechSynthesis.cancel()
    scope.speechSynthesis.speak(primer)
    // Some engines leave the queue "pending" after a muted primer.
    scope.setTimeout?.(() => { try { scope.speechSynthesis.cancel() } catch { /* ignore */ } }, 250)
  } catch { /* speech is optional — the widget still works silently */ }
}

let activeRun = 0
let keepAliveTimer: ReturnType<typeof setInterval> | null = null

function startKeepAlive(scope: Window): void {
  stopKeepAlive()
  // Chrome pauses long utterances after ~15s unless resume() is pumped.
  if (typeof scope.setInterval !== 'function') return
  keepAliveTimer = scope.setInterval(() => {
    try {
      const synthesis = scope.speechSynthesis
      if (synthesis.speaking && !synthesis.pending) synthesis.resume()
    } catch { /* ignore */ }
  }, 6_000) as unknown as ReturnType<typeof setInterval>
}

function stopKeepAlive(): void {
  if (keepAliveTimer !== null) { clearInterval(keepAliveTimer); keepAliveTimer = null }
}

/** Cancels anything Jarvis is currently saying. */
export function stopSpeaking(scope: Window | undefined = typeof window === 'undefined' ? undefined : window): void {
  activeRun += 1
  stopKeepAlive()
  try { scope?.speechSynthesis?.cancel() } catch { /* ignore */ }
}

/**
 * Speaks a reply out loud. Resolves (via `onEnd`) when the last chunk finishes,
 * when the browser errors, or when a watchdog decides nothing is coming — the
 * caller can then safely resume listening.
 */
export function speak(request: SpeakRequest, scope: Window | undefined = typeof window === 'undefined' ? undefined : window): SpeechHandle {
  const chunks = chunkSpeech(request.text)
  if (!scope || !speechSynthesisAvailable(scope) || chunks.length === 0) {
    request.onError?.('This browser cannot speak out loud.')
    request.onEnd?.()
    return { cancel: () => undefined }
  }
  activeRun += 1
  const run = activeRun
  const synthesis = scope.speechSynthesis
  try { synthesis.cancel() } catch { /* ignore */ }

  let finished = false
  const finish = (): void => {
    if (finished || run !== activeRun) return
    finished = true
    stopKeepAlive()
    request.onEnd?.()
  }

  void loadVoices(scope).then((voices) => {
    if (run !== activeRun) return
    const voice = pickPreferredVoice(voices, request.language)
    let index = 0
    let started = false

    const speakChunk = (): void => {
      if (run !== activeRun) return
      const chunk = chunks[index]
      if (chunk === undefined) { finish(); return }
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.lang = voice?.lang ?? (request.language === 'hi' ? 'hi-IN' : 'en-IN')
      if (voice) utterance.voice = voice as SpeechSynthesisVoice
      // Slightly slower than default with a natural pitch reads as calm and
      // human rather than clipped and robotic.
      utterance.rate = request.language === 'hi' ? 0.95 : 1
      utterance.pitch = 1
      utterance.volume = 1
      utterance.onstart = () => { if (!started) { started = true; request.onStart?.() } }
      utterance.onend = () => { index += 1; speakChunk() }
      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        // "interrupted"/"canceled" are our own cancel() calls, not failures.
        if (event.error && event.error !== 'interrupted' && event.error !== 'canceled') request.onError?.(speechErrorMessage(event.error))
        finish()
      }
      try { synthesis.speak(utterance) } catch { request.onError?.('Voice output failed to start.'); finish() }
    }

    startKeepAlive(scope)
    speakChunk()

    // Watchdog: if the engine never fires `onstart` the utterance was dropped
    // (blocked autoplay, missing voice pack). Report it once and release the
    // microphone instead of leaving Jarvis stuck in "speaking".
    scope.setTimeout?.(() => {
      if (run !== activeRun || started || finished) return
      request.onError?.('Voice output is blocked in this browser view.')
      finish()
    }, 2_500)
  })

  return { cancel: () => { if (run === activeRun) stopSpeaking(scope) } }
}

export function speechErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'audio-busy') return 'The browser blocked audio output. Click Jarvis once more to allow sound.'
  if (code === 'language-unavailable' || code === 'voice-unavailable') return 'No voice pack is installed for this language.'
  if (code === 'synthesis-failed' || code === 'synthesis-unavailable') return 'Voice output failed in this browser.'
  return 'Voice output is unavailable right now.'
}
