import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Logger, createMemorySink } from '@profitpilot/logger'
import { createApi } from './app.js'
import { LEGAL_SLUGS, LIABILITY_DISCLAIMER, legalBodyText, legalConfigFromEnv, legalDocument, legalDocuments, renderLegalHtml } from './legal.js'

const env = {
  LEGAL_ENTITY_NAME: 'Anash Ali',
  LEGAL_ENTITY_ADDRESS: 'Tanda Mallu Ramnagar Uttarakhand 244715',
  LEGAL_JURISDICTION: 'Uttarakhand India',
  SUPPORT_EMAIL: 'anasanasali1714@gmail.com',
} as const

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const memory = createMemorySink()
  const app = createApi({ logger: new Logger(memory.sink), readinessChecks: [], legal: { config: legalConfigFromEnv(env), now: () => new Date('2026-08-13T00:00:00.000Z') } })
  const server = createServer(app)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('F7 env-driven legal documents', () => {
  it('requires every legal environment value', () => {
    expect(() => legalConfigFromEnv({})).toThrow('LEGAL_ENTITY_NAME')
    expect(() => legalConfigFromEnv({ ...env, SUPPORT_EMAIL: 'invalid' })).toThrow('SUPPORT_EMAIL')
    expect(legalConfigFromEnv(env)).toEqual({ entityName: 'Anash Ali', entityAddress: 'Tanda Mallu Ramnagar Uttarakhand 244715', jurisdiction: 'Uttarakhand India', supportEmail: 'anasanasali1714@gmail.com' })
  })

  it('generates all five required documents from configuration', () => {
    const config = legalConfigFromEnv(env)
    const documents = legalDocuments(config, new Date('2026-08-13T00:00:00.000Z'))
    expect(documents.map((document) => document.slug)).toEqual([...LEGAL_SLUGS])
    expect(documents.every((document) => document.entityName === config.entityName && document.physicalAddress === config.entityAddress)).toBe(true)
    expect(legalBodyText(documents.find((document) => document.slug === 'terms') as NonNullable<typeof documents[number]>)).toContain(LIABILITY_DISCLAIMER)
  })

  it('includes GDPR, CCPA, CAN-SPAM, and TCPA controls', () => {
    const config = legalConfigFromEnv(env)
    const text = legalDocuments(config).map(legalBodyText).join('\n')
    expect(text).toContain('GDPR rights')
    expect(text).toContain('CCPA and CPRA rights')
    expect(text).toContain('physical address')
    expect(text).toContain('TCPA-compliant opt-in')
    expect(text).toContain('customer personal data')
  })

  it('escapes configuration before HTML rendering', () => {
    const document = legalDocument('security', { ...legalConfigFromEnv(env), entityName: '<Unsafe>', supportEmail: 'safe@example.com' }, new Date('2026-08-13T00:00:00.000Z'))
    const html = renderLegalHtml(document)
    expect(html).toContain('&lt;Unsafe&gt;')
    expect(html).not.toContain('<Unsafe>')
    expect(html).toContain('aria-label="Legal pages"')
  })
})

describe('F7 legal routes', () => {
  it('returns JSON documents by default and HTML for browsers', async () => await withServer(async (base) => {
    const json = await fetch(`${base}/legal/terms`)
    expect(json.status).toBe(200)
    expect((await json.json()).data.bodyText).toContain(LIABILITY_DISCLAIMER)
    const html = await fetch(`${base}/legal/privacy`, { headers: { accept: 'text/html' } })
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    expect(await html.text()).toContain('Anash Ali')
  }))

  it('lists legal pages and supports an explicit JSON format', async () => await withServer(async (base) => {
    const index = await fetch(`${base}/legal`, { headers: { accept: 'text/html' } })
    expect(await index.text()).toContain('/legal/dpa')
    const json = await fetch(`${base}/legal?format=json`)
    expect((await json.json()).data).toHaveLength(5)
  }))

  it('returns a typed not-found error for unknown legal pages', async () => await withServer(async (base) => {
    const response = await fetch(`${base}/legal/unknown`)
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  }))
})
