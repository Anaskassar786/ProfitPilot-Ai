import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loggerFromEnv } from '@profitpilot/logger'
import { createApi } from './app.js'
import { createF9Bootstrap } from './f9-bootstrap.js'
import { readinessChecksFromEnv } from './readiness.js'
import { runMigrations } from './migrations.js'

const port = Number(process.env.PORT ?? '3000')
const logger = loggerFromEnv(process.env)
const startedAt = Date.now()
const webDistPath = resolve(process.cwd(), process.env.WEB_DIST_PATH?.trim() || 'apps/web/dist')
const webIndexPath = join(webDistPath, 'index.html')

const main = async (): Promise<void> => {
  logger.info('ProfitPilot API starting', {
    entry: 'apps/api/dist/main.js',
    port,
    node: process.version,
    environment: process.env.NODE_ENV ?? 'development',
    pid: process.pid,
  })
  const webDistExists = existsSync(webDistPath)
  const webIndexExists = existsSync(webIndexPath)
  if (!webIndexExists) {
    logger.warn('Web app serving disabled: build output is missing', { webDistPath, exists: webDistExists, indexExists: webIndexExists })
    if (process.env.NODE_ENV === 'production') throw new Error(`Web app build is missing: ${webIndexPath}`)
  }

  const bootstrap = createF9Bootstrap(process.env, logger)
  if (bootstrap && process.env.RUN_MIGRATIONS === 'true') await runMigrations(bootstrap.database)
  const app = bootstrap === null
    ? createApi({ logger, readinessChecks: readinessChecksFromEnv(process.env), webDistPath })
    : createApi({ logger, monitor: bootstrap.f9.monitor, productAnalytics: bootstrap.f9.analytics, readinessChecks: bootstrap.f9.readinessChecks, security: bootstrap.security, legal: bootstrap.legal, shopify: bootstrap.shopify, dataPlane: bootstrap.dataPlane, ai: bootstrap.ai, billing: bootstrap.billing, admin: { ...bootstrap.admin, accessReview: bootstrap.accessReview }, automation: bootstrap.automation, jarvis: bootstrap.f8.jarvis, copilot: bootstrap.f8.copilot, forecasting: bootstrap.f8.forecasting, reports: bootstrap.f8.reports, f9: { controls: bootstrap.f9.controls, ops: bootstrap.f9.ops, stepUp: bootstrap.admin.stepUp }, webDistPath })
  if (webIndexExists) logger.info('Web app serving enabled', { webDistPath, exists: webDistExists, indexExists: webIndexExists })
  const server = app.listen(port, '0.0.0.0', () => logger.info('ProfitPilot API listening', { port, shopifyRoutes: bootstrap !== null, webApp: webIndexExists, startedInMs: Date.now() - startedAt }))
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
