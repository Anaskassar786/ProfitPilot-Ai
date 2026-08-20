import { useEffect, useSyncExternalStore } from 'react'
import type { VoiceStatus as NativeVoiceStatus } from './voice.js'
import { createSpeechRecognition, speechRecognitionFailure } from './voice.js'
import type { NativeSpeechRecognition } from './voice.js'
import { speak as speakAloud, speechSynthesisAvailable, stopSpeaking as stopSpeechOutput, unlockSpeech } from './jarvis-speech.js'

/**
 * Voice status shown by the floating Jarvis bar.
 * `paused` means the merchant asked Jarvis to stay quiet for a moment.
 */
export type FloatingVoiceStatus = NativeVoiceStatus | 'paused'

export type VoiceBlock = 'insecure' | 'embedded-policy' | 'policy-denied' | 'media-devices-unavailable' | null

type TranscriptHandler = (transcript: string) => void | Promise<void>
type SpeakOptions = Readonly<{ text: string; language: 'en' | 'hi'; muted?: boolean }>

type VoiceState = Readonly<{
  active: boolean
  status: FloatingVoiceStatus
  error: string | null
  block: VoiceBlock
  muted: boolean
  /** The merchant's mic switch on the bar. Off means Jarvis stops listening. */
  micEnabled: boolean
  paused: boolean
  framed: boolean
  language: 'en' | 'hi'
}>

type VoiceController = Readonly<{
  active: boolean
  status: FloatingVoiceStatus
  error: string | null
  block: VoiceBlock
  muted: boolean
  micEnabled: boolean
  paused: boolean
  framed: boolean
  language: 'en' | 'hi'
  start: (options: Readonly<{ language: 'en' | 'hi'; onTranscript: TranscriptHandler; onError: (message: string) => void; listen?: boolean }>) => void
  stop: () => void
  setProcessing: () => void
  speak: (options: SpeakOptions, onEnd?: () => void) => void
  stopSpeaking: () => void
  setMuted: (muted: boolean) => void
  /** The mic toggle on the voice bar. */
  setMicEnabled: (enabled: boolean) => void
  /** Pauses listening and speaking without tearing the session down. */
  setPaused: (paused: boolean) => void
  setLanguage: (language: 'en' | 'hi') => void
  setBlock: (block: VoiceBlock, framed: boolean) => void
}>

let recognition: NativeSpeechRecognition | null = null
let onTranscriptRef: TranscriptHandler | null = null
let onErrorRef: ((message: string) => void) | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null
/** Consecutive silent restarts, used to back off instead of hammering the mic. */
let emptyTurns = 0

let state: VoiceState = {
  active: false,
  status: 'idle',
  error: null,
  block: null,
  muted: false,
  micEnabled: false,
  paused: false,
  framed: false,
  language: 'en',
}
const listeners = new Set<() => void>()
function setState(patch: Partial<VoiceState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function clearRestart(): void {
  if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null }
}

function teardownRecognition(): void {
  clearRestart()
  if (recognition) {
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.onstart = null
    try { recognition.abort() } catch { /* ignore */ }
    recognition = null
  }
}

/** True when Jarvis should have an open microphone right now. */
function shouldListen(): boolean {
  return state.active && state.micEnabled && !state.paused && state.status !== 'processing' && state.status !== 'speaking'
}

function scheduleRestart(delayMs: number): void {
  clearRestart()
  if (typeof window === 'undefined') return
  if (typeof window.setTimeout !== 'function') return
  restartTimer = window.setTimeout(() => {
    restartTimer = null
    if (shouldListen()) startRecognition(state.language)
  }, delayMs) as unknown as ReturnType<typeof setTimeout>
}

function startRecognition(language: 'en' | 'hi'): void {
  teardownRecognition()
  if (typeof window === 'undefined') return
  if (!state.active || !state.micEnabled || state.paused) return
  const next = createSpeechRecognition(window)
  if (!next) {
    setState({ status: 'error', micEnabled: false, error: 'This browser cannot listen. Try Chrome or Edge, or open ProfitPilot in a new tab.' })
    return
  }
  recognition = next
  next.lang = language === 'hi' ? 'hi-IN' : 'en-IN'
  // One phrase per turn: Jarvis answers, then listens again. Continuous mode
  // makes the browser hear its own reply and talk over the merchant.
  next.continuous = false
  next.interimResults = false
  next.onstart = () => setState({ status: 'listening', error: null })
  next.onresult = (event) => {
    const transcript = [...event.results].map((result) => result[0]?.transcript ?? '').join(' ').trim()
    if (!transcript) return
    emptyTurns = 0
    clearRestart()
    setState({ status: 'processing', error: null })
    if (onTranscriptRef) void onTranscriptRef(transcript)
  }
  next.onerror = (event) => {
    const code = event.error ?? 'unknown'
    // Silence and self-aborts are normal in a hands-free loop: restart quietly
    // with a gentle back-off instead of shouting an error at the merchant.
    if (code === 'no-speech' || code === 'aborted' || code === 'audio-capture-idle') {
      emptyTurns = Math.min(emptyTurns + 1, 6)
      if (shouldListen()) scheduleRestart(400 + emptyTurns * 600)
      return
    }
    const failure = speechRecognitionFailure(code)
    const blocking = code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture'
    setState({ status: 'error', error: failure.message, ...(blocking ? { micEnabled: false } : {}) })
    onErrorRef?.(failure.message)
    if (!blocking && shouldListen()) scheduleRestart(1_200)
  }
  next.onend = () => {
    recognition = null
    // Keep the hands-free loop alive across the browser's own end events.
    if (state.status === 'listening') setState({ status: 'idle' })
    if (shouldListen()) scheduleRestart(350)
  }
  setState({ status: 'listening', error: null, language })
  try {
    next.start()
  } catch {
    // start() throws when a previous instance is still shutting down.
    scheduleRestart(500)
  }
}

