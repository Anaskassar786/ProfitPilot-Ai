import { Router } from 'express'
import type { Request } from 'express'
import { AppError, PhaseNotImplementedError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { Logger } from '@profitpilot/logger'
import { installStepFromError } from '@profitpilot/shopify'
import type { ShopifyInstallService, AccessTokenExchange, WebhookEvent, WebhookProcessor } from '@profitpilot/shopify'
import { rawBodyFor } from './security.js'
import { setSessionCookie } from './cookies.js'

export type StoreLookup = Readonly<{ getByShopDomain(shop: string): Promise<{ storeId: StoreId; shopDomain: string } | null>; get(storeId: StoreId): Promise<{ storeId: StoreId; shopDomain: string } | null> }>

export type WebhookRouteDependencies = Readonly<{ processor: WebhookProcessor; storeIdForShop: (shop: string) => Promise<StoreId | null>; handle: (event: WebhookEvent) => Promise<void> }>
export type ShopifyRouteDependencies = Readonly<{ installer: ShopifyInstallService; exchange: AccessTokenExchange; logger?: Logger; webhook?: WebhookRouteDependencies; directory?: StoreLookup; tokenExchange?: import('@profitpilot/shopify').ShopifyTokenExchangeService }>

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

  /**
   * Diagnostic endpoint that reports the app's installation status for a shop.
   * Useful after an app becomes inaccessible (e.g. 404 in admin sidebar) to
   * verify whether the store is registered and has an access token.
   */
  router.get('/status', async (request, response, next) => {
    try {
      const shop = queryString(request.query.shop)
      const storeId = queryString(request.query.storeId)
      let connection: { storeId: StoreId; shopDomain: string } | null = null
      if (shop) {
        connection = await dependencies.directory?.getByShopDomain(shop) ?? null
      } else if (storeId) {
        connection = await dependencies.directory?.get(storeId as StoreId) ?? null
      }
      const scopesList = parseScopesFromQuery(request.query.scopes)
      const status = {
        registered: connection !== null,
        shopDomain: connection?.shopDomain ?? shop ?? null,
        storeId: connection?.storeId ?? null,
        hasToken: false,
        missingScopes: scopesList.length > 0 ? scopesList.filter((scope) => !request.query.scopes?.toString().includes(scope)) : [],
        installUrl: connection
          ? `https://admin.shopify.com/store/${connection.shopDomain.replace(/\.myshopify\.com$/, '')}/apps/${dependencies.installer['config'].apiKey}`
          : null,
      }
      if (dependencies.tokenExchange && connection) {
        status.hasToken = await dependencies.tokenExchange.hasAccessToken(connection.shopDomain)
      }
      response.status(200).json({ ok: true, status })
    } catch (error: unknown) {
      next(error)
    }
  })

  /**
   * Reinstall endpoint for embedded apps. When the app becomes inaccessible
   * (e.g. 404 in the admin sidebar or "There's no page at this address"),
   * this directs the merchant to the correct managed-install entry point.
   *
   * For embedded apps using managed installation, the correct way to install
   * is via the Partner Dashboard, NOT via a custom install link like
   * `admin.shopify.com/oauth/install_custom_app`.
   *
   * However, this endpoint provides the recoverable OAuth authorize URL for
   * legacy/fallback install flows and diagnostic guidance.
   */
  router.get('/reinstall', async (request, response, next) => {
    try {
      const shop = queryString(request.query.shop)
      const storeId = queryString(request.query.storeId)
      let shopDomain = shop ?? ''
      let registered = false

      if (storeId && !shopDomain) {
        const connection = await dependencies.directory?.get(storeId as StoreId) ?? null
        if (connection) {
          shopDomain = connection.shopDomain
          registered = true
        }
      } else if (shopDomain) {
        const connection = await dependencies.directory?.getByShopDomain(shopDomain) ?? null
        registered = connection !== null
      }

      if (!shopDomain) {
        response.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'shop query parameter is required. Provide your *.myshopify.com domain.',
          },
          recovery: [
            'Go to the Shopify Partner Dashboard → Apps → ProfitPilot → Distribution',
            'Click "Install app" and select your store',
            'The app will appear in your Shopify admin sidebar under "Apps"',
          ],
        })
        return
      }

      const correctAdminUrl = `https://admin.shopify.com/store/${shopDomain.replace(/\.myshopify\.com$/, '')}/apps/${dependencies.installer['config'].apiKey}`
      const partnerDashboardUrl = `https://partners.shopify.com/organizations/apps/${dependencies.installer['config'].apiKey}/distribution`

      response.status(200).json({
        ok: true,
        guidance: {
          registered,
          shop: shopDomain,
          appApiKey: dependencies.installer['config'].apiKey,
          // For managed-install embedded apps, the correct way to install is
          // via the Partner Dashboard. The OAuth URL below is a fallback.
          partnerDashboardUrl,
          correctAppUrlInAdmin: correctAdminUrl,
          steps: [
            `Step 1: If the app shows 404 in admin, go to ${partnerDashboardUrl} and install the app again.`,
            `Step 2: After installation, access the app at ${correctAdminUrl}`,
            'Step 3: If the app still does not appear, try clearing your browser cache and refreshing the Shopify admin.',
            'Note: The URL https://admin.shopify.com/oauth/install_custom_app?client_id=... is NOT the correct way to install embedded apps. It is designed for custom (non-embedded) apps only.',
          ],
        },
      })
    } catch (error: unknown) {
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
function parseScopesFromQuery(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (Array.isArray(value)) return value.flatMap((v) => parseScopesFromQuery(v))
  return []
}

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
