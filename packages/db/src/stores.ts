import { randomUUID } from 'node:crypto'
import { storeId } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import { PostgresDatabase } from './database.js'
import type { SqlExecutor } from './database.js'

type StoreRow = { id: string; shop_domain: string } & Record<string, unknown>

export type StoreConnection = Readonly<{ storeId: StoreId; shopDomain: string }>

/** Tenant directory contract shared by the Postgres implementation and the in-memory test double. */
export interface StoreDirectory {
  get(storeId: StoreId): Promise<StoreConnection | null>
  getByShopDomain(shopDomain: string): Promise<StoreConnection | null>
  upsertByShopDomain(shopDomain: string): Promise<StoreConnection>
}

export class PostgresStoreDirectory implements StoreDirectory {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) {
    this.executor = executor
  }

  public async get(storeId: StoreId): Promise<StoreConnection | null> {
    return this.withRlsContext('app.store_id', storeId, async (executor) => {
      const result = await executor.query<StoreRow>('SELECT shop_domain FROM stores WHERE id = $1 LIMIT 1', [storeId])
      const row = result.rows[0]
      return row ? { storeId, shopDomain: row.shop_domain } : null
    })
  }

  public async getByShopDomain(shopDomain: string): Promise<StoreConnection | null> {
    const normalized = normalizeShopDomain(shopDomain)
    if (!normalized) return null
    return this.withRlsContext('app.shop_domain', normalized, async (executor) => {
      const result = await executor.query<StoreRow>('SELECT id, shop_domain FROM stores WHERE shop_domain = $1 LIMIT 1', [normalized])
      const row = result.rows[0]
      return row ? { storeId: row.id as StoreId, shopDomain: row.shop_domain } : null
    })
  }

  /**
   * Idempotently register a shop domain and return its tenant id. The
   * ON CONFLICT ... DO UPDATE clause makes concurrent installs race-safe. The
   * signed shop context is transaction-local so this also works when the app's
   * database role is subject to stores row-level security.
   *
   * Reinstall recovery: a returning merchant gets their old row back, so the
   * conflict branch must also reset `status` to ACTIVE and clear
   * `uninstalled_at` — otherwise a reinstalled store stays UNINSTALLED forever
   * and every status='ACTIVE' query (indexes from migration 0029) skips it.
   */
  public async upsertByShopDomain(shopDomain: string): Promise<StoreConnection> {
    const normalized = normalizeShopDomain(shopDomain)
    if (!normalized) throw new TypeError('A valid Shopify shop domain is required')
    return this.withRlsContext('app.shop_domain', normalized, async (executor) => {
      const result = await executor.query<StoreRow>(
        `INSERT INTO stores (shop_domain) VALUES ($1)
         ON CONFLICT (shop_domain) DO UPDATE SET
           updated_at = now(),
           status = 'ACTIVE',
           uninstalled_at = NULL
         RETURNING id, shop_domain`,
        [normalized],
      )
      const row = result.rows[0]
      if (!row) throw new Error('Store upsert returned no row')
      return { storeId: row.id as StoreId, shopDomain: row.shop_domain }
    })
  }

  private async withRlsContext<Value>(setting: 'app.store_id' | 'app.shop_domain', value: string, operation: (executor: SqlExecutor) => Promise<Value>): Promise<Value> {
    if (this.executor instanceof PostgresDatabase) {
      return this.executor.withTransaction(async (client) => {
        await client.query('SELECT set_config($1, $2, true)', [setting, value])
        return operation(client)
      })
    }
    return operation(this.executor)
  }
}

export class InMemoryStoreDirectory implements StoreDirectory {
  private readonly byId = new Map<string, StoreConnection>()
  private readonly byDomain = new Map<string, string>()

  public async get(storeId: StoreId): Promise<StoreConnection | null> {
    return this.byId.get(storeId) ?? null
  }

  public async getByShopDomain(shopDomain: string): Promise<StoreConnection | null> {
    const normalized = normalizeShopDomain(shopDomain)
    if (!normalized) return null
    const id = this.byDomain.get(normalized)
    return id ? (this.byId.get(id) ?? null) : null
  }

  public async upsertByShopDomain(shopDomain: string): Promise<StoreConnection> {
    const normalized = normalizeShopDomain(shopDomain)
    if (!normalized) throw new TypeError('A valid Shopify shop domain is required')
    const existing = this.byDomain.get(normalized)
    if (existing) {
      const connection = this.byId.get(existing)
      if (connection) return connection
    }
    const connection: StoreConnection = { storeId: storeId(`store-${randomUUID()}`), shopDomain: normalized }
    this.byId.set(connection.storeId, connection)
    this.byDomain.set(normalized, connection.storeId)
    return connection
  }
}

function normalizeShopDomain(shopDomain: string): string {
  return shopDomain.trim().toLowerCase()
}
