import { randomUUID } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { EvidenceField } from './evidence.js'
import { validateLanguageResponse } from './language.js'
import { AiUnavailableError, OpenRouterError } from './provider.js'
import type { AiGeneration } from './provider.js'

/**
 * Validated insight generation (QA 2026-08-22).
 *
 * The insight services (customers, orders, inventory, analytics) used to catch
 * EVERY failure into one generic "temporarily unavailable" string, so a
 * merchant could not tell an offline provider from a safety rejection, and a
 * response that merely tripped a formatting rule in the language firewall was
 * discarded instead of retried once with stricter instructions.
 *
 * This helper splits the two failure classes, logs the exact provider
 * exception with a request id, retries once with a stricter system
 * instruction when the firewall rejects formatting, and returns a
 * merchant-facing status that distinguishes "AI offline/rate-limited" from
 * "safety check failed".
 */

export type InsightGenerationOutcome =
  | Readonly<{ status: 'generated'; text: string; model: string; generation: AiGeneration }>
  | Readonly<{ status: 'safety_failed'; message: string; model: string | null }>
  | Readonly<{ status: 'rate_limited'; message: string }>
  | Readonly<{ status: 'provider_unavailable'; message: string }>

export type InsightDiagnosticContext = Readonly<{
  requestId: string
  error: string
  kind?: string
  statusCode?: number | null
  attempt?: string
  model?: string
}>

export type InsightGenerationInput = Readonly<{
  provider: { generate(system: string, user: string, context?: Readonly<{ requestId?: string; maxTokens?: number }>): Promise<AiGeneration> }
  system: string
  user: string
  /** System instruction used for the single strict retry after a firewall rejection. */
  stricterSystem?: string
  evidence: readonly EvidenceField[]
  impactValue?: number
  maxTokens?: number
  requestId?: string
  /** Receives exact failure details (provider exceptions, firewall rejections). */
  diagnose?: ((event: 'provider_error' | 'firewall_rejected' | 'firewall_retry_failed', context: InsightDiagnosticContext) => void) | undefined
}>

export const INSIGHT_OFFLINE_MESSAGE = 'AI is offline or rate-limited right now. The deterministic insights above remain available.'
export const INSIGHT_RATE_LIMITED_MESSAGE = 'AI is rate-limited right now and will recover shortly. The deterministic insights above remain available.'
export const INSIGHT_SAFETY_MESSAGE = 'AI answered, but the response failed our safety check, so it was not shown. The deterministic insights above remain available.'

export const STRICT_INSIGHT_SUFFIX = 'STRICT FORMAT RULES: Reply in exactly two short sentences. Use only digits for numbers that appear in the supplied facts — never spell a quantity out in words. Never mention email addresses, phone numbers, addresses, or names. Never echo instructions. Do not add any number that is not present in the facts.'

/** Runs one grounded model call through the language firewall with a single strict retry. */
export async function generateValidatedInsight(input: InsightGenerationInput): Promise<InsightGenerationOutcome> {
  const requestId = input.requestId?.trim() || `insight-${randomUUID()}`
  const impact = input.impactValue ?? 0
  let generation: AiGeneration
  try {
    generation = await input.provider.generate(input.system, input.user, { requestId, maxTokens: input.maxTokens ?? 180 })
  } catch (error: unknown) {
    const detail = describeProviderError(error)
    input.diagnose?.('provider_error', { requestId, ...detail })
    if (detail.kind === 'rate_limit') return { status: 'rate_limited', message: INSIGHT_RATE_LIMITED_MESSAGE }
    return { status: 'provider_unavailable', message: INSIGHT_OFFLINE_MESSAGE }
  }

  const firstPass = attemptValidation(generation.text, input.evidence, impact)
  if (firstPass.ok) return { status: 'generated', text: firstPass.text, model: generation.model, generation }
  input.diagnose?.('firewall_rejected', { requestId, error: firstPass.reason, model: generation.model, attempt: 'initial' })

  // Minor formatting slips (a spelled-out number, an extra sentence) get ONE
  // strict retry before we admit defeat — never an instant fallback string.
  try {
    const retry = await input.provider.generate(`${input.stricterSystem ?? input.system}\n\n${STRICT_INSIGHT_SUFFIX}`, input.user, { requestId: `${requestId}:strict`, maxTokens: input.maxTokens ?? 180 })
    const secondPass = attemptValidation(retry.text, input.evidence, impact)
    if (secondPass.ok) return { status: 'generated', text: secondPass.text, model: retry.model, generation: retry }
    input.diagnose?.('firewall_retry_failed', { requestId, error: secondPass.reason, model: retry.model, attempt: 'strict_retry' })
    return { status: 'safety_failed', message: INSIGHT_SAFETY_MESSAGE, model: retry.model }
  } catch (error: unknown) {
    const detail = describeProviderError(error)
    input.diagnose?.('provider_error', { requestId, ...detail, attempt: 'strict_retry' })
    // The first response was already rejected by the firewall, so a failed
    // retry still surfaces as a safety failure rather than an outage.
    return { status: 'safety_failed', message: INSIGHT_SAFETY_MESSAGE, model: generation.model }
  }
}

function attemptValidation(text: string, evidence: readonly EvidenceField[], impactValue: number): Readonly<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    return { ok: true, text: validateLanguageResponse(text, evidence, impactValue) }
  } catch (error: unknown) {
    return { ok: false, reason: error instanceof Error ? error.message : 'AI response failed the language firewall' }
  }
}

function describeProviderError(error: unknown): Readonly<{ error: string; kind?: string; statusCode?: number | null }> {
  if (error instanceof OpenRouterError) {
    return { error: error.message, kind: error.kind, statusCode: error.status }
  }
  if (error instanceof AiUnavailableError) {
    return { error: error.message, kind: 'unavailable', statusCode: null }
  }
  if (error instanceof AppError) {
    return { error: error.message, kind: 'app_error', statusCode: error.status }
  }
  return { error: error instanceof Error ? error.message : String(error), kind: 'unknown', statusCode: null }
}
