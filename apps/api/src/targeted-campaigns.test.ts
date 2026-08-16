import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { CampaignEmailService, InMemoryMerchantEmailConfigRepository, InMemoryTemplateRepository, InMemoryWorkflowRepository, MerchantEmailVerifier, ThreadLedger } from '@profitpilot/automation'
import type { BillingRepository } from '@profitpilot/billing'
import { AppError, storeId } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'
import { normalizeCustomer } from './customers.js'
import type { CustomerRepository } from './customers.js'
import { InMemoryCampaignSendStore, TargetedCampaignService } from './targeted-campaigns.js'

const TENANT = storeId('targeted-campaign-store')
const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'
const JOB_ID = 'send-key-12345678'

function billing(plan: PlanTier): Pick<BillingRepository, 'get'> { return { async get() { return { storeId: TENANT, state: 'ACTIVE_MONTHLY', plan, currentPeriodEnd: null, version: 0, priceLockedAt: null, grandfathered: false, interval: 'MONTHLY', chargeId: null } } } }
function customer(marketingState: 'subscribed' | 'not_subscribed' = 'subscribed') { return normalizeCustomer('customer-1', { id: 'customer-1', first_name: 'Asha', last_name: 'Khan', email: 'asha@example.com', email_marketing_consent: { state: marketingState }, total_spent: '500', orders_count: 2 }, new Date('2026-08-16T00:00:00Z')) }
function customerRepository(value = customer(), onRead: () => void = () => undefined): CustomerRepository { return { async list() { return { customers: [value], coverage: value.coverage } }, async get(_store, id) { onRead(); return id === value.id ? value : null } } }

async function fixture(options: Readonly<{ plan?: PlanTier; customer?: ReturnType<typeof customer>; verified?: boolean; sends?: InMemoryCampaignSendStore; providerFailure?: boolean }> = {}) {
  const templates = new InMemoryTemplateRepository()
  await templates.put({ id: TEMPLATE_ID, storeId: TENANT, name: 'Retention review', kind: 'EMAIL', subject: 'Hello {{customer.first_name}}', body: '<p>We miss you, {{customer.first_name}}.</p><a href="{{unsubscribe.url}}">Unsubscribe</a>', variables: ['customer.first_name', 'unsubscribe.url'] })
  const verifier = new MerchantEmailVerifier('merchant-secret')
  const configs = new InMemoryMerchantEmailConfigRepository()
  const config = { shopId: TENANT, merchantEmail: 'merchant@example.com', fromName: 'Real Store', verified: options.verified ?? true, verificationSentAt: 1, verifiedAt: options.verified === false ? null : 2 }
  await configs.put(config)
  const delivered: Array<Readonly<{ to: string; from: string; subject: string; html: string; headers?: Readonly<Record<string, string>> }>> = []
  const transport = { async send(message: typeof delivered[number]) { delivered.push(message); if (options.providerFailure) throw new Error('provider unavailable'); return { messageId: 'provider-message-1' } } }
  const email = new CampaignEmailService(transport, transport, verifier, 'system@example.com', 'ProfitPilot', { physicalAddress: 'Real business address', supportEmail: 'support@example.com' })
  const sends = options.sends ?? new InMemoryCampaignSendStore()
  const audits: string[] = []
  const service = new TargetedCampaignService(customerRepository(options.customer ?? customer()), billing(options.plan ?? 'growth'), templates, configs, verifier, email, sends, async () => 'real-store.myshopify.com', 'unsubscribe-secret', 'https://app.example.com', { async locked(_store, plan) { audits.push(plan) } }, () => Date.parse('2026-08-16T12:00:00Z'))
  return { service, sends, delivered, templates, verifier, configs, audits }
}

const input = { storeId: TENANT, customerId: 'customer-1', templateId: TEMPLATE_ID, idempotencyKey: JOB_ID, reviewed: true }

