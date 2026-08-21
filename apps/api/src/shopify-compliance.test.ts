import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { Logger } from '@profitpilot/logger'
import { InMemoryWebhookProcessingLedger, OAuthStateStore, ShopifyInstallService, TokenVault, InMemoryTokenRecordStore, WebhookProcessor, WebhookVerifier } from '@profitpilot/shopify'
import { AesGcmCipher } from '@profitpilot/crypto'
import { InMemoryStoreDirectory } from '@profitpilot/db'
import type { SqlExecutor } from '@profitpilot/db'
import { storeId } from '@profitpilot/types'
import { createApi } from './app.js'
import { InMemoryCustomerPrivacyRepository, InMemoryUninstallRepository, PostgresCustomerPrivacyRepository, PostgresUninstallRepository, ShopifyComplianceService } from './shopify-compliance.js'

const tenant = storeId('00000000-0000-4000-8000-000000000001')
const secret = 'shopify-secret'
const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function event(topic: string, body: string, webhookId = 'privacy-1') { return { storeId: tenant, webhookId, topic, rawBody: body, signature: createHmac('sha256', secret).update(body).digest('base64') } }
function service(repository = new InMemoryCustomerPrivacyRepository(), logger: Pick<Logger, 'info'> = { info: vi.fn() }) { return { repository, tokens: { remove: vi.fn(async () => undefined) }, logger, compliance: new ShopifyComplianceService(repository, { remove: vi.fn(async () => undefined) }, () => 1_000, logger) } }

