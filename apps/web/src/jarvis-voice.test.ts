import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jarvisVoiceController, resumeJarvisListening, useJarvisVoiceSnapshot } from './jarvis-voice.js'

class FakeRecognition {
  public lang = ''
  public continuous = false
  public interimResults = false
  public onstart: (() => void) | null = null
  public onend: (() => void) | null = null
  public onerror: ((event: Readonly<{ error?: string }>) => void) | null = null
  public onresult: ((event: Readonly<{ results: readonly Readonly<{ 0?: Readonly<{ transcript: string }>; length: number }>[] }>) => void) | null = null
  public start = vi.fn(() => { this.onstart?.() })
  public stop = vi.fn()
  public abort = vi.fn(() => { this.onend?.() })
}

function installBrowserMocks(): void {
  vi.stubGlobal('window', {
    SpeechRecognition: FakeRecognition,
    speechSynthesis: { cancel: vi.fn(), speak: vi.fn() },
  })
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    public lang = ''
    public onend: (() => void) | null = null
  })
}

describe('Shared Jarvis voice controller', () => {
  beforeEach(() => {
    installBrowserMocks()
    jarvisVoiceController.stop()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts inactive and becomes active when voice starts', () => {
    expect(jarvisVoiceController.active).toBe(false)
    jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    expect(jarvisVoiceController.active).toBe(true)
    expect(jarvisVoiceController.status).toBe('listening')
  })

  it('stops and returns to idle, clearing the active session', () => {
    jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.stop()
    expect(jarvisVoiceController.active).toBe(false)
    expect(jarvisVoiceController.status).toBe('idle')
  })

  it('mutes and un-mutes audio output without dropping the session', () => {
    jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.setMuted(true)
    expect(jarvisVoiceController.muted).toBe(true)
    expect(jarvisVoiceController.active).toBe(true)
    jarvisVoiceController.setMuted(false)
    expect(jarvisVoiceController.muted).toBe(false)
  })

  it('pauses background listening and can resume', () => {
    jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.setPaused(true)
    expect(jarvisVoiceController.status).toBe('paused')
    jarvisVoiceController.setPaused(false)
    expect(jarvisVoiceController.status).toBe('idle')
  })

  it('does not resume listening when inactive or paused', () => {
    expect(jarvisVoiceController.active).toBe(false)
    // No recognition should start; this simply must not throw.
    resumeJarvisListening('en')
    jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.setPaused(true)
    resumeJarvisListening('en')
    expect(jarvisVoiceController.status).toBe('paused')
  })

  it('exposes a snapshot hook for subscribers', () => {
    const snapshot = useJarvisVoiceSnapshot
    expect(typeof snapshot).toBe('function')
  })
})
