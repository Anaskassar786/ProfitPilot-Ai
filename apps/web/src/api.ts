import type { AgentStatus, AnalyticsSnapshot, BillingAccount, BillingPlan, CatalogProduct, Recommendation, RoiMetrics, SectionId, UsageMeter, WorkspaceContext } from './model.js'
import type { CopilotAnswer, CopilotThread, ForecastBundle, JarvisMessage, JarvisPreference, JarvisResponse, JarvisSession, ReportRun } from './f8-model.js'
import type { MaintenanceState, MerchantFlags, OpsMetrics, QueueSnapshot } from './f9-model.js'
import type { OrderInsightFeature, OrderInsightsResult, OrderQuery, OrdersPageResult, OrderView } from './orders-model.js'
import type { CustomerDetail, CustomerInsightFeature, CustomerInsightsResult, CustomerQuery, CustomersPageResult } from './customers-model.js'
import type { InventoryCoverage, InventoryItem, InventoryLocation, InventoryPageResult, InventoryQuery } from './inventory-model.js'
import type { InventoryHistoryResult, InventoryInsightFeature, InventoryInsightsResult } from './inventory-insights-model.js'
import type { AnalyticsInsights } from './analytics-model.js'
import type { AgentActivityItem, AgentOverview, CostBreakdownRow, CostSummaryView, RuleCatalogEntry, RunAllEvent, StoreHealthResult } from './command-center-model.js'
import { parseSseFrame } from './command-center-model.js'
import { safeDayKey } from './safe-date.js'

export type SyncResult = Readonly<{ storeId: string; module: SectionId | string; pages: number; records: number; cursor: string | null; resumedFrom: string | null }>
export type SyncAllModuleResult = Readonly<{ module: string; status: 'succeeded'; result: SyncResult }> | Readonly<{ module: string; status: 'failed'; error: Readonly<{ code: string; message: string }> }>
export type SyncAllResult = Readonly<{ storeId: string; modules: readonly SyncAllModuleResult[]; succeeded: readonly string[]; failed: readonly string[] }>
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
let csrfToken: string | null = null
let csrfInitialization: Promise<string> | null = null

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

export function requestJson<Value>(path: string, init: RequestInit = {}, fetcher: Fetcher = fetch): Promise<Value> {
  return requestJsonAttempt<Value>(path, init, fetcher, true)
}

async function requestJsonAttempt<Value>(path: string, init: RequestInit, fetcher: Fetcher, allowCsrfRetry: boolean): Promise<Value> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (UNSAFE_METHODS.has(method) && csrfToken) headers.set('x-csrf-token', csrfToken)
  let response: Response
  try {
    response = await fetcher(path, { ...init, headers })
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
    if (allowCsrfRetry && UNSAFE_METHODS.has(method) && isCsrfFailure(payload, response.status)) {
      csrfToken = null
      csrfInitialization = null
      await initializeCsrf(fetcher)
      return requestJsonAttempt<Value>(path, init, fetcher, false)
    }
    throw failureFromPayload(payload, response.status)
  }
  if (!isRecord(payload) || payload.ok !== true || !('data' in payload)) {
    throw new ApiClientError('API returned an invalid envelope', response.status, 'INVALID_ENVELOPE')
  }
  return payload.data as Value
}

export function fetchSessionContext(query = '', fetcher: Fetcher = fetch): Promise<WorkspaceContext> {
  return requestJson<WorkspaceContext>(`/session/context${query}`, {}, fetcher)
}

/**
 * Fetches the signed CSRF token from the API. The response also sets the
 * `profitpilot_csrf` cookie; unsafe requests then echo the token back via the
 * `x-csrf-token` header so the server's double-submit check passes. The token
 * is cached in-memory for the lifetime of the page.
 */
export async function fetchCsrfToken(fetcher: Fetcher = fetch): Promise<string> {
  const result = await requestJson<{ csrfToken: string }>('/security/csrf', {}, fetcher)
  csrfToken = result.csrfToken
  return result.csrfToken
}

/** Deduplicates page-start CSRF acquisition across App and Jarvis startup. */
export function initializeCsrf(fetcher: Fetcher = fetch): Promise<string> {
  if (csrfToken) return Promise.resolve(csrfToken)
  if (csrfInitialization) return csrfInitialization
  csrfInitialization = fetchCsrfToken(fetcher).catch((error: unknown) => {
    csrfInitialization = null
    throw error
  })
  return csrfInitialization
}

/** Clears module state between isolated browser-client tests. */
export function resetApiClientStateForTests(): void {
  csrfToken = null
  csrfInitialization = null
}

export function fetchAnalytics(storeId: string, fetcher: Fetcher = fetch): Promise<AnalyticsSnapshot> {
  return requestJson<AnalyticsSnapshot>(`/analytics?storeId=${encodeURIComponent(storeId)}`, {}, fetcher).then(normalizeAnalyticsSnapshot)
}

/**
 * Repair the analytics snapshot's date contract.
 *
 * `analytics_*_daily.day` are Postgres `date` columns. The `pg` driver parses
 * OID 1082 into a JS `Date`, so the API emits `"2026-08-14T00:00:00.000Z"`
 * while `RevenueMetric.day` and friends are typed (and consumed) as bare
 * `YYYY-MM-DD` keys. Consumers that appended a time part to that value built
 * `Invalid Date` and threw `RangeError: Invalid time value`.
 *
 * Normalising once, here at the boundary, means every page — Analytics,
 * Dashboard, Products — receives the day-key shape its types promise.
 * Rows with unusable dates are dropped rather than propagated as `NaN`.
 */
