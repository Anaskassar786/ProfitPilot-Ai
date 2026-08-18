import { describe, expect, it } from 'vitest'
import { missingNames, normalizeEnvironment, requireStartupEnvironment, StartupConfigurationError, validateStartupEnvironment } from './f9-config.js'

describe('F9 startup environment normalization', () => {
  it('maps both Cloudflare R2 naming conventions', () => {
    const normalized = normalizeEnvironment({ CLOUDFLARE_R2_ENDPOINT: 'https://r2', CLOUDFLARE_R2_BUCKET_NAME: 'bucket', CLOUDFLARE_R2_ACCESS_KEY_ID: 'key', CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret' })
    expect(normalized.R2_ENDPOINT).toBe('https://r2')
    expect(normalized.R2_BUCKET).toBe('bucket')
    expect(normalized.R2_ACCESS_KEY_ID).toBe('key')
    expect(normalized.R2_SECRET_ACCESS_KEY).toBe('secret')
  })
  it('accepts OPENROUTER_API_KEY as the primary-key fallback', () => {
    expect(normalizeEnvironment({ OPENROUTER_API_KEY: 'generic-key' }).OPENROUTER_API_KEY_1).toBe('generic-key')
    expect(normalizeEnvironment({ OPENROUTER_API_KEY_1: 'numbered', OPENROUTER_API_KEY: 'generic' }).OPENROUTER_API_KEY_1).toBe('numbered')
  })
  it('aliases shared OpenRouter keys onto STORE_COACH_API_KEY', () => {
    expect(normalizeEnvironment({ OPENROUTER_API_KEY_1: 'shared-key' }).STORE_COACH_API_KEY).toBe('shared-key')
    expect(normalizeEnvironment({ STORE_COACH_API_KEY: 'coach-key', OPENROUTER_API_KEY_1: 'shared-key' }).STORE_COACH_API_KEY).toBe('coach-key')
  })
  it('prefers canonical values and reports grouped production gaps', () => {
    const normalized = normalizeEnvironment({ R2_ENDPOINT: 'canonical', CLOUDFLARE_R2_ENDPOINT: 'alias' })
    expect(normalized.R2_ENDPOINT).toBe('canonical')
    const validation = validateStartupEnvironment({}, true)
    expect(validation.ok).toBe(false)
    expect(missingNames(validation)).toContain('database:DATABASE_URL')
    expect(() => requireStartupEnvironment({ NODE_ENV: 'production' })).toThrow(StartupConfigurationError)
    expect(validateStartupEnvironment({}, false).ok).toBe(true)
  })
})
