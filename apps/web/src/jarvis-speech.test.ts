import { describe, expect, it, vi } from 'vitest'
import { chunkSpeech, loadVoices, normalizeForSpeech, pickPreferredVoice, preferredLocales, speak, speechErrorMessage, unlockSpeech } from './jarvis-speech.js'

type FakeVoice = Readonly<{ name: string; lang: string; localService?: boolean }>

const VOICES: readonly FakeVoice[] = [
  { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
  { name: 'Google UK English Female', lang: 'en-GB', localService: false },
  { name: 'Microsoft Heera - English (India)', lang: 'en-IN', localService: true },
  { name: 'Google हिन्दी', lang: 'hi-IN', localService: false },
  { name: 'Albert (compact)', lang: 'en-US', localService: true },
]

describe('Voice selection sounds human', () => {
  it('prefers an Indian-English neural voice for English', () => {
    const chosen = pickPreferredVoice(VOICES, 'en')
    expect(chosen?.lang).toBe('en-IN')
  })

  it('prefers a Hindi voice when the merchant speaks Hindi', () => {
    expect(pickPreferredVoice(VOICES, 'hi')?.lang).toBe('hi-IN')
  })

  it('never returns a compact/robotic voice when a better one exists', () => {
    expect(pickPreferredVoice(VOICES, 'en')?.name).not.toContain('compact')
  })

  it('returns null when the browser has no voices at all', () => {
    expect(pickPreferredVoice([], 'en')).toBeNull()
  })

  it('asks for the closest locales first', () => {
    expect(preferredLocales('hi')[0]).toBe('hi-IN')
    expect(preferredLocales('en')[0]).toBe('en-IN')
  })
})

describe('Spoken text preparation', () => {
  it('strips markdown, links, and the action protocol line before speaking', () => {
    const spoken = normalizeForSpeech('**Revenue** is up. See https://example.com/x @jarvis:action {"actionId":"show_revenue","parameters":{}}')
    expect(spoken).not.toContain('*')
    expect(spoken).not.toContain('http')
    expect(spoken).not.toContain('@jarvis:action')
    expect(spoken).toContain('Revenue is up.')
  })

  it('splits long replies into utterance-sized chunks on sentence boundaries', () => {
    const long = `${'Revenue is up today. '.repeat(20)}`
    const chunks = chunkSpeech(long)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(190)
  })

  it('keeps a short reply as a single utterance', () => {
    expect(chunkSpeech('Twelve orders today.')).toEqual(['Twelve orders today.'])
    expect(chunkSpeech('   ')).toEqual([])
  })
})

/** Minimal speechSynthesis double that behaves like Chrome. */
function fakeScope(options: Readonly<{ fireStart?: boolean }> = {}) {
  const spoken: string[] = []
  const utterances: Array<{ text: string; onstart: (() => void) | null; onend: (() => void) | null }> = []
  class FakeUtterance {
    public lang = ''
    public voice: unknown = null
    public rate = 1
    public pitch = 1
    public volume = 1
    public onstart: (() => void) | null = null
    public onend: (() => void) | null = null
    public onerror: ((event: { error?: string }) => void) | null = null
    public constructor(public text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  const scope = {
    speechSynthesis: {
      speaking: false,
      pending: false,
      cancel: vi.fn(),
      resume: vi.fn(),
      getVoices: () => VOICES,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      speak: (utterance: FakeUtterance) => {
        spoken.push(utterance.text)
        utterances.push(utterance)
        if (options.fireStart !== false) { utterance.onstart?.(); utterance.onend?.() }
      },
    },
    setTimeout: (handler: () => void) => { void handler; return 1 },
    clearTimeout: vi.fn(),
    setInterval: () => 1,
    clearInterval: vi.fn(),
  } as unknown as Window
  return { scope, spoken, utterances }
}

describe('Speech output actually reaches the synthesiser', () => {
  it('speaks the reply and reports completion so listening can resume', async () => {
    const { scope, spoken } = fakeScope()
    const onEnd = vi.fn()
    speak({ text: 'Your revenue is up today.', language: 'en', onEnd }, scope)
    await Promise.resolve()
    await Promise.resolve()
    expect(spoken).toContain('Your revenue is up today.')
    expect(onEnd).toHaveBeenCalled()
  })

  it('reports an error (instead of hanging) when the browser cannot speak', () => {
    const onError = vi.fn()
    const onEnd = vi.fn()
    speak({ text: 'Hello', language: 'en', onError, onEnd }, undefined)
    expect(onError).toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalled()
  })

  it('primes the engine inside the opening click so the first reply is audible', () => {
    const { scope } = fakeScope()
    unlockSpeech(scope)
    expect(scope.speechSynthesis.cancel).toHaveBeenCalled()
  })

  it('resolves the voice list even when the browser publishes it late', async () => {
    const { scope } = fakeScope()
    await expect(loadVoices(scope, 5)).resolves.toHaveLength(VOICES.length)
  })

  it('explains blocked audio in plain language', () => {
    expect(speechErrorMessage('not-allowed')).toContain('blocked')
    expect(speechErrorMessage('language-unavailable')).toContain('voice pack')
  })
})
