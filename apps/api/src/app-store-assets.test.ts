import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_STORE_SCREENSHOT_SPECS, PROFITPILOT_SHOPIFY_SCOPES, PROFITPILOT_SHOPIFY_SCOPES_CSV, PROFITPILOT_WEBHOOK_TOPICS, appListingMetadata, missingShopifyScopes, parseShopifyScopes, renderShopifyAppToml, shopifyAppConfigFromEnv } from './app-store-assets.js'

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
    expect(config.apiVersion).toBe('2026-07')
    expect(toml).toContain('api_version = "2026-07"')
    expect(toml).toContain('[webhooks.privacy]')
    expect(toml).toContain('customer_data_request_url = "https://app.example/shopify/webhooks"')
    expect(toml).toContain('customer_deletion_url = "https://app.example/shopify/webhooks"')
    expect(toml).toContain('shop_deletion_url = "https://app.example/shopify/webhooks"')
    expect(toml).toContain('topics = ["app/uninstalled", "orders/create", "orders/updated", "customers/create", "customers/update", "products/update", "inventory_levels/update"]')
    expect(toml).toContain('uri = "/shopify/webhooks"')
    expect(toml).not.toContain('client_secret')
  })

  it('subscribes every automation webhook topic and never deprecated checkout/cart topics', () => {
    const config = shopifyAppConfigFromEnv({ SHOPIFY_API_KEY: 'key', SHOPIFY_APP_URL: 'https://app.example' })
    const toml = renderShopifyAppToml(config)
    for (const topic of PROFITPILOT_WEBHOOK_TOPICS) {
      expect(toml).toContain(topic)
    }
    expect(PROFITPILOT_WEBHOOK_TOPICS).toContain('app/uninstalled')
    for (const required of ['orders/create', 'orders/updated', 'customers/create', 'customers/update', 'products/update', 'inventory_levels/update']) {
      expect(PROFITPILOT_WEBHOOK_TOPICS).toContain(required)
    }
    expect(PROFITPILOT_WEBHOOK_TOPICS.some((topic) => topic.startsWith('checkouts/') || topic.startsWith('carts/'))).toBe(false)
    expect(toml).not.toMatch(/checkouts\//)
    expect(toml).not.toMatch(/carts\//)
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
    const listing = appListingMetadata({ SHOPIFY_APP_URL: 'https://app.example.com/' })
    expect(listing.description).toContain('does not invent store numbers')
    expect(listing.complianceLinks).toContain('https://app.example.com/legal/dpa')
  })

  it('resolves absolute HTTPS legal and support URLs from the app host', () => {
    const listing = appListingMetadata({ SHOPIFY_APP_URL: 'https://profitpilot-ai-production.up.railway.app', SUPPORT_EMAIL: 'support@example.com' })
    expect(listing.privacyPolicyUrl).toBe('https://profitpilot-ai-production.up.railway.app/legal/privacy')
    expect(listing.termsOfServiceUrl).toBe('https://profitpilot-ai-production.up.railway.app/legal/terms')
    expect(listing.securityPolicyUrl).toBe('https://profitpilot-ai-production.up.railway.app/legal/security')
    expect(listing.cookiePolicyUrl).toBe('https://profitpilot-ai-production.up.railway.app/legal/cookies')
    expect(listing.dataProcessingAddendumUrl).toBe('https://profitpilot-ai-production.up.railway.app/legal/dpa')
    expect(listing.supportUrl).toBe('https://profitpilot-ai-production.up.railway.app/support')
    expect(listing.supportEmail).toBe('support@example.com')
    expect(listing.complianceLinks.every((url) => url.startsWith('https://'))).toBe(true)
  })

  it('honors an explicit SUPPORT_URL override', () => {
    const listing = appListingMetadata({ SHOPIFY_APP_URL: 'https://app.example.com', SUPPORT_URL: 'https://help.profitpilot.example/contact' })
    expect(listing.supportUrl).toBe('https://help.profitpilot.example/contact')
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
      'read_discounts',
      'write_discounts',
      'read_price_rules',
    ])
    // discountCodeBasicCreate / discountCodeDeactivate are 403 without this one.
    expect(PROFITPILOT_SHOPIFY_SCOPES).toContain('write_discounts')
    // The GraphQL discount mutations no longer rely on the legacy REST scope.
    expect(PROFITPILOT_SHOPIFY_SCOPES).not.toContain('write_price_rules')
    // The REST discounts sync still reads legacy price rules.
    expect(PROFITPILOT_SHOPIFY_SCOPES).toContain('read_price_rules')
  })

  it('generates the complete scope TOML even when the environment is stale or empty', () => {
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
    expect(missingShopifyScopes('read_products,read_orders,read_customers,read_inventory,read_locations,read_discounts,read_price_rules')).toEqual(['write_discounts'])
    expect(missingShopifyScopes([])).toEqual([...PROFITPILOT_SHOPIFY_SCOPES])
  })

  it('keeps .env.example and the shopify.app.toml template identical to the registry', () => {
    const envExample = /^SHOPIFY_SCOPES=(.*)$/m.exec(repoFile('.env.example'))?.[1]?.trim()
    expect(envExample).toBe(PROFITPILOT_SHOPIFY_SCOPES_CSV)

    const templateScopes = /^scopes\s*=\s*"(.*)"$/m.exec(repoFile('docs/app-store/shopify.app.toml.template'))?.[1]
    expect(templateScopes).toBe(PROFITPILOT_SHOPIFY_SCOPES_CSV)
  })

  it('keeps the shopify.app.toml template webhook subscriptions identical to the registry', () => {
    const templateTopics = /^topics\s*=\s*\[(.*)\]$/m.exec(repoFile('docs/app-store/shopify.app.toml.template'))?.[1]
    const parsed = templateTopics ? [...templateTopics.matchAll(/"([^"]+)"/g)].map((match) => match[1]) : []
    expect(parsed).toEqual([...PROFITPILOT_WEBHOOK_TOPICS])
  })
})
