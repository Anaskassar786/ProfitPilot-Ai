import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { SqlExecutor } from '@profitpilot/db'
import type { CheckpointStore, SyncCheckpoint, SyncModule } from './sync.js'

type CheckpointRow = { store_id: string; module: string; cursor: string | null; version: number; updated_at: Date } & Record<string, unknown>

export class PostgresCheckpointStore implements CheckpointStore {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) {
    this.executor = executor
  }

  public async get(storeId: StoreId, module: SyncModule): Promise<SyncCheckpoint | null> {
    const result = await this.executor.query<CheckpointRow>('SELECT store_id, module, cursor, version, updated_at FROM sync_checkpoints WHERE store_id = $1 AND module = $2 LIMIT 1', [storeId, module])
    const row = result.rows[0]
    return row ? toCheckpoint(row) : null
  }

  public async save(next: Omit<SyncCheckpoint, 'version'>, expectedVersion: number | null): Promise<SyncCheckpoint> {
    const expected = expectedVersion ?? 0
    const result = await this.executor.query<CheckpointRow>(
      `INSERT INTO sync_checkpoints (store_id, module, cursor, version, updated_at) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0)) ON CONFLICT (store_id, module) DO UPDATE SET cursor = EXCLUDED.cursor, version = sync_checkpoints.version + 1, updated_at = EXCLUDED.updated_at WHERE sync_checkpoints.version = $6 RETURNING store_id, module, cursor, version, updated_at`,
      [next.storeId, next.module, next.cursor, expected + 1, next.updatedAt, expected],
    )
    if (result.rowCount === 0) throw new AppError('CONFLICT', 'Sync checkpoint changed; resume from the latest cursor', 409, { module: next.module, expectedVersion })
    const row = result.rows[0]
    if (!row) throw new Error('Checkpoint write returned no row')
    return toCheckpoint(row)
  }
}

function toCheckpoint(row: CheckpointRow): SyncCheckpoint {
  return { storeId: row.store_id as StoreId, module: row.module as SyncModule, cursor: row.cursor, version: row.version, updatedAt: row.updated_at.valueOf() }
}
