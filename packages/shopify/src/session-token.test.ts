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

  it('previews dest/iss/aud claims for diagnostics without verifying the token', async () => {
    const { sessionTokenClaimsPreview } = await import('./session-token.js')
    expect(sessionTokenClaimsPreview(sign(validPayload()))).toEqual({
      dest: 'https://commander-pilot.myshopify.com',
      iss: 'https://commander-pilot.myshopify.com/admin',
      aud: API_KEY,
    })
    expect(sessionTokenClaimsPreview('not-a-jwt')).toEqual({ dest: null, iss: null, aud: null })
  })
})

describe('audience aliases (SHOPIFY_API_KEY_ALIASES)', () => {
  it('accepts a signature-valid token whose aud is a configured alias and reports which one', async () => {
    const { sanitizeSessionTokenConfig } = await import('./session-token.js')
    const config = sanitizeSessionTokenConfig({ apiKey: API_KEY, apiSecret: API_SECRET, audienceAliases: [' "legacy-client-id"\n'] })
    const claims = verifyShopifySessionToken(sign(validPayload({ aud: 'legacy-client-id' })), config, NOW)
    expect(claims?.shop).toBe('commander-pilot.myshopify.com')
    expect(claims?.audienceAlias).toBe('legacy-client-id')
  })

  it('reports an empty alias for a token matching the primary key', () => {
    const claims = verifyShopifySessionToken(sign(validPayload()), { ...CONFIG, audienceAliases: ['legacy-client-id'] }, NOW)
    expect(claims?.audienceAlias).toBe('')
  })

  it('still rejects an aud that is neither the key nor an alias', async () => {
    const { sanitizeSessionTokenConfig } = await import('./session-token.js')
    const config = sanitizeSessionTokenConfig({ apiKey: API_KEY, apiSecret: API_SECRET, audienceAliases: ['legacy-client-id'] })
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'unknown-app' })), config, NOW)).toBeNull()
  })

  it('never accepts a forged token just because its aud is an alias — the signature still must verify', async () => {
    const { sanitizeSessionTokenConfig } = await import('./session-token.js')
    const config = sanitizeSessionTokenConfig({ apiKey: API_KEY, apiSecret: API_SECRET, audienceAliases: ['attacker-client-id'] })
    // Signed with an attacker secret but naming an allowlisted audience.
    expect(verifyShopifySessionToken(sign(validPayload({ aud: 'attacker-client-id' }), 'attacker-secret'), config, NOW)).toBeNull()
  })

  it('drops aliases equal to the primary key and de-duplicates them', async () => {
    const { sanitizeSessionTokenConfig } = await import('./session-token.js')
    expect(sanitizeSessionTokenConfig({ apiKey: API_KEY, apiSecret: API_SECRET, audienceAliases: [API_KEY, 'a', 'a', '  '] }).audienceAliases).toEqual(['a'])
  })

  it('parses a comma-separated env value and ignores blank entries', async () => {
    const { parseAudienceAliases } = await import('./session-token.js')
    expect(parseAudienceAliases(' "a"\n , b ,,')).toEqual(['a', 'b'])
    expect(parseAudienceAliases(undefined)).toEqual([])
    expect(parseAudienceAliases('')).toEqual([])
  })
})

describe('shop resolution from verified claims', () => {
  it('falls back to the iss host when dest is absent, because the signature is already verified', () => {
    const payload = validPayload()
    delete payload.dest
    expect(verifyShopifySessionToken(sign(payload), CONFIG, NOW)?.shop).toBe('commander-pilot.myshopify.com')
  })

  it('rejects when neither dest nor iss names a myshopify.com host', () => {
    const payload = validPayload({ dest: 'https://evil.example.com', iss: 'https://evil.example.com/admin' })
    expect(verifyShopifySessionToken(sign(payload), CONFIG, NOW)).toBeNull()
  })

  it('does NOT let a valid iss rescue a present-but-invalid dest', () => {
    // Shopify always mints dest and iss from the same host, so this shape is
    // malformed. Preferring iss here would silently drop the dest guard.
    const claims = verifyShopifySessionToken(sign(validPayload({ dest: 'https://evil.example.com' })), CONFIG, NOW)
    expect(claims).toBeNull()
  })

  it('never resolves a shop from a forged token claiming a victim store', () => {
    // The payload names a real-looking victim shop but is signed with the wrong
    // secret: dest/iss must never become a tenant lookup key here.
    const forged = sign(validPayload({ dest: 'https://victim.myshopify.com', iss: 'https://victim.myshopify.com/admin' }), 'attacker-secret')
    expect(verifyShopifySessionToken(forged, CONFIG, NOW)).toBeNull()
    expect(verifyEmbeddedRequest({ id_token: forged }, CONFIG, undefined, NOW)).toBeNull()
  })
})
