import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger } from '@profitpilot/logger'
import type { ExportRow } from '@profitpilot/reporting'
import type { ExportDataset, PlanTier } from '@profitpilot/types'
import { createApi } from './app.js'
import { ExportsService } from './exports-service.js'
import type { ExportDataSource, ExportDateRange } from './exports-service.js'
import { InMemoryExportHistoryRepository } from './exports-repository.js'

/**
 * Data Exports — API behaviour.
 *
 * Covers the whole merchant contract end to end over real HTTP: plan gating
 * per dataset, the monthly allowance, real file bytes for CSV/XLSX/PDF, empty
 * datasets refusing instead of shipping a blank file, custom date ranges, and
 * export history feeding the "last exported" line.
 */

const STORE = 'store-exports-1'

const ORDER_ROWS: readonly ExportRow[] = [
  { 'Order date': '2026-08-16', 'Orders placed': 12, 'Orders fulfilled': 11, 'Orders cancelled': 1, 'Average order value': 84.5 },
  { 'Order date': '2026-08-17', 'Orders placed': 9, 'Orders fulfilled': 9, 'Orders cancelled': 0, 'Average order value': 92.15 },
  { 'Order date': '2026-08-18', 'Orders placed': 15, 'Orders fulfilled': 12, 'Orders cancelled': 2, 'Average order value': 78.4 },
]
const CATALOG_ROWS: readonly ExportRow[] = [
  { 'Product ID': 'gid://shopify/Product/1', 'Product title': 'Everyday Hoodie', 'Last synced': '2026-08-18' },
  { 'Product ID': 'gid://shopify/Product/2', 'Product title': 'Trail Cap, Black', 'Last synced': '2026-08-18' },
]
const AUDIT_ROWS: readonly ExportRow[] = [
  { 'Action': 'orders synced', 'When': '2026-08-18T09:15:00.000Z', 'Reference': 'sync-1' },
]
const REVENUE_ROWS: readonly ExportRow[] = [
  { 'Day': '2026-08-17', 'Gross revenue': 829.35, 'Discounts': 12, 'Orders': 9 },
  { 'Day': '2026-08-18', 'Gross revenue': 1176, 'Discounts': 0, 'Orders': 15 },
]

class StubSource implements ExportDataSource {
  public constructor(private readonly data: Readonly<Partial<Record<ExportDataset, readonly ExportRow[]>>>) {}
  public async rows(_store: string, dataset: ExportDataset, range: ExportDateRange): Promise<readonly ExportRow[]> {
    const rows = this.data[dataset] ?? []
    if (!range.from && !range.to) return rows
    return rows.filter((row) => {
      const day = String(row['Order date'] ?? row['Day'] ?? '')
      if (range.from && day < range.from) return false
      if (range.to && day > range.to) return false
      return true
    })
  }
  public async estimates(): Promise<Readonly<Partial<Record<ExportDataset, number>>>> {
    const output: Partial<Record<ExportDataset, number>> = {}
    for (const [dataset, rows] of Object.entries(this.data)) output[dataset as ExportDataset] = rows.length
    return output
  }
}

const fullSource = (): StubSource => new StubSource({ orders: ORDER_ROWS, catalog: CATALOG_ROWS, audit: AUDIT_ROWS, revenue: REVENUE_ROWS })

type Harness = Readonly<{ base: string; history: InMemoryExportHistoryRepository; close: () => Promise<void> }>

