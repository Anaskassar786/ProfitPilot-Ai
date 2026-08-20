import { describe, expect, it, vi } from 'vitest'
import { framedMicrophoneNeedsBridge, isVoiceBridgeMessage, reserveVoiceBridge, startVoiceBridge, voiceBridgeEnvelope, voiceBridgePopupUrl } from './jarvis-voice-bridge.js'

function framedWindow(): Window {
  const top = {} as Window
  const scope = { isSecureContext: true, location: { origin: 'https://app.test' } } as unknown as Window
  Object.defineProperties(scope, { self: { value: scope }, top: { value: top } })
  return scope
}

describe('Jarvis voice bridge', () => {
  it('accepts only same-channel bridge messages', () => {
    expect(isVoiceBridgeMessage(voiceBridgeEnvelope('transcript', { text: 'hello' }))).toBe(true)
    expect(isVoiceBridgeMessage({ channel: 'other', kind: 'transcript' })).toBe(false)
    expect(isVoiceBridgeMessage(null)).toBe(false)
  })

  it('builds a CSP-safe popup URL that encodes the language', () => {
    expect(voiceBridgePopupUrl('en')).toBe('/jarvis-mic.html?lang=en-IN')
    expect(voiceBridgePopupUrl('hi')).toBe('/jarvis-mic.html?lang=hi-IN')
  })

  it('prefers a voice bridge only when the iframe policy withholds the microphone', () => {
    const scope = framedWindow()
    const standalone = { isSecureContext: true } as unknown as Window
    Object.defineProperties(standalone, { self: { value: standalone }, top: { value: standalone } })
    expect(framedMicrophoneNeedsBridge(standalone, { permissionsPolicy: { allowsFeature: () => true } } as unknown as Document)).toBe(false)
    expect(framedMicrophoneNeedsBridge(scope, { permissionsPolicy: { allowsFeature: () => true } } as unknown as Document)).toBe(false)
    expect(framedMicrophoneNeedsBridge(scope, { permissionsPolicy: { allowsFeature: () => false } } as unknown as Document)).toBe(true)
    expect(framedMicrophoneNeedsBridge(scope, {} as Document)).toBe(true)
  })

  it('reserves and starts a same-origin popup via a CSP-safe served page, then forwards transcripts', () => {
    const listeners = new Set<(event: MessageEvent) => void>()
    const popup = {
      closed: false,
      close: vi.fn(() => { popup.closed = true }),
      focus: vi.fn(),
      postMessage: vi.fn(),
    }
    const scope = framedWindow()
    Object.assign(scope, {
      open: vi.fn(() => popup),
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => { if (type === 'message') listeners.add(listener) }),
      removeEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => { if (type === 'message') listeners.delete(listener) }),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    })
    expect(reserveVoiceBridge(scope, 'en')).toBe(popup)
    expect(scope.open).toHaveBeenCalledWith('/jarvis-mic.html?lang=en-IN', 'profitpilot-jarvis-mic', expect.stringContaining('popup=yes'))
    const onTranscript = vi.fn()
    const session = startVoiceBridge({
      scope,
      popup: popup as unknown as Window,
      language: 'en',
      onTranscript,
      onError: vi.fn(),
      onListening: vi.fn(),
      onClosed: vi.fn(),
    })
    expect(session).not.toBeNull()
    const listener = [...listeners][0]
    listener?.({
      origin: 'https://app.test',
      source: popup,
      data: voiceBridgeEnvelope('transcript', { text: 'show revenue' }),
    } as unknown as MessageEvent)
    expect(onTranscript).toHaveBeenCalledWith('show revenue')
    session?.close()
    expect(popup.close).toHaveBeenCalled()
  })

  it('opens the Hindi popup URL when Hindi is requested', () => {
    const popup = { closed: false, close: vi.fn(), focus: vi.fn(), postMessage: vi.fn() }
    const scope = framedWindow()
    Object.assign(scope, { open: vi.fn(() => popup) })
    reserveVoiceBridge(scope, 'hi')
    expect(scope.open).toHaveBeenCalledWith('/jarvis-mic.html?lang=hi-IN', expect.any(String), expect.any(String))
  })
})
