import { Logger } from '@profitpilot/logger'
import { AdminOpsService, F9ControlService, InMemoryOpsQueue, UpstashOpsQueue, monitoringFromEnv } from '@profitpilot/monitoring'
import type { ErrorMonitor, OpsQueueAdapter } from '@profitpilot/monitoring'
import { createF8Bootstrap } from './f8-bootstrap.js'
import type { F8Bootstrap } from './f8-bootstrap.js'
import { PostgresF9ControlRepository } from './f9-repositories.js'
import { normalizeEnvironment, requireStartupEnvironment } from './f9-config.js'
import { readinessChecksFromAdapters } from './readiness.js'
import type { DependencyCheck } from './readiness.js'

export type F9Bootstrap = Readonly<F8Bootstrap & { f9: Readonly<{ controls: F9ControlService; ops: AdminOpsService; monitor: ErrorMonitor; readinessChecks: readonly DependencyCheck[] }> }>

export function createF9Bootstrap(rawEnv: Readonly<Record<string, string | undefined>>, logger = new Logger()): F9Bootstrap | null {
  const env = normalizeEnvironment(rawEnv)
  const f8 = createF8Bootstrap(env)
  if (!f8) return null
  requireStartupEnvironment(env)
  const controls = new F9ControlService(new PostgresF9ControlRepository(f8.database))
  const queue: OpsQueueAdapter = env.UPSTASH_REDIS_REST_URL?.trim() && env.UPSTASH_REDIS_REST_TOKEN?.trim() ? new UpstashOpsQueue(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN) : new InMemoryOpsQueue()
  const ops = new AdminOpsService(queue, controls)
  const monitor = monitoringFromEnv(env, logger)
  const readinessChecks = readinessChecksFromAdapters({
    database: async () => { await f8.database.query('SELECT 1'); return true },
    redis: upstashPing(env),
    ai: openRouterHealth(env),
    shopify: shopifyHealth(env),
  })
  return { ...f8, f9: { controls, ops, monitor, readinessChecks } }
}

function upstashPing(env: Readonly<Record<string, string | undefined>>): () => Promise<boolean> {
  const url = env.UPSTASH_REDIS_REST_URL?.trim(); const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return async () => false
  return async () => { const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(['PING']) }); return response.ok }
}
function openRouterHealth(env: Readonly<Record<string, string | undefined>>): () => Promise<boolean> {
  const key = env.OPENROUTER_API_KEY_1?.trim()
  if (!key) return async () => false
  return async () => { const response = await fetch('https://openrouter.ai/api/v1/models', { headers: { authorization: `Bearer ${key}` } }); return response.ok }
}
function shopifyHealth(env: Readonly<Record<string, string | undefined>>): () => Promise<boolean> {
  const shop = env.SHOPIFY_HEALTH_SHOP?.trim(); const token = env.SHOPIFY_HEALTH_ACCESS_TOKEN?.trim()
  if (!shop || !token) return async () => false
  return async () => { const response = await fetch(`https://${shop}/admin/api/${env.SHOPIFY_API_VERSION?.trim() || '2025-10'}/shop.json`, { headers: { 'X-Shopify-Access-Token': token, accept: 'application/json' } }); return response.ok }
}
