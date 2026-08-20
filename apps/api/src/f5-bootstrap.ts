import { AesGcmCipher } from '@profitpilot/crypto'
import { PostgresStoreDirectory } from '@profitpilot/db'
import { AppError, storeId } from '@profitpilot/types'
import { Logger } from '@profitpilot/logger'
import { AdminStepUpSessions, calculateRoi, DEFAULT_GIFT_CODES, FunnelLedger, limitForPlan, PostgresBillingRepository, PostgresTrialGiftStore, ShopifyBillingClient } from '@profitpilot/billing'
import type { TrialRecord } from '@profitpilot/billing'
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
  const giftStore = new PostgresTrialGiftStore(f4.database, giftCodesFromEnv(env))
  // Best-effort seed so KASSAR786 / AFRIDI786 (or env overrides) exist even if
  // the migration seed was wiped. Failures are non-fatal at boot.
  void giftStore.seedDefaultCodes(giftCodesFromEnv(env)).catch(() => undefined)
  const funnel = new FunnelLedger()
  const stepUp = new AdminStepUpSessions(15)
  const logger = new Logger()
  const billingClient = async (shopId: string): Promise<ShopifyBillingClient> => {
    const connection = await directory.get(storeId(shopId))
    if (!connection) throw new AppError('NOT_FOUND', 'Shopify store is not registered', 404, { storeId: shopId })
    const token = await vault.get(connection.shopDomain)
    // Same reconnect path as /sync: an absent offline token is a 503 the
    // merchant can act on, not an opaque 500.
    if (!token) throw new AppError('DEPENDENCY_ERROR', 'Shopify access token is missing. Hard refresh the embedded app to reconnect this store, then retry.', 503, { storeId: shopId, reason: 'SHOPIFY_TOKEN_MISSING', action: 'HARD_REFRESH' })
    return new ShopifyBillingClient({ shop: connection.shopDomain, accessToken: token, apiVersion: env.SHOPIFY_API_VERSION?.trim() || '2025-10', testMode: billingTestMode(env), logger })
  }

  const ensureTrial = async (shopId: string): Promise<TrialRecord> => giftStore.ensureTrial(shopId)

  return {
    ...f4,
    // PR45: the AI Command Center is plan-aware — the billing repository is
    // the source of truth for which agents a store's tier unlocks.
    ai: { ...f4.ai, plan: async (tenant) => (await repository.get(tenant))?.plan ?? 'trial' },
    billing: {
      repository,
      trials: giftStore,
      funnel,
      // Phase 1: mock local plan upgrades by default so the Billing UI can be
      // tested end-to-end without Shopify Billing. Flip via BILLING_MOCK_CHARGES=false.
      mockCharges: env.BILLING_MOCK_CHARGES?.trim().toLowerCase() !== 'false',
      createCharge: async (shopId, plan, interval, returnUrl, trialDays) => (await billingClient(shopId)).createRecurringCharge(plan, interval, returnUrl, trialDays),
      verifyCharge: async (shopId, chargeId, plan, interval) => (await billingClient(shopId)).verifyCharge(chargeId, { plan, interval }),
      usage: async (shopId) => usage(f4.database, shopId),
      roi: async (shopId) => roi(f4.database, f4.ai, shopId),
      ensureTrial,
    },
    admin: {
      adminKey: requiredEnv(env, 'ADMIN_KEY'),
      stepUp,
      funnel,
      gifts: {
        setGiftKillSwitch: (active: boolean) => giftStore.setGiftKillSwitch(active),
        isGiftKillSwitchActive: () => giftStore.isGiftKillSwitchActive(),
      },
    },
  }
}

async function usage(database: { query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number }> }, shopId: string) {
  const result = await database.query<UsageRow>('SELECT feature, used FROM billing_usage WHERE shop_id = $1 AND period_start = date_trunc(\'month\', now())::date', [shopId])
  const account = await new PostgresBillingRepository(database).get(shopId)
  const tier = account?.plan ?? 'trial'
  // Always surface every metered entitlement so the Billing UI can render a
  // complete usage dashboard even when no rows exist yet for the period.
  const features = [
    'orders_sync_month',
    'products_sync',
    'customers_sync',
    'ai_recommendations_month',
    'active_agents',
    'jarvis_messages_month',
    'automation_workflows',
    'active_campaigns',
    'email_sends_month',
    'sms_sends_month',
    'team_members',
    'reports',
    'exports',
    'forecasting',
    'attribution',
    'ai_command_daily',
  ] as const
  const usedByFeature = new Map(result.rows.map((row) => [row.feature, Number(row.used)]))
  return features.map((feature) => ({
    feature,
    used: usedByFeature.get(feature) ?? 0,
    limit: featureLimit(tier, feature),
  }))
}

async function roi(database: { query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number }> }, ai: F4Bootstrap['ai'], shopId: string) {
  const result = await database.query<RevenueRow>('SELECT COALESCE(SUM(revenue), 0) AS revenue FROM ai_attribution_events WHERE store_id = $1', [shopId])
  const revenue = Number(result.rows[0]?.revenue ?? 0)
  return calculateRoi(revenue, (await Promise.resolve(ai.costs.summary(storeId(shopId)))).microDollars)
}

function featureLimit(plan: 'trial' | 'start' | 'growth' | 'commander', feature: string): number | null {
  const allowed = ['orders_sync_month', 'products_sync', 'customers_sync', 'ai_recommendations_month', 'active_agents', 'jarvis_messages_month', 'automation_workflows', 'active_campaigns', 'email_sends_month', 'sms_sends_month', 'team_members', 'reports', 'exports', 'forecasting', 'attribution', 'ai_command_daily'] as const
  return allowed.includes(feature as (typeof allowed)[number]) ? limitForPlan(plan, feature as (typeof allowed)[number]) : null
}

/**
 * `SHOPIFY_BILLING_TEST_MODE` accepts `true`, `false`, or `auto` (default).
 * `auto` lets the billing client read the shop's plan and force `test: true`
 * for development/partner-test stores, which Shopify otherwise rejects with a
 * 422 when a live charge is requested.
 */
function billingTestMode(env: Readonly<Record<string, string | undefined>>): boolean | 'auto' {
  const value = env.SHOPIFY_BILLING_TEST_MODE?.trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  return 'auto'
}

function giftCodesFromEnv(env: Readonly<Record<string, string | undefined>>) {
  return DEFAULT_GIFT_CODES.map((defaultCode, index) => {
    const slot = String(index + 1)
    return { ...defaultCode, code: env[`GIFT_CODE_${slot}`]?.trim() || defaultCode.code, maxUses: numberEnv(env, `GIFT_CODE_${slot}_MAX_USES`, defaultCode.maxUses), active: env[`GIFT_CODE_${slot}_ACTIVE`] !== 'false' }
  })
}

function numberEnv(env: Readonly<Record<string, string | undefined>>, key: string, fallback: number): number { const value = env[key]; const parsed = value?.trim() ? Number(value) : fallback; return Number.isFinite(parsed) ? parsed : fallback }
function requiredEnv(env: Readonly<Record<string, string | undefined>>, key: string): string { const value = env[key]?.trim(); if (!value) throw new Error(`Missing required environment variable ${key}`); return value }

// Re-export for tests that previously imported the private ensureTrial helper shape.
export type { TrialRecord }
