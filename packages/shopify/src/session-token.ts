import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseShopDomain, sanitizeCredential, verifyOAuthHmac } from './oauth.js'

/**
 * Verified identity of an embedded app request.
 *
 * Shopify's managed installation never calls the app's OAuth callback: Shopify
 * installs the app and grants scopes on its own, then loads the app URL inside
 * the admin iframe with `shop`, `host`, `hmac` and a short-lived `id_token`
 * session token. That landing request is therefore the ONLY moment the app
 * learns which store it is running for, which makes verifying it the
 * replacement for the callback's tenant-registration step.
 */
export type EmbeddedRequestIdentity = Readonly<{ shop: string; method: 'session-token' | 'query-hmac' }>

export type ShopifySessionTokenClaims = Readonly<{
  shop: string
  dest: string
  aud: string
  sub: string
  exp: number
  nbf: number
  iat: number
  sid: string
  iss: string
  /**
   * Non-null when the token's `aud` matched one of `audienceAliases` instead of
   * the primary `apiKey`. The signature was still verified against
   * `apiSecret`, so the identity is authentic — but it means the merchant's
   * App Bridge is minting tokens for a client id other than SHOPIFY_API_KEY,
   * which is a configuration drift the operator must know about.
   */
  audienceAlias: string | null
}>

/**
 * Credentials used to verify Shopify session tokens.
 *
 * `audienceAliases` is an OPTIONAL, operator-controlled allowlist of extra
 * client ids accepted in the `aud` claim — populated from
 * `SHOPIFY_API_KEY_ALIASES`. It exists for the real-world case where the app's
 * client id changed (app cloned to a new Partner org, key rotated, dev/prod
 * apps sharing one deployment) while `SHOPIFY_API_SECRET` stayed the same.
 *
 * SECURITY INVARIANT: an alias only widens the *audience* comparison. A token
 * is never accepted unless its HMAC signature verifies against `apiSecret`.
 * There is deliberately no way to configure this package to trust a claim from
 * an unverified token.
 */
export type SessionTokenConfig = Readonly<{ apiKey: string; apiSecret: string; audienceAliases?: readonly string[] }>

/**
 * Sanitize a session-token config in one call.
 *
 * Aliases are sanitized with the same credential scrubber as the key itself,
 * de-duplicated, and stripped of any value equal to the primary `apiKey`
 * (that case is already handled by the primary comparison and listing it twice
 * would only obscure the diagnostics).
 */
export function sanitizeSessionTokenConfig(config: Readonly<{ apiKey: string | undefined; apiSecret: string | undefined; audienceAliases?: readonly string[] }>): SessionTokenConfig {
  const apiKey = sanitizeCredential(config.apiKey)
  const aliases = (config.audienceAliases ?? []).map(sanitizeCredential).filter((alias) => alias.length > 0 && alias !== apiKey)
  return { apiKey, apiSecret: sanitizeCredential(config.apiSecret), ...(aliases.length > 0 ? { audienceAliases: [...new Set(aliases)] } : {}) }
}

/** Parses `SHOPIFY_API_KEY_ALIASES` (comma-separated client ids) into a config fragment. */
export function parseAudienceAliases(value: string | undefined | null): readonly string[] {
  return [...new Set((value ?? '').split(',').map(sanitizeCredential).filter((alias) => alias.length > 0))]
}

/** Clock skew tolerated when checking `exp`/`nbf`. Session tokens live ~60s. */
const DEFAULT_LEEWAY_SECONDS = 10

/**
 * Diagnostic sink for session-token verification failures. Wired by the API
 * layer (`apps/api`) into the structured logger; defaults to a no-op so the
 * shared package never writes to the console on its own. Every message is
 * technical only — never the token itself and never the API secret.
 */
export type SessionTokenVerificationLogger = (message: string, context: Readonly<Record<string, unknown>>) => void

let sessionTokenVerificationLogger: SessionTokenVerificationLogger = () => {}

