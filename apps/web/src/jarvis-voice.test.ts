import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jarvisVoiceController, resumeJarvisListening, retryCloudSpeech, useJarvisVoiceSnapshot } from './jarvis-voice.js'
import { resetApiClientStateForTests } from './api.js'

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
  vi.stubGlobal('document', {})
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
    expect(jarvisVoiceController.error).not.toMatch(/new tab|embedded view/i)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('starts through a voice-bridge popup when the iframe blocks the microphone', async () => {
    const popup = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      postMessage: vi.fn(),
    }
    const top = {}
    const windowLike = {
      SpeechRecognition: FakeRecognition,
      speechSynthesis: { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] },
      isSecureContext: true,
      location: { origin: 'https://app.test' },
      open: vi.fn(() => popup),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 7),
      clearInterval: vi.fn(),
      navigator: { mediaDevices: { getUserMedia: async () => { throw new DOMException('blocked', 'NotAllowedError') } } },
    }
    Object.defineProperties(windowLike, { self: { value: windowLike }, top: { value: top } })
    vi.stubGlobal('window', windowLike)
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } })
    vi.stubGlobal('navigator', windowLike.navigator)
    jarvisVoiceController.stop()
    const started = await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    expect(started).toBe(true)
    expect(jarvisVoiceController.active).toBe(true)
    expect(jarvisVoiceController.status).toBe('listening')
    expect(jarvisVoiceController.error).toBeNull()
    expect(windowLike.open).toHaveBeenCalledOnce()
    expect(windowLike.open).toHaveBeenCalledWith('/jarvis-mic.html?lang=en-IN', 'profitpilot-jarvis-mic', expect.stringContaining('popup=yes'))
    jarvisVoiceController.stop()
  })

  it('uses the in-page microphone (no popup) when a framed page can own getUserMedia', async () => {
    const top = {}
    const windowLike = {
      SpeechRecognition: FakeRecognition,
      speechSynthesis: { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] },
      isSecureContext: true,
      location: { origin: 'https://app.test' },
      open: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 7),
      clearInterval: vi.fn(),
      // A preview iframe that allows the mic: getUserMedia resolves.
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ readyState: 'live', stop: vi.fn() }] }) } },
    }
    Object.defineProperties(windowLike, { self: { value: windowLike }, top: { value: top } })
    vi.stubGlobal('window', windowLike)
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } })
    vi.stubGlobal('navigator', windowLike.navigator)
    jarvisVoiceController.stop()
    const started = await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    expect(started).toBe(true)
    // The permission prompt is owned by the page, so no popup bridge is opened.
    expect(windowLike.open).not.toHaveBeenCalled()
    expect(jarvisVoiceController.framed).toBe(true)
    jarvisVoiceController.stop()
  })

  it('plays the natural cloud voice when a storeId is provided and cloud speech is available', async () => {
    resetApiClientStateForTests()
    retryCloudSpeech()
    const played: string[] = []
    class FakeAudio {
      public onended: (() => void) | null = null
      public onerror: (() => void) | null = null
      public ended = false
      public paused = false
      public src = ''
      public currentSrc = ''
      public play = vi.fn(async () => { played.push('played'); return undefined })
      public pause = vi.fn()
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (String(input).includes('/security/csrf')) return new Response(JSON.stringify({ ok: true, data: { csrfToken: 'tok' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(Buffer.from([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }))
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:audio'), revokeObjectURL: vi.fn() })
    vi.stubGlobal('Audio', FakeAudio)
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.speak({ text: 'Hello Sir.', language: 'en', storeId: 'store-1' })
    await vi.waitFor(() => expect(played).toContain('played'))
    expect(jarvisVoiceController.status).toBe('speaking')
    jarvisVoiceController.stop()
  })

  it('falls back to the browser voice when cloud speech is unavailable (503)', async () => {
    resetApiClientStateForTests()
    retryCloudSpeech()
    const nativeSpeak = vi.fn()
    class FakeAudio { public play = vi.fn(async () => undefined) }
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (String(input).includes('/security/csrf')) return new Response(JSON.stringify({ ok: true, data: { csrfToken: 'tok' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response('unavailable', { status: 503 })
    }))
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:audio'), revokeObjectURL: vi.fn() })
    vi.stubGlobal('Audio', FakeAudio)
    const navigatorLike = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ readyState: 'live', stop: vi.fn() }] }) } }
    vi.stubGlobal('window', {
      SpeechRecognition: FakeRecognition,
      speechSynthesis: { cancel: vi.fn(), speak: nativeSpeak, getVoices: () => [], addEventListener: vi.fn() },
      isSecureContext: true,
      navigator: navigatorLike,
    })
    vi.stubGlobal('navigator', navigatorLike)
    vi.stubGlobal('SpeechSynthesisUtterance', class { public lang = ''; public onend: (() => void) | null = null })
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    jarvisVoiceController.speak({ text: 'Hello Sir.', language: 'en', storeId: 'store-1' })
    // After a 503 the cloud voice is disabled and the native queue takes over.
    await vi.waitFor(() => expect(nativeSpeak).toHaveBeenCalled())
    jarvisVoiceController.stop()
  })

  it('de-duplicates identical speech within 2 seconds (React StrictMode guard)', async () => {
    await jarvisVoiceController.start({ language: 'en', onTranscript: vi.fn(), onError: vi.fn() })
    const nativeSpeak = vi.fn()
    const navigatorLike = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ readyState: 'live', stop: vi.fn() }] }) } }
    vi.stubGlobal('window', {
      SpeechRecognition: FakeRecognition,
      speechSynthesis: { cancel: vi.fn(), speak: nativeSpeak, getVoices: () => [], addEventListener: vi.fn() },
      isSecureContext: true,
      navigator: navigatorLike,
    })
    vi.stubGlobal('navigator', navigatorLike)
    vi.stubGlobal('SpeechSynthesisUtterance', class { public lang = ''; public onend: (() => void) | null = null } as unknown as typeof SpeechSynthesisUtterance)
    const onEndFirst = vi.fn()
    const onEndSecond = vi.fn()
    jarvisVoiceController.speak({ text: 'Hello Sir same text', language: 'en' }, onEndFirst)
    // Immediate duplicate within 2s should be dropped and onEnd called synchronously
    jarvisVoiceController.speak({ text: 'Hello Sir same text', language: 'en' }, onEndSecond)
    expect(onEndSecond).toHaveBeenCalledOnce()
    // Let the first utterance queue settle; nativeSpeak should have been called exactly once (not twice)
    await vi.waitFor(() => expect(nativeSpeak).toHaveBeenCalledTimes(1))
    expect(onEndFirst).not.toHaveBeenCalled()
    jarvisVoiceController.stop()
  })
})
