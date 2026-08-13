import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'
import { createF8Bootstrap } from './f8-bootstrap.js'

import { readinessChecksFromEnv } from './readiness.js'

const port = Number(process.env.PORT ?? '3000')
const logger = new Logger()
const bootstrap = createF8Bootstrap(process.env)
const app = bootstrap === null
  ? createApi({ logger, readinessChecks: readinessChecksFromEnv(process.env) })
  : createApi({ logger, readinessChecks: readinessChecksFromEnv(process.env), security: bootstrap.security, legal: bootstrap.legal, shopify: bootstrap.shopify, dataPlane: bootstrap.dataPlane, ai: bootstrap.ai, billing: bootstrap.billing, admin: { ...bootstrap.admin, accessReview: bootstrap.accessReview }, automation: bootstrap.automation, jarvis: bootstrap.f8.jarvis, copilot: bootstrap.f8.copilot, forecasting: bootstrap.f8.forecasting, reports: bootstrap.f8.reports })
const server = app.listen(port, '0.0.0.0', () => logger.info('ProfitPilot API listening', { port, shopifyRoutes: bootstrap !== null }))

const shutdown = (): void => {
  server.close(() => { void bootstrap?.database.close() })
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
