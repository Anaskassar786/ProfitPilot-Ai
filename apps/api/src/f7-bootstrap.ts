import { PostgresSessionRepository } from '@profitpilot/db'
import { AccessReviewService } from '@profitpilot/monitoring'
import { JwtService } from './auth.js'
import { createF6Bootstrap } from './f6-bootstrap.js'
import type { F6Bootstrap } from './f6-bootstrap.js'
import { PostgresAccessReviewRepository } from './access-review-repository.js'
import { legalConfigFromEnv } from './legal.js'
import type { LegalRouteDependencies } from './legal-routes.js'
import { sanitizeCredential } from '@profitpilot/shopify'
import { securityOptionsFromEnv } from './security.js'
import type { SecurityOptions } from './security.js'

export type F7Bootstrap = Readonly<F6Bootstrap & { legal: LegalRouteDependencies; accessReview: AccessReviewService; security: SecurityOptions; sessionCookieSecret: string }>

export function createF7Bootstrap(env: Readonly<Record<string, string | undefined>>): F7Bootstrap | null {
  const f6 = createF6Bootstrap(env)
  if (!f6) return null
  const jwtSecret = sanitizeCredential(env.JWT_SECRET)
  const auth = jwtSecret
    ? { jwt: new JwtService({ secret: jwtSecret, issuer: env.JWT_ISSUER?.trim() || 'profitpilot', accessTtlSeconds: positiveNumber(env.JWT_ACCESS_TTL_SECONDS, 900), refreshTtlSeconds: positiveNumber(env.JWT_REFRESH_TTL_SECONDS, 604_800) }), sessions: new PostgresSessionRepository(f6.database) }
    : undefined
  // Embedded auth: the same public/secret key pair that signs OAuth HMACs and
  // the first-load id_token verifies App Bridge session tokens on every API
  // call, resolving the token's `dest` shop back to the stores row.
  // Credentials are sanitized (whitespace, wrapping quotes, stray newlines)
  // because a single invisible character makes every session token 401.
  const apiKey = sanitizeCredential(env.SHOPIFY_API_KEY)
  const apiSecret = sanitizeCredential(env.SHOPIFY_API_SECRET)
  const shopifySessionToken = apiKey && apiSecret
    ? { config: { apiKey, apiSecret }, directory: f6.storeDirectory }
    : undefined
  // Signed tenant cookie: the credential the API can verify when App Bridge
  // cannot mint a session token (standalone tab, blocked CDN, preview iframe).
  // It is sealed with JWT_SECRET and only trusted when that secret is real
  // (never the public development placeholder — see sessionCookieAuthEnabled).
  const sessionCookieSecret = sanitizeCredential(env.SESSION_COOKIE_SECRET) || sanitizeCredential(env.JWT_SECRET)
  const sessionCookie = sessionCookieSecret ? { secret: sessionCookieSecret, directory: f6.storeDirectory } : undefined
  const security = securityOptionsFromEnv(env, auth, shopifySessionToken, sessionCookie)
  return {
    ...f6,
    legal: { config: legalConfigFromEnv(env) },
    accessReview: new AccessReviewService(new PostgresAccessReviewRepository(f6.database)),
    security,
    sessionCookieSecret,
  }
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = value?.trim() ? Number(value) : fallback
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
