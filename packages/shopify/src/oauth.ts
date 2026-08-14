import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type OAuthState = Readonly<{ token: string; shop: string; expiresAt: number }>

/**
 * Storage contract for OAuth state tokens. Implementations must make consume()
 * single-use (a returned true must never be repeated for the same token) so a
 * replayed callback cannot re-exchange the same authorization code.
 */
export interface OAuthStates {
  issue(shop: string, ttlMs?: number): Promise<OAuthState>
  consume(token: string, shop: string): Promise<boolean>
}

export function parseShopDomain(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new TypeError('Invalid Shopify shop domain')
  }
  return normalized
}

/** In-memory state store for single-process development and unit tests. */
export class OAuthStateStore implements OAuthStates {
  private readonly states = new Map<string, OAuthState>()
  private readonly now: () => number

  public constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  public async issue(shop: string, ttlMs = 10 * 60 * 1000): Promise<OAuthState> {
    const state: OAuthState = { token: randomBytes(32).toString('hex'), shop: parseShopDomain(shop), expiresAt: this.now() + ttlMs }
    this.states.set(state.token, state)
    return state
  }

  public async consume(token: string, shop: string): Promise<boolean> {
    const state = this.states.get(token)
    this.states.delete(token)
    if (!state || state.expiresAt <= this.now()) return false
    return safeEqualString(state.shop, parseShopDomain(shop))
  }
}

/**
 * Version tag surfaced in every OAuth diagnostics record and at startup. A stale
 * deploy is the single most common "I shipped the fix but it still fails" cause,
 * so this string lets anyone reading the logs confirm the new code is actually
 * running before chasing an algorithm that isn't even live yet.
 */
export const OAUTH_DIAGNOSTICS_VERSION = 'PR9-multi-method-2026-08-14'

/**
 * The parameter set Shopify signs on an OAuth callback today (plus the legacy
 * `signature`). A callback carrying anything outside this set is flagged in
 * diagnostics: an unexpected parameter is part of the signed message, so even a
 * correctly computed HMAC mismatches and looks like a secret bug when it is
 * really an extra-param bug.
 */
const SHOPIFY_CALLBACK_KEYS: ReadonlySet<string> = new Set(['code', 'hmac', 'host', 'shop', 'state', 'timestamp', 'signature'])

/**
 * The canonical message constructions Shopify and its official SDK use to sign
 * an OAuth callback. Shopify's documentation is deliberately ambiguous about
 * whether values are signed URL-encoded or raw-decoded (its worked example uses
 * only characters that need no encoding), so a callback that verifies under one
 * convention can fail under another. We compute all of them:
 *
 *  - `raw`         the exact query bytes Shopify sent (from the original URL),
 *                  hmac/signature removed, order preserved. Ground truth for the
 *                  "Shopify signed the encoded form" case.
 *  - `raw-sorted`  the same segments re-sorted by key, in case an intermediary
 *                  reordered the query string.
 *  - `decoded`     parsed query values joined raw (`key=value`), as in
 *                  Shopify's own documentation example. Ground truth for the
 *                  "Shopify signed the decoded form" case.
 *  - `encoded`     parsed query values percent-encoded with encodeURIComponent,
 *                  mirroring @shopify/shopify-api's URLSearchParams validator.
 *
 * All four are HMAC-SHA256 over a deterministic message with the same secret, so
 * accepting any of them does not weaken verification: an attacker still needs
 * the secret to produce a single valid digest. The base64 `host` callback
 * parameter is what forces this — roughly two thirds of store handles base64-
 * encode to a value containing `=` padding / `+` / `/`, where the encoded and
 * decoded forms genuinely differ.
 */
type HmacMethodName = 'raw' | 'raw-sorted' | 'decoded' | 'encoded'

export function verifyOAuthHmac(query: Readonly<Record<string, string>>, secret: string, rawQuery?: string): boolean {
  const provided = query.hmac
  if (!provided) return false
  // Evaluate every method (no short-circuit) so the match/no-match signal is
  // not gated on ordering and the diagnostics stay self-consistent.
  let matched = false
  for (const candidate of computeHmacCandidates(query, secret, rawQuery)) {
    if (safeEqualString(candidate.hmac, provided)) matched = true
  }
  return matched
}

/**
 * The "encoded" signed message (matches @shopify/shopify-api): every query
 * parameter except `hmac`/`signature`, sorted by key in byte order, joined as
 * `key=value` with each value percent-encoded via encodeURIComponent.
 *
 * Kept as the canonical preview builder for diagnostics; verification itself
 * consults several message forms (see computeHmacCandidates).
 */
