import { describe, expect, it } from 'vitest'
import { productionAppUrl } from './app-url.js'

describe('production app URL validation', () => {
  it('accepts an absolute HTTPS production host', () => {
    expect(productionAppUrl({ SHOPIFY_APP_URL: 'https://profitpilot-ai-production.up.railway.app' })).toBe('https://profitpilot-ai-production.up.railway.app')
    expect(productionAppUrl({ APP_URL: 'https://app.profitpilot.ai/' })).toBe('https://app.profitpilot.ai/')
  })

  it('requires SHOPIFY_APP_URL or APP_URL', () => {
    expect(() => productionAppUrl({ NODE_ENV: 'production' })).toThrow('SHOPIFY_APP_URL')
    expect(() => productionAppUrl({ SHOPIFY_APP_URL: '   ' })).toThrow('SHOPIFY_APP_URL')
  })

  it('rejects HTTP, relative, and malformed values', () => {
    expect(() => productionAppUrl({ SHOPIFY_APP_URL: 'http://app.profitpilot.ai' })).toThrow(/HTTPS/)
    expect(() => productionAppUrl({ APP_URL: '/relative' })).toThrow(/absolute HTTPS/)
    expect(() => productionAppUrl({ APP_URL: 'not-a-url' })).toThrow(/absolute HTTPS/)
  })

  it('rejects localhost, loopback, and example.com placeholders', () => {
    expect(() => productionAppUrl({ SHOPIFY_APP_URL: 'https://localhost:3000' })).toThrow(/placeholder|localhost/)
    expect(() => productionAppUrl({ APP_URL: 'https://127.0.0.1' })).toThrow(/placeholder|localhost/)
    expect(() => productionAppUrl({ SHOPIFY_APP_URL: 'https://example.com' })).toThrow(/placeholder/)
    expect(() => productionAppUrl({ APP_URL: 'https://app.example.com' })).toThrow(/placeholder/)
    expect(() => productionAppUrl({ SHOPIFY_APP_URL: 'https://app.example' })).toThrow(/placeholder/)
  })
})
