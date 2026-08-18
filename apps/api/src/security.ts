import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { Router } from 'express'
import { AppError, requestId, success, toAppError } from '@profitpilot/types'
import { isMissingRelationError } from './ai-keys.js'
import { isShopifyApiError } from '@profitpilot/shopify'
import type { JwtClaims } from './auth.js'
import { JwtService } from './auth.js'
import type { SessionRecord, SessionRepository } from '@profitpilot/db'
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, createCsrfToken, parseCookies, setCsrfCookie, verifyCsrfToken } from './cookies.js'

export type EndpointRateRule = Readonly<{ limit: number; windowMs: number }>
export type RateLimitDecision = Readonly<{ allowed: boolean; limit: number; remaining: number; retryAfterMs: number }>

export type AuthContext = Readonly<{ claims: JwtClaims; session: SessionRecord }>
export type SecurityAuth = Readonly<{ jwt: JwtService; sessions: SessionRepository }>
export type SecurityOptions = Readonly<{
  environment: string
  allowedOrigins: readonly string[]
  requireAuthentication: boolean
  csrfSecret: string
  auth?: SecurityAuth
  rateLimiter?: EndpointRateLimiter
}>

export type SecurityRouteDependencies = Readonly<{ environment: string; csrfSecret: string }>

interface RequestWithAuth extends Request {
  profitPilotAuth?: AuthContext
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const rawBodies = new WeakMap<Request, string>()
const DEFAULT_RATE_RULE: EndpointRateRule = { limit: 120, windowMs: 60_000 }
const DEFAULT_RULES: Readonly<Record<string, EndpointRateRule>> = {
  'POST /sync': { limit: 60, windowMs: 60_000 },
  'POST /shopify/webhooks': { limit: 300, windowMs: 60_000 },
  'POST /admin/step-up': { limit: 20, windowMs: 60_000 },
  'POST /billing/charge': { limit: 20, windowMs: 60_000 },
  'POST /billing/gift': { limit: 10, windowMs: 60_000 },
}

export class EndpointRateLimiter {
  private readonly defaultRule: EndpointRateRule
  private readonly rules: Readonly<Record<string, EndpointRateRule>>
  private readonly buckets = new Map<string, number[]>()

  public constructor(defaultRule: EndpointRateRule = DEFAULT_RATE_RULE, rules: Readonly<Record<string, EndpointRateRule>> = DEFAULT_RULES) {
    validateRule(defaultRule)
    for (const rule of Object.values(rules)) validateRule(rule)
    this.defaultRule = defaultRule
    this.rules = rules
  }

  public check(method: string, path: string, identity: string, now = Date.now()): RateLimitDecision {
    const rule = this.rules[`${method.toUpperCase()} ${path}`] ?? this.defaultRule
    const key = `${method.toUpperCase()}:${path}:${identity}`
    const existing = this.buckets.get(key) ?? []
    const active = existing.filter((timestamp) => timestamp > now - rule.windowMs)
    if (active.length >= rule.limit) {
      this.buckets.set(key, active)
      const first = active[0] ?? now
      return { allowed: false, limit: rule.limit, remaining: 0, retryAfterMs: Math.max(1, first + rule.windowMs - now) }
    }
    active.push(now)
    this.buckets.set(key, active)
    return { allowed: true, limit: rule.limit, remaining: Math.max(0, rule.limit - active.length), retryAfterMs: 0 }
  }

  public reset(): void {
    this.buckets.clear()
  }

