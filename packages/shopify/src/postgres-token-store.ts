import type { QueryResultRow } from 'pg'
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
    const result = await this.executor.query<TokenRow>('SELECT shop_domain, encrypted_access_token, created_at, rotated_at FROM shopify_tokens WHERE shop_domain = $1 LIMIT 1', [normalizedShop])
    const row = result.rows[0]
    if (!row) return null
    return { shop: row.shop_domain, ciphertext: row.encrypted_access_token as EncryptedTokenRecord['ciphertext'], createdAt: row.created_at.valueOf(), rotatedAt: row.rotated_at?.valueOf() ?? null }
  }

  public async put(record: EncryptedTokenRecord): Promise<void> {
    await this.executor.query(
      `INSERT INTO shopify_tokens (shop_domain, encrypted_access_token, created_at, rotated_at) VALUES ($1, $2, to_timestamp($3 / 1000.0), CASE WHEN $4 IS NULL THEN NULL ELSE to_timestamp($4 / 1000.0) END) ON CONFLICT (shop_domain) DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token, rotated_at = EXCLUDED.rotated_at`,
      [parseShopDomain(record.shop), record.ciphertext, record.createdAt, record.rotatedAt],
    )
  }

  public async delete(shop: string): Promise<void> {
    await this.executor.query('DELETE FROM shopify_tokens WHERE shop_domain = $1', [parseShopDomain(shop)])
  }
}