async function harness(plan: PlanTier, source: ExportDataSource = fullSource()): Promise<Harness> {
  const history = new InMemoryExportHistoryRepository()
  const service = new ExportsService({ history, data: source, plan: async () => plan })
  const app = createApi({ logger: new Logger(), readinessChecks: [], exports: { service } })
  const server: Server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  return { base: `http://127.0.0.1:${address.port}`, history, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function withHarness<T>(plan: PlanTier, run: (harness: Harness) => Promise<T>, source?: ExportDataSource): Promise<T> {
  const created = await harness(plan, source)
  try { return await run(created) } finally { await created.close() }
}

const overview = async (base: string) => (await (await fetch(`${base}/exports/overview?storeId=${STORE}`)).json()).data
const download = async (base: string, dataset: ExportDataset, body: Record<string, unknown> = {}) =>
  fetch(`${base}/exports/${dataset}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: STORE, ...body }) })

describe('Data Exports — overview', () => {
  it('returns four merchant-named exports with real row estimates', async () => await withHarness('growth', async ({ base }) => {
    const data = await overview(base)
    expect(data.exports.map((card: { name: string }) => card.name)).toEqual(['Orders Export', 'Product Catalog', 'Activity Log', 'Revenue Report'])
    expect(data.exports.map((card: { format: string }) => card.format)).toEqual(['CSV', 'XLSX', 'CSV', 'PDF'])
    expect(data.exports[0].estimatedRows).toBe(3)
    expect(data.exports[1].estimatedRows).toBe(2)
    expect(data.rowCeiling).toBe(50_000)
  }))

  it('locks Activity Log and Revenue Report on Trial with the plan that unlocks them', async () => await withHarness('trial', async ({ base }) => {
    const data = await overview(base)
    const locked = Object.fromEntries(data.exports.map((card: { id: string; locked: boolean; requiredPlan: string | null }) => [card.id, card]))
    expect(locked.orders.locked).toBe(false)
    expect(locked.catalog.locked).toBe(false)
    expect(locked.audit.locked).toBe(true)
    expect(locked.audit.requiredPlan).toBe('start')
    expect(locked.revenue.locked).toBe(true)
    expect(locked.revenue.requiredPlan).toBe('growth')
  }))

  it('unlocks the Activity Log on Start but keeps the Revenue Report gated', async () => await withHarness('start', async ({ base }) => {
    const data = await overview(base)
    const byId = Object.fromEntries(data.exports.map((card: { id: string; locked: boolean }) => [card.id, card.locked]))
    expect(byId).toEqual({ orders: false, catalog: false, audit: false, revenue: true })
  }))

  it('unlocks every export on Commander', async () => await withHarness('commander', async ({ base }) => {
    const data = await overview(base)
    expect(data.exports.every((card: { locked: boolean }) => !card.locked)).toBe(true)
    expect(data.usage.unlimited).toBe(true)
    expect(data.features).toEqual({ customDateRange: true, scheduledExports: true })
  }))

  it('reports the monthly allowance per plan', async () => {
    const expectations: ReadonlyArray<readonly [PlanTier, number | null]> = [['trial', 3], ['start', 10], ['growth', null], ['commander', null]]
    for (const [plan, limit] of expectations) {
      await withHarness(plan, async ({ base }) => {
        const data = await overview(base)
        expect(data.usage.limit).toBe(limit)
        expect(data.usage.used).toBe(0)
      })
    }
  })

  it('gates custom date range and scheduled exports by plan', async () => {
    await withHarness('start', async ({ base }) => expect((await overview(base)).features).toEqual({ customDateRange: false, scheduledExports: false }))
    await withHarness('growth', async ({ base }) => expect((await overview(base)).features).toEqual({ customDateRange: true, scheduledExports: false }))
  })

  it('requires a store before anything is exported', async () => await withHarness('growth', async ({ base }) => {
    const response = await fetch(`${base}/exports/overview`)
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('Connect your Shopify store')
  }))
})

describe('Data Exports — generation', () => {
  it('writes a real CSV containing the merchant rows', async () => await withHarness('growth', async ({ base }) => {
    const response = await download(base, 'orders')
    expect(response.status).toBe(201)
    const body = (await response.json()).data
    expect(body.rows).toBe(3)
    expect(body.contentType).toContain('csv')
    expect(body.filename).toMatch(/^orders-export-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}\.csv$/)
    const text = Buffer.from(body.bodyBase64, 'base64').toString('utf8')
    expect(text).toContain('Order date,Orders placed,Orders fulfilled,Orders cancelled,Average order value')
    expect(text).toContain('2026-08-18,15,12,2,78.4')
  }))

  it('writes a real XLSX workbook for the product catalog', async () => await withHarness('growth', async ({ base }) => {
    const body = (await (await download(base, 'catalog')).json()).data
    expect(body.format).toBe('XLSX')
    expect(body.contentType).toContain('spreadsheetml')
    const bytes = Buffer.from(body.bodyBase64, 'base64')
    expect(bytes.subarray(0, 2).toString('utf8')).toBe('PK')
    expect(body.rows).toBe(2)
  }))

  it('writes a real PDF for the revenue report', async () => await withHarness('growth', async ({ base }) => {
    const body = (await (await download(base, 'revenue')).json()).data
    expect(body.format).toBe('PDF')
    const bytes = Buffer.from(body.bodyBase64, 'base64')
    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-')
    expect(bytes.toString('utf8')).toContain('%%EOF')
  }))

  it('writes the activity log as CSV on Start', async () => await withHarness('start', async ({ base }) => {
    const body = (await (await download(base, 'audit')).json()).data
    expect(body.rows).toBe(1)
    expect(Buffer.from(body.bodyBase64, 'base64').toString('utf8')).toContain('orders synced')
  }))

  it('never returns an empty file — it explains what to sync instead', async () => {
    await withHarness('growth', async ({ base }) => {
      const response = await download(base, 'orders')
      expect(response.status).toBe(404)
      const message = (await response.json()).error.message
      expect(message).toContain('nothing to export yet')
      expect(message).toContain('Sync your Shopify orders')
    }, new StubSource({ orders: [] }))
  })

  it('blocks a locked dataset with 402 and the generic Upgrade Plan wording', async () => await withHarness('trial', async ({ base }) => {
    const response = await download(base, 'revenue')
    expect(response.status).toBe(402)
    const error = (await response.json()).error
    expect(error.message).toBe('Revenue Report is available on the Growth plan. Upgrade Plan to download it.')
    expect(error.details.reason).toBe('UPGRADE_REQUIRED')
    expect(error.details.requiredPlan).toBe('growth')
  }))

  it('enforces the Trial allowance of three exports per month', async () => await withHarness('trial', async ({ base }) => {
    for (let index = 0; index < 3; index += 1) expect((await download(base, 'orders')).status).toBe(201)
    const blocked = await download(base, 'orders')
    expect(blocked.status).toBe(402)
    const error = (await blocked.json()).error
    expect(error.message).toContain('all 3 exports included this month')
    expect(error.message).toContain('Upgrade Plan')
    expect(error.details.limit).toBe(3)
  }))

  it('never runs out on Growth', async () => await withHarness('growth', async ({ base }) => {
    for (let index = 0; index < 12; index += 1) expect((await download(base, 'orders')).status).toBe(201)
    expect((await overview(base)).usage.unlimited).toBe(true)
  }))

  it('counts each successful export against the month and reports what is left', async () => await withHarness('trial', async ({ base }) => {
    await download(base, 'orders')
    const usage = (await overview(base)).usage
    expect(usage.used).toBe(1)
    expect(usage.remaining).toBe(2)
    expect(usage.limitReached).toBe(false)
  }))

  it('does not count a blocked export against the allowance', async () => await withHarness('trial', async ({ base }) => {
    expect((await download(base, 'revenue')).status).toBe(402)
    expect((await overview(base)).usage.used).toBe(0)
  }))

  it('does not count an empty dataset against the allowance', async () => {
    await withHarness('trial', async ({ base }) => {
      expect((await download(base, 'orders')).status).toBe(404)
      expect((await overview(base)).usage.used).toBe(0)
    }, new StubSource({ orders: [] }))
  })

  it('applies a custom date range on Growth', async () => await withHarness('growth', async ({ base }) => {
    const body = (await (await download(base, 'orders', { from: '2026-08-17', to: '2026-08-17' })).json()).data
    expect(body.rows).toBe(1)
    expect(Buffer.from(body.bodyBase64, 'base64').toString('utf8')).toContain('2026-08-17')
  }))

  it('rejects a custom date range below Growth with Upgrade Plan', async () => await withHarness('start', async ({ base }) => {
    const response = await download(base, 'orders', { from: '2026-08-17' })
    expect(response.status).toBe(402)
    expect((await response.json()).error.message).toContain('Upgrade Plan')
  }))

  it('rejects a malformed date and an inverted range', async () => await withHarness('growth', async ({ base }) => {
    expect((await download(base, 'orders', { from: 'yesterday' })).status).toBe(400)
    expect((await download(base, 'orders', { from: '2026-08-18', to: '2026-08-01' })).status).toBe(400)
  }))

  it('rejects impossible calendar dates that Date.parse quietly normalises', async () => await withHarness('growth', async ({ base }) => {
    // Date.parse('2026-02-30') succeeds (it rolls over to March 2nd); without a
    // real calendar check the merchant got a confusing "no data" 404 instead.
    for (const impossible of ['2026-02-30', '2026-04-31', '2026-02-29', '2026-13-05']) {
      const response = await download(base, 'orders', { from: impossible })
      expect(response.status).toBe(400)
      expect((await response.json()).error.message).toContain('real calendar date')
    }
    // A real leap day and a normal date still pass.
    expect((await download(base, 'orders', { from: '2028-02-29', to: '2028-03-01' })).status).not.toBe(400)
    expect((await download(base, 'orders', { from: '2026-08-16', to: '2026-08-18' })).status).toBe(201)
  }))

  it('rejects an unknown dataset in merchant language', async () => await withHarness('growth', async ({ base }) => {
    const response = await fetch(`${base}/exports/customers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: STORE }) })
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('Choose one of the available exports')
  }))
})

