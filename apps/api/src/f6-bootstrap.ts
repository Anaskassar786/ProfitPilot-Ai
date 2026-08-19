import { AutomationExecutionService, CampaignEmailService, MerchantEmailVerifier, PostgresMerchantEmailConfigRepository, PostgresRunRepository, PostgresTemplateRepository, PostgresWorkflowRepository, ThreadLedger, createBrevoMailer } from '@profitpilot/automation'
import { ProductionWorkflowActions } from './automation-actions.js'
import { AutomationTriggerService } from './automation-triggers.js'
import type { EmailTransport } from '@profitpilot/automation'
import type { ExportRow } from '@profitpilot/reporting'
import { createF5Bootstrap } from './f5-bootstrap.js'
import type { F5Bootstrap } from './f5-bootstrap.js'
import type { AutomationRouteDependencies } from './automation-routes.js'
import { AppError, storeId } from '@profitpilot/types'
import { OpenRouterClient } from '@profitpilot/ai'
import { PostgresCustomerRepository } from './customers.js'
import { PostgresCampaignSendStore, TargetedCampaignService } from './targeted-campaigns.js'
import { withTenantContext } from '@profitpilot/db'

export type F6Bootstrap = Readonly<F5Bootstrap & { automation: AutomationRouteDependencies & Readonly<{ triggers: AutomationTriggerService }> }>
export function createF6Bootstrap(env: Readonly<Record<string, string | undefined>>): F6Bootstrap | null {
  const f5 = createF5Bootstrap(env)
  if (!f5) return null
  const templates = new PostgresTemplateRepository(f5.database)
  const merchantEmails = new PostgresMerchantEmailConfigRepository(f5.database)
  const emailVerifier = new MerchantEmailVerifier(env.MERCHANT_EMAIL_VERIFICATION_SECRET?.trim() || env.TRACKING_SECRET?.trim() || 'development-merchant-email-secret')
  const mailer = campaignMailer(env)
  const campaignEmail = new CampaignEmailService(mailer, mailer, emailVerifier, env.SMTP_FROM?.trim() || 'unconfigured@profitpilot.invalid', env.SMTP_FROM_NAME?.trim() || 'ProfitPilot', { physicalAddress: env.LEGAL_ENTITY_ADDRESS?.trim() || '', supportEmail: env.SUPPORT_EMAIL?.trim() || '' })
  const targetedCampaigns = new TargetedCampaignService(
    new PostgresCustomerRepository(f5.database),
    f5.billing.repository,
    templates,
    merchantEmails,
    emailVerifier,
    campaignEmail,
    new PostgresCampaignSendStore(f5.database),
    async (tenant) => (await f5.storeDirectory.get(tenant))?.shopDomain ?? null,
    env.TRACKING_SECRET?.trim() || 'development-campaign-unsubscribe-secret',
    env.SHOPIFY_APP_URL?.trim() || env.APP_URL?.trim() || null,
    { locked: (tenant, plan) => withTenantContext(f5.database, tenant, async (client) => { await client.query(`INSERT INTO billing_audit (shop_id, actor, event, payload) VALUES ($1, 'merchant', 'campaigns.targeted_send.locked', $2::jsonb)`, [tenant, JSON.stringify({ plan, requiredPlan: 'growth' })]) }) },
  )
  const workflows = new PostgresWorkflowRepository(f5.database)
  const runs = new PostgresRunRepository(f5.database)
  const workflowAi = new OpenRouterClient({ keys: [env.OPENROUTER_API_KEY_1, env.OPENROUTER_API_KEY_2, env.OPENROUTER_API_KEY_3, env.OPENROUTER_API_KEY].filter((key): key is string => typeof key === 'string' && key.trim().length > 0), models: [env.AI_MODEL_PRIMARY, env.AI_MODEL_FALLBACK1, env.AI_MODEL_FALLBACK2].filter((model): model is string => typeof model === 'string' && model.trim().length > 0), maxTokens: 300 })
  const actions = new ProductionWorkflowActions(f5.database, f5.storeDirectory, f5.tokenVault, targetedCampaigns, workflowAi.configured ? workflowAi : null, env.SHOPIFY_API_VERSION?.trim() || '2025-10')
  const execution = new AutomationExecutionService(runs, actions)
  const triggers = new AutomationTriggerService(f5.database, workflows, execution)
  return { ...f5, automation: {
    workflows,
    runs,
    execution,
    triggers,
    billing: f5.billing.repository,
    templates,
    emailVerifier,
    merchantEmails,
    targetedCampaigns,
    tickets: new ThreadLedger(),
    sendVerificationEmail: async ({ email, fromName, token, shopId }) => {
      const origin = env.SHOPIFY_APP_URL?.trim() || env.APP_URL?.trim() || ''
      const link = origin ? `${origin.replace(/\/$/, '')}/settings/merchant-email/verify?token=${encodeURIComponent(token)}` : token
      await campaignEmail.sendSystem(email, 'Verify your ProfitPilot sender email', `<p>Confirm ${fromName} (${shopId}) can send from this address.</p><p><a href="${link}">Verify email</a></p>`)
      return true
    },
    requirePermission: (tenant, user, permission) => withTenantContext(f5.database, tenant, async (client) => {
      const result = await client.query<{ allowed: boolean }>(`SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN role_permissions rp ON rp.role_id = mr.role_id WHERE mr.store_id = $1 AND mr.user_id = $2 AND rp.permission_id = $3) AS allowed`, [tenant, user, permission])
      if (result.rows[0]?.allowed !== true) throw new AppError('FORBIDDEN', 'You do not have permission to manage automations', 403, { permission })
    }),
    exportRows: (tenant, dataset) => loadExportRows(f5, tenant, dataset),
  } }
}

function campaignMailer(env: Readonly<Record<string, string | undefined>>): EmailTransport {
  if (env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASSWORD?.trim()) return createBrevoMailer(env)
  return { async send() { throw new AppError('DEPENDENCY_ERROR', 'SMTP campaign transport is not configured', 503) } }
}

async function loadExportRows(f5: F5Bootstrap, tenant: string, dataset: 'orders' | 'catalog' | 'audit' | 'revenue'): Promise<readonly ExportRow[]> {
  const id = storeId(tenant)
  if (dataset === 'catalog') {
    const catalog = await f5.dataPlane.analytics.readCatalog(id)
    return catalog.slice(0, 50_000).map((product) => ({ productId: product.productId, title: typeof product.payload.title === 'string' ? product.payload.title : product.productId, syncedAt: new Date(product.syncedAt).toISOString() }))
  }
  if (dataset === 'audit') {
    const result = await f5.database.query<{ action: string; created_at: Date; idempotency_key: string }>('SELECT action, created_at, idempotency_key FROM audit_log WHERE store_id = $1 ORDER BY created_at DESC LIMIT 50000', [tenant]).catch(async () => f5.database.query<{ module: string; record_id: string; synced_at: Date }>('SELECT module, record_id, synced_at FROM sync_records WHERE store_id = $1 ORDER BY synced_at DESC LIMIT 50000', [tenant]))
    return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])) as ExportRow)
  }
  const analytics = await f5.dataPlane.analytics.read(id)
  if (dataset === 'orders') return analytics.orders.slice(0, 50_000).map((row) => ({ day: row.day, orders: row.orderCount, fulfilled: row.fulfilledCount, cancelled: row.cancelledCount, averageOrderValue: row.averageOrderValue }))
  return analytics.revenue.slice(0, 50_000).map((row) => ({ day: row.day, grossRevenue: row.grossRevenue, discounts: row.discounts, orderCount: row.orderCount }))
}
