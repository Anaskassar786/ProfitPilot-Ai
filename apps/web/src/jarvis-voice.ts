import { useEffect, useSyncExternalStore } from 'react'
import type { VoiceStatus as NativeVoiceStatus } from './voice.js'
import {
  applySpeechProfile,
  createSpeechRecognition,
  loadSpeechVoices,
  pickSpeechVoice,
  releaseMicrophoneAccess,
  requestMicrophoneAccess,
  speechRecognitionAvailable,
  speechRecognitionFailure,
  spokenReplyText,
  stopNativeSpeech,
  unlockSpeechSynthesis,
} from './voice.js'
import type { NativeSpeechRecognition } from './voice.js'
import { synthesizeJarvisSpeech } from './api.js'
import { framedMicrophoneNeedsBridge, reserveVoiceBridge, startVoiceBridge } from './jarvis-voice-bridge.js'
import type { VoiceBridgeSession } from './jarvis-voice-bridge.js'
import { isEchoOfSpoken, isLikelyBargeIn, isStartupGreeting } from './jarvis-intents.js'

/**
 * Voice status shown by the floating strip.
 * `paused` means the user asked Jarvis to stay quiet in the background.
 */
export type FloatingVoiceStatus = NativeVoiceStatus | 'paused'

export type VoiceBlock = 'insecure' | 'embedded-policy' | 'policy-denied' | 'media-devices-unavailable' | null

type TranscriptHandler = (transcript: string) => void | Promise<void>
type SpeakOptions = Readonly<{
  text: string
  language?: 'en' | 'hi'
  muted?: boolean
  voiceGender?: 'feminine' | 'masculine'
  storeId?: string
  /** When false, a new line will not cut off speech that is already playing. */
  interrupt?: boolean
}>

export type JarvisVoiceProfile = Readonly<{ language: 'en' | 'hi'; gender: 'feminine' | 'masculine' }>

type VoiceController = Readonly<{
  active: boolean
  status: FloatingVoiceStatus
  error: string | null
  block: VoiceBlock
  muted: boolean
  framed: boolean
  lastSpoken: string | null
  start: (options: Readonly<{ language: 'en' | 'hi'; onTranscript: TranscriptHandler; onError: (message: string) => void }>) => Promise<boolean>
  stop: () => void
  setProcessing: () => void
  speak: (options: SpeakOptions, onEnd?: () => void) => void
  stopSpeaking: () => void
  setMuted: (muted: boolean) => void
  /** Pauses background listening without tearing the session down. */
  setPaused: (paused: boolean) => void
  setBlock: (block: VoiceBlock, framed: boolean) => void
  /** Switch recognition language while a session is active. */
  setLanguage: (language: 'en' | 'hi') => void
  /** Must run inside a click handler so the browser allows speech + mic. */
  unlock: () => void
}>

let recognition: NativeSpeechRecognition | null = null
let bridgeSession: VoiceBridgeSession | null = null
let onTranscriptRef: TranscriptHandler | null = null
let onErrorRef: ((message: string) => void) | null = null
let currentUtterance: SpeechSynthesisUtterance | null = null
let speakGeneration = 0
let resumeTimer: ReturnType<typeof setInterval> | null = null
let speakEndTimer: ReturnType<typeof setTimeout> | null = null
let pendingLanguage: 'en' | 'hi' = 'en'
let startGeneration = 0
// Disable cloud TTS only after several consecutive failures. A single 503
// used to pin the session to choppy browser speechSynthesis.
let cloudTtsDisabled = false
let cloudTtsFailures = 0
let cloudAudio: HTMLAudioElement | null = null
let lastDedupText = ''
let lastDedupAt = 0
let bargeInArmedAt = 0
let restartTimer: ReturnType<typeof setTimeout> | null = null
let pendingBargeIn = ''
let voiceProfile: JarvisVoiceProfile = { language: 'en', gender: 'feminine' }

export function setJarvisVoiceProfile(next: Partial<JarvisVoiceProfile>): void {
  voiceProfile = {
    language: next.language ?? voiceProfile.language,
    gender: next.gender ?? voiceProfile.gender,
  }
}

export function getJarvisVoiceProfile(): JarvisVoiceProfile {
  return voiceProfile
}

