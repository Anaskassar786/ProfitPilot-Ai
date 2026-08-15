import { parseShopDomain } from './oauth.js'
import { describeSessionTokenRejection, verifyShopifySessionToken } from './session-token.js'
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
  /** Comma-separated list of OAuth scopes to request during token exchange. */
  private readonly scopes: string

  public constructor(config: SessionTokenConfig, vault: TokenVault, transport: TokenExchangeTransport = fetch) {
    if (!config.apiKey.trim() || !config.apiSecret.trim()) throw new TypeError('Shopify token exchange requires API credentials')
    this.config = config
    this.vault = vault
    this.transport = transport
    this.scopes = config.scopes?.trim() ?? ''
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
    if (!subjectToken) throw new ShopifyTokenExchangeError('Shopify session token is missing', null, undefined, 'missing_subject_token')
    const claims = verifyShopifySessionToken(subjectToken, this.config)
    if (!claims) {
      // Name the exact rejection reason: a wrong SHOPIFY_API_SECRET and a
      // merely expired id_token are indistinguishable without it.
      const rejection = describeSessionTokenRejection(subjectToken, this.config)
      throw new ShopifyTokenExchangeError(`Shopify session token is invalid or expired (${rejection})`, null, undefined, rejection)
    }
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
    // Request the configured OAuth scopes during token exchange so the offline
    // token has access to all declared API resources. Without a scope parameter
    // Shopify may grant a token with fewer scopes than the app declared in the
    // Partner Dashboard, causing 403 Forbidden on subsequent API calls.
    if (this.scopes) body.set('scope', this.scopes)

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
      // Shopify explains WHY the exchange was refused in the response body
      // (`invalid_subject_token`, `invalid_client`, ...). Without it every
      // failure looked identical in production logs. The body is echoed back
      // only after redaction, and the request never contained anything from
      // the merchant other than the already-verified id_token.
      const detail = await readErrorDetail(response)
      throw new ShopifyTokenExchangeError(
        `Shopify token exchange failed with HTTP ${response.status}${detail.summary ? ` (${detail.summary})` : ''}`,
        response.status,
        undefined,
        detail.errorCode,
      )
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
  /** Shopify's OAuth `error` code when the response carried one. */
  public readonly upstreamCode: string | null

  public constructor(message: string, upstreamStatus: number | null = null, cause?: unknown, upstreamCode: string | null = null) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ShopifyTokenExchangeError'
    this.upstreamStatus = upstreamStatus
    this.upstreamCode = upstreamCode
  }
}

/**
 * Reads a failed token-exchange response body and reduces it to a
 * secret-safe one-line summary. Shopify returns small JSON payloads such as
 * `{"error":"invalid_subject_token","error_description":"..."}`; anything else
 * is truncated. Values that look like credentials are never echoed.
 */
async function readErrorDetail(response: Response): Promise<Readonly<{ summary: string; errorCode: string | null }>> {
  let raw: string
  try {
    raw = await response.text()
  } catch {
    return { summary: '', errorCode: null }
  }
  const trimmed = raw.trim()
  if (!trimmed) return { summary: '', errorCode: null }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isRecord(parsed)) {
      const code = typeof parsed.error === 'string' ? parsed.error : null
      const description = typeof parsed.error_description === 'string' ? parsed.error_description : ''
      const summary = [code, description].filter((part) => Boolean(part)).join(': ')
      return { summary: redact(summary || condense(trimmed)), errorCode: code }
    }
  } catch {
    // Fall through to the raw (condensed) form for HTML/plain-text bodies.
  }
  return { summary: redact(condense(trimmed)), errorCode: null }
}

function condense(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 300)
}

/** Strip anything token-shaped so a body echo can never leak a credential. */
function redact(value: string): string {
  return value
    .replace(/sh[pP][a-z]{0,3}_[A-Za-z0-9]+/g, '[redacted-token]')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[redacted-jwt]')
}

function parseScopes(value: unknown): readonly string[] {
  if (typeof value !== 'string') return []
  return value.split(',').map((scope) => scope.trim()).filter((scope) => scope.length > 0)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
