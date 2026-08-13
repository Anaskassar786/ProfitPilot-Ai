export type DatabaseConfig = Readonly<{
  connectionString: string
  maxConnections: number
  idleTimeoutMs: number
  statementTimeoutMs: number
  ssl: boolean
}>

export function databaseConfigFromEnv(env: Readonly<Record<string, string | undefined>>): DatabaseConfig {
  const connectionString = env.DATABASE_URL?.trim() ?? ''
  if (!connectionString.startsWith('postgres://') && !connectionString.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string')
  }
  const maxConnections = parsePositiveInteger(env.DB_POOL_MAX ?? '10', 'DB_POOL_MAX')
  const idleTimeoutMs = parsePositiveInteger(env.DB_IDLE_TIMEOUT_MS ?? '10000', 'DB_IDLE_TIMEOUT_MS')
  const statementTimeoutMs = parsePositiveInteger(env.DB_STATEMENT_TIMEOUT_MS ?? '5000', 'DB_STATEMENT_TIMEOUT_MS')
  return { connectionString, maxConnections, idleTimeoutMs, statementTimeoutMs, ssl: env.NODE_ENV === 'production' }
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}
