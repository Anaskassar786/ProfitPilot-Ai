import { createBrevoMailer } from '@profitpilot/automation'
import { sha256Hex } from '@profitpilot/crypto'
import { Logger } from '@profitpilot/logger'
import type { Logger as LoggerType } from '@profitpilot/logger'
import type { QueryResultRow } from '@profitpilot/db'
import { OpenRouterClient, CopilotService, JarvisService } from '@profitpilot/ai'
import type { JarvisActionAuditEntry, JarvisActionTool } from '@profitpilot/ai'
import { PostgresCopilotRepository, PostgresJarvisRepository, PostgresReportRepository } from './f8-repositories.js'
import { F8ContextProvider } from './f8-context.js'
import { computeForecast } from './f8-forecast.js'
import { createF7Bootstrap } from './f7-bootstrap.js'
import type { F7Bootstrap } from './f7-bootstrap.js'
import type { CopilotRouteDependencies, ForecastRouteDependencies, JarvisRouteDependencies, ReportRouteDependencies } from './f8-routes.js'
import { CloudflareR2ObjectStore, ReportService } from '@profitpilot/reporting'
import type { ReportDataProvider } from '@profitpilot/reporting'
import { OrderInsightsService, PostgresOrderInsightAudit, PostgresOrderInsightUsage, PostgresOrderRepository } from './orders.js'
import type { OrderRouteDependencies } from './order-routes.js'
import { PostgresCustomerRepository } from './customers.js'
import { CustomerInsightsService, CustomerService, PostgresCustomerInsightAudit, PostgresCustomerInsightUsage } from './customer-insights.js'
import type { CustomerRouteDependencies } from './customer-routes.js'
import { PostgresInventoryRepository } from './inventory.js'
import { InventoryInsightsService, PostgresInventoryInsightAudit, PostgresInventoryInsightUsage, PostgresInventorySnapshotRepository } from './inventory-insights.js'
import type { InventoryRouteDependencies } from './inventory-routes.js'
import { AnalyticsInsightsService, PostgresAnalyticsQueryUsage } from './analytics-insights.js'
import type { AnalyticsRouteDependencies } from './analytics-routes.js'

export type F8RouteDependencies = Readonly<{ jarvis: JarvisRouteDependencies; copilot: CopilotRouteDependencies; forecasting: ForecastRouteDependencies; reports: ReportRouteDependencies }>
export type F8Bootstrap = Readonly<F7Bootstrap & { f8: F8RouteDependencies; analyticsInsights: AnalyticsRouteDependencies; orders: OrderRouteDependencies; customers: CustomerRouteDependencies; inventory: InventoryRouteDependencies; jarvisProvider: OpenRouterClient }>

