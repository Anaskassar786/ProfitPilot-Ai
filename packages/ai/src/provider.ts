import { randomUUID } from 'node:crypto'

export const DEFAULT_AI_MODELS = ['nvidia/nemotron-nano-9b-v2:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3.5-lightning:free'] as const
export const DEFAULT_AI_TIMEOUT_MS = 25_000
export type AiModel = string
export type AiUsage = Readonly<{ promptTokens: number; completionTokens: number; totalTokens: number }>
export type AiGeneration = Readonly<{ text: string; model: AiModel; keyIndex: number; usage: AiUsage; attempts: number }>
export type ProviderFailureKind = 'timeout' | 'rate_limit' | 'server' | 'network' | 'bad_response'
export type ProviderFailureTelemetry = Readonly<{
  model: string
  statusCode: number | null
  failureKind: ProviderFailureKind
  attemptNumber: number
  durationMs: number
  requestId: string
}>
export type ModelValidation = Readonly<{ model: string; available: boolean; statusCode: number | null; reason: 'available' | 'not_found' | 'no_endpoints' | 'request_failed' }>

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
  onFailure?: (failure: ProviderFailureTelemetry) => void
}>

export type AiRequestContext = Readonly<{ requestId?: string }>
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
  onFailure: (failure: ProviderFailureTelemetry) => void
}>

export class OpenRouterClient {
  private readonly config: ResolvedOpenRouterConfig

  public constructor(config: OpenRouterConfig) {
    const keys = unique(config.keys.map((key) => key.trim()).filter((key) => key.length > 0))
    const configuredModels = config.models?.map((model) => model.trim()).filter((model) => model.length > 0) ?? []
    this.config = {
      ...config,
      keys,
      models: configuredModels.length > 0 ? configuredModels : DEFAULT_AI_MODELS,
      timeoutMs: config.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? 1,
      temperature: config.temperature ?? .3,
      maxTokens: config.maxTokens ?? 2_000,
      inputMicroDollarsPerToken: config.inputMicroDollarsPerToken ?? 0,
      outputMicroDollarsPerToken: config.outputMicroDollarsPerToken ?? 0,
      fetcher: config.fetcher ?? fetch,
      sleep: config.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      onFailure: config.onFailure ?? defaultFailureLogger,
    }
    if (this.config.timeoutMs < 1 || this.config.maxRetries < 0 || this.config.maxTokens < 1) throw new RangeError('Invalid OpenRouter configuration')
  }

  public get configured(): boolean { return this.config.keys.length > 0 }
  public get models(): readonly string[] { return this.config.models }

  public async generate(system: string, user: string, context: AiRequestContext = {}): Promise<AiGeneration> {
    if (!this.configured) throw new AiUnavailableError()
    const requestId = context.requestId?.trim() || randomUUID()
    let attempts = 0
    let lastError: OpenRouterError | null = null
    for (let modelIndex = 0; modelIndex < this.config.models.length; modelIndex += 1) {
      const model = this.config.models[modelIndex]
      if (!model) continue
      for (let keyIndex = 0; keyIndex < this.config.keys.length; keyIndex += 1) {
        const key = this.config.keys[(keyIndex + modelIndex) % this.config.keys.length]
        if (!key) continue
        const result = await this.tryCandidate(model, key, (keyIndex + modelIndex) % this.config.keys.length, system, user, attempts, requestId)
        attempts = result.attempts
        if (result.generation) return result.generation
        lastError = result.error
      }
    }
    throw new AiUnavailableError(lastError?.message ?? 'AI temporarily unavailable')
  }

  public async completionHealthCheck(requestId = `readiness-${randomUUID()}`): Promise<boolean> {
    if (!this.configured) return false
    try {
      const result = await this.generate('You are a health probe. Reply with the single word OK.', 'OK', { requestId })
      return result.text.trim().length > 0
    } catch {
      return false
    }
  }

  public async validateModels(): Promise<readonly ModelValidation[]> {
    const key = this.config.keys[0]
    return Promise.all(this.config.models.map(async (model): Promise<ModelValidation> => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.min(this.config.timeoutMs, 10_000))
      try {
        const headers: Record<string, string> = { accept: 'application/json' }
        if (key) headers.authorization = `Bearer ${key}`
        const response = await this.config.fetcher(`https://openrouter.ai/api/v1/models/${model}/endpoints`, { method: 'GET', signal: controller.signal, headers })
        if (response.status === 404) return { model, available: false, statusCode: 404, reason: 'not_found' }
        if (!response.ok) return { model, available: false, statusCode: response.status, reason: 'request_failed' }
        const payload: unknown = await response.json()
        const endpoints = isRecord(payload) && isRecord(payload.data) && Array.isArray(payload.data.endpoints) ? payload.data.endpoints : []
        return endpoints.length > 0
          ? { model, available: true, statusCode: response.status, reason: 'available' }
          : { model, available: false, statusCode: response.status, reason: 'no_endpoints' }
      } catch {
        return { model, available: false, statusCode: null, reason: 'request_failed' }
      } finally {
        clearTimeout(timer)
      }
    }))
  }

  private async tryCandidate(model: string, key: string, keyIndex: number, system: string, user: string, attemptsBefore: number, requestId: string): Promise<Readonly<{ generation: AiGeneration | null; error: OpenRouterError; attempts: number }>> {
    const retryLimit = this.config.maxRetries
    let attempts = attemptsBefore
    let lastFailure: OpenRouterError | null = null
    for (let retry = 0; retry <= retryLimit; retry += 1) {
      attempts += 1
      const startedAt = Date.now()
      try {
        const response = await this.request(model, key, system, user)
        return { generation: { ...response, model, keyIndex, attempts }, error: new OpenRouterError('bad_response', 'unused'), attempts }
      } catch (error: unknown) {
        const providerError = error instanceof OpenRouterError ? error : new OpenRouterError('network', 'OpenRouter network error', null, true)
        this.config.onFailure({ model, statusCode: providerError.status, failureKind: providerError.kind, attemptNumber: attempts, durationMs: Math.max(0, Date.now() - startedAt), requestId })
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

function defaultFailureLogger(failure: ProviderFailureTelemetry): void {
  if (process.env.NODE_ENV === 'test') return
  console.warn(JSON.stringify({ level: 'warn', message: 'OpenRouter provider failure', context: { model: failure.model, status_code: failure.statusCode, failure_kind: failure.failureKind, attempt_number: failure.attemptNumber, duration_ms: failure.durationMs, request_id: failure.requestId } }))
}
function unique(values: readonly string[]): readonly string[] { return [...new Set(values)] }
function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
