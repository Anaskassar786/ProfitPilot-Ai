/**
 * Single source of truth for the Shopify access scopes ProfitPilot requests.
 *
 * Every scope declaration in the repository (.env.example, the OAuth install
 * URL built in bootstrap.ts, the generated shopify.app.toml, and the checked-in
 * docs/app-store/shopify.app.toml.template) is derived from — or verified
 * against — this list, so a stale copy can no longer drift out of sync.
 *
 * Why each scope exists:
 * - read_products / read_orders / read_customers: core analytics + sync.
 * - read_inventory / read_locations: inventory health and stockout features.
 * - read_checkouts: abandoned-checkout recovery reporting.
 * - read_price_rules: reading existing discounts before recommending changes.
 * - write_price_rules: REQUIRED to run discountCodeBasicCreate and
 *   discountCodeDeactivate from the AI Command Center and Automation Engine.
 *   Without it Shopify answers those mutations with 403 Access Denied.
 *
 * NOTE: this module is imported directly by scripts/generate-shopify-app-toml.ts
 * through Node's type stripping, so it must stay dependency-free (no imports).
 */
export const PROFITPILOT_SHOPIFY_SCOPES = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_inventory',
  'read_locations',
  'read_checkouts',
  'read_price_rules',
  'write_price_rules',
] as const

/** Comma-separated form used by SHOPIFY_SCOPES and the `access_scopes` TOML field. */
export const PROFITPILOT_SHOPIFY_SCOPES_CSV: string = PROFITPILOT_SHOPIFY_SCOPES.join(',')

/**
 * Normalize a comma-separated scope string into the effective scope list.
 *
 * The required registry is always included: an operator whose SHOPIFY_SCOPES
 * value predates a new capability (for example a deployment still requesting
 * only read_price_rules) would otherwise install the app without the write
 * scope and hit a 403 the first time a discount action runs. Any extra scope
 * supplied through the environment is preserved after the required ones.
 */
export function parseShopifyScopes(value: string | undefined): readonly string[] {
  const requested = (value ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)
  const merged = new Set<string>(PROFITPILOT_SHOPIFY_SCOPES)
  for (const scope of requested) merged.add(scope)
  return [...merged]
}

/**
 * Scopes ProfitPilot needs that a Shopify installation did not grant. Empty
 * means the installation can run every feature, discount actions included.
 */
export function missingShopifyScopes(granted: readonly string[] | string | undefined): readonly string[] {
  const list = typeof granted === 'string' ? granted.split(',') : (granted ?? [])
  const present = new Set(list.map((scope) => scope.trim()).filter((scope) => scope.length > 0))
  return PROFITPILOT_SHOPIFY_SCOPES.filter((scope) => !present.has(scope))
}

export type ShopifyAppTomlConfig = Readonly<{
  clientId: string
  name: string
  applicationUrl: string
  redirectUrls: readonly string[]
  scopes: readonly string[]
  apiVersion: string
}>

export type AppStoreScreenshotSpec = Readonly<{ name: string; width: number; height: number; format: 'PNG' | 'JPG'; maxBytes: number; description: string }>

export const APP_STORE_SCREENSHOT_SPECS: readonly AppStoreScreenshotSpec[] = [
  { name: 'dashboard', width: 1600, height: 1000, format: 'PNG', maxBytes: 5_000_000, description: 'Store health and real-data sync state.' },
  { name: 'recommendations', width: 1600, height: 1000, format: 'PNG', maxBytes: 5_000_000, description: 'Evidence-backed recommendation review and approval.' },
  { name: 'automation', width: 1600, height: 1000, format: 'PNG', maxBytes: 5_000_000, description: 'Workflow safety gates and idempotent execution history.' },
  { name: 'billing', width: 1600, height: 1000, format: 'PNG', maxBytes: 5_000_000, description: 'Plan, usage, trial, and measurable ROI information.' },
]

export function shopifyAppConfigFromEnv(env: Readonly<Record<string, string | undefined>>): ShopifyAppTomlConfig {
  const applicationUrl = required(env, 'SHOPIFY_APP_URL', 'APP_URL')
  const clientId = required(env, 'SHOPIFY_API_KEY')
  const callback = env.SHOPIFY_REDIRECT_URI?.trim() || `${applicationUrl.replace(/\/$/, '')}/shopify/callback`
  // Never empty and never partial: parseShopifyScopes merges SHOPIFY_SCOPES
  // with the required registry, so the generated TOML always declares the full
  // set of scopes the app actually calls.
  const scopes = parseShopifyScopes(env.SHOPIFY_SCOPES)
  return { clientId, name: env.SHOPIFY_APP_NAME?.trim() || 'ProfitPilot', applicationUrl, redirectUrls: [callback], scopes, apiVersion: env.SHOPIFY_API_VERSION?.trim() || '2025-10' }
}

export function renderShopifyAppToml(config: ShopifyAppTomlConfig): string {
  const redirects = config.redirectUrls.map((url) => `  "${tomlEscape(url)}"`).join(',\n')
  return `client_id = "${tomlEscape(config.clientId)}"\nname = "${tomlEscape(config.name)}"\napplication_url = "${tomlEscape(config.applicationUrl)}"\nembedded = true\n\n[build]\nautomatically_update_urls_on_dev = true\n\n[auth]\nredirect_urls = [\n${redirects}\n]\n\n[access_scopes]\nscopes = "${tomlEscape(config.scopes.join(','))}"\n\n[webhooks]\napi_version = "${tomlEscape(config.apiVersion)}"\n\n[[webhooks.subscriptions]]\ncompliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]\nuri = "/shopify/webhooks"\n`
}

export function appListingMetadata(): Readonly<{ name: string; tagline: string; category: string; description: string; complianceLinks: readonly string[] }> {
  return {
    name: 'ProfitPilot',
    tagline: 'A review-first AI employee for Shopify operations.',
    category: 'Store management',
    description: 'ProfitPilot monitors authorized Shopify data, explains deterministic opportunities, requests merchant approval, executes approved workflows, and measures outcomes. It does not invent store numbers and it minimizes customer personal data before optional language-model explanations.',
    complianceLinks: ['/legal/privacy', '/legal/terms', '/legal/security', '/legal/cookies', '/legal/dpa'],
  }
}

function required(env: Readonly<Record<string, string | undefined>>, primary: string, fallback?: string): string {
  const value = env[primary]?.trim() || (fallback ? env[fallback]?.trim() : undefined)
  if (!value) throw new Error(`Missing required Shopify app environment variable ${primary}`)
  return value
}

function tomlEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}
