import { describe, expect, it, vi } from 'vitest'
import type { SqlExecutor } from '@profitpilot/db'
import { storeId } from '@profitpilot/types'
import { PostgresAiCommandRepository } from './ai-command-repository.js'

const tenant = storeId('store-1')

describe('Postgres AI Command repository safety', () => {
  it('does not retry a failed tenant-scoped write outside its transaction', async () => {
    const query = vi.fn().mockRejectedValue(new Error('database unavailable'))
    const executor = { query } as unknown as SqlExecutor
    const repository = new PostgresAiCommandRepository(executor, async () => 'growth')
    await expect(repository.deleteConversation(tenant, 'conversation-1')).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_ERROR' })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('reserves command quota with an atomic capped upsert', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const executor = { query } as unknown as SqlExecutor
    const repository = new PostgresAiCommandRepository(executor, async () => 'trial')
    await expect(repository.reserveCommand(tenant, '2026-08-19', 10)).resolves.toBeNull()
    expect(String(query.mock.calls[0]?.[0])).toContain('commands_used = ai_command_usage.commands_used + 1')
    expect(String(query.mock.calls[0]?.[0])).toContain('ai_command_usage.commands_used < $4::integer')
  })

  it('claims approvals with a pending-status compare-and-set', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    const executor = { query } as unknown as SqlExecutor
    const repository = new PostgresAiCommandRepository(executor, async () => 'commander')
    await expect(repository.claimAction(tenant, 'action-1', '2026-08-19T00:00:00.000Z')).resolves.toBeNull()
    expect(String(query.mock.calls[0]?.[0])).toContain("execution_status = 'PENDING'")
    expect(String(query.mock.calls[0]?.[0])).toContain('RETURNING *')
  })
})
