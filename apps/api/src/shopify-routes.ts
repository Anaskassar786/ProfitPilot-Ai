import { Router } from 'express'
import type { Request } from 'express'
import { AppError, PhaseNotImplementedError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { ShopifyInstallService, AccessTokenExchange, WebhookEvent, WebhookProcessor } from '@profitpilot/shopify'
import { rawBodyFor } from './security.js'

export type WebhookRouteDependencies = Readonly<{ processor: WebhookProcessor; storeIdForShop: (shop: string) => Promise<StoreId | null>; handle: (event: WebhookEvent) => Promise<void> }>
export type ShopifyRouteDependencies = Readonly<{ installer: ShopifyInstallService; exchange: AccessTokenExchange; webhook?: WebhookRouteDependencies }>

export function createShopifyInstallRouter(dependencies: ShopifyRouteDependencies): Router {
  const router = Router()

  router.get('/install', (request, response) => {
    const shop = queryString(request.query.shop)
    if (!shop) {
      response.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'shop query parameter is required' } })
      return
    }
    const start = dependencies.installer.start(shop)
    response.redirect(302, start.authorizationUrl)
  })

  router.get('/callback', async (request, response, next) => {
    try {
      const callback = callbackQuery(request)
      await dependencies.installer.complete(callback, dependencies.exchange)
      response.status(200).json({ ok: true, shop: callback.shop, installed: true })
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

function callbackQuery(request: Request): Record<string, string> {
  const keys = ['shop', 'state', 'code', 'hmac', 'timestamp', 'host']
  const result: Record<string, string> = {}
  for (const key of keys) {
    const value = queryString(request.query[key])
    if (value !== null) result[key] = value
  }
  return result
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
