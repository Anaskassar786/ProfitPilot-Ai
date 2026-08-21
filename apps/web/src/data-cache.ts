/**
 * Module-scope stale-while-revalidate cache (GA 2026-08-21).
 *
 * SPA tab switches unmount/remount workspace components, and several heavy
 * pages (AI Command Center, Reports, Automation, Store Coach, PatternAI)
 * re-fetch their full data bundle on every mount — which is why tab
 * switching regressed into spinner-heavy navigation.
 *
 * This cache keeps the last-good payload per key (storeId-scoped) in module
 * memory. Pages seed their state from the cache instantly (no loading
 * spinner), then silently refresh in the background and swap in newer data
 * when it arrives. `ttlMs` only controls whether the cached copy is
 * considered "fresh"; stale copies are still rendered immediately while the
 * background refresh runs.
 */
type Entry = Readonly<{ data: unknown; fetchedAt: number }>

const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

/** Returns the cached payload for `key`, or null when never fetched. */
export function cached<T>(key: string): T | null {
  const entry = cache.get(key)
  return entry ? (entry.data as T) : null
}

/** Returns true when a cached payload exists and is newer than `ttlMs`. */
export function isFresh(key: string, ttlMs: number): boolean {
  const entry = cache.get(key)
  return entry !== undefined && Date.now() - entry.fetchedAt <= ttlMs
}

/** Stores a payload (also used by optimistic writes). */
export function remember<T>(key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now() })
}

/** Drops a key (e.g. after a mutation so the next visit re-fetches). */
export function invalidateCache(key: string): void {
  cache.delete(key)
  inflight.delete(key)
}

/**
 * Fetches through the cache, deduplicating concurrent loads of the same key
 * so double-mounts (StrictMode, rapid tab switches) never fire two requests.
 */
export function loadCached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const run = Promise.resolve()
    .then(loader)
    .then((data) => {
      remember(key, data)
      return data
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, run)
  return run
}

/** For tests: clears the shared cache between cases. */
export function resetDataCacheForTests(): void {
  cache.clear()
  inflight.clear()
}
