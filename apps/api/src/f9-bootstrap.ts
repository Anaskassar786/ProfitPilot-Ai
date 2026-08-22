import { Logger } from '@profitpilot/logger'
import { AdminOpsService, F9ControlService, InMemoryOpsQueue, UpstashOpsQueue, monitoringFromEnv, posthogFromEnv } from '@profitpilot/monitoring'
import type { ErrorMonitor, OpsQueueAdapter } from '@profitpilot/monitoring'
import { createF8Bootstrap } from './f8-bootstrap.js'
import type { F8Bootstrap } from './f8-bootstrap.js'
import { PostgresF9ControlRepository } from './f9-repositories.js'
import { normalizeEnvironment, requireStartupEnvironment } from './f9-config.js'
import { readinessChecksFromAdapters } from './readiness.js'
import type { DependencyCheck } from './readiness.js'

export type F9Bootstrap = Readonly<F8Bootstrap & { f9: Readonly<{ controls: F9ControlService; ops: AdminOpsService; monitor: ErrorMonitor; analytics: import('@profitpilot/monitoring').ProductAnalytics; readinessChecks: readonly DependencyCheck[] }> }>

export function createF9Bootstrap(rawEnv: Readonly<Record<string, string | undefined>>, logger = new Logger()): F9Bootstrap | null {
  const env = normalizeEnvironment(rawEnv)
  const f8 = createF8Bootstrap(env, logger)
  if (!f8) return null
  requireStartupEnvironment(env)
  const controls = new F9ControlService(new PostgresF9ControlRepository(f8.database))
  const queue: OpsQueueAdapter = env.UPSTASH_REDIS_REST_URL?.trim() && env.UPSTASH_REDIS_REST_TOKEN?.trim() ? new UpstashOpsQueue(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN) : new InMemoryOpsQueue()
  const ops = new AdminOpsService(queue, controls)
  const monitor = monitoringFromEnv(env, logger)
  const analytics = posthogFromEnv(env)
  const readinessChecks = readinessChecksFromAdapters({
    database: async () => { await f8.database.query('SELECT 1'); return true },
    redis: upstashPing(env),
    ai: cachedAiCompletionHealth(f8.jarvisProvider),
    shopify: shopifyHealth(env),
  })
  return { ...f8, f9: { controls, ops, monitor, analytics, readinessChecks } }
}

function upstashPing(env: Readonly<Record<string, string | undefined>>): () => Promise<boolean> {
  const url = env.UPSTASH_REDIS_REST_URL?.trim(); const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return async () => false
  return async () => { const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(['PING']) }); return response.ok }
}
export function cachedAiCompletionHealth(provider: Pick<import('@profitpilot/ai').OpenRouterClient, 'completionHealthCheck'>, ttlMs = 300_000, now: () => number = () => Date.now()): () => Promise<boolean> {
  let cached: Readonly<{ value: boolean; expiresAt: number }> | null = null
  let pending: Promise<boolean> | null = null
  return async () => {
    const checkedAt = now()
    if (cached && cached.expiresAt > checkedAt) return cached.value
    if (pending) return pending
    pending = provider.completionHealthCheck().then((value) => { cached = { value, expiresAt: now() + ttlMs }; return value }).finally(() => { pending = null })
    return pending
  }
}
/** Admin GraphQL shop probe used by readiness — never REST `/shop.json`. */
export const SHOP_PROBE_QUERY = `query ShopProbe {
  shop {
    name
    myshopifyDomain
    plan {
      displayName
    }
  }
}`

export function shopifyHealth(env: Readonly<Record<string, string | undefined>>, transport: typeof fetch = fetch): () => Promise<boolean> {
  const shop = env.SHOPIFY_HEALTH_SHOP?.trim(); const token = env.SHOPIFY_HEALTH_ACCESS_TOKEN?.trim()
  if (!shop || !token) return async () => false
  const version = env.SHOPIFY_API_VERSION?.trim() || '2026-07'
  return async () => {
    const response = await transport(`https://${shop}/admin/api/${version}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ query: SHOP_PROBE_QUERY }),
    })
    if (!response.ok) return false
    const payload = await response.json().catch(() => null) as { data?: { shop?: unknown } } | null
    return Boolean(payload?.data?.shop)
  }
}
