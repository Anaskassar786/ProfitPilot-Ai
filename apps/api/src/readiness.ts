export type DependencyName = 'database' | 'redis' | 'ai' | 'shopify'
export type DependencyCheck = Readonly<{ name: DependencyName; check: () => Promise<boolean> }>
export type DependencyStatus = Readonly<{ name: DependencyName; ok: boolean }>
export type Readiness = Readonly<{ ok: boolean; checks: readonly DependencyStatus[] }>

export async function evaluateReadiness(checks: readonly DependencyCheck[]): Promise<Readiness> {
  const statuses = await Promise.all(checks.map(async ({ name, check }) => {
    try { return { name, ok: await check() } } catch { return { name, ok: false } }
  }))
  return { ok: statuses.every((status) => status.ok), checks: statuses }
}

export function readinessChecksFromEnv(env: Readonly<Record<string, string | undefined>>): readonly DependencyCheck[] {
  const configured = (name: DependencyName, key: string): DependencyCheck => ({ name, check: async () => Boolean(env[key]?.trim()) })
  return [configured('database', 'DATABASE_URL'), configured('redis', 'REDIS_URL'), configured('ai', 'OPENROUTER_API_KEY_1'), configured('shopify', 'SHOPIFY_API_KEY')]
}

export type ReadinessAdapters = Readonly<{ database: () => Promise<boolean>; redis: () => Promise<boolean>; ai: () => Promise<boolean>; shopify: () => Promise<boolean> }>
export function readinessChecksFromAdapters(adapters: ReadinessAdapters): readonly DependencyCheck[] { return [{ name: 'database', check: adapters.database }, { name: 'redis', check: adapters.redis }, { name: 'ai', check: adapters.ai }, { name: 'shopify', check: adapters.shopify }] }

export function httpHealthCheck(input: Readonly<{ url: string; headers?: Readonly<Record<string, string>>; fetcher?: (input: string, init: RequestInit) => Promise<Response> }>): () => Promise<boolean> {
  const fetcher = input.fetcher ?? fetch
  return async () => { const init: RequestInit = input.headers ? { method: 'GET', headers: input.headers } : { method: 'GET' }; const response = await fetcher(input.url, init); return response.ok }
}
