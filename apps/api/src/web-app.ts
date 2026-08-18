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
  '/inventory',
  '/jarvis',
  '/legal',
  '/live',
  '/orders',
  '/ready',
  '/recommendations',
  '/reports',
  '/security',
  '/session',
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
  "script-src 'self'",
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

function isWebNavigation(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (extname(request.path) !== '') return false
  return !isApiPath(request.path)
}

function setWebHeaders(response: Response, filePath: string): void {
  response.setHeader('Content-Security-Policy', WEB_CONTENT_SECURITY_POLICY)
  // X-Frame-Options cannot express Shopify's required allowlist. CSP
  // frame-ancestors above is the modern control used for embedded apps.
  response.removeHeader('X-Frame-Options')
  if (filePath.endsWith(`${sep}index.html`)) {
    response.setHeader('Cache-Control', 'no-cache')
  } else {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }
}