  public size(): number {
    return this.buckets.size
  }
}

export function securityOptionsFromEnv(env: Readonly<Record<string, string | undefined>>, auth?: SecurityAuth): SecurityOptions {
  const environment = env.NODE_ENV?.trim() || 'development'
  const allowedOrigins = unique([
    ...splitCsv(env.CORS_ALLOWED_ORIGINS),
    nonEmpty(env.APP_URL),
    nonEmpty(env.SHOPIFY_APP_URL),
    ...(environment === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ])
  const requireAuthentication = env.SECURITY_REQUIRE_AUTH === 'true' || (environment === 'production' && env.SECURITY_REQUIRE_AUTH !== 'false')
  if (requireAuthentication && !auth) throw new Error('Production security requires JWT and session configuration')
  const base: Omit<SecurityOptions, 'auth'> = {
    environment,
    allowedOrigins,
    requireAuthentication,
    csrfSecret: env.CSRF_SECRET?.trim() || env.JWT_SECRET?.trim() || 'development-csrf-secret-change-me',
    rateLimiter: new EndpointRateLimiter({ limit: numberEnv(env, 'RATE_LIMIT_DEFAULT', 120), windowMs: numberEnv(env, 'RATE_LIMIT_WINDOW_MS', 60_000) }),
  }
  return auth ? { ...base, auth } : base
}

export function defaultSecurityOptions(): SecurityOptions {
  return {
    environment: 'development',
    allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    requireAuthentication: false,
    csrfSecret: 'development-csrf-secret-change-me',
    rateLimiter: new EndpointRateLimiter(),
  }
}

export function captureRawBody(request: Request, body: Buffer): void {
  rawBodies.set(request, body.toString('utf8'))
}

export function rawBodyFor(request: Request): string | null {
  return rawBodies.get(request) ?? null
}

export function requestIdMiddleware(): RequestHandler {
  return (request, response, next): void => {
    const incoming = request.header('x-request-id')
    const id = incoming && /^[a-zA-Z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID()
    response.setHeader('x-request-id', id)
    request.headers['x-request-id'] = id
    next()
  }
}

/**
 * Frame policy for responses that may be consumed inside the Shopify admin
 * iframe. `X-Frame-Options` has no syntax for an origin allowlist (the old
 * ALLOW-FROM was dropped by every modern browser), so embedded surfaces must
 * rely on CSP `frame-ancestors` instead and omit XFO entirely — a stray
 * `X-Frame-Options: DENY` would override the allowlist in some browsers.
 */
export const SHOPIFY_FRAME_ANCESTORS = 'https://admin.shopify.com https://*.myshopify.com'

/** Paths that never render in a frame and keep the strict deny-everything policy. */
const NON_EMBEDDED_PREFIXES = ['/live', '/ready', '/health'] as const

function isEmbeddableApiPath(requestPath: string): boolean {
  return !NON_EMBEDDED_PREFIXES.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`))
}

export function securityHeadersMiddleware(environment = 'development'): RequestHandler {
  return (request, response, next): void => {
    // API responses are JSON and are never themselves framed, but they are read
    // by the dashboard running inside the Shopify admin iframe. Advertising a
    // frame policy consistent with the embedded app avoids the misleading
    // `x-frame-options: DENY` that shows up on every XHR in DevTools while
    // keeping a hard deny on the infrastructure endpoints.
    const embeddable = isEmbeddableApiPath(request.path)
    const frameAncestors = embeddable ? SHOPIFY_FRAME_ANCESTORS : "'none'"
    response.setHeader('Content-Security-Policy', `default-src 'none'; base-uri 'none'; frame-ancestors ${frameAncestors}; form-action 'self'; img-src 'self' data:; script-src 'none'; style-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none';`)
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (embeddable) response.removeHeader('X-Frame-Options')
    else response.setHeader('X-Frame-Options', 'DENY')
    const microphonePolicy = embeddable ? '(self "https://admin.shopify.com")' : '()'
    response.setHeader('Permissions-Policy', `microphone=${microphonePolicy}, geolocation=(), payment=()`)
    if (environment === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  }
}

export function corsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins)
  return (request, response, next): void => {
    const origin = request.header('origin')
    if (!origin) {
      next()
      return
    }
    if (!allowed.has(origin)) {
      next(new AppError('FORBIDDEN', 'Origin is not allowed', 403))
      return
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Request-Id, X-Admin-Step-Up, X-Shopify-Session-Token')
    response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS')
    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }
    next()
  }
}

export function rateLimitMiddleware(limiter: EndpointRateLimiter): RequestHandler {
  return (request, response, next): void => {
    const decision = limiter.check(request.method, request.path, request.ip || 'unknown')
    response.setHeader('X-RateLimit-Limit', String(decision.limit))
    response.setHeader('X-RateLimit-Remaining', String(decision.remaining))
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)))
      next(new AppError('RATE_LIMITED', 'Too many requests', 429, { retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000) }))
      return
    }
    next()
  }
}

export function tenantInputGuard(): RequestHandler {
  return (request, _response, next): void => {
    try {
      for (const key of ['storeId', 'shopId']) {
        const queryValue = request.query[key]
        if (typeof queryValue === 'string') assertSafeTenantValue(queryValue)
        const body: unknown = request.body
        if (isRecord(body) && typeof body[key] === 'string') assertSafeTenantValue(body[key])
      }
      next()
    } catch (error: unknown) {
      next(error)
    }
  }
}

export function assertSafeTenantValue(value: string): void {
  if (value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f\s=()<>]/.test(value) || /(?:'|"|;|--|\/\*|\*\/|\bunion\b|\bselect\b|\bdrop\b|\binsert\b|\bdelete\b|\bupdate\b)/i.test(value)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid tenant identifier', 400)
  }
}

export function authenticationMiddleware(options: Pick<SecurityOptions, 'auth' | 'requireAuthentication'>): RequestHandler {
  return (request, _response, next): void => {
    // /public-api/* carries its own Bearer credential (Insights Hub API
    // keys, PR #50); JWT session auth must not consume those requests.
    if (request.path.startsWith('/public-api/')) { next(); return }
    const token = bearerToken(request)
    const hasTenant = requestTenantValue(request) !== null
    if (!token) {
      if (options.requireAuthentication && hasTenant) next(new AppError('UNAUTHORIZED', 'Authentication is required', 401))
      else next()
      return
    }
    if (!options.auth) {
      next(new AppError('UNAUTHORIZED', 'Authentication is unavailable', 401))
      return
    }
    void authenticate(token, options.auth, request).then(() => next()).catch(next)
  }
}

