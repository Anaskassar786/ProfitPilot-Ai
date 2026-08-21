import { existsSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { Express, Request, RequestHandler, Response } from 'express'

const API_PATH_PREFIXES = [
  '/api',
  '/admin',
  '/ai',
  '/ai-command',
  '/ai-executive',
  '/analytics',
  '/automation',
  '/billing',
  '/campaigns',
  '/catalog',
  '/copilot',
  '/customers',
  '/exports',
  '/forecasting',
  '/health',
  '/insights',
  '/inventory',
  '/jarvis',
  '/legal',
  '/live',
  '/orders',
  // QA (2026-08-20): the PatternAI router registers BOTH /patternai and
  // /insights paths. Only /insights was listed here, so every POST to the
  // /patternai alias skipped express.json (body arrived unparsed →
  // "a JSON body is required" on investigations/generate) and, worse, skipped
  // the authentication/CSRF middleware chain. Adding the prefix restores
  // JSON parsing and the full security pipeline for the alias.
  '/patternai',
  '/public-api',
  '/ready',
  '/recommendations',
  '/reports',
  '/security',
  '/session',
  '/store-coach',
  '/settings',
  '/shopify',
  '/support',
  '/sync',
] as const

const WEB_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  'frame-ancestors https://admin.shopify.com https://*.myshopify.com',
  "form-action 'self'",
  "img-src 'self' data: https:",
  // Shopify App Bridge ships as the official CDN script (index.html). It must
  // be allowed or embedded session-token auth silently disappears.
  "script-src 'self' https://cdn.shopify.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: wss:",
  "object-src 'none'",
].join('; ')

/** Resolve apps/web/dist from both apps/api/src and apps/api/dist. */
export function defaultWebDistPath(): string {
  return fileURLToPath(new URL('../../web/dist/', import.meta.url))
}

/**
 * Serve the Vite build and its SPA routes from the API process.
 *
 * Returns false when index.html is absent so API-only development and tests can
 * still start before the web workspace has been built.
 */
export function mountWebApp(app: Express, distPath = defaultWebDistPath()): boolean {
  const absoluteDistPath = resolve(distPath)
  const indexPath = resolve(absoluteDistPath, 'index.html')
  if (!existsSync(indexPath)) return false

  app.use(express.static(absoluteDistPath, {
    cacheControl: false,
    fallthrough: true,
    index: 'index.html',
    redirect: false,
    setHeaders: (response, filePath) => setWebHeaders(response, filePath),
  }))
  app.use(spaFallback(indexPath))
  return true
}

function spaFallback(indexPath: string): RequestHandler {
  return (request, response, next): void => {
    if (!isWebNavigation(request)) {
      next()
      return
    }
    setWebHeaders(response, indexPath)
    response.sendFile(indexPath, { cacheControl: false }, (error) => {
      if (error) next(error)
    })
  }
}

export function isApiPath(requestPath: string): boolean {
  return API_PATH_PREFIXES.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`))
}

/**
 * Client-side routes inside the Automation module. They share their path
 * prefix with the JSON API (`/automation` is an API prefix), so the general
 * SPA fallback below refuses to serve them. Browser navigations — which
 * always request HTML — must still reach the app shell, otherwise a hard
 * refresh or deep link to /automation (or a workflow) shows "Cannot GET".
 */
const AUTOMATION_SPA_PATH_PATTERN =
  /^\/automation(?:\/(?:templates|approvals|runs\/[^/]+|workflows\/[^/]+(?:\/runs)?))?$/

export function isAutomationSpaNavigation(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (extname(request.path) !== '') return false
  const accept = request.header('accept') ?? ''
  if (!accept.includes('text/html')) return false
  return AUTOMATION_SPA_PATH_PATTERN.test(request.path)
}

/**
 * Serves the app shell for Automation deep links BEFORE the API routers run,
 * so the JSON endpoints keep answering API clients while the browser still
 * gets index.html for `/automation`, `/automation/templates`,
 * `/automation/workflows/:id`, and friends. Returns false when the web build
 * is absent (API-only development and tests).
 */
export function mountAutomationSpaFallback(app: Express, distPath = defaultWebDistPath()): boolean {
  const indexPath = resolve(resolve(distPath), 'index.html')
  if (!existsSync(indexPath)) return false
  app.use((request, response, next): void => {
    if (!isAutomationSpaNavigation(request)) {
      next()
      return
    }
    setWebHeaders(response, indexPath)
    response.sendFile(indexPath, { cacheControl: false }, (error) => {
      if (error) next(error)
    })
  })
  return true
}

function isWebNavigation(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (extname(request.path) !== '') return false
  return !isApiPath(request.path)
}

function setWebHeaders(response: Response, filePath: string): void {
  response.setHeader('Content-Security-Policy', WEB_CONTENT_SECURITY_POLICY)
  response.setHeader('Permissions-Policy', 'microphone=(self *), geolocation=(), payment=()')
  // X-Frame-Options cannot express Shopify's required allowlist. CSP
  // frame-ancestors above is the modern control used for embedded apps.
  response.removeHeader('X-Frame-Options')
  if (filePath.endsWith(`${sep}index.html`)) {
    response.setHeader('Cache-Control', 'no-cache')
  } else {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }
}
