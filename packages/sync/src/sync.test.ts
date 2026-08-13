import { describe, expect, it } from 'vitest'
import { AppError, PhaseNotImplementedError, storeId } from '@profitpilot/types'
import { CheckpointLedger, SYNC_MODULES, SyncEngine, createSyncPlan } from './index.js'

describe('sync foundation', () => {
  it('defines all eight sync modules', () => expect(SYNC_MODULES).toHaveLength(8))
  it('creates a deterministic sync plan', () => expect(createSyncPlan().map((item) => item.module)).toEqual([...SYNC_MODULES]))
  it('starts a checkpoint at version one', () => {
    const checkpoint = new CheckpointLedger().save({ storeId: storeId('s1'), module: 'products', cursor: 'c1', updatedAt: 100 }, null)
    expect(checkpoint.version).toBe(1)
  })
  it('resumes a checkpoint with the expected version', () => {
    const ledger = new CheckpointLedger()
    ledger.save({ storeId: storeId('s1'), module: 'orders', cursor: 'c1', updatedAt: 100 }, null)
    expect(ledger.save({ storeId: storeId('s1'), module: 'orders', cursor: 'c2', updatedAt: 200 }, 1).cursor).toBe('c2')
  })
  it('rejects stale checkpoint writes', () => {
    const ledger = new CheckpointLedger()
    ledger.save({ storeId: storeId('s1'), module: 'orders', cursor: 'c1', updatedAt: 100 }, null)
    expect(() => ledger.save({ storeId: storeId('s1'), module: 'orders', cursor: 'stale', updatedAt: 200 }, 0)).toThrow(AppError)
  })
  it('isolates checkpoint modules', () => {
    const ledger = new CheckpointLedger()
    ledger.save({ storeId: storeId('s1'), module: 'orders', cursor: 'o', updatedAt: 100 }, null)
    expect(ledger.get(storeId('s1'), 'products')).toBeNull()
  })
  it('returns the current checkpoint', () => {
    const ledger = new CheckpointLedger()
    ledger.save({ storeId: storeId('s1'), module: 'orders', cursor: 'c', updatedAt: 100 }, null)
    expect(ledger.get(storeId('s1'), 'orders')?.cursor).toBe('c')
  })
  it('marks runtime execution as an F2 boundary', async () => expect(new SyncEngine().run(storeId('s1'), 'products')).rejects.toBeInstanceOf(PhaseNotImplementedError))
})
