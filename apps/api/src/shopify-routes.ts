import { Router } from 'express'
import type { Request } from 'express'
import { AppError, PhaseNotImplementedError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { Logger } from '@profitpilot/logger'
import { installStepFromError } from '@profitpilot/shopify'
import type { ShopifyInstallService, AccessTokenExchange, WebhookEvent, WebhookProcessor } from '@profitpilot/shopify'
import { rawBodyFor } from './security.js'
import { setSessionCookie } from './cookies.js'

export type WebhookRouteDependencies = Readonly<{ processor: WebhookProcessor; storeIdForShop: (shop: string) => Promise<StoreId | null>; handle: (event: WebhookEvent) => Promise<void>; finalize?: (event: WebhookEvent) => Promise<void> }>
export type ShopifyRouteDependencies = Readonly<{ installer: ShopifyInstallService; exchange: AccessTokenExchange; logger?: Logger; webhook?: WebhookRouteDependencies }>

export function createShopifyInstallRouter(dependencies: ShopifyRouteDependencies): Router {
  const router = Router()

  router.get('/install', async (request, response, next) => {
    try {
      const shop = queryString(request.query.shop)
      if (!shop) {
        response.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'shop query parameter is required' } })
        return
      }
      const start = await dependencies.installer.start(shop)
      dependencies.logger?.info('Shopify OAuth install started', { shopDomain: start.shop, requestId: String(response.getHeader('x-request-id') ?? '') })
      response.redirect(302, start.authorizationUrl)
    } catch (error: unknown) {
      next(error)
    }
  })

  router.get('/callback', async (request, response, next) => {
    const callback = callbackQuery(request)
    const rawQuery = rawQueryString(request)
    // Secret-safe HMAC diagnostics on every attempt: if verification fails in
    // production, the log shows the signed parameter set, the per-method
    // computed HMACs vs the received signature, the secret's scheme tag and
    // length, and the raw-vs-parsed host comparison — without exposing the
    // secret, the authorization code, or the CSRF state.
    const diagnostics = dependencies.installer.hmacDiagnostics(callback, rawQuery)
    dependencies.logger?.info('Shopify OAuth HMAC verification attempt', {
      ...diagnostics,
      rawUrl: redactedRawUrl(request),
      requestId: String(response.getHeader('x-request-id') ?? ''),
    })
    try {
      const result = await dependencies.installer.complete(callback, dependencies.exchange, rawQuery)
      const location = dependencies.installer.postInstallRedirect(callback, result.shop, result.storeId)
      // Persist the tenant context so refreshes of the embedded app keep the
      // workspace attached even when the redirect query string is absent.
      setSessionCookie(response, result.storeId)
      dependencies.logger?.info('Shopify OAuth callback completed', { shopDomain: result.shop, storeId: result.storeId, matchedHmacMethod: diagnostics.matchedMethod, requestId: String(response.getHeader('x-request-id') ?? '') })
      // OAuth completes in the merchant's browser; send them into the embedded
      // app inside Shopify admin rather than returning a bare JSON body.
      response.redirect(302, location)
    } catch (error: unknown) {
      // Response bodies stay sanitized; the real diagnostics belong in logs.
      // Never log the raw query: it contains the code, state token, and hmac.
      // diagnostics (and redactedRawUrl) are the safe equivalent.
      dependencies.logger?.error('Shopify OAuth callback failed', {
        step: installStepFromError(error) ?? 'unknown',
        shopDomain: callback.shop ?? '',
        error: error instanceof Error ? error.message : String(error),
        cause: describeCause(error),
        stack: error instanceof Error ? error.stack ?? '' : '',
        hmac: diagnostics,
        requestId: String(response.getHeader('x-request-id') ?? ''),
      })
      next(error)
    }
  })

  router.post('/webhooks', async (request, response, next) => {
    try {
      if (!dependencies.webhook) throw new PhaseNotImplementedError('F7', 'Shopify webhook HTTP handler')
      const shop = requiredHeader(request, 'x-shopify-shop-domain')
      const webhookId = requiredHeader(request, 'x-shopify-webhook-id')
      const topic = requiredHeader(request, 'x-shopify-topic')
      const signature = requiredHeader(request, 'x-shopify-hmac-sha256')
      const rawBody = rawBodyFor(request)
      if (rawBody === null) throw new AppError('VALIDATION_ERROR', 'Webhook body is required', 400)
      const tenant = await dependencies.webhook.storeIdForShop(shop)
      if (!tenant) throw new AppError('NOT_FOUND', 'Shopify store is not registered', 404)
      const event: WebhookEvent = { storeId: tenant, webhookId, topic, rawBody, signature }
      const result = await dependencies.webhook.processor.process(event, async () => dependencies.webhook?.handle(event) ?? Promise.resolve())
      if ((result.status === 'processed' || result.status === 'deduped') && dependencies.webhook.finalize) await dependencies.webhook.finalize(event)
      response.status(result.status === 'failed' ? 500 : result.status === 'retry' ? 202 : 200).json({ ok: result.status !== 'failed', status: result.status, payloadHash: result.payloadHash })
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('HMAC')) { next(new AppError('UNAUTHORIZED', 'Invalid webhook signature', 401)); return }
      next(error)
    }
  })

  return router
}

/**
 * Every query parameter Shopify sent. HMAC verification must cover the exact
 * signed parameter set (code, hmac, host, shop, state, timestamp today), so a
 * fixed whitelist would silently break verification whenever Shopify adds or
 * renames a parameter.
 */
function callbackQuery(request: Request): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.query)) {
    const normalized = queryString(value)
    if (normalized !== null) result[key] = normalized
  }
  return result
}

/**
 * The exact query bytes Shopify sent, taken from the original URL before any
 * middleware parses it. This is what Shopify HMAC-signed, so the "raw"
 * verification method signs it verbatim and is immune to a framework that
 * decodes/re-encodes values differently. Express preserves originalUrl exactly
 * as received by Node's HTTP parser.
 */
function rawQueryString(request: Request): string | undefined {
  const url = request.originalUrl ?? request.url ?? ''
  const queryIndex = url.indexOf('?')
  return queryIndex < 0 ? undefined : url.slice(queryIndex + 1)
}

/**
 * The raw callback URL with the authorization `code` and CSRF `state` masked and
 * the `hmac` truncated to a prefix. Surfaces the on-the-wire structure Shopify
 * sent — parameter order, the host's percent-encoding, and any unexpected
 * parameter — without leaking the secrets a raw query string would expose.
 */
function redactedRawUrl(request: Request): string {
  const url = request.originalUrl ?? request.url ?? ''
  const queryIndex = url.indexOf('?')
  if (queryIndex < 0) return url
  const path = url.slice(0, queryIndex)
  const segments = url.slice(queryIndex + 1).split('&').map((segment) => {
    const eq = segment.indexOf('=')
    if (eq < 0) return segment
    const key = segment.slice(0, eq)
    const value = segment.slice(eq + 1)
    if (key === 'code' || key === 'state') return `${key}=<redacted:${value.length}chars>`
    if (key === 'hmac') return `${key}=${value.slice(0, 12)}…`
    return segment
  })
  return `${path}?${segments.join('&')}`
}

function requiredHeader(request: Request, name: string): string {
  const value = request.header(name)?.trim()
  if (!value) throw new AppError('VALIDATION_ERROR', `${name} header is required`, 400)
  return value
}

function queryString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' ? first : null
  }
  return null
}

function describeCause(error: unknown): string {
  if (!(error instanceof Error)) return ''
  const cause: unknown = error.cause
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  return typeof cause === 'string' ? cause : ''
}
