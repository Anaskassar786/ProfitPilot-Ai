import { AesGcmCipher } from '@profitpilot/crypto'
import { TenantVersionedCache, UpstashCacheStore } from '@profitpilot/cache'
import { AppError } from '@profitpilot/types'
import { PostgresAnalyticsRepository, PostgresStoreDirectory } from '@profitpilot/db'
import { ShopifyClient, PostgresTokenRecordStore, TokenVault } from '@profitpilot/shopify'
import { AdaptiveRateController, PostgresCheckpointStore, PostgresSyncSink, ShopifyRestSyncSource, StoreCircuitRegistry, StoreRequestPolicy, SyncEngine } from '@profitpilot/sync'
import { Logger } from '@profitpilot/logger'
import type { DataPlaneDependencies } from './data-plane-routes.js'
import { createF1Bootstrap } from './bootstrap.js'
import type { F1Bootstrap } from './bootstrap.js'

export type F2Bootstrap = Readonly<F1Bootstrap & { dataPlane: DataPlaneDependencies }>

export function createF2Bootstrap(env: Readonly<Record<string, string | undefined>>): F2Bootstrap | null {
  const f1 = createF1Bootstrap(env)
  if (!f1) return null
  const analytics = new PostgresAnalyticsRepository(f1.database)
  const directory = new PostgresStoreDirectory(f1.database)
  const vault = new TokenVault(AesGcmCipher.fromHex(requiredEnv(env, 'ENCRYPTION_KEY')), new PostgresTokenRecordStore(f1.database))
  const source = new ShopifyRestSyncSource(async (storeId) => {
    const connection = await directory.get(storeId)
    if (!connection) throw new AppError('NOT_FOUND', 'Shopify store is not registered', 404, { storeId })
    const token = await vault.get(connection.shopDomain)
    if (!token) throw new AppError('DEPENDENCY_ERROR', 'Shopify token is unavailable for this store', 503, { storeId })
    return new ShopifyClient(connection.shopDomain, token, fetch, env.SHOPIFY_API_VERSION ?? '2024-04')
  })
  const cache = createCache(env)
  const policy = new StoreRequestPolicy(new AdaptiveRateController(), new StoreCircuitRegistry())
  const engine = new SyncEngine(source, new PostgresSyncSink(f1.database, analytics), new PostgresCheckpointStore(f1.database), policy, new Logger(), () => Date.now(), cache)
  return { ...f1, dataPlane: { sync: engine, analytics } }
}

function createCache(env: Readonly<Record<string, string | undefined>>): TenantVersionedCache | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim()
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null
  return new TenantVersionedCache(new UpstashCacheStore(url, token))
}

function requiredEnv(env: Readonly<Record<string, string | undefined>>, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${key}`)
  return value
}