export function shopifyHmacMessage(query: Readonly<Record<string, string>>): string {
  return encodedMessage(query)
}

/** Every signed parameter (hmac/signature removed). */
function signedEntries(query: Readonly<Record<string, string>>): Array<readonly [string, string]> {
  return Object.entries(query).filter(([key]) => key !== 'hmac' && key !== 'signature')
}

function encodedMessage(query: Readonly<Record<string, string>>): string {
  return signedEntries(query)
    .sort(([left], [right]) => compareBytes(left, right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
}

function decodedMessage(query: Readonly<Record<string, string>>): string {
  return signedEntries(query)
    .sort(([left], [right]) => compareBytes(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function rawSegments(rawQuery: string | undefined): readonly string[] {
  if (!rawQuery) return []
  return rawQuery.split('&').filter((segment) => segment.length > 0 && !segment.startsWith('hmac=') && !segment.startsWith('signature='))
}

function segmentKey(segment: string): string {
  const eq = segment.indexOf('=')
  return eq < 0 ? segment : segment.slice(0, eq)
}

function rawPreservedMessage(rawQuery: string | undefined): string {
  return rawSegments(rawQuery).join('&')
}

function rawSortedMessage(rawQuery: string | undefined): string {
  return [...rawSegments(rawQuery)].sort((left, right) => compareBytes(segmentKey(left), segmentKey(right))).join('&')
}

type HmacCandidate = Readonly<{ method: HmacMethodName; message: string; hmac: string }>

function computeHmacCandidates(query: Readonly<Record<string, string>>, secret: string, rawQuery?: string): readonly HmacCandidate[] {
  const builders: ReadonlyArray<Readonly<{ method: HmacMethodName; message: string }>> = [
    { method: 'raw', message: rawPreservedMessage(rawQuery) },
    { method: 'raw-sorted', message: rawSortedMessage(rawQuery) },
    { method: 'decoded', message: decodedMessage(query) },
    { method: 'encoded', message: encodedMessage(query) },
  ]
  return builders.map(({ method, message }) => ({ method, message, hmac: createHmac('sha256', secret).update(message).digest('hex') }))
}

export type HmacMethodDiagnostic = Readonly<{ method: HmacMethodName; hmacPrefix: string; matched: boolean }>

/**
 * Diagnostics for the `host` callback parameter — the value most likely to
 * expose an encoding mismatch. We compare the raw (still percent-encoded) form
 * taken from the request URL against the parser-decoded form and its
 * re-encoding, so a framework that double-decodes is visible at a glance.
 */
export type CallbackHostDiagnostic = Readonly<{
  present: boolean
  fromRawQuery: string | null
  decodedByParser: string | null
  reencoded: string | null
  parserMatchesRaw: boolean
  base64Decoded: string | null
  base64RoundTrips: boolean
  hasPadding: boolean
}>

/**
 * Secret-safe snapshot of an HMAC verification attempt, for production
 * diagnostics. Deliberately prefixes-only: never logs the API secret, the
 * authorization `code`, the CSRF `state`, or more than a prefix of any HMAC.
 *
 * `secretPrefix` is the scheme tag plus two characters (e.g. `shpss_b8`) and
 * `secretLength` is the raw length: together they make a stale secret, a
 * stray-quoted env value, or trailing whitespace obvious without leaking key
 * material. The logger exempts these two keys from its blanket `secret`
 * redaction (see @profitpilot/logger) precisely because they carry no secret.
 */
export type OAuthHmacDiagnostics = Readonly<{
  version: string
  parameterKeys: string[]
  parameterCount: number
  extraParameters: string[]
  receivedHmacPrefix: string | null
  receivedHmacLength: number
  computedHmacPrefix: string
  matchedMethod: HmacMethodName | null
  matched: boolean
  secretPrefix: string
  secretLength: number
  methods: HmacMethodDiagnostic[]
  signedMessagePreview: string
  host: CallbackHostDiagnostic
}>

export function inspectOAuthHmac(query: Readonly<Record<string, string>>, secret: string, rawQuery?: string): OAuthHmacDiagnostics {
  const provided = query.hmac ?? null
  const candidates = computeHmacCandidates(query, secret, rawQuery)
  const encodedCandidate = candidates.find((candidate) => candidate.method === 'encoded') ?? candidates[candidates.length - 1]!
  const matchedCandidate = candidates.find((candidate) => provided !== null && safeEqualString(candidate.hmac, provided)) ?? null
  const parameterKeys = Object.keys(query).filter((key) => key !== 'hmac' && key !== 'signature').sort(compareBytes)
  return {
    version: OAUTH_DIAGNOSTICS_VERSION,
    parameterKeys,
    parameterCount: parameterKeys.length,
    extraParameters: Object.keys(query).filter((key) => !SHOPIFY_CALLBACK_KEYS.has(key)),
    receivedHmacPrefix: provided === null ? null : provided.slice(0, 20),
    receivedHmacLength: provided === null ? 0 : provided.length,
    // Backward-compatible field: the encoded-method digest prefix. The methods[]
    // array below carries the full per-method comparison.
    computedHmacPrefix: encodedCandidate.hmac.slice(0, 20),
    matchedMethod: matchedCandidate?.method ?? null,
    matched: matchedCandidate !== null,
    secretPrefix: secret.slice(0, 8),
    secretLength: secret.length,
    methods: candidates.map((candidate) => ({ method: candidate.method, hmacPrefix: candidate.hmac.slice(0, 16), matched: provided !== null && safeEqualString(candidate.hmac, provided) })),
    signedMessagePreview: redactSensitiveValues(encodedMessage(query), query),
    host: inspectCallbackHost(query.host, rawQuery),
  }
}

/** Rebuild the signed message with `code`/`state` masked so previews are safe to ship to log drains. */
function redactSensitiveValues(message: string, query: Readonly<Record<string, string>>): string {
  let preview = message
  for (const key of ['code', 'state'] as const) {
    const value = query[key]
    if (value) preview = preview.split(`${key}=${encodeURIComponent(value)}`).join(`${key}=<redacted:${value.length}chars>`)
  }
  return preview
}

function inspectCallbackHost(host: string | undefined, rawQuery: string | undefined): CallbackHostDiagnostic {
  const fromRawQuery = rawQuery === undefined ? null : rawParam(rawQuery, 'host')
  if (!host) {
    return { present: false, fromRawQuery, decodedByParser: null, reencoded: null, parserMatchesRaw: false, base64Decoded: null, base64RoundTrips: false, hasPadding: false }
  }
  const reencoded = encodeURIComponent(host)
  const base64Decoded = Buffer.from(host, 'base64').toString('utf8')
  return {
    present: true,
    fromRawQuery,
    decodedByParser: host,
    reencoded,
    parserMatchesRaw: fromRawQuery === null ? false : fromRawQuery === reencoded,
    base64Decoded,
    base64RoundTrips: Buffer.from(base64Decoded, 'utf8').toString('base64') === host,
    hasPadding: host.includes('='),
  }
}

function rawParam(rawQuery: string, key: string): string | null {
  for (const segment of rawQuery.split('&')) {
    const eq = segment.indexOf('=')
    if (eq < 0) continue
    if (segment.slice(0, eq) === key) return segment.slice(eq + 1)
  }
  return null
}

export type ShopifyHmacSelfTestResult = Readonly<{ passed: boolean; expected: string; computed: string }>

/**
 * Shopify's documented OAuth HMAC example (shopify.dev
 * authorization-code-grant). The docs render `{shop}` and `my_client_secret` as
 * display placeholders, but the canonical digest `700e2dad…fc4bf` is produced
 * by secret `hush` and shop `some-shop.myshopify.com`. Reproducing it at startup
 * proves the deployed HMAC function is algorithmically correct, independent of
 * any live request or secret — a failure here means the code itself (or the
 * deploy) is broken, not the merchant's callback.
 */
const SHOPIFY_DOCS_SELF_TEST = {
  secret: 'hush',
  query: { code: '0907a61c0c8d55e99db179b68161bc00', shop: 'some-shop.myshopify.com', state: '0.6784241404160823', timestamp: '1337178173' } as Readonly<Record<string, string>>,
  expectedHmac: '700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf',
}

export function shopifyHmacSelfTest(): ShopifyHmacSelfTestResult {
  const computed = createHmac('sha256', SHOPIFY_DOCS_SELF_TEST.secret).update(encodedMessage(SHOPIFY_DOCS_SELF_TEST.query)).digest('hex')
  return { passed: computed === SHOPIFY_DOCS_SELF_TEST.expectedHmac, expected: SHOPIFY_DOCS_SELF_TEST.expectedHmac, computed }
}

export function verifyWebhookHmac(rawBody: string, providedBase64: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  return safeEqualString(expected, providedBase64)
}

function compareBytes(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
}
