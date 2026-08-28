import { Router } from 'express'
import type { Request } from 'express'
import { requestId, storeId, success } from '@profitpilot/types'
import type { StoreDirectory } from '@profitpilot/db'
import { verifyShopifySessionToken } from '@profitpilot/shopify'
import type { SessionTokenConfig } from '@profitpilot/shopify'
import { SESSION_COOKIE_NAME, parseCookies, verifySessionValue } from './cookies.js'

export type SessionRouteDependencies = Readonly<{
  directory: StoreDirectory
  sessionToken?: SessionTokenConfig
  logger?: import('@profitpilot/logger').Logger
  /** Secret the tenant session cookie is signed with; enables verified cookie resolution. */
  sessionCookieSecret?: string | undefined
  /**
   * Mirrors `SecurityOptions.requireAuthentication`. An unverified context is
   * usable exactly when the server does not insist on authentication (local
   * dev), which is what `authenticated` is promising the client.
   */
  requireAuthentication?: boolean
}>

/**
 * `authenticated` is the field that keeps the dashboard honest.
 *
 * It is true ONLY when the tenant was resolved from a credential the server
 * actually verified — a Shopify session token or a correctly signed tenant
 * cookie. It is false when the context came from the unsigned `?shop=` query
 * parameter or from a legacy/unverifiable cookie, i.e. when the shell knows
 * WHICH store it is for but has no proof it may read that store's data.
 *
 * Before this existed the dashboard rendered "Shopify data plane ready" off a
 * bootstrap endpoint that answers 200 with no credentials at all, so a total
 * credential outage looked like a working workspace with empty cards.
 */
export type SessionContext = Readonly<{ storeId: string | null; shop: string | null; installed: boolean; authenticated: boolean }>

/**
 * Returns the active tenant context for the embedded dashboard — the single
 * bootstrap source of truth the frontend uses to decide between the live
 * dashboard, a session-expired banner, and (only when no store exists at all)
 * the install guidance. The context is resolved in order of specificity:
 *   1. a verified Shopify session token from the `Authorization: Bearer`
 *      header (the embedded primary path — works with cookies blocked), then
 *   2. the session cookie set at OAuth time (survives refreshes), then
 *   3. the `shop` query parameter Shopify appends to the app URL.
 * All three resolve through the store directory, so the single source of
 * truth stays the `stores` row rather than any client-supplied value.
 * `installed` mirrors `storeId !== null`: a false value with a known `shop`
 * means the tenant row is missing (reload/reauth), while a null `shop` means
 * the app is genuinely not connected to any store.
 */
export function createSessionRouter(dependencies: SessionRouteDependencies): Router {
  const router = Router()
  router.get('/session/context', async (request, response, next) => {
    try {
      const context = await resolveContext(dependencies.directory, dependencies.sessionToken, request, dependencies.sessionCookieSecret ?? '', dependencies.requireAuthentication ?? false)
      // A null context is the symptom merchants report as "No Shopify store
      // context detected". Log which inputs were available so the cause
      // (missing cookie vs. missing stores row) is visible in production logs.
      if (context.storeId === null) {
        const cookies = parseCookies(request.header('cookie'))
        dependencies.logger?.warn('Session context resolved to no tenant', {
          hasSessionCookie: Boolean(cookies[SESSION_COOKIE_NAME]?.trim()),
          hasBearer: bearerToken(request) !== null,
          shopQuery: queryString(request.query.shop) ?? '',
          requestId: String(response.getHeader('x-request-id') ?? ''),
        })
      } else if (!context.authenticated) {
        // The shell now knows the store but holds no verified credential, so
        // every storeId-scoped call is about to 401. Say so once, here, instead
        // of letting the dashboard claim the data plane is ready.
        dependencies.logger?.warn('Session context resolved WITHOUT a verified credential — the data plane will reject this session', {
          code: 'CONTEXT_UNAUTHENTICATED',
          storeId: context.storeId,
          shop: context.shop,
          hasBearer: bearerToken(request) !== null,
          hasSessionCookie: Boolean(parseCookies(request.header('cookie'))[SESSION_COOKIE_NAME]?.trim()),
          requestId: String(response.getHeader('x-request-id') ?? ''),
        })
      }
      response.status(200).json(success(context, requestId(String(response.getHeader('x-request-id') ?? 'session'))))
    } catch (error: unknown) {
      next(error)
    }
  })
  return router
}

async function resolveContext(
  directory: StoreDirectory,
  sessionToken: SessionTokenConfig | undefined,
  request: Request,
  sessionCookieSecret = '',
  requireAuthentication = false,
): Promise<SessionContext> {
  // `authenticated` must promise the client something precise: "the data plane
  // will accept requests from this session". When the server does not require
  // authentication (local dev) an unverified context really is usable, so it
  // is authenticated in the only sense that matters here.
  const unverifiedIsUsable = !requireAuthentication
  // 1. Embedded primary path: the App Bridge session token the fetch wrapper
  //    attaches as a Bearer header. Verified, never trusted blind.
  const bearer = bearerToken(request)
  if (bearer && sessionToken) {
    const shopClaims = verifyShopifySessionToken(bearer, sessionToken)
    if (shopClaims) {
      const connection = await directory.getByShopDomain(shopClaims.shop)
      if (connection) return { storeId: connection.storeId, shop: connection.shopDomain, installed: true, authenticated: true }
    }
  }
  // 2. Session cookie fallback for non-embedded / local dev. A cookie whose
  //    signature verifies is as good a credential here as it is in the
  //    authentication middleware; an unsigned (pre-signing) cookie still
  //    resolves the tenant for backwards compatibility but is NOT trusted.
  const cookies = parseCookies(request.header('cookie'))
  const cookieValue = cookies[SESSION_COOKIE_NAME]?.trim() ?? ''
  if (cookieValue) {
    const signedStoreId = sessionCookieSecret ? verifySessionValue(sessionCookieSecret, cookieValue) : null
    // Fall back to the raw value so a pre-signing cookie still NAMES the right
    // store instead of leaving the shell blank. It never authorizes anything:
    // the authentication middleware rejects an unsigned cookie outright, and
    // the flag below tells the dashboard the data plane will refuse it.
    const cookieStoreId = signedStoreId ?? cookieValue
    const connection = await directory.get(storeId(cookieStoreId))
    if (connection) return { storeId: connection.storeId, shop: connection.shopDomain, installed: true, authenticated: signedStoreId !== null || unverifiedIsUsable }
  }
  // 3. Unsigned `shop` query parameter. It tells us WHICH store the app was
  //    opened for — it proves nothing about who is asking, so `authenticated`
  //    stays false and the dashboard must not claim the data plane is ready.
  const shop = queryString(request.query.shop)
  if (shop) {
    const connection = await directory.getByShopDomain(shop)
    if (connection) return { storeId: connection.storeId, shop: connection.shopDomain, installed: true, authenticated: unverifiedIsUsable }
  }
  return { storeId: null, shop: null, installed: false, authenticated: false }
}

function bearerToken(request: Request): string | null {
  const value = request.header('authorization')
  if (!value) return null
  const [scheme, token] = value.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token?.trim() ? token.trim() : null
}

function queryString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' ? first : null
  }
  return null
}
