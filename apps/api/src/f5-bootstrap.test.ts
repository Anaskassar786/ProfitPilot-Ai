import { describe, expect, it } from 'vitest'
import { createF5Bootstrap } from './f5-bootstrap.js'

const env = { DATABASE_URL: 'postgres://db', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', SHOPIFY_API_KEY: 'key', SHOPIFY_API_SECRET: 'secret', SHOPIFY_REDIRECT_URI: 'https://app.example/callback', ADMIN_KEY: 'admin' }

describe('F5 bootstrap', () => {
  it('fails closed without F1 and F4 provider configuration', () => expect(createF5Bootstrap({})).toBeNull())
  it('does not silently accept partial provider configuration', () => expect(() => createF5Bootstrap({ DATABASE_URL: 'postgres://db' })).toThrow('F1 bootstrap requires'))
  it('constructs real billing, admin, and provider adapters from env', async () => {
    const bootstrap = createF5Bootstrap({ ...env, SHOPIFY_BILLING_TEST_MODE: 'true' })
    expect(bootstrap?.billing.repository).toBeDefined()
    expect(bootstrap?.admin.adminKey).toBe('admin')
    await bootstrap?.database.close()
  })
})
