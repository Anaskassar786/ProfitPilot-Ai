import { randomUUID } from 'node:crypto'
import { ActionExecutor, CalibrationLedger, DecisionEngine, OpenRouterClient, PersistentCostMeter, PostgresAgentSettingsRepository, PostgresCalibrationStore, PostgresCostLedgerStore, PostgresExecutionLedger, PostgresRecommendationRepository } from '@profitpilot/ai'
import type { ActionTool, ExplanationCache } from '@profitpilot/ai'
import { limitForPlan } from '@profitpilot/billing'
import { withTenantContext } from '@profitpilot/db'
import type { QueryResultRow } from '@profitpilot/db'
import { sha256Hex } from '@profitpilot/crypto'
import type { PlanTier, Role, StoreId } from '@profitpilot/types'
import { InMemoryCacheStore, TenantVersionedCache, UpstashCacheStore } from '@profitpilot/cache'
import { createF2Bootstrap } from './f2-bootstrap.js'
import type { F2Bootstrap } from './f2-bootstrap.js'
import type { AiRouteDependencies } from './ai-routes.js'
import { AI_RECOMMENDATION_USAGE_FEATURE } from './ai-routes.js'
import { buildStoreSnapshot } from './store-snapshot.js'

export type F4Bootstrap = Readonly<F2Bootstrap & { ai: AiRouteDependencies }>

type UsedRow = QueryResultRow & { used: string | number }
type RoleRow = QueryResultRow & { role_id: string }
type PlanRow = QueryResultRow & { plan: string }

