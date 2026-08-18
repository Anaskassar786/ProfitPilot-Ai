import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loggerFromEnv } from '@profitpilot/logger'
import { OAUTH_DIAGNOSTICS_VERSION, shopifyHmacSelfTest } from '@profitpilot/shopify'
import { createApi } from './app.js'
import { createStoreCoachBootstrap } from './f10-bootstrap.js'
import { StoreCoachScheduler } from './store-coach-scheduler.js'
import { createExecutiveBootstrap } from './executive-bootstrap.js'
import { readinessChecksFromEnv } from './readiness.js'
import { runMigrations } from './migrations.js'
import { createInsightsHubBootstrap, InsightsHubService, PostgresInsightsHubRepository } from './insights-hub.js'
import { buildStoreSnapshot } from './store-snapshot.js'
import { shouldRunMigrations } from './ai-keys.js'

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
  // Reproduce Shopify's documented OAuth HMAC example at boot. A failure here
  // means the HMAC function itself (or the deploy) is broken — independent of
  // any live callback or secret — and is the fastest way to rule out stale code
  // before chasing a merchant-specific signature mismatch.
  const hmacSelfTest = shopifyHmacSelfTest()
  logger.info('Shopify OAuth HMAC module ready', {
    version: OAUTH_DIAGNOSTICS_VERSION,
    buildTime: '2026-08-14',
    selfTestPassed: hmacSelfTest.passed,
    selfTestComputed: hmacSelfTest.computed,
    selfTestExpected: hmacSelfTest.expected,
  })
  const webDistExists = existsSync(webDistPath)
  const webIndexExists = existsSync(webIndexPath)
  if (!webIndexExists) {
    logger.warn('Web app serving disabled: build output is missing', { webDistPath, exists: webDistExists, indexExists: webIndexExists })
    if (process.env.NODE_ENV === 'production') throw new Error(`Web app build is missing: ${webIndexPath}`)
  }

  const bootstrap = createStoreCoachBootstrap(process.env, logger)
  // Production deploys must apply pending SQL (0022 GrowthIQ, 0023 Store
  // Coach, …) or the new pages 500 with "relation does not exist". Operators
  // can still opt out with RUN_MIGRATIONS=false.
  if (bootstrap && shouldRunMigrations(process.env)) {
    const applied = await runMigrations(bootstrap.database)
    if (applied.length > 0) logger.info('Applied pending database migrations', { applied: applied.join(',') })
    else logger.info('Database schema is up to date')
  }
  const shopify = bootstrap?.shopify.webhook ? { ...bootstrap.shopify, webhook: { ...bootstrap.shopify.webhook, finalize: async (event: Parameters<NonNullable<typeof bootstrap.shopify.webhook>['handle']>[0]) => {
    await bootstrap.shopify.webhook?.finalize?.(event)
    await bootstrap.automation.triggers.handleWebhook(event)
  } } } : bootstrap?.shopify
  const executive = bootstrap ? createExecutiveBootstrap(bootstrap, process.env, logger) : null
  // PatternAI (formerly Insights Hub) runs on its own dedicated OpenRouter key + Nemotron
  // models. When the key is absent the service still works — it degrades to
  // pure deterministic output with no AI narration (never fake content).
  const insights = createInsightsHubBootstrap(process.env)
  const insightsHub = bootstrap === null
    ? undefined
    : {
        service: new InsightsHubService({
          dataset: {
            snapshot: (storeId: import('@profitpilot/types').StoreId) => buildStoreSnapshot(storeId, bootstrap.dataPlane.analytics, bootstrap.database),
            analytics: bootstrap.dataPlane.analytics,
            orders: bootstrap.orders.repository,
          },
          repository: new PostgresInsightsHubRepository(bootstrap.database, logger),
          plan: async (storeId) => (await bootstrap.billing.repository.get(storeId))?.plan ?? 'trial',
          billingState: async (storeId) => (await bootstrap.billing.repository.get(storeId))?.state ?? null,
          narrator: insights.narrator,
          env: insights.env,
          logger,
        }),
        env: insights.env,
      }
  const app = bootstrap === null
    ? createApi({ logger, readinessChecks: readinessChecksFromEnv(process.env), webDistPath })
    : createApi({ logger, monitor: bootstrap.f9.monitor, productAnalytics: bootstrap.f9.analytics, readinessChecks: bootstrap.f9.readinessChecks, security: bootstrap.security, legal: bootstrap.legal, shopify: shopify!, session: { directory: bootstrap.storeDirectory, logger }, embeddedEntry: { directory: bootstrap.storeDirectory, sessionToken: bootstrap.sessionToken, tokenExchange: bootstrap.tokenExchange }, dataPlane: bootstrap.dataPlane, analytics: bootstrap.analyticsInsights, orders: bootstrap.orders, customers: bootstrap.customers, inventory: bootstrap.inventory, ai: bootstrap.ai, billing: bootstrap.billing, admin: { ...bootstrap.admin, accessReview: bootstrap.accessReview }, automation: bootstrap.automation, jarvis: bootstrap.f8.jarvis, copilot: bootstrap.f8.copilot, forecasting: bootstrap.f8.forecasting, reports: bootstrap.f8.reports, aiCommand: bootstrap.aiCommand, storeCoach: { service: bootstrap.storeCoach.service }, ...(executive?.enabled ? { executive: executive.routes } : {}), ...(insightsHub ? { insightsHub } : {}), f9: { controls: bootstrap.f9.controls, ops: bootstrap.f9.ops, stepUp: bootstrap.admin.stepUp }, webDistPath })
  if (webIndexExists) logger.info('Web app serving enabled', { webDistPath, exists: webDistExists, indexExists: webIndexExists })
  if (executive?.enabled) logger.info('GrowthIQ module enabled', { models: executive.routes.costSummary ? 'configured' : 'default' })
  const server = app.listen(port, '0.0.0.0', () => logger.info('ProfitPilot API listening', { port, shopifyRoutes: bootstrap !== null, webApp: webIndexExists, startedInMs: Date.now() - startedAt }))
  const automationTick = bootstrap ? setInterval(() => {
    void Promise.all([bootstrap.automation.triggers.tickSchedules(), bootstrap.automation.triggers.resumeWaits(), bootstrap.automation.triggers.purgeExpiredData()]).catch((error: unknown) => logger.error('Automation scheduler tick failed', { error: error instanceof Error ? error.message : String(error) }))
  }, 60_000) : null
  // PR #48: Store Coach scheduler (daily huddles, Sunday digests, badge sweep).
  const coachScheduler = bootstrap ? new StoreCoachScheduler({ database: bootstrap.database, service: bootstrap.storeCoach.service, logger }) : null
  const coachTick = coachScheduler ? setInterval(() => {
    void coachScheduler.tick().catch((error: unknown) => logger.error('Store Coach scheduler tick failed', { error: error instanceof Error ? error.message : String(error) }))
  }, 3_600_000) : null
  // PR #49: hourly check for stores whose monthly board-report day has
  // arrived (per-store report_generation_day, 1-28). Cheap when nothing is
  // due; generation + Brevo delivery reuse the same service as the API.
  const executiveTick = executive?.enabled ? setInterval(() => {
    void executive.tick().then((result) => {
      if (result.generated > 0 || result.failed > 0) logger.info('GrowthIQ monthly tick', { ...result })
    }).catch((error: unknown) => logger.error('GrowthIQ monthly tick failed', { error: error instanceof Error ? error.message : String(error) }))
  }, 3_600_000) : null
  const shutdown = (): void => {
    if (automationTick) clearInterval(automationTick)
    if (coachTick) clearInterval(coachTick)
    if (executiveTick) clearInterval(executiveTick)
    server.close(() => { void bootstrap?.database.close() })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

void main().catch((error: unknown) => {
  logger.error('ProfitPilot API failed to start', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
