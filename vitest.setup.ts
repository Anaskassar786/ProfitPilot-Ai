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

// Polaris reads `window.matchMedia` at module load. jsdom does not implement
// it, so any jsdom test file that imports Polaris outside the local
// jsdom-polaris-setup stub crashed at import time. Stub it once here for
// every jsdom suite (no-op under the node environment).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false },
    }),
  })
}

beforeEach(() => {
  resetDataCacheForTests()
})
