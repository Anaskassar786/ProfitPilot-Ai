import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from '@profitpilot/db'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { AppError, storeId } from '@profitpilot/types'
import { PostgresCheckpointStore } from './index.js'

const row = { store_id: 'store-1', module: 'products', cursor: 'c1', version: 1, updated_at: new Date(100) }

describe('Postgres checkpoint persistence', () => {
  it('reads a cursor checkpoint', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [row as unknown as Row], rowCount: 1 } } }
    expect(await new PostgresCheckpointStore(executor).get(storeId('store-1'), 'products')).toMatchObject({ cursor: 'c1', version: 1, updatedAt: 100 })
  })
  it('returns null for an absent checkpoint', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }
    expect(await new PostgresCheckpointStore(executor).get(storeId('store-1'), 'products')).toBeNull()
  })
  it('writes a checkpoint with compare-and-set SQL', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [row as unknown as Row], rowCount: 1 } } }
    const result = await new PostgresCheckpointStore(executor).save({ storeId: storeId('store-1'), module: 'products', cursor: 'c1', updatedAt: 100 }, null)
    expect(result.cursor).toBe('c1')
    expect(queries[0]).toContain('WHERE sync_checkpoints.version = $6')
  })
  it('raises a conflict when compare-and-set updates no row', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }
    await expect(new PostgresCheckpointStore(executor).save({ storeId: storeId('store-1'), module: 'products', cursor: 'c1', updatedAt: 100 }, 2)).rejects.toBeInstanceOf(AppError)
  })
})
