export type EnvironmentCategory = 'database' | 'redis' | 'shopify' | 'ai' | 'security' | 'legal' | 'storage' | 'email'
export type StartupValidation = Readonly<{ ok: boolean; missing: Readonly<Record<EnvironmentCategory, readonly string[]>> }>
export type NormalizedEnvironment = Readonly<Record<string, string | undefined>>

const R2_ALIASES: Readonly<Record<string, readonly string[]>> = { R2_ENDPOINT: ['R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT'], R2_BUCKET: ['R2_BUCKET', 'CLOUDFLARE_R2_BUCKET', 'CLOUDFLARE_R2_BUCKET_NAME'], R2_ACCESS_KEY_ID: ['R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID'], R2_SECRET_ACCESS_KEY: ['R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY'] }
const REQUIRED: Readonly<Record<EnvironmentCategory, readonly string[]>> = { database: ['DATABASE_URL'], redis: ['REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], shopify: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_REDIRECT_URI'], ai: ['OPENROUTER_API_KEY_1'], security: ['ENCRYPTION_KEY', 'JWT_SECRET', 'ADMIN_KEY'], legal: ['LEGAL_ENTITY_NAME', 'LEGAL_ENTITY_ADDRESS', 'LEGAL_JURISDICTION', 'SUPPORT_EMAIL'], storage: ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'], email: [] }

export class StartupConfigurationError extends Error {
  public readonly validation: StartupValidation
  public constructor(validation: StartupValidation) { super(`Startup configuration is incomplete: ${missingNames(validation).join(', ')}`); this.name = 'StartupConfigurationError'; this.validation = validation }
}

export function normalizeEnvironment(env: Readonly<Record<string, string | undefined>>): NormalizedEnvironment {
  const normalized: Record<string, string | undefined> = { ...env }
  for (const [canonical, aliases] of Object.entries(R2_ALIASES)) { const value = aliases.map((key) => env[key]?.trim()).find((candidate) => Boolean(candidate)); if (value) normalized[canonical] = value }
  return normalized
}

export function validateStartupEnvironment(env: Readonly<Record<string, string | undefined>>, production = env.NODE_ENV === 'production'): StartupValidation {
  const missing = Object.fromEntries(Object.entries(REQUIRED).map(([category, keys]) => [category, production ? keys.filter((key) => !env[key]?.trim()) : []])) as unknown as Record<EnvironmentCategory, readonly string[]>
  if (!production) missing.storage = []
  return { ok: Object.values(missing).every((keys) => keys.length === 0), missing }
}

export function requireStartupEnvironment(env: Readonly<Record<string, string | undefined>>): NormalizedEnvironment {
  const normalized = normalizeEnvironment(env)
  const validation = validateStartupEnvironment(normalized)
  if (!validation.ok) throw new StartupConfigurationError(validation)
  return normalized
}

export function missingNames(validation: StartupValidation): readonly string[] { return Object.entries(validation.missing).flatMap(([category, keys]) => keys.map((key) => `${category}:${key}`)) }
