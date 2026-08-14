import type { QueryResultRow } from 'pg'
import { PostgresDatabase } from '@profitpilot/db'
import type { SqlExecutor } from '@profitpilot/db'
import type { EncryptedTokenRecord, TokenRecordStore } from './token-vault.js'
import { parseShopDomain } from './oauth.js'

 type TokenRow = QueryResultRow & {
  shop_domain: string
  encrypted_access_token: string
  created_at: Date
  rotated_at: Date | null
}

export class PostgresTokenRecordStore implements TokenRecordStore {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) {
    this.executor = executor
  }

  public async get(shop: string): Promise<EncryptedTokenRecord | null> {
    const normalizedShop = parseShopDomain(shop)
    return this.withShopContext(normalizedShop, async (executor) => {
      const result = await executor.query<TokenRow>('SELECT shop_domain, encrypted_access_token, created_at, rotated_at FROM shopify_tokens WHERE shop_domain = $1 LIMIT 1', [normalizedShop])
      const row = result.rows[0]
      if (!row) return null
      return { shop: row.shop_domain, ciphertext: row.encrypted_access_token as EncryptedTokenRecord['ciphertext'], createdAt: row.created_at.valueOf(), rotatedAt: row.rotated_at?.valueOf() ?? null }
    })
  }

  public async put(record: EncryptedTokenRecord): Promise<void> {
    const normalizedShop = parseShopDomain(record.shop)
    await this.withShopContext(normalizedShop, (executor) => executor.query(
      `INSERT INTO shopify_tokens (shop_domain, encrypted_access_token, created_at, rotated_at) VALUES ($1, $2, to_timestamp($3 / 1000.0), CASE WHEN $4 IS NULL THEN NULL ELSE to_timestamp($4 / 1000.0) END) ON CONFLICT (shop_domain) DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token, rotated_at = EXCLUDED.rotated_at`,
      [normalizedShop, record.ciphertext, record.createdAt, record.rotatedAt],
    ))
  }

  public async delete(shop: string): Promise<void> {
    const normalizedShop = parseShopDomain(shop)
    await this.withShopContext(normalizedShop, (executor) => executor.query('DELETE FROM shopify_tokens WHERE shop_domain = $1', [normalizedShop]))
  }

  /**
   * shopify_tokens enforces row-level security keyed on the app.shop_domain
   * setting. When connected as a role subject to RLS (i.e. not the table
   * owner or a superuser), an unset context silently hides every row and
   * rejects the install-time upsert, so set it transactionally per operation.
   */
  private async withShopContext<Value>(shop: string, operation: (executor: SqlExecutor) => Promise<Value>): Promise<Value> {
    if (this.executor instanceof PostgresDatabase) {
      return this.executor.withTransaction(async (client) => {
        await client.query('SELECT set_config($1, $2, true)', ['app.shop_domain', shop])
        return operation(client)
      })
    }
    return operation(this.executor)
  }
}
