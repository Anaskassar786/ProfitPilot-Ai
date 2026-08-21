import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemorySink, Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const webDistPath = mkdtempSync(join(tmpdir(), 'profitpilot-web-'))
  temporaryDirectories.push(webDistPath)
  mkdirSync(join(webDistPath, 'assets'))
  writeFileSync(join(webDistPath, 'index.html'), '<!doctype html><html><body><div id=\"root\">ProfitPilot web shell</div></body></html>')
  writeFileSync(join(webDistPath, 'assets', 'app.js'), 'console.log(\"ProfitPilot\")')
  writeFileSync(join(webDistPath, 'assets', 'app.css'), 'body { color: #123; }')
  writeFileSync(join(webDistPath, 'assets', 'logo.svg'), '<svg xmlns=\"http://www.w3.org/2000/svg\"/>')
  writeFileSync(join(webDistPath, 'jarvis-mic.html'), '<!doctype html><html><head><link rel=\"stylesheet\" href=\"/jarvis-mic.css\"/><script src=\"/jarvis-mic.js\" defer></script></head><body>Jarvis mic</body></html>')
  writeFileSync(join(webDistPath, 'jarvis-mic.js'), 'const CHANNEL=\"profitpilot:jarvis-voice\"; navigator.mediaDevices.getUserMedia; window.SpeechRecognition; window.opener.postMessage;')
  writeFileSync(join(webDistPath, 'jarvis-mic.css'), 'body{color:#e6f6ff}')

  const memory = createMemorySink()
  const app = createApi({
    logger: new Logger(memory.sink),
    readinessChecks: [],
    webDistPath,
    security: {
      environment: 'production',
      allowedOrigins: ['https://app.example'],
      requireAuthentication: true,
      csrfSecret: 'test-csrf-secret',
    },
  })
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try {
    return await handler(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

describe('API-hosted web app', () => {
  it('serves the root, SPA routes, and static assets while preserving API routes', async () => await withServer(async (base) => {
    const root = await fetch(`${base}/?shop=demo.myshopify.com&host=encoded&storeId=store-1`)
    expect(root.status).toBe(200)
    expect(root.headers.get('content-type')).toContain('text/html')
    expect(root.headers.get('cache-control')).toBe('no-cache')
    const webCsp = root.headers.get('content-security-policy') ?? ''
    expect(webCsp).toContain('frame-ancestors https://admin.shopify.com https://*.myshopify.com')
    expect(webCsp).toContain("script-src 'self' https://cdn.shopify.com")
    expect(webCsp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(webCsp).not.toContain('unsafe-eval')
    expect(webCsp).toContain("style-src 'self' 'unsafe-inline'")
    expect(webCsp).not.toContain('https://fonts.googleapis.com')
    expect(root.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains; preload')
    expect(root.headers.get('permissions-policy')).toContain('microphone=(self *)')
    expect(root.headers.get('x-frame-options')).toBeNull()
    expect(await root.text()).toContain('ProfitPilot web shell')

    const dashboard = await fetch(`${base}/dashboard?shop=demo.myshopify.com&storeId=store-1`)
    expect(dashboard.status).toBe(200)
    expect(dashboard.headers.get('content-type')).toContain('text/html')
    expect(await dashboard.text()).toContain('ProfitPilot web shell')

    for (const [asset, contentType, body] of [
      ['/assets/app.js', 'javascript', 'ProfitPilot'],
      ['/assets/app.css', 'text/css', 'color'],
      ['/assets/logo.svg', 'image/svg+xml', '<svg'],
    ] as const) {
      const response = await fetch(`${base}${asset}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain(contentType)
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains; preload')
      expect(await response.text()).toContain(body)
    }

    const live = await fetch(`${base}/live`)
    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({ ok: true, service: 'api', status: 'live' })
    expect(live.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(live.headers.get('x-frame-options')).toBe('DENY')

    expect((await fetch(`${base}/api/missing`)).status).toBe(404)
    for (const path of ['/orders?storeId=store-1', '/customers?storeId=store-1', '/inventory?storeId=store-1', '/inventory/locations?storeId=store-1']) {
      const apiResponse = await fetch(`${base}${path}`)
      expect(apiResponse.status).toBe(401)
      expect(apiResponse.headers.get('content-type')).toContain('application/json')
      expect(await apiResponse.text()).not.toContain('ProfitPilot web shell')
    }
    const campaignApi = await fetch(`${base}/campaigns/send`)
    expect(campaignApi.status).toBe(404)
    expect(await campaignApi.text()).not.toContain('ProfitPilot web shell')
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404)
  }))

  it('serves the CSP-safe Jarvis mic popup (real served page with external script)', async () => await withServer(async (base) => {
    const html = await fetch(`${base}/jarvis-mic.html`)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    expect(html.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(html.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const htmlBody = await html.text()
    expect(htmlBody).toContain('<script src="/jarvis-mic.js"')
    expect(htmlBody).not.toContain('document.write')

    const js = await fetch(`${base}/jarvis-mic.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(js.headers.get('content-security-policy')).toContain("script-src 'self'")
    const jsBody = await js.text()
    expect(jsBody).toContain('profitpilot:jarvis-voice')
    expect(jsBody).toContain('getUserMedia')
    expect(jsBody).toContain('SpeechRecognition')
    expect(jsBody).toContain('postMessage')

    const css = await fetch(`${base}/jarvis-mic.css`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
  }))
})
