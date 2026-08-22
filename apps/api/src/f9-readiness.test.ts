import { describe, expect, it } from 'vitest'
import { evaluateReadiness, httpHealthCheck, readinessChecksFromAdapters } from './readiness.js'
import { cachedAiCompletionHealth, shopifyHealth, SHOP_PROBE_QUERY } from './f9-bootstrap.js'

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
  it('probes Shopify readiness via Admin GraphQL ShopProbe, never REST /shop.json', async () => {
    const urls: string[] = []
    const check = shopifyHealth(
      { SHOPIFY_HEALTH_SHOP: 'demo.myshopify.com', SHOPIFY_HEALTH_ACCESS_TOKEN: 'token', SHOPIFY_API_VERSION: '2026-07' },
      async (input, init) => {
        urls.push(String(input))
        expect(init?.method).toBe('POST')
        expect(String(init?.body)).toContain('ShopProbe')
        expect(String(init?.body)).not.toContain('shop.json')
        return new Response(JSON.stringify({ data: { shop: { name: 'Demo', myshopifyDomain: 'demo.myshopify.com', plan: { displayName: 'Shopify Plus' } } } }), { status: 200 })
      },
    )
    await expect(check()).resolves.toBe(true)
    expect(urls).toEqual(['https://demo.myshopify.com/admin/api/2026-07/graphql.json'])
    expect(SHOP_PROBE_QUERY).toContain('myshopifyDomain')
    expect(SHOP_PROBE_QUERY).not.toContain('shop.json')
  })
})
