import { Pool } from 'pg'
import type { PoolClient, QueryResultRow } from 'pg'
import type { StoreId } from '@profitpilot/types'
import type { DatabaseConfig } from './config.js'

export type DatabaseResult<Row extends QueryResultRow> = Readonly<{ rows: readonly Row[]; rowCount: number }>

export interface SqlExecutor {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<DatabaseResult<Row>>
}

export class PostgresDatabase implements SqlExecutor {
  private readonly pool: Pool

  public constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections,
      idleTimeoutMillis: config.idleTimeoutMs,
      statement_timeout: config.statementTimeoutMs,
      ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    })
  }

  public async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
    const result = await this.pool.query<Row>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount ?? 0 }
  }

  public async withTransaction<Value>(operation: (client: TransactionClient) => Promise<Value>): Promise<Value> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const value = await operation(new TransactionClient(client))
      await client.query('COMMIT')
      return value
    } catch (error: unknown) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  public async close(): Promise<void> {
    await this.pool.end()
  }
}

class TransactionClient implements SqlExecutor {
  private readonly client: PoolClient

  public constructor(client: PoolClient) {
    this.client = client
  }

  public async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
    const result = await this.client.query<Row>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount ?? 0 }
  }
}

export async function withStoreContext<Value>(executor: SqlExecutor, storeId: StoreId, operation: () => Promise<Value>): Promise<Value> {
  await executor.query('SELECT set_config($1, $2, true)', ['app.store_id', storeId])
  return operation()
}
