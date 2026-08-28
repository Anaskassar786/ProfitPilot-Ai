import { describe, expect, it } from 'vitest'
import { enforceSecureTls } from './index.js'

describe('enforceSecureTls', () => {
  it('restores certificate verification when the deployment disables it', () => {
    const env: Record<string, string | undefined> = { NODE_TLS_REJECT_UNAUTHORIZED: '0' }
    const logs: string[] = []
    expect(enforceSecureTls(env, (message) => logs.push(message))).toEqual({ enforced: true, previous: '0' })
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('1')
    expect(logs[0]).toContain('NODE_TLS_REJECT_UNAUTHORIZED')
  })
  it('leaves a secure value alone', () => {
    const env: Record<string, string | undefined> = { NODE_TLS_REJECT_UNAUTHORIZED: '1' }
    expect(enforceSecureTls(env).enforced).toBe(false)
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('1')
  })
  it('does nothing when the variable is absent', () => {
    const env: Record<string, string | undefined> = {}
    expect(enforceSecureTls(env)).toEqual({ enforced: false, previous: null })
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined()
  })
  it('does not invent the variable when it was never set', () => {
    const env: Record<string, string | undefined> = { PORT: '3000' }
    enforceSecureTls(env)
    expect('NODE_TLS_REJECT_UNAUTHORIZED' in env).toBe(false)
  })
  it('treats only the exact insecure value 0 as disabled', () => {
    for (const value of ['false', '00', 'no']) {
      const env: Record<string, string | undefined> = { NODE_TLS_REJECT_UNAUTHORIZED: value }
      expect(enforceSecureTls(env).enforced).toBe(false)
      expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(value)
    }
  })
  it('mutates a live process.env-like object in place', () => {
    const env: Record<string, string | undefined> = { NODE_TLS_REJECT_UNAUTHORIZED: ' 0 ' }
    expect(enforceSecureTls(env).enforced).toBe(true)
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('1')
  })
})
