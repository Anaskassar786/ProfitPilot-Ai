import { AppError } from '@profitpilot/types'
import type { EvidenceField } from './evidence.js'

/** Hard ceiling on explanation length; anything longer is suspicious output. */
export const MAX_EXPLANATION_LENGTH = 1_200

const NUMBER_WORDS = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\s+(?:hundred|thousand|million|billion|dollars?|percent|orders?|units?|customers?|days?)\b/i
const INJECTION_PATTERNS = /(ignore (all|any|previous|prior) instructions|disregard (the|all|your) (system|previous)|you are now|new instructions:|<<<|>>>)/i

export function validateLanguageResponse(text: string, evidence: readonly EvidenceField[], impactValue: number): string {
  if (text.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'AI response is empty', 502)
  if (text.trim().length > MAX_EXPLANATION_LENGTH) throw new AppError('VALIDATION_ERROR', 'AI response exceeds the explanation length cap', 502, { length: text.trim().length })
  if (/(email|phone|address|credit card|full name|customer name)/i.test(text)) throw new AppError('VALIDATION_ERROR', 'AI response contains restricted PII', 502)
  if (INJECTION_PATTERNS.test(text)) throw new AppError('VALIDATION_ERROR', 'AI response echoes prompt-injection markers', 502)
  if (NUMBER_WORDS.test(text)) throw new AppError('VALIDATION_ERROR', 'AI response spells out an unsupported quantity in words', 502)
  const allowed = new Set([impactValue, ...evidence.flatMap((field) => typeof field.value === 'number' ? [field.value] : [])].map(normalizeNumber))
  for (const candidate of extractNumbers(text)) {
    if (!allowed.has(normalizeNumber(candidate))) throw new AppError('VALIDATION_ERROR', `AI response introduced an unsupported number: ${candidate}`, 502, { candidate })
  }
  return text.trim()
}

/**
 * Extracts standalone numeric claims. Compound adjectives ("7-day window"),
 * ratios ("24/7"), and version-like tokens ("v1.0.0") are descriptive rather
 * than quantitative claims, so they are not treated as invented numbers.
 */
export function extractNumbers(text: string): readonly number[] {
  const results: number[] = []
  for (const match of text.matchAll(/(?:\$|€|£)?\b\d[\d,]*(?:\.\d+)?%?/g)) {
    const token = match[0] ?? ''
    const start = match.index ?? 0
    const end = start + token.length
    const next = text.slice(end, end + 2)
    const previous = text.slice(Math.max(0, start - 1), start)
    if (/^-[a-z]/i.test(next)) continue // compound adjective: "7-day", "30-day"
    if (next.startsWith('/') || previous === '/') continue // ratios: "24/7"
    if (previous === '.' || next.startsWith('.')) {
      // version-ish tokens like 1.0.0 — the regex already consumes one dot,
      // a second adjacent dot means this is not a quantity.
      if (/^\.\d/.test(next)) continue
    }
    const value = Number(token.replace(/[$€£,%]/g, '').replace(/,/g, ''))
    if (Number.isFinite(value)) results.push(value)
  }
  return results
}

function normalizeNumber(value: number): string { return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') }
