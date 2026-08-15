import { MerchantEmailVerifier, PostgresTemplateRepository, PostgresWorkflowRepository, ThreadLedger } from '@profitpilot/automation'
import type { ExportRow } from '@profitpilot/reporting'
import { createF5Bootstrap } from './f5-bootstrap.js'
import type { F5Bootstrap } from './f5-bootstrap.js'
import type { AutomationRouteDependencies } from './automation-routes.js'
import { storeId } from '@profitpilot/types'

export type F6Bootstrap = Readonly<F5Bootstrap & { automation: AutomationRouteDependencies }>
export function createF6Bootstrap(env: Readonly<Record<string, string | undefined>>): F6Bootstrap | null {
  const f5 = createF5Bootstrap(env)
  if (!f5) return null
  return { ...f5, automation: { workflows: new PostgresWorkflowRepository(f5.database), templates: new PostgresTemplateRepository(f5.database), emailVerifier: new MerchantEmailVerifier(env.TRACKING_SECRET?.trim() || 'development-tracking-secret'), tickets: new ThreadLedger(), exportRows: (tenant, dataset) => loadExportRows(f5, tenant, dataset) } }
}

async function loadExportRows(f5: F5Bootstrap, tenant: string, dataset: 'orders' | 'catalog' | 'audit' | 'revenue'): Promise<readonly ExportRow[]> {
  const id = storeId(tenant)
  if (dataset === 'catalog') {
    const catalog = await f5.dataPlane.analytics.readCatalog(id)
    return catalog.slice(0, 50_000).map((product) => ({ productId: product.productId, title: typeof product.payload.title === 'string' ? product.payload.title : product.productId, syncedAt: new Date(product.syncedAt).toISOString() }))
  }
  if (dataset === 'audit') {
    const result = await f5.database.query<{ action: string; created_at: Date; idempotency_key: string }>('SELECT action, created_at, idempotency_key FROM audit_log WHERE store_id = $1 ORDER BY created_at DESC LIMIT 50000', [tenant]).catch(async () => f5.database.query<{ module: string; record_id: string; synced_at: Date }>('SELECT module, record_id, synced_at FROM sync_records WHERE store_id = $1 ORDER BY synced_at DESC LIMIT 50000', [tenant]))
    return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])) as ExportRow)
  }
  const analytics = await f5.dataPlane.analytics.read(id)
  if (dataset === 'orders') return analytics.orders.slice(0, 50_000).map((row) => ({ day: row.day, orders: row.orderCount, fulfilled: row.fulfilledCount, cancelled: row.cancelledCount, averageOrderValue: row.averageOrderValue }))
  return analytics.revenue.slice(0, 50_000).map((row) => ({ day: row.day, grossRevenue: row.grossRevenue, discounts: row.discounts, orderCount: row.orderCount }))
}
