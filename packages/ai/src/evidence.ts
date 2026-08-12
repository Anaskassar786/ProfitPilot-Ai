import { createHash } from 'node:crypto'
import { AppError, PhaseNotImplementedError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export type EvidenceValue = string | number | boolean | null
export type EvidenceField = Readonly<{ key: string; label: string; value: EvidenceValue; source: string }>
export type EvidencePack = Readonly<{
  id: string
  storeId: StoreId
  ruleId: string
  ruleVersion: string
  fields: readonly EvidenceField[]
  generatedAt: string
  sha256: string
}>

const PII_KEY = /(email|phone|address|first_?name|last_?name|full_?name|credit|card|customer_?id)/i

export function assertPiiMinimized(fields: readonly EvidenceField[]): void {
  const violation = fields.find((field) => PII_KEY.test(field.key) || PII_KEY.test(field.label))
  if (violation) {
    throw new AppError('VALIDATION_ERROR', `PII field ${violation.key} cannot enter an AI evidence pack`, 400, { field: violation.key })
  }
}

export function buildEvidencePack(input: Readonly<{ id: string; storeId: StoreId; ruleId: string; ruleVersion: string; fields: readonly EvidenceField[]; generatedAt: string }>): EvidencePack {
  assertPiiMinimized(input.fields)
  const fields = [...input.fields].sort((left, right) => left.key.localeCompare(right.key))
  const canonical = JSON.stringify({ id: input.id, storeId: input.storeId, ruleId: input.ruleId, ruleVersion: input.ruleVersion, fields, generatedAt: input.generatedAt })
  const sha256 = createHash('sha256').update(canonical, 'utf8').digest('hex')
  return Object.freeze({ ...input, fields: Object.freeze(fields), sha256 })
}

export function verifyEvidencePack(pack: EvidencePack): boolean {
  const rebuilt = buildEvidencePack({ id: pack.id, storeId: pack.storeId, ruleId: pack.ruleId, ruleVersion: pack.ruleVersion, fields: pack.fields, generatedAt: pack.generatedAt })
  return rebuilt.sha256 === pack.sha256
}

export function runAgent(_agent: string): never {
  throw new PhaseNotImplementedError('F4', 'AI decision engine execution')
}
