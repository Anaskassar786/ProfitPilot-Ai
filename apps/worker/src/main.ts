import { loggerFromEnv } from '@profitpilot/logger'
import { InMemoryQueue, UpstashQueue } from '@profitpilot/queue'
import { WorkerRuntime } from './worker.js'
import { createWorkerHealthServer } from './health.js'
import { createInsightsDiscoveryRunner } from './insights-discovery-job.js'
import { createBillingJobs } from './billing-job.js'

const logger = loggerFromEnv(process.env)

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in worker', {
    reason: reason instanceof Error ? reason.message : String(reason),
    ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
  })
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in worker', {
    error: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  })
  process.exit(1)
})

const rawPort = process.env.PORT ?? process.env.WORKER_PORT ?? '3100'
const parsedPort = Number(rawPort)
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3100

const isUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim())
const queue = isUpstash
  ? new UpstashQueue(
      process.env.UPSTASH_REDIS_REST_URL!.trim(),
      process.env.UPSTASH_REDIS_REST_TOKEN!.trim(),
      process.env.UPSTASH_QUEUE_NAME?.trim() || 'profitpilot:jobs'
    )
  : new InMemoryQueue()

// PR #50: Insights Hub auto-discovery. The API owns the pipeline; the worker
// keeps the clock and dispatches daily (2:00 UTC) / weekly (Sunday) sweeps.
const insightsDiscovery = createInsightsDiscoveryRunner({
  env: process.env,
  fetcher: fetch,
  log: (message, context) => logger.info(message, context ?? {}),
})

// Billing background jobs (daily charge reconciliation + hourly trial nudges).
// Best-effort: null when the worker lacks DATABASE_URL/ENCRYPTION_KEY.
const billingJobs = createBillingJobs(process.env, logger)
if (!billingJobs) {
  logger.info('Billing background jobs disabled (DATABASE_URL/ENCRYPTION_KEY not configured)')
}

const runtime = new WorkerRuntime(
  queue,
  async (job) => {
    if (job.type === 'billing_reconcile') {
      if (!billingJobs) return
      const result = await billingJobs.reconcile()
      logger.info('Billing charge reconciliation completed', { jobId: String(job.id), ...result })
      return
    }
    if (job.type === 'trial_nudge') {
      if (!billingJobs) return
      const expiring = await billingJobs.nudge()
      if (expiring.length > 0) logger.info('Trial expiry nudge found expiring trials', { jobId: String(job.id), count: expiring.length })
      return
    }
    // `report_tick` and `sync` are not worker responsibilities (reports run via
    // the queue handler above; sync is API-driven over /sync). Skip them.
    if (job.type === 'report_tick' || job.type === 'sync') {
      return
    }
    if ((await insightsDiscovery.handle(job)) === 'handled') {
      return
    }
    throw new Error(`No worker handler configured for ${job.type}`)
  },
  logger
)

const state = {
  current: {
    startedAt: Date.now(),
    lastTickAt: null as number | null,
    lastOutcome: 'starting',
    running: true,
  },
}

const server = createWorkerHealthServer(port, state, () => {
  logger.info('ProfitPilot worker health server listening', {
    port,
    host: '0.0.0.0',
    endpoints: ['/health', '/live', '/ready'],
  })
})

logger.info('ProfitPilot worker started', {
  entry: 'apps/worker/dist/main.js',
  port,
  queueType: isUpstash ? 'upstash' : 'in-memory',
  node: process.version,
  environment: process.env.NODE_ENV ?? 'development',
  pid: process.pid,
})

const intervalRaw = Number(process.env.REPORT_TICK_INTERVAL_MS ?? '3600000')
const intervalMs = Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : 3_600_000

// Hourly trial nudge + daily charge reconciliation run on the worker's own
// clock (nothing else enqueues those job types). The day/hour guards keep the
// runs idempotent if a `billing_reconcile`/`trial_nudge` queue job also lands.
let lastNudgeHour: number | null = null
let lastReconcileDay: string | null = null

const billingTick = async (now = Date.now()): Promise<void> => {
  if (!billingJobs) return
  const date = new Date(now)
  const hour = date.getUTCHours()
  const dayKey = date.toISOString().slice(0, 10)

  if (hour !== lastNudgeHour) {
    lastNudgeHour = hour
    try {
      const expiring = await billingJobs.nudge()
      if (expiring.length > 0) logger.info('Trial expiry nudge found expiring trials', { count: expiring.length })
    } catch (error: unknown) {
      logger.error('Trial expiry nudge failed', { reason: error instanceof Error ? error.message : String(error) })
    }
  }

  if (dayKey !== lastReconcileDay) {
    lastReconcileDay = dayKey
    try {
      const result = await billingJobs.reconcile()
      logger.info('Billing charge reconciliation completed', { ...result })
    } catch (error: unknown) {
      logger.error('Billing charge reconciliation failed', { reason: error instanceof Error ? error.message : String(error) })
    }
  }
}

const tick = async (): Promise<void> => {
  const outcome = await runtime.tick()
  await billingTick()
  state.current = {
    ...state.current,
    lastTickAt: Date.now(),
    lastOutcome: outcome,
  }
}

void tick().catch((error: unknown) => {
  state.current = {
    ...state.current,
    lastTickAt: Date.now(),
    lastOutcome: 'failed',
  }
  logger.error(error instanceof Error ? error.message : 'Worker tick failed')
})

const timer = setInterval(() => {
  void tick()
}, intervalMs)

const shutdown = (signal: string): void => {
  logger.info(`ProfitPilot worker shutting down on ${signal}`)
  clearInterval(timer)
  state.current = { ...state.current, running: false }
  server.close(() => {
    logger.info('ProfitPilot worker health server closed')
  })
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
