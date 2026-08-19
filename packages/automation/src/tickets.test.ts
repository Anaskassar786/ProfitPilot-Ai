import { describe, expect, it } from 'vitest'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { AppError } from '@profitpilot/types'
import { PostgresTicketRepository, ThreadLedger, priorityForPlan } from './tickets.js'
import type { Ticket } from './tickets.js'

/**
 * Support-ticket persistence contracts. The production bootstrap now wires
 * PostgresTicketRepository (migrations 0008 + 0014 created the tables with
 * RLS tenant isolation long ago — the wiring was the missing piece), while
 * ThreadLedger stays for route tests. These guards keep both honest.
 */

const ticketFixture = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: '11111111-1111-1111-1111-111111111111',
  shopId: 'store-1',
  subject: '[Billing & Plans] Invoices are missing',
  description: 'The billing page shows no invoices.',
  priority: 'NORMAL',
  status: 'OPEN',
  createdAt: 1_755_000_000_000,
  updatedAt: 1_755_000_000_000,
  version: 0,
  ...overrides,
})

const rowFixture = (overrides: Record<string, unknown> = {}): QueryResultRow => ({
  id: '11111111-1111-1111-1111-111111111111',
  store_id: 'store-1',
  subject: '[Billing & Plans] Invoices are missing',
  description: 'The billing page shows no invoices.',
  priority: 'NORMAL',
  status: 'OPEN',
  version: 0,
  created_at: new Date(1_755_000_000_000),
  updated_at: new Date(1_755_000_000_000),
  ...overrides,
})

function makeExecutor(handlers: ReadonlyArray<{ match: string; rows: readonly QueryResultRow[] }>): { executor: SqlExecutor; calls: ReadonlyArray<{ text: string; values: readonly unknown[] }> } {
  const calls: { text: string; values: readonly unknown[] }[] = []
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
      calls.push({ text, values })
      const handler = handlers.find((entry) => text.includes(entry.match))
      return { rows: (handler?.rows ?? []) as unknown as Row[], rowCount: handler?.rows.length ?? 0 }
    },
  }
  return { executor, calls }
}

describe('priorityForPlan', () => {
  it('maps plans to ticket priorities', () => {
    expect(priorityForPlan('commander')).toBe('URGENT')
    expect(priorityForPlan('growth')).toBe('HIGH')
    expect(priorityForPlan('start')).toBe('NORMAL')
  })
})

describe('ThreadLedger (test double kept for route tests)', () => {
  it('creates, lists newest-updated first, and rejects duplicate ids', () => {
    const ledger = new ThreadLedger()
    const older = ticketFixture({ id: 'a', updatedAt: 100 })
    const newer = ticketFixture({ id: 'b', updatedAt: 200 })
    ledger.create(older)
    ledger.create(newer)
    expect(ledger.list('store-1').map((ticket) => ticket.id)).toEqual(['b', 'a'])
    expect(ledger.list('other-store')).toEqual([])
    expect(() => ledger.create(older)).toThrowError(AppError)
  })
})

