import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

function encode(value: Buffer): string {
  return value.toString('base64url')
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

export function parseEncryptionKey(hexKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new TypeError('ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters')
  }
  return Buffer.from(hexKey, 'hex')
}

export type Ciphertext = `${typeof VERSION}.${string}.${string}.${string}`

export class AesGcmCipher {
  private readonly key: Buffer

  public constructor(key: Buffer) {
    if (key.byteLength !== KEY_BYTES) {
      throw new TypeError('AES-256-GCM requires a 32-byte key')
    }
    this.key = Buffer.from(key)
  }

  public static fromHex(hexKey: string): AesGcmCipher {
    return new AesGcmCipher(parseEncryptionKey(hexKey))
  }

  public encrypt(plaintext: string, associatedData = ''): Ciphertext {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    if (associatedData.length > 0) {
      cipher.setAAD(Buffer.from(associatedData, 'utf8'))
    }
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return `${VERSION}.${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(ciphertext)}` as Ciphertext
  }

  public decrypt(payload: string, associatedData = ''): string {
    const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split('.')
    if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
      throw new Error('Invalid encrypted payload')
    }
    const iv = decode(encodedIv)
    const tag = decode(encodedTag)
    const ciphertext = decode(encodedCiphertext)
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
      throw new Error('Invalid encrypted payload dimensions')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    if (associatedData.length > 0) {
      decipher.setAAD(Buffer.from(associatedData, 'utf8'))
    }
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex')
}

export function safeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right) || left.length !== right.length || left.length % 2 !== 0) {
    return false
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}
