/**
 * GrowthIQ (formerly "AI Executive") — bootstrap.
 *
 * Assembles the GrowthIQ module from environment configuration and the F9
 * bootstrap: its own OpenRouter client (reusing the shared STORE_COACH_API_KEY
 * with the AI_EXECUTIVE model pair), Postgres repositories, the deterministic
 * snapshot pipeline, plan resolution, the `billing_usage` meter, Brevo SMTP
 * delivery, and the investor-PDF store. Also exposes the monthly report tick
 * that `main.ts` runs on the API schedule.
 */
import { OpenRouterClient } from '@profitpilot/ai'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { QueryResultRow } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import type { Logger } from '@profitpilot/logger'
import { createBrevoMailer } from '@profitpilot/automation'
import type { EmailTransport } from '@profitpilot/automation'
import { PostgresExecutiveRepository } from './executive-repository.js'
import { createExecutiveAiService } from './executive-ai.js'
import type { ExecutiveAiService } from './executive-ai.js'
import { buildStoreSnapshot } from './store-snapshot.js'
import { runMonthlyReportTick } from './executive-service.js'
import type { ExecutiveContext, ExecutiveUsageMeter, MonthlyTickResult } from './executive-service.js'
import type { ExecutiveRouteDependencies } from './executive-routes.js'
import { createExecutiveEmailDelivery } from './executive-email.js'
import type { ExecutiveEmailDelivery } from './executive-email.js'
import { FileExecutivePdfStore, InMemoryExecutivePdfStore } from './executive-pdf.js'
import type { ExecutivePdfStore } from './executive-pdf.js'
import type { F9Bootstrap } from './f9-bootstrap.js'
import { resolveApiKeys } from './ai-keys.js'

export type ExecutiveBootstrap = Readonly<{
  routes: ExecutiveRouteDependencies
  tick: () => Promise<MonthlyTickResult>
  enabled: boolean
}>

type PlanRow = QueryResultRow & { plan: string }

function planResolver(database: import('@profitpilot/db').SqlExecutor): (storeId: StoreId) => Promise<PlanTier> {
  return async (storeId: StoreId): Promise<PlanTier> => {
    const record = await withTenantContext(database, storeId, async (client) => {
      const result = await client.query<PlanRow>('SELECT plan FROM billing_subscriptions WHERE shop_id = $1 LIMIT 1', [storeId])
      return result.rows[0] ?? null
    }).catch(() => null)
    const tier = record?.plan
    return tier === 'start' || tier === 'growth' || tier === 'commander' ? tier : 'trial'
  }
}

function usageMeter(database: import('@profitpilot/db').SqlExecutor): ExecutiveUsageMeter {
  return {
    current: async (storeId: StoreId, feature: string): Promise<number> => withTenantContext(database, storeId, async (client) => {
      const result = await client.query<{ used: string | number }>(
        "SELECT used FROM billing_usage WHERE shop_id = $1 AND feature = $2 AND period_start = date_trunc('month', now())::date",
        [storeId, feature],
      )
      return Number(result.rows[0]?.used ?? 0)
    }),
    add: async (storeId: StoreId, feature: string, count: number): Promise<void> => withTenantContext(database, storeId, async (client) => {
      if (count <= 0) return
      await client.query(
        `INSERT INTO billing_usage (shop_id, feature, period_start, used) VALUES ($1, $2, date_trunc('month', now())::date, $3)
         ON CONFLICT (shop_id, feature, period_start) DO UPDATE SET used = billing_usage.used + $3`,
        [storeId, feature, count],
      )
    }),
  }
}

