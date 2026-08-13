import express, { type Express } from 'express'
import { requestId, success } from '@profitpilot/types'
import type { Logger } from '@profitpilot/logger'
import { createLegalRouter } from './legal-routes.js'
import type { LegalRouteDependencies } from './legal-routes.js'
import { EndpointRateLimiter, captureRawBody, createSecurityRouter, authenticationMiddleware, corsMiddleware, csrfMiddleware, defaultSecurityOptions, normalizeRequestError, rateLimitMiddleware, requestIdMiddleware, securityHeadersMiddleware, tenantContextMiddleware, tenantInputGuard } from './security.js'
import type { SecurityOptions } from './security.js'
import { evaluateReadiness } from './readiness.js'
import type { DependencyCheck } from './readiness.js'
import { createShopifyInstallRouter } from './shopify-routes.js'
import type { ShopifyRouteDependencies } from './shopify-routes.js'
import { createDataPlaneRouter } from './data-plane-routes.js'
import type { DataPlaneDependencies } from './data-plane-routes.js'
import { createAiRouter } from './ai-routes.js'
import type { AiRouteDependencies } from './ai-routes.js'
import { createBillingRouter } from './billing-routes.js'
import type { BillingRouteDependencies } from './billing-routes.js'
import { createAdminRouter } from './admin-routes.js'
import type { AdminRouteDependencies } from './admin-routes.js'
import { createAutomationRouter } from './automation-routes.js'
import type { AutomationRouteDependencies } from './automation-routes.js'

export type ApiDependencies = Readonly<{ readinessChecks: readonly DependencyCheck[]; logger: Logger; security?: SecurityOptions; legal?: LegalRouteDependencies; shopify?: ShopifyRouteDependencies; dataPlane?: DataPlaneDependencies; ai?: AiRouteDependencies; billing?: BillingRouteDependencies; admin?: AdminRouteDependencies; automation?: AutomationRouteDependencies }>

export function createApi(dependencies: ApiDependencies): Express {
  const app = express()
  const security = dependencies.security ?? defaultSecurityOptions()
  app.disable('x-powered-by')
  app.use(requestIdMiddleware())
  app.use((request, response, next) => {
    const startedAt = Date.now()
    response.once('finish', () => dependencies.logger.info('HTTP request', { method: request.method, path: request.path, status: response.statusCode, durationMs: Date.now() - startedAt, requestId: String(response.getHeader('x-request-id') ?? '') }))
    next()
  })
  app.use(securityHeadersMiddleware(security.environment))
  app.use(corsMiddleware(security.allowedOrigins))
  app.use(rateLimitMiddleware(security.rateLimiter ?? new EndpointRateLimiter()))
  app.use(express.json({ limit: '100kb', verify: (request, _response, body) => captureRawBody(request as express.Request, body) }))
  app.use(tenantInputGuard())
  app.use(authenticationMiddleware(security))
  app.use(tenantContextMiddleware(security.requireAuthentication))
  app.use(csrfMiddleware(security.csrfSecret))
  app.use(createSecurityRouter({ environment: security.environment, csrfSecret: security.csrfSecret }))
  if (dependencies.legal) app.use(createLegalRouter(dependencies.legal))
  if (dependencies.shopify) app.use('/shopify', createShopifyInstallRouter(dependencies.shopify))
  if (dependencies.dataPlane) app.use(createDataPlaneRouter(dependencies.dataPlane))
  if (dependencies.ai) app.use(createAiRouter(dependencies.ai))
  if (dependencies.billing) app.use(createBillingRouter(dependencies.billing))
  if (dependencies.admin) app.use(createAdminRouter(dependencies.admin))
  if (dependencies.automation) app.use(createAutomationRouter(dependencies.automation))

  app.get('/live', (_request, response) => {
    response.status(200).json({ ok: true, service: 'api', status: 'live' })
  })

  app.get('/ready', async (_request, response) => {
    const readiness = await evaluateReadiness(dependencies.readinessChecks)
    response.status(readiness.ok ? 200 : 503).json(success(readiness, requestId(String(response.getHeader('x-request-id') ?? 'ready'))))
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const appError = normalizeRequestError(error)
    dependencies.logger.error(appError.expose ? appError.message : 'Internal server error', { code: appError.code, status: appError.status })
    response.status(appError.status).json({ ok: false, error: appError.toJSON() })
  })

  return app
}
