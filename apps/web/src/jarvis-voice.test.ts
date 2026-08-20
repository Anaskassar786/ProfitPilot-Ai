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

function installBrowserMocks(getUserMedia: () => Promise<{ getTracks: () => readonly { readyState: string; stop: () => void }[] }>): void {
  const navigatorLike = { mediaDevices: { getUserMedia } }
  vi.stubGlobal('window', {
    SpeechRecognition: FakeRecognition,
    speechSynthesis: { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] },
    isSecureContext: true,
    navigator: navigatorLike,
  })
  vi.stubGlobal('navigator', navigatorLike)
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    public lang = ''
    public onend: (() => void) | null = null
  })
}

describe('Shared Jarvis voice controller', () => {
  beforeEach(() => {
    installBrowserMocks(async () => ({ getTracks: () => [{ readyState: 'live', stop: vi.fn() }] }))
    jarvisVoiceController.stop()
  })
  afterEach(() => {
    jarvisVoiceController.stop()
    vi.unstubAllGlobals()
  })

  it('starts inactive and becomes active when voice starts', async () => {
    expect(jarvisVoiceController.active).toBe(false)
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    expect(jarvisVoiceController.active).toBe(true)
    expect(jarvisVoiceController.status).toBe('listening')
  })

  it('stops and returns to idle, clearing the active session', async () => {
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.stop()
    expect(jarvisVoiceController.active).toBe(false)
    expect(jarvisVoiceController.status).toBe('idle')
  })

  it('mutes and un-mutes audio output without dropping the session', async () => {
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.setMuted(true)
    expect(jarvisVoiceController.muted).toBe(true)
    expect(jarvisVoiceController.active).toBe(true)
    jarvisVoiceController.setMuted(false)
    expect(jarvisVoiceController.muted).toBe(false)
  })

  it('pauses background listening and can resume', async () => {
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.setPaused(true)
    expect(jarvisVoiceController.status).toBe('paused')
    jarvisVoiceController.setPaused(false)
    expect(jarvisVoiceController.status).toBe('listening')
  })

  it('does not resume listening when inactive or paused', async () => {
    expect(jarvisVoiceController.active).toBe(false)
    // No recognition should start; this simply must not throw.
    resumeJarvisListening('en')
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.setPaused(true)
    resumeJarvisListening('en')
    expect(jarvisVoiceController.status).toBe('paused')
  })

  it('exposes a snapshot hook for subscribers', () => {
    const snapshot = useJarvisVoiceSnapshot
    expect(typeof snapshot).toBe('function')
  })

  it('speaks cleaned store replies and records the last spoken line', async () => {
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.speak({ text: 'Sir, revenue is ready.\n@jarvis:action {"actionId":"navigate_page","parameters":{"page":"products"}}', language: 'en' })
    expect(jarvisVoiceController.lastSpoken).toContain('revenue is ready')
    expect(jarvisVoiceController.lastSpoken).not.toContain('@jarvis:action')
  })

  it('does not start recognition when the browser denies the microphone', async () => {
    installBrowserMocks(async () => { throw new DOMException('blocked', 'NotAllowedError') })
    const onError = vi.fn()
    const started = await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError })
    expect(started).toBe(false)
    expect(jarvisVoiceController.active).toBe(false)
    expect(jarvisVoiceController.status).toBe('error')
    expect(jarvisVoiceController.error).not.toMatch(/not-allowed/i)
    expect(jarvisVoiceController.error).toContain('Microphone')
    expect(onError).toHaveBeenCalledOnce()
  })
})
