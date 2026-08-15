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
  const scopes = (env.SHOPIFY_SCOPES ?? 'read_products,read_orders,read_customers,read_inventory,read_locations,read_checkouts,read_price_rules').split(',').map((scope) => scope.trim()).filter((scope) => scope.length > 0)
  if (scopes.length === 0) throw new Error('SHOPIFY_SCOPES must contain at least one scope')
  return { clientId, name: env.SHOPIFY_APP_NAME?.trim() || 'ProfitPilot', applicationUrl, redirectUrls: [callback], scopes, apiVersion: env.SHOPIFY_API_VERSION?.trim() || '2025-10' }
}

export function renderShopifyAppToml(config: ShopifyAppTomlConfig): string {
  const redirects = config.redirectUrls.map((url) => `  "${tomlEscape(url)}"`).join(',\n')
  return `client_id = "${tomlEscape(config.clientId)}"\nname = "${tomlEscape(config.name)}"\napplication_url = "${tomlEscape(config.applicationUrl)}"\nembedded = true\n\n[build]\nautomatically_update_urls_on_dev = true\n\n[auth]\nredirect_urls = [\n${redirects}\n]\n\n[access_scopes]\nscopes = "${tomlEscape(config.scopes.join(','))}"\n\n[webhooks]\napi_version = "${tomlEscape(config.apiVersion)}"\n`
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
