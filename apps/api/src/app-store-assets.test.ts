import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_STORE_SCREENSHOT_SPECS, PROFITPILOT_SHOPIFY_SCOPES, PROFITPILOT_SHOPIFY_SCOPES_CSV, appListingMetadata, missingShopifyScopes, parseShopifyScopes, renderShopifyAppToml, shopifyAppConfigFromEnv } from './app-store-assets.js'

const REPO_ROOT = new URL('../../../', import.meta.url)

function repoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, REPO_ROOT), 'utf8')
}

describe('F7 Shopify App Store assets', () => {
  it('renders shopify.app.toml from environment without a secret', () => {
    const config = shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'public-client-id', SHOPIFY_APP_URL: 'https://app.example', SHOPIFY_REDIRECT_URI: 'https://app.example/shopify/callback', SHOPIFY_SCOPES: PROFITPILOT_SHOPIFY_SCOPES_CSV })
    const toml = renderShopifyAppToml(config)
    expect(toml).toContain('client_id = "public-client-id"')
    expect(toml).toContain('https://app.example/shopify/callback')
    expect(toml).toContain(`scopes = "${PROFITPILOT_SHOPIFY_SCOPES_CSV}"`)
    expect(toml).toContain('[webhooks.privacy]')
    expect(toml).toContain('customer_data_request_url = "https://app.example/shopify/webhooks"')
    expect(toml).toContain('customer_deletion_url = "https://app.example/shopify/webhooks"')
    expect(toml).toContain('shop_deletion_url = "https://app.example/shopify/webhooks"')
    expect(toml).toContain('topics = ["app/uninstalled"]')
    expect(toml).toContain('uri = "/shopify/webhooks"')
    expect(toml).not.toContain('client_secret')
  })

  it('uses APP_URL fallback and validates generator inputs', () => {
    expect(shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'key', APP_URL: 'https://app.example' }).redirectUrls[0]).toBe('https://app.example/shopify/callback')
    expect(() => shopifyAppConfigFromEnv({ APP_URL: 'https://app.example' })).toThrow('SHOPIFY_API_KEY')
    expect(() => shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'key' })).toThrow('SHOPIFY_APP_URL')
  })

  it('derives privacy webhook URLs from the app host and honors an explicit override', () => {
    const derived = shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'key', SHOPIFY_APP_URL: 'https://profitpilot-ai-production.up.railway.app' })
    expect(derived.privacyWebhookUrl).toBe('https://profitpilot-ai-production.up.railway.app/shopify/webhooks')
    expect(renderShopifyAppToml(derived)).toContain('customer_data_request_url = "https://profitpilot-ai-production.up.railway.app/shopify/webhooks"')

    const pinned = shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'key', SHOPIFY_APP_URL: 'https://app.example', SHOPIFY_PRIVACY_WEBHOOK_URL: 'https://profitpilot-ai-production.up.railway.app/shopify/webhooks' })
    expect(renderShopifyAppToml(pinned)).toContain('customer_deletion_url = "https://profitpilot-ai-production.up.railway.app/shopify/webhooks"')
  })

  it('publishes screenshot specs and an honest listing template', () => {
    expect(APP_STORE_SCREENSHOT_SPECS).toHaveLength(4)
    expect(APP_STORE_SCREENSHOT_SPECS.every((spec) => spec.width === 1600 && spec.height === 1000 && spec.format === 'PNG')).toBe(true)
    const listing = appListingMetadata()
    expect(listing.description).toContain('does not invent store numbers')
    expect(listing.complianceLinks).toContain('/legal/dpa')
  })
})

describe('Shopify scope registry', () => {
  it('requests every scope ProfitPilot executes against, including discount writes', () => {
    expect([...PROFITPILOT_SHOPIFY_SCOPES]).toEqual([
      'read_products',
      'read_orders',
      'read_customers',
      'read_inventory',
      'read_locations',
      'read_checkouts',
      'read_price_rules',
      'write_price_rules',
    ])
    // discountCodeBasicCreate / discountCodeDeactivate are 403 without this one.
    expect(PROFITPILOT_SHOPIFY_SCOPES).toContain('write_price_rules')
  })

  it('generates the complete 8-scope TOML even when the environment is stale or empty', () => {
    const base = { SHOPIFY_API_KEY: 'key', SHOPIFY_APP_URL: 'https://app.example' }
    for (const env of [base, { ...base, SHOPIFY_SCOPES: '   ' }, { ...base, SHOPIFY_SCOPES: 'read_products,read_price_rules' }]) {
      const config = shopifyAppConfigFromEnv(env)
      expect(config.scopes).toHaveLength(8)
      expect(missingShopifyScopes(config.scopes)).toEqual([])
      expect(renderShopifyAppToml(config)).toContain(`scopes = "${PROFITPILOT_SHOPIFY_SCOPES_CSV}"`)
    }
  })

  it('keeps operator-supplied extra scopes after the required ones', () => {
    expect(parseShopifyScopes('write_products, read_products')).toEqual([...PROFITPILOT_SHOPIFY_SCOPES, 'write_products'])
    expect(parseShopifyScopes(undefined)).toEqual([...PROFITPILOT_SHOPIFY_SCOPES])
  })

  it('reports the scopes an installation is missing', () => {
    expect(missingShopifyScopes(PROFITPILOT_SHOPIFY_SCOPES_CSV)).toEqual([])
    expect(missingShopifyScopes('read_products,read_orders,read_customers,read_inventory,read_locations,read_checkouts,read_price_rules')).toEqual(['write_price_rules'])
    expect(missingShopifyScopes([])).toEqual([...PROFITPILOT_SHOPIFY_SCOPES])
  })

  it('keeps .env.example and the shopify.app.toml template identical to the registry', () => {
    const envExample = /^SHOPIFY_SCOPES=(.*)$/m.exec(repoFile('.env.example'))?.[1]?.trim()
    expect(envExample).toBe(PROFITPILOT_SHOPIFY_SCOPES_CSV)

    const templateScopes = /^scopes\s*=\s*"(.*)"$/m.exec(repoFile('docs/app-store/shopify.app.toml.template'))?.[1]
    expect(templateScopes).toBe(PROFITPILOT_SHOPIFY_SCOPES_CSV)
  })
})
