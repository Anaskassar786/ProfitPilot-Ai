import { sha256Hex } from '@profitpilot/crypto'
import { AppError } from '@profitpilot/types'
import type { RawStoreContext, StoreSnapshot } from './domain.js'

export function buildStoreContext(raw: RawStoreContext): StoreSnapshot {
  const customers = raw.customers.map(({ email: _email, name: _name, phone: _phone, ...safe }) => ({ ...safe, customerKey: safe.customerKey || sha256Hex(`${raw.storeId}:${safe.firstOrderDay}:${safe.lifetimeValue}`) }))
  const snapshot: StoreSnapshot = { ...raw, customers }
  assertAiSafeSnapshot(snapshot)
  return Object.freeze(snapshot)
}

export function serializeAiContext(snapshot: StoreSnapshot): string {
  assertAiSafeSnapshot(snapshot)
  const serialized = JSON.stringify(snapshot)
  if (/(email|phone|address|full_?name|first_?name|last_?name)/i.test(serialized)) throw new AppError('VALIDATION_ERROR', 'PII key detected in AI context', 400)
  return serialized
}

export function assertAiSafeSnapshot(snapshot: StoreSnapshot): void {
  const candidate = snapshot as unknown as Readonly<Record<string, unknown>>
  if (Object.keys(candidate).some((key) => /(email|phone|address|name)/i.test(key))) throw new AppError('VALIDATION_ERROR', 'PII key detected in AI snapshot', 400)
  if (snapshot.customers.some((customer) => !customer.customerKey.trim())) throw new AppError('VALIDATION_ERROR', 'AI customer keys must be opaque', 400)
}
