import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { PostgresTokenRecordStore } from './index.js'

const record = { shop: 'demo.myshopify.com', ciphertext: 'v1.iv.tag.cipher' as `v1.${string}.${string}.${string}`, createdAt: 1000, rotatedAt: null }

describe('Postgres Shopify token storage', () => {
  it('maps an encrypted token row without decrypting in the repository', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [{ shop_domain: 'demo.myshopify.com', encrypted_access_token: record.ciphertext, created_at: new Date(1000), rotated_at: null } as unknown as Row], rowCount: 1 } } }
    expect(await new PostgresTokenRecordStore(executor).get('demo.myshopify.com')).toMatchObject({ shop: 'demo.myshopify.com', ciphertext: record.ciphertext, createdAt: 1000 })
  })
  it('returns null for an absent row', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }
    expect(await new PostgresTokenRecordStore(executor).get('demo.myshopify.com')).toBeNull()
  })
  it('writes the encrypted value through an upsert', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [], rowCount: 1 } } }
    await new PostgresTokenRecordStore(executor).put(record)
    expect(queries[0]).toContain('ON CONFLICT (shop_domain)')
  })
  it('deletes a token record by normalized shop', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: [], rowCount: 1 } } }
    await new PostgresTokenRecordStore(executor).delete('DEMO.myshopify.com')
    expect(queries[0]).toContain('DELETE FROM shopify_tokens')
  })
})
