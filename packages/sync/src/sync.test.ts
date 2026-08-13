import { describe, expect, it, vi } from 'vitest'
import { AppError, storeId } from '@profitpilot/types'
import { InMemoryCacheStore, TenantVersionedCache } from '@profitpilot/cache'
import { CheckpointLedger, SYNC_MODULES, SyncEngine, createSyncPlan } from './index.js'
import { AdaptiveRateController, StoreCircuitRegistry, StoreRequestPolicy } from './rate.js'
import type { SyncModule, SyncRecord, SyncSource } from './index.js'

const store = storeId('store-1')
const record = (id: number): SyncRecord => ({ id, title: `item-${id}` })

function policy(): StoreRequestPolicy {
  return new StoreRequestPolicy(new AdaptiveRateController({ sleep: async () => undefined }), new StoreCircuitRegistry())
}

describe('sync foundation', () => {
  it('defines all eight sync modules', () => expect(SYNC_MODULES).toHaveLength(8))
  it('creates a deterministic sync plan', () => expect(createSyncPlan().map((item) => item.module)).toEqual([...SYNC_MODULES]))
  it('starts a checkpoint at version one', async () => {
    const checkpoint = await new CheckpointLedger().save({ storeId: store, module: 'products', cursor: 'c1', updatedAt: 100 }, null)
    expect(checkpoint.version).toBe(1)
  })
  it('resumes a checkpoint with the expected version', async () => {
    const ledger = new CheckpointLedger()
    await ledger.save({ storeId: store, module: 'orders', cursor: 'c1', updatedAt: 100 }, null)
    expect((await ledger.save({ storeId: store, module: 'orders', cursor: 'c2', updatedAt: 200 }, 1)).cursor).toBe('c2')
  })
  it('rejects stale checkpoint writes', async () => {
    const ledger = new CheckpointLedger()
    await ledger.save({ storeId: store, module: 'orders', cursor: 'c1', updatedAt: 100 }, null)
    await expect(ledger.save({ storeId: store, module: 'orders', cursor: 'stale', updatedAt: 200 }, 0)).rejects.toBeInstanceOf(AppError)
  })
  it('isolates checkpoint modules', async () => {
    const ledger = new CheckpointLedger()
    await ledger.save({ storeId: store, module: 'orders', cursor: 'o', updatedAt: 100 }, null)
    expect(await ledger.get(store, 'products')).toBeNull()
  })
  it('returns the current checkpoint', async () => {
    const ledger = new CheckpointLedger()
    await ledger.save({ storeId: store, module: 'orders', cursor: 'c', updatedAt: 100 }, null)
    expect((await ledger.get(store, 'orders'))?.cursor).toBe('c')
  })
  it('runs every page and commits the next cursor after the sink succeeds', async () => {
    const pages: Readonly<Record<string, readonly [string | null, readonly SyncRecord[]]>> = { start: ['next', [record(1)]], next: [null, [record(2)]] }
    const requested: (string | null)[] = []
    const source: SyncSource = { fetchPage: async (_store, _module, cursor) => { requested.push(cursor); const page = pages[cursor ?? 'start']; if (!page) throw new Error('unexpected cursor'); return { nextCursor: page[0], records: page[1] } } }
    const upsert = vi.fn(async () => undefined)
    const result = await new SyncEngine(source, { upsert }, new CheckpointLedger(), policy(), null, () => 100).runModule(store, 'products')
    expect(requested).toEqual([null, 'next'])
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ pages: 2, records: 2, cursor: null, resumedFrom: null })
  })
  it('resumes from the last committed cursor after a previous run', async () => {
    const checkpoints = new CheckpointLedger()
    await checkpoints.save({ storeId: store, module: 'orders', cursor: 'resume-here', updatedAt: 100 }, null)
    const requested: (string | null)[] = []
    const source: SyncSource = { fetchPage: async (_store, _module, cursor) => { requested.push(cursor); return { nextCursor: null, records: [record(5)] } } }
    const result = await new SyncEngine(source, { upsert: async () => undefined }, checkpoints, policy(), null, () => 200).runModule(store, 'orders')
    expect(requested).toEqual(['resume-here'])
    expect(result.resumedFrom).toBe('resume-here')
  })
  it('does not checkpoint a failed sink page', async () => {
    const checkpoints = new CheckpointLedger()
    const source: SyncSource = { fetchPage: async () => ({ nextCursor: 'never-saved', records: [record(1)] }) }
    await expect(new SyncEngine(source, { upsert: async () => { throw new Error('database unavailable') } }, checkpoints, policy()).runModule(store, 'products')).rejects.toThrow('database unavailable')
    expect(await checkpoints.get(store, 'products')).toBeNull()
  })
  it('invalidates the tenant cache after each committed page', async () => {
    const cache = new TenantVersionedCache(new InMemoryCacheStore())
    const source: SyncSource = { fetchPage: async () => ({ nextCursor: null, records: [record(1)] }) }
    await new SyncEngine(source, { upsert: async () => undefined }, new CheckpointLedger(), policy(), null, () => 100, cache).runModule(store, 'products')
    expect(cache.version(store)).toBe(1)
  })
  it('rejects a non-advancing cursor to prevent an infinite loop', async () => {
    const source: SyncSource = { fetchPage: async () => ({ nextCursor: 'same', records: [] }) }
    const checkpoints = new CheckpointLedger()
    await checkpoints.save({ storeId: store, module: 'products', cursor: 'same', updatedAt: 1 }, null)
    await expect(new SyncEngine(source, { upsert: async () => undefined }, checkpoints, policy()).runModule(store, 'products')).rejects.toThrow('non-advancing')
  })
})