export function retryCloudSpeech(): void {
  cloudTtsDisabled = false
  cloudTtsFailures = 0
}

export function __resetJarvisVoiceDedupForTests(): void {
  lastDedupText = ''
  lastDedupAt = 0
}

export function __resetJarvisVoiceProfileForTests(): void {
  voiceProfile = { language: 'en', gender: 'feminine' }
}

export function __armJarvisBargeInForTests(): void {
  bargeInArmedAt = 0
}

let state = {
  active: false,
  status: 'idle' as FloatingVoiceStatus,
  error: null as string | null,
  block: null as VoiceBlock,
  muted: false,
  framed: false,
  lastSpoken: null as string | null,
}
const listeners = new Set<() => void>()
function setState(patch: Partial<typeof state>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}
function updateState(updater: (current: typeof state) => Partial<typeof state>): void {
  state = { ...state, ...updater(state) }
  for (const listener of listeners) listener()
}

function clearRestartTimer(): void {
  if (restartTimer === null) return
  clearTimeout(restartTimer)
  restartTimer = null
}

function teardownRecognition(): void {
  clearRestartTimer()
  pendingBargeIn = ''
  if (recognition) {
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.onstart = null
    try { recognition.abort() } catch { /* ignore */ }
    recognition = null
  }
}

function teardownBridge(): void {
  if (!bridgeSession) return
  const session = bridgeSession
  bridgeSession = null
  session.close()
}

function pauseBridge(): void {
  bridgeSession?.pause()
}

function resumeBridge(): void {
  bridgeSession?.resume()
}

function clearSpeakKeepAlive(): void {
  if (resumeTimer !== null) {
    clearInterval(resumeTimer)
    resumeTimer = null
  }
  if (speakEndTimer !== null) {
    clearTimeout(speakEndTimer)
    speakEndTimer = null
  }
}

function shouldKeepListening(): boolean {
  return state.active && state.status !== 'paused' && state.status !== 'processing' && state.status !== 'error'
}

function scheduleRecognitionRestart(language: 'en' | 'hi'): void {
  clearRestartTimer()
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (!shouldKeepListening() || recognition) return
    startRecognition(language)
  }, 160)
}

function handleHeardSpeech(transcript: string, isFinal: boolean): void {
  const clean = transcript.replace(/\s+/g, ' ').trim()
  if (!clean) return

  if (state.status === 'speaking') {
    if (Date.now() < bargeInArmedAt) return
    if (isEchoOfSpoken(clean, state.lastSpoken)) return
    if (!isLikelyBargeIn(clean) && !pendingBargeIn) return
    interruptSpeaking()
    if (isFinal) {
      pendingBargeIn = ''
      if (onTranscriptRef) void onTranscriptRef(clean)
      return
    }
    pendingBargeIn = clean
    return
  }

  if (state.status === 'processing' || state.status === 'paused') return
  if (!isFinal) return
  const heard = pendingBargeIn && clean.length < pendingBargeIn.length ? pendingBargeIn : clean
  pendingBargeIn = ''
  if (onTranscriptRef) void onTranscriptRef(heard)
}

function interruptSpeaking(): void {
  speakGeneration += 1
  clearSpeakKeepAlive()
  teardownCloudAudio()
  currentUtterance = null
  stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
  if (state.status === 'speaking') setState({ status: 'listening' })
}

function startRecognition(language: 'en' | 'hi'): void {
  teardownRecognition()
  if (typeof window === 'undefined') return
  pendingLanguage = language
  const next = createSpeechRecognition(window)
  if (!next) {
    setState({ status: 'error', error: 'Voice input is not available in this browser. Use AI Command to type a question.' })
    return
  }
  recognition = next
  next.lang = language === 'hi' ? 'hi-IN' : 'en-IN'
  next.continuous = true
  next.interimResults = true
  next.onstart = () => {
    if (state.status === 'speaking' || state.status === 'processing' || state.status === 'paused') return
    setState({ status: 'listening', error: null })
  }
  next.onresult = (event) => {
    const last = event.results[event.results.length - 1]
    const transcript = last?.[0]?.transcript ?? [...event.results].map((result) => result[0]?.transcript ?? '').join(' ')
    handleHeardSpeech(transcript, last?.isFinal !== false)
  }
  next.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') {
      updateState((current) => ({ status: current.status === 'listening' ? 'idle' : current.status }))
      return
    }
    const failure = speechRecognitionFailure(event.error)
    setState({ status: 'error', error: failure.message })
    onErrorRef?.(failure.message)
  }
  next.onend = () => {
    recognition = null
    if (state.status === 'listening') updateState((current) => ({ status: current.status === 'listening' ? 'idle' : current.status }))
    if (shouldKeepListening()) scheduleRecognitionRestart(pendingLanguage)
  }
  if (state.status !== 'speaking' && state.status !== 'processing' && state.status !== 'paused') {
    setState({ status: 'listening', error: null })
  }
  try {
    next.start()
  } catch {
    setState({ status: 'error', error: 'Could not start the microphone. Allow access and try again.' })
  }
}

