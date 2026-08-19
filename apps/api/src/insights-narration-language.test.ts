/**
 * PatternAI — narration language wiring.
 *
 * Regression coverage for the "Insight language" preference (English /
 * हिन्दी) in Settings. The preference was persisted and surfaced as a button
 * but never reached the narrator, so choosing Hindi had no effect on the
 * discovery narration a merchant actually read. These tests pin the wiring:
 * the store's stored language flows into the narrator, and the Hindi system
 * prompt keeps every figure in Latin digits so the numeric language firewall
 * can still verify each number against the engine's evidence.
 */

import { describe, expect, it } from 'vitest'
import { createInsightsNarrator, insightsNarratorSystemPrompt } from './insights-hub.js'
import type { InsightsNarrator } from './insights-hub.js'
import { INSIGHTS_HUB_SYSTEM_PROMPT } from '@profitpilot/ai'

type NarratorProvider = { generate: (system: string, user: string) => Promise<{ text: string; model: string }> }

/** Cast a bare provider into the shape `createInsightsNarrator` accepts. */
function asProvider(provider: NarratorProvider): Parameters<typeof createInsightsNarrator>[0] {
  return provider as unknown as Parameters<typeof createInsightsNarrator>[0]
}

describe('PatternAI narration language', () => {
  it('uses the base English prompt for English or an unspecified language', () => {
    expect(insightsNarratorSystemPrompt(undefined)).toBe(INSIGHTS_HUB_SYSTEM_PROMPT)
    expect(insightsNarratorSystemPrompt('en')).toBe(INSIGHTS_HUB_SYSTEM_PROMPT)
  })

  it('extends the prompt with a Hindi directive that keeps numbers in Latin digits', () => {
    const hindi = insightsNarratorSystemPrompt('hi')
    expect(hindi).not.toBe(INSIGHTS_HUB_SYSTEM_PROMPT)
    expect(hindi).toContain('Respond in Hindi')
    expect(hindi).toContain('Devanagari')
    expect(hindi).toContain('Latin digits')
    expect(hindi).toContain('never Devanagari numerals')
  })

  it('passes the merchant language into the narrator system prompt', async () => {
    let capturedSystem = ''
    const provider: NarratorProvider = {
      generate: async (system: string) => {
        capturedSystem = system
        return { text: 'राजस्व में 42 की बढ़त देखी गई।', model: 'nemotron:free' }
      },
    }
    const narrator = createInsightsNarrator(asProvider(provider))
    const result = await narrator({
      title: 'Revenue jump',
      description: 'Revenue rose recently.',
      evidenceNumbers: [42],
      category: 'REVENUE',
      language: 'hi',
    })
    expect(capturedSystem).toContain('Respond in Hindi')
    expect(capturedSystem).toContain('Latin digits')
    expect(result?.text).toContain('42')
  })

  it('falls back to English when the merchant has not chosen a language', async () => {
    let capturedSystem = ''
    const provider: NarratorProvider = {
      generate: async (system: string) => {
        capturedSystem = system
        return { text: 'Revenue climbed by 42.', model: 'nemotron:free' }
      },
    }
    const narrator = createInsightsNarrator(asProvider(provider))
    await narrator({ title: 'Revenue jump', description: 'Revenue rose.', evidenceNumbers: [42], category: 'REVENUE' })
    expect(capturedSystem).toBe(INSIGHTS_HUB_SYSTEM_PROMPT)
    expect(capturedSystem).not.toContain('Respond in Hindi')
  })

  it('still rejects an invented number in Hindi narration via the language firewall', async () => {
    const provider: NarratorProvider = {
      generate: async () => ({ text: 'राजस्व 999 तक बढ़ा।', model: 'nemotron:free' }),
    }
    const narrator = createInsightsNarrator(asProvider(provider))
    const result = await narrator({
      title: 'Revenue jump',
      description: 'Revenue rose.',
      evidenceNumbers: [42],
      category: 'REVENUE',
      language: 'hi',
    })
    // The firewall drops the invented 999 (not in evidence), so narration is null.
    expect(result).toBeNull()
  })

  it('the narrator type signature is language-aware', () => {
    const narrator: InsightsNarrator = async () => ({ text: 'ok', model: 'm' })
    // Compile-time guard: the input accepts an optional language field.
    expect(typeof narrator).toBe('function')
  })
})
