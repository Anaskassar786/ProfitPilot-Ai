import { withTenantContext } from '@profitpilot/db'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { exportPeriodStart } from '@profitpilot/types'
import type { ExportDataset, ExportFormat, PlanTier } from '@profitpilot/types'

/**
 * Durable export history (migration 0026). Every successful download is
 * recorded here, which makes three merchant-facing numbers real instead of
 * guessed: exports used this month, last-exported per dataset, and the
 * Export History list.
 */

export type ExportHistoryRecord = Readonly<{
  id: string
  storeId: string
  dataset: ExportDataset
  format: ExportFormat
  filename: string
  rowCount: number
  byteSize: number
  plan: PlanTier
  rangeStart: string | null
  rangeEnd: string | null
  createdAt: number
}>

export type ExportHistoryInput = Readonly<{
  storeId: string
  dataset: ExportDataset
  format: ExportFormat
  filename: string
  rowCount: number
  byteSize: number
  plan: PlanTier
  rangeStart?: string | null
  rangeEnd?: string | null
}>

export interface ExportHistoryRepository {
  /** Newest-first history for the Export History section. */
  list(storeId: string, limit: number): Promise<readonly ExportHistoryRecord[]>
  /** How many exports this store has generated in the current metering month. */
  countForPeriod(storeId: string, periodStart: string): Promise<number>
  /** Most recent export timestamp per dataset, for the "Last exported" line. */
  lastExportedByDataset(storeId: string): Promise<Readonly<Partial<Record<ExportDataset, number>>>>
  /** Records a successful export. Never called for blocked or failed exports. */
  record(input: ExportHistoryInput): Promise<ExportHistoryRecord>
}

type HistoryRow = QueryResultRow & {
  id: string
  store_id: string
  dataset: string
  format: string
  filename: string
  row_count: number | string
  byte_size: number | string
  plan: string
  range_start: Date | string | null
  range_end: Date | string | null
  created_at: Date
}

export class PostgresExportHistoryRepository implements ExportHistoryRepository {
  private readonly database: SqlExecutor

  public constructor(database: SqlExecutor) {
    this.database = database
  }

  public async list(storeId: string, limit: number): Promise<readonly ExportHistoryRecord[]> {
    return withTenantContext(this.database, storeId, async (client) => {
      const result = await client.query<HistoryRow>(
        'SELECT id, store_id, dataset, format, filename, row_count, byte_size, plan, range_start, range_end, created_at FROM export_history WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2',
        [storeId, Math.max(1, Math.min(50, limit))],
      )
      return result.rows.map(mapRow)
    })
  }

  public async countForPeriod(storeId: string, periodStart: string): Promise<number> {
    return withTenantContext(this.database, storeId, async (client) => {
      const result = await client.query<{ used: string | number }>(
        'SELECT COUNT(*)::int AS used FROM export_history WHERE store_id = $1 AND period_start = $2::date',
        [storeId, periodStart],
      )
      return Number(result.rows[0]?.used ?? 0)
    })
  }

  public async lastExportedByDataset(storeId: string): Promise<Readonly<Partial<Record<ExportDataset, number>>>> {
    return withTenantContext(this.database, storeId, async (client) => {
      const result = await client.query<{ dataset: string; last_at: Date }>(
        'SELECT dataset, MAX(created_at) AS last_at FROM export_history WHERE store_id = $1 GROUP BY dataset',
        [storeId],
      )
      const output: Partial<Record<ExportDataset, number>> = {}
      for (const row of result.rows) output[row.dataset as ExportDataset] = row.last_at.valueOf()
      return output
    })
  }

  public async record(input: ExportHistoryInput): Promise<ExportHistoryRecord> {
    return withTenantContext(this.database, input.storeId, async (client) => {
      const result = await client.query<HistoryRow>(
        `INSERT INTO export_history (store_id, dataset, format, filename, row_count, byte_size, plan, period_start, range_start, range_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10::date)
         RETURNING id, store_id, dataset, format, filename, row_count, byte_size, plan, range_start, range_end, created_at`,
        [input.storeId, input.dataset, input.format, input.filename, input.rowCount, input.byteSize, input.plan, exportPeriodStart(), input.rangeStart ?? null, input.rangeEnd ?? null],
      )
      const row = result.rows[0]
      if (!row) throw new Error('Export history row was not written')
      return mapRow(row)
    })
  }
}

/** Process-local history used by tests and by deployments without a database. */
export class InMemoryExportHistoryRepository implements ExportHistoryRepository {
  private readonly rows: ExportHistoryRecord[] = []
  private sequence = 0

  public async list(storeId: string, limit: number): Promise<readonly ExportHistoryRecord[]> {
    return this.rows.filter((row) => row.storeId === storeId).sort((left, right) => right.createdAt - left.createdAt).slice(0, Math.max(1, limit))
  }

  public async countForPeriod(storeId: string, periodStart: string): Promise<number> {
    return this.rows.filter((row) => row.storeId === storeId && exportPeriodStart(row.createdAt) === periodStart).length
  }

  public async lastExportedByDataset(storeId: string): Promise<Readonly<Partial<Record<ExportDataset, number>>>> {
    const output: Partial<Record<ExportDataset, number>> = {}
    for (const row of this.rows) {
      if (row.storeId !== storeId) continue
      const current = output[row.dataset]
      if (current === undefined || row.createdAt > current) output[row.dataset] = row.createdAt
    }
    return output
  }

  public async record(input: ExportHistoryInput): Promise<ExportHistoryRecord> {
    this.sequence += 1
    const record: ExportHistoryRecord = {
      id: `export-${this.sequence}`,
      storeId: input.storeId,
      dataset: input.dataset,
      format: input.format,
      filename: input.filename,
      rowCount: input.rowCount,
      byteSize: input.byteSize,
      plan: input.plan,
      rangeStart: input.rangeStart ?? null,
      rangeEnd: input.rangeEnd ?? null,
      createdAt: Date.now(),
    }
    this.rows.push(record)
    return record
  }
}

function mapRow(row: HistoryRow): ExportHistoryRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    dataset: row.dataset as ExportDataset,
    format: row.format as ExportFormat,
    filename: row.filename,
    rowCount: Number(row.row_count),
    byteSize: Number(row.byte_size),
    plan: row.plan as PlanTier,
    rangeStart: dateText(row.range_start),
    rangeEnd: dateText(row.range_end),
    createdAt: row.created_at.valueOf(),
  }
}

function dateText(value: Date | string | null): string | null {
  if (value === null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value.slice(0, 10)
}
