import { storeId as toStoreId } from '@profitpilot/types'
import type { ExportDataset } from '@profitpilot/types'
import { EXPORT_ROW_CEILING } from '@profitpilot/types'
import type { ExportRow } from '@profitpilot/reporting'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AnalyticsRepository } from '@profitpilot/db'
import type { ExportDataSource, ExportDateRange } from './exports-service.js'

/**
 * Real rows for every export, read straight from the synced data plane.
 *
 * Column names are the merchant-facing labels shown on the export card
 * ("Order date", "Orders placed", …) so the downloaded file is readable in
 * Excel or Sheets without a data dictionary. Nothing is generated, padded, or
 * estimated: an unsynced dataset returns zero rows and the service turns that
 * into a clear "nothing to export yet" message.
 */

type AuditRow = QueryResultRow & { action: string; created_at: Date; idempotency_key: string }
type SyncFallbackRow = QueryResultRow & { module: string; record_id: string; synced_at: Date }

export type ExportDataSourceDependencies = Readonly<{
  analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>
  database: SqlExecutor
}>

export class DataPlaneExportSource implements ExportDataSource {
  private readonly dependencies: ExportDataSourceDependencies

  public constructor(dependencies: ExportDataSourceDependencies) {
    this.dependencies = dependencies
  }

  public async rows(store: string, dataset: ExportDataset, range: ExportDateRange): Promise<readonly ExportRow[]> {
    const id = toStoreId(store)
    if (dataset === 'catalog') {
      const catalog = await this.dependencies.analytics.readCatalog(id)
      return catalog.slice(0, EXPORT_ROW_CEILING).map((product) => ({
        'Product ID': product.productId,
        'Product title': typeof product.payload.title === 'string' && product.payload.title.trim() ? product.payload.title : product.productId,
        'Last synced': new Date(product.syncedAt).toISOString().slice(0, 10),
      }))
    }
    if (dataset === 'audit') {
      const rows = await this.auditRows(store)
      return rows.slice(0, EXPORT_ROW_CEILING)
    }
    const analytics = await this.dependencies.analytics.read(id)
    if (dataset === 'orders') {
      return analytics.orders
        .filter((row) => withinRange(row.day, range))
        .slice(0, EXPORT_ROW_CEILING)
        .map((row) => ({
          'Order date': row.day,
          'Orders placed': row.orderCount,
          'Orders fulfilled': row.fulfilledCount,
          'Orders cancelled': row.cancelledCount,
          'Average order value': round2(row.averageOrderValue),
        }))
    }
    return analytics.revenue
      .filter((row) => withinRange(row.day, range))
      .slice(0, EXPORT_ROW_CEILING)
      .map((row) => ({
        'Day': row.day,
        'Gross revenue': round2(row.grossRevenue),
        'Discounts': round2(row.discounts),
        'Orders': row.orderCount,
      }))
  }

  public async estimates(store: string): Promise<Readonly<Partial<Record<ExportDataset, number>>>> {
    const id = toStoreId(store)
    const [analytics, catalog, audit] = await Promise.all([
      this.dependencies.analytics.read(id).catch(() => null),
      this.dependencies.analytics.readCatalog(id).catch(() => null),
      this.auditCount(store).catch(() => null),
    ])
    const estimates: Partial<Record<ExportDataset, number>> = {}
    if (analytics) {
      estimates.orders = Math.min(analytics.orders.length, EXPORT_ROW_CEILING)
      estimates.revenue = Math.min(analytics.revenue.length, EXPORT_ROW_CEILING)
    }
    if (catalog) estimates.catalog = Math.min(catalog.length, EXPORT_ROW_CEILING)
    if (audit !== null) estimates.audit = Math.min(audit, EXPORT_ROW_CEILING)
    return estimates
  }

  /**
   * Activity comes from the audit log. Older installs whose audit table is not
   * populated yet fall back to sync records so the merchant still receives the
   * real trail of what ProfitPilot did for their store.
   */
  private async auditRows(store: string): Promise<readonly ExportRow[]> {
    try {
      const result = await this.dependencies.database.query<AuditRow>(
        'SELECT action, created_at, idempotency_key FROM audit_log WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2',
        [store, EXPORT_ROW_CEILING],
      )
      if (result.rows.length > 0) {
        return result.rows.map((row) => ({ 'Action': row.action, 'When': row.created_at.toISOString(), 'Reference': row.idempotency_key }))
      }
    } catch { /* fall through to sync records */ }
    const fallback = await this.dependencies.database.query<SyncFallbackRow>(
      'SELECT module, record_id, synced_at FROM sync_records WHERE store_id = $1 ORDER BY synced_at DESC LIMIT $2',
      [store, EXPORT_ROW_CEILING],
    )
    return fallback.rows.map((row) => ({ 'Action': `${row.module} synced`, 'When': row.synced_at.toISOString(), 'Reference': row.record_id }))
  }

  private async auditCount(store: string): Promise<number> {
    try {
      const result = await this.dependencies.database.query<{ total: string | number }>('SELECT COUNT(*)::int AS total FROM audit_log WHERE store_id = $1', [store])
      const total = Number(result.rows[0]?.total ?? 0)
      if (total > 0) return total
    } catch { /* fall through to sync records */ }
    const fallback = await this.dependencies.database.query<{ total: string | number }>('SELECT COUNT(*)::int AS total FROM sync_records WHERE store_id = $1', [store])
    return Number(fallback.rows[0]?.total ?? 0)
  }
}

function withinRange(day: string, range: ExportDateRange): boolean {
  if (range.from && day < range.from) return false
  if (range.to && day > range.to) return false
  return true
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
