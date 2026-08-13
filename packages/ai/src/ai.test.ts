import { describe, expect, it } from 'vitest'
import { AppError, storeId } from '@profitpilot/types'
import { CompareAndSetApprovals, assertPiiMinimized, buildEvidencePack, verifyEvidencePack } from './index.js'

const fields = [{ key: 'days_inactive', label: 'Days inactive', value: 80, source: 'customers.last_order_at' }, { key: 'average_ltv', label: 'Average LTV', value: 189, source: 'customers.ltv' }] as const

describe('immutable AI evidence packs', () => {
  it('builds a hashed pack from deterministic fields', () => {
    const pack = buildEvidencePack({ id: 'e1', storeId: storeId('s1'), ruleId: 'churn-risk', ruleVersion: '1.0.0', fields, generatedAt: '2024-01-01T00:00:00.000Z' })
    expect(pack.sha256).toHaveLength(64)
    expect(verifyEvidencePack(pack)).toBe(true)
  })
  it('canonicalizes field order', () => {
    const first = buildEvidencePack({ id: 'e1', storeId: storeId('s1'), ruleId: 'r', ruleVersion: '1', fields, generatedAt: 'now' })
    const second = buildEvidencePack({ id: 'e1', storeId: storeId('s1'), ruleId: 'r', ruleVersion: '1', fields: [...fields].reverse(), generatedAt: 'now' })
    expect(first.sha256).toBe(second.sha256)
  })
  it('rejects PII fields before hashing', () => expect(() => assertPiiMinimized([{ key: 'email', label: 'Email', value: 'hidden@example.com', source: 'customer.email' }])).toThrow(AppError))
  it('rejects customer IDs as PII', () => expect(() => assertPiiMinimized([{ key: 'customer_id', label: 'Customer ID', value: 'gid://1', source: 'customer.id' }])).toThrow('PII'))
  it('freezes the pack and field list', () => {
    const pack = buildEvidencePack({ id: 'e1', storeId: storeId('s1'), ruleId: 'r', ruleVersion: '1', fields, generatedAt: 'now' })
    expect(Object.isFrozen(pack)).toBe(true)
    expect(Object.isFrozen(pack.fields)).toBe(true)
  })
  it('keeps evidence fields immutable after creation', () => {
    const pack = buildEvidencePack({ id: 'e1', storeId: storeId('s1'), ruleId: 'r', ruleVersion: '1', fields, generatedAt: 'now' })
    expect(verifyEvidencePack(pack)).toBe(true)
  })
})

describe('CAS approval state', () => {
  it('creates pending approvals', () => expect(new CompareAndSetApprovals().create('r1').status).toBe('pending'))
  it('rejects duplicate approval creation', () => {
    const approvals = new CompareAndSetApprovals()
    approvals.create('r1')
    expect(() => approvals.create('r1')).toThrow('already exists')
  })
  it('approves with the expected version', () => {
    const approvals = new CompareAndSetApprovals()
    approvals.create('r1')
    expect(approvals.decide('r1', 0, 'approved').version).toBe(1)
  })
  it('rejects stale approval writes', () => {
    const approvals = new CompareAndSetApprovals()
    approvals.create('r1')
    approvals.decide('r1', 0, 'approved')
    expect(() => approvals.decide('r1', 0, 'rejected')).toThrow('already changed')
  })
  it('returns null for missing approvals', () => expect(new CompareAndSetApprovals().get('missing')).toBeNull())
})
