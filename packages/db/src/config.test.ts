import { describe, expect, it } from 'vitest'
import { databaseConfigFromEnv, normalizePostgresSslMode } from './config.js'

describe('normalizePostgresSslMode', () => {
  it('rewrites sslmode=require to verify-full', () => {
    expect(normalizePostgresSslMode('postgresql://u:p@host:5432/db?sslmode=require')).toEqual({
      connectionString: 'postgresql://u:p@host:5432/db?sslmode=verify-full',
      rewrittenFrom: 'require',
    })
  })
  it('rewrites sslmode=prefer and sslmode=verify-ca, whatever the case', () => {
    expect(normalizePostgresSslMode('postgresql://host/db?sslmode=prefer').rewrittenFrom).toBe('prefer')
    expect(normalizePostgresSslMode('postgresql://host/db?sslmode=VERIFY-CA').rewrittenFrom).toBe('verify-ca')
    expect(normalizePostgresSslMode('postgresql://host/db?sslmode=VERIFY-CA').connectionString).toBe('postgresql://host/db?sslmode=verify-full')
  })
  it('leaves verify-full, disable and no-verify untouched', () => {
    for (const mode of ['verify-full', 'disable', 'no-verify']) {
      const url = `postgresql://host/db?sslmode=${mode}`
      expect(normalizePostgresSslMode(url)).toEqual({ connectionString: url, rewrittenFrom: null })
    }
  })
  it('respects an explicit uselibpqcompat opt-in', () => {
    const url = 'postgresql://host/db?sslmode=require&uselibpqcompat=true'
    expect(normalizePostgresSslMode(url)).toEqual({ connectionString: url, rewrittenFrom: null })
  })
  it('preserves every other query parameter and rewrites only sslmode', () => {
    const normalized = normalizePostgresSslMode('postgresql://u:p@host:5432/db?sslmode=require&application_name=profitpilot&connect_timeout=10')
    expect(normalized.rewrittenFrom).toBe('require')
    const params = new URLSearchParams(normalized.connectionString.split('?')[1])
    expect(params.get('sslmode')).toBe('verify-full')
    expect(params.get('application_name')).toBe('profitpilot')
    expect(params.get('connect_timeout')).toBe('10')
  })
  it('leaves connection strings without a query string untouched', () => {
    const url = 'postgresql://u:p@host:5432/db'
    expect(normalizePostgresSslMode(url)).toEqual({ connectionString: url, rewrittenFrom: null })
  })
  it('never touches credentials in the base URL', () => {
    const url = 'postgresql://user:p%40ss%3Aword@host:5432/db?sslmode=require'
    expect(normalizePostgresSslMode(url).connectionString).toBe('postgresql://user:p%40ss%3Aword@host:5432/db?sslmode=verify-full')
  })
})

describe('databaseConfigFromEnv', () => {
  it('normalizes a production-style DATABASE_URL and reports the original mode', () => {
    const config = databaseConfigFromEnv({ DATABASE_URL: 'postgresql://u:p@host:5432/db?sslmode=require', NODE_ENV: 'production' })
    expect(config.connectionString).toBe('postgresql://u:p@host:5432/db?sslmode=verify-full')
    expect(config.sslModeRewrittenFrom).toBe('require')
    expect(config.ssl).toBe(true)
  })
  it('reports null when the URL already used verify-full', () => {
    const config = databaseConfigFromEnv({ DATABASE_URL: 'postgresql://u:p@host:5432/db?sslmode=verify-full' })
    expect(config.sslModeRewrittenFrom).toBeNull()
    expect(config.connectionString).toBe('postgresql://u:p@host:5432/db?sslmode=verify-full')
  })
  it('reports null when the URL carries no sslmode at all', () => {
    const config = databaseConfigFromEnv({ DATABASE_URL: 'postgres://localhost/db' })
    expect(config.sslModeRewrittenFrom).toBeNull()
  })
})
