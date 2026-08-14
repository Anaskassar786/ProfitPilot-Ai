import { describe, expect, it } from 'vitest'
import { createF1Bootstrap } from './bootstrap.js'
import type { F1Bootstrap } from './bootstrap.js'

const validEnv = {
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/profitpilot',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  SHOPIFY_API_KEY: 'key',
  SHOPIFY_API_SECRET: 'secret',
  SHOPIFY_REDIRECT_URI: 'https://app.example/shopify/callback',
}

async function withExchange(run: (bootstrap: F1Bootstrap) => Promise<void>): Promise<void> {
  const bootstrap = createF1Bootstrap(validEnv)
  expect(bootstrap).not.toBeNull()
  if (!bootstrap) throw new Error('F1 bootstrap should be configured')
  try {
    await run(bootstrap)
  } finally {
    await bootstrap.database.close()
  }
}

describe('F1 production bootstrap', () => {
  it('does not create provider clients when F1 is not configured', () => expect(createF1Bootstrap({})).toBeNull())
  it('rejects partial provider configuration instead of silently degrading', () => expect(() => createF1Bootstrap({ DATABASE_URL: 'postgres://db' })).toThrow('F1 bootstrap requires'))
  it('requires a valid encryption key when all providers are configured', () => expect(() => createF1Bootstrap({ DATABASE_URL: 'postgres://db', ENCRYPTION_KEY: 'short', SHOPIFY_API_KEY: 'key', SHOPIFY_API_SECRET: 'secret', SHOPIFY_REDIRECT_URI: 'https://app.example/callback' })).toThrow('32 bytes'))

  it('exchanges the authorization code against the SINGULAR Shopify access_token endpoint', async () => {
    const requests: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({ access_token: 'shpat_real_token', scope: 'read_products' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      await withExchange(async (bootstrap) => {
        const token = await bootstrap.shopify.exchange('commander-pilot.myshopify.com', 'oauth-code')
        expect(token).toBe('shpat_real_token')
        // Regression guard: the pluralized /admin/oauth/access_tokens path is a
        // Shopify 404 and was the root cause of the production callback 500s.
        expect(requests).toEqual(['https://commander-pilot.myshopify.com/admin/oauth/access_token'])
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reports the upstream status when Shopify rejects the exchange', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('Not Found', { status: 404 })) as typeof fetch
    try {
      await withExchange(async (bootstrap) => {
        await expect(bootstrap.shopify.exchange('commander-pilot.myshopify.com', 'bad-code')).rejects.toThrow('HTTP 404')
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('reports network failures from the exchange instead of hanging', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as typeof fetch
    try {
      await withExchange(async (bootstrap) => {
        await expect(bootstrap.shopify.exchange('commander-pilot.myshopify.com', 'code')).rejects.toThrow('could not reach commander-pilot.myshopify.com')
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
