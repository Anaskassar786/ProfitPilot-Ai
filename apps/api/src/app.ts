import express, { type Express } from 'express'
import { requestId, success, toAppError } from '@profitpilot/types'
import type { Logger } from '@profitpilot/logger'
import { evaluateReadiness } from './readiness.js'
import type { DependencyCheck } from './readiness.js'

export type ApiDependencies = Readonly<{ readinessChecks: readonly DependencyCheck[]; logger: Logger }>

export function createApi(dependencies: ApiDependencies): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '100kb' }))

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
