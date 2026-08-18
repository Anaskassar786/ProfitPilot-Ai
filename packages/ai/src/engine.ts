import { randomUUID, createHash } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import { buildEvidencePack } from './evidence.js'
import { AGENT_PROMPTS, agentStatuses, promptFor } from './agents.js'
import { CalibrationLedger } from './calibration.js'
import { calculateStoreHealth } from './health.js'
import { CostCapExceededError } from './cost.js'
import type { AnyCostMeter } from './cost.js'
import type { AgentId, AgentStatus, Recommendation, RuleSignal, StoreSnapshot } from './domain.js'
import { AGENT_IDS, confidenceLevel, deriveExpiry } from './domain.js'
import { runDeterministicRules } from './rules.js'
import { AiUnavailableError, OpenRouterClient } from './provider.js'
import { validateLanguageResponse } from './language.js'
import type { RecommendationRepository } from './repository.js'

export type DecisionRun = Readonly<{ storeId: StoreId; health: ReturnType<typeof calculateStoreHealth>; recommendations: readonly Recommendation[]; generatedAt: string; deduplicated: number; cacheHits: number }>
export type DecisionEngineConfig = Readonly<{ inputRateMicroDollars?: number; outputRateMicroDollars?: number; concurrency?: number; signalCap?: number }>
export type RunProgressEvent = Readonly<{ agent: AgentId; completed: number; total: number; recommendationId?: string }>
export type RunOptions = Readonly<{ agents?: readonly AgentId[]; maxRecommendations?: number; onProgress?: (event: RunProgressEvent) => void }>

/** Minimal cache port so identical evidence never pays for a second AI call. */
export interface ExplanationCache {
  get(storeId: StoreId, key: string): Promise<Readonly<{ text: string; model: string }> | null>
  set(storeId: StoreId, key: string, value: Readonly<{ text: string; model: string }>, ttlSeconds: number): Promise<void>
}

export const EXPLANATION_CACHE_TTL_SECONDS = 24 * 60 * 60

export class DecisionEngine {
  private readonly provider: OpenRouterClient
  private readonly costs: AnyCostMeter
  private readonly calibration: CalibrationLedger
  private readonly repository: RecommendationRepository
  private readonly cache: ExplanationCache | null
  private readonly inputRate: number
  private readonly outputRate: number
  private readonly concurrency: number
  private readonly signalCap: number
  private readonly now: () => number
  private cacheHitCount = 0

  public constructor(provider: OpenRouterClient, costs: AnyCostMeter, calibration: CalibrationLedger, repository: RecommendationRepository, config: DecisionEngineConfig = {}, now: () => number = () => Date.now(), cache: ExplanationCache | null = null) {
    this.provider = provider
    this.costs = costs
    this.calibration = calibration
    this.repository = repository
    this.cache = cache
    this.inputRate = config.inputRateMicroDollars ?? 0
    this.outputRate = config.outputRateMicroDollars ?? 0
    this.concurrency = Math.max(1, config.concurrency ?? 3)
    this.signalCap = Math.max(1, config.signalCap ?? 100)
    this.now = now
  }

  public get cacheHits(): number { return this.cacheHitCount }

  public statuses(enabledAgents = Object.keys(AGENT_PROMPTS) as readonly AgentStatus['id'][]): readonly AgentStatus[] {
    return agentStatuses(this.provider.configured, enabledAgents)
  }

