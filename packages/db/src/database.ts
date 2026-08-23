import { Pool } from 'pg'
import type { PoolClient, QueryResultRow } from 'pg'
import { Logger } from '@profitpilot/logger'
import type { StoreId } from '@profitpilot/types'
import type { DatabaseConfig } from './config.js'

/** Structured logger for pool-level failures (no query values are logged). */
const poolLogger = new Logger()

export type DatabaseResult<Row extends QueryResultRow> = Readonly<{ rows: readonly Row[]; rowCount: number }>

export interface SqlExecutor {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<DatabaseResult<Row>>
}

export class PostgresDatabase implements SqlExecutor {  private readonly pool: Pool

  public constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections,
      idleTimeoutMillis: config.idleTimeoutMs,
      statement_timeout: config.statementTimeoutMs,
      ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    })
    // P0 reliability (QA 2026-08-20): without a listener, a protocol error on
    // an idle pooled client (e.g. "could not determine data type of parameter
    // $n" from a query passing `undefined`) fires the pool 'error' event,
    // which Node treats as an uncaught exception and the whole API process
    // dies. Log the failure instead; the connection is re-established on the
    // next use.
    this.pool.on('error', (error) => {
      poolLogger.error('Postgres pool connection error (recovering)', { error: error instanceof Error ? error.message : String(error) })
    })
  }

  public async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
    // Guard: `undefined` parameters make Postgres answer "could not determine
    // data type of parameter $n" and (before the pool error handler) killed
    // the process. Log the query text so the call site can be fixed, and pass
    // a typed NULL instead so the statement still succeeds.
    const safeValues = values.map((value) => (value === undefined ? null : value))
    if (safeValues.some((value, index) => values[index] === undefined)) {
      poolLogger.error('SQL query passed an undefined parameter (converted to NULL)', { query: text.slice(0, 300) })
    }
    try {
      const result = await this.pool.query<Row>(text, [...safeValues])
      return { rows: result.rows, rowCount: result.rowCount ?? 0 }
    } catch (error: unknown) {
      // QA (2026-08-21): transient connection-level protocol errors — most
      // notably `portal "" does not exist` — can surface when a pooled
      // connection is rotated or its session state is lost (pgBouncer
      // rotation, or a multiplexing proxy). The failing client is already
      // being evicted by the pool; one retry on a fresh connection is the
      // standard recovery and turns a merchant-facing "Internal server
      // error" into a transparent success.
      if (isTransientProtocolError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        const retried = await this.pool.query<Row>(text, [...safeValues])
        return { rows: retried.rows, rowCount: retried.rowCount ?? 0 }
      }
      throw error
    }
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
    const result = await this.client.query<Row>(text, values.map((value) => (value === undefined ? null : value)))
    return { rows: result.rows, rowCount: result.rowCount ?? 0 }
  }
}

export async function withStoreContext<Value>(executor: SqlExecutor, storeId: StoreId, operation: () => Promise<Value>): Promise<Value> {
  await executor.query('SELECT set_config($1, $2, true)', ['app.store_id', storeId])
  return operation()
}

/**
 * Sets `app.store_id` on the same connection that runs `operation`.
 * `set_config(..., true)` is transaction-local, so this opens a transaction
 * when the executor is a real pool. Test doubles run the callback directly.
 */
export async function withTenantContext<Value>(executor: SqlExecutor, storeId: string, operation: (client: SqlExecutor) => Promise<Value>): Promise<Value> {
  if (executor instanceof PostgresDatabase) {
    return executor.withTransaction(async (client) => {
      await client.query('SELECT set_config($1, $2, true)', ['app.store_id', storeId])
      return operation(client)
    })
  }
  return operation(executor)
}

/** Protocol-level failures where a fresh connection retry is both safe and the
 *  documented recovery path. These never indicate a bad query. */
function isTransientProtocolError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('portal ') || message.includes('Connection terminated') || message.includes('Connection reset')
}
