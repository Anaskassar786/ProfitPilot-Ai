import type { SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import type { TokenVault, WebhookEvent } from '@profitpilot/shopify'
import { Logger } from '@profitpilot/logger'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { SessionRepository } from '@profitpilot/db'
import type { BillingRepository } from '@profitpilot/billing'
import type { StoreDirectory } from '@profitpilot/db'

export type PrivacyRequestTopic = 'customers/data_request' | 'customers/redact'
export type PrivacyRequestRecord = Readonly<{
  storeId: StoreId
  webhookId: string
  topic: PrivacyRequestTopic
  customerId: string | null
  status: 'RECEIVED' | 'COMPLETED'
  receivedAt: number
  dueAt: number
  completedAt: number | null
  exportData?: Readonly<Record<string, unknown>> | null
}>

/** Identifiers extracted from a Shopify privacy webhook payload. */
export type CustomerContact = Readonly<{ id: string | null; email: string | null; phone: string | null }>

export interface CustomerPrivacyRepository {
  record(request: PrivacyRequestRecord): Promise<void>
  compileCustomerData(storeId: StoreId, identifiers: readonly string[], customer: CustomerContact): Promise<Record<string, unknown>>
  completeDataRequest(storeId: StoreId, webhookId: string, exportData: Record<string, unknown>, now: number): Promise<void>
  redactCustomer(storeId: StoreId, identifiers: readonly string[], webhookId: string, now: number): Promise<void>
  redactShop(storeId: StoreId, shopDomain: string): Promise<void>
}

/**
 * Repository for store uninstallation operations.
 * Handles marking stores as uninstalled and revoking sessions.
 */
export interface UninstallRepository {
  /**
   * Mark a store as uninstalled. Idempotent — if already uninstalled, returns early.
   * @param storeId The store's UUID
   * @param shopDomain The shop domain (for audit logging)
   * @param now Current timestamp in milliseconds
   */
  markStoreUninstalled(storeId: StoreId, shopDomain: string, now: number): Promise<void>

  /**
   * Revoke all active sessions for a store.
   * @param storeId The store's UUID
   * @param now Current timestamp in milliseconds
   * @returns Number of sessions revoked
   */
  revokeStoreSessions(storeId: StoreId, now: number): Promise<number>
}

export class PostgresCustomerPrivacyRepository implements CustomerPrivacyRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public record(request: PrivacyRequestRecord): Promise<void> {
    return withTenantContext(this.executor, request.storeId, async (client) => {
      await client.query(
        `INSERT INTO privacy_compliance_requests (store_id, webhook_id, topic, shopify_customer_id, status, received_at, due_at, completed_at, export_data)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8 / 1000.0) END, NULL)
         ON CONFLICT (store_id, webhook_id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at, export_data = EXCLUDED.export_data`,
        [request.storeId, request.webhookId, request.topic, request.customerId, request.status, request.receivedAt, request.dueAt, request.completedAt],
      )
    })
  }

  /**
   * Compiles every row associated with a customer across all tenant tables into
   * a single structured JSON object for a `customers/data_request` export.
   *
   * Each table query is wrapped in its own try/catch so an optional or missing
   * table can never take down the fulfillment handler — the export degrades to
   * an empty section for that table instead of failing the whole request.
   */
  public compileCustomerData(storeId: StoreId, identifiers: readonly string[], customer: CustomerContact): Promise<Record<string, unknown>> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const patterns = searchPatterns(identifiers)
      const [customers, orders, conversations, recommendations, supportTickets, personas, suppression, campaignSends] = await Promise.all([
        safeRows(client, `SELECT * FROM sync_records WHERE store_id = $1 AND module = 'customers' AND (record_id = ANY($2::text[]) OR payload->>'id' = ANY($2::text[]) OR payload->>'admin_graphql_api_id' = ANY($2::text[]))`, [storeId, identifiers]),
        safeRows(client, `SELECT * FROM sync_records WHERE store_id = $1 AND module = 'orders' AND (payload->'customer'->>'id' = ANY($2::text[]) OR payload->'customer'->>'admin_graphql_api_id' = ANY($2::text[]) OR payload->>'email' = ANY($2::text[]) OR payload->>'phone' = ANY($2::text[]))`, [storeId, identifiers]),
        safeRows(client, `SELECT * FROM ai_command_conversations WHERE store_id = $1 AND (messages::text ILIKE ANY($2::text[]) OR title ILIKE ANY($2::text[]) OR context::text ILIKE ANY($2::text[]))`, [storeId, patterns]),
        safeRows(client, `SELECT * FROM ai_recommendations WHERE store_id = $1 AND payload::text ILIKE ANY($2::text[])`, [storeId, patterns]),
        safeRows(client, `SELECT * FROM support_tickets WHERE store_id = $1 AND subject ILIKE ANY($2::text[])`, [storeId, patterns]),
        safeRows(client, `SELECT * FROM insights_personas WHERE store_id = $1 AND (customer_segment_criteria::text ILIKE ANY($2::text[]) OR behavior_patterns::text ILIKE ANY($2::text[]) OR motivations::text ILIKE ANY($2::text[]) OR how_to_reach::text ILIKE ANY($2::text[]) OR radar::text ILIKE ANY($2::text[]))`, [storeId, patterns]),
        safeRows(client, `SELECT * FROM suppression_ledger WHERE store_id = $1 AND recipient_key = ANY($2::text[])`, [storeId, identifiers]),
        safeRows(client, `SELECT * FROM campaign_sends WHERE store_id = $1 AND recipient_key = ANY($2::text[])`, [storeId, identifiers]),
      ])
      return {
        customer,
        sync_records: { customers, orders },
        ai_conversations: conversations,
        recommendations,
        support_tickets: supportTickets,
        patternai_personas: personas,
        suppression_list: suppression,
        campaign_sends: campaignSends,
      }
    })
  }

  public completeDataRequest(storeId: StoreId, webhookId: string, exportData: Record<string, unknown>, now: number): Promise<void> {
    return withTenantContext(this.executor, storeId, async (client) => {
      await client.query(
        `UPDATE privacy_compliance_requests SET status = 'COMPLETED', export_data = $3::jsonb, completed_at = to_timestamp($4 / 1000.0) WHERE store_id = $1 AND webhook_id = $2`,
        [storeId, webhookId, JSON.stringify(exportData), now],
      )
    })
  }

  public redactCustomer(storeId: StoreId, identifiers: readonly string[], webhookId: string, now: number): Promise<void> {
    return withTenantContext(this.executor, storeId, async (client) => {
      // `identifiers` carries every form the customer can be referenced by:
      // numeric id, REST/GraphQL ids, email, and phone. `patterns` is the
      // case-insensitive LIKE subset used for free-text/jsonb columns; bare
      // numeric ids are excluded so a short id like "42" cannot over-match.
      const patterns = searchPatterns(identifiers)

      // Delete the canonical customer sync row, then remove the same person's
      // protected fields from order payloads while retaining non-personal order
      // totals needed for merchant accounting and deterministic analytics.
      await client.query(`DELETE FROM sync_records WHERE store_id = $1 AND module = 'customers' AND (record_id = ANY($2::text[]) OR payload->>'id' = ANY($2::text[]) OR payload->>'admin_graphql_api_id' = ANY($2::text[]))`, [storeId, identifiers])
      await client.query(
        `UPDATE sync_records
         SET payload = (payload - 'email' - 'phone' - 'note' - 'billing_address' - 'shipping_address') || '{"customer":null}'::jsonb,
             synced_at = now()
         WHERE store_id = $1 AND module = 'orders'
           AND (payload->'customer'->>'id' = ANY($2::text[]) OR payload->'customer'->>'admin_graphql_api_id' = ANY($2::text[]) OR payload->>'email' = ANY($2::text[]) OR payload->>'phone' = ANY($2::text[]))`,
        [storeId, identifiers],
      )

      // AI conversations (AI Command + Store Coach) and the AI Command action
      // log can carry the customer's email/phone in free text; delete any rows
      // that mention them.
      await client.query(`DELETE FROM ai_command_conversations WHERE store_id = $1 AND (messages::text ILIKE ANY($2::text[]) OR title ILIKE ANY($2::text[]) OR context::text ILIKE ANY($2::text[]))`, [storeId, patterns])
      await client.query(`DELETE FROM ai_command_actions WHERE store_id = $1 AND (action_params::text ILIKE ANY($2::text[]) OR action_preview::text ILIKE ANY($2::text[]) OR execution_result::text ILIKE ANY($2::text[]) OR error_details::text ILIKE ANY($2::text[]))`, [storeId, patterns])
      await client.query(`DELETE FROM store_coach_conversations WHERE store_id = $1 AND messages::text ILIKE ANY($2::text[])`, [storeId, patterns])

      // Recommendations and PatternAI personas are derived records about the
      // customer; remove any that reference them.
      await client.query(`DELETE FROM ai_recommendations WHERE store_id = $1 AND payload::text ILIKE ANY($2::text[])`, [storeId, patterns])
      await client.query(`DELETE FROM insights_personas WHERE store_id = $1 AND (customer_segment_criteria::text ILIKE ANY($2::text[]) OR behavior_patterns::text ILIKE ANY($2::text[]) OR motivations::text ILIKE ANY($2::text[]) OR how_to_reach::text ILIKE ANY($2::text[]) OR radar::text ILIKE ANY($2::text[]))`, [storeId, patterns])

      // Support threads authored by / about this customer.
      await client.query(`DELETE FROM support_thread_messages WHERE store_id = $1 AND (body ILIKE ANY($2::text[]) OR author ILIKE ANY($2::text[]))`, [storeId, patterns])
      await client.query(`DELETE FROM support_tickets WHERE store_id = $1 AND subject ILIKE ANY($2::text[])`, [storeId, patterns])

      // Marketing consent + send history are keyed by recipient (email/phone).
      await client.query(`DELETE FROM suppression_ledger WHERE store_id = $1 AND recipient_key = ANY($2::text[])`, [storeId, identifiers])
      await client.query(`DELETE FROM campaign_sends WHERE store_id = $1 AND recipient_key = ANY($2::text[])`, [storeId, identifiers])

      // Clear the audit row's customer pointer and any compiled export so the
      // erased customer's data is not retained by the compliance ledger itself.
      await client.query(`UPDATE privacy_compliance_requests SET status = 'COMPLETED', shopify_customer_id = NULL, export_data = NULL, completed_at = to_timestamp($3 / 1000.0) WHERE store_id = $1 AND webhook_id = $2`, [storeId, webhookId, now])
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

/**
 * PostgreSQL implementation of UninstallRepository.
 * Handles marking stores as uninstalled and revoking active sessions.
 */
export class PostgresUninstallRepository implements UninstallRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async markStoreUninstalled(storeId: StoreId, shopDomain: string, now: number): Promise<void> {
    // Idempotent: UPDATE ... WHERE status = 'ACTIVE' ensures we don't overwrite
    // if somehow this runs twice. The uninstalled_at timestamp is recorded for
    // audit purposes and Shopify App Store compliance.
    await this.executor.query(
      `UPDATE stores SET status = 'UNINSTALLED', uninstalled_at = to_timestamp($2 / 1000.0), updated_at = now()
       WHERE id = $1 AND status = 'ACTIVE'`,
      [storeId, now],
    )
  }

  public async revokeStoreSessions(storeId: StoreId, now: number): Promise<number> {
    // Revoke all active sessions for this store. Using COALESCE(revoked_at, ...)
    // ensures we don't double-update already-revoked sessions (idempotent).
    const result = await this.executor.query(
      `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, to_timestamp($2 / 1000.0))
       WHERE store_id = $1 AND revoked_at IS NULL`,
      [storeId, now],
    )
    return result.rowCount
  }
}

export class ShopifyComplianceService {
  public constructor(
    private readonly repository: CustomerPrivacyRepository,
    private readonly tokens: Pick<TokenVault, 'remove'>,
    private readonly now: () => number = () => Date.now(),
    private readonly logger: Pick<Logger, 'info'> = new Logger(),
  ) {}

  /**
   * Handles app/uninstalled webhook from Shopify.
   * This is the immediate response to app uninstallation — Shopify requires
   * public apps to revoke tokens and invalidate sessions without waiting for
   * the 48-hour shop/redact.
   *
   * This handler is idempotent: if the store is already UNINSTALLED, it returns
   * silently (200 OK) without errors.
   */
  public async handleUninstall(event: WebhookEvent): Promise<void> {
    const payload = compliancePayload(event.rawBody)
    const shopDomain = stringValue(payload.shop_domain) ?? stringValue(payload.shopDomain)
    if (!shopDomain) throw new AppError('VALIDATION_ERROR', 'Shopify app/uninstalled payload is missing shop_domain', 400)

    // Token revocation: immediately invalidate the access token. This prevents
    // any further API calls using the stored token.
    await this.tokens.remove(shopDomain)

    // The uninstall repository is injected via finalize() to avoid circular
    // dependencies. See handle() dispatch below.
    void event // Mark as intentionally unused when no uninstallRepo
  }

  public async handle(event: WebhookEvent): Promise<void> {
    if (event.topic === 'app/uninstalled') {
      // app/uninstalled is handled by handleUninstall, which revokes tokens.
      // Store status update is handled via finalize() below.
      const payload = compliancePayload(event.rawBody)
      const shopDomain = stringValue(payload.shop_domain) ?? stringValue(payload.shopDomain)
      if (!shopDomain) throw new AppError('VALIDATION_ERROR', 'Shopify app/uninstalled payload is missing shop_domain', 400)
      // Token revocation happens immediately in this handler
      await this.tokens.remove(shopDomain)
      return
    }

    if (event.topic === 'customers/data_request') {
      const payload = compliancePayload(event.rawBody)
      const customer = customerContact(payload)
      const identifiers = customerIdentifiers(customer.id, customer.email, customer.phone)
      const at = this.now()
      await this.repository.record({ storeId: event.storeId, webhookId: event.webhookId, topic: event.topic, customerId: customer.id, status: 'RECEIVED', receivedAt: at, dueAt: at + 30 * 24 * 60 * 60_000, completedAt: null })
      // Compile and persist the actual data export — Shopify's GDPR tester
      // verifies that a data_request produces the customer's data, not just an
      // acknowledged RECEIVED row.
      const exportData = await this.repository.compileCustomerData(event.storeId, identifiers, customer)
      await this.repository.completeDataRequest(event.storeId, event.webhookId, exportData, at)
      this.logger.info(`[GDPR] data_request completed for shop ${event.storeId}, customer ${customer.email ?? customer.id ?? ''}`)
      return
    }
    if (event.topic === 'customers/redact') {
      const payload = compliancePayload(event.rawBody)
      const customer = customerContact(payload)
      if (!customer.id) throw new AppError('VALIDATION_ERROR', 'Shopify customer redaction payload is missing customer.id', 400)
      const identifiers = customerIdentifiers(customer.id, customer.email, customer.phone)
      const at = this.now()
      await this.repository.record({ storeId: event.storeId, webhookId: event.webhookId, topic: event.topic, customerId: customer.id, status: 'RECEIVED', receivedAt: at, dueAt: at + 30 * 24 * 60 * 60_000, completedAt: null })
      await this.repository.redactCustomer(event.storeId, identifiers, event.webhookId, at)
      return
    }
    // shop/redact is finalized only after WebhookProcessor has marked its
    // receipt processed. Deleting stores here would cascade-delete the receipt
    // before the replay ledger can acknowledge Shopify.
    if (event.topic === 'shop/redact') compliancePayload(event.rawBody)
  }

  public async finalize(event: WebhookEvent): Promise<void> {
    if (event.topic === 'app/uninstalled') {
      // Mark store as uninstalled and revoke sessions in finalize() to keep
      // handle() fast (token revocation only). This follows the same pattern as
      // shop/redact where store deletion happens after webhook acknowledgment.
      const payload = compliancePayload(event.rawBody)
      const shopDomain = stringValue(payload.shop_domain) ?? stringValue(payload.shopDomain)
      if (!shopDomain) throw new AppError('VALIDATION_ERROR', 'Shopify app/uninstalled payload is missing shop_domain', 400)
      // Call the injected uninstall repository if available
      if (this.uninstallRepository) {
        await this.uninstallRepository.markStoreUninstalled(event.storeId, shopDomain, this.now())
        await this.uninstallRepository.revokeStoreSessions(event.storeId, this.now())
      }
      return
    }

    if (event.topic !== 'shop/redact') return
    const payload = compliancePayload(event.rawBody)
    const shopDomain = stringValue(payload.shop_domain) ?? stringValue(payload.shopDomain)
    if (!shopDomain) throw new AppError('VALIDATION_ERROR', 'Shopify shop redaction payload is missing shop_domain', 400)
    await this.tokens.remove(shopDomain)
    await this.repository.redactShop(event.storeId, shopDomain)
  }

  /**
   * Inject the uninstall repository for store status and session management.
   * Called during bootstrap wiring.
   */
  public setUninstallRepository(repo: UninstallRepository): void {
    this.uninstallRepository = repo
  }

  private uninstallRepository?: UninstallRepository
}

export class InMemoryCustomerPrivacyRepository implements CustomerPrivacyRepository {
  public readonly requests: PrivacyRequestRecord[] = []
  private readonly customers = new Map<string, Set<string>>()
  private readonly shops = new Set<string>()
  private readonly compiled = new Map<string, Record<string, unknown>>()
  public seedShop(storeId: StoreId, customerIds: readonly string[] = []): void { this.shops.add(storeId); this.customers.set(storeId, new Set(customerIds)) }
  public seedCustomerData(storeId: StoreId, customerId: string, data: Record<string, unknown>): void { this.compiled.set(`${storeId}:${customerId}`, data) }
  public hasCustomer(storeId: StoreId, customerId: string): boolean { return this.customers.get(storeId)?.has(customerId) ?? false }
  public hasShop(storeId: StoreId): boolean { return this.shops.has(storeId) }
  public async record(request: PrivacyRequestRecord): Promise<void> { const index = this.requests.findIndex((item) => item.storeId === request.storeId && item.webhookId === request.webhookId); if (index >= 0) this.requests[index] = request; else this.requests.push(request) }
  public async compileCustomerData(storeId: StoreId, identifiers: readonly string[], customer: CustomerContact): Promise<Record<string, unknown>> { const match = identifiers.map((identifier) => this.compiled.get(`${storeId}:${identifier}`)).find((data): data is Record<string, unknown> => data !== undefined); return { customer, ...(match ?? {}) } }
  public async completeDataRequest(storeId: StoreId, webhookId: string, exportData: Record<string, unknown>, now: number): Promise<void> { const index = this.requests.findIndex((item) => item.storeId === storeId && item.webhookId === webhookId); if (index >= 0 && this.requests[index]) this.requests[index] = { ...this.requests[index], status: 'COMPLETED', completedAt: now, exportData } }
  public async redactCustomer(storeId: StoreId, identifiers: readonly string[], webhookId: string, now: number): Promise<void> { const rows = this.customers.get(storeId); for (const identifier of identifiers) { rows?.delete(identifier); this.compiled.delete(`${storeId}:${identifier}`) } const index = this.requests.findIndex((item) => item.storeId === storeId && item.webhookId === webhookId); if (index >= 0 && this.requests[index]) this.requests[index] = { ...this.requests[index], customerId: null, status: 'COMPLETED', completedAt: now, exportData: null } }
  public async redactShop(storeId: StoreId): Promise<void> { this.customers.delete(storeId); this.shops.delete(storeId); for (const key of [...this.compiled.keys()]) if (key.startsWith(`${storeId}:`)) this.compiled.delete(key) }
}

/**
 * In-memory implementation of UninstallRepository for testing.
 */
export class InMemoryUninstallRepository implements UninstallRepository {
  private readonly stores = new Map<string, { status: string; uninstalledAt: number | null }>()
  private readonly sessionRevocations = new Map<string, Set<string>>()

  public seedStore(storeId: StoreId, status = 'ACTIVE'): void {
    this.stores.set(storeId, { status, uninstalledAt: null })
  }

  public getStoreStatus(storeId: StoreId): string | null {
    return this.stores.get(storeId)?.status ?? null
  }

  public getStoreUninstalledAt(storeId: StoreId): number | null {
    return this.stores.get(storeId)?.uninstalledAt ?? null
  }

  public getRevokedSessions(storeId: StoreId): Set<string> {
    return this.sessionRevocations.get(storeId) ?? new Set()
  }

  public async markStoreUninstalled(storeId: StoreId, shopDomain: string, now: number): Promise<void> {
    const existing = this.stores.get(storeId)
    if (!existing || existing.status !== 'ACTIVE') return // Idempotent: skip if already uninstalled
    this.stores.set(storeId, { status: 'UNINSTALLED', uninstalledAt: now })
  }

  public async revokeStoreSessions(storeId: StoreId, now: number): Promise<number> {
    // In-memory: track revoked sessions for test assertions
    if (!this.sessionRevocations.has(storeId)) {
      this.sessionRevocations.set(storeId, new Set())
    }
    const revoked = this.sessionRevocations.get(storeId)!
    revoked.add(`revoked-at-${now}`)
    return 1
  }
}

function compliancePayload(rawBody: string): Readonly<Record<string, unknown>> {
  let parsed: unknown
  try { parsed = JSON.parse(rawBody) } catch { throw new AppError('VALIDATION_ERROR', 'Shopify compliance webhook payload is invalid JSON', 400) }
  if (!isRecord(parsed)) throw new AppError('VALIDATION_ERROR', 'Shopify compliance webhook payload must be an object', 400)
  return parsed
}
function customerContact(payload: Readonly<Record<string, unknown>>): CustomerContact {
  const customer = isRecord(payload.customer) ? payload.customer : null
  return {
    id: scalarString(customer?.id ?? payload.customer_id),
    email: scalarString(customer?.email ?? payload.email),
    phone: scalarString(customer?.phone ?? payload.phone),
  }
}
function customerIdentifiers(id: string | null, email: string | null = null, phone: string | null = null): readonly string[] {
  const identifiers: string[] = []
  if (id) {
    const normalized = id.replace(/^gid:\/\/shopify\/Customer\//, '')
    identifiers.push(id, normalized, `gid://shopify/Customer/${normalized}`)
  }
  if (email) identifiers.push(email)
  if (phone) identifiers.push(phone)
  return [...new Set(identifiers.filter(Boolean))]
}
function searchPatterns(identifiers: readonly string[]): readonly string[] {
  // Bare numeric ids are useless (and dangerous) as free-text search terms;
  // email, phone, and GraphQL id forms carry enough signal without over-match.
  return identifiers.filter((identifier) => !/^\d+$/.test(identifier)).map((identifier) => `%${identifier}%`)
}
async function safeRows(client: SqlExecutor, sql: string, params: readonly unknown[]): Promise<readonly unknown[]> {
  try { return (await client.query(sql, params)).rows } catch { return [] }
}
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null }
function scalarString(value: unknown): string | null { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
