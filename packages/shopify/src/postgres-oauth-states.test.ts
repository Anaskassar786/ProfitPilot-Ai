import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { PostgresOAuthStateStore } from './index.js'

type StoredRow = Readonly<{ token: string; shop_domain: string; expires_at: Date }>

/**
 * Minimal stand-in for the shopify_oauth_states table honoring the three
 * statements PostgresOAuthStateStore issues, including single-use semantics
 * for DELETE ... RETURNING.
 */
function fakeDatabase(): { executor: SqlExecutor; rows: Map<string, StoredRow>; queries: string[] } {
  const rows = new Map<string, StoredRow>()
  const queries: string[] = []
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
      queries.push(text)
      if (text.startsWith('INSERT INTO shopify_oauth_states')) {
        const row: StoredRow = { token: String(values[0]), shop_domain: String(values[1]), expires_at: new Date(Number(values[2])) }
        rows.set(row.token, row)
        return { rows: [], rowCount: 1 }
      }
      if (text.startsWith('DELETE FROM shopify_oauth_states WHERE token')) {
        const row = rows.get(String(values[0])) ?? null
        rows.delete(String(values[0])) // burns the token even when expired or mismatched
        return { rows: row ? [row as unknown as Row] : [], rowCount: row ? 1 : 0 }
      }
      if (text.startsWith('DELETE FROM shopify_oauth_states WHERE expires_at')) {
        return { rows: [], rowCount: 0 }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
  }
  return { executor, rows, queries }
}

describe('Postgres OAuth state store', () => {
  it('issues and consumes a state exactly once', async () => {
    const { executor, queries } = fakeDatabase()
    const states = new PostgresOAuthStateStore(executor, () => 1000)
    const state = await states.issue('Demo.myshopify.com')
    expect(state.shop).toBe('demo.myshopify.com')
    expect(state.token).toMatch(/^[0-9a-f]{64}$/)
    expect(await states.consume(state.token, 'demo.myshopify.com')).toBe(true)
    expect(await states.consume(state.token, 'demo.myshopify.com')).toBe(false)
    expect(queries.some((query) => query.startsWith("DELETE FROM shopify_oauth_states WHERE expires_at"))).toBe(true)
  })

  it('rejects a state issued for a different shop', async () => {
    const { executor } = fakeDatabase()
    const states = new PostgresOAuthStateStore(executor, () => 1000)
    const state = await states.issue('demo.myshopify.com')
    expect(await states.consume(state.token, 'other.myshopify.com')).toBe(false)
  })

  it('rejects expired states', async () => {
    let now = 1000
    const { executor } = fakeDatabase()
    const states = new PostgresOAuthStateStore(executor, () => now)
    const state = await states.issue('demo.myshopify.com', 10)
    now = 1000 + 11
    expect(await states.consume(state.token, 'demo.myshopify.com')).toBe(false)
  })

  it('rejects unknown and empty tokens without touching the database for empty input', async () => {
    const { executor, queries } = fakeDatabase()
    const states = new PostgresOAuthStateStore(executor, () => 1000)
    expect(await states.consume('missing', 'demo.myshopify.com')).toBe(false)
    const before = queries.length
    expect(await states.consume('   ', 'demo.myshopify.com')).toBe(false)
    expect(queries.length).toBe(before)
  })
})
