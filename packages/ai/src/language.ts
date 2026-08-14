import { AppError } from '@profitpilot/types'
import type { EvidenceField } from './evidence.js'

export function validateLanguageResponse(text: string, evidence: readonly EvidenceField[], impactValue: number): string {
  if (text.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'AI response is empty', 502)
  if (/(email|phone|address|credit card|full name|customer name)/i.test(text)) throw new AppError('VALIDATION_ERROR', 'AI response contains restricted PII', 502)
  const allowed = new Set([impactValue, ...evidence.flatMap((field) => typeof field.value === 'number' ? [field.value] : [])].map(normalizeNumber))
  for (const candidate of extractNumbers(text)) {
    if (!allowed.has(normalizeNumber(candidate))) throw new AppError('VALIDATION_ERROR', `AI response introduced an unsupported number: ${candidate}`, 502, { candidate })
  }
  return text.trim()
}

export function extractNumbers(text: string): readonly number[] {
  return [...text.matchAll(/(?:\$|€|£)?\b\d[\d,]*(?:\.\d+)?%?/g)].map((match) => Number((match[0] ?? '').replace(/[$€£,%]/g, '').replace(/,/g, ''))).filter((value) => Number.isFinite(value))
}

function normalizeNumber(value: number): string { return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') }
