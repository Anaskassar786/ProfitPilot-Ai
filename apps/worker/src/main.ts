import { loggerFromEnv } from '@profitpilot/logger'
import { InMemoryQueue, UpstashQueue } from '@profitpilot/queue'
import { WorkerRuntime } from './worker.js'
import { createWorkerHealthServer } from './health.js'

const logger = loggerFromEnv(process.env)
const queue = process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ? new UpstashQueue(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN, process.env.UPSTASH_QUEUE_NAME?.trim() || 'profitpilot:jobs')
  : new InMemoryQueue()
const runtime = new WorkerRuntime(queue, async (job) => { if (job.type === 'report_tick') return; throw new Error(`No worker handler configured for ${job.type}`) }, logger)
const state = { current: { startedAt: Date.now(), lastTickAt: null as number | null, lastOutcome: 'starting', running: true } }
const server = createWorkerHealthServer(Number(process.env.WORKER_PORT ?? '3100'), state)
const intervalMs = Number(process.env.REPORT_TICK_INTERVAL_MS ?? '3600000')
const tick = async (): Promise<void> => { const outcome = await runtime.tick(); state.current = { ...state.current, lastTickAt: Date.now(), lastOutcome: outcome } }
void tick().catch((error: unknown) => { state.current = { ...state.current, lastTickAt: Date.now(), lastOutcome: 'failed' }; logger.error(error instanceof Error ? error.message : 'Worker tick failed') })
const timer = setInterval(() => { void tick() }, Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 3_600_000)
const shutdown = (): void => { clearInterval(timer); state.current = { ...state.current, running: false }; server.close(() => undefined) }
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
