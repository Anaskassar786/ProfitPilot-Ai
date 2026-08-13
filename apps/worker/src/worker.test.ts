import { describe, expect, it } from 'vitest'
import { Logger, createMemorySink } from '@profitpilot/logger'
import { InMemoryQueue } from '@profitpilot/queue'
import { jobId, storeId } from '@profitpilot/types'
import { WorkerRuntime } from './index.js'

const job = { id: jobId('job-1'), storeId: storeId('store-1'), type: 'test', data: { ok: true } }

describe('worker runtime', () => {
  it('returns idle when no jobs are available', async () => {
    const runtime = new WorkerRuntime(new InMemoryQueue(), async () => undefined, new Logger())
    await expect(runtime.tick()).resolves.toBe('idle')
  })
  it('completes a successful job and logs it', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(job)
    const memory = createMemorySink()
    const runtime = new WorkerRuntime(queue, async () => undefined, new Logger(memory.sink))
    await expect(runtime.tick()).resolves.toBe('completed')
    expect(memory.records[0]?.message).toBe('Job completed')
  })
  it('retries a failed job with a typed outcome', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(job, { maxAttempts: 2, now: 100 })
    const runtime = new WorkerRuntime(queue, async () => { throw new Error('boom') }, new Logger())
    await expect(runtime.tick(100)).resolves.toBe('failed')
    expect(queue.size()).toBe(1)
  })
})
