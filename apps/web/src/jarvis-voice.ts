import { useEffect, useSyncExternalStore } from 'react'
import type { VoiceStatus as NativeVoiceStatus } from './voice.js'
import {
  applySpeechProfile,
  createSpeechRecognition,
  pickSpeechVoice,
  releaseMicrophoneAccess,
  requestMicrophoneAccess,
  speechRecognitionAvailable,
  speechRecognitionFailure,
  speechSentences,
  spokenReplyText,
  stopNativeSpeech,
  unlockSpeechSynthesis,
} from './voice.js'
import type { NativeSpeechRecognition } from './voice.js'
import { framedMicrophoneNeedsBridge, reserveVoiceBridge, startVoiceBridge } from './jarvis-voice-bridge.js'
import type { VoiceBridgeSession } from './jarvis-voice-bridge.js'

/**
 * Voice status shown by the floating strip.
 * `paused` means the user asked Jarvis to stay quiet in the background.
 */
export type FloatingVoiceStatus = NativeVoiceStatus | 'paused'

export type VoiceBlock = 'insecure' | 'embedded-policy' | 'policy-denied' | 'media-devices-unavailable' | null

type TranscriptHandler = (transcript: string) => void | Promise<void>
type SpeakOptions = Readonly<{ text: string; language: 'en' | 'hi'; muted?: boolean; voiceGender?: 'feminine' | 'masculine' }>

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

function teardownRecognition(): void {
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
  next.continuous = false
  next.interimResults = false
  next.onstart = () => setState({ status: 'listening', error: null })
  next.onresult = (event) => {
    const transcript = [...event.results].map((result) => result[0]?.transcript ?? '').join(' ').trim()
    if (transcript && onTranscriptRef) void onTranscriptRef(transcript)
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
    updateState((current) => ({ status: current.status === 'listening' ? 'idle' : current.status }))
    recognition = null
  }
  setState({ status: 'listening', error: null })
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

function speakSentenceQueue(scope: Window, sentences: readonly string[], language: 'en' | 'hi', gender: 'feminine' | 'masculine', generation: number, index: number, onEnd?: () => void): void {
  if (generation !== speakGeneration) return
  const sentence = sentences[index]
  if (!sentence) {
    finishSpeaking(generation, onEnd)
    return
  }
  const utterance = new SpeechSynthesisUtterance(sentence)
  applySpeechProfile(utterance, language, gender, pickSpeechVoice(scope, language, gender))
  utterance.onend = () => {
    if (generation !== speakGeneration) return
    if (index + 1 >= sentences.length) {
      finishSpeaking(generation, onEnd)
      return
    }
    window.setTimeout(() => speakSentenceQueue(scope, sentences, language, gender, generation, index + 1, onEnd), 160)
  }
  utterance.onerror = () => finishSpeaking(generation, onEnd)
  currentUtterance = utterance
  try {
    scope.speechSynthesis.speak(utterance)
  } catch {
    finishSpeaking(generation, onEnd)
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

    // Iframes (preview / Shopify Admin) usually cannot own the microphone.
    // Open a same-origin popup while we still have the click gesture.
    const needsBridge = typeof window !== 'undefined' && framedMicrophoneNeedsBridge(window, typeof document === 'undefined' ? undefined : document)
    if (needsBridge) {
      teardownRecognition()
      teardownBridge()
      const popup = reserveVoiceBridge(window)
      const session = popup ? startVoiceBridge({
        scope: window,
        popup,
        language,
        onTranscript: (transcript) => { if (onTranscriptRef) void onTranscriptRef(transcript) },
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

    const access = await requestMicrophoneAccess(typeof window === 'undefined' ? undefined : window, typeof navigator === 'undefined' ? undefined : navigator)
    if (generation !== startGeneration) return false
    if (access.ok) {
      teardownBridge()
      setState({ active: true, error: null, framed: access.framed })
      startRecognition(language)
      return true
    }

    // Only fall back to in-page recognition when the page itself can own the mic.
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
    stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
    releaseMicrophoneAccess()
    currentUtterance = null
    onTranscriptRef = null
    onErrorRef = null
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
    const { text, language, muted } = options
    const clean = spokenReplyText(text)
    if (clean) setState({ lastSpoken: clean })
    const silenced = muted ?? state.muted
    if (!clean || silenced || typeof window === 'undefined' || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    speakGeneration += 1
    const generation = speakGeneration
    pendingLanguage = language
    teardownRecognition()
    pauseBridge()
    setState({ status: 'speaking', lastSpoken: clean })
    unlockSpeechSynthesis(window)
    window.speechSynthesis.cancel()
    // Chrome drops the next utterance if speak() runs in the same turn as cancel().
    setTimeout(() => {
      if (generation !== speakGeneration) return
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        finishSpeaking(generation, onEnd)
        return
      }
      const gender = options.voiceGender ?? 'feminine'
      const sentences = speechSentences(clean)
      speakSentenceQueue(window, sentences, language, gender, generation, 0, onEnd)
      // Chrome silently pauses long utterances. Keep the queue alive.
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
    }, 80)
  },
  stopSpeaking() {
    speakGeneration += 1
    clearSpeakKeepAlive()
    currentUtterance = null
    stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
    if (state.active && state.status === 'speaking') setState({ status: 'idle' })
  },
  setMuted(muted) {
    setState({ muted })
    if (muted) {
      speakGeneration += 1
      clearSpeakKeepAlive()
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
  if (bridgeSession) {
    resumeBridge()
    return
  }
  startRecognition(language)
}

export function useJarvisVoiceTeardown(): void {
  useEffect(() => () => {
    startGeneration += 1
    speakGeneration += 1
    teardownRecognition()
    teardownBridge()
    clearSpeakKeepAlive()
    releaseMicrophoneAccess()
    onTranscriptRef = null
    onErrorRef = null
  }, [])
}
