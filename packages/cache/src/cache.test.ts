import { describe, expect, it } from 'vitest'
import { InMemoryCacheStore, TenantVersionedCache, UpstashCacheStore } from './index.js'
import { storeId } from '@profitpilot/types'

describe('in-memory cache', () => {
  it('sets and gets string values', async () => {
    const cache = new InMemoryCacheStore()
    await cache.set('key', 'value', 10)
    expect(await cache.get('key')).toBe('value')
  })
  it('expires values with the injected clock', async () => {
    let now = 1000
    const cache = new InMemoryCacheStore(() => now)
    await cache.set('key', 'value', 1)
    now += 1001
    expect(await cache.get('key')).toBeNull()
  })
  it('rejects invalid TTLs', async () => {
    await expect(new InMemoryCacheStore().set('key', 'value', 0)).rejects.toThrow('TTL')
  })
  it('deletes values', async () => {
    const cache = new InMemoryCacheStore()
    await cache.set('key', 'value', 10)
    await cache.delete('key')
    expect(await cache.get('key')).toBeNull()
  })
})

describe('tenant-versioned cache', () => {
  it('serializes typed values', async () => {
    const cache = new TenantVersionedCache(new InMemoryCacheStore())
    await cache.set(storeId('store-1'), 'health', { score: 82 }, 60)
    expect(await cache.get<{ score: number }>(storeId('store-1'), 'health')).toEqual({ score: 82 })
  })
  it('isolates store keys', async () => {
    const cache = new TenantVersionedCache(new InMemoryCacheStore())
    await cache.set(storeId('one'), 'key', 'one', 60)
    await cache.set(storeId('two'), 'key', 'two', 60)
    expect(await cache.get(storeId('one'), 'key')).toBe('one')
    expect(await cache.get(storeId('two'), 'key')).toBe('two')
  })
  it('bumps a tenant version on invalidation', async () => {
    const cache = new TenantVersionedCache(new InMemoryCacheStore())
    await cache.set(storeId('store-1'), 'key', 'old', 60)
    expect(await cache.invalidateTenant(storeId('store-1'))).toBe(1)
    expect(await cache.get(storeId('store-1'), 'key')).toBeNull()
  })
  it('starts versions at zero', () => expect(new TenantVersionedCache(new InMemoryCacheStore()).version(storeId('s'))).toBe(0))
})

describe('Upstash cache transport', () => {
  it('sends GET and SET commands with authorization', async () => {
    const requests: RequestInit[] = []
    const fetcher = async (_input: string, init: RequestInit): Promise<Response> => {
      requests.push(init)
      return new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
    }
    const cache = new UpstashCacheStore('https://cache.example', 'token', fetcher)
    await cache.set('key', 'value', 30)
    await cache.get('key')
    expect(requests[0]?.headers).toMatchObject({ authorization: 'Bearer token' })
    expect(JSON.parse(String(requests[0]?.body))).toEqual(['SET', 'key', 'value', 'EX', '30'])
  })
  it('rejects failed Upstash responses', async () => {
    const fetcher = async (): Promise<Response> => new Response('', { status: 503 })
    await expect(new UpstashCacheStore('https://cache.example', 'token', fetcher).get('key')).rejects.toThrow('503')
  })
})