export function createF8Bootstrap(env: Readonly<Record<string, string | undefined>>, logger?: Logger): F8Bootstrap | null {
  const f7 = createF7Bootstrap(env)
  if (!f7) return null
  const context = new F8ContextProvider({ analytics: f7.dataPlane.analytics, recommendations: f7.ai.recommendations, usage: f7.billing.usage })
  const provider = new OpenRouterClient({
    keys: [env.OPENROUTER_API_KEY_1, env.OPENROUTER_API_KEY_2, env.OPENROUTER_API_KEY_3, env.OPENROUTER_API_KEY].filter((key): key is string => typeof key === 'string'),
    models: [env.AI_MODEL_PRIMARY, env.AI_MODEL_FALLBACK1, env.AI_MODEL_FALLBACK2].filter((model): model is string => typeof model === 'string' && model.trim().length > 0),
    timeoutMs: positiveNumber(env.AI_TIMEOUT_MS, 25_000),
    maxRetries: nonNegativeNumber(env.AI_MAX_RETRIES, 1),
    temperature: numberEnv(env.AI_TEMPERATURE, .3),
    maxTokens: positiveNumber(env.AI_MAX_TOKENS, 2_000),
    ...(logger ? { onFailure: (failure: import('@profitpilot/ai').ProviderFailureTelemetry) => logger.warn('OpenRouter provider failure', { model: failure.model, status_code: failure.statusCode, failure_kind: failure.failureKind, attempt_number: failure.attemptNumber, duration_ms: failure.durationMs, request_id: failure.requestId }) } : {}),
  })
  if (logger) void validateOpenRouterModels(provider, logger)
  const jarvis = new JarvisService(provider, context, new PostgresJarvisRepository(f7.database), null, () => Date.now(), (storeId, generation) => { void Promise.resolve(f7.ai.costs.record({ storeId, model: generation.model, promptTokens: generation.usage.promptTokens, completionTokens: generation.usage.completionTokens, inputRateMicroDollars: numberEnv(env.AI_INPUT_MICRO_DOLLARS, 0), outputRateMicroDollars: numberEnv(env.AI_OUTPUT_MICRO_DOLLARS, 0), at: Date.now() })).catch(() => undefined) }, jarvisActionTools(f7), jarvisActionAudit(f7, logger ?? new Logger()))
  const copilot = new CopilotService({ get: (storeId, intent, page) => context.factsForIntent(storeId, intent, page) }, new PostgresCopilotRepository(f7.database))
  const forecasting: ForecastRouteDependencies = { forecast: (storeId) => computeForecast(storeId, { analytics: f7.dataPlane.analytics, customers: (tenant) => customerRfm(f7.database, tenant) }) }
  const reports = createReports(f7, env)
  const orderRepository = new PostgresOrderRepository(f7.database)
  const orderInsights = new OrderInsightsService(
    orderRepository,
    f7.billing.repository,
    new PostgresOrderInsightUsage(f7.database),
    new PostgresOrderInsightAudit(f7.database),
    provider,
    (storeId, generation) => { void Promise.resolve(f7.ai.costs.record({ storeId, model: generation.model, promptTokens: generation.usage.promptTokens, completionTokens: generation.usage.completionTokens, inputRateMicroDollars: numberEnv(env.AI_INPUT_MICRO_DOLLARS, 0), outputRateMicroDollars: numberEnv(env.AI_OUTPUT_MICRO_DOLLARS, 0), at: Date.now() })).catch(() => undefined) },
  )
  const customerRepository = new PostgresCustomerRepository(f7.database)
  const customerAudit = new PostgresCustomerInsightAudit(f7.database)
  const customerUsage = new PostgresCustomerInsightUsage(f7.database)
  const customers: CustomerRouteDependencies = {
    customers: new CustomerService(customerRepository, f7.billing.repository, customerAudit),
    insights: new CustomerInsightsService(
      customerRepository,
      f7.billing.repository,
      customerUsage,
      customerAudit,
      provider,
      (storeId, generation) => { void Promise.resolve(f7.ai.costs.record({ storeId, model: generation.model, promptTokens: generation.usage.promptTokens, completionTokens: generation.usage.completionTokens, inputRateMicroDollars: numberEnv(env.AI_INPUT_MICRO_DOLLARS, 0), outputRateMicroDollars: numberEnv(env.AI_OUTPUT_MICRO_DOLLARS, 0), at: Date.now() })).catch(() => undefined) },
    ),
  }
  const inventoryRepository = new PostgresInventoryRepository(f7.database)
  const inventory: InventoryRouteDependencies = {
    repository: inventoryRepository,
    // Locked premium metadata must reflect the tenant's real plan, so the
    // existing billing repository is the single source of truth here too.
    plan: async (storeId) => (await f7.billing.repository.get(storeId))?.plan ?? 'trial',
    insights: new InventoryInsightsService(
      inventoryRepository,
      new PostgresInventorySnapshotRepository(f7.database),
      f7.billing.repository,
      new PostgresInventoryInsightUsage(f7.database),
      new PostgresInventoryInsightAudit(f7.database),
      provider,
      (storeId, generation) => { void Promise.resolve(f7.ai.costs.record({ storeId, model: generation.model, promptTokens: generation.usage.promptTokens, completionTokens: generation.usage.completionTokens, inputRateMicroDollars: numberEnv(env.AI_INPUT_MICRO_DOLLARS, 0), outputRateMicroDollars: numberEnv(env.AI_OUTPUT_MICRO_DOLLARS, 0), at: Date.now() })).catch(() => undefined) },
    ),
  }
  const analyticsInsights: AnalyticsRouteDependencies = { insights: new AnalyticsInsightsService(f7.dataPlane.analytics, f7.billing.repository, orderRepository, new PostgresAnalyticsQueryUsage(f7.database), provider) }
  return { ...f7, f8: { jarvis: { service: jarvis }, copilot: { service: copilot }, forecasting, reports: { service: reports } }, analyticsInsights, orders: { repository: orderRepository, insights: orderInsights }, customers, inventory, jarvisProvider: provider }
}

