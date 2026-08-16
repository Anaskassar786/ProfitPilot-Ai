import { withTenantContext } from '@profitpilot/db'
import type { SqlExecutor } from '@profitpilot/db'
import type { StoreId } from '@profitpilot/types'

/**
 * Daily inventory snapshots.
 *
 * Shopify reports only *current* stock, so a stock-history chart is impossible
 * unless the app records what it saw. `PostgresSyncSink.complete()` calls
 * `writeInventorySnapshots` when an inventory sync finishes: no cron, no worker
 * change, and exactly one observation per calendar day per variant/location.
 *
 * Nothing is back-filled or interpolated. A store that syncs for the first time
 * gets one data point; the chart fills in as syncs accumulate.
 */

/** Snapshots older than this are pruned on write; the spec requires 365 days minimum. */
export const INVENTORY_SNAPSHOT_RETENTION_DAYS = 400
const LOCATION_RECORD_PREFIX = 'location:'

export type InventorySnapshotRow = Readonly<{
  variantId: string
  productId: string
  /** '' when Shopify returned no per-location level for the variant. */
  locationId: string
  quantity: number
  /** null when Shopify returned no usable variant price — value is never invented. */
  value: number | null
}>

export type SnapshotCatalogRow = Readonly<{ product_id: string; payload: unknown }>
export type SnapshotInventoryRow = Readonly<{ record_id: string; payload: unknown }>

/**
 * Joins synced catalog variants to synced inventory levels and produces the
 * rows to persist. A variant with no usable quantity is skipped rather than
 * recorded as zero.
 */
export function buildInventorySnapshotRows(input: Readonly<{ catalog: readonly SnapshotCatalogRow[]; inventory: readonly SnapshotInventoryRow[] }>): readonly InventorySnapshotRow[] {
  const levels = new Map<string, Array<Readonly<{ locationId: string; available: number }>>>()
  for (const row of input.inventory) {
    const payload = objectValue(unwrapLegacy(row.payload))
    if (!payload) continue
    if (row.record_id.startsWith(LOCATION_RECORD_PREFIX) || payload.record_kind === 'location') continue
    const inventoryItemId = scalarString(payload.inventory_item_id)
    const available = integerOrNull(payload.available)
    if (!inventoryItemId || available === null) continue
    const bucket = levels.get(inventoryItemId) ?? []
    bucket.push({ locationId: scalarString(payload.location_id) ?? '', available })
    levels.set(inventoryItemId, bucket)
  }

  const rows: InventorySnapshotRow[] = []
  const seen = new Set<string>()
  for (const catalogRow of input.catalog) {
    const product = objectValue(unwrapLegacy(catalogRow.payload))
    if (!product) continue
    const productId = scalarString(product.id) ?? catalogRow.product_id
    for (const rawVariant of arrayValue(product.variants)) {
      const variant = objectValue(rawVariant)
      if (!variant) continue
      const variantId = scalarString(variant.id)
      if (!variantId) continue
      const price = money(variant.price)
      const inventoryItemId = scalarString(variant.inventory_item_id)
      const variantLevels = inventoryItemId ? levels.get(inventoryItemId) ?? [] : []
      if (variantLevels.length > 0) {
        for (const level of variantLevels) {
          const key = `${variantId}:${level.locationId}`
          if (seen.has(key)) continue
          seen.add(key)
          rows.push({ variantId, productId, locationId: level.locationId, quantity: level.available, value: price === null ? null : round(price * Math.max(0, level.available)) })
        }
        continue
      }
      const variantQuantity = integerOrNull(variant.inventory_quantity)
      if (variantQuantity === null) continue
      const key = `${variantId}:`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ variantId, productId, locationId: '', quantity: variantQuantity, value: price === null ? null : round(price * Math.max(0, variantQuantity)) })
    }
  }
  return rows
}

/** UTC calendar day for a timestamp; snapshots are keyed by date, not time. */
export function snapshotDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * Reads the store's current synced catalog + inventory levels and upserts one
 * snapshot row per variant/location for today. Re-running on the same day
 * overwrites the day's rows with the latest observation.
 */
export function writeInventorySnapshots(executor: SqlExecutor, storeId: StoreId, at: number): Promise<number> {
  // Runs inside the tenant context so the row-level security policy on
  // inventory_snapshots_daily is satisfied for non-owner application roles.
  return withTenantContext(executor, storeId, (client) => writeSnapshotsOn(client, storeId, at))
}

async function writeSnapshotsOn(executor: SqlExecutor, storeId: StoreId, at: number): Promise<number> {
  const [catalog, inventory] = await Promise.all([
    executor.query<SnapshotCatalogRow & Record<string, unknown>>('SELECT product_id, payload FROM catalog_products WHERE store_id = $1 ORDER BY product_id', [storeId]),
    executor.query<SnapshotInventoryRow & Record<string, unknown>>(`SELECT record_id, payload FROM sync_records WHERE store_id = $1 AND module = 'inventory'`, [storeId]),
  ])
  const rows = buildInventorySnapshotRows({ catalog: catalog.rows, inventory: inventory.rows })
  if (rows.length === 0) return 0
  const day = snapshotDate(at)
  for (const row of rows) {
    await executor.query(
      `INSERT INTO inventory_snapshots_daily (store_id, snapshot_date, variant_id, location_id, product_id, quantity, value)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7)
       ON CONFLICT (store_id, snapshot_date, variant_id, location_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, value = EXCLUDED.value, product_id = EXCLUDED.product_id, recorded_at = now()`,
      [storeId, day, row.variantId, row.locationId, row.productId, row.quantity, row.value],
    )
  }
  await executor.query(
    `DELETE FROM inventory_snapshots_daily WHERE store_id = $1 AND snapshot_date < ($2::date - $3::int)`,
    [storeId, day, INVENTORY_SNAPSHOT_RETENTION_DAYS],
  )
  return rows.length
}

function unwrapLegacy(value: unknown): unknown {
  const raw = objectValue(value)
  if (!raw || typeof raw.payload !== 'string') return value
  try {
    const parsed: unknown = JSON.parse(raw.payload)
    const record = objectValue(parsed)
    return record ? { ...record, id: record.id ?? raw.id } : value
  } catch { return value }
}
function objectValue(value: unknown): Readonly<Record<string, unknown>> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null }
function arrayValue(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function scalarString(value: unknown): string | null { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null }
function integerOrNull(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? Math.round(parsed) : null }
function money(value: unknown): number | null { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null }
function round(value: number): number { return Math.round(value * 100) / 100 }
