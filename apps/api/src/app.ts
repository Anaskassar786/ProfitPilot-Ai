import express, { type Express } from 'express'
import { requestId, success, toAppError } from '@profitpilot/types'
import type { Logger } from '@profitpilot/logger'
import { evaluateReadiness } from './readiness.js'
import type { DependencyCheck } from './readiness.js'
import { createShopifyInstallRouter } from './shopify-routes.js'
import type { ShopifyRouteDependencies } from './shopify-routes.js'
import { createDataPlaneRouter } from './data-plane-routes.js'
import type { DataPlaneDependencies } from './data-plane-routes.js'
import { createAiRouter } from './ai-routes.js'
import type { AiRouteDependencies } from './ai-routes.js'

export type ApiDependencies = Readonly<{ readinessChecks: readonly DependencyCheck[]; logger: Logger; shopify?: ShopifyRouteDependencies; dataPlane?: DataPlaneDependencies; ai?: AiRouteDependencies }>

export function createApi(dependencies: ApiDependencies): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '100kb' }))
  if (dependencies.shopify) app.use('/shopify', createShopifyInstallRouter(dependencies.shopify))
  if (dependencies.dataPlane) app.use(createDataPlaneRouter(dependencies.dataPlane))
  if (dependencies.ai) app.use(createAiRouter(dependencies.ai))

  app.get('/live', (_request, response) => {
    response.status(200).json({ ok: true, service: 'api', status: 'live' })
  })

  app.get('/ready', async (_request, response) => {
    const readiness = await evaluateReadiness(dependencies.readinessChecks)
    response.status(readiness.ok ? 200 : 503).json(success(readiness, requestId(String(response.getHeader('x-request-id') ?? 'ready'))))
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const appError = toAppError(error)
    dependencies.logger.error(appError.message, { code: appError.code, status: appError.status })
    response.status(appError.status).json({ ok: false, error: appError.toJSON() })
  })

  return app
}
