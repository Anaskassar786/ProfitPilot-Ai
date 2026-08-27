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
}>

export type SessionTokenConfig = Readonly<{ apiKey: string; apiSecret: string }>

/** Sanitize both halves of a session-token config in one call. */
export function sanitizeSessionTokenConfig(config: Readonly<{ apiKey: string | undefined; apiSecret: string | undefined }>): SessionTokenConfig {
  return { apiKey: sanitizeCredential(config.apiKey), apiSecret: sanitizeCredential(config.apiSecret) }
}

/** Clock skew tolerated when checking `exp`/`nbf`. Session tokens live ~60s. */
const DEFAULT_LEEWAY_SECONDS = 10

/**
 * Verify a Shopify session token (`id_token`).
 *
 * The token is a JWT signed HS256 with the app's client secret, so a valid
 * signature proves Shopify issued it and that the `dest` claim (the shop) is
 * authentic. Returns null rather than throwing: callers treat an unverifiable
 * token as "no identity" and fall back to a read-only lookup.
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
  if (!safeEqualString(signature, expected)) return null

  const payload = decodeJsonSegment(encodedPayload)
  if (!payload) return null

  // `aud` is the app's client id. Without this check a session token minted for
  // a different app on the same store would be accepted.
  if (typeof payload.aud !== 'string' || !safeEqualString(payload.aud, config.apiKey)) return null

  const seconds = Math.floor(now / 1000)
  const exp = numberClaim(payload.exp)
  const nbf = numberClaim(payload.nbf)
  if (exp === null || exp + DEFAULT_LEEWAY_SECONDS <= seconds) return null
  if (nbf !== null && nbf - DEFAULT_LEEWAY_SECONDS > seconds) return null

  const shop = shopFromDest(payload.dest)
  if (!shop) return null

  return {
    shop,
    dest: String(payload.dest),
    aud: payload.aud,
    sub: typeof payload.sub === 'string' ? payload.sub : '',
    exp,
    nbf: nbf ?? 0,
    iat: numberClaim(payload.iat) ?? 0,
    sid: typeof payload.sid === 'string' ? payload.sid : '',
  }
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
  if (typeof payload.aud !== 'string' || !safeEqualString(payload.aud, config.apiKey)) return 'audience-mismatch'

  const seconds = Math.floor(now / 1000)
  const exp = numberClaim(payload.exp)
  const nbf = numberClaim(payload.nbf)
  if (exp === null || exp + DEFAULT_LEEWAY_SECONDS <= seconds) return 'expired'
  if (nbf !== null && nbf - DEFAULT_LEEWAY_SECONDS > seconds) return 'not-yet-valid'
  if (!shopFromDest(payload.dest)) return 'missing-shop'
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
      return { reason, code, message: `JWT verification failed: AUD_MISMATCH expected ${config.apiKey} got ${aud} — SHOPIFY_API_KEY does not match the App Bridge client id that minted this token` }
    }
    case 'signature-mismatch':
      return { reason, code, message: 'JWT verification failed: INVALID_SIGNATURE — SHOPIFY_API_SECRET does not match the app that minted this token' }
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
      return { reason, code, message: 'JWT verification failed: MISSING_DEST_SHOP — the dest claim is not a valid *.myshopify.com domain' }
    case 'missing-credentials':
      return { reason, code, message: 'JWT verification failed: MISSING_CREDENTIALS — SHOPIFY_API_KEY / SHOPIFY_API_SECRET are empty after sanitization' }
    case 'malformed':
      return { reason, code, message: 'JWT verification failed: MALFORMED_JWT — the Authorization bearer is not a three-part base64url JWT' }
    default:
      return { reason, code, message: 'JWT verification succeeded' }
  }
}
