import { sha256Hex } from '@profitpilot/crypto'
import type { StoreId } from '@profitpilot/types'
import { verifyWebhookHmac } from './oauth.js'

export const SHOPIFY_WEBHOOK_TOPICS = [
  'app/uninstalled',
  'customers/data_request',
  'customers/redact',
  'shop/redact',
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/cancelled',
  'orders/fulfilled',
  'orders/edited',
  'customers/create',
  'customers/update',
  'products/create',
  'products/update',
  'products/delete',
  'inventory_levels/update',
  'checkouts/create',
  'checkouts/update',
  'carts/update',
  'collections/update',
] as const
export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number]

export type WebhookEvent = Readonly<{ storeId: StoreId; webhookId: string; topic: string; rawBody: string; signature: string }>
export type WebhookStatus = 'PROCESSING' | 'RETRY' | 'PROCESSED' | 'FAILED'
export type WebhookReceipt = Readonly<{ storeId: StoreId; webhookId: string; topic: string; payloadHash: string; status: WebhookStatus; attempts: number; nextAttemptAt: number | null; lastError: string | null; receivedAt: number; processedAt: number | null; failedAt: number | null }>
export type WebhookAuditEvent = Readonly<{ storeId: StoreId; webhookId: string; event: 'claimed' | 'processed' | 'retry_scheduled' | 'failed'; detail: string; at: number }>

export interface WebhookReceiptStore {
  claim(storeId: StoreId, webhookId: string): Promise<boolean>
}

export interface WebhookProcessingStore extends WebhookReceiptStore {
  begin(event: WebhookEvent, now?: number): Promise<boolean>
  markProcessed(storeId: StoreId, webhookId: string, now?: number): Promise<void>
  markFailed(storeId: StoreId, webhookId: string, reason: string, now?: number): Promise<WebhookStatus>
  get(storeId: StoreId, webhookId: string): Promise<WebhookReceipt | null>
  auditTrail(): readonly WebhookAuditEvent[] | Promise<readonly WebhookAuditEvent[]>
}

export class InMemoryWebhookReceiptStore implements WebhookReceiptStore {
  private readonly seen = new Set<string>()

  public async claim(storeId: StoreId, webhookId: string): Promise<boolean> {
    const key = `${storeId}:${webhookId}`
    if (this.seen.has(key)) return false
    this.seen.add(key)
    return true
  }
}

export class InMemoryWebhookProcessingLedger implements WebhookProcessingStore {
  private readonly receipts = new Map<string, WebhookReceipt>()
  private readonly audit: WebhookAuditEvent[] = []
  private readonly maxAttempts: number

  public constructor(maxAttempts = 3) {
    if (maxAttempts < 1) throw new RangeError('Webhook max attempts must be positive')
    this.maxAttempts = maxAttempts
  }

  public async claim(storeId: StoreId, webhookId: string): Promise<boolean> {
    const receipt = this.receipts.get(this.key(storeId, webhookId))
    if (!receipt) return true
    return receipt.status === 'RETRY'
  }

  public async begin(event: WebhookEvent, now = Date.now()): Promise<boolean> {
    const key = this.key(event.storeId, event.webhookId)
    const existing = this.receipts.get(key)
    if (existing) {
      if (existing.status !== 'RETRY' || (existing.nextAttemptAt !== null && existing.nextAttemptAt > now)) return false
      const retrying: WebhookReceipt = { ...existing, status: 'PROCESSING', attempts: existing.attempts + 1, nextAttemptAt: null, lastError: null }
      this.receipts.set(key, retrying)
      this.audit.push({ storeId: event.storeId, webhookId: event.webhookId, event: 'claimed', detail: `retry attempt ${retrying.attempts}`, at: now })
      return true
    }
    const receipt: WebhookReceipt = { storeId: event.storeId, webhookId: event.webhookId, topic: event.topic, payloadHash: sha256Hex(event.rawBody), status: 'PROCESSING', attempts: 1, nextAttemptAt: null, lastError: null, receivedAt: now, processedAt: null, failedAt: null }
    this.receipts.set(key, receipt)
    this.audit.push({ storeId: event.storeId, webhookId: event.webhookId, event: 'claimed', detail: 'first attempt', at: now })
    return true
  }

