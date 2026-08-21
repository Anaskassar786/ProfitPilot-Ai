import { describe, expect, it } from 'vitest'
import { OAuthStateStore, ShopifyInstallService } from '@profitpilot/shopify'
import type { TokenVault } from '@profitpilot/shopify'
import type { StoreDirectory } from '@profitpilot/db'
import { PROFITPILOT_SHOPIFY_SCOPES, PROFITPILOT_SHOPIFY_SCOPES_CSV, parseShopifyScopes } from './app-store-assets.js'

/**
 * The OAuth install URL is what the merchant actually approves. If a scope is
 * missing here the grant is missing it too, and the discount mutations run by
 * the AI Command Center and Automation Engine come back 403 Access Denied.
 */
async function authorizationUrl(scopes: readonly string[]): Promise<URL> {
  const service = new ShopifyInstallService(
    { apiKey: 'client-id', apiSecret: 'secret', scopes, redirectUri: 'https://app.example/shopify/callback' },
    new OAuthStateStore(),
    {} as TokenVault,
    {} as StoreDirectory,
  )
  const start = await service.start('commander-pilot.myshopify.com')
  return new URL(start.authorizationUrl)
}

describe('Shopify OAuth install scopes', () => {
  it('requests every registry scope, write_discounts included', async () => {
    const url = await authorizationUrl(parseShopifyScopes(process.env.SHOPIFY_SCOPES))
    const requested = (url.searchParams.get('scope') ?? '').split(',')
    for (const scope of PROFITPILOT_SHOPIFY_SCOPES) expect(requested).toContain(scope)
    expect(requested).toContain('write_discounts')
    expect(requested).not.toContain('write_price_rules')
    expect(url.searchParams.get('scope')).toBe(PROFITPILOT_SHOPIFY_SCOPES_CSV)
  })

  it('repairs a stale SHOPIFY_SCOPES value that predates discount actions', async () => {
    const url = await authorizationUrl(parseShopifyScopes('read_products,read_orders'))
    expect(url.searchParams.get('scope')).toBe(PROFITPILOT_SHOPIFY_SCOPES_CSV)
  })

  it('preserves an operator-supplied scope after the required ones', async () => {
    const url = await authorizationUrl(parseShopifyScopes('read_products,read_orders,read_price_rules'))
    expect(url.searchParams.get('scope')).toBe([...PROFITPILOT_SHOPIFY_SCOPES, 'read_price_rules'].join(','))
  })
})
