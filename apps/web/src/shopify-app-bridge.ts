/**
 * Shopify App Bridge — embedded session tokens.
 *
 * The embedded app runs inside the Shopify admin iframe, where third-party
 * cookies are increasingly blocked (Chrome/Safari ITP). Instead of relying on
 * the `profitpilot_session` cookie, every authenticated API call asks App
 * Bridge for a fresh, short-lived Shopify session token (an HS256 JWT signed
 * with the app's API secret) and sends it as `Authorization: Bearer …`.
 *
 * App Bridge itself ships as the official CDN script loaded by index.html;
 * this module only detects the embedded context and talks to `window.shopify`.
 * It is a hard no-op when the app runs standalone (local dev, no `host`
 * query parameter), so the existing cookie-based dev path is untouched.
 */

export type AppBridgeTokenSource = Readonly<{ idToken(): Promise<string> }>

export type EmbeddedSessionTokenResult =
  | Readonly<{ status: 'not-embedded' }>
  | Readonly<{ status: 'ok'; token: string }>
  | Readonly<{ status: 'unavailable'; message: string }>

/** How long to wait for the CDN script to expose `window.shopify`. */
const APP_BRIDGE_READY_TIMEOUT_MS = 5_000
const APP_BRIDGE_READY_POLL_MS = 50

let appBridgeInstance: AppBridgeTokenSource | null = null
let appBridgeOverride: AppBridgeTokenSource | null = null
let appBridgeReadyTimeoutMs = APP_BRIDGE_READY_TIMEOUT_MS
let appBridgeReadyPollMs = APP_BRIDGE_READY_POLL_MS

/**
 * The `host` query parameter Shopify appends to the app URL is the reliable
 * marker that the page is embedded. (Checking `window.top !== window.self`
 * alone would misfire inside any iframe, e.g. previews.)
 */
export function embeddedHost(search: string): string | null {
  try {
    const value = new URLSearchParams(search).get('host')
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

export function isEmbeddedShopifyApp(search: string = currentSearch()): boolean {
  return embeddedHost(search) !== null
}

/** Public app key only — never the API secret (Vite only exposes VITE_ vars). */
function publicShopifyApiKey(): string | null {
  try {
    const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> }
    const key = meta.env?.VITE_SHOPIFY_API_KEY?.trim()
    return key || null
  } catch {
    return null
  }
}

/**
 * Returns a fresh Shopify session token for the embedded admin, or a
 * discriminated "why not" result. Never throws: callers decide how to handle
 * an unavailable token (log + keep the cookie fallback, or surface a
 * user-visible re-auth message).
 */
export async function getShopifySessionToken(search: string = currentSearch(), apiKey: string | null = publicShopifyApiKey()): Promise<EmbeddedSessionTokenResult> {
  if (typeof window === 'undefined') return { status: 'not-embedded' }
  const host = embeddedHost(search)
  if (!host) return { status: 'not-embedded' }
  if (!apiKey) {
    return { status: 'unavailable', message: 'VITE_SHOPIFY_API_KEY is not configured for this build' }
  }
  try {
    const source = appBridgeOverride ?? (await appBridgeSource(apiKey, host))
    const token = await source.idToken()
    if (typeof token !== 'string' || !token.trim()) return { status: 'unavailable', message: 'Shopify returned an empty session token' }
    return { status: 'ok', token }
  } catch (error: unknown) {
    return { status: 'unavailable', message: error instanceof Error ? error.message : 'Shopify session token request failed' }
  }
}

async function appBridgeSource(apiKey: string, host: string): Promise<AppBridgeTokenSource> {
  if (appBridgeInstance) return appBridgeInstance
  const shopifyGlobal = await waitForShopifyGlobal()
  if (!shopifyGlobal) throw new Error('Shopify App Bridge did not load (the CDN script may be blocked)')
  const createApp = typeof shopifyGlobal.default === 'function'
    ? shopifyGlobal.default
    : typeof shopifyGlobal.createApp === 'function'
      ? shopifyGlobal.createApp
      : null
  if (createApp) {
    appBridgeInstance = (createApp as (config: Readonly<{ apiKey: string; host: string }>) => unknown)({ apiKey, host }) as AppBridgeTokenSource
    if (typeof appBridgeInstance.idToken !== 'function') throw new Error('Shopify App Bridge createApp returned no idToken()')
    return appBridgeInstance
  }
  // Legacy CDN builds expose idToken() directly on the window.shopify global.
  if (typeof shopifyGlobal.idToken === 'function') {
    appBridgeInstance = shopifyGlobal as unknown as AppBridgeTokenSource
    return appBridgeInstance
  }
  throw new Error('Shopify App Bridge is present but has no idToken() API')
}

async function waitForShopifyGlobal(): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + appBridgeReadyTimeoutMs
  for (;;) {
    const shopify = (window as { shopify?: unknown }).shopify as Record<string, unknown> | undefined
    if (shopify) return shopify
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, appBridgeReadyPollMs))
  }
}

function currentSearch(): string {
  // Guard against partial `window` mocks (tests, hardened embeds) where
  // `location` may be missing or throw on access.
  try {
    const search = typeof window !== 'undefined' ? window.location.search : ''
    return typeof search === 'string' ? search : ''
  } catch {
    return ''
  }
}

/** Clears module state between isolated browser-client tests. */
export function resetShopifyAppBridgeStateForTests(): void {
  appBridgeInstance = null
  appBridgeOverride = null
  appBridgeReadyTimeoutMs = APP_BRIDGE_READY_TIMEOUT_MS
  appBridgeReadyPollMs = APP_BRIDGE_READY_POLL_MS
}

/** Shrinks the CDN readiness poll so "script missing" tests stay fast. */
export function setAppBridgeReadyTimingForTests(timeoutMs: number, pollMs: number): void {
  appBridgeReadyTimeoutMs = timeoutMs
  appBridgeReadyPollMs = pollMs
}

/** Lets tests inject a fake App Bridge without a real Shopify admin frame. */
export function overrideShopifyAppBridgeForTests(source: AppBridgeTokenSource | null): void {
  appBridgeOverride = source
}
