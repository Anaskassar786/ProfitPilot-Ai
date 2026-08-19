import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
export type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
export type Ticket = Readonly<{ id: string; shopId: string; subject: string; description?: string; priority: TicketPriority; status: TicketStatus; createdAt: number; updatedAt: number; version: number }>
export type TicketMessage = Readonly<{ id: string; ticketId: string; author: 'MERCHANT' | 'OPERATOR'; body: string; createdAt: number }>

export function priorityForPlan(plan: PlanTier): TicketPriority { return plan === 'commander' ? 'URGENT' : plan === 'growth' ? 'HIGH' : 'NORMAL' }

/**
 * The contract the support-ticket routes depend on. Both the in-memory
 * ledger (tests) and the durable Postgres repository (production) satisfy
 * it; sync or async returns are both accepted so the routes can simply
 * `await` either implementation.
 */
export interface TicketStore {
  create(ticket: Ticket): Ticket | Promise<Ticket>
  list(shopId: string): readonly Ticket[] | Promise<readonly Ticket[]>
}

export class ThreadLedger {
  private readonly tickets = new Map<string, Ticket>()
  private readonly messages = new Map<string, TicketMessage[]>()
  public create(ticket: Ticket): Ticket { if (this.tickets.has(ticket.id)) throw new AppError('CONFLICT', 'Ticket already exists', 409); this.tickets.set(ticket.id, ticket); this.messages.set(ticket.id, []); return ticket }
  public list(shopId: string): readonly Ticket[] { return [...this.tickets.values()].filter((ticket) => ticket.shopId === shopId).sort((left, right) => right.updatedAt - left.updatedAt) }
  public get(id: string): Ticket | null { return this.tickets.get(id) ?? null }
  public addMessage(message: TicketMessage): Ticket { const ticket = this.tickets.get(message.ticketId); if (!ticket) throw new AppError('NOT_FOUND', 'Ticket not found', 404); const list = this.messages.get(message.ticketId) ?? []; list.push(message); this.messages.set(message.ticketId, list); const updated = { ...ticket, updatedAt: message.createdAt, version: ticket.version + 1 }; this.tickets.set(ticket.id, updated); return updated }
  public messagesFor(ticketId: string): readonly TicketMessage[] { return this.messages.get(ticketId) ?? [] }
  public setStatus(id: string, status: TicketStatus, expectedVersion: number, now = Date.now()): Ticket { const ticket = this.tickets.get(id); if (!ticket || ticket.version !== expectedVersion) throw new AppError('CONFLICT', 'Ticket changed; reload before updating', 409); const next = { ...ticket, status, version: ticket.version + 1, updatedAt: now }; this.tickets.set(ticket.id, next); return next }
}

/** Row shapes of the existing support tables (migrations 0008 + 0014). */
type TicketRow = QueryResultRow & { id: string; store_id: string; subject: string; description: string; priority: TicketPriority; status: TicketStatus; version: number; created_at: Date; updated_at: Date }
type TicketMessageRow = QueryResultRow & { id: string; ticket_id: string; author: 'MERCHANT' | 'OPERATOR'; body: string; created_at: Date }

const TICKET_COLUMNS = 'id, store_id, subject, description, priority, status, version, created_at, updated_at'

function toTicket(row: TicketRow): Ticket {
  const base = {
    id: row.id,
    shopId: row.store_id,
    subject: row.subject,
    priority: row.priority,
    status: row.status,
    version: row.version,
    createdAt: row.created_at instanceof Date ? row.created_at.valueOf() : new Date(row.created_at).valueOf(),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.valueOf() : new Date(row.updated_at).valueOf(),
  }
  // exactOptionalPropertyTypes: an empty description column maps to an
  // absent property, never an explicit `undefined`.
  return row.description.trim().length > 0 ? { ...base, description: row.description } : base
}

function toMessage(row: TicketMessageRow): TicketMessage {
  return { id: row.id, ticketId: row.ticket_id, author: row.author, body: row.body, createdAt: row.created_at instanceof Date ? row.created_at.valueOf() : new Date(row.created_at).valueOf() }
}

