import { loggerFromEnv } from '@profitpilot/logger'
import { createApi } from './app.js'
import { createF9Bootstrap } from './f9-bootstrap.js'
import { readinessChecksFromEnv } from './readiness.js'
import { runMigrations } from './migrations.js'

const port = Number(process.env.PORT ?? '3000')
const logger = loggerFromEnv(process.env)
const startedAt = Date.now()

const main = async (): Promise<void> => {
  logger.info('ProfitPilot API starting', {
    entry: 'apps/api/dist/main.js',
    port,
    node: process.version,
    environment: process.env.NODE_ENV ?? 'development',
    pid: process.pid,
  })
  const bootstrap = createF9Bootstrap(process.env, logger)
  if (bootstrap && process.env.RUN_MIGRATIONS === 'true') await runMigrations(bootstrap.database)
  const app = bootstrap === null
    ? createApi({ logger, readinessChecks: readinessChecksFromEnv(process.env) })
    : createApi({ logger, monitor: bootstrap.f9.monitor, productAnalytics: bootstrap.f9.analytics, readinessChecks: bootstrap.f9.readinessChecks, security: bootstrap.security, legal: bootstrap.legal, shopify: bootstrap.shopify, dataPlane: bootstrap.dataPlane, ai: bootstrap.ai, billing: bootstrap.billing, admin: { ...bootstrap.admin, accessReview: bootstrap.accessReview }, automation: bootstrap.automation, jarvis: bootstrap.f8.jarvis, copilot: bootstrap.f8.copilot, forecasting: bootstrap.f8.forecasting, reports: bootstrap.f8.reports, f9: { controls: bootstrap.f9.controls, ops: bootstrap.f9.ops, stepUp: bootstrap.admin.stepUp } })
  const server = app.listen(port, '0.0.0.0', () => logger.info('ProfitPilot API listening', { port, shopifyRoutes: bootstrap !== null, startedInMs: Date.now() - startedAt }))
  const shutdown = (): void => {
    server.close(() => { void bootstrap?.database.close() })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

void main().catch((error: unknown) => {
  logger.error('ProfitPilot API failed to start', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
