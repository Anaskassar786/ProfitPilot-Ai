import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ALL_MIGRATIONS, PostgresDatabase } from '@profitpilot/db'
import type { SqlExecutor } from '@profitpilot/db'

export async function runMigrations(executor: SqlExecutor, directory = join(process.cwd(), 'migrations')): Promise<readonly string[]> {
  if (executor instanceof PostgresDatabase) return executor.withTransaction((client) => runMigrationsOn(client, directory))
  return runMigrationsOn(executor, directory)
}

async function runMigrationsOn(executor: SqlExecutor, directory: string): Promise<readonly string[]> {
  await executor.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, filename text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
  const appliedResult = await executor.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')
  const applied = new Set(appliedResult.rows.map((row) => row.id))
  const appliedNow: string[] = []
  for (const migration of ALL_MIGRATIONS) {
    if (applied.has(migration.id)) continue
    const sql = await readFile(join(directory, migration.filename), 'utf8')
    await executor.query(sql)
    await executor.query('INSERT INTO schema_migrations (id, filename) VALUES ($1, $2)', [migration.id, migration.filename])
    appliedNow.push(migration.id)
  }
  return appliedNow
}
