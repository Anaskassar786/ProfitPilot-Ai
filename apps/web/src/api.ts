import type { AnalyticsSnapshot, CatalogProduct, SectionId } from './model.js'

export type SyncResult = Readonly<{ storeId: string; module: SectionId | string; pages: number; records: number; cursor: string | null; resumedFrom: string | null }>
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export class ApiClientError extends Error {
  public readonly status: number
  public readonly code: string

  public constructor(message: string, status: number, code = 'API_ERROR') {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
  }
}

export async function requestJson<Value>(path: string, init: RequestInit = {}, fetcher: Fetcher = fetch): Promise<Value> {
  let response: Response
  try {
    response = await fetcher(path, init)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Network request failed'
    throw new ApiClientError(message, 0, 'NETWORK_ERROR')
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    throw failureFromPayload(payload, response.status)
  }
  if (!isRecord(payload) || payload.ok !== true || !('data' in payload)) {
    throw new ApiClientError('API returned an invalid envelope', response.status, 'INVALID_ENVELOPE')
  }
  return payload.data as Value
}

export function fetchAnalytics(storeId: string, fetcher: Fetcher = fetch): Promise<AnalyticsSnapshot> {
  return requestJson<AnalyticsSnapshot>(`/analytics?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchCatalog(storeId: string, fetcher: Fetcher = fetch): Promise<readonly CatalogProduct[]> {
  return requestJson<readonly CatalogProduct[]>(`/catalog?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function requestSync(storeId: string, module: string, fetcher: Fetcher = fetch): Promise<SyncResult> {
  return requestJson<SyncResult>('/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, module }) }, fetcher)
}

function failureFromPayload(payload: unknown, status: number): ApiClientError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const message = typeof payload.error.message === 'string' ? payload.error.message : 'API request failed'
    const code = typeof payload.error.code === 'string' ? payload.error.code : 'API_ERROR'
    return new ApiClientError(message, status, code)
  }
  return new ApiClientError(status === 0 ? 'Network request failed' : `API request failed with ${status}`, status)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
