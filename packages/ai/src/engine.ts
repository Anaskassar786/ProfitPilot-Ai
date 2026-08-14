import { randomUUID } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import { buildEvidencePack } from './evidence.js'
import { AGENT_PROMPTS, agentStatuses, promptFor } from './agents.js'
import { CalibrationLedger } from './calibration.js'
import { calculateStoreHealth } from './health.js'
import { CostCapExceededError, CostMeter } from './cost.js'
import type { AgentStatus, Recommendation, RuleSignal, StoreSnapshot } from './domain.js'
import { confidenceLevel } from './domain.js'
import { runDeterministicRules } from './rules.js'
import { AiUnavailableError, OpenRouterClient } from './provider.js'
import { validateLanguageResponse } from './language.js'
import type { RecommendationRepository } from './repository.js'

export type DecisionRun = Readonly<{ storeId: StoreId; health: ReturnType<typeof calculateStoreHealth>; recommendations: readonly Recommendation[]; generatedAt: string }>
export type DecisionEngineConfig = Readonly<{ inputRateMicroDollars?: number; outputRateMicroDollars?: number }>

export class DecisionEngine {
  private readonly provider: OpenRouterClient
  private readonly costs: CostMeter
  private readonly calibration: CalibrationLedger
  private readonly repository: RecommendationRepository
  private readonly inputRate: number
  private readonly outputRate: number
  private readonly now: () => number

  public constructor(provider: OpenRouterClient, costs: CostMeter, calibration: CalibrationLedger, repository: RecommendationRepository, config: DecisionEngineConfig = {}, now: () => number = () => Date.now()) {
    this.provider = provider
    this.costs = costs
    this.calibration = calibration
    this.repository = repository
    this.inputRate = config.inputRateMicroDollars ?? 0
    this.outputRate = config.outputRateMicroDollars ?? 0
    this.now = now
  }

  public statuses(enabledAgents = Object.keys(AGENT_PROMPTS) as readonly AgentStatus['id'][]): readonly AgentStatus[] {
    return agentStatuses(this.provider.configured, enabledAgents)
  }

  public async run(snapshot: StoreSnapshot): Promise<DecisionRun> {
    const health = calculateStoreHealth(snapshot)
    const signals = runDeterministicRules(snapshot)
    const generatedAt = new Date(this.now()).toISOString()
    const recommendations: Recommendation[] = []
    for (const signal of signals) {
      const recommendation = await this.fromSignal(snapshot, signal, generatedAt)
      await this.repository.put(recommendation)
      recommendations.push(recommendation)
    }
    return { storeId: snapshot.storeId, health, recommendations, generatedAt }
  }

  private async fromSignal(snapshot: StoreSnapshot, signal: RuleSignal, generatedAt: string): Promise<Recommendation> {
    const calibrated = this.calibration.calibrate(signal.agent, signal.confidence)
    const evidencePack = buildEvidencePack({ id: randomUUID(), storeId: snapshot.storeId, ruleId: signal.ruleId, ruleVersion: signal.ruleVersion, fields: signal.evidence, generatedAt })
    let explanation: string | null = null
    let explanationStatus: Recommendation['explanationStatus'] = 'AI_UNAVAILABLE'
    let model: string | null = null
    if (this.provider.configured) {
      try {
        const prompt = promptFor(signal, snapshot)
        const generated = await this.provider.generate(prompt.system, prompt.user)
        explanation = validateLanguageResponse(generated.text, signal.evidence, signal.impactValue)
        this.costs.record({ storeId: snapshot.storeId, model: generated.model, promptTokens: generated.usage.promptTokens, completionTokens: generated.usage.completionTokens, inputRateMicroDollars: this.inputRate, outputRateMicroDollars: this.outputRate, at: this.now() })
        explanationStatus = 'AI_GENERATED'
        model = generated.model
      } catch (error: unknown) {
        if (!(error instanceof AiUnavailableError) && !(error instanceof CostCapExceededError) && !(error instanceof AppError)) throw error
        explanationStatus = error instanceof AppError && error.code === 'VALIDATION_ERROR' ? 'AI_REJECTED' : 'AI_UNAVAILABLE'
      }
    }
    return { id: randomUUID(), storeId: snapshot.storeId, agent: signal.agent, ruleId: signal.ruleId, title: signal.title, reason: signal.reason, impactValue: signal.impactValue, impactLabel: signal.impactLabel, currency: signal.currency, confidence: calibrated.score, confidenceLevel: confidenceLevel(calibrated.score), actionType: signal.actionType, actionRisk: signal.actionRisk, status: 'PENDING', evidencePack, explanation, explanationStatus, model, version: 0, createdAt: generatedAt }
  }
}
