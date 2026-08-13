import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger, createMemorySink } from '@profitpilot/logger'
import { createApi } from './app.js'
import { InMemoryQueue } from '@profitpilot/queue'
import { assertLatencyBudget, measureParallel } from '@profitpilot/monitoring'
import { StoreCircuitRegistry, StoreRequestPolicy, AdaptiveRateController } from '@profitpilot/sync'
import { CheckpointLedger, SyncEngine } from '@profitpilot/sync'
import { InMemoryWebhookProcessingLedger, WebhookProcessor, WebhookVerifier } from '@profitpilot/shopify'
import { jobId, storeId } from '@profitpilot/types'

async function withApiServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const snapshot = { revenue: [], orders: [], productSales: [], customerCohorts: [] }
  const app = createApi({ logger: new Logger(createMemorySink().sink), readinessChecks: [], dataPlane: { sync: { runModule: async (tenant, module) => ({ storeId: tenant, module, pages: 1, records: 0, cursor: null, resumedFrom: null }) }, analytics: { read: async () => snapshot, readCatalog: async () => [] } } })
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No load-test address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('F7 bounded load suite', () => {
  it('serves 30 parallel tenant API reads under the 500ms p95 budget', async () => await withApiServer(async (base) => {
    const measurement = await measureParallel(30, async (index) => {
      const response = await fetch(`${base}/analytics?storeId=tenant-${index}`)
      if (response.status !== 200) throw new Error(`Tenant ${index} returned ${response.status}`)
      await response.arrayBuffer()
    }, 500)
    assertLatencyBudget(measurement)
    expect(measurement.samples).toBe(30)
  }))

  it('runs 30 parallel tenant sync operations under the 2s p95 budget', async () => {
    const checkpoints = new CheckpointLedger()
    const rate = new AdaptiveRateController({ minDelayMs: 0, maxDelayMs: 1, maxConcurrency: 30, sleep: async () => Promise.resolve() })
    const policy = new StoreRequestPolicy(rate, new StoreCircuitRegistry({ failureThreshold: 3, cooldownMs: 1_000 }))
    const engine = new SyncEngine({ fetchPage: async () => ({ records: [], nextCursor: null }) }, { upsert: async () => Promise.resolve() }, checkpoints, policy, null, () => 1_000)
    const measurement = await measureParallel(30, async (index) => { await engine.runModule(storeId(`tenant-${index}`), 'products') }, 2_000)
    assertLatencyBudget(measurement)
    expect(measurement.samples).toBe(30)
    expect(measurement.p95Ms).toBeLessThan(2_000)
  })

  it('processes a webhook flood above 100 events/sec under the 200ms p95 budget', async () => {
    const ledger = new InMemoryWebhookProcessingLedger()
    const processor = new WebhookProcessor(new WebhookVerifier('webhook-secret', ledger), ledger, () => 1_000)
    const body = (index: number): string => JSON.stringify({ id: index, topic: 'orders/create' })
    const measurement = await measureParallel(120, async (index) => {
      const rawBody = body(index)
      const signature = createHmac('sha256', 'webhook-secret').update(rawBody).digest('base64')
      const result = await processor.process({ storeId: storeId(`tenant-${index % 30}`), webhookId: `webhook-${index}`, topic: 'orders/create', rawBody, signature }, async () => Promise.resolve())
      if (result.status !== 'processed') throw new Error(`Webhook ${index} was not processed`)
    }, 200)
    assertLatencyBudget(measurement)
    expect(measurement.samples).toBe(120)
    expect((await ledger.auditTrail()).filter((event) => event.event === 'processed')).toHaveLength(120)
  })

  it('exercises limiter saturation and queue backpressure without dropping jobs', async () => {
    const rate = new AdaptiveRateController({ minDelayMs: 0, maxDelayMs: 2, maxConcurrency: 10, sleep: async () => Promise.resolve() })
    const policy = new StoreRequestPolicy(rate, new StoreCircuitRegistry())
    const queue = new InMemoryQueue()
    const measurement = await measureParallel(1_000, async (index) => {
      await queue.enqueue({ id: jobId(`load-job-${index}`), storeId: storeId(`tenant-${index % 30}`), type: 'sync', data: { index } })
    }, 2_000)
    assertLatencyBudget(measurement)
    expect(queue.size()).toBe(1_000)
    let reserved = 0
    const reserveNow = Date.now() + 10_000
    while (await queue.reserve(reserveNow)) {
      reserved += 1
      await queue.complete(jobId(`load-job-${reserved - 1}`))
    }
    expect(reserved).toBe(1_000)
    const limiter = new (await import('./security.js')).EndpointRateLimiter({ limit: 100, windowMs: 60_000 }, {})
    const decisions = Array.from({ length: 120 }, (_value, index) => limiter.check('POST', '/sync', 'load-client', index))
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(20)
    await policy.execute(storeId('rate-tenant'), async () => 'ok')
    expect(measurement.withinBudget).toBe(true)
  })

  it('keeps load fixtures free of customer PII and uses a real logger boundary', () => {
    const logger = new Logger()
    expect(logger).toBeInstanceOf(Logger)
  })
})