export function createF4Bootstrap(env: Readonly<Record<string, string | undefined>>): F4Bootstrap | null {
  const f2 = createF2Bootstrap(env)
  if (!f2) return null
  const provider = new OpenRouterClient({ keys: [env.OPENROUTER_API_KEY_1, env.OPENROUTER_API_KEY_2, env.OPENROUTER_API_KEY_3, env.OPENROUTER_API_KEY].filter((key): key is string => typeof key === 'string'), models: [env.AI_MODEL_PRIMARY, env.AI_MODEL_FALLBACK1, env.AI_MODEL_FALLBACK2].filter((model): model is string => typeof model === 'string' && model.trim().length > 0), timeoutMs: numberEnv(env, 'AI_TIMEOUT_MS', 25_000), maxRetries: numberEnv(env, 'AI_MAX_RETRIES', 1), temperature: numberEnv(env, 'AI_TEMPERATURE', .3), maxTokens: numberEnv(env, 'AI_MAX_TOKENS', 2_000) })
  const costs = new PersistentCostMeter(new PostgresCostLedgerStore(f2.database), numberEnv(env, 'AI_DAILY_COST_CAP_USD', 5))
  const recommendations = new PostgresRecommendationRepository(f2.database)

  // One durable calibration store serves both Command Center and lifecycle decisions.
  const calibration = new CalibrationLedger(new PostgresCalibrationStore(f2.database))
  const settings = new PostgresAgentSettingsRepository(f2.database)
  const cache = explanationCache(env)
  const engine = new DecisionEngine(provider, costs, calibration, recommendations, {
    inputRateMicroDollars: numberEnv(env, 'AI_INPUT_MICRO_DOLLARS', 0),
    outputRateMicroDollars: numberEnv(env, 'AI_OUTPUT_MICRO_DOLLARS', 0),
    concurrency: numberEnv(env, 'AI_RUN_CONCURRENCY', 3),
    signalCap: numberEnv(env, 'AI_RUN_SIGNAL_CAP', 100),
  }, () => Date.now(), cache)

  const plan = async (storeId: StoreId): Promise<PlanTier> => {
    const record = await withTenantContext(f2.database, storeId, async (client) => {
      const result = await client.query<PlanRow>('SELECT plan FROM billing_subscriptions WHERE shop_id = $1 LIMIT 1', [storeId])
      return result.rows[0] ?? null
    }).catch(() => null)
    const tier = record?.plan
    return tier === 'start' || tier === 'growth' || tier === 'commander' ? tier : 'trial'
  }

  const usage = {
    current: async (storeId: StoreId): Promise<number> => withTenantContext(f2.database, storeId, async (client) => {
      const result = await client.query<UsedRow>(`SELECT used FROM billing_usage WHERE shop_id = $1 AND feature = $2 AND period_start = date_trunc('month', now())::date`, [storeId, AI_RECOMMENDATION_USAGE_FEATURE])
      return Number(result.rows[0]?.used ?? 0)
    }),
    add: async (storeId: StoreId, count: number): Promise<void> => withTenantContext(f2.database, storeId, async (client) => {
      await client.query(
        `INSERT INTO billing_usage (shop_id, feature, period_start, used) VALUES ($1, $2, date_trunc('month', now())::date, $3)
         ON CONFLICT (shop_id, feature, period_start) DO UPDATE SET used = billing_usage.used + $3`,
        [storeId, AI_RECOMMENDATION_USAGE_FEATURE, count],
      )
    }),
  }

  const calibrationDependency = {
    record: async (storeId: StoreId, agent: import('@profitpilot/ai').AgentId, recommendationId: string, outcome: 'accepted' | 'rejected'): Promise<void> => {
      await calibration.hydrate()
      await calibration.recordDecision(storeId, agent, recommendationId, outcome)
    },
  }


  const audit = {
    record: async (entry: Readonly<{ storeId: StoreId; actorId: string | null; action: string; recommendationId: string; detail: Readonly<Record<string, string | number | boolean | null>> }>): Promise<void> => {
      // Audit is best-effort by contract: a ledger hiccup must never block a
      // merchant decision, so failures are swallowed after one attempt.
      // actor_id has an FK to users(id) that Shopify session subjects may not
      // satisfy, so the actor travels in the hashed payload instead — the
      // recommendation payload's decidedBy carries it queryably too.
      await f2.database.query(
        `INSERT INTO audit_log (id, store_id, actor_id, action, idempotency_key, payload_hash) VALUES ($1, $2, NULL, $3, $4, $5) ON CONFLICT (store_id, idempotency_key) DO NOTHING`,
        [randomUUID(), entry.storeId, entry.action, `recommendation:${entry.action}:${entry.recommendationId}:${randomUUID()}`, sha256Hex(JSON.stringify({ ...entry.detail, actorId: entry.actorId, recommendationId: entry.recommendationId }))],
      ).catch(() => undefined)
    },
  }

  /**
   * RBAC resolver (PR #46). Reads member_roles for the authenticated user;
   * a store without explicit assignments resolves to 'owner' because the
   * embedded Shopify session is the store owner's session.
   */
  const role = async (storeId: StoreId, userId: string | null): Promise<Role> => {
    if (!userId) return 'owner'
    const row = await withTenantContext(f2.database, storeId, async (client) => {
      const result = await client.query<RoleRow>('SELECT role_id FROM member_roles WHERE store_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT 1', [storeId, userId])
      return result.rows[0] ?? null
    }).catch(() => null)
    const value = row?.role_id
    return value === 'owner' || value === 'admin' || value === 'operator' || value === 'analyst' || value === 'viewer' ? value : 'owner'
  }

  const executor = new ActionExecutor(actionTools(f2), new PostgresExecutionLedger(f2.database))

  return {
    ...f2,
    ai: {
      engine,
      recommendations,
      costs,
      snapshot: (storeId: StoreId) => buildStoreSnapshot(storeId, f2.dataPlane.analytics, f2.database),
      plan,
      limit: (tier: PlanTier) => limitForPlan(tier, AI_RECOMMENDATION_USAGE_FEATURE),
      usage,
      calibration: calibrationDependency,
      settings,
      audit,
      role,
      executor,
      attribution: (storeId: StoreId) => matchAttribution(f2.database, storeId),
    },
  }
}

/** AI explanations are cached per tenant: same evidence means no second AI bill. */
function explanationCache(env: Readonly<Record<string, string | undefined>>): ExplanationCache {
  const store = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new UpstashCacheStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN)
    : new InMemoryCacheStore()
  const cache = new TenantVersionedCache(store)
  return {
    get: async (tenant, key) => cache.get<{ text: string; model: string }>(tenant, key),
    set: async (tenant, key, value, ttlSeconds) => cache.set(tenant, key, value, ttlSeconds),
  }
}

/**
 * Action tools for the execution bridge (PR #46). Every tool is honest about
 * what it does — nothing contacts a customer directly from this path:
 * - CREATE_RECOMMENDATION / INTERNAL_ALERT record the approved insight.
 * - SEND_EMAIL creates a draft campaign template the merchant reviews and
 *   sends from the Campaigns module (merchant-owned sender enforcement stays).
 * - TAG_CUSTOMER / CREATE_DISCOUNT record a prepared draft; applying it in
 *   Shopify remains a reviewed, manual step in this release.
 */