function finishSpeaking(generation: number, onEnd?: () => void): void {
  if (generation !== speakGeneration) return
  clearSpeakKeepAlive()
  currentUtterance = null
  updateState((current) => ({ status: current.status === 'speaking' ? 'idle' : current.status }))
  onEnd?.()
}

/** Releases a finished cloud audio element and its object URL. */
function teardownCloudAudio(): void {
  if (!cloudAudio) return
  const src = cloudAudio.currentSrc || cloudAudio.src
  try { cloudAudio.pause() } catch { /* ignore */ }
  try { cloudAudio.src = '' } catch { /* ignore */ }
  try { if (src.startsWith('blob:')) URL.revokeObjectURL(src) } catch { /* ignore */ }
  cloudAudio = null
}

/** Plays natural cloud speech; falls back to the browser voice on any failure. */
function playCloudAudio(url: string, generation: number, fallback: () => void, onEnd?: () => void): void {
  if (generation !== speakGeneration || typeof window === 'undefined') {
    try { URL.revokeObjectURL(url) } catch { /* ignore */ }
    return
  }
  const audio = new Audio(url)
  audio.preload = 'auto'
  cloudAudio = audio
  const safeEnd = (): void => { if (generation !== speakGeneration) return; teardownCloudAudio(); finishSpeaking(generation, onEnd) }
  audio.onended = safeEnd
  audio.onerror = () => { teardownCloudAudio(); fallback() }
  const playPromise = audio.play()
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise.then(() => undefined).catch(() => { teardownCloudAudio(); fallback() })
  }
  // Guard against browsers that never fire `ended` for short clips.
  clearSpeakKeepAlive()
  speakEndTimer = setTimeout(() => {
    if (generation !== speakGeneration) return
    if (cloudAudio && cloudAudio.ended) return
    if (cloudAudio && !cloudAudio.paused) return
    teardownCloudAudio(); finishSpeaking(generation, onEnd)
  }, Math.max(8_000, (url.length || 0) * 200))
}

/** Native browser voice — one full utterance, never chopped into sentences. */
function startNativeQueue(scope: Window, clean: string, language: 'en' | 'hi', gender: 'feminine' | 'masculine', generation: number, onEnd?: () => void): void {
  void loadSpeechVoices(scope).finally(() => {
    if (generation !== speakGeneration) return
    const utterance = new SpeechSynthesisUtterance(clean)
    applySpeechProfile(utterance, language, gender, pickSpeechVoice(scope, language, gender))
    utterance.onend = () => finishSpeaking(generation, onEnd)
    utterance.onerror = () => finishSpeaking(generation, onEnd)
    currentUtterance = utterance
    try {
      scope.speechSynthesis.speak(utterance)
    } catch {
      finishSpeaking(generation, onEnd)
      return
    }
    clearSpeakKeepAlive()
    resumeTimer = setInterval(() => {
      if (generation !== speakGeneration || typeof window === 'undefined') return
      if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
        try { window.speechSynthesis.resume() } catch { /* ignore */ }
      }
    }, 4_000)
    const estimatedMs = Math.min(60_000, Math.max(4_000, clean.length * 80))
    speakEndTimer = setTimeout(() => {
      if (generation !== speakGeneration) return
      if (typeof window !== 'undefined' && window.speechSynthesis.speaking) return
      finishSpeaking(generation, onEnd)
    }, estimatedMs)
  })
}

function noteCloudSpeechFailure(): void {
  cloudTtsFailures += 1
  if (cloudTtsFailures >= 3) cloudTtsDisabled = true
}

