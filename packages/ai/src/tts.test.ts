import { describe, expect, it, vi } from 'vitest'
import { createJarvisTtsProvider, JarvisTtsUnavailableError, NOOP_JARVIS_TTS, OpenAiTtsProvider } from './tts.js'

function fakeResponse(body: Buffer, status = 200, contentType = 'audio/mpeg'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response
}

describe('Jarvis cloud TTS provider', () => {
  it('is unavailable when no API key is configured and never makes a request', async () => {
    const provider = new OpenAiTtsProvider({ apiKey: '', fetcher: vi.fn() })
    expect(provider.available).toBe(false)
    await expect(provider.synthesize('hello', 'feminine', 'en')).rejects.toBeInstanceOf(JarvisTtsUnavailableError)
  })

  it('maps feminine and masculine voices and returns the synthesized audio buffer', async () => {
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string; voice: string; input: string; response_format: string }
      expect(body.voice).toBe('shimmer')
      expect(body.response_format).toBe('mp3')
      return fakeResponse(Buffer.from([1, 2, 3, 4]))
    })
    const provider = new OpenAiTtsProvider({ apiKey: 'sk-test', model: 'gpt-4o-mini-tts', fetcher })
    expect(provider.available).toBe(true)
    const result = await provider.synthesize('Hello Sir.', 'feminine', 'en')
    expect(result.contentType).toBe('audio/mpeg')
    expect(Array.from(result.audio)).toEqual([1, 2, 3, 4])
    expect(fetcher).toHaveBeenCalledOnce()
    const [url] = fetcher.mock.calls[0]!
    expect(url).toContain('/audio/speech')
  })

  it('uses the configured masculine voice for the masculine gender', async () => {
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { voice: string }
      expect(body.voice).toBe('onyx')
      return fakeResponse(Buffer.from([9]))
    })
    const provider = new OpenAiTtsProvider({ apiKey: 'sk-test', voices: { masculine: 'onyx' }, fetcher })
    await provider.synthesize('Hello Sir.', 'masculine', 'en')
  })

  it('memoizes identical text + voice so repeated greetings hit the cache', async () => {
    const fetcher = vi.fn(async () => fakeResponse(Buffer.from([7])))
    const provider = new OpenAiTtsProvider({ apiKey: 'sk-test', fetcher })
    await provider.synthesize('Same greeting', 'feminine', 'en')
    await provider.synthesize('Same greeting', 'feminine', 'en')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('surfaces a friendly unavailable error when the speech service errors', async () => {
    const fetcher = vi.fn(async () => fakeResponse(Buffer.from([]), 503))
    const provider = new OpenAiTtsProvider({ apiKey: 'sk-test', fetcher })
    await expect(provider.synthesize('hello', 'feminine', 'en')).rejects.toBeInstanceOf(JarvisTtsUnavailableError)
  })

  it('surfaces an unavailable error when the request aborts', async () => {
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      const controller = init.signal as unknown as { aborted: boolean }
      controller.aborted = true
      const abort = new Error('aborted'); abort.name = 'AbortError'
      throw abort
    })
    const provider = new OpenAiTtsProvider({ apiKey: 'sk-test', timeoutMs: 1, fetcher })
    await expect(provider.synthesize('hello', 'feminine', 'en')).rejects.toBeInstanceOf(JarvisTtsUnavailableError)
  })

  it('strips protocol markup before synthesizing', async () => {
    let captured = ''
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      captured = (JSON.parse(String(init.body)) as { input: string }).input
      return fakeResponse(Buffer.from([1]))
    })
    const provider = new OpenAiTtsProvider({ apiKey: 'sk-test', fetcher })
    await provider.synthesize('Hello Sir.\n@jarvis:action {"actionId":"x","parameters":{}}', 'feminine', 'en')
    expect(captured).toBe('Hello Sir.')
  })

  it('honors a configured response_format', async () => {
    let captured = ''
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      captured = (JSON.parse(String(init.body)) as { response_format: string }).response_format
      return fakeResponse(Buffer.from([1]))
    })
    const provider = new OpenAiTtsProvider({ apiKey: 'sk-test', responseFormat: 'wav', fetcher })
    await provider.synthesize('hello', 'feminine', 'en')
    expect(captured).toBe('wav')
  })

  it('omits speed by default and includes it only when configured', async () => {
    let defaultBody = ''
    const defaultFetcher = vi.fn(async (_input: string, init: RequestInit) => {
      defaultBody = String(init.body)
      return fakeResponse(Buffer.from([1]))
    })
    const noSpeed = new OpenAiTtsProvider({ apiKey: 'sk-test', fetcher: defaultFetcher })
    await noSpeed.synthesize('hello', 'feminine', 'en')
    expect(defaultBody).not.toContain('speed')

    let withSpeedBody = ''
    const speedFetcher = vi.fn(async (_input: string, init: RequestInit) => {
      withSpeedBody = String(init.body)
      return fakeResponse(Buffer.from([1]))
    })
    const withSpeed = new OpenAiTtsProvider({ apiKey: 'sk-test', speed: 1.1, fetcher: speedFetcher })
    await withSpeed.synthesize('hello', 'feminine', 'en')
    expect(withSpeedBody).toContain('"speed":1.1')
  })

  it('picks a language-specific voice for Hindi vs English, falling back to the gender default', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { voice: string }
      calls.push(body.voice)
      return fakeResponse(Buffer.from([1]))
    })
    const provider = new OpenAiTtsProvider({
      apiKey: 'sk-test',
      voices: {
        // gender fallbacks
        feminine: 'en-female-default',
        masculine: 'en-male-default',
        // language-specific overrides
        en: { feminine: 'sarah-en', masculine: 'adrian-en' },
        hi: { feminine: 'hindi-female', masculine: 'hindi-male' },
      },
      fetcher,
    })
    await provider.synthesize('hi text', 'feminine', 'hi')
    await provider.synthesize('en text', 'masculine', 'en')
    // Hindi female -> hindi voice; English male -> english voice.
    expect(calls[0]).toBe('hindi-female')
    expect(calls[1]).toBe('adrian-en')
  })

  it('createJarvisTtsProvider returns null without a key and a provider with one', () => {
    expect(createJarvisTtsProvider({}, vi.fn())).toBeNull()
    const provider = createJarvisTtsProvider({ JARVIS_TTS_API_KEY: 'sk-test' }, vi.fn())
    expect(provider?.available).toBe(true)
  })

  it('NOOP provider reports unavailable', () => {
    expect(NOOP_JARVIS_TTS.available).toBe(false)
  })
})
