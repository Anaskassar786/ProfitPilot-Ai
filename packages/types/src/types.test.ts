import { describe, expect, it } from 'vitest'
import { AppError, PhaseNotImplementedError, err, failure, isStoreId, jobId, limitFor, ok, requestId, storeId, success, unwrap, userId } from './index.js'

describe('typed identifiers', () => {
  it('creates store identifiers', () => expect(storeId('store-1')).toBe('store-1'))
  it('creates user identifiers', () => expect(userId('user-1')).toBe('user-1'))
  it('creates job identifiers', () => expect(jobId('job-1')).toBe('job-1'))
  it('creates request identifiers', () => expect(requestId('req-1')).toBe('req-1'))
  it('rejects blank identifiers', () => expect(() => storeId('  ')).toThrow('cannot be empty'))
  it('recognizes non-empty store identifiers', () => expect(isStoreId('shop-123')).toBe(true))
  it('rejects blank store identifiers', () => expect(isStoreId('')).toBe(false))
})

describe('results and API envelopes', () => {
  it('creates and unwraps a success result', () => expect(unwrap(ok(42))).toBe(42))
  it('throws the error from a failed result', () => {
    const error = new Error('no')
    expect(() => unwrap(err(error))).toThrow('no')
  })
  it('creates a success envelope with request metadata', () => {
    const envelope = success({ count: 2 }, requestId('req-1'), '2024-01-01T00:00:00.000Z')
    expect(envelope.ok).toBe(true)
    expect(envelope.meta.requestId).toBe('req-1')
  })
  it('creates a failure envelope', () => {
    const envelope = failure({ code: 'NOPE', message: 'Nope', details: {} }, requestId('req-2'))
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('NOPE')
  })
})

describe('errors and entitlements', () => {
  it('serializes an exposed application error', () => {
    const error = new AppError('VALIDATION_ERROR', 'Bad input', 400, { field: 'email' })
    expect(error.toJSON()).toEqual({ code: 'VALIDATION_ERROR', message: 'Bad input', details: { field: 'email' } })
  })
  it('hides non-exposed error messages', () => {
    const error = new AppError('INTERNAL_ERROR', 'database secret', 500, {}, false)
    expect(error.toJSON().message).toBe('Internal server error')
  })
  it('creates explicit future phase errors', () => {
    const error = new PhaseNotImplementedError('F1', 'OAuth install')
    expect(error.phase).toBe('F1')
    expect(error.status).toBe(501)
  })
  it('returns a known plan limit', () => expect(limitFor('growth', 'aiRecommendations')).toBe(150))
  it('returns unlimited as null for Commander', () => expect(limitFor('commander', 'jarvisMessages')).toBeNull())
  it('returns zero for an unknown entitlement', () => expect(limitFor('start', 'missing')).toBe(0))
})
