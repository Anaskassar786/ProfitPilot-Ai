import { describe, expect, it } from 'vitest'
import { evaluateReadiness, readinessChecksFromEnv } from './index.js'

describe('API readiness boundary', () => {
  it('is ready when every dependency check succeeds', async () => {
    const result = await evaluateReadiness([{ name: 'database', check: async () => true }, { name: 'redis', check: async () => true }])
    expect(result.ok).toBe(true)
    expect(result.checks).toHaveLength(2)
  })
  it('is not ready when a dependency check fails', async () => {
    const result = await evaluateReadiness([{ name: 'database', check: async () => true }, { name: 'redis', check: async () => false }])
    expect(result.ok).toBe(false)
  })
  it('converts thrown dependency checks to failed status', async () => {
    const result = await evaluateReadiness([{ name: 'ai', check: async () => { throw new Error('offline') } }])
    expect(result.checks[0]?.ok).toBe(false)
  })
})


describe('provider configuration readiness', () => {
  it('requires all F0 provider configuration keys', async () => {
    const result = await evaluateReadiness(readinessChecksFromEnv({ DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://cache', OPENROUTER_API_KEY_1: 'key', SHOPIFY_API_KEY: 'key' }))
    expect(result.ok).toBe(true)
  })
  it('does not report ready without provider configuration', async () => {
    const result = await evaluateReadiness(readinessChecksFromEnv({}))
    expect(result.ok).toBe(false)
    expect(result.checks).toHaveLength(4)
  })
})
