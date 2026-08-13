import { AppError } from '@profitpilot/types'
import type { EmailMessage, EmailTransport } from './email.js'

export type SuppressionReason = 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINT' | 'LEGAL_REQUEST'
export type SuppressionEntry = Readonly<{ shopId: string; recipientKey: string; reason: SuppressionReason; createdAt: number }>
export class SuppressionLedger {
  private readonly entries = new Map<string, SuppressionEntry>()
  public suppress(entry: SuppressionEntry): void { this.entries.set(`${entry.shopId}:${entry.recipientKey}`, entry) }
  public isSuppressed(shopId: string, recipientKey: string): boolean { return this.entries.has(`${shopId}:${recipientKey}`) }
  public get(shopId: string, recipientKey: string): SuppressionEntry | null { return this.entries.get(`${shopId}:${recipientKey}`) ?? null }
}

export type BatchMessage = Readonly<EmailMessage & { shopId: string; recipientKey: string; jobId: string; messageId: string }>
export type BatchResult = Readonly<{ attempted: number; sent: number; suppressed: number; deduped: number; failed: number; messageIds: readonly string[] }>
export class InMemorySendLedger {
  private readonly sent = new Map<string, string>()
  public get(jobId: string): string | null { return this.sent.get(jobId) ?? null }
  public put(jobId: string, messageId: string): void { this.sent.set(jobId, messageId) }
}

export class BatchSender {
  private readonly transport: EmailTransport
  private readonly suppression: SuppressionLedger
  private readonly ledger: InMemorySendLedger
  private readonly batchSize: number
  private readonly throttle: (batchIndex: number) => Promise<void>
  public constructor(transport: EmailTransport, suppression: SuppressionLedger, ledger: InMemorySendLedger, batchSize = 50, throttle: (batchIndex: number) => Promise<void> = async () => undefined) { this.transport = transport; this.suppression = suppression; this.ledger = ledger; this.batchSize = batchSize; this.throttle = throttle; if (batchSize < 1 || batchSize > 50) throw new RangeError('Email batch size must be between 1 and 50') }
  public async send(messages: readonly BatchMessage[]): Promise<BatchResult> { let sent = 0; let suppressed = 0; let deduped = 0; let failed = 0; const messageIds: string[] = []; for (let start = 0, batchIndex = 0; start < messages.length; start += this.batchSize, batchIndex += 1) { if (batchIndex > 0) await this.throttle(batchIndex); const batch = messages.slice(start, start + this.batchSize); for (const message of batch) { if (this.suppression.isSuppressed(message.shopId, message.recipientKey)) { suppressed += 1; continue } if (this.ledger.get(message.jobId)) { deduped += 1; continue } try { const result = await this.transport.send(message); this.ledger.put(message.jobId, result.messageId); messageIds.push(result.messageId); sent += 1 } catch { failed += 1 } } } return { attempted: messages.length, sent, suppressed, deduped, failed, messageIds } }
}

export function assertBatchLimit(rows: number, max = 50_000): void { if (!Number.isInteger(rows) || rows < 0 || rows > max) throw new AppError('VALIDATION_ERROR', `Export/send row limit is ${max}`, 400, { rows, max }) }
