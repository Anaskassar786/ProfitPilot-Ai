/**
 * Single source of truth for the Shopify access scopes ProfitPilot requests.
 *
 * Every scope declaration in the repository (.env.example, the OAuth install
 * URL built in bootstrap.ts, the generated shopify.app.toml, and the checked-in
 * docs/app-store/shopify.app.toml.template) is derived from — or verified
 * against — this list, so a stale copy can no longer drift out of sync.
 *
 * Why each scope exists:
 * - read_products / read_orders / read_customers: core analytics + sync. The
 *   GraphQL Admin API connections the sync engine reads (products, orders with
 *   nested transactions, customers, abandonedCheckouts) are all authorized by
 *   these scopes.
 * - read_inventory / read_locations: inventory health and stockout features
 *   (the GraphQL inventoryItems / locations connections).
 * - read_discounts: reading discount listings via the GraphQL `discountNodes`
 *   connection. The legacy REST `/price_rules.json` endpoint and its
 *   `read_price_rules` scope were retired with the REST sync engine.
 * - write_discounts: REQUIRED to run discountCodeBasicCreate and
 *   discountCodeDeactivate from the AI Command Center and Automation Engine.
 *   These are GraphQL mutations — the legacy `write_price_rules` REST scope
 *   does not authorize them, so Shopify answers with 403 Access Denied.
 *
 * `read_checkouts` was dropped: Shopify deprecated and shut down the REST
 * Checkout API (and its `read_checkouts` scope) in 2025, so it no longer
 * authorizes anything ProfitPilot calls.
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
  'read_discounts',
  'write_discounts',
] as const

/** Comma-separated form used by SHOPIFY_SCOPES and the `access_scopes` TOML field. */
export const PROFITPILOT_SHOPIFY_SCOPES_CSV: string = PROFITPILOT_SHOPIFY_SCOPES.join(',')

/**
 * Normalize a comma-separated scope string into the effective scope list.
 *
 * The required registry is always included: an operator whose SHOPIFY_SCOPES
 * value predates a new capability (for example a deployment still requesting
 * only the base read scopes) would otherwise install the app without the
 * write_discounts scope and hit a 403 the first time a discount action runs.
 * Any extra scope supplied through the environment is preserved after the
 * required ones.
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
  privacyWebhookUrl: string
  /** Absolute App Store listing URLs (legal pages + support). */
  listing: AppStoreListingUrls
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
  const privacyWebhookUrl = env.SHOPIFY_PRIVACY_WEBHOOK_URL?.trim() || `${applicationUrl.replace(/\/$/, '')}/shopify/webhooks`
  return { clientId, name: env.SHOPIFY_APP_NAME?.trim() || 'ProfitPilot', applicationUrl, redirectUrls: [callback], scopes, apiVersion: env.SHOPIFY_API_VERSION?.trim() || '2025-10', privacyWebhookUrl, listing: listingUrlsFromEnv(env) }
}

export function renderShopifyAppToml(config: ShopifyAppTomlConfig): string {
  const redirects = config.redirectUrls.map((url) => `  "${tomlEscape(url)}"`).join(',\n')
  const privacyWebhookUrl = config.privacyWebhookUrl
  return `client_id = "${tomlEscape(config.clientId)}"\nname = "${tomlEscape(config.name)}"\napplication_url = "${tomlEscape(config.applicationUrl)}"\nembedded = true\n\n[build]\nautomatically_update_urls_on_dev = true\n\n[auth]\nredirect_urls = [\n${redirects}\n]\n\n[access_scopes]\nscopes = "${tomlEscape(config.scopes.join(','))}"\n\n[webhooks]\napi_version = "${tomlEscape(config.apiVersion)}"\n\n[webhooks.privacy]\ncustomer_data_request_url = "${tomlEscape(privacyWebhookUrl)}"\ncustomer_deletion_url = "${tomlEscape(privacyWebhookUrl)}"\nshop_deletion_url = "${tomlEscape(privacyWebhookUrl)}"\n\n[[webhooks.subscriptions]]\ntopics = ["app/uninstalled"]\nuri = "/shopify/webhooks"\n\n${renderAppListingUrls(config.listing)}`
}