export function setSessionTokenVerificationLogger(logger: SessionTokenVerificationLogger | null): void {
  sessionTokenVerificationLogger = logger ?? (() => {})
}

function logSessionTokenFailure(message: string, context: Readonly<Record<string, unknown>> = {}): void {
  try {
    sessionTokenVerificationLogger(message, context)
  } catch {
    /* diagnostics must never break verification */
  }
}

/**
 * Reads the `dest`/`iss`/`aud` claims out of a session token WITHOUT verifying
 * it, strictly for diagnostic log lines. Values from an unverified payload are
 * attacker-controlled — callers must never use them for authorization
 * decisions, only to explain a rejection.
 */
export function sessionTokenClaimsPreview(token: string): Readonly<{ dest: string | null; iss: string | null; aud: string | null }> {
  const payload = decodeJsonSegment(token.trim().split('.')[1] ?? '')
  return {
    dest: payload !== null && typeof payload.dest === 'string' ? payload.dest : null,
    iss: payload !== null && typeof payload.iss === 'string' ? payload.iss : null,
    aud: payload !== null && typeof payload.aud === 'string' ? payload.aud : null,
  }
}

/**
 * Verify a Shopify session token (`id_token`).
 *
 * The token is a JWT signed HS256 with the app's client secret, so a valid
 * signature proves Shopify issued it and that the `dest` claim (the shop) is
 * authentic. Returns null rather than throwing: callers treat an unverifiable
 * token as "no identity" and fall back to a read-only lookup.
 *
 * The `aud` claim is compared against `config.apiKey`, which the API bootstrap
 * builds as `sanitizeCredential(process.env.SHOPIFY_API_KEY)` — i.e. the
 * trimmed, quote/newline-stripped SHOPIFY_API_KEY env value. Every failure is
 * logged through the diagnostics sink with the exact received-vs-expected
 * audience so a production 401 is diagnosable from the server log alone.
 */
