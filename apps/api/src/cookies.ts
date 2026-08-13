import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Response } from 'express'

export type SameSite = 'Strict' | 'Lax' | 'None'
export type CookieOptions = Readonly<{ httpOnly: boolean; secure: boolean; sameSite: SameSite; path: string; maxAgeSeconds?: number }>

export const SESSION_COOKIE_NAME = 'profitpilot_session'
export const CSRF_COOKIE_NAME = 'profitpilot_csrf'

export function sessionCookieOptions(environment: string): CookieOptions {
  return { httpOnly: true, secure: environment === 'production', sameSite: 'Lax', path: '/', maxAgeSeconds: 7 * 24 * 60 * 60 }
}

export function csrfCookieOptions(environment: string): CookieOptions {
  return { httpOnly: false, secure: environment === 'production', sameSite: 'Lax', path: '/', maxAgeSeconds: 60 * 60 }
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, `Path=${options.path}`, `SameSite=${options.sameSite}`]
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`)
  return parts.join('; ')
}

export function setSessionCookie(response: Response, sessionValue: string, environment: string): void {
  response.append('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, sessionValue, sessionCookieOptions(environment)))
}

export function setCsrfCookie(response: Response, token: string, environment: string): void {
  response.append('Set-Cookie', serializeCookie(CSRF_COOKIE_NAME, token, csrfCookieOptions(environment)))
}

export function clearSessionCookie(response: Response, environment: string): void {
  response.append('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(environment), maxAgeSeconds: 0 }))
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
