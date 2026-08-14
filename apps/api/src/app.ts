import express, { type Express } from 'express'
import { requestId, success } from '@profitpilot/types'
import type { Logger } from '@profitpilot/logger'
import type { ErrorMonitor } from '@profitpilot/monitoring'
import { createLegalRouter } from './legal-routes.js'
import type { LegalRouteDependencies } from './legal-routes.js'
import { EndpointRateLimiter, captureRawBody, createSecurityRouter, authenticationMiddleware, corsMiddleware, csrfMiddleware, defaultSecurityOptions, getAuthContext, normalizeRequestError, rateLimitMiddleware, requestIdMiddleware, securityHeadersMiddleware, tenantContextMiddleware, tenantInputGuard } from './security.js'
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
import { launchControlMiddleware, createF9Router } from './f9.js'
import type { F9RouteDependencies } from './f9.js'
import { createF8Router } from './f8-routes.js'
import type { CopilotRouteDependencies, ForecastRouteDependencies, JarvisRouteDependencies, ReportRouteDependencies } from './f8-routes.js'

export type ApiDependencies = Readonly<{ readinessChecks: readonly DependencyCheck[]; logger: Logger; monitor?: ErrorMonitor; security?: SecurityOptions; legal?: LegalRouteDependencies; shopify?: ShopifyRouteDependencies; dataPlane?: DataPlaneDependencies; ai?: AiRouteDependencies; billing?: BillingRouteDependencies; admin?: AdminRouteDependencies; automation?: AutomationRouteDependencies; jarvis?: JarvisRouteDependencies; copilot?: CopilotRouteDependencies; forecasting?: ForecastRouteDependencies; reports?: ReportRouteDependencies; f9?: F9RouteDependencies }>

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
  app.use(launchControlMiddleware(dependencies.f9?.controls ?? null))
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
  if (dependencies.f9) app.use(createF9Router(dependencies.f9))
  if (dependencies.automation) app.use(createAutomationRouter(dependencies.automation))
  const f8Dependencies = { ...(dependencies.jarvis ? { jarvis: dependencies.jarvis } : {}), ...(dependencies.copilot ? { copilot: dependencies.copilot } : {}), ...(dependencies.forecasting ? { forecasting: dependencies.forecasting } : {}), ...(dependencies.reports ? { reports: dependencies.reports } : {}) }
  app.use(createF8Router(f8Dependencies))

  app.get('/live', (_request, response) => {
    response.status(200).json({ ok: true, service: 'api', status: 'live' })
  })

  app.get('/health', (_request, response) => {
    response.status(200).json({ ok: true, service: 'api', status: 'healthy' })
  })

  app.get('/ready', async (_request, response) => {
    const readiness = await evaluateReadiness(dependencies.readinessChecks)
    response.status(readiness.ok ? 200 : 503).json(success(readiness, requestId(String(response.getHeader('x-request-id') ?? 'ready'))))
  })

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const appError = normalizeRequestError(error)
    dependencies.logger.error(appError.expose ? appError.message : 'Internal server error', { code: appError.code, status: appError.status })
    if (dependencies.monitor) dependencies.monitor.capture(appError, { path: request.path, method: request.method, errorCode: appError.code, storeId: getAuthContext(request)?.claims.storeId ?? String(request.query.storeId ?? request.query.shopId ?? '') })
    response.status(appError.status).json({ ok: false, error: appError.toJSON() })
  })

  return app
}
