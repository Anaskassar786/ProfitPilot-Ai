/**
 * Production app-host validation. Listing metadata, legal pages, and webhook
 * URIs all derive from SHOPIFY_APP_URL / APP_URL — a placeholder or HTTP
 * value in production is a launch-blocking misconfiguration.
 */

const PLACEHOLDER_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'example.com',
  'www.example.com',
  'example.org',
  'example.net',
])

export function productionAppUrl(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env.SHOPIFY_APP_URL?.trim() || env.APP_URL?.trim() || ''
  if (!raw) {
    throw new Error('SHOPIFY_APP_URL (or APP_URL) must be set in production: listing metadata, legal pages, and webhook URIs depend on it')
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`SHOPIFY_APP_URL (or APP_URL) must be an absolute HTTPS URL in production (got: ${raw})`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`SHOPIFY_APP_URL (or APP_URL) must be HTTPS in production (got: ${parsed.protocol}//${parsed.host})`)
  }
  const host = parsed.hostname.toLowerCase()
  if (PLACEHOLDER_HOSTS.has(host) || host.endsWith('.example.com') || host === 'example' || host.endsWith('.example')) {
    throw new Error(`SHOPIFY_APP_URL (or APP_URL) must not use a localhost or placeholder host in production (got: ${host})`)
  }
  return raw
}

export function assertProductionAppUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return productionAppUrl(env)
}
