import { describe, expect, it } from 'vitest'
import { injectShopifyAppBridgeApiKey } from './web-app.js'

describe('App Bridge API key injection', () => {
  it('fills the Shopify meta tag from the public client id at serve time', () => {
    const html = '<meta name="shopify-api-key" content="%VITE_SHOPIFY_API_KEY%" />'
    expect(injectShopifyAppBridgeApiKey(html, 'abc123client')).toBe('<meta name="shopify-api-key" content="abc123client" />')
  })

  it('replaces an empty baked meta tag', () => {
    const html = '<head><meta name="shopify-api-key" content="" /></head>'
    expect(injectShopifyAppBridgeApiKey(html, 'live-client')).toBe('<head><meta name="shopify-api-key" content="live-client" /></head>')
  })

  it('leaves unrelated HTML untouched', () => {
    const html = '<!doctype html><html><body><div id="root">ProfitPilot web shell</div></body></html>'
    expect(injectShopifyAppBridgeApiKey(html, 'abc123client')).toBe(html)
  })
})
