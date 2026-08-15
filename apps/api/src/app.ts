import express, { type Express, type RequestHandler } from 'express'
import { requestId, success } from '@profitpilot/types'
import type { Logger } from '@profitpilot/logger'
import type { ErrorMonitor, ProductAnalytics } from '@profitpilot/monitoring'
import { createLegalRouter } from './legal-routes.js'
import type { LegalRouteDependencies } from './legal-routes.js'
import { EndpointRateLimiter, captureRawBody, createSecurityRouter, authenticationMiddleware, corsMiddleware, csrfMiddleware, defaultSecurityOptions, getAuthContext, normalizeRequestError, rateLimitMiddleware, requestIdMiddleware, securityHeadersMiddleware, tenantContextMiddleware, tenantInputGuard } from './security.js'
import type { SecurityOptions } from './security.js'
import { evaluateReadiness } from './readiness.js'
import type { DependencyCheck } from './readiness.js'
import { createShopifyInstallRouter } from './shopify-routes.js'
import type { ShopifyRouteDependencies } from './shopify-routes.js'
import { createSessionRouter } from './session-routes.js'
import type { SessionRouteDependencies } from './session-routes.js'
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
import { isApiPath, mountWebApp } from './web-app.js'

export type ApiDependencies = Readonly<{ readinessChecks: readonly DependencyCheck[]; logger: Logger; monitor?: ErrorMonitor; productAnalytics?: ProductAnalytics; security?: SecurityOptions; legal?: LegalRouteDependencies; shopify?: ShopifyRouteDependencies; session?: SessionRouteDependencies; dataPlane?: DataPlaneDependencies; ai?: AiRouteDependencies; billing?: BillingRouteDependencies; admin?: AdminRouteDependencies; automation?: AutomationRouteDependencies; jarvis?: JarvisRouteDependencies; copilot?: CopilotRouteDependencies; forecasting?: ForecastRouteDependencies; reports?: ReportRouteDependencies; f9?: F9RouteDependencies; webDistPath?: string }>

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

  // Headers run first for every response. Web responses replace the API-only
  // frame policy below with Shopify's frame-ancestors allowlist.
  app.use(securityHeadersMiddleware(security.environment))
  app.use(corsMiddleware(security.allowedOrigins))
  app.use(rateLimitMiddleware(security.rateLimiter ?? new EndpointRateLimiter()))

  // Keep API parsing/authentication ahead of API routes without applying it to
  // browser navigation. In particular, a Shopify SPA URL containing storeId
  // must still be able to reach index.html before an API session is created.
  app.use(apiOnly(express.json({ limit: '100kb', verify: (request, _response, body) => captureRawBody(request as express.Request, body) })))
  app.use(apiOnly(launchControlMiddleware(dependencies.f9?.controls ?? null)))
  app.use(apiOnly(tenantInputGuard()))
  app.use(apiOnly(authenticationMiddleware(security)))
  app.use(apiOnly(tenantContextMiddleware(security.requireAuthentication)))
  app.use(apiOnly(csrfMiddleware(security.csrfSecret)))

  // API routes must be registered before the static server and SPA fallback so
  // neither a real endpoint nor an unknown API URL can return index.html.
  app.use(createSecurityRouter({ environment: security.environment, csrfSecret: security.csrfSecret }))
  if (dependencies.legal) app.use(createLegalRouter(dependencies.legal))
  if (dependencies.shopify) app.use('/shopify', createShopifyInstallRouter({ ...dependencies.shopify, logger: dependencies.logger }))
  if (dependencies.session) app.use(createSessionRouter(dependencies.session))
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

  // Express 5 no longer accepts app.get('*'). A terminal app.use handler is the
  // equivalent safe SPA fallback and mountWebApp restricts it to GET/HEAD web
  // navigation only.
  mountWebApp(app, dependencies.webDistPath)

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const appError = normalizeRequestError(error)
    // The HTTP response stays sanitized, but production logs must carry the
    // real failure: previously everything collapsed into "INTERNAL_ERROR {}
    // context.status: 500", which made the OAuth callback failure undebuggable.
    dependencies.logger.error(appError.expose ? appError.message : 'Internal server error', {
      code: appError.code,
      status: appError.status,
      internalMessage: appError.message,
      step: typeof appError.details.step === 'string' ? appError.details.step : '',
      stack: appError.stack ?? '',
      cause: describeCauseChains(appError),
      method: request.method,
      path: request.path,
      requestId: String(response.getHeader('x-request-id') ?? ''),
    })
    const storeId = getAuthContext(request)?.claims.storeId ?? String(request.query.storeId ?? request.query.shopId ?? '')
    if (dependencies.monitor) dependencies.monitor.capture(appError, { path: request.path, method: request.method, errorCode: appError.code, storeId })
    dependencies.productAnalytics?.capture('api_error', { path: request.path, method: request.method, errorCode: appError.code, storeId })
    response.status(appError.status).json({ ok: false, error: appError.toJSON() })
  })

  return app
}

function apiOnly(handler: RequestHandler): RequestHandler {
  return (request, response, next): void => {
    if (!isApiPath(request.path)) {
      next()
      return
    }
    void handler(request, response, next)
  }
}

function describeCauseChains(error: Error): string {
  const chain: string[] = []
  let current: unknown = error.cause
  while (current instanceof Error && chain.length < 3) {
    chain.push(`${current.name}: ${current.message}`)
    current = current.cause
  }
  return chain.join(' <- ')
}