/** Fetches the natural cloud voice. Disable only after 3 consecutive failures. */
async function fetchCloudSpeech(storeId: string, clean: string, gender: 'feminine' | 'masculine', language: 'en' | 'hi', generation: number): Promise<string | null> {
  try {
    const url = await synthesizeJarvisSpeech(storeId, clean, gender, language)
    if (!url) {
      noteCloudSpeechFailure()
      return null
    }
    cloudTtsFailures = 0
    return generation === speakGeneration ? url : null
  } catch {
    noteCloudSpeechFailure()
    return null
  }
}

export const jarvisVoiceController: VoiceController = {
  get active() { return state.active },
  get status() { return state.status },
  get error() { return state.error },
  get block() { return state.block },
  get muted() { return state.muted },
  get framed() { return state.framed },
  get lastSpoken() { return state.lastSpoken },
  unlock() {
    if (typeof window === 'undefined') return
    unlockSpeechSynthesis(window)
  },
  async start({ language, onTranscript, onError }) {
    onTranscriptRef = onTranscript
    onErrorRef = onError
    pendingLanguage = language
    startGeneration += 1
    const generation = startGeneration
    if (typeof window !== 'undefined') unlockSpeechSynthesis(window)
    retryCloudSpeech()

    const needsBridge = typeof window !== 'undefined' && framedMicrophoneNeedsBridge(window, typeof document === 'undefined' ? undefined : document)

    // Try to own the microphone in THIS page first. getUserMedia reliably
    // surfaces the browser permission prompt in the main tab (and in modern
    // preview iframes that allow the mic), which is what merchants expect.
    const access = await requestMicrophoneAccess(typeof window === 'undefined' ? undefined : window, typeof navigator === 'undefined' ? undefined : navigator)
    if (generation !== startGeneration) return false
    if (access.ok) {
      teardownBridge()
      setState({ active: true, error: null, framed: access.framed })
      startRecognition(language)
      return true
    }

    // The page could not own the mic and we are framed — open a same-origin
    // popup while we still have the click gesture so the browser prompt can
    // appear in a top-level browsing context.
    if (needsBridge) {
      teardownRecognition()
      teardownBridge()
      const popup = reserveVoiceBridge(window, language)
      const session = popup ? startVoiceBridge({
        scope: window,
        popup,
        language,
        onTranscript: (transcript) => handleHeardSpeech(transcript, true),
        onError: (message) => {
          setState({ status: 'error', error: message })
          onErrorRef?.(message)
        },
        onListening: () => setState({ status: 'listening', error: null }),
        onClosed: () => {
          if (bridgeSession?.popup === popup) {
            bridgeSession = null
            updateState((current) => ({ active: false, status: current.status === 'speaking' ? current.status : 'idle' }))
          }
        },
      }) : null
      if (session && generation === startGeneration) {
        bridgeSession = session
        setState({ active: true, status: 'listening', error: null, framed: true })
        return true
      }
    }

    // Fall back to in-page recognition when the page supports it even though
    // getUserMedia was skipped/unavailable (some engines split the two).
    if (access.code !== 'denied' && typeof window !== 'undefined' && speechRecognitionAvailable(window)) {
      teardownBridge()
      setState({ active: true, error: null, framed: access.framed })
      startRecognition(language)
      return true
    }

    const message = needsBridge
      ? 'Tap the microphone again so Jarvis can ask for voice access.'
      : (access.message ?? 'Microphone permission was denied.')
    setState({ active: false, status: 'error', error: message, framed: access.framed })
    onError?.(message)
    return false
  },
  stop() {
    startGeneration += 1
    speakGeneration += 1
    teardownRecognition()
    teardownBridge()
    clearSpeakKeepAlive()
    teardownCloudAudio()
    stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
    releaseMicrophoneAccess()
    currentUtterance = null
    onTranscriptRef = null
    onErrorRef = null
    lastDedupText = ''
    lastDedupAt = 0
    setState({ active: false, status: 'idle', error: null })
  },
  setProcessing() {
    if (state.active) {
      teardownRecognition()
      pauseBridge()
      setState({ status: 'processing' })
    }
  },
  speak(options, onEnd) {
    const { text, muted } = options
    const language = options.language ?? voiceProfile.language
    const gender = options.voiceGender ?? voiceProfile.gender
    const clean = spokenReplyText(text)
    if (clean) setState({ lastSpoken: clean })
    const silenced = muted ?? state.muted
    if (!clean || silenced || typeof window === 'undefined' || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    const interrupt = options.interrupt !== false
    if (!interrupt && (state.status === 'speaking' || state.status === 'processing')) {
      onEnd?.()
      return
    }
    const alreadySpeaking = state.status === 'speaking' && clean === lastDedupText
    const dedupMs = isStartupGreeting(clean) ? 12_000 : 2_500
    if (alreadySpeaking || (clean === lastDedupText && Date.now() - lastDedupAt < dedupMs)) {
      onEnd?.()
      return
    }
    lastDedupText = clean
    lastDedupAt = Date.now()
    speakGeneration += 1
    const generation = speakGeneration
    pendingLanguage = language
    pendingBargeIn = ''
    bargeInArmedAt = Date.now() + Math.min(3_500, 600 + 18 * clean.length)
    // Keep the mic open so the merchant can barge in mid-reply.
    if (state.active && !recognition && !bridgeSession) startRecognition(language)
    setState({ status: 'speaking', lastSpoken: clean })
    teardownCloudAudio()
    if (interrupt) window.speechSynthesis.cancel()
    const storeId = options.storeId
    // Natural cloud voice first (like ChatGPT). Do not unlockSpeechSynthesis
    // here — cancel()+speak() races the real utterance.
    const nativeFallback = (): void => startNativeQueue(window, clean, language, gender, generation, onEnd)
    if (storeId && !cloudTtsDisabled) {
      void fetchCloudSpeech(storeId, clean, gender, language, generation).then((url) => {
        if (generation !== speakGeneration) { if (url) { try { URL.revokeObjectURL(url) } catch { /* ignore */ } } return }
        if (url) playCloudAudio(url, generation, nativeFallback, onEnd)
        else nativeFallback()
      })
      return
    }
    nativeFallback()
  },
  stopSpeaking() {
    interruptSpeaking()
    if (state.active && state.status === 'listening') return
    if (state.active && state.status === 'speaking') setState({ status: 'idle' })
  },
  setMuted(muted) {
    setState({ muted })
    if (muted) {
      speakGeneration += 1
      clearSpeakKeepAlive()
      teardownCloudAudio()
      stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
      if (state.status === 'speaking') setState({ status: 'idle' })
    }
  },
  setPaused(paused) {
    if (paused) {
      speakGeneration += 1
      teardownRecognition()
      pauseBridge()
      clearSpeakKeepAlive()
      teardownCloudAudio()
      stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
      setState({ status: 'paused' })
    } else if (state.active) {
      setState({ status: 'idle' })
      if (bridgeSession) resumeBridge()
      else startRecognition(pendingLanguage)
    }
  },
  setBlock(block, framed) {
    setState({ block, framed })
  },
  setLanguage(language) {
    const already = pendingLanguage === language
    pendingLanguage = language
    if (!state.active || state.status === 'paused' || state.status === 'processing') return
    if (bridgeSession) return
    if (already && recognition) return
    startRecognition(language)
  },
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useJarvisVoice(): VoiceController {
  useSyncExternalStore(subscribe, () => state, () => state)
  return jarvisVoiceController
}

export function useJarvisVoiceSnapshot(): typeof state {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/**
 * Restarts recognition after a spoken exchange so Jarvis keeps listening
 * across page navigations. No-op when voice is inactive or paused.
 */
export function resumeJarvisListening(language: 'en' | 'hi'): void {
  if (!state.active || state.status === 'paused' || state.status === 'speaking' || state.status === 'processing') return
  pendingLanguage = language
  if (bridgeSession) {
    resumeBridge()
    return
  }
  if (recognition) return
  startRecognition(language)
}

export function useJarvisVoiceTeardown(): void {
  useEffect(() => () => {
    startGeneration += 1
    speakGeneration += 1
    teardownRecognition()
    teardownBridge()
    clearSpeakKeepAlive()
    teardownCloudAudio()
    releaseMicrophoneAccess()
    onTranscriptRef = null
    onErrorRef = null
  }, [])
}
