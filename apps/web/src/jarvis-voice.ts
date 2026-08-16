import { useEffect, useSyncExternalStore } from 'react'
import type { VoiceStatus as NativeVoiceStatus } from './voice.js'
import { createSpeechRecognition, stopNativeSpeech } from './voice.js'
import type { NativeSpeechRecognition } from './voice.js'

/**
 * Voice status shown by both the inline chat strip and the floating widget.
 * `paused` means the user asked Jarvis to stay quiet in the background.
 */
export type FloatingVoiceStatus = NativeVoiceStatus | 'paused'

export type VoiceBlock = 'insecure' | 'embedded-policy' | 'policy-denied' | 'media-devices-unavailable' | null

type TranscriptHandler = (transcript: string) => void | Promise<void>
type SpeakOptions = Readonly<{ text: string; language: 'en' | 'hi'; muted: boolean }>

type VoiceController = Readonly<{
  active: boolean
  status: FloatingVoiceStatus
  error: string | null
  block: VoiceBlock
  muted: boolean
  framed: boolean
  start: (options: Readonly<{ language: 'en' | 'hi'; onTranscript: TranscriptHandler; onError: (message: string) => void }>) => void
  stop: () => void
  setProcessing: () => void
  speak: (options: SpeakOptions, onEnd?: () => void) => void
  stopSpeaking: () => void
  setMuted: (muted: boolean) => void
  /** Pauses background listening without tearing the session down. */
  setPaused: (paused: boolean) => void
  setBlock: (block: VoiceBlock, framed: boolean) => void
}>

let recognition: NativeSpeechRecognition | null = null
let onTranscriptRef: TranscriptHandler | null = null
let onErrorRef: ((message: string) => void) | null = null

let state = {
  active: false,
  status: 'idle' as FloatingVoiceStatus,
  error: null as string | null,
  block: null as VoiceBlock,
  muted: false,
  framed: false,
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

function startRecognition(language: 'en' | 'hi'): void {
  teardownRecognition()
  if (typeof window === 'undefined') return
  const next = createSpeechRecognition(window)
  if (!next) {
    setState({ status: 'error', error: 'Native voice input is not available in this browser. Chat mode remains available.' })
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
    const message = event.error ? `Voice error: ${event.error}` : 'Voice recognition failed.'
    setState({ status: 'error', error: message })
    onErrorRef?.(message)
  }
  next.onend = () => {
    // Keep the active session alive (the widget stays visible) but return to
    // idle unless we are processing/speaking/paused.
    updateState((current) => ({ status: current.status === 'listening' ? 'idle' : current.status }))
    recognition = null
  }
  setState({ status: 'listening', error: null })
  try {
    next.start()
  } catch {
    setState({ status: 'error', error: 'Could not start voice input. Try again or type your message.' })
  }
}

export const jarvisVoiceController: VoiceController = {
  get active() { return state.active },
  get status() { return state.status },
  get error() { return state.error },
  get block() { return state.block },
  get muted() { return state.muted },
  get framed() { return state.framed },
  start({ language, onTranscript, onError }) {
    onTranscriptRef = onTranscript
    onErrorRef = onError
    setState({ active: true, error: null })
    startRecognition(language)
  },
  stop() {
    teardownRecognition()
    stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
    onTranscriptRef = null
    onErrorRef = null
    setState({ active: false, status: 'idle', error: null })
  },
  setProcessing() {
    if (state.active) setState({ status: 'processing' })
  },
  speak({ text, language, muted }, onEnd) {
    if (!state.active || muted || typeof window === 'undefined' || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    setState({ status: 'speaking' })
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN'
    utterance.onend = () => {
      updateState((current) => ({ status: current.status === 'speaking' ? 'idle' : current.status }))
      onEnd?.()
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  },
  stopSpeaking() {
    stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
    if (state.active && state.status === 'speaking') setState({ status: 'idle' })
  },
  setMuted(muted) {
    setState({ muted })
    if (muted) stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
  },
  setPaused(paused) {
    if (paused) {
      teardownRecognition()
      stopNativeSpeech(typeof window === 'undefined' ? undefined : window)
      setState({ status: 'paused' })
    } else if (state.active) {
      // Resume: kick off a fresh recognition pass if we were the active session.
      setState({ status: 'idle' })
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

/**
 * Shared voice controller so the floating widget keeps listening after the
 * chat panel unmounts. Both surfaces read the same snapshot.
 */
export function useJarvisVoice(): VoiceController {
  useSyncExternalStore(subscribe, () => state, () => state)
  return jarvisVoiceController
}

/** Convenience selector hook for components that only need the snapshot. */
export function useJarvisVoiceSnapshot(): typeof state {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/**
 * Restarts recognition after a spoken exchange so Jarvis keeps listening in
 * the background across page navigations. No-op when voice is inactive or paused.
 */
export function resumeJarvisListening(language: 'en' | 'hi'): void {
  if (!state.active || state.status === 'paused') return
  startRecognition(language)
}

/** Cleans up recognition when the app unmounts (tests / hot reload). */
export function useJarvisVoiceTeardown(): void {
  useEffect(() => () => {
    teardownRecognition()
    onTranscriptRef = null
    onErrorRef = null
  }, [])
}
