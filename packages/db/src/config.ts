export type DatabaseConfig = Readonly<{
  connectionString: string
  maxConnections: number
  idleTimeoutMs: number
  statementTimeoutMs: number
  ssl: boolean
  /** Set when `DATABASE_URL` arrived with a deprecated `sslmode` (see below). */
  sslModeRewrittenFrom: string | null
}>

/**
 * `pg-connection-string` v2.x (shipped with `pg` v8.23) treats the SSL modes
 * `prefer`, `require` and `verify-ca` as aliases of `verify-full`, and prints
 * this startup warning the first time it parses one of them:
 *
 *   SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are
 *   treated as aliases for 'verify-full'. In the next major version
 *   (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt
 *   standard libpq semantics, which have weaker security guarantees.
 *
 * In pg v9 those modes stop verifying the server certificate, so a connection
 * string left on `sslmode=require` silently downgrades from "verified TLS" to
 * "encrypted but unauthenticated TLS" on the next major upgrade. Rewriting the
 * mode to `verify-full` today removes the warning, keeps the strict behaviour
 * the alias already provided, and pins that behaviour across the pg 9 upgrade.
 *
 * `uselibpqcompat=true` is an explicit opt-in to the weaker libpq semantics, so
 * those connection strings are left untouched.
 */
const DEPRECATED_SSL_MODES = new Set(['prefer', 'require', 'verify-ca'])

export function normalizePostgresSslMode(connectionString: string): Readonly<{ connectionString: string; rewrittenFrom: string | null }> {
  const queryIndex = connectionString.indexOf('?')
  if (queryIndex === -1) return { connectionString, rewrittenFrom: null }
  const base = connectionString.slice(0, queryIndex)
  const query = connectionString.slice(queryIndex + 1)
  if (query.length === 0) return { connectionString, rewrittenFrom: null }
  const params = new URLSearchParams(query)
  const mode = params.get('sslmode')?.trim().toLowerCase() ?? null
  if (!mode || !DEPRECATED_SSL_MODES.has(mode)) return { connectionString, rewrittenFrom: null }
  if (params.get('uselibpqcompat')?.trim().toLowerCase() === 'true') return { connectionString, rewrittenFrom: null }
  params.set('sslmode', 'verify-full')
  return { connectionString: `${base}?${params.toString()}`, rewrittenFrom: mode }
}

export function databaseConfigFromEnv(env: Readonly<Record<string, string | undefined>>): DatabaseConfig {
  const connectionString = env.DATABASE_URL?.trim() ?? ''
  if (!connectionString.startsWith('postgres://') && !connectionString.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string')
  }
  const maxConnections = parsePositiveInteger(env.DB_POOL_MAX ?? '10', 'DB_POOL_MAX')
  const idleTimeoutMs = parsePositiveInteger(env.DB_IDLE_TIMEOUT_MS ?? '10000', 'DB_IDLE_TIMEOUT_MS')
  const statementTimeoutMs = parsePositiveInteger(env.DB_STATEMENT_TIMEOUT_MS ?? '5000', 'DB_STATEMENT_TIMEOUT_MS')
  const normalized = normalizePostgresSslMode(connectionString)
  return {
    connectionString: normalized.connectionString,
    maxConnections,
    idleTimeoutMs,
    statementTimeoutMs,
    ssl: env.NODE_ENV === 'production',
    sslModeRewrittenFrom: normalized.rewrittenFrom,
  }
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}
