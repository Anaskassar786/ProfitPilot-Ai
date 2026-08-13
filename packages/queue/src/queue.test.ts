import { describe, expect, it } from 'vitest'
import { InMemoryQueue, UpstashQueue } from './index.js'
import { jobId, storeId } from '@profitpilot/types'

const baseJob = { id: jobId('job-1'), storeId: storeId('store-1'), type: 'sync.products', data: { cursor: null } }

describe('idempotent in-memory queue', () => {
  it('enqueues a job', async () => {
    const queue = new InMemoryQueue()
    const result = await queue.enqueue(baseJob, { now: 100 })
    expect(result.accepted).toBe(true)
    expect(result.job.status).toBe('queued')
  })
  it('deduplicates a second enqueue by job id', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(baseJob)
    const duplicate = await queue.enqueue(baseJob)
    expect(duplicate.accepted).toBe(false)
    expect(queue.size()).toBe(1)
  })
  it('does not reserve a delayed job too early', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(baseJob, { delayMs: 100, now: 10 })
    expect(await queue.reserve(50)).toBeNull()
    expect(await queue.reserve(110)).not.toBeNull()
  })
  it('marks a reserved job as processing', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(baseJob)
    const reserved = await queue.reserve()
    expect(reserved?.status).toBe('processing')
    expect(reserved?.attempts).toBe(1)
  })
  it('completes a reserved job without removing its ledger', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(baseJob)
    await queue.reserve()
    await queue.complete(baseJob.id)
    expect(queue.size()).toBe(0)
    expect(await queue.enqueue(baseJob)).toMatchObject({ accepted: false })
  })
  it('requeues a failed job while attempts remain', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(baseJob, { maxAttempts: 2 })
    await queue.reserve(100)
    const retry = await queue.fail(baseJob.id, 'timeout', 100)
    expect(retry?.status).toBe('queued')
    expect(retry?.lastError).toBe('timeout')
  })
  it('marks a job failed after max attempts', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(baseJob, { maxAttempts: 1 })
    await queue.reserve()
    const failed = await queue.fail(baseJob.id, 'bad response')
    expect(failed?.status).toBe('failed')
  })
  it('returns null for an unknown failure', async () => {
    const queue = new InMemoryQueue()
    expect(await queue.fail(jobId('unknown'), 'missing')).toBeNull()
  })
  it('rejects completing an unknown job', async () => {
    await expect(new InMemoryQueue().complete(jobId('unknown'))).rejects.toThrow('Unknown job')
  })
  it('reports queued and processing jobs', async () => {
    const queue = new InMemoryQueue()
    await queue.enqueue(baseJob)
    expect(queue.size()).toBe(1)
    await queue.reserve()
    expect(queue.size()).toBe(1)
  })
})

describe('Upstash queue transport', () => {
  it('pushes a job only after reserving its idempotency key', async () => {
    const commands: string[][] = []
    const fetcher = async (_input: string, init: RequestInit): Promise<Response> => {
      const command = JSON.parse(String(init.body)) as string[]
      commands.push(command)
      return new Response(JSON.stringify({ result: command[0] === 'SET' ? 'OK' : null }), { status: 200 })
    }
    const queue = new UpstashQueue('https://redis.example', 'token', 'jobs', fetcher)
    const result = await queue.enqueue(baseJob)
    expect(result.accepted).toBe(true)
    expect(commands[0]?.[0]).toBe('SET')
    expect(commands[1]?.[0]).toBe('RPUSH')
  })
  it('returns no job for an empty list', async () => {
    const fetcher = async (): Promise<Response> => new Response(JSON.stringify({ result: null }), { status: 200 })
    expect(await new UpstashQueue('https://redis.example', 'token', 'jobs', fetcher).reserve()).toBeNull()
  })
  it('rejects failed transport responses', async () => {
    const fetcher = async (): Promise<Response> => new Response('', { status: 500 })
    await expect(new UpstashQueue('https://redis.example', 'token', 'jobs', fetcher).reserve()).rejects.toThrow('500')
  })
})