async function validateOpenRouterModels(provider: OpenRouterClient, logger: Logger): Promise<void> {
  const validations = await provider.validateModels()
  for (const validation of validations) {
    if (validation.available) logger.info('OpenRouter model validated', { model: validation.model, status_code: validation.statusCode })
    else logger.warn('OpenRouter model unavailable at startup', { model: validation.model, status_code: validation.statusCode, reason: validation.reason })
  }
}

function createReports(f7: F7Bootstrap, env: Readonly<Record<string, string | undefined>>): ReportService {
  const objectStore = r2FromEnv(env)
  const dataProvider: ReportDataProvider = { get: async (storeId, _frequency, period) => { const raw = await f7.dataPlane.analytics.read(storeId as import('@profitpilot/types').StoreId); const startDay = period.start.slice(0, 10); const endDay = period.end.slice(0, 10); const analytics = { revenue: raw.revenue.filter((row) => row.day >= startDay && row.day <= endDay), orders: raw.orders.filter((row) => row.day >= startDay && row.day <= endDay), productSales: raw.productSales.filter((row) => row.day >= startDay && row.day <= endDay), customerCohorts: raw.customerCohorts.filter((row) => row.activityDay >= startDay && row.activityDay <= endDay) }; const scopedAnalytics = { read: async () => analytics, readCatalog: (tenant: import('@profitpilot/types').StoreId) => f7.dataPlane.analytics.readCatalog(tenant) }; const forecast = await computeForecast(storeId, { analytics: scopedAnalytics, customers: (tenant) => customerRfm(f7.database, tenant) }); const rows = [{ metric: 'closed_period_revenue', value: analytics.revenue.length > 0 ? analytics.revenue.reduce((sum, row) => sum + row.grossRevenue, 0) : null, source: 'analytics_revenue_daily' }, { metric: 'closed_period_orders', value: analytics.orders.length > 0 ? analytics.orders.reduce((sum, row) => sum + row.orderCount, 0) : null, source: 'analytics_orders_daily' }, { metric: 'forecast_method', value: forecast.revenue?.method.method ?? 'unavailable', source: 'forecasting' }, { metric: 'forecast_value', value: forecast.revenue?.value ?? null, source: 'forecasting' }]; return { storeId, currency: null, rows, summary: 'Deterministic closed-period ProfitPilot report.' } } }
  const delivery = reportDelivery(f7, env)
  return new ReportService(new PostgresReportRepository(f7.database), objectStore, dataProvider, delivery)
}

/**
 * Plan-gated store actions Jarvis can execute after confirmation. These map to
 * capabilities that already exist in the product (recommendation decisions).
 * The plan check happens inside JarvisService before the tool runs, so these
 * tools are only ever reached for Commander stores that have confirmed.
 */
function jarvisActionTools(f7: F7Bootstrap): Readonly<Partial<Record<string, JarvisActionTool>>> {
  const decide = async (storeId: string, recommendationId: string, status: 'APPROVED' | 'REJECTED') => {
    // PR #46: single atomic UPDATE guarded by status = 'PENDING'. The old
    // SELECT-version-then-UPDATE pattern had a race window that could clobber
    // a concurrent merchant decision.
    await f7.ai.recommendations.decidePending(storeId as import('@profitpilot/types').StoreId, recommendationId, status, { decidedBy: 'jarvis' })
    return status === 'APPROVED' ? 'Recommendation approved — its workflow is now cleared to run.' : 'Recommendation rejected.'
  }
  return {
    approve_recommendation: async (storeId, parameters) => {
      const recommendationId = typeof parameters.recommendationId === 'string' ? parameters.recommendationId : ''
      if (!recommendationId) throw new Error('A recommendation id is required.')
      return { message: await decide(storeId, recommendationId, 'APPROVED') }
    },
    reject_recommendation: async (storeId, parameters) => {
      const recommendationId = typeof parameters.recommendationId === 'string' ? parameters.recommendationId : ''
      if (!recommendationId) throw new Error('A recommendation id is required.')
      return { message: await decide(storeId, recommendationId, 'REJECTED') }
    },
    // Sync touches the data-plane module; rather than reach across module
    // boundaries from Jarvis scope, we report the action honestly as a
    // suggestion the merchant can trigger from the workspace.
    trigger_sync: async () => ({ message: 'I can queue a fresh sync for you from the Dashboard — use "Sync all" to pull the latest Shopify data.' }),
  }
}

