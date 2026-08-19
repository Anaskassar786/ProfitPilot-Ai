import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Logger } from '@profitpilot/logger'
import { InMemoryTemplateRepository, InMemoryWorkflowRepository, MerchantEmailVerifier, ThreadLedger } from '@profitpilot/automation'
import { createApi } from './app.js'

/**
 * Automation deep links (/automation, /automation/templates, workflow pages…)
 * share their path prefix with the JSON API, so the general SPA fallback
 * skips them. These tests lock the contract that browser navigations — which
 * always request text/html — receive the app shell BEFORE the API routers,
 * while API clients keep receiving JSON.
 */

const SPA_HTML = '<!doctype html><html><body>PROFITPILOT SPA SHELL</body></html>'

describe('Automation SPA deep links', () => {
  const dist = mkdtempSync(join(tmpdir(), 'profitpilot-web-'))
  // index.html must exist before createApi mounts the early SPA fallback.
  writeFileSync(join(dist, 'index.html'), SPA_HTML)
  const server = createServer(
    createApi({
      logger: new Logger(),
      readinessChecks: [],
      webDistPath: dist,
      automation: {
        workflows: new InMemoryWorkflowRepository(),
        templates: new InMemoryTemplateRepository(),
        emailVerifier: new MerchantEmailVerifier('secret'),
        tickets: new ThreadLedger(),
      },
    }),
  )
  let base = ''

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No address')
    base = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const get = async (path: string, accept: string) =>
    fetch(`${base}${path}`, { headers: { accept } })

  it('serves the app shell for /automation when a browser navigates', async () => {
    const response = await get('/automation', 'text/html,application/xhtml+xml')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('PROFITPILOT SPA SHELL')
  })

  it('serves the app shell for every Automation SPA route', async () => {
    for (const path of ['/automation/templates', '/automation/approvals', '/automation/workflows/wf-123', '/automation/workflows/wf-123/runs', '/automation/runs/run-1']) {
      const response = await get(path, 'text/html')
      expect(response.status, path).toBe(200)
      expect((await response.text()), path).toContain('PROFITPILOT SPA SHELL')
    }
  })

  it('never hijacks JSON API calls to the same prefixes', async () => {
    const listed = await get('/automation/workflows?storeId=s', '*/*')
    expect(listed.status).toBe(200)
    expect(listed.headers.get('content-type')).toContain('application/json')
    const payload = (await listed.json()) as { ok: boolean }
    expect(payload.ok).toBe(true)

    const templates = await get('/automation/templates', 'application/json')
    expect(templates.status).toBe(400) // VALIDATION_ERROR: storeId required — the real API route answered
    expect((await templates.json() as { ok: boolean }).ok).toBe(false)

    const summary = await get('/automation/summary?storeId=s', '*/*')
    expect(summary.status).toBe(200)
    expect((await summary.json() as { ok: boolean }).ok).toBe(true)
  })

  it('still allows creating workflows through the API', async () => {
    const created = await fetch(`${base}/automation/workflows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storeId: 's', name: 'Deep link test', category: 'Operations' }),
    })
    expect(created.status).toBe(201)
  })

  it('ignores HTML requests with a file extension (static assets keep 404ing)', async () => {
    const asset = await get('/automation/static.js', 'text/html')
    expect(asset.status).not.toBe(200)
  })
})
