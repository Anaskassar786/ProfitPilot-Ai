export type Brand<Value, Name extends string> = Value & { readonly __brand: Name }

export type StoreId = Brand<string, 'StoreId'>
export type UserId = Brand<string, 'UserId'>
export type JobId = Brand<string, 'JobId'>
export type RequestId = Brand<string, 'RequestId'>

function assertId(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} cannot be empty`)
  }
}

export function storeId(value: string): StoreId {
  assertId(value, 'storeId')
  return value as StoreId
}

export function userId(value: string): UserId {
  assertId(value, 'userId')
  return value as UserId
}

export function jobId(value: string): JobId {
  assertId(value, 'jobId')
  return value as JobId
}

export function requestId(value: string): RequestId {
  assertId(value, 'requestId')
  return value as RequestId
}

export function isStoreId(value: string): value is StoreId {
  return value.trim().length > 0
}
