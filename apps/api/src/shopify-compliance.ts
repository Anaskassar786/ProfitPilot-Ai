import type { SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import type { TokenVault, WebhookEvent } from '@profitpilot/shopify'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export type PrivacyRequestTopic = 'customers/data_request' | 'customers/redact'
export type PrivacyRequestRecord = Readonly<{ storeId: StoreId; webhookId: string; topic: PrivacyRequestTopic; customerId: string | null; status: 'RECEIVED' | 'COMPLETED'; receivedAt: number; dueAt: number; completedAt: number | null }>

export interface CustomerPrivacyRepository {
  record(request: PrivacyRequestRecord): Promise<void>
  redactCustomer(storeId: StoreId, identifiers: readonly string[], webhookId: string, now: number): Promise<void>
  redactShop(storeId: StoreId, shopDomain: string): Promise<void>
}

export class PostgresCustomerPrivacyRepository implements CustomerPrivacyRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public record(request: PrivacyRequestRecord): Promise<void> {
    return withTenantContext(this.executor, request.storeId, async (client) => {
      await client.query(
        `INSERT INTO privacy_compliance_requests (store_id, webhook_id, topic, shopify_customer_id, status, received_at, due_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8 / 1000.0) END)
         ON CONFLICT (store_id, webhook_id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at`,
        [request.storeId, request.webhookId, request.topic, request.customerId, request.status, request.receivedAt, request.dueAt, request.completedAt],
      )
    })
  }

  public redactCustomer(storeId: StoreId, identifiers: readonly string[], webhookId: string, now: number): Promise<void> {
    return withTenantContext(this.executor, storeId, async (client) => {
      // Delete the canonical customer sync row, then remove the same person's
      // protected fields from order payloads while retaining non-personal order
      // totals needed for merchant accounting and deterministic analytics.
      await client.query(`DELETE FROM sync_records WHERE store_id = $1 AND module = 'customers' AND (record_id = ANY($2::text[]) OR payload->>'id' = ANY($2::text[]) OR payload->>'admin_graphql_api_id' = ANY($2::text[]))`, [storeId, identifiers])
      await client.query(
        `UPDATE sync_records
         SET payload = (payload - 'email' - 'phone' - 'note' - 'billing_address' - 'shipping_address') || '{"customer":null}'::jsonb,
             synced_at = now()
         WHERE store_id = $1 AND module = 'orders'
           AND (payload->'customer'->>'id' = ANY($2::text[]) OR payload->'customer'->>'admin_graphql_api_id' = ANY($2::text[]))`,
        [storeId, identifiers],
      )
      await client.query(`DELETE FROM suppression_ledger WHERE store_id = $1 AND recipient_key = ANY($2::text[])`, [storeId, identifiers])
      await client.query(`DELETE FROM campaign_sends WHERE store_id = $1 AND recipient_key = ANY($2::text[])`, [storeId, identifiers])
      await client.query(`UPDATE privacy_compliance_requests SET status = 'COMPLETED', shopify_customer_id = NULL, completed_at = to_timestamp($3 / 1000.0) WHERE store_id = $1 AND webhook_id = $2`, [storeId, webhookId, now])
    })
  }

  public async redactShop(storeId: StoreId, shopDomain: string): Promise<void> {
    await withTenantContext(this.executor, storeId, async (client) => {
      // Every tenant table has ON DELETE CASCADE from stores. OAuth states are
      // domain-scoped and intentionally have no store FK, so clear them first.
      await client.query('DELETE FROM shopify_oauth_states WHERE shop_domain = $1', [shopDomain])
      await client.query('DELETE FROM stores WHERE id = $1', [storeId])
    })
  }
}

export class ShopifyComplianceService {
  public constructor(private readonly repository: CustomerPrivacyRepository, private readonly tokens: Pick<TokenVault, 'remove'>, private readonly now: () => number = () => Date.now()) {}

