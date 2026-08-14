import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type OAuthState = Readonly<{ token: string; shop: string; expiresAt: number }>

/**
 * Storage contract for OAuth state tokens. Implementations must make consume()
 * single-use (a returned true must never be repeated for the same token) so a
 * replayed callback cannot re-exchange the same authorization code.
 */
export interface OAuthStates {
  issue(shop: string, ttlMs?: number): Promise<OAuthState>
  consume(token: string, shop: string): Promise<boolean>
}

export function parseShopDomain(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new TypeError('Invalid Shopify shop domain')
  }
  return normalized
}

/** In-memory state store for single-process development and unit tests. */
export class OAuthStateStore implements OAuthStates {
  private readonly states = new Map<string, OAuthState>()
  private readonly now: () => number

  public constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  public async issue(shop: string, ttlMs = 10 * 60 * 1000): Promise<OAuthState> {
    const state: OAuthState = { token: randomBytes(32).toString('hex'), shop: parseShopDomain(shop), expiresAt: this.now() + ttlMs }
    this.states.set(state.token, state)
    return state
  }

  public async consume(token: string, shop: string): Promise<boolean> {
    const state = this.states.get(token)
    this.states.delete(token)
    if (!state || state.expiresAt <= this.now()) return false
    return safeEqualString(state.shop, parseShopDomain(shop))
  }
}

export function verifyOAuthHmac(query: Readonly<Record<string, string>>, secret: string): boolean {
  const provided = query.hmac
  if (!provided) return false
  const expected = createHmac('sha256', secret).update(shopifyHmacMessage(query)).digest('hex')
  return safeEqualString(expected, provided)
}

/**
 * The exact string Shopify HMAC-signs for an OAuth callback: every query
 * parameter except `hmac`/`signature`, sorted by key in byte order
 * (localeCompare output differs under some ICU locales and must not be used),
 * joined as `key=value&key=value`, with EACH VALUE percent-encoded as it
 * appeared in the redirect URL Shopify generated.
 *
 * Shopify signs the encoded form — the official @shopify/shopify-api validator
 * rebuilds the message with URLSearchParams.toString(), which percent-encodes
 * values. Framework query parsers (Express/qs) hand us DECODED values, so
 * joining them raw breaks verification whenever a value differs from its
 * encoded form. The OAuth callback's base64 `host` parameter is the classic
 * trigger: for roughly two thirds of store handles the base64 ends in `=`
 * padding (`%3D` in the URL), and any `+`/`/` in the alphabet breaks it too.
 *
 * encodeURIComponent is byte-identical to the SDK's URLSearchParams encoding
 * (after its + -> %20 normalization) for every character class Shopify uses in
 * these values (hex, domains, base64).
 */
export function shopifyHmacMessage(query: Readonly<Record<string, string>>): string {
  return Object.entries(query)
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([left], [right]) => compareBytes(left, right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
}

/**
 * Secret-safe snapshot of an HMAC verification attempt, for production
 * diagnostics. Deliberately prefixes-only: never logs the API secret, the
 * authorization `code`, the CSRF `state`, or more than a prefix of either
 * HMAC. `secretPrefix` is capped at the scheme tag (e.g. `shpss_`) precisely so
 * a stale/new-format secret, stray quotes, or padding in the environment
 * variable is visible via `secretLength` without leaking key material.
 */
export type OAuthHmacDiagnostics = Readonly<{
  parameterKeys: string[]
  signedMessagePreview: string
  receivedHmacPrefix: string | null
  computedHmacPrefix: string
  secretPrefix: string
  secretLength: number
  matched: boolean
}>

export function inspectOAuthHmac(query: Readonly<Record<string, string>>, secret: string): OAuthHmacDiagnostics {
  const provided = query.hmac ?? null
  const message = shopifyHmacMessage(query)
  const computed = createHmac('sha256', secret).update(message).digest('hex')
  return {
    parameterKeys: Object.keys(query).filter((key) => key !== 'hmac' && key !== 'signature').sort(compareBytes),
    signedMessagePreview: redactSensitiveValues(message, query),
    receivedHmacPrefix: provided === null ? null : provided.slice(0, 20),
    computedHmacPrefix: computed.slice(0, 20),
    secretPrefix: secret.slice(0, 6),
    secretLength: secret.length,
    matched: provided !== null && safeEqualString(computed, provided),
  }
}

/** Rebuild the signed message with `code`/`state` masked so previews are safe to ship to log drains. */
function redactSensitiveValues(message: string, query: Readonly<Record<string, string>>): string {
  let preview = message
  for (const key of ['code', 'state'] as const) {
    const value = query[key]
    if (value) preview = preview.split(`${key}=${encodeURIComponent(value)}`).join(`${key}=<redacted:${value.length}chars>`)
  }
  return preview
}

export function verifyWebhookHmac(rawBody: string, providedBase64: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  return safeEqualString(expected, providedBase64)
}

function compareBytes(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
}
