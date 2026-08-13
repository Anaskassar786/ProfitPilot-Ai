import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import type { DatabaseResult, SqlExecutor } from '@profitpilot/db'
import { PostgresWebhookProcessingStore } from './index.js'
import { storeId } from '@profitpilot/types'

const event = { storeId: storeId('s'), webhookId: 'w1', topic: 'orders/create', rawBody: '{}', signature: createHmac('sha256', 'secret').update('{}').digest('base64') }
const row = { store_id: 's', webhook_id: 'w1', topic: 'orders/create', payload_hash: 'hash', status: 'PROCESSING' as const, attempts: 1, next_attempt_at: null, last_error: null, received_at: new Date(100), processed_at: null, failed_at: null }

describe('Postgres webhook retry ledger', () => {
  it('begins a receipt with an atomic retry-aware upsert', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return text.startsWith('INSERT INTO webhook_receipts') ? { rows: [row as unknown as Row], rowCount: 1 } : { rows: [], rowCount: 1 } } }
    expect(await new PostgresWebhookProcessingStore(executor).begin(event, 100)).toBe(true)
    expect(queries[0]).toContain('ON CONFLICT')
  })
  it('returns false when a retry claim is not ready', async () => {
    const retryRow = { ...row, status: 'RETRY' as const, next_attempt_at: new Date(10_000) }
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { return text.startsWith('SELECT') ? { rows: [retryRow as unknown as Row], rowCount: 1 } : { rows: [], rowCount: 0 } } }
    expect(await new PostgresWebhookProcessingStore(executor).begin(event, 100)).toBe(false)
  })
  it('marks a receipt processed and writes audit', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return { rows: text.startsWith('UPDATE') ? [] : [row as unknown as Row], rowCount: 1 } } }
    await new PostgresWebhookProcessingStore(executor).markProcessed(event.storeId, event.webhookId, 200)
    expect(queries.some((query) => query.includes('webhook_audit_events'))).toBe(true)
  })
  it('schedules a retry with an audit event', async () => {
    const queries: string[] = []
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); return text.startsWith('SELECT') ? { rows: [row as unknown as Row], rowCount: 1 } : { rows: [], rowCount: 1 } } }
    expect(await new PostgresWebhookProcessingStore(executor).markFailed(event.storeId, event.webhookId, 'temporary', 100)).toBe('RETRY')
    expect(queries.some((query) => query.includes('UPDATE webhook_receipts'))).toBe(true)
  })
  it('maps a persisted receipt', async () => {
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(): Promise<DatabaseResult<Row>> { return { rows: [row as unknown as Row], rowCount: 1 } } }
    expect(await new PostgresWebhookProcessingStore(executor).get(event.storeId, event.webhookId)).toMatchObject({ status: 'PROCESSING', attempts: 1 })
  })
  it('maps persisted audit events', async () => {
    const audit = { store_id: 's', webhook_id: 'w1', event: 'failed' as const, detail: 'bad', at: new Date(100) }
    const executor: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { return { rows: text.includes('webhook_audit_events') ? [audit as unknown as Row] : [], rowCount: 1 } } }
    expect((await new PostgresWebhookProcessingStore(executor).auditTrail())[0]?.event).toBe('failed')
  })
})
