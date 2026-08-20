/**
 * Jarvis text-to-speech.
 *
 * Browser `speechSynthesis` voices are OS-level and often robotic, so Jarvis
 * prefers a neural cloud voice (OpenAI-compatible `/audio/speech`) when an API
 * key is configured, and the frontend transparently falls back to the browser
 * engine when it is not. This gives a natural, human voice like ChatGPT when a
 * key is present, while still working with zero configuration.
 *
 * The provider is OpenAI-compatible, so any endpoint that mirrors
 * `POST {base}/audio/speech` works (OpenAI, OpenRouter + Fish Audio/Grok/etc.,
 * Groq, local gateways). Model, voices, audio container, and speed are fully
 * overridable from configuration so each provider's quirks are handled by env
 * vars alone, with no code change. Unknown fields (like `speed`) are omitted by
 * default because some providers strictly validate the request body.
 */

export type JarvisTtsVoice = 'feminine' | 'masculine'
export type JarvisTtsLanguage = 'en' | 'hi'

export type JarvisTtsResult = Readonly<{ audio: Buffer; contentType: string }>

export interface JarvisTtsProvider {
  /** Whether a cloud voice is configured. When false, synthesize() throws. */
  readonly available: boolean
  synthesize(text: string, voice: JarvisTtsVoice, language: JarvisTtsLanguage): Promise<JarvisTtsResult>
}

export type TtsFetcher = (input: string, init: RequestInit) => Promise<Response>

export type OpenAiTtsConfig = Readonly<{
  apiKey: string
  baseUrl?: string
  model?: string
  /** feminine / masculine → vendor voice id (e.g. a Fish Audio reference_id). */
  voices?: Readonly<{ feminine?: string; masculine?: string }>
  /** Audio container requested from the provider (mp3, wav, opus, flac…). */
  responseFormat?: string
  /** Optional playback speed (0.5–2.0). Omitted by default for compatibility. */
  speed?: number
  /** Per-request timeout in ms. */
  timeoutMs?: number
  fetcher?: TtsFetcher
  /** Max phrases to memoize (identical text + voice never re-synthesizes). */
  cacheLimit?: number
}>

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_VOICES: Readonly<Record<JarvisTtsVoice, string>> = { feminine: 'shimmer', masculine: 'echo' }
const DEFAULT_RESPONSE_FORMAT = 'mp3'
const MAX_TEXT = 4_000
const CACHE_LIMIT = 64

type CacheKey = string
interface CacheEntry { readonly audio: Buffer; readonly contentType: string; readonly at: number }

export class OpenAiTtsProvider implements JarvisTtsProvider {
  private readonly cache = new Map<CacheKey, CacheEntry>()
  private readonly config: Readonly<{ apiKey: string; baseUrl: string; model: string; voices: Readonly<Record<JarvisTtsVoice, string>>; responseFormat: string; speed: number | null; timeoutMs: number; fetcher: TtsFetcher; cacheLimit: number }>

  public constructor(config: OpenAiTtsConfig) {
    const baseUrl = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
    const voices: Readonly<Record<JarvisTtsVoice, string>> = {
      feminine: config.voices?.feminine?.trim() || DEFAULT_VOICES.feminine,
      masculine: config.voices?.masculine?.trim() || DEFAULT_VOICES.masculine,
    }
    const rawSpeed = typeof config.speed === 'number' && Number.isFinite(config.speed) ? config.speed : null
    this.config = {
      apiKey: config.apiKey,
      baseUrl,
      model: config.model?.trim() || DEFAULT_MODEL,
      voices,
      responseFormat: config.responseFormat?.trim() || DEFAULT_RESPONSE_FORMAT,
      speed: rawSpeed !== null && rawSpeed > 0 ? rawSpeed : null,
      timeoutMs: config.timeoutMs ?? 15_000,
      fetcher: config.fetcher ?? fetch,
      cacheLimit: Math.max(0, config.cacheLimit ?? CACHE_LIMIT),
    }
  }

  public get available(): boolean { return this.config.apiKey.trim().length > 0 }

