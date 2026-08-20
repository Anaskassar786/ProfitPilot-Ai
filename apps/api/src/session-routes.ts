import { Router } from 'express'
import type { Request } from 'express'
import { requestId, storeId, success } from '@profitpilot/types'
import type { StoreDirectory } from '@profitpilot/db'
import { verifyShopifySessionToken } from '@profitpilot/shopify'
import type { SessionTokenConfig } from '@profitpilot/shopify'
import { SESSION_COOKIE_NAME, parseCookies } from './cookies.js'

export type SessionRouteDependencies = Readonly<{ directory: StoreDirectory; sessionToken?: SessionTokenConfig; logger?: import('@profitpilot/logger').Logger }>

export type SessionContext = Readonly<{ storeId: string | null; shop: string | null }>

/**
 * Returns the active tenant context for the embedded dashboard. The context is
 * resolved in order of specificity:
 *   1. a verified Shopify session token from the `Authorization: Bearer`
 *      header (the embedded primary path — works with cookies blocked), then
 *   2. the session cookie set at OAuth time (survives refreshes), then
 *   3. the `shop` query parameter Shopify appends to the app URL.
 * All three resolve through the store directory, so the single source of
 * truth stays the `stores` row rather than any client-supplied value.
 */
export function createSessionRouter(dependencies: SessionRouteDependencies): Router {
  const router = Router()
  router.get('/session/context', async (request, response, next) => {
    try {
      const context = await resolveContext(dependencies.directory, dependencies.sessionToken, request)
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
      }
      response.status(200).json(success(context, requestId(String(response.getHeader('x-request-id') ?? 'session'))))
    } catch (error: unknown) {
      next(error)
    }
  })
  return router
}

async function resolveContext(directory: StoreDirectory, sessionToken: SessionTokenConfig | undefined, request: Request): Promise<SessionContext> {
  // 1. Embedded primary path: the App Bridge session token the fetch wrapper
  //    attaches as a Bearer header. Verified, never trusted blind.
  const bearer = bearerToken(request)
  if (bearer && sessionToken) {
    const shopClaims = verifyShopifySessionToken(bearer, sessionToken)
    if (shopClaims) {
      const connection = await directory.getByShopDomain(shopClaims.shop)
      if (connection) return { storeId: connection.storeId, shop: connection.shopDomain }
    }
  }
  // 2. Session cookie fallback for non-embedded / local dev.
  const cookies = parseCookies(request.header('cookie'))
  const cookieStoreId = cookies[SESSION_COOKIE_NAME]?.trim() ?? ''
  if (cookieStoreId) {
    const connection = await directory.get(storeId(cookieStoreId))
    if (connection) return { storeId: connection.storeId, shop: connection.shopDomain }
  }
  // 3. Signed-at-install `shop` query parameter.
  const shop = queryString(request.query.shop)
  if (shop) {
    const connection = await directory.getByShopDomain(shop)
    if (connection) return { storeId: connection.storeId, shop: connection.shopDomain }
  }
  return { storeId: null, shop: null }
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
