import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
export type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
export type Ticket = Readonly<{ id: string; shopId: string; subject: string; description?: string; priority: TicketPriority; status: TicketStatus; createdAt: number; updatedAt: number; version: number }>
export type TicketMessage = Readonly<{ id: string; ticketId: string; author: 'MERCHANT' | 'OPERATOR'; body: string; createdAt: number }>

export function priorityForPlan(plan: PlanTier): TicketPriority { return plan === 'commander' ? 'URGENT' : plan === 'growth' ? 'HIGH' : 'NORMAL' }

export class ThreadLedger {
  private readonly tickets = new Map<string, Ticket>()
  private readonly messages = new Map<string, TicketMessage[]>()
  public create(ticket: Ticket): Ticket { if (this.tickets.has(ticket.id)) throw new AppError('CONFLICT', 'Ticket already exists', 409); this.tickets.set(ticket.id, ticket); this.messages.set(ticket.id, []); return ticket }
  public list(shopId: string): readonly Ticket[] { return [...this.tickets.values()].filter((ticket) => ticket.shopId === shopId).sort((left, right) => right.updatedAt - left.updatedAt) }
  public get(id: string): Ticket | null { return this.tickets.get(id) ?? null }
  public addMessage(message: TicketMessage): Ticket { const ticket = this.tickets.get(message.ticketId); if (!ticket) throw new AppError('NOT_FOUND', 'Ticket not found', 404); const list = this.messages.get(message.ticketId) ?? []; list.push(message); this.messages.set(message.ticketId, list); const updated = { ...ticket, updatedAt: message.createdAt, version: ticket.version + 1 }; this.tickets.set(ticket.id, updated); return updated }
  public messagesFor(ticketId: string): readonly TicketMessage[] { return this.messages.get(ticketId) ?? [] }
  public setStatus(id: string, status: TicketStatus, expectedVersion: number, now = Date.now()): Ticket { const ticket = this.tickets.get(id); if (!ticket || ticket.version !== expectedVersion) throw new AppError('CONFLICT', 'Ticket changed; reload before updating', 409); const next = { ...ticket, status, version: ticket.version + 1, updatedAt: now }; this.tickets.set(id, next); return next }
}
