import { describe, expect, it } from 'vitest'
import { AppError } from '@profitpilot/types'
import { AiUnavailableError, OpenRouterError } from './provider.js'
import {
  INSIGHT_OFFLINE_MESSAGE,
  INSIGHT_RATE_LIMITED_MESSAGE,
  INSIGHT_SAFETY_MESSAGE,
  generateValidatedInsight,
} from './insight-language.js'

const facts = [
  { key: 'orders', label: 'Total orders', value: 12, source: 'calculated' },
  { key: 'units', label: 'Units', value: 40, source: 'calculated' },
]

function provider(texts: readonly string[], errors: readonly unknown[] = []) {
  const calls: string[] = []
  let index = 0
  return {
    calls,
    generate: async (system: string, _user: string, context?: Readonly<{ requestId?: string }>) => {
      calls.push(system)
      const error = errors[index]
      const text = texts[index] ?? ''
      index += 1
      if (error) throw error
      void context
      return { text, model: `model-${index}`, keyIndex: 0, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, attempts: 1 }
    },
  }
}

describe('generateValidatedInsight', () => {
  it('returns generated text that passes the language firewall', async () => {
    const source = provider(['You sold 12 orders across 40 units. Restock your best seller.'])
    const outcome = await generateValidatedInsight({ provider: source, system: 'base', user: 'q', evidence: facts })
    expect(outcome.status).toBe('generated')
    expect(source.calls).toHaveLength(1)
  })

  it('retries once with a stricter system instruction when formatting trips the firewall', async () => {
    // First answer spells a quantity in words (firewall rejects); strict retry answers cleanly.
    const source = provider(['You sold twelve orders recently.', 'You sold 12 orders recently.'])
    const events: string[] = []
    const outcome = await generateValidatedInsight({
      provider: source,
      system: 'base',
      user: 'q',
      evidence: facts,
      diagnose: (event) => events.push(event),
    })
    expect(outcome.status).toBe('generated')
    expect(source.calls).toHaveLength(2)
    expect(source.calls[1]).toContain('STRICT FORMAT RULES')
    expect(events).toContain('firewall_rejected')
  })

  it('reports a safety failure when both attempts fail the firewall', async () => {
    const source = provider(['You sold twelve orders.', 'You sold twelve orders again.'])
    const outcome = await generateValidatedInsight({ provider: source, system: 'base', user: 'q', evidence: facts })
    expect(outcome).toMatchObject({ status: 'safety_failed', message: INSIGHT_SAFETY_MESSAGE })
  })

  it('distinguishes rate-limited providers from offline providers', async () => {
    const limited = provider([], [new OpenRouterError('rate_limit', 'OpenRouter rate limit', 429)])
    const rateOutcome = await generateValidatedInsight({ provider: limited, system: 's', user: 'q', evidence: facts })
    expect(rateOutcome).toMatchObject({ status: 'rate_limited', message: INSIGHT_RATE_LIMITED_MESSAGE })

    const offline = provider([], [new AiUnavailableError()])
    const offlineOutcome = await generateValidatedInsight({ provider: offline, system: 's', user: 'q', evidence: facts })
    expect(offlineOutcome).toMatchObject({ status: 'provider_unavailable', message: INSIGHT_OFFLINE_MESSAGE })
  })

  it('logs the exact provider exception with a request id', async () => {
    const failing = provider([], [new OpenRouterError('server', 'OpenRouter server error 503', 503)])
    const seen: Array<Readonly<Record<string, unknown>>> = []
    await generateValidatedInsight({ provider: failing, system: 's', user: 'q', evidence: facts, requestId: 'req-42', diagnose: (event, context) => seen.push({ event, ...context }) })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ event: 'provider_error', requestId: 'req-42', kind: 'server', statusCode: 503 })
  })

  it('does not expose firewall internals to the merchant', async () => {
    const source = provider([], [new AppError('VALIDATION_ERROR', 'AI response is empty', 502)])
    const outcome = await generateValidatedInsight({ provider: source, system: 's', user: 'q', evidence: facts })
    expect(outcome.status).toBe('provider_unavailable')
    if (outcome.status === 'provider_unavailable') expect(outcome.message).not.toContain('VALIDATION_ERROR')
  })
})
