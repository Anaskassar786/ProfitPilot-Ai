import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Response } from 'express'

export type SameSite = 'Strict' | 'Lax' | 'None'
export type CookieOptions = Readonly<{ httpOnly: boolean; secure: boolean; sameSite: SameSite; path: string; maxAgeSeconds?: number }>

export const SESSION_COOKIE_NAME = 'profitpilot_session'
export const CSRF_COOKIE_NAME = 'profitpilot_csrf'

/**
 * The session cookie carries the tenant (storeId) context between the OAuth
 * callback and the embedded dashboard. Because the app renders inside Shopify
 * admin (admin.shopify.com), the cookie must be sent across a cross-site frame:
 * `SameSite=None` is required and browsers only honor it together with
 * `Secure`, so both are always set regardless of environment.
 */
export function sessionCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAgeSeconds: 7 * 24 * 60 * 60 }
}

/**
 * The CSRF cookie participates in a double-submit token check for unsafe
 * requests. The dashboard runs inside the Shopify admin iframe, so this cookie
 * must also be sent cross-site: SameSite=None with Secure, matching the session
 * cookie. It stays non-HttpOnly so client code may read the token if needed.
 */
export function csrfCookieOptions(): CookieOptions {
  return { httpOnly: false, secure: true, sameSite: 'None', path: '/', maxAgeSeconds: 7 * 24 * 60 * 60 }
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, `Path=${options.path}`, `SameSite=${options.sameSite}`]
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`)
  return parts.join('; ')
}

export function setSessionCookie(response: Response, sessionValue: string): void {
  response.append('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, sessionValue, sessionCookieOptions()))
}

/**
 * Signs the tenant id before it goes into the session cookie.
 *
 * The cookie used to carry a bare `storeId`, which is fine for the *bootstrap*
 * lookup (`/session/context` only reads it) but useless as an authentication
 * credential: `storeId` values appear in URLs (the post-OAuth redirect carries
 * `?storeId=…`), so trusting an unsigned cookie would let anyone impersonate a
 * tenant by setting one. Signing it with a server-only secret turns the cookie
 * into something the API can actually verify.
 *
 * The format is `<storeId>.<base64url HMAC-SHA256>`; `verifySessionValue`
 * splits on the LAST dot so a dotted storeId stays intact.
 */
export function signSessionValue(secret: string, value: string): string {
  if (!secret.trim()) throw new TypeError('Session cookie secret is required')
  return `${value}.${signSession(secret, value)}`
}

/**
 * Returns the tenant id when `signed` carries a valid signature, otherwise
 * null. Never throws: an old unsigned cookie simply fails verification and the
 * caller falls back to its unauthenticated path (no merchant is locked out by
 * a deploy that rotates this format).
 */
export function verifySessionValue(secret: string, signed: string): string | null {
  if (!secret.trim()) return null
  const separator = signed.lastIndexOf('.')
  if (separator <= 0 || separator === signed.length - 1) return null
  const value = signed.slice(0, separator)
  const signature = signed.slice(separator + 1)
  const expected = signSession(secret, value)
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  return left.byteLength === right.byteLength && timingSafeEqual(left, right) ? value : null
}

function signSession(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

/**
 * Writes the tenant id to the session cookie in its SIGNED form. Every writer
 * (OAuth callback, embedded app load) must use this so the credential the
 * authentication middleware verifies is the one it was given.
 */
export function setSignedSessionCookie(response: Response, storeId: string, secret: string): void {
  try {
    setSessionCookie(response, signSessionValue(secret, storeId))
  } catch {
    // A missing secret must never break the OAuth callback or the app load:
    // fall back to the unsigned cookie, which still serves the bootstrap
    // lookup (it just cannot authenticate the data plane).
    setSessionCookie(response, storeId)
  }
}

export function setCsrfCookie(response: Response, token: string): void {
  response.append('Set-Cookie', serializeCookie(CSRF_COOKIE_NAME, token, csrfCookieOptions()))
}

export function clearSessionCookie(response: Response): void {
  response.append('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAgeSeconds: 0 }))
}

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  if (!header) return {}
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = decodePart(part.slice(0, separator).trim())
    const value = decodePart(part.slice(separator + 1).trim())
    if (name) cookies[name] = value
  }
  return cookies
}

export function createCsrfToken(secret: string): string {
  if (!secret.trim()) throw new TypeError('CSRF secret is required')
  const nonce = randomBytes(32).toString('base64url')
  return `${nonce}.${signCsrf(secret, nonce)}`
}

export function verifyCsrfToken(secret: string, token: string): boolean {
  if (!secret.trim()) return false
  const separator = token.lastIndexOf('.')
  if (separator <= 0 || separator === token.length - 1) return false
  const nonce = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = signCsrf(secret, nonce)
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

function signCsrf(secret: string, nonce: string): string {
  return createHmac('sha256', secret).update(nonce, 'utf8').digest('base64url')
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}
