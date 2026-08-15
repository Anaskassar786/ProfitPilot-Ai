import type { Request, RequestHandler } from 'express'
import type { Logger } from '@profitpilot/logger'
import type { StoreDirectory } from '@profitpilot/db'
import { verifyEmbeddedRequest } from '@profitpilot/shopify'
import type { SessionTokenConfig } from '@profitpilot/shopify'
import { setSessionCookie } from './cookies.js'
import { isApiPath } from './web-app.js'

export type EmbeddedEntryDependencies = Readonly<{
  directory: StoreDirectory
  sessionToken: SessionTokenConfig
  logger?: Logger
}>

/**
 * Registers the tenant when Shopify loads the embedded app.
 *
 * Under Shopify managed installation — the default for embedded apps, and what
 * this app uses (`embedded = true`, no `use_legacy_install_flow`) — Shopify
 * installs the app and grants scopes WITHOUT ever calling the app's OAuth
 * callback. The first and only time the app hears about the install is when
 * Shopify loads the app URL inside the admin iframe with `shop`, `host`,
 * `hmac`, and a signed `id_token` session token.
 *
 * That made the previous design fail silently in production: `stores` rows were
 * only ever written by `/shopify/callback`, which Shopify no longer invokes, so
 * `upsertByShopDomain()` never ran, no session cookie was ever set, and
 * `/session/context` correctly reported `{storeId: null, shop: null}` forever.
 *
 * This middleware moves tenant registration onto the app-load request itself:
 *   1. verify the request really came from Shopify (session token or HMAC —
 *      both require the app secret; the bare `shop` param is never trusted),
 *   2. upsert the `stores` row so the tenant exists, and
 *   3. set the session cookie so later same-site XHRs resolve the tenant even
 *      when the query string is gone (e.g. after an in-app navigation).
 *
 * Failures are logged and swallowed: a registration problem must not turn the
 * merchant's app load into a blank error page. The dashboard degrades to the
 * "no store context" banner exactly as it does today.
 */
export function embeddedEntryMiddleware(dependencies: EmbeddedEntryDependencies): RequestHandler {
  return (request, response, next): void => {
    if (!isEmbeddedNavigation(request)) {
      next()
      return
    }
    const query = queryRecord(request)
    const identity = verifyEmbeddedRequest(query, dependencies.sessionToken, rawQueryString(request))
    if (!identity) {
      next()
      return
    }
    void dependencies.directory
      .upsertByShopDomain(identity.shop)
      .then((tenant) => {
        setSessionCookie(response, tenant.storeId)
        dependencies.logger?.info('Embedded app load registered tenant', {
          shopDomain: tenant.shopDomain,
          storeId: tenant.storeId,
          verification: identity.method,
          path: request.path,
          requestId: String(response.getHeader('x-request-id') ?? ''),
        })
      })
      .catch((error: unknown) => {
        // Previously an upsert failure here would have been invisible. Log the
        // real error so a broken migration or permission issue is diagnosable
        // from the logs instead of presenting as a silent null context.
        dependencies.logger?.error('Embedded app load failed to register tenant', {
          shopDomain: identity.shop,
          verification: identity.method,
          path: request.path,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? (error.stack ?? '') : '',
          requestId: String(response.getHeader('x-request-id') ?? ''),
        })
      })
      .finally(() => next())
  }
}

/**
 * True for the browser navigations Shopify uses to load the embedded app: a
 * GET/HEAD for an SPA document (no file extension, not an API path).
 */
function isEmbeddedNavigation(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (isApiPath(request.path)) return false
  return !/\.[a-zA-Z0-9]+$/.test(request.path)
}

function queryRecord(request: Request): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.query)) {
    if (typeof value === 'string') result[key] = value
    else if (Array.isArray(value) && typeof value[0] === 'string') result[key] = value[0]
  }
  return result
}

function rawQueryString(request: Request): string | undefined {
  const url = request.originalUrl ?? request.url ?? ''
  const index = url.indexOf('?')
  return index < 0 ? undefined : url.slice(index + 1)
}
