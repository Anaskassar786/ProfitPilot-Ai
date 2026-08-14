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