async function withServer(app: ReturnType<typeof createApi>, run: (base: string) => Promise<void>): Promise<void> {
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  try { await run(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('Shopify mandatory privacy compliance', () => {
  it('fulfills data requests by compiling customer data and completing the request', async () => {
    const { repository, compliance, logger } = service()
    repository.seedCustomerData(tenant, '42', { sync_records: { customers: [{ id: 42, email: 'private@example.com' }], orders: [] } })
    await compliance.handle(event('customers/data_request', JSON.stringify({ customer: { id: 42, email: 'private@example.com', phone: '+15551234567' }, shop_domain: 'demo.myshopify.com' })))
    expect(repository.requests[0]).toMatchObject({ customerId: '42', status: 'COMPLETED', receivedAt: 1_000, dueAt: 2_592_001_000, completedAt: 1_000 })
    expect(repository.requests[0]!.exportData).toMatchObject({ customer: { id: '42', email: 'private@example.com', phone: '+15551234567' }, sync_records: { customers: [{ id: 42, email: 'private@example.com' }] } })
    expect(logger.info).toHaveBeenCalledWith(`[GDPR] data_request completed for shop ${tenant}, customer private@example.com`)
  })

  it('keeps the audit pointer to the customer id but only stores email/phone in the compiled export', async () => {
    const { repository, compliance } = service()
    await compliance.handle(event('customers/data_request', JSON.stringify({ customer: { id: 42, email: 'private@example.com', phone: '+15551234567' }, shop_domain: 'demo.myshopify.com' })))
    // The RECEIVED audit row never copied the email into shopify_customer_id.
    expect(repository.requests[0]).toMatchObject({ customerId: '42' })
    expect(repository.requests[0]!.exportData).toMatchObject({ customer: { email: 'private@example.com', phone: '+15551234567' } })
  })

  it('actually deletes the customer record for REST and GraphQL identifier forms', async () => {
    const { repository, compliance } = service(); repository.seedShop(tenant, ['42', 'gid://shopify/Customer/42'])
    await compliance.handle(event('customers/redact', JSON.stringify({ customer: { id: 42 } })))
    expect(repository.hasCustomer(tenant, '42')).toBe(false)
    expect(repository.hasCustomer(tenant, 'gid://shopify/Customer/42')).toBe(false)
    expect(repository.requests[0]).toMatchObject({ topic: 'customers/redact', status: 'COMPLETED', completedAt: 1_000 })
  })

  it('finalizes shop redaction by deleting credentials and all tenant state', async () => {
    const repository = new InMemoryCustomerPrivacyRepository(); repository.seedShop(tenant, ['42'])
    const remove = vi.fn(async () => undefined); const compliance = new ShopifyComplianceService(repository, { remove })
    const shopRedact = event('shop/redact', JSON.stringify({ shop_domain: 'demo.myshopify.com', shop_id: 1 }))
    await compliance.handle(shopRedact); expect(repository.hasShop(tenant)).toBe(true)
    await compliance.finalize(shopRedact)
    expect(remove).toHaveBeenCalledWith('demo.myshopify.com'); expect(repository.hasShop(tenant)).toBe(false)
  })

  it('HMAC-verifies the exact raw body before customer redaction at the HTTP boundary', async () => {
    const repository = new InMemoryCustomerPrivacyRepository(); repository.seedShop(tenant, ['42'])
    const tokens = new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore())
    const compliance = new ShopifyComplianceService(repository, tokens)
    const ledger = new InMemoryWebhookProcessingLedger(); const processor = new WebhookProcessor(new WebhookVerifier(secret, ledger), ledger)
    const directory = new InMemoryStoreDirectory(); const connection = await directory.upsertByShopDomain('demo.myshopify.com')
    repository.seedShop(connection.storeId, ['42'])
    const installer = new ShopifyInstallService({ apiKey: 'key', apiSecret: secret, scopes: [], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(), tokens, directory)
    const app = createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer, exchange: async () => 'token', webhook: { processor, storeIdForShop: async () => connection.storeId, handle: (item) => compliance.handle(item), finalize: (item) => compliance.finalize(item) } } })
    await withServer(app, async (base) => {
      const body = JSON.stringify({ customer: { id: 42 }, shop_domain: 'demo.myshopify.com' }); const headers = { 'content-type': 'application/json', 'x-shopify-shop-domain': 'demo.myshopify.com', 'x-shopify-webhook-id': 'redact-1', 'x-shopify-topic': 'customers/redact', 'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64') }
      const invalid = await fetch(`${base}/shopify/webhooks`, { method: 'POST', headers: { ...headers, 'x-shopify-webhook-id': 'redact-invalid', 'x-shopify-hmac-sha256': 'invalid' }, body }); expect(invalid.status).toBe(401); expect(repository.hasCustomer(connection.storeId, '42')).toBe(true)
      const valid = await fetch(`${base}/shopify/webhooks`, { method: 'POST', headers, body }); expect(valid.status).toBe(200); expect(repository.hasCustomer(connection.storeId, '42')).toBe(false)
    })
  })

  it('uses tenant-bound SQL to delete customers and anonymize matching order PII', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = []
    const executor: SqlExecutor = { query: async (sql, parameters = []) => { calls.push({ sql, parameters }); return { rows: [], rowCount: 1 } } }
    await new PostgresCustomerPrivacyRepository(executor).redactCustomer(tenant, ['42', 'gid://shopify/Customer/42'], 'hook', 1_000)
    expect(calls.every((call) => call.parameters[0] === tenant)).toBe(true)
    expect(calls.some((call) => call.sql.includes("module = 'customers'") && call.sql.includes('DELETE FROM sync_records'))).toBe(true)
    expect(calls.some((call) => call.sql.includes("module = 'orders'") && call.sql.includes("'{\"customer\":null}'"))).toBe(true)
    expect(calls.some((call) => call.sql.includes('DELETE FROM campaign_sends'))).toBe(true)
  })

  it('purges customer PII from every tenant table, not just sync_records', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = []
    const executor: SqlExecutor = { query: async (sql, parameters = []) => { calls.push({ sql, parameters }); return { rows: [], rowCount: 1 } } }
    await new PostgresCustomerPrivacyRepository(executor).redactCustomer(tenant, ['42', 'gid://shopify/Customer/42', 'private@example.com', '+15551234567'], 'hook', 1_000)
    expect(calls.every((call) => call.parameters[0] === tenant)).toBe(true)
    for (const table of ['sync_records', 'ai_command_conversations', 'ai_command_actions', 'store_coach_conversations', 'ai_recommendations', 'insights_personas', 'support_tickets', 'support_thread_messages', 'suppression_ledger', 'campaign_sends']) {
      expect(calls.some((call) => call.sql.includes(`DELETE FROM ${table}`) || call.sql.includes(`UPDATE ${table}`))).toBe(true)
    }
    expect(calls.some((call) => call.sql.includes('UPDATE privacy_compliance_requests') && call.sql.includes("status = 'COMPLETED'") && call.sql.includes('export_data = NULL'))).toBe(true)
  })

  it('compiles customer data from every tenant table with tenant-bound SQL', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = []
    const executor: SqlExecutor = { query: async (sql, parameters = []) => { calls.push({ sql, parameters }); return { rows: [], rowCount: 0 } } }
    const exportData = await new PostgresCustomerPrivacyRepository(executor).compileCustomerData(tenant, ['42', 'gid://shopify/Customer/42', 'private@example.com'], { id: '42', email: 'private@example.com', phone: null })
    expect(calls.every((call) => call.parameters[0] === tenant)).toBe(true)
    for (const table of ['sync_records', 'ai_command_conversations', 'ai_recommendations', 'support_tickets', 'insights_personas', 'suppression_ledger', 'campaign_sends']) {
      expect(calls.some((call) => call.sql.includes(`FROM ${table}`))).toBe(true)
    }
    expect(exportData).toMatchObject({ customer: { id: '42', email: 'private@example.com', phone: null } })
    expect(exportData.sync_records).toBeDefined()
    expect(exportData.ai_conversations).toBeDefined()
    expect(exportData.recommendations).toBeDefined()
    expect(exportData.support_tickets).toBeDefined()
    expect(exportData.patternai_personas).toBeDefined()
  })

  it('stores the compiled export and marks the data request COMPLETED', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = []
    const executor: SqlExecutor = { query: async (sql, parameters = []) => { calls.push({ sql, parameters }); return { rows: [], rowCount: 1 } } }
    await new PostgresCustomerPrivacyRepository(executor).completeDataRequest(tenant, 'hook', { customer: { id: '42', email: 'private@example.com' } }, 1_000)
    const call = calls[0]!
    expect(call.sql).toContain('UPDATE privacy_compliance_requests')
    expect(call.sql).toContain("status = 'COMPLETED'")
    expect(call.sql).toContain('export_data = $3::jsonb')
    expect(call.parameters[0]).toBe(tenant)
    expect(call.parameters[2]).toBe(JSON.stringify({ customer: { id: '42', email: 'private@example.com' } }))
  })

  it('fulfills a signed data_request at the HTTP boundary', async () => {
    const repository = new InMemoryCustomerPrivacyRepository()
    const tokens = new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore())
    const compliance = new ShopifyComplianceService(repository, tokens)
    const ledger = new InMemoryWebhookProcessingLedger(); const processor = new WebhookProcessor(new WebhookVerifier(secret, ledger), ledger)
    const directory = new InMemoryStoreDirectory(); const connection = await directory.upsertByShopDomain('demo.myshopify.com')
    repository.seedCustomerData(connection.storeId, '42', { sync_records: { customers: [{ id: 42, email: 'private@example.com' }], orders: [] } })
    const installer = new ShopifyInstallService({ apiKey: 'key', apiSecret: secret, scopes: [], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(), tokens, directory)
    const app = createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer, exchange: async () => 'token', webhook: { processor, storeIdForShop: async () => connection.storeId, handle: (item) => compliance.handle(item), finalize: (item) => compliance.finalize(item) } } })
    await withServer(app, async (base) => {
      const body = JSON.stringify({ customer: { id: 42, email: 'private@example.com' }, shop_domain: 'demo.myshopify.com' })
      const headers = { 'content-type': 'application/json', 'x-shopify-shop-domain': 'demo.myshopify.com', 'x-shopify-webhook-id': 'data-request-1', 'x-shopify-topic': 'customers/data_request', 'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64') }
      const response = await fetch(`${base}/shopify/webhooks`, { method: 'POST', headers, body })
      expect(response.status).toBe(200)
      expect(repository.requests[0]).toMatchObject({ status: 'COMPLETED', customerId: '42' })
      expect(repository.requests[0]!.exportData).toMatchObject({ customer: { id: '42', email: 'private@example.com' }, sync_records: { customers: [{ id: 42, email: 'private@example.com' }] } })
    })
  })

  it('acknowledges shop/redact with 200 when the shop is unknown or already deleted', async () => {
    const repository = new InMemoryCustomerPrivacyRepository()
    const tokens = new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore())
    const compliance = new ShopifyComplianceService(repository, tokens)
    const ledger = new InMemoryWebhookProcessingLedger(); const processor = new WebhookProcessor(new WebhookVerifier(secret, ledger), ledger)
    const directory = new InMemoryStoreDirectory()
    const installer = new ShopifyInstallService({ apiKey: 'key', apiSecret: secret, scopes: [], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(), tokens, directory)
    const app = createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer, exchange: async () => 'token', webhook: { processor, storeIdForShop: async () => null, handle: (item) => compliance.handle(item), finalize: (item) => compliance.finalize(item) } } })
    await withServer(app, async (base) => {
      const body = JSON.stringify({ shop_domain: 'unknown.myshopify.com', shop_id: 999 })
      const headers = { 'content-type': 'application/json', 'x-shopify-shop-domain': 'unknown.myshopify.com', 'x-shopify-webhook-id': 'shop-redact-1', 'x-shopify-topic': 'shop/redact', 'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64') }
      const valid = await fetch(`${base}/shopify/webhooks`, { method: 'POST', headers, body })
      expect(valid.status).toBe(200)
      expect(await valid.json()).toEqual({ ok: true, message: 'Shop already redacted or never installed' })

      const tampered = await fetch(`${base}/shopify/webhooks`, { method: 'POST', headers: { ...headers, 'x-shopify-webhook-id': 'shop-redact-2', 'x-shopify-hmac-sha256': 'invalid' }, body })
      expect(tampered.status).toBe(401)
    })
  })
})

