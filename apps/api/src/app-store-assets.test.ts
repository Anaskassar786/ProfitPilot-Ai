import { describe, expect, it } from 'vitest'
import { APP_STORE_SCREENSHOT_SPECS, appListingMetadata, renderShopifyAppToml, shopifyAppConfigFromEnv } from './app-store-assets.js'

describe('F7 Shopify App Store assets', () => {
  it('renders shopify.app.toml from environment without a secret', () => {
    const config = shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'public-client-id', SHOPIFY_APP_URL: 'https://app.example', SHOPIFY_REDIRECT_URI: 'https://app.example/shopify/callback', SHOPIFY_SCOPES: 'read_products, read_orders' })
    const toml = renderShopifyAppToml(config)
    expect(toml).toContain('client_id = "public-client-id"')
    expect(toml).toContain('https://app.example/shopify/callback')
    expect(toml).toContain('scopes = "read_products,read_orders"')
    expect(toml).toContain('compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]')
    expect(toml).toContain('uri = "/shopify/webhooks"')
    expect(toml).not.toContain('client_secret')
  })

  it('uses APP_URL fallback and validates generator inputs', () => {
    expect(shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'key', APP_URL: 'https://app.example' }).redirectUrls[0]).toBe('https://app.example/shopify/callback')
    expect(() => shopifyAppConfigFromEnv({ APP_URL: 'https://app.example' })).toThrow('SHOPIFY_API_KEY')
    expect(() => shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'key' })).toThrow('SHOPIFY_APP_URL')
    expect(() => shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'key', APP_URL: 'https://app.example', SHOPIFY_SCOPES: '   ' })).toThrow('SHOPIFY_SCOPES')
  })

  it('publishes screenshot specs and an honest listing template', () => {
    expect(APP_STORE_SCREENSHOT_SPECS).toHaveLength(4)
    expect(APP_STORE_SCREENSHOT_SPECS.every((spec) => spec.width === 1600 && spec.height === 1000 && spec.format === 'PNG')).toBe(true)
    const listing = appListingMetadata()
    expect(listing.description).toContain('does not invent store numbers')
    expect(listing.complianceLinks).toContain('/legal/dpa')
  })
})
