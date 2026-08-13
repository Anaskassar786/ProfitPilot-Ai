import { PostgresSessionRepository } from '@profitpilot/db'
import { AccessReviewService } from '@profitpilot/monitoring'
import { JwtService } from './auth.js'
import { createF6Bootstrap } from './f6-bootstrap.js'
import type { F6Bootstrap } from './f6-bootstrap.js'
import { PostgresAccessReviewRepository } from './access-review-repository.js'
import { legalConfigFromEnv } from './legal.js'
import type { LegalRouteDependencies } from './legal-routes.js'
import { securityOptionsFromEnv } from './security.js'
import type { SecurityOptions } from './security.js'

export type F7Bootstrap = Readonly<F6Bootstrap & { legal: LegalRouteDependencies; accessReview: AccessReviewService; security: SecurityOptions }>

export function createF7Bootstrap(env: Readonly<Record<string, string | undefined>>): F7Bootstrap | null {
  const f6 = createF6Bootstrap(env)
  if (!f6) return null
  const jwtSecret = env.JWT_SECRET?.trim()
  const auth = jwtSecret
    ? { jwt: new JwtService({ secret: jwtSecret, issuer: env.JWT_ISSUER?.trim() || 'profitpilot', accessTtlSeconds: positiveNumber(env.JWT_ACCESS_TTL_SECONDS, 900), refreshTtlSeconds: positiveNumber(env.JWT_REFRESH_TTL_SECONDS, 604_800) }), sessions: new PostgresSessionRepository(f6.database) }
    : undefined
  const security = securityOptionsFromEnv(env, auth)
  return { ...f6, legal: { config: legalConfigFromEnv(env) }, accessReview: new AccessReviewService(new PostgresAccessReviewRepository(f6.database)), security }
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = value?.trim() ? Number(value) : fallback
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
