import type { AesGcmCipher, Ciphertext } from '@profitpilot/crypto'
import { parseShopDomain } from './oauth.js'

export type EncryptedTokenRecord = Readonly<{ shop: string; ciphertext: Ciphertext; createdAt: number; rotatedAt: number | null }>

export interface TokenRecordStore {
  get(shop: string): Promise<EncryptedTokenRecord | null>
  put(record: EncryptedTokenRecord): Promise<void>
  delete(shop: string): Promise<void>
}

export class InMemoryTokenRecordStore implements TokenRecordStore {
  private readonly records = new Map<string, EncryptedTokenRecord>()

  public async get(shop: string): Promise<EncryptedTokenRecord | null> {
    return this.records.get(parseShopDomain(shop)) ?? null
  }

  public async put(record: EncryptedTokenRecord): Promise<void> {
    this.records.set(parseShopDomain(record.shop), record)
  }

  public async delete(shop: string): Promise<void> {
    this.records.delete(parseShopDomain(shop))
  }
}

export class TokenVault {
  private readonly cipher: AesGcmCipher
  private readonly store: TokenRecordStore
  private readonly now: () => number

  public constructor(cipher: AesGcmCipher, store: TokenRecordStore, now: () => number = () => Date.now()) {
    this.cipher = cipher
    this.store = store
    this.now = now
  }

  public async put(shop: string, accessToken: string): Promise<EncryptedTokenRecord> {
    const normalizedShop = parseShopDomain(shop)
    if (!accessToken.trim()) throw new TypeError('Shopify access token cannot be empty')
    const previous = await this.store.get(normalizedShop)
    const record: EncryptedTokenRecord = {
      shop: normalizedShop,
      ciphertext: this.cipher.encrypt(accessToken, this.associatedData(normalizedShop)),
      createdAt: previous?.createdAt ?? this.now(),
      rotatedAt: previous ? this.now() : null,
    }
    await this.store.put(record)
    return record
  }

  public async get(shop: string): Promise<string | null> {
    const normalizedShop = parseShopDomain(shop)
    const record = await this.store.get(normalizedShop)
    return record ? this.cipher.decrypt(record.ciphertext, this.associatedData(normalizedShop)) : null
  }

  public async remove(shop: string): Promise<void> {
    await this.store.delete(parseShopDomain(shop))
  }

  private associatedData(shop: string): string {
    return `shopify-token:${shop}`
  }
}