/**
 * Writes every Jarvis store-action attempt (executed, refused, or failed) to
 * the existing operational audit_log table. Failures here never block Jarvis.
 */
function jarvisActionAudit(f7: F7Bootstrap, logger: LoggerType): { record(entry: JarvisActionAuditEntry): Promise<void> } {
  return {
    async record(entry: JarvisActionAuditEntry): Promise<void> {
      try {
        const payload = JSON.stringify({ actionId: entry.actionId, outcome: entry.outcome, plan: entry.plan, parameters: entry.parameters })
        await f7.database.query(
          `INSERT INTO audit_log (id, store_id, action, idempotency_key, payload_hash) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (store_id, idempotency_key) DO NOTHING`,
          [entry.id, entry.storeId, `jarvis.action.${entry.actionId}`, `jarvis:${entry.id}`, sha256Hex(payload)],
        )
      } catch (error: unknown) {
        logger.warn('Jarvis action audit write failed', { actionId: entry.actionId, outcome: entry.outcome, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

function r2FromEnv(env: Readonly<Record<string, string | undefined>>): CloudflareR2ObjectStore | null {
  const endpoint = env.R2_ENDPOINT?.trim(); const bucket = env.R2_BUCKET?.trim(); const accessKeyId = env.R2_ACCESS_KEY_ID?.trim(); const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim()
  return endpoint && bucket && accessKeyId && secretAccessKey ? new CloudflareR2ObjectStore({ endpoint, bucket, accessKeyId, secretAccessKey }) : null
}

function reportDelivery(f7: F7Bootstrap, env: Readonly<Record<string, string | undefined>>): import('@profitpilot/reporting').ReportEmailDelivery | null {
  const smtpConfigured = Boolean(env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASSWORD?.trim() && env.SMTP_FROM?.trim())
  if (!smtpConfigured) return null
  const mailer = createBrevoMailer(env)
  return { send: async ({ storeId, filename, body, subject }) => { const merchant = f7.automation.emailVerifier.get(storeId); if (!merchant?.verified) throw new Error('Merchant report email is not verified'); await mailer.send({ to: merchant.merchantEmail, from: env.SMTP_FROM?.trim() ?? '', fromName: env.SMTP_FROM_NAME?.trim() || 'ProfitPilot', subject, html: `<p>Your ${filename} report is attached.</p>`, headers: { 'X-ProfitPilot-Report-Bytes': String(body.byteLength) }, attachments: [{ filename, content: body, contentType: 'application/pdf' }] }) } }
}

type CustomerSyncRow = QueryResultRow & { payload: unknown }
async function customerRfm(database: { query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number }> }, storeId: string): Promise<readonly import('@profitpilot/forecasting').RfmInput[]> {
  const result = await database.query<CustomerSyncRow>('SELECT payload FROM sync_records WHERE store_id = $1 AND module = $2 ORDER BY synced_at DESC', [storeId, 'customers'])
  const now = Date.now()
  return result.rows.flatMap((row) => {
    if (!isRecord(row.payload)) return []
    const id = row.payload.id ?? row.payload.customer_id
    const lastOrder = typeof row.payload.last_order_at === 'string' ? Date.parse(row.payload.last_order_at) : Number.NaN
    const frequency = numberField(row.payload.orders_count ?? row.payload.order_count)
    const monetaryValue = numberField(row.payload.lifetime_value ?? row.payload.total_spent)
    if ((typeof id !== 'string' && typeof id !== 'number') || !Number.isFinite(lastOrder) || frequency === null || monetaryValue === null) return []
    return [{ customerKey: sha256Hex(`${storeId}:${String(id)}`), recencyDays: Math.max(0, Math.floor((now - lastOrder) / 86_400_000)), frequency, monetaryValue }]
  })
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function numberField(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null }
function positiveNumber(value: string | undefined, fallback: number): number { const parsed = value?.trim() ? Number(value) : fallback; return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback }
function nonNegativeNumber(value: string | undefined, fallback: number): number { const parsed = value?.trim() ? Number(value) : fallback; return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback }
function numberEnv(value: string | undefined, fallback: number): number { const parsed = value?.trim() ? Number(value) : fallback; return Number.isFinite(parsed) ? parsed : fallback }
