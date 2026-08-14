import { describe, expect, it } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { QueryResultRow } from '@profitpilot/db'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { ALL_MIGRATIONS } from '@profitpilot/db'
import { runMigrations } from './migrations.js'

const temporary = join(process.cwd(), '.f9-test-migrations')

describe('F9 startup migration runner', () => {
  it('runs only unapplied SQL files in order and records them', async () => {
    await mkdir(temporary, { recursive: true })
    for (const migration of ALL_MIGRATIONS) await writeFile(join(temporary, migration.filename), `-- ${migration.id}`)
    const calls: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string, _values: readonly unknown[] = []): Promise<DatabaseResult<Row>> { calls.push(text); if (text.startsWith('SELECT id')) return { rows: [{ id: '0001' } as unknown as Row], rowCount: 1 }; return { rows: [], rowCount: 1 } } }
    const applied = await runMigrations(executor, temporary)
    expect(applied[0]).toBe('0002')
    expect(calls.some((query) => query.includes('-- 0002'))).toBe(true)
    await rm(temporary, { recursive: true, force: true })
  })
})