  public async synthesize(text: string, voice: JarvisTtsVoice, _language: JarvisTtsLanguage): Promise<JarvisTtsResult> {
    if (!this.available) throw new JarvisTtsUnavailableError('Jarvis cloud speech is not configured.')
    const cleaned = text.replace(/@jarvis:action\s*\{[\s\S]*$/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
    if (!cleaned) throw new JarvisTtsUnavailableError('Nothing to synthesize.')

    const key = `${cleaned}\u0000${voice}`
    const cached = this.cache.get(key)
    if (cached) return { audio: cached.audio, contentType: cached.contentType }

    // Build the OpenAI-compatible payload. Only `speed` is optional; some
    // providers (Fish Audio, Grok) reject unknown fields, so it is sent only
    // when explicitly configured.
    const payload: Record<string, unknown> = { model: this.config.model, voice: this.config.voices[voice], input: cleaned, response_format: this.config.responseFormat }
    if (this.config.speed !== null) payload.speed = this.config.speed

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.config.fetcher(`${this.config.baseUrl}/audio/speech`, {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new JarvisTtsUnavailableError(`Speech service responded ${response.status}.`)
      }
      const arrayBuffer = await response.arrayBuffer()
      const audio = Buffer.from(arrayBuffer)
      const contentType = response.headers.get('content-type') || 'audio/mpeg'
      this.store(key, { audio, contentType, at: Date.now() })
      return { audio, contentType }
    } catch (error: unknown) {
      if (error instanceof JarvisTtsUnavailableError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new JarvisTtsUnavailableError('Speech service timed out.')
      throw new JarvisTtsUnavailableError('Speech service is temporarily unavailable.')
    } finally {
      clearTimeout(timer)
    }
  }

  private store(key: string, entry: CacheEntry): void {
    if (this.config.cacheLimit === 0) return
    this.cache.set(key, entry)
    // Tiny LRU: drop the oldest entries once we exceed the limit.
    if (this.cache.size > this.config.cacheLimit) {
      const oldest = [...this.cache.entries()].sort((left, right) => left[1].at - right[1].at)[0]?.[0]
      if (oldest) this.cache.delete(oldest)
    }
  }
}

export class JarvisTtsUnavailableError extends Error {
  public constructor(message = 'Jarvis cloud speech is unavailable.') {
    super(message)
    this.name = 'JarvisTtsUnavailableError'
  }
}

/** Build a provider from a flat env record, returning null when unconfigured. */
export function createJarvisTtsProvider(env: Readonly<Record<string, string | undefined>>, fetcher?: TtsFetcher): JarvisTtsProvider | null {
  const apiKey = env.JARVIS_TTS_API_KEY?.trim() || env.OPENAI_TTS_API_KEY?.trim()
  if (!apiKey) return null
  const config: { apiKey: string; baseUrl?: string; model?: string; voices?: { feminine?: string; masculine?: string }; responseFormat?: string; speed?: number; fetcher?: TtsFetcher } = { apiKey }
  const baseUrl = env.JARVIS_TTS_BASE_URL?.trim() || env.OPENAI_TTS_BASE_URL?.trim()
  const model = env.JARVIS_TTS_MODEL?.trim() || env.OPENAI_TTS_MODEL?.trim()
  const responseFormat = env.JARVIS_TTS_RESPONSE_FORMAT?.trim()
  if (baseUrl) config.baseUrl = baseUrl
  if (model) config.model = model
  if (responseFormat) config.responseFormat = responseFormat
  const voices: { feminine?: string; masculine?: string } = {}
  const feminine = env.JARVIS_TTS_VOICE_FEMININE?.trim()
  const masculine = env.JARVIS_TTS_VOICE_MASCULINE?.trim()
  if (feminine) voices.feminine = feminine
  if (masculine) voices.masculine = masculine
  if (feminine || masculine) config.voices = voices
  const speed = env.JARVIS_TTS_SPEED?.trim()
  if (speed) { const parsed = Number(speed); if (Number.isFinite(parsed) && parsed > 0) config.speed = parsed }
  if (fetcher) config.fetcher = fetcher
  return new OpenAiTtsProvider(config)
}

export const NOOP_JARVIS_TTS: JarvisTtsProvider = {
  available: false,
  async synthesize() { throw new JarvisTtsUnavailableError('Jarvis cloud speech is not configured.') },
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = value?.trim() ? Number(value) : fallback
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
