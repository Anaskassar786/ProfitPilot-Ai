import { describe, expect, it, vi } from 'vitest'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
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
    const respond = async <Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> => {
      // Report generation now reserves the monthly `reports` quota through
      // billing_usage before composing the PDF; simulate a successful claim.
      if (text.startsWith('INSERT INTO billing_usage')) return { rows: [{ used: 1 } as unknown as Row], rowCount: 1 }
      if (text.startsWith('INSERT INTO report_runs')) return { rows: [] as readonly Row[], rowCount: 1 }
      return { rows: [] as readonly Row[], rowCount: 0 }
    }
    const query = vi.spyOn(PostgresDatabase.prototype, 'query')
    query.mockImplementation(respond)
    const withTransaction = vi.spyOn(PostgresDatabase.prototype, 'withTransaction')
    // Run tenant-scoped operations against the same in-memory `respond` query
    // double instead of opening a real connection, matching how the quota and
    // report repository exercise `withTenantContext`.
    withTransaction.mockImplementation(((operation: (client: SqlExecutor) => Promise<unknown>) => operation({ query: respond } as unknown as SqlExecutor)) as never)
    vi.stubGlobal('fetch', async () => new Response('', { status: 200 }))
    const bootstrap = createF8Bootstrap({ ...env, R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com', R2_BUCKET: 'reports', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' })
    const generated = await bootstrap?.f8.reports.service.generate({ storeId: 'store-1', frequency: 'WEEKLY', period: { start: '2024-05-01', end: '2024-05-07' }, email: false })
    expect(generated?.run.status).toBe('COMPLETED')
    await bootstrap?.database.close()
    query.mockRestore()
    withTransaction.mockRestore()
    vi.unstubAllGlobals()
  })
})
