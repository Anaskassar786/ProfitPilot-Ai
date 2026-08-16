import { sha256Hex } from '@profitpilot/crypto'
import type { StoreId } from '@profitpilot/types'
import { withTenantContext } from '@profitpilot/db'
import type { SqlExecutor } from '@profitpilot/db'
import type { WebhookEvent, WebhookAuditEvent, WebhookProcessingStore, WebhookReceipt, WebhookStatus } from './webhooks.js'

type ReceiptRow = { store_id: string; webhook_id: string; topic: string; payload_hash: string; status: WebhookStatus; attempts: number; next_attempt_at: Date | null; last_error: string | null; received_at: Date; processed_at: Date | null; failed_at: Date | null } & Record<string, unknown>
type AuditRow = { store_id: string; webhook_id: string; event: WebhookAuditEvent['event']; detail: string; at: Date } & Record<string, unknown>

export class PostgresWebhookProcessingStore implements WebhookProcessingStore {
  private readonly executor: SqlExecutor
  private readonly maxAttempts: number

  public constructor(executor: SqlExecutor, maxAttempts = 3) {
    if (maxAttempts < 1) throw new RangeError('Webhook max attempts must be positive')
    this.executor = executor
    this.maxAttempts = maxAttempts
  }

  public async claim(storeId: StoreId, webhookId: string): Promise<boolean> {
    const receipt = await this.get(storeId, webhookId)
    return receipt === null || receipt.status === 'RETRY'
  }

  public begin(event: WebhookEvent, now = Date.now()): Promise<boolean> {
    return withTenantContext(this.executor, event.storeId, async (client) => {
      const payloadHash = sha256Hex(event.rawBody)
      const result = await client.query<ReceiptRow>(
        `INSERT INTO webhook_receipts (store_id, webhook_id, topic, payload_hash, status, attempts, received_at) VALUES ($1, $2, $3, $4, 'PROCESSING', 1, to_timestamp($5 / 1000.0)) ON CONFLICT (store_id, webhook_id) DO UPDATE SET status = 'PROCESSING', attempts = webhook_receipts.attempts + 1, next_attempt_at = NULL, last_error = NULL WHERE webhook_receipts.status = 'RETRY' AND (webhook_receipts.next_attempt_at IS NULL OR webhook_receipts.next_attempt_at <= to_timestamp($5 / 1000.0)) RETURNING store_id, webhook_id, topic, payload_hash, status, attempts, next_attempt_at, last_error, received_at, processed_at, failed_at`,
        [event.storeId, event.webhookId, event.topic, payloadHash, now],
      )
      if (result.rowCount === 0) return false
      await this.writeAudit(client, event.storeId, event.webhookId, 'claimed', result.rows[0]?.attempts === 1 ? 'first attempt' : 'retry attempt', now)
      return true
    })
  }

  public markProcessed(storeId: StoreId, webhookId: string, now = Date.now()): Promise<void> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query(`UPDATE webhook_receipts SET status = 'PROCESSED', processed_at = to_timestamp($3 / 1000.0), next_attempt_at = NULL WHERE store_id = $1 AND webhook_id = $2`, [storeId, webhookId, now])
      if (result.rowCount === 0) throw new Error('Cannot process an unknown webhook receipt')
      await this.writeAudit(client, storeId, webhookId, 'processed', 'handler completed', now)
    })
  }

  public markFailed(storeId: StoreId, webhookId: string, reason: string, now = Date.now()): Promise<WebhookStatus> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const existing = await client.query<ReceiptRow>('SELECT store_id, webhook_id, topic, payload_hash, status, attempts, next_attempt_at, last_error, received_at, processed_at, failed_at FROM webhook_receipts WHERE store_id = $1 AND webhook_id = $2 LIMIT 1', [storeId, webhookId])
      const receipt = existing.rows[0]
      if (!receipt) throw new Error('Cannot fail an unknown webhook receipt')
      const terminal = receipt.attempts >= this.maxAttempts
      const status: WebhookStatus = terminal ? 'FAILED' : 'RETRY'
      const nextAttemptAt = terminal ? null : now + Math.min(60_000, 2 ** receipt.attempts * 1_000)
      await client.query(`UPDATE webhook_receipts SET status = $3, last_error = $4, next_attempt_at = CASE WHEN $5 IS NULL THEN NULL ELSE to_timestamp($5 / 1000.0) END, failed_at = CASE WHEN $5 IS NULL THEN to_timestamp($6 / 1000.0) ELSE NULL END WHERE store_id = $1 AND webhook_id = $2`, [storeId, webhookId, status, reason, nextAttemptAt, now])
      await this.writeAudit(client, storeId, webhookId, terminal ? 'failed' : 'retry_scheduled', reason, now)
      return status
    })
  }

  public get(storeId: StoreId, webhookId: string): Promise<WebhookReceipt | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<ReceiptRow>('SELECT store_id, webhook_id, topic, payload_hash, status, attempts, next_attempt_at, last_error, received_at, processed_at, failed_at FROM webhook_receipts WHERE store_id = $1 AND webhook_id = $2 LIMIT 1', [storeId, webhookId])
      const row = result.rows[0]
      return row ? toReceipt(row) : null
    })
  }

  public async auditTrail(): Promise<readonly WebhookAuditEvent[]> {
    // This operator-only method intentionally remains subject to RLS. Production
    // callers without a tenant context receive no cross-store audit disclosure.
    const result = await this.executor.query<AuditRow>('SELECT store_id, webhook_id, event, detail, at FROM webhook_audit_events ORDER BY at', [])
    return result.rows.map((row) => ({ storeId: row.store_id as StoreId, webhookId: row.webhook_id, event: row.event, detail: row.detail, at: row.at.valueOf() }))
  }

  private async writeAudit(client: SqlExecutor, storeId: StoreId, webhookId: string, event: WebhookAuditEvent['event'], detail: string, at: number): Promise<void> {
    await client.query('INSERT INTO webhook_audit_events (store_id, webhook_id, event, detail, at) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))', [storeId, webhookId, event, detail, at])
  }
}

function toReceipt(row: ReceiptRow): WebhookReceipt {
  return { storeId: row.store_id as StoreId, webhookId: row.webhook_id, topic: row.topic, payloadHash: row.payload_hash, status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at?.valueOf() ?? null, lastError: row.last_error, receivedAt: row.received_at.valueOf(), processedAt: row.processed_at?.valueOf() ?? null, failedAt: row.failed_at?.valueOf() ?? null }
}
