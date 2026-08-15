import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loggerFromEnv } from '@profitpilot/logger'
import { OAUTH_DIAGNOSTICS_VERSION, scopeForEndpoint, shopifyHmacSelfTest } from '@profitpilot/shopify'
import { SYNC_MODULES } from '@profitpilot/sync'
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

  const bootstrap = createF9Bootstrap(process.env, logger)
  if (bootstrap && process.env.RUN_MIGRATIONS === 'true') await runMigrations(bootstrap.database)

  // Validate Shopify scopes at startup: warn about missing scopes for sync
  // modules so the operator knows before merchants report 403 Forbidden.
  const scopeCsv = process.env.SHOPIFY_SCOPES?.trim() ?? ''
  const declaredScopes = scopeCsv.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (scopeCsv) {
    // Map each sync module to its actual API endpoint path for scope lookup.
    const MODULE_TO_ENDPOINT: Readonly<Record<string, string>> = {
      products: '/products',
      orders: '/orders',
      customers: '/customers',
      inventory: '/inventory_levels',
      checkouts: '/checkouts',
      collections: '/collections',
      discounts: '/price_rules',
      transactions: '/transactions',
    }
    const missingScopes: string[] = []
    const foundScopes = new Set<string>()
    for (const module of SYNC_MODULES) {
      const endpoint = MODULE_TO_ENDPOINT[module] ?? `/${module}`
      const requiredScope = scopeForEndpoint(endpoint)
      if (requiredScope) {
        foundScopes.add(requiredScope)
        if (!declaredScopes.includes(requiredScope) && !declaredScopes.includes(requiredScope.replace('read_', 'write_'))) {
          missingScopes.push(requiredScope)
        }
      }
    }
    if (missingScopes.length > 0) {
      logger.warn('SHOPIFY_SCOPES is missing scopes required by sync modules', {
        declared: scopeCsv,
        missing: missingScopes.join(', '),
        recommended: [...new Set([...declaredScopes, ...missingScopes])].join(','),
        impact: 'Sync operations for modules requiring these scopes will receive 403 Forbidden from Shopify',
        knownRequiredScopes: [...foundScopes].join(', '),
      })
    } else {
      logger.info('SHOPIFY_SCOPES validation passed', {
        declared: scopeCsv,
        knownRequiredScopes: [...foundScopes].join(', '),
        moduleCount: SYNC_MODULES.length,
      })
    }
  } else {
    logger.warn('SHOPIFY_SCOPES is not set. Sync and analytics will fail with 403 Forbidden from Shopify.')
  }
  const app = bootstrap === null
    ? createApi({ logger, readinessChecks: readinessChecksFromEnv(process.env), webDistPath })
    : createApi({
      logger,
      monitor: bootstrap.f9.monitor,
      productAnalytics: bootstrap.f9.analytics,
      readinessChecks: bootstrap.f9.readinessChecks,
      security: bootstrap.security,
      legal: bootstrap.legal,
      shopify: { ...bootstrap.shopify, directory: bootstrap.storeDirectory, tokenExchange: bootstrap.tokenExchange },
      session: { directory: bootstrap.storeDirectory, logger },
      embeddedEntry: { directory: bootstrap.storeDirectory, sessionToken: bootstrap.sessionToken, tokenExchange: bootstrap.tokenExchange },
      dataPlane: bootstrap.dataPlane,
      ai: bootstrap.ai,
      billing: bootstrap.billing,
      admin: { ...bootstrap.admin, accessReview: bootstrap.accessReview },
      automation: bootstrap.automation,
      jarvis: bootstrap.f8.jarvis,
      copilot: bootstrap.f8.copilot,
      forecasting: bootstrap.f8.forecasting,
      reports: bootstrap.f8.reports,
      f9: { controls: bootstrap.f9.controls, ops: bootstrap.f9.ops, stepUp: bootstrap.admin.stepUp },
      webDistPath,
    })
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
