import { parseShopDomain } from './oauth.js'
import { verifyShopifySessionToken } from './session-token.js'
import type { SessionTokenConfig } from './session-token.js'
import type { TokenVault } from './token-vault.js'

export const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token'
export const OFFLINE_ACCESS_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:offline-access-token'

export type TokenExchangeTransport = (url: string, init: RequestInit) => Promise<Response>
export type OfflineTokenResult = Readonly<{
  shop: string
  scopes: readonly string[]
  source: 'existing' | 'exchanged'
}>

/**
 * Exchanges a short-lived Shopify session token (`id_token`) for a
 * non-expiring offline Admin API access token and stores it through TokenVault.
 * The plaintext access token never leaves this service.
 */
export class ShopifyTokenExchangeService {
  private readonly config: SessionTokenConfig
  private readonly vault: TokenVault
  private readonly transport: TokenExchangeTransport
  private readonly exchanges = new Map<string, Promise<OfflineTokenResult>>()

  public constructor(config: SessionTokenConfig, vault: TokenVault, transport: TokenExchangeTransport = fetch) {
    if (!config.apiKey.trim() || !config.apiSecret.trim()) throw new TypeError('Shopify token exchange requires API credentials')
    this.config = config
    this.vault = vault
    this.transport = transport
  }

  public async hasAccessToken(shop: string): Promise<boolean> {
    return (await this.vault.get(parseShopDomain(shop))) !== null
  }

  /** Return the existing token state, or exchange only when the vault is empty. */
  public async ensureOfflineAccessToken(shop: string, idToken: string): Promise<OfflineTokenResult> {
    const normalizedShop = parseShopDomain(shop)
    if (await this.hasAccessToken(normalizedShop)) return { shop: normalizedShop, scopes: [], source: 'existing' }
    return this.exchangeOfflineAccessToken(normalizedShop, idToken)
  }

  /** Force token rotation, used after Shopify rejects a stored token with 401. */
  public async exchangeOfflineAccessToken(shop: string, idToken: string): Promise<OfflineTokenResult> {
    const normalizedShop = parseShopDomain(shop)
    const active = this.exchanges.get(normalizedShop)
    if (active) return active

    const exchange = this.performExchange(normalizedShop, idToken)
    this.exchanges.set(normalizedShop, exchange)
    try {
      return await exchange
    } finally {
      if (this.exchanges.get(normalizedShop) === exchange) this.exchanges.delete(normalizedShop)
    }
  }

  private async performExchange(shop: string, idToken: string): Promise<OfflineTokenResult> {
    const subjectToken = idToken.trim()
    const claims = subjectToken ? verifyShopifySessionToken(subjectToken, this.config) : null
    if (!claims) throw new ShopifyTokenExchangeError('Shopify session token is invalid or expired')
    if (claims.shop !== shop) throw new ShopifyTokenExchangeError('Shopify session token does not belong to this store')

    const body = new URLSearchParams({
      client_id: this.config.apiKey,
      client_secret: this.config.apiSecret,
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token: subjectToken,
      subject_token_type: ID_TOKEN_TYPE,
      requested_token_type: OFFLINE_ACCESS_TOKEN_TYPE,
      expiring: '0',
    })

    let response: Response
    try {
      response = await this.transport(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new ShopifyTokenExchangeError(`Shopify token exchange could not reach ${shop}: ${detail}`, null, error)
    }

    if (!response.ok) {
      // Never include the subject token or app secret in diagnostics. Shopify's
      // status is enough to distinguish an expired id_token (400) from an
      // upstream outage, while the response body can contain provider details.
      throw new ShopifyTokenExchangeError(`Shopify token exchange failed with HTTP ${response.status}`, response.status)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error: unknown) {
      throw new ShopifyTokenExchangeError('Shopify token exchange returned invalid JSON', response.status, error)
    }
    if (!isRecord(payload) || typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw new ShopifyTokenExchangeError('Shopify token exchange response did not contain an access token', response.status)
    }

    await this.vault.put(shop, payload.access_token)
    return { shop, scopes: parseScopes(payload.scope), source: 'exchanged' }
  }
}

export class ShopifyTokenExchangeError extends Error {
  public readonly upstreamStatus: number | null

  public constructor(message: string, upstreamStatus: number | null = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ShopifyTokenExchangeError'
    this.upstreamStatus = upstreamStatus
  }
}

function parseScopes(value: unknown): readonly string[] {
  if (typeof value !== 'string') return []
  return value.split(',').map((scope) => scope.trim()).filter((scope) => scope.length > 0)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