describe('app/uninstalled webhook handler', () => {
  it('revokes access token on app/uninstalled webhook', async () => {
    const remove = vi.fn(async () => undefined)
    const compliance = new ShopifyComplianceService(new InMemoryCustomerPrivacyRepository(), { remove }, () => 1_000)
    const uninstallEvent = event('app/uninstalled', JSON.stringify({ shop_domain: 'demo.myshopify.com', shop_id: 1 }))
    await compliance.handle(uninstallEvent)
    expect(remove).toHaveBeenCalledWith('demo.myshopify.com')
  })

  it('marks store as UNINSTALLED and revokes sessions in finalize', async () => {
    const remove = vi.fn(async () => undefined)
    const uninstallRepo = new InMemoryUninstallRepository()
    uninstallRepo.seedStore(tenant, 'ACTIVE')
    const compliance = new ShopifyComplianceService(new InMemoryCustomerPrivacyRepository(), { remove }, () => 1_000)
    compliance.setUninstallRepository(uninstallRepo)

    const uninstallEvent = event('app/uninstalled', JSON.stringify({ shop_domain: 'demo.myshopify.com', shop_id: 1 }))
    await compliance.handle(uninstallEvent)
    await compliance.finalize(uninstallEvent)

    expect(remove).toHaveBeenCalledWith('demo.myshopify.com')
    expect(uninstallRepo.getStoreStatus(tenant)).toBe('UNINSTALLED')
    expect(uninstallRepo.getStoreUninstalledAt(tenant)).toBe(1_000)
  })

  it('is idempotent: duplicate uninstall requests succeed without error', async () => {
    const remove = vi.fn(async () => undefined)
    const uninstallRepo = new InMemoryUninstallRepository()
    uninstallRepo.seedStore(tenant, 'ACTIVE')
    const compliance = new ShopifyComplianceService(new InMemoryCustomerPrivacyRepository(), { remove }, () => 1_000)
    compliance.setUninstallRepository(uninstallRepo)

    const uninstallEvent = event('app/uninstalled', JSON.stringify({ shop_domain: 'demo.myshopify.com', shop_id: 1 }), 'uninstall-1')
    await compliance.handle(uninstallEvent)
    await compliance.finalize(uninstallEvent)

    // First uninstall succeeded
    expect(uninstallRepo.getStoreStatus(tenant)).toBe('UNINSTALLED')

    // Reset mocks for second call
    remove.mockClear()

    // Second (duplicate) uninstall should also succeed (idempotent)
    const duplicateEvent = event('app/uninstalled', JSON.stringify({ shop_domain: 'demo.myshopify.com', shop_id: 1 }), 'uninstall-2')
    await compliance.handle(duplicateEvent)
    await compliance.finalize(duplicateEvent)

    // Token removal still called (for idempotency, token revocation is idempotent)
    expect(remove).toHaveBeenCalledWith('demo.myshopify.com')
    // Status remains UNINSTALLED (not an error)
    expect(uninstallRepo.getStoreStatus(tenant)).toBe('UNINSTALLED')
  })

  it('rejects app/uninstalled with missing shop_domain', async () => {
    const compliance = new ShopifyComplianceService(new InMemoryCustomerPrivacyRepository(), { remove: vi.fn(async () => undefined) }, () => 1_000)
    const invalidEvent = event('app/uninstalled', JSON.stringify({ shop_id: 1 }))
    await expect(compliance.handle(invalidEvent)).rejects.toThrow('missing shop_domain')
  })

  it('HMAC-verifies app/uninstalled webhook at HTTP boundary', async () => {
    const remove = vi.fn(async () => undefined)
    const uninstallRepo = new InMemoryUninstallRepository()
    uninstallRepo.seedStore(tenant, 'ACTIVE')
    const compliance = new ShopifyComplianceService(new InMemoryCustomerPrivacyRepository(), { remove }, () => 1_000)
    compliance.setUninstallRepository(uninstallRepo)
    const ledger = new InMemoryWebhookProcessingLedger()
    const processor = new WebhookProcessor(new WebhookVerifier(secret, ledger), ledger)
    const directory = new InMemoryStoreDirectory()
    const connection = await directory.upsertByShopDomain('demo.myshopify.com')
    const installer = new ShopifyInstallService({ apiKey: 'key', apiSecret: secret, scopes: [], redirectUri: 'https://app.example/callback' }, new OAuthStateStore(), new TokenVault(AesGcmCipher.fromHex(key), new InMemoryTokenRecordStore()), directory)
    const app = createApi({ logger: new Logger(), readinessChecks: [], shopify: { installer, exchange: async () => 'token', webhook: { processor, storeIdForShop: async () => connection.storeId, handle: (item) => compliance.handle(item), finalize: (item) => compliance.finalize(item) } } })

    await withServer(app, async (base) => {
      const body = JSON.stringify({ shop_domain: 'demo.myshopify.com', shop_id: 1 })
      const validHeaders = { 'content-type': 'application/json', 'x-shopify-shop-domain': 'demo.myshopify.com', 'x-shopify-webhook-id': 'uninstall-1', 'x-shopify-topic': 'app/uninstalled', 'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64') }

      // Invalid HMAC returns 401
      const invalidHmacResponse = await fetch(`${base}/shopify/webhooks`, { method: 'POST', headers: { ...validHeaders, 'x-shopify-hmac-sha256': 'invalid-signature' }, body })
      expect(invalidHmacResponse.status).toBe(401)
      expect(remove).not.toHaveBeenCalled()

      // Valid HMAC returns 200 and revokes token
      const validResponse = await fetch(`${base}/shopify/webhooks`, { method: 'POST', headers: validHeaders, body })
      expect(validResponse.status).toBe(200)
      expect(remove).toHaveBeenCalledWith('demo.myshopify.com')
    })
  })

  it('PostgresUninstallRepository uses tenant-bound SQL', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = []
    const executor: SqlExecutor = { query: async (sql, parameters = []) => { calls.push({ sql, parameters }); return { rows: [], rowCount: 1 } } }
    const repo = new PostgresUninstallRepository(executor)
    await repo.markStoreUninstalled(tenant, 'demo.myshopify.com', 1_000)
    expect(calls[0]!.sql).toContain('UPDATE stores')
    expect(calls[0]!.sql).toContain("status = 'UNINSTALLED'")
    expect(calls[0]!.sql).toContain('uninstalled_at')
    expect(calls[0]!.parameters[0]).toBe(tenant)
  })

  it('PostgresUninstallRepository revokes sessions with tenant-bound SQL', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = []
    const executor: SqlExecutor = { query: async (sql, parameters = []) => { calls.push({ sql, parameters }); return { rows: [], rowCount: 5 } } }
    const repo = new PostgresUninstallRepository(executor)
    const revoked = await repo.revokeStoreSessions(tenant, 1_000)
    expect(revoked).toBe(5)
    expect(calls[0]!.sql).toContain('UPDATE auth_sessions')
    expect(calls[0]!.sql).toContain('revoked_at')
    expect(calls[0]!.parameters[0]).toBe(tenant)
  })
})
