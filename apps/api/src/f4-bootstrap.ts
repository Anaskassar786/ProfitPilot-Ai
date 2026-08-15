import { CalibrationLedger, CostMeter, DecisionEngine, OpenRouterClient, PostgresRecommendationRepository } from '@profitpilot/ai'
import { createF2Bootstrap } from './f2-bootstrap.js'
import type { F2Bootstrap } from './f2-bootstrap.js'
import type { AiRouteDependencies } from './ai-routes.js'
import { buildStoreSnapshot } from './store-snapshot.js'

export type F4Bootstrap = Readonly<F2Bootstrap & { ai: AiRouteDependencies }>

export function createF4Bootstrap(env: Readonly<Record<string, string | undefined>>): F4Bootstrap | null {
  const f2 = createF2Bootstrap(env)
  if (!f2) return null
  const provider = new OpenRouterClient({ keys: [env.OPENROUTER_API_KEY_1, env.OPENROUTER_API_KEY_2, env.OPENROUTER_API_KEY_3, env.OPENROUTER_API_KEY].filter((key): key is string => typeof key === 'string'), models: [env.AI_MODEL_PRIMARY, env.AI_MODEL_FALLBACK1, env.AI_MODEL_FALLBACK2].filter((model): model is string => typeof model === 'string' && model.trim().length > 0), timeoutMs: numberEnv(env, 'AI_TIMEOUT_MS', 25_000), maxRetries: numberEnv(env, 'AI_MAX_RETRIES', 1), temperature: numberEnv(env, 'AI_TEMPERATURE', .3), maxTokens: numberEnv(env, 'AI_MAX_TOKENS', 2_000) })
  const costs = new CostMeter(numberEnv(env, 'AI_DAILY_COST_CAP_USD', 5))
  const recommendations = new PostgresRecommendationRepository(f2.database)
  const engine = new DecisionEngine(provider, costs, new CalibrationLedger(), recommendations, { inputRateMicroDollars: numberEnv(env, 'AI_INPUT_MICRO_DOLLARS', 0), outputRateMicroDollars: numberEnv(env, 'AI_OUTPUT_MICRO_DOLLARS', 0) })
  return { ...f2, ai: { engine, recommendations, costs } }
}

function numberEnv(env: Readonly<Record<string, string | undefined>>, key: string, fallback: number): number {
  const value = env[key]
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
