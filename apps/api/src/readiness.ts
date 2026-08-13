export type DependencyName = 'database' | 'redis' | 'ai' | 'shopify'
export type DependencyCheck = Readonly<{ name: DependencyName; check: () => Promise<boolean> }>
export type DependencyStatus = Readonly<{ name: DependencyName; ok: boolean }>
export type Readiness = Readonly<{ ok: boolean; checks: readonly DependencyStatus[] }>

export async function evaluateReadiness(checks: readonly DependencyCheck[]): Promise<Readiness> {
  const statuses = await Promise.all(checks.map(async ({ name, check }) => {
    try {
      return { name, ok: await check() }
    } catch {
      return { name, ok: false }
    }
  }))
  return { ok: statuses.every((status) => status.ok), checks: statuses }
}


export function readinessChecksFromEnv(env: Readonly<Record<string, string | undefined>>): readonly DependencyCheck[] {
  const configured = (name: DependencyName, key: string): DependencyCheck => ({ name, check: async () => Boolean(env[key]?.trim()) })
  return [
    configured('database', 'DATABASE_URL'),
    configured('redis', 'REDIS_URL'),
    configured('ai', 'OPENROUTER_API_KEY_1'),
    configured('shopify', 'SHOPIFY_API_KEY'),
  ]
}
