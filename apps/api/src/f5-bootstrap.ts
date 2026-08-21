import { AesGcmCipher } from '@profitpilot/crypto'
import { PostgresStoreDirectory, withTenantContext } from '@profitpilot/db'
import { AppError, storeId } from '@profitpilot/types'
import { Logger } from '@profitpilot/logger'
import { AdminStepUpSessions, agentsForPlanCount, calculateRoi, DEFAULT_GIFT_CODES, FunnelLedger, limitForPlan, PostgresBillingRepository, PostgresTrialGiftStore, ShopifyBillingClient } from '@profitpilot/billing'
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
type CountRow = QueryResultRow & { total: string | number }
type CommandCountRow = QueryResultRow & { total: string | number | null }

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
    return new ShopifyBillingClient({ shop: connection.shopDomain, accessToken: token, apiVersion: env.SHOPIFY_API_VERSION?.trim() || '2026-07', testMode: billingTestMode(env), logger })
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
      verifyCharge: async (shopId, chargeId, plan, interval) => (await billingClient(shopId)).verifyCharge(chargeId, plan && interval ? { plan, interval } : undefined),
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
  // Resolve the tier first — every meter needs a limit and Commander fairness
  // flags are tier-relative.
  let account: Awaited<ReturnType<PostgresBillingRepository['get']>> = null
  try {
    account = await new PostgresBillingRepository(database).get(shopId)
  } catch {
    account = null
  }
  const tier: 'trial' | 'start' | 'growth' | 'commander' = account?.plan ?? 'trial'

  // Pull every live counter under a single tenant context. The sync tables
  // (`catalog_products`, `sync_records`, `workflows`) and the `ai_command_usage`
  // table are RLS-gated, so we MUST run them through `withTenantContext` or
  // the rows are silently invisible. The local `billing_usage` rows below
  // are for features that are not stored in domain tables (e.g. AI recs,
  // email sends).
  const liveCounts: Record<string, number> = { ...(await readLiveCounts(database, shopId)) }

  // `active_agents` is a capacity meter, not consumption. We render the
  // number of named agents a plan unlocks (Trial 2 / Start 3 / Growth 4 /
  // Commander 6) so the UI can show "3 of 3 agents available" — never a
  // fake 0/2 progress bar. Commander's full 6 always count.
  liveCounts.active_agents = agentsForPlanCount(tier)

  // billing_usage is the canonical counter for things that are not 1:1
  // with another table (recommendations, email sends). Read what's there
  // for the current calendar month; missing rows become 0.
  let periodUsage = new Map<string, number>()
  try {
    const result = await database.query<UsageRow>('SELECT feature, used FROM billing_usage WHERE shop_id = $1 AND period_start = date_trunc(\'month\', now())::date', [shopId])
    periodUsage = new Map(result.rows.map((row) => [row.feature, Number(row.used)]))
  } catch { /* billing_usage rows are best-effort */ }

  // Always surface every metered entitlement so the Billing UI can render a
  // complete usage dashboard even when no rows exist yet for the period.
  // The UI additionally filters out hidden/dead keys (`HIDDEN_METER_KEYS`).
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
  return features.map((feature) => {
    const live = liveCounts[feature]
    const used = live !== undefined ? live : (periodUsage.get(feature) ?? 0)
    return {
      feature,
      used: Number.isFinite(used) ? Math.max(0, used) : 0,
      limit: featureLimit(tier, feature),
    }
  })
}

/**
 * Live counter source per meter key. Backed by the actual domain tables so
 * the Billing page never lies. Falls back to 0 when the table does not exist
 * yet or the count query throws (e.g. fresh install before a sync). Wraps
 * the whole read in `withTenantContext` so every query sees the right RLS
 * tenant — no per-row `shop_id = $1` is needed beyond the table key.
 */
async function readLiveCounts(
  database: { query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number }> },
  shopId: string,
): Promise<Readonly<Record<string, number>>> {
  const out: Record<string, number> = {}
  const safe = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)
  try {
    await withTenantContext(database, shopId, async (client) => {
      // Products synced → catalog_products (active rows)
      const products = await client.query<CountRow>('SELECT COUNT(*)::text AS total FROM catalog_products WHERE store_id = $1', [shopId]).catch(() => ({ rows: [{ total: '0' }] as readonly CountRow[] }))
      out.products_sync = safe(Number(products.rows[0]?.total ?? 0))

      // Customers synced → sync_records where module = 'customers'
      const customers = await client.query<CountRow>("SELECT COUNT(*)::text AS total FROM sync_records WHERE store_id = $1 AND module = 'customers'", [shopId]).catch(() => ({ rows: [{ total: '0' }] as readonly CountRow[] }))
      out.customers_sync = safe(Number(customers.rows[0]?.total ?? 0))

      // Orders synced / month → sync_records where module='orders' and the
      // Shopify order's created_at falls in the current calendar month (UTC).
      // The JSON payload's `created_at` is the merchant-visible order date; we
      // fall back to `processed_at` then `synced_at` so older imports without
      // a `created_at` still get counted in the right month.
      const orders = await client.query<CountRow>(
        `SELECT COUNT(*)::text AS total
         FROM sync_records
         WHERE store_id = $1
           AND module = 'orders'
           AND date_trunc('month', COALESCE(
                 (payload->>'created_at')::timestamptz,
                 (payload->>'processed_at')::timestamptz,
                 synced_at
               )) = date_trunc('month', now())`,
        [shopId],
      ).catch(() => ({ rows: [{ total: '0' }] as readonly CountRow[] }))
      out.orders_sync_month = safe(Number(orders.rows[0]?.total ?? 0))

      // Automation workflows → workflows table (any status; merchants see
      // how many they have created, not just active ones)
      const workflows = await client.query<CountRow>('SELECT COUNT(*)::text AS total FROM workflows WHERE store_id = $1', [shopId]).catch(() => ({ rows: [{ total: '0' }] as readonly CountRow[] }))
      out.automation_workflows = safe(Number(workflows.rows[0]?.total ?? 0))

      // AI Command / day → ai_command_usage for today (commands_used column)
      const aiCommand = await client.query<CommandCountRow>(
        'SELECT COALESCE(commands_used, 0)::text AS total FROM ai_command_usage WHERE store_id = $1 AND usage_date = CURRENT_DATE',
        [shopId],
      ).catch(() => ({ rows: [{ total: '0' }] as readonly CommandCountRow[] }))
      out.ai_command_daily = safe(Number(aiCommand.rows[0]?.total ?? 0))
    })
  } catch { /* RLS or table not ready — return whatever we already have */ }
  return out
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

// Re-export the usage resolver + live-count helper so unit tests can drive
// them with a fake executor and assert the SQL/used mapping without booting
// a real Postgres. The functions stay internal to BillingRouteDependencies
// in production; the named exports only exist to keep the test surface small.
export { readLiveCounts, usage }