describe('targeted customer email safety', () => {
  it('previews and sends a reviewed EMAIL template with server-resolved recipient and unsubscribe URL', async () => {
    const item = await fixture()
    const preview = await item.service.preview(input)
    expect(preview).toMatchObject({ customerId: 'customer-1', subject: 'Hello Asha', sender: { email: 'merchant@example.com' } })
    expect(preview.html).toContain('https://app.example.com/campaigns/unsubscribe?token=')
    const result = await item.service.send(input)
    expect(result).toMatchObject({ status: 'sent', customerId: 'customer-1', templateId: TEMPLATE_ID, providerMessageId: 'provider-message-1', idempotent: false })
    expect(item.delivered).toHaveLength(1)
    expect(item.delivered[0]).toMatchObject({ to: 'asha@example.com', from: 'merchant@example.com', subject: 'Hello Asha' })
    expect(item.delivered[0]?.html).toContain('Real business address')
    expect(item.delivered[0]?.headers?.['List-Unsubscribe']).toContain('/campaigns/unsubscribe?token=')
  })

  it('returns the durable result on an idempotent replay without a second provider send', async () => {
    const item = await fixture()
    const first = await item.service.send(input)
    const replay = await item.service.send(input)
    expect(first.status).toBe('sent')
    expect(replay).toMatchObject({ status: 'sent', idempotent: true, campaignId: first.campaignId })
    expect(item.delivered).toHaveLength(1)
  })

  it('blocks opted-out consent, suppression, and unverified merchant sender', async () => {
    await expect((await fixture({ customer: customer('not_subscribed') })).service.send(input)).rejects.toMatchObject({ status: 403, details: { marketingState: 'not_subscribed' } })
    const suppressed = await fixture(); suppressed.sends.suppress(TENANT, 'customer-1')
    const suppressedResult = await suppressed.service.send(input)
    expect(suppressedResult).toMatchObject({ status: 'suppressed', reason: 'Customer unsubscribed' })
    expect(suppressed.delivered).toHaveLength(0)
    await expect((await fixture({ verified: false })).service.send(input)).rejects.toMatchObject({ status: 403, details: { senderVerified: false } })
  })

  it('enforces Growth before reading recipient data and audits the denial', async () => {
    let reads = 0
    const base = await fixture({ plan: 'start' })
    const service = new TargetedCampaignService(customerRepository(customer(), () => { reads += 1 }), billing('start'), base.templates, base.configs, base.verifier, new CampaignEmailService({ async send() { return { messageId: 'x' } }, }, { async send() { return { messageId: 'x' } }, }, base.verifier, 'system@example.com'), base.sends, async () => 'store.myshopify.com', 'unsubscribe-secret', 'https://app.example.com', { async locked(_store, plan) { base.audits.push(plan) } })
    await expect(service.send(input)).rejects.toMatchObject({ status: 403, details: { locked: true, feature: 'targeted_customer_email', required_plan: 'growth' } })
    expect(reads).toBe(0)
    expect(base.audits).toEqual(['start'])
  })

  it('requires explicit review and propagates an atomic monthly email quota denial', async () => {
    const item = await fixture()
    await expect(item.service.send({ ...input, reviewed: false })).rejects.toMatchObject({ status: 400 })
    const quotaStore = { ...new InMemoryCampaignSendStore(), find: item.sends.find.bind(item.sends), suppressed: item.sends.suppressed.bind(item.sends), finish: item.sends.finish.bind(item.sends), unsubscribe: item.sends.unsubscribe.bind(item.sends), async reserve() { throw new AppError('FORBIDDEN', 'Monthly email send quota reached', 403, { feature: 'email_sends_month', reason: 'QUOTA_REACHED' }) } }
    const quota = await fixture()
    const service = new TargetedCampaignService(customerRepository(), billing('growth'), quota.templates, quota.configs, quota.verifier, new CampaignEmailService({ async send() { return { messageId: 'x' } }, }, { async send() { return { messageId: 'x' } }, }, quota.verifier, 'system@example.com'), quotaStore, async () => 'store.myshopify.com', 'unsubscribe-secret', 'https://app.example.com', { async locked() {} })
    await expect(service.send(input)).rejects.toMatchObject({ status: 403, details: { feature: 'email_sends_month', reason: 'QUOTA_REACHED' } })
  })

  it('persists an honest failed outcome when the provider rejects delivery', async () => {
    const item = await fixture({ providerFailure: true })
    const result = await item.service.send(input)
    expect(result).toMatchObject({ status: 'failed', providerMessageId: null, idempotent: false })
    expect(result.reason).toBe('Email provider did not accept the message')
    const replay = await item.service.send(input)
    expect(replay).toMatchObject({ status: 'failed', idempotent: true })
    expect(item.delivered).toHaveLength(1)
  })

  it('isolates templates by tenant and fails closed on unavailable variables', async () => {
    const item = await fixture()
    const otherTemplate = '22222222-2222-4222-8222-222222222222'
    await item.templates.put({ id: otherTemplate, storeId: storeId('other-store'), name: 'Other tenant', kind: 'EMAIL', subject: 'Private', body: '<a href="{{unsubscribe.url}}">Unsubscribe</a>', variables: ['unsubscribe.url'] })
    await expect(item.service.preview({ ...input, templateId: otherTemplate })).rejects.toMatchObject({ status: 404 })
    const unavailable = '33333333-3333-4333-8333-333333333333'
    await item.templates.put({ id: unavailable, storeId: TENANT, name: 'Unavailable data', kind: 'EMAIL', subject: '{{product.title}}', body: '<a href="{{unsubscribe.url}}">Unsubscribe</a>', variables: ['product.title', 'unsubscribe.url'] })
    await expect(item.service.preview({ ...input, templateId: unavailable })).rejects.toMatchObject({ status: 400, details: { variable: 'product.title' } })
  })

  it('turns the signed unsubscribe URL into a durable suppression', async () => {
    const item = await fixture()
    await item.service.send(input)
    const link = item.delivered[0]?.headers?.['List-Unsubscribe'] ?? ''
    const token = /token=([^>&]+)/.exec(link)?.[1]
    expect(token).toBeTruthy()
    expect(await item.service.unsubscribe(decodeURIComponent(token ?? ''))).toEqual({ status: 'unsubscribed', alreadySuppressed: false })
    expect(await item.sends.suppressed(TENANT, 'customer-1')).toBe('UNSUBSCRIBED')
    expect(await item.service.unsubscribe(decodeURIComponent(token ?? ''))).toEqual({ status: 'unsubscribed', alreadySuppressed: true })
  })
})

describe('targeted campaign HTTP contract', () => {
  it('never accepts a client-supplied recipient email or marketing flag', async () => {
    const item = await fixture()
    const app = createApi({ logger: new Logger(), readinessChecks: [], automation: { workflows: new InMemoryWorkflowRepository(), templates: item.templates, emailVerifier: item.verifier, merchantEmails: item.configs, targetedCampaigns: item.service, tickets: new ThreadLedger() } })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/campaigns/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, recipientEmail: 'attacker@example.com', acceptsMarketing: true }) })
      expect(response.status).toBe(400)
      expect((await response.json()).error.message).toContain('Client-supplied')
      expect(item.delivered).toHaveLength(0)
      await item.service.send(input)
      const token = /token=([^>&]+)/.exec(item.delivered[0]?.headers?.['List-Unsubscribe'] ?? '')?.[1] ?? ''
      const unsubscribed = await fetch(`http://127.0.0.1:${address.port}/campaigns/unsubscribe?token=${token}`)
      expect(unsubscribed.status).toBe(200)
      expect(await unsubscribed.text()).toContain('You are unsubscribed')
      const invalid = await fetch(`http://127.0.0.1:${address.port}/campaigns/unsubscribe?token=invalid`)
      expect(invalid.status).toBe(400)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