  public async handle(event: WebhookEvent): Promise<void> {
    if (event.topic === 'customers/data_request') {
      const payload = compliancePayload(event.rawBody)
      const customerId = customerIdentifier(payload)
      const at = this.now()
      await this.repository.record({ storeId: event.storeId, webhookId: event.webhookId, topic: event.topic, customerId, status: 'RECEIVED', receivedAt: at, dueAt: at + 30 * 24 * 60 * 60_000, completedAt: null })
      return
    }
    if (event.topic === 'customers/redact') {
      const payload = compliancePayload(event.rawBody)
      const customerId = customerIdentifier(payload)
      if (!customerId) throw new AppError('VALIDATION_ERROR', 'Shopify customer redaction payload is missing customer.id', 400)
      const identifiers = customerIdentifiers(customerId)
      const at = this.now()
      await this.repository.record({ storeId: event.storeId, webhookId: event.webhookId, topic: event.topic, customerId, status: 'RECEIVED', receivedAt: at, dueAt: at + 30 * 24 * 60 * 60_000, completedAt: null })
      await this.repository.redactCustomer(event.storeId, identifiers, event.webhookId, at)
      return
    }
    // shop/redact is finalized only after WebhookProcessor has marked its
    // receipt processed. Deleting stores here would cascade-delete the receipt
    // before the replay ledger can acknowledge Shopify.
    if (event.topic === 'shop/redact') compliancePayload(event.rawBody)
  }

  public async finalize(event: WebhookEvent): Promise<void> {
    if (event.topic !== 'shop/redact') return
    const payload = compliancePayload(event.rawBody)
    const shopDomain = stringValue(payload.shop_domain) ?? stringValue(payload.shopDomain)
    if (!shopDomain) throw new AppError('VALIDATION_ERROR', 'Shopify shop redaction payload is missing shop_domain', 400)
    await this.tokens.remove(shopDomain)
    await this.repository.redactShop(event.storeId, shopDomain)
  }
}

export class InMemoryCustomerPrivacyRepository implements CustomerPrivacyRepository {
  public readonly requests: PrivacyRequestRecord[] = []
  private readonly customers = new Map<string, Set<string>>()
  private readonly shops = new Set<string>()
  public seedShop(storeId: StoreId, customerIds: readonly string[] = []): void { this.shops.add(storeId); this.customers.set(storeId, new Set(customerIds)) }
  public hasCustomer(storeId: StoreId, customerId: string): boolean { return this.customers.get(storeId)?.has(customerId) ?? false }
  public hasShop(storeId: StoreId): boolean { return this.shops.has(storeId) }
  public async record(request: PrivacyRequestRecord): Promise<void> { const index = this.requests.findIndex((item) => item.storeId === request.storeId && item.webhookId === request.webhookId); if (index >= 0) this.requests[index] = request; else this.requests.push(request) }
  public async redactCustomer(storeId: StoreId, identifiers: readonly string[], webhookId: string, now: number): Promise<void> { const rows = this.customers.get(storeId); for (const identifier of identifiers) rows?.delete(identifier); const index = this.requests.findIndex((item) => item.storeId === storeId && item.webhookId === webhookId); if (index >= 0 && this.requests[index]) this.requests[index] = { ...this.requests[index], customerId: null, status: 'COMPLETED', completedAt: now } }
  public async redactShop(storeId: StoreId): Promise<void> { this.customers.delete(storeId); this.shops.delete(storeId) }
}

function compliancePayload(rawBody: string): Readonly<Record<string, unknown>> {
  let parsed: unknown
  try { parsed = JSON.parse(rawBody) } catch { throw new AppError('VALIDATION_ERROR', 'Shopify compliance webhook payload is invalid JSON', 400) }
  if (!isRecord(parsed)) throw new AppError('VALIDATION_ERROR', 'Shopify compliance webhook payload must be an object', 400)
  return parsed
}
function customerIdentifier(payload: Readonly<Record<string, unknown>>): string | null { const customer = isRecord(payload.customer) ? payload.customer : null; return scalarString(customer?.id ?? payload.customer_id) }
function customerIdentifiers(id: string): readonly string[] { const normalized = id.replace(/^gid:\/\/shopify\/Customer\//, ''); return [...new Set([id, normalized, `gid://shopify/Customer/${normalized}`])] }
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null }
function scalarString(value: unknown): string | null { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

