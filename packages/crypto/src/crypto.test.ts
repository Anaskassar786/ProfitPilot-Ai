import { describe, expect, it } from 'vitest'
import { AesGcmCipher, hmacSha256Hex, parseEncryptionKey, safeEqualHex, sha256Hex } from './index.js'

const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

describe('AES-256-GCM secret box', () => {
  it('validates a 32-byte hex key', () => expect(parseEncryptionKey(key)).toHaveLength(32))
  it('rejects a short key', () => expect(() => parseEncryptionKey('abcd')).toThrow('32 bytes'))
  it('encrypts and decrypts plaintext', () => {
    const cipher = AesGcmCipher.fromHex(key)
    const payload = cipher.encrypt('shopify-access-token', 'store-1')
    expect(payload.startsWith('v1.')).toBe(true)
    expect(cipher.decrypt(payload, 'store-1')).toBe('shopify-access-token')
  })
  it('uses a fresh IV for every encryption', () => {
    const cipher = AesGcmCipher.fromHex(key)
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'))
  })
  it('rejects invalid associated data', () => {
    const cipher = AesGcmCipher.fromHex(key)
    const payload = cipher.encrypt('secret', 'one')
    expect(() => cipher.decrypt(payload, 'two')).toThrow()
  })
  it('rejects tampered ciphertext', () => {
    const cipher = AesGcmCipher.fromHex(key)
    const payload = cipher.encrypt('secret')
    const parts = payload.split('.')
    const last = parts[3] ?? ''
    parts[3] = `${last.slice(0, -1)}x`
    expect(() => cipher.decrypt(parts.join('.'))).toThrow()
  })
  it('rejects malformed payloads', () => {
    expect(() => AesGcmCipher.fromHex(key).decrypt('nope')).toThrow('Invalid encrypted payload')
  })
  it('hashes deterministically', () => expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'))
  it('creates deterministic HMAC digests', () => expect(hmacSha256Hex('secret', 'hello')).toBe(hmacSha256Hex('secret', 'hello')))
  it('compares equal hex values safely', () => expect(safeEqualHex('aabb', 'AABB')).toBe(true))
  it('rejects unequal or malformed hex values', () => {
    expect(safeEqualHex('aabb', 'aabc')).toBe(false)
    expect(safeEqualHex('odd', 'odd')).toBe(false)
    expect(safeEqualHex('aa', 'a')).toBe(false)
  })
})
