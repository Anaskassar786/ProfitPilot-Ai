import type { AgentStatus, AnalyticsSnapshot, BillingAccount, BillingPlan, CatalogProduct, Recommendation, RoiMetrics, SectionId, UsageMeter } from './model.js'

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

export function fetchAgentStatuses(fetcher: Fetcher = fetch): Promise<readonly AgentStatus[]> {
  return requestJson<readonly AgentStatus[]>('/ai/agents', {}, fetcher)
}

export function fetchRecommendations(storeId: string, fetcher: Fetcher = fetch): Promise<readonly Recommendation[]> {
  return requestJson<readonly Recommendation[]>(`/recommendations?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export type WorkflowRecord = Readonly<{ id: string; storeId: string; version: number; nodes: readonly Readonly<Record<string, unknown>>[]; status?: string; definitionHash?: string }>
export type CampaignTemplateRecord = Readonly<{ id: string; name: string; kind: 'EMAIL' | 'SMS'; subject: string; body: string; variables: readonly string[] }>
export type TicketRecord = Readonly<{ id: string; shopId: string; subject: string; priority: string; status: string; version: number; createdAt: number; updatedAt: number }>

export function decideRecommendation(storeId: string, id: string, expectedVersion: number, decision: 'approve' | 'reject', fetcher: Fetcher = fetch): Promise<Recommendation> {
  return requestJson<Recommendation>(`/recommendations/${encodeURIComponent(id)}/${decision}?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion }) }, fetcher)
}

export function fetchWorkflows(storeId: string, fetcher: Fetcher = fetch): Promise<readonly WorkflowRecord[]> { return requestJson<readonly WorkflowRecord[]>(`/automation/workflows?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function createWorkflow(workflow: Readonly<Record<string, unknown>>, fetcher: Fetcher = fetch): Promise<WorkflowRecord> { return requestJson<WorkflowRecord>('/automation/workflows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(workflow) }, fetcher) }
export function activateWorkflow(id: string, fetcher: Fetcher = fetch): Promise<WorkflowRecord> { return requestJson<WorkflowRecord>(`/automation/workflows/${encodeURIComponent(id)}/activate`, { method: 'POST' }, fetcher) }
export function fetchCampaignTemplates(fetcher: Fetcher = fetch): Promise<readonly CampaignTemplateRecord[]> { return requestJson<readonly CampaignTemplateRecord[]>('/campaigns/templates', {}, fetcher) }
export function createCampaignTemplate(template: Readonly<Record<string, unknown>>, fetcher: Fetcher = fetch): Promise<CampaignTemplateRecord> { return requestJson<CampaignTemplateRecord>('/campaigns/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(template) }, fetcher) }
export function exportRows(format: 'CSV' | 'XLSX' | 'PDF', rows: readonly Readonly<Record<string, string | number | boolean | null>>[], fetcher: Fetcher = fetch): Promise<Readonly<{ filename: string; contentType: string; bodyBase64: string; rows: number }>> { return requestJson(`/exports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format, rows }) }, fetcher) }
export function fetchTickets(storeId: string, fetcher: Fetcher = fetch): Promise<readonly TicketRecord[]> { return requestJson<readonly TicketRecord[]>(`/support/tickets?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function createTicket(shopId: string, subject: string, plan: 'start' | 'growth' | 'commander', fetcher: Fetcher = fetch): Promise<TicketRecord> { return requestJson<TicketRecord>('/support/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopId, subject, plan }) }, fetcher) }
export function saveMerchantEmail(shopId: string, email: string, fromName: string, fetcher: Fetcher = fetch): Promise<Readonly<{ config: Readonly<Record<string, unknown>>; verificationToken: string }>> { return requestJson(`/settings/merchant-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopId, email, fromName }) }, fetcher) }
export function verifyMerchantEmail(token: string, fetcher: Fetcher = fetch): Promise<Readonly<Record<string, unknown>>> { return requestJson('/settings/merchant-email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }, fetcher) }

export function fetchBillingPlans(fetcher: Fetcher = fetch): Promise<readonly BillingPlan[]> { return requestJson<readonly BillingPlan[]>('/billing/plans', {}, fetcher) }
export function fetchBilling(storeId: string, fetcher: Fetcher = fetch): Promise<BillingAccount> { return requestJson<BillingAccount>(`/billing?shopId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchBillingUsage(storeId: string, fetcher: Fetcher = fetch): Promise<readonly UsageMeter[]> { return requestJson<readonly UsageMeter[]>(`/billing/usage?shopId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchBillingRoi(storeId: string, fetcher: Fetcher = fetch): Promise<RoiMetrics> { return requestJson<RoiMetrics>(`/billing/roi?shopId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function redeemGiftCode(storeId: string, code: string, fetcher: Fetcher = fetch): Promise<Readonly<{ code: string; expiresAt: number }>> { return requestJson(`/billing/gift?shopId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }, fetcher) }
export function createBillingCharge(storeId: string, plan: BillingPlan['code'], interval: 'MONTHLY' | 'ANNUAL', returnUrl: string, fetcher: Fetcher = fetch): Promise<Readonly<{ confirmationUrl: string | null }>> { return requestJson(`/billing/charge?shopId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan, interval, returnUrl }) }, fetcher) }

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
