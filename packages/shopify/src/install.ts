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
 * Structural logger accepted by the install service (kept structural so the
 * shopify package does not depend on @profitpilot/logger). It exists for ONE
 * reason: when the OAuth callback fails to write the offline access token or
 * the store row, the exact database error must reach the logs. A swallowed
 * DB error here is precisely what leaves a merchant installed on Shopify's
 * side but unknown to the app — every later API call then 401s.
 */
export type InstallLogger = Readonly<{
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}>

export type ShopifyInstallOptions = Readonly<{ logger?: InstallLogger }>

/**
 * Named steps of the OAuth callback. Every failure raised by complete() carries
 * its step in AppError.details.step so logs and alerts point at the exact stage
 * instead of a sanitized INTERNAL_ERROR.
 */
export type InstallStep = 'validation' | 'hmac-verification' | 'state-verification' | 'token-exchange' | 'token-storage' | 'tenant-registration' | 'token-verification'

export class ShopifyInstallService {
  private readonly config: ShopifyInstallConfig
  private readonly states: OAuthStates
  private readonly vault: TokenVault
  private readonly directory: StoreDirectory
  private readonly logger: InstallLogger | null

  public constructor(config: ShopifyInstallConfig, states: OAuthStates, vault: TokenVault, directory: StoreDirectory, options: ShopifyInstallOptions = {}) {
    if (!config.apiKey.trim() || !config.apiSecret.trim() || !config.redirectUri.trim()) throw new TypeError('Shopify OAuth configuration is incomplete')
    this.config = config
    this.states = states
    this.vault = vault
    this.directory = directory
    this.logger = options.logger ?? null
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
      this.logger?.error('Shopify OAuth token exchange failed', { step: 'token-exchange', shopDomain: shop, ...describeDbError(error) })
      throw installError('DEPENDENCY_ERROR', 'token-exchange', 'Shopify access token exchange failed', 502, error)
    }

    // Tenant row FIRST. The `stores` row is what every embedded API call
    // resolves the session token's `dest` shop to; registering it before the
    // vault write means a transient token-vault failure can never leave the
    // merchant with an installed app and no tenant (the state that produced
    // 401 STORE_NOT_FOUND on every /api call). The upsert also resets
    // status='ACTIVE' and uninstalled_at=NULL for a reinstalling merchant.
    let tenant: { storeId: StoreId; shopDomain: string }
    try {
      tenant = await this.directory.upsertByShopDomain(shop)
    } catch (error: unknown) {
      this.logger?.error('Shopify OAuth callback could not write the stores row', {
        step: 'tenant-registration',
        shopDomain: shop,
        ...describeDbError(error),
      })
      throw installError('INTERNAL_ERROR', 'tenant-registration', 'Failed to register the Shopify store tenant', 500, error, false)
    }
    this.logger?.info('Shopify OAuth callback registered the store row', { shopDomain: tenant.shopDomain, storeId: tenant.storeId, status: 'ACTIVE', uninstalledAt: null })

    // Offline access token → token vault (encrypted `shopify_tokens` row).
    // Every failure mode here is logged with the EXACT database error
    // (message, pg code, constraint, detail) because a silent write failure is
    // indistinguishable from "the merchant never installed" at request time.
    try {
      await this.vault.put(tenant.shopDomain, accessToken)
    } catch (error: unknown) {
      this.logger?.error('Shopify OAuth callback failed to persist the offline access token to the token vault', {
        step: 'token-storage',
        shopDomain: tenant.shopDomain,
        storeId: tenant.storeId,
        ...describeDbError(error),
      })
      throw installError('INTERNAL_ERROR', 'token-storage', 'Failed to store the Shopify access token', 500, error, false)
    }

    // Read-back verification: proves the row is actually in the database (and
    // decryptable) rather than trusting a write that a pooler may have rolled
    // back. Without it, "install succeeded" and "token missing" can both be
    // true — the exact production symptom being fixed.
    try {
      const stored = await this.vault.get(tenant.shopDomain)
      if (!stored) {
        this.logger?.error('Shopify OAuth callback stored no readable offline access token', { step: 'token-verification', shopDomain: tenant.shopDomain, storeId: tenant.storeId, reason: 'TOKEN_VAULT_READBACK_EMPTY' })
        throw installError('INTERNAL_ERROR', 'token-verification', 'The Shopify access token was not persisted', 500, undefined, false)
      }
    } catch (error: unknown) {
      if (error instanceof AppError) throw error
      this.logger?.error('Shopify OAuth callback could not read back the offline access token', {
        step: 'token-verification',
        shopDomain: tenant.shopDomain,
        storeId: tenant.storeId,
        ...describeDbError(error),
      })
      throw installError('INTERNAL_ERROR', 'token-verification', 'The Shopify access token could not be verified after storage', 500, error, false)
    }

    this.logger?.info('Shopify OAuth callback persisted the offline access token', { shopDomain: tenant.shopDomain, storeId: tenant.storeId, accessMode: 'offline', tokenStored: true })
    return { shop: tenant.shopDomain, storeId: tenant.storeId, tokenStored: true }
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

/**
 * Flattens a thrown value into the operator-facing fields that identify a
 * database failure: the message, the PostgreSQL SQLSTATE (`code`), the
 * violated `constraint`, the server `detail`/`hint`, the `table`, and the
 * cause chain. These are what turn "Failed to store the Shopify access token"
 * into an actionable line (e.g. `42P01 relation "shopify_tokens" does not
 * exist` or `42501 new row violates row-level security policy`). No token,
 * secret, or merchant PII is included.
 */
function describeDbError(error: unknown): Record<string, unknown> {
  const source = error as Partial<Record<'message' | 'code' | 'detail' | 'hint' | 'constraint' | 'table' | 'schema' | 'routine' | 'severity', unknown>> | null
  const cause = error instanceof Error ? error.cause : undefined
  const causeSource = cause as Partial<Record<'message' | 'code' | 'constraint' | 'detail', unknown>> | null
  return {
    error: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : typeof error,
    dbCode: stringOrNull(source?.code),
    dbDetail: stringOrNull(source?.detail),
    dbHint: stringOrNull(source?.hint),
    dbConstraint: stringOrNull(source?.constraint),
    dbTable: stringOrNull(source?.table),
    dbSchema: stringOrNull(source?.schema),
    dbRoutine: stringOrNull(source?.routine),
    dbSeverity: stringOrNull(source?.severity),
    cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : typeof cause === 'string' ? cause : null,
    causeCode: stringOrNull(causeSource?.code),
    causeConstraint: stringOrNull(causeSource?.constraint),
    causeDetail: stringOrNull(causeSource?.detail),
    stack: error instanceof Error ? (error.stack ?? '') : '',
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : null
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
