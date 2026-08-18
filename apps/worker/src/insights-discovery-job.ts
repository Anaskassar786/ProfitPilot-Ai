/**
 * PatternAI (formerly Insights Hub) auto-discovery worker jobs.
 *
 * The scheduler enqueues sweep jobs; each store's pipeline runs inside the
 * API process (it owns the dataset, the plan matrix, and RLS tenant context).
 * The worker is the clock + the courier:
 *
 *   insights_discovery_sweep  { storeIds, reason }  → one POST per store
 *   insights_discovery        { storeId }           → a single POST
 *
 * POST /insights/auto-discovery/run is CSRF-protected like every unsafe
 * route, so the runner performs the same double-submit handshake the browser
 * client does (GET /security/csrf, replay cookie + x-csrf-token header).
 * Per-store failures never fail the sweep — they are recorded in the result
 * and the queue only sees an exception when every store failed.
 */

import type { QueueJob } from '@profitpilot/queue'

export const INSIGHTS_DISCOVERY_JOB = 'insights_discovery'
export const INSIGHTS_DISCOVERY_SWEEP_JOB = 'insights_discovery_sweep'

export type InsightsDiscoveryReason = 'daily' | 'weekly' | 'realtime' | 'manual'

export type InsightsDiscoveryJobPayload =
  | Readonly<{ kind: 'store'; storeId: string; reason?: InsightsDiscoveryReason }>
  | Readonly<{ kind: 'sweep'; storeIds: readonly string[]; reason?: InsightsDiscoveryReason }>

export type InsightsDiscoveryRunResult = Readonly<{ storeId: string; ok: boolean; generated: number; error: string | null }>
export type InsightsDiscoverySweepResult = Readonly<{ attempted: number; succeeded: number; failed: number; results: readonly InsightsDiscoveryRunResult[] }>

export type InsightsDiscoveryRunner = Readonly<{
  jobTypes: readonly string[]
  enabled: boolean
  handle: (job: QueueJob<unknown>) => Promise<'handled' | 'ignored'>
  runStore: (storeId: string, reason?: InsightsDiscoveryReason) => Promise<InsightsDiscoveryRunResult>
  runSweep: (payload: Readonly<{ storeIds: readonly string[]; reason?: InsightsDiscoveryReason }>) => Promise<InsightsDiscoverySweepResult>
}>

export type InsightsDiscoveryEnv = Readonly<Record<string, string | undefined>>

export type FetchLike = (input: string, init?: Readonly<{ method?: string; headers?: Readonly<Record<string, string>>; body?: string }>) => Promise<Readonly<{ ok: boolean; status: number; json: () => Promise<unknown>; headers: Readonly<{ get: (name: string) => string | null }> }>>

/** Local Development default mirrors apps/api main.ts (PORT ?? 3000). */
export function insightsDiscoveryApiBase(env: InsightsDiscoveryEnv): string {
  const explicit = env.INSIGHTS_HUB_API_BASE_URL ?? env.API_BASE_URL
  if (explicit && explicit.trim()) return explicit.replace(/\/+$/, '')
  const port = env.PORT ?? '3000'
  return `http://127.0.0.1:${port}`
}

export function insightsDiscoveryEnabled(env: InsightsDiscoveryEnv): boolean {
  return (env.INSIGHTS_HUB_ENABLED ?? 'true').toLowerCase() !== 'false' && (env.INSIGHTS_HUB_AUTO_DISCOVERY_ENABLED ?? 'true').toLowerCase() !== 'false'
}

