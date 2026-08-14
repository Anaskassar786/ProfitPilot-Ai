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
  const message = Object.entries(query)
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    // Shopify signs parameters sorted by byte order; localeCompare output can
    // differ under some ICU locales and must not be used here.
    .sort(([left], [right]) => compareBytes(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const expected = createHmac('sha256', secret).update(message).digest('hex')
  return safeEqualString(expected, provided)
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
