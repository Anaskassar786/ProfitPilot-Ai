import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    headers: { 'Content-Security-Policy': "default-src 'self'; base-uri 'self'; frame-ancestors https://admin.shopify.com https://*.myshopify.com; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws:; object-src 'none'" },
    proxy: {
      // PatternAI deep links are client-side routes. Without this bypass the
      // broad '/ai' rule below would forward /ai-growth-command/patternai to
      // the API and the dev server would answer a page refresh with JSON.
      '^/ai-growth-command/patternai': { target: 'http://127.0.0.1:5173', bypass: () => '/index.html' },
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
      '/analytics': 'http://127.0.0.1:3000',
      '/catalog': 'http://127.0.0.1:3000',
      '/live': 'http://127.0.0.1:3000',
      '/ready': 'http://127.0.0.1:3000',
      '/ai': 'http://127.0.0.1:3000',
      '/ai-command': 'http://127.0.0.1:3000',
      '/ai-executive': 'http://127.0.0.1:3000',
      '/recommendations': 'http://127.0.0.1:3000',
      '/billing': 'http://127.0.0.1:3000',
      '/admin': 'http://127.0.0.1:3000',
      '/campaigns': 'http://127.0.0.1:3000',
      '/customers': 'http://127.0.0.1:3000',
      '/inventory': 'http://127.0.0.1:3000',
      '/exports': 'http://127.0.0.1:3000',
      '/support': 'http://127.0.0.1:3000',
      '/settings': 'http://127.0.0.1:3000',
      '/security': 'http://127.0.0.1:3000',
      '/session': 'http://127.0.0.1:3000',
      '/legal': 'http://127.0.0.1:3000',
      '/jarvis': 'http://127.0.0.1:3000',
      '/copilot': 'http://127.0.0.1:3000',
      '/forecasting': 'http://127.0.0.1:3000',
      '/reports': 'http://127.0.0.1:3000',
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
    headers: { 'Content-Security-Policy': "default-src 'self'; base-uri 'self'; frame-ancestors https://admin.shopify.com https://*.myshopify.com; form-action 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'" },
  },
})