export const jarvisVoiceController: VoiceController = {
  get active() { return state.active },
  get status() { return state.status },
  get error() { return state.error },
  get block() { return state.block },
  get muted() { return state.muted },
  get micEnabled() { return state.micEnabled },
  get paused() { return state.paused },
  get framed() { return state.framed },
  get language() { return state.language },
  start({ language, onTranscript, onError, listen = true }) {
    onTranscriptRef = onTranscript
    onErrorRef = onError
    emptyTurns = 0
    // Runs inside the click that opened Jarvis, which is exactly what the
    // browser's autoplay policy needs before it will let Jarvis speak.
    if (typeof window !== 'undefined') unlockSpeech(window)
    setState({ active: true, error: null, paused: false, micEnabled: listen, language, status: 'idle' })
    if (listen) startRecognition(language)
  },
  stop() {
    teardownRecognition()
    stopSpeechOutput(typeof window === 'undefined' ? undefined : window)
    onTranscriptRef = null
    onErrorRef = null
    emptyTurns = 0
    setState({ active: false, status: 'idle', error: null, micEnabled: false, paused: false })
  },
  setProcessing() {
    if (!state.active) return
    teardownRecognition()
    setState({ status: 'processing' })
  },
  speak({ text, language, muted }, onEnd) {
    const silent = muted ?? state.muted
    if (!state.active || silent || state.paused || !speechSynthesisAvailable(typeof window === 'undefined' ? undefined : window)) {
      if (state.active && !state.paused) {
        setState({ status: 'idle' })
        if (shouldListen()) scheduleRestart(250)
      }
      onEnd?.()
      return
    }
    // Never listen while speaking, or the microphone transcribes Jarvis.
    teardownRecognition()
    setState({ status: 'speaking', error: null })
    speakAloud({
      text,
      language,
      onError: (message) => { setState({ error: message }); onErrorRef?.(message) },
      onEnd: () => {
        if (!state.active) { onEnd?.(); return }
        setState({ status: state.paused ? 'paused' : 'idle' })
        onEnd?.()
        if (shouldListen()) scheduleRestart(250)
      },
    }, typeof window === 'undefined' ? undefined : window)
  },
  stopSpeaking() {
    stopSpeechOutput(typeof window === 'undefined' ? undefined : window)
    if (state.active && state.status === 'speaking') {
      setState({ status: 'idle' })
      if (shouldListen()) scheduleRestart(200)
    }
  },
  setMuted(muted) {
    setState({ muted })
    if (muted) stopSpeechOutput(typeof window === 'undefined' ? undefined : window)
  },
  setMicEnabled(enabled) {
    if (!state.active) return
    if (!enabled) {
      teardownRecognition()
      setState({ micEnabled: false, status: state.status === 'speaking' ? 'speaking' : 'idle' })
      return
    }
    setState({ micEnabled: true, paused: false, error: null })
    startRecognition(state.language)
  },
  setPaused(paused) {
    if (paused) {
      teardownRecognition()
      stopSpeechOutput(typeof window === 'undefined' ? undefined : window)
      setState({ paused: true, status: 'paused' })
      return
    }
    if (!state.active) { setState({ paused: false }); return }
    setState({ paused: false, status: 'idle' })
    if (state.micEnabled) startRecognition(state.language)
  },
  setLanguage(language) {
    if (state.language === language) return
    setState({ language })
    if (shouldListen()) startRecognition(language)
  },
  setBlock(block, framed) {
    setState({ block, framed })
  },
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Shared voice controller so the bar keeps listening while the merchant moves
 * between pages. Every surface reads the same snapshot.
 */
export function useJarvisVoice(): VoiceController {
  useSyncExternalStore(subscribe, () => state, () => state)
  return jarvisVoiceController
}

/** Convenience selector hook for components that only need the snapshot. */
export function useJarvisVoiceSnapshot(): VoiceState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/**
 * Restarts listening after a spoken exchange so Jarvis keeps the conversation
 * going hands-free. No-op when voice is inactive, muted at the mic, or paused.
 */
export function resumeJarvisListening(language: 'en' | 'hi'): void {
  if (!state.active || state.paused || !state.micEnabled) return
  startRecognition(language)
}

/** Cleans up recognition when the app unmounts (tests / hot reload). */
export function useJarvisVoiceTeardown(): void {
  useEffect(() => () => {
    teardownRecognition()
    stopSpeechOutput(typeof window === 'undefined' ? undefined : window)
    onTranscriptRef = null
    onErrorRef = null
  }, [])
}
