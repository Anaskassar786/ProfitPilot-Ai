import { describe, expect, it, vi } from 'vitest'
import { PostgresDatabase } from '@profitpilot/db'
import { createF9Bootstrap } from './f9-bootstrap.js'

describe('F9 bootstrap boundary', () => {
  it('does not build launch controls without earlier-phase configuration', () => expect(createF9Bootstrap({})).toBeNull())
  it('builds launch controls and evaluates all four health adapters', async () => {
    const query = vi.spyOn(PostgresDatabase.prototype, 'query').mockResolvedValue({ rows: [], rowCount: 0 })
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: {} }), { status: 200 })
      if (url.includes('/models/')) return new Response(JSON.stringify({ data: { endpoints: [{ status: 0 }] } }), { status: 200 })
      return new Response('', { status: 200 })
    })
    const bootstrap = createF9Bootstrap({ NODE_ENV: 'development', DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://cache', UPSTASH_REDIS_REST_URL: 'https://redis', UPSTASH_REDIS_REST_TOKEN: 'token', OPENROUTER_API_KEY_1: 'key', SHOPIFY_API_KEY: 'shopify', SHOPIFY_API_SECRET: 'secret', SHOPIFY_REDIRECT_URI: 'https://app/callback', SHOPIFY_HEALTH_SHOP: 'store.myshopify.com', SHOPIFY_HEALTH_ACCESS_TOKEN: 'token', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', ADMIN_KEY: 'admin', JWT_SECRET: 'jwt-secret-that-is-at-least-32-characters', LEGAL_ENTITY_NAME: 'Entity', LEGAL_ENTITY_ADDRESS: 'Address', LEGAL_JURISDICTION: 'India', SUPPORT_EMAIL: 'support@example.com' })
    expect(bootstrap?.f9).toBeDefined()
    for (const check of bootstrap?.f9.readinessChecks ?? []) await expect(check.check()).resolves.toBe(true)
    await bootstrap?.f8.forecasting.forecast('store-1')
    await bootstrap?.database.close()
    query.mockRestore(); vi.unstubAllGlobals()
  })
})
