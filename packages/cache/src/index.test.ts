import { describe, expect, it } from 'vitest'
import { InMemoryCacheStore, TenantVersionedCache } from './index.js'
import { storeId } from '@profitpilot/types'

describe('cache public surface', () => {
  it('supports deleting a tenant key', async () => {
    const cache = new TenantVersionedCache(new InMemoryCacheStore())
    await cache.set(storeId('s'), 'k', true, 10)
    await cache.delete(storeId('s'), 'k')
    expect(await cache.get(storeId('s'), 'k')).toBeNull()
  })
})
