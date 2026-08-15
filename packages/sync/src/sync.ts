import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { Logger } from '@profitpilot/logger'
import type { TenantVersionedCache } from '@profitpilot/cache'
import type { StoreRequestPolicy } from './rate.js'

export const SYNC_MODULES = ['products', 'orders', 'customers', 'inventory', 'checkouts', 'collections', 'discounts', 'transactions'] as const
export type SyncModule = (typeof SYNC_MODULES)[number]
export type SyncScalar = string | number | boolean | null
/** A normalized Shopify resource. Nested arrays/objects remain intact. */
export type SyncRecord = Readonly<Record<string, unknown>>
export type SyncCheckpoint = Readonly<{ storeId: StoreId; module: SyncModule; cursor: string | null; version: number; updatedAt: number }>
export type SyncPage = Readonly<{ records: readonly SyncRecord[]; nextCursor: string | null }>
export type SyncRunResult = Readonly<{ storeId: StoreId; module: SyncModule; pages: number; records: number; cursor: string | null; resumedFrom: string | null }>
export type SyncPlanItem = Readonly<{ module: SyncModule; priority: 'webhook' | 'sync' | 'report' }>

export interface SyncSource {
  fetchPage(storeId: StoreId, module: SyncModule, cursor: string | null): Promise<SyncPage>
}

export interface SyncSink {
  upsert(storeId: StoreId, module: SyncModule, records: readonly SyncRecord[]): Promise<void>
  /** Runs only after every page has persisted and the terminal checkpoint is saved. */
  complete?(storeId: StoreId, module: SyncModule): Promise<void>
}

export interface CheckpointStore {
  get(storeId: StoreId, module: SyncModule): Promise<SyncCheckpoint | null>
  save(next: Omit<SyncCheckpoint, 'version'>, expectedVersion: number | null): Promise<SyncCheckpoint>
}

export function createSyncPlan(): readonly SyncPlanItem[] {
  return SYNC_MODULES.map((module) => ({ module, priority: 'sync' as const }))
}

export class CheckpointLedger implements CheckpointStore {
  private readonly checkpoints = new Map<string, SyncCheckpoint>()

  public async get(storeId: StoreId, module: SyncModule): Promise<SyncCheckpoint | null> {
    return this.checkpoints.get(`${storeId}:${module}`) ?? null
  }

  public async save(next: Omit<SyncCheckpoint, 'version'>, expectedVersion: number | null): Promise<SyncCheckpoint> {
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
  private readonly source: SyncSource
  private readonly sink: SyncSink
  private readonly checkpoints: CheckpointStore
  private readonly policy: StoreRequestPolicy
  private readonly logger: Logger | null
  private readonly now: () => number
  private readonly cache: TenantVersionedCache | null

  public constructor(source: SyncSource, sink: SyncSink, checkpoints: CheckpointStore, policy: StoreRequestPolicy, logger: Logger | null = null, now: () => number = () => Date.now(), cache: TenantVersionedCache | null = null) {
    this.source = source
    this.sink = sink
    this.checkpoints = checkpoints
    this.policy = policy
    this.logger = logger
    this.now = now
    this.cache = cache
  }

  public async runModule(storeId: StoreId, module: SyncModule): Promise<SyncRunResult> {
    const existing = await this.checkpoints.get(storeId, module)
    const resumedFrom = existing?.cursor ?? null
    let cursor = resumedFrom
    let version = existing?.version ?? null
    let pages = 0
    let records = 0

    while (true) {
      const page = await this.policy.execute(storeId, () => this.source.fetchPage(storeId, module, cursor))
      if (page.nextCursor === cursor && page.nextCursor !== null) throw new AppError('DEPENDENCY_ERROR', 'Shopify sync returned a non-advancing cursor', 502, { module, cursor })
      await this.sink.upsert(storeId, module, page.records)
      records += page.records.length
      pages += 1
      const checkpoint = await this.checkpoints.save({ storeId, module, cursor: page.nextCursor, updatedAt: this.now() }, version)
      version = checkpoint.version
      cursor = page.nextCursor
      this.logger?.info('Sync page committed', { storeId, module, page: pages, records: page.records.length, cursor: cursor ?? 'complete' })
      if (cursor === null) {
        // Rebuild completion-dependent projections from all persisted records,
        // never from one page. This stays correct across pagination and resume.
        await this.sink.complete?.(storeId, module)
        await this.cache?.invalidateTenant(storeId)
        return { storeId, module, pages, records, cursor, resumedFrom }
      }
      await this.cache?.invalidateTenant(storeId)
    }
  }
}
