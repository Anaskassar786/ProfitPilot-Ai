/**
 * Shared OpenRouter key resolution.
 *
 * Railway / Docker env injection is noisy: values arrive quoted, with a
 * BOM, with a `Bearer ` prefix, or under a sibling name
 * (`OPENROUTER_API_KEY` instead of `STORE_COACH_API_KEY`). Store Coach and
 * AI Executive used to read ONLY `STORE_COACH_API_KEY` and treated any of
 * those variants as "not configured". This helper accepts the documented
 * name first, then the keys the rest of the product already uses.
 */

export const STORE_COACH_KEY_CANDIDATES = [
  'STORE_COACH_API_KEY',
  'STORE_COACH_OPENROUTER_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_API_KEY_1',
  'AI_COMMAND_API_KEY',
  'INSIGHTS_HUB_API_KEY',
] as const

export type ResolvedApiKeys = Readonly<{
  keys: readonly string[]
  source: string | null
}>

/** Strip quotes, BOM, Bearer prefix, and placeholder values. */
export function cleanSecret(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null
  let cleaned = value.replace(/^\uFEFF/, '').trim()
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2)
  ) {
    cleaned = cleaned.slice(1, -1).trim()
  }
  if (/^bearer\s+/i.test(cleaned)) cleaned = cleaned.replace(/^bearer\s+/i, '').trim()
  if (!cleaned) return null
  const placeholder = cleaned.toLowerCase()
  if (placeholder === 'replace' || placeholder === 'changeme' || placeholder === 'your-key-here' || placeholder === 'sk-or-v1-replace') return null
  return cleaned
}

/** Case-insensitive env lookup so `store_coach_api_key` still resolves. */
export function envLookup(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined) return env[name]
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === target) return value
  }
  return undefined
}

export function resolveApiKeys(env: Readonly<Record<string, string | undefined>>, candidates: readonly string[] = STORE_COACH_KEY_CANDIDATES): ResolvedApiKeys {
  const keys: string[] = []
  const seen = new Set<string>()
  let source: string | null = null
  for (const name of candidates) {
    const cleaned = cleanSecret(envLookup(env, name))
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    keys.push(cleaned)
    if (source === null) source = name
  }
  return { keys, source }
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return 'absent'
  if (value.length <= 8) return `${value.slice(0, 2)}…`
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}

/** True unless the operator explicitly disabled startup migrations. */
export function shouldRunMigrations(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env.RUN_MIGRATIONS?.trim().toLowerCase()
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
}

export function isMissingRelationError(error: unknown): boolean {
  if (isRecord(error) && (error.code === '42P01' || error.code === '42P07')) return true
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /relation ["'].+["'] does not exist/i.test(message) || /relation \S+ does not exist/i.test(message)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
