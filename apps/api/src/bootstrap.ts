import { AesGcmCipher } from '@profitpilot/crypto'
import { databaseConfigFromEnv, PostgresDatabase } from '@profitpilot/db'
import { PostgresTokenRecordStore, ShopifyInstallService, TokenVault, OAuthStateStore } from '@profitpilot/shopify'
import type { AccessTokenExchange } from '@profitpilot/shopify'
import type { ShopifyRouteDependencies } from './shopify-routes.js'

export type F1Bootstrap = Readonly<{ shopify: ShopifyRouteDependencies; database: PostgresDatabase }>

const REQUIRED_KEYS = ['DATABASE_URL', 'ENCRYPTION_KEY', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_REDIRECT_URI'] as const

type RequiredKey = (typeof REQUIRED_KEYS)[number]

export function createF1Bootstrap(env: Readonly<Record<string, string | undefined>>): F1Bootstrap | null {
  const present = REQUIRED_KEYS.filter((key) => Boolean(env[key]?.trim()))
  if (present.length === 0) return null
  if (present.length !== REQUIRED_KEYS.length) throw new Error(`F1 bootstrap requires: ${REQUIRED_KEYS.filter((key) => !env[key]?.trim()).join(', ')}`)

  const encryptionKey = requiredEnv(env, 'ENCRYPTION_KEY')
  const database = new PostgresDatabase(databaseConfigFromEnv(env))
  const tokenStore = new PostgresTokenRecordStore(database)
  const vault = new TokenVault(AesGcmCipher.fromHex(encryptionKey), tokenStore)
  const installer = new ShopifyInstallService({ apiKey: requiredEnv(env, 'SHOPIFY_API_KEY'), apiSecret: requiredEnv(env, 'SHOPIFY_API_SECRET'), scopes: parseScopes(env.SHOPIFY_SCOPES), redirectUri: requiredEnv(env, 'SHOPIFY_REDIRECT_URI') }, new OAuthStateStore(), vault)
  const exchange: AccessTokenExchange = async (shop, code) => exchangeCode(shop, code, requiredEnv(env, 'SHOPIFY_API_KEY'), requiredEnv(env, 'SHOPIFY_API_SECRET'))
  return { database, shopify: { installer, exchange } }
}

function requiredEnv(env: Readonly<Record<string, string | undefined>>, key: RequiredKey): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${key}`)
  return value
}

function parseScopes(value: string | undefined): readonly string[] {
  return (value ?? '').split(',').map((scope) => scope.trim()).filter((scope) => scope.length > 0)
}

async function exchangeCode(shop: string, code: string, apiKey: string, apiSecret: string): Promise<string> {
  const response = await fetch(`https://${shop}/admin/oauth/access_tokens`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }) })
  if (!response.ok) throw new Error(`Shopify OAuth token exchange failed with ${response.status}`)
  const payload: unknown = await response.json()
  if (!isRecord(payload) || typeof payload.access_token !== 'string' || payload.access_token.trim().length === 0) throw new Error('Shopify OAuth response did not contain an access token')
  return payload.access_token
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
