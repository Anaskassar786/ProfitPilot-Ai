import type { StoreId } from '@profitpilot/types'

export type CacheStore = Readonly<{
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}>

type MemoryEntry = Readonly<{ value: string; expiresAt: number }>
type Clock = () => number

export class InMemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, MemoryEntry>()
  private readonly clock: Clock

  public constructor(clock: Clock = () => Date.now()) {
    this.clock = clock
  }

  public async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError('Cache TTL must be greater than zero')
    }
    this.entries.set(key, { value, expiresAt: this.clock() + ttlSeconds * 1000 })
  }

  public async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }
}

export class TenantVersionedCache {
  private readonly versions = new Map<StoreId, number>()
  private readonly store: CacheStore
  private readonly namespace: string

  public constructor(store: CacheStore, namespace = 'profitpilot') {
    this.store = store
    this.namespace = namespace
  }

  public async get<Value>(storeId: StoreId, key: string): Promise<Value | null> {
    const encoded = await this.store.get(this.versionKey(storeId, key))
    return encoded === null ? null : (JSON.parse(encoded) as Value)
  }

  public async set<Value>(storeId: StoreId, key: string, value: Value, ttlSeconds: number): Promise<void> {
    await this.store.set(this.versionKey(storeId, key), JSON.stringify(value), ttlSeconds)
  }

  public async delete(storeId: StoreId, key: string): Promise<void> {
    await this.store.delete(this.versionKey(storeId, key))
  }

  public async invalidateTenant(storeId: StoreId): Promise<number> {
    const next = (this.versions.get(storeId) ?? 0) + 1
    this.versions.set(storeId, next)
    return next
  }

  public version(storeId: StoreId): number {
    return this.versions.get(storeId) ?? 0
  }

  private versionKey(storeId: StoreId, key: string): string {
    const version = this.version(storeId)
    return `${this.namespace}:v${version}:${storeId}:${key}`
  }
}

export type UpstashResponse = Readonly<{ result: string | null }>
export type UpstashFetcher = (input: string, init: RequestInit) => Promise<Response>

export class UpstashCacheStore implements CacheStore {
  private readonly url: string
  private readonly token: string
  private readonly fetcher: UpstashFetcher

  public constructor(url: string, token: string, fetcher: UpstashFetcher = fetch) {
    if (!url.startsWith('http')) throw new TypeError('Upstash URL must be HTTP(S)')
    if (token.trim().length === 0) throw new TypeError('Upstash token cannot be empty')
    this.url = url
    this.token = token
    this.fetcher = fetcher
  }

  public async get(key: string): Promise<string | null> {
    const response = await this.command(['GET', key])
    return response.result
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new RangeError('Cache TTL must be greater than zero')
    await this.command(['SET', key, value, 'EX', String(Math.floor(ttlSeconds))])
  }

  public async delete(key: string): Promise<void> {
    await this.command(['DEL', key])
  }

  private async command(command: readonly string[]): Promise<UpstashResponse> {
    const response = await this.fetcher(this.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    })
    if (!response.ok) throw new Error(`Upstash cache request failed with ${response.status}`)
    return (await response.json()) as UpstashResponse
  }
}
