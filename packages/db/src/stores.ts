import type { StoreId } from '@profitpilot/types'
import type { SqlExecutor } from './database.js'

type StoreRow = { id: string; shop_domain: string } & Record<string, unknown>

export type StoreConnection = Readonly<{ storeId: StoreId; shopDomain: string }>

export class PostgresStoreDirectory {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) {
    this.executor = executor
  }

  public async get(storeId: StoreId): Promise<StoreConnection | null> {
    const result = await this.executor.query<StoreRow>('SELECT shop_domain FROM stores WHERE id = $1 LIMIT 1', [storeId])
    const row = result.rows[0]
    return row ? { storeId, shopDomain: row.shop_domain } : null
  }

  public async getByShopDomain(shopDomain: string): Promise<StoreConnection | null> {
    const normalized = shopDomain.trim().toLowerCase()
    if (!normalized) return null
    const result = await this.executor.query<StoreRow>('SELECT id, shop_domain FROM stores WHERE shop_domain = $1 LIMIT 1', [normalized])
    const row = result.rows[0]
    return row ? { storeId: row.id as StoreId, shopDomain: row.shop_domain } : null
  }
}
