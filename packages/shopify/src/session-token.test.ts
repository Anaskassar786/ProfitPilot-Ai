import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyEmbeddedRequest, verifyShopifySessionToken } from './session-token.js'

const API_KEY = 'test-client-id'
const API_SECRET = 'test-client-secret'
const CONFIG = { apiKey: API_KEY, apiSecret: API_SECRET }
const NOW = 1_760_000_000_000
const SECONDS = Math.floor(NOW / 1000)

function sign(payload: Record<string, unknown>, secret = API_SECRET, header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const body = `${encode(header)}.${encode(payload)}`
  return `${body}.${createHmac('sha256', secret).update(body, 'utf8').digest('base64url')}`
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://commander-pilot.myshopify.com/admin',
    dest: 'https://commander-pilot.myshopify.com',
    aud: API_KEY,
    sub: '42',
    exp: SECONDS + 60,
    nbf: SECONDS - 5,
    iat: SECONDS,
    sid: 'session-abc',
    ...overrides,
  }
}

describe('verifyShopifySessionToken', () => {
  it('accepts a token Shopify signed with the app secret and extracts the shop', () => {
    const claims = verifyShopifySessionToken(sign(validPayload()), CONFIG, NOW)
    expect(claims).not.toBeNull()
    expect(claims?.shop).toBe('commander-pilot.myshopify.com')
    expect(claims?.sid).toBe('session-abc')
  })

  it('rejects a token signed with the wrong secret', () => {
    expect(verifyShopifySessionToken(sign(validPayload(), 'attacker-secret'), CONFIG, NOW)).toBeNull()
  })

  it('rejects a token minted for a different app', () => {
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'another-app' })), CONFIG, NOW)).toBeNull()
  })

  it('rejects an expired token and one that is not yet valid', () => {
    expect(verifyShopifySessionToken(sign(validPayload({ exp: SECONDS - 30 })), CONFIG, NOW)).toBeNull()
    expect(verifyShopifySessionToken(sign(validPayload({ nbf: SECONDS + 600 })), CONFIG, NOW)).toBeNull()
  })

  it('rejects the alg=none downgrade and malformed tokens', () => {
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
    expect(verifyShopifySessionToken(`${encode({ alg: 'none' })}.${encode(validPayload())}.`, CONFIG, NOW)).toBeNull()
    expect(verifyShopifySessionToken('not-a-jwt', CONFIG, NOW)).toBeNull()
    expect(verifyShopifySessionToken('', CONFIG, NOW)).toBeNull()
  })

  it('rejects a dest that is not a myshopify domain', () => {
    expect(verifyShopifySessionToken(sign(validPayload({ dest: 'https://evil.example.com' })), CONFIG, NOW)).toBeNull()
  })
})

describe('audience-mismatch graceful fallback (stale SHOPIFY_API_KEY recovery)', () => {
  const FALLBACK = { allowAudienceFallback: true } as const

  it('accepts a signature-valid token whose aud drifted and flags the fallback', () => {
    const claims = verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id' })), CONFIG, NOW, FALLBACK)
    expect(claims?.shop).toBe('commander-pilot.myshopify.com')
    expect(claims?.aud).toBe('rotated-client-id')
    expect(claims?.audienceFallback).toBe(true)
  })

  it('keeps strict rejection as the default when the flag is absent', () => {
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id' })), CONFIG, NOW)).toBeNull()
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id' })), CONFIG, NOW, {})).toBeNull()
    // A fully matching token verifies with or without the flag, unflagged.
    const claims = verifyShopifySessionToken(sign(validPayload()), CONFIG, NOW, {})
    expect(claims?.shop).toBe('commander-pilot.myshopify.com')
    expect(claims?.audienceFallback).toBeUndefined()
  })

  it('never relaxes the signature check — forged tokens are still rejected', () => {
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id' }), 'attacker-secret'), CONFIG, NOW, FALLBACK)).toBeNull()
  })

  it('still enforces expiry and not-before on fallback tokens', () => {
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id', exp: SECONDS - 30 })), CONFIG, NOW, FALLBACK)).toBeNull()
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id', nbf: SECONDS + 600 })), CONFIG, NOW, FALLBACK)).toBeNull()
  })

  it('resolves the shop from the authenticated iss claim when dest is unusable', () => {
    const claims = verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id', dest: 'https://evil.example.com' })), CONFIG, NOW, FALLBACK)
    expect(claims?.shop).toBe('commander-pilot.myshopify.com')
    expect(claims?.audienceFallback).toBe(true)
  })

  it('never falls back to iss in strict mode', () => {
    expect(verifyShopifySessionToken(sign(validPayload({ dest: 'https://evil.example.com' })), CONFIG, NOW)).toBeNull()
  })

  it('rejects a fallback token that carries neither a usable dest nor iss', () => {
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id', dest: 'https://evil.example.com', iss: 'https://evil.example.com/admin' })), CONFIG, NOW, FALLBACK)).toBeNull()
  })

  it('logs the fallback with aud_received, key_expected and shop', async () => {
    const { setSessionTokenVerificationLogger } = await import('./session-token.js')
    const logs: Array<{ message: string; context: Readonly<Record<string, unknown>> }> = []
    setSessionTokenVerificationLogger((message, context) => logs.push({ message, context }))
    try {
      expect(verifyShopifySessionToken(sign(validPayload({ aud: 'rotated-client-id' })), CONFIG, NOW, FALLBACK)).not.toBeNull()
      const fallback = logs.find((entry) => entry.message.startsWith('[AuthDiagnostic] Session token audience fallback'))
      expect(fallback).toBeDefined()
      expect(fallback?.context).toMatchObject({ aud_received: 'rotated-client-id', key_expected: API_KEY, shop: 'commander-pilot.myshopify.com', reason: 'audience-mismatch-fallback' })
    } finally {
      setSessionTokenVerificationLogger(null)
    }
  })

  it('enriches failure diagnostics with aud_received, key_expected and shop', async () => {
    const { setSessionTokenVerificationLogger } = await import('./session-token.js')
    const logs: Array<{ message: string; context: Readonly<Record<string, unknown>> }> = []
    setSessionTokenVerificationLogger((message, context) => logs.push({ message, context }))
    try {
      expect(verifyShopifySessionToken(sign(validPayload({ exp: SECONDS - 30 })), CONFIG, NOW)).toBeNull()
      expect(logs[0]?.context).toMatchObject({ aud_received: API_KEY, key_expected: API_KEY, shop: 'https://commander-pilot.myshopify.com' })
    } finally {
      setSessionTokenVerificationLogger(null)
    }
  })

  it('never echoes unauthenticated claims in the signature-mismatch context', async () => {
    const { setSessionTokenVerificationLogger } = await import('./session-token.js')
    const logs: Array<{ message: string; context: Readonly<Record<string, unknown>> }> = []
    setSessionTokenVerificationLogger((message, context) => logs.push({ message, context }))
    try {
      expect(verifyShopifySessionToken(sign(validPayload(), 'attacker-secret'), CONFIG, NOW)).toBeNull()
      expect(logs[0]?.context).toMatchObject({ aud_received: null, key_expected: API_KEY, shop: null })
    } finally {
      setSessionTokenVerificationLogger(null)
    }
  })
})

