import { writeFile } from 'node:fs/promises'
import { PROFITPILOT_SHOPIFY_SCOPES, missingShopifyScopes, shopifyAppConfigFromEnv, renderShopifyAppToml } from '../apps/api/src/app-store-assets.ts'

const output = process.env.SHOPIFY_APP_TOML_OUT?.trim() || 'shopify.app.toml'
const config = shopifyAppConfigFromEnv(process.env)

// Fail loudly instead of shipping a partition of the required scopes: an app
// configuration missing write_price_rules installs fine and then 403s the first
// time the AI Command Center or Automation Engine runs a discount action.
const missing = missingShopifyScopes(config.scopes)
if (missing.length > 0) {
  process.stderr.write(`Refusing to generate ${output}: missing required Shopify scopes ${missing.join(', ')}\n`)
  process.exit(1)
}

await writeFile(output, renderShopifyAppToml(config), 'utf8')
process.stdout.write(`Generated ${output} for ${config.name}\n`)
process.stdout.write(`Access scopes (${config.scopes.length}): ${config.scopes.join(',')}\n`)
if (config.scopes.length > PROFITPILOT_SHOPIFY_SCOPES.length) {
  process.stdout.write(`Note: SHOPIFY_SCOPES added extra scopes beyond the ${PROFITPILOT_SHOPIFY_SCOPES.length} required by ProfitPilot.\n`)
}
