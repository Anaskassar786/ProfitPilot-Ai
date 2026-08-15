import type { AnalyticsRepository, DbJsonObject, CatalogProduct, SqlExecutor } from '@profitpilot/db'
import type { StoreId } from '@profitpilot/types'
import { aggregateOrderFacts } from './analytics.js'
import { shopifyOrderToFact } from './order-facts.js'
import type { SyncModule, SyncRecord, SyncSink } from './sync.js'

export class PostgresSyncSink implements SyncSink {
  private readonly executor: SqlExecutor
  private readonly analytics: AnalyticsRepository | null
  private readonly now: () => number

  public constructor(executor: SqlExecutor, analytics: AnalyticsRepository | null = null, now: () => number = () => Date.now()) {
    this.executor = executor
    this.analytics = analytics
    this.now = now
  }

  public async upsert(storeId: StoreId, module: SyncModule, records: readonly SyncRecord[]): Promise<void> {
    const catalog: CatalogProduct[] = []
    for (const record of records) {
      const recordId = record.id ?? record.admin_graphql_api_id
      if (recordId === undefined || recordId === null || String(recordId).trim().length === 0) throw new Error(`Sync record in ${module} is missing an id`)
      const payload = JSON.stringify(record)
      await this.executor.query(`INSERT INTO sync_records (store_id, module, record_id, payload, synced_at) VALUES ($1, $2, $3, $4::jsonb, to_timestamp($5 / 1000.0)) ON CONFLICT (store_id, module, record_id) DO UPDATE SET payload = EXCLUDED.payload, synced_at = EXCLUDED.synced_at`, [storeId, module, String(recordId), payload, this.now()])
      if (module === 'products' && this.analytics) catalog.push({ storeId, productId: String(recordId), payload: record as DbJsonObject, syncedAt: this.now() })
    }
    if (catalog.length > 0 && this.analytics) await this.analytics.upsertCatalog(catalog)
  }

  public async complete(storeId: StoreId, module: SyncModule): Promise<void> {
    if (module !== 'orders' || !this.analytics) return
    const result = await this.executor.query<{ payload: unknown }>(
      `SELECT payload FROM sync_records WHERE store_id = $1 AND module = 'orders' ORDER BY record_id`,
      [storeId],
    )
    const facts = result.rows.map((row) => shopifyOrderToFact(row.payload))
    await this.analytics.upsert(aggregateOrderFacts(storeId, facts))
  }
}
