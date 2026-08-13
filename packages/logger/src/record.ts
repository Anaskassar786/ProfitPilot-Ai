export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogRecord = Readonly<{
  level: LogLevel
  message: string
  timestamp: string
  context: JsonObject
}>

export type LogSink = (record: LogRecord) => void

const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /(token|secret|password|authorization|api[_-]?key|credential|email|phone|address|customer)/i

function redact(value: JsonValue, key: string): JsonValue {
  if (SENSITIVE_KEY.test(key)) {
    return REDACTED
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, key))
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)] as const)
    return Object.fromEntries(entries)
  }
  return value
}

export function redactFields(fields: JsonObject): JsonObject {
  return redact(fields, '') as JsonObject
}

export function mergeFields(...fields: JsonObject[]): JsonObject {
  const merged: { [key: string]: JsonValue } = {}
  for (const fieldSet of fields) {
    Object.assign(merged, fieldSet)
  }
  return redactFields(merged)
}