function actionTools(f2: F2Bootstrap): Readonly<Partial<Record<import('@profitpilot/ai').ActionType, ActionTool>>> {
  const recordDraft: ActionTool = async (request) => ({ recorded: true, actionType: request.actionType, recommendationId: String(request.payload.recommendationId ?? '') })
  const sendEmailDraft: ActionTool = async (request) => {
    const templateId = randomUUID()
    const title = String(request.payload.title ?? 'AI recommendation follow-up')
    await f2.database.query(
      `INSERT INTO campaign_templates (id, store_id, name, kind, subject, body, variables) VALUES ($1, $2, $3, 'EMAIL', $4, $5, $6::jsonb) ON CONFLICT (id) DO NOTHING`,
      [templateId, request.storeId, `AI draft: ${title}`.slice(0, 120), `About your recent activity, {{customer.first_name}}`, `Hello {{customer.first_name}},\n\nWe prepared this note from an approved ProfitPilot recommendation. Review and personalize it before sending.\n\nUnsubscribe: {{unsubscribe.url}}`, JSON.stringify(['customer.first_name', 'unsubscribe.url'])],
    )
    return { draftCampaignTemplateId: templateId, requiresReview: true }
  }
  return {
    CREATE_RECOMMENDATION: recordDraft,
    INTERNAL_ALERT: recordDraft,
    TAG_CUSTOMER: recordDraft,
    CREATE_DISCOUNT: recordDraft,
    SEND_EMAIL: sendEmailDraft,
  }
}

type ExecutedRow = QueryResultRow & { id: string; entity_key: string | null; executed_at: Date | string }
type OrderRow = QueryResultRow & { record_id: string; payload: unknown }

const ATTRIBUTION_WINDOW_MS = 7 * 24 * 3_600_000

/**
 * Deterministic attribution matcher (PR #46). Executed customer-facing
 * actions are matched to later synced orders from the same customer within a
 * 7-day window; matches are written idempotently to `ai_attribution_events`
 * (UNIQUE (store_id, order_id)), which is exactly what `/billing/roi` sums.
 */
export async function matchAttribution(database: F2Bootstrap['database'], storeId: StoreId): Promise<number> {
  const executed = await database.query<ExecutedRow>(
    `SELECT e.id, r.entity_key, e.created_at AS executed_at FROM ai_executions e
       JOIN ai_recommendations r ON r.id = e.id AND r.store_id = e.store_id
     WHERE e.store_id = $1 AND r.entity_key IS NOT NULL AND e.action_type IN ('SEND_EMAIL', 'CREATE_DISCOUNT', 'TAG_CUSTOMER')`,
    [storeId],
  ).catch(() => ({ rows: [] as readonly ExecutedRow[] }))
  if (executed.rows.length === 0) return 0
  const orders = await database.query<OrderRow>('SELECT record_id, payload FROM sync_records WHERE store_id = $1 AND module = $2', [storeId, 'orders']).catch(() => ({ rows: [] as readonly OrderRow[] }))
  let written = 0
  for (const order of orders.rows) {
    const payload = order.payload
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue
    const record = payload as Readonly<Record<string, unknown>>
    const customer = typeof record.customer === 'object' && record.customer !== null ? (record.customer as Readonly<Record<string, unknown>>).id : null
    const customerKey = typeof customer === 'string' || typeof customer === 'number' ? String(customer) : null
    if (!customerKey) continue
    const createdAt = typeof record.created_at === 'string' ? Date.parse(record.created_at) : Number.NaN
    if (!Number.isFinite(createdAt)) continue
    const total = Number(record.total_price ?? record.current_total_price ?? Number.NaN)
    if (!Number.isFinite(total) || total <= 0) continue
    const match = executed.rows.find((action) => {
      if (action.entity_key !== customerKey) return false
      const executedAt = new Date(action.executed_at).valueOf()
      return Number.isFinite(executedAt) && createdAt >= executedAt && createdAt - executedAt <= ATTRIBUTION_WINDOW_MS
    })
    if (!match) continue
    const result = await database.query(
      `INSERT INTO ai_attribution_events (store_id, action_id, order_id, method, revenue) VALUES ($1, $2, $3, 'TIME_WINDOW', $4) ON CONFLICT (store_id, order_id) DO NOTHING`,
      [storeId, match.id, order.record_id, total],
    ).catch(() => ({ rowCount: 0 }))
    written += result.rowCount
  }
  return written
}

function numberEnv(env: Readonly<Record<string, string | undefined>>, key: string, fallback: number): number {
  const value = env[key]
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