export function tenantContextMiddleware(requireAuthentication: boolean): RequestHandler {
  return (request, _response, next): void => {
    const tenant = requestTenantValue(request)
    if (tenant === null) {
      next()
      return
    }
    const context = getAuthContext(request)
    if (!context) {
      if (requireAuthentication) next(new AppError('UNAUTHORIZED', 'Authentication is required', 401))
      else next()
      return
    }
    if (context.claims.storeId !== tenant) next(new AppError('FORBIDDEN', 'Tenant context does not match the authenticated session', 403))
    else next()
  }
}

export function csrfMiddleware(secret: string): RequestHandler {
  return (request, _response, next): void => {
    if (!UNSAFE_METHODS.has(request.method)) {
      next()
      return
    }
    const cookies = parseCookies(request.header('cookie'))
    const cookieToken = cookies[CSRF_COOKIE_NAME]
    const hasSessionCookie = Boolean(cookies[SESSION_COOKIE_NAME])
    if (!cookieToken && !hasSessionCookie) {
      next()
      return
    }
    const headerToken = request.header('x-csrf-token')
    if (!cookieToken || !headerToken || headerToken !== cookieToken || !verifyCsrfToken(secret, headerToken)) {
      next(new AppError('FORBIDDEN', 'CSRF validation failed', 403))
      return
    }
    next()
  }
}

export function createSecurityRouter(dependencies: SecurityRouteDependencies): Router {
  const router = Router()
  router.get('/security/csrf', (request, response) => {
    const token = createCsrfToken(dependencies.csrfSecret)
    setCsrfCookie(response, token)
    response.status(200).json(success({ csrfToken: token }, requestId(request.header('x-request-id') || randomUUID())))
  })
  return router
}

export function getAuthContext(request: Request): AuthContext | null {
  return (request as RequestWithAuth).profitPilotAuth ?? null
}

export function normalizeRequestError(error: unknown): AppError {
  if (isRecord(error) && error.type === 'entity.too.large') return new AppError('VALIDATION_ERROR', 'Request payload is too large', 413)
  if (isRecord(error) && error.type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 'Malformed JSON payload', 400)
  if (isMissingRelationError(error) || (error instanceof Error && isMissingRelationError(error.cause))) {
    return new AppError('DEPENDENCY_ERROR', 'Required database tables are missing. Pending migrations will apply on the next API restart (or set RUN_MIGRATIONS=true).', 503, { reason: 'SCHEMA_MISSING' })
  }
  if (isShopifyApiError(error) || (isRecord(error) && error.name === 'ShopifyApiError')) {
    const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 502
    const message = error instanceof Error ? error.message : 'Shopify API error'
    const code = status === 401 ? 'UNAUTHORIZED' : status === 429 ? 'RATE_LIMITED' : 'DEPENDENCY_ERROR'
    const appError = new AppError(code, message, status, { upstreamStatus: status }, true)
    if (error instanceof Error && error.stack) appError.stack = error.stack
    appError.cause = error
    return appError
  }
  return toAppError(error)
}

async function authenticate(token: string, auth: SecurityAuth, request: Request): Promise<void> {
  const claims = auth.jwt.verify(token, 'access', Math.floor(Date.now() / 1000))
  const session = auth.sessions.getForStore ? await auth.sessions.getForStore(claims.storeId, claims.sid) : await auth.sessions.get(claims.sid)
  if (!session || session.revokedAt !== null || session.expiresAt <= Date.now() || session.storeId !== claims.storeId || session.userId !== claims.sub) {
    throw new AppError('UNAUTHORIZED', 'Session is no longer valid', 401)
  }
  ;(request as RequestWithAuth).profitPilotAuth = { claims, session }
}

function bearerToken(request: Request): string | null {
  const value = request.header('authorization')
  if (!value) return null
  const [scheme, token] = value.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token?.trim() ? token.trim() : null
}

function requestTenantValue(request: Request): string | null {
  const queryStore = request.query.storeId
  if (typeof queryStore === 'string' && queryStore.trim()) return queryStore
  const queryShop = request.query.shopId
  if (typeof queryShop === 'string' && queryShop.trim()) return queryShop
  const body: unknown = request.body
  if (!isRecord(body)) return null
  for (const key of ['storeId', 'shopId']) {
    if (typeof body[key] === 'string' && body[key].trim()) return body[key]
  }
  return null
}

function validateRule(rule: EndpointRateRule): void {
  if (!Number.isInteger(rule.limit) || rule.limit < 1 || !Number.isInteger(rule.windowMs) || rule.windowMs < 1) throw new RangeError('Rate-limit rule must have positive integer bounds')
}

function unique(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim().replace(/\/$/, '')))]
}

function splitCsv(value: string | undefined): readonly string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter((item) => item.length > 0)
}

function nonEmpty(value: string | undefined): string | undefined {
  const result = value?.trim()
  return result ? result : undefined
}

function numberEnv(env: Readonly<Record<string, string | undefined>>, key: string, fallback: number): number {
  const value = env[key]?.trim()
  const parsed = value ? Number(value) : fallback
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