export function createExecutiveBootstrap(f9: F9Bootstrap, env: Readonly<Record<string, string | undefined>>, logger: Logger): ExecutiveBootstrap {
  const enabled = env.AI_EXECUTIVE_ENABLED?.trim() !== 'false'
  const database = f9.database
  const repository = new PostgresExecutiveRepository(database)
  const resolvedKeys = resolveApiKeys(env)
  const provider = new OpenRouterClient({
    keys: resolvedKeys.keys,
    models: [env.AI_EXECUTIVE_MODEL_PRIMARY ?? 'nvidia/nemotron-3-ultra-550b-a55b:free', env.AI_EXECUTIVE_MODEL_FALLBACK ?? 'nvidia/nemotron-3-super-120b-a12b:free'].filter((model): model is string => typeof model === 'string' && model.trim().length > 0),
    timeoutMs: 60_000,
    maxRetries: 1,
    temperature: 0.3,
    maxTokens: 1_400,
  })
  const ai: ExecutiveAiService = createExecutiveAiService(provider, env.AI_EXECUTIVE_MODEL_PRIMARY ?? null, env.AI_EXECUTIVE_MODEL_FALLBACK ?? null)

  let mailTransport: EmailTransport | null = null
  try {
    if (env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASSWORD?.trim()) mailTransport = createBrevoMailer(env)
  } catch { mailTransport = null }
  const email: ExecutiveEmailDelivery = createExecutiveEmailDelivery({
    transport: mailTransport,
    from: env.SMTP_FROM?.trim() || 'reports@profitpilot.example',
    fromName: env.SMTP_FROM_NAME?.trim() || 'ProfitPilot GrowthIQ',
  })

  const pdfEnabled = env.AI_EXECUTIVE_PDF_ENABLED?.trim() !== 'false'
  const pdfDirectory = env.AI_EXECUTIVE_PDF_DIR?.trim()
  const pdfStore: ExecutivePdfStore = pdfEnabled && pdfDirectory ? new FileExecutivePdfStore(pdfDirectory) : new InMemoryExecutivePdfStore()

  const context: ExecutiveContext = {
    repository,
    snapshot: (storeId: StoreId) => buildStoreSnapshot(storeId, f9.dataPlane.analytics, database),
    analytics: (storeId: StoreId) => f9.dataPlane.analytics.read(storeId),
    catalog: (storeId: StoreId) => f9.dataPlane.analytics.readCatalog(storeId),
    plan: planResolver(database),
    usage: usageMeter(database),
    ai,
    email,
    pdf: { enabled: pdfEnabled, store: pdfStore, whiteLabel: () => ({ brandName: null, logoText: null, primaryColor: null, footerText: null }) },
    shopName: async (storeId: StoreId) => (await f9.storeDirectory.get(storeId))?.shopDomain ?? null,
    appUrl: () => env.APP_URL?.trim() || 'http://localhost:3000',
    recordCost: async () => undefined,
    now: () => Date.now(),
  }

  const routes: ExecutiveRouteDependencies = {
    ...context,
    rateLimitPerStore: numberEnv(env, 'AI_EXECUTIVE_RATE_LIMIT_PER_STORE', 20),
    costSummary: async (storeId: StoreId) => {
      const summary = await f9.ai.costs.summary(storeId)
      const [reportsUsed, scenariosUsed] = await Promise.all([
        context.usage.current(storeId, 'ai_executive_reports_month'),
        context.usage.current(storeId, 'ai_executive_scenarios_month'),
      ])
      return {
        summary: { day: summary.day, microDollars: summary.microDollars, capMicroDollars: summary.capMicroDollars, calls: summary.calls },
        executiveCalls: reportsUsed + scenariosUsed,
        models: [env.AI_EXECUTIVE_MODEL_PRIMARY ?? 'nvidia/nemotron-3-ultra-550b-a55b:free', env.AI_EXECUTIVE_MODEL_FALLBACK ?? 'nvidia/nemotron-3-super-120b-a12b:free'].filter((model): model is string => typeof model === 'string' && model.trim().length > 0),
        budgetUsd: numberEnv(env, 'AI_EXECUTIVE_DAILY_BUDGET_USD', 0),
      }
    },
  }

  const tick = async (): Promise<MonthlyTickResult> => runMonthlyReportTick(context, logger)
  logger.info('GrowthIQ AI provider', {
    configured: provider.configured,
    keySource: resolvedKeys.source ?? 'none',
    modelCount: provider.models.length,
    enabled,
  })
  return { routes, tick, enabled }
}

function numberEnv(env: Readonly<Record<string, string | undefined>>, key: string, fallback: number): number {
  const parsed = Number(env[key])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