describe('PostgresTicketRepository', () => {
  it('creates tickets with parameterized, tenant-scoped SQL and maps rows to epoch milliseconds', async () => {
    const { executor, calls } = makeExecutor([{ match: 'INSERT INTO support_tickets', rows: [rowFixture()] }])
    const repository = new PostgresTicketRepository(executor)
    const created = await repository.create(ticketFixture())
    expect(created.id).toBe('11111111-1111-1111-1111-111111111111')
    expect(created.shopId).toBe('store-1')
    expect(created.createdAt).toBe(1_755_000_000_000)
    expect(created.updatedAt).toBe(1_755_000_000_000)
    const insert = calls.find((call) => call.text.includes('INSERT INTO support_tickets'))!
    expect(insert.text).not.toContain('store-1')
    expect(insert.values[1]).toBe('store-1')
    expect(insert.values[3]).toBe('The billing page shows no invoices.')
    expect(insert.text).toContain('ON CONFLICT (id) DO NOTHING')
  })

  it('translates an id conflict into a 409 CONFLICT error', async () => {
    const { executor } = makeExecutor([])
    const repository = new PostgresTicketRepository(executor)
    await expect(repository.create(ticketFixture())).rejects.toMatchObject({ status: 409, code: 'CONFLICT' })
  })

  it('lists tickets newest-updated first via SQL ordering', async () => {
    const { executor, calls } = makeExecutor([{ match: 'FROM support_tickets', rows: [rowFixture({ id: 'b', updated_at: new Date(200) }), rowFixture({ id: 'a', updated_at: new Date(100) })] }])
    const repository = new PostgresTicketRepository(executor)
    const list = await repository.list('store-1')
    expect(list.map((ticket) => ticket.id)).toEqual(['b', 'a'])
    expect(list[1]?.updatedAt).toBe(100)
    const select = calls.find((call) => call.text.includes('SELECT'))!
    expect(select.text).toContain('ORDER BY updated_at DESC')
    expect(select.values).toEqual(['store-1'])
  })

  it('turns an empty description column back into an absent optional field', async () => {
    const { executor } = makeExecutor([{ match: 'FROM support_tickets', rows: [rowFixture({ description: '' })] }])
    const repository = new PostgresTicketRepository(executor)
    const [ticket] = await repository.list('store-1')
    expect(ticket?.description).toBeUndefined()
  })

  it('appends a message, bumps the ticket version, and reads the thread back in order', async () => {
    const messageRow = { id: 'm-1', ticket_id: 't-1', author: 'OPERATOR', body: 'We are on it.', created_at: new Date(500) }
    const { executor, calls } = makeExecutor([
      { match: 'FROM support_tickets', rows: [rowFixture()] },
      { match: 'UPDATE support_tickets', rows: [rowFixture({ version: 1 })] },
      { match: 'FROM support_thread_messages', rows: [messageRow] },
    ])
    const repository = new PostgresTicketRepository(executor)
    const updated = await repository.addMessage('store-1', { id: 'm-1', ticketId: 't-1', author: 'OPERATOR', body: 'We are on it.', createdAt: 500 })
    expect(updated.version).toBe(1)
    const insert = calls.find((call) => call.text.includes('INSERT INTO support_thread_messages'))!
    expect(insert.values).toEqual(['m-1', 't-1', 'store-1', 'OPERATOR', 'We are on it.', 500])
    const messages = await repository.messagesFor('store-1', 't-1')
    expect(messages).toEqual([{ id: 'm-1', ticketId: 't-1', author: 'OPERATOR', body: 'We are on it.', createdAt: 500 }])
  })

  it('rejects addMessage for an unknown ticket with NOT_FOUND', async () => {
    const { executor } = makeExecutor([])
    const repository = new PostgresTicketRepository(executor)
    await expect(repository.addMessage('store-1', { id: 'm-1', ticketId: 'missing', author: 'OPERATOR', body: 'hi', createdAt: 1 })).rejects.toMatchObject({ status: 404 })
  })

  it('guards status transitions with the expected version (optimistic concurrency)', async () => {
    // First UPDATE matches the expected version and returns the bumped row;
    // a second UPDATE with a stale version matches nothing → 409.
    let matched = true
    const calls: { text: string; values: readonly unknown[] }[] = []
    const executor: SqlExecutor = {
      async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
        calls.push({ text, values })
        if (text.includes('UPDATE support_tickets') && matched) { matched = false; return { rows: [rowFixture({ status: 'RESOLVED', version: 1 })] as unknown as Row[], rowCount: 1 } }
        return { rows: [], rowCount: 0 }
      },
    }
    const repository = new PostgresTicketRepository(executor)
    const updated = await repository.setStatus('store-1', 't-1', 'RESOLVED', 0, 999)
    expect(updated.status).toBe('RESOLVED')
    const update = calls.find((call) => call.text.includes('UPDATE support_tickets'))!
    expect(update.text).toContain('AND version = $5') // optimistic-concurrency guard present
    expect(update.values).toEqual(['store-1', 't-1', 'RESOLVED', 999, 0])
    await expect(repository.setStatus('store-1', 't-1', 'RESOLVED', 7, 999)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' })
  })
})
