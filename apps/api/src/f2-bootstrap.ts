import { TenantVersionedCache, UpstashCacheStore } from '@profitpilot/cache'
import { AppError } from '@profitpilot/types'
import { PostgresAnalyticsRepository, PostgresStoreDirectory } from '@profitpilot/db'
import { ShopifyClient } from '@profitpilot/shopify'
import { AdaptiveRateController, PostgresCheckpointStore, PostgresSyncSink, ShopifyGraphQLSyncSource, StoreCircuitRegistry, StoreRequestPolicy, SyncEngine } from '@profitpilot/sync'
import { Logger } from '@profitpilot/logger'
import type { DataPlaneDependencies } from './data-plane-routes.js'
import { createF1Bootstrap } from './bootstrap.js'
import type { F1Bootstrap } from './bootstrap.js'
import { TokenRefreshingSync } from './token-refresh-sync.js'

export type F2Bootstrap = Readonly<F1Bootstrap & { dataPlane: DataPlaneDependencies }>

export function createF2Bootstrap(env: Readonly<Record<string, string | undefined>>): F2Bootstrap | null {
  const f1 = createF1Bootstrap(env)
  if (!f1) return null
  const analytics = new PostgresAnalyticsRepository(f1.database)
  const directory = new PostgresStoreDirectory(f1.database)
  const logger = new Logger()
  const source = new ShopifyGraphQLSyncSource(async (storeId) => {
    const connection = await directory.get(storeId)
    if (!connection) throw new AppError('NOT_FOUND', 'Shopify store is not registered', 404, { storeId })
    const token = await f1.tokenVault.get(connection.shopDomain)
    if (!token) {
      throw new AppError(
        'DEPENDENCY_ERROR',
        'Shopify access token is missing. Hard refresh the embedded app to reconnect this store, then retry sync.',
        503,
        { storeId, reason: 'SHOPIFY_TOKEN_MISSING', action: 'HARD_REFRESH' },
      )
    }
    return new ShopifyClient(connection.shopDomain, token, fetch, env.SHOPIFY_API_VERSION?.trim() || '2025-10', logger)
  })
  const cache = createCache(env)
  // A store circuit now auto-closes after this cooldown, and /sync closes it
  // early whenever a token exchange repairs the underlying cause.
  const circuits = new StoreCircuitRegistry({ failureThreshold: circuitThreshold(env), cooldownMs: circuitCooldownMs(env) })
  const policy = new StoreRequestPolicy(new AdaptiveRateController(), circuits)
  const engine = new SyncEngine(source, new PostgresSyncSink(f1.database, analytics), new PostgresCheckpointStore(f1.database), policy, logger, () => Date.now(), cache)
  const sync = new TokenRefreshingSync(engine, directory, f1.tokenExchange, logger, circuits)
  return { ...f1, dataPlane: { sync, analytics, circuits, tokenVault: f1.tokenVault, directory } }
}

/** Default 3 consecutive upstream failures, overridable per deployment. */
function circuitThreshold(env: Readonly<Record<string, string | undefined>>): number {
  const parsed = Number(env.SYNC_CIRCUIT_FAILURE_THRESHOLD?.trim())
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 3
}

/** Default 60s cooldown; the circuit half-opens automatically afterwards. */
function circuitCooldownMs(env: Readonly<Record<string, string | undefined>>): number {
  const parsed = Number(env.SYNC_CIRCUIT_COOLDOWN_MS?.trim())
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.floor(parsed) : 60_000
}

function createCache(env: Readonly<Record<string, string | undefined>>): TenantVersionedCache | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim()
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null
  return new TenantVersionedCache(new UpstashCacheStore(url, token))
}
