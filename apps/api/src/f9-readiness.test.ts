import { describe, expect, it } from 'vitest'
import { evaluateReadiness, httpHealthCheck, readinessChecksFromAdapters } from './readiness.js'

describe('F9 four-check readiness', () => {
  it('exposes honest database/redis/AI/Shopify adapter statuses', async () => {
    const checks = readinessChecksFromAdapters({ database: async () => true, redis: async () => false, ai: async () => true, shopify: async () => false })
    const result = await evaluateReadiness(checks)
    expect(result.checks.map((check) => check.name)).toEqual(['database', 'redis', 'ai', 'shopify'])
    expect(result.ok).toBe(false)
  })
  it('wraps HTTP provider health and handles non-OK responses', async () => {
    const ok = httpHealthCheck({ url: 'https://provider', fetcher: async () => new Response('', { status: 200 }) })
    const bad = httpHealthCheck({ url: 'https://provider', headers: { authorization: 'Bearer key' }, fetcher: async () => new Response('', { status: 503 }) })
    await expect(ok()).resolves.toBe(true)
    await expect(bad()).resolves.toBe(false)
  })
})