  public async markProcessed(storeId: StoreId, webhookId: string, now = Date.now()): Promise<void> {
    const key = this.key(storeId, webhookId)
    const receipt = this.receipts.get(key)
    if (!receipt) throw new Error('Cannot process an unknown webhook receipt')
    this.receipts.set(key, { ...receipt, status: 'PROCESSED', processedAt: now, nextAttemptAt: null })
    this.audit.push({ storeId, webhookId, event: 'processed', detail: 'handler completed', at: now })
  }

  public async markFailed(storeId: StoreId, webhookId: string, reason: string, now = Date.now()): Promise<WebhookStatus> {
    const key = this.key(storeId, webhookId)
    const receipt = this.receipts.get(key)
    if (!receipt) throw new Error('Cannot fail an unknown webhook receipt')
    const terminal = receipt.attempts >= this.maxAttempts
    const status: WebhookStatus = terminal ? 'FAILED' : 'RETRY'
    const nextAttemptAt = terminal ? null : now + Math.min(60_000, 2 ** receipt.attempts * 1_000)
    this.receipts.set(key, { ...receipt, status, nextAttemptAt, lastError: reason, failedAt: terminal ? now : null })
    this.audit.push({ storeId, webhookId, event: terminal ? 'failed' : 'retry_scheduled', detail: reason, at: now })
    return status
  }

  public async get(storeId: StoreId, webhookId: string): Promise<WebhookReceipt | null> {
    return this.receipts.get(this.key(storeId, webhookId)) ?? null
  }

  public auditTrail(): readonly WebhookAuditEvent[] {
    return [...this.audit]
  }

  private key(storeId: StoreId, webhookId: string): string {
    return `${storeId}:${webhookId}`
  }
}

export class WebhookVerifier {
  private readonly secret: string
  private readonly receipts: WebhookReceiptStore

  public constructor(secret: string, receipts: WebhookReceiptStore) {
    if (!secret.trim()) throw new TypeError('Shopify webhook secret cannot be empty')
    this.secret = secret
    this.receipts = receipts
  }

  public async verifyAndClaim(event: WebhookEvent): Promise<Readonly<{ accepted: boolean; payloadHash: string }>> {
    if (!verifyWebhookHmac(event.rawBody, event.signature, this.secret)) throw new Error('Invalid Shopify webhook HMAC')
    const accepted = await this.receipts.claim(event.storeId, event.webhookId)
    return { accepted, payloadHash: sha256Hex(event.rawBody) }
  }
}

export type WebhookProcessResult = Readonly<{ status: 'processed' | 'deduped' | 'retry' | 'failed'; payloadHash: string }>

export class WebhookProcessor {
  private readonly verifier: WebhookVerifier
  private readonly ledger: WebhookProcessingStore
  private readonly now: () => number

  public constructor(verifier: WebhookVerifier, ledger: WebhookProcessingStore, now: () => number = () => Date.now()) {
    this.verifier = verifier
    this.ledger = ledger
    this.now = now
  }

  public async process(event: WebhookEvent, handler: (rawBody: string) => Promise<void>): Promise<WebhookProcessResult> {
    const verified = await this.verifier.verifyAndClaim(event)
    if (!verified.accepted) return { status: 'deduped', payloadHash: verified.payloadHash }
    const begun = await this.ledger.begin(event, this.now())
    if (!begun) return { status: 'deduped', payloadHash: verified.payloadHash }
    try {
      await handler(event.rawBody)
      await this.ledger.markProcessed(event.storeId, event.webhookId, this.now())
      return { status: 'processed', payloadHash: verified.payloadHash }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown webhook handler failure'
      const status = await this.ledger.markFailed(event.storeId, event.webhookId, reason, this.now())
      return { status: status === 'FAILED' ? 'failed' : 'retry', payloadHash: verified.payloadHash }
    }
  }
}