  public async run(snapshot: StoreSnapshot, options: RunOptions = {}): Promise<DecisionRun> {
    await this.calibration.hydrate()
    const health = calculateStoreHealth(snapshot)
    const agentFilter = options.agents ?? AGENT_IDS
    const filtered = runDeterministicRules(snapshot).filter((signal) => agentFilter.includes(signal.agent)).slice(0, this.signalCap)
    const max = options.maxRecommendations
    const signals = typeof max === 'number' && Number.isFinite(max) ? filtered.slice(0, Math.max(0, Math.floor(max))) : filtered
    const generatedAt = new Date(this.now()).toISOString()
    const results: Array<Recommendation | null> = new Array(signals.length).fill(null)
    let deduplicated = 0
    let completed = 0
    // Bounded-concurrency worker pool: a store with hundreds of signals no
    // longer serializes hundreds of 25-second AI calls.
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= signals.length) return
        const signal = signals[index]
        if (!signal) return
        const outcome = await this.fromSignal(snapshot, signal, generatedAt)
        if (outcome.deduplicated) deduplicated += 1
        results[index] = outcome.recommendation
        completed += 1
        options.onProgress?.({ agent: signal.agent, completed, total: signals.length, recommendationId: outcome.recommendation.id })
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, signals.length)) }, () => worker()))
    const recommendations = results.filter((item): item is Recommendation => item !== null)
    return { storeId: snapshot.storeId, health, recommendations, generatedAt, deduplicated, cacheHits: this.cacheHitCount }
  }

  private async fromSignal(snapshot: StoreSnapshot, signal: RuleSignal, generatedAt: string): Promise<Readonly<{ recommendation: Recommendation; deduplicated: boolean }>> {
    const existing = await this.repository.findPending(snapshot.storeId, signal.ruleId, signal.entityKey)
    const calibrated = this.calibration.calibrate(signal.agent, signal.confidence)
    const id = existing?.id ?? randomUUID()
    const evidencePack = buildEvidencePack({ id, storeId: snapshot.storeId, ruleId: signal.ruleId, ruleVersion: signal.ruleVersion, fields: signal.evidence, generatedAt })
    const explanationResult = await this.explain(snapshot, signal)
    const recommendation: Recommendation = {
      id,
      storeId: snapshot.storeId,
      agent: signal.agent,
      ruleId: signal.ruleId,
      entityKey: signal.entityKey,
      title: signal.title,
      reason: signal.reason,
      impactValue: signal.impactValue,
      impactLabel: signal.impactLabel,
      currency: signal.currency,
      confidence: calibrated.score,
      confidenceLevel: confidenceLevel(calibrated.score),
      actionType: signal.actionType,
      actionRisk: signal.actionRisk,
      status: 'PENDING',
      evidencePack,
      explanation: explanationResult.explanation,
      explanationStatus: explanationResult.status,
      model: explanationResult.model,
      version: existing?.version ?? 0,
      createdAt: existing?.createdAt ?? generatedAt,
      expiresAt: deriveExpiry(signal.ruleId, signal.evidence, generatedAt),
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
      snoozedUntil: null,
    }
    if (existing) await this.repository.refresh(recommendation)
    else await this.repository.put(recommendation)
    return { recommendation, deduplicated: existing !== null }
  }

  private async explain(snapshot: StoreSnapshot, signal: RuleSignal): Promise<Readonly<{ explanation: string | null; status: Recommendation['explanationStatus']; model: string | null }>> {
    if (!this.provider.configured) return { explanation: null, status: 'AI_UNAVAILABLE', model: null }
    const prompt = promptFor(signal, snapshot)
    const cacheKey = explanationCacheKey(signal)
    if (this.cache) {
      const cached = await this.cache.get(snapshot.storeId, cacheKey).catch(() => null)
      if (cached) {
        this.cacheHitCount += 1
        return { explanation: cached.text, status: 'AI_GENERATED', model: cached.model }
      }
    }
    try {
      const generated = await this.provider.generate(prompt.system, prompt.user)
      const explanation = validateLanguageResponse(generated.text, signal.evidence, signal.impactValue)
      await Promise.resolve(this.costs.record({ storeId: snapshot.storeId, model: generated.model, agent: signal.agent, promptTokens: generated.usage.promptTokens, completionTokens: generated.usage.completionTokens, inputRateMicroDollars: this.inputRate, outputRateMicroDollars: this.outputRate, at: this.now() }))
      if (this.cache) await this.cache.set(snapshot.storeId, cacheKey, { text: explanation, model: generated.model }, EXPLANATION_CACHE_TTL_SECONDS).catch(() => undefined)
      return { explanation, status: 'AI_GENERATED', model: generated.model }
    } catch (error: unknown) {
      if (!(error instanceof AiUnavailableError) && !(error instanceof CostCapExceededError) && !(error instanceof AppError)) throw error
      const status = error instanceof AppError && error.code === 'VALIDATION_ERROR' ? 'AI_REJECTED' : 'AI_UNAVAILABLE'
      return { explanation: null, status, model: null }
    }
  }
}

/** Same agent + prompt version + identical evidence values ⇒ same explanation. */
export function explanationCacheKey(signal: RuleSignal): string {
  const canonical = JSON.stringify({ agent: signal.agent, version: AGENT_PROMPTS[signal.agent].version, rule: signal.ruleId, ruleVersion: signal.ruleVersion, impact: signal.impactValue, evidence: [...signal.evidence].sort((left, right) => left.key.localeCompare(right.key)) })
  return `ai-explanation:${signal.agent}:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}
