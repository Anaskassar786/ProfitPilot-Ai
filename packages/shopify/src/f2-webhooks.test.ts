import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InMemoryWebhookProcessingLedger, SHOPIFY_WEBHOOK_TOPICS, WebhookProcessor, WebhookVerifier } from './index.js'
import { storeId } from '@profitpilot/types'

const body = '{"id":1}'
const event = (id = 'webhook-1') => ({ storeId: storeId('store-1'), webhookId: id, topic: 'orders/create', rawBody: body, signature: createHmac('sha256', 'secret').update(body).digest('base64') })

describe('Shopify F2 webhook topics and retry ledger', () => {
  it('registers all eighteen required topics', () => expect(SHOPIFY_WEBHOOK_TOPICS).toHaveLength(18))
  it('claims a webhook receipt once', async () => {
    const ledger = new InMemoryWebhookProcessingLedger()
    expect(await ledger.begin(event(), 100)).toBe(true)
    expect(await ledger.begin(event(), 100)).toBe(false)
  })
  it('marks successful processing with an audit event', async () => {
    const ledger = new InMemoryWebhookProcessingLedger()
    const processor = new WebhookProcessor(new WebhookVerifier('secret', ledger), ledger, () => 100)
    await expect(processor.process(event(), async () => undefined)).resolves.toMatchObject({ status: 'processed' })
    expect((await ledger.get(storeId('store-1'), 'webhook-1'))?.status).toBe('PROCESSED')
    expect(ledger.auditTrail().map((item) => item.event)).toEqual(['claimed', 'processed'])
  })
  it('schedules a failed handler for retry', async () => {
    const ledger = new InMemoryWebhookProcessingLedger(3)
    const processor = new WebhookProcessor(new WebhookVerifier('secret', ledger), ledger, () => 100)
    await expect(processor.process(event(), async () => { throw new Error('temporary') })).resolves.toMatchObject({ status: 'retry' })
    expect((await ledger.get(storeId('store-1'), 'webhook-1'))?.status).toBe('RETRY')
    expect(ledger.auditTrail().at(-1)?.event).toBe('retry_scheduled')
  })
  it('retries a ready receipt and increments attempts', async () => {
    const ledger = new InMemoryWebhookProcessingLedger(3)
    await ledger.begin(event(), 0)
    await ledger.markFailed(storeId('store-1'), 'webhook-1', 'temporary', 0)
    expect(await ledger.begin(event(), 2_000)).toBe(true)
    expect((await ledger.get(storeId('store-1'), 'webhook-1'))?.attempts).toBe(2)
  })
  it('moves a receipt to FAILED after max attempts', async () => {
    const ledger = new InMemoryWebhookProcessingLedger(1)
    await ledger.begin(event(), 100)
    expect(await ledger.markFailed(storeId('store-1'), 'webhook-1', 'permanent', 100)).toBe('FAILED')
    expect((await ledger.get(storeId('store-1'), 'webhook-1'))?.failedAt).toBe(100)
    expect(ledger.auditTrail().at(-1)?.event).toBe('failed')
  })
  it('deduplicates a processed webhook without invoking its handler', async () => {
    const ledger = new InMemoryWebhookProcessingLedger()
    const processor = new WebhookProcessor(new WebhookVerifier('secret', ledger), ledger)
    await processor.process(event(), async () => undefined)
    let calls = 0
    const result = await processor.process(event(), async () => { calls += 1 })
    expect(result.status).toBe('deduped')
    expect(calls).toBe(0)
  })
  it('records unknown handler failures as typed retry state', async () => {
    const ledger = new InMemoryWebhookProcessingLedger(3)
    const processor = new WebhookProcessor(new WebhookVerifier('secret', ledger), ledger, () => 100)
    await processor.process(event(), async () => { throw 'not-an-error' })
    expect((await ledger.get(storeId('store-1'), 'webhook-1'))?.lastError).toBe('Unknown webhook handler failure')
  })
  it('isolates the same webhook id across stores', async () => {
    const ledger = new InMemoryWebhookProcessingLedger()
    expect(await ledger.begin({ ...event(), storeId: storeId('one') }, 100)).toBe(true)
    expect(await ledger.begin({ ...event(), storeId: storeId('two') }, 100)).toBe(true)
  })
})
