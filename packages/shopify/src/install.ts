import { AppError } from '@profitpilot/types'
import type { ErrorCode, StoreId } from '@profitpilot/types'
import type { StoreDirectory } from '@profitpilot/db'
import { inspectOAuthHmac, parseShopDomain, verifyOAuthHmac } from './oauth.js'
import type { OAuthHmacDiagnostics, OAuthStates } from './oauth.js'
import type { TokenVault } from './token-vault.js'

export type ShopifyInstallConfig = Readonly<{ apiKey: string; apiSecret: string; scopes: readonly string[]; redirectUri: string }>
export type InstallStart = Readonly<{ shop: string; state: string; authorizationUrl: string }>
export type OAuthCallback = Readonly<Record<string, string>>
export type AccessTokenExchange = (shop: string, code: string) => Promise<string>

/**
 * Named steps of the OAuth callback. Every failure raised by complete() carries
 * its step in AppError.details.step so logs and alerts point at the exact stage
 * instead of a sanitized INTERNAL_ERROR.
 */
export type InstallStep = 'validation' | 'hmac-verification' | 'state-verification' | 'token-exchange' | 'token-storage' | 'tenant-registration'

export class ShopifyInstallService {
  private readonly config: ShopifyInstallConfig
  private readonly states: OAuthStates
  private readonly vault: TokenVault
  private readonly directory: StoreDirectory

  public constructor(config: ShopifyInstallConfig, states: OAuthStates, vault: TokenVault, directory: StoreDirectory) {
    if (!config.apiKey.trim() || !config.apiSecret.trim() || !config.redirectUri.trim()) throw new TypeError('Shopify OAuth configuration is incomplete')
    this.config = config
    this.states = states
    this.vault = vault
    this.directory = directory
  }

  public async start(shop: string): Promise<InstallStart> {
    const normalizedShop = requireShopDomain(shop)
    const state = await this.states.issue(normalizedShop)
    const params = new URLSearchParams({ client_id: this.config.apiKey, scope: this.config.scopes.join(','), redirect_uri: this.config.redirectUri, state: state.token })
    return { shop: normalizedShop, state: state.token, authorizationUrl: `https://${normalizedShop}/admin/oauth/authorize?${params.toString()}` }
  }

  public async complete(callback: OAuthCallback, exchange: AccessTokenExchange, rawQuery?: string): Promise<Readonly<{ shop: string; storeId: StoreId; tokenStored: true }>> {
    const shop = requireShopDomain(callback.shop ?? '')
    if (!verifyOAuthHmac(callback, this.config.apiSecret, rawQuery)) {
      throw installError('UNAUTHORIZED', 'hmac-verification', 'Shopify OAuth callback signature verification failed', 401)
    }
    if (!callback.state || !(await this.states.consume(callback.state, shop))) {
      throw installError('UNAUTHORIZED', 'state-verification', 'Shopify OAuth state is invalid, expired, or replayed — restart the install flow', 401)
    }
    if (!callback.code?.trim()) {
      throw installError('VALIDATION_ERROR', 'validation', 'Shopify OAuth callback is missing the authorization code', 400)
    }
    let accessToken: string
    try {
      accessToken = await exchange(shop, callback.code)
    } catch (error: unknown) {
      throw installError('DEPENDENCY_ERROR', 'token-exchange', 'Shopify access token exchange failed', 502, error)
    }
    try {
      await this.vault.put(shop, accessToken)
    } catch (error: unknown) {
      throw installError('INTERNAL_ERROR', 'token-storage', 'Failed to store the Shopify access token', 500, error, false)
    }
    let tenant: { storeId: StoreId; shopDomain: string }
    try {
      // Register (or re-find) the tenant row so the dashboard has a storeId to
      // attach the Shopify token to. This is what connects the stored token to
      // the workspace context the web app renders from.
      tenant = await this.directory.upsertByShopDomain(shop)
    } catch (error: unknown) {
      throw installError('INTERNAL_ERROR', 'tenant-registration', 'Failed to register the Shopify store tenant', 500, error, false)
    }
    return { shop, storeId: tenant.storeId, tokenStored: true }
  }

  /**
   * Secret-safe HMAC diagnostics for the callback route's logs. Uses the same
   * candidate message builders as verification (including the raw query string),
   * so logs show exactly what was signed under each convention and which one —
   * if any — matched the received signature.
   */
  public hmacDiagnostics(callback: OAuthCallback, rawQuery?: string): OAuthHmacDiagnostics {
    return inspectOAuthHmac(callback, this.config.apiSecret, rawQuery)
  }

  /**
   * Where the merchant's browser should land after a successful install.
   * Embedded apps belong inside Shopify admin; the `host` callback parameter
   * encodes the admin origin (e.g. admin.shopify.com/store/<store>) so it is
   * authoritative when present, with a myshopify-derived fallback otherwise.
   *
   * The tenant context (storeId, shop, and the original `host`) is carried as
   * query parameters so the web app can render the correct workspace without a
   * second resolution step. The session cookie set by the caller provides the
   * same context on later refreshes.
   */
  public postInstallRedirect(callback: OAuthCallback, shop: string, storeId: StoreId): string {
    const query = new URLSearchParams({ storeId, shop })
    const host = callback.host ?? ''
    if (host) query.set('host', host)
    const adminOrigin = decodeAdminHost(host)
    const base = adminOrigin
      ? `https://${adminOrigin}/apps/${this.config.apiKey}`
      : `https://admin.shopify.com/store/${normalizeShopDomainFallback(shop).replace(/\.myshopify\.com$/, '')}/apps/${this.config.apiKey}`
    return `${base}?${query.toString()}`
  }
}

/** Extract the failing install step from an error raised by complete(), for structured logs. */
export function installStepFromError(error: unknown): InstallStep | null {
  if (error instanceof AppError && typeof error.details.step === 'string') return error.details.step as InstallStep
  return null
}

function requireShopDomain(value: string): string {
  try {
    return parseShopDomain(value)
  } catch {
    throw installError('VALIDATION_ERROR', 'validation', 'A valid *.myshopify.com shop domain is required', 400)
  }
}

function normalizeShopDomainFallback(value: string): string {
  try {
    return parseShopDomain(value)
  } catch {
    return ''
  }
}

function decodeAdminHost(host: string): string | null {
  if (!host) return null
  try {
    // `host` is base64/base64url; Buffer accepts both alphabets and missing padding.
    const decoded = Buffer.from(host, 'base64').toString('utf8')
    return /^admin\.shopify\.com\/store\/[a-z0-9][a-z0-9-]*$/.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

function installError(code: ErrorCode, step: InstallStep, message: string, status: number, cause?: unknown, expose = true): AppError {
  const error = new AppError(code, message, status, { step }, expose)
  if (cause !== undefined) (error as { cause?: unknown }).cause = cause
  return error
}
