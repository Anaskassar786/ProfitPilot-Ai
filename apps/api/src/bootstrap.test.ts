import { describe, expect, it } from 'vitest'
import { createF1Bootstrap } from './bootstrap.js'

describe('F1 production bootstrap', () => {
  it('does not create provider clients when F1 is not configured', () => expect(createF1Bootstrap({})).toBeNull())
  it('rejects partial provider configuration instead of silently degrading', () => expect(() => createF1Bootstrap({ DATABASE_URL: 'postgres://db' })).toThrow('F1 bootstrap requires'))
  it('requires a valid encryption key when all providers are configured', () => expect(() => createF1Bootstrap({ DATABASE_URL: 'postgres://db', ENCRYPTION_KEY: 'short', SHOPIFY_API_KEY: 'key', SHOPIFY_API_SECRET: 'secret', SHOPIFY_REDIRECT_URI: 'https://app.example/callback' })).toThrow('32 bytes'))
})
