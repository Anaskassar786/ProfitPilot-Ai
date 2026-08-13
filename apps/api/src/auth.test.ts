import { describe, expect, it } from 'vitest'
import { AppError, storeId, userId } from '@profitpilot/types'
import { InMemorySessionRepository } from '@profitpilot/db'
import { AuthService, JwtService } from './auth.js'

const secret = 'a-very-long-f1-jwt-secret-that-is-never-committed'
const user = userId('user-1')
const store = storeId('store-1')

function services(now = 1_700_000_000_000): { jwt: JwtService; sessions: InMemorySessionRepository; auth: AuthService } {
  const jwt = new JwtService({ secret, issuer: 'profitpilot.test', accessTtlSeconds: 900, refreshTtlSeconds: 604800 })
  const sessions = new InMemorySessionRepository()
  return { jwt, sessions, auth: new AuthService(jwt, sessions, () => now) }
}

describe('JWT access and refresh tokens', () => {
  it('requires a strong signing secret', () => expect(() => new JwtService({ secret: 'short', issuer: 'test', accessTtlSeconds: 1, refreshTtlSeconds: 1 })).toThrow('32'))
  it('issues verifiable access and refresh tokens', async () => {
    const { auth, jwt } = services()
    const pair = await auth.signIn(user, store)
    expect(jwt.verify(pair.accessToken, 'access', 1_700_000_000)).toMatchObject({ sub: user, storeId: store, kind: 'access' })
    expect(jwt.verify(pair.refreshToken, 'refresh', 1_700_000_000)).toMatchObject({ sid: pair.sessionId, kind: 'refresh' })
  })
  it('rejects a refresh token when access is expected', async () => {
    const { auth, jwt } = services()
    const pair = await auth.signIn(user, store)
    expect(() => jwt.verify(pair.refreshToken, 'access', 1_700_000_000)).toThrow('claims')
  })
  it('rejects tampered signatures', async () => {
    const { auth, jwt } = services()
    const pair = await auth.signIn(user, store)
    const parts = pair.accessToken.split('.')
    parts[2] = `${parts[2]}tampered`
    expect(() => jwt.verify(parts.join('.'), 'access', 1_700_000_000)).toThrow('signature')
  })
  it('rejects expired tokens', async () => {
    const jwt = new JwtService({ secret, issuer: 'profitpilot.test', accessTtlSeconds: 1, refreshTtlSeconds: 2 })
    const pair = jwt.issuePair(user, store, 'session', 100)
    expect(() => jwt.verify(pair.accessToken, 'access', 101)).toThrow('expired')
  })
  it('rejects tokens from another issuer', async () => {
    const { auth } = services()
    const pair = await auth.signIn(user, store)
    const other = new JwtService({ secret, issuer: 'other', accessTtlSeconds: 900, refreshTtlSeconds: 900 })
    expect(() => other.verify(pair.accessToken, 'access', 1_700_000_000)).toThrow('claims')
  })
  it('rejects malformed JWT input', () => expect(() => services().jwt.verify('not-a-token', 'access', 1)).toThrow(AppError))
  it('rejects invalid JWT JSON', async () => {
    const { auth, jwt } = services()
    const pair = await auth.signIn(user, store)
    const parts = pair.accessToken.split('.')
    const payload = Buffer.from('not-json').toString('base64url')
    parts[1] = payload
    expect(() => jwt.verify(parts.join('.'), 'access', 1_700_000_000)).toThrow(AppError)
  })
})

describe('refresh rotation and reuse detection', () => {
  it('rotates a refresh token into a new session id', async () => {
    const { auth, sessions } = services()
    const first = await auth.signIn(user, store)
    const second = await auth.rotate(first.refreshToken)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect((await sessions.get(first.sessionId))?.revokedAt).not.toBeNull()
    expect((await sessions.get(second.sessionId))?.revokedAt).toBeNull()
  })
  it('rejects reuse of an already rotated refresh token', async () => {
    const { auth, sessions } = services()
    const first = await auth.signIn(user, store)
    await auth.rotate(first.refreshToken)
    await expect(auth.rotate(first.refreshToken)).rejects.toThrow('reuse detected')
    const original = await sessions.get(first.sessionId)
    expect(original?.reuseDetectedAt).not.toBeNull()
  })
  it('rejects a refresh token from a missing session', async () => {
    const { auth, jwt } = services()
    const pair = jwt.issuePair(user, store, 'missing-session', 1_700_000_000)
    await expect(auth.rotate(pair.refreshToken)).rejects.toThrow('not found')
  })
  it('revokes a whole session family on logout', async () => {
    const { auth, sessions } = services()
    const first = await auth.signIn(user, store)
    const second = await auth.rotate(first.refreshToken)
    await auth.revoke(second.refreshToken)
    expect((await sessions.get(first.sessionId))?.revokedAt).not.toBeNull()
    expect((await sessions.get(second.sessionId))?.revokedAt).not.toBeNull()
  })
  it('rejects a refresh after session expiry', async () => {
    let now = 1_700_000_000_000
    const jwt = new JwtService({ secret, issuer: 'profitpilot.test', accessTtlSeconds: 1, refreshTtlSeconds: 2 })
    const sessions = new InMemorySessionRepository()
    const auth = new AuthService(jwt, sessions, () => now)
    const pair = await auth.signIn(user, store)
    now += 3_000
    await expect(auth.rotate(pair.refreshToken)).rejects.toThrow('expired')
  })
  it('rejects invalid refresh input', async () => await expect(services().auth.rotate('invalid')).rejects.toThrow(AppError))
})
