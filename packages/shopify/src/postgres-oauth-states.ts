import { randomBytes } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { SqlExecutor } from '@profitpilot/db'
import type { OAuthState, OAuthStates } from './oauth.js'
import { parseShopDomain, safeEqualString } from './oauth.js'

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000

type StateRow = QueryResultRow & {
  shop_domain: string
  expires_at: Date
}

/**
 * Database-backed OAuth state store.
 *
 * The install redirect and the OAuth callback can be served by different
 * processes (restarts, replicas, deploys), so state tokens must live outside
 * process memory. consume() uses DELETE ... RETURNING, which atomically burns
 * the token: a callback can consume a state exactly once, even if Shopify or
 * a browser retries concurrently.
 */
export class PostgresOAuthStateStore implements OAuthStates {
  private readonly executor: SqlExecutor
  private readonly now: () => number

  public constructor(executor: SqlExecutor, now: () => number = () => Date.now()) {
    this.executor = executor
    this.now = now
  }

  public async issue(shop: string, ttlMs = DEFAULT_STATE_TTL_MS): Promise<OAuthState> {
    const state: OAuthState = { token: randomBytes(32).toString('hex'), shop: parseShopDomain(shop), expiresAt: this.now() + ttlMs }
    await this.executor.query('INSERT INTO shopify_oauth_states (token, shop_domain, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))', [state.token, state.shop, state.expiresAt])
    // Opportunistic GC so abandoned installs cannot grow the table over time.
    await this.executor.query("DELETE FROM shopify_oauth_states WHERE expires_at < now() - interval '1 day'")
    return state
  }

  public async consume(token: string, shop: string): Promise<boolean> {
    if (!token.trim()) return false
    const result = await this.executor.query<StateRow>('DELETE FROM shopify_oauth_states WHERE token = $1 RETURNING shop_domain, expires_at', [token])
    const row = result.rows[0]
    if (!row) return false
    if (row.expires_at.getTime() <= this.now()) return false
    return safeEqualString(row.shop_domain, parseShopDomain(shop))
  }
}
