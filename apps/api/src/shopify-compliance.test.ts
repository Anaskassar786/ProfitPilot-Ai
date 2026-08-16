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
import { InMemoryCustomerPrivacyRepository, PostgresCustomerPrivacyRepository, ShopifyComplianceService } from './shopify-compliance.js'

const tenant = storeId('00000000-0000-4000-8000-000000000001')
const secret = 'shopify-secret'
const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function event(topic: string, body: string, webhookId = 'privacy-1') { return { storeId: tenant, webhookId, topic, rawBody: body, signature: createHmac('sha256', secret).update(body).digest('base64') } }
function service(repository = new InMemoryCustomerPrivacyRepository()) { return { repository, tokens: { remove: vi.fn(async () => undefined) }, compliance: new ShopifyComplianceService(repository, { remove: vi.fn(async () => undefined) }, () => 1_000) } }

async function withServer(app: ReturnType<typeof createApi>, run: (base: string) => Promise<void>): Promise<void> {
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  try { await run(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('Shopify mandatory privacy compliance', () => {
  it('records data requests with the statutory 30-day deadline and no copied email', async () => {
    const { repository, compliance } = service()
    await compliance.handle(event('customers/data_request', JSON.stringify({ customer: { id: 42, email: 'private@example.com' }, shop_domain: 'demo.myshopify.com' })))
    expect(repository.requests).toEqual([expect.objectContaining({ customerId: '42', status: 'RECEIVED', receivedAt: 1_000, dueAt: 2_592_001_000 })])
    expect(JSON.stringify(repository.requests)).not.toContain('private@example.com')
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
})