describe('Data Exports — history', () => {
  it('records each download with real rows, bytes, and format', async () => await withHarness('growth', async ({ base }) => {
    await download(base, 'orders')
    await download(base, 'catalog')
    const history = (await (await fetch(`${base}/exports/history?storeId=${STORE}`)).json()).data
    expect(history).toHaveLength(2)
    expect(history[0].dataset).toBe('catalog')
    expect(history[0].format).toBe('XLSX')
    expect(history[0].byteSize).toBeGreaterThan(0)
    expect(history[1]).toMatchObject({ dataset: 'orders', format: 'CSV', rowCount: 3 })
  }))

  it('feeds the last-exported line on the matching card only', async () => await withHarness('growth', async ({ base }) => {
    await download(base, 'orders')
    const data = await overview(base)
    const byId = Object.fromEntries(data.exports.map((card: { id: string; lastExportedAt: number | null }) => [card.id, card.lastExportedAt]))
    expect(typeof byId.orders).toBe('number')
    expect(byId.catalog).toBeNull()
    expect(data.history).toHaveLength(1)
  }))

  it('starts empty for a store that has never exported', async () => await withHarness('growth', async ({ base }) => {
    const data = await overview(base)
    expect(data.history).toEqual([])
    expect(data.exports.every((card: { lastExportedAt: number | null }) => card.lastExportedAt === null)).toBe(true)
  }))

  it('keeps history tenant-scoped', async () => await withHarness('growth', async ({ base }) => {
    await download(base, 'orders')
    const other = (await (await fetch(`${base}/exports/history?storeId=another-store`)).json()).data
    expect(other).toEqual([])
  }))
})
