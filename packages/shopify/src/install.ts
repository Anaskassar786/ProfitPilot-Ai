import { parseShopDomain, verifyOAuthHmac } from './oauth.js'
import type { OAuthStateStore } from './oauth.js'
import type { TokenVault } from './token-vault.js'

export type ShopifyInstallConfig = Readonly<{ apiKey: string; apiSecret: string; scopes: readonly string[]; redirectUri: string }>
export type InstallStart = Readonly<{ shop: string; state: string; authorizationUrl: string }>
export type OAuthCallback = Readonly<Record<string, string>>
export type AccessTokenExchange = (shop: string, code: string) => Promise<string>

export class ShopifyInstallService {
  private readonly config: ShopifyInstallConfig
  private readonly states: OAuthStateStore
  private readonly vault: TokenVault

  public constructor(config: ShopifyInstallConfig, states: OAuthStateStore, vault: TokenVault) {
    if (!config.apiKey.trim() || !config.apiSecret.trim() || !config.redirectUri.trim()) throw new TypeError('Shopify OAuth configuration is incomplete')
    this.config = config
    this.states = states
    this.vault = vault
  }

  public start(shop: string): InstallStart {
    const normalizedShop = parseShopDomain(shop)
    const state = this.states.issue(normalizedShop)
    const params = new URLSearchParams({ client_id: this.config.apiKey, scope: this.config.scopes.join(','), redirect_uri: this.config.redirectUri, state: state.token })
    return { shop: normalizedShop, state: state.token, authorizationUrl: `https://${normalizedShop}/admin/oauth/authorize?${params.toString()}` }
  }

  public async complete(callback: OAuthCallback, exchange: AccessTokenExchange): Promise<Readonly<{ shop: string; tokenStored: true }>> {
    const shop = parseShopDomain(callback.shop ?? '')
    if (!verifyOAuthHmac(callback, this.config.apiSecret)) throw new Error('Invalid Shopify OAuth callback signature')
    if (!callback.state || !this.states.consume(callback.state, shop)) throw new Error('Invalid or replayed Shopify OAuth state')
    if (!callback.code?.trim()) throw new Error('Shopify OAuth callback is missing code')
    const accessToken = await exchange(shop, callback.code)
    await this.vault.put(shop, accessToken)
    return { shop, tokenStored: true }
  }
}
