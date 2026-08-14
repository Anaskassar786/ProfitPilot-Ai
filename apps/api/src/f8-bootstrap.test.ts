import { describe, expect, it, vi } from 'vitest'
import type { DatabaseResult, QueryResultRow } from '@profitpilot/db'
import { PostgresDatabase } from '@profitpilot/db'
import { createF8Bootstrap } from './f8-bootstrap.js'

const env = {
  DATABASE_URL: 'postgres://localhost/profitpilot', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', SHOPIFY_API_KEY: 'shopify-key', SHOPIFY_API_SECRET: 'shopify-secret', SHOPIFY_REDIRECT_URI: 'https://app.example/shopify/callback', OPENROUTER_API_KEY_1: 'openrouter-key', ADMIN_KEY: 'admin-key', JWT_SECRET: 'jwt-secret-that-is-at-least-32-characters-long', JWT_ISSUER: 'profitpilot', CSRF_SECRET: 'csrf-secret-that-is-at-least-32-characters-long', LEGAL_ENTITY_NAME: 'Anash Ali', LEGAL_ENTITY_ADDRESS: 'Tanda Mallu Ramnagar Uttarakhand 244715', LEGAL_JURISDICTION: 'Uttarakhand India', SUPPORT_EMAIL: 'anasanasali1714@gmail.com',
} as const

describe('F8 bootstrap', () => {
  it('fails closed without F7 provider configuration', () => expect(createF8Bootstrap({})).toBeNull())
  it('wires Jarvis, Copilot, forecasting, and reports without pretending R2 exists', async () => {
    const bootstrap = createF8Bootstrap(env)
    expect(bootstrap?.f8.jarvis).toBeDefined()
    expect(bootstrap?.f8.copilot).toBeDefined()
    expect(bootstrap?.f8.forecasting).toBeDefined()
    expect(bootstrap?.f8.reports).toBeDefined()
    await bootstrap?.database.close()
  })

  it('executes the real F8 data/report composition when R2 and SQL adapters are configured', async () => {
    const query = vi.spyOn(PostgresDatabase.prototype, 'query')
    query.mockImplementation(async <Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> => ({ rows: [] as readonly Row[], rowCount: text.startsWith('INSERT INTO report_runs') ? 1 : 0 }))
    vi.stubGlobal('fetch', async () => new Response('', { status: 200 }))
    const bootstrap = createF8Bootstrap({ ...env, R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com', R2_BUCKET: 'reports', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' })
    const generated = await bootstrap?.f8.reports.service.generate({ storeId: 'store-1', frequency: 'WEEKLY', period: { start: '2024-05-01', end: '2024-05-07' }, email: false })
    expect(generated?.run.status).toBe('COMPLETED')
    await bootstrap?.database.close()
    query.mockRestore()
    vi.unstubAllGlobals()
  })
})