/**
 * App Store listing URLs as commented assignments. The shopify.app.toml CLI
 * schema has no keys for listing metadata (those live in the Partner Dashboard
 * listing editor), so the values are emitted as comments the deployer pastes
 * verbatim — keeping the generator the single source of truth without breaking
 * `shopify app deploy` config validation.
 */
export function renderAppListingUrls(listing: AppStoreListingUrls): string {
  return [
    '# App Store listing URLs — paste into Partner Dashboard → App listing.',
    '# Shopify requires absolute https:// URLs (mailto: allowed for support).',
    `# privacy_policy_url = "${tomlEscape(listing.privacyPolicyUrl)}"`,
    `# terms_of_service_url = "${tomlEscape(listing.termsOfServiceUrl)}"`,
    `# security_url = "${tomlEscape(listing.securityUrl)}"`,
    `# cookie_policy_url = "${tomlEscape(listing.cookiePolicyUrl)}"`,
    `# data_processing_addendum_url = "${tomlEscape(listing.dataProcessingAgreementUrl)}"`,
    `# support_url = "${tomlEscape(listing.supportUrl)}"`,
    '',
  ].join('\n')
}

/** Absolute legal + support URLs required by the Shopify App Store listing. */
export type AppStoreListingUrls = Readonly<{
  privacyPolicyUrl: string
  termsOfServiceUrl: string
  securityUrl: string
  cookiePolicyUrl: string
  dataProcessingAgreementUrl: string
  supportUrl: string
}>

export type AppStoreListingMetadata = Readonly<{
  name: string
  tagline: string
  category: string
  description: string
} & AppStoreListingUrls>

/**
 * Builds the absolute listing URLs from the deployed app host
 * (`SHOPIFY_APP_URL`, falling back to `APP_URL`).
 *
 * App Store review requires every legal link to be an absolute `https://` URL;
 * relative paths such as `/legal/privacy` are rejected. The support URL may be
 * an `https://` page or a `mailto:` link when no help page exists.
 */
export function listingUrlsFromEnv(env: Readonly<Record<string, string | undefined>>): AppStoreListingUrls {
  const base = required(env, 'SHOPIFY_APP_URL', 'APP_URL').replace(/\/$/, '')
  return {
    privacyPolicyUrl: `${base}/legal/privacy`,
    termsOfServiceUrl: `${base}/legal/terms`,
    securityUrl: `${base}/legal/security`,
    cookiePolicyUrl: `${base}/legal/cookies`,
    dataProcessingAgreementUrl: `${base}/legal/dpa`,
    supportUrl: supportUrlFromEnv(env, base),
  }
}

/**
 * Support URL precedence: an explicit `SHOPIFY_SUPPORT_URL`/`SUPPORT_URL`
 * (absolute `https://` help page), then the configured `SUPPORT_EMAIL`
 * wrapped in a `mailto:` link, then the conventional `/help` path on the app
 * host.
 */
export function supportUrlFromEnv(env: Readonly<Record<string, string | undefined>>, base: string): string {
  const explicit = env.SHOPIFY_SUPPORT_URL?.trim() || env.SUPPORT_URL?.trim() || ''
  if (explicit) {
    if (!/^https:\/\//i.test(explicit) && !/^mailto:/i.test(explicit)) {
      throw new Error('SHOPIFY_SUPPORT_URL must be an absolute https:// URL or a mailto: link')
    }
    return explicit
  }
  const supportEmail = env.SUPPORT_EMAIL?.trim()
  if (supportEmail) return `mailto:${supportEmail}`
  return `${base}/help`
}

export function appListingMetadata(env: Readonly<Record<string, string | undefined>>): AppStoreListingMetadata {
  return {
    name: 'ProfitPilot',
    tagline: 'A review-first AI employee for Shopify operations.',
    category: 'Store management',
    description: 'ProfitPilot monitors authorized Shopify data, explains deterministic opportunities, requests merchant approval, executes approved workflows, and measures outcomes. It does not invent store numbers and it minimizes customer personal data before optional language-model explanations.',
    ...listingUrlsFromEnv(env),
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