export function normalizeAnalyticsSnapshot(snapshot: AnalyticsSnapshot | null | undefined): AnalyticsSnapshot {
  const empty: AnalyticsSnapshot = { revenue: [], orders: [], productSales: [], customerCohorts: [] }
  if (!snapshot || typeof snapshot !== 'object') return empty
  const rows = <T,>(value: unknown): readonly T[] => (Array.isArray(value) ? (value as readonly T[]) : [])
  const byDay = <T extends { day: string }>(value: unknown): readonly T[] => {
    const result: T[] = []
    for (const row of rows<T>(value)) { const day = safeDayKey(row?.day); if (day) result.push({ ...row, day }) }
    return result
  }
  const cohorts: AnalyticsSnapshot['customerCohorts'][number][] = []
  for (const row of rows<AnalyticsSnapshot['customerCohorts'][number]>(snapshot.customerCohorts)) {
    const cohortDay = safeDayKey(row?.cohortDay)
    const activityDay = safeDayKey(row?.activityDay)
    if (cohortDay && activityDay) cohorts.push({ ...row, cohortDay, activityDay })
  }
  return {
    revenue: byDay<AnalyticsSnapshot['revenue'][number]>(snapshot.revenue),
    orders: byDay<AnalyticsSnapshot['orders'][number]>(snapshot.orders),
    productSales: byDay<AnalyticsSnapshot['productSales'][number]>(snapshot.productSales),
    customerCohorts: cohorts,
  }
}
export function fetchAnalyticsInsights(storeId: string, fetcher: Fetcher = fetch): Promise<AnalyticsInsights> { return requestJson<AnalyticsInsights>(`/analytics/insights?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchAnalyticsChannels(storeId: string, fetcher: Fetcher = fetch): Promise<NonNullable<AnalyticsInsights['channels']>> { return requestJson(`/analytics/channels?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchAnalyticsGeography(storeId: string, fetcher: Fetcher = fetch): Promise<NonNullable<AnalyticsInsights['geography']>> { return requestJson(`/analytics/geography?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchAnalyticsCohorts(storeId: string, fetcher: Fetcher = fetch): Promise<NonNullable<AnalyticsInsights['cohorts']>> { return requestJson(`/analytics/cohorts?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchAnalyticsComparisons(storeId: string, fetcher: Fetcher = fetch): Promise<NonNullable<AnalyticsInsights['comparisons']>> { return requestJson(`/analytics/comparisons?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchAnalyticsFunnel(storeId: string, fetcher: Fetcher = fetch): Promise<NonNullable<AnalyticsInsights['funnel']>> { return requestJson(`/analytics/funnel?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function queryAnalyticsInsights(storeId: string, question: string, fetcher: Fetcher = fetch): Promise<Readonly<{ text: string; model: string }>> { return requestJson('/analytics/insights/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, question }) }, fetcher) }

export function fetchCatalog(storeId: string, fetcher: Fetcher = fetch): Promise<readonly CatalogProduct[]> {
  return requestJson<readonly CatalogProduct[]>(`/catalog?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchOrders(storeId: string, query: OrderQuery = {}, fetcher: Fetcher = fetch): Promise<OrdersPageResult> {
  const parameters = new URLSearchParams({ storeId })
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') parameters.set(key, String(value))
  return requestJson<OrdersPageResult>(`/orders?${parameters.toString()}`, {}, fetcher)
}

export function fetchOrder(storeId: string, orderId: string, fetcher: Fetcher = fetch): Promise<OrderView> {
  return requestJson<OrderView>(`/orders/${encodeURIComponent(orderId)}?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchOrderInsights(storeId: string, options: Readonly<{ feature?: OrderInsightFeature; question?: string }> = {}, fetcher: Fetcher = fetch): Promise<OrderInsightsResult> {
  const parameters = new URLSearchParams({ storeId })
  if (options.feature) parameters.set('feature', options.feature)
  if (options.question?.trim()) parameters.set('question', options.question.trim())
  return requestJson<OrderInsightsResult>(`/orders/insights?${parameters.toString()}`, {}, fetcher)
}

export function fetchCustomers(storeId: string, query: CustomerQuery = {}, fetcher: Fetcher = fetch): Promise<CustomersPageResult> {
  const parameters = new URLSearchParams({ storeId })
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') parameters.set(key, String(value))
  return requestJson<CustomersPageResult>(`/customers?${parameters.toString()}`, {}, fetcher)
}

export function fetchCustomer(storeId: string, customerId: string, fetcher: Fetcher = fetch): Promise<CustomerDetail> {
  return requestJson<CustomerDetail>(`/customers/${encodeURIComponent(customerId)}?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchCustomerInsights(storeId: string, feature?: CustomerInsightFeature, fetcher: Fetcher = fetch): Promise<CustomerInsightsResult> {
  const parameters = new URLSearchParams({ storeId })
  if (feature) parameters.set('feature', feature)
  return requestJson<CustomerInsightsResult>(`/customers/insights?${parameters.toString()}`, {}, fetcher)
}

export function queryCustomerInsights(storeId: string, question: string, fetcher: Fetcher = fetch): Promise<CustomerInsightsResult> {
  return requestJson<CustomerInsightsResult>('/customers/insights/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, question }) }, fetcher)
}

export type InventoryLocationsResult = Readonly<{ locations: readonly (InventoryLocation & { itemCount: number; totalUnits: number })[]; multiLocation: boolean; coverage: InventoryCoverage }>

export function fetchInventory(storeId: string, query: InventoryQuery = {}, fetcher: Fetcher = fetch): Promise<InventoryPageResult> {
  const parameters = new URLSearchParams({ storeId })
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') parameters.set(key, String(value))
  return requestJson<InventoryPageResult>(`/inventory?${parameters.toString()}`, {}, fetcher)
}

export function fetchInventoryItem(storeId: string, variantId: string, fetcher: Fetcher = fetch): Promise<InventoryItem> {
  return requestJson<InventoryItem>(`/inventory/${encodeURIComponent(variantId)}?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchInventoryLocations(storeId: string, fetcher: Fetcher = fetch): Promise<InventoryLocationsResult> {
  return requestJson<InventoryLocationsResult>(`/inventory/locations?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchInventoryInsights(storeId: string, feature?: InventoryInsightFeature, fetcher: Fetcher = fetch): Promise<InventoryInsightsResult> {
  const parameters = new URLSearchParams({ storeId })
  if (feature) parameters.set('feature', feature)
  return requestJson<InventoryInsightsResult>(`/inventory/insights?${parameters.toString()}`, {}, fetcher)
}

export function queryInventoryInsights(storeId: string, question: string, fetcher: Fetcher = fetch): Promise<InventoryInsightsResult> {
  return requestJson<InventoryInsightsResult>('/inventory/insights/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, question }) }, fetcher)
}

export function fetchInventoryHistory(storeId: string, days: number, fetcher: Fetcher = fetch): Promise<InventoryHistoryResult> {
  return requestJson<InventoryHistoryResult>(`/inventory/history?storeId=${encodeURIComponent(storeId)}&days=${encodeURIComponent(String(days))}`, {}, fetcher)
}

/** Records a manual reorder decision. ProfitPilot never places the order itself. */
export function submitReorderDecision(storeId: string, productId: string, decision: 'approved' | 'dismissed', fetcher: Fetcher = fetch): Promise<Readonly<{ productId: string; decision: string; recordedAt: string; execution: string }>> {
  return requestJson('/inventory/reorder-decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, productId, decision }) }, fetcher)
}

export function requestSync(storeId: string, module: string, fetcher: Fetcher = fetch, idToken: string | null = embeddedSessionToken()): Promise<SyncResult> {
  const headers = new Headers({ 'content-type': 'application/json' })
  // Keep the short-lived Shopify id_token out of the JSON body. The API uses
  // it only if a stored offline token is missing or Shopify rejects it with
  // 401, then performs one token-exchange retry.
  if (idToken) headers.set('x-shopify-session-token', idToken)
  return requestJson<SyncResult>('/sync', { method: 'POST', headers, body: JSON.stringify({ storeId, module }) }, fetcher)
}

export function requestSyncAll(storeId: string, fetcher: Fetcher = fetch, idToken: string | null = embeddedSessionToken()): Promise<SyncAllResult> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (idToken) headers.set('x-shopify-session-token', idToken)
  return requestJson<SyncAllResult>('/sync/all', { method: 'POST', headers, body: JSON.stringify({ storeId }) }, fetcher)
}

export type SyncStatus = Readonly<{
  storeId: string
  shopDomain: string | null
  registered: boolean
  hasAccessToken: boolean | null
  circuit: Readonly<{ open: boolean; failures: number; retryAfterMs: number | null; cooldownMs: number }> | null
  canSync: boolean
}>

export function fetchSyncStatus(storeId: string, fetcher: Fetcher = fetch): Promise<SyncStatus> {
  return requestJson<SyncStatus>(`/sync/status?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

/** Closes a Shopify circuit breaker that opened for this store. */
export function resetSyncCircuit(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ storeId: string }>> {
  return requestJson(`/sync/circuit/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) }, fetcher)
}

export function fetchAgentStatuses(fetcher: Fetcher = fetch): Promise<readonly AgentStatus[]> {
  return requestJson<readonly AgentStatus[]>('/ai/agents', {}, fetcher)
}

/* ── AI Command Center (PR45) ─────────────────────────────────────────── */

export function fetchAgentOverview(storeId: string, fetcher: Fetcher = fetch): Promise<AgentOverview> {
  return requestJson<AgentOverview>(`/ai/agents?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchAiCost(storeId: string, fetcher: Fetcher = fetch): Promise<CostSummaryView> {
  return requestJson<CostSummaryView>(`/ai/cost?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchAiCostBreakdown(storeId: string, fetcher: Fetcher = fetch): Promise<readonly CostBreakdownRow[]> {
  return requestJson<readonly CostBreakdownRow[]>(`/ai/cost/breakdown?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchStoreHealth(storeId: string, fetcher: Fetcher = fetch): Promise<StoreHealthResult> {
  return requestJson<StoreHealthResult>(`/ai/health?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchRuleCatalog(fetcher: Fetcher = fetch): Promise<readonly RuleCatalogEntry[]> {
  return requestJson<readonly RuleCatalogEntry[]>('/ai/rules', {}, fetcher)
}

export function fetchAgentActivity(storeId: string, agentId: string, fetcher: Fetcher = fetch): Promise<readonly AgentActivityItem[]> {
  return requestJson<readonly AgentActivityItem[]>(`/ai/agents/${encodeURIComponent(agentId)}/activity?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function setAgentPaused(storeId: string, agentId: string, paused: boolean, fetcher: Fetcher = fetch): Promise<Readonly<{ agent: string; paused: boolean }>> {
  return requestJson(`/ai/agents/${encodeURIComponent(agentId)}?storeId=${encodeURIComponent(storeId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused }) }, fetcher)
}

export function runAgent(storeId: string, agentId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ recommendations: readonly Recommendation[]; deduplicated: number; cacheHits: number }>> {
  return requestJson(`/ai/agents/${encodeURIComponent(agentId)}/run?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, fetcher)
}

/**
 * Runs every unlocked agent and streams progress over SSE frames.
 * The callback receives parsed events; the promise resolves when the stream ends.
 */
export async function runAllAgents(storeId: string, onEvent: (event: RunAllEvent) => void, fetcher: Fetcher = fetch): Promise<void> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (!csrfToken) await initializeCsrf(fetcher)
  if (csrfToken) headers.set('x-csrf-token', csrfToken)
  const response = await fetcher(`/ai/run-all?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers, body: '{}' })
  if (!response.ok || !response.body) {
    let payload: unknown = null
    try { payload = await response.json() } catch { payload = null }
    throw failureFromPayload(payload, response.status)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    buffer += decoder.decode(step.value, { stream: true })
    let boundary: number
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = parseSseFrame(frame)
      if (event) onEvent(event)
    }
  }
}


/**
 * PR #46: the list endpoint returns a page envelope. This wrapper keeps the
 * older array-shaped call sites (passive Jarvis card) working.
 */
export function fetchRecommendations(storeId: string, fetcher: Fetcher = fetch): Promise<readonly Recommendation[]> {
  return fetchRecommendationPage(storeId, {}, fetcher).then((page) => page.items as unknown as readonly Recommendation[])
}

export function fetchRecommendationPage(storeId: string, filters: import('./recommendations-model.js').RecommendationListFilters = {}, fetcher: Fetcher = fetch): Promise<import('./recommendations-model.js').RecommendationPage> {
  const params = new URLSearchParams({ storeId })
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && String(value).length > 0) params.set(key, String(value))
  }
  return requestJson(`/recommendations?${params.toString()}`, {}, fetcher)
}

export function fetchRecommendationSummary(storeId: string, fetcher: Fetcher = fetch): Promise<import('./recommendations-model.js').RecommendationSummary> {
  return requestJson(`/recommendations/summary?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function fetchRecommendation(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<import('./recommendations-model.js').RecommendationView> {
  return requestJson(`/recommendations/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function verifyRecommendationEvidence(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<import('./recommendations-model.js').EvidenceVerification> {
  return requestJson(`/recommendations/${encodeURIComponent(id)}/evidence/verify?storeId=${encodeURIComponent(storeId)}`, {}, fetcher)
}

export function undoRecommendationDecision(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<import('./recommendations-model.js').RecommendationView> {
  return requestJson(`/recommendations/${encodeURIComponent(id)}/undo?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, fetcher)
}

export function snoozeRecommendation(storeId: string, id: string, hours: number, fetcher: Fetcher = fetch): Promise<import('./recommendations-model.js').RecommendationView> {
  return requestJson(`/recommendations/${encodeURIComponent(id)}/snooze?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hours }) }, fetcher)
}

export function executeRecommendation(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<Readonly<{ recommendation: import('./recommendations-model.js').RecommendationView; execution: Readonly<Record<string, unknown>> }>> {
  return requestJson(`/recommendations/${encodeURIComponent(id)}/execute?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, fetcher)
}

export function bulkDecideRecommendations(storeId: string, decisions: readonly Readonly<{ id: string; expectedVersion: number; decision: 'approve' | 'reject'; reason?: string }>[], fetcher: Fetcher = fetch): Promise<import('./recommendations-model.js').BulkDecisionResult> {
  return requestJson(`/recommendations/bulk-decide?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, decisions }) }, fetcher)
}

export function decideRecommendationWithReason(storeId: string, id: string, expectedVersion: number, decision: 'approve' | 'reject', reason: string | null, fetcher: Fetcher = fetch): Promise<import('./recommendations-model.js').RecommendationView> {
  const body: Record<string, unknown> = { expectedVersion }
  if (decision === 'reject' && reason) body.reason = reason
  return requestJson(`/recommendations/${encodeURIComponent(id)}/${decision}?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, fetcher)
}

export type WorkflowRecord = Readonly<{ id: string; storeId: string; version: number; nodes: readonly Readonly<Record<string, unknown>>[]; status?: string; definitionHash?: string }>
export type CampaignTemplateRecord = Readonly<{ id: string; storeId: string; name: string; kind: 'EMAIL' | 'SMS'; subject: string; body: string; variables: readonly string[] }>
export type TargetedCampaignPreview = Readonly<{ templateId: string; templateName: string; subject: string; html: string; customerId: string; variables: readonly string[]; sender: Readonly<{ fromName: string; email: string }> }>
export type TargetedCampaignResult = Readonly<{ status: 'sent' | 'suppressed' | 'failed'; jobId: string; campaignId: string; customerId: string; templateId: string; providerMessageId: string | null; idempotent: boolean; reason: string | null }>
export type TicketRecord = Readonly<{ id: string; shopId: string; subject: string; description?: string; priority: string; status: string; version: number; createdAt: number; updatedAt: number }>

export function decideRecommendation(storeId: string, id: string, expectedVersion: number, decision: 'approve' | 'reject', fetcher: Fetcher = fetch): Promise<Recommendation> {
  return requestJson<Recommendation>(`/recommendations/${encodeURIComponent(id)}/${decision}?storeId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion }) }, fetcher)
}

export function fetchWorkflows(storeId: string, fetcher: Fetcher = fetch): Promise<readonly WorkflowRecord[]> { return requestJson<readonly WorkflowRecord[]>(`/automation/workflows?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function createWorkflow(workflow: Readonly<Record<string, unknown>>, fetcher: Fetcher = fetch): Promise<WorkflowRecord> { return requestJson<WorkflowRecord>('/automation/workflows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(workflow) }, fetcher) }
export function activateWorkflow(id: string, fetcher: Fetcher = fetch): Promise<WorkflowRecord> { return requestJson<WorkflowRecord>(`/automation/workflows/${encodeURIComponent(id)}/activate`, { method: 'POST' }, fetcher) }
export function fetchCampaignTemplates(storeId: string, fetcher: Fetcher = fetch): Promise<readonly CampaignTemplateRecord[]> { return requestJson<readonly CampaignTemplateRecord[]>(`/campaigns/templates?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function createCampaignTemplate(template: Readonly<Record<string, unknown>>, fetcher: Fetcher = fetch): Promise<CampaignTemplateRecord> { return requestJson<CampaignTemplateRecord>('/campaigns/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(template) }, fetcher) }
export function previewTargetedCampaign(storeId: string, customerId: string, templateId: string, idempotencyKey: string, fetcher: Fetcher = fetch): Promise<TargetedCampaignPreview> { return requestJson<TargetedCampaignPreview>('/campaigns/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, customerId, templateId, idempotencyKey }) }, fetcher) }
export function sendTargetedCampaign(storeId: string, customerId: string, templateId: string, idempotencyKey: string, fetcher: Fetcher = fetch): Promise<TargetedCampaignResult> { return requestJson<TargetedCampaignResult>('/campaigns/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, customerId, templateId, idempotencyKey, reviewed: true }) }, fetcher) }
export function exportRows(format: 'CSV' | 'XLSX' | 'PDF', rows: readonly Readonly<Record<string, string | number | boolean | null>>[], fetcher: Fetcher = fetch, extras: Readonly<{ storeId?: string; dataset?: 'orders' | 'catalog' | 'audit' | 'revenue' }> = {}): Promise<Readonly<{ filename: string; contentType: string; bodyBase64: string; rows: number; ceiling?: number; ceilingNote?: string }>> { return requestJson(`/exports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format, rows, ...extras }) }, fetcher) }
export function fetchTickets(storeId: string, fetcher: Fetcher = fetch): Promise<readonly TicketRecord[]> { return requestJson<readonly TicketRecord[]>(`/support/tickets?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function createTicket(shopId: string, subject: string, plan: 'start' | 'growth' | 'commander', fetcher: Fetcher = fetch, extras: Readonly<{ description?: string; priority?: string }> = {}): Promise<TicketRecord> { return requestJson<TicketRecord>('/support/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopId, subject, plan, ...extras }) }, fetcher) }
export function analyzeRecommendations(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ recommendations: readonly Recommendation[] }>> { return requestJson(`/recommendations/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) }, fetcher) }
export function saveMerchantEmail(shopId: string, email: string, fromName: string, fetcher: Fetcher = fetch): Promise<Readonly<{ config: Readonly<Record<string, unknown>>; verificationToken: string }>> { return requestJson(`/settings/merchant-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopId, email, fromName }) }, fetcher) }
export function verifyMerchantEmail(token: string, fetcher: Fetcher = fetch): Promise<Readonly<Record<string, unknown>>> { return requestJson('/settings/merchant-email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }, fetcher) }

export function fetchBillingPlans(fetcher: Fetcher = fetch): Promise<readonly BillingPlan[]> { return requestJson<readonly BillingPlan[]>('/billing/plans', {}, fetcher) }
export function fetchBilling(storeId: string, fetcher: Fetcher = fetch): Promise<BillingAccount> { return requestJson<BillingAccount>(`/billing?shopId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchBillingUsage(storeId: string, fetcher: Fetcher = fetch): Promise<readonly UsageMeter[]> { return requestJson<readonly UsageMeter[]>(`/billing/usage?shopId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchBillingRoi(storeId: string, fetcher: Fetcher = fetch): Promise<RoiMetrics> { return requestJson<RoiMetrics>(`/billing/roi?shopId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function redeemGiftCode(storeId: string, code: string, fetcher: Fetcher = fetch): Promise<Readonly<{ code: string; expiresAt: number }>> { return requestJson(`/billing/gift?shopId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }, fetcher) }
export function createBillingCharge(storeId: string, plan: BillingPlan['code'], interval: 'MONTHLY' | 'ANNUAL', returnUrl: string, fetcher: Fetcher = fetch): Promise<Readonly<{ confirmationUrl: string | null }>> { return requestJson(`/billing/charge?shopId=${encodeURIComponent(storeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan, interval, returnUrl }) }, fetcher) }

export function fetchJarvisPreferences(storeId: string, fetcher: Fetcher = fetch): Promise<JarvisPreference> { return requestJson<JarvisPreference>(`/jarvis/preferences?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function saveJarvisPreferences(preferences: Readonly<Partial<JarvisPreference> & { storeId: string }>, fetcher: Fetcher = fetch): Promise<JarvisPreference> { return requestJson<JarvisPreference>('/jarvis/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(preferences) }, fetcher) }
export async function startJarvisSession(storeId: string, page: string, plan: JarvisSession['plan'] = 'trial', fetcher: Fetcher = fetch): Promise<JarvisSession> {
  await initializeCsrf(fetcher)
  return requestJson<JarvisSession>('/jarvis/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, page, plan }) }, fetcher)
}
export function fetchJarvisBriefing(storeId: string, page: string, plan: JarvisSession['plan'] = 'trial', fetcher: Fetcher = fetch): Promise<JarvisResponse> { return requestJson<JarvisResponse>(`/jarvis/briefing?storeId=${encodeURIComponent(storeId)}&page=${encodeURIComponent(page)}&plan=${encodeURIComponent(plan)}`, {}, fetcher) }
export function fetchJarvisSession(storeId: string, sessionId: string, fetcher: Fetcher = fetch): Promise<JarvisSession> { return requestJson<JarvisSession>(`/jarvis/sessions/${encodeURIComponent(sessionId)}?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchJarvisMessages(storeId: string, sessionId: string, fetcher: Fetcher = fetch): Promise<readonly JarvisMessage[]> { return requestJson<readonly JarvisMessage[]>(`/jarvis/sessions/${encodeURIComponent(sessionId)}/messages?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function sendJarvisMessage(storeId: string, sessionId: string, text: string, page: string, voice = false, fetcher: Fetcher = fetch): Promise<JarvisResponse> { return requestJson<JarvisResponse>(`/jarvis/sessions/${encodeURIComponent(sessionId)}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, text, page, voice }) }, fetcher) }

/**
 * Streams a Jarvis answer over server-sent events. `onDelta` receives the
 * FULL accumulated answer text on every chunk, so the caller can render it
 * directly. Resolves with the final validated response once the stream
 * completes. Throws when the stream cannot be established or breaks — the
 * caller should then fall back to sendJarvisMessage.
 */
export async function streamJarvisMessage(storeId: string, sessionId: string, text: string, page: string, onDelta: (fullText: string) => void, fetcher: Fetcher = fetch): Promise<JarvisResponse> {
  const response = await fetcher(`/jarvis/sessions/${encodeURIComponent(sessionId)}/message`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ storeId, text, page, stream: true }) })
  if (!response.ok || !response.body) throw new ApiClientError('Jarvis streaming unavailable', response.status)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    buffer += decoder.decode(step.value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        let payload: unknown = null
        try { payload = JSON.parse(line.slice(6)) } catch { continue }
        if (!isRecord(payload)) continue
        if (typeof payload.text === 'string') onDelta(payload.text)
        if (isRecord(payload.response)) return payload.response as unknown as JarvisResponse
        if (isRecord(payload.error)) throw new ApiClientError(typeof payload.error.message === 'string' ? payload.error.message : 'Jarvis stream failed', response.status)
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
  throw new ApiClientError('Jarvis stream ended without a response', response.status)
}
export function confirmJarvisAction(storeId: string, sessionId: string, actionId: string, fetcher: Fetcher = fetch): Promise<JarvisResponse> { return requestJson<JarvisResponse>(`/jarvis/sessions/${encodeURIComponent(sessionId)}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, actionId }) }, fetcher) }
/**
 * Invokes a plan-gated Jarvis store action (read on all plans, write actions
 * are Commander-only and require confirmation). The backend re-checks the plan
 * before running anything; `confirmed` marks an explicit merchant approval.
 */
export function invokeJarvisStoreAction(storeId: string, sessionId: string, actionId: string, parameters: Readonly<Record<string, string | number | boolean | null>>, confirmed: boolean, fetcher: Fetcher = fetch): Promise<JarvisResponse> { return requestJson<JarvisResponse>(`/jarvis/sessions/${encodeURIComponent(sessionId)}/store-action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, actionId, parameters, confirmed }) }, fetcher) }
export function setJarvisState(storeId: string, sessionId: string, state: 'pause' | 'resume' | 'end', fetcher: Fetcher = fetch): Promise<JarvisSession> { return requestJson<JarvisSession>(`/jarvis/sessions/${encodeURIComponent(sessionId)}/${state}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) }, fetcher) }

export function fetchCopilotThreads(storeId: string, fetcher: Fetcher = fetch): Promise<readonly CopilotThread[]> { return requestJson<readonly CopilotThread[]>(`/copilot/threads?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function createCopilotThread(storeId: string, title: string, fetcher: Fetcher = fetch): Promise<CopilotThread> { return requestJson<CopilotThread>('/copilot/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, title }) }, fetcher) }
export function fetchCopilotMessages(storeId: string, threadId: string, fetcher: Fetcher = fetch): Promise<readonly CopilotAnswer[]> { return requestJson<readonly CopilotAnswer[]>(`/copilot/threads/${encodeURIComponent(threadId)}/messages?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export async function askCopilot(storeId: string, query: string, page: string, threadId?: string, fetcher: Fetcher = fetch): Promise<CopilotAnswer> {
  await initializeCsrf(fetcher)
  return requestJson<CopilotAnswer>('/copilot/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, query, page, ...(threadId ? { threadId } : {}) }) }, fetcher)
}
export function exportCopilotThread(storeId: string, threadId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ filename: string; contentType: string; bodyBase64: string; rows: number }>> { return requestJson(`/copilot/threads/${encodeURIComponent(threadId)}/export?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchForecast(storeId: string, fetcher: Fetcher = fetch): Promise<ForecastBundle> { return requestJson<ForecastBundle>(`/forecasting?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function fetchReports(storeId: string, fetcher: Fetcher = fetch): Promise<readonly ReportRun[]> { return requestJson<readonly ReportRun[]>(`/reports?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }
export function generateReport(storeId: string, frequency: ReportRun['frequency'], start: string, end: string, email: boolean, fetcher: Fetcher = fetch): Promise<Readonly<{ run: ReportRun; file: Readonly<{ filename: string; contentType: string; bodyBase64: string }> | null }>> { return requestJson(`/reports/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, frequency, start, end, email }) }, fetcher) }
export function downloadReport(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<Readonly<{ filename: string; contentType: string; bodyBase64: string; bytes: number }>> { return requestJson(`/reports/${encodeURIComponent(id)}/download?storeId=${encodeURIComponent(storeId)}`, {}, fetcher) }

export function adminStepUp(key: string, fetcher: Fetcher = fetch): Promise<Readonly<{ stepUpToken: string; expiresInMinutes: number }>> { return requestJson('/admin/step-up', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }, fetcher) }
export function fetchMaintenance(stepUpToken: string, fetcher: Fetcher = fetch): Promise<MaintenanceState> { return requestJson('/admin/maintenance', { headers: { 'x-admin-step-up': stepUpToken } }, fetcher) }
export function setMaintenance(stepUpToken: string, state: Readonly<{ enabled: boolean; message: string; expectedVersion: number }>, fetcher: Fetcher = fetch): Promise<MaintenanceState> { return requestJson('/admin/maintenance', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-step-up': stepUpToken }, body: JSON.stringify(state) }, fetcher) }
export function fetchMerchantFlags(stepUpToken: string, storeId: string, fetcher: Fetcher = fetch): Promise<MerchantFlags> { return requestJson(`/admin/merchant-flags?storeId=${encodeURIComponent(storeId)}`, { headers: { 'x-admin-step-up': stepUpToken } }, fetcher) }
export function setMerchantFlags(stepUpToken: string, flags: MerchantFlags, fetcher: Fetcher = fetch): Promise<MerchantFlags> { return requestJson('/admin/merchant-flags', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-step-up': stepUpToken }, body: JSON.stringify(flags) }, fetcher) }
export function fetchOpsQueue(stepUpToken: string, fetcher: Fetcher = fetch): Promise<QueueSnapshot> { return requestJson('/admin/ops/queue', { headers: { 'x-admin-step-up': stepUpToken } }, fetcher) }
export function fetchOpsMetrics(stepUpToken: string, fetcher: Fetcher = fetch): Promise<OpsMetrics> { return requestJson('/admin/ops/metrics', { headers: { 'x-admin-step-up': stepUpToken } }, fetcher) }
export function retryOpsJob(stepUpToken: string, jobId: string, fetcher: Fetcher = fetch): Promise<Readonly<Record<string, unknown>>> { return requestJson(`/admin/ops/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST', headers: { 'x-admin-step-up': stepUpToken } }, fetcher) }

function embeddedSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('id_token')?.trim()
  return value || null
}

function isCsrfFailure(payload: unknown, status: number): boolean {
  if (status !== 403 || !isRecord(payload) || !isRecord(payload.error)) return false
  return payload.error.code === 'FORBIDDEN' && typeof payload.error.message === 'string' && payload.error.message.toLowerCase().includes('csrf')
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

// ---------------------------------------------------------------------------
// PR #48 — Store Coach client
// ---------------------------------------------------------------------------

const coachPath = (path: string, storeId: string): string => `${path}?storeId=${encodeURIComponent(storeId)}`

export function fetchCoachHuddle(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachHuddle> { return requestJson(coachPath('/store-coach/huddle/today', storeId), {}, fetcher) }
export function fetchCoachHuddleHistory(storeId: string, days: number, fetcher: Fetcher = fetch): Promise<readonly { id: string; huddleDate: string; content: Readonly<Record<string, unknown>>; viewedAt: number | null; createdAt: number }[]> { return requestJson(coachPath(`/store-coach/huddle/history?days=${Math.max(1, days)}`, storeId), {}, fetcher) }
export function markCoachHuddleViewed(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<unknown> { return requestJson(coachPath(`/store-coach/huddle/${encodeURIComponent(id)}/viewed`, storeId), { method: 'POST' }, fetcher) }
export function regenerateCoachHuddle(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachHuddle> { return requestJson(coachPath('/store-coach/huddle/generate', storeId), { method: 'POST' }, fetcher) }

export function fetchCoachPriorities(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachPrioritiesView> { return requestJson(coachPath('/store-coach/priorities/today', storeId), {}, fetcher) }
export function completeCoachPriority(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<unknown> { return requestJson(coachPath(`/store-coach/priorities/${encodeURIComponent(id)}/complete`, storeId), { method: 'POST' }, fetcher) }
export function dismissCoachPriority(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<unknown> { return requestJson(coachPath(`/store-coach/priorities/${encodeURIComponent(id)}/dismiss`, storeId), { method: 'POST' }, fetcher) }
export function regenerateCoachPriorities(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachPrioritiesView> { return requestJson(coachPath('/store-coach/priorities/generate', storeId), { method: 'POST' }, fetcher) }

export function fetchCoachGoals(storeId: string, status?: string, fetcher: Fetcher = fetch): Promise<readonly import('./store-coach-model.js').CoachGoal[]> { return requestJson(coachPath(status ? `/store-coach/goals?status=${encodeURIComponent(status)}` : '/store-coach/goals', storeId), {}, fetcher) }
export function createCoachGoal(storeId: string, input: Readonly<Record<string, unknown>>, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachGoal> { return requestJson(coachPath('/store-coach/goals', storeId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, fetcher) }
export function updateCoachGoal(storeId: string, id: string, patch: Readonly<Record<string, unknown>>, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachGoal> { return requestJson(coachPath(`/store-coach/goals/${encodeURIComponent(id)}`, storeId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }, fetcher) }
export function deleteCoachGoal(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<Readonly<{ deleted: boolean }>> { return requestJson(coachPath(`/store-coach/goals/${encodeURIComponent(id)}`, storeId), { method: 'DELETE' }, fetcher) }
export function fetchCoachGoalSuggestions(storeId: string, fetcher: Fetcher = fetch): Promise<readonly import('./store-coach-model.js').CoachGoalSuggestion[]> { return requestJson(coachPath('/store-coach/goals/suggestions', storeId), {}, fetcher) }
export function acceptCoachGoalSuggestion(storeId: string, suggestion: Readonly<Record<string, unknown>>, startDate: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachGoal> { return requestJson(coachPath('/store-coach/goals/suggestion/accept-suggestion', storeId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suggestion, startDate }) }, fetcher) }
export function fetchCoachGoalProgress(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachGoalProgress> { return requestJson(coachPath(`/store-coach/goals/${encodeURIComponent(id)}/progress`, storeId), {}, fetcher) }

export function fetchCoachAchievements(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ earned: readonly import('./store-coach-model.js').CoachAchievement[]; visible: number }>> { return requestJson(coachPath('/store-coach/achievements', storeId), {}, fetcher) }
export function fetchCoachAvailableAchievements(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ earnedIds: readonly string[]; catalog: readonly import('./store-coach-model.js').CoachBadgeCatalogEntry[]; visible: number }>> { return requestJson(coachPath('/store-coach/achievements/available', storeId), {}, fetcher) }
export function fetchCoachStreak(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachStreakView> { return requestJson(coachPath('/store-coach/streak', storeId), {}, fetcher) }

export function fetchCoachProgressSummary(storeId: string, days: number, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachProgressSummary> { return requestJson(coachPath(`/store-coach/progress/summary?days=${Math.max(1, days)}`, storeId), {}, fetcher) }
export function fetchCoachProgressTrends(storeId: string, metric: string, days: number, fetcher: Fetcher = fetch): Promise<Readonly<{ metric: string; window: number; series: readonly Readonly<Record<string, string | number>>[] }>> { return requestJson(coachPath(`/store-coach/progress/trends?metric=${encodeURIComponent(metric)}&days=${Math.max(1, days)}`, storeId), {}, fetcher) }
export function fetchCoachActivityHeatmap(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachHeatmapView> { return requestJson(coachPath('/store-coach/progress/heatmap', storeId), {}, fetcher) }
export function fetchCoachProgressComparisons(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<Record<string, unknown>>> { return requestJson(coachPath('/store-coach/progress/comparisons', storeId), {}, fetcher) }

/** Streams the coach reply over SSE and resolves with the final message. */
export async function streamCoachChat(storeId: string, message: string, onDelta: (fullText: string) => void, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachMessage> {
  let response: Response
  try {
    response = await fetcher(coachPath('/store-coach/chat', storeId), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
      body: JSON.stringify({ message }),
    })
  } catch (error: unknown) {
    throw new ApiClientError(error instanceof Error ? error.message : 'Network request failed', 0, 'NETWORK_ERROR')
  }
  if (!response.ok || !response.body) {
    let payload: unknown = null
    try { payload = await response.json() } catch { payload = null }
    throw failureFromPayload(payload, response.status)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalMessage: import('./store-coach-model.js').CoachMessage | null = null
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    buffer += decoder.decode(step.value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const rawFrame = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      if (!rawFrame.startsWith('data:')) continue
      const payload: unknown = JSON.parse(rawFrame.slice(5).trim())
      if (!isRecord(payload)) continue
      if (payload.type === 'delta' && typeof payload.text === 'string') onDelta(payload.text)
      if (payload.type === 'done' && isRecord(payload.message)) finalMessage = payload.message as unknown as import('./store-coach-model.js').CoachMessage
      if (payload.type === 'error') throw new ApiClientError(String(payload.message ?? 'Chat stream failed'), Number(payload.status ?? 502), String(payload.code ?? 'API_ERROR'))
    }
  }
  if (!finalMessage) throw new ApiClientError('Chat stream ended without a reply', 0, 'STREAM_INCOMPLETE')
  return finalMessage
}

export function fetchCoachChatHistory(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ id: string; messages: readonly import('./store-coach-model.js').CoachMessage[] }>> { return requestJson(coachPath('/store-coach/chat/history', storeId), {}, fetcher) }
export function clearCoachChat(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ cleared: boolean }>> { return requestJson(coachPath('/store-coach/chat/clear', storeId), { method: 'POST' }, fetcher) }
export function fetchCoachChatSuggestions(storeId: string, fetcher: Fetcher = fetch): Promise<readonly string[]> { return requestJson(coachPath('/store-coach/chat/suggestions', storeId), {}, fetcher) }

export function fetchCoachReview(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachReviewView> { return requestJson(coachPath('/store-coach/review/current', storeId), {}, fetcher) }
export function fetchCoachReviewHistory(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ reports: readonly Readonly<{ id: string; reportType: string; reportDate: string; createdAt: number; sentViaEmail: boolean }>[] }>> { return requestJson(coachPath('/store-coach/review/history', storeId), {}, fetcher) }
export function regenerateCoachReview(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachReviewView> { return requestJson(coachPath('/store-coach/review/generate', storeId), { method: 'POST' }, fetcher) }
export function fetchCoachReviewPdf(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<Readonly<{ pdfUrl: string }>> { return requestJson(coachPath(`/store-coach/review/${encodeURIComponent(id)}/pdf`, storeId), {}, fetcher) }
export function emailCoachReview(storeId: string, id: string, fetcher: Fetcher = fetch): Promise<Readonly<{ sent: boolean }>> { return requestJson(coachPath(`/store-coach/review/${encodeURIComponent(id)}/email`, storeId), { method: 'POST' }, fetcher) }

export function fetchCoachPreferences(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachPreferencesView> { return requestJson(coachPath('/store-coach/preferences', storeId), {}, fetcher) }
export function updateCoachPreferences(storeId: string, patch: Readonly<Record<string, unknown>>, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachPreferencesView> { return requestJson(coachPath('/store-coach/preferences', storeId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }, fetcher) }

export function fetchCoachHealthScore(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachHealthView> { return requestJson(coachPath('/store-coach/health-score', storeId), {}, fetcher) }
export function fetchCoachOnboarding(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachOnboardingView> { return requestJson(coachPath('/store-coach/onboarding/status', storeId), {}, fetcher) }
export function completeCoachOnboardingStep(storeId: string, step: number, fetcher: Fetcher = fetch): Promise<Readonly<{ currentStep: number; completed: boolean; skipped: boolean }>> { return requestJson(coachPath('/store-coach/onboarding/complete-step', storeId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step }) }, fetcher) }
export function skipCoachOnboarding(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ currentStep: number; completed: boolean; skipped: boolean }>> { return requestJson(coachPath('/store-coach/onboarding/skip', storeId), { method: 'POST' }, fetcher) }

export function fetchCoachUsage(storeId: string, fetcher: Fetcher = fetch): Promise<import('./store-coach-model.js').CoachUsageView> { return requestJson(coachPath('/store-coach/usage', storeId), {}, fetcher) }
export function fetchCoachCostSummary(storeId: string, fetcher: Fetcher = fetch): Promise<Readonly<{ tracked: boolean }>> { return requestJson(coachPath('/store-coach/cost-summary', storeId), {}, fetcher) }