/**
 * Durable ticket store backed by the existing `support_tickets` and
 * `support_thread_messages` tables (both already carry row-level tenant
 * isolation policies). Replaces the in-memory ledger in production so a
 * deploy or restart can never wipe a merchant's support history — the
 * Help & Support page keeps every ticket it promises to track.
 *
 * Every query runs inside `withTenantContext`, which pins `app.store_id`
 * on the leased connection so the RLS policies admit only the merchant's
 * own rows.
 */
export class PostgresTicketRepository implements TicketStore {
  public constructor(private readonly executor: SqlExecutor) {}

  public create(ticket: Ticket): Promise<Ticket> {
    return withTenantContext(this.executor, ticket.shopId, async (client) => {
      const result = await client.query<TicketRow>(
        `INSERT INTO support_tickets (${TICKET_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0)) ON CONFLICT (id) DO NOTHING RETURNING ${TICKET_COLUMNS}`,
        [ticket.id, ticket.shopId, ticket.subject, ticket.description ?? '', ticket.priority, ticket.status, ticket.version, ticket.createdAt, ticket.updatedAt],
      )
      const row = result.rows[0]
      if (!row) throw new AppError('CONFLICT', 'Ticket already exists', 409)
      return toTicket(row)
    })
  }

  public list(shopId: string): Promise<readonly Ticket[]> {
    return withTenantContext(this.executor, shopId, async (client) => {
      const result = await client.query<TicketRow>(`SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE store_id = $1 ORDER BY updated_at DESC`, [shopId])
      return result.rows.map(toTicket)
    })
  }

  public async get(shopId: string, id: string): Promise<Ticket | null> {
    return withTenantContext(this.executor, shopId, async (client) => {
      const result = await client.query<TicketRow>(`SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE store_id = $1 AND id = $2 LIMIT 1`, [shopId, id])
      return result.rows[0] ? toTicket(result.rows[0]) : null
    })
  }

  /** Appends a conversation message and bumps the ticket's version + updated_at atomically. */
  public async addMessage(shopId: string, message: TicketMessage): Promise<Ticket> {
    return withTenantContext(this.executor, shopId, async (client) => {
      const existing = await client.query<TicketRow>(`SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE store_id = $1 AND id = $2 LIMIT 1`, [shopId, message.ticketId])
      if (!existing.rows[0]) throw new AppError('NOT_FOUND', 'Ticket not found', 404)
      await client.query(
        `INSERT INTO support_thread_messages (id, ticket_id, store_id, author, body, created_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))`,
        [message.id, message.ticketId, shopId, message.author, message.body, message.createdAt],
      )
      const updated = await client.query<TicketRow>(
        `UPDATE support_tickets SET version = version + 1, updated_at = to_timestamp($3 / 1000.0) WHERE store_id = $1 AND id = $2 RETURNING ${TICKET_COLUMNS}`,
        [shopId, message.ticketId, message.createdAt],
      )
      const row = updated.rows[0]
      if (!row) throw new AppError('NOT_FOUND', 'Ticket not found', 404)
      return toTicket(row)
    })
  }

  public messagesFor(shopId: string, ticketId: string): Promise<readonly TicketMessage[]> {
    return withTenantContext(this.executor, shopId, async (client) => {
      const result = await client.query<TicketMessageRow>('SELECT id, ticket_id, author, body, created_at FROM support_thread_messages WHERE store_id = $1 AND ticket_id = $2 ORDER BY created_at ASC', [shopId, ticketId])
      return result.rows.map(toMessage)
    })
  }

  /** Optimistic-concurrency status change — mirrors ThreadLedger.setStatus semantics on durable storage. */
  public async setStatus(shopId: string, id: string, status: TicketStatus, expectedVersion: number, now = Date.now()): Promise<Ticket> {
    return withTenantContext(this.executor, shopId, async (client) => {
      const result = await client.query<TicketRow>(
        `UPDATE support_tickets SET status = $3, version = version + 1, updated_at = to_timestamp($4 / 1000.0) WHERE store_id = $1 AND id = $2 AND version = $5 RETURNING ${TICKET_COLUMNS}`,
        [shopId, id, status, now, expectedVersion],
      )
      const row = result.rows[0]
      if (!row) throw new AppError('CONFLICT', 'Ticket changed; reload before updating', 409)
      return toTicket(row)
    })
  }
}
