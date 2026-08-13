import { sha256Hex } from '@profitpilot/crypto'
import type { StoreId } from '@profitpilot/types'
import { verifyWebhookHmac } from './oauth.js'

export type WebhookEvent = Readonly<{ storeId: StoreId; webhookId: string; topic: string; rawBody: string; signature: string }>

export interface WebhookReceiptStore {
  claim(storeId: StoreId, webhookId: string): Promise<boolean>
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
