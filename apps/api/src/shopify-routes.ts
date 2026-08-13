import { Router } from 'express'
import type { Request } from 'express'
import type { ShopifyInstallService, AccessTokenExchange } from '@profitpilot/shopify'

export type ShopifyRouteDependencies = Readonly<{ installer: ShopifyInstallService; exchange: AccessTokenExchange }>

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

function queryString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' ? first : null
  }
  return null
}

