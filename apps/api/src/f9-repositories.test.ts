import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from '@profitpilot/db'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { PostgresF9ControlRepository } from './f9-repositories.js'

const maintenance = { maintenance_enabled: true, maintenance_message: 'Deploy', version: 1, updated_by: 'admin', updated_at: new Date(100) }
const flags = { store_id: 'store-1', ai_enabled: false, automation_enabled: true, suspended: false, version: 1, updated_by: 'admin', updated_at: new Date(100) }
const audit = { id: 'audit-1', store_id: 'store-1', actor_id: 'admin', action: 'MERCHANT_FLAGS_CHANGED' as const, before_state: { aiEnabled: true }, after_state: { aiEnabled: false }, created_at: new Date(100) }

function makeExecutor(): SqlExecutor {
  return { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { const row = text.includes('platform_controls') ? maintenance : text.includes('merchant_controls') ? flags : text.includes('launch_control_audit') ? audit : null; return { rows: row ? [row as unknown as Row] : [], rowCount: text.startsWith('UPDATE') || text.startsWith('INSERT') ? 1 : row ? 1 : 0 } } }
}

describe('F9 Postgres launch control repository', () => {
  it('maps controls, flags, and audit rows with bound SQL', async () => {
    const repository = new PostgresF9ControlRepository(makeExecutor())
    expect((await repository.getMaintenance()).message).toBe('Deploy')
    expect(await repository.saveMaintenance({ enabled: false, message: 'x', version: 2, updatedBy: 'admin', updatedAt: 200 }, 1)).toBe(true)
    expect((await repository.getFlags('store-1')).aiEnabled).toBe(false)
    expect(await repository.saveFlags({ storeId: 'store-1', aiEnabled: true, automationEnabled: true, suspended: false, version: 2, updatedBy: 'admin', updatedAt: 200 }, 1)).toBe(true)
    await repository.appendAudit({ id: 'audit-2', storeId: 'store-1', actorId: 'admin', action: 'MERCHANT_FLAGS_CHANGED', before: {}, after: { aiEnabled: true }, at: 200 })
    expect((await repository.listAudit('store-1'))[0]?.action).toBe('MERCHANT_FLAGS_CHANGED')
  })

  it('returns safe defaults when persistent rows are absent or malformed', async () => {
    const empty: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [], rowCount: 0 } } }
    const repository = new PostgresF9ControlRepository(empty)
    expect((await repository.getMaintenance()).enabled).toBe(false)
    expect((await repository.getFlags('store-2')).aiEnabled).toBe(true)
    expect(await repository.listAudit()).toEqual([])
  })
})
