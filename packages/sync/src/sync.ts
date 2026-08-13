import { PhaseNotImplementedError, AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export const SYNC_MODULES = ['products', 'orders', 'customers', 'inventory', 'checkouts', 'collections', 'discounts', 'transactions'] as const
export type SyncModule = (typeof SYNC_MODULES)[number]
export type SyncCheckpoint = Readonly<{ storeId: StoreId; module: SyncModule; cursor: string | null; version: number; updatedAt: number }>

export type SyncPlanItem = Readonly<{ module: SyncModule; priority: 'webhook' | 'sync' | 'report' }>

export function createSyncPlan(): readonly SyncPlanItem[] {
  return SYNC_MODULES.map((module) => ({ module, priority: 'sync' as const }))
}

export class CheckpointLedger {
  private readonly checkpoints = new Map<string, SyncCheckpoint>()

  public get(storeId: StoreId, module: SyncModule): SyncCheckpoint | null {
    return this.checkpoints.get(`${storeId}:${module}`) ?? null
  }

  public save(next: Omit<SyncCheckpoint, 'version'>, expectedVersion: number | null): SyncCheckpoint {
    const key = `${next.storeId}:${next.module}`
    const current = this.checkpoints.get(key)
    const currentVersion = current?.version ?? 0
    if (currentVersion !== (expectedVersion ?? 0)) {
      throw new AppError('CONFLICT', 'Sync checkpoint changed; resume from the latest cursor', 409, { module: next.module, expectedVersion, currentVersion })
    }
    const checkpoint: SyncCheckpoint = { ...next, version: currentVersion + 1 }
    this.checkpoints.set(key, checkpoint)
    return checkpoint
  }
}

export class SyncEngine {
  public async run(_storeId: StoreId, _module: SyncModule): Promise<never> {
    throw new PhaseNotImplementedError('F2', 'Shopify sync execution')
  }
}
