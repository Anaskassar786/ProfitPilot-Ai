/**
 * Global vitest setup: clears the SPA data cache between test cases.
 *
 * The web app's module-scope stale-while-revalidate cache (`data-cache.ts`)
 * is intentionally module-level so tab switches render instantly. Without a
 * reset, fixtures from one test would seed the next test's component renders
 * and produce order-dependent results.
 */
import { beforeEach } from 'vitest'
import { resetDataCacheForTests } from './apps/web/src/data-cache.js'

beforeEach(() => {
  resetDataCacheForTests()
})
