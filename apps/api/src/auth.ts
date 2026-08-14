import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { sha256Hex } from '@profitpilot/crypto'
import { AppError, storeId, userId } from '@profitpilot/types'
import type { StoreId, UserId } from '@profitpilot/types'
import type { SessionRecord, SessionRepository } from '@profitpilot/db'

export type JwtKind = 'access' | 'refresh'
export type JwtConfig = Readonly<{ secret: string; issuer: string; accessTtlSeconds: number; refreshTtlSeconds: number }>
export type JwtClaims = Readonly<{ sub: UserId; storeId: StoreId; sid: string; jti: string; kind: JwtKind; iss: string; iat: number; exp: number }>
export type TokenPair = Readonly<{ accessToken: string; refreshToken: string; sessionId: string; expiresAt: number }>

export class JwtService {
  private readonly config: JwtConfig

  public constructor(config: JwtConfig) {
    if (config.secret.trim().length < 32) throw new TypeError('JWT secret must be at least 32 characters')
    if (!config.issuer.trim()) throw new TypeError('JWT issuer cannot be empty')
    if (!Number.isInteger(config.accessTtlSeconds) || config.accessTtlSeconds <= 0) throw new TypeError('Access TTL must be positive')
    if (!Number.isInteger(config.refreshTtlSeconds) || config.refreshTtlSeconds <= 0) throw new TypeError('Refresh TTL must be positive')
    this.config = config
  }

  public issuePair(user: UserId, store: StoreId, sessionId: string, nowSeconds: number): TokenPair {
    const accessToken = this.issue({ sub: user, storeId: store, sid: sessionId, kind: 'access', nowSeconds, ttlSeconds: this.config.accessTtlSeconds })
    const refreshToken = this.issue({ sub: user, storeId: store, sid: sessionId, kind: 'refresh', nowSeconds, ttlSeconds: this.config.refreshTtlSeconds })
    return { accessToken, refreshToken, sessionId, expiresAt: (nowSeconds + this.config.refreshTtlSeconds) * 1000 }
  }

  public verify(token: string, expectedKind: JwtKind, nowSeconds: number): JwtClaims {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw unauthorized('Malformed JWT')
    const [encodedHeader, encodedPayload, encodedSignature] = parts
    const expectedSignature = this.sign(`${encodedHeader}.${encodedPayload}`)
    if (!safeEqual(expectedSignature, encodedSignature)) throw unauthorized('Invalid JWT signature')
    try {
      const header = parseJson(encodedHeader)
      const payload = parseJson(encodedPayload)
      if (header.alg !== 'HS256' || header.typ !== 'JWT' || payload.iss !== this.config.issuer || payload.kind !== expectedKind) throw unauthorized('Invalid JWT claims')
      if (!isString(payload.sub) || !isString(payload.storeId) || !isString(payload.sid) || !isString(payload.jti) || !isNumber(payload.iat) || !isNumber(payload.exp)) throw unauthorized('Invalid JWT claims')
      if (payload.exp <= nowSeconds) throw unauthorized('JWT expired')
      return { sub: userId(payload.sub), storeId: storeId(payload.storeId), sid: payload.sid, jti: payload.jti, kind: expectedKind, iss: this.config.issuer, iat: payload.iat, exp: payload.exp }
    } catch (error: unknown) {
      if (error instanceof AppError) throw error
      throw unauthorized('Invalid JWT payload')
    }
  }

  private issue(input: Readonly<{ sub: UserId; storeId: StoreId; sid: string; kind: JwtKind; nowSeconds: number; ttlSeconds: number }>): string {
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' })
    const payload = encodeJson({ sub: input.sub, storeId: input.storeId, sid: input.sid, jti: randomUUID(), kind: input.kind, iss: this.config.issuer, iat: input.nowSeconds, exp: input.nowSeconds + input.ttlSeconds })
    return `${header}.${payload}.${this.sign(`${header}.${payload}`)}`
  }

  private sign(value: string): string {
    return createHmac('sha256', this.config.secret).update(value, 'utf8').digest('base64url')
  }
}

export class AuthService {
  private readonly jwt: JwtService
  private readonly sessions: SessionRepository
  private readonly now: () => number

  public constructor(jwt: JwtService, sessions: SessionRepository, now: () => number = () => Date.now()) {
    this.jwt = jwt
    this.sessions = sessions
    this.now = now
  }

  public async signIn(user: UserId, store: StoreId): Promise<TokenPair> {
    const now = this.now()
    const sessionId = randomUUID()
    const familyId = randomUUID()
    const tokens = this.jwt.issuePair(user, store, sessionId, Math.floor(now / 1000))
    await this.sessions.create(this.recordFromTokens(sessionId, familyId, user, store, tokens, now))
    return tokens
  }

  public async rotate(refreshToken: string): Promise<TokenPair> {
    const now = this.now()
    const claims = this.jwt.verify(refreshToken, 'refresh', Math.floor(now / 1000))
    const current = this.sessions.getForStore ? await this.sessions.getForStore(claims.storeId, claims.sid) : await this.sessions.get(claims.sid)
    if (!current) throw unauthorized('Refresh session not found')
    const successorId = randomUUID()
    const tokens = this.jwt.issuePair(claims.sub, claims.storeId, successorId, Math.floor(now / 1000))
    const successor = this.recordFromTokens(successorId, current.familyId, claims.sub, claims.storeId, tokens, now)
    const result = await this.sessions.rotate(claims.sid, sha256Hex(refreshToken), successor, now)
    if (result.status !== 'rotated') {
      throw unauthorized(result.status === 'reuse' ? 'Refresh token reuse detected; session family revoked' : 'Refresh session is no longer valid')
    }
    return tokens
  }

  public async revoke(refreshToken: string): Promise<void> {
    const now = this.now()
    const claims = this.jwt.verify(refreshToken, 'refresh', Math.floor(now / 1000))
    const session = this.sessions.getForStore ? await this.sessions.getForStore(claims.storeId, claims.sid) : await this.sessions.get(claims.sid)
    if (session) await this.sessions.revokeFamily(session.familyId, now)
  }

  private recordFromTokens(sessionId: string, familyId: string, user: UserId, store: StoreId, tokens: TokenPair, now: number): SessionRecord {
    return { id: sessionId, familyId, storeId: store, userId: user, refreshTokenHash: sha256Hex(tokens.refreshToken), expiresAt: tokens.expiresAt, createdAt: now, lastUsedAt: now, revokedAt: null, replacedBy: null, reuseDetectedAt: null }
  }
}

function encodeJson(value: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

type UnknownObject = Readonly<Record<string, unknown>>

function parseJson(value: string): UnknownObject {
  const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  if (!isObject(parsed)) throw unauthorized('Invalid JWT JSON')
  return parsed
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isString(value: unknown): value is string { return typeof value === 'string' }
function isNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.byteLength === b.byteLength && timingSafeEqual(a, b) }
function unauthorized(message: string): AppError { return new AppError('UNAUTHORIZED', message, 401) }
