import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => {
  const local = loadEnv(mode, webRoot, '')
  const root = loadEnv(mode, repoRoot, '')
  const shopifyApiKey = (local.VITE_SHOPIFY_API_KEY || local.SHOPIFY_API_KEY || root.VITE_SHOPIFY_API_KEY || root.SHOPIFY_API_KEY || '').trim()

  /**
   * Dev proxy for prefixes that are simultaneously a client page route and a
   * JSON API (e.g. /billing). Browser navigations (GET, Accept: text/html, no
   * file extension, exact page path) are bypassed to the SPA shell; every
   * API call — which never accepts HTML — proxies through to the API.
   */
  const pageProxy = (pagePath: string) => ({
    target: 'http://127.0.0.1:3000',
    bypass: (req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined> }) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return undefined
      const path = (req.url ?? '').split('?')[0]?.replace(/\/+$/, '') || '/'
      if (/\.\w+$/.test(path)) return undefined
      const accept = req.headers.accept
      const acceptHeader = Array.isArray(accept) ? accept.join(',') : accept ?? ''
      if (!acceptHeader.includes('text/html')) return undefined
      return path === pagePath ? '/index.html' : undefined
    },
  })

  return {
    plugins: [
      react(),
      {
        name: 'html-shopify-api-key',
        transformIndexHtml(html: string) {
          return html.replaceAll('%VITE_SHOPIFY_API_KEY%', shopifyApiKey)
        },
      },
    ],
    define: {
      'import.meta.env.VITE_SHOPIFY_API_KEY': JSON.stringify(shopifyApiKey),
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      allowedHosts: true,
      // frame-ancestors is dev-only (production CSP ships from the API in
      // web-app.ts). The *.e2b.app entry lets the Arena preview iframe embed
      // the dev server; Shopify domains keep parity with production.
      headers: {
        'Content-Security-Policy': "default-src 'self'; base-uri 'self'; frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.e2b.app; img-src 'self' data:; script-src 'self' 'unsafe-inline' https://cdn.shopify.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws:; object-src 'none'",
        'Permissions-Policy': 'microphone=(self *), geolocation=(), payment=()',
      },
      proxy: {
        '/api': 'http://127.0.0.1:3000',
        // Every /ai-growth-command/* path (Store Coach, PatternAI, GrowthIQ) is
        // a client-side route. Without this bypass the broad '/ai' rule below
        // forwards them to the API, so refreshing or deep-linking to
        // /ai-growth-command/coach answers a page navigation with JSON (404).
        // This supersedes the narrower '^/ai-growth-command/patternai' rule it
        // replaces: PatternAI deep links are covered by the same bypass.
        // Browser navigations (Accept: text/html) get the SPA shell; genuine
        // API calls never accept HTML and still reach the API target.
        '^/ai-growth-command': {
          target: 'http://127.0.0.1:3000',
          bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
        },
        // Automation deep links are client-side routes. The broad '/automation'
        // rule below would otherwise forward /automation and
        // /automation/templates to the API and a page refresh would answer
        // with JSON (or "Cannot GET /automation"). Browser navigations (which
        // always request text/html) get the SPA shell; API calls — which never
        // accept HTML — fall through to the API target exactly as before.
        '^/automation/(templates|approvals)$': {
          target: 'http://127.0.0.1:3000',
          bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
        },
        '^/automation/workflows/[^/]+(/runs)?$': {
          target: 'http://127.0.0.1:3000',
          bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
        },
        '^/automation/runs/[^/]+$': {
          target: 'http://127.0.0.1:3000',
          bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
        },
        '/automation': {
          target: 'http://127.0.0.1:3000',
          bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
        },
        '/sync': 'http://127.0.0.1:3000',
        // These prefixes are BOTH page routes and JSON APIs (e.g. /orders is
        // the Orders page AND GET /orders?storeId=…). pageProxy bypasses to
        // the SPA shell only for real browser navigations to the exact page
        // path (GET + Accept: text/html, no extension); every API call keeps
        // proxying to the API. /orders was previously missing entirely, so
        // the Orders page could not load data in dev.
        ...Object.fromEntries(
          ['/orders', '/customers', '/inventory', '/analytics', '/recommendations', '/billing', '/exports', '/support', '/settings', '/reports', '/ai-command'].map(
            (page) => [page, pageProxy(page)],
          ),
        ),
        '/catalog': 'http://127.0.0.1:3000',
        '/live': 'http://127.0.0.1:3000',
        '/ready': 'http://127.0.0.1:3000',
        '/ai': 'http://127.0.0.1:3000',
        '/ai-executive': 'http://127.0.0.1:3000',
        '/admin': 'http://127.0.0.1:3000',
        '/campaigns': 'http://127.0.0.1:3000',
        '/security': 'http://127.0.0.1:3000',
        '/session': 'http://127.0.0.1:3000',
        '/legal': 'http://127.0.0.1:3000',
        '/jarvis': 'http://127.0.0.1:3000',
        '/copilot': 'http://127.0.0.1:3000',
        '/forecasting': 'http://127.0.0.1:3000',
        '/store-coach': 'http://127.0.0.1:3000',
        // PatternAI (formerly Insights Hub): both prefixes are proxied so the
        // dev server never answers module API calls with the SPA shell.
        '/patternai': 'http://127.0.0.1:3000',
        '/insights': 'http://127.0.0.1:3000',
        '/public-api': 'http://127.0.0.1:3000',
      },
    },
    build: { chunkSizeWarningLimit: 700 },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
      headers: {
        'Content-Security-Policy': "default-src 'self'; base-uri 'self'; frame-ancestors https://admin.shopify.com https://*.myshopify.com; form-action 'self'; img-src 'self' data:; script-src 'self' https://cdn.shopify.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'",
        'Permissions-Policy': 'microphone=(self *), geolocation=(), payment=()',
      },
    },
  }
})
