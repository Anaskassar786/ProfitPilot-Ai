import type { Request, RequestHandler, Response } from 'express'
import type { Logger } from '@profitpilot/logger'
import type { StoreConnection, StoreDirectory } from '@profitpilot/db'
import { verifyEmbeddedRequest } from '@profitpilot/shopify'
import type { OfflineTokenResult, SessionTokenConfig } from '@profitpilot/shopify'
import { missingShopifyScopes } from './app-store-assets.js'
import { setSessionCookie } from './cookies.js'
import { isApiPath } from './web-app.js'

export type EmbeddedTokenExchange = Readonly<{
  hasAccessToken(shop: string): Promise<boolean>
  ensureOfflineAccessToken(shop: string, idToken: string): Promise<OfflineTokenResult>
}>

export type EmbeddedEntryDependencies = Readonly<{
  directory: StoreDirectory
  sessionToken: SessionTokenConfig
  tokenExchange?: EmbeddedTokenExchange
  logger?: Logger
}>

/**
 * Registers the tenant and provisions its offline Admin API token when Shopify
 * loads the embedded app.
 *
 * Under Shopify managed installation — the default for embedded apps, and what
 * this app uses (`embedded = true`, no `use_legacy_install_flow`) — Shopify
 * installs the app and grants scopes WITHOUT ever calling the app's OAuth
 * callback. The first app load therefore performs both managed-install steps:
 *
 *   1. verify the signed `id_token` (or signed query HMAC),
 *   2. upsert the store and set the tenant session cookie, and
 *   3. when the token vault is empty, exchange that `id_token` for a
 *      non-expiring offline access token and persist it through TokenVault.
 *
 * Failures are logged and swallowed so the merchant never gets a blank iframe.
 * `/sync` still returns an explicit reconnect message if provisioning failed.
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

    void registerTenant(dependencies, response, request, identity.shop, identity.method, query.id_token)
      .finally(() => next())
  }
}

async function registerTenant(
  dependencies: EmbeddedEntryDependencies,
  response: Response,
  request: Request,
  shop: string,
  verification: 'session-token' | 'query-hmac',
  idToken: string | undefined,
): Promise<void> {
  let tenant: StoreConnection
  try {
    tenant = await dependencies.directory.upsertByShopDomain(shop)
    setSessionCookie(response, tenant.storeId)
    dependencies.logger?.info('Embedded app load registered tenant', {
      shopDomain: tenant.shopDomain,
      storeId: tenant.storeId,
      verification,
      path: request.path,
      requestId: requestIdFrom(response),
    })
  } catch (error: unknown) {
    dependencies.logger?.error('Embedded app load failed to register tenant', {
      shopDomain: shop,
      verification,
      path: request.path,
      error: errorMessage(error),
      stack: error instanceof Error ? (error.stack ?? '') : '',
      requestId: requestIdFrom(response),
    })
    return
  }

  if (!dependencies.tokenExchange) return
  try {
    const existing = await dependencies.tokenExchange.hasAccessToken(tenant.shopDomain)
    if (existing) {
      dependencies.logger?.info('Shopify offline access token ready', {
        shopDomain: tenant.shopDomain,
        storeId: tenant.storeId,
        source: 'vault',
        requestId: requestIdFrom(response),
      })
      return
    }

    // A query-HMAC proves the shop identity but cannot be used as the RFC 8693
    // subject token. Only the already-verified id_token can be exchanged.
    if (verification !== 'session-token' || !idToken?.trim()) {
      dependencies.logger?.warn('Shopify offline access token is missing and app load has no exchangeable id_token', {
        shopDomain: tenant.shopDomain,
        storeId: tenant.storeId,
        verification,
        requestId: requestIdFrom(response),
      })
      return
    }

    const result = await dependencies.tokenExchange.ensureOfflineAccessToken(tenant.shopDomain, idToken)
    dependencies.logger?.info('Shopify offline access token exchange succeeded', {
      shopDomain: tenant.shopDomain,
      storeId: tenant.storeId,
      accessMode: 'offline',
      source: result.source,
      scopes: result.scopes.join(','),
      requestId: requestIdFrom(response),
    })
    // A grant that predates a scope change (for example an install made before
    // write_discounts was requested) keeps working for reads and then fails
    // with 403 on discount actions. Surface it here instead of at execution.
    const missing = result.scopes.length > 0 ? missingShopifyScopes(result.scopes) : []
    if (missing.length > 0) {
      dependencies.logger?.warn('Shopify installation is missing required access scopes', {
        shopDomain: tenant.shopDomain,
        storeId: tenant.storeId,
        missingScopes: missing.join(','),
        action: 'REINSTALL_TO_GRANT_SCOPES',
        requestId: requestIdFrom(response),
      })
    }
  } catch (error: unknown) {
    // upstreamStatus/upstreamCode are what distinguish "the merchant's id_token
    // expired" from "SHOPIFY_API_SECRET is wrong" from "Shopify is down". They
    // are set by ShopifyTokenExchangeError and never contain a credential.
    dependencies.logger?.error('Shopify offline access token exchange failed', {
      shopDomain: tenant.shopDomain,
      storeId: tenant.storeId,
      error: errorMessage(error),
      upstreamStatus: numberProperty(error, 'upstreamStatus'),
      upstreamCode: stringProperty(error, 'upstreamCode'),
      stack: error instanceof Error ? (error.stack ?? '') : '',
      requestId: requestIdFrom(response),
    })
  }
}

/** Shopify app-load browser navigations only: never assets or API routes. */
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

function requestIdFrom(response: Response): string {
  return String(response.getHeader('x-request-id') ?? '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function numberProperty(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null) return 0
  const property = (value as Record<string, unknown>)[key]
  return typeof property === 'number' ? property : 0
}

function stringProperty(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return ''
  const property = (value as Record<string, unknown>)[key]
  return typeof property === 'string' ? property : ''
}
