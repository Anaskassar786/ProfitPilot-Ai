import { describe, expect, it } from 'vitest'
import { createF7Bootstrap } from './f7-bootstrap.js'

const completeEnv = {
  DATABASE_URL: 'postgres://localhost/profitpilot',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  SHOPIFY_API_KEY: 'shopify-key',
  SHOPIFY_API_SECRET: 'shopify-secret',
  SHOPIFY_REDIRECT_URI: 'https://app.example/shopify/callback',
  OPENROUTER_API_KEY_1: 'openrouter-key',
  ADMIN_KEY: 'admin-key',
  JWT_SECRET: 'jwt-secret-that-is-at-least-32-characters-long',
  JWT_ISSUER: 'profitpilot',
  CSRF_SECRET: 'csrf-secret-that-is-at-least-32-characters-long',
  LEGAL_ENTITY_NAME: 'Anash Ali',
  LEGAL_ENTITY_ADDRESS: 'Tanda Mallu Ramnagar Uttarakhand 244715',
  LEGAL_JURISDICTION: 'Uttarakhand India',
  SUPPORT_EMAIL: 'anasanasali1714@gmail.com',
} as const

describe('F7 production bootstrap', () => {
  it('does not construct F7 services without F1 configuration', () => expect(createF7Bootstrap({})).toBeNull())
  it('fails closed on partial provider configuration', () => expect(() => createF7Bootstrap({ DATABASE_URL: 'postgres://localhost/profitpilot' })).toThrow('F1 bootstrap requires'))
  it('wires real legal, access-review, and production security dependencies', async () => {
    const bootstrap = createF7Bootstrap(completeEnv)
    expect(bootstrap).not.toBeNull()
    expect(bootstrap?.legal.config.entityName).toBe('Anash Ali')
    expect(bootstrap?.accessReview).toBeDefined()
    expect(bootstrap?.security.auth).toBeDefined()
    await bootstrap?.database.close()
  })
})
