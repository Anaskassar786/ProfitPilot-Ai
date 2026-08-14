import { describe, expect, it } from 'vitest'
import { F9ControlService, InMemoryF9ControlRepository } from './f9-controls.js'
import { AdminOpsService, InMemoryOpsQueue, UpstashOpsQueue } from './f9-ops.js'
import { NoopErrorMonitor, SentryMonitor, monitoringFromEnv, sentryFromEnv } from './index.js'
import { Logger } from '@profitpilot/logger'

describe('F9 launch controls', () => {
  it('toggles maintenance with CAS and audits the change', async () => {
    let now = 100
    const controls = new F9ControlService(new InMemoryF9ControlRepository(), () => now)
    expect((await controls.maintenance()).enabled).toBe(false)
    const next = await controls.setMaintenance({ enabled: true, message: 'Deploying', actorId: 'admin', expectedVersion: 0 })
    expect(next.enabled).toBe(true)
    expect((await controls.audit())[0]?.action).toBe('MAINTENANCE_CHANGED')
    await expect(controls.setMaintenance({ enabled: false, message: '', actorId: 'admin', expectedVersion: 0 })).rejects.toThrow('changed')
    now += 1
    const flags = await controls.setFlags({ storeId: 'store-1', aiEnabled: false, automationEnabled: true, suspended: false, actorId: 'admin', expectedVersion: 0 })
    expect(flags.aiEnabled).toBe(false)
    expect((await controls.flags('store-2')).aiEnabled).toBe(true)
    await expect(controls.setFlags({ storeId: 'store-1', aiEnabled: true, automationEnabled: true, suspended: false, actorId: 'admin', expectedVersion: 0 })).rejects.toThrow('changed')
  })
})

describe('F9 admin queue operations', () => {
  it('inspects failed/dead-letter jobs and retries them', async () => {
    const queue = new InMemoryOpsQueue()
    queue.add({ id: 'job-1', storeId: 'store-1', type: 'sync', status: 'failed', attempts: 2, lastError: 'timeout', availableAt: 1, createdAt: 1 })
    queue.add({ id: 'job-2', storeId: 'store-2', type: 'email', status: 'dead-letter', attempts: 3, lastError: 'bad', availableAt: 1, createdAt: 1 })
    const ops = new AdminOpsService(queue)
    ops.recordCompleted(); ops.recordFailed()
    expect((await ops.snapshot()).failed).toBe(1)
    expect((await ops.retry('job-1')).status).toBe('queued')
    expect((await ops.metrics()).retried).toBe(1)
    expect(ops.activityFor('store-1')[0]?.event).toBe('job_retried')
    await expect(ops.retry('missing')).rejects.toThrow('not found')
  })

  it('uses Upstash commands and parses malformed entries safely', async () => {
    const calls: string[] = []
    const queue = new UpstashOpsQueue('https://redis.example', 'token', 'jobs', 'dead', async (_url, init) => { calls.push(String(init.body)); const command = JSON.parse(String(init.body)) as readonly string[]; if (command[0] === 'LRANGE') return new Response(JSON.stringify({ result: command[1] === 'dead' ? ['bad-json'] : [JSON.stringify({ id: 'job', storeId: 'store', type: 'sync', status: 'failed', attempts: 1, lastError: 'x', availableAt: 1, createdAt: 1 })] }), { status: 200 }); return new Response(JSON.stringify({ result: null }), { status: 200 }) })
    const snapshot = await queue.snapshot()
    expect(snapshot.failed).toBe(1)
    await expect(queue.retry('job')).resolves.toMatchObject({ status: 'queued' })
    expect(calls.some((call) => call.includes('LPUSH'))).toBe(true)
    await expect(new UpstashOpsQueue('https://redis.example', 'token', 'jobs', 'dead', async () => new Response('', { status: 500 })).snapshot()).rejects.toThrow('500')
  })
})

describe('F9 Sentry monitoring', () => {
  it('uses no-op monitoring without a DSN', () => { expect(monitoringFromEnv({}, new Logger())).toBeInstanceOf(NoopErrorMonitor); expect(sentryFromEnv({})).toHaveProperty('capture') })
  it('sends grouped store-aware events and performance spans', async () => {
    const requests: RequestInit[] = []
    const monitor = new SentryMonitor({ dsn: 'https://public@example.sentry.io/42', release: 'release-1', environment: 'test', fetcher: async (_url, init) => { requests.push(init); return new Response('', { status: 200 }) } })
    monitor.captureStore(new Error('boom'), 'store-1', { route: '/test' })
    const span = monitor.startSpan('GET /ready')
    await span.finish('ok')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(2)
    expect(String(requests[0]?.body)).toContain('storeId')
    expect(String(requests[0]?.body)).toContain('release-1')
  })
  it('rejects malformed DSNs and swallows transport failures', async () => {
    expect(() => new SentryMonitor({ dsn: 'not-a-dsn', release: 'r', environment: 'test' })).toThrow('invalid')
    const monitor = new SentryMonitor({ dsn: 'https://public@example.sentry.io/42', release: 'r', environment: 'test', fetcher: async () => { throw new Error('offline') } })
    expect(() => monitor.capture(new Error('safe'))).not.toThrow()
  })
})
