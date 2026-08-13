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
    expect(second.file).toBeNull()
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

  it('fails honestly when R2 is not configured and signs Cloudflare requests', async () => {
    const service = new ReportService(new InMemoryReportRepository(), null, dataProvider, null, () => Date.parse('2024-06-01T00:00:00.000Z'))
    await expect(service.generate({ storeId: 'store-4', frequency: 'WEEKLY', period, email: false })).rejects.toThrow('R2')
    const calls: RequestInit[] = []
    const store = new CloudflareR2ObjectStore({ endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'reports', accessKeyId: 'key', secretAccessKey: 'secret', fetcher: async (_input, init) => { calls.push(init); return new Response('', { status: 200, headers: { etag: 'etag-1' } }) } })
    await expect(store.put('store-1/report.pdf', Buffer.from('pdf'), 'application/pdf')).resolves.toMatchObject({ etag: 'etag-1' })
    expect(Object.keys((calls[0]?.headers ?? {}) as Readonly<Record<string, unknown>>).map((key) => key.toLowerCase())).toContain('authorization')
    await expect(store.get('missing')).resolves.toEqual(Buffer.from(''))
  })
})
