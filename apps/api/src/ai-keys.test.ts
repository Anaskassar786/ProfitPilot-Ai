import { describe, expect, it } from 'vitest'
import { cleanSecret, envLookup, isMissingRelationError, maskSecret, resolveApiKeys, shouldRunMigrations } from './ai-keys.js'

describe('Store Coach / AI Executive API key resolution', () => {
  it('reads STORE_COACH_API_KEY as the preferred name', () => {
    const resolved = resolveApiKeys({ STORE_COACH_API_KEY: 'sk-or-v1-coach', OPENROUTER_API_KEY_1: 'sk-or-v1-generic' })
    expect(resolved.source).toBe('STORE_COACH_API_KEY')
    expect(resolved.keys[0]).toBe('sk-or-v1-coach')
  })

  it('falls back to OPENROUTER_API_KEY / OPENROUTER_API_KEY_1 when STORE_COACH_API_KEY is missing', () => {
    expect(resolveApiKeys({ OPENROUTER_API_KEY: 'sk-or-v1-generic' }).source).toBe('OPENROUTER_API_KEY')
    expect(resolveApiKeys({ OPENROUTER_API_KEY_1: 'sk-or-v1-one' }).keys).toEqual(['sk-or-v1-one'])
  })

  it('strips wrapping quotes, BOM, Bearer prefix, and placeholder values', () => {
    expect(cleanSecret('"sk-or-v1-quoted"')).toBe('sk-or-v1-quoted')
    expect(cleanSecret("  'sk-or-v1-single'  ")).toBe('sk-or-v1-single')
    expect(cleanSecret('Bearer sk-or-v1-bearer')).toBe('sk-or-v1-bearer')
    expect(cleanSecret('\uFEFFsk-or-v1-bom')).toBe('sk-or-v1-bom')
    expect(cleanSecret('replace')).toBeNull()
    expect(cleanSecret('   ')).toBeNull()
  })

  it('looks up env names case-insensitively', () => {
    expect(envLookup({ store_coach_api_key: 'sk-or-v1-lower' }, 'STORE_COACH_API_KEY')).toBe('sk-or-v1-lower')
    const resolved = resolveApiKeys({ Store_Coach_Api_Key: 'sk-or-v1-mixed' })
    expect(resolved.source).toBe('STORE_COACH_API_KEY')
    expect(resolved.keys).toEqual(['sk-or-v1-mixed'])
  })

  it('masks secrets for boot logs', () => {
    expect(maskSecret('sk-or-v1-ba10a514790bba18')).toContain('…')
    expect(maskSecret('sk-or-v1-ba10a514790bba18')).not.toContain('ba10a514')
    expect(maskSecret(null)).toBe('absent')
  })
})

describe('startup migration policy', () => {
  it('runs pending migrations in production unless explicitly disabled', () => {
    expect(shouldRunMigrations({ NODE_ENV: 'production' })).toBe(true)
    expect(shouldRunMigrations({ NODE_ENV: 'production', RUN_MIGRATIONS: 'false' })).toBe(false)
    expect(shouldRunMigrations({ NODE_ENV: 'development' })).toBe(false)
    expect(shouldRunMigrations({ NODE_ENV: 'development', RUN_MIGRATIONS: 'true' })).toBe(true)
  })
})

describe('missing-relation detection', () => {
  it('recognizes Postgres 42P01 errors', () => {
    expect(isMissingRelationError({ code: '42P01', message: 'relation "ai_executive_reports" does not exist' })).toBe(true)
    expect(isMissingRelationError(new Error('relation "ai_executive_preferences" does not exist'))).toBe(true)
    expect(isMissingRelationError(new Error('syntax error'))).toBe(false)
  })
})
