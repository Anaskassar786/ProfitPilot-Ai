import { AesGcmCipher } from '@profitpilot/crypto'
import { PostgresStoreDirectory } from '@profitpilot/db'
import { storeId } from '@profitpilot/types'
import { AdminStepUpSessions, calculateRoi, DEFAULT_GIFT_CODES, FunnelLedger, limitForPlan, PostgresBillingRepository, ShopifyBillingClient, TrialAndGiftLedger } from '@profitpilot/billing'
import { PostgresTokenRecordStore, TokenVault } from '@profitpilot/shopify'
import type { QueryResultRow } from '@profitpilot/db'
import { createF4Bootstrap } from './f4-bootstrap.js'
import type { F4Bootstrap } from './f4-bootstrap.js'
import type { BillingRouteDependencies } from './billing-routes.js'
import type { AdminRouteDependencies } from './admin-routes.js'

export type F5Bootstrap = Readonly<F4Bootstrap & { billing: BillingRouteDependencies; admin: AdminRouteDependencies }>

type UsageRow = QueryResultRow & { feature: string; used: string | number }
type RevenueRow = QueryResultRow & { revenue: string | number }

export function createF5Bootstrap(env: Readonly<Record<string, string | undefined>>): F5Bootstrap | null {
  const f4 = createF4Bootstrap(env)
  if (!f4) return null
  const repository = new PostgresBillingRepository(f4.database)
  const directory = new PostgresStoreDirectory(f4.database)
  const vault = new TokenVault(AesGcmCipher.fromHex(requiredEnv(env, 'ENCRYPTION_KEY')), new PostgresTokenRecordStore(f4.database))
  const trials = new TrialAndGiftLedger(giftCodesFromEnv(env))
  const funnel = new FunnelLedger()
  const stepUp = new AdminStepUpSessions(15)
  const billingClient = async (shopId: string): Promise<ShopifyBillingClient> => {
    const connection = await directory.get(storeId(shopId))
    if (!connection) throw new Error('Shopify store is not registered')
    const token = await vault.get(connection.shopDomain)
    if (!token) throw new Error('Shopify token is unavailable')
    return new ShopifyBillingClient({ shop: connection.shopDomain, accessToken: token, testMode: env.SHOPIFY_BILLING_TEST_MODE === 'true' })
  }
  return {
    ...f4,
    billing: {
      repository,
      trials,
      funnel,
      createCharge: async (shopId, plan, interval, returnUrl, trialDays) => (await billingClient(shopId)).createRecurringCharge(plan, interval, returnUrl, trialDays),
      verifyCharge: async (shopId, chargeId, plan, interval) => (await billingClient(shopId)).verifyCharge(chargeId, { plan, interval }),
      usage: async (shopId) => usage(f4.database, shopId),
      roi: async (shopId) => roi(f4.database, f4.ai, shopId),
    },
    admin: { adminKey: requiredEnv(env, 'ADMIN_KEY'), stepUp, funnel, gifts: trials },
  }
}

async function usage(database: { query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number }> }, shopId: string) {
  const result = await database.query<UsageRow>('SELECT feature, used FROM billing_usage WHERE shop_id = $1 AND period_start = date_trunc(\'month\', now())::date', [shopId])
  const account = await new PostgresBillingRepository(database).get(shopId)
  const tier = account?.plan ?? 'trial'
  return result.rows.map((row) => ({ feature: row.feature, used: Number(row.used), limit: featureLimit(tier, row.feature) }))
}

async function roi(database: { query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number }> }, ai: F4Bootstrap['ai'], shopId: string) {
  const result = await database.query<RevenueRow>('SELECT COALESCE(SUM(revenue), 0) AS revenue FROM ai_attribution_events WHERE store_id = $1', [shopId])
  const revenue = Number(result.rows[0]?.revenue ?? 0)
  return calculateRoi(revenue, ai.costs.summary(storeId(shopId)).microDollars)
}

function featureLimit(plan: 'trial' | 'start' | 'growth' | 'commander', feature: string): number | null {
  const allowed = ['orders_sync_month', 'products_sync', 'customers_sync', 'ai_recommendations_month', 'active_agents', 'jarvis_messages_month', 'automation_workflows', 'active_campaigns', 'email_sends_month', 'sms_sends_month', 'team_members', 'reports', 'exports', 'forecasting', 'attribution'] as const
  return allowed.includes(feature as (typeof allowed)[number]) ? limitForPlan(plan, feature as (typeof allowed)[number]) : null
}

function giftCodesFromEnv(env: Readonly<Record<string, string | undefined>>) {
  return DEFAULT_GIFT_CODES.map((defaultCode, index) => {
    const slot = String(index + 1)
    return { ...defaultCode, code: env[`GIFT_CODE_${slot}`]?.trim() || defaultCode.code, maxUses: numberEnv(env, `GIFT_CODE_${slot}_MAX_USES`, defaultCode.maxUses), active: env[`GIFT_CODE_${slot}_ACTIVE`] !== 'false' }
  })
}

function numberEnv(env: Readonly<Record<string, string | undefined>>, key: string, fallback: number): number { const value = env[key]; const parsed = value?.trim() ? Number(value) : fallback; return Number.isFinite(parsed) ? parsed : fallback }
function requiredEnv(env: Readonly<Record<string, string | undefined>>, key: string): string { const value = env[key]?.trim(); if (!value) throw new Error(`Missing required environment variable ${key}`); return value }

