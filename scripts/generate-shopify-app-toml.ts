import { writeFile } from 'node:fs/promises'
import { shopifyAppConfigFromEnv, renderShopifyAppToml } from '../apps/api/src/app-store-assets.ts'

const output = process.env.SHOPIFY_APP_TOML_OUT?.trim() || 'shopify.app.toml'
const config = shopifyAppConfigFromEnv(process.env)
await writeFile(output, renderShopifyAppToml(config), 'utf8')
process.stdout.write(`Generated ${output} for ${config.name}\n`)
