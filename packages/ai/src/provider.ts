export const DEFAULT_AI_MODELS = ['google/gemma-4-31b:free', 'google/gemma-4-26b-a4b:free', 'nvidia/nemotron-3.5-lightning:free'] as const
export type AiModel = string
export type AiUsage = Readonly<{ promptTokens: number; completionTokens: number; totalTokens: number }>
export type AiGeneration = Readonly<{ text: string; model: AiModel; keyIndex: number; usage: AiUsage; attempts: number }>
export type ProviderFailureKind = 'timeout' | 'rate_limit' | 'server' | 'network' | 'bad_response'

export class OpenRouterError extends Error {
  public readonly kind: ProviderFailureKind
  public readonly status: number | null
  public readonly retryable: boolean

  public constructor(kind: ProviderFailureKind, message: string, status: number | null = null, retryable = false) {
    super(message)
    this.name = 'OpenRouterError'
    this.kind = kind
    this.status = status
    this.retryable = retryable
  }
}

export class AiUnavailableError extends Error {
  public constructor(message = 'AI temporarily unavailable') {
    super(message)
    this.name = 'AiUnavailableError'
  }
}

export type ProviderFetcher = (input: string, init: RequestInit) => Promise<Response>
export type ProviderSleep = (milliseconds: number) => Promise<void>
export type OpenRouterConfig = Readonly<{
  keys: readonly string[]
  models?: readonly string[]
  timeoutMs?: number
  maxRetries?: number
  temperature?: number
  maxTokens?: number
  inputMicroDollarsPerToken?: number
  outputMicroDollarsPerToken?: number
  fetcher?: ProviderFetcher
  sleep?: ProviderSleep
}>

type ChatMessage = Readonly<{ role: 'system' | 'user'; content: string }>
type ResolvedOpenRouterConfig = Readonly<{
  keys: readonly string[]
  models: readonly string[]
  timeoutMs: number
  maxRetries: number
  temperature: number
  maxTokens: number
  inputMicroDollarsPerToken: number
  outputMicroDollarsPerToken: number
  fetcher: ProviderFetcher
  sleep: ProviderSleep
}>

export class OpenRouterClient {
  private readonly config: ResolvedOpenRouterConfig

  public constructor(config: OpenRouterConfig) {
    const keys = config.keys.map((key) => key.trim()).filter((key) => key.length > 0)
    this.config = { ...config, keys, models: config.models?.length ? config.models : DEFAULT_AI_MODELS, timeoutMs: config.timeoutMs ?? 5_000, maxRetries: config.maxRetries ?? 1, temperature: config.temperature ?? .3, maxTokens: config.maxTokens ?? 2_000, inputMicroDollarsPerToken: config.inputMicroDollarsPerToken ?? 0, outputMicroDollarsPerToken: config.outputMicroDollarsPerToken ?? 0, fetcher: config.fetcher ?? fetch, sleep: config.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) }
    if (this.config.timeoutMs < 1 || this.config.maxRetries < 0 || this.config.maxTokens < 1) throw new RangeError('Invalid OpenRouter configuration')
  }

  public get configured(): boolean { return this.config.keys.length > 0 }
  public get models(): readonly string[] { return this.config.models }

  public async generate(system: string, user: string): Promise<AiGeneration> {
    if (!this.configured) throw new AiUnavailableError()
    let attempts = 0
    let lastError: OpenRouterError | null = null
    for (let modelIndex = 0; modelIndex < this.config.models.length; modelIndex += 1) {
      const model = this.config.models[modelIndex]
      if (!model) continue
      for (let keyIndex = 0; keyIndex < this.config.keys.length; keyIndex += 1) {
        const key = this.config.keys[(keyIndex + modelIndex) % this.config.keys.length]
        if (!key) continue
        const result = await this.tryCandidate(model, key, (keyIndex + modelIndex) % this.config.keys.length, system, user, attempts)
        attempts = result.attempts
        if (result.generation) return result.generation
        lastError = result.error
        if (result.error.kind === 'timeout' || result.error.kind === 'rate_limit' || result.error.kind === 'server') continue
      }
    }
    throw new AiUnavailableError(lastError?.message ?? 'AI temporarily unavailable')
  }

  private async tryCandidate(model: string, key: string, keyIndex: number, system: string, user: string, attemptsBefore: number): Promise<Readonly<{ generation: AiGeneration | null; error: OpenRouterError; attempts: number }>> {
    const retryLimit = this.config.maxRetries
    let attempts = attemptsBefore
    let lastFailure: OpenRouterError | null = null
    for (let retry = 0; retry <= retryLimit; retry += 1) {
      attempts += 1
      try {
        const response = await this.request(model, key, system, user)
        return { generation: { ...response, model, keyIndex, attempts }, error: new OpenRouterError('bad_response', 'unused'), attempts }
      } catch (error: unknown) {
        const providerError = error instanceof OpenRouterError ? error : new OpenRouterError('network', 'OpenRouter network error', null, true)
        if (!providerError.retryable || providerError.kind === 'rate_limit' || providerError.kind === 'server' || providerError.kind === 'timeout') return { generation: null, error: providerError, attempts }
        if (retry === retryLimit) return { generation: null, error: providerError, attempts }
        await this.config.sleep(50 * (retry + 1))
        if (providerError.kind !== 'network' && providerError.kind !== 'bad_response') return { generation: null, error: providerError, attempts }
        lastFailure = providerError
      }
    }
    return { generation: null, error: lastFailure ?? new OpenRouterError('network', 'OpenRouter network error', null, true), attempts }
  }

  private async request(model: string, key: string, system: string, user: string): Promise<Readonly<{ text: string; usage: AiUsage }>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await this.config.fetcher('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'http-referer': 'https://profitpilot.app', 'x-title': 'ProfitPilot' }, body: JSON.stringify({ model, temperature: this.config.temperature, max_tokens: this.config.maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] satisfies readonly ChatMessage[] }) })
      if (response.status === 429) throw new OpenRouterError('rate_limit', 'OpenRouter rate limit', response.status)
      if (response.status >= 500) throw new OpenRouterError('server', `OpenRouter server error ${response.status}`, response.status)
      if (!response.ok) throw new OpenRouterError('bad_response', `OpenRouter rejected the request with ${response.status}`, response.status)
      const payload: unknown = await response.json()
      return parseResponse(payload)
    } catch (error: unknown) {
      if (error instanceof OpenRouterError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new OpenRouterError('timeout', 'OpenRouter request timed out', null)
      throw new OpenRouterError('network', error instanceof Error ? error.message : 'OpenRouter network error', null, true)
    } finally {
      clearTimeout(timer)
    }
  }
}

function parseResponse(payload: unknown): Readonly<{ text: string; usage: AiUsage }> {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new OpenRouterError('bad_response', 'OpenRouter response has no choices', null, true)
  const first = payload.choices[0]
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== 'string' || first.message.content.trim().length === 0) throw new OpenRouterError('bad_response', 'OpenRouter response has no text content', null, true)
  const usage = isRecord(payload.usage) ? payload.usage : {}
  const promptTokens = numberValue(usage.prompt_tokens)
  const completionTokens = numberValue(usage.completion_tokens)
  const totalTokens = numberValue(usage.total_tokens) || promptTokens + completionTokens
  return { text: first.message.content, usage: { promptTokens, completionTokens, totalTokens } }
}

function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
