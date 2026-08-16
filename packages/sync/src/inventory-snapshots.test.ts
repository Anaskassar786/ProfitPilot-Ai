import { describe, expect, it } from 'vitest'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { storeId } from '@profitpilot/types'
import { PostgresSyncSink, buildInventorySnapshotRows, snapshotDate, writeInventorySnapshots, INVENTORY_SNAPSHOT_RETENTION_DAYS } from './index.js'

const TENANT = storeId('11111111-1111-4111-8111-111111111111')
const AT = Date.parse('2026-08-16T07:15:00Z')

function catalogRow(productId: string, variants: readonly Readonly<Record<string, unknown>>[]) {
  return { product_id: productId, payload: { id: productId, title: 'Real Product', variants } }
}
function levelRow(inventoryItemId: string, locationId: string, available: number) {
  return { record_id: `${locationId}:${inventoryItemId}`, payload: { inventory_item_id: inventoryItemId, location_id: locationId, available } }
}

type Recorded = Readonly<{ text: string; values: readonly unknown[] }>

function recordingExecutor(catalog: readonly unknown[], inventory: readonly unknown[]): Readonly<{ executor: SqlExecutor; calls: Recorded[] }> {
  const calls: Recorded[] = []
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<DatabaseResult<Row>> {
      calls.push({ text, values })
      if (text.includes('FROM catalog_products')) return { rows: catalog as Row[], rowCount: catalog.length }
      if (text.includes("module = 'inventory'")) return { rows: inventory as Row[], rowCount: inventory.length }
      return { rows: [], rowCount: 0 }
    },
  }
  return { executor, calls }
}

describe('daily inventory snapshot rows', () => {
  it('records one row per variant per location using real synced levels', () => {
    const rows = buildInventorySnapshotRows({
      catalog: [catalogRow('7001', [{ id: '9001', price: '499.00', inventory_item_id: '5001', inventory_quantity: 24 }])],
      inventory: [levelRow('5001', '61', 20), levelRow('5001', '62', 4)],
    })
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.locationId).sort()).toEqual(['61', '62'])
    expect(rows.find((row) => row.locationId === '61')).toMatchObject({ variantId: '9001', productId: '7001', quantity: 20, value: 499 * 20 })
  })

  it('falls back to the variant quantity when Shopify returned no levels', () => {
    const rows = buildInventorySnapshotRows({ catalog: [catalogRow('7001', [{ id: '9001', price: '10.00', inventory_item_id: '5001', inventory_quantity: 7 }])], inventory: [] })
    expect(rows).toEqual([{ variantId: '9001', productId: '7001', locationId: '', quantity: 7, value: 70 }])
  })

  it('skips a variant with no usable quantity instead of recording a fabricated zero', () => {
    expect(buildInventorySnapshotRows({ catalog: [catalogRow('7001', [{ id: '9001', price: '10.00', inventory_item_id: '5001' }])], inventory: [] })).toEqual([])
  })

  it('records a null value when Shopify returned no price rather than inventing one', () => {
    const rows = buildInventorySnapshotRows({ catalog: [catalogRow('7001', [{ id: '9001', inventory_item_id: '5001', inventory_quantity: 3 }])], inventory: [] })
    expect(rows[0]?.value).toBeNull()
    expect(rows[0]?.quantity).toBe(3)
  })

  it('ignores location records, which are not stock levels', () => {
    const rows = buildInventorySnapshotRows({
      catalog: [catalogRow('7001', [{ id: '9001', price: '5.00', inventory_item_id: '5001', inventory_quantity: 2 }])],
      inventory: [{ record_id: 'location:61', payload: { id: 'location:61', location_id: '61', record_kind: 'location', name: 'Warehouse' } }],
    })
    expect(rows).toEqual([{ variantId: '9001', productId: '7001', locationId: '', quantity: 2, value: 10 }])
  })

  it('reads the legacy stringified payload shape', () => {
    const rows = buildInventorySnapshotRows({
      catalog: [{ product_id: '7001', payload: { id: '7001', payload: JSON.stringify({ id: '7001', variants: [{ id: '9001', price: '3.00', inventory_item_id: '5001', inventory_quantity: 4 }] }) } }],
      inventory: [],
    })
    expect(rows).toEqual([{ variantId: '9001', productId: '7001', locationId: '', quantity: 4, value: 12 }])
  })

  it('keys snapshots by UTC calendar day', () => {
    expect(snapshotDate(AT)).toBe('2026-08-16')
  })
})

describe('snapshot persistence', () => {
  it('upserts today rows and prunes beyond the retention window', async () => {
    const { executor, calls } = recordingExecutor(
      [catalogRow('7001', [{ id: '9001', price: '499.00', inventory_item_id: '5001', inventory_quantity: 24 }])],
      [levelRow('5001', '61', 24)],
    )
    const written = await writeInventorySnapshots(executor, TENANT, AT)
    expect(written).toBe(1)
    const insert = calls.find((call) => call.text.includes('INSERT INTO inventory_snapshots_daily'))
    expect(insert?.text).toContain('ON CONFLICT (store_id, snapshot_date, variant_id, location_id)')
    expect(insert?.values).toEqual([TENANT, '2026-08-16', '9001', '61', '7001', 24, 499 * 24])
    const prune = calls.find((call) => call.text.includes('DELETE FROM inventory_snapshots_daily'))
    expect(prune?.values).toEqual([TENANT, '2026-08-16', INVENTORY_SNAPSHOT_RETENTION_DAYS])
    expect(INVENTORY_SNAPSHOT_RETENTION_DAYS).toBeGreaterThanOrEqual(365)
    expect(calls.every((call) => call.values[0] === TENANT)).toBe(true)
  })

  it('writes nothing for a store with no synced catalog', async () => {
    const { executor, calls } = recordingExecutor([], [])
    expect(await writeInventorySnapshots(executor, TENANT, AT)).toBe(0)
    expect(calls.some((call) => call.text.includes('INSERT INTO inventory_snapshots_daily'))).toBe(false)
  })
})

describe('sync sink completion hook', () => {
  it('snapshots inventory when an inventory sync completes', async () => {
    const { executor, calls } = recordingExecutor(
      [catalogRow('7001', [{ id: '9001', price: '10.00', inventory_item_id: '5001', inventory_quantity: 5 }])],
      [levelRow('5001', '61', 5)],
    )
    await new PostgresSyncSink(executor, null, () => AT).complete(TENANT, 'inventory')
    expect(calls.some((call) => call.text.includes('INSERT INTO inventory_snapshots_daily'))).toBe(true)
  })

  it('does not snapshot for unrelated modules', async () => {
    const { executor, calls } = recordingExecutor([], [])
    await new PostgresSyncSink(executor, null, () => AT).complete(TENANT, 'customers')
    expect(calls).toEqual([])
  })
})
