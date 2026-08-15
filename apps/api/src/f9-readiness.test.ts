import { describe, expect, it } from 'vitest'
import { evaluateReadiness, httpHealthCheck, readinessChecksFromAdapters } from './readiness.js'
import { cachedAiCompletionHealth } from './f9-bootstrap.js'

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
  it('runs a completion health check and caches it for five minutes', async () => {
    let calls = 0; let now = 1_000
    const check = cachedAiCompletionHealth({ completionHealthCheck: async () => { calls += 1; return true } }, 300_000, () => now)
    await expect(check()).resolves.toBe(true)
    await expect(check()).resolves.toBe(true)
    expect(calls).toBe(1)
    now += 300_001
    await expect(check()).resolves.toBe(true)
    expect(calls).toBe(2)
  })
})
