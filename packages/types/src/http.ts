import type { RequestId } from './ids.js'

export type ApiMeta = Readonly<{
  requestId: RequestId
  timestamp: string
}>

export type ApiSuccess<Value> = Readonly<{
  ok: true
  data: Value
  meta: ApiMeta
}>

export type ApiFailure = Readonly<{
  ok: false
  error: Readonly<{
    code: string
    message: string
    details: Readonly<Record<string, string | number | boolean | null>>
  }>
  meta: ApiMeta
}>

export type ApiEnvelope<Value> = ApiSuccess<Value> | ApiFailure

export function success<Value>(data: Value, requestId: RequestId, timestamp = new Date().toISOString()): ApiSuccess<Value> {
  return { ok: true, data, meta: { requestId, timestamp } }
}

export function failure(error: ApiFailure['error'], requestId: RequestId, timestamp = new Date().toISOString()): ApiFailure {
  return { ok: false, error, meta: { requestId, timestamp } }
}
