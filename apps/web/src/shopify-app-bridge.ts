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
/** Pause between embedded-session retries so a still-booting bridge can settle. */
const SESSION_TOKEN_RETRY_DELAY_MS = 250

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
export function publicShopifyApiKey(): string | null {
  try {
    const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> }
    const key = meta.env?.VITE_SHOPIFY_API_KEY?.trim()
    if (key && key !== '%VITE_SHOPIFY_API_KEY%') return key
  } catch {
    /* import.meta.env is unavailable in some test shims */
  }
  try {
    const content = document.querySelector('meta[name="shopify-api-key"]')?.getAttribute('content')?.trim()
    if (content && content !== '%VITE_SHOPIFY_API_KEY%') return content
  } catch {
    /* jsdom / SSR */
  }
  return null
}

/**
 * Guarantees the `shopify-api-key` meta tag App Bridge v4 reads at boot. The
 * static index.html carries it and the API injects it at serve time, but a
 * static/CDN-hosted build with an empty placeholder would otherwise leave the
 * CDN bridge without a client id. Idempotent; never overwrites a real key.
 */
export function ensureShopifyApiKeyMetaTag(apiKey: string | null = publicShopifyApiKey()): void {
  if (!apiKey || typeof document === 'undefined') return
  const existing = document.querySelector('meta[name="shopify-api-key"]')
  const content = existing?.getAttribute('content')?.trim()
  if (existing && content && content !== '%VITE_SHOPIFY_API_KEY%') return
  if (existing) {
    existing.setAttribute('content', apiKey)
    return
  }
  const meta = document.createElement('meta')
  meta.name = 'shopify-api-key'
  meta.content = apiKey
  document.head.appendChild(meta)
}

/**
 * App Bridge v3 `forceRedirect` equivalent for v4 CDN apps: if Shopify loaded
 * the app outside the admin iframe (host+api key present, `window.top ===
 * window.self`), bounce into admin so `idToken()` can mint a session token.
 */
export function ensureEmbeddedAppBridgeRedirect(search: string = currentSearch(), apiKey: string | null = publicShopifyApiKey()): boolean {
  if (typeof window === 'undefined') return false
  const host = embeddedHost(search)
  if (!host || !apiKey) return false
  let nested = false
  try {
    nested = window.top !== window.self
  } catch {
    nested = true
  }
  if (nested) return false
  let decoded = ''
  try {
    decoded = atob(host)
  } catch {
    return false
  }
  if (!decoded || decoded.includes('\0') || /\s/.test(decoded)) return false
  const origin = decoded.startsWith('https://') ? decoded : `https://${decoded}`
  const path = window.location.pathname || '/'
  const query = window.location.search || ''
  window.location.replace(`${origin}/apps/${encodeURIComponent(apiKey)}${path}${query}`)
  return true
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
  try {
    const source = appBridgeOverride ?? (await appBridgeSource(apiKey, host))
    const token = await source.idToken()
    if (typeof token !== 'string' || !token.trim()) return { status: 'unavailable', message: 'Shopify returned an empty session token' }
    return { status: 'ok', token }
  } catch (error: unknown) {
    return { status: 'unavailable', message: error instanceof Error ? error.message : 'Shopify session token request failed' }
  }
}

/**
 * Like `getShopifySessionToken`, but retries a transient `unavailable` result
 * (the App Bridge CDN may still be booting, or the first token mint can race
 * the admin frame handshake). Used by the boot-time warm-up so the very first
 * bootstrap fetch carries a Bearer token instead of falling back to the cookie.
 */
export async function getShopifySessionTokenWithRetry(
  search: string = currentSearch(),
  apiKey: string | null = publicShopifyApiKey(),
  retries = 1,
): Promise<EmbeddedSessionTokenResult> {
  let result = await getShopifySessionToken(search, apiKey)
  for (let attempt = 0; attempt < retries && result.status === 'unavailable'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, SESSION_TOKEN_RETRY_DELAY_MS))
    result = await getShopifySessionToken(search, apiKey)
  }
  return result
}

async function appBridgeSource(apiKey: string | null, host: string): Promise<AppBridgeTokenSource> {
  if (appBridgeInstance) return appBridgeInstance
  const existing = readShopifyGlobal()
  // App Bridge v4: the CDN script exposes `window.shopify.idToken()` and does
  // not need createApp / the public API key once it has booted from the meta tag.
  if (existing && typeof existing.idToken === 'function') {
    appBridgeInstance = existing as unknown as AppBridgeTokenSource
    return appBridgeInstance
  }
  if (!existing && !apiKey) {
    throw new Error('VITE_SHOPIFY_API_KEY is not configured for this build')
  }
  const shopifyGlobal = existing ?? (await waitForShopifyGlobal())
  if (!shopifyGlobal) throw new Error('Shopify App Bridge did not load (the CDN script may be blocked)')
  if (typeof shopifyGlobal.idToken === 'function') {
    appBridgeInstance = shopifyGlobal as unknown as AppBridgeTokenSource
    return appBridgeInstance
  }
  const createApp = typeof shopifyGlobal.default === 'function'
    ? shopifyGlobal.default
    : typeof shopifyGlobal.createApp === 'function'
      ? shopifyGlobal.createApp
      : null
  if (createApp) {
    if (!apiKey) throw new Error('VITE_SHOPIFY_API_KEY is not configured for this build')
    appBridgeInstance = (createApp as (config: Readonly<{ apiKey: string; host: string; forceRedirect: boolean }>) => unknown)({ apiKey, host, forceRedirect: true }) as AppBridgeTokenSource
    if (typeof appBridgeInstance.idToken !== 'function') throw new Error('Shopify App Bridge createApp returned no idToken()')
    return appBridgeInstance
  }
  // Fallback: the official npm package, lazily loaded so the CDN stays the
  // primary path. This covers a blocked/expired CDN script or a stale cached
  // build: `createApp` from @shopify/app-bridge still mints session tokens
  // inside the admin iframe as long as the host param and API key are known.
  if (apiKey) {
    const npmCreateApp = await createAppFromNpmPackage()
    if (npmCreateApp) {
      const instance = npmCreateApp({ apiKey, host, forceRedirect: true }) as AppBridgeTokenSource
      if (typeof instance.idToken === 'function') {
        appBridgeInstance = instance
        return appBridgeInstance
      }
    }
  }
  throw new Error('Shopify App Bridge is present but has no idToken() API')
}

async function createAppFromNpmPackage(): Promise<((config: Readonly<{ apiKey: string; host: string; forceRedirect: boolean }>) => unknown) | null> {
  try {
    const mod = await import('@shopify/app-bridge')
    const candidate = (mod as { default?: unknown }).default ?? (mod as { createApp?: unknown }).createApp
    return typeof candidate === 'function' ? (candidate as (config: Readonly<{ apiKey: string; host: string; forceRedirect: boolean }>) => unknown) : null
  } catch {
    return null
  }
}

function readShopifyGlobal(): Record<string, unknown> | null {
  try {
    const shopify = (window as { shopify?: unknown }).shopify
    return shopify && typeof shopify === 'object' ? shopify as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function waitForShopifyGlobal(): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + appBridgeReadyTimeoutMs
  for (;;) {
    const shopify = readShopifyGlobal()
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