export function createInsightsDiscoveryRunner(options: Readonly<{ env: InsightsDiscoveryEnv; fetcher: FetchLike; log?: (message: string, context?: Readonly<Record<string, string | number>>) => void }>): InsightsDiscoveryRunner {
  const base = insightsDiscoveryApiBase(options.env)
  const enabled = insightsDiscoveryEnabled(options.env)
  const fetcher = options.fetcher
  const log = (message: string, context?: Readonly<Record<string, string | number>>) => options.log?.(message, context)

  /** Double-submit CSRF handshake, mirroring apps/web/src/api.ts. */
  const csrf = async (): Promise<Readonly<{ token: string; cookie: string } | null>> => {
    try {
      const response = await fetcher(`${base}/security/csrf`, { method: 'GET' })
      const payload: unknown = await response.json()
      const token = isRecord(payload) && isRecord(payload.data) && typeof payload.data.csrfToken === 'string' ? payload.data.csrfToken : null
      const setCookie = response.headers.get('set-cookie') ?? ''
      const cookie = setCookie.split(';', 1)[0]?.trim() ?? ''
      if (!token || !cookie) return null
      return { token, cookie: `profitpilot_csrf=${cookie.replace(/^profitpilot_csrf=/, '')}` }
    } catch {
      return null
    }
  }

  const runStore = async (storeId: string, reason: InsightsDiscoveryReason = 'daily'): Promise<InsightsDiscoveryRunResult> => {
    try {
      if (!enabled) return { storeId, ok: true, generated: 0, error: null }
      const handshake = await csrf()
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-insights-worker': 'auto-discovery' }
      if (handshake) {
        headers['x-csrf-token'] = handshake.token
        headers.cookie = handshake.cookie
      }
      const response = await fetcher(`${base}/insights/auto-discovery/run`, { method: 'POST', headers, body: JSON.stringify({ storeId, reason }) })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string' ? payload.error.message : `HTTP ${response.status}`
        // 402/429 (plan wall, quota, rate limit) are steady-state outcomes,
        // not sweep failures: the store simply could not generate more today.
        if (response.status === 402 || response.status === 429) return { storeId, ok: true, generated: 0, error: message }
        return { storeId, ok: false, generated: 0, error: message }
      }
      const generated = isRecord(payload) && isRecord(payload.data) && typeof payload.data.generated === 'number' ? payload.data.generated : 0
      return { storeId, ok: true, generated, error: null }
    } catch (error: unknown) {
      return { storeId, ok: false, generated: 0, error: error instanceof Error ? error.message : 'network failure' }
    }
  }

  const runSweep = async (payload: Readonly<{ storeIds: readonly string[]; reason?: InsightsDiscoveryReason }>): Promise<InsightsDiscoverySweepResult> => {
    const results: InsightsDiscoveryRunResult[] = []
    for (const storeId of payload.storeIds) {
      const result = await runStore(storeId, payload.reason ?? 'daily')
      results.push(result)
      log('Insights auto-discovery store tick', { storeId, ok: result.ok ? 1 : 0, generated: result.generated })
    }
    const failed = results.filter((result) => !result.ok).length
    return { attempted: results.length, succeeded: results.length - failed, failed, results }
  }

  const handle = async (job: QueueJob<unknown>): Promise<'handled' | 'ignored'> => {
    if (job.type === INSIGHTS_DISCOVERY_JOB) {
      if (!enabled) { log('Insights discovery job skipped — module disabled', { jobId: String(job.id) }); return 'handled' }
      const payload = job.data
      const storeId = isRecord(payload) && typeof payload.storeId === 'string' ? payload.storeId : null
      if (!storeId) throw new Error('insights_discovery job requires data.storeId')
      const result = await runStore(storeId, isRecord(payload) && typeof payload.reason === 'string' ? (payload.reason as InsightsDiscoveryReason) : 'daily')
      if (!result.ok) throw new Error(`insights discovery failed for ${storeId}: ${result.error ?? 'unknown'}`)
      return 'handled'
    }
    if (job.type === INSIGHTS_DISCOVERY_SWEEP_JOB) {
      if (!enabled) { log('Insights discovery sweep skipped — module disabled', { jobId: String(job.id) }); return 'handled' }
      const payload = job.data
      const storeIds = isRecord(payload) && Array.isArray(payload.storeIds) ? payload.storeIds.filter((id): id is string => typeof id === 'string') : []
      if (storeIds.length === 0) { log('Insights discovery sweep received an empty store list', { jobId: String(job.id) }); return 'handled' }
      const result = await runSweep({ storeIds, ...(isRecord(payload) && typeof payload.reason === 'string' ? { reason: payload.reason as InsightsDiscoveryReason } : {}) })
      log('Insights discovery sweep complete', { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed })
      if (result.attempted > 0 && result.succeeded === 0) throw new Error('insights discovery sweep failed for every store')
      return 'handled'
    }
    return 'ignored'
  }

  return { jobTypes: [INSIGHTS_DISCOVERY_JOB, INSIGHTS_DISCOVERY_SWEEP_JOB], enabled, handle, runStore, runSweep }
}

/* ── Scheduling helpers (who should be swept, and when) ────────────────── */

/**
 * The daily sweep fires at 02:00 UTC; weekly stores ride the Sunday tick.
 * A scheduler enqueueing sweeps asks this whether the current tick qualifies
 * — keeping the "when" in one deterministic, testable place.
 */
export function insightsSweepDue(at: number, weeklyAlso = true, now = new Date(at)): boolean {
  if (now.getUTCHours() !== 2) return false
  if (weeklyAlso) return true
  return now.getUTCDay() === 0
}

/** Builds the enqueue payload for a sweep, deduping store ids. */
export function insightsDiscoverySweepJob(ownerStoreId: string, storeIds: readonly string[], reason: InsightsDiscoveryReason = 'daily'): Readonly<{ storeId: string; type: string; data: InsightsDiscoveryJobPayload }> {
  return { storeId: ownerStoreId, type: INSIGHTS_DISCOVERY_SWEEP_JOB, data: { kind: 'sweep', storeIds: [...new Set(storeIds)], reason } }
}

/** Builds the enqueue payload for a single-store discovery run. */
export function insightsDiscoveryStoreJob(storeId: string, reason: InsightsDiscoveryReason = 'daily'): Readonly<{ storeId: string; type: string; data: InsightsDiscoveryJobPayload }> {
  return { storeId, type: INSIGHTS_DISCOVERY_JOB, data: { kind: 'store', storeId, reason } }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
