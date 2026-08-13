import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type OAuthState = Readonly<{ token: string; shop: string; expiresAt: number }>

export function parseShopDomain(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new TypeError('Invalid Shopify shop domain')
  }
  return normalized
}

export class OAuthStateStore {
  private readonly states = new Map<string, OAuthState>()
  private readonly now: () => number

  public constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  public issue(shop: string, ttlMs = 10 * 60 * 1000): OAuthState {
    const state: OAuthState = { token: randomBytes(32).toString('hex'), shop: parseShopDomain(shop), expiresAt: this.now() + ttlMs }
    this.states.set(state.token, state)
    return state
  }

  public consume(token: string, shop: string): boolean {
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
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const expected = createHmac('sha256', secret).update(message).digest('hex')
  return safeEqualString(expected, provided)
}

export function verifyWebhookHmac(rawBody: string, providedBase64: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  return safeEqualString(expected, providedBase64)
}

function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
}