describe('verifyEmbeddedRequest', () => {
  it('identifies the shop from a session token on the app-load URL', () => {
    const identity = verifyEmbeddedRequest({ id_token: sign(validPayload()), shop: 'commander-pilot.myshopify.com' }, CONFIG, undefined, NOW)
    expect(identity).toEqual({ shop: 'commander-pilot.myshopify.com', method: 'session-token' })
  })

  it('falls back to the signed hmac when no session token is present', () => {
    const query: Record<string, string> = { shop: 'commander-pilot.myshopify.com', host: 'YWRtaW4=', timestamp: '1700000000' }
    const message = Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')
    query.hmac = createHmac('sha256', API_SECRET).update(message, 'utf8').digest('hex')
    expect(verifyEmbeddedRequest(query, CONFIG, undefined, NOW)).toEqual({ shop: 'commander-pilot.myshopify.com', method: 'query-hmac' })
  })

  it('never trusts a bare shop parameter with no proof', () => {
    expect(verifyEmbeddedRequest({ shop: 'attacker.myshopify.com' }, CONFIG, undefined, NOW)).toBeNull()
    expect(verifyEmbeddedRequest({}, CONFIG, undefined, NOW)).toBeNull()
  })

  it('rejects a forged hmac', () => {
    expect(verifyEmbeddedRequest({ shop: 'commander-pilot.myshopify.com', hmac: 'deadbeef', timestamp: '1' }, CONFIG, undefined, NOW)).toBeNull()
  })
})

describe('session-token verification diagnostics', () => {
  it('logs the exact audience mismatch diagnostic with shop, received aud and expected api key', async () => {
    const { setSessionTokenVerificationLogger } = await import('./session-token.js')
    const logs: string[] = []
    setSessionTokenVerificationLogger((message) => logs.push(message))
    try {
      expect(verifyShopifySessionToken(sign(validPayload({ aud: 'another-app' })), CONFIG, NOW)).toBeNull()
      expect(logs).toContain(
        `[AuthDiagnostics] JWT verification failed for shop=https://commander-pilot.myshopify.com, aud_received=another-app, aud_expected=${API_KEY}`,
      )
    } finally {
      setSessionTokenVerificationLogger(null)
    }
  })

  it('logs an expired token with the authenticated payload identity', async () => {
    const { setSessionTokenVerificationLogger } = await import('./session-token.js')
    const logs: Array<{ message: string; context: Readonly<Record<string, unknown>> }> = []
    setSessionTokenVerificationLogger((message, context) => logs.push({ message, context }))
    try {
      expect(verifyShopifySessionToken(sign(validPayload({ exp: SECONDS - 30 })), CONFIG, NOW)).toBeNull()
      expect(logs).toHaveLength(1)
      expect(logs[0]?.message).toContain(`[AuthDiagnostics] JWT verification failed for shop=https://commander-pilot.myshopify.com, aud_received=${API_KEY}, aud_expected=${API_KEY}`)
      expect(logs[0]?.context).toMatchObject({ reason: 'expired' })
    } finally {
      setSessionTokenVerificationLogger(null)
    }
  })

  it('never echoes unauthenticated claims for a signature mismatch', async () => {
    const { setSessionTokenVerificationLogger } = await import('./session-token.js')
    const logs: string[] = []
    setSessionTokenVerificationLogger((message) => logs.push(message))
    try {
      expect(verifyShopifySessionToken(sign(validPayload(), 'attacker-secret'), CONFIG, NOW)).toBeNull()
      expect(logs).toHaveLength(1)
      expect(logs[0]).toContain('INVALID_SIGNATURE')
      expect(logs[0]).toContain(`aud_expected=${API_KEY}`)
      expect(logs[0]).not.toContain('commander-pilot.myshopify.com')
    } finally {
      setSessionTokenVerificationLogger(null)
    }
  })

  it('previews dest/aud claims for diagnostics without verifying the token', async () => {
    const { sessionTokenClaimsPreview } = await import('./session-token.js')
    expect(sessionTokenClaimsPreview(sign(validPayload()))).toEqual({ dest: 'https://commander-pilot.myshopify.com', aud: API_KEY })
    expect(sessionTokenClaimsPreview('not-a-jwt')).toEqual({ dest: null, aud: null })
  })
})