export function verifyShopifySessionToken(token: string, rawConfig: SessionTokenConfig, now: number = Date.now()): ShopifySessionTokenClaims | null {
  const config = sanitizeSessionTokenConfig(rawConfig)
  if (!config.apiKey || !config.apiSecret) return null
  const parts = token.trim().split('.')
  if (parts.length !== 3) return null
  const [encodedHeader, encodedPayload, signature] = parts
  if (!encodedHeader || !encodedPayload || !signature) return null

  const header = decodeJsonSegment(encodedHeader)
  if (!header || header.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT')) return null

  const expected = createHmac('sha256', config.apiSecret).update(`${encodedHeader}.${encodedPayload}`, 'utf8').digest('base64url')
  if (!safeEqualString(signature, expected)) {
    // The payload is NOT authenticated at this point, so its claims are never
    // echoed — only the expected (public) client id is safe to log. This is
    // also why there is NO shop-domain fallback here: `dest`/`iss` would be
    // attacker-controlled, and resolving a tenant from them would let anyone
    // mint a self-signed token naming a victim store.
    logSessionTokenFailure(`[AuthDiagnostics] JWT verification failed: INVALID_SIGNATURE (payload not authenticated, claims unavailable) aud_expected=${config.apiKey}`, {
      reason: 'signature-mismatch',
      aud_received: UNAUTHENTICATED_CLAIM,
      key_expected: config.apiKey,
      shop: UNAUTHENTICATED_CLAIM,
    })
    return null
  }

  const payload = decodeJsonSegment(encodedPayload)
  if (!payload) return null

  // Past this line the HMAC has been verified against `apiSecret`, so the
  // payload below is authentic: whoever minted this token holds the app
  // secret. That is what makes `dest`/`iss` usable for a tenant lookup, and it
  // is precisely why the same claims are refused above.
  const destClaim = typeof payload.dest === 'string' ? payload.dest : '(absent)'
  const audClaim = typeof payload.aud === 'string' ? payload.aud : '(absent)'
  const issClaim = typeof payload.iss === 'string' ? payload.iss : '(absent)'
  const failWithDiagnostics = (reason: SessionTokenRejection): null => {
    logSessionTokenFailure(
      `[AuthDiagnostics] JWT verification failed for shop=${destClaim}, aud_received=${audClaim}, aud_expected=${config.apiKey}`,
      { reason, aud_received: audClaim, key_expected: config.apiKey, shop: destClaim, iss: issClaim },
    )
    return null
  }

  // `aud` is the app's client id (`process.env.SHOPIFY_API_KEY?.trim()`).
  // Without this check a session token minted for a different app on the same
  // store would be accepted. A token whose `aud` is an explicitly configured
  // alias still authenticates — its signature already proved the app secret —
  // and is reported back to the caller so the drift is logged loudly.
  const aud = typeof payload.aud === 'string' ? payload.aud : ''
  const audienceAlias = matchAudience(aud, config)
  if (audienceAlias === null) return failWithDiagnostics('audience-mismatch')

  const seconds = Math.floor(now / 1000)
  const exp = numberClaim(payload.exp)
  const nbf = numberClaim(payload.nbf)
  if (exp === null || exp + DEFAULT_LEEWAY_SECONDS <= seconds) return failWithDiagnostics('expired')
  if (nbf !== null && nbf - DEFAULT_LEEWAY_SECONDS > seconds) return failWithDiagnostics('not-yet-valid')

  // `dest` is authoritative. `iss` (https://<shop>.myshopify.com/admin) is used
  // ONLY when `dest` is absent — never as a substitute for a `dest` that is
  // present but fails the *.myshopify.com check. Shopify always mints the two
  // from the same host, so a token carrying a non-myshopify `dest` alongside a
  // valid `iss` is malformed rather than recoverable, and silently preferring
  // `iss` there would quietly delete that guard.
  const shop = shopFromClaimedShop(payload.dest, payload.iss)
  if (!shop) return failWithDiagnostics('missing-shop')

  return {
    shop,
    dest: String(payload.dest),
    aud,
    sub: typeof payload.sub === 'string' ? payload.sub : '',
    exp,
    nbf: nbf ?? 0,
    iat: numberClaim(payload.iat) ?? 0,
    sid: typeof payload.sid === 'string' ? payload.sid : '',
    iss: typeof payload.iss === 'string' ? payload.iss : '',
    audienceAlias,
  }
}

/** Placeholder used when a claim cannot be echoed because it is unauthenticated. */
const UNAUTHENTICATED_CLAIM = '(unavailable: payload not authenticated)'

/**
 * Constant-time comparison of a token's `aud` against the primary client id and
 * every configured alias. Returns `null` when nothing matches, or the alias
 * string itself when the match came from the allowlist rather than the primary
 * key (empty string means "matched the primary key").
 */
function matchAudience(aud: string, config: SessionTokenConfig): string | null {
  if (safeEqualString(aud, config.apiKey)) return ''
  for (const alias of config.audienceAliases ?? []) {
    if (safeEqualString(aud, alias)) return alias
  }
  return null
}

export type SessionTokenRejection =
  | 'malformed'
  | 'unsupported-algorithm'
  | 'signature-mismatch'
  | 'audience-mismatch'
  | 'expired'
  | 'not-yet-valid'
  | 'missing-shop'
  | 'missing-credentials'
  | 'valid'

/**
 * Explains why `verifyShopifySessionToken` returned null, WITHOUT revealing the
 * token or the secret. This is the difference between "SHOPIFY_API_SECRET is
 * wrong" (signature-mismatch), "SHOPIFY_API_KEY belongs to another app"
 * (audience-mismatch) and "the merchant sat on the page for two minutes"
 * (expired) — three causes that previously produced one identical log line.
 */
export function describeSessionTokenRejection(token: string, rawConfig: SessionTokenConfig, now: number = Date.now()): SessionTokenRejection {
  const config = sanitizeSessionTokenConfig(rawConfig)
  if (!config.apiKey || !config.apiSecret) return 'missing-credentials'
  const parts = token.trim().split('.')
  if (parts.length !== 3) return 'malformed'
  const [encodedHeader, encodedPayload, signature] = parts
  if (!encodedHeader || !encodedPayload || !signature) return 'malformed'

  const header = decodeJsonSegment(encodedHeader)
  if (!header) return 'malformed'
  if (header.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT')) return 'unsupported-algorithm'

  const expected = createHmac('sha256', config.apiSecret).update(`${encodedHeader}.${encodedPayload}`, 'utf8').digest('base64url')
  if (!safeEqualString(signature, expected)) return 'signature-mismatch'

  const payload = decodeJsonSegment(encodedPayload)
  if (!payload) return 'malformed'
  if (typeof payload.aud !== 'string' || matchAudience(payload.aud, config) === null) return 'audience-mismatch'

  const seconds = Math.floor(now / 1000)
  const exp = numberClaim(payload.exp)
  const nbf = numberClaim(payload.nbf)
  if (exp === null || exp + DEFAULT_LEEWAY_SECONDS <= seconds) return 'expired'
  if (nbf !== null && nbf - DEFAULT_LEEWAY_SECONDS > seconds) return 'not-yet-valid'
  if (!shopFromClaimedShop(payload.dest, payload.iss)) return 'missing-shop'
  return 'valid'
}

/**
 * Establish the authenticated shop for an embedded app request.
 *
 * Two independent proofs are accepted, both requiring the app secret:
 *   1. `id_token` — the session token Shopify puts on the app-load URL, and
 *   2. `hmac`     — the signature Shopify puts on the same URL.
 *
 * An unsigned `shop` query parameter is deliberately NOT trusted here: it is
 * attacker-controlled, and treating it as an identity would let anyone create
 * arbitrary tenant rows.
 */
export function verifyEmbeddedRequest(query: Readonly<Record<string, string>>, config: SessionTokenConfig, rawQuery?: string, now: number = Date.now()): EmbeddedRequestIdentity | null {
  const idToken = query.id_token?.trim()
  if (idToken) {
    const claims = verifyShopifySessionToken(idToken, config, now)
    if (claims) return { shop: claims.shop, method: 'session-token' }
  }
  if (query.hmac?.trim() && query.shop?.trim() && verifyOAuthHmac(query, config.apiSecret, rawQuery)) {
    const shop = safeShopDomain(query.shop)
    if (shop) return { shop, method: 'query-hmac' }
  }
  return null
}

function shopFromDest(dest: unknown): string | null {
  if (typeof dest !== 'string' || !dest.trim()) return null
  const withoutScheme = dest.trim().replace(/^https?:\/\//, '')
  const host = withoutScheme.split('/')[0] ?? ''
  return safeShopDomain(host)
}

/**
 * Shopify's `iss` claim is `https://<shop>.myshopify.com/admin` — the same host
 * as `dest`, with a path suffix. Only ever called on a payload whose signature
 * has already been verified.
 */
function shopFromIss(iss: unknown): string | null {
  if (typeof iss !== 'string' || !iss.trim()) return null
  const withoutScheme = iss.trim().replace(/^https?:\/\//, '')
  const host = withoutScheme.split('/')[0] ?? ''
  return safeShopDomain(host)
}

/**
 * Resolves the shop for an already-verified payload.
 *
 * `dest` wins whenever it is present. `iss` is consulted only if `dest` is
 * missing entirely, so a present-but-invalid `dest` is still a hard rejection
 * (see the "rejects a dest that is not a myshopify domain" test).
 */
function shopFromClaimedShop(dest: unknown, iss: unknown): string | null {
  if (typeof dest === 'string' && dest.trim()) return shopFromDest(dest)
  return shopFromIss(iss)
}

function safeShopDomain(value: string): string | null {
  try {
    return parseShopDomain(value)
  } catch {
    return null
  }
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function numberClaim(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

export type SessionTokenDiagnostics = Readonly<{
  /** Machine-readable rejection reason (never contains secrets or PII). */
  reason: SessionTokenRejection
  /** Uppercase code used in log lines, e.g. AUD_MISMATCH / EXPIRED. */
  code: string
  /** One-line technical explanation safe for server logs. */
  message: string
}>

const REJECTION_CODES: Readonly<Record<SessionTokenRejection, string>> = {
  malformed: 'MALFORMED_JWT',
  'unsupported-algorithm': 'UNSUPPORTED_ALG',
  'signature-mismatch': 'INVALID_SIGNATURE',
  'audience-mismatch': 'AUD_MISMATCH',
  expired: 'EXPIRED',
  'not-yet-valid': 'NOT_YET_VALID',
  'missing-shop': 'MISSING_DEST_SHOP',
  'missing-credentials': 'MISSING_CREDENTIALS',
  valid: 'VALID',
}

/**
 * Explain a session-token rejection in terms an operator can act on, WITHOUT
 * logging merchant PII or key material. Only the app's own (public) client id
 * and the token's `aud` claim — also a public client id — are echoed, plus
 * relative expiry in seconds.
 */
export function diagnoseSessionToken(token: string, rawConfig: SessionTokenConfig, now: number = Date.now()): SessionTokenDiagnostics {
  const config = sanitizeSessionTokenConfig(rawConfig)
  const reason = describeSessionTokenRejection(token, config, now)
  const code = REJECTION_CODES[reason]
  const payload = decodeJsonSegment(token.trim().split('.')[1] ?? '')
  switch (reason) {
    case 'audience-mismatch': {
      const aud = typeof payload?.aud === 'string' ? payload.aud : '(absent)'
      const aliases = config.audienceAliases ?? []
      return {
        reason,
        code,
        message: `JWT verification failed: AUD_MISMATCH expected ${config.apiKey} got ${aud} — SHOPIFY_API_KEY does not match the App Bridge client id that minted this token${aliases.length > 0 ? ` (also accepted: ${aliases.join(', ')})` : ''}. FIX: set SHOPIFY_API_KEY to the client id shown as "got", or add it to SHOPIFY_API_KEY_ALIASES once confirmed`,
      }
    }
    case 'signature-mismatch':
      return { reason, code, message: 'JWT verification failed: INVALID_SIGNATURE — SHOPIFY_API_SECRET does not match the app that minted this token. The dest/iss claims of this token are NOT trusted: resolving a store from them would let a forged token impersonate any shop' }
    case 'expired': {
      const exp = numberClaim(payload?.exp)
      const ageSeconds = exp === null ? null : Math.floor(now / 1000) - exp
      return { reason, code, message: `JWT verification failed: EXPIRED${ageSeconds === null ? '' : ` (${ageSeconds}s past exp)`} — App Bridge must mint a fresh id_token per request` }
    }
    case 'not-yet-valid':
      return { reason, code, message: 'JWT verification failed: NOT_YET_VALID — server clock is ahead of Shopify by more than the allowed leeway' }
    case 'unsupported-algorithm':
      return { reason, code, message: 'JWT verification failed: UNSUPPORTED_ALG — expected HS256 typ JWT' }
    case 'missing-shop':
      return { reason, code, message: 'JWT verification failed: MISSING_DEST_SHOP — neither the dest nor the iss claim is a valid *.myshopify.com domain' }
    case 'missing-credentials':
      return { reason, code, message: 'JWT verification failed: MISSING_CREDENTIALS — SHOPIFY_API_KEY / SHOPIFY_API_SECRET are empty after sanitization' }
    case 'malformed':
      return { reason, code, message: 'JWT verification failed: MALFORMED_JWT — the Authorization bearer is not a three-part base64url JWT' }
    default:
      return { reason, code, message: 'JWT verification succeeded' }
  }
}
