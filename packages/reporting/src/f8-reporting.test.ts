import { describe, expect, it } from 'vitest'
import { CloudflareR2ObjectStore, InMemoryReportObjectStore, InMemoryReportRepository, ReportService, isSixHourlyTick } from './index.js'

const period = { start: '2024-05-01T00:00:00.000Z', end: '2024-05-07T23:59:59.000Z' }
const dataProvider = { async get(storeId: string) { return { storeId, currency: 'USD', summary: 'closed', rows: [{ metric: 'revenue', value: 189, source: 'analytics' }] } } }

describe('F8 deterministic PDF vault', () => {
  it('generates a real PDF in R2 and converges on regeneration', async () => {
    const repository = new InMemoryReportRepository()
    const objects = new InMemoryReportObjectStore()
    const service = new ReportService(repository, objects, dataProvider, null, () => Date.parse('2024-06-01T00:00:00.000Z'))
    const first = await service.generate({ storeId: 'store-1', frequency: 'WEEKLY', period, email: true })
    expect(first.run.status).toBe('COMPLETED')
    expect(first.run.emailStatus).toBe('EMAIL_UNAVAILABLE')
    expect(first.file?.contentType).toBe('application/pdf')
    expect(first.file?.body.subarray(0, 8).toString()).toBe('%PDF-1.4')
    const second = await service.generate({ storeId: 'store-1', frequency: 'WEEKLY', period, email: true })
    expect(second.run.id).toBe(first.run.id)
    expect(second.run.status).toBe('COMPLETED')
    await expect(service.download('store-1', first.run.id)).resolves.toMatchObject({ run: { filename: first.run.filename } })
  })

  it('sends idempotent reports when delivery is available and rejects open periods', async () => {
    let sends = 0
    const service = new ReportService(new InMemoryReportRepository(), new InMemoryReportObjectStore(), dataProvider, { send: async () => { sends += 1 } }, () => Date.parse('2024-06-01T00:00:00.000Z'))
    const result = await service.generate({ storeId: 'store-2', frequency: 'MONTHLY', period, email: true })
    expect(result.run.emailStatus).toBe('SENT')
    expect(sends).toBe(1)
    await expect(service.generate({ storeId: 'store-3', frequency: 'DAILY', period: { start: '2024-07-01', end: '2024-07-02' }, email: false })).rejects.toThrow('closed')
  })

  it('marks delivery failures honestly and validates schedules', async () => {
    const service = new ReportService(new InMemoryReportRepository(), new InMemoryReportObjectStore(), dataProvider, { send: async () => { throw new Error('smtp down') } }, () => Date.parse('2024-06-01T00:00:00.000Z'))
    const result = await service.generate({ storeId: 'store-3', frequency: 'DAILY', period, email: true })
    expect(result.run.emailStatus).toBe('FAILED')
    await expect(service.saveSchedule({ id: 's', storeId: 'store-3', frequency: 'DAILY', enabled: true, nextRunAt: 100, version: 0 })).resolves.toMatchObject({ id: 's' })
    expect(await service.schedules('store-3')).toHaveLength(1)
    expect(isSixHourlyTick(Date.parse('2024-06-01T06:00:00.000Z'))).toBe(true)
    expect(isSixHourlyTick(Date.parse('2024-06-01T06:01:00.000Z'))).toBe(false)
  })

  it('completes reports without R2 by storing the PDF in the vault and signs Cloudflare requests', async () => {
    const service = new ReportService(new InMemoryReportRepository(), null, dataProvider, null, () => Date.parse('2024-06-01T00:00:00.000Z'))
    const generated = await service.generate({ storeId: 'store-4', frequency: 'WEEKLY', period, email: false })
    expect(generated.run.status).toBe('COMPLETED')
    expect((await service.download('store-4', generated.run.id)).body.subarray(0, 8).toString()).toBe('%PDF-1.4')
    const calls: RequestInit[] = []
    const store = new CloudflareR2ObjectStore({ endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'reports', accessKeyId: 'key', secretAccessKey: 'secret', fetcher: async (_input, init) => { calls.push(init); return new Response('', { status: 200, headers: { etag: 'etag-1' } }) } })
    await expect(store.put('store-1/report.pdf', Buffer.from('pdf'), 'application/pdf')).resolves.toMatchObject({ etag: 'etag-1' })
    expect(Object.keys((calls[0]?.headers ?? {}) as Readonly<Record<string, unknown>>).map((key) => key.toLowerCase())).toContain('authorization')
    await expect(store.get('missing')).resolves.toEqual(Buffer.from(''))
  })

  it('enforces the monthly report quota and never double-charges an idempotent replay', async () => {
    let consumed = 0
    const quota = {
      plan: async () => 'trial' as const,
      limitFor: () => 1 as const,
      consume: async () => {
        if (consumed >= 1) return { allowed: false, used: consumed }
        consumed += 1
        return { allowed: true, used: consumed }
      },
      refund: async () => { consumed = Math.max(0, consumed - 1) },
    }
    const service = new ReportService(new InMemoryReportRepository(), new InMemoryReportObjectStore(), dataProvider, null, () => Date.parse('2024-06-01T00:00:00.000Z'), quota)
    const first = await service.generate({ storeId: 'store-q', frequency: 'MONTHLY', period, email: false })
    expect(first.run.status).toBe('COMPLETED')
    expect(consumed).toBe(1)
    // Replaying the same period is idempotent: the stored run is returned and
    // the quota is not charged a second time.
    const replay = await service.generate({ storeId: 'store-q', frequency: 'MONTHLY', period, email: false })
    expect(replay.run.id).toBe(first.run.id)
    expect(consumed).toBe(1)
    // A different closed period is a fresh report and now exceeds the quota.
    await expect(service.generate({ storeId: 'store-q', frequency: 'MONTHLY', period: { start: '2024-04-01T00:00:00.000Z', end: '2024-04-30T23:59:59.000Z' }, email: false })).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED', status: 402 })
  })

  it('refunds the reserved quota slot when generation fails', async () => {
    let consumed = 0
    const quota = {
      plan: async () => 'trial' as const,
      limitFor: () => 1 as const,
      consume: async () => { consumed += 1; return { allowed: true, used: consumed } },
      refund: async () => { consumed = Math.max(0, consumed - 1) },
    }
    const failingProvider = { async get() { throw new Error('analytics down') } }
    const service = new ReportService(new InMemoryReportRepository(), new InMemoryReportObjectStore(), failingProvider, null, () => Date.parse('2024-06-01T00:00:00.000Z'), quota)
    await expect(service.generate({ storeId: 'store-f', frequency: 'MONTHLY', period, email: false })).rejects.toThrow('analytics down')
    expect(consumed).toBe(0)
  })

  it('surfaces invalid periods as a 400 validation error instead of a 500', async () => {
    const service = new ReportService(new InMemoryReportRepository(), new InMemoryReportObjectStore(), dataProvider, null, () => Date.parse('2024-06-01T00:00:00.000Z'))
    await expect(service.generate({ storeId: 'store-6', frequency: 'DAILY', period: { start: '2024-07-01', end: '2024-07-02' }, email: false })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 })
  })

  it('emails an already-completed report on request without regenerating the PDF', async () => {
    let sends = 0
    const service = new ReportService(new InMemoryReportRepository(), new InMemoryReportObjectStore(), dataProvider, { send: async () => { sends += 1 } }, () => Date.parse('2024-06-01T00:00:00.000Z'))
    const first = await service.generate({ storeId: 'store-e', frequency: 'MONTHLY', period, email: false })
    expect(first.run.emailStatus).toBe('NOT_REQUESTED')
    const emailed = await service.generate({ storeId: 'store-e', frequency: 'MONTHLY', period, email: true })
    expect(emailed.run.id).toBe(first.run.id)
    expect(emailed.run.emailStatus).toBe('SENT')
    expect(sends).toBe(1)
  })

  it('recovers stale GENERATING runs to FAILED so the UI never spins forever', async () => {
    const repository = new InMemoryReportRepository()
    const now = () => Date.parse('2024-06-01T12:00:00.000Z')
    const service = new ReportService(repository, new InMemoryReportObjectStore(), dataProvider, null, now)
    const generated = await service.generate({ storeId: 'store-stale', frequency: 'MONTHLY', period, email: false })
    expect(generated.run.status).toBe('COMPLETED')
    // Simulate a crashed generation: write a GENERATING run with an old
    // createdAt directly into the repository.
    const staleRun = {
      ...generated.run,
      id: 'stale-1',
      idempotencyKey: 'MONTHLY:2024-03-01:2024-03-31',
      period: { start: '2024-03-01T00:00:00.000Z', end: '2024-03-31T23:59:59.000Z' },
      filename: 'stale.pdf',
      objectKey: 'reports/store-stale/stale.pdf',
      status: 'GENERATING' as const,
      createdAt: Date.parse('2024-06-01T09:00:00.000Z'),
      completedAt: null,
    }
    await repository.createRunIfAbsent(staleRun)
    // Fresh GENERATING runs (< staleness window) are left untouched.
    const freshRun = { ...staleRun, id: 'fresh-1', idempotencyKey: 'MONTHLY:2024-02-01:2024-02-28', period: { start: '2024-02-01T00:00:00.000Z', end: '2024-02-28T23:59:59.000Z' }, createdAt: now() }
    await repository.createRunIfAbsent(freshRun)

    const listed = await service.list('store-stale')
    const stale = listed.find((run) => run.id === 'stale-1')
    expect(stale?.status).toBe('FAILED')
    const fresh = listed.find((run) => run.id === 'fresh-1')
    expect(fresh?.status).toBe('GENERATING')
    // The recovery is persisted: a fresh list shows the same terminal state.
    expect((await repository.listRuns('store-stale')).find((run) => run.id === 'stale-1')?.status).toBe('FAILED')
    // Re-generating the same period after a crash re-drives to COMPLETED.
    const retried = await service.generate({ storeId: 'store-stale', frequency: 'MONTHLY', period: staleRun.period, email: false })
    expect(retried.run.status).toBe('COMPLETED')
    expect(retried.run.id).not.toBe('stale-1')
  })
})
